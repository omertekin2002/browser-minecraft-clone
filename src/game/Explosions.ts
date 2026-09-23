import * as B from '../world/blocks';
import type { World } from '../world/World';

/** Primed TNT: a falling, flashing block that explodes when its fuse runs out. */
export interface PrimedTnt {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fuse: number;
}

/** How much an explosion ray is weakened by a block (Minecraft's blast resistance, approximated). */
function blastResistance(id: number): number {
  if (id === B.BEDROCK) return Infinity;
  if (id === B.OBSIDIAN) return 1200;
  if (B.IS_LIQUID[id]) return 100;
  const d = B.BLOCKS[id];
  if (!d) return 0;
  if (d.tool === 'pickaxe' && d.requiresTool) return id === B.SANDSTONE || B.BLOCKS[id].name.includes('sandstone') ? 0.8 : 6;
  return d.hardness;
}

export interface ExplosionResult {
  /** Blocks destroyed (x, y, z, id). */
  destroyed: Array<[number, number, number, number]>;
}

/**
 * Minecraft's explosion: rays from a 16×16×16 grid on a cube's surface lose strength in every block
 * they pass; blocks the ray still has strength for are destroyed.
 */
export function explode(world: World, cx: number, cy: number, cz: number, power: number): ExplosionResult {
  const hit = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      for (let k = 0; k < 16; k++) {
        if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
        let dx = (i / 15) * 2 - 1, dy = (j / 15) * 2 - 1, dz = (k / 15) * 2 - 1;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        let strength = power * (0.7 + Math.random() * 0.6);
        let x = cx, y = cy, z = cz;
        while (strength > 0) {
          const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
          if (by < 0 || by > 255) break;
          const id = world.getBlock(bx, by, bz);
          if (id < 0) break;
          if (id > 0) {
            strength -= (blastResistance(id) + 0.3) * 0.3;
            if (strength > 0 && !B.IS_LIQUID[id]) {
              const key = `${bx},${by},${bz}`;
              if (!hit.has(key)) hit.set(key, [bx, by, bz, id]);
            }
          }
          x += dx * 0.3; y += dy * 0.3; z += dz * 0.3;
          strength -= 0.225;
        }
      }
    }
  }
  return { destroyed: [...hit.values()] };
}

/** Fraction of sample points of a box visible from a point (explosion exposure). */
export function exposure(world: World, cx: number, cy: number, cz: number, box: number[]): number {
  let seen = 0, total = 0;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
    const px = box[0] + ((box[3] - box[0]) * i) / 2, py = box[1] + ((box[4] - box[1]) * j) / 2, pz = box[2] + ((box[5] - box[2]) * k) / 2;
    total++;
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.ceil(dist / 0.25);
    let blocked = false;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const b = world.getBlock(Math.floor(cx + dx * t), Math.floor(cy + dy * t), Math.floor(cz + dz * t));
      if (b > 0 && B.IS_OPAQUE[b]) { blocked = true; break; }
    }
    if (!blocked) seen++;
  }
  return seen / total;
}

export class TntSystem {
  readonly list: PrimedTnt[] = [];

  prime(x: number, y: number, z: number, fuse = 4) {
    const a = Math.random() * Math.PI * 2;
    this.list.push({ x: x + 0.5, y, z: z + 0.5, vx: Math.cos(a) * 0.4, vy: 4, vz: Math.sin(a) * 0.4, fuse });
  }

  clear() {
    this.list.length = 0;
  }

  /** Steps the falling TNT; calls `boom` for each one whose fuse ran out. */
  update(dt: number, get: (x: number, y: number, z: number) => number, boom: (t: PrimedTnt) => void) {
    const solid = (x: number, y: number, z: number) => {
      const b = get(Math.floor(x), Math.floor(y), Math.floor(z));
      return b < 0 || B.IS_SOLID[b] === 1;
    };
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.fuse -= dt;
      t.vy -= 16 * dt;
      const drag = Math.exp(-dt * 0.4);
      t.vx *= drag; t.vz *= drag;
      const ny = t.y + t.vy * dt;
      if (t.vy < 0 && solid(t.x, ny, t.z)) {
        t.y = Math.floor(ny) + 1;
        t.vy = 0;
        t.vx *= 0.7; t.vz *= 0.7;
      } else t.y = ny;
      const nx = t.x + t.vx * dt, nz = t.z + t.vz * dt;
      if (!solid(nx + Math.sign(t.vx) * 0.5, t.y + 0.5, t.z)) t.x = nx; else t.vx = 0;
      if (!solid(t.x, t.y + 0.5, nz + Math.sign(t.vz) * 0.5)) t.z = nz; else t.vz = 0;
      if (t.fuse <= 0) {
        this.list.splice(i, 1);
        boom(t);
      }
    }
  }
}
