import { BLOCKS, BlockDef, Shape, Tint, RenderLayer, BOX } from '../world/blocks';
import { ITEMS } from '../world/items';
import { TEXTURE_NAMES } from '../world/textureNames';
import type { TextureSet, TexData } from '../render/textures/BlockTextures';

const TINTS: Record<number, [number, number, number]> = {
  [Tint.GRASS]: [0.49, 0.74, 0.31],
  [Tint.FOLIAGE]: [0.4, 0.68, 0.25],
  [Tint.BIRCH]: [0.5, 0.65, 0.33],
  [Tint.SPRUCE]: [0.38, 0.58, 0.38],
};

type AlphaMode = 'opaque' | 'cutout' | 'blend';

function faceCanvas(t: TexData, tint: [number, number, number] | null, shade: number, mode: AlphaMode): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < 256; i++) {
    const a = t.rgba[i * 4 + 3];
    let r = t.rgba[i * 4], g = t.rgba[i * 4 + 1], b = t.rgba[i * 4 + 2];
    const tintHere = tint && (mode !== 'opaque' || a > 127);
    if (tintHere) { r *= tint![0]; g *= tint![1]; b *= tint![2]; }
    img.data[i * 4] = r * shade;
    img.data[i * 4 + 1] = g * shade;
    img.data[i * 4 + 2] = b * shade;
    img.data[i * 4 + 3] = mode === 'opaque' ? 255 : mode === 'blend' ? Math.max(90, a) : a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const cache = new Map<number, string>();
let textureSet: TextureSet | null = null;

/** Must be called once with the generated block textures before icons are requested. */
export function setIconTextures(ts: TextureSet) {
  textureSet = ts;
  cache.clear();
}

function drawFlat(ctx: CanvasRenderingContext2D, size: number, layer: number, tint: [number, number, number] | null, pad: number) {
  const t = textureSet!.byName.get(TEXTURE_NAMES[layer])!;
  const f = faceCanvas(t, tint, 1, 'cutout');
  ctx.drawImage(f, size * pad, size * pad, size * (1 - 2 * pad), size * (1 - 2 * pad));
}

/** Isometric cube (or slab) icon. */
function drawBlock(ctx: CanvasRenderingContext2D, size: number, def: BlockDef) {
  const ts = textureSet!;
  const tex = (face: number) => ts.byName.get(TEXTURE_NAMES[def.faces[face]])!;
  const tint = def.tint ? TINTS[def.tint] : null;
  const mode = (face: number): AlphaMode =>
    def.layer === RenderLayer.TRANSLUCENT ? 'blend' : ts.cutout[def.faces[face]] ? 'cutout' : 'opaque';
  const o6 = def.id * 6;
  const y0 = def.shape === Shape.BOX ? BOX[o6 + 1] / 16 : 0;
  const y1 = def.shape === Shape.BOX ? BOX[o6 + 4] / 16 : 1;
  const h = y1 - y0;
  const S = size * 0.92;
  const o = (size - S) / 2;
  // Screen offset of the top face for a box that doesn't reach the top of the cell.
  const dy = (1 - y1) * (S / 2);
  const top = faceCanvas(tex(2), tint, 1.0, mode(2));
  // Blocks with a front (furnace, chest, jack o'lantern…) show it on the left, like Minecraft's icons.
  const leftFace = def.faces[5] !== def.faces[4] ? 5 : 4;
  const left = faceCanvas(tex(leftFace), tint, 0.78, mode(leftFace));
  const right = faceCanvas(tex(0), tint, 0.6, mode(0));
  const sy = 16 * (1 - y1), sh = 16 * h;
  ctx.setTransform((S / 2) / 16, (S / 4) / 16, 0, (S / 2) / 16, o, o + S / 4);
  ctx.drawImage(left, 0, sy, 16, sh, 0, sy, 16, sh);
  ctx.setTransform((S / 2) / 16, (-S / 4) / 16, 0, (S / 2) / 16, o + S / 2, o + S / 2);
  ctx.drawImage(right, 0, sy, 16, sh, 0, sy, 16, sh);
  ctx.setTransform((S / 2) / 16, (-S / 4) / 16, (S / 2) / 16, (S / 4) / 16, o, o + S / 4 + dy);
  ctx.drawImage(top, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Forgets a cached icon (animated items redraw their texture). */
export function invalidateIcon(id: number) {
  cache.delete(id);
}

/** Data URL of an item's inventory icon: isometric blocks, flat sprites for everything else. */
export function itemIcon(id: number, size = 64): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = ITEMS[id];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (def && textureSet) {
    const block = def.block && def.block === id ? BLOCKS[id] : null;
    if (def.flat) {
      const tint = block?.tint ? TINTS[block.tint] : null;
      drawFlat(ctx, size, def.texture, tint, block && block.shape !== Shape.CROSS ? 0.06 : 0.04);
    } else if (block) {
      drawBlock(ctx, size, block);
    }
  }
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}
