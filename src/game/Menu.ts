import { ItemStack, ITEMS, maxStack, stackable, copyStack } from '../world/items';
import { matchCrafting, smeltingRecipe, fuelTime, CraftMatch, Recipe, recipeLayout, Ingredient } from '../world/recipes';
import { Inventory, HOTBAR_SIZE, INVENTORY_SIZE } from './Inventory';
import { FurnaceData, ChestData } from './TileEntities';

/**
 * Container logic, independent of the DOM: Minecraft's slot click semantics (pick up, split,
 * merge, swap, shift-click routing, drag-distribute, double-click collect, hotbar swaps) over
 * a list of slots, plus the crafting grid and recipe-book auto-fill.
 */

export type MenuKind = 'inventory' | 'crafting' | 'furnace' | 'chest' | 'creative';
export type SlotGroup = 'hotbar' | 'main' | 'armor' | 'grid' | 'result' | 'container' | 'input' | 'fuel' | 'output' | 'trash';

export interface Slot {
  group: SlotGroup;
  /** Index within its group. */
  index: number;
  get(): ItemStack | null;
  set(s: ItemStack | null): void;
  mayPlace(s: ItemStack): boolean;
  /** How many of this item the slot can hold. */
  limit(s: ItemStack): number;
}

export interface MenuHost {
  inv: Inventory;
  creative: boolean;
  /** Throws a stack into the world from the player. */
  drop(s: ItemStack): void;
  /** Called after each crafted result is taken. */
  crafted?(s: ItemStack): void;
}

function arraySlot(arr: (ItemStack | null)[], i: number, group: SlotGroup, index = i, mayPlace: (s: ItemStack) => boolean = () => true, cap = 64): Slot {
  return {
    group, index,
    get: () => arr[i],
    set: (s) => { arr[i] = s && s.count > 0 ? s : null; },
    mayPlace,
    limit: (s) => Math.min(maxStack(s.id), cap),
  };
}

export class Menu {
  readonly slots: Slot[] = [];
  carried: ItemStack | null = null;
  /** Crafting grid (2×2 or 3×3), row-major. */
  readonly grid: (ItemStack | null)[];
  readonly gridW: number;
  private match: CraftMatch | null = null;
  readonly furnace: FurnaceData | null;
  readonly chest: ChestData | null;

  constructor(readonly kind: MenuKind, private host: MenuHost, tile: FurnaceData | ChestData | null = null) {
    this.gridW = kind === 'inventory' ? 2 : kind === 'crafting' ? 3 : 0;
    this.grid = new Array(this.gridW * this.gridW).fill(null);
    this.furnace = tile && tile.kind === 'furnace' ? tile : null;
    this.chest = tile && tile.kind === 'chest' ? tile : null;
    const inv = host.inv;

    if (this.gridW) {
      this.slots.push({
        group: 'result', index: 0,
        get: () => this.match?.result ?? null,
        set: () => {},
        mayPlace: () => false,
        limit: (s) => maxStack(s.id),
      });
      for (let i = 0; i < this.grid.length; i++) this.slots.push(arraySlot(this.grid, i, 'grid'));
    }
    if (kind === 'inventory' || kind === 'creative') {
      for (let i = 0; i < 4; i++) {
        this.slots.push(arraySlot(inv.armor, i, 'armor', i, (s) => ITEMS[s.id]?.armor?.slot === i, 1));
      }
    }
    if (this.furnace) {
      const f = this.furnace;
      this.slots.push(arraySlot(f.slots, 0, 'input'));
      this.slots.push(arraySlot(f.slots, 1, 'fuel', 1, (s) => fuelTime(s.id) > 0));
      this.slots.push(arraySlot(f.slots, 2, 'output', 2, () => false));
    }
    if (this.chest) {
      for (let i = 0; i < this.chest.slots.length; i++) this.slots.push(arraySlot(this.chest.slots, i, 'container'));
    }
    for (let i = HOTBAR_SIZE; i < INVENTORY_SIZE; i++) this.slots.push(arraySlot(inv.slots, i, 'main', i - HOTBAR_SIZE));
    for (let i = 0; i < HOTBAR_SIZE; i++) this.slots.push(arraySlot(inv.slots, i, 'hotbar', i));
    if (kind === 'creative') {
      this.slots.push({
        group: 'trash', index: 0,
        get: () => null,
        set: () => {},
        mayPlace: () => true,
        limit: () => 64,
      });
    }
    this.updateResult();
  }

  slotIndex(group: SlotGroup, index: number): number {
    return this.slots.findIndex((s) => s.group === group && s.index === index);
  }

  private done() {
    this.updateResult();
    this.host.inv.changed();
  }

  updateResult() {
    this.match = this.gridW ? matchCrafting(this.grid, this.gridW, this.gridW) : null;
  }

  // ---------------------------------------------------------------------------
  // Clicks
  // ---------------------------------------------------------------------------

  /** Normal click (button 0 left, 1 right). */
  click(i: number, button: number) {
    const slot = this.slots[i];
    if (!slot) return;
    if (slot.group === 'trash') {
      this.carried = null;
      return this.done();
    }
    if (slot.group === 'result') { this.takeResult(); return this.done(); }
    const s = slot.get();
    const c = this.carried;
    if (!c) {
      if (!s) return;
      const n = button === 0 ? s.count : Math.ceil(s.count / 2);
      this.carried = copyStack(s, n);
      s.count -= n;
      slot.set(s.count > 0 ? s : null);
    } else if (slot.group === 'output') {
      // Output slots only let you take: top up the carried stack.
      if (s && stackable(s, c)) {
        const n = Math.min(button === 0 ? s.count : Math.ceil(s.count / 2), maxStack(c.id) - c.count);
        c.count += n;
        s.count -= n;
        slot.set(s.count > 0 ? s : null);
      }
    } else if (!slot.mayPlace(c)) {
      return;
    } else if (!s) {
      const n = Math.min(button === 0 ? c.count : 1, slot.limit(c));
      slot.set(copyStack(c, n));
      c.count -= n;
      if (c.count <= 0) this.carried = null;
    } else if (stackable(s, c)) {
      const n = Math.min(button === 0 ? c.count : 1, slot.limit(c) - s.count);
      if (n > 0) {
        s.count += n;
        c.count -= n;
        slot.set(s);
        if (c.count <= 0) this.carried = null;
      }
    } else if (c.count <= slot.limit(c)) {
      slot.set(c);
      this.carried = s;
    }
    this.done();
  }

  /** Takes the crafting result onto the cursor (consumes one set of ingredients). */
  private takeResult(): boolean {
    const r = this.match?.result;
    if (!r) return false;
    const c = this.carried;
    if (c && !(stackable(c, r) && c.count + r.count <= maxStack(r.id))) return false;
    if (c) c.count += r.count;
    else this.carried = copyStack(r);
    this.consumeGrid();
    this.host.crafted?.(r);
    return true;
  }

  private consumeGrid() {
    for (let k = 0; k < this.grid.length; k++) {
      const s = this.grid[k];
      if (!s) continue;
      const rem = ITEMS[s.id]?.remainder ?? 0;
      s.count--;
      if (s.count <= 0) this.grid[k] = rem ? { id: rem, count: 1 } : null;
      else if (rem) {
        const left = this.host.inv.add({ id: rem, count: 1 });
        if (left) this.host.drop({ id: rem, count: left });
      }
    }
    this.updateResult();
  }

  /** Shift-click. */
  quickMove(i: number) {
    const slot = this.slots[i];
    if (!slot) return;
    if (slot.group === 'trash') {
      if (this.host.creative) this.host.inv.clear();
      return this.done();
    }
    if (slot.group === 'result') {
      // Craft as many as fit in the inventory.
      for (let n = 0; n < 64; n++) {
        const r = this.match?.result;
        if (!r || this.host.inv.room(r) < r.count) break;
        const before = r.id;
        this.moveTo(copyStack(r), this.playerSlots(), true);
        this.consumeGrid();
        this.host.crafted?.(r);
        if (this.match?.result.id !== before) break;
      }
      return this.done();
    }
    const s = slot.get();
    if (!s) return;
    const targets = this.quickTargets(slot, s);
    for (const [list, reverse] of targets) {
      if (s.count <= 0) break;
      this.moveTo(s, list, reverse);
    }
    slot.set(s.count > 0 ? s : null);
    this.done();
  }

  private playerSlots(): Slot[] {
    return this.slots.filter((s) => s.group === 'main' || s.group === 'hotbar');
  }

  private group(g: SlotGroup): Slot[] {
    return this.slots.filter((s) => s.group === g);
  }

  /** Where a shift-clicked stack goes, in order: [slots, fill from the end?]. */
  private quickTargets(slot: Slot, s: ItemStack): Array<[Slot[], boolean]> {
    const g = slot.group;
    if (g === 'output' || g === 'container') return [[this.playerSlots(), true]];
    if (g === 'grid' || g === 'armor' || g === 'input' || g === 'fuel') return [[this.playerSlots(), false]];
    const other = g === 'main' ? this.group('hotbar') : this.group('main');
    if (this.chest) return [[this.group('container'), false]];
    if (this.furnace) {
      if (smeltingRecipe(s.id)) return [[this.group('input'), false]];
      if (fuelTime(s.id) > 0) return [[this.group('fuel'), false], [other, false]];
      return [[other, false]];
    }
    const armor = ITEMS[s.id]?.armor;
    if (armor && (this.kind === 'inventory' || this.kind === 'creative')) {
      const a = this.group('armor')[armor.slot];
      if (a && !a.get()) return [[[a], false]];
    }
    return [[other, false]];
  }

  /** Moves as much of `s` as possible into the slots (merging first). Mutates s.count. */
  private moveTo(s: ItemStack, list: Slot[], reverse: boolean) {
    const order = reverse ? [...list].reverse() : list;
    for (const t of order) {
      if (s.count <= 0) return;
      const cur = t.get();
      if (!cur || !stackable(cur, s) || !t.mayPlace(s)) continue;
      const n = Math.min(s.count, t.limit(s) - cur.count);
      if (n <= 0) continue;
      cur.count += n;
      s.count -= n;
      t.set(cur);
    }
    for (const t of order) {
      if (s.count <= 0) return;
      if (t.get() || !t.mayPlace(s)) continue;
      const n = Math.min(s.count, t.limit(s));
      t.set(copyStack(s, n));
      s.count -= n;
    }
  }

  /** Double-click: gathers matching items into the carried stack. */
  collect() {
    const c = this.carried;
    if (!c) return;
    const max = maxStack(c.id);
    for (const pass of [0, 1]) {
      for (const t of this.slots) {
        if (c.count >= max) break;
        if (t.group === 'result' || t.group === 'trash') continue;
        const s = t.get();
        if (!s || !stackable(s, c)) continue;
        if (pass === 0 && s.count >= maxStack(s.id)) continue;
        const n = Math.min(s.count, max - c.count);
        c.count += n;
        s.count -= n;
        t.set(s.count > 0 ? s : null);
      }
    }
    this.done();
  }

  /** Whether a drag over this slot would place carried items into it. */
  canDragInto(i: number): boolean {
    const c = this.carried, slot = this.slots[i];
    if (!c || !slot || slot.group === 'result' || slot.group === 'output' || slot.group === 'trash') return false;
    if (!slot.mayPlace(c)) return false;
    const s = slot.get();
    return !s || (stackable(s, c) && s.count < slot.limit(c));
  }

  /** Drag-distribute: button 0 splits the carried stack evenly, button 1 places one per slot. */
  distribute(indices: number[], button: number) {
    const c = this.carried;
    const list = indices.filter((i) => this.canDragInto(i));
    if (!c || list.length === 0) return;
    const per = button === 0 ? Math.floor(c.count / list.length) : 1;
    if (per <= 0) return;
    for (const i of list) {
      if (c.count <= 0) break;
      const slot = this.slots[i];
      const s = slot.get();
      const room = slot.limit(c) - (s ? s.count : 0);
      const n = Math.min(per, room, c.count);
      if (n <= 0) continue;
      if (s) { s.count += n; slot.set(s); } else slot.set(copyStack(c, n));
      c.count -= n;
    }
    if (c.count <= 0) this.carried = null;
    this.done();
  }

  /** Number keys over a slot: swap it with a hotbar slot. */
  swapWithHotbar(i: number, h: number) {
    const slot = this.slots[i];
    const inv = this.host.inv;
    if (!slot || slot.group === 'trash' || h < 0 || h >= HOTBAR_SIZE) return;
    const hot = inv.slots[h];
    if (slot.group === 'result') {
      const r = this.match?.result;
      if (!r || hot) return;
      inv.slots[h] = copyStack(r);
      this.consumeGrid();
      this.host.crafted?.(r);
      return this.done();
    }
    if (slot.group === 'hotbar' && slot.index === h) return;
    const s = slot.get();
    if (hot && (!slot.mayPlace(hot) || hot.count > slot.limit(hot))) return;
    if (slot.group === 'output' && hot) return;
    inv.slots[h] = s;
    slot.set(hot);
    this.done();
  }

  /** Q over a slot: removes one (or the whole stack) and returns it to be thrown. */
  dropFrom(i: number, all: boolean): ItemStack | null {
    const slot = this.slots[i];
    if (!slot || slot.group === 'trash') return null;
    if (slot.group === 'result') {
      const r = this.match?.result;
      if (!r) return null;
      const out = copyStack(r);
      this.consumeGrid();
      this.host.crafted?.(r);
      this.done();
      return out;
    }
    const s = slot.get();
    if (!s) return null;
    const n = all ? s.count : 1;
    const out = copyStack(s, n);
    s.count -= n;
    slot.set(s.count > 0 ? s : null);
    this.done();
    return out;
  }

  /**
   * Creative palette click: a left click puts a full stack in the selected hotbar slot, a right
   * (or shift / middle) click picks one up on the cursor; clicking while carrying deletes the stack.
   */
  clickPalette(id: number, button: number, shift: boolean) {
    if (this.carried) {
      this.carried = null;
    } else {
      const full = { id, count: maxStack(id) };
      if (button === 0 && !shift) this.host.inv.slots[this.host.inv.selected] = full;
      else this.carried = full;
    }
    this.done();
  }

  paletteToHotbar(id: number, h: number) {
    this.host.inv.slots[h] = { id, count: maxStack(id) };
    this.done();
  }

  /** Throws the carried stack (click outside the window). */
  dropCarried(all: boolean) {
    const c = this.carried;
    if (!c) return;
    const n = all ? c.count : 1;
    this.host.drop(copyStack(c, n));
    c.count -= n;
    if (c.count <= 0) this.carried = null;
    this.done();
  }

  /** Returns everything held by the menu (grid, cursor) to the inventory or drops it. */
  close() {
    const give = (s: ItemStack | null) => {
      if (!s) return;
      const left = this.host.inv.add(s);
      if (left > 0) this.host.drop(copyStack(s, left));
    };
    for (let k = 0; k < this.grid.length; k++) { give(this.grid[k]); this.grid[k] = null; }
    give(this.carried);
    this.carried = null;
    this.done();
  }

  // ---------------------------------------------------------------------------
  // Recipe book
  // ---------------------------------------------------------------------------

  /** Item counts available for crafting: inventory plus what is already in the grid. */
  available(): Map<number, number> {
    const m = new Map<number, number>();
    const add = (s: ItemStack | null) => { if (s && !s.damage) m.set(s.id, (m.get(s.id) ?? 0) + s.count); };
    this.host.inv.slots.forEach(add);
    this.grid.forEach(add);
    return m;
  }

  /** Picks an item for every ingredient from the given counts; null if something is missing. */
  static allocate(cells: Array<Ingredient | null>, counts: Map<number, number>): Array<number | null> | null {
    const left = new Map(counts);
    const chosen: Array<number | null> = [];
    // Cells with the same ingredient prefer the same item (all oak planks rather than a mix).
    const prefer = new Map<string, number>();
    for (const cell of cells) {
      if (!cell) { chosen.push(null); continue; }
      const key = cell.join(',');
      let pick = prefer.get(key);
      if (pick === undefined || !((left.get(pick) ?? 0) > 0)) {
        pick = undefined;
        let best = 0;
        for (const id of cell) {
          const n = left.get(id) ?? 0;
          if (n > best) { best = n; pick = id; }
        }
      }
      if (pick === undefined) return null;
      left.set(pick, left.get(pick)! - 1);
      prefer.set(key, pick);
      chosen.push(pick);
    }
    return chosen;
  }

  canCraft(r: Recipe): boolean {
    const layout = recipeLayout(r, this.gridW);
    return !!layout && Menu.allocate(layout, this.available()) !== null;
  }

  /**
   * Recipe-book click: clears the grid into the inventory and lays out the recipe with items from
   * the inventory (as many sets as possible when `max`). Returns false if it can't be made.
   */
  fillRecipe(r: Recipe, max: boolean): boolean {
    const layout = recipeLayout(r, this.gridW);
    if (!layout || !this.canCraft(r)) return false;
    const inv = this.host.inv;
    for (let k = 0; k < this.grid.length; k++) {
      const s = this.grid[k];
      if (!s) continue;
      const left = inv.add(s);
      this.grid[k] = left > 0 ? copyStack(s, left) : null;
    }
    if (this.grid.some((s) => s)) { this.done(); return false; }
    const counts = new Map<number, number>();
    for (const s of inv.slots) if (s && !s.damage) counts.set(s.id, (counts.get(s.id) ?? 0) + s.count);
    const pick = Menu.allocate(layout, counts)!;
    // Sets: limited by the scarcest ingredient and by stack sizes.
    let sets = 1;
    if (max) {
      sets = 64;
      const need = new Map<number, number>();
      for (const id of pick) if (id !== null) need.set(id, (need.get(id) ?? 0) + 1);
      for (const [id, n] of need) sets = Math.min(sets, Math.floor((counts.get(id) ?? 0) / n), maxStack(id));
      sets = Math.max(1, sets);
    }
    for (let k = 0; k < layout.length; k++) {
      const id = pick[k];
      if (id === null) continue;
      const got = inv.remove(id, sets);
      if (got > 0) this.grid[k] = { id, count: got };
    }
    this.done();
    return true;
  }
}
