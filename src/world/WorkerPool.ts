import type { MeshData } from './mesh/Mesher';

interface Job {
  id: number;
  msg: Record<string, unknown>;
  priority: number;
  resolve: (v: any) => void;
  transfer?: Transferable[];
}

export interface GenResult { cx: number; cz: number; blocks: Uint8Array; ms: number }
export interface MeshResult { data: MeshData; ms: number }

/** Small pool of chunk workers with a priority queue (lower priority value = sooner). */
export class WorkerPool {
  private workers: Worker[] = [];
  private busy: number[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, Job>();
  private nextId = 1;
  readonly size: number;
  private maxInFlight = 2;

  constructor(seed: number, size = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2))) {
    this.size = size;
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMessage(i, e.data);
      w.onerror = (e) => console.error('Worker error', e);
      w.postMessage({ type: 'init', seed });
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get queued(): number {
    return this.queue.length;
  }

  get inFlight(): number {
    return this.pending.size;
  }

  generate(cx: number, cz: number, priority: number): Promise<GenResult> {
    return this.enqueue({ type: 'generate', cx, cz }, priority);
  }

  mesh(cx: number, cz: number, chunks: Uint8Array[], priority: number): Promise<MeshResult> {
    return this.enqueue({ type: 'mesh', cx, cz, chunks }, priority);
  }

  far(x0: number, z0: number, n: number, step: number, priority: number): Promise<{ data: Float32Array; ms: number }> {
    return this.enqueue({ type: 'far', x0, z0, n, step }, priority);
  }

  private enqueue(msg: Record<string, unknown>, priority: number, transfer?: Transferable[]): Promise<any> {
    return new Promise((resolve) => {
      const job: Job = { id: this.nextId++, msg, priority, resolve, transfer };
      this.queue.push(job);
      this.pump();
    });
  }

  /** Re-sorts the queue; call when priorities may have changed (player moved). */
  reprioritize(fn: (msg: Record<string, unknown>) => number) {
    for (const j of this.queue) {
      if (j.msg.type === 'far') continue;
      const p = fn(j.msg);
      if (Number.isFinite(p)) j.priority = p;
    }
  }

  /** Drops queued jobs matching a predicate (their promises never resolve). */
  cancel(pred: (msg: Record<string, unknown>) => boolean): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((j) => !pred(j.msg));
    return before - this.queue.length;
  }

  pump() {
    if (this.queue.length === 0) return;
    this.queue.sort((a, b) => a.priority - b.priority);
    for (let round = 0; round < this.maxInFlight; round++) {
      for (let i = 0; i < this.workers.length && this.queue.length > 0; i++) {
        if (this.busy[i] > round) continue;
        const job = this.queue.shift()!;
        this.busy[i]++;
        this.pending.set(job.id, job);
        (job.msg as any).id = job.id;
        (job as any).worker = i;
        this.workers[i].postMessage(job.msg, job.transfer ?? []);
      }
    }
  }

  private onMessage(worker: number, data: any) {
    const job = this.pending.get(data.id);
    this.busy[worker]--;
    if (job) {
      this.pending.delete(data.id);
      if (data.type === 'generated') job.resolve({ cx: data.cx, cz: data.cz, blocks: data.blocks, ms: data.ms });
      else job.resolve({ data: data.data, ms: data.ms });
    }
    this.pump();
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.queue = [];
    this.pending.clear();
  }
}
