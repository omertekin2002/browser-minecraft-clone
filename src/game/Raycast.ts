import * as B from '../world/blocks';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  dist: number;
  block: number;
  /** Exact hit point. */
  px: number;
  py: number;
  pz: number;
}

/** Ray vs. the box of block b at (x, y, z). Returns [t, nx, ny, nz] or null. */
function rayBox(
  b: number, x: number, y: number, z: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
): [number, number, number, number] | null {
  const o = b * 6;
  const lo = [x + B.BOX[o] / 16, y + B.BOX[o + 1] / 16, z + B.BOX[o + 2] / 16];
  const hi = [x + B.BOX[o + 3] / 16, y + B.BOX[o + 4] / 16, z + B.BOX[o + 5] / 16];
  const org = [ox, oy, oz], dir = [dx, dy, dz];
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (org[k] < lo[k] || org[k] > hi[k]) return null;
      continue;
    }
    let t0 = (lo[k] - org[k]) / dir[k], t1 = (hi[k] - org[k]) / dir[k];
    let s = -1;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = k; sign = s; }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const n = [0, 0, 0];
  n[axis] = sign;
  return [Math.max(0, tmin), n[0], n[1], n[2]];
}

/**
 * Voxel DDA (Amanatides & Woo) that tests each block's selection box, so the ray passes through the
 * empty part of slabs, plants and torches. Liquids are skipped unless `liquids` is set.
 */
export function raycast(
  getBlock: (x: number, y: number, z: number) => number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  liquids = false,
): RayHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const b = getBlock(x, y, z);
    if (b > 0 && (liquids || !B.IS_LIQUID[b])) {
      if (B.FULL_CUBE[b] || B.IS_LIQUID[b]) {
        return { x, y, z, nx, ny, nz, dist: t, block: b, px: ox + dx * t, py: oy + dy * t, pz: oz + dz * t };
      }
      const h = rayBox(b, x, y, z, ox, oy, oz, dx, dy, dz);
      if (h && h[0] <= maxDist) {
        return { x, y, z, nx: h[1], ny: h[2], nz: h[3], dist: h[0], block: b, px: ox + dx * h[0], py: oy + dy * h[0], pz: oz + dz * h[0] };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
