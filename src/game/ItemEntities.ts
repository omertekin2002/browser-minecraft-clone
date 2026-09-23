import * as B from '../world/blocks';
import { ItemStack, stackable, maxStack, copyStack } from '../world/items';
import type { ItemInstance } from '../render/Entities';
import { saveStack, loadStack } from './Inventory';

/** A dropped item stack floating in the world. */
interface Drop {
  stack: ItemStack;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  /** Seconds before the player may pick it up. */
  delay: number;
  spin: number;
  onGround: boolean;
  /** Being collected: seconds of the fly-to-player animation left. */
  collect: number;
  sky: number;
  block: number;
  lightTimer: number;
}

const GRAVITY = 16;
const DESPAWN = 300;
const MAX_DROPS = 400;

export type SolidFn = (x: number, y: number, z: number) => number;
export type LightFn = (x: number, y: number, z: number) => [number, number];

/** Dropped items: physics, merging, despawning and pickup. */
export class ItemEntities {
  private list: Drop[] = [];
  private mergeTimer = 0;
  readonly instances: ItemInstance[] = [];

  get count() {
    return this.list.length;
  }

  clear() {
    this.list.length = 0;
    this.instances.length = 0;
  }

  /** Spawns a stack at a position with a small random pop (or a given velocity). */
  spawn(stack: ItemStack, x: number, y: number, z: number, v?: [number, number, number], delay = 0.5) {
    if (stack.count <= 0) return;
    if (this.list.length >= MAX_DROPS) this.list.shift();
    this.list.push({
      stack: copyStack(stack), x, y, z,
      vx: v ? v[0] : (Math.random() - 0.5) * 2, vy: v ? v[1] : 2 + Math.random() * 1.5, vz: v ? v[2] : (Math.random() - 0.5) * 2,
      age: 0, delay, spin: Math.random() * Math.PI * 2, onGround: false, collect: 0, sky: 1, block: 0, lightTimer: 0,
    });
  }

  /** Solid-box test at a point (items are points with a small radius). */
  private static solidAt(get: SolidFn, x: number, y: number, z: number): boolean {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const b = get(bx, by, bz);
    if (b < 0) return true;
    if (!B.IS_SOLID[b]) return false;
    const o = b * 6;
    const fy = y - by;
    return fy >= B.BOX[o + 1] / 16 && fy < B.BOX[o + 4] / 16;
  }

  private static surface(get: SolidFn, x: number, y: number, z: number): number {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const b = get(bx, by, bz);
    return by + (b > 0 ? B.BOX[b * 6 + 4] / 16 : 1);
  }

  /**
   * Steps physics and collects items near the player. `give` adds a stack to the player's
   * inventory and returns how many items it took.
   */
  update(
    dt: number, get: SolidFn, light: LightFn,
    player: { x: number; y: number; z: number; alive: boolean }, give: (s: ItemStack) => number,
    picked: () => void, burned?: (x: number, y: number, z: number) => void,
  ) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.age += dt;
      d.delay -= dt;
      d.spin += dt * 1.6;
      if (d.collect > 0) {
        // Fly into the player, then vanish.
        d.collect -= dt;
        const k = 1 - Math.exp(-dt * 30);
        d.x += (player.x - d.x) * k; d.y += (player.y + 0.8 - d.y) * k; d.z += (player.z - d.z) * k;
        if (d.collect <= 0) { list[i] = list[list.length - 1]; list.pop(); }
        continue;
      }
      if (d.age > DESPAWN || d.y < -64) { list[i] = list[list.length - 1]; list.pop(); continue; }

      // Physics (items that land in lava burn up)
      const cell = get(Math.floor(d.x), Math.floor(d.y + 0.1), Math.floor(d.z));
      if (cell === B.LAVA) { list[i] = list[list.length - 1]; list.pop(); burned?.(d.x, d.y, d.z); continue; }
      const inWater = cell === B.WATER;
      if (inWater) { d.vy += (1.2 - d.vy) * (1 - Math.exp(-dt * 3)); d.vx *= Math.exp(-dt * 3); d.vz *= Math.exp(-dt * 3); }
      else d.vy -= GRAVITY * dt;
      const drag = d.onGround ? Math.exp(-dt * 10) : Math.exp(-dt * 0.4);
      d.vx *= drag; d.vz *= drag;
      if (ItemEntities.solidAt(get, d.x, d.y + 0.05, d.z)) {
        // Stuck inside a block: float up out of it.
        d.y += 3 * dt; d.vy = 0; d.onGround = false;
      } else {
        const ny = d.y + d.vy * dt;
        if (d.vy < 0 && ItemEntities.solidAt(get, d.x, ny, d.z)) {
          d.y = ItemEntities.surface(get, d.x, ny, d.z);
          d.vy = 0;
          d.onGround = true;
        } else if (d.vy > 0 && ItemEntities.solidAt(get, d.x, ny + 0.25, d.z)) {
          d.vy = 0;
        } else {
          d.y = ny;
          d.onGround = d.vy === 0 && ItemEntities.solidAt(get, d.x, d.y - 0.02, d.z);
        }
        const nx = d.x + d.vx * dt;
        if (ItemEntities.solidAt(get, nx + Math.sign(d.vx) * 0.12, d.y + 0.05, d.z)) d.vx *= -0.3; else d.x = nx;
        const nz = d.z + d.vz * dt;
        if (ItemEntities.solidAt(get, d.x, d.y + 0.05, nz + Math.sign(d.vz) * 0.12)) d.vz *= -0.3; else d.z = nz;
      }

      // Light for rendering (refreshed now and then).
      d.lightTimer -= dt;
      if (d.lightTimer <= 0) {
        d.lightTimer = 0.4 + Math.random() * 0.2;
        [d.sky, d.block] = light(d.x, d.y + 0.25, d.z);
      }

      // Pickup: the player's box grown by 1 block sideways and half a block vertically.
      if (d.delay <= 0 && player.alive &&
          Math.abs(d.x - player.x) < 1.3 && Math.abs(d.z - player.z) < 1.3 && d.y > player.y - 0.5 && d.y < player.y + 2.3) {
        const n = give(d.stack);
        if (n > 0) {
          picked();
          if (n >= d.stack.count) d.collect = 0.12;
          else d.stack.count -= n;
        }
      }
    }

    // Merge nearby stacks of the same item.
    this.mergeTimer -= dt;
    if (this.mergeTimer <= 0) {
      this.mergeTimer = 0.5;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.collect > 0 || a.stack.count >= maxStack(a.stack.id)) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (b.collect > 0 || !stackable(a.stack, b.stack)) continue;
          if (Math.abs(a.x - b.x) > 0.6 || Math.abs(a.y - b.y) > 0.6 || Math.abs(a.z - b.z) > 0.6) continue;
          const n = Math.min(b.stack.count, maxStack(a.stack.id) - a.stack.count);
          a.stack.count += n;
          b.stack.count -= n;
          a.delay = Math.max(a.delay, b.delay);
          a.age = Math.min(a.age, b.age);
          if (b.stack.count <= 0) { list.splice(j, 1); j--; }
          if (a.stack.count >= maxStack(a.stack.id)) break;
        }
      }
    }

    // Render list
    const inst = this.instances;
    inst.length = list.length;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const bob = d.collect > 0 ? 0 : Math.sin(d.age * 2.6 + d.spin) * 0.05 + 0.05;
      inst[i] = { id: d.stack.id, count: d.stack.count, x: d.x, y: d.y + bob, z: d.z, spin: d.spin, sky: d.sky, block: d.block };
    }
  }

  serialize() {
    return this.list.filter((d) => d.collect <= 0).map((d) => [saveStack(d.stack), Math.round(d.x * 100) / 100, Math.round(d.y * 100) / 100, Math.round(d.z * 100) / 100, Math.round(d.age)]);
  }

  load(data: unknown) {
    this.clear();
    if (!Array.isArray(data)) return;
    for (const e of data) {
      if (!Array.isArray(e)) continue;
      const s = loadStack(e[0]);
      if (!s) continue;
      this.spawn(s, Number(e[1]) || 0, Number(e[2]) || 0, Number(e[3]) || 0, [0, 0, 0], 0);
      this.list[this.list.length - 1].age = Number(e[4]) || 0;
    }
  }
}
