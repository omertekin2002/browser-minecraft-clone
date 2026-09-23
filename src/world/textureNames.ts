/**
 * Every texture layer in the block texture arrays, in layer order.
 * Shared between the main thread (texture generation) and workers (meshing).
 */
export const TEXTURE_NAMES = [
  'stone', 'dirt', 'grass_top', 'grass_side', 'grass_side_snowy', 'cobblestone',
  'oak_planks', 'birch_planks', 'spruce_planks', 'bedrock', 'sand', 'gravel',
  'oak_log', 'oak_log_top', 'birch_log', 'birch_log_top', 'spruce_log', 'spruce_log_top',
  'oak_leaves', 'birch_leaves', 'spruce_leaves',
  'glass', 'water', 'lava',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore',
  'sandstone_top', 'sandstone_side', 'sandstone_bottom',
  'snow', 'ice', 'clay', 'bricks', 'stone_bricks', 'mossy_cobblestone',
  'bookshelf', 'crafting_table_top', 'crafting_table_side', 'crafting_table_front',
  'furnace_front', 'furnace_side', 'furnace_top',
  'glowstone', 'sea_lantern', 'obsidian', 'iron_block', 'gold_block', 'diamond_block', 'emerald_block',
  'white_wool', 'red_wool', 'orange_wool', 'yellow_wool', 'lime_wool', 'light_blue_wool', 'blue_wool',
  'purple_wool', 'black_wool',
  'tnt_side', 'tnt_top', 'tnt_bottom',
  'pumpkin_side', 'pumpkin_top', 'jack_o_lantern',
  'torch',
  'tall_grass', 'fern', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'oxeye_daisy', 'cornflower',
  'dead_bush', 'cactus_side', 'cactus_top', 'cactus_bottom', 'sugar_cane', 'red_mushroom', 'brown_mushroom',
  'destroy_0', 'destroy_1', 'destroy_2', 'destroy_3', 'destroy_4',
  'destroy_5', 'destroy_6', 'destroy_7', 'destroy_8', 'destroy_9',
] as const;

export type TextureName = (typeof TEXTURE_NAMES)[number];

const layerMap = new Map<string, number>();
TEXTURE_NAMES.forEach((n, i) => layerMap.set(n, i));

export function textureLayer(name: TextureName): number {
  const l = layerMap.get(name);
  if (l === undefined) throw new Error(`Unknown texture ${name}`);
  return l;
}

export const TEXTURE_COUNT = TEXTURE_NAMES.length;
export const DESTROY_LAYER_BASE = textureLayer('destroy_0');
