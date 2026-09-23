import * as B from '../world/blocks';
import type { World } from '../world/World';
import { chunkKey } from '../world/constants';

/**
 * Minecraft-style random ticks around the player: crops and saplings grow, sugar cane and cacti
 * get taller, grass spreads onto dirt (and dies under blocks), dry farmland turns back into dirt.
 * Also bone meal and leaf decay after a tree is chopped down.
 */

const TICK = 1 / 20;
const RADIUS = 5; // chunks
const PER_SECTION = 3;

type Removed = (x: number, y: number, z: number, id: number) => void;

export class Growth {
  private acc = 0;
  /** Leaves to check for decay: key → time left. */
  private decay = new Map<string, number>();

  constructor(private world: World, private removed: Removed) {}

  update(dt: number, px: number, pz: number) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n++ < 4) {
      this.acc -= TICK;
      this.randomTicks(px, pz);
    }
    if (this.acc > TICK * 4) this.acc = 0;
    this.updateDecay(dt);
  }

  private randomTicks(px: number, pz: number) {
    const w = this.world;
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const c = w.chunks.get(chunkKey(pcx + dx, pcz + dz));
        if (!c || !c.blocks) continue;
        const blocks = c.blocks;
        for (let s = 0; s < 16; s++) {
          for (let k = 0; k < PER_SECTION; k++) {
            const r = (Math.random() * 4096) | 0;
            const i = (s << 12) | r;
            const id = blocks[i];
            if (!NEEDS_TICK[id]) continue;
            this.tickBlock(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), id);
          }
        }
      }
    }
  }

  private tickBlock(x: number, y: number, z: number, id: number) {
    const w = this.world;
    if (B.isCrop(id)) {
      if (id >= B.WHEAT_RIPE) return;
      const below = w.getBlock(x, y - 1, z);
      if (below !== B.FARMLAND) return;
      if (Math.random() < (this.hydrated(x, y - 1, z) ? 1 / 3 : 1 / 6)) w.setBlock(x, y, z, id + 1);
    } else if (B.isSapling(id)) {
      if (Math.random() < 1 / 10) this.growTree(x, y, z, id);
    } else if (id === B.SUGAR_CANE || id === B.CACTUS) {
      if (w.getBlock(x, y + 1, z) !== B.AIR || Math.random() > 1 / 10) return;
      let h = 1;
      while (h < 3 && w.getBlock(x, y - h, z) === id) h++;
      if (h < 3) w.setBlock(x, y + 1, z, id);
    } else if (id === B.GRASS) {
      const above = w.getBlock(x, y + 1, z);
      if (above > 0 && B.LIGHT_OPACITY[above] >= 15) { w.setBlock(x, y, z, B.DIRT); return; }
      for (let k = 0; k < 4; k++) {
        const tx = x + ((Math.random() * 3) | 0) - 1, ty = y + ((Math.random() * 5) | 0) - 3, tz = z + ((Math.random() * 3) | 0) - 1;
        if (w.getBlock(tx, ty, tz) !== B.DIRT) continue;
        const a = w.getBlock(tx, ty + 1, tz);
        if (a === B.AIR || (a > 0 && B.LIGHT_OPACITY[a] < 15 && !B.IS_LIQUID[a])) w.setBlock(tx, ty, tz, B.GRASS);
      }
    } else if (id === B.FARMLAND) {
      const above = w.getBlock(x, y + 1, z);
      if (above > 0 && B.IS_OPAQUE[above]) { w.setBlock(x, y, z, B.DIRT); return; }
      if (!B.isCrop(above) && !this.hydrated(x, y, z) && Math.random() < 1 / 3) w.setBlock(x, y, z, B.DIRT);
    }
  }

  /** Water within 4 blocks horizontally, at farmland level or one above. */
  hydrated(x: number, y: number, z: number): boolean {
    const w = this.world;
    for (let dy = 0; dy <= 1; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      if (w.getBlock(x + dx, y + dy, z + dz) === B.WATER) return true;
    }
    return false;
  }

  /** Grows a sapling into a tree if there is room. Returns true on success. */
  growTree(x: number, y: number, z: number, sapling: number): boolean {
    const w = this.world;
    const spruce = sapling === B.SPRUCE_SAPLING;
    const log = spruce ? B.SPRUCE_LOG : sapling === B.BIRCH_SAPLING ? B.BIRCH_LOG : B.OAK_LOG;
    const leaves = spruce ? B.SPRUCE_LEAVES : sapling === B.BIRCH_SAPLING ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const height = spruce ? 6 + ((Math.random() * 4) | 0) : sapling === B.BIRCH_SAPLING ? 5 + ((Math.random() * 3) | 0) : 4 + ((Math.random() * 3) | 0);
    if (y + height + 2 > 255) return false;
    const free = (b: number) => b === B.AIR || (b > 0 && (B.BLOCKS[b].replaceable || B.isLeaves(b)) && !B.IS_LIQUID[b]);
    for (let i = 1; i <= height; i++) if (!free(w.getBlock(x, y + i, z))) return false;
    const soil = w.getBlock(x, y - 1, z);
    if (soil === B.GRASS || soil === B.FARMLAND || soil === B.SNOWY_GRASS) w.setBlock(x, y - 1, z, B.DIRT, false);
    const leaf = (lx: number, ly: number, lz: number) => {
      const b = w.getBlock(lx, ly, lz);
      if (b === B.AIR || (b > 0 && B.BLOCKS[b].replaceable && !B.IS_LIQUID[b])) w.setBlock(lx, ly, lz, leaves, false);
    };
    if (spruce) {
      const top = y + height;
      let radius = 0, maxR = 1;
      for (let yy = top; yy >= y + 2; yy--) {
        for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
          leaf(x + dx, yy, z + dz);
        }
        radius++;
        if (radius > maxR) { radius = maxR >= 2 ? 1 : 0; maxR = Math.min(3, maxR + 1); }
      }
      leaf(x, top + 1, z);
    } else {
      const top = y + height - 1;
      for (let dy = -3; dy <= 0; dy++) {
        const yy = top + dy + 1;
        const r = dy >= -1 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 0 || Math.random() < 0.5)) continue;
          leaf(x + dx, yy, z + dz);
        }
      }
    }
    for (let i = 0; i < height; i++) w.setBlock(x, y + i, z, log, false);
    return true;
  }

  /** Bone meal on a block. Returns true if it did something (and should be used up). */
  boneMeal(x: number, y: number, z: number): boolean {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (B.isCrop(id)) {
      if (id >= B.WHEAT_RIPE) return false;
      w.setBlock(x, y, z, Math.min(B.WHEAT_RIPE, id + 2 + ((Math.random() * 4) | 0)));
      return true;
    }
    if (B.isSapling(id)) {
      if (Math.random() < 0.45) this.growTree(x, y, z, id);
      return true;
    }
    if (id === B.GRASS) {
      // Scatter grass and a few flowers on nearby grass blocks.
      const flowers = [B.DANDELION, B.POPPY, B.OXEYE_DAISY, B.CORNFLOWER];
      for (let k = 0; k < 48; k++) {
        const dx = Math.round((Math.random() + Math.random() - 1) * 3.5), dz = Math.round((Math.random() + Math.random() - 1) * 3.5);
        for (let dy = 1; dy >= -1; dy--) {
          if (w.getBlock(x + dx, y + dy, z + dz) !== B.GRASS || w.getBlock(x + dx, y + dy + 1, z + dz) !== B.AIR) continue;
          const r = Math.random();
          w.setBlock(x + dx, y + dy + 1, z + dz, r < 0.12 ? flowers[(Math.random() * flowers.length) | 0] : B.TALL_GRASS);
          break;
        }
      }
      return true;
    }
    return false;
  }

  /** Called when a log is removed: nearby leaves without a log within 4 blocks will decay. */
  logRemoved(x: number, y: number, z: number) {
    const w = this.world;
    for (let dy = -5; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      if (B.isLeaves(w.getBlock(x + dx, y + dy, z + dz))) {
        const k = `${x + dx},${y + dy},${z + dz}`;
        if (!this.decay.has(k)) this.decay.set(k, 1 + Math.random() * 12);
      }
    }
  }

  private updateDecay(dt: number) {
    if (this.decay.size === 0) return;
    const w = this.world;
    for (const [k, t] of this.decay) {
      const left = t - dt;
      if (left > 0) { this.decay.set(k, left); continue; }
      this.decay.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (!B.isLeaves(id) || this.nearLog(x, y, z)) continue;
      w.setBlock(x, y, z, B.AIR);
      this.removed(x, y, z, id);
    }
  }

  /** Whether a log is reachable within 4 steps through leaves (Minecraft's leaf distance). */
  private nearLog(x: number, y: number, z: number): boolean {
    const w = this.world;
    const seen = new Set<string>([`${x},${y},${z}`]);
    let frontier: Array<[number, number, number]> = [[x, y, z]];
    for (let d = 0; d < 4 && frontier.length; d++) {
      const next: Array<[number, number, number]> = [];
      for (const [cx, cy, cz] of frontier) {
        for (const [ox, oy, oz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = cx + ox, ny = cy + oy, nz = cz + oz;
          const key = `${nx},${ny},${nz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const b = w.getBlock(nx, ny, nz);
          if (b === B.OAK_LOG || b === B.BIRCH_LOG || b === B.SPRUCE_LOG || b < 0) return true;
          if (B.isLeaves(b)) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
    }
    return false;
  }
}

/** Blocks that react to random ticks. */
const NEEDS_TICK = new Uint8Array(256);
for (let id = B.WHEAT_0; id < B.WHEAT_RIPE; id++) NEEDS_TICK[id] = 1;
for (const id of [B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING, B.SUGAR_CANE, B.CACTUS, B.GRASS, B.FARMLAND]) NEEDS_TICK[id] = 1;
