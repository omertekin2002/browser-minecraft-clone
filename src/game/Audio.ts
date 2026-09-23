import type { SoundType } from '../world/blocks';

interface MatSound {
  type: BiquadFilterType;
  freq: number;
  q: number;
  decay: number;
  gain: number;
  tone?: number; // optional resonant knock frequency
}

const MATS: Record<SoundType, MatSound> = {
  stone: { type: 'bandpass', freq: 1700, q: 1.1, decay: 0.07, gain: 0.9, tone: 180 },
  dirt: { type: 'lowpass', freq: 900, q: 0.7, decay: 0.09, gain: 1.0 },
  grass: { type: 'bandpass', freq: 3200, q: 0.6, decay: 0.11, gain: 0.8 },
  wood: { type: 'bandpass', freq: 650, q: 3.5, decay: 0.1, gain: 1.0, tone: 240 },
  sand: { type: 'highpass', freq: 2400, q: 0.5, decay: 0.14, gain: 0.55 },
  gravel: { type: 'bandpass', freq: 1300, q: 0.7, decay: 0.12, gain: 0.9 },
  glass: { type: 'highpass', freq: 3500, q: 0.8, decay: 0.08, gain: 0.7 },
  wool: { type: 'lowpass', freq: 600, q: 0.5, decay: 0.08, gain: 0.8 },
  snow: { type: 'bandpass', freq: 2200, q: 0.5, decay: 0.12, gain: 0.7 },
  plant: { type: 'highpass', freq: 1800, q: 0.6, decay: 0.06, gain: 0.6 },
  metal: { type: 'bandpass', freq: 2600, q: 9, decay: 0.18, gain: 0.6, tone: 880 },
};

export interface AmbientState {
  daylight: number; // 0..1
  outdoor: number; // 0..1
  underwater: boolean;
  altitude: number;
  rain: number; // 0..1
}

/** Procedural WebAudio: block sounds, footsteps and ambience (wind, birds, crickets). */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private cricketGain!: GainNode;
  private rainGain!: GainNode;
  private nextBird = 0;
  private volume = 0.6;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind: looping brown-ish noise through a slowly swept band-pass.
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    const wind = ctx.createBufferSource();
    wind.buffer = brown;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(this.windFilter.frequency);
    lfo.start();

    // Crickets: amplitude-modulated high sine.
    const cr = ctx.createOscillator();
    cr.frequency.value = 4400;
    const am = ctx.createOscillator();
    am.type = 'square';
    am.frequency.value = 28;
    const amGain = ctx.createGain();
    amGain.gain.value = 0.5;
    const crAmp = ctx.createGain();
    crAmp.gain.value = 0.5;
    am.connect(amGain).connect(crAmp.gain);
    const chirpLfo = ctx.createOscillator();
    chirpLfo.frequency.value = 1.3;
    const chirpGain = ctx.createGain();
    chirpGain.gain.value = 0.5;
    const crGate = ctx.createGain();
    crGate.gain.value = 0.5;
    chirpLfo.connect(chirpGain).connect(crGate.gain);
    this.cricketGain = ctx.createGain();
    this.cricketGain.gain.value = 0;
    cr.connect(crAmp).connect(crGate).connect(this.cricketGain).connect(this.master);
    cr.start(); am.start(); chirpLfo.start();

    // Rain: white noise through a soft band-pass.
    const rain = ctx.createBufferSource();
    rain.buffer = this.noise;
    rain.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 1800;
    rf.Q.value = 0.4;
    const rl = ctx.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 6000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rf).connect(rl).connect(this.rainGain).connect(this.master);
    rain.start();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private burst(m: MatSound, gain: number, dur: number, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = pitch;
    const f = ctx.createBiquadFilter();
    f.type = m.type;
    f.frequency.value = m.freq * pitch;
    f.Q.value = m.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * m.gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    if (m.tone) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(m.tone * pitch * 1.4, t);
      o.frequency.exponentialRampToValueAtTime(m.tone * pitch, t + dur * 0.6);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(gain * 0.25, t + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  step(s: SoundType) {
    this.burst(MATS[s], 0.16, MATS[s].decay * 1.1, 0.85 + Math.random() * 0.3);
  }
  dig(s: SoundType) {
    this.burst(MATS[s], 0.22, MATS[s].decay * 1.4, 0.8 + Math.random() * 0.25);
  }
  breakBlock(s: SoundType) {
    const m = MATS[s];
    this.burst(m, 0.45, m.decay * 3, 0.7 + Math.random() * 0.15);
    this.burst(m, 0.3, m.decay * 2, 1.1 + Math.random() * 0.2);
    if (s === 'glass' && this.ctx) {
      for (let i = 0; i < 5; i++) {
        const t = this.ctx.currentTime + i * 0.025;
        const o = this.ctx.createOscillator();
        o.frequency.value = 2500 + Math.random() * 3000;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.3);
      }
    }
  }
  place(s: SoundType) {
    this.burst(MATS[s], 0.4, MATS[s].decay * 1.8, 0.75 + Math.random() * 0.1);
  }
  /** Rolling thunder: low-passed noise with a long decay. */
  thunder(distance: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.35;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900 - distance * 500, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 3);
    const g = ctx.createGain();
    const peak = 0.9 * (1 - distance * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.08 + distance * 0.4);
    g.gain.exponentialRampToValueAtTime(peak * 0.4, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, 0, 4.6);
  }

  /** Short rising blip for picking up an item. */
  pop() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 500 + Math.random() * 350;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.1, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** One bite. */
  eat() {
    this.burst({ type: 'bandpass', freq: 1100, q: 0.8, decay: 0.07, gain: 1 }, 0.35, 0.08, 0.8 + Math.random() * 0.4);
  }

  burp() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(130, t);
    o.frequency.linearRampToValueAtTime(95, t + 0.28);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** Player hurt: a short low grunt. */
  hurt() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.22);
    this.burst({ type: 'lowpass', freq: 700, q: 0.7, decay: 0.1, gain: 1 }, 0.25, 0.12, 1);
  }

  /** A tool snapping. */
  toolBreak() {
    this.burst(MATS.glass, 0.5, 0.25, 0.9);
    this.burst(MATS.metal, 0.35, 0.3, 0.7);
  }

  /** Chest / barrel lid. */
  chest(open: boolean) {
    this.burst(MATS.wood, 0.5, 0.18, open ? 0.75 : 0.6);
    const ctx = this.ctx;
    if (!ctx) return;
    window.setTimeout(() => this.burst(MATS.wood, 0.3, 0.12, open ? 0.95 : 0.7), 70);
  }

  /** An explosion; distance 0 (on top of it) .. 1 (far away). */
  explode(distance: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200 - distance * 1400, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 1.6);
    const g = ctx.createGain();
    const peak = 1.1 * (1 - distance * 0.75);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
    g.gain.exponentialRampToValueAtTime(peak * 0.3, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, 0, 2.3);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(peak * 0.9, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.65);
  }

  /** Lava hitting water, or something catching fire. */
  fizz() {
    this.burst({ type: 'highpass', freq: 2500, q: 0.5, decay: 0.3, gain: 0.8 }, 0.4, 0.45, 1);
  }

  splash() {
    this.burst({ type: 'lowpass', freq: 1500, q: 0.7, decay: 0.5, gain: 1 }, 0.35, 0.6, 1);
  }

  private bird() {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const base = 2400 + Math.random() * 2400;
    const notes = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.master);
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.08);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = base * (0.9 + Math.random() * 0.25);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.35 : 0.75), t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  update(a: AmbientState, now: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const windLevel = a.underwater ? 0 : (0.05 + Math.min(1, Math.max(0, (a.altitude - 70) / 80)) * 0.18) * a.outdoor;
    this.windGain.gain.setTargetAtTime(windLevel, t, 0.5);
    const crickets = a.underwater ? 0 : (1 - a.daylight) * a.outdoor * 0.012;
    this.cricketGain.gain.setTargetAtTime(crickets, t, 1.0);
    this.muffle.frequency.setTargetAtTime(a.underwater ? 650 : 20000, t, 0.08);
    this.rainGain.gain.setTargetAtTime(a.underwater ? 0 : a.rain * (0.08 + 0.22 * a.outdoor), t, 0.6);
    if (!a.underwater && a.daylight > 0.4 && a.outdoor > 0.6 && now > this.nextBird) {
      this.bird();
      this.nextBird = now + 1.5 + Math.random() * 6;
    }
  }
}
