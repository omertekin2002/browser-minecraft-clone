import type { GL } from './gl/GL';
import type { WorkerPool } from '../world/WorkerPool';

/** Texture size in texels (toroidal addressing: texel = worldTexel & (SIZE - 1)). */
export const FAR_SIZE = 512;
/** World blocks per texel. */
export const FAR_STEP = 8;
/** Texels per generation tile. */
const TILE = 32;
/** Tiles kept around the camera per axis (must be < FAR_SIZE / TILE to keep slots unique). */
const KEEP = 15;
const UNKNOWN = -9999;

/**
 * Streams a coarse height / material map of the terrain far beyond the chunk render distance.
 * Texels hold [height, material, temperature, humidity]; the far-terrain shaders turn it into a mesh.
 */
export class FarTerrain {
  readonly tex: WebGLTexture;
  private tiles = new Map<string, 'pending' | 'ready'>();
  private inFlight = 0;
  private clear = new Float32Array(TILE * TILE * 4);
  enabled = true;
  generation = 0;

  constructor(private gl: GL, private pool: WorkerPool) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, FAR_SIZE, FAR_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    for (let i = 0; i < TILE * TILE; i++) this.clear[i * 4] = UNKNOWN;
    const init = new Float32Array(FAR_SIZE * FAR_SIZE * 4);
    for (let i = 0; i < FAR_SIZE * FAR_SIZE; i++) init[i * 4] = UNKNOWN;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FAR_SIZE, FAR_SIZE, gl.RGBA, gl.FLOAT, init);
  }

  private slot(t: number): number {
    const n = FAR_SIZE / TILE;
    return (((t % n) + n) % n) * TILE;
  }

  private write(tx: number, tz: number, data: Float32Array) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, this.slot(tx), this.slot(tz), TILE, TILE, gl.RGBA, gl.FLOAT, data);
  }

  /** Requests missing tiles around the camera and evicts tiles that fell out of range. */
  update(camX: number, camZ: number) {
    if (!this.enabled) return;
    const blocksPerTile = TILE * FAR_STEP;
    const ctx = Math.floor(camX / blocksPerTile), ctz = Math.floor(camZ / blocksPerTile);
    const lo = -Math.floor(KEEP / 2), hi = lo + KEEP - 1;
    // Evict
    for (const [key, state] of this.tiles) {
      const [tx, tz] = key.split(',').map(Number);
      if (tx - ctx < lo || tx - ctx > hi || tz - ctz < lo || tz - ctz > hi) {
        this.tiles.delete(key);
        if (state === 'ready') this.write(tx, tz, this.clear);
      }
    }
    // Request, nearest first
    if (this.inFlight >= 6) return;
    const wanted: Array<[number, number, number]> = [];
    for (let dz = lo; dz <= hi; dz++) {
      for (let dx = lo; dx <= hi; dx++) {
        const key = `${ctx + dx},${ctz + dz}`;
        if (!this.tiles.has(key)) wanted.push([ctx + dx, ctz + dz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    const gen = this.generation;
    for (const [tx, tz, d2] of wanted) {
      if (this.inFlight >= 6) break;
      const key = `${tx},${tz}`;
      this.tiles.set(key, 'pending');
      this.inFlight++;
      this.pool.far(tx * blocksPerTile, tz * blocksPerTile, TILE, FAR_STEP, 6 + Math.sqrt(d2) * 3).then((res) => {
        this.inFlight--;
        if (gen !== this.generation || this.tiles.get(key) !== 'pending') return;
        this.tiles.set(key, 'ready');
        this.write(tx, tz, res.data);
      });
    }
  }

  get readyCount(): number {
    let n = 0;
    for (const s of this.tiles.values()) if (s === 'ready') n++;
    return n;
  }

  dispose() {
    this.generation++;
    this.gl.deleteTexture(this.tex);
  }
}
