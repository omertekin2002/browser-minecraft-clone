import type { GL } from './gl/GL';

/** CPU-side layout of the std140 FrameUniforms block (see shaders/frame.glsl). */
export const U = {
  view: 0,
  proj: 16,
  viewProj: 32,
  invViewProj: 48,
  invProj: 64,
  prevViewProj: 80,
  viewProjUnjittered: 96,
  invView: 112,
  shadowMat: 128, // 4 × 16
  cameraPos: 192,
  cameraDelta: 196,
  sunDir: 200,
  moonDir: 204,
  lightDir: 208,
  sunIlluminance: 212,
  moonIlluminance: 216,
  resolution: 220,
  jitter: 224,
  fog: 228,
  cascadeSplits: 232,
  shadowInfo: 236,
  cascadeSize: 240,
  camera: 244,
  wind: 248,
  misc: 252,
  cameraAbs: 256,
  cloudShadow: 260,
  SIZE: 264,
} as const;

export class FrameUniforms {
  readonly data = new Float32Array(U.SIZE);
  readonly buffer: WebGLBuffer;

  constructor(private gl: GL) {
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
  }

  mat(offset: number, m: ArrayLike<number>) {
    for (let i = 0; i < 16; i++) this.data[offset + i] = m[i];
  }

  vec4(offset: number, x: number, y: number, z: number, w: number) {
    const d = this.data;
    d[offset] = x;
    d[offset + 1] = y;
    d[offset + 2] = z;
    d[offset + 3] = w;
  }

  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.data);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.buffer);
  }
}
