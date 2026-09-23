import * as B from '../blocks';
import { Shape, RenderLayer } from '../blocks';
import { hash3 } from '../gen/noise';

/**
 * Chunk mesher.
 *
 * Works on a padded 50×50×258 region built from the 3×3 chunk neighbourhood so light can be
 * flood-filled exactly for the centre chunk (light never travels further than 15 blocks).
 *
 * Output quads are 4×uint32 ("vertex pulling" format, decoded in chunk.vert):
 *   w0: x+32 (9 bits, 1/16 block) | z+32 (9 bits) << 9 | y (13 bits) << 18
 *   w1: face (3) | sizeU-1 (8) << 3 | sizeV-1 (8) << 11 | texture layer (10) << 19
 *   w2: sky light ×4 corners (4 bits each) | block light ×4 corners << 16
 *   w3: AO ×4 corners (2 bits each) | tint temperature << 8 | flags << 16 | tint humidity << 24
 * Corners are ordered (u,v) = (0,0), (1,0), (1,1), (0,1).
 */

const W = 50;
const D = 50;
const LAYER = W * D;
const RH = 258;
const REGION_SIZE = LAYER * RH;
const CENTER = 17; // padded coordinate of the centre chunk's local x/z = 0

// Region-index offsets per face: +X, -X, +Y, -Y, +Z, -Z
const OFF = [1, -1, LAYER, -LAYER, W, -W];
// Quad U / V axes per face in region-index units (see chunk.vert for the geometric definition).
const U_OFF = [-W, W, 1, 1, 1, -1];
const V_OFF = [LAYER, LAYER, -W, W, LAYER, LAYER];

export const FLAG_WAVE_LEAVES = 1;
export const FLAG_WAVE_PLANT = 2;
export const FLAG_FLIP = 1 << 5;
export const FLAG_UP_NORMAL = 1 << 6;

const { IS_OPAQUE, LIGHT_OPACITY, EMISSION, SHAPE, LAYER: BLOCK_LAYER, FACE_TEX, TINT, WAVING, CULL_SAME, UP_NORMAL, IS_LIQUID } = B;

class QuadList {
  data: Uint32Array;
  count = 0;
  constructor(cap: number) {
    this.data = new Uint32Array(cap * 4);
  }
  reset() {
    this.count = 0;
  }
  push(w0: number, w1: number, w2: number, w3: number) {
    if ((this.count + 1) * 4 > this.data.length) {
      const n = new Uint32Array(this.data.length * 2);
      n.set(this.data);
      this.data = n;
    }
    const o = this.count * 4;
    this.data[o] = w0;
    this.data[o + 1] = w1;
    this.data[o + 2] = w2;
    this.data[o + 3] = w3;
    this.count++;
  }
}

export interface MeshData {
  cx: number;
  cz: number;
  /**
   * All quads: opaque, then cutout, then translucent. Within the opaque and cutout ranges, quads that
   * receive some sky light come first; fully dark (cave-only) quads follow and are skipped by shadow passes.
   */
  quads: Uint32Array;
  opaqueCount: number;
  opaqueLit: number;
  cutoutCount: number;
  cutoutLit: number;
  translucentCount: number;
  minY: number;
  maxY: number;
  /** Per column (z*16+x): y of the highest water block, or -1. */
  waterTop: Int16Array;
}

export type TintFn = (wx: number, wz: number) => number;

export class Mesher {
  private region = new Uint8Array(REGION_SIZE);
  private sky = new Uint8Array(REGION_SIZE);
  private blk = new Uint8Array(REGION_SIZE);
  private queue = new Int32Array(1 << 21);
  // 0 opaque (lit), 1 cutout (lit), 2 translucent, 3 opaque (dark), 4 cutout (dark)
  private lists = [new QuadList(8192), new QuadList(4096), new QuadList(2048), new QuadList(4096), new QuadList(1024)];
  private mask = new Float64Array(256);
  private corner = new Int32Array(12);
  private tints = new Uint16Array(256);
  private minY = 256;
  private maxY = 0;

  /**
   * @param chunks 3×3 neighbourhood, index (dz+1)*3 + (dx+1). All must be present.
   */
  mesh(cx: number, cz: number, chunks: Uint8Array[], tintFn: TintFn): MeshData {
    const region = this.region;
    region.fill(0);

    // --- find the vertical extent of the neighbourhood ---
    let maxSolid = 0;
    for (const c of chunks) maxSolid = Math.max(maxSolid, Mesher.topOf(c));
    const H = Math.min(256, maxSolid + 2);

    // --- build padded region, collect emitters ---
    const seeds = this.queue;
    let emitters = 0;
    const emitterList: number[] = [];
    for (let n = 0; n < 9; n++) {
      const src = chunks[n];
      const xo = 1 + (n % 3) * 16;
      const zo = 1 + Math.floor(n / 3) * 16;
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < 16; z++) {
          const s = (y << 8) | (z << 4);
          const d = (y * D + zo + z) * W + xo;
          for (let x = 0; x < 16; x++) {
            const b = src[s + x];
            region[d + x] = b;
            if (b !== 0 && EMISSION[b] !== 0) emitterList.push(d + x);
          }
        }
      }
    }
    // Opaque walls around the region stop light at the border.
    for (let y = 0; y < RH; y++) {
      const base = y * LAYER;
      for (let i = 0; i < W; i++) {
        region[base + i] = B.STONE;
        region[base + (D - 1) * W + i] = B.STONE;
        region[base + i * W] = B.STONE;
        region[base + i * W + W - 1] = B.STONE;
      }
    }

    // --- sky light ---
    const sky = this.sky, blk = this.blk;
    sky.fill(0, 0, (H + 1) * LAYER);
    blk.fill(0, 0, (H + 1) * LAYER);
    sky.fill(15, H * LAYER, (H + 1) * LAYER);
    for (let z = 1; z < D - 1; z++) {
      for (let x = 1; x < W - 1; x++) {
        let light = 15;
        for (let y = H - 1; y >= 0; y--) {
          const i = (y * D + z) * W + x;
          const op = LIGHT_OPACITY[region[i]];
          if (op >= 15) break;
          if (!(light === 15 && op === 0)) light -= op > 1 ? op : 1;
          if (light <= 0) break;
          sky[i] = light;
        }
      }
    }
    // Seed the flood fill with lit cells next to darker transparent neighbours.
    const mask = seeds.length - 1;
    let tail = 0;
    for (let y = 0; y < H; y++) {
      for (let z = 1; z < D - 1; z++) {
        const row = (y * D + z) * W;
        for (let x = 1; x < W - 1; x++) {
          const i = row + x;
          const L = sky[i];
          if (L < 2) continue;
          const t = L - 1;
          if ((sky[i + 1] < t && LIGHT_OPACITY[region[i + 1]] < 15) ||
              (sky[i - 1] < t && LIGHT_OPACITY[region[i - 1]] < 15) ||
              (sky[i + W] < t && LIGHT_OPACITY[region[i + W]] < 15) ||
              (sky[i - W] < t && LIGHT_OPACITY[region[i - W]] < 15)) {
            seeds[tail] = i;
            tail = (tail + 1) & mask;
          }
        }
      }
    }
    this.propagate(sky, tail, (H + 1) * LAYER);

    // --- block light ---
    tail = 0;
    for (const i of emitterList) {
      blk[i] = EMISSION[region[i]];
      seeds[tail] = i;
      tail = (tail + 1) & mask;
      emitters++;
    }
    if (emitters > 0) this.propagate(blk, tail, (H + 1) * LAYER);

    // --- tints for the centre chunk ---
    const wx0 = cx * 16, wz0 = cz * 16;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) this.tints[z * 16 + x] = tintFn(wx0 + x, wz0 + z);

    // --- meshing ---
    for (const l of this.lists) l.reset();
    this.minY = 256;
    this.maxY = 0;
    const centerTop = Math.min(255, Mesher.topOf(chunks[4]));
    const lastSection = centerTop >> 4;
    for (let s = 0; s <= lastSection; s++) {
      for (let f = 0; f < 6; f++) this.greedyFaces(s, f, H);
      this.specialShapes(s, cx, cz);
    }

    // Highest water block per column (for underwater lighting / caustics).
    const waterTop = new Int16Array(256).fill(-1);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        for (let y = centerTop; y >= 0; y--) {
          if (region[(y * D + z + CENTER) * W + x + CENTER] === B.WATER) { waterTop[z * 16 + x] = y; break; }
        }
      }
    }

    const [o, c, t, od, cd] = this.lists;
    const total = o.count + c.count + t.count + od.count + cd.count;
    const quads = new Uint32Array(total * 4);
    let off = 0;
    for (const l of [o, od, c, cd, t]) {
      quads.set(l.data.subarray(0, l.count * 4), off);
      off += l.count * 4;
    }
    return {
      cx, cz, quads,
      opaqueCount: o.count + od.count, opaqueLit: o.count,
      cutoutCount: c.count + cd.count, cutoutLit: c.count,
      translucentCount: t.count,
      minY: total > 0 ? this.minY : 0,
      maxY: total > 0 ? this.maxY : 0,
      waterTop,
    };
  }

  /** Highest non-air y in a chunk column (0 if empty). */
  static topOf(c: Uint8Array): number {
    for (let s = 15; s >= 0; s--) {
      const base = s << 12;
      for (let i = base + 4095; i >= base; i--) {
        if (c[i] !== 0) return i >> 8;
      }
    }
    return 0;
  }

  private propagate(light: Uint8Array, tail: number, limit: number) {
    const q = this.queue, qm = q.length - 1, region = this.region;
    let head = 0;
    const offs = [1, -1, W, -W, LAYER, -LAYER];
    while (head !== tail) {
      const idx = q[head];
      head = (head + 1) & qm;
      const L = light[idx];
      if (L <= 1) continue;
      for (let k = 0; k < 6; k++) {
        const n = idx + offs[k];
        if (n < 0 || n >= limit) continue;
        const op = LIGHT_OPACITY[region[n]];
        if (op >= 15) continue;
        const nl = L - (op > 1 ? op : 1);
        if (nl > light[n]) {
          light[n] = nl;
          const nt = (tail + 1) & qm;
          if (nt === head) return; // queue overflow: give up on remaining light (never happens in practice)
          q[tail] = n;
          tail = nt;
        }
      }
    }
  }

  /** Fills this.corner with AO[0..3], sky[4..7], block[8..11] for a face. */
  private faceCorners(idx: number, f: number) {
    const region = this.region, sky = this.sky, blk = this.blk, out = this.corner;
    const F = idx + OFF[f];
    const U = U_OFF[f], V = V_OFF[f];
    const sF = sky[F], bF = blk[F];
    for (let k = 0; k < 4; k++) {
      const su = k === 1 || k === 2 ? U : -U;
      const sv = k >= 2 ? V : -V;
      const s1 = F + su, s2 = F + sv, c = s1 + sv;
      const o1 = IS_OPAQUE[region[s1]], o2 = IS_OPAQUE[region[s2]], oc = IS_OPAQUE[region[c]];
      out[k] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
      let ss = sF, bs = bF, n = 1;
      if (!o1) { ss += sky[s1]; bs += blk[s1]; n++; }
      if (!o2) { ss += sky[s2]; bs += blk[s2]; n++; }
      if (!oc && !(o1 && o2)) { ss += sky[c]; bs += blk[c]; n++; }
      out[4 + k] = Math.round(ss / n);
      out[8 + k] = Math.round(bs / n);
    }
  }

  private pushQuad(
    list: number, px: number, py: number, pz: number, face: number, su: number, sv: number, layer: number,
    sky4: number, blk4: number, ao4: number, tint: number, flags: number,
  ) {
    const w0 = (px + 32) | ((pz + 32) << 9) | (py << 18);
    const w1 = face | ((su - 1) << 3) | ((sv - 1) << 11) | (layer << 19);
    const w2 = sky4 | (blk4 << 16);
    const w3 = ao4 | ((tint >> 8) << 8) | (flags << 16) | ((tint & 255) << 24);
    // Quads that never see the sky (caves) go to the "dark" lists so shadow passes can skip them.
    const target = list < 2 && sky4 === 0 ? list + 3 : list;
    this.lists[target].push(w0, w1, w2, w3);
    const y0 = py >> 4;
    const y1 = (py + (face === 2 || face === 3 ? 0 : sv) + 15) >> 4;
    if (y0 < this.minY) this.minY = y0;
    if (y1 > this.maxY) this.maxY = y1;
  }

  private static listFor(b: number): number {
    return BLOCK_LAYER[b] === RenderLayer.OPAQUE ? 0 : BLOCK_LAYER[b] === RenderLayer.CUTOUT ? 1 : 2;
  }

  private static tintFlags(b: number): number {
    return (WAVING[b] & 3) | ((TINT[b] & 7) << 2);
  }

  /** Whether a cube face of block b towards neighbour n is visible. */
  private static cubeFaceVisible(b: number, n: number): boolean {
    if (IS_OPAQUE[n]) return false;
    if (n === b && CULL_SAME[b]) return false;
    // Translucent solids (ice) hide faces of other translucent/cutout neighbours of the same kind.
    return true;
  }

  /**
   * Greedy meshing of cube faces (and liquid tops) for one section and face direction.
   * Only faces whose four corners share identical AO/light values are merged, so the merged
   * result is visually identical to the per-face mesh.
   */
  private greedyFaces(s: number, f: number, H: number) {
    const region = this.region;
    const maskArr = this.mask;
    const cr = this.corner;
    const yBase = s * 16;
    const off = OFF[f];

    for (let d = 0; d < 16; d++) {
      let any = false;
      for (let b = 0; b < 16; b++) {
        for (let a = 0; a < 16; a++) {
          let lx: number, y: number, lz: number;
          if (f <= 1) { lx = d; lz = a; y = yBase + b; }
          else if (f <= 3) { lx = a; lz = b; y = yBase + d; }
          else { lx = a; lz = d; y = yBase + b; }
          maskArr[b * 16 + a] = 0;
          if (y >= H) continue;
          const idx = (y * D + lz + CENTER) * W + lx + CENTER;
          const blk = region[idx];
          if (blk === 0) continue;
          const shape = SHAPE[blk];
          const liquidTop = shape === Shape.LIQUID && f === 2;
          if (shape !== Shape.CUBE && !liquidTop) continue;
          if (f === 3 && y === 0) continue;
          const nb = region[idx + off];
          if (liquidTop) {
            if (IS_LIQUID[nb] || IS_OPAQUE[nb] || nb === B.ICE) continue;
          } else if (!Mesher.cubeFaceVisible(blk, nb)) continue;

          const layer = FACE_TEX[blk * 6 + f];
          const tint = TINT[blk] ? this.tints[lz * 16 + lx] : 0;
          const flags = Mesher.tintFlags(blk);
          let ao4: number, sky4: number, blk4: number;
          let uniform: boolean;
          if (liquidTop) {
            // Liquids are lit by the cell above, no AO.
            this.faceCorners(idx, f);
            ao4 = 0xff;
            sky4 = cr[4] | (cr[5] << 4) | (cr[6] << 8) | (cr[7] << 12);
            blk4 = cr[8] | (cr[9] << 4) | (cr[10] << 8) | (cr[11] << 12);
            uniform = cr[4] === cr[5] && cr[5] === cr[6] && cr[6] === cr[7] && cr[8] === cr[9] && cr[9] === cr[10] && cr[10] === cr[11];
          } else {
            this.faceCorners(idx, f);
            ao4 = cr[0] | (cr[1] << 2) | (cr[2] << 4) | (cr[3] << 6);
            sky4 = cr[4] | (cr[5] << 4) | (cr[6] << 8) | (cr[7] << 12);
            blk4 = cr[8] | (cr[9] << 4) | (cr[10] << 8) | (cr[11] << 12);
            uniform = cr[0] === cr[1] && cr[1] === cr[2] && cr[2] === cr[3] &&
              cr[4] === cr[5] && cr[5] === cr[6] && cr[6] === cr[7] &&
              cr[8] === cr[9] && cr[9] === cr[10] && cr[10] === cr[11];
          }
          const list = Mesher.listFor(blk);
          if (!uniform) {
            this.emitRect(f, s, d, a, b, a + 1, b + 1, liquidTop, list, layer, sky4, blk4, ao4, tint, flags);
            continue;
          }
          // key: layer | tint | flags | ao | sky | block | liquid | list
          maskArr[b * 16 + a] = 1 + layer + 1024 * (tint + 65536 * (flags + 256 * ((ao4 & 3) + 4 * (cr[4] + 16 * (cr[8] + 16 * ((liquidTop ? 1 : 0) + 2 * list))))));
          any = true;
        }
      }
      if (!any) continue;

      // Greedy rectangle extraction.
      for (let b = 0; b < 16; b++) {
        for (let a = 0; a < 16;) {
          const key = maskArr[b * 16 + a];
          if (key === 0) { a++; continue; }
          let w = 1;
          while (a + w < 16 && maskArr[b * 16 + a + w] === key) w++;
          let h = 1;
          outer: while (b + h < 16) {
            for (let k = 0; k < w; k++) if (maskArr[(b + h) * 16 + a + k] !== key) break outer;
            h++;
          }
          for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) maskArr[(b + hh) * 16 + a + k] = 0;

          // Decode key.
          let k2 = key - 1;
          const layer = k2 % 1024; k2 = Math.floor(k2 / 1024);
          const tint = k2 % 65536; k2 = Math.floor(k2 / 65536);
          const flags = k2 % 256; k2 = Math.floor(k2 / 256);
          const ao = k2 % 4; k2 = Math.floor(k2 / 4);
          const sk = k2 % 16; k2 = Math.floor(k2 / 16);
          const bl = k2 % 16; k2 = Math.floor(k2 / 16);
          const liquid = (k2 & 1) === 1;
          const list = k2 >> 1;
          const ao4 = liquid ? 0xff : ao | (ao << 2) | (ao << 4) | (ao << 6);
          const sky4 = sk | (sk << 4) | (sk << 8) | (sk << 12);
          const blk4 = bl | (bl << 4) | (bl << 8) | (bl << 12);
          this.emitRect(f, s, d, a, b, a + w, b + h, liquid, list, layer, sky4, blk4, ao4, tint, flags);
          a += w;
        }
      }
    }
  }

  /** Emits a (possibly merged) axis-aligned face rectangle given in slice coordinates. */
  private emitRect(
    f: number, s: number, d: number, a0: number, b0: number, a1: number, b1: number, liquid: boolean,
    list: number, layer: number, sky4: number, blk4: number, ao4: number, tint: number, flags: number,
  ) {
    const su = (a1 - a0) * 16, sv = (b1 - b0) * 16;
    const yb = s * 16;
    let px = 0, py = 0, pz = 0;
    switch (f) {
      case 0: px = (d + 1) * 16; py = (yb + b0) * 16; pz = a1 * 16; break;
      case 1: px = d * 16; py = (yb + b0) * 16; pz = a0 * 16; break;
      case 2: px = a0 * 16; py = liquid ? (yb + d) * 16 + 14 : (yb + d + 1) * 16; pz = b1 * 16; break;
      case 3: px = a0 * 16; py = (yb + d) * 16; pz = b0 * 16; break;
      case 4: px = a0 * 16; py = (yb + b0) * 16; pz = (d + 1) * 16; break;
      case 5: px = a1 * 16; py = (yb + b0) * 16; pz = d * 16; break;
    }
    this.pushQuad(list, px, py, pz, f, su, sv, layer, sky4, blk4, ao4, tint, flags);
  }

  /** Non-cube shapes: plants, torches, cactus, liquid sides/bottoms. */
  private specialShapes(s: number, cx: number, cz: number) {
    const region = this.region, sky = this.sky, blk = this.blk, cr = this.corner;
    for (let y = s * 16; y < s * 16 + 16; y++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const idx = (y * D + lz + CENTER) * W + lx + CENTER;
          const b = region[idx];
          if (b === 0) continue;
          const shape = SHAPE[b];
          if (shape === Shape.CUBE || shape === Shape.NONE) continue;
          const list = Mesher.listFor(b);
          const tint = TINT[b] ? this.tints[lz * 16 + lx] : 0;
          const own4s = sky[idx] * 0x1111;
          const own4b = blk[idx] * 0x1111;
          const px = lx * 16, py = y * 16, pz = lz * 16;

          if (shape === Shape.CROSS) {
            const h = hash3(cx * 16 + lx, y, cz * 16 + lz, 0x51f3);
            const ox = (h & 7) - 3, oz = ((h >>> 3) & 7) - 3;
            const flags = Mesher.tintFlags(b) | (UP_NORMAL[b] ? FLAG_UP_NORMAL : 0);
            const layer = FACE_TEX[b * 6];
            const ao4 = 2 | (2 << 2) | (3 << 4) | (3 << 6); // slightly darker at the base
            this.pushQuad(list, px + ox, py, pz + oz, 6, 16, 16, layer, own4s, own4b, ao4, tint, flags);
            this.pushQuad(list, px + ox, py, pz + oz, 6, 16, 16, layer, own4s, own4b, ao4, tint, flags | FLAG_FLIP);
            this.pushQuad(list, px + 16 + ox, py, pz + oz, 7, 16, 16, layer, own4s, own4b, ao4, tint, flags);
            this.pushQuad(list, px + 16 + ox, py, pz + oz, 7, 16, 16, layer, own4s, own4b, ao4, tint, flags | FLAG_FLIP);
          } else if (shape === Shape.TORCH) {
            const layer = FACE_TEX[b * 6];
            const ao4 = 0xff;
            this.pushQuad(list, px + 9, py, pz + 9, 0, 2, 10, layer, own4s, own4b, ao4, 0, 0);
            this.pushQuad(list, px + 7, py, pz + 7, 1, 2, 10, layer, own4s, own4b, ao4, 0, 0);
            this.pushQuad(list, px + 7, py, pz + 9, 4, 2, 10, layer, own4s, own4b, ao4, 0, 0);
            this.pushQuad(list, px + 9, py, pz + 7, 5, 2, 10, layer, own4s, own4b, ao4, 0, 0);
            this.pushQuad(list, px + 7, py + 10, pz + 9, 2, 2, 2, layer, own4s, own4b, ao4, 0, 0);
          } else if (shape === Shape.CACTUS) {
            const ao4 = 0xff;
            const side = FACE_TEX[b * 6];
            this.pushQuad(list, px + 15, py, pz + 16, 0, 16, 16, side, own4s, own4b, ao4, 0, 0);
            this.pushQuad(list, px + 1, py, pz, 1, 16, 16, side, own4s, own4b, ao4, 0, 0);
            this.pushQuad(list, px, py, pz + 15, 4, 16, 16, side, own4s, own4b, ao4, 0, 0);
            this.pushQuad(list, px + 16, py, pz + 1, 5, 16, 16, side, own4s, own4b, ao4, 0, 0);
            const up = region[idx + LAYER], down = region[idx - LAYER];
            if (up !== b && !IS_OPAQUE[up]) {
              this.faceCorners(idx, 2);
              this.pushQuad(list, px, py + 16, pz + 16, 2, 16, 16, FACE_TEX[b * 6 + 2],
                cr[4] | (cr[5] << 4) | (cr[6] << 8) | (cr[7] << 12), cr[8] | (cr[9] << 4) | (cr[10] << 8) | (cr[11] << 12), ao4, 0, 0);
            }
            if (down !== b && !IS_OPAQUE[down]) {
              this.pushQuad(list, px, py, pz, 3, 16, 16, FACE_TEX[b * 6 + 3], own4s, own4b, ao4, 0, 0);
            }
          } else if (shape === Shape.LIQUID) {
            const above = region[idx + LAYER];
            const full = IS_LIQUID[above] && above === b;
            const hgt = full ? 16 : 14;
            const sideFaces = [0, 1, 4, 5];
            for (const f of sideFaces) {
              const nb = region[idx + OFF[f]];
              if (nb === b || IS_OPAQUE[nb]) continue;
              this.faceCorners(idx, f);
              const sky4 = cr[4] | (cr[5] << 4) | (cr[6] << 8) | (cr[7] << 12);
              const blk4 = cr[8] | (cr[9] << 4) | (cr[10] << 8) | (cr[11] << 12);
              const layer = FACE_TEX[b * 6 + f];
              let qx = px, qz = pz;
              if (f === 0) { qx = px + 16; qz = pz + 16; }
              else if (f === 4) qz = pz + 16;
              else if (f === 5) qx = px + 16;
              this.pushQuad(list, qx, py, qz, f, 16, hgt, layer, sky4, blk4, 0xff, 0, 0);
            }
            const below = region[idx - LAYER];
            if (y > 0 && below !== b && !IS_OPAQUE[below]) {
              this.faceCorners(idx, 3);
              const sky4 = cr[4] | (cr[5] << 4) | (cr[6] << 8) | (cr[7] << 12);
              const blk4 = cr[8] | (cr[9] << 4) | (cr[10] << 8) | (cr[11] << 12);
              this.pushQuad(list, px, py, pz, 3, 16, 16, FACE_TEX[b * 6 + 3], sky4, blk4, 0xff, 0, 0);
            }
          }
        }
      }
    }
  }
}
