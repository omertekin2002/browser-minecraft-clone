import { ItemStack, ITEMS, maxStack, stackable, copyStack, isValidItem } from '../world/items';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;

type SavedStack = [number, number] | [number, number, number] | null;

export function saveStack(s: ItemStack | null): SavedStack {
  if (!s) return null;
  return s.damage ? [s.id, s.count, s.damage] : [s.id, s.count];
}

export function loadStack(v: unknown): ItemStack | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [id, count, damage] = v as number[];
  if (!isValidItem(id) || !(count > 0)) return null;
  const s: ItemStack = { id, count: Math.min(Math.floor(count), maxStack(id)) };
  if (damage && damage > 0) s.damage = Math.floor(damage);
  return s;
}

/**
 * The player's items: 36 slots (0–8 hotbar, 9–35 main) and 4 armor slots (head, chest, legs, feet).
 */
export class Inventory {
  readonly slots: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
  readonly armor: (ItemStack | null)[] = [null, null, null, null];
  selected = 0;
  /** Called after any change (HUD refresh). */
  onChange: (() => void) | null = null;

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  changed() {
    this.onChange?.();
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this.changed();
  }

  /** How many more of this stack would fit. */
  room(stack: ItemStack): number {
    let n = 0;
    const max = maxStack(stack.id);
    for (const s of this.slots) {
      if (!s) n += max;
      else if (stackable(s, stack)) n += max - s.count;
    }
    return n;
  }

  /**
   * Adds items like Minecraft does: top up the selected stack and other matching stacks first,
   * then fill empty slots (hotbar first). Returns the count that did not fit.
   */
  add(stack: ItemStack): number {
    let left = stack.count;
    const max = maxStack(stack.id);
    const order = [this.selected, ...Array.from({ length: INVENTORY_SIZE }, (_, i) => i).filter((i) => i !== this.selected)];
    for (const i of order) {
      const s = this.slots[i];
      if (!s || !stackable(s, stack) || s.count >= max) continue;
      const n = Math.min(left, max - s.count);
      s.count += n;
      left -= n;
      if (left === 0) break;
    }
    for (let i = 0; i < INVENTORY_SIZE && left > 0; i++) {
      if (this.slots[i]) continue;
      const n = Math.min(left, max);
      this.slots[i] = copyStack(stack, n);
      left -= n;
    }
    if (left !== stack.count) this.changed();
    return left;
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Removes up to n items of an id (from the end of the inventory first); returns how many were removed. */
  remove(id: number, n: number): number {
    let removed = 0;
    for (let i = INVENTORY_SIZE - 1; i >= 0 && removed < n; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const k = Math.min(s.count, n - removed);
      s.count -= k;
      removed += k;
      if (s.count === 0) this.slots[i] = null;
    }
    if (removed) this.changed();
    return removed;
  }

  /** Uses up items from the selected slot. */
  consumeHeld(n = 1) {
    const s = this.held;
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /** Replaces the held item (e.g. bucket → water bucket). Extra items of a stack go back into the inventory. */
  replaceHeld(result: ItemStack): ItemStack | null {
    const s = this.held;
    if (s && s.count > 1) {
      s.count--;
      const left = this.add(result);
      this.changed();
      return left > 0 ? copyStack(result, left) : null;
    }
    this.slots[this.selected] = result;
    this.changed();
    return null;
  }

  /** Wears down a damageable stack. Returns true if it broke (and removes it). */
  static damage(s: ItemStack, amount: number): boolean {
    const d = ITEMS[s.id];
    if (!d || d.durability <= 0 || amount <= 0) return false;
    s.damage = (s.damage ?? 0) + amount;
    return s.damage >= d.durability;
  }

  /** Damages the held item; returns true when it broke. */
  damageHeld(amount = 1): boolean {
    const s = this.held;
    if (!s) return false;
    const broke = Inventory.damage(s, amount);
    if (broke) this.slots[this.selected] = null;
    this.changed();
    return broke;
  }

  /** Total armor defense points and toughness of the worn pieces. */
  armorValues(): [number, number] {
    let def = 0, tough = 0;
    for (const s of this.armor) {
      const a = s && ITEMS[s.id]?.armor;
      if (a) { def += a.defense; tough += a.toughness; }
    }
    return [def, tough];
  }

  serialize() {
    return { slots: this.slots.map(saveStack), armor: this.armor.map(saveStack), selected: this.selected };
  }

  load(data: unknown): boolean {
    const d = data as { slots?: unknown[]; armor?: unknown[]; selected?: number } | null;
    if (!d || !Array.isArray(d.slots)) return false;
    for (let i = 0; i < INVENTORY_SIZE; i++) this.slots[i] = loadStack(d.slots[i]);
    for (let i = 0; i < 4; i++) {
      const s = Array.isArray(d.armor) ? loadStack(d.armor[i]) : null;
      this.armor[i] = s && ITEMS[s.id]?.armor?.slot === i ? s : null;
    }
    if (typeof d.selected === 'number' && d.selected >= 0 && d.selected < HOTBAR_SIZE) this.selected = d.selected | 0;
    this.changed();
    return true;
  }
}
