/** The 16 dye colours, in Minecraft's canonical order (used for dyes, wool, glass, terracotta, concrete). */
export const COLORS = [
  'white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black',
] as const;
export type Color = (typeof COLORS)[number];

const TOOL_NAMES = [
  'wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_hoe', 'wooden_sword',
  'stone_pickaxe', 'stone_axe', 'stone_shovel', 'stone_hoe', 'stone_sword',
  'iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_hoe', 'iron_sword',
  'golden_pickaxe', 'golden_axe', 'golden_shovel', 'golden_hoe', 'golden_sword',
  'diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_hoe', 'diamond_sword',
] as const;

const ARMOR_NAMES = [
  'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots',
  'chainmail_helmet', 'chainmail_chestplate', 'chainmail_leggings', 'chainmail_boots',
  'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
  'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots',
  'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
] as const;

/**
 * Every texture layer in the block texture arrays, in layer order.
 * Shared between the main thread (texture generation) and workers (meshing).
 * Item sprites live in the same arrays so held and dropped items render through the G-buffer.
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

  // ---- blocks added with crafting ----
  'chest_top', 'chest_side', 'chest_front', 'furnace_front_on',
  'coal_block', 'lapis_block', 'redstone_block', 'smooth_stone', 'smooth_stone_slab_side',
  'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks',
  'cut_sandstone', 'chiseled_sandstone', 'terracotta',
  'hay_block_side', 'hay_block_top', 'farmland',
  'wheat_0', 'wheat_1', 'wheat_2', 'wheat_3', 'wheat_4', 'wheat_5', 'wheat_6', 'wheat_7',
  'oak_sapling', 'birch_sapling', 'spruce_sapling',
  'granite', 'polished_granite', 'diorite', 'polished_diorite', 'andesite', 'polished_andesite',
  'lantern', 'lantern_top', 'cobweb', 'barrel_side', 'barrel_top', 'barrel_bottom', 'bone_block_side', 'bone_block_top',
  'light_gray_wool', 'gray_wool', 'brown_wool', 'green_wool', 'cyan_wool', 'magenta_wool', 'pink_wool',
  ...COLORS.map((c) => `${c}_stained_glass` as const),
  ...COLORS.map((c) => `${c}_terracotta` as const),
  ...COLORS.map((c) => `${c}_concrete` as const),
  ...COLORS.map((c) => `${c}_concrete_powder` as const),

  // ---- item sprites ----
  'stick', 'coal', 'charcoal', 'raw_iron', 'raw_gold', 'iron_ingot', 'gold_ingot', 'iron_nugget', 'gold_nugget',
  'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'flint', 'clay_ball', 'brick', 'glowstone_dust',
  'string', 'feather', 'leather', 'bone', 'bone_meal', 'gunpowder', 'paper', 'book', 'sugar',
  'wheat_seeds', 'wheat', 'bowl', 'snowball', 'egg', 'ink_sac', 'cocoa_beans',
  ...COLORS.map((c) => `${c}_dye` as const),
  'apple', 'golden_apple', 'bread', 'mushroom_stew', 'cookie', 'pumpkin_pie',
  'porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'cod', 'cooked_cod',
  ...TOOL_NAMES,
  'shears', 'flint_and_steel', 'bucket', 'water_bucket', 'lava_bucket', 'compass', 'clock',
  ...ARMOR_NAMES,
  'lantern_item', 'player_arm',
] as const;

export type TextureName = (typeof TEXTURE_NAMES)[number];

const layerMap = new Map<string, number>();
TEXTURE_NAMES.forEach((n, i) => layerMap.set(n, i));

export function textureLayer(name: TextureName): number {
  const l = layerMap.get(name);
  if (l === undefined) throw new Error(`Unknown texture ${name}`);
  return l;
}

export function hasTexture(name: string): name is TextureName {
  return layerMap.has(name);
}

export const TEXTURE_COUNT = TEXTURE_NAMES.length;
export const DESTROY_LAYER_BASE = textureLayer('destroy_0');
