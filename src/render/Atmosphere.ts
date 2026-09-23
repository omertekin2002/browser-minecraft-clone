/** CPU mirror of the atmosphere model (atmosphere.glsl) for sun / moon illuminance at the camera. */

const GROUND = 6.36;
const ATMO = 6.46;
const RAYLEIGH = [5.802, 13.558, 33.1];
const MIE_S = 2.6;
const MIE_A = 2.9;
const OZONE = [0.65, 1.881, 0.085];

function intersectSphere(ro: number[], rd: number[], r: number): number {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  if (disc > b * b) return -b + Math.sqrt(disc);
  return -b - Math.sqrt(disc);
}

/** Transmittance from a camera at `altitudeM` metres towards direction dir (unit, y up). */
export function atmosphereTransmittance(dir: [number, number, number], altitudeM = 100): [number, number, number] {
  const pos = [0, GROUND + 0.0002 + Math.max(altitudeM, 0) * 1e-6, 0];
  if (intersectSphere(pos, dir, GROUND) > 0) return [0, 0, 0];
  const dist = intersectSphere(pos, dir, ATMO);
  const steps = 40;
  let t = 0;
  const tr = [1, 1, 1];
  for (let i = 0; i < steps; i++) {
    const nt = ((i + 0.3) / steps) * dist;
    const dt = nt - t;
    t = nt;
    const px = pos[0] + dir[0] * t, py = pos[1] + dir[1] * t, pz = pos[2] + dir[2] * t;
    const alt = (Math.hypot(px, py, pz) - GROUND) * 1000;
    const rd = Math.exp(-alt / 8), md = Math.exp(-alt / 1.2);
    const oz = Math.max(0, 1 - Math.abs(alt - 25) / 15);
    for (let c = 0; c < 3; c++) {
      const ext = RAYLEIGH[c] * rd + (MIE_S + MIE_A) * md + OZONE[c] * oz;
      tr[c] *= Math.exp(-dt * ext);
    }
  }
  return [tr[0], tr[1], tr[2]];
}

/** Soft transition of transmittance near and just below the horizon (sun disk partially visible). */
export function lightIlluminance(dir: [number, number, number], altitudeM: number, scale: number): [number, number, number] {
  // Evaluate slightly above the geometric direction when near the horizon so the light fades smoothly.
  const y = dir[1];
  if (y < -0.08) return [0, 0, 0];
  const d: [number, number, number] = y < 0.01 ? [dir[0], 0.01, dir[2]] : dir;
  const l = Math.hypot(d[0], d[1], d[2]);
  const tr = atmosphereTransmittance([d[0] / l, d[1] / l, d[2] / l], altitudeM);
  const fade = y < 0.01 ? Math.max(0, (y + 0.08) / 0.09) : 1;
  return [tr[0] * scale * fade, tr[1] * scale * fade, tr[2] * scale * fade];
}
