import * as B from '../world/blocks';
import * as I from '../world/items';
import { ItemStack, ToolInfo, ITEMS } from '../world/items';

/**
 * Minecraft's mining rules: which tool is fast on which block, which blocks need the right tool
 * to drop anything, break times, and what each block drops.
 */

export function toolOf(s: ItemStack | null): ToolInfo | undefined {
  return s ? ITEMS[s.id]?.tool : undefined;
}

/** Speed multiplier a tool gets on a block. */
export function toolSpeed(tool: ToolInfo | undefined, block: number): number {
  if (!tool) return 1;
  const def = B.BLOCKS[block];
  switch (tool.type) {
    case 'sword':
      if (block === B.COBWEB) return 15;
      return B.isLeaves(block) || def.shape === B.Shape.CROSS || block === B.PUMPKIN || block === B.CACTUS ? 1.5 : 1;
    case 'shears':
      if (block === B.COBWEB || B.isLeaves(block)) return 15;
      return def.tool === 'shears' ? 5 : 1;
    default:
      return def.tool === tool.type ? tool.speed : 1;
  }
}

/** Whether mining a block with this tool drops anything. */
export function canHarvest(block: number, tool: ToolInfo | undefined): boolean {
  const def = B.BLOCKS[block];
  if (!def.requiresTool) return true;
  if (block === B.COBWEB) return tool?.type === 'sword' || tool?.type === 'shears';
  return !!tool && tool.type === def.tool && tool.tier >= def.harvest;
}

/**
 * Seconds needed to break a block (0 = instant, Infinity = unbreakable).
 * Mining is 5× slower under water and in mid-air, as in Minecraft.
 */
export function breakTime(block: number, tool: ToolInfo | undefined, underwater: boolean, onGround: boolean): number {
  const def = B.BLOCKS[block];
  if (!def || !isFinite(def.hardness)) return Infinity;
  if (def.hardness <= 0) return 0;
  let speed = toolSpeed(tool, block);
  if (underwater) speed /= 5;
  if (!onGround) speed /= 5;
  const perTick = speed / def.hardness / (canHarvest(block, tool) ? 30 : 100);
  if (perTick >= 1) return 0;
  return Math.ceil(1 / perTick) / 20;
}

const one = (id: number, count = 1): ItemStack[] => [{ id, count }];
const rint = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** Items dropped by breaking a block with the given tool. */
export function blockDrops(block: number, tool: ToolInfo | undefined, rng: () => number = Math.random): ItemStack[] {
  block = B.baseBlock(block);
  const def = B.BLOCKS[block];
  if (!def || !canHarvest(block, tool)) return [];
  const shears = tool?.type === 'shears';
  if (B.isLeaves(block)) {
    if (shears) return one(block);
    const out: ItemStack[] = [];
    const sapling = block === B.OAK_LEAVES ? B.OAK_SAPLING : block === B.BIRCH_LEAVES ? B.BIRCH_SAPLING : B.SPRUCE_SAPLING;
    if (rng() < 0.05) out.push({ id: sapling, count: 1 });
    if (rng() < 0.02) out.push({ id: I.STICK, count: rint(rng, 1, 2) });
    if (block === B.OAK_LEAVES && rng() < 0.005) out.push({ id: I.APPLE, count: 1 });
    return out;
  }
  if (B.isCrop(block)) {
    if (block !== B.WHEAT_RIPE) return one(I.WHEAT_SEEDS);
    let seeds = 1;
    for (let k = 0; k < 3; k++) if (rng() < 0.57) seeds++;
    return [{ id: I.WHEAT, count: 1 }, { id: I.WHEAT_SEEDS, count: seeds }];
  }
  if (B.SLAB_BASE[block]) return one(B.SLAB_BASE[block]);
  switch (block) {
    case B.STONE: return one(B.COBBLESTONE);
    case B.GRASS: case B.SNOWY_GRASS: case B.FARMLAND: return one(B.DIRT);
    case B.GRAVEL: return rng() < 0.1 ? one(I.FLINT) : one(B.GRAVEL);
    case B.GLASS: case B.ICE: return [];
    case B.COAL_ORE: return one(I.COAL);
    case B.IRON_ORE: return one(I.RAW_IRON);
    case B.GOLD_ORE: return one(I.RAW_GOLD);
    case B.DIAMOND_ORE: return one(I.DIAMOND);
    case B.EMERALD_ORE: return one(I.EMERALD);
    case B.REDSTONE_ORE: return one(I.REDSTONE, rint(rng, 4, 5));
    case B.LAPIS_ORE: return one(I.LAPIS_LAZULI, rint(rng, 4, 9));
    case B.SNOW: return one(I.SNOWBALL, 4);
    case B.CLAY: return one(I.CLAY_BALL, 4);
    case B.BOOKSHELF: return one(I.BOOK, 3);
    case B.GLOWSTONE: return one(I.GLOWSTONE_DUST, rint(rng, 2, 4));
    case B.TALL_GRASS: case B.FERN:
      if (shears) return one(block);
      return rng() < 0.125 ? one(I.WHEAT_SEEDS) : [];
    case B.DEAD_BUSH:
      if (shears) return one(block);
      return one(I.STICK, rint(rng, 0, 2)).filter((s) => s.count > 0);
    case B.COBWEB: return shears ? one(B.COBWEB) : one(I.STRING);
    case B.LIT_FURNACE: return one(B.FURNACE);
    case B.WATER: case B.LAVA: case B.BEDROCK: case B.AIR: return [];
  }
  if (B.BLOCKS[block].name.endsWith('_stained_glass')) return [];
  return def.inInventory ? one(block) : [];
}

/** Durability a tool loses for breaking a block (swords wear twice as fast on blocks). */
export function toolWear(block: number, tool: ToolInfo | undefined): number {
  if (!tool) return 0;
  const def = B.BLOCKS[block];
  if (def.hardness <= 0 && tool.type !== 'shears') return 0;
  if (tool.type === 'shears' && !(B.isLeaves(block) || block === B.COBWEB || def.tool === 'shears' || def.shape === B.Shape.CROSS)) return 0;
  return tool.type === 'sword' ? 2 : 1;
}
