import { TextureName, textureLayer, COLORS, Color } from './textureNames';

/**
 * Block shapes. BOX blocks render (and collide / get selected) as the axis-aligned box from
 * their `box` field — slabs and lanterns.
 */
export const enum Shape { NONE = 0, CUBE = 1, CROSS = 2, LIQUID = 3, TORCH = 4, CACTUS = 5, BOX = 6 }
export const enum RenderLayer { OPAQUE = 0, CUTOUT = 1, TRANSLUCENT = 2 }
/** Tint sources. Must match the shader's tint decoding. */
export const enum Tint { NONE = 0, GRASS = 1, FOLIAGE = 2, BIRCH = 3, SPRUCE = 4 }
export const enum Waving { NONE = 0, LEAVES = 1, PLANT = 2 }

export type SoundType =
  | 'stone' | 'grass' | 'dirt' | 'wood' | 'sand' | 'gravel' | 'glass' | 'wool' | 'snow' | 'plant' | 'metal';

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';

/** Tool tiers (harvest levels): wood and gold 0, stone 1, iron 2, diamond 3. */
export const TIER_WOOD = 0, TIER_STONE = 1, TIER_IRON = 2, TIER_DIAMOND = 3;

export interface BlockDef {
  id: number;
  name: string;
  displayName: string;
  shape: Shape;
  layer: RenderLayer;
  /** Collides with the player. */
  solid: boolean;
  /** Full opaque cube: hides neighbour faces, casts AO, blocks all light. */
  opaque: boolean;
  /** How much light is lost passing through (0..15). */
  lightOpacity: number;
  /** Light emitted (0..15). */
  emission: number;
  /** Texture layer per face: +X, -X, +Y, -Y, +Z, -Z. */
  faces: number[];
  tint: Tint;
  waving: Waving;
  cullSame: boolean;
  replaceable: boolean;
  /** Minecraft hardness (break time scale). 0 breaks instantly, Infinity never. */
  hardness: number;
  sound: SoundType;
  /** Shade with an up-facing normal (plants). */
  upNormal: boolean;
  /** Has an item form (shown in the creative inventory / can be held). */
  inInventory: boolean;
  liquid: boolean;
  /** Breaks when the block underneath is removed. */
  needsSupport: boolean;
  /** Falls when unsupported (sand, gravel). */
  gravity: boolean;
  /** Tool that mines this block quickly. */
  tool: ToolType | null;
  /** Drops nothing unless mined with `tool` of at least tier `harvest`. */
  requiresTool: boolean;
  harvest: number;
  /** Selection / collision box in 1/16 block units: x0 y0 z0 x1 y1 z1. */
  box: number[];
  /** Blocks light but is rendered with its neighbours' light (slabs). */
  neighborLight: boolean;
}

interface BlockSpec {
  name: string;
  displayName?: string;
  shape?: Shape;
  layer?: RenderLayer;
  solid?: boolean;
  opaque?: boolean;
  lightOpacity?: number;
  emission?: number;
  tex?: TextureName;
  top?: TextureName;
  bottom?: TextureName;
  side?: TextureName;
  front?: TextureName; // -Z / north face
  tint?: Tint;
  waving?: Waving;
  cullSame?: boolean;
  replaceable?: boolean;
  hardness?: number;
  sound?: SoundType;
  upNormal?: boolean;
  inInventory?: boolean;
  liquid?: boolean;
  needsSupport?: boolean;
  gravity?: boolean;
  tool?: ToolType;
  requiresTool?: boolean;
  harvest?: number;
  box?: number[];
  neighborLight?: boolean;
}

function titleCase(name: string): string {
  return name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export const BLOCKS: BlockDef[] = [];
const byName = new Map<string, BlockDef>();
const FULL_BOX = [0, 0, 0, 16, 16, 16];

function def(id: number, s: BlockSpec): number {
  const shape = s.shape ?? Shape.CUBE;
  const layer = s.layer ?? RenderLayer.OPAQUE;
  const opaque = s.opaque ?? (shape === Shape.CUBE && layer === RenderLayer.OPAQUE);
  const side = s.side ?? s.tex ?? (s.name as TextureName);
  const top = s.top ?? s.tex ?? side;
  const bottom = s.bottom ?? s.top ?? s.tex ?? side;
  const front = s.front ?? side;
  const L = (n: TextureName) => textureLayer(n);
  if (BLOCKS[id]) throw new Error(`Block id ${id} used twice`);
  const b: BlockDef = {
    id,
    name: s.name,
    displayName: s.displayName ?? titleCase(s.name),
    shape,
    layer,
    solid: s.solid ?? (shape === Shape.CUBE || shape === Shape.CACTUS || shape === Shape.BOX),
    opaque,
    lightOpacity: s.lightOpacity ?? (opaque ? 15 : 0),
    emission: s.emission ?? 0,
    faces: [L(side), L(side), L(top), L(bottom), L(side), L(front)],
    tint: s.tint ?? Tint.NONE,
    waving: s.waving ?? Waving.NONE,
    cullSame: s.cullSame ?? false,
    replaceable: s.replaceable ?? false,
    hardness: s.hardness ?? 1.5,
    sound: s.sound ?? 'stone',
    upNormal: s.upNormal ?? false,
    inInventory: s.inInventory ?? true,
    liquid: s.liquid ?? false,
    needsSupport: s.needsSupport ?? false,
    gravity: s.gravity ?? false,
    tool: s.tool ?? null,
    requiresTool: s.requiresTool ?? false,
    harvest: s.harvest ?? 0,
    box: s.box ?? FULL_BOX,
    neighborLight: s.neighborLight ?? false,
  };
  BLOCKS[id] = b;
  byName.set(b.name, b);
  return id;
}

const PLANT = {
  shape: Shape.CROSS,
  layer: RenderLayer.CUTOUT,
  solid: false,
  replaceable: true,
  hardness: 0,
  sound: 'plant' as SoundType,
  waving: Waving.PLANT,
  upNormal: true,
  needsSupport: true,
  box: [2, 0, 2, 14, 13, 14],
};

/** Stone-like blocks: need a pickaxe to drop anything. */
const ROCK = { tool: 'pickaxe' as ToolType, requiresTool: true };
const WOOD = { tool: 'axe' as ToolType, sound: 'wood' as SoundType, hardness: 2 };
const SOIL = { tool: 'shovel' as ToolType };
const LEAVES = { layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 1, waving: Waving.LEAVES, cullSame: true, hardness: 0.2, sound: 'plant' as SoundType, tool: 'hoe' as ToolType };
const WOOL = { hardness: 0.8, sound: 'wool' as SoundType, tool: 'shears' as ToolType };

// ---- Block table (ids are stable: they are written to save files) ----
export const AIR = def(0, { name: 'air', shape: Shape.NONE, solid: false, opaque: false, lightOpacity: 0, replaceable: true, inInventory: false, tex: 'stone', hardness: 0 });
export const STONE = def(1, { name: 'stone', hardness: 1.5, ...ROCK });
export const GRASS = def(2, { name: 'grass_block', top: 'grass_top', side: 'grass_side', bottom: 'dirt', tint: Tint.GRASS, hardness: 0.6, sound: 'grass', ...SOIL });
export const DIRT = def(3, { name: 'dirt', hardness: 0.5, sound: 'dirt', ...SOIL });
export const COBBLESTONE = def(4, { name: 'cobblestone', hardness: 2, ...ROCK });
export const OAK_PLANKS = def(5, { name: 'oak_planks', ...WOOD });
export const BEDROCK = def(6, { name: 'bedrock', hardness: Infinity, inInventory: false });
export const SAND = def(7, { name: 'sand', hardness: 0.5, sound: 'sand', gravity: true, ...SOIL });
export const GRAVEL = def(8, { name: 'gravel', hardness: 0.6, sound: 'gravel', gravity: true, ...SOIL });
export const OAK_LOG = def(9, { name: 'oak_log', side: 'oak_log', top: 'oak_log_top', ...WOOD });
export const OAK_LEAVES = def(10, { name: 'oak_leaves', tint: Tint.FOLIAGE, ...LEAVES });
export const GLASS = def(11, { name: 'glass', layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 0, cullSame: true, hardness: 0.3, sound: 'glass' });
export const WATER = def(12, { name: 'water', shape: Shape.LIQUID, layer: RenderLayer.TRANSLUCENT, solid: false, opaque: false, lightOpacity: 1, cullSame: true, replaceable: true, liquid: true, hardness: Infinity, inInventory: true, sound: 'plant' });
export const COAL_ORE = def(13, { name: 'coal_ore', hardness: 3, ...ROCK });
export const IRON_ORE = def(14, { name: 'iron_ore', hardness: 3, ...ROCK, harvest: TIER_STONE });
export const GOLD_ORE = def(15, { name: 'gold_ore', hardness: 3, ...ROCK, harvest: TIER_IRON });
export const DIAMOND_ORE = def(16, { name: 'diamond_ore', hardness: 3, ...ROCK, harvest: TIER_IRON });
export const REDSTONE_ORE = def(17, { name: 'redstone_ore', hardness: 3, ...ROCK, harvest: TIER_IRON });
export const LAPIS_ORE = def(18, { name: 'lapis_ore', hardness: 3, ...ROCK, harvest: TIER_STONE });
export const EMERALD_ORE = def(19, { name: 'emerald_ore', hardness: 3, ...ROCK, harvest: TIER_IRON });
export const SANDSTONE = def(20, { name: 'sandstone', side: 'sandstone_side', top: 'sandstone_top', bottom: 'sandstone_bottom', hardness: 0.8, ...ROCK });
export const BIRCH_LOG = def(21, { name: 'birch_log', side: 'birch_log', top: 'birch_log_top', ...WOOD });
export const BIRCH_LEAVES = def(22, { name: 'birch_leaves', tint: Tint.BIRCH, ...LEAVES });
export const SPRUCE_LOG = def(23, { name: 'spruce_log', side: 'spruce_log', top: 'spruce_log_top', ...WOOD });
export const SPRUCE_LEAVES = def(24, { name: 'spruce_leaves', tint: Tint.SPRUCE, ...LEAVES });
export const BIRCH_PLANKS = def(25, { name: 'birch_planks', ...WOOD });
export const SPRUCE_PLANKS = def(26, { name: 'spruce_planks', ...WOOD });
export const SNOW = def(27, { name: 'snow', displayName: 'Snow Block', hardness: 0.2, sound: 'snow', ...SOIL, requiresTool: true });
export const SNOWY_GRASS = def(28, { name: 'snowy_grass_block', displayName: 'Snowy Grass', top: 'snow', side: 'grass_side_snowy', bottom: 'dirt', hardness: 0.6, sound: 'snow', ...SOIL });
export const ICE = def(29, { name: 'ice', layer: RenderLayer.TRANSLUCENT, opaque: false, lightOpacity: 1, cullSame: true, hardness: 0.5, sound: 'glass', tool: 'pickaxe' });
export const CLAY = def(30, { name: 'clay', hardness: 0.6, sound: 'dirt', ...SOIL });
export const BRICKS = def(31, { name: 'bricks', hardness: 2, ...ROCK });
export const STONE_BRICKS = def(32, { name: 'stone_bricks', hardness: 1.5, ...ROCK });
export const MOSSY_COBBLESTONE = def(33, { name: 'mossy_cobblestone', hardness: 2, ...ROCK });
export const BOOKSHELF = def(34, { name: 'bookshelf', side: 'bookshelf', top: 'oak_planks', ...WOOD, hardness: 1.5 });
export const CRAFTING_TABLE = def(35, { name: 'crafting_table', side: 'crafting_table_side', front: 'crafting_table_front', top: 'crafting_table_top', bottom: 'oak_planks', ...WOOD, hardness: 2.5 });
export const FURNACE = def(36, { name: 'furnace', side: 'furnace_side', front: 'furnace_front', top: 'furnace_top', hardness: 3.5, ...ROCK });
export const GLOWSTONE = def(37, { name: 'glowstone', emission: 15, hardness: 0.3, sound: 'glass' });
export const SEA_LANTERN = def(38, { name: 'sea_lantern', emission: 15, hardness: 0.3, sound: 'glass' });
export const OBSIDIAN = def(39, { name: 'obsidian', hardness: 50, ...ROCK, harvest: TIER_DIAMOND });
export const IRON_BLOCK = def(40, { name: 'iron_block', displayName: 'Block of Iron', hardness: 5, sound: 'metal', ...ROCK, harvest: TIER_STONE });
export const GOLD_BLOCK = def(41, { name: 'gold_block', displayName: 'Block of Gold', hardness: 3, sound: 'metal', ...ROCK, harvest: TIER_IRON });
export const DIAMOND_BLOCK = def(42, { name: 'diamond_block', displayName: 'Block of Diamond', hardness: 5, sound: 'metal', ...ROCK, harvest: TIER_IRON });
export const EMERALD_BLOCK = def(43, { name: 'emerald_block', displayName: 'Block of Emerald', hardness: 5, sound: 'metal', ...ROCK, harvest: TIER_IRON });
export const WHITE_WOOL = def(44, { name: 'white_wool', ...WOOL });
export const RED_WOOL = def(45, { name: 'red_wool', ...WOOL });
export const ORANGE_WOOL = def(46, { name: 'orange_wool', ...WOOL });
export const YELLOW_WOOL = def(47, { name: 'yellow_wool', ...WOOL });
export const LIME_WOOL = def(48, { name: 'lime_wool', ...WOOL });
export const LIGHT_BLUE_WOOL = def(49, { name: 'light_blue_wool', ...WOOL });
export const BLUE_WOOL = def(50, { name: 'blue_wool', ...WOOL });
export const PURPLE_WOOL = def(51, { name: 'purple_wool', ...WOOL });
export const BLACK_WOOL = def(52, { name: 'black_wool', ...WOOL });
export const TNT = def(53, { name: 'tnt', displayName: 'TNT', side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom', hardness: 0, sound: 'plant' });
export const PUMPKIN = def(54, { name: 'pumpkin', side: 'pumpkin_side', top: 'pumpkin_top', ...WOOD, hardness: 1 });
export const JACK_O_LANTERN = def(55, { name: 'jack_o_lantern', displayName: "Jack o'Lantern", side: 'pumpkin_side', front: 'jack_o_lantern', top: 'pumpkin_top', emission: 15, ...WOOD, hardness: 1 });
export const LAVA = def(56, { name: 'lava', shape: Shape.LIQUID, layer: RenderLayer.OPAQUE, solid: false, opaque: false, lightOpacity: 15, emission: 15, cullSame: true, replaceable: true, liquid: true, hardness: Infinity, sound: 'plant' });
export const TORCH = def(57, { name: 'torch', shape: Shape.TORCH, layer: RenderLayer.CUTOUT, solid: false, opaque: false, lightOpacity: 0, emission: 14, hardness: 0, sound: 'wood', needsSupport: true, box: [6, 0, 6, 10, 10, 10] });
export const TALL_GRASS = def(58, { name: 'tall_grass', displayName: 'Grass', ...PLANT, tex: 'tall_grass', tint: Tint.GRASS });
export const FERN = def(59, { name: 'fern', ...PLANT, tex: 'fern', tint: Tint.GRASS });
export const DANDELION = def(60, { name: 'dandelion', ...PLANT, tex: 'dandelion', box: [5, 0, 5, 11, 10, 11] });
export const POPPY = def(61, { name: 'poppy', ...PLANT, tex: 'poppy', box: [5, 0, 5, 11, 10, 11] });
export const BLUE_ORCHID = def(62, { name: 'blue_orchid', ...PLANT, tex: 'blue_orchid', box: [5, 0, 5, 11, 10, 11] });
export const ALLIUM = def(63, { name: 'allium', ...PLANT, tex: 'allium', box: [5, 0, 5, 11, 10, 11] });
export const OXEYE_DAISY = def(64, { name: 'oxeye_daisy', ...PLANT, tex: 'oxeye_daisy', box: [5, 0, 5, 11, 10, 11] });
export const CORNFLOWER = def(65, { name: 'cornflower', ...PLANT, tex: 'cornflower', box: [5, 0, 5, 11, 10, 11] });
export const DEAD_BUSH = def(66, { name: 'dead_bush', ...PLANT, tex: 'dead_bush' });
export const CACTUS = def(67, { name: 'cactus', shape: Shape.CACTUS, layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 0, side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_bottom', hardness: 0.4, sound: 'wool', needsSupport: true, box: [1, 0, 1, 15, 16, 15] });
export const SUGAR_CANE = def(68, { name: 'sugar_cane', ...PLANT, tex: 'sugar_cane', waving: Waving.NONE, replaceable: false, box: [2, 0, 2, 14, 16, 14] });
export const RED_MUSHROOM = def(69, { name: 'red_mushroom', ...PLANT, tex: 'red_mushroom', waving: Waving.NONE, box: [5, 0, 5, 11, 6, 11] });
export const BROWN_MUSHROOM = def(70, { name: 'brown_mushroom', ...PLANT, tex: 'brown_mushroom', waving: Waving.NONE, box: [5, 0, 5, 11, 6, 11] });

// ---- Crafting-era blocks ----
export const CHEST = def(71, { name: 'chest', side: 'chest_side', front: 'chest_front', top: 'chest_top', ...WOOD, hardness: 2.5 });
export const LIT_FURNACE = def(72, { name: 'lit_furnace', displayName: 'Furnace', side: 'furnace_side', front: 'furnace_front_on', top: 'furnace_top', emission: 13, hardness: 3.5, ...ROCK, inInventory: false });
export const COAL_BLOCK = def(73, { name: 'coal_block', displayName: 'Block of Coal', hardness: 5, ...ROCK });
export const LAPIS_BLOCK = def(74, { name: 'lapis_block', displayName: 'Block of Lapis Lazuli', hardness: 3, ...ROCK, harvest: TIER_STONE });
export const REDSTONE_BLOCK = def(75, { name: 'redstone_block', displayName: 'Block of Redstone', hardness: 5, sound: 'metal', ...ROCK });
export const SMOOTH_STONE = def(76, { name: 'smooth_stone', hardness: 2, ...ROCK });
export const MOSSY_STONE_BRICKS = def(77, { name: 'mossy_stone_bricks', hardness: 1.5, ...ROCK });
export const CRACKED_STONE_BRICKS = def(78, { name: 'cracked_stone_bricks', hardness: 1.5, ...ROCK });
export const CHISELED_STONE_BRICKS = def(79, { name: 'chiseled_stone_bricks', hardness: 1.5, ...ROCK });
export const CUT_SANDSTONE = def(80, { name: 'cut_sandstone', side: 'cut_sandstone', top: 'sandstone_top', bottom: 'sandstone_top', hardness: 0.8, ...ROCK });
export const SMOOTH_SANDSTONE = def(81, { name: 'smooth_sandstone', tex: 'sandstone_top', hardness: 2, ...ROCK });
export const CHISELED_SANDSTONE = def(82, { name: 'chiseled_sandstone', side: 'chiseled_sandstone', top: 'sandstone_top', bottom: 'sandstone_top', hardness: 0.8, ...ROCK });
export const TERRACOTTA = def(83, { name: 'terracotta', hardness: 1.25, ...ROCK });
export const HAY_BLOCK = def(84, { name: 'hay_block', displayName: 'Hay Bale', side: 'hay_block_side', top: 'hay_block_top', hardness: 0.5, sound: 'grass', tool: 'hoe' });
export const FARMLAND = def(85, { name: 'farmland', top: 'farmland', side: 'dirt', hardness: 0.6, sound: 'dirt', tool: 'shovel', inInventory: false });
/** Wheat crop growth stages 0..7 (ids 86..93). */
export const WHEAT_0 = 86;
for (let age = 0; age < 8; age++) {
  def(WHEAT_0 + age, {
    name: `wheat_${age}`, displayName: 'Wheat Crops', ...PLANT, tex: `wheat_${age}` as TextureName, replaceable: false,
    inInventory: false, box: [0, 0, 0, 16, 2 * (age + 1), 16],
  });
}
export const WHEAT_RIPE = WHEAT_0 + 7;
export const OAK_SAPLING = def(94, { name: 'oak_sapling', ...PLANT, tex: 'oak_sapling', replaceable: false, box: [2, 0, 2, 14, 12, 14] });
export const BIRCH_SAPLING = def(95, { name: 'birch_sapling', ...PLANT, tex: 'birch_sapling', replaceable: false, box: [2, 0, 2, 14, 12, 14] });
export const SPRUCE_SAPLING = def(96, { name: 'spruce_sapling', ...PLANT, tex: 'spruce_sapling', replaceable: false, box: [2, 0, 2, 14, 12, 14] });
export const GRANITE = def(97, { name: 'granite', hardness: 1.5, ...ROCK });
export const POLISHED_GRANITE = def(98, { name: 'polished_granite', hardness: 1.5, ...ROCK });
export const DIORITE = def(99, { name: 'diorite', hardness: 1.5, ...ROCK });
export const POLISHED_DIORITE = def(100, { name: 'polished_diorite', hardness: 1.5, ...ROCK });
export const ANDESITE = def(101, { name: 'andesite', hardness: 1.5, ...ROCK });
export const POLISHED_ANDESITE = def(102, { name: 'polished_andesite', hardness: 1.5, ...ROCK });
export const LANTERN = def(103, {
  name: 'lantern', top: 'lantern_top', shape: Shape.BOX, layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 0, emission: 15,
  hardness: 3.5, sound: 'metal', ...ROCK, needsSupport: true, box: [5, 0, 5, 11, 9, 11],
});
export const COBWEB = def(104, { name: 'cobweb', ...PLANT, waving: Waving.NONE, upNormal: false, tex: 'cobweb', replaceable: false, needsSupport: false, hardness: 4, tool: 'sword', requiresTool: true, box: [0, 0, 0, 16, 16, 16], sound: 'wool' });
export const BARREL = def(105, { name: 'barrel', side: 'barrel_side', top: 'barrel_top', bottom: 'barrel_bottom', ...WOOD, hardness: 2.5 });
export const BONE_BLOCK = def(106, { name: 'bone_block', side: 'bone_block_side', top: 'bone_block_top', hardness: 2, ...ROCK });

/** Wool / stained glass / terracotta / concrete by colour. */
export const WOOL_BY_COLOR = {} as Record<Color, number>;
export const GLASS_BY_COLOR = {} as Record<Color, number>;
export const TERRACOTTA_BY_COLOR = {} as Record<Color, number>;
export const CONCRETE_BY_COLOR = {} as Record<Color, number>;
export const POWDER_BY_COLOR = {} as Record<Color, number>;
/** Concrete powder id → the concrete it hardens into when touching water. */
export const POWDER_TO_CONCRETE = new Uint8Array(256);
Object.assign(WOOL_BY_COLOR, {
  white: WHITE_WOOL, red: RED_WOOL, orange: ORANGE_WOOL, yellow: YELLOW_WOOL, lime: LIME_WOOL,
  light_blue: LIGHT_BLUE_WOOL, blue: BLUE_WOOL, purple: PURPLE_WOOL, black: BLACK_WOOL,
});
(['light_gray', 'gray', 'brown', 'green', 'cyan', 'magenta', 'pink'] as const).forEach((c, i) => {
  WOOL_BY_COLOR[c] = def(107 + i, { name: `${c}_wool`, ...WOOL });
});
COLORS.forEach((c, i) => {
  GLASS_BY_COLOR[c] = def(114 + i, {
    name: `${c}_stained_glass`, layer: RenderLayer.TRANSLUCENT, opaque: false, lightOpacity: 0, cullSame: true,
    hardness: 0.3, sound: 'glass',
  });
  TERRACOTTA_BY_COLOR[c] = def(130 + i, { name: `${c}_terracotta`, hardness: 1.25, ...ROCK });
  CONCRETE_BY_COLOR[c] = def(146 + i, { name: `${c}_concrete`, hardness: 1.8, ...ROCK });
  POWDER_BY_COLOR[c] = def(162 + i, { name: `${c}_concrete_powder`, hardness: 0.5, sound: 'sand', gravity: true, ...SOIL });
  POWDER_TO_CONCRETE[POWDER_BY_COLOR[c]] = CONCRETE_BY_COLOR[c];
});

/** Slabs: [bottom, top] ids per material (178..195). A second slab of the same kind makes `full`. */
interface SlabKind { name: string; full: number; tex?: TextureName; top?: TextureName; side?: TextureName; bottom?: TextureName; wood?: boolean; hardness: number }
const SLAB_KINDS: SlabKind[] = [
  { name: 'oak_slab', full: OAK_PLANKS, tex: 'oak_planks', wood: true, hardness: 2 },
  { name: 'birch_slab', full: BIRCH_PLANKS, tex: 'birch_planks', wood: true, hardness: 2 },
  { name: 'spruce_slab', full: SPRUCE_PLANKS, tex: 'spruce_planks', wood: true, hardness: 2 },
  { name: 'stone_slab', full: STONE, tex: 'stone', hardness: 2 },
  { name: 'smooth_stone_slab', full: SMOOTH_STONE, top: 'smooth_stone', side: 'smooth_stone_slab_side', hardness: 2 },
  { name: 'cobblestone_slab', full: COBBLESTONE, tex: 'cobblestone', hardness: 2 },
  { name: 'stone_brick_slab', full: STONE_BRICKS, tex: 'stone_bricks', hardness: 2 },
  { name: 'brick_slab', full: BRICKS, tex: 'bricks', hardness: 2 },
  { name: 'sandstone_slab', full: SANDSTONE, top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_bottom', hardness: 2 },
];
export const SLAB_IDS: Record<string, [number, number]> = {};
/** For every slab id: the bottom-slab id (its item), the other half, and the full block two slabs make. */
export const SLAB_BASE = new Uint8Array(256);
export const SLAB_OTHER = new Uint8Array(256);
export const SLAB_FULL = new Uint8Array(256);
export const IS_TOP_SLAB = new Uint8Array(256);
SLAB_KINDS.forEach((k, i) => {
  const bottomId = 178 + i * 2, topId = bottomId + 1;
  const base = {
    tex: k.tex, top: k.top, side: k.side, bottom: k.bottom, hardness: k.hardness, shape: Shape.BOX, layer: RenderLayer.OPAQUE,
    opaque: false, lightOpacity: 15, neighborLight: true,
    ...(k.wood ? { tool: 'axe' as ToolType, sound: 'wood' as SoundType } : ROCK),
  };
  def(bottomId, { name: k.name, ...base, box: [0, 0, 0, 16, 8, 16] });
  def(topId, { name: `${k.name}_top`, displayName: titleCase(k.name), ...base, box: [0, 8, 0, 16, 16, 16], inInventory: false });
  SLAB_IDS[k.name] = [bottomId, topId];
  for (const id of [bottomId, topId]) { SLAB_BASE[id] = bottomId; SLAB_FULL[id] = k.full; }
  SLAB_OTHER[bottomId] = topId; SLAB_OTHER[topId] = bottomId;
  IS_TOP_SLAB[topId] = 1;
});

/**
 * Blocks with a front face get three extra ids so the front can face the player: variants per
 * base block in the order [north (the base id), east, south, west]. Ids 196..207.
 */
export const FACING: Record<number, number[]> = {};
/** Any orientable block or variant → its north-facing base block (0 for other blocks). */
export const FACING_BASE = new Uint8Array(256);
function facingVariants(base: number, firstId: number) {
  const b = BLOCKS[base];
  const side = b.faces[0], front = b.faces[5], top = b.faces[2], bottom = b.faces[3];
  const layouts: Record<string, number[]> = {
    east: [front, side, top, bottom, side, side],
    south: [side, side, top, bottom, front, side],
    west: [side, front, top, bottom, side, side],
  };
  FACING[base] = [base];
  FACING_BASE[base] = base;
  ['east', 'south', 'west'].forEach((dir, k) => {
    const id = firstId + k;
    if (BLOCKS[id]) throw new Error(`Block id ${id} used twice`);
    const v: BlockDef = { ...b, id, name: `${b.name}_${dir}`, faces: layouts[dir], inInventory: false };
    BLOCKS[id] = v;
    byName.set(v.name, v);
    FACING[base].push(id);
    FACING_BASE[id] = base;
  });
}
facingVariants(FURNACE, 196);
facingVariants(LIT_FURNACE, 199);
facingVariants(CHEST, 202);
facingVariants(JACK_O_LANTERN, 205);

/** The north-facing base of an orientable block (or the block itself). */
export function baseBlock(id: number): number {
  return FACING_BASE[id] || id;
}

/** Facing index of a block: 0 north, 1 east, 2 south, 3 west. */
export function facingOf(id: number): number {
  const base = FACING_BASE[id];
  return base ? FACING[base].indexOf(id) : 0;
}

export const BLOCK_COUNT = BLOCKS.length;

// ---- Flat lookup tables for hot loops (meshing, physics, lighting) ----
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256);
export const EMISSION = new Uint8Array(256);
export const SHAPE = new Uint8Array(256);
export const LAYER = new Uint8Array(256);
export const TINT = new Uint8Array(256);
export const WAVING = new Uint8Array(256);
export const CULL_SAME = new Uint8Array(256);
export const UP_NORMAL = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
export const NEIGHBOR_LIGHT = new Uint8Array(256);
export const FACE_TEX = new Uint16Array(256 * 6);
/** Box per block in 1/16 units (x0 y0 z0 x1 y1 z1), and whether it is the full cube. */
export const BOX = new Uint8Array(256 * 6);
export const FULL_CUBE = new Uint8Array(256);

for (const b of BLOCKS) {
  if (!b) continue;
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  EMISSION[b.id] = b.emission;
  SHAPE[b.id] = b.shape;
  LAYER[b.id] = b.layer;
  TINT[b.id] = b.tint;
  WAVING[b.id] = b.waving;
  CULL_SAME[b.id] = b.cullSame ? 1 : 0;
  UP_NORMAL[b.id] = b.upNormal ? 1 : 0;
  IS_LIQUID[b.id] = b.liquid ? 1 : 0;
  NEIGHBOR_LIGHT[b.id] = b.neighborLight ? 1 : 0;
  for (let f = 0; f < 6; f++) FACE_TEX[b.id * 6 + f] = b.faces[f];
  for (let k = 0; k < 6; k++) BOX[b.id * 6 + k] = b.box[k];
  FULL_CUBE[b.id] = b.box.every((v, k) => v === FULL_BOX[k]) ? 1 : 0;
}

export function blockByName(name: string): BlockDef | undefined {
  return byName.get(name);
}

export function isFlower(id: number): boolean {
  return id >= DANDELION && id <= CORNFLOWER;
}

export function isSapling(id: number): boolean {
  return id === OAK_SAPLING || id === BIRCH_SAPLING || id === SPRUCE_SAPLING;
}

export function isCrop(id: number): boolean {
  return id >= WHEAT_0 && id <= WHEAT_RIPE;
}

export function isLeaves(id: number): boolean {
  return id === OAK_LEAVES || id === BIRCH_LEAVES || id === SPRUCE_LEAVES;
}

/** Soil that plants (flowers, saplings, grass) can be placed on. */
export function isPlantSoil(id: number): boolean {
  return id === GRASS || id === DIRT || id === SNOWY_GRASS || id === FARMLAND;
}
