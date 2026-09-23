import { ItemStack, ITEMS, maxStack } from '../world/items';
import { smeltingRecipe, fuelTime } from '../world/recipes';
import { saveStack, loadStack } from './Inventory';

/** Furnace slots: 0 input, 1 fuel, 2 output. Times are in seconds. */
export interface FurnaceData {
  kind: 'furnace';
  x: number; y: number; z: number;
  slots: (ItemStack | null)[];
  /** Remaining burn time of the current fuel item, and its total. */
  burn: number;
  burnMax: number;
  /** Cooking progress of the current item, and the time it needs. */
  cook: number;
  cookMax: number;
}

export interface ChestData {
  kind: 'chest';
  x: number; y: number; z: number;
  slots: (ItemStack | null)[];
}

export type TileData = FurnaceData | ChestData;

export const CHEST_SIZE = 27;

/**
 * Block entities: furnaces and chests (barrels share the chest data). Keyed by block position;
 * furnaces keep smelting while their chunk is unloaded.
 */
export class TileEntities {
  private map = new Map<string, TileData>();

  private static key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  get(x: number, y: number, z: number): TileData | undefined {
    return this.map.get(TileEntities.key(x, y, z));
  }

  furnace(x: number, y: number, z: number): FurnaceData {
    let t = this.get(x, y, z);
    if (!t || t.kind !== 'furnace') {
      t = { kind: 'furnace', x, y, z, slots: [null, null, null], burn: 0, burnMax: 0, cook: 0, cookMax: 10 };
      this.map.set(TileEntities.key(x, y, z), t);
    }
    return t;
  }

  chest(x: number, y: number, z: number): ChestData {
    let t = this.get(x, y, z);
    if (!t || t.kind !== 'chest') {
      t = { kind: 'chest', x, y, z, slots: new Array(CHEST_SIZE).fill(null) };
      this.map.set(TileEntities.key(x, y, z), t);
    }
    return t;
  }

  /** Removes a block entity and returns its contents (to be dropped). */
  remove(x: number, y: number, z: number): ItemStack[] {
    const k = TileEntities.key(x, y, z);
    const t = this.map.get(k);
    if (!t) return [];
    this.map.delete(k);
    return t.slots.filter((s): s is ItemStack => !!s);
  }

  clear() {
    this.map.clear();
  }

  /** Advances every furnace. `lit` is told when a furnace starts or stops burning. */
  tick(dt: number, lit: (f: FurnaceData, burning: boolean) => void) {
    for (const t of this.map.values()) {
      if (t.kind !== 'furnace') continue;
      const was = t.burn > 0;
      tickFurnace(t, dt);
      const now = t.burn > 0;
      if (was !== now) lit(t, now);
    }
  }

  furnaces(): FurnaceData[] {
    return [...this.map.values()].filter((t): t is FurnaceData => t.kind === 'furnace');
  }

  serialize() {
    return [...this.map.values()].map((t) =>
      t.kind === 'furnace'
        ? { k: 'f', p: [t.x, t.y, t.z], s: t.slots.map(saveStack), b: t.burn, bm: t.burnMax, c: t.cook, cm: t.cookMax }
        : { k: 'c', p: [t.x, t.y, t.z], s: t.slots.map(saveStack) });
  }

  load(data: unknown) {
    this.map.clear();
    if (!Array.isArray(data)) return;
    for (const e of data as Array<Record<string, unknown>>) {
      const p = e.p as number[];
      if (!Array.isArray(p) || p.length !== 3) continue;
      const slots = Array.isArray(e.s) ? (e.s as unknown[]).map(loadStack) : [];
      if (e.k === 'f') {
        const f = this.furnace(p[0], p[1], p[2]);
        for (let i = 0; i < 3; i++) f.slots[i] = slots[i] ?? null;
        f.burn = Number(e.b) || 0; f.burnMax = Number(e.bm) || 0;
        f.cook = Number(e.c) || 0; f.cookMax = Number(e.cm) || 10;
      } else if (e.k === 'c') {
        const c = this.chest(p[0], p[1], p[2]);
        for (let i = 0; i < CHEST_SIZE; i++) c.slots[i] = slots[i] ?? null;
      }
    }
  }
}

/** Whether the furnace's current input can be smelted into its output slot. */
export function canSmelt(f: FurnaceData): boolean {
  const input = f.slots[0];
  const r = input && smeltingRecipe(input.id);
  if (!r) return false;
  const out = f.slots[2];
  return !out || (out.id === r.result && !out.damage && out.count < maxStack(out.id));
}

/** Minecraft's furnace logic, in seconds instead of ticks. */
export function tickFurnace(f: FurnaceData, dt: number) {
  if (f.burn > 0) f.burn = Math.max(0, f.burn - dt);
  const input = f.slots[0], fuel = f.slots[1];
  if (f.burn > 0 || (input && fuel)) {
    const ok = canSmelt(f);
    if (f.burn <= 0 && ok && fuel && fuelTime(fuel.id) > 0) {
      f.burn = f.burnMax = fuelTime(fuel.id);
      const rem = ITEMS[fuel.id]?.remainder ?? 0;
      fuel.count--;
      if (fuel.count <= 0) f.slots[1] = rem ? { id: rem, count: 1 } : null;
    }
    if (f.burn > 0 && ok) {
      const r = smeltingRecipe(input!.id)!;
      f.cookMax = r.time;
      f.cook += dt;
      if (f.cook >= r.time) {
        f.cook = 0;
        const out = f.slots[2];
        if (out) out.count++;
        else f.slots[2] = { id: r.result, count: 1 };
        input!.count--;
        if (input!.count <= 0) f.slots[0] = null;
      }
    } else {
      f.cook = 0;
    }
  } else if (f.cook > 0) {
    f.cook = Math.max(0, f.cook - dt * 2);
  }
}
