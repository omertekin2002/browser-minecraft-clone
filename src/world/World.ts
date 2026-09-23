import { CHUNK_VOLUME, chunkKey, SEA_LEVEL } from './constants';
import * as B from './blocks';
import { WorkerPool } from './WorkerPool';
import type { MeshData } from './mesh/Mesher';
import { TerrainGenerator } from './gen/TerrainGenerator';

export class ChunkColumn {
  blocks: Uint8Array | null = null;
  generating = false;
  needsMesh = false;
  meshing = false;
  hasMesh = false;
  urgent = false;
  modified = false;
  /** Renderer-owned GPU resources. */
  gpu: unknown = null;
  constructor(readonly cx: number, readonly cz: number) {}
  get key() {
    return chunkKey(this.cx, this.cz);
  }
}

export interface WorldCallbacks {
  onMesh(col: ChunkColumn, data: MeshData): void;
  onUnload(col: ChunkColumn): void;
  onModified?(col: ChunkColumn): void;
  /** A block broke by itself (lost its support); the game may drop it as an item. */
  onRemoved?(x: number, y: number, z: number, id: number): void;
}

const SIDES: Array<[number, number, number]> = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

export class World {
  readonly chunks = new Map<number, ChunkColumn>();
  readonly pool: WorkerPool;
  readonly gen: TerrainGenerator;
  renderDistance = 10;
  /** Saved chunk data that overrides generation. */
  readonly savedChunks = new Map<number, Uint8Array>();
  private spiral: Array<[number, number, number]> = [];
  private spiralRadius = -1;
  private centerCx = 0;
  private centerCz = 0;
  private viewX = 0;
  private viewZ = 1;
  stats = { genMs: 0, meshMs: 0, genCount: 0, meshCount: 0 };

  constructor(readonly seed: number, private cb: WorldCallbacks) {
    this.pool = new WorkerPool(seed);
    this.gen = new TerrainGenerator(seed);
  }

  private buildSpiral(r: number) {
    this.spiral = [];
    const R = r + 1;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= (R + 0.5) * (R + 0.5)) this.spiral.push([dx, dz, d2]);
      }
    }
    this.spiral.sort((a, b) => a[2] - b[2]);
    this.spiralRadius = r;
  }

  getColumn(cx: number, cz: number): ChunkColumn | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y > 255) return B.AIR;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.blocks) return -1;
    return c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  isReady(x: number, z: number): boolean {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return !!c && !!c.blocks;
  }

  /** Sets a block and schedules remeshing. Returns false if the chunk isn't loaded. */
  setBlock(x: number, y: number, z: number, id: number, updateNeighbors = true): boolean {
    if (y < 0 || y > 255) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.blocks) return false;
    const lx = x & 15, lz = z & 15;
    const i = (y << 8) | (lz << 4) | lx;
    if (c.blocks[i] === id) return true;
    c.blocks[i] = id;
    c.modified = true;
    this.savedChunks.set(c.key, c.blocks);
    this.cb.onModified?.(c);

    // Remesh: the chunk itself and chunks sharing the touched border urgently, the rest for lighting.
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (!n || !n.blocks) continue;
      n.needsMesh = true;
      const touchesX = dx === 0 || (dx === -1 && lx === 0) || (dx === 1 && lx === 15);
      const touchesZ = dz === 0 || (dz === -1 && lz === 0) || (dz === 1 && lz === 15);
      if (touchesX && touchesZ) n.urgent = true;
    }

    if (updateNeighbors) this.blockUpdate(x, y, z);
    return true;
  }

  /** Simple block physics: unsupported plants break, sand falls, water fills gaps. */
  private blockUpdate(x: number, y: number, z: number) {
    const here = this.getBlock(x, y, z);
    // Things resting on top of this block.
    const above = this.getBlock(x, y + 1, z);
    if (above > 0) {
      const def = B.BLOCKS[above];
      const supported = here > 0 && !B.BLOCKS[here].liquid && (B.IS_SOLID[here] || here === above || B.BLOCKS[here].shape === B.Shape.CACTUS);
      if (def.needsSupport && !supported && !(B.isCrop(above) && here === B.FARMLAND)) {
        this.setBlock(x, y + 1, z, B.AIR, true);
        this.cb.onRemoved?.(x, y + 1, z, above);
      } else if (def.gravity && here === B.AIR) {
        let ty = y;
        while (ty > 0 && this.getBlock(x, ty - 1, z) === B.AIR) ty--;
        this.setBlock(x, y + 1, z, B.AIR, false);
        this.setBlock(x, ty, z, above, true);
        this.blockUpdate(x, y + 1, z);
      }
    }
    // Falling blocks placed in the air.
    if (here > 0 && B.BLOCKS[here].gravity) {
      const below = this.getBlock(x, y - 1, z);
      if (below === B.AIR || below === B.WATER) {
        let ty = y - 1;
        while (ty > 0 && (this.getBlock(x, ty - 1, z) === B.AIR || this.getBlock(x, ty - 1, z) === B.WATER)) ty--;
        this.setBlock(x, y, z, B.AIR, false);
        this.setBlock(x, ty, z, here, false);
        this.harden(x, ty, z);
      }
    }
    this.harden(x, y, z);
    // Water meeting lava turns the lava into obsidian.
    if (here === B.WATER || here === B.LAVA) {
      for (const [dx, dy, dz] of SIDES) {
        const n = this.getBlock(x + dx, y + dy, z + dz);
        if (here === B.WATER && n === B.LAVA) this.setBlock(x + dx, y + dy, z + dz, B.OBSIDIAN, false);
        else if (here === B.LAVA && n === B.WATER) { this.setBlock(x, y, z, B.OBSIDIAN, false); break; }
      }
    }
    // Water flows into freshly opened space (bounded spread, no levels).
    if (here === B.AIR) {
      const wet = this.getBlock(x, y + 1, z) === B.WATER ||
        this.getBlock(x + 1, y, z) === B.WATER || this.getBlock(x - 1, y, z) === B.WATER ||
        this.getBlock(x, y, z + 1) === B.WATER || this.getBlock(x, y, z - 1) === B.WATER;
      if (wet && y <= SEA_LEVEL + 40) this.flood(x, y, z);
    }
  }

  /** Concrete powder next to water becomes concrete (checks the block and its neighbours). */
  private harden(x: number, y: number, z: number) {
    const check = (px: number, py: number, pz: number) => {
      const b = this.getBlock(px, py, pz);
      if (b <= 0 || !B.POWDER_TO_CONCRETE[b]) return;
      for (const [dx, dy, dz] of SIDES) {
        if (this.getBlock(px + dx, py + dy, pz + dz) === B.WATER) { this.setBlock(px, py, pz, B.POWDER_TO_CONCRETE[b], false); return; }
      }
    };
    const here = this.getBlock(x, y, z);
    if (here === B.WATER) for (const [dx, dy, dz] of SIDES) check(x + dx, y + dy, z + dz);
    else check(x, y, z);
  }

  private flood(x: number, y: number, z: number) {
    const queue: Array<[number, number, number, number]> = [[x, y, z, 0]];
    let placed = 0;
    while (queue.length > 0 && placed < 96) {
      const [qx, qy, qz, dist] = queue.shift()!;
      if (this.getBlock(qx, qy, qz) !== B.AIR) continue;
      this.setBlock(qx, qy, qz, B.WATER, false);
      this.harden(qx, qy, qz);
      placed++;
      if (this.getBlock(qx, qy - 1, qz) === B.AIR) {
        queue.push([qx, qy - 1, qz, dist]);
        continue;
      }
      if (dist < 3) {
        queue.push([qx + 1, qy, qz, dist + 1], [qx - 1, qy, qz, dist + 1], [qx, qy, qz + 1, dist + 1], [qx, qy, qz - 1, dist + 1]);
      }
    }
  }

  setViewDirection(dx: number, dz: number) {
    const l = Math.hypot(dx, dz) || 1;
    this.viewX = dx / l;
    this.viewZ = dz / l;
  }

  private priority(cx: number, cz: number): number {
    const dx = cx - this.centerCx, dz = cz - this.centerCz;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) return d;
    const facing = (dx * this.viewX + dz * this.viewZ) / d; // -1..1
    return d * (1.35 - 0.45 * facing);
  }

  /** Streams chunks around the player. Call every frame. */
  update(px: number, pz: number) {
    const R = this.renderDistance;
    if (this.spiralRadius !== R) this.buildSpiral(R);
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    const moved = pcx !== this.centerCx || pcz !== this.centerCz;
    this.centerCx = pcx;
    this.centerCz = pcz;

    if (moved) {
      // Unload distant columns.
      const lim = (R + 3) * (R + 3);
      for (const [key, c] of this.chunks) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > lim) {
          if (c.generating) continue; // let in-flight work finish
          this.cb.onUnload(c);
          this.chunks.delete(key);
        }
      }
      this.pool.reprioritize((m) => this.priority(m.cx as number, m.cz as number));
    }

    // Generation requests.
    let genBudget = 24 - this.pool.queued;
    for (const [dx, dz] of this.spiral) {
      if (genBudget <= 0) break;
      const cx = pcx + dx, cz = pcz + dz;
      const key = chunkKey(cx, cz);
      if (this.chunks.has(key)) continue;
      const col = new ChunkColumn(cx, cz);
      this.chunks.set(key, col);
      const saved = this.savedChunks.get(key);
      if (saved) {
        col.blocks = saved;
        col.modified = true;
        this.onColumnReady(col);
        continue;
      }
      col.generating = true;
      genBudget--;
      this.pool.generate(cx, cz, this.priority(cx, cz)).then((res) => {
        col.generating = false;
        if (this.chunks.get(key) !== col) return;
        col.blocks = res.blocks;
        this.stats.genMs += res.ms;
        this.stats.genCount++;
        this.onColumnReady(col);
      });
    }

    // Mesh requests.
    let meshBudget = this.pool.size * 3 - this.pool.inFlight;
    const r2 = (R + 0.5) * (R + 0.5);
    // Urgent (edited) chunks first.
    for (const c of this.chunks.values()) {
      if (c.urgent && c.needsMesh && !c.meshing) this.tryMesh(c, -1000);
    }
    for (const [dx, dz, d2] of this.spiral) {
      if (meshBudget <= 0) break;
      if (d2 > r2) break;
      const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (!c || !c.blocks || !c.needsMesh || c.meshing) continue;
      if (this.tryMesh(c, this.priority(c.cx, c.cz) + (c.hasMesh ? -0.5 : 0))) meshBudget--;
    }
  }

  private onColumnReady(col: ChunkColumn) {
    col.needsMesh = true;
    // Neighbours may now be meshable (they were waiting on this one); nothing else to do.
  }

  private tryMesh(c: ChunkColumn, priority: number): boolean {
    const arrays: Uint8Array[] = [];
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
      if (!n || !n.blocks) return false;
      arrays.push(n.blocks.slice());
    }
    c.meshing = true;
    c.needsMesh = false;
    c.urgent = false;
    this.pool.mesh(c.cx, c.cz, arrays, priority).then((res) => {
      c.meshing = false;
      this.stats.meshMs += res.ms;
      this.stats.meshCount++;
      if (this.chunks.get(c.key) !== c) return;
      c.hasMesh = true;
      this.cb.onMesh(c, res.data);
    });
    return true;
  }

  /** Number of columns inside the render distance that still lack a mesh. */
  pendingCount(): number {
    const R = this.renderDistance;
    let n = 0;
    for (const c of this.chunks.values()) {
      const dx = c.cx - this.centerCx, dz = c.cz - this.centerCz;
      if (dx * dx + dz * dz <= R * R && !c.hasMesh) n++;
    }
    return n;
  }

  /** Whether the columns around a position are generated (used to hold the player at spawn). */
  areaReady(x: number, z: number, radius = 1): boolean {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (!c || !c.hasMesh) return false;
      }
    }
    return true;
  }

  dispose() {
    this.pool.terminate();
    for (const c of this.chunks.values()) this.cb.onUnload(c);
    this.chunks.clear();
  }
}

export { CHUNK_VOLUME };
