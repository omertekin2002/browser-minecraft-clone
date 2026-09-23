import type { GL, Program } from './gl/GL';
import type { MeshData } from '../world/mesh/Mesher';

/** Width of the shared quad heap texture (quads per row). Must match chunk.vert. */
export const HEAP_W = 4096;
/** Max draws per multi-draw batch. Must match the uChunkData array size in chunk.vert. */
export const MAX_BATCH = 256;
const ALIGN = 64;

export interface ChunkGPU {
  cx: number;
  cz: number;
  /** First quad of this chunk inside the heap (-1 = none). */
  start: number;
  /** Allocated quad slots. */
  alloc: number;
  opaqueCount: number;
  opaqueLit: number;
  cutoutCount: number;
  cutoutLit: number;
  translucentCount: number;
  minY: number;
  maxY: number;
  /** CPU copy of the quads (needed when the heap grows). */
  quads: Uint32Array | null;
}

/** 'opaqueLit' / 'cutoutLit' skip cave-only quads (used by shadow passes). */
export type Range = 'opaque' | 'cutout' | 'translucent' | 'opaqueLit' | 'cutoutLit';

export const WATER_MAP_SIZE = 1024;

/**
 * All chunk quads live in one RGBA32UI "quad heap" texture that chunk.vert pulls vertices from.
 * Every pass draws all visible chunks with a single WEBGL_multi_draw call (per-chunk offsets come
 * from gl_DrawID), which keeps WebGL's per-draw overhead out of the frame.
 */
export class ChunkMeshes {
  readonly map = new Map<number, ChunkGPU>();
  totalQuads = 0;
  heapTex: WebGLTexture;
  private heapRows = 256;
  private freeList: Array<[number, number]> = [];
  readonly multiDraw: WEBGL_multi_draw | null;
  /** Toroidal R16F map (world xz mod 1024) of the highest water block y per column (-1000 = none). */
  readonly waterMap: WebGLTexture;
  /** 64×64 toroidal R8 mask: 1 where a chunk column has a mesh (the far terrain hides there). */
  readonly chunkMask: WebGLTexture;
  private waterScratch = new Float32Array(256);
  private maskByte = new Uint8Array(1);
  private firsts = new Int32Array(4096);
  private counts = new Int32Array(4096);
  private chunkData = new Float32Array(4096 * 4);

  constructor(private gl: GL) {
    this.multiDraw = gl.getExtension('WEBGL_multi_draw');
    this.heapTex = this.createHeap(this.heapRows);
    this.freeList = [[0, HEAP_W * this.heapRows]];

    this.waterMap = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.waterMap);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, WATER_MAP_SIZE, WATER_MAP_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const init = new Float32Array(WATER_MAP_SIZE * WATER_MAP_SIZE).fill(-1000);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WATER_MAP_SIZE, WATER_MAP_SIZE, gl.RED, gl.FLOAT, init);

    this.chunkMask = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.chunkMask);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, 64, 64);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 64, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(64 * 64));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  get bytes(): number {
    return HEAP_W * this.heapRows * 16;
  }

  private createHeap(rows: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, HEAP_W, rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // ---------------------------------------------------------------------------
  // Heap allocation (first fit over a sorted free list)
  // ---------------------------------------------------------------------------

  private allocate(n: number): number {
    const size = Math.ceil(n / ALIGN) * ALIGN;
    for (let i = 0; i < this.freeList.length; i++) {
      const [s, len] = this.freeList[i];
      if (len >= size) {
        if (len === size) this.freeList.splice(i, 1);
        else this.freeList[i] = [s + size, len - size];
        return s;
      }
    }
    return -1;
  }

  private release(start: number, n: number) {
    const size = Math.ceil(n / ALIGN) * ALIGN;
    const fl = this.freeList;
    let i = 0;
    while (i < fl.length && fl[i][0] < start) i++;
    fl.splice(i, 0, [start, size]);
    if (i + 1 < fl.length && fl[i][0] + fl[i][1] === fl[i + 1][0]) {
      fl[i][1] += fl[i + 1][1];
      fl.splice(i + 1, 1);
    }
    if (i > 0 && fl[i - 1][0] + fl[i - 1][1] === fl[i][0]) {
      fl[i - 1][1] += fl[i][1];
      fl.splice(i, 1);
    }
  }

  /** Doubles the heap and re-uploads every chunk (rare). */
  private grow() {
    const gl = this.gl;
    this.heapRows *= 2;
    gl.deleteTexture(this.heapTex);
    this.heapTex = this.createHeap(this.heapRows);
    this.freeList = [[0, HEAP_W * this.heapRows]];
    for (const g of this.map.values()) {
      if (!g.quads || g.alloc === 0) continue;
      const total = g.opaqueCount + g.cutoutCount + g.translucentCount;
      g.start = this.allocate(total);
      g.alloc = total;
      this.writeQuads(g.start, g.quads, total);
    }
  }

  private writeQuads(start: number, data: Uint32Array, count: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.heapTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    let off = 0, pos = start;
    while (off < count) {
      const row = Math.floor(pos / HEAP_W), col = pos % HEAP_W;
      if (col === 0 && count - off >= HEAP_W) {
        const rows = Math.floor((count - off) / HEAP_W);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, row, HEAP_W, rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data, off * 4);
        off += rows * HEAP_W;
        pos += rows * HEAP_W;
        continue;
      }
      const n = Math.min(HEAP_W - col, count - off);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, col, row, n, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data, off * 4);
      off += n;
      pos += n;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-chunk side maps
  // ---------------------------------------------------------------------------

  private writeWater(cx: number, cz: number, top: Int16Array | null) {
    const gl = this.gl;
    for (let i = 0; i < 256; i++) this.waterScratch[i] = top && top[i] >= 0 ? top[i] : -1000;
    const x = ((cx * 16) % WATER_MAP_SIZE + WATER_MAP_SIZE) % WATER_MAP_SIZE;
    const z = ((cz * 16) % WATER_MAP_SIZE + WATER_MAP_SIZE) % WATER_MAP_SIZE;
    gl.bindTexture(gl.TEXTURE_2D, this.waterMap);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, z, 16, 16, gl.RED, gl.FLOAT, this.waterScratch);
  }

  private writeMask(cx: number, cz: number, on: boolean) {
    const gl = this.gl;
    this.maskByte[0] = on ? 255 : 0;
    gl.bindTexture(gl.TEXTURE_2D, this.chunkMask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, cx & 63, cz & 63, 1, 1, gl.RED, gl.UNSIGNED_BYTE, this.maskByte);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  upload(key: number, d: MeshData) {
    const total = d.opaqueCount + d.cutoutCount + d.translucentCount;
    let g = this.map.get(key);
    if (!g) {
      g = { cx: d.cx, cz: d.cz, start: -1, alloc: 0, opaqueCount: 0, opaqueLit: 0, cutoutCount: 0, cutoutLit: 0, translucentCount: 0, minY: 0, maxY: 0, quads: null };
      this.map.set(key, g);
    }
    this.totalQuads -= g.opaqueCount + g.cutoutCount + g.translucentCount;
    this.totalQuads += total;
    if (g.alloc > 0 && (total > Math.ceil(g.alloc / ALIGN) * ALIGN || total === 0)) {
      this.release(g.start, g.alloc);
      g.start = -1;
      g.alloc = 0;
    }
    if (total > 0 && g.start < 0) {
      let s = this.allocate(total);
      while (s < 0) {
        this.grow();
        s = this.allocate(total);
      }
      g.start = s;
      g.alloc = total;
    }
    g.opaqueCount = d.opaqueCount;
    g.opaqueLit = d.opaqueLit;
    g.cutoutCount = d.cutoutCount;
    g.cutoutLit = d.cutoutLit;
    g.translucentCount = d.translucentCount;
    g.minY = d.minY;
    g.maxY = d.maxY;
    g.quads = d.quads;
    if (total > 0) this.writeQuads(g.start, d.quads, total);
    this.writeWater(d.cx, d.cz, d.waterTop);
    this.writeMask(d.cx, d.cz, true);
  }

  remove(key: number) {
    const g = this.map.get(key);
    if (!g) return;
    if (g.alloc > 0) this.release(g.start, g.alloc);
    this.totalQuads -= g.opaqueCount + g.cutoutCount + g.translucentCount;
    this.writeWater(g.cx, g.cz, null);
    this.writeMask(g.cx, g.cz, false);
    this.map.delete(key);
  }

  /**
   * Draws one range of each listed chunk with the program currently in use (uQuads must be bound to
   * the heap texture). Returns the number of quads drawn.
   */
  draw(prog: Program, list: ChunkGPU[], range: Range, camX: number, camY: number, camZ: number): number {
    const gl = this.gl;
    let n = 0, quads = 0;
    for (const g of list) {
      let start = 0, count = 0;
      if (range === 'opaque') { start = 0; count = g.opaqueCount; }
      else if (range === 'opaqueLit') { start = 0; count = g.opaqueLit; }
      else if (range === 'cutout') { start = g.opaqueCount; count = g.cutoutCount; }
      else if (range === 'cutoutLit') { start = g.opaqueCount; count = g.cutoutLit; }
      else { start = g.opaqueCount + g.cutoutCount; count = g.translucentCount; }
      if (count === 0 || g.start < 0) continue;
      if (n >= this.firsts.length) break;
      const ox = g.cx * 16, oz = g.cz * 16;
      this.firsts[n] = (g.start + start) * 6;
      this.counts[n] = count * 6;
      this.chunkData[n * 4] = ox - camX;
      this.chunkData[n * 4 + 1] = oz - camZ;
      this.chunkData[n * 4 + 2] = ((ox % 4096) + 4096) % 4096;
      this.chunkData[n * 4 + 3] = ((oz % 4096) + 4096) % 4096;
      n++;
      quads += count;
    }
    if (n === 0) return 0;
    gl.uniform1f(prog.loc('uChunkY'), -camY);
    const locData = prog.loc('uChunkData');
    for (let b = 0; b < n; b += MAX_BATCH) {
      const cnt = Math.min(MAX_BATCH, n - b);
      gl.uniform4fv(locData, this.chunkData, b * 4, cnt * 4);
      if (this.multiDraw) {
        this.multiDraw.multiDrawArraysWEBGL(gl.TRIANGLES, this.firsts, b, this.counts, b, cnt);
      } else {
        const locId = prog.loc('uDrawID');
        for (let k = 0; k < cnt; k++) {
          gl.uniform1i(locId, k);
          gl.drawArrays(gl.TRIANGLES, this.firsts[b + k], this.counts[b + k]);
        }
      }
    }
    return quads;
  }

  dispose() {
    for (const k of [...this.map.keys()]) this.remove(k);
  }
}
