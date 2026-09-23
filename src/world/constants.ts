export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 256;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_HEIGHT;
export const SECTION_COUNT = CHUNK_HEIGHT / 16;
export const SEA_LEVEL = 62;

/** Index into a chunk column's block array. Layout is y-major so 16³ sections are contiguous. */
export function blockIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

/** Packs chunk coordinates into a single integer key (valid for |c| < 32768). */
export function chunkKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

export function keyToChunk(key: number): [number, number] {
  const cz = (key % 65536) - 32768;
  const cx = Math.floor(key / 65536) - 32768;
  return [cx, cz];
}

/** Face order used throughout the engine. */
export const enum Face {
  PX = 0, // east  (+X)
  NX = 1, // west  (-X)
  PY = 2, // up    (+Y)
  NY = 3, // down  (-Y)
  PZ = 4, // south (+Z)
  NZ = 5, // north (-Z)
}

export const FACE_NORMALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
