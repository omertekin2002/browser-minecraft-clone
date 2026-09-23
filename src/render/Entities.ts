import type { GL, Program } from './gl/GL';
import { BLOCKS, Shape, Tint } from '../world/blocks';
import * as B from '../world/blocks';
import type { Mat4 } from './math';

const FLOATS = 18; // pos3 normal3 tangent4 uv2 layer1 light2 tint3
const MAX_PARTICLES = 600;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  layer: number;
  u0: number; v0: number;
  tint: [number, number, number];
  light: number;
}

const TINT_LIN: Record<number, [number, number, number]> = {
  [Tint.GRASS]: [0.2, 0.5, 0.08],
  [Tint.FOLIAGE]: [0.13, 0.38, 0.05],
  [Tint.BIRCH]: [0.21, 0.38, 0.09],
  [Tint.SPRUCE]: [0.12, 0.3, 0.12],
};

// Cube faces: normal, tangent (dP/du), bitangent (dP/dv) — same texture orientation as chunk.vert.
const FACES: Array<{ n: number[]; t: number[]; b: number[]; face: number }> = [
  { n: [1, 0, 0], t: [0, 0, -1], b: [0, -1, 0], face: 0 },
  { n: [-1, 0, 0], t: [0, 0, 1], b: [0, -1, 0], face: 1 },
  { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, 1], face: 2 },
  { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, 1], face: 3 },
  { n: [0, 0, 1], t: [1, 0, 0], b: [0, -1, 0], face: 4 },
  { n: [0, 0, -1], t: [-1, 0, 0], b: [0, -1, 0], face: 5 },
];

function cross(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Held block (first-person) and block-break particles, drawn into the G-buffer. */
export class EntityRenderer {
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new Float32Array((36 + MAX_PARTICLES * 6) * FLOATS);
  private heldId = -1;
  private heldVerts = 0;
  private heldData = new Float32Array(36 * FLOATS);
  particles: Particle[] = [];

  constructor(private gl: GL, private cutout: boolean[]) {
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    const attr = (loc: number, size: number, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    };
    attr(0, 3, 0); attr(1, 3, 3); attr(2, 4, 6); attr(3, 2, 10); attr(4, 1, 12); attr(5, 2, 13); attr(6, 3, 15);
    gl.bindVertexArray(null);
  }

  private lay(layer: number): number {
    return layer + (this.cutout[layer] ? 1024 : 0);
  }

  private static push(out: Float32Array, o: number, p: number[], n: number[], t: number[], w: number, u: number, v: number, layer: number, sky: number, blk: number, tint: number[]): number {
    out[o] = p[0]; out[o + 1] = p[1]; out[o + 2] = p[2];
    out[o + 3] = n[0]; out[o + 4] = n[1]; out[o + 5] = n[2];
    out[o + 6] = t[0]; out[o + 7] = t[1]; out[o + 8] = t[2]; out[o + 9] = w;
    out[o + 10] = u; out[o + 11] = v; out[o + 12] = layer;
    out[o + 13] = sky; out[o + 14] = blk;
    out[o + 15] = tint[0]; out[o + 16] = tint[1]; out[o + 17] = tint[2];
    return o + FLOATS;
  }

  /** Rebuilds the held-item mesh (unit cube or flat sprite centred at the origin). */
  setHeld(id: number) {
    if (id === this.heldId) return;
    this.heldId = id;
    const def = BLOCKS[id];
    const out = this.heldData;
    let o = 0;
    const tint = def.tint ? TINT_LIN[def.tint] : [1, 1, 1];
    if (def.shape === Shape.CROSS || def.shape === Shape.TORCH) {
      // Flat sprite, visible from both sides.
      const layer = this.lay(def.faces[0]);
      const n = [0, 0, 1], t = [1, 0, 0], b = [0, -1, 0];
      const w = Math.sign(cross(n, t)[0] * b[0] + cross(n, t)[1] * b[1] + cross(n, t)[2] * b[2]) || 1;
      const quad = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
      for (const [u, v] of quad) o = EntityRenderer.push(out, o, [u - 0.5, 0.5 - v, 0], n, t, w, u, v, layer, 1, 0, tint);
      this.heldVerts = 6;
    } else {
      for (const f of FACES) {
        const layer = this.lay(def.faces[f.face]);
        const c = cross(f.n, f.t);
        const w = Math.sign(c[0] * f.b[0] + c[1] * f.b[1] + c[2] * f.b[2]) || 1;
        const corner = (u: number, v: number) => [
          f.n[0] * 0.5 + f.t[0] * (u - 0.5) + f.b[0] * (v - 0.5),
          f.n[1] * 0.5 + f.t[1] * (u - 0.5) + f.b[1] * (v - 0.5),
          f.n[2] * 0.5 + f.t[2] * (u - 0.5) + f.b[2] * (v - 0.5),
        ];
        const faceTint = def.id === B.GRASS && f.face !== 2 && f.face !== 3 ? tint : tint;
        for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
          o = EntityRenderer.push(out, o, corner(u, v), f.n, f.t, w, u, v, layer, 1, 0, faceTint);
        }
      }
      this.heldVerts = 36;
    }
  }

  spawnBreak(x: number, y: number, z: number, id: number) {
    const def = BLOCKS[id];
    if (!def) return;
    const tint = def.tint ? TINT_LIN[def.tint] : [1, 1, 1] as [number, number, number];
    const n = def.shape === Shape.CROSS ? 10 : 22;
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const face = Math.floor(Math.random() * 6);
      this.particles.push({
        x: x + 0.15 + Math.random() * 0.7, y: y + 0.15 + Math.random() * 0.7, z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 3.2, vy: Math.random() * 3.5 + 1, vz: (Math.random() - 0.5) * 3.2,
        life: 0, maxLife: 0.5 + Math.random() * 0.8,
        size: 0.08 + Math.random() * 0.08,
        layer: this.lay(def.faces[face]),
        u0: Math.floor(Math.random() * 12) / 16, v0: Math.floor(Math.random() * 12) / 16,
        tint: tint as [number, number, number], light: 1,
      });
    }
  }

  /** Small puffs while digging. */
  spawnDig(x: number, y: number, z: number, nx: number, ny: number, nz: number, id: number) {
    const def = BLOCKS[id];
    if (!def) return;
    const tint = def.tint ? TINT_LIN[def.tint] : [1, 1, 1] as [number, number, number];
    for (let i = 0; i < 3 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: x + 0.5 + nx * 0.52 + (nx ? 0 : Math.random() - 0.5) * 0.9,
        y: y + 0.5 + ny * 0.52 + (ny ? 0 : Math.random() - 0.5) * 0.9,
        z: z + 0.5 + nz * 0.52 + (nz ? 0 : Math.random() - 0.5) * 0.9,
        vx: nx * 1.5 + (Math.random() - 0.5), vy: ny * 1.5 + Math.random() * 1.5, vz: nz * 1.5 + (Math.random() - 0.5),
        life: 0, maxLife: 0.3 + Math.random() * 0.4, size: 0.06 + Math.random() * 0.05,
        layer: this.lay(def.faces[ny > 0 ? 2 : ny < 0 ? 3 : 0]),
        u0: Math.floor(Math.random() * 12) / 16, v0: Math.floor(Math.random() * 12) / 16,
        tint: tint as [number, number, number], light: 1,
      });
    }
  }

  update(dt: number, solid: (x: number, y: number, z: number) => boolean) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      if (p.life >= p.maxLife) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.vy -= 22 * dt;
      const drag = Math.exp(-dt * 1.5);
      p.vx *= drag; p.vz *= drag;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (solid(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))) p.vx = -p.vx * 0.3; else p.x = nx;
      if (solid(Math.floor(p.x), Math.floor(ny - p.size * 0.5), Math.floor(p.z))) { p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; } else p.y = ny;
      if (solid(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))) p.vz = -p.vz * 0.3; else p.z = nz;
    }
  }

  /**
   * Draws particles (camera-relative, facing the camera) and the held item. The program must be
   * the entity G-buffer program with textures already bound.
   */
  draw(prog: Program, cam: { x: number; y: number; z: number }, right: number[], up: number[], heldModel: Mat4 | null, sky: number, blockLight: number) {
    const gl = this.gl;
    const out = this.data;
    let o = 0;
    let verts = 0;
    for (const p of this.particles) {
      const s = p.size * (1 - Math.max(0, p.life / p.maxLife - 0.7) * 2);
      const cx = p.x - cam.x, cy = p.y - cam.y, cz = p.z - cam.z;
      const n = [0, 1, 0], t = [1, 0, 0];
      const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [a, b] of corners) {
        const px = cx + (right[0] * a + up[0] * b) * s;
        const py = cy + (right[1] * a + up[1] * b) * s;
        const pz = cz + (right[2] * a + up[2] * b) * s;
        const u = p.u0 + (a * 0.5 + 0.5) * (4 / 16);
        const v = p.v0 + (0.5 - b * 0.5) * (4 / 16);
        o = EntityRenderer.push(out, o, [px, py, pz], n, t, 1, u, v, p.layer, sky, blockLight, p.tint);
      }
      verts += 6;
    }
    const particleVerts = verts;
    if (heldModel && this.heldVerts > 0) {
      for (let i = 0; i < this.heldVerts * FLOATS; i++) out[o + i] = this.heldData[i];
      // Held item light follows the player.
      for (let k = 0; k < this.heldVerts; k++) {
        out[o + k * FLOATS + 13] = sky;
        out[o + k * FLOATS + 14] = blockLight;
      }
      o += this.heldVerts * FLOATS;
      verts += this.heldVerts;
    }
    if (verts === 0) return;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out, 0, o);
    gl.disable(gl.CULL_FACE);
    if (particleVerts > 0) {
      prog.i('uViewSpace', 0);
      gl.drawArrays(gl.TRIANGLES, 0, particleVerts);
    }
    if (heldModel && verts > particleVerts) {
      const m = new Float32Array(16);
      for (let i = 0; i < 16; i++) m[i] = heldModel[i];
      prog.i('uViewSpace', 1).m4('uModel', m);
      // Squeeze the held item into the front of the depth range so it never clips into walls.
      gl.depthRange(0, 0.004);
      gl.drawArrays(gl.TRIANGLES, particleVerts, verts - particleVerts);
      gl.depthRange(0, 1);
    }
    gl.bindVertexArray(null);
  }
}
