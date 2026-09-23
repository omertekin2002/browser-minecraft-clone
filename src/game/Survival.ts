import type { FoodInfo } from '../world/items';

/**
 * Health, hunger, saturation, air and burning — Minecraft's survival rules (converted from ticks
 * to seconds). Creative players are unaffected.
 */

export type Difficulty = 'Peaceful' | 'Easy' | 'Normal' | 'Hard';
export type DamageSource = 'fall' | 'lava' | 'fire' | 'drown' | 'starve' | 'cactus' | 'void' | 'suffocate' | 'explosion';

/** Sources that armor protects against. */
const ARMORED: Record<DamageSource, boolean> = {
  fall: false, lava: true, fire: true, drown: false, starve: false, cactus: true, void: false, suffocate: false, explosion: true,
};

export const MAX_AIR = 15;

export interface StatsContext {
  creative: boolean;
  difficulty: Difficulty;
  eyeInWater: boolean;
  inLava: boolean;
  /** Standing in water or rain (puts out fire). */
  wet: boolean;
  sprinting: boolean;
  swimming: boolean;
  movedDist: number;
  jumped: boolean;
  touchingCactus: boolean;
  headInBlock: boolean;
  inVoid: boolean;
}

export class PlayerStats {
  health = 20;
  food = 20;
  saturation = 5;
  exhaustion = 0;
  air = MAX_AIR;
  /** Seconds of burning left. */
  fire = 0;
  /** Seconds of Regeneration II left (golden apple). */
  regen = 0;
  dead = false;
  deathCause: DamageSource | null = null;
  /** 1 right after taking damage, decays (for the red flash / camera tilt). */
  hurt = 0;
  private invuln = 0;
  private lastDamage = 0;
  private regenTimer = 0;
  private starveTimer = 0;
  private drownTimer = 0;
  private hazardTimer = 0;
  private fireTimer = 0;
  private regenEffectTimer = 0;
  private peacefulTimer = 0;
  /** Called with the damage actually taken (after armor). */
  onDamage: ((amount: number, source: DamageSource) => void) | null = null;
  /** Armor points and toughness, and a callback that wears armor down. */
  armor: () => [number, number] = () => [0, 0];
  wearArmor: (amount: number) => void = () => {};

  reset() {
    this.health = 20; this.food = 20; this.saturation = 5; this.exhaustion = 0; this.air = MAX_AIR;
    this.fire = 0; this.regen = 0; this.dead = false; this.deathCause = null; this.hurt = 0; this.invuln = 0;
  }

  get canSprint(): boolean {
    return this.food > 6;
  }

  canEat(food: FoodInfo, creative: boolean): boolean {
    return !this.dead && (food.always === true || (!creative && this.food < 20));
  }

  eat(food: FoodInfo) {
    this.food = Math.min(20, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.saturation);
    if (food.regen) this.regen = Math.max(this.regen, food.regen);
  }

  exhaust(amount: number) {
    this.exhaustion = Math.min(40, this.exhaustion + amount);
  }

  heal(amount: number) {
    if (!this.dead) this.health = Math.min(20, this.health + amount);
  }

  /** Applies damage (armor, invulnerability frames). Returns the damage taken. */
  damage(amount: number, source: DamageSource, creative: boolean): number {
    if (this.dead || amount <= 0) return 0;
    if (creative && source !== 'void') return 0;
    // Half a second of invulnerability: only a bigger hit gets through, for the difference.
    if (this.invuln > 0) {
      if (amount <= this.lastDamage) return 0;
      const extra = amount - this.lastDamage;
      this.lastDamage = amount;
      amount = extra;
    } else {
      this.lastDamage = amount;
      this.invuln = 0.5;
    }
    if (ARMORED[source]) {
      const [def, tough] = this.armor();
      if (def > 0) {
        const eff = Math.min(20, Math.max(def / 5, def - (4 * amount) / (tough + 8)));
        this.wearArmor(Math.max(1, Math.floor(amount / 4)));
        amount *= 1 - eff / 25;
      }
    }
    amount = Math.round(amount * 100) / 100;
    if (amount <= 0) return 0;
    this.health = Math.max(0, this.health - amount);
    this.exhaust(0.1);
    this.hurt = 1;
    this.onDamage?.(amount, source);
    if (this.health <= 0) {
      this.dead = true;
      this.deathCause = source;
    }
    return amount;
  }

  /** Fall damage for a landing (hay bales absorb 80%). */
  fall(distance: number, onHay: boolean, creative: boolean) {
    const d = Math.ceil(distance - 3);
    if (d > 0) this.damage(onHay ? Math.max(0, Math.round(d * 0.2)) : d, 'fall', creative);
  }

  update(dt: number, c: StatsContext) {
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.dead) return;
    if (c.creative) {
      this.air = MAX_AIR;
      this.fire = 0;
      if (c.inVoid) this.voidDamage(dt, c);
      return;
    }

    // Exhaustion from moving around.
    if (c.sprinting) this.exhaust(0.1 * c.movedDist);
    else if (c.swimming) this.exhaust(0.01 * c.movedDist);
    if (c.jumped) this.exhaust(c.sprinting ? 0.2 : 0.05);
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (c.difficulty !== 'Peaceful') this.food = Math.max(0, this.food - 1);
    }

    // Natural regeneration and starvation.
    if (c.difficulty === 'Peaceful') {
      this.peacefulTimer += dt;
      if (this.peacefulTimer >= 1) {
        this.peacefulTimer = 0;
        this.heal(1);
        if (this.food < 20) this.food++;
      }
    }
    if (this.food >= 20 && this.saturation > 0 && this.health < 20) {
      this.regenTimer += dt;
      if (this.regenTimer >= 0.5) {
        this.regenTimer = 0;
        const h = Math.min(this.saturation, 6) / 6;
        this.heal(h);
        this.exhaust(h * 6);
      }
    } else if (this.food >= 18 && this.health < 20) {
      this.regenTimer += dt;
      if (this.regenTimer >= 4) {
        this.regenTimer = 0;
        this.heal(1);
        this.exhaust(6);
      }
    } else if (this.food <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        const floor = c.difficulty === 'Easy' ? 10 : c.difficulty === 'Normal' ? 1 : 0;
        if (this.health > floor) this.damage(1, 'starve', false);
      }
    } else this.regenTimer = 0;

    if (this.regen > 0) {
      this.regen -= dt;
      this.regenEffectTimer += dt;
      if (this.regenEffectTimer >= 1.25) { this.regenEffectTimer = 0; this.heal(1); }
    }

    // Air
    if (c.eyeInWater) {
      this.air -= dt;
      if (this.air <= 0) {
        this.air = 0;
        this.drownTimer += dt;
        if (this.drownTimer >= 1) { this.drownTimer = 0; this.damage(2, 'drown', false); }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 4);
      this.drownTimer = 0;
    }

    // Lava, fire, cactus, suffocation, void
    this.hazardTimer -= dt;
    if (c.inLava) {
      this.fire = 15;
      if (this.hazardTimer <= 0) { this.hazardTimer = 0.5; this.damage(4, 'lava', false); }
    } else if (c.touchingCactus && this.hazardTimer <= 0) {
      this.hazardTimer = 0.5;
      this.damage(1, 'cactus', false);
    } else if (c.headInBlock && this.hazardTimer <= 0) {
      this.hazardTimer = 0.5;
      this.damage(1, 'suffocate', false);
    }
    if (c.wet) this.fire = 0;
    if (this.fire > 0) {
      this.fire -= dt;
      this.fireTimer += dt;
      if (this.fireTimer >= 1 && !c.inLava) { this.fireTimer = 0; this.damage(1, 'fire', false); }
    } else this.fireTimer = 0;
    if (c.inVoid) this.voidDamage(dt, c);
  }

  private voidDamage(dt: number, c: StatsContext) {
    this.hazardTimer -= dt;
    if (this.hazardTimer <= 0) { this.hazardTimer = 0.5; this.damage(4, 'void', c.creative); }
  }

  serialize() {
    return { h: this.health, f: this.food, s: this.saturation, e: this.exhaustion, a: this.air, r: this.regen };
  }

  load(d: unknown) {
    const o = d as Record<string, number> | null;
    if (!o || typeof o !== 'object') return;
    const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
    this.health = num(o.h, 0, 20, 20);
    this.food = Math.round(num(o.f, 0, 20, 20));
    this.saturation = num(o.s, 0, 20, 5);
    this.exhaustion = num(o.e, 0, 40, 0);
    this.air = num(o.a, 0, MAX_AIR, MAX_AIR);
    this.regen = num(o.r, 0, 60, 0);
    if (this.health <= 0) this.health = 20;
  }
}

export const DEATH_MESSAGES: Record<DamageSource, string> = {
  fall: 'hit the ground too hard',
  lava: 'tried to swim in lava',
  fire: 'burned to death',
  drown: 'drowned',
  starve: 'starved to death',
  cactus: 'was pricked to death',
  void: 'fell out of the world',
  suffocate: 'suffocated in a wall',
  explosion: 'blew up',
};
