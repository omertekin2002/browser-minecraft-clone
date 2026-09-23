import { SimplexNoise, hash2, hash3, mulberry32, smoothstep, lerp, clamp } from './noise';
import * as B from '../blocks';
import { CHUNK_VOLUME, SEA_LEVEL } from '../constants';

export const enum Biome {
  OCEAN, DEEP_OCEAN, FROZEN_OCEAN, RIVER, FROZEN_RIVER, BEACH, SNOWY_BEACH,
  DESERT, SAVANNA, PLAINS, MEADOW, FOREST, BIRCH_FOREST, DARK_FOREST,
  TAIGA, SNOWY_TAIGA, SNOWY_PLAINS, MOUNTAINS, SNOWY_PEAKS,
}

export const BIOME_NAMES = [
  'Ocean', 'Deep Ocean', 'Frozen Ocean', 'River', 'Frozen River', 'Beach', 'Snowy Beach',
  'Desert', 'Savanna', 'Plains', 'Meadow', 'Forest', 'Birch Forest', 'Dark Forest',
  'Taiga', 'Snowy Taiga', 'Snowy Plains', 'Mountains', 'Snowy Peaks',
];

const enum TreeKind { NONE, OAK, BIRCH, SPRUCE, CACTUS, BIG_OAK }

/** Per-biome decoration parameters. */
interface BiomeInfo {
  tree: number; // probability per tree cell
  grass: number; // tall grass chance per column
  flowers: number; // flower chance inside flower patches
  frozen: boolean;
}

const BIOME_INFO: Record<number, BiomeInfo> = {
  [Biome.OCEAN]: { tree: 0, grass: 0, flowers: 0, frozen: false },
  [Biome.DEEP_OCEAN]: { tree: 0, grass: 0, flowers: 0, frozen: false },
  [Biome.FROZEN_OCEAN]: { tree: 0, grass: 0, flowers: 0, frozen: true },
  [Biome.RIVER]: { tree: 0, grass: 0.1, flowers: 0, frozen: false },
  [Biome.FROZEN_RIVER]: { tree: 0, grass: 0, flowers: 0, frozen: true },
  [Biome.BEACH]: { tree: 0, grass: 0, flowers: 0, frozen: false },
  [Biome.SNOWY_BEACH]: { tree: 0, grass: 0, flowers: 0, frozen: true },
  [Biome.DESERT]: { tree: 0.05, grass: 0, flowers: 0, frozen: false },
  [Biome.SAVANNA]: { tree: 0.05, grass: 0.45, flowers: 0.02, frozen: false },
  [Biome.PLAINS]: { tree: 0.035, grass: 0.4, flowers: 0.05, frozen: false },
  [Biome.MEADOW]: { tree: 0.015, grass: 0.45, flowers: 0.35, frozen: false },
  [Biome.FOREST]: { tree: 0.7, grass: 0.22, flowers: 0.06, frozen: false },
  [Biome.BIRCH_FOREST]: { tree: 0.65, grass: 0.28, flowers: 0.08, frozen: false },
  [Biome.DARK_FOREST]: { tree: 0.9, grass: 0.12, flowers: 0.02, frozen: false },
  [Biome.TAIGA]: { tree: 0.6, grass: 0.2, flowers: 0.01, frozen: false },
  [Biome.SNOWY_TAIGA]: { tree: 0.45, grass: 0.03, flowers: 0, frozen: true },
  [Biome.SNOWY_PLAINS]: { tree: 0.02, grass: 0.02, flowers: 0, frozen: true },
  [Biome.MOUNTAINS]: { tree: 0.08, grass: 0.12, flowers: 0.01, frozen: false },
  [Biome.SNOWY_PEAKS]: { tree: 0, grass: 0, flowers: 0, frozen: true },
};

/** Cached per-grid-column data (4-block horizontal spacing). */
interface GridColumn {
  dens: Float32Array; // 33 samples, 8-block vertical spacing
  cave: Float32Array; // 65 samples, 4-block vertical spacing
  cont: number;
  mountain: number;
  river: number;
  height: number;
}

interface TreeSpec {
  x: number; y: number; z: number;
  kind: TreeKind;
  height: number;
  seed: number;
}

const TREE_CELL = 4;
const TREE_JITTER = 3;
const TREE_REACH = 3; // max horizontal leaf radius

const ORES: Array<[number, number, number, number, number]> = [
  // block, veins per chunk, minY, maxY, size
  [B.COAL_ORE, 18, 5, 130, 10],
  [B.IRON_ORE, 12, 5, 70, 7],
  [B.GOLD_ORE, 3, 5, 34, 7],
  [B.REDSTONE_ORE, 5, 5, 18, 6],
  [B.LAPIS_ORE, 2, 5, 32, 5],
  [B.DIAMOND_ORE, 1.4, 5, 16, 5],
  [B.GRAVEL, 5, 5, 110, 22],
  [B.DIRT, 5, 5, 110, 22],
  [B.CLAY, 1, 30, 62, 12],
];

const STONE_VARIANTS = [B.GRANITE, B.DIORITE, B.ANDESITE];

export class TerrainGenerator {
  readonly seed: number;
  private nCont: SimplexNoise;
  private nErosion: SimplexNoise;
  private nRidge: SimplexNoise;
  private nHills: SimplexNoise;
  private nRiver: SimplexNoise;
  private nWarp: SimplexNoise;
  private nTemp: SimplexNoise;
  private nHumid: SimplexNoise;
  private nDens: SimplexNoise;
  private nCaveA: SimplexNoise;
  private nCaveB: SimplexNoise;
  private nCaveW: SimplexNoise;
  private nCaveC: SimplexNoise;
  private nPatch: SimplexNoise;
  private gridCache = new Map<number, GridColumn>();

  constructor(seed: number) {
    this.seed = seed | 0;
    const s = this.seed;
    this.nCont = new SimplexNoise(s ^ 0x1001);
    this.nErosion = new SimplexNoise(s ^ 0x2002);
    this.nRidge = new SimplexNoise(s ^ 0x3003);
    this.nHills = new SimplexNoise(s ^ 0x4004);
    this.nRiver = new SimplexNoise(s ^ 0x5005);
    this.nWarp = new SimplexNoise(s ^ 0x6006);
    this.nTemp = new SimplexNoise(s ^ 0x7007);
    this.nHumid = new SimplexNoise(s ^ 0x8008);
    this.nDens = new SimplexNoise(s ^ 0x9009);
    this.nCaveA = new SimplexNoise(s ^ 0xa00a);
    this.nCaveB = new SimplexNoise(s ^ 0xb00b);
    this.nCaveW = new SimplexNoise(s ^ 0xc00c);
    this.nCaveC = new SimplexNoise(s ^ 0xd00d);
    this.nPatch = new SimplexNoise(s ^ 0xe00e);
  }

  // ------------------------------------------------------------------
  // 2D fields
  // ------------------------------------------------------------------

  /** Temperature and humidity in roughly [-1, 1]. */
  climate(x: number, z: number): [number, number] {
    const t = clamp(this.nTemp.fbm2(x / 1100, z / 1100, 3) * 1.8, -1, 1);
    const h = clamp(this.nHumid.fbm2(x / 900 + 300, z / 900, 3) * 1.8, -1, 1);
    return [t, h];
  }

  /** Tint index packed as (temperature byte, humidity byte). */
  tintIndex(x: number, z: number): number {
    const [t, h] = this.climate(x, z);
    const ti = clamp(Math.round((t * 0.5 + 0.5) * 255), 0, 255);
    const hi = clamp(Math.round((h * 0.5 + 0.5) * 255), 0, 255);
    return (ti << 8) | hi;
  }

  private shape(x: number, z: number): { height: number; amp: number; cont: number; mountain: number; river: number } {
    const c = this.nCont.fbm2(x / 1800, z / 1800, 5) * 1.4;
    const e = this.nErosion.fbm2(x / 1100 + 500, z / 1100, 4) * 1.4;
    const land = smoothstep(-0.42, -0.18, c);
    const oceanH = SEA_LEVEL - 7 - 22 * smoothstep(-0.45, -0.8, c);

    const hills = this.nHills.fbm2(x / 190, z / 190, 4);
    const hillAmp = lerp(14, 4, smoothstep(-0.3, 0.45, e));
    const inland = smoothstep(-0.15, 0.45, c);
    const mountain = smoothstep(-0.28, -0.7, e) * smoothstep(-0.25, 0.1, c);
    const ridge = 1 - Math.abs(this.nRidge.fbm2(x / 520, z / 520, 5));
    const peaks = mountain * (Math.pow(ridge, 2.6) * 120 + 22);
    let landH = SEA_LEVEL + 3 + 11 * inland + hills * hillAmp + peaks;

    // Meandering rivers carved into the land.
    const wx = x + 45 * this.nWarp.noise2D(x / 160, z / 160);
    const wz = z + 45 * this.nWarp.noise2D(x / 160 + 31.7, z / 160 - 11.3);
    const r = Math.abs(this.nRiver.fbm2(wx / 900, wz / 900, 2));
    const valley = 1 - smoothstep(0.0, 0.075, r);
    const bed = 1 - smoothstep(0.004, 0.016, r);
    const rw = land * (1 - mountain * 0.85);
    landH = lerp(landH, Math.min(landH, SEA_LEVEL + 2), valley * valley * rw);
    landH = lerp(landH, SEA_LEVEL - 5, bed * rw);

    const height = lerp(oceanH, landH, land);
    const amp = 2.5 + 4 * smoothstep(-0.2, -0.55, e) + 24 * mountain;
    return { height, amp, cont: c, mountain, river: bed * rw };
  }

  // ------------------------------------------------------------------
  // Grid columns (density + caves), shared by bulk fill and point queries
  // ------------------------------------------------------------------

  private column(gx: number, gz: number): GridColumn {
    const key = (gx + 1048576) * 2097152 + (gz + 1048576);
    const hit = this.gridCache.get(key);
    if (hit) return hit;
    if (this.gridCache.size > 30000) this.gridCache.clear();

    const x = gx * 4, z = gz * 4;
    const s = this.shape(x, z);
    const dens = new Float32Array(33);
    const band = s.amp * 1.6 + 10;
    for (let gy = 0; gy < 33; gy++) {
      const y = gy * 8;
      let d = s.height - y;
      if (Math.abs(d) < band) {
        const n = this.nDens.fbm3(x / 110, y / 72, z / 110, 3);
        d += n * s.amp;
      }
      dens[gy] = d;
    }
    const cave = new Float32Array(65);
    const topGuess = s.height + s.amp + 4;
    for (let gy = 0; gy < 65; gy++) {
      const y = gy * 4;
      cave[gy] = y > topGuess + 8 ? 1 : this.caveField(x, y, z);
    }
    const col: GridColumn = { dens, cave, cont: s.cont, mountain: s.mountain, river: s.river, height: s.height };
    this.gridCache.set(key, col);
    return col;
  }

  private caveField(x: number, y: number, z: number): number {
    if (y < 5) return 1;
    const a = this.nCaveA.noise3D(x / 70, y / 46, z / 70);
    const b = this.nCaveB.noise3D(x / 70, y / 46, z / 70);
    const w = 0.05 + 0.028 * this.nCaveW.noise3D(x / 160, y / 110, z / 160);
    let f = a * a + b * b - w * w;
    if (y < 58) {
      const c = this.nCaveC.noise3D(x / 110, y / 58, z / 110) + 0.35 * this.nCaveC.noise3D(x / 42 + 71, y / 30, z / 42);
      const thr = 0.82 - 0.22 * smoothstep(58, 18, y);
      f = Math.min(f, (thr - c) * 0.12);
    }
    return f;
  }

  private static tri(
    c00: Float32Array, c10: Float32Array, c01: Float32Array, c11: Float32Array,
    gy: number, fx: number, fy: number, fz: number,
  ): number {
    const a0 = c00[gy] + (c10[gy] - c00[gy]) * fx;
    const b0 = c01[gy] + (c11[gy] - c01[gy]) * fx;
    const a1 = c00[gy + 1] + (c10[gy + 1] - c00[gy + 1]) * fx;
    const b1 = c01[gy + 1] + (c11[gy + 1] - c01[gy + 1]) * fx;
    const v0 = a0 + (b0 - a0) * fz;
    const v1 = a1 + (b1 - a1) * fz;
    return v0 + (v1 - v0) * fy;
  }

  private static bilerp(a: number, b: number, c: number, d: number, fx: number, fz: number): number {
    const ab = a + (b - a) * fx;
    const cd = c + (d - c) * fx;
    return ab + (cd - ab) * fz;
  }

  /** Highest solid y of a column according to the density field (caves ignored). */
  private pointTop(x: number, z: number): number {
    const gx = Math.floor(x / 4), gz = Math.floor(z / 4);
    const fx = (x - gx * 4) * 0.25, fz = (z - gz * 4) * 0.25;
    const c00 = this.column(gx, gz).dens, c10 = this.column(gx + 1, gz).dens;
    const c01 = this.column(gx, gz + 1).dens, c11 = this.column(gx + 1, gz + 1).dens;
    for (let gy = 31; gy >= 0; gy--) {
      const m = Math.max(c00[gy], c10[gy], c01[gy], c11[gy], c00[gy + 1], c10[gy + 1], c01[gy + 1], c11[gy + 1]);
      if (m <= 0) continue;
      for (let dy = 7; dy >= 0; dy--) {
        if (TerrainGenerator.tri(c00, c10, c01, c11, gy, fx, dy * 0.125, fz) > 0) return gy * 8 + dy;
      }
    }
    return 0;
  }

  private pointCave(x: number, y: number, z: number): boolean {
    const gx = Math.floor(x / 4), gz = Math.floor(z / 4);
    const fx = (x - gx * 4) * 0.25, fz = (z - gz * 4) * 0.25;
    const gy = y >> 2;
    const fy = (y & 3) * 0.25;
    const v = TerrainGenerator.tri(
      this.column(gx, gz).cave, this.column(gx + 1, gz).cave,
      this.column(gx, gz + 1).cave, this.column(gx + 1, gz + 1).cave, gy, fx, fy, fz);
    return v < 0;
  }

  private columnFactors(x: number, z: number): { cont: number; mountain: number; river: number } {
    const gx = Math.floor(x / 4), gz = Math.floor(z / 4);
    const fx = (x - gx * 4) * 0.25, fz = (z - gz * 4) * 0.25;
    const a = this.column(gx, gz), b = this.column(gx + 1, gz), c = this.column(gx, gz + 1), d = this.column(gx + 1, gz + 1);
    return {
      cont: TerrainGenerator.bilerp(a.cont, b.cont, c.cont, d.cont, fx, fz),
      mountain: TerrainGenerator.bilerp(a.mountain, b.mountain, c.mountain, d.mountain, fx, fz),
      river: TerrainGenerator.bilerp(a.river, b.river, c.river, d.river, fx, fz),
    };
  }

  decideBiome(t: number, h: number, top: number, cont: number, mountain: number, river: number): Biome {
    const tAdj = t - Math.max(0, top - 100) * 0.013;
    const frozen = tAdj < -0.64;
    if (top < SEA_LEVEL - 1) {
      if (river > 0.25 && cont > -0.12) return frozen ? Biome.FROZEN_RIVER : Biome.RIVER;
      if (frozen) return Biome.FROZEN_OCEAN;
      return top < SEA_LEVEL - 14 ? Biome.DEEP_OCEAN : Biome.OCEAN;
    }
    if (top <= SEA_LEVEL + 2 && mountain < 0.3) {
      if (river > 0.12) return frozen ? Biome.FROZEN_RIVER : Biome.RIVER;
      if (cont < -0.1) return frozen ? Biome.SNOWY_BEACH : Biome.BEACH;
    }
    if (top > 140 || (mountain > 0.55 && top > 108)) {
      return tAdj < -0.15 || top > 152 ? Biome.SNOWY_PEAKS : Biome.MOUNTAINS;
    }
    if (frozen) return h > 0.0 ? Biome.SNOWY_TAIGA : Biome.SNOWY_PLAINS;
    if (tAdj < -0.36) return h > -0.25 ? Biome.TAIGA : Biome.PLAINS;
    if (tAdj > 0.46) {
      if (h < 0.0) return Biome.DESERT;
      if (h < 0.3) return Biome.SAVANNA;
      return Biome.DARK_FOREST;
    }
    if (h > 0.5) return Biome.DARK_FOREST;
    if (h > 0.18) return Biome.FOREST;
    if (h > 0.0) return Biome.BIRCH_FOREST;
    if (h > -0.28) return Biome.PLAINS;
    if (h > -0.5) return Biome.MEADOW;
    return Biome.PLAINS;
  }

  /** Biome at a world column (used by the debug overlay). */
  biomeAt(x: number, z: number): Biome {
    x = Math.floor(x); z = Math.floor(z);
    const top = this.pointTop(x, z);
    const [t, h] = this.climate(x, z);
    const f = this.columnFactors(x, z);
    return this.decideBiome(t, h, top, f.cont, f.mountain, f.river);
  }

  /** Approximate spawn height at a column. */
  surfaceHeight(x: number, z: number): number {
    return this.pointTop(Math.floor(x), Math.floor(z));
  }

  // ------------------------------------------------------------------
  // Trees (deterministic across chunk borders)
  // ------------------------------------------------------------------

  private treeInCell(cellX: number, cellZ: number): TreeSpec | null {
    const h = hash2(cellX, cellZ, this.seed + 1013);
    const tx = cellX * TREE_CELL + (h % TREE_JITTER);
    const tz = cellZ * TREE_CELL + ((h >>> 8) % TREE_JITTER);
    const r = ((h >>> 16) & 0xffff) / 65536;
    if (r > 0.9) return null; // no biome is denser than 0.9
    const [t, hum] = this.climate(tx, tz);
    const f = this.columnFactors(tx, tz);
    // Cheap pre-reject: ocean / beach areas never have trees.
    if (f.cont < -0.45) return null;
    const top = this.pointTop(tx, tz);
    if (top <= SEA_LEVEL || top > 200) return null;
    const biome = this.decideBiome(t, hum, top, f.cont, f.mountain, f.river);
    const info = BIOME_INFO[biome];
    if (r >= info.tree) return null;
    if (this.pointCave(tx, top, tz) || this.pointCave(tx, top + 1, tz)) return null;
    const h2 = hash2(tx, tz, this.seed + 7717);
    const r2 = (h2 & 0xffff) / 65536;
    let kind: TreeKind;
    switch (biome) {
      case Biome.DESERT: kind = TreeKind.CACTUS; break;
      case Biome.BIRCH_FOREST: kind = r2 < 0.85 ? TreeKind.BIRCH : TreeKind.OAK; break;
      case Biome.FOREST: kind = r2 < 0.3 ? TreeKind.BIRCH : r2 < 0.38 ? TreeKind.BIG_OAK : TreeKind.OAK; break;
      case Biome.DARK_FOREST: kind = r2 < 0.35 ? TreeKind.BIG_OAK : TreeKind.OAK; break;
      case Biome.TAIGA: case Biome.SNOWY_TAIGA: case Biome.SNOWY_PLAINS: case Biome.MOUNTAINS:
        kind = TreeKind.SPRUCE; break;
      default: kind = r2 < 0.12 ? TreeKind.BIG_OAK : TreeKind.OAK;
    }
    const hr = (h2 >>> 16) / 65536;
    let height = 5;
    switch (kind) {
      case TreeKind.OAK: height = 4 + Math.floor(hr * 3); break;
      case TreeKind.BIG_OAK: height = 6 + Math.floor(hr * 3); break;
      case TreeKind.BIRCH: height = 5 + Math.floor(hr * 3); break;
      case TreeKind.SPRUCE: height = 7 + Math.floor(hr * 5); break;
      case TreeKind.CACTUS: height = 1 + Math.floor(hr * 3); break;
    }
    return { x: tx, y: top + 1, z: tz, kind, height, seed: h2 };
  }

  private placeTree(blocks: Uint8Array, x0: number, z0: number, t: TreeSpec): void {
    const set = (x: number, y: number, z: number, id: number, force: boolean) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y > 255) return;
      const i = (y << 8) | (lz << 4) | lx;
      const cur = blocks[i];
      if (force) {
        if (cur === B.AIR || B.BLOCKS[cur].replaceable || cur === B.OAK_LEAVES || cur === B.BIRCH_LEAVES || cur === B.SPRUCE_LEAVES) blocks[i] = id;
      } else if (cur === B.AIR || (B.BLOCKS[cur].replaceable && !B.BLOCKS[cur].liquid)) {
        blocks[i] = id;
      }
    };
    const rng = mulberry32(t.seed);
    const { x, y, z, height } = t;

    if (t.kind === TreeKind.CACTUS) {
      for (let i = 0; i < height; i++) set(x, y + i, z, B.CACTUS, true);
      return;
    }

    // Soil under the trunk.
    const lx = x - x0, lz = z - z0;
    if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && y > 0) {
      const i = ((y - 1) << 8) | (lz << 4) | lx;
      if (blocks[i] === B.GRASS || blocks[i] === B.SNOWY_GRASS) blocks[i] = B.DIRT;
    }

    if (t.kind === TreeKind.SPRUCE) {
      const top = y + height;
      // Conical canopy of alternating tiers: radii 0,1,0,1,2,1,2,3,1,2,3...
      let radius = 0;
      let maxR = 1;
      for (let yy = top; yy >= y + 2; yy--) {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
            set(x + dx, yy, z + dz, B.SPRUCE_LEAVES, false);
          }
        }
        radius++;
        if (radius > maxR) {
          radius = maxR >= 2 ? 1 : 0;
          maxR = Math.min(3, maxR + 1);
        }
      }
      set(x, top + 1, z, B.SPRUCE_LEAVES, false);
      for (let i = 0; i < height; i++) set(x, y + i, z, B.SPRUCE_LOG, true);
      return;
    }

    const log = t.kind === TreeKind.BIRCH ? B.BIRCH_LOG : B.OAK_LOG;
    const leaves = t.kind === TreeKind.BIRCH ? B.BIRCH_LEAVES : B.OAK_LEAVES;
    const top = y + height - 1;

    if (t.kind === TreeKind.BIG_OAK) {
      // Rounded blob canopy with a few branches.
      const cy = top - 1;
      const R = 3;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          for (let dz = -R; dz <= R; dz++) {
            const d = dx * dx + dz * dz + dy * dy * 1.8;
            if (d > R * R + 1 - rng() * 2.5) continue;
            set(x + dx, cy + dy, z + dz, leaves, false);
          }
        }
      }
      for (let i = 0; i < 3; i++) {
        const ang = rng() * Math.PI * 2;
        const bx = Math.round(Math.cos(ang) * 2), bz = Math.round(Math.sin(ang) * 2);
        set(x + bx, cy - 1, z + bz, log, true);
      }
      for (let i = 0; i < height; i++) set(x, y + i, z, log, true);
      return;
    }

    // Classic oak / birch canopy.
    for (let dy = -3; dy <= 0; dy++) {
      const yy = top + dy + 1;
      const r = dy >= -1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r) {
            if (dy === 0 || rng() < 0.5) continue;
          }
          set(x + dx, yy, z + dz, leaves, false);
        }
      }
    }
    for (let i = 0; i < height; i++) set(x, y + i, z, log, true);
  }

  // ------------------------------------------------------------------
  // Chunk generation
  // ------------------------------------------------------------------

  generate(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const x0 = cx * 16, z0 = cz * 16;
    const gx0 = cx * 4, gz0 = cz * 4;

    const cols: GridColumn[] = new Array(25);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) cols[j * 5 + i] = this.column(gx0 + i, gz0 + j);

    const tops = new Int16Array(256);
    const biomes = new Uint8Array(256);

    // --- 1. density fill + caves ---
    for (let lz = 0; lz < 16; lz++) {
      const gzi = lz >> 2, fz = (lz & 3) * 0.25;
      for (let lx = 0; lx < 16; lx++) {
        const gxi = lx >> 2, fx = (lx & 3) * 0.25;
        const a = cols[gzi * 5 + gxi], b = cols[gzi * 5 + gxi + 1];
        const c = cols[(gzi + 1) * 5 + gxi], d = cols[(gzi + 1) * 5 + gxi + 1];
        let top = 0;
        for (let gy = 31; gy >= 0; gy--) {
          const m = Math.max(a.dens[gy], b.dens[gy], c.dens[gy], d.dens[gy], a.dens[gy + 1], b.dens[gy + 1], c.dens[gy + 1], d.dens[gy + 1]);
          const mn = Math.min(a.dens[gy], b.dens[gy], c.dens[gy], d.dens[gy], a.dens[gy + 1], b.dens[gy + 1], c.dens[gy + 1], d.dens[gy + 1]);
          if (m <= 0) continue;
          for (let dy = 7; dy >= 0; dy--) {
            const y = gy * 8 + dy;
            const solid = mn > 0 || TerrainGenerator.tri(a.dens, b.dens, c.dens, d.dens, gy, fx, dy * 0.125, fz) > 0;
            if (solid) {
              blocks[(y << 8) | (lz << 4) | lx] = B.STONE;
              if (y > top) top = y;
            }
          }
        }
        tops[lz * 16 + lx] = top;

        // Caves: keep ocean/river floors sealed.
        const underwater = top < SEA_LEVEL + 1;
        const caveCeil = underwater ? top - 7 : top + 1;
        for (let y = 5; y <= caveCeil && y < 256; y++) {
          const i = (y << 8) | (lz << 4) | lx;
          if (blocks[i] === B.AIR) continue;
          const v = TerrainGenerator.tri(a.cave, b.cave, c.cave, d.cave, y >> 2, fx, (y & 3) * 0.25, fz);
          if (v < 0) blocks[i] = y <= 10 ? B.LAVA : B.AIR;
        }
        // Bedrock.
        blocks[(0 << 8) | (lz << 4) | lx] = B.BEDROCK;
        const hb = hash2(x0 + lx, z0 + lz, this.seed + 99);
        for (let y = 1; y <= 3; y++) if (((hb >>> (y * 3)) & 7) < 4 - y) blocks[(y << 8) | (lz << 4) | lx] = B.BEDROCK;
      }
    }

    // --- 2. surface decoration ---
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const top = tops[lz * 16 + lx];
        const [t, h] = this.climate(x, z);
        const f = this.columnFactors(x, z);
        const biome = this.decideBiome(t, h, top, f.cont, f.mountain, f.river);
        biomes[lz * 16 + lx] = biome;

        // Local slope from neighbouring tops (clamped at chunk borders).
        const tl = tops[lz * 16 + Math.max(0, lx - 1)], tr = tops[lz * 16 + Math.min(15, lx + 1)];
        const tu = tops[Math.max(0, lz - 1) * 16 + lx], td = tops[Math.min(15, lz + 1) * 16 + lx];
        const slope = Math.max(Math.abs(tr - tl), Math.abs(td - tu)) * 0.5;
        const patch = this.nPatch.noise2D(x / 18, z / 18);

        let topBlock = B.GRASS, filler = B.DIRT, depth = 3 + ((hash2(x, z, this.seed) >>> 5) & 1);
        let deepFiller = -1;
        switch (biome) {
          case Biome.OCEAN: case Biome.DEEP_OCEAN: case Biome.FROZEN_OCEAN:
            topBlock = top < SEA_LEVEL - 10 ? B.GRAVEL : patch > 0.45 ? B.CLAY : B.SAND;
            if (biome === Biome.DEEP_OCEAN && patch > -0.2) topBlock = B.GRAVEL;
            filler = topBlock === B.CLAY ? B.CLAY : topBlock; depth = 3;
            break;
          case Biome.RIVER: case Biome.FROZEN_RIVER:
            topBlock = patch > 0.5 ? B.CLAY : patch < -0.55 ? B.GRAVEL : B.SAND;
            if (top >= SEA_LEVEL) topBlock = biome === Biome.FROZEN_RIVER ? B.SNOWY_GRASS : B.GRASS;
            filler = topBlock === B.GRASS || topBlock === B.SNOWY_GRASS ? B.DIRT : topBlock; depth = 3;
            break;
          case Biome.BEACH: case Biome.SNOWY_BEACH:
            topBlock = B.SAND; filler = B.SAND; depth = 4; deepFiller = B.SANDSTONE;
            break;
          case Biome.DESERT:
            topBlock = B.SAND; filler = B.SAND; depth = 5; deepFiller = B.SANDSTONE;
            break;
          case Biome.SNOWY_PLAINS: case Biome.SNOWY_TAIGA:
            topBlock = B.SNOWY_GRASS;
            break;
          case Biome.MOUNTAINS:
            if (slope > 1.4 || patch > 0.55) { topBlock = B.STONE; filler = B.STONE; }
            else if (patch < -0.6) { topBlock = B.GRAVEL; filler = B.GRAVEL; }
            break;
          case Biome.SNOWY_PEAKS:
            if (slope > 2.2) { topBlock = B.STONE; filler = B.STONE; }
            else { topBlock = B.SNOW; filler = B.SNOW; depth = 2; }
            break;
          default:
            if (slope > 2.6 && f.mountain > 0.2) { topBlock = B.STONE; filler = B.STONE; }
        }

        // Replace the top solid run.
        let d = 0;
        for (let y = top; y > 4; y--) {
          const i = (y << 8) | (lz << 4) | lx;
          const cur = blocks[i];
          if (cur !== B.STONE) {
            if (d > 0) break; // hit a cave below the surface run
            continue;
          }
          if (d === 0) {
            // Grass cannot grow underwater.
            let tb = topBlock;
            if (y < SEA_LEVEL && (tb === B.GRASS || tb === B.SNOWY_GRASS)) tb = B.DIRT;
            blocks[i] = tb;
          } else if (d < depth) {
            blocks[i] = filler;
          } else if (deepFiller >= 0 && d < depth + 4) {
            blocks[i] = deepFiller;
          } else break;
          d++;
        }

        // Water and ice.
        if (top < SEA_LEVEL) {
          for (let y = top + 1; y <= SEA_LEVEL; y++) {
            const i = (y << 8) | (lz << 4) | lx;
            if (blocks[i] === B.AIR) blocks[i] = B.WATER;
          }
          if (BIOME_INFO[biome].frozen) blocks[(SEA_LEVEL << 8) | (lz << 4) | lx] = B.ICE;
        }
      }
    }

    // --- 3. ores ---
    const orng = mulberry32(hash2(cx, cz, this.seed + 4242));
    for (const [ore, per, minY, maxY, size] of ORES) {
      let count = Math.floor(per) + (orng() < per - Math.floor(per) ? 1 : 0);
      while (count-- > 0) {
        let x = Math.floor(orng() * 16), y = minY + Math.floor(orng() * (maxY - minY)), z = Math.floor(orng() * 16);
        const n = Math.max(1, Math.floor(size * (0.5 + orng() * 0.5)));
        for (let k = 0; k < n; k++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < 255) {
            const i = (y << 8) | (z << 4) | x;
            if (blocks[i] === B.STONE) blocks[i] = ore;
          }
          const dir = Math.floor(orng() * 6);
          if (dir === 0) x++; else if (dir === 1) x--; else if (dir === 2) y++; else if (dir === 3) y--; else if (dir === 4) z++; else z--;
        }
      }
    }
    // Emeralds in mountains.
    if (biomes[136] === Biome.MOUNTAINS || biomes[136] === Biome.SNOWY_PEAKS) {
      for (let k = 0; k < 4; k++) {
        const x = Math.floor(orng() * 16), y = 5 + Math.floor(orng() * 60), z = Math.floor(orng() * 16);
        const i = (y << 8) | (z << 4) | x;
        if (blocks[i] === B.STONE) blocks[i] = B.EMERALD_ORE;
      }
    }

    // Granite, diorite and andesite blobs. Seeded per chunk (with their own RNG, so ore placement
    // is unchanged) and written into neighbours too, so blobs are never cut at chunk borders.
    for (let nz = cz - 1; nz <= cz + 1; nz++) {
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        const vrng = mulberry32(hash2(nx, nz, this.seed + 9191));
        for (const kind of STONE_VARIANTS) {
          if (vrng() > 0.55) continue;
          const bx = nx * 16 + vrng() * 16 - x0, by = 8 + vrng() * 80, bz = nz * 16 + vrng() * 16 - z0;
          const rx = 2 + vrng() * 2.2, ry = 1.6 + vrng() * 1.6, rz = 2 + vrng() * 2.2;
          const lx0 = Math.max(0, Math.floor(bx - rx)), lx1 = Math.min(15, Math.ceil(bx + rx));
          const lz0 = Math.max(0, Math.floor(bz - rz)), lz1 = Math.min(15, Math.ceil(bz + rz));
          for (let y = Math.max(1, Math.floor(by - ry)); y <= Math.min(254, Math.ceil(by + ry)); y++) {
            for (let lz = lz0; lz <= lz1; lz++) {
              for (let lx = lx0; lx <= lx1; lx++) {
                const dx = (lx + 0.5 - bx) / rx, dy = (y + 0.5 - by) / ry, dz = (lz + 0.5 - bz) / rz;
                if (dx * dx + dy * dy + dz * dz > 1) continue;
                const i = (y << 8) | (lz << 4) | lx;
                if (blocks[i] === B.STONE) blocks[i] = kind;
              }
            }
          }
        }
      }
    }

    // Cobwebs clinging to some cave ceilings.
    const wrng = mulberry32(hash2(cx, cz, this.seed + 7171));
    if (wrng() < 0.14) {
      for (let tries = 0; tries < 40; tries++) {
        const x = 2 + Math.floor(wrng() * 12), y = 12 + Math.floor(wrng() * 40), z = 2 + Math.floor(wrng() * 12);
        const i = (y << 8) | (z << 4) | x;
        if (blocks[i] !== B.AIR || blocks[((y + 1) << 8) | (z << 4) | x] !== B.STONE) continue;
        const n = 3 + Math.floor(wrng() * 6);
        for (let k = 0; k < n; k++) {
          const wx = x + Math.floor(wrng() * 3) - 1, wy = y - Math.floor(wrng() * 2), wz = z + Math.floor(wrng() * 3) - 1;
          const j = (wy << 8) | (wz << 4) | wx;
          if (blocks[j] === B.AIR) blocks[j] = B.COBWEB;
        }
        break;
      }
    }

    // Fossils: a bone-block spine with ribs, buried under deserts.
    const frng = mulberry32(hash2(cx, cz, this.seed + 6161));
    if (biomes[136] === Biome.DESERT && frng() < 0.05) {
      const y = 22 + Math.floor(frng() * 18), z = 7, len = 6 + Math.floor(frng() * 4), sx = 8 - (len >> 1);
      const put = (x: number, yy: number, zz: number) => {
        const i = (yy << 8) | (zz << 4) | x;
        if (blocks[i] !== B.AIR && blocks[i] !== B.WATER && blocks[i] !== B.LAVA) blocks[i] = B.BONE_BLOCK;
      };
      for (let k = 0; k < len; k++) {
        put(sx + k, y, z);
        if (k % 2 === 1 && k < len - 1) {
          for (const side of [-1, 1]) {
            put(sx + k, y, z + side); put(sx + k, y, z + side * 2);
            put(sx + k, y - 1, z + side * 3); put(sx + k, y - 2, z + side * 3);
          }
        }
      }
      put(sx + len, y + 1, z); put(sx + len + 1, y + 1, z);
    }

    // --- 4. trees (including those rooted in neighbouring chunks) ---
    const cellMinX = Math.floor((x0 - TREE_REACH) / TREE_CELL), cellMaxX = Math.floor((x0 + 15 + TREE_REACH) / TREE_CELL);
    const cellMinZ = Math.floor((z0 - TREE_REACH) / TREE_CELL), cellMaxZ = Math.floor((z0 + 15 + TREE_REACH) / TREE_CELL);
    for (let cz2 = cellMinZ; cz2 <= cellMaxZ; cz2++) {
      for (let cx2 = cellMinX; cx2 <= cellMaxX; cx2++) {
        const tree = this.treeInCell(cx2, cz2);
        if (tree) this.placeTree(blocks, x0, z0, tree);
      }
    }

    // --- 5. small plants ---
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const top = tops[lz * 16 + lx];
        if (top >= 254) continue;
        const ground = blocks[(top << 8) | (lz << 4) | lx];
        const above = (top + 1) << 8 | (lz << 4) | lx;
        if (blocks[above] !== B.AIR) continue;
        const biome = biomes[lz * 16 + lx];
        const info = BIOME_INFO[biome];
        const hh = hash2(x, z, this.seed + 555);
        const r = (hh & 0xffff) / 65536;
        const r2 = (hh >>> 16) / 65536;

        if (ground === B.SAND) {
          if (biome === Biome.DESERT && r < 0.012) blocks[above] = B.DEAD_BUSH;
          // Sugar cane next to water.
          else if (r < 0.08 && top === SEA_LEVEL && this.nextToWater(blocks, lx, top, lz)) {
            const hgt = 1 + Math.floor(r2 * 3);
            for (let i = 1; i <= hgt && top + i < 256; i++) blocks[((top + i) << 8) | (lz << 4) | lx] = B.SUGAR_CANE;
          }
          continue;
        }
        if (ground !== B.GRASS && ground !== B.SNOWY_GRASS) continue;
        if (ground === B.GRASS && r < 0.05 && top === SEA_LEVEL && this.nextToWater(blocks, lx, top, lz)) {
          const hgt = 1 + Math.floor(r2 * 3);
          for (let i = 1; i <= hgt && top + i < 256; i++) blocks[((top + i) << 8) | (lz << 4) | lx] = B.SUGAR_CANE;
          continue;
        }
        const flowerPatch = this.nPatch.noise2D(x / 36 + 100, z / 36);
        if (ground === B.GRASS && info.flowers > 0 && flowerPatch > 0.35 && r < info.flowers) {
          const fk = this.nPatch.noise2D(x / 70 - 300, z / 70);
          const flowers = biome === Biome.MEADOW
            ? [B.CORNFLOWER, B.ALLIUM, B.OXEYE_DAISY, B.POPPY, B.DANDELION, B.BLUE_ORCHID]
            : [B.DANDELION, B.POPPY, B.OXEYE_DAISY, B.CORNFLOWER];
          const idx = Math.floor(clamp((fk * 0.5 + 0.5) * flowers.length + (r2 - 0.5) * 1.2, 0, flowers.length - 0.001));
          blocks[above] = flowers[idx];
        } else if (r < info.grass + (flowerPatch > 0.5 ? 0.1 : 0)) {
          const fern = biome === Biome.TAIGA || biome === Biome.SNOWY_TAIGA || biome === Biome.DARK_FOREST;
          blocks[above] = fern && r2 < 0.6 ? B.FERN : B.TALL_GRASS;
        } else if (biome === Biome.DARK_FOREST && r < info.grass + 0.02) {
          blocks[above] = r2 < 0.5 ? B.RED_MUSHROOM : B.BROWN_MUSHROOM;
        } else if ((biome === Biome.PLAINS || biome === Biome.SAVANNA) && r > 0.9985) {
          blocks[above] = B.PUMPKIN;
        }
      }
    }

    // Mushrooms and glowing lava pools already placed; sprinkle cave mushrooms.
    const mrng = mulberry32(hash2(cx, cz, this.seed + 8080));
    for (let k = 0; k < 6; k++) {
      const x = Math.floor(mrng() * 16), z = Math.floor(mrng() * 16), y = 12 + Math.floor(mrng() * 45);
      const i = (y << 8) | (z << 4) | x;
      const below = ((y - 1) << 8) | (z << 4) | x;
      if (blocks[i] === B.AIR && blocks[below] === B.STONE) blocks[i] = mrng() < 0.5 ? B.RED_MUSHROOM : B.BROWN_MUSHROOM;
    }

    return blocks;
  }

  private nextToWater(blocks: Uint8Array, lx: number, y: number, lz: number): boolean {
    const check = (x: number, z: number) => x >= 0 && x < 16 && z >= 0 && z < 16 && blocks[(y << 8) | (z << 4) | x] === B.WATER;
    return check(lx + 1, lz) || check(lx - 1, lz) || check(lx, lz + 1) || check(lx, lz - 1);
  }

  /**
   * Coarse samples for the distant-terrain LOD: per sample [height, material, temperature, humidity].
   * Materials: 0 grass, 1 sand, 2 stone, 3 snow, 4 gravel, 5 oak canopy, 6 spruce canopy, 7 birch canopy, 8 dirt, 9 clay.
   */
  farTile(x0: number, z0: number, n: number, step: number): Float32Array {
    const out = new Float32Array(n * n * 4);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step + (step >> 1), z = z0 + j * step + (step >> 1);
        const top = this.pointTop(x, z);
        const [t, h] = this.climate(x, z);
        const f = this.columnFactors(x, z);
        const biome = this.decideBiome(t, h, top, f.cont, f.mountain, f.river);
        let mat = 0;
        let height = top + 1;
        switch (biome) {
          case Biome.OCEAN: case Biome.DEEP_OCEAN: case Biome.FROZEN_OCEAN:
            mat = top < SEA_LEVEL - 10 ? 4 : 1; break;
          case Biome.RIVER: case Biome.FROZEN_RIVER: case Biome.BEACH: case Biome.SNOWY_BEACH: case Biome.DESERT:
            mat = 1; break;
          case Biome.SNOWY_PLAINS: case Biome.SNOWY_PEAKS:
            mat = 3; break;
          case Biome.MOUNTAINS:
            mat = top > 125 ? 2 : 0; break;
          default:
            mat = 0;
        }
        const info = BIOME_INFO[biome];
        if (info.tree > 0.3 && top > SEA_LEVEL) {
          const r = (hash2(x >> 3, z >> 3, this.seed + 31) & 0xffff) / 65536;
          if (r < info.tree + 0.05) {
            if (biome === Biome.TAIGA || biome === Biome.SNOWY_TAIGA) { mat = 6; height += 7 + r * 5; }
            else if (biome === Biome.BIRCH_FOREST) { mat = 7; height += 5 + r * 3; }
            else { mat = 5; height += 5 + r * 3; }
          }
        } else if (biome === Biome.SNOWY_TAIGA) {
          mat = 3;
        }
        const o = (j * n + i) * 4;
        out[o] = height;
        out[o + 1] = mat;
        out[o + 2] = t * 0.5 + 0.5;
        out[o + 3] = h * 0.5 + 0.5;
      }
    }
    return out;
  }

  /** Finds a dry spawn column near the origin. */
  findSpawn(): [number, number, number] {
    for (let r = 0; r < 4000; r += 16) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        const top = this.pointTop(x, z);
        if (top > SEA_LEVEL + 1 && top < 120) {
          const [t, h] = this.climate(x, z);
          const f = this.columnFactors(x, z);
          const b = this.decideBiome(t, h, top, f.cont, f.mountain, f.river);
          if (b === Biome.PLAINS || b === Biome.MEADOW || b === Biome.FOREST || b === Biome.BIRCH_FOREST || b === Biome.SAVANNA) {
            return [x + 0.5, top + 1, z + 0.5];
          }
        }
      }
    }
    return [0.5, this.pointTop(0, 0) + 1, 0.5];
  }
}

export function biomeHash3(x: number, y: number, z: number, seed: number): number {
  return hash3(x, y, z, seed);
}
