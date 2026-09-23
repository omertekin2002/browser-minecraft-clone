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
  eyeInWater = false;
  sprinting = false;
  sneaking = false;
  frozen = true; // held in place until spawn chunks exist
  creative = true;
  bobPhase = 0;
  bobAmount = 0;
  eyeHeight = EYE;
  fovBoost = 0;
  private lastSpace = -1;
  private walkDist = 0;
  onStep: ((block: number) => void) | null = null;
  onLand: ((block: number, speed: number) => void) | null = null;

  get eyeY(): number {
    return this.y + this.eyeHeight;
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

  private isSolid(get: BlockGetter, x: number, y: number, z: number): boolean {
    const b = get(x, y, z);
    if (b < 0) return true; // unloaded chunks are solid
    return B.IS_SOLID[b] === 1;
  }

  private collides(get: BlockGetter, x: number, y: number, z: number): boolean {
    const x0 = Math.floor(x - HALF_W), x1 = Math.floor(x + HALF_W - 1e-7);
    const y0 = Math.floor(y), y1 = Math.floor(y + HEIGHT - 1e-7);
    const z0 = Math.floor(z - HALF_W), z1 = Math.floor(z + HALF_W - 1e-7);
    for (let by = y0; by <= y1; by++)
      for (let bz = z0; bz <= z1; bz++)
        for (let bx = x0; bx <= x1; bx++)
          if (this.isSolid(get, bx, by, bz)) return true;
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

  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return bx + 1 > this.x - HALF_W && bx < this.x + HALF_W && by + 1 > this.y && by < this.y + HEIGHT && bz + 1 > this.z - HALF_W && bz < this.z + HALF_W;
  }

  private moveAxis(get: BlockGetter, axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const nx = axis === 0 ? this.x + delta : this.x;
    const ny = axis === 1 ? this.y + delta : this.y;
    const nz = axis === 2 ? this.z + delta : this.z;
    if (!this.collides(get, nx, ny, nz)) {
      this.x = nx; this.y = ny; this.z = nz;
      return false;
    }
    // Resolve against the block boundary.
    const eps = 1e-4;
    if (axis === 0) {
      this.x = delta > 0 ? Math.floor(this.x + HALF_W + delta) - HALF_W - eps : Math.floor(this.x - HALF_W + delta) + 1 + HALF_W + eps;
      if (this.collides(get, this.x, this.y, this.z)) this.x = nx - delta;
    } else if (axis === 1) {
      this.y = delta > 0 ? Math.floor(this.y + HEIGHT + delta) - HEIGHT - eps : Math.floor(this.y + delta) + 1 + eps;
      if (this.collides(get, this.x, this.y, this.z)) this.y = ny - delta;
    } else {
      this.z = delta > 0 ? Math.floor(this.z + HALF_W + delta) - HALF_W - eps : Math.floor(this.z - HALF_W + delta) + 1 + HALF_W + eps;
      if (this.collides(get, this.x, this.y, this.z)) this.z = nz - delta;
    }
    return true;
  }

  update(dt: number, input: Input, get: BlockGetter, now: number) {
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
      if (f > 0) this.sprinting = true;
    }
    if (f <= 0) this.sprinting = false;
    this.sneaking = input.down('ShiftLeft') && !this.flying;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = sy * f + cy * s;
    let wz = -cy * f + sy * s;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    this.inWater = this.touches(get, (b) => b === B.WATER, 0.1, 1.0);
    this.eyeInWater = get(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z)) === B.WATER;
    const inLava = this.touches(get, (b) => b === B.LAVA, 0.1, 1.0);

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
    } else if (this.inWater || inLava) {
      const sp = (this.sprinting ? 3.2 : 2.2) * (inLava ? 0.5 : 1);
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
        if (this.sprinting) { this.vx += wx * 1.2; this.vz += wz * 1.2; }
      }
    }

    // Integrate with collision (sub-stepped to avoid tunnelling).
    const wasOnGround = this.onGround;
    const fallSpeed = -this.vy;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy), Math.abs(this.vz)) * dt / 0.35));
    const sdt = dt / steps;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      if (this.moveAxis(get, 1, this.vy * sdt)) {
        if (this.vy < 0) this.onGround = true;
        this.vy = 0;
      }
      const edgeGuard = this.sneaking && (wasOnGround || this.onGround) && !this.flying;
      for (const axis of [0, 2] as const) {
        const v = axis === 0 ? this.vx : this.vz;
        const px = this.x, pz = this.z;
        if (this.moveAxis(get, axis, v * sdt)) {
          if (axis === 0) this.vx = 0; else this.vz = 0;
        }
        if (edgeGuard && !this.collides(get, this.x, this.y - 0.06, this.z)) {
          this.x = px; this.z = pz;
          if (axis === 0) this.vx = 0; else this.vz = 0;
        }
      }
    }
    if (this.onGround && this.flying && !input.down('Space')) {
      // landing ends flight like in creative mode
      this.flying = false;
    }
    if (this.onGround && !wasOnGround && fallSpeed > 6) {
      this.onLand?.(get(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z)), fallSpeed);
    }

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
