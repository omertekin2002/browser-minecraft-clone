/// Chunk generation + meshing worker.
import { TerrainGenerator } from './gen/TerrainGenerator';
import { Mesher } from './mesh/Mesher';

export type WorkerRequest =
  | { type: 'init'; seed: number }
  | { type: 'generate'; id: number; cx: number; cz: number }
  | { type: 'mesh'; id: number; cx: number; cz: number; chunks: Uint8Array[] }
  | { type: 'far'; id: number; x0: number; z0: number; n: number; step: number };

let gen: TerrainGenerator | null = null;
const mesher = new Mesher();
const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      gen = new TerrainGenerator(msg.seed);
      break;
    case 'generate': {
      const t0 = performance.now();
      const blocks = gen!.generate(msg.cx, msg.cz);
      post({ type: 'generated', id: msg.id, cx: msg.cx, cz: msg.cz, blocks, ms: performance.now() - t0 }, [blocks.buffer]);
      break;
    }
    case 'far': {
      const t0 = performance.now();
      const data = gen!.farTile(msg.x0, msg.z0, msg.n, msg.step);
      post({ type: 'far', id: msg.id, data, ms: performance.now() - t0 }, [data.buffer]);
      break;
    }
    case 'mesh': {
      const t0 = performance.now();
      const g = gen!;
      const data = mesher.mesh(msg.cx, msg.cz, msg.chunks, (x, z) => g.tintIndex(x, z));
      post({ type: 'meshed', id: msg.id, data, ms: performance.now() - t0 }, [data.quads.buffer, data.waterTop.buffer]);
      break;
    }
  }
};
