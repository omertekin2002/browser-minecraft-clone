import { DEFAULT_SETTINGS, RenderSettings } from '../render/Renderer';

export interface GameSettings extends RenderSettings {
  preset: string;
  sensitivity: number;
  viewBobbing: boolean;
  dayLength: number; // minutes per full day
  volume: number;
  weather: string; // Dynamic | Clear | Rain | Storm
}

export const PRESETS: Record<string, Partial<GameSettings>> = {
  Low: { renderScale: 0.7, shadows: 1, shadowDistance: 96, clouds: 1, volumetric: false, ssr: false, taa: true, bloom: true, renderDistance: 6, parallax: false, farTerrain: false },
  Medium: { renderScale: 0.85, shadows: 1, shadowDistance: 128, clouds: 1, volumetric: true, ssr: true, taa: true, bloom: true, renderDistance: 8, parallax: false, farTerrain: true },
  High: { renderScale: 1.0, shadows: 2, shadowDistance: 160, clouds: 2, volumetric: true, ssr: true, taa: true, bloom: true, renderDistance: 10, parallax: true, farTerrain: true },
  Ultra: { renderScale: 1.35, shadows: 3, shadowDistance: 224, clouds: 2, volumetric: true, ssr: true, taa: true, bloom: true, renderDistance: 14, parallax: true, farTerrain: true },
};

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  ...DEFAULT_SETTINGS,
  ...PRESETS.High,
  preset: 'High',
  sensitivity: 0.0022,
  viewBobbing: true,
  dayLength: 20,
  volume: 0.6,
  weather: 'Dynamic',
};

const KEY = 'voxelcraft:settings:v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_GAME_SETTINGS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_GAME_SETTINGS };
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* ignore */ }
}
