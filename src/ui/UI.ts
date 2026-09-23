import { ITEMS, ItemStack } from '../world/items';
import type { TextureSet } from '../render/textures/BlockTextures';
import { itemIcon, setIconTextures } from './icons';
import { hudIcon } from './hudIcons';
import { ContainerScreen, ScreenHost } from './ContainerScreen';
import { GameSettings, PRESETS } from '../game/Settings';
import type { PlayerStats } from '../game/Survival';
import { MAX_AIR } from '../game/Survival';

export type ScreenName = 'title' | 'pause' | 'settings' | 'inventory' | 'dead' | null;

export interface UIHandlers {
  play(): void;
  resume(): void;
  settingsChanged(key: keyof GameSettings): void;
  newWorld(seed: string): void;
  toggleMode(): void;
  setTime(dayTime: number): void;
  quitToTitle(): void;
  respawn(): void;
}

type SettingDef =
  | { key: keyof GameSettings; label: string; type: 'range'; min: number; max: number; step: number; fmt?: (v: number) => string }
  | { key: keyof GameSettings; label: string; type: 'seg'; options: string[]; values?: Array<number | string | boolean> }
  | { key: keyof GameSettings; label: string; type: 'toggle' };

const SETTINGS: SettingDef[] = [
  { key: 'preset', label: 'Graphics Preset', type: 'seg', options: ['Low', 'Medium', 'High', 'Ultra'], values: ['Low', 'Medium', 'High', 'Ultra'] },
  { key: 'renderDistance', label: 'Render Distance', type: 'range', min: 4, max: 20, step: 1, fmt: (v) => `${v} chunks` },
  { key: 'farTerrain', label: 'Distant Terrain (LOD)', type: 'toggle' },
  { key: 'renderScale', label: 'Render Resolution', type: 'range', min: 0.5, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'shadows', label: 'Shadows', type: 'seg', options: ['Off', 'Low', 'High', 'Ultra'], values: [0, 1, 2, 3] },
  { key: 'shadowDistance', label: 'Shadow Distance', type: 'range', min: 64, max: 320, step: 16, fmt: (v) => `${v} blocks` },
  { key: 'clouds', label: 'Volumetric Clouds', type: 'seg', options: ['Off', 'Fast', 'Fancy'], values: [0, 1, 2] },
  { key: 'cloudCoverage', label: 'Cloud Coverage', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'weather', label: 'Weather', type: 'seg', options: ['Dynamic', 'Clear', 'Rain', 'Storm'], values: ['Dynamic', 'Clear', 'Rain', 'Storm'] },
  { key: 'difficulty', label: 'Difficulty (Survival)', type: 'seg', options: ['Peaceful', 'Easy', 'Normal', 'Hard'], values: ['Peaceful', 'Easy', 'Normal', 'Hard'] },
  { key: 'volumetric', label: 'God Rays & Mist', type: 'toggle' },
  { key: 'parallax', label: 'Parallax Occlusion (POM)', type: 'toggle' },
  { key: 'ssr', label: 'Water Reflections (SSR)', type: 'toggle' },
  { key: 'taa', label: 'Temporal Anti-Aliasing', type: 'toggle' },
  { key: 'bloom', label: 'Bloom', type: 'toggle' },
  { key: 'tonemap', label: 'Tonemapper', type: 'seg', options: ['AgX', 'ACES'], values: [0, 1] },
  { key: 'exposureBias', label: 'Exposure', type: 'range', min: -2, max: 2, step: 0.1, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} EV` },
  { key: 'saturation', label: 'Saturation', type: 'range', min: 0.5, max: 1.6, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'sharpen', label: 'Sharpening', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'fov', label: 'Field of View', type: 'range', min: 50, max: 110, step: 1, fmt: (v) => `${v}°` },
  { key: 'sensitivity', label: 'Mouse Sensitivity', type: 'range', min: 0.0005, max: 0.006, step: 0.0001, fmt: (v) => `${Math.round(v * 20000)}%` },
  { key: 'dayLength', label: 'Day Length', type: 'range', min: 2, max: 60, step: 1, fmt: (v) => `${v} min` },
  { key: 'viewBobbing', label: 'View Bobbing', type: 'toggle' },
  { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];

export class UI {
  private screens: Record<string, HTMLElement>;
  private hud = document.getElementById('hud')!;
  private hotbarEl = document.getElementById('hotbar')!;
  private nameEl = document.getElementById('blockname')!;
  private debugEl = document.getElementById('debug')!;
  private toastEl = document.getElementById('toast')!;
  private loadingEl = document.getElementById('loading')!;
  private modeBadge = document.getElementById('mode-badge')!;
  private waterEl = document.getElementById('vignette-water')!;
  private hurtEl = document.getElementById('vignette-hurt')!;
  private statsEl = document.getElementById('stats')!;
  private nameTimer = 0;
  private toastTimer = 0;
  private statsKey = '';
  current: ScreenName = 'title';
  private settingsReturn: ScreenName = 'title';
  readonly containers: ContainerScreen;

  constructor(private h: UIHandlers, private settings: GameSettings, ts: TextureSet, screenHost: ScreenHost) {
    setIconTextures(ts);
    this.screens = {
      title: document.getElementById('screen-title')!,
      pause: document.getElementById('screen-pause')!,
      settings: document.getElementById('screen-settings')!,
      inventory: document.getElementById('screen-inventory')!,
      dead: document.getElementById('screen-dead')!,
    };
    this.containers = new ContainerScreen(this.screens.inventory, screenHost);
    document.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.action(el.dataset.action!);
      });
    });
    this.buildSettings();
  }

  private action(a: string) {
    switch (a) {
      case 'play': this.h.play(); break;
      case 'resume': this.h.resume(); break;
      case 'settings': this.settingsReturn = this.current; this.show('settings'); break;
      case 'settings-done': this.show(this.settingsReturn); break;
      case 'newworld': this.h.newWorld((document.getElementById('seed-input') as HTMLInputElement).value); break;
      case 'mode': this.h.toggleMode(); break;
      case 'time-sunrise': this.h.setTime(0.0); break;
      case 'time-noon': this.h.setTime(0.25); break;
      case 'time-sunset': this.h.setTime(0.47); break;
      case 'time-night': this.h.setTime(0.72); break;
      case 'title': this.h.quitToTitle(); break;
      case 'respawn': this.h.respawn(); break;
    }
  }

  show(name: ScreenName) {
    this.current = name;
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
    this.hud.classList.toggle('hidden', name === 'title');
    if (name === 'settings') this.refreshSettings();
  }

  setHudHidden(hidden: boolean) {
    this.hud.style.visibility = hidden ? 'hidden' : '';
  }

  setSeed(seed: string) {
    document.getElementById('seed-label')!.textContent = seed;
    (document.getElementById('seed-input') as HTMLInputElement).placeholder = `World seed (current: ${seed})`;
  }

  setMode(creative: boolean) {
    document.getElementById('mode-label')!.textContent = creative ? 'Creative' : 'Survival';
    this.modeBadge.textContent = creative ? 'Creative' : 'Survival';
  }

  setHotbar(stacks: (ItemStack | null)[], selected: number) {
    if (this.hotbarEl.childElementCount !== stacks.length) {
      this.hotbarEl.innerHTML = '';
      stacks.forEach((_, i) => {
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = `<span class="num">${i + 1}</span><img alt="" /><span class="cnt"></span><div class="dur"><i></i></div>`;
        this.hotbarEl.appendChild(s);
      });
    }
    stacks.forEach((st, i) => {
      const s = this.hotbarEl.children[i] as HTMLElement;
      s.classList.toggle('selected', i === selected);
      const img = s.querySelector('img')!;
      const src = st ? itemIcon(st.id) : '';
      if ((img.getAttribute('src') ?? '') !== src) {
        if (src) img.setAttribute('src', src); else img.removeAttribute('src');
      }
      img.style.visibility = st ? 'visible' : 'hidden';
      const cnt = s.querySelector('.cnt')!;
      const t = st && st.count > 1 ? String(st.count) : '';
      if (cnt.textContent !== t) cnt.textContent = t;
      const dur = s.querySelector('.dur') as HTMLElement;
      const d = st && ITEMS[st.id];
      if (d && d.durability > 0 && st!.damage) {
        const f = Math.max(0, 1 - st!.damage / d.durability);
        dur.style.display = 'block';
        const bar = dur.firstElementChild as HTMLElement;
        bar.style.width = `${Math.round(f * 100)}%`;
        bar.style.background = `hsl(${Math.round(f * 120)}, 90%, 50%)`;
      } else dur.style.display = 'none';
    });
  }

  /** Health, hunger, armor and air above the hotbar (survival only). */
  setStats(st: PlayerStats, armor: number, visible: boolean) {
    const air = Math.ceil((st.air / MAX_AIR) * 10 - 0.01);
    const health = Math.ceil(st.health);
    const low = health <= 4 ? Math.floor(performance.now() / 120) % 4 : 0;
    const variant = st.regen > 0 ? 'regen' : '';
    const key = visible ? `${health}|${st.food}|${armor}|${air}|${low}|${variant}|${st.air < MAX_AIR}` : 'hidden';
    if (key === this.statsKey) return;
    this.statsKey = key;
    this.statsEl.classList.toggle('hidden', !visible);
    if (!visible) return;
    const row = (kind: 'heart' | 'food' | 'armor' | 'bubble', value: number, v = '', jitter = false) => {
      let html = '';
      for (let i = 0; i < 10; i++) {
        const fill = value >= (i + 1) * 2 ? 2 : value >= i * 2 + 1 ? 1 : 0;
        const dy = jitter && (i + low) % 3 === 0 ? -2 : 0;
        html += `<img alt="" src="${hudIcon(kind, fill, v)}" style="transform:translateY(${dy}px)"/>`;
      }
      return html;
    };
    const bubbles = () => {
      let html = '';
      for (let i = 0; i < 10; i++) if (i < air) html += `<img alt="" src="${hudIcon('bubble', 2)}"/>`;
      return html;
    };
    (this.statsEl.querySelector('.sbar.health') as HTMLElement).innerHTML = row('heart', health, variant, health <= 4);
    (this.statsEl.querySelector('.sbar.food') as HTMLElement).innerHTML = row('food', st.food);
    (this.statsEl.querySelector('.sbar.armor') as HTMLElement).innerHTML = armor > 0 ? row('armor', armor) : '';
    (this.statsEl.querySelector('.sbar.air') as HTMLElement).innerHTML = st.air < MAX_AIR ? bubbles() : '';
  }

  /** Red flash when hurt, orange glow while burning. */
  setHurt(hurt: number, burning: boolean) {
    const o = Math.min(1, hurt * 0.8);
    this.hurtEl.style.opacity = o > 0.01 ? String(o) : '0';
    this.hurtEl.classList.toggle('burning', burning);
  }

  showDeath(message: string) {
    document.getElementById('death-msg')!.textContent = message;
  }

  flashName(name: string) {
    this.nameEl.textContent = name;
    this.nameEl.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = window.setTimeout(() => this.nameEl.classList.remove('show'), 1400);
  }

  toast(msg: string, ms = 1800) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setDebug(lines: string[] | null) {
    if (!lines) { this.debugEl.classList.add('hidden'); return; }
    this.debugEl.classList.remove('hidden');
    this.debugEl.innerHTML = lines.map((l) => `<span>${l}</span>`).join('\n');
  }

  setLoading(progress: number | null, sub = '') {
    if (progress === null) { this.loadingEl.classList.add('hidden'); return; }
    this.loadingEl.classList.remove('hidden');
    (this.loadingEl.querySelector('.fill') as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
    this.loadingEl.querySelector('.loading-sub')!.textContent = sub;
  }

  setUnderwater(on: boolean) {
    this.waterEl.classList.toggle('on', on);
  }

  // ---------------- Settings ----------------

  private buildSettings() {
    const grid = document.getElementById('settings-grid')!;
    grid.innerHTML = '';
    for (const d of SETTINGS) {
      const box = document.createElement('div');
      box.className = 'setting';
      box.dataset.key = d.key as string;
      const label = document.createElement('label');
      label.innerHTML = `<span>${d.label}</span><span class="val"></span>`;
      box.appendChild(label);
      if (d.type === 'range') {
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = String(d.min);
        inp.max = String(d.max);
        inp.step = String(d.step);
        inp.addEventListener('input', () => {
          (this.settings as any)[d.key] = parseFloat(inp.value);
          this.onChange(d.key);
        });
        box.appendChild(inp);
      } else {
        const seg = document.createElement('div');
        seg.className = 'seg';
        const opts = d.type === 'toggle' ? ['Off', 'On'] : d.options;
        const vals = d.type === 'toggle' ? [false, true] : d.values ?? d.options;
        opts.forEach((o, i) => {
          const b = document.createElement('button');
          b.textContent = o;
          b.addEventListener('click', () => {
            (this.settings as any)[d.key] = vals[i];
            this.onChange(d.key);
          });
          seg.appendChild(b);
        });
        box.appendChild(seg);
      }
      grid.appendChild(box);
    }
  }

  private onChange(key: keyof GameSettings) {
    if (key === 'preset') {
      Object.assign(this.settings, PRESETS[this.settings.preset]);
    } else if (['renderScale', 'shadows', 'shadowDistance', 'clouds', 'volumetric', 'ssr', 'renderDistance'].includes(key as string)) {
      this.settings.preset = 'Custom';
    }
    this.h.settingsChanged(key);
    this.refreshSettings();
  }

  refreshSettings() {
    for (const d of SETTINGS) {
      const box = document.querySelector<HTMLElement>(`.setting[data-key="${d.key as string}"]`);
      if (!box) continue;
      const v = (this.settings as any)[d.key];
      const val = box.querySelector('.val')!;
      if (d.type === 'range') {
        (box.querySelector('input') as HTMLInputElement).value = String(v);
        val.textContent = d.fmt ? d.fmt(v) : String(v);
      } else {
        const vals = d.type === 'toggle' ? [false, true] : d.values ?? d.options;
        box.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', vals[i] === v));
        val.textContent = d.key === 'preset' && v === 'Custom' ? 'Custom' : '';
      }
    }
  }
}
