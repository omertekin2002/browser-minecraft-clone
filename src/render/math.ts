/** Minimal column-major 4×4 matrix / vec3 math in double precision (converted to f32 for GPU). */

export type Mat4 = Float64Array;
export type Vec3 = [number, number, number];

export function mat4(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mul(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let rI = 0; rI < 4; rI++) {
      r[c * 4 + rI] =
        a[rI] * b[c * 4] + a[4 + rI] * b[c * 4 + 1] + a[8 + rI] * b[c * 4 + 2] + a[12 + rI] * b[c * 4 + 3];
    }
  }
  out.set(r);
  return out;
}

export function invert(out: Mat4, m: Mat4): Mat4 {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return out;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function ortho(out: Mat4, l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

/** Rotation-only view matrix from an orthonormal basis (right, up, forward). */
export function viewFromBasis(out: Mat4, r: Vec3, u: Vec3, f: Vec3): Mat4 {
  out.fill(0);
  out[0] = r[0]; out[4] = r[1]; out[8] = r[2];
  out[1] = u[0]; out[5] = u[1]; out[9] = u[2];
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2];
  out[15] = 1;
  return out;
}

export function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function toF32(m: Mat4, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(16);
  for (let i = 0; i < 16; i++) o[i] = m[i];
  return o;
}

/** Extracts 6 normalised frustum planes (a,b,c,d) from a view-projection matrix. */
export function frustumPlanes(m: Mat4): Float64Array {
  const p = new Float64Array(24);
  const rows = (i: number) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = rows(0), r1 = rows(1), r2 = rows(2), r3 = rows(3);
  const planes = [
    r3.map((v, i) => v + r0[i]), r3.map((v, i) => v - r0[i]),
    r3.map((v, i) => v + r1[i]), r3.map((v, i) => v - r1[i]),
    r3.map((v, i) => v + r2[i]), r3.map((v, i) => v - r2[i]),
  ];
  planes.forEach((pl, k) => {
    const l = Math.hypot(pl[0], pl[1], pl[2]) || 1;
    for (let i = 0; i < 4; i++) p[k * 4 + i] = pl[i] / l;
  });
  return p;
}

/** Conservative AABB-vs-frustum test. */
export function aabbInFrustum(planes: Float64Array, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
  for (let k = 0; k < 6; k++) {
    const a = planes[k * 4], b = planes[k * 4 + 1], c = planes[k * 4 + 2], d = planes[k * 4 + 3];
    const x = a >= 0 ? maxX : minX;
    const y = b >= 0 ? maxY : minY;
    const z = c >= 0 ? maxZ : minZ;
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}

export function halton(index: number, base: number): number {
  let f = 1, r = 0, i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = mat4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function rotationX(a: number): Mat4 {
  const m = mat4(), c = Math.cos(a), s = Math.sin(a);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

export function rotationY(a: number): Mat4 {
  const m = mat4(), c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

export function rotationZ(a: number): Mat4 {
  const m = mat4(), c = Math.cos(a), s = Math.sin(a);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

export function scaling(s: number): Mat4 {
  const m = mat4();
  m[0] = m[5] = m[10] = s;
  return m;
}

/** Multiplies matrices left to right: compose(A, B, C) = A·B·C. */
export function compose(...ms: Mat4[]): Mat4 {
  const out = mat4();
  for (const m of ms) mul(out, out, m);
  return out;
}
