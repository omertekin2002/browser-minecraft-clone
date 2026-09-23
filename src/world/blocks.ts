import { TextureName, textureLayer } from './textureNames';

export const enum Shape { NONE = 0, CUBE = 1, CROSS = 2, LIQUID = 3, TORCH = 4, CACTUS = 5 }
export const enum RenderLayer { OPAQUE = 0, CUTOUT = 1, TRANSLUCENT = 2 }
/** Tint sources. Must match the shader's tint decoding. */
export const enum Tint { NONE = 0, GRASS = 1, FOLIAGE = 2, BIRCH = 3, SPRUCE = 4 }
export const enum Waving { NONE = 0, LEAVES = 1, PLANT = 2 }

export type SoundType =
  | 'stone' | 'grass' | 'dirt' | 'wood' | 'sand' | 'gravel' | 'glass' | 'wool' | 'snow' | 'plant' | 'metal';

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
  hardness: number;
  sound: SoundType;
  /** Shade with an up-facing normal (plants). */
  upNormal: boolean;
  inInventory: boolean;
  liquid: boolean;
  /** Breaks when the block underneath is removed. */
  needsSupport: boolean;
  /** Falls when unsupported (sand, gravel). */
  gravity: boolean;
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
}

function titleCase(name: string): string {
  return name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export const BLOCKS: BlockDef[] = [];
const byName = new Map<string, BlockDef>();

function def(id: number, s: BlockSpec): number {
  const shape = s.shape ?? Shape.CUBE;
  const layer = s.layer ?? RenderLayer.OPAQUE;
  const opaque = s.opaque ?? (shape === Shape.CUBE && layer === RenderLayer.OPAQUE);
  const side = s.side ?? s.tex ?? (s.name as TextureName);
  const top = s.top ?? s.tex ?? side;
  const bottom = s.bottom ?? s.top ?? s.tex ?? side;
  const front = s.front ?? side;
  const L = (n: TextureName) => textureLayer(n);
  const b: BlockDef = {
    id,
    name: s.name,
    displayName: s.displayName ?? titleCase(s.name),
    shape,
    layer,
    solid: s.solid ?? (shape === Shape.CUBE || shape === Shape.CACTUS),
    opaque,
    lightOpacity: s.lightOpacity ?? (opaque ? 15 : 0),
    emission: s.emission ?? 0,
    faces: [L(side), L(side), L(top), L(bottom), L(side), L(front)],
    tint: s.tint ?? Tint.NONE,
    waving: s.waving ?? Waving.NONE,
    cullSame: s.cullSame ?? false,
    replaceable: s.replaceable ?? false,
    hardness: s.hardness ?? 0.8,
    sound: s.sound ?? 'stone',
    upNormal: s.upNormal ?? false,
    inInventory: s.inInventory ?? true,
    liquid: s.liquid ?? false,
    needsSupport: s.needsSupport ?? false,
    gravity: s.gravity ?? false,
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
};

// ---- Block table (ids are stable: they are written to save files) ----
export const AIR = def(0, { name: 'air', shape: Shape.NONE, solid: false, opaque: false, lightOpacity: 0, replaceable: true, inInventory: false, tex: 'stone' });
export const STONE = def(1, { name: 'stone', hardness: 0.9 });
export const GRASS = def(2, { name: 'grass_block', top: 'grass_top', side: 'grass_side', bottom: 'dirt', tint: Tint.GRASS, hardness: 0.4, sound: 'grass' });
export const DIRT = def(3, { name: 'dirt', hardness: 0.35, sound: 'dirt' });
export const COBBLESTONE = def(4, { name: 'cobblestone', hardness: 1.0 });
export const OAK_PLANKS = def(5, { name: 'oak_planks', hardness: 0.7, sound: 'wood' });
export const BEDROCK = def(6, { name: 'bedrock', hardness: Infinity, inInventory: false });
export const SAND = def(7, { name: 'sand', hardness: 0.35, sound: 'sand', gravity: true });
export const GRAVEL = def(8, { name: 'gravel', hardness: 0.4, sound: 'gravel', gravity: true });
export const OAK_LOG = def(9, { name: 'oak_log', side: 'oak_log', top: 'oak_log_top', hardness: 0.8, sound: 'wood' });
export const OAK_LEAVES = def(10, { name: 'oak_leaves', layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 1, tint: Tint.FOLIAGE, waving: Waving.LEAVES, cullSame: true, hardness: 0.15, sound: 'plant' });
export const GLASS = def(11, { name: 'glass', layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 0, cullSame: true, hardness: 0.25, sound: 'glass' });
export const WATER = def(12, { name: 'water', shape: Shape.LIQUID, layer: RenderLayer.TRANSLUCENT, solid: false, opaque: false, lightOpacity: 1, cullSame: true, replaceable: true, liquid: true, hardness: Infinity, inInventory: true, sound: 'plant' });
export const COAL_ORE = def(13, { name: 'coal_ore', hardness: 1.1 });
export const IRON_ORE = def(14, { name: 'iron_ore', hardness: 1.2 });
export const GOLD_ORE = def(15, { name: 'gold_ore', hardness: 1.2 });
export const DIAMOND_ORE = def(16, { name: 'diamond_ore', hardness: 1.4 });
export const REDSTONE_ORE = def(17, { name: 'redstone_ore', hardness: 1.2 });
export const LAPIS_ORE = def(18, { name: 'lapis_ore', hardness: 1.2 });
export const EMERALD_ORE = def(19, { name: 'emerald_ore', hardness: 1.3 });
export const SANDSTONE = def(20, { name: 'sandstone', side: 'sandstone_side', top: 'sandstone_top', bottom: 'sandstone_bottom', hardness: 0.8 });
export const BIRCH_LOG = def(21, { name: 'birch_log', side: 'birch_log', top: 'birch_log_top', hardness: 0.8, sound: 'wood' });
export const BIRCH_LEAVES = def(22, { name: 'birch_leaves', layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 1, tint: Tint.BIRCH, waving: Waving.LEAVES, cullSame: true, hardness: 0.15, sound: 'plant' });
export const SPRUCE_LOG = def(23, { name: 'spruce_log', side: 'spruce_log', top: 'spruce_log_top', hardness: 0.8, sound: 'wood' });
export const SPRUCE_LEAVES = def(24, { name: 'spruce_leaves', layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 1, tint: Tint.SPRUCE, waving: Waving.LEAVES, cullSame: true, hardness: 0.15, sound: 'plant' });
export const BIRCH_PLANKS = def(25, { name: 'birch_planks', hardness: 0.7, sound: 'wood' });
export const SPRUCE_PLANKS = def(26, { name: 'spruce_planks', hardness: 0.7, sound: 'wood' });
export const SNOW = def(27, { name: 'snow', displayName: 'Snow Block', hardness: 0.2, sound: 'snow' });
export const SNOWY_GRASS = def(28, { name: 'snowy_grass_block', displayName: 'Snowy Grass', top: 'snow', side: 'grass_side_snowy', bottom: 'dirt', hardness: 0.4, sound: 'snow' });
export const ICE = def(29, { name: 'ice', layer: RenderLayer.TRANSLUCENT, opaque: false, lightOpacity: 1, cullSame: true, hardness: 0.3, sound: 'glass' });
export const CLAY = def(30, { name: 'clay', hardness: 0.4, sound: 'dirt' });
export const BRICKS = def(31, { name: 'bricks', hardness: 1.2 });
export const STONE_BRICKS = def(32, { name: 'stone_bricks', hardness: 1.1 });
export const MOSSY_COBBLESTONE = def(33, { name: 'mossy_cobblestone', hardness: 1.0 });
export const BOOKSHELF = def(34, { name: 'bookshelf', side: 'bookshelf', top: 'oak_planks', hardness: 0.6, sound: 'wood' });
export const CRAFTING_TABLE = def(35, { name: 'crafting_table', side: 'crafting_table_side', front: 'crafting_table_front', top: 'crafting_table_top', bottom: 'oak_planks', hardness: 0.7, sound: 'wood' });
export const FURNACE = def(36, { name: 'furnace', side: 'furnace_side', front: 'furnace_front', top: 'furnace_top', hardness: 1.1 });
export const GLOWSTONE = def(37, { name: 'glowstone', emission: 15, hardness: 0.3, sound: 'glass' });
export const SEA_LANTERN = def(38, { name: 'sea_lantern', emission: 15, hardness: 0.3, sound: 'glass' });
export const OBSIDIAN = def(39, { name: 'obsidian', hardness: 3.0 });
export const IRON_BLOCK = def(40, { name: 'iron_block', displayName: 'Block of Iron', hardness: 1.5, sound: 'metal' });
export const GOLD_BLOCK = def(41, { name: 'gold_block', displayName: 'Block of Gold', hardness: 1.5, sound: 'metal' });
export const DIAMOND_BLOCK = def(42, { name: 'diamond_block', displayName: 'Block of Diamond', hardness: 1.5, sound: 'metal' });
export const EMERALD_BLOCK = def(43, { name: 'emerald_block', displayName: 'Block of Emerald', hardness: 1.5, sound: 'metal' });
export const WHITE_WOOL = def(44, { name: 'white_wool', hardness: 0.4, sound: 'wool' });
export const RED_WOOL = def(45, { name: 'red_wool', hardness: 0.4, sound: 'wool' });
export const ORANGE_WOOL = def(46, { name: 'orange_wool', hardness: 0.4, sound: 'wool' });
export const YELLOW_WOOL = def(47, { name: 'yellow_wool', hardness: 0.4, sound: 'wool' });
export const LIME_WOOL = def(48, { name: 'lime_wool', hardness: 0.4, sound: 'wool' });
export const LIGHT_BLUE_WOOL = def(49, { name: 'light_blue_wool', hardness: 0.4, sound: 'wool' });
export const BLUE_WOOL = def(50, { name: 'blue_wool', hardness: 0.4, sound: 'wool' });
export const PURPLE_WOOL = def(51, { name: 'purple_wool', hardness: 0.4, sound: 'wool' });
export const BLACK_WOOL = def(52, { name: 'black_wool', hardness: 0.4, sound: 'wool' });
export const TNT = def(53, { name: 'tnt', displayName: 'TNT', side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom', hardness: 0.1, sound: 'plant' });
export const PUMPKIN = def(54, { name: 'pumpkin', side: 'pumpkin_side', top: 'pumpkin_top', hardness: 0.5, sound: 'wood' });
export const JACK_O_LANTERN = def(55, { name: 'jack_o_lantern', displayName: "Jack o'Lantern", side: 'pumpkin_side', front: 'jack_o_lantern', top: 'pumpkin_top', emission: 15, hardness: 0.5, sound: 'wood' });
export const LAVA = def(56, { name: 'lava', shape: Shape.LIQUID, layer: RenderLayer.OPAQUE, solid: false, opaque: false, lightOpacity: 15, emission: 15, cullSame: true, replaceable: true, liquid: true, hardness: Infinity, sound: 'plant' });
export const TORCH = def(57, { name: 'torch', shape: Shape.TORCH, layer: RenderLayer.CUTOUT, solid: false, opaque: false, lightOpacity: 0, emission: 14, hardness: 0, sound: 'wood', needsSupport: true });
export const TALL_GRASS = def(58, { name: 'tall_grass', displayName: 'Grass', ...PLANT, tex: 'tall_grass', tint: Tint.GRASS });
export const FERN = def(59, { name: 'fern', ...PLANT, tex: 'fern', tint: Tint.GRASS });
export const DANDELION = def(60, { name: 'dandelion', ...PLANT, tex: 'dandelion' });
export const POPPY = def(61, { name: 'poppy', ...PLANT, tex: 'poppy' });
export const BLUE_ORCHID = def(62, { name: 'blue_orchid', ...PLANT, tex: 'blue_orchid' });
export const ALLIUM = def(63, { name: 'allium', ...PLANT, tex: 'allium' });
export const OXEYE_DAISY = def(64, { name: 'oxeye_daisy', ...PLANT, tex: 'oxeye_daisy' });
export const CORNFLOWER = def(65, { name: 'cornflower', ...PLANT, tex: 'cornflower' });
export const DEAD_BUSH = def(66, { name: 'dead_bush', ...PLANT, tex: 'dead_bush' });
export const CACTUS = def(67, { name: 'cactus', shape: Shape.CACTUS, layer: RenderLayer.CUTOUT, opaque: false, lightOpacity: 0, side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_bottom', hardness: 0.3, sound: 'wool', needsSupport: true });
export const SUGAR_CANE = def(68, { name: 'sugar_cane', ...PLANT, tex: 'sugar_cane', waving: Waving.NONE, replaceable: false });
export const RED_MUSHROOM = def(69, { name: 'red_mushroom', ...PLANT, tex: 'red_mushroom', waving: Waving.NONE });
export const BROWN_MUSHROOM = def(70, { name: 'brown_mushroom', ...PLANT, tex: 'brown_mushroom', waving: Waving.NONE });

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
export const FACE_TEX = new Uint16Array(256 * 6);

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
  for (let f = 0; f < 6; f++) FACE_TEX[b.id * 6 + f] = b.faces[f];
}

export function blockByName(name: string): BlockDef | undefined {
  return byName.get(name);
}

export function isFlower(id: number): boolean {
  return id >= DANDELION && id <= CORNFLOWER;
}

/** Default hotbar contents. */
export const DEFAULT_HOTBAR = [
  GRASS, STONE_BRICKS, OAK_PLANKS, OAK_LOG, GLASS, TORCH, GLOWSTONE, WATER, GOLD_BLOCK,
];
