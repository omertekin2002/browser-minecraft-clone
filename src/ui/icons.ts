import { BLOCKS, BlockDef, Shape, Tint } from '../world/blocks';
import { TEXTURE_NAMES } from '../world/textureNames';
import type { TextureSet, TexData } from '../render/textures/BlockTextures';

const TINTS: Record<number, [number, number, number]> = {
  [Tint.GRASS]: [0.49, 0.74, 0.31],
  [Tint.FOLIAGE]: [0.4, 0.68, 0.25],
  [Tint.BIRCH]: [0.5, 0.65, 0.33],
  [Tint.SPRUCE]: [0.38, 0.58, 0.38],
};

function faceCanvas(t: TexData, tint: [number, number, number] | null, shade: number, cutout: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < 256; i++) {
    const a = t.rgba[i * 4 + 3];
    let r = t.rgba[i * 4], g = t.rgba[i * 4 + 1], b = t.rgba[i * 4 + 2];
    const tintHere = tint && (cutout || a > 127);
    if (tintHere) { r *= tint![0]; g *= tint![1]; b *= tint![2]; }
    img.data[i * 4] = r * shade;
    img.data[i * 4 + 1] = g * shade;
    img.data[i * 4 + 2] = b * shade;
    img.data[i * 4 + 3] = cutout ? a : 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const cache = new Map<number, string>();

/** Returns a data URL of an isometric (or flat, for plants) icon for a block. */
export function blockIcon(id: number, ts: TextureSet, size = 64): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const def: BlockDef = BLOCKS[id];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const tex = (face: number) => ts.byName.get(TEXTURE_NAMES[def.faces[face]])!;
  const tint = def.tint ? TINTS[def.tint] : null;
  const cutout = (face: number) => ts.cutout[def.faces[face]];

  if (def.shape === Shape.CROSS || def.shape === Shape.TORCH) {
    const f = faceCanvas(tex(0), tint, 1, true);
    ctx.drawImage(f, size * 0.1, size * 0.1, size * 0.8, size * 0.8);
  } else {
    const S = size * 0.92;
    const o = (size - S) / 2;
    const top = faceCanvas(tex(2), tint, 1.0, cutout(2));
    const left = faceCanvas(tex(4), tint, 0.78, cutout(4));
    const right = faceCanvas(tex(0), tint, 0.6, cutout(0));
    ctx.setTransform((S / 2) / 16, (-S / 4) / 16, (S / 2) / 16, (S / 4) / 16, o, o + S / 4);
    ctx.drawImage(top, 0, 0);
    ctx.setTransform((S / 2) / 16, (S / 4) / 16, 0, (S / 2) / 16, o, o + S / 4);
    ctx.drawImage(left, 0, 0);
    ctx.setTransform((S / 2) / 16, (-S / 4) / 16, 0, (S / 2) / 16, o + S / 2, o + S / 2);
    ctx.drawImage(right, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const url = c.toDataURL();
  cache.set(id, url);
  return url;
}
