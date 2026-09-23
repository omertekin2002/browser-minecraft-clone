import { TEXTURE_NAMES, TextureName } from '../../world/textureNames';
import { mulberry32 } from '../../world/gen/noise';

/**
 * Procedural 16×16 pixel-art block textures with PBR data:
 *  - albedo (sRGB, alpha = cutout coverage or tint mask for opaque blocks)
 *  - normal (tangent space, derived from a height map) + height in alpha
 *  - specular: R smoothness, G F0 (255 = metal), B subsurface, A emission
 */

export const TEX = 16;
const N = TEX * TEX;

type RGB = [number, number, number];

export class TexData {
  rgba = new Uint8ClampedArray(N * 4);
  height = new Float32Array(N).fill(0.5);
  smooth = new Float32Array(N).fill(0.1);
  f0 = new Float32Array(N).fill(0.04);
  sss = new Float32Array(N);
  emit = new Float32Array(N);
  normalStrength = 1.0;
  cutout = false;

  set(x: number, y: number, c: RGB, a = 255) {
    x &= 15; y &= 15;
    const i = (y * TEX + x) * 4;
    this.rgba[i] = c[0];
    this.rgba[i + 1] = c[1];
    this.rgba[i + 2] = c[2];
    this.rgba[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (((y & 15) * TEX) + (x & 15)) * 4;
    return [this.rgba[i], this.rgba[i + 1], this.rgba[i + 2]];
  }
  alpha(x: number, y: number): number {
    return this.rgba[(((y & 15) * TEX) + (x & 15)) * 4 + 3];
  }
  setAlpha(x: number, y: number, a: number) {
    this.rgba[(((y & 15) * TEX) + (x & 15)) * 4 + 3] = a;
  }
  h(x: number, y: number, v: number) { this.height[(y & 15) * TEX + (x & 15)] = v; }
  hGet(x: number, y: number) { return this.height[(y & 15) * TEX + (x & 15)]; }
  mat(x: number, y: number, smooth: number, f0 = 0.04, sss = 0, emit = 0) {
    const i = (y & 15) * TEX + (x & 15);
    this.smooth[i] = smooth; this.f0[i] = f0; this.sss[i] = sss; this.emit[i] = emit;
  }
  fillMat(smooth: number, f0 = 0.04, sss = 0) {
    this.smooth.fill(smooth); this.f0.fill(f0); this.sss.fill(sss);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex(h: number): RGB {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
function pal(...hs: number[]): RGB[] {
  return hs.map(hex);
}
function pick(p: RGB[], v: number): RGB {
  const i = Math.max(0, Math.min(p.length - 1, Math.floor(v * p.length)));
  return p[i];
}
function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}
function mixc(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function grey(v: number): RGB {
  const g = Math.round(v * 255);
  return [g, g, g];
}
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Tileable value noise over the 16×16 texture. */
class TNoise {
  private g: Float32Array;
  constructor(rng: () => number, readonly fx: number, readonly fy: number = fx) {
    this.g = new Float32Array(fx * fy);
    for (let i = 0; i < this.g.length; i++) this.g[i] = rng();
  }
  at(x: number, y: number): number {
    const u = (x / TEX) * this.fx, v = (y / TEX) * this.fy;
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const tx = u - x0, ty = v - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (i: number, j: number) => this.g[(((j % this.fy) + this.fy) % this.fy) * this.fx + (((i % this.fx) + this.fx) % this.fx)];
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

function fbm(rng: () => number, octaves: number, base = 2): (x: number, y: number) => number {
  const layers: TNoise[] = [];
  for (let o = 0; o < octaves; o++) layers.push(new TNoise(rng, base << o));
  return (x, y) => {
    let s = 0, a = 1, n = 0;
    for (const l of layers) { s += l.at(x, y) * a; n += a; a *= 0.5; }
    return s / n;
  };
}

/** Tileable Voronoi: returns [cellIndex, d1, d2]. */
function voronoi(rng: () => number, count: number): { pts: Array<[number, number]>; at: (x: number, y: number) => [number, number, number] } {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) pts.push([rng() * TEX, rng() * TEX]);
  return {
    pts,
    at(x: number, y: number) {
      let d1 = 1e9, d2 = 1e9, idx = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const dx = pts[i][0] + ox * TEX - x, dy = pts[i][1] + oy * TEX - y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; idx = i; } else if (d < d2) d2 = d;
          }
        }
      }
      return [idx, d1, d2];
    },
  };
}

function forEach(fn: (x: number, y: number) => void) {
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) fn(x, y);
}

// ---------------------------------------------------------------------------
// Base materials reused by several textures
// ---------------------------------------------------------------------------

const STONE_PAL = pal(0x5f5f5f, 0x696969, 0x727272, 0x7b7b7b, 0x838383, 0x8c8c8c, 0x959595);
const DIRT_PAL = pal(0x5a3d27, 0x654630, 0x714f36, 0x7c583c, 0x876245, 0x946e4f);

function stone(t: TexData, rng: () => number) {
  const n = fbm(rng, 3, 2);
  const streak = new TNoise(rng, 8, 3);
  forEach((x, y) => {
    let v = n(x + 0.5, y + 0.5) * 0.7 + rng() * 0.3;
    const s = streak.at(x, y);
    if (s > 0.72) v -= 0.22;
    t.set(x, y, pick(STONE_PAL, v));
    t.h(x, y, 0.35 + v * 0.5);
  });
  t.fillMat(0.14, 0.04);
  t.normalStrength = 1.2;
}

function dirt(t: TexData, rng: () => number) {
  const n = fbm(rng, 3, 2);
  forEach((x, y) => {
    const v = n(x, y) * 0.55 + rng() * 0.45;
    let c = pick(DIRT_PAL, v);
    let h = 0.3 + v * 0.4;
    const r = rng();
    if (r < 0.06) { c = hex(0x9c7a58); h = 0.95; }
    else if (r < 0.12) { c = hex(0x4a3220); h = 0.1; }
    t.set(x, y, c, 0);
    t.h(x, y, h);
  });
  t.fillMat(0.04, 0.04);
  t.normalStrength = 1.3;
}

function grassTop(t: TexData, rng: () => number) {
  const n = fbm(rng, 3, 2);
  forEach((x, y) => {
    const v = n(x, y) * 0.5 + rng() * 0.5;
    t.set(x, y, grey(0.5 + v * 0.3), 255);
    t.h(x, y, 0.2 + rng() * 0.8);
  });
  t.fillMat(0.12, 0.04, 0.35);
  t.normalStrength = 1.1;
}

function cobble(t: TexData, rng: () => number, count = 11) {
  const vor = voronoi(rng, count);
  const tones = vor.pts.map(() => 0.25 + rng() * 0.7);
  forEach((x, y) => {
    const [i, d1, d2] = vor.at(x + 0.5, y + 0.5);
    const edge = d2 - d1;
    const p = vor.pts[i];
    // fake top-left lighting inside each rock
    let dx = x + 0.5 - p[0], dy = y + 0.5 - p[1];
    if (dx > 8) dx -= 16; if (dx < -8) dx += 16; if (dy > 8) dy -= 16; if (dy < -8) dy += 16;
    const light = -(dx + dy) * 0.05;
    let v = tones[i] + light + (rng() - 0.5) * 0.18;
    if (edge < 1.1) v = 0.05 + rng() * 0.1;
    t.set(x, y, pick(STONE_PAL, v));
    t.h(x, y, edge < 1.1 ? 0.05 : Math.min(1, 0.45 + Math.min(edge, 3) * 0.18 - d1 * 0.04));
  });
  t.fillMat(0.12, 0.04);
  t.normalStrength = 1.6;
}

function planks(t: TexData, rng: () => number, p: RGB[], seam: RGB) {
  const grain = new TNoise(rng, 2, 16);
  for (let board = 0; board < 4; board++) {
    const off = rng() * 16;
    const tone = (rng() - 0.5) * 0.15;
    const cut = Math.floor(rng() * 16);
    for (let yy = 0; yy < 4; yy++) {
      const y = board * 4 + yy;
      for (let x = 0; x < 16; x++) {
        let v = grain.at(x * 0.25 + off, y) * 0.7 + rng() * 0.25 + tone + 0.1;
        let c = pick(p, v);
        let h = 0.6 + v * 0.2;
        if (yy === 3) { c = seam; h = 0.1; }
        else if (x === cut && (board % 2 === 0 ? yy >= 0 : true)) { c = shade(seam, 1.12); h = 0.2; }
        else if (yy === 0) { c = shade(c, 1.06); }
        t.set(x, y, c, 0);
        t.h(x, y, h);
      }
    }
  }
  t.fillMat(0.2, 0.04);
  t.normalStrength = 1.2;
}

function bark(t: TexData, rng: () => number, p: RGB[], crack: RGB) {
  const cols: number[] = [];
  let w = rng();
  for (let x = 0; x < 16; x++) { w = Math.min(1, Math.max(0, w + (rng() - 0.5) * 0.5)); cols.push(w); }
  const vn = new TNoise(rng, 4, 2);
  forEach((x, y) => {
    let v = cols[x] * 0.6 + vn.at(x, y) * 0.3 + rng() * 0.2;
    let c = pick(p, v);
    let h = 0.4 + v * 0.5;
    if (cols[x] < 0.25 && rng() < 0.8) { c = crack; h = 0.05; }
    t.set(x, y, c, 0);
    t.h(x, y, h);
  });
  t.fillMat(0.08, 0.04);
  t.normalStrength = 1.8;
}

function logTop(t: TexData, rng: () => number, inner: RGB[], barkP: RGB[]) {
  forEach((x, y) => {
    const dx = x - 7.5, dy = y - 7.5;
    const r = Math.max(Math.abs(dx), Math.abs(dy)) * 0.7 + Math.sqrt(dx * dx + dy * dy) * 0.3;
    let c: RGB;
    let h = 0.6;
    if (x === 0 || y === 0 || x === 15 || y === 15) { c = pick(barkP, rng()); h = 0.3; }
    else {
      const ring = Math.floor(r + rng() * 0.4) % 2;
      c = pick(inner, 0.25 + ring * 0.45 + rng() * 0.25);
      h = ring ? 0.65 : 0.5;
    }
    t.set(x, y, c, 0);
    t.h(x, y, h);
  });
  t.fillMat(0.18, 0.04);
}

function leaves(t: TexData, rng: () => number, holes = 0.2, needles = false) {
  const n = fbm(rng, 2, 4);
  t.cutout = true;
  forEach((x, y) => {
    const v = n(x, y);
    const r = rng();
    let a = 255;
    if (needles) {
      if (((x + y * 2) % 5 === 0 && r < 0.5) || r < holes * 0.6) a = 0;
    } else if (r < holes + (v < 0.35 ? 0.2 : 0)) a = 0;
    const g = 0.35 + v * 0.35 + rng() * 0.2;
    t.set(x, y, grey(g), a);
    t.h(x, y, 0.3 + g * 0.6);
  });
  t.fillMat(0.3, 0.04, 0.85);
  t.normalStrength = 1.0;
}

function wool(t: TexData, rng: () => number, base: RGB) {
  forEach((x, y) => {
    const knit = ((x + (y >> 1)) % 4 === 0 ? -0.08 : 0) + ((x - y) % 3 === 0 ? 0.04 : 0);
    const v = 1 + knit + (rng() - 0.5) * 0.12;
    t.set(x, y, shade(base, v), 0);
    t.h(x, y, 0.5 + knit * 2 + rng() * 0.1);
  });
  t.fillMat(0.02, 0.04, 0.2);
  t.normalStrength = 0.9;
}

function ore(t: TexData, rng: () => number, p: RGB[], opts: { smooth: number; f0: number; emit?: number; clusters?: number }) {
  stone(t, rng);
  const clusters = opts.clusters ?? 4;
  for (let k = 0; k < clusters; k++) {
    const cx = Math.floor(rng() * 16), cy = Math.floor(rng() * 16);
    const size = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < size; i++) {
      const x = cx + Math.floor(rng() * 3) - 1, y = cy + Math.floor(rng() * 3) - 1;
      const shadeIdx = rng();
      t.set(x, y, pick(p, shadeIdx));
      t.h(x, y, 0.8 + shadeIdx * 0.2);
      t.mat(x, y, opts.smooth, opts.f0, 0, opts.emit ? opts.emit * (0.5 + shadeIdx * 0.5) : 0);
      // dark rim below-right for depth
      if (rng() < 0.5) {
        t.set(x + 1, y + 1, shade(t.get(x + 1, y + 1), 0.8));
      }
    }
  }
}

function border(t: TexData, c: RGB, h = 0.35) {
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, c); t.set(i, 15, c); t.set(0, i, c); t.set(15, i, c);
    t.h(i, 0, h); t.h(i, 15, h); t.h(0, i, h); t.h(15, i, h);
  }
}

function metalBlock(t: TexData, rng: () => number, p: RGB[], edge: RGB, metal: boolean, smooth: number) {
  forEach((x, y) => {
    const brushed = Math.sin(y * 1.7 + rng() * 0.6) * 0.08;
    let v = 0.55 + brushed + (rng() - 0.5) * 0.12;
    // bevel lighting
    if (x === 1 || y === 1) v += 0.25;
    if (x === 14 || y === 14) v -= 0.25;
    t.set(x, y, pick(p, v), 0);
    t.h(x, y, 0.75);
  });
  border(t, edge, 0.3);
  t.fillMat(smooth, metal ? 1.0 : 0.17);
  t.normalStrength = 1.4;
}

function gemBlock(t: TexData, rng: () => number, p: RGB[], edge: RGB, f0: number) {
  forEach((x, y) => {
    // faceted diamond pattern
    const fx = ((x + 4) % 8) - 3.5, fy = ((y + 4) % 8) - 3.5;
    const facet = (Math.abs(fx) + Math.abs(fy)) / 7;
    const v = 0.3 + (1 - facet) * 0.45 + (fx < 0 ? 0.12 : -0.05) + (rng() - 0.5) * 0.08;
    t.set(x, y, pick(p, v), 0);
    t.h(x, y, 0.4 + (1 - facet) * 0.5);
  });
  border(t, edge, 0.3);
  t.fillMat(0.93, f0);
  t.normalStrength = 1.6;
}

/** Tiny 3×5 font for the TNT label. */
const GLYPHS: Record<string, string[]> = {
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  N: ['#.#', '###', '###', '#.#', '#.#'],
};

function plantBase(t: TexData) {
  t.cutout = true;
  forEach((x, y) => t.set(x, y, [0, 0, 0], 0));
  t.fillMat(0.2, 0.04, 0.7);
}

function stem(t: TexData, x: number, top: number, c: RGB = hex(0x3f7a28)) {
  for (let y = top; y < 16; y++) {
    t.set(x, y, shade(c, 0.85 + (y % 3) * 0.08));
    t.h(x, y, 0.6);
  }
}

function flower(t: TexData, rng: () => number, petal: RGB[], center: RGB | null, kind: 'round' | 'cup' | 'ball' | 'spike') {
  plantBase(t);
  stem(t, 7, 7);
  // leaves on the stem
  t.set(6, 11, hex(0x4f8f30)); t.set(5, 10, hex(0x4f8f30)); t.set(8, 12, hex(0x4f8f30)); t.set(9, 11, hex(0x4f8f30));
  if (kind === 'round') {
    for (let y = 2; y <= 7; y++) for (let x = 4; x <= 10; x++) {
      const d = Math.hypot(x - 7, (y - 4.5) * 1.1);
      if (d < 3.2) { t.set(x, y, pick(petal, 1 - d / 3.2 + rng() * 0.2)); t.h(x, y, 1 - d / 4); }
    }
  } else if (kind === 'cup') {
    for (let y = 3; y <= 7; y++) for (let x = 5; x <= 9; x++) {
      if ((y === 3 && (x === 5 || x === 9)) || (y === 7 && (x === 5 || x === 9))) continue;
      t.set(x, y, pick(petal, rng())); t.h(x, y, 0.8);
    }
  } else if (kind === 'ball') {
    for (let y = 1; y <= 7; y++) for (let x = 4; x <= 10; x++) {
      const d = Math.hypot(x - 7, y - 4);
      if (d < 3.2 && rng() < 0.85) { t.set(x, y, pick(petal, rng())); t.h(x, y, 0.9); }
    }
  } else {
    for (let y = 2; y <= 8; y++) for (let x = 6; x <= 8; x++) {
      if (rng() < 0.8) { t.set(x, y, pick(petal, rng())); t.h(x, y, 0.8); }
    }
  }
  if (center) { t.set(7, 4, center); t.set(7, 5, center); t.set(6, 5, center); }
}

// ---------------------------------------------------------------------------
// Texture table
// ---------------------------------------------------------------------------

type Gen = (t: TexData, rng: () => number) => void;

const GENERATORS: Partial<Record<TextureName, Gen>> = {
  stone,
  dirt,
  grass_top: grassTop,
  grass_side: (t, rng) => {
    dirt(t, rng);
    for (let x = 0; x < 16; x++) {
      let depth = 3 + (rng() < 0.5 ? 1 : 0);
      if (rng() < 0.15) depth += 2;
      for (let y = 0; y < depth; y++) {
        const v = 0.5 + rng() * 0.3;
        t.set(x, y, grey(v), 255);
        t.h(x, y, 0.75 + rng() * 0.2);
        t.mat(x, y, 0.12, 0.04, 0.3);
      }
    }
  },
  grass_side_snowy: (t, rng) => {
    dirt(t, rng);
    for (let x = 0; x < 16; x++) {
      const depth = 3 + (rng() < 0.4 ? 1 : 0) + (rng() < 0.1 ? 1 : 0);
      for (let y = 0; y < depth; y++) {
        t.set(x, y, pick(pal(0xdfeaea, 0xeaf2f2, 0xf6fbfb, 0xffffff), rng()), 0);
        t.h(x, y, 0.8);
        t.mat(x, y, 0.3, 0.04, 0.4);
      }
    }
  },
  cobblestone: (t, rng) => cobble(t, rng),
  oak_planks: (t, rng) => planks(t, rng, pal(0x8c6d40, 0x9a7a4a, 0xa88652, 0xb2905b, 0xbd9a63), hex(0x5c4526)),
  birch_planks: (t, rng) => planks(t, rng, pal(0xb8a46c, 0xc4b078, 0xcfbc84, 0xd8c68f, 0xe0d09a), hex(0x8e7b4b)),
  spruce_planks: (t, rng) => planks(t, rng, pal(0x5c4329, 0x664b2e, 0x715334, 0x7b5c3a, 0x856441), hex(0x3a2917)),
  bedrock: (t, rng) => {
    forEach((x, y) => {
      const v = rng();
      t.set(x, y, pick(pal(0x222222, 0x353535, 0x4a4a4a, 0x5e5e5e, 0x777777, 0x8e8e8e), v * v));
      t.h(x, y, v);
    });
    t.fillMat(0.1, 0.04);
    t.normalStrength = 2;
  },
  sand: (t, rng) => {
    const n = fbm(rng, 2, 4);
    forEach((x, y) => {
      const v = n(x, y) * 0.4 + rng() * 0.6;
      t.set(x, y, pick(pal(0xcbbf8a, 0xd4c894, 0xdbd09e, 0xe1d7a8, 0xe8dfb4), v), 0);
      t.h(x, y, 0.4 + v * 0.3);
    });
    t.fillMat(0.08, 0.04);
    t.normalStrength = 0.8;
  },
  gravel: (t, rng) => {
    const vor = voronoi(rng, 22);
    const tones = vor.pts.map(() => rng());
    const gp = pal(0x5b5452, 0x6e6664, 0x7f7775, 0x8f8886, 0x9f9896, 0x7a6a5a);
    forEach((x, y) => {
      const [i, d1, d2] = vor.at(x + 0.5, y + 0.5);
      const edge = d2 - d1;
      let c = pick(gp, tones[i]);
      if (edge < 0.7) c = shade(c, 0.65);
      t.set(x, y, shade(c, 1.05 - d1 * 0.08), 0);
      t.h(x, y, edge < 0.7 ? 0.1 : 0.5 + (1 - d1 / 3) * 0.4);
    });
    t.fillMat(0.1, 0.04);
    t.normalStrength = 1.7;
  },
  oak_log: (t, rng) => bark(t, rng, pal(0x3f311d, 0x4c3b23, 0x59462b, 0x665234, 0x735d3c), hex(0x2b2012)),
  oak_log_top: (t, rng) => logTop(t, rng, pal(0x8f6f42, 0x9e7b4a, 0xad8854, 0xb8935c), pal(0x4c3b23, 0x59462b, 0x665234)),
  birch_log: (t, rng) => {
    forEach((x, y) => {
      const v = 0.6 + rng() * 0.4;
      t.set(x, y, pick(pal(0xc9c9c0, 0xd7d7ce, 0xe3e3da, 0xeeeee6), v), 0);
      t.h(x, y, 0.7);
    });
    for (let k = 0; k < 9; k++) {
      const y = Math.floor(rng() * 16), x = Math.floor(rng() * 16), len = 2 + Math.floor(rng() * 4);
      for (let i = 0; i < len; i++) {
        t.set(x + i, y, pick(pal(0x1e1e1e, 0x323232, 0x474747), rng()), 0);
        t.h(x + i, y, 0.2);
      }
    }
    t.fillMat(0.2, 0.04);
    t.normalStrength = 1.3;
  },
  birch_log_top: (t, rng) => logTop(t, rng, pal(0xc2ad73, 0xceba80, 0xd8c68d, 0xe0cf98), pal(0xd7d7ce, 0xe3e3da, 0x3a3a3a)),
  spruce_log: (t, rng) => bark(t, rng, pal(0x2c1f12, 0x352617, 0x3f2d1c, 0x493522, 0x533d27), hex(0x1c130a)),
  spruce_log_top: (t, rng) => logTop(t, rng, pal(0x6b4d2c, 0x775733, 0x83613a, 0x8f6b42), pal(0x352617, 0x3f2d1c, 0x493522)),
  oak_leaves: (t, rng) => leaves(t, rng, 0.18),
  birch_leaves: (t, rng) => leaves(t, rng, 0.16),
  spruce_leaves: (t, rng) => leaves(t, rng, 0.12, true),
  glass: (t, rng) => {
    t.cutout = true;
    forEach((x, y) => t.set(x, y, [230, 240, 245], 0));
    const edge = pal(0xc4dfe6, 0xd8eef3, 0xeef9fb);
    for (let i = 0; i < 16; i++) {
      t.set(i, 0, pick(edge, rng())); t.set(i, 15, pick(edge, rng() * 0.6));
      t.set(0, i, pick(edge, rng())); t.set(15, i, pick(edge, rng() * 0.6));
    }
    for (const [x, y] of [[3, 3], [4, 2], [2, 4], [3, 5], [5, 3], [11, 11], [12, 10], [10, 12]]) t.set(x, y, [250, 254, 255], 255);
    t.fillMat(0.96, 0.04);
    t.normalStrength = 0.4;
  },
  water: (t, rng) => {
    forEach((x, y) => t.set(x, y, pick(pal(0x2f5fb8, 0x3668c4, 0x3c70cf, 0x4378d8), rng()), 200));
    t.fillMat(0.98, 0.02);
  },
  lava: (t, rng) => {
    const n = fbm(rng, 3, 2);
    forEach((x, y) => {
      const v = n(x, y) * 0.7 + rng() * 0.3;
      t.set(x, y, pick(pal(0xb3260a, 0xcf3d0c, 0xe35a10, 0xf07a18, 0xf99e2a, 0xffc44a), v), 0);
      t.h(x, y, v);
      t.mat(x, y, 0.4, 0.04, 0, 0.55 + v * 0.45);
    });
  },
  coal_ore: (t, rng) => ore(t, rng, pal(0x141414, 0x222222, 0x333333, 0x454545), { smooth: 0.35, f0: 0.04 }),
  iron_ore: (t, rng) => ore(t, rng, pal(0x9c7a62, 0xb8937a, 0xd2ad93, 0xe4c7b0), { smooth: 0.6, f0: 1.0 }),
  gold_ore: (t, rng) => ore(t, rng, pal(0xb88a14, 0xd8aa1e, 0xf5d23a, 0xfff08a), { smooth: 0.75, f0: 1.0 }),
  diamond_ore: (t, rng) => ore(t, rng, pal(0x1a9c98, 0x2fc7c0, 0x5de8e2, 0xb4fff6), { smooth: 0.92, f0: 0.17 }),
  redstone_ore: (t, rng) => ore(t, rng, pal(0x7a0000, 0xa80000, 0xd81010, 0xff4a4a), { smooth: 0.55, f0: 0.05, emit: 0.35 }),
  lapis_ore: (t, rng) => ore(t, rng, pal(0x0e2a70, 0x173c96, 0x2553bf, 0x4a78e0), { smooth: 0.5, f0: 0.05 }),
  emerald_ore: (t, rng) => ore(t, rng, pal(0x007a26, 0x0da33c, 0x2fd46a, 0x9cf5bd), { smooth: 0.9, f0: 0.08, clusters: 3 }),
  sandstone_top: (t, rng) => {
    forEach((x, y) => {
      const v = rng() * 0.5 + 0.3;
      t.set(x, y, pick(pal(0xd3c38c, 0xdacb95, 0xe0d29e, 0xe6d8a6), v), 0);
      t.h(x, y, 0.5 + v * 0.1);
    });
    t.fillMat(0.12, 0.04);
  },
  sandstone_side: (t, rng) => {
    forEach((x, y) => {
      let p = pal(0xd0bf86, 0xd8c890, 0xe0d19b, 0xe6d8a4);
      let v = rng() * 0.6 + 0.2;
      let h = 0.6;
      if (y < 3) { v += 0.2; h = 0.7; }
      else if (y === 3 || y === 8 || y === 12) { p = pal(0xb9a672, 0xc2af7b); v = rng(); h = 0.25; }
      t.set(x, y, pick(p, v), 0);
      t.h(x, y, h + rng() * 0.1);
    });
    t.fillMat(0.1, 0.04);
    t.normalStrength = 1.3;
  },
  sandstone_bottom: (t, rng) => {
    forEach((x, y) => {
      const v = rng();
      t.set(x, y, pick(pal(0xc3b07a, 0xcdbb84, 0xd6c58f, 0xdfcf99), v), 0);
      t.h(x, y, v);
    });
    t.fillMat(0.08, 0.04);
  },
  snow: (t, rng) => {
    const n = fbm(rng, 2, 2);
    forEach((x, y) => {
      const v = n(x, y) * 0.5 + rng() * 0.5;
      t.set(x, y, pick(pal(0xe4eff2, 0xedf6f8, 0xf5fbfc, 0xffffff), v), 0);
      t.h(x, y, 0.5 + v * 0.3);
    });
    t.fillMat(0.35, 0.04, 0.45);
    t.normalStrength = 0.7;
  },
  ice: (t, rng) => {
    forEach((x, y) => {
      t.set(x, y, pick(pal(0x7fa9e6, 0x8ab3ec, 0x96bdf1, 0xa3c8f6), rng()), 180);
      t.h(x, y, 0.8);
    });
    // cracks
    for (let k = 0; k < 3; k++) {
      let x = rng() * 16, y = rng() * 16;
      const a = rng() * Math.PI;
      for (let i = 0; i < 7; i++) {
        t.set(Math.floor(x), Math.floor(y), [225, 240, 255], 215);
        t.h(Math.floor(x), Math.floor(y), 0.5);
        x += Math.cos(a) + (rng() - 0.5) * 0.6;
        y += Math.sin(a) + (rng() - 0.5) * 0.6;
      }
    }
    t.fillMat(0.95, 0.02);
    t.normalStrength = 0.5;
  },
  clay: (t, rng) => {
    const n = fbm(rng, 2, 2);
    forEach((x, y) => {
      const v = n(x, y) * 0.6 + rng() * 0.4;
      t.set(x, y, pick(pal(0x969cab, 0x9ea4b3, 0xa5abb9, 0xadb3c1), v), 0);
      t.h(x, y, 0.5 + v * 0.2);
    });
    t.fillMat(0.25, 0.04);
    t.normalStrength = 0.6;
  },
  bricks: (t, rng) => {
    const bp = pal(0x7f3526, 0x8e3e2c, 0x9c4732, 0xa9523b, 0xb35e46);
    const mortar = pal(0x9b958c, 0xa8a298, 0xb4aea4);
    for (let row = 0; row < 4; row++) {
      const offset = row % 2 === 0 ? 0 : 4;
      const tones = [rng(), rng(), rng()];
      for (let yy = 0; yy < 4; yy++) {
        const y = row * 4 + yy;
        for (let x = 0; x < 16; x++) {
          const bx = (x + offset) % 16;
          const brick = Math.floor(bx / 8);
          const isMortar = yy === 3 || bx % 8 === 7;
          if (isMortar) { t.set(x, y, pick(mortar, rng()), 0); t.h(x, y, 0.1); continue; }
          let v = tones[brick] * 0.5 + rng() * 0.4;
          if (yy === 0) v += 0.15;
          t.set(x, y, pick(bp, v), 0);
          t.h(x, y, 0.75 + (yy === 0 ? 0.1 : 0));
        }
      }
    }
    t.fillMat(0.12, 0.04);
    t.normalStrength = 1.8;
  },
  stone_bricks: (t, rng) => {
    const sp = pal(0x676767, 0x707070, 0x797979, 0x828282, 0x8b8b8b);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const row = y >> 3;
        const bx = (x + (row ? 8 : 0)) % 16;
        const ly = y & 7, lx = bx & 15;
        const mortar = ly === 7 || lx === 15;
        let v = 0.45 + rng() * 0.3;
        let h = 0.7;
        if (mortar) { v = 0.02; h = 0.05; }
        else if (ly === 0 || lx === 0) { v += 0.25; h = 0.85; }
        else if (ly === 6 || lx === 14) { v -= 0.2; h = 0.6; }
        t.set(x, y, pick(sp, v), 0);
        t.h(x, y, h);
      }
    }
    t.fillMat(0.15, 0.04);
    t.normalStrength = 1.6;
  },
  mossy_cobblestone: (t, rng) => {
    cobble(t, rng);
    const n = fbm(rng, 2, 2);
    forEach((x, y) => {
      if (n(x, y) > 0.5 && t.hGet(x, y) > 0.2) {
        t.set(x, y, pick(pal(0x405f22, 0x4b6c2a, 0x587a31, 0x668a3a), rng()));
        t.mat(x, y, 0.08, 0.04, 0.3);
      }
    });
  },
  bookshelf: (t, rng) => {
    planks(t, rng, pal(0x8c6d40, 0x9a7a4a, 0xa88652, 0xb2905b), hex(0x5c4526));
    const bookColors = pal(0x8e2a26, 0x2a4a8e, 0x2f6e36, 0x7a5a2a, 0x6a2e7a, 0x2e7a78, 0xa8842a, 0x5a1e1e);
    for (const [y0, y1] of [[1, 7], [9, 15]]) {
      let x = 1;
      while (x < 15) {
        const w = rng() < 0.3 ? 2 : 1;
        const c = pick(bookColors, rng());
        const top = y0 + Math.floor(rng() * 2);
        for (let xx = x; xx < Math.min(15, x + w); xx++) {
          for (let y = y0; y < y1; y++) {
            if (y < top) { t.set(xx, y, hex(0x2e2214), 0); t.h(xx, y, 0.1); continue; }
            t.set(xx, y, shade(c, y === top ? 1.25 : 0.9 + rng() * 0.2), 0);
            t.h(xx, y, 0.55);
          }
        }
        x += w;
      }
    }
  },
  crafting_table_top: (t, rng) => {
    planks(t, rng, pal(0x9a7a4a, 0xa88652, 0xb2905b, 0xbd9a63), hex(0x6b5030));
    border(t, hex(0x4a3620), 0.3);
    for (let i = 1; i < 15; i++) { t.set(i, 5, hex(0x5c4526)); t.set(i, 10, hex(0x5c4526)); t.set(5, i, hex(0x5c4526)); t.set(10, i, hex(0x5c4526)); }
  },
  crafting_table_side: (t, rng) => {
    planks(t, rng, pal(0x8c6d40, 0x9a7a4a, 0xa88652, 0xb2905b), hex(0x5c4526));
    for (let x = 0; x < 16; x++) { t.set(x, 0, hex(0x4a3620)); t.set(x, 1, hex(0x6b5030)); }
    // saw
    for (let x = 3; x <= 9; x++) { t.set(x, 5, hex(0xa8a8a8)); t.set(x, 6, x % 2 ? hex(0x7a7a7a) : hex(0xb8b8b8)); }
    t.set(10, 5, hex(0x5a3a1a)); t.set(11, 5, hex(0x5a3a1a)); t.set(11, 6, hex(0x5a3a1a));
    // hammer
    for (let y = 8; y <= 13; y++) t.set(12, y, hex(0x5a3a1a));
    t.set(11, 8, hex(0x8a8a8a)); t.set(13, 8, hex(0x8a8a8a)); t.set(12, 8, hex(0x9a9a9a));
  },
  crafting_table_front: (t, rng) => {
    planks(t, rng, pal(0x8c6d40, 0x9a7a4a, 0xa88652, 0xb2905b), hex(0x5c4526));
    for (let x = 0; x < 16; x++) { t.set(x, 0, hex(0x4a3620)); t.set(x, 1, hex(0x6b5030)); }
    // tongs & pick
    for (let i = 0; i < 6; i++) { t.set(4 + i, 5 + i, hex(0x5a3a1a)); }
    for (let x = 3; x <= 7; x++) t.set(x, 4, hex(0x9a9a9a));
    for (let y = 5; y <= 12; y++) t.set(11, y, hex(0x3a3a3a));
  },
  furnace_front: (t, rng) => {
    forEach((x, y) => { t.set(x, y, pick(STONE_PAL, 0.45 + rng() * 0.35), 0); t.h(x, y, 0.6); });
    border(t, hex(0x5a5a5a), 0.3);
    for (let y = 8; y <= 13; y++) for (let x = 4; x <= 11; x++) {
      const inner = y > 8 && x > 4 && x < 11;
      t.set(x, y, inner ? hex(0x161616) : hex(0x3a3a3a), 0);
      t.h(x, y, inner ? 0.05 : 0.4);
    }
    for (let x = 3; x <= 12; x++) t.set(x, 3, hex(0x4a4a4a));
    t.fillMat(0.2, 0.04);
  },
  furnace_side: (t, rng) => {
    forEach((x, y) => { t.set(x, y, pick(STONE_PAL, 0.45 + rng() * 0.35), 0); t.h(x, y, 0.6); });
    border(t, hex(0x5a5a5a), 0.3);
    t.fillMat(0.2, 0.04);
  },
  furnace_top: (t, rng) => {
    forEach((x, y) => { t.set(x, y, pick(STONE_PAL, 0.5 + rng() * 0.3), 0); t.h(x, y, 0.6); });
    border(t, hex(0x5a5a5a), 0.3);
    t.fillMat(0.2, 0.04);
  },
  glowstone: (t, rng) => {
    const vor = voronoi(rng, 14);
    const tones = vor.pts.map(() => rng());
    forEach((x, y) => {
      const [i, , ] = vor.at(x + 0.5, y + 0.5);
      const [, d1, d2] = vor.at(x + 0.5, y + 0.5);
      const edge = d2 - d1;
      const v = tones[i] * 0.6 + rng() * 0.4;
      if (edge < 0.9) {
        t.set(x, y, pick(pal(0x6b4a1e, 0x7e5a26, 0x8f6a2e), rng()), 0);
        t.h(x, y, 0.2);
        t.mat(x, y, 0.3, 0.04, 0, 0.12);
      } else {
        t.set(x, y, pick(pal(0xc98f3a, 0xe6b04c, 0xf8d06a, 0xffe69a, 0xfff4c8), v), 0);
        t.h(x, y, 0.6 + v * 0.3);
        t.mat(x, y, 0.5, 0.04, 0, 0.55 + v * 0.45);
      }
    });
  },
  sea_lantern: (t, rng) => {
    forEach((x, y) => {
      const qx = x % 8, qy = y % 8;
      const d = Math.max(Math.abs(qx - 3.5), Math.abs(qy - 3.5));
      const v = 1 - d / 4 + (rng() - 0.5) * 0.15;
      t.set(x, y, pick(pal(0x7fb3a8, 0x9fcdc2, 0xbfe3da, 0xdcf4ee, 0xf4fffc), v), 0);
      t.h(x, y, 0.4 + v * 0.4);
      t.mat(x, y, 0.8, 0.05, 0.2, 0.45 + v * 0.55);
    });
  },
  obsidian: (t, rng) => {
    forEach((x, y) => {
      const r = rng();
      const c = r < 0.08 ? hex(0x4a3470) : r < 0.2 ? hex(0x2c1c44) : pick(pal(0x0c0812, 0x120c1c, 0x191126, 0x1f1530), rng());
      t.set(x, y, c, 0);
      t.h(x, y, 0.5 + r * 0.3);
    });
    t.fillMat(0.88, 0.05);
    t.normalStrength = 0.8;
  },
  iron_block: (t, rng) => metalBlock(t, rng, pal(0xa8a8a8, 0xbdbdbd, 0xcecece, 0xdcdcdc, 0xeaeaea), hex(0x8a8a8a), true, 0.72),
  gold_block: (t, rng) => metalBlock(t, rng, pal(0xc99a18, 0xe0b52a, 0xf2cf3e, 0xfbe262, 0xfff08c), hex(0xa87a10), true, 0.85),
  diamond_block: (t, rng) => gemBlock(t, rng, pal(0x2aa6a0, 0x3dc4be, 0x61e7e0, 0x8ef7ee, 0xc8fff9), hex(0x1f8a85), 0.17),
  emerald_block: (t, rng) => gemBlock(t, rng, pal(0x118a3c, 0x1aa34d, 0x2fd46a, 0x5ce68e, 0xa8f7c4), hex(0x0c6a2c), 0.08),
  white_wool: (t, rng) => wool(t, rng, hex(0xe9ecec)),
  red_wool: (t, rng) => wool(t, rng, hex(0xa12722)),
  orange_wool: (t, rng) => wool(t, rng, hex(0xf07613)),
  yellow_wool: (t, rng) => wool(t, rng, hex(0xf8c627)),
  lime_wool: (t, rng) => wool(t, rng, hex(0x70b919)),
  light_blue_wool: (t, rng) => wool(t, rng, hex(0x3aafd9)),
  blue_wool: (t, rng) => wool(t, rng, hex(0x35399d)),
  purple_wool: (t, rng) => wool(t, rng, hex(0x7a2aad)),
  black_wool: (t, rng) => wool(t, rng, hex(0x1d1d21)),
  tnt_side: (t, rng) => {
    forEach((x, y) => {
      let c = shade(hex(0xc9291b), 0.85 + rng() * 0.25);
      if (x % 4 === 3) c = shade(c, 0.7);
      t.set(x, y, c, 0);
      t.h(x, y, x % 4 === 3 ? 0.3 : 0.7);
    });
    for (let y = 5; y <= 10; y++) for (let x = 0; x < 16; x++) { t.set(x, y, grey(0.88 + rng() * 0.08), 0); t.h(x, y, 0.8); }
    let gx = 2;
    for (const ch of 'TNT') {
      const g = GLYPHS[ch];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '#') t.set(gx + c, 5 + r + 0, hex(0x151515), 0);
      gx += 4;
    }
    t.fillMat(0.15, 0.04);
  },
  tnt_top: (t, rng) => {
    forEach((x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      let c = shade(hex(0xb8b0a0), 0.85 + rng() * 0.2);
      if (d < 3) c = shade(hex(0xc9291b), 0.9);
      if (d < 1.2) c = hex(0x1a1a1a);
      t.set(x, y, c, 0);
      t.h(x, y, d < 1.2 ? 0.1 : 0.6);
    });
    t.fillMat(0.1, 0.04);
  },
  tnt_bottom: (t, rng) => {
    forEach((x, y) => { t.set(x, y, shade(hex(0xc9291b), 0.75 + rng() * 0.2), 0); t.h(x, y, 0.6); });
    t.fillMat(0.1, 0.04);
  },
  pumpkin_side: (t, rng) => {
    forEach((x, y) => {
      const ridge = x % 4 === 0;
      const v = (ridge ? 0.1 : 0.45) + rng() * 0.35 + (y === 0 || y === 15 ? -0.15 : 0);
      t.set(x, y, pick(pal(0x9a5410, 0xb46414, 0xc8741a, 0xd98422, 0xe8952c), v), 0);
      t.h(x, y, ridge ? 0.2 : 0.7);
    });
    t.fillMat(0.3, 0.04, 0.1);
    t.normalStrength = 1.5;
  },
  pumpkin_top: (t, rng) => {
    forEach((x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const v = 0.3 + rng() * 0.4 - d * 0.02;
      t.set(x, y, pick(pal(0x9a5410, 0xb46414, 0xc8741a, 0xd98422), v), 0);
      t.h(x, y, 0.6);
    });
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8], [8, 6]]) { t.set(x, y, hex(0x4a5a1e), 0); t.h(x, y, 0.95); }
    t.fillMat(0.3, 0.04);
  },
  jack_o_lantern: (t, rng) => {
    GENERATORS.pumpkin_side!(t, rng);
    const glow = pal(0xffa51f, 0xffc23a, 0xffdd6a, 0xfff09a);
    const carve = (x: number, y: number) => {
      t.set(x, y, pick(glow, rng()), 0);
      t.h(x, y, 0.05);
      t.mat(x, y, 0.2, 0.04, 0, 1.0);
    };
    // eyes
    for (const [x0] of [[3], [10]]) {
      for (let y = 4; y <= 6; y++) for (let x = x0; x <= x0 + 2; x++) if (y - 4 >= Math.abs(x - x0 - 1)) carve(x, y);
    }
    // mouth
    for (let x = 3; x <= 12; x++) { carve(x, 10); if (x !== 5 && x !== 9) carve(x, 11); if (x > 4 && x < 11) carve(x, 12); }
    t.set(5, 10, hex(0xc8741a)); t.set(9, 10, hex(0xc8741a));
  },
  torch: (t, rng) => {
    plantBase(t);
    for (let y = 6; y < 16; y++) for (let x = 7; x <= 8; x++) {
      t.set(x, y, pick(pal(0x5a3a18, 0x6b4a26, 0x86602f), rng()));
      t.h(x, y, 0.7);
      t.mat(x, y, 0.2, 0.04, 0, 0);
    }
    const flame: Array<[number, number, number]> = [[7, 6, 0xffe8a0], [8, 6, 0xffd46a], [7, 7, 0xffffe0], [8, 7, 0xfff0b0], [7, 8, 0xffb43a], [8, 8, 0xff9a2a], [7, 5, 0xffc050], [8, 5, 0xffe070]];
    for (const [x, y, c] of flame) { t.set(x, y, hex(c)); t.mat(x, y, 0.2, 0.04, 0, 1.0); t.h(x, y, 0.9); }
  },
  tall_grass: (t, rng) => {
    plantBase(t);
    for (let k = 0; k < 9; k++) {
      let x = 1 + rng() * 14;
      const hgt = 7 + Math.floor(rng() * 8);
      const lean = (rng() - 0.5) * 0.35;
      for (let i = 0; i < hgt; i++) {
        const y = 15 - i;
        t.set(Math.floor(x), y, grey(0.45 + (i / hgt) * 0.35 + rng() * 0.1));
        t.h(Math.floor(x), y, 0.5 + (i / hgt) * 0.4);
        x += lean + (rng() - 0.5) * 0.3;
        if (x < 0) x = 0; if (x > 15.9) x = 15.9;
      }
    }
  },
  fern: (t, rng) => {
    plantBase(t);
    for (const [sx, lean] of [[5, -0.35], [10, 0.3], [8, 0.02]] as Array<[number, number]>) {
      let x = sx;
      for (let i = 0; i < 13; i++) {
        const y = 15 - i;
        const xi = Math.floor(x);
        t.set(xi, y, grey(0.4 + i * 0.03));
        if (i > 2 && i % 2 === 0) {
          const len = Math.max(1, 3 - Math.floor(i / 5));
          for (let k = 1; k <= len; k++) { t.set(xi - k, y + (k > 1 ? 1 : 0), grey(0.5 + rng() * 0.2)); t.set(xi + k, y + (k > 1 ? 1 : 0), grey(0.5 + rng() * 0.2)); }
        }
        x += lean;
      }
    }
  },
  dandelion: (t, rng) => flower(t, rng, pal(0xd8b000, 0xf2d000, 0xffe830, 0xfff27a), null, 'round'),
  poppy: (t, rng) => flower(t, rng, pal(0x8a0a0a, 0xb81414, 0xde2020, 0xf04040), hex(0x1a1a1a), 'cup'),
  blue_orchid: (t, rng) => flower(t, rng, pal(0x1a8ad0, 0x2aa8e8, 0x54c4f5, 0x9ae0ff), null, 'round'),
  allium: (t, rng) => flower(t, rng, pal(0x7a2aa8, 0x9a44c8, 0xb866e0, 0xd89af5), null, 'ball'),
  oxeye_daisy: (t, rng) => flower(t, rng, pal(0xd8d8d8, 0xeaeaea, 0xf6f6f6, 0xffffff), hex(0xe8c020), 'round'),
  cornflower: (t, rng) => flower(t, rng, pal(0x2a3a9a, 0x3a50c0, 0x506ae0, 0x7a92f5), null, 'spike'),
  dead_bush: (t, rng) => {
    plantBase(t);
    const branch = (x: number, y: number, dx: number, len: number) => {
      for (let i = 0; i < len; i++) {
        t.set(Math.round(x), Math.round(y), pick(pal(0x5a3a1e, 0x6b4a26, 0x7a5a30), rng()));
        x += dx; y -= 1;
      }
    };
    branch(7, 15, 0, 6); branch(7, 12, -0.7, 6); branch(8, 11, 0.8, 6); branch(7, 9, -0.2, 6); branch(5, 11, -0.3, 3);
    t.fillMat(0.1, 0.04, 0.2);
  },
  cactus_side: (t, rng) => {
    plantBase(t);
    for (let y = 0; y < 16; y++) for (let x = 1; x < 15; x++) {
      const stripe = x % 3 === 1;
      let c = pick(pal(0x0b4a14, 0x0f5f1c, 0x137324, 0x18872c), (stripe ? 0.75 : 0.35) + rng() * 0.25);
      if (x === 1 || x === 14) c = shade(c, 0.75);
      t.set(x, y, c);
      t.h(x, y, stripe ? 0.8 : 0.5);
    }
    for (let k = 0; k < 10; k++) {
      const x = 2 + Math.floor(rng() * 12), y = Math.floor(rng() * 16);
      t.set(x, y, hex(0xd8d8b0)); t.h(x, y, 1);
    }
    t.fillMat(0.3, 0.04, 0.2);
  },
  cactus_top: (t, rng) => {
    forEach((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const v = (Math.floor(d) % 2 ? 0.7 : 0.35) + rng() * 0.2;
      t.set(x, y, pick(pal(0x0f5f1c, 0x137324, 0x18872c, 0x2a9a3a), v), 255);
      t.h(x, y, 0.4 + v * 0.3);
    });
    t.cutout = true;
    t.fillMat(0.3, 0.04, 0.2);
  },
  cactus_bottom: (t, rng) => {
    forEach((x, y) => { t.set(x, y, pick(pal(0x0f5f1c, 0x137324, 0x18872c), rng()), 255); t.h(x, y, 0.5); });
    t.cutout = true;
    t.fillMat(0.3, 0.04, 0.2);
  },
  sugar_cane: (t, rng) => {
    plantBase(t);
    for (const sx of [3, 8, 12]) {
      for (let y = 0; y < 16; y++) {
        const joint = (y + sx) % 5 === 0;
        const c = joint ? hex(0x5e8a2e) : pick(pal(0x86c25a, 0x94d066, 0xa6dc78), rng());
        t.set(sx, y, c); t.set(sx + 1, y, shade(c, 0.85));
        t.h(sx, y, 0.8); t.h(sx + 1, y, 0.7);
      }
    }
    t.set(5, 6, hex(0x7ab848)); t.set(6, 5, hex(0x7ab848)); t.set(10, 9, hex(0x7ab848)); t.set(11, 8, hex(0x7ab848));
  },
  red_mushroom: (t, rng) => {
    plantBase(t);
    for (let y = 10; y < 16; y++) { t.set(7, y, hex(0xe0d8c8)); t.set(8, y, hex(0xd0c8b8)); }
    for (let y = 5; y <= 10; y++) for (let x = 4; x <= 11; x++) {
      const d = Math.hypot(x - 7.5, (y - 9) * 1.4);
      if (d < 4 && y <= 9) { t.set(x, y, rng() < 0.2 ? hex(0xf0f0f0) : pick(pal(0xa01010, 0xc81818, 0xe02424), rng())); t.h(x, y, 0.9 - d * 0.1); }
    }
    t.fillMat(0.4, 0.04, 0.3);
  },
  brown_mushroom: (t, rng) => {
    plantBase(t);
    for (let y = 11; y < 16; y++) { t.set(7, y, hex(0xd8ccb4)); t.set(8, y, hex(0xc8bca4)); }
    for (let y = 8; y <= 11; y++) for (let x = 3; x <= 12; x++) {
      const d = Math.hypot(x - 7.5, (y - 11) * 2);
      if (d < 5 && y <= 10) { t.set(x, y, pick(pal(0x7a5a3a, 0x8f6c48, 0xa07a52), rng())); t.h(x, y, 0.8); }
    }
    t.fillMat(0.3, 0.04, 0.3);
  },
};

function destroyStage(t: TexData, stage: number) {
  const rng = mulberry32(12345);
  t.cutout = true;
  forEach((x, y) => t.set(x, y, [0, 0, 0], 0));
  const cracks = 3 + stage * 2;
  const len = 3 + stage;
  for (let k = 0; k < cracks; k++) {
    let x = 7.5 + (rng() - 0.5) * 4, y = 7.5 + (rng() - 0.5) * 4;
    let a = rng() * Math.PI * 2;
    for (let i = 0; i < len; i++) {
      t.set(Math.floor(x), Math.floor(y), [40, 40, 40], 255);
      a += (rng() - 0.5) * 1.2;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
}

// ---------------------------------------------------------------------------
// Build + mip generation
// ---------------------------------------------------------------------------

export interface TextureSet {
  count: number;
  levels: number;
  /** Per-mip RGBA8 data for all layers: [level][layer*size*size*4] */
  albedo: Uint8Array[];
  normal: Uint8Array[];
  specular: Uint8Array[];
  /** Raw level-0 texture data per name (for UI icons). */
  byName: Map<string, TexData>;
  cutout: boolean[];
}

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linToSrgb8(v: number): number {
  v = Math.max(0, Math.min(1, v));
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

function buildNormal(t: TexData): Uint8Array {
  const out = new Uint8Array(N * 4);
  const s = t.normalStrength * 2.2;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      // Only derive normals from opaque neighbours in cutout textures.
      const hl = t.hGet(x - 1, y), hr = t.hGet(x + 1, y), hu = t.hGet(x, y - 1), hd = t.hGet(x, y + 1);
      let nx = -(hr - hl) * s, ny = -(hd - hu) * s;
      if (t.cutout) { nx *= 0.5; ny *= 0.5; }
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      out[i * 4] = Math.round((nx / l * 0.5 + 0.5) * 255);
      out[i * 4 + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = Math.round((nz / l * 0.5 + 0.5) * 255);
      out[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, t.height[i])) * 255);
    }
  }
  return out;
}

function buildSpecular(t: TexData): Uint8Array {
  const out = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    out[i * 4] = Math.round(Math.max(0, Math.min(1, t.smooth[i])) * 255);
    out[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, t.f0[i])) * 255);
    out[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, t.sss[i])) * 255);
    out[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, t.emit[i])) * 255);
  }
  return out;
}

/** Downsamples one RGBA8 layer by 2×. mode: 'albedo' (sRGB, alpha-weighted), 'normal', 'linear'. */
function downsample(src: Uint8Array, size: number, mode: 'albedo' | 'normal' | 'linear', cutout: boolean): Uint8Array {
  const h = size >> 1;
  const out = new Uint8Array(h * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < h; x++) {
      const idx = [((2 * y) * size + 2 * x) * 4, ((2 * y) * size + 2 * x + 1) * 4, ((2 * y + 1) * size + 2 * x) * 4, ((2 * y + 1) * size + 2 * x + 1) * 4];
      const o = (y * h + x) * 4;
      if (mode === 'albedo') {
        let r = 0, g = 0, b = 0, wsum = 0, a = 0;
        for (const i of idx) {
          const w = cutout ? src[i + 3] / 255 + 1e-4 : 1;
          r += SRGB_TO_LIN[src[i]] * w; g += SRGB_TO_LIN[src[i + 1]] * w; b += SRGB_TO_LIN[src[i + 2]] * w;
          wsum += w; a += src[i + 3];
        }
        out[o] = linToSrgb8(r / wsum); out[o + 1] = linToSrgb8(g / wsum); out[o + 2] = linToSrgb8(b / wsum);
        out[o + 3] = Math.round(a / 4);
      } else if (mode === 'normal') {
        let nx = 0, ny = 0, nz = 0, a = 0;
        for (const i of idx) { nx += src[i] / 127.5 - 1; ny += src[i + 1] / 127.5 - 1; nz += src[i + 2] / 127.5 - 1; a += src[i + 3]; }
        const l = Math.hypot(nx, ny, nz) || 1;
        out[o] = Math.round((nx / l * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
        out[o + 2] = Math.round((nz / l * 0.5 + 0.5) * 255); out[o + 3] = Math.round(a / 4);
      } else {
        for (let c = 0; c < 4; c++) out[o + c] = Math.round((src[idx[0] + c] + src[idx[1] + c] + src[idx[2] + c] + src[idx[3] + c]) / 4);
      }
    }
  }
  return out;
}

/** Rescales alpha of a cutout mip so its coverage (alpha >= 0.5) matches the base level. */
function preserveCoverage(mip: Uint8Array, target: number) {
  const n = mip.length / 4;
  const coverage = (scale: number) => {
    let c = 0;
    for (let i = 0; i < n; i++) if (mip[i * 4 + 3] * scale >= 127.5) c++;
    return c / n;
  };
  let lo = 0.5, hi = 4;
  for (let it = 0; it < 12; it++) {
    const mid = (lo + hi) / 2;
    if (coverage(mid) < target) lo = mid; else hi = mid;
  }
  const s = (lo + hi) / 2;
  for (let i = 0; i < n; i++) mip[i * 4 + 3] = Math.min(255, Math.round(mip[i * 4 + 3] * s));
}

export function buildTextures(): TextureSet {
  const count = TEXTURE_NAMES.length;
  const levels = Math.log2(TEX) + 1;
  const albedo: Uint8Array[] = [], normal: Uint8Array[] = [], specular: Uint8Array[] = [];
  for (let l = 0; l < levels; l++) {
    const s = TEX >> l;
    albedo.push(new Uint8Array(s * s * 4 * count));
    normal.push(new Uint8Array(s * s * 4 * count));
    specular.push(new Uint8Array(s * s * 4 * count));
  }
  const byName = new Map<string, TexData>();
  const cutoutFlags: boolean[] = [];

  TEXTURE_NAMES.forEach((name, layer) => {
    const t = new TexData();
    const rng = mulberry32(hashStr(name));
    if (name.startsWith('destroy_')) destroyStage(t, parseInt(name.slice(8), 10));
    else {
      const gen = GENERATORS[name];
      if (gen) gen(t, rng);
      else forEach((x, y) => t.set(x, y, (x + y) % 2 ? [255, 0, 255] : [0, 0, 0], 0));
    }
    byName.set(name, t);
    cutoutFlags.push(t.cutout);

    let a: Uint8Array = new Uint8Array(t.rgba);
    let n: Uint8Array = buildNormal(t);
    let s: Uint8Array = buildSpecular(t);
    // Base coverage for cutouts.
    let baseCoverage = 0;
    if (t.cutout) {
      for (let i = 0; i < N; i++) if (a[i * 4 + 3] >= 128) baseCoverage++;
      baseCoverage /= N;
    }
    for (let l = 0; l < levels; l++) {
      const size = TEX >> l;
      const stride = size * size * 4;
      albedo[l].set(a, layer * stride);
      normal[l].set(n, layer * stride);
      specular[l].set(s, layer * stride);
      if (l + 1 < levels) {
        a = downsample(a, size, 'albedo', t.cutout);
        if (t.cutout) preserveCoverage(a, baseCoverage);
        n = downsample(n, size, 'normal', t.cutout);
        s = downsample(s, size, 'linear', t.cutout);
      }
    }
  });

  return { count, levels, albedo, normal, specular, byName, cutout: cutoutFlags };
}
