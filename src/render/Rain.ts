import type { GL, Program } from './gl/GL';

const MAX = 2600;
const RADIUS = 22;

/** CPU-simulated rain streaks around the camera, drawn as instanced quads. */
export class Rain {
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private drops = new Float32Array(MAX * 4); // world x, y, z, alpha
  private gpu = new Float32Array(MAX * 4);
  private count = 0;
  private active = 0;

  constructor(private gl: GL) {
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.gpu.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
  }

  private spawn(i: number, cx: number, cy: number, cz: number, top: (x: number, z: number) => number, anywhere: boolean) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * RADIUS;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const ground = top(Math.floor(x), Math.floor(z));
    const y = anywhere ? cy - 8 + Math.random() * 30 : cy + 14 + Math.random() * 10;
    this.drops[i * 4] = x;
    this.drops[i * 4 + 1] = Math.max(y, ground + 0.5);
    this.drops[i * 4 + 2] = z;
    this.drops[i * 4 + 3] = ground; // store ground height in w while simulating
  }

  update(dt: number, intensity: number, cam: { x: number; y: number; z: number }, wind: [number, number], top: (x: number, z: number) => number) {
    const want = Math.floor(MAX * Math.min(1, intensity));
    if (want > this.count) {
      for (let i = this.count; i < want; i++) this.spawn(i, cam.x, cam.y, cam.z, top, true);
    }
    this.count = want;
    const speed = 24;
    const d = this.drops;
    for (let i = 0; i < this.count; i++) {
      d[i * 4] += wind[0] * dt;
      d[i * 4 + 1] -= speed * dt;
      d[i * 4 + 2] += wind[1] * dt;
      const dx = d[i * 4] - cam.x, dz = d[i * 4 + 2] - cam.z;
      if (d[i * 4 + 1] < d[i * 4 + 3] || dx * dx + dz * dz > RADIUS * RADIUS || d[i * 4 + 1] < cam.y - 20) {
        this.spawn(i, cam.x, cam.y, cam.z, top, false);
      }
    }
  }

  draw(prog: Program, cam: { x: number; y: number; z: number }, intensity: number, wind: [number, number]) {
    if (this.count === 0) return;
    const gl = this.gl;
    const g = this.gpu, d = this.drops;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const x = d[i * 4] - cam.x, y = d[i * 4 + 1] - cam.y, z = d[i * 4 + 2] - cam.z;
      const dist = Math.sqrt(x * x + y * y + z * z);
      if (dist < 0.8) continue;
      g[n * 4] = x; g[n * 4 + 1] = y; g[n * 4 + 2] = z;
      g[n * 4 + 3] = 0.5 * Math.min(1, intensity * 1.4) * Math.min(1, dist / 3);
      n++;
    }
    this.active = n;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g, 0, n * 4);
    const len = 0.9;
    const fx = wind[0] / 24, fz = wind[1] / 24;
    const l = Math.hypot(fx, 1, fz);
    prog.v3('uFall', (fx / l) * len * -1, len / l, (fz / l) * len * -1).f('uWidth', 0.024);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  get drawn() {
    return this.active;
  }
}
