import * as B from './blocks';
import { TextureName, textureLayer, COLORS, Color } from './textureNames';

/**
 * Item registry. Every block with an item form uses its block id as item id (0..255); all other
 * items (tools, food, materials…) have ids from 256. Ids are written to save files, so new items
 * must be appended to the end of the table below.
 */

export type Category = 'building' | 'colored' | 'natural' | 'functional' | 'tools' | 'combat' | 'food' | 'ingredients';

export const CATEGORY_NAMES: Record<Category, string> = {
  building: 'Building Blocks',
  colored: 'Colored Blocks',
  natural: 'Natural Blocks',
  functional: 'Functional Blocks',
  tools: 'Tools & Utilities',
  combat: 'Combat',
  food: 'Food & Drinks',
  ingredients: 'Ingredients',
};

export interface ToolInfo {
  type: B.ToolType;
  /** Harvest tier (see B.TIER_*). */
  tier: number;
  /** Mining speed multiplier on blocks this tool is made for. */
  speed: number;
  /** Attack damage (shown in tooltips). */
  damage: number;
}

/** Armor slots: 0 head, 1 chest, 2 legs, 3 feet. */
export interface ArmorInfo { slot: number; defense: number; toughness: number }

export interface FoodInfo {
  hunger: number;
  saturation: number;
  /** Can be eaten with a full hunger bar. */
  always?: boolean;
  /** Seconds of Regeneration II after eating. */
  regen?: number;
}

export interface ItemDef {
  id: number;
  name: string;
  displayName: string;
  maxStack: number;
  /** Block placed by this item (0 = none). */
  block: number;
  /** Drawn as a flat sprite (icon + held item) instead of a block. */
  flat: boolean;
  /** Texture layer of the flat sprite (-1 for block-rendered items). */
  texture: number;
  /** Creative inventory tab (null = hidden). */
  category: Category | null;
  /** Uses before breaking (0 = not damageable). */
  durability: number;
  tool?: ToolInfo;
  armor?: ArmorInfo;
  food?: FoodInfo;
  /** Furnace burn time in seconds (0 = not a fuel). */
  fuel: number;
  /** Item left behind after being used up in a recipe or as fuel (0 = none). */
  remainder: number;
  /** Name colour: 0 common, 1 uncommon (yellow), 2 rare (aqua). */
  rarity: number;
}

export interface ItemStack {
  id: number;
  count: number;
  /** Durability used so far (damageable items only). */
  damage?: number;
}

export const ITEMS: ItemDef[] = [];
const byName = new Map<string, ItemDef>();

function titleCase(name: string): string {
  return name.split('_').map((w) => (w === 'and' || w === 'of' || w === 'o' ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

function register(d: ItemDef): number {
  if (ITEMS[d.id]) throw new Error(`Item id ${d.id} used twice`);
  if (byName.has(d.name)) throw new Error(`Item name ${d.name} used twice`);
  ITEMS[d.id] = d;
  byName.set(d.name, d);
  return d.id;
}

// ---------------------------------------------------------------------------
// Block items
// ---------------------------------------------------------------------------

const BLOCK_CATEGORY: Record<string, Category> = {};
const catBlocks = (cat: Category, ids: number[]) => ids.forEach((id) => { BLOCK_CATEGORY[B.BLOCKS[id].name] = cat; });

const SLAB = (name: string) => B.SLAB_IDS[name][0];
catBlocks('building', [
  B.STONE, B.COBBLESTONE, B.MOSSY_COBBLESTONE, B.SMOOTH_STONE, B.STONE_BRICKS, B.MOSSY_STONE_BRICKS,
  B.CRACKED_STONE_BRICKS, B.CHISELED_STONE_BRICKS, B.GRANITE, B.POLISHED_GRANITE, B.DIORITE, B.POLISHED_DIORITE,
  B.ANDESITE, B.POLISHED_ANDESITE, B.BRICKS, B.SANDSTONE, B.CUT_SANDSTONE, B.SMOOTH_SANDSTONE, B.CHISELED_SANDSTONE,
  B.OAK_LOG, B.OAK_PLANKS, B.BIRCH_LOG, B.BIRCH_PLANKS, B.SPRUCE_LOG, B.SPRUCE_PLANKS,
  SLAB('oak_slab'), SLAB('birch_slab'), SLAB('spruce_slab'), SLAB('stone_slab'), SLAB('smooth_stone_slab'),
  SLAB('cobblestone_slab'), SLAB('stone_brick_slab'), SLAB('brick_slab'), SLAB('sandstone_slab'),
  B.GLASS, B.TERRACOTTA, B.OBSIDIAN, B.COAL_BLOCK, B.IRON_BLOCK, B.GOLD_BLOCK, B.REDSTONE_BLOCK, B.EMERALD_BLOCK,
  B.LAPIS_BLOCK, B.DIAMOND_BLOCK,
]);
catBlocks('colored', [
  ...COLORS.map((c) => B.WOOL_BY_COLOR[c]), ...COLORS.map((c) => B.TERRACOTTA_BY_COLOR[c]),
  ...COLORS.map((c) => B.CONCRETE_BY_COLOR[c]), ...COLORS.map((c) => B.POWDER_BY_COLOR[c]),
  ...COLORS.map((c) => B.GLASS_BY_COLOR[c]),
]);
catBlocks('natural', [
  B.GRASS, B.SNOWY_GRASS, B.DIRT, B.SAND, B.GRAVEL, B.CLAY, B.SNOW, B.ICE,
  B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.REDSTONE_ORE, B.EMERALD_ORE, B.LAPIS_ORE, B.DIAMOND_ORE,
  B.OAK_LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING,
  B.TALL_GRASS, B.FERN, B.DEAD_BUSH, B.DANDELION, B.POPPY, B.BLUE_ORCHID, B.ALLIUM, B.OXEYE_DAISY, B.CORNFLOWER,
  B.RED_MUSHROOM, B.BROWN_MUSHROOM, B.CACTUS, B.SUGAR_CANE, B.PUMPKIN, B.HAY_BLOCK, B.BONE_BLOCK, B.COBWEB,
]);
catBlocks('functional', [
  B.CRAFTING_TABLE, B.FURNACE, B.CHEST, B.BARREL, B.BOOKSHELF, B.TORCH, B.LANTERN, B.GLOWSTONE, B.SEA_LANTERN,
  B.JACK_O_LANTERN, B.TNT,
]);

/** Furnace fuel for block items, seconds. */
const BLOCK_FUEL: Record<string, number> = {
  coal_block: 800, oak_log: 15, birch_log: 15, spruce_log: 15, oak_planks: 15, birch_planks: 15, spruce_planks: 15,
  oak_slab: 7.5, birch_slab: 7.5, spruce_slab: 7.5, crafting_table: 15, chest: 15, barrel: 15, bookshelf: 15,
  oak_sapling: 5, birch_sapling: 5, spruce_sapling: 5, dead_bush: 5,
};
for (const c of COLORS) BLOCK_FUEL[`${c}_wool`] = 5;

for (const b of B.BLOCKS) {
  if (!b || !b.inInventory) continue;
  const flat = b.shape === B.Shape.CROSS || b.shape === B.Shape.TORCH || b.id === B.LANTERN;
  register({
    id: b.id,
    name: b.name,
    displayName: b.displayName,
    maxStack: 64,
    block: b.id,
    flat,
    texture: b.id === B.LANTERN ? textureLayer('lantern_item') : flat ? b.faces[0] : -1,
    category: BLOCK_CATEGORY[b.name] ?? null,
    durability: 0,
    fuel: BLOCK_FUEL[b.name] ?? 0,
    remainder: 0,
    rarity: 0,
  });
}

// ---------------------------------------------------------------------------
// Non-block items (ids from 256, append only)
// ---------------------------------------------------------------------------

let nextId = 256;
interface ItemSpec {
  displayName?: string;
  maxStack?: number;
  block?: number;
  texture?: TextureName;
  durability?: number;
  tool?: ToolInfo;
  armor?: ArmorInfo;
  food?: FoodInfo;
  fuel?: number;
  remainder?: number;
  rarity?: number;
}
function item(name: string, category: Category | null, s: ItemSpec = {}): number {
  return register({
    id: nextId++,
    name,
    displayName: s.displayName ?? titleCase(name),
    maxStack: s.maxStack ?? (s.durability || s.tool || s.armor ? 1 : 64),
    block: s.block ?? 0,
    flat: true,
    texture: textureLayer(s.texture ?? (name as TextureName)),
    category,
    durability: s.durability ?? 0,
    tool: s.tool,
    armor: s.armor,
    food: s.food,
    fuel: s.fuel ?? 0,
    remainder: s.remainder ?? 0,
    rarity: s.rarity ?? 0,
  });
}

export const STICK = item('stick', 'ingredients', { fuel: 5 });
export const COAL = item('coal', 'ingredients', { fuel: 80 });
export const CHARCOAL = item('charcoal', 'ingredients', { fuel: 80 });
export const RAW_IRON = item('raw_iron', 'ingredients');
export const RAW_GOLD = item('raw_gold', 'ingredients');
export const IRON_INGOT = item('iron_ingot', 'ingredients');
export const GOLD_INGOT = item('gold_ingot', 'ingredients');
export const IRON_NUGGET = item('iron_nugget', 'ingredients');
export const GOLD_NUGGET = item('gold_nugget', 'ingredients');
export const DIAMOND = item('diamond', 'ingredients');
export const EMERALD = item('emerald', 'ingredients');
export const LAPIS_LAZULI = item('lapis_lazuli', 'ingredients');
export const REDSTONE = item('redstone', 'ingredients', { displayName: 'Redstone Dust' });
export const FLINT = item('flint', 'ingredients');
export const CLAY_BALL = item('clay_ball', 'ingredients');
export const BRICK = item('brick', 'ingredients');
export const GLOWSTONE_DUST = item('glowstone_dust', 'ingredients');
export const STRING = item('string', 'ingredients');
export const FEATHER = item('feather', 'ingredients');
export const LEATHER = item('leather', 'ingredients');
export const BONE = item('bone', 'ingredients');
export const BONE_MEAL = item('bone_meal', 'tools');
export const GUNPOWDER = item('gunpowder', 'ingredients');
export const PAPER = item('paper', 'ingredients');
export const BOOK = item('book', 'ingredients');
export const SUGAR = item('sugar', 'ingredients');
export const WHEAT_SEEDS = item('wheat_seeds', 'natural', { block: B.WHEAT_0 });
export const WHEAT = item('wheat', 'ingredients');
export const BOWL = item('bowl', 'ingredients', { fuel: 5 });
export const SNOWBALL = item('snowball', 'ingredients', { maxStack: 16 });
export const EGG = item('egg', 'ingredients', { maxStack: 16 });
export const INK_SAC = item('ink_sac', 'ingredients');
export const COCOA_BEANS = item('cocoa_beans', 'ingredients');
export const DYE_BY_COLOR = {} as Record<Color, number>;
for (const c of COLORS) DYE_BY_COLOR[c] = item(`${c}_dye`, 'ingredients');

export const APPLE = item('apple', 'food', { food: { hunger: 4, saturation: 2.4 } });
export const GOLDEN_APPLE = item('golden_apple', 'food', { food: { hunger: 4, saturation: 9.6, always: true, regen: 5 }, rarity: 2 });
export const BREAD = item('bread', 'food', { food: { hunger: 5, saturation: 6 } });
export const MUSHROOM_STEW = item('mushroom_stew', 'food', { maxStack: 1, food: { hunger: 6, saturation: 7.2 }, remainder: 0 });
export const COOKIE = item('cookie', 'food', { food: { hunger: 2, saturation: 0.4 } });
export const PUMPKIN_PIE = item('pumpkin_pie', 'food', { food: { hunger: 8, saturation: 4.8 } });
export const PORKCHOP = item('porkchop', 'food', { displayName: 'Raw Porkchop', food: { hunger: 3, saturation: 1.8 } });
export const COOKED_PORKCHOP = item('cooked_porkchop', 'food', { food: { hunger: 8, saturation: 12.8 } });
export const BEEF = item('beef', 'food', { displayName: 'Raw Beef', food: { hunger: 3, saturation: 1.8 } });
export const COOKED_BEEF = item('cooked_beef', 'food', { displayName: 'Steak', food: { hunger: 8, saturation: 12.8 } });
export const CHICKEN = item('chicken', 'food', { displayName: 'Raw Chicken', food: { hunger: 2, saturation: 1.2 } });
export const COOKED_CHICKEN = item('cooked_chicken', 'food', { food: { hunger: 6, saturation: 7.2 } });
export const COD = item('cod', 'food', { displayName: 'Raw Cod', food: { hunger: 2, saturation: 0.4 } });
export const COOKED_COD = item('cooked_cod', 'food', { food: { hunger: 5, saturation: 6 } });

/** Tool materials: harvest tier, mining speed, durability, sword damage. */
const TOOL_TIERS = {
  wooden: { tier: B.TIER_WOOD, speed: 2, durability: 59, damage: 4 },
  stone: { tier: B.TIER_STONE, speed: 4, durability: 131, damage: 5 },
  iron: { tier: B.TIER_IRON, speed: 6, durability: 250, damage: 6 },
  golden: { tier: B.TIER_WOOD, speed: 12, durability: 32, damage: 4 },
  diamond: { tier: B.TIER_DIAMOND, speed: 8, durability: 1561, damage: 7 },
};
const TOOL_DAMAGE_OFFSET: Record<string, number> = { pickaxe: -2, axe: 3, shovel: -1.5, hoe: -3, sword: 0 };
export const TOOLS: Record<string, number> = {};
for (const [mat, t] of Object.entries(TOOL_TIERS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'] as const) {
    const name = `${mat}_${type}`;
    TOOLS[name] = item(name, type === 'sword' ? 'combat' : 'tools', {
      durability: t.durability,
      tool: { type, tier: t.tier, speed: type === 'sword' ? 1 : t.speed, damage: Math.max(1, t.damage + TOOL_DAMAGE_OFFSET[type]) },
      fuel: mat === 'wooden' ? 10 : 0,
    });
  }
}

export const SHEARS = item('shears', 'tools', { durability: 238, tool: { type: 'shears', tier: 0, speed: 1, damage: 1 } });
export const FLINT_AND_STEEL = item('flint_and_steel', 'tools', { displayName: 'Flint and Steel', durability: 64 });
export const BUCKET = item('bucket', 'tools', { maxStack: 16 });
export const WATER_BUCKET = item('water_bucket', 'tools', { maxStack: 1, block: B.WATER, remainder: 0 });
export const LAVA_BUCKET = item('lava_bucket', 'tools', { maxStack: 1, block: B.LAVA, fuel: 1000, remainder: 0 });
export const COMPASS = item('compass', 'tools');
export const CLOCK = item('clock', 'tools');

/** Armor: defense per slot (helmet, chestplate, leggings, boots), toughness, durability multiplier. */
const ARMOR_MATS = {
  leather: { defense: [1, 3, 2, 1], toughness: 0, dur: 5, names: ['Leather Cap', 'Leather Tunic', 'Leather Pants', 'Leather Boots'] },
  chainmail: { defense: [2, 5, 4, 1], toughness: 0, dur: 15, names: null },
  iron: { defense: [2, 6, 5, 2], toughness: 0, dur: 15, names: null },
  golden: { defense: [2, 5, 3, 1], toughness: 0, dur: 7, names: null },
  diamond: { defense: [3, 8, 6, 3], toughness: 2, dur: 33, names: null },
};
const ARMOR_BASE_DURABILITY = [11, 16, 15, 13];
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
export const ARMOR: Record<string, number> = {};
for (const [mat, a] of Object.entries(ARMOR_MATS)) {
  ARMOR_PIECES.forEach((piece, slot) => {
    const name = `${mat}_${piece}`;
    ARMOR[name] = item(name, 'combat', {
      displayName: a.names?.[slot],
      durability: ARMOR_BASE_DURABILITY[slot] * a.dur,
      armor: { slot, defense: a.defense[slot], toughness: a.toughness },
    });
  });
}
// Buckets hold their contents' remainder.
ITEMS[WATER_BUCKET].remainder = BUCKET;
ITEMS[LAVA_BUCKET].remainder = BUCKET;
ITEMS[MUSHROOM_STEW].remainder = BOWL;

export const ITEM_COUNT = nextId;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function itemDef(id: number): ItemDef | undefined {
  return ITEMS[id];
}

export function itemByName(name: string): ItemDef | undefined {
  return byName.get(name);
}

/** Item id by name; throws for unknown names (catches typos in recipe tables at startup). */
export function itemId(name: string): number {
  const d = byName.get(name);
  if (!d) throw new Error(`Unknown item ${name}`);
  return d.id;
}

export function maxStack(id: number): number {
  return ITEMS[id]?.maxStack ?? 64;
}

export function isValidItem(id: number): boolean {
  return Number.isInteger(id) && id > 0 && !!ITEMS[id];
}

export function stackable(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0) && maxStack(a.id) > 1;
}

export function copyStack(s: ItemStack, count = s.count): ItemStack {
  return s.damage ? { id: s.id, count, damage: s.damage } : { id: s.id, count };
}

/** Starting hotbar in creative mode. */
export const DEFAULT_HOTBAR = [
  B.GRASS, B.STONE_BRICKS, B.OAK_PLANKS, B.OAK_LOG, B.GLASS, B.TORCH, B.GLOWSTONE, WATER_BUCKET, B.GOLD_BLOCK,
];

/** Items per creative tab, in display order. */
export const CREATIVE_TABS: Record<Category, number[]> = {
  building: [], colored: [], natural: [], functional: [], tools: [], combat: [], food: [], ingredients: [],
};
{
  // Blocks keep the curated order they were categorised in; items follow registry order.
  const order = new Map<number, number>();
  let k = 0;
  for (const name of Object.keys(BLOCK_CATEGORY)) order.set(byName.get(name)!.id, k++);
  const all = ITEMS.filter((d) => d && d.category);
  all.sort((a, b) => (order.get(a.id) ?? 1e6 + a.id) - (order.get(b.id) ?? 1e6 + b.id));
  for (const d of all) CREATIVE_TABS[d.category!].push(d.id);
  // Tools: group by kind (pickaxes, axes, shovels, hoes) rather than by material.
  const toolKind = (d: ItemDef) => ['pickaxe', 'axe', 'shovel', 'hoe'].indexOf(d.tool?.type ?? '');
  CREATIVE_TABS.tools.sort((a, b) => {
    const ka = toolKind(ITEMS[a]), kb = toolKind(ITEMS[b]);
    if (ka !== kb) return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
    return a - b;
  });
}
