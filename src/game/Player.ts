import * as B from '../world/blocks';
import type { Input } from './Input';

export type BlockGetter = (x: number, y: number, z: number) => number;

const HALF_W = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;
const SNEAK_EYE = 1.32;
const GRAVITY = 32;
const JUMP_V = 8.9;
const WALK = 4.317;
const SPRINT = 5.612;
const SNEAK = 1.31;
const FLY = 10.9;
const FLY_SPRINT = 21.6;
/** Height the player walks up without jumping (slabs). */
const STEP = 0.6;
const EPS = 1e-7;

export class Player {
  x = 0;
  y = 80;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  flying = false;
  inWater = false;
  inLava = false;
  inWeb = false;
  eyeInWater = false;
  sprinting = false;
  sneaking = false;
  frozen = true; // held in place until spawn chunks exist
  creative = true;
  /** Set by survival rules (hunger too low to sprint). */
  canSprint = true;
  bobPhase = 0;
  bobAmount = 0;
  eyeHeight = EYE;
  fovBoost = 0;
  /** Blocks fallen since last touching the ground (for fall damage). */
  fallDistance = 0;
  /** Distance walked this frame and whether a jump started (hunger exhaustion). */
  movedDist = 0;
  jumped = false;
  private lastSpace = -1;
  private walkDist = 0;
  /** Camera offset that smooths out stepping up slabs. */
  private stepSmooth = 0;
  private boxList: number[] = [];
  onStep: ((block: number) => void) | null = null;
  onLand: ((block: number, fallDistance: number) => void) | null = null;

  get eyeY(): number {
    return this.y + this.eyeHeight + this.stepSmooth;
  }

  forward(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  look(dx: number, dy: number, sensitivity: number) {
    this.yaw += dx * sensitivity;
    this.pitch -= dy * sensitivity;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    this.yaw = ((this.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  /** Collision boxes (x0 y0 z0 x1 y1 z1 …) of solid blocks in a region; unloaded chunks are solid. */
  private collectBoxes(get: BlockGetter, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
    const out = this.boxList;
    out.length = 0;
    const bx0 = Math.floor(x0), bx1 = Math.floor(x1 - EPS);
    const by0 = Math.floor(y0), by1 = Math.floor(y1 - EPS);
    const bz0 = Math.floor(z0), bz1 = Math.floor(z1 - EPS);
    for (let by = by0; by <= by1; by++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const b = get(bx, by, bz);
          if (b < 0) { out.push(bx, by, bz, bx + 1, by + 1, bz + 1); continue; }
          if (B.IS_SOLID[b] !== 1) continue;
          const o = b * 6;
          out.push(bx + B.BOX[o] / 16, by + B.BOX[o + 1] / 16, bz + B.BOX[o + 2] / 16, bx + B.BOX[o + 3] / 16, by + B.BOX[o + 4] / 16, bz + B.BOX[o + 5] / 16);
        }
      }
    }
    return out;
  }

  private collides(get: BlockGetter, x: number, y: number, z: number): boolean {
    const bs = this.collectBoxes(get, x - HALF_W, y, z - HALF_W, x + HALF_W, y + HEIGHT, z + HALF_W);
    for (let i = 0; i < bs.length; i += 6) {
      if (bs[i + 3] > x - HALF_W + EPS && bs[i] < x + HALF_W - EPS &&
          bs[i + 4] > y + EPS && bs[i + 1] < y + HEIGHT - EPS &&
          bs[i + 5] > z - HALF_W + EPS && bs[i + 2] < z + HALF_W - EPS) return true;
    }
    return false;
  }

  /** Whether the player's box overlaps any block of the given kind. */
  private touches(get: BlockGetter, pred: (b: number) => boolean, yOff = 0, h = HEIGHT): boolean {
    const x0 = Math.floor(this.x - HALF_W), x1 = Math.floor(this.x + HALF_W);
    const y0 = Math.floor(this.y + yOff), y1 = Math.floor(this.y + yOff + h);
    const z0 = Math.floor(this.z - HALF_W), z1 = Math.floor(this.z + HALF_W);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++)
          if (pred(get(bx, by, bz))) return true;
    return false;
  }

  /** Whether the player's box overlaps a box (world coordinates). */
  intersectsBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    return x1 > this.x - HALF_W && x0 < this.x + HALF_W && y1 > this.y && y0 < this.y + HEIGHT && z1 > this.z - HALF_W && z0 < this.z + HALF_W;
  }

  /** Whether a block placed at (bx, by, bz) would overlap the player. */
  intersectsBlock(bx: number, by: number, bz: number, block: number): boolean {
    const o = block * 6;
    return this.intersectsBox(bx + B.BOX[o] / 16, by + B.BOX[o + 1] / 16, bz + B.BOX[o + 2] / 16, bx + B.BOX[o + 3] / 16, by + B.BOX[o + 4] / 16, bz + B.BOX[o + 5] / 16);
  }

  /** The player's feet and head overlap (for suffocation checks). */
  get box(): [number, number, number, number, number, number] {
    return [this.x - HALF_W, this.y, this.z - HALF_W, this.x + HALF_W, this.y + HEIGHT, this.z + HALF_W];
  }

  /** Sweeps the player's box along one axis against block boxes; returns the distance actually moved. */
  private moveAxis(get: BlockGetter, axis: 0 | 1 | 2, delta: number): number {
    if (delta === 0) return 0;
    const lo = [this.x - HALF_W, this.y, this.z - HALF_W];
    const hi = [this.x + HALF_W, this.y + HEIGHT, this.z + HALF_W];
    const rlo = lo.slice(), rhi = hi.slice();
    if (delta > 0) rhi[axis] += delta; else rlo[axis] += delta;
    const bs = this.collectBoxes(get, rlo[0], rlo[1], rlo[2], rhi[0], rhi[1], rhi[2]);
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    for (let i = 0; i < bs.length; i += 6) {
      if (!(bs[i + 3 + a1] > lo[a1] + EPS && bs[i + a1] < hi[a1] - EPS)) continue;
      if (!(bs[i + 3 + a2] > lo[a2] + EPS && bs[i + a2] < hi[a2] - EPS)) continue;
      if (delta > 0 && bs[i + axis] >= hi[axis] - EPS) delta = Math.min(delta, bs[i + axis] - hi[axis]);
      else if (delta < 0 && bs[i + 3 + axis] <= lo[axis] + EPS) delta = Math.max(delta, bs[i + 3 + axis] - lo[axis]);
    }
    if (axis === 0) this.x += delta; else if (axis === 1) this.y += delta; else this.z += delta;
    return delta;
  }

  update(dt: number, input: Input, get: BlockGetter, now: number) {
    this.movedDist = 0;
    this.jumped = false;
    // Mode toggles
    if (input.hit('Space') && input.enabled) {
      if (this.creative && now - this.lastSpace < 0.3) {
        this.flying = !this.flying;
        this.vy = 0;
        this.lastSpace = -1;
      } else this.lastSpace = now;
    }
    if (!this.creative) this.flying = false;

    const fwdKey = input.down('KeyW') ? 1 : 0, backKey = input.down('KeyS') ? 1 : 0;
    const leftKey = input.down('KeyA') ? 1 : 0, rightKey = input.down('KeyD') ? 1 : 0;
    const f = fwdKey - backKey, s = rightKey - leftKey;
    if (input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyR')) {
      if (f > 0 && (this.canSprint || this.flying)) this.sprinting = true;
    }
    if (f <= 0 || (!this.canSprint && !this.flying)) this.sprinting = false;
    this.sneaking = input.down('ShiftLeft') && !this.flying;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = sy * f + cy * s;
    let wz = -cy * f + sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    this.inWater = this.touches(get, (b) => b === B.WATER, 0.1, 1.0);
    this.eyeInWater = get(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z)) === B.WATER;
    this.inLava = this.touches(get, (b) => b === B.LAVA, 0.1, 1.0);
    this.inWeb = this.touches(get, (b) => b === B.COBWEB, 0.05, HEIGHT - 0.1);
    this.stepSmooth *= Math.exp(-dt * 18);

    if (this.frozen) {
      this.vx = this.vy = this.vz = 0;
      return;
    }

    // Velocity update
    if (this.flying) {
      const sp = this.sprinting ? FLY_SPRINT : FLY;
      const k = 1 - Math.exp(-dt * 9);
      this.vx += (wx * sp - this.vx) * k;
      this.vz += (wz * sp - this.vz) * k;
      const up = (input.down('Space') ? 1 : 0) - (input.down('ShiftLeft') ? 1 : 0);
      this.vy += (up * 8.5 - this.vy) * k;
    } else if (this.inWater || this.inLava) {
      const sp = (this.sprinting ? 3.2 : 2.2) * (this.inLava ? 0.5 : 1);
      const k = 1 - Math.exp(-dt * 5);
      this.vx += (wx * sp - this.vx) * k;
      this.vz += (wz * sp - this.vz) * k;
      this.vy -= 9 * dt;
      this.vy *= Math.exp(-dt * 2.5);
      if (input.down('Space')) this.vy = Math.min(this.vy + 22 * dt, 3.6);
      if (this.sneaking) this.vy = Math.max(this.vy - 20 * dt, -4);
    } else {
      const sp = this.sneaking ? SNEAK : this.sprinting ? SPRINT : WALK;
      const accel = this.onGround ? 14 : 3.2;
      const k = 1 - Math.exp(-dt * accel);
      this.vx += (wx * sp - this.vx) * k;
      this.vz += (wz * sp - this.vz) * k;
      this.vy -= GRAVITY * dt;
      if (this.vy < -78) this.vy = -78;
      if (input.down('Space') && this.onGround) {
        this.vy = JUMP_V;
        this.onGround = false;
        this.jumped = true;
        if (this.sprinting) { this.vx += wx * 1.2; this.vz += wz * 1.2; }
      }
    }

    // Cobwebs slow everything down drastically (and stop falls).
    const webH = this.inWeb ? 0.25 : 1, webV = this.inWeb ? 0.05 : 1;

    // Integrate with collision (sub-stepped to avoid tunnelling).
    const wasOnGround = this.onGround;
    const startY = this.y;
    const fallSpeed = -this.vy;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy), Math.abs(this.vz)) * dt / 0.35));
    const sdt = dt / steps;
    this.onGround = false;
    const px0 = this.x, pz0 = this.z;
    for (let i = 0; i < steps; i++) {
      const dy = this.vy * sdt * webV;
      const my = this.moveAxis(get, 1, dy);
      if (my !== dy) {
        if (dy < 0) this.onGround = true;
        this.vy = 0;
      }
      const dx = this.vx * sdt * webH, dz = this.vz * sdt * webH;
      const hx = this.x, hz = this.z;
      const mx = this.moveAxis(get, 0, dx);
      const mz = this.moveAxis(get, 2, dz);
      let blockedX = mx !== dx, blockedZ = mz !== dz;
      // Step up onto slabs and other low obstacles.
      if ((blockedX || blockedZ) && (this.onGround || wasOnGround) && !this.flying && !this.inWater) {
        const ax = this.x, ay = this.y, az = this.z;
        this.x = hx; this.z = hz;
        const rise = this.moveAxis(get, 1, STEP);
        const sx = this.moveAxis(get, 0, dx), sz = this.moveAxis(get, 2, dz);
        this.moveAxis(get, 1, -rise);
        if (Math.hypot(sx, sz) > Math.hypot(ax - hx, az - hz) + 1e-4 && this.y > ay + 1e-4) {
          this.stepSmooth -= this.y - ay;
          blockedX = sx !== dx;
          blockedZ = sz !== dz;
          this.onGround = true;
        } else {
          this.x = ax; this.y = ay; this.z = az;
        }
      }
      if (blockedX) this.vx = 0;
      if (blockedZ) this.vz = 0;
      const edgeGuard = this.sneaking && (wasOnGround || this.onGround) && !this.flying;
      if (edgeGuard && !this.collides(get, this.x, this.y - 0.06, this.z)) {
        // Sneaking: never walk off an edge (try each axis separately).
        const cx = this.x;
        this.x = hx;
        if (!this.collides(get, this.x, this.y - 0.06, this.z)) { this.x = cx; this.z = hz; }
        if (!this.collides(get, this.x, this.y - 0.06, this.z)) { this.x = hx; this.z = hz; }
        if (this.x === hx) this.vx = 0;
        if (this.z === hz) this.vz = 0;
      }
    }
    if (this.inWeb) { this.vx *= 0.5; this.vz *= 0.5; this.vy = Math.max(this.vy, -1); }
    this.movedDist = Math.hypot(this.x - px0, this.z - pz0);

    // Fall distance (reset by water, webs, flight and ladders-to-be).
    if (this.flying || this.inWater || this.inWeb || this.inLava) this.fallDistance = 0;
    else if (this.y < startY) this.fallDistance += startY - this.y;
    if (this.onGround && this.flying && !input.down('Space')) {
      // landing ends flight like in creative mode
      this.flying = false;
    }
    if (this.onGround && !wasOnGround) {
      const under = get(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
      if (fallSpeed > 6 || this.fallDistance > 0.5) this.onLand?.(under, this.fallDistance);
      this.fallDistance = 0;
    } else if (this.onGround) this.fallDistance = 0;

    // View bobbing / footsteps
    const hs = Math.hypot(this.vx, this.vz);
    const targetEye = this.sneaking ? SNEAK_EYE : EYE;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-dt * 14));
    if (this.onGround && !this.flying && hs > 0.5) {
      this.bobPhase += hs * dt * 1.9;
      this.bobAmount += (Math.min(1, hs / SPRINT) - this.bobAmount) * (1 - Math.exp(-dt * 8));
      this.walkDist += hs * dt;
      if (this.walkDist > 1.9) {
        this.walkDist = 0;
        this.onStep?.(get(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z)));
      }
    } else {
      this.bobAmount += (0 - this.bobAmount) * (1 - Math.exp(-dt * 6));
    }
    const boost = this.sprinting ? (this.flying ? 0.14 : 0.1) : 0;
    this.fovBoost += (boost - this.fovBoost) * (1 - Math.exp(-dt * 8));
  }

  /** Camera offset from view bobbing: [side, up, roll]. */
  bob(): [number, number, number] {
    const a = this.bobAmount;
    return [Math.cos(this.bobPhase * Math.PI) * 0.035 * a, -Math.abs(Math.sin(this.bobPhase * Math.PI)) * 0.06 * a, Math.cos(this.bobPhase * Math.PI) * 0.006 * a];
  }
}
