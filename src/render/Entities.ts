import type { GL, Program } from './gl/GL';
import { BLOCKS, Shape, Tint, BOX, TNT } from '../world/blocks';
import { ITEMS } from '../world/items';
import { TEXTURE_NAMES, textureLayer } from '../world/textureNames';
import type { TextureSet } from './textures/BlockTextures';
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

/** A lit TNT block. */
export interface TntInstance {
  x: number; y: number; z: number;
  fuse: number;
}

/** A dropped item as the renderer sees it. */
export interface ItemInstance {
  id: number;
  count: number;
  x: number; y: number; z: number;
  spin: number;
  sky: number;
  block: number;
}

interface Mesh {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  count: number;
  flat: boolean;
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
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Builds vertex data into a growable float list. */
class MeshBuilder {
  data: number[] = [];
  push(p: number[], n: number[], t: number[], w: number, u: number, v: number, layer: number, tint: number[]) {
    this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1], t[2], w, u, v, layer, 1, 0, tint[0], tint[1], tint[2]);
  }
  /** Quad from 4 corners (in order) with per-corner uv. */
  quad(c: number[][], uv: number[][], n: number[], t: number[], b: number[], layer: number, tint: number[]) {
    const w = Math.sign(dot(cross(n, t), b)) || 1;
    for (const k of [0, 1, 2, 0, 2, 3]) this.push(c[k], n, t, w, uv[k][0], uv[k][1], layer, tint);
  }
}

/** Held item, dropped items and block-break particles, drawn into the G-buffer. */
export class EntityRenderer {
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new Float32Array(MAX_PARTICLES * 6 * FLOATS);
  private meshes = new Map<number, Mesh>();
  private armMesh: Mesh | null = null;
  heldId = 0;
  particles: Particle[] = [];

  constructor(private gl: GL, private ts: TextureSet) {
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    EntityRenderer.attribs(gl);
    gl.bindVertexArray(null);
  }

  private static attribs(gl: GL) {
    const stride = FLOATS * 4;
    const attr = (loc: number, size: number, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    };
    attr(0, 3, 0); attr(1, 3, 3); attr(2, 4, 6); attr(3, 2, 10); attr(4, 1, 12); attr(5, 2, 13); attr(6, 3, 15);
  }

  private lay(layer: number): number {
    return layer + (this.ts.cutout[layer] ? 1024 : 0);
  }

  private upload(b: MeshBuilder, flat: boolean): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.data), gl.STATIC_DRAW);
    EntityRenderer.attribs(gl);
    gl.bindVertexArray(null);
    return { vao, vbo, count: b.data.length / FLOATS, flat };
  }

  /** Axis-aligned box (in [-0.5, 0.5] cube space) with the cube's texture mapping. */
  private static box(b: MeshBuilder, lo: number[], hi: number[], layers: number[], tint: number[]) {
    for (const f of FACES) {
      const axis = f.n[0] ? 0 : f.n[1] ? 1 : 2;
      const plane = dot(f.n, [1, 1, 1]) > 0 ? hi[axis] : lo[axis];
      const corner = (su: number, sv: number) => {
        const p = [0, 0, 0];
        p[axis] = plane;
        for (let k = 0; k < 3; k++) {
          if (k === axis) continue;
          // Choose the box extent along t / b so that u, v grow with su, sv.
          const tu = f.t[k], tv = f.b[k];
          if (tu) p[k] = (tu > 0) === (su > 0) ? hi[k] : lo[k];
          else if (tv) p[k] = (tv > 0) === (sv > 0) ? hi[k] : lo[k];
        }
        return p;
      };
      const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const uv = cs.map((p) => [dot(p, f.t) + 0.5, dot(p, f.b) + 0.5]);
      b.quad(cs, uv, f.n, f.t, f.b, layers[f.face], tint);
    }
  }

  /** Flat sprite extruded one pixel deep, like Minecraft's held and dropped items. */
  private extruded(b: MeshBuilder, layer: number, tint: number[]) {
    const tex = this.ts.byName.get(TEXTURE_NAMES[layer]);
    const L = this.lay(layer);
    const H = 1 / 32;
    const P = 1 / 16;
    b.quad([[-0.5, 0.5, H], [0.5, 0.5, H], [0.5, -0.5, H], [-0.5, -0.5, H]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, 1], [1, 0, 0], [0, -1, 0], L, tint);
    b.quad([[0.5, 0.5, -H], [-0.5, 0.5, -H], [-0.5, -0.5, -H], [0.5, -0.5, -H]], [[1, 0], [0, 0], [0, 1], [1, 1]], [0, 0, -1], [1, 0, 0], [0, -1, 0], L, tint);
    if (!tex) return;
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && tex.rgba[(y * 16 + x) * 4 + 3] >= 128;
    // Top / bottom edges, merged into horizontal runs.
    for (const dir of [-1, 1]) {
      for (let y = 0; y < 16; y++) {
        let x = 0;
        while (x < 16) {
          if (!(solid(x, y) && !solid(x, y + dir))) { x++; continue; }
          const x0 = x;
          while (x < 16 && solid(x, y) && !solid(x, y + dir)) x++;
          const py = 0.5 - (dir < 0 ? y : y + 1) * P;
          const xa = x0 * P - 0.5, xb = x * P - 0.5, v = (y + 0.5) / 16;
          const n = [0, -dir, 0];
          b.quad([[xa, py, H], [xb, py, H], [xb, py, -H], [xa, py, -H]], [[x0 / 16, v], [x / 16, v], [x / 16, v], [x0 / 16, v]], n, [1, 0, 0], [0, 0, -1], L, tint);
        }
      }
    }
    // Left / right edges, merged into vertical runs.
    for (const dir of [-1, 1]) {
      for (let x = 0; x < 16; x++) {
        let y = 0;
        while (y < 16) {
          if (!(solid(x, y) && !solid(x + dir, y))) { y++; continue; }
          const y0 = y;
          while (y < 16 && solid(x, y) && !solid(x + dir, y)) y++;
          const px = (dir < 0 ? x : x + 1) * P - 0.5;
          const ya = 0.5 - y0 * P, yb = 0.5 - y * P, u = (x + 0.5) / 16;
          const n = [dir, 0, 0];
          b.quad([[px, ya, H], [px, ya, -H], [px, yb, -H], [px, yb, H]], [[u, y0 / 16], [u, y0 / 16], [u, y / 16], [u, y / 16]], n, [0, 0, -1], [0, -1, 0], L, tint);
        }
      }
    }
  }

  /** GPU mesh for an item: an extruded sprite or a (possibly partial) block, centred at the origin. */
  mesh(id: number): Mesh | null {
    const hit = this.meshes.get(id);
    if (hit) return hit;
    const d = ITEMS[id];
    if (!d) return null;
    const b = new MeshBuilder();
    const block = d.block === id ? BLOCKS[id] : null;
    const tint = block?.tint ? TINT_LIN[block.tint] : [1, 1, 1];
    if (d.flat) this.extruded(b, d.texture, tint);
    else if (block) {
      const layers = block.faces.map((l) => this.lay(l));
      if (block.shape === Shape.BOX) {
        const o = id * 6;
        EntityRenderer.box(b, [BOX[o] / 16 - 0.5, BOX[o + 1] / 16 - 0.5, BOX[o + 2] / 16 - 0.5], [BOX[o + 3] / 16 - 0.5, BOX[o + 4] / 16 - 0.5, BOX[o + 5] / 16 - 0.5], layers, tint);
      } else EntityRenderer.box(b, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], layers, tint);
    }
    const m = this.upload(b, d.flat);
    this.meshes.set(id, m);
    return m;
  }

  private arm(): Mesh {
    if (!this.armMesh) {
      const b = new MeshBuilder();
      const l = this.lay(textureLayer('player_arm'));
      EntityRenderer.box(b, [-0.125, -0.375, -0.125], [0.125, 0.375, 0.125], [l, l, l, l, l, l], [1, 1, 1]);
      this.armMesh = this.upload(b, false);
    }
    return this.armMesh;
  }

  /** Whether an item is drawn as a flat sprite (affects the held pose). */
  isFlat(id: number): boolean {
    return !!ITEMS[id]?.flat;
  }

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------

  private addParticles(x: number, y: number, z: number, n: number, layerOf: () => number, tint: [number, number, number], spread = 0.7, speed = 1) {
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread, z: z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 3.2 * speed, vy: (Math.random() * 3.5 + 1) * speed, vz: (Math.random() - 0.5) * 3.2 * speed,
        life: 0, maxLife: 0.5 + Math.random() * 0.8,
        size: 0.08 + Math.random() * 0.08,
        layer: layerOf(),
        u0: Math.floor(Math.random() * 12) / 16, v0: Math.floor(Math.random() * 12) / 16,
        tint, light: 1,
      });
    }
  }

  spawnBreak(x: number, y: number, z: number, id: number) {
    const def = BLOCKS[id];
    if (!def) return;
    const tint = def.tint ? TINT_LIN[def.tint] : [1, 1, 1] as [number, number, number];
    this.addParticles(x + 0.5, y + 0.5, z + 0.5, def.shape === Shape.CROSS ? 10 : 22, () => this.lay(def.faces[Math.floor(Math.random() * 6)]), tint);
  }

  /** Crumbs of an item (eating, a tool breaking). */
  spawnItemCrumbs(x: number, y: number, z: number, id: number, n = 8) {
    const d = ITEMS[id];
    if (!d) return;
    const layer = d.flat ? d.texture : BLOCKS[id]?.faces[0] ?? 0;
    this.addParticles(x, y, z, n, () => this.lay(layer), [1, 1, 1], 0.25, 0.45);
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

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  /**
   * Draws particles (camera-relative, facing the camera), dropped items and the held item (or the
   * empty hand). The program must be the entity G-buffer program with textures already bound.
   */
  draw(
    prog: Program, cam: { x: number; y: number; z: number }, right: number[], up: number[],
    heldModel: Mat4 | null, sky: number, blockLight: number, items: ItemInstance[], tnt: TntInstance[] = [],
  ) {
    const gl = this.gl;
    gl.disable(gl.CULL_FACE);
    prog.v3('uLightOverride', 0, 0, 0).f('uFlash', 0);

    // Particles (dynamic buffer)
    const out = this.data;
    let o = 0;
    for (const p of this.particles) {
      const s = p.size * (1 - Math.max(0, p.life / p.maxLife - 0.7) * 2);
      const cx = p.x - cam.x, cy = p.y - cam.y, cz = p.z - cam.z;
      const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [a, b] of corners) {
        out[o] = cx + (right[0] * a + up[0] * b) * s;
        out[o + 1] = cy + (right[1] * a + up[1] * b) * s;
        out[o + 2] = cz + (right[2] * a + up[2] * b) * s;
        out[o + 3] = 0; out[o + 4] = 1; out[o + 5] = 0;
        out[o + 6] = 1; out[o + 7] = 0; out[o + 8] = 0; out[o + 9] = 1;
        out[o + 10] = p.u0 + (a * 0.5 + 0.5) * (4 / 16);
        out[o + 11] = p.v0 + (0.5 - b * 0.5) * (4 / 16);
        out[o + 12] = p.layer;
        out[o + 13] = sky; out[o + 14] = blockLight;
        out[o + 15] = p.tint[0]; out[o + 16] = p.tint[1]; out[o + 17] = p.tint[2];
        o += FLOATS;
      }
    }
    if (o > 0) {
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, out, 0, o);
      prog.i('uViewSpace', 0);
      gl.drawArrays(gl.TRIANGLES, 0, o / FLOATS);
    }

    // Dropped items: spinning, bobbing, a few copies for bigger stacks.
    const m = new Float32Array(16);
    prog.i('uViewSpace', 2);
    for (const it of items) {
      const mesh = this.mesh(it.id);
      if (!mesh) continue;
      const scale = mesh.flat ? 0.5 : 0.25;
      const copies = it.count > 32 ? 4 : it.count > 16 ? 3 : it.count > 1 ? 2 : 1;
      prog.v3('uLightOverride', it.sky, it.block, 1);
      gl.bindVertexArray(mesh.vao);
      const c = Math.cos(it.spin), s = Math.sin(it.spin);
      for (let k = 0; k < copies; k++) {
        // Deterministic small offsets per copy.
        const ox = k ? (((k * 7919) % 13) / 13 - 0.5) * 0.18 : 0;
        const oy = k * (mesh.flat ? 0.02 : 0.06);
        const oz = k ? (((k * 104729) % 17) / 17 - 0.5) * 0.18 : 0;
        const lift = mesh.flat ? 0.25 : 0.125;
        m.fill(0);
        m[0] = c * scale; m[2] = -s * scale; m[5] = scale; m[8] = s * scale; m[10] = c * scale; m[15] = 1;
        m[12] = it.x - cam.x + ox * c + oz * s;
        m[13] = it.y + lift + oy - cam.y;
        m[14] = it.z - cam.z - ox * s + oz * c;
        prog.m4('uModel', m);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }
    }

    // Lit TNT: flashes white and swells just before it goes off.
    const tm = tnt.length ? this.mesh(TNT) : null;
    if (tm) {
      gl.bindVertexArray(tm.vao);
      prog.v3('uLightOverride', sky, Math.max(blockLight, 0.4), 1);
      for (const t of tnt) {
        const grow = t.fuse < 0.5 ? 1 + (0.5 - t.fuse) * 0.6 : 1;
        m.fill(0);
        m[0] = m[5] = m[10] = grow; m[15] = 1;
        m[12] = t.x - cam.x; m[13] = t.y + 0.5 - cam.y; m[14] = t.z - cam.z;
        prog.m4('uModel', m).f('uFlash', Math.floor(t.fuse * 4) % 2 === 0 ? 0.7 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, tm.count);
      }
      prog.f('uFlash', 0);
    }

    // Held item or hand
    if (heldModel) {
      const mesh = this.heldId ? this.mesh(this.heldId) : this.arm();
      if (mesh) {
        for (let i = 0; i < 16; i++) m[i] = heldModel[i];
        prog.i('uViewSpace', 1).m4('uModel', m).v3('uLightOverride', sky, blockLight, 1);
        gl.bindVertexArray(mesh.vao);
        // Squeeze the held item into the front of the depth range so it never clips into walls.
        gl.depthRange(0, 0.004);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        gl.depthRange(0, 1);
      }
    }
    gl.bindVertexArray(null);
  }
}
