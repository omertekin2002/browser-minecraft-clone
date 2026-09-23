import * as B from './blocks';
import * as I from './items';
import { ItemStack, itemId, ITEMS } from './items';
import { COLORS } from './textureNames';

/**
 * Crafting and smelting recipes (Minecraft's vanilla recipes for everything the game has).
 * Ingredients are item names or '#tags'.
 */

/** Any of these item ids. */
export type Ingredient = number[];

export interface ShapedRecipe {
  kind: 'shaped';
  id: number;
  w: number;
  h: number;
  /** Row-major w×h cells; null = must be empty. */
  cells: (Ingredient | null)[];
  result: ItemStack;
}

export interface ShapelessRecipe {
  kind: 'shapeless';
  id: number;
  ingredients: Ingredient[];
  result: ItemStack;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

export interface SmeltingRecipe {
  input: Ingredient;
  result: number;
  /** Cooking time in seconds. */
  time: number;
}

const TAGS: Record<string, number[]> = {
  planks: [B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS],
  logs: [B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG],
  wool: COLORS.map((c) => B.WOOL_BY_COLOR[c]),
  coals: [I.COAL, I.CHARCOAL],
  wooden_slabs: ['oak_slab', 'birch_slab', 'spruce_slab'].map((n) => B.SLAB_IDS[n][0]),
  stone_tool_materials: [B.COBBLESTONE],
};

export const TAG_NAMES: Record<string, string> = {
  planks: 'Any Planks', logs: 'Any Log', wool: 'Any Wool', coals: 'Coal or Charcoal', wooden_slabs: 'Any Wooden Slab',
};

function ing(spec: string): Ingredient {
  if (spec.startsWith('#')) {
    const t = TAGS[spec.slice(1)];
    if (!t) throw new Error(`Unknown tag ${spec}`);
    return t;
  }
  return [itemId(spec)];
}

export const RECIPES: Recipe[] = [];

function shaped(result: string, count: number, pattern: string[], keys: Record<string, string>) {
  const h = pattern.length, w = Math.max(...pattern.map((r) => r.length));
  const cells: (Ingredient | null)[] = [];
  for (const row of pattern) for (let x = 0; x < w; x++) {
    const ch = row[x] ?? ' ';
    cells.push(ch === ' ' ? null : ing(keys[ch] ?? (() => { throw new Error(`Recipe ${result}: no key ${ch}`); })()));
  }
  RECIPES.push({ kind: 'shaped', id: RECIPES.length, w, h, cells, result: { id: itemId(result), count } });
}

function shapeless(result: string, count: number, ingredients: string[]) {
  RECIPES.push({ kind: 'shapeless', id: RECIPES.length, ingredients: ingredients.map(ing), result: { id: itemId(result), count } });
}

const SQUARE2 = ['##', '##'];
const SQUARE3 = ['###', '###', '###'];
const RING = ['###', '# #', '###'];

/** A 3×3 storage block and its reverse. */
function storage(block: string, item: string) {
  shaped(block, 1, SQUARE3, { '#': item });
  shapeless(item, 9, [block]);
}

// ---- wood ----
for (const wood of ['oak', 'birch', 'spruce']) {
  shapeless(`${wood}_planks`, 4, [`${wood}_log`]);
  shaped(`${wood}_slab`, 6, ['###'], { '#': `${wood}_planks` });
}
shaped('stick', 4, ['#', '#'], { '#': '#planks' });
shaped('crafting_table', 1, SQUARE2, { '#': '#planks' });
shaped('chest', 1, RING, { '#': '#planks' });
shaped('barrel', 1, ['PSP', 'P P', 'PSP'], { P: '#planks', S: '#wooden_slabs' });
shaped('bookshelf', 1, ['###', 'BBB', '###'], { '#': '#planks', B: 'book' });
shaped('bowl', 4, ['# #', ' # '], { '#': '#planks' });

// ---- stone ----
shaped('furnace', 1, RING, { '#': 'cobblestone' });
shaped('stone_bricks', 4, SQUARE2, { '#': 'stone' });
shaped('chiseled_stone_bricks', 1, ['#', '#'], { '#': 'stone_brick_slab' });
for (const [slab, block] of [
  ['stone_slab', 'stone'], ['smooth_stone_slab', 'smooth_stone'], ['cobblestone_slab', 'cobblestone'],
  ['stone_brick_slab', 'stone_bricks'], ['brick_slab', 'bricks'], ['sandstone_slab', 'sandstone'],
]) shaped(slab, 6, ['###'], { '#': block });
for (const s of ['granite', 'diorite', 'andesite']) shaped(`polished_${s}`, 4, SQUARE2, { '#': s });
shapeless('andesite', 2, ['diorite', 'cobblestone']);
shaped('bricks', 1, SQUARE2, { '#': 'brick' });
shaped('sandstone', 1, SQUARE2, { '#': 'sand' });
shaped('cut_sandstone', 4, SQUARE2, { '#': 'sandstone' });
shaped('chiseled_sandstone', 1, ['#', '#'], { '#': 'sandstone_slab' });

// ---- storage blocks & nuggets ----
storage('iron_block', 'iron_ingot');
storage('gold_block', 'gold_ingot');
storage('diamond_block', 'diamond');
storage('emerald_block', 'emerald');
storage('lapis_block', 'lapis_lazuli');
storage('redstone_block', 'redstone');
storage('coal_block', 'coal');
storage('hay_block', 'wheat');
storage('bone_block', 'bone_meal');
shaped('iron_ingot', 1, SQUARE3, { '#': 'iron_nugget' });
shapeless('iron_nugget', 9, ['iron_ingot']);
shaped('gold_ingot', 1, SQUARE3, { '#': 'gold_nugget' });
shapeless('gold_nugget', 9, ['gold_ingot']);

// ---- tools, weapons & armor ----
const TOOL_PATTERNS: Record<string, string[]> = {
  pickaxe: ['XXX', ' # ', ' # '],
  axe: ['XX', 'X#', ' #'],
  shovel: ['X', '#', '#'],
  hoe: ['XX', ' #', ' #'],
  sword: ['X', 'X', '#'],
};
const TOOL_MATERIAL: Record<string, string> = {
  wooden: '#planks', stone: '#stone_tool_materials', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond',
};
for (const [mat, x] of Object.entries(TOOL_MATERIAL)) {
  for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) shaped(`${mat}_${tool}`, 1, pattern, { X: x, '#': 'stick' });
}
const ARMOR_PATTERNS: Record<string, string[]> = {
  helmet: ['XXX', 'X X'],
  chestplate: ['X X', 'XXX', 'XXX'],
  leggings: ['XXX', 'X X', 'X X'],
  boots: ['X X', 'X X'],
};
for (const [mat, x] of Object.entries({ leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' })) {
  for (const [piece, pattern] of Object.entries(ARMOR_PATTERNS)) shaped(`${mat}_${piece}`, 1, pattern, { X: x });
}
shaped('shears', 1, [' #', '# '], { '#': 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
shaped('bucket', 1, ['# #', ' # '], { '#': 'iron_ingot' });
shaped('compass', 1, [' # ', '#R#', ' # '], { '#': 'iron_ingot', R: 'redstone' });
shaped('clock', 1, [' # ', '#R#', ' # '], { '#': 'gold_ingot', R: 'redstone' });

// ---- light & functional ----
shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' });
shaped('lantern', 1, ['NNN', 'NTN', 'NNN'], { N: 'iron_nugget', T: 'torch' });
shaped('glowstone', 1, SQUARE2, { '#': 'glowstone_dust' });
shaped('jack_o_lantern', 1, ['P', 'T'], { P: 'pumpkin', T: 'torch' });
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' });

// ---- natural materials ----
shaped('snow', 1, SQUARE2, { '#': 'snowball' });
shaped('clay', 1, SQUARE2, { '#': 'clay_ball' });
shapeless('bone_meal', 3, ['bone']);
shaped('paper', 3, ['###'], { '#': 'sugar_cane' });
shapeless('sugar', 1, ['sugar_cane']);
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shaped('white_wool', 1, SQUARE2, { '#': 'string' });

// ---- food ----
shaped('bread', 1, ['###'], { '#': 'wheat' });
shaped('cookie', 8, ['WCW'], { W: 'wheat', C: 'cocoa_beans' });
shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shaped('golden_apple', 1, ['###', '#A#', '###'], { '#': 'gold_ingot', A: 'apple' });
shapeless('mushroom_stew', 1, ['red_mushroom', 'brown_mushroom', 'bowl']);

// ---- dyes ----
for (const [dye, src] of [
  ['white_dye', 'bone_meal'], ['yellow_dye', 'dandelion'], ['red_dye', 'poppy'], ['light_blue_dye', 'blue_orchid'],
  ['magenta_dye', 'allium'], ['light_gray_dye', 'oxeye_daisy'], ['blue_dye', 'cornflower'], ['blue_dye', 'lapis_lazuli'],
  ['black_dye', 'ink_sac'], ['brown_dye', 'cocoa_beans'],
]) shapeless(dye, 1, [src]);
for (const [dye, count, parts] of [
  ['orange_dye', 2, ['red_dye', 'yellow_dye']],
  ['pink_dye', 2, ['red_dye', 'white_dye']],
  ['lime_dye', 2, ['green_dye', 'white_dye']],
  ['light_blue_dye', 2, ['blue_dye', 'white_dye']],
  ['cyan_dye', 2, ['blue_dye', 'green_dye']],
  ['purple_dye', 2, ['red_dye', 'blue_dye']],
  ['magenta_dye', 2, ['purple_dye', 'pink_dye']],
  ['magenta_dye', 3, ['blue_dye', 'red_dye', 'pink_dye']],
  ['magenta_dye', 4, ['blue_dye', 'red_dye', 'red_dye', 'white_dye']],
  ['gray_dye', 2, ['black_dye', 'white_dye']],
  ['light_gray_dye', 2, ['gray_dye', 'white_dye']],
  ['light_gray_dye', 3, ['black_dye', 'white_dye', 'white_dye']],
] as Array<[string, number, string[]]>) shapeless(dye, count, parts);

// ---- coloured blocks ----
for (const c of COLORS) {
  shapeless(`${c}_wool`, 1, [`${c}_dye`, '#wool']);
  shaped(`${c}_stained_glass`, 8, RING.map((r, i) => (i === 1 ? '#D#' : r)), { '#': 'glass', D: `${c}_dye` });
  shaped(`${c}_terracotta`, 8, ['###', '#D#', '###'], { '#': 'terracotta', D: `${c}_dye` });
  shapeless(`${c}_concrete_powder`, 8, [`${c}_dye`, 'sand', 'sand', 'sand', 'sand', 'gravel', 'gravel', 'gravel', 'gravel']);
}

// ---------------------------------------------------------------------------
// Smelting
// ---------------------------------------------------------------------------

export const SMELTING: SmeltingRecipe[] = [];
const smeltMap = new Map<number, SmeltingRecipe>();
function smelt(input: string, result: string, time = 10) {
  const r = { input: ing(input), result: itemId(result), time };
  SMELTING.push(r);
  for (const id of r.input) smeltMap.set(id, r);
}
smelt('cobblestone', 'stone');
smelt('stone', 'smooth_stone');
smelt('stone_bricks', 'cracked_stone_bricks');
smelt('sandstone', 'smooth_sandstone');
smelt('sand', 'glass');
smelt('clay_ball', 'brick');
smelt('clay', 'terracotta');
smelt('cactus', 'green_dye');
smelt('#logs', 'charcoal');
smelt('raw_iron', 'iron_ingot');
smelt('raw_gold', 'gold_ingot');
smelt('iron_ore', 'iron_ingot');
smelt('gold_ore', 'gold_ingot');
smelt('coal_ore', 'coal');
smelt('diamond_ore', 'diamond');
smelt('emerald_ore', 'emerald');
smelt('lapis_ore', 'lapis_lazuli');
smelt('redstone_ore', 'redstone');
for (const meat of ['porkchop', 'beef', 'chicken', 'cod']) smelt(meat, `cooked_${meat}`);
for (const [mat, nugget] of [['iron', 'iron_nugget'], ['golden', 'gold_nugget']]) {
  for (const t of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) smelt(`${mat}_${t}`, nugget);
  for (const p of I.ARMOR_PIECES) smelt(`${mat}_${p}`, nugget);
}
for (const p of I.ARMOR_PIECES) smelt(`chainmail_${p}`, 'iron_nugget');

export function smeltingRecipe(id: number): SmeltingRecipe | undefined {
  return smeltMap.get(id);
}

export function fuelTime(id: number): number {
  return ITEMS[id]?.fuel ?? 0;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const shapedBySize = new Map<number, ShapedRecipe[]>();
const shapelessByCount = new Map<number, ShapelessRecipe[]>();
for (const r of RECIPES) {
  if (r.kind === 'shaped') {
    const k = r.w * 4 + r.h;
    if (!shapedBySize.has(k)) shapedBySize.set(k, []);
    shapedBySize.get(k)!.push(r);
  } else {
    const k = r.ingredients.length;
    if (!shapelessByCount.has(k)) shapelessByCount.set(k, []);
    shapelessByCount.get(k)!.push(r);
  }
}

function matchesShaped(r: ShapedRecipe, grid: (ItemStack | null)[], gw: number, ox: number, oy: number, mirror: boolean): boolean {
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const want = r.cells[y * r.w + (mirror ? r.w - 1 - x : x)];
      const have = grid[(oy + y) * gw + ox + x];
      if (!want) { if (have) return false; continue; }
      if (!have || !want.includes(have.id)) return false;
    }
  }
  return true;
}

function matchesShapeless(r: ShapelessRecipe, items: ItemStack[]): boolean {
  const used = new Array<boolean>(items.length).fill(false);
  const assign = (k: number): boolean => {
    if (k === r.ingredients.length) return true;
    const want = r.ingredients[k];
    for (let i = 0; i < items.length; i++) {
      if (used[i] || !want.includes(items[i].id)) continue;
      used[i] = true;
      if (assign(k + 1)) return true;
      used[i] = false;
    }
    return false;
  };
  return assign(0);
}

export interface CraftMatch {
  result: ItemStack;
  /** The recipe (null for tool repair). */
  recipe: Recipe | null;
}

/** Finds what a crafting grid (gw×gh, row-major) makes, if anything. */
export function matchCrafting(grid: (ItemStack | null)[], gw: number, gh: number): CraftMatch | null {
  let minX = gw, minY = gh, maxX = -1, maxY = -1;
  const items: ItemStack[] = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const s = grid[y * gw + x];
    if (!s) continue;
    items.push(s);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (items.length === 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const r of shapedBySize.get(bw * 4 + bh) ?? []) {
    if (matchesShaped(r, grid, gw, minX, minY, false) || matchesShaped(r, grid, gw, minX, minY, true)) {
      return { result: { ...r.result }, recipe: r };
    }
  }
  for (const r of shapelessByCount.get(items.length) ?? []) {
    if (matchesShapeless(r, items)) return { result: { ...r.result }, recipe: r };
  }
  // Repair: two damaged items of the same kind combine their durability plus a 5% bonus.
  if (items.length === 2 && items[0].id === items[1].id) {
    const d = ITEMS[items[0].id];
    if (d && d.durability > 0) {
      const left = (s: ItemStack) => d.durability - (s.damage ?? 0);
      const total = left(items[0]) + left(items[1]) + Math.floor(d.durability * 0.05);
      const damage = Math.max(0, d.durability - total);
      return { result: damage > 0 ? { id: d.id, count: 1, damage } : { id: d.id, count: 1 }, recipe: null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recipe book helpers
// ---------------------------------------------------------------------------

/** The recipe laid out on a grid of the given width (for auto-filling and ghost previews). */
export function recipeLayout(r: Recipe, gw: number): Array<Ingredient | null> | null {
  const out: Array<Ingredient | null> = new Array(gw * gw).fill(null);
  if (r.kind === 'shaped') {
    if (r.w > gw || r.h > gw) return null;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out[y * gw + x] = r.cells[y * r.w + x];
  } else {
    if (r.ingredients.length > gw * gw) return null;
    r.ingredients.forEach((ingr, i) => { out[i] = ingr; });
  }
  return out;
}

export function recipeFits(r: Recipe, gw: number): boolean {
  return r.kind === 'shaped' ? r.w <= gw && r.h <= gw : r.ingredients.length <= gw * gw;
}

/** The ingredients of a recipe, one entry per grid cell that must be filled. */
export function recipeIngredients(r: Recipe): Ingredient[] {
  return r.kind === 'shaped' ? r.cells.filter((c): c is Ingredient => !!c) : r.ingredients;
}

/** Display name for an ingredient ("Stick", "Any Planks"). */
export function ingredientName(ingr: Ingredient): string {
  if (ingr.length === 1) return ITEMS[ingr[0]]?.displayName ?? '?';
  for (const [k, ids] of Object.entries(TAGS)) {
    if (ids.length === ingr.length && ids.every((id, i) => id === ingr[i])) return TAG_NAMES[k] ?? `Any ${k}`;
  }
  return ITEMS[ingr[0]]?.displayName ?? '?';
}
