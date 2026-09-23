/** World persistence: modified chunk columns in IndexedDB (RLE-compressed), player state in localStorage. */

const DB_NAME = 'voxelcraft';
const STORE = 'chunks';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function rleEncode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length * 2);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === v && run < 255) run++;
    out[o++] = v;
    out[o++] = run;
    i += run;
  }
  return out.slice(0, o);
}

export function rleDecode(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i + 1 < data.length; i += 2) {
    out.fill(data[i], o, o + data[i + 1]);
    o += data[i + 1];
  }
  return out;
}

export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dayTime: number;
  dayCount: number;
  flying: boolean;
  creative: boolean;
  /** Hotbar block ids (the only inventory before items existed; still written for older builds). */
  hotbar?: number[];
  inv?: unknown;
  stats?: unknown;
  spawn?: [number, number, number];
}

/** Per-world state that isn't part of chunks: block entities (furnaces, chests) and dropped items. */
export interface WorldMeta {
  tiles?: unknown;
  drops?: unknown;
}

export class SaveStore {
  private db: Promise<IDBDatabase | null>;
  private dirty = new Map<number, Uint8Array>();
  private timer: number | null = null;

  constructor(readonly seed: number) {
    this.db = openDB().catch(() => null);
  }

  private prefix() {
    return `${this.seed}:`;
  }

  async loadAll(): Promise<Map<number, Uint8Array>> {
    const out = new Map<number, Uint8Array>();
    const db = await this.db;
    if (!db) return out;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const range = IDBKeyRange.bound(this.prefix(), this.prefix() + '￿');
      const req = tx.objectStore(STORE).openCursor(range);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(out); return; }
        const key = Number(String(cur.key).slice(this.prefix().length));
        out.set(key, rleDecode(new Uint8Array(cur.value as ArrayBuffer), 65536));
        cur.continue();
      };
      req.onerror = () => resolve(out);
    });
  }

  markDirty(key: number, blocks: Uint8Array) {
    this.dirty.set(key, blocks);
    if (this.timer === null) this.timer = window.setTimeout(() => this.flush(), 1500);
  }

  async flush() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.dirty.size === 0) return;
    const db = await this.db;
    if (!db) return;
    const entries = [...this.dirty.entries()];
    this.dirty.clear();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [key, blocks] of entries) store.put(rleEncode(blocks).buffer, this.prefix() + key);
  }

  async clearWorld() {
    const db = await this.db;
    if (!db) return;
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(IDBKeyRange.bound(this.prefix(), this.prefix() + '￿'));
    try {
      localStorage.removeItem(`voxelcraft:player:${this.seed}`);
      localStorage.removeItem(`voxelcraft:world:${this.seed}`);
    } catch { /* ignore */ }
  }

  savePlayer(p: PlayerSave) {
    try { localStorage.setItem(`voxelcraft:player:${this.seed}`, JSON.stringify(p)); } catch { /* ignore */ }
  }

  loadPlayer(): PlayerSave | null {
    try {
      const raw = localStorage.getItem(`voxelcraft:player:${this.seed}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveMeta(m: WorldMeta) {
    try { localStorage.setItem(`voxelcraft:world:${this.seed}`, JSON.stringify(m)); } catch { /* ignore */ }
  }

  loadMeta(): WorldMeta | null {
    try {
      const raw = localStorage.getItem(`voxelcraft:world:${this.seed}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}
