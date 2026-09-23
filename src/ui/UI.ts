import { BLOCKS } from '../world/blocks';
import type { TextureSet } from '../render/textures/BlockTextures';
import { blockIcon } from './icons';
import { GameSettings, PRESETS } from '../game/Settings';

export type ScreenName = 'title' | 'pause' | 'settings' | 'inventory' | null;

export interface UIHandlers {
  play(): void;
  resume(): void;
  settingsChanged(key: keyof GameSettings): void;
  newWorld(seed: string): void;
  pickInventory(id: number): void;
  toggleMode(): void;
  setTime(dayTime: number): void;
  quitToTitle(): void;
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
  private nameTimer = 0;
  private toastTimer = 0;
  current: ScreenName = 'title';
  private settingsReturn: ScreenName = 'title';

  constructor(private h: UIHandlers, private settings: GameSettings, private ts: TextureSet) {
    this.screens = {
      title: document.getElementById('screen-title')!,
      pause: document.getElementById('screen-pause')!,
      settings: document.getElementById('screen-settings')!,
      inventory: document.getElementById('screen-inventory')!,
    };
    document.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.action(el.dataset.action!);
      });
    });
    this.buildSettings();
    this.buildInventory();
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

  setHotbar(ids: number[], selected: number) {
    if (this.hotbarEl.childElementCount !== ids.length) {
      this.hotbarEl.innerHTML = '';
      ids.forEach((_, i) => {
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = `<span class="num">${i + 1}</span><img alt="" />`;
        this.hotbarEl.appendChild(s);
      });
    }
    ids.forEach((id, i) => {
      const s = this.hotbarEl.children[i] as HTMLElement;
      s.classList.toggle('selected', i === selected);
      const img = s.querySelector('img')!;
      const src = blockIcon(id, this.ts);
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
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

  // ---------------- Inventory ----------------

  private buildInventory() {
    const grid = document.getElementById('inventory-grid')!;
    grid.innerHTML = '';
    for (const b of BLOCKS) {
      if (!b || !b.inInventory) continue;
      const item = document.createElement('div');
      item.className = 'inv-item';
      item.innerHTML = `<img alt="${b.displayName}" src="${blockIcon(b.id, this.ts)}"/><span class="tip">${b.displayName}</span>`;
      item.addEventListener('click', () => this.h.pickInventory(b.id));
      grid.appendChild(item);
    }
  }
}
