/** Thin WebGL2 helpers: shader programs with #include support, textures and render targets. */

export type GL = WebGL2RenderingContext;

const includeRegistry = new Map<string, string>();

export function registerInclude(name: string, src: string) {
  includeRegistry.set(name, src);
}

function resolveIncludes(src: string, seen = new Set<string>()): string {
  return src.replace(/^[ \t]*#include\s+<([\w-]+)>.*$/gm, (_m, name: string) => {
    if (seen.has(name)) return '';
    const inc = includeRegistry.get(name);
    if (inc === undefined) throw new Error(`Unknown shader include <${name}>`);
    seen.add(name);
    return resolveIncludes(inc, seen);
  });
}

export function preprocess(src: string, defines: Record<string, string | number | boolean> = {}): string {
  let body = src.replace(/^\s*#version[^\n]*\n/, '');
  body = resolveIncludes(body);
  const defs = Object.entries(defines)
    .filter(([, v]) => v !== false)
    .map(([k, v]) => `#define ${k}${v === true ? '' : ' ' + v}`)
    .join('\n');
  return `#version 300 es\n${defs}\n${body}`;
}

function compile(gl: GL, type: number, src: string, name: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '';
    const lines = src.split('\n');
    const annotated = log.replace(/ERROR: 0:(\d+):/g, (m, ln) => {
      const n = parseInt(ln, 10);
      return `${m}\n    > ${lines[n - 1]?.trim() ?? ''}\n`;
    });
    console.error(`[${name}] ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader error:\n${annotated}`);
    throw new Error(`Shader compile failed: ${name}`);
  }
  return sh;
}

export class Program {
  readonly program: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(
    readonly gl: GL,
    readonly name: string,
    vs: string,
    fs: string,
    defines: Record<string, string | number | boolean> = {},
  ) {
    const v = compile(gl, gl.VERTEX_SHADER, preprocess(vs, defines), name);
    const f = compile(gl, gl.FRAGMENT_SHADER, preprocess(fs, defines), name);
    const p = gl.createProgram()!;
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(`[${name}] link error: ${gl.getProgramInfoLog(p)}`);
      throw new Error(`Program link failed: ${name}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    this.program = p;
    const blockIdx = gl.getUniformBlockIndex(p, 'FrameUniforms');
    if (blockIdx !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, blockIdx, 0);
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.locs.set(name, l);
    }
    return l;
  }

  i(name: string, v: number) { this.gl.uniform1i(this.loc(name), v); return this; }
  f(name: string, v: number) { this.gl.uniform1f(this.loc(name), v); return this; }
  v2(name: string, x: number, y: number) { this.gl.uniform2f(this.loc(name), x, y); return this; }
  v3(name: string, x: number, y: number, z: number) { this.gl.uniform3f(this.loc(name), x, y, z); return this; }
  v4(name: string, x: number, y: number, z: number, w: number) { this.gl.uniform4f(this.loc(name), x, y, z, w); return this; }
  iv2(name: string, x: number, y: number) { this.gl.uniform2i(this.loc(name), x, y); return this; }
  iv3(name: string, x: number, y: number, z: number) { this.gl.uniform3i(this.loc(name), x, y, z); return this; }
  iv4(name: string, x: number, y: number, z: number, w: number) { this.gl.uniform4i(this.loc(name), x, y, z, w); return this; }
  m4(name: string, m: Float32Array) { this.gl.uniformMatrix4fv(this.loc(name), false, m); return this; }
  fv(name: string, v: Float32Array) { this.gl.uniform1fv(this.loc(name), v); return this; }
  v4v(name: string, v: Float32Array) { this.gl.uniform4fv(this.loc(name), v); return this; }

  /** Binds a texture to a unit and sets the sampler uniform. */
  tex(name: string, unit: number, tex: WebGLTexture | null, target: number = this.gl.TEXTURE_2D) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
}

export interface TexOptions {
  internalFormat: number;
  format: number;
  type: number;
  min?: number;
  mag?: number;
  wrap?: number;
  data?: ArrayBufferView | null;
}

export function createTexture2D(gl: GL, w: number, h: number, o: TexOptions): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internalFormat, w, h, 0, o.format, o.type, o.data ?? null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.min ?? gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.mag ?? gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.wrap ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, o.wrap ?? gl.CLAMP_TO_EDGE);
  return t;
}

export const FMT = {
  rgba8: (gl: GL): TexOptions => ({ internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }),
  srgba8: (gl: GL): TexOptions => ({ internalFormat: gl.SRGB8_ALPHA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE }),
  rgba16f: (gl: GL): TexOptions => ({ internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }),
  rg16f: (gl: GL): TexOptions => ({ internalFormat: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT }),
  r16f: (gl: GL): TexOptions => ({ internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }),
  r32f: (gl: GL): TexOptions => ({ internalFormat: gl.R32F, format: gl.RED, type: gl.FLOAT }),
  rgba32f: (gl: GL): TexOptions => ({ internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT }),
  r11g11b10f: (gl: GL): TexOptions => ({ internalFormat: gl.R11F_G11F_B10F, format: gl.RGB, type: gl.HALF_FLOAT }),
  depth32f: (gl: GL): TexOptions => ({ internalFormat: gl.DEPTH_COMPONENT32F, format: gl.DEPTH_COMPONENT, type: gl.FLOAT, min: gl.NEAREST, mag: gl.NEAREST }),
  depth24: (gl: GL): TexOptions => ({ internalFormat: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, min: gl.NEAREST, mag: gl.NEAREST }),
};

/** A framebuffer with owned color/depth textures that can be resized. */
export class RenderTarget {
  fbo: WebGLFramebuffer;
  colors: WebGLTexture[] = [];
  depth: WebGLTexture | null = null;
  width = 0;
  height = 0;

  constructor(
    private gl: GL,
    readonly name: string,
    private colorOpts: TexOptions[],
    private depthOpts: TexOptions | null,
    w: number,
    h: number,
    private sharedDepth: RenderTarget | null = null,
  ) {
    this.fbo = gl.createFramebuffer()!;
    this.resize(w, h);
  }

  resize(w: number, h: number) {
    const gl = this.gl;
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    for (const t of this.colors) gl.deleteTexture(t);
    if (this.depth && !this.sharedDepth) gl.deleteTexture(this.depth);
    this.colors = this.colorOpts.map((o) => createTexture2D(gl, w, h, o));
    this.depth = this.sharedDepth ? this.sharedDepth.depth : this.depthOpts ? createTexture2D(gl, w, h, this.depthOpts) : null;
    this.attach();
  }

  /** Re-attaches textures (needed when a shared depth target was resized). */
  attach() {
    const gl = this.gl;
    if (this.sharedDepth) this.depth = this.sharedDepth.depth;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const bufs: number[] = [];
    this.colors.forEach((t, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    gl.drawBuffers(bufs.length ? bufs : [gl.NONE]);
    if (bufs.length === 0) gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error(`Framebuffer ${this.name} incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Binds for rendering. `discard` tells tiled GPUs the old contents need not be loaded. */
  bind(discard = false) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    if (discard && this.colors.length) {
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, this.colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    }
  }

  get color(): WebGLTexture {
    return this.colors[0];
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.colors) gl.deleteTexture(t);
    if (this.depth && !this.sharedDepth) gl.deleteTexture(this.depth);
    gl.deleteFramebuffer(this.fbo);
  }
}

/** Two render targets that swap roles every frame (temporal history). */
export class PingPong {
  a: RenderTarget;
  b: RenderTarget;
  constructor(gl: GL, name: string, opts: TexOptions[], w: number, h: number) {
    this.a = new RenderTarget(gl, name + 'A', opts, null, w, h);
    this.b = new RenderTarget(gl, name + 'B', opts, null, w, h);
  }
  swap() {
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }
  /** Current write target. */
  get write() { return this.a; }
  /** Previous frame. */
  get read() { return this.b; }
  resize(w: number, h: number) {
    this.a.resize(w, h);
    this.b.resize(w, h);
  }
}
