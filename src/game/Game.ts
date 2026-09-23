import { Renderer, CameraState, EnvState } from '../render/Renderer';
import { World, ChunkColumn } from '../world/World';
import { Player } from './Player';
import { Input } from './Input';
import { raycast, RayHit } from './Raycast';
import { UI } from '../ui/UI';
import { Audio } from './Audio';
import { SaveStore } from './Save';
import { GameSettings, loadSettings, saveSettings } from './Settings';
import * as B from '../world/blocks';
import { BIOME_NAMES } from '../world/gen/TerrainGenerator';
import type { MeshData } from '../world/mesh/Mesher';
import { FarTerrain } from '../render/FarTerrain';
import { compose, translation, rotationX, rotationY, rotationZ, scaling } from '../render/math';

type State = 'title' | 'playing' | 'paused' | 'inventory';

function hashSeed(s: string): number {
  if (/^-?\d+$/.test(s.trim())) return parseInt(s.trim(), 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

export class Game {
  settings: GameSettings;
  renderer: Renderer;
  world!: World;
  player = new Player();
  input: Input;
  ui: UI;
  audio = new Audio();
  save!: SaveStore;
  far: FarTerrain | null = null;
  seed = 0;
  seedLabel = '';
  hotbar: number[] = [...B.DEFAULT_HOTBAR];
  selected = 0;
  dayTime = 0.06;
  dayCount = 0;
  time = 0;
  timeFrozen = false;
  state: State = 'title';
  hit: RayHit | null = null;
  private breaking: { x: number; y: number; z: number; progress: number; block: number } | null = null;
  private breakCooldown = 0;
  private placeCooldown = 0;
  private digSound = 0;
  private uploads = new Map<number, [ChunkColumn, MeshData]>();
  private debug = false;
  private hudHidden = false;
  private last = 0;
  private fps = 60;
  private frameMs = 16;
  private playerSky = 1;
  private spawned = false;
  private autoplay = false;
  private titleYaw = 0;
  private saveTimer = 0;
  private loadStartChunks = 0;
  private swing = 1;
  private equip = 1;
  private lockTimer = 0;
  /** True for a brand-new world: the spawn gets moved to open ground once terrain exists. */
  private freshSpawn = false;
  private perfHintShown = false;
  private slowTime = 0;
  /** Weather: current rain intensity, target, timer until the next change, lightning flash. */
  rain = 0;
  private rainTarget = 0;
  private weatherTimer = 240;
  private storm = false;
  private lightning = 0;
  private nextLightning = 5;

  constructor(private canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    const params = new URLSearchParams(location.search);
    this.autoplay = params.has('autoplay');
    this.renderer = new Renderer(canvas);
    this.applySettings();
    this.input = new Input(canvas);
    this.ui = new UI({
      play: () => this.play(),
      resume: () => this.play(),
      settingsChanged: (k) => this.onSettingChanged(k),
      newWorld: (s) => this.newWorld(s),
      pickInventory: (id) => this.pickInventory(id),
      toggleMode: () => this.toggleMode(),
      setTime: (t) => { this.dayTime = t; this.renderer.resetHistory(); },
      quitToTitle: () => this.quitToTitle(),
    }, this.settings, this.renderer.textureSet);

    this.player.onStep = (b) => { if (b > 0) this.audio.step(B.BLOCKS[b].sound); };
    this.player.onLand = (b, speed) => { if (b > 0) this.audio.place(B.BLOCKS[b].sound); void speed; };
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.autoplay) this.setState('paused');
    };
    canvas.addEventListener('click', () => {
      if (this.state === 'paused') this.play();
      else if (this.state === 'playing' && !this.input.locked && !this.autoplay) this.input.lock();
    });
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', () => this.persist());

    let seedStr = params.get('seed') ?? localStorage.getItem('voxelcraft:seed') ?? String(Math.floor(Math.random() * 1e9));
    this.loadWorld(seedStr, params);
    this.ui.setHotbar(this.hotbar, this.selected);
    this.ui.setMode(this.player.creative);
    this.ui.show('title');
    this.onResize();
    (window as any).__game = this;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------------------
  // World lifecycle
  // ---------------------------------------------------------------------------

  private async loadWorld(seedStr: string, params?: URLSearchParams) {
    this.seedLabel = seedStr;
    this.seed = hashSeed(seedStr);
    try { localStorage.setItem('voxelcraft:seed', seedStr); } catch { /* ignore */ }
    this.ui.setSeed(seedStr);
    this.save = new SaveStore(this.seed);
    const saved = await this.save.loadAll();
    this.world = new World(this.seed, {
      onMesh: (col, data) => this.onMesh(col, data),
      onUnload: (col) => { this.renderer.meshes.remove(col.key); this.uploads.delete(col.key); },
      onModified: (col) => this.save.markDirty(col.key, col.blocks!),
    });
    for (const [k, v] of saved) this.world.savedChunks.set(k, v);
    this.world.renderDistance = this.settings.renderDistance;
    this.far?.dispose();
    this.far = new FarTerrain(this.renderer.gl, this.world.pool);
    this.far.enabled = this.settings.farTerrain;
    this.renderer.far = this.far;

    const ps = this.save.loadPlayer();
    if (ps) {
      Object.assign(this.player, { x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw, pitch: ps.pitch, flying: ps.flying, creative: ps.creative ?? true });
      this.dayTime = ps.dayTime;
      this.dayCount = ps.dayCount ?? 0;
      if (Array.isArray(ps.hotbar) && ps.hotbar.length === 9) this.hotbar = ps.hotbar.filter((b) => B.BLOCKS[b]).length === 9 ? ps.hotbar : this.hotbar;
    } else {
      this.freshSpawn = true;
      const [sx, sy, sz] = this.world.gen.findSpawn();
      this.player.x = sx;
      this.player.y = sy + 0.01;
      this.player.z = sz;
      this.player.yaw = Math.PI * 0.25;
      this.player.pitch = -0.05;
    }
    if (params) {
      const num = (k: string) => (params.has(k) ? parseFloat(params.get(k)!) : null);
      const x = num('x'), y = num('y'), z = num('z');
      if (x !== null) this.player.x = x;
      if (y !== null) this.player.y = y;
      if (z !== null) this.player.z = z;
      const yaw = num('yaw'), pitch = num('pitch'), time = num('time');
      if (yaw !== null) this.player.yaw = (yaw * Math.PI) / 180;
      if (pitch !== null) this.player.pitch = (pitch * Math.PI) / 180;
      if (time !== null) this.dayTime = time;
      if (params.has('fly')) this.player.flying = true;
      if (params.has('freeze')) this.timeFrozen = true;
    }
    this.titleYaw = this.player.yaw;
    this.player.frozen = true;
    this.spawned = false;
    this.loadStartChunks = 0;
    this.renderer.resetHistory();
    this.ui.setMode(this.player.creative);
    this.ui.setHotbar(this.hotbar, this.selected);
    if (this.autoplay) this.setState('playing');
  }

  private persist() {
    if (!this.world) return;
    this.save.savePlayer({
      x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch,
      dayTime: this.dayTime, dayCount: this.dayCount, flying: this.player.flying, creative: this.player.creative, hotbar: this.hotbar,
    });
    this.save.flush();
  }

  private async newWorld(seedStr: string) {
    seedStr = seedStr.trim() || String(Math.floor(Math.random() * 1e9));
    this.persist();
    this.world?.dispose();
    this.uploads.clear();
    this.renderer.meshes.dispose();
    this.hotbar = [...B.DEFAULT_HOTBAR];
    this.dayTime = 0.06;
    this.dayCount = 0;
    await this.loadWorld(seedStr);
    this.ui.toast(`New world: ${seedStr}`);
  }

  private onMesh(col: ChunkColumn, data: MeshData) {
    const p = this.player;
    const dx = col.cx - Math.floor(p.x / 16), dz = col.cz - Math.floor(p.z / 16);
    if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
      this.uploads.delete(col.key);
      this.renderer.meshes.upload(col.key, data);
    } else {
      this.uploads.set(col.key, [col, data]);
    }
  }

  private processUploads(budgetMs: number) {
    const t0 = performance.now();
    for (const [key, [col, data]] of this.uploads) {
      this.uploads.delete(key);
      if (this.world.chunks.get(key) !== col) continue;
      this.renderer.meshes.upload(key, data);
      if (performance.now() - t0 > budgetMs) break;
    }
  }

  // ---------------------------------------------------------------------------
  // State / settings
  // ---------------------------------------------------------------------------

  private setState(s: State) {
    this.state = s;
    this.input.enabled = s === 'playing';
    if (s === 'playing') this.ui.show(null);
    else if (s === 'paused') this.ui.show('pause');
    else if (s === 'inventory') this.ui.show('inventory');
    else this.ui.show('title');
  }

  private play() {
    this.audio.init();
    this.audio.setVolume(this.settings.volume);
    this.setState('playing');
    if (!this.autoplay) {
      this.input.lock();
      // Browsers can refuse pointer lock (e.g. right after Esc); fall back to the pause screen.
      clearTimeout(this.lockTimer);
      this.lockTimer = window.setTimeout(() => {
        if (this.state === 'playing' && !this.input.locked) {
          this.setState('paused');
          this.ui.toast('Click the game to capture the mouse');
        }
      }, 900);
    }
  }

  private quitToTitle() {
    this.persist();
    this.input.unlock();
    this.titleYaw = this.player.yaw;
    this.setState('title');
  }

  private toggleMode() {
    this.player.creative = !this.player.creative;
    if (!this.player.creative) this.player.flying = false;
    this.ui.setMode(this.player.creative);
    this.ui.toast(this.player.creative ? 'Creative mode' : 'Survival mode');
  }

  private pickInventory(id: number) {
    this.hotbar[this.selected] = id;
    this.ui.setHotbar(this.hotbar, this.selected);
    this.ui.flashName(B.BLOCKS[id].displayName);
  }

  private applySettings() {
    const s = this.settings;
    const r = this.renderer.settings;
    const scaleChanged = r.renderScale !== s.renderScale;
    Object.assign(r, {
      renderScale: s.renderScale, shadows: s.shadows, shadowDistance: s.shadowDistance, clouds: s.clouds,
      volumetric: s.volumetric, ssr: s.ssr, taa: s.taa, bloom: s.bloom, tonemap: s.tonemap, fov: s.fov,
      exposureBias: s.exposureBias, saturation: s.saturation, sharpen: s.sharpen, cloudCoverage: s.cloudCoverage,
      renderDistance: s.renderDistance, farTerrain: s.farTerrain, parallax: s.parallax,
    });
    if (this.far) this.far.enabled = s.farTerrain;
    if (this.world) this.world.renderDistance = s.renderDistance;
    if (scaleChanged) this.onResize(true);
    this.audio.setVolume(s.volume);
  }

  private onSettingChanged(_k: keyof GameSettings) {
    this.applySettings();
    saveSettings(this.settings);
  }

  private onResize(force = false) {
    const w = window.innerWidth, h = window.innerHeight;
    if (force) (this.renderer as any).width = 0;
    this.renderer.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, Math.max(0.0005, (now - (this.last || now)) / 1000));
    this.last = now;
    this.fps += (1 / dt - this.fps) * 0.05;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (!this.world) return;
    try {
      this.update(dt);
      this.render(dt);
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
  }

  private getBlock = (x: number, y: number, z: number) => this.world.getBlock(x, y, z);

  private update(dt: number) {
    const p = this.player;
    const input = this.input;
    this.time += dt;

    // Global keys
    if (input.hit('KeyE') && (this.state === 'playing' || this.state === 'inventory')) {
      if (this.state === 'playing') { this.input.unlock(); this.setState('inventory'); }
      else this.play();
    }
    if (input.hit('Escape') && this.state === 'inventory') this.play();
    if (input.hit('F3')) this.debug = !this.debug;
    if (input.hit('F1')) { this.hudHidden = !this.hudHidden; this.ui.setHudHidden(this.hudHidden); }
    if (input.hit('F2')) this.screenshot();

    // Day/night
    if (!this.timeFrozen) {
      let rate = 1 / (this.settings.dayLength * 60);
      if (this.state === 'playing') {
        if (input.keys.has('BracketRight')) rate = 0.06;
        if (input.keys.has('BracketLeft')) rate = -0.06;
      }
      this.dayTime += dt * rate;
      if (this.dayTime >= 1) { this.dayTime -= 1; this.dayCount++; }
      if (this.dayTime < 0) { this.dayTime += 1; this.dayCount--; }
    }

    this.updateWeather(dt);

    // Streaming
    const f = p.forward();
    this.world.setViewDirection(f[0], f[2]);
    this.world.update(p.x, p.z);
    // Distant terrain only after the playable area has loaded, so it never competes with nearby chunks.
    if (this.far && this.spawned && this.world.pool.queued < 8) this.far.update(p.x, p.z);
    this.processUploads(this.spawned ? 3 : 10);

    // Spawn gating: hold the player until nearby terrain is meshed.
    if (!this.spawned) {
      const pending = this.world.pendingCount();
      if (!this.loadStartChunks) this.loadStartChunks = Math.max(1, pending);
      const ready = this.world.areaReady(p.x, p.z, 1);
      const progress = 1 - pending / Math.max(this.loadStartChunks, 1);
      this.ui.setLoading(ready && progress > 0.35 ? null : Math.max(0, Math.min(1, progress)), `${pending} chunks remaining`);
      if (ready) {
        this.spawned = true;
        p.frozen = false;
        this.ui.setLoading(null);
        if (this.freshSpawn) {
          this.freshSpawn = false;
          this.findOpenGround();
        }
        // Make sure we are not inside terrain.
        let guard = 0;
        while (guard++ < 256 && (B.IS_SOLID[this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] || B.IS_SOLID[this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z))])) p.y += 1;
      }
    }

    if (this.state === 'title') {
      this.titleYaw += dt * 0.035;
      return;
    }

    if (this.state === 'playing') {
      p.look(input.mouseDX, input.mouseDY, this.settings.sensitivity);
      // Hotbar
      for (let i = 0; i < 9; i++) {
        if (input.hit(`Digit${i + 1}`)) this.selectSlot(i);
      }
      if (input.wheel !== 0) this.selectSlot((this.selected + input.wheel + 9) % 9);
    }
    p.update(dt, input, this.getBlock, this.time);
    if (p.y < -64) { p.y = 200; p.vy = 0; }

    if (this.state === 'playing' && this.spawned) this.interact(dt);
    else this.breaking = null;
    this.swing = Math.min(1, this.swing + dt / 0.3);
    this.equip = Math.min(1, this.equip + dt / 0.22);
    this.renderer.entities.update(dt, (x, y, z) => {
      const b = this.world.getBlock(x, y, z);
      return b > 0 && B.IS_SOLID[b] === 1;
    });

    // One-time hint when the machine struggles with the current preset.
    if (this.state === 'playing' && this.spawned && !this.perfHintShown) {
      this.slowTime = this.fps < 32 ? this.slowTime + dt : Math.max(0, this.slowTime - dt);
      if (this.slowTime > 6) {
        this.perfHintShown = true;
        this.ui.toast('Running slowly? Try a lower preset or Render Resolution (Esc → Graphics)', 6000);
      }
    }

    // Save periodically
    this.saveTimer += dt;
    if (this.saveTimer > 10) { this.saveTimer = 0; this.persist(); }
  }

  private selectSlot(i: number) {
    if (i === this.selected) return;
    this.selected = i;
    this.equip = 0;
    this.ui.setHotbar(this.hotbar, this.selected);
    this.ui.flashName(B.BLOCKS[this.hotbar[i]].displayName);
  }

  private interact(dt: number) {
    const p = this.player;
    const input = this.input;
    const f = p.forward();
    const reach = p.creative ? 6 : 5;
    this.hit = raycast(this.getBlock, p.x, p.eyeY, p.z, f[0], f[1], f[2], reach);
    this.breakCooldown -= dt;
    this.placeCooldown -= dt;
    const hit = this.hit;

    // Breaking
    if (input.buttons.has(0) && hit) {
      const def = B.BLOCKS[hit.block];
      if (p.creative) {
        if (this.breakCooldown <= 0) {
          this.breakBlock(hit.x, hit.y, hit.z);
          this.breakCooldown = 0.22;
        }
        this.breaking = null;
      } else {
        if (!this.breaking || this.breaking.x !== hit.x || this.breaking.y !== hit.y || this.breaking.z !== hit.z) {
          this.breaking = { x: hit.x, y: hit.y, z: hit.z, progress: 0, block: hit.block };
        }
        if (def.hardness !== Infinity) {
          this.breaking.progress += dt / Math.max(0.05, def.hardness);
          this.digSound -= dt;
          if (this.digSound <= 0) {
            this.audio.dig(def.sound);
            this.digSound = 0.24;
            this.renderer.entities.spawnDig(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.block);
            this.swing = 0;
          }
          if (this.breaking.progress >= 1) {
            this.breakBlock(hit.x, hit.y, hit.z);
            this.breaking = null;
            this.breakCooldown = 0.15;
          }
        }
      }
    } else {
      this.breaking = null;
    }

    // Placing
    if (hit && (input.clicked.has(2) || (input.buttons.has(2) && this.placeCooldown <= 0))) {
      this.placeCooldown = 0.22;
      this.placeBlock(hit);
    }

    // Pick block
    if (hit && input.clicked.has(1)) {
      const id = hit.block;
      const existing = this.hotbar.indexOf(id);
      if (existing >= 0) this.selectSlot(existing);
      else {
        this.hotbar[this.selected] = id;
        this.ui.setHotbar(this.hotbar, this.selected);
        this.ui.flashName(B.BLOCKS[id].displayName);
      }
    }
  }

  private breakBlock(x: number, y: number, z: number) {
    const id = this.world.getBlock(x, y, z);
    if (id <= 0 || (id === B.BEDROCK && !this.player.creative)) return;
    this.world.setBlock(x, y, z, B.AIR);
    this.audio.breakBlock(B.BLOCKS[id].sound);
    this.renderer.entities.spawnBreak(x, y, z, id);
    this.swing = 0;
  }

  private placeBlock(hit: RayHit) {
    const id = this.hotbar[this.selected];
    const def = B.BLOCKS[id];
    let tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
    if (B.BLOCKS[hit.block].replaceable && !B.BLOCKS[hit.block].liquid) {
      tx = hit.x; ty = hit.y; tz = hit.z;
    }
    if (ty < 0 || ty > 255) return;
    const cur = this.world.getBlock(tx, ty, tz);
    if (cur < 0 || (cur !== B.AIR && !B.BLOCKS[cur].replaceable)) return;
    if (def.solid && this.player.intersectsBlock(tx, ty, tz)) return;
    if (def.needsSupport) {
      const below = this.world.getBlock(tx, ty - 1, tz);
      if (below <= 0 || !B.IS_SOLID[below]) {
        if (!(id === B.SUGAR_CANE && below === B.SUGAR_CANE) && !(id === B.CACTUS && below === B.CACTUS)) return;
      }
      if (def.shape === B.Shape.CROSS && id !== B.DEAD_BUSH && id !== B.SUGAR_CANE && ![B.GRASS, B.DIRT, B.SNOWY_GRASS, B.SAND, B.GRAVEL, B.CLAY].includes(below) && !(id === B.RED_MUSHROOM || id === B.BROWN_MUSHROOM)) return;
    }
    if (cur === B.WATER && def.shape === B.Shape.CROSS) return;
    this.world.setBlock(tx, ty, tz, id);
    if (id === B.WATER) this.audio.splash(); else this.audio.place(def.sound);
    this.swing = 0;
  }

  private screenshot() {
    this.canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `voxelcraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    this.ui.toast('Screenshot saved');
  }

  private updateWeather(dt: number) {
    const mode = this.settings.weather;
    if (mode === 'Dynamic') {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        const r = Math.random();
        if (this.rainTarget > 0 || r < 0.65) { this.rainTarget = 0; this.storm = false; this.weatherTimer = 300 + Math.random() * 600; }
        else if (r < 0.88) { this.rainTarget = 0.75; this.storm = false; this.weatherTimer = 120 + Math.random() * 240; }
        else { this.rainTarget = 1; this.storm = true; this.weatherTimer = 120 + Math.random() * 180; }
      }
    } else {
      this.rainTarget = mode === 'Clear' ? 0 : mode === 'Rain' ? 0.75 : 1;
      this.storm = mode === 'Storm';
    }
    this.rain += (this.rainTarget - this.rain) * (1 - Math.exp(-dt / 12));
    if (this.rain < 0.002 && this.rainTarget === 0) this.rain = 0;
    // Lightning
    this.lightning *= Math.exp(-dt * 9);
    if (this.storm && this.rain > 0.8) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.nextLightning = 4 + Math.random() * 14;
        const dist = Math.random();
        this.lightning = 1 - dist * 0.6;
        window.setTimeout(() => { this.lightning = Math.max(this.lightning, 0.6 - dist * 0.3); }, 90);
        window.setTimeout(() => this.audio.thunder(dist), 400 + dist * 2600);
      }
    }
  }

  /** Column height used by rain (highest block that stops rain). */
  private rainTop = (x: number, z: number): number => {
    let y = Math.min(255, Math.floor(this.player.y) + 40);
    while (y > 0) {
      const b = this.world.getBlock(x, y, z);
      if (b > 0 && B.IS_SOLID[b] || b === B.WATER || b === B.OAK_LEAVES || b === B.BIRCH_LEAVES || b === B.SPRUCE_LEAVES) return y + 1;
      if (b < 0) return -1000;
      y--;
    }
    return 0;
  };

  /** Moves the player to a nearby grass/sand column with open sky (not on top of a tree). */
  private findOpenGround() {
    const p = this.player, w = this.world;
    const x0 = Math.floor(p.x), z0 = Math.floor(p.z);
    for (let r = 0; r <= 24; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = x0 + dx, z = z0 + dz;
          let y = 200;
          const passable = (b: number) => b === B.AIR || (b > 0 && B.BLOCKS[b].replaceable && !B.BLOCKS[b].liquid);
          while (y > 1 && passable(w.getBlock(x, y, z))) y--;
          const top = w.getBlock(x, y, z);
          if ((top === B.GRASS || top === B.SAND || top === B.SNOWY_GRASS) && y > 62) {
            p.x = x + 0.5; p.y = y + 1; p.z = z + 0.5;
            return;
          }
        }
      }
    }
  }

  /** View-space transform of the held block (Minecraft-style swing / equip animation). */
  private heldTransform(id: number) {
    const sp = this.swing >= 1 ? 0 : this.swing;
    const sq = Math.sqrt(sp);
    const p = this.player;
    const bob = this.settings.viewBobbing ? p.bob() : [0, 0, 0];
    const sprite = B.BLOCKS[id].shape === B.Shape.CROSS || B.BLOCKS[id].shape === B.Shape.TORCH;
    const eq = 1 - this.equip;
    const base = compose(
      translation(-0.4 * Math.sin(sq * Math.PI) - bob[0] * 1.5, 0.2 * Math.sin(sq * Math.PI * 2) - bob[1] * 0.8, -0.2 * Math.sin(sp * Math.PI)),
      translation(0.56, -0.54 - eq * 0.6, -0.78),
    );
    if (sprite) {
      return compose(base, rotationY(-0.35 + Math.sin(sp * sp * Math.PI) * -0.3), rotationZ(0.35 + Math.sin(sq * Math.PI) * -0.3), rotationX(Math.sin(sq * Math.PI) * -1.2), scaling(0.62));
    }
    return compose(
      base,
      rotationY(Math.PI / 4 + Math.sin(sp * sp * Math.PI) * (-20 * Math.PI) / 180),
      rotationZ(Math.sin(sq * Math.PI) * (-20 * Math.PI) / 180),
      rotationX(Math.sin(sq * Math.PI) * (-80 * Math.PI) / 180),
      scaling(0.4),
    );
  }

  /** Fraction of upward rays that escape to the sky (used for cave darkness / fog). */
  private skyExposure(x: number, y: number, z: number): number {
    const dirs = [[0, 1, 0], [0.5, 0.85, 0], [-0.5, 0.85, 0], [0, 0.85, 0.5], [0, 0.85, -0.5]];
    let open = 0;
    for (const d of dirs) {
      let blocked = false;
      for (let t = 1; t < 48; t += 1) {
        const b = this.world.getBlock(Math.floor(x + d[0] * t), Math.floor(y + d[1] * t), Math.floor(z + d[2] * t));
        if (b > 0 && B.IS_OPAQUE[b]) { blocked = true; break; }
        if (y + d[1] * t > 256) break;
      }
      if (!blocked) open++;
    }
    return open / dirs.length;
  }

  private render(dt: number) {
    const p = this.player;
    const s = this.settings;
    const title = this.state === 'title';
    let yaw = title ? this.titleYaw : p.yaw;
    let pitch = title ? -0.08 : p.pitch;
    let ex = p.x, ey = title ? p.eyeY + 14 : p.eyeY, ez = p.z;
    if (!title && s.viewBobbing && !p.flying) {
      const [side, upb] = p.bob();
      ex += Math.cos(yaw) * side;
      ez += Math.sin(yaw) * side;
      ey += upb;
    }
    const cam: CameraState = { x: ex, y: ey, z: ez, yaw, pitch, fovDeg: s.fov * (1 + p.fovBoost) };

    const eyeBlock = this.world.getBlock(Math.floor(ex), Math.floor(ey), Math.floor(ez));
    const underwater = eyeBlock === B.WATER;
    let waterSurface = ey + 1;
    if (underwater) {
      let yy = Math.floor(ey);
      while (yy < 256 && this.world.getBlock(Math.floor(ex), yy, Math.floor(ez)) === B.WATER) yy++;
      waterSurface = yy - 0.12;
    }
    const exposure = this.skyExposure(ex, ey, ez);
    this.playerSky += (exposure - this.playerSky) * (1 - Math.exp(-dt * 1.5));

    const held = this.hotbar[this.selected];
    const heldLight = title ? 0 : B.EMISSION[held] ? B.EMISSION[held] * 0.55 : 0;
    this.renderer.entities.setHeld(held);
    const heldModel = title || this.hudHidden ? null : this.heldTransform(held);
    const env: EnvState = {
      dayTime: this.dayTime,
      dayCount: this.dayCount,
      time: this.time,
      underwater,
      waterSurfaceY: waterSurface,
      playerSky: this.playerSky,
      heldLight,
      selection: !title && this.hit && this.state === 'playing' ? [this.hit.x, this.hit.y, this.hit.z] : null,
      breakBlock: this.breaking ? [this.breaking.x, this.breaking.y, this.breaking.z, Math.min(9, Math.floor(this.breaking.progress * 10))] : null,
      heldModel,
      playerLight: [Math.max(this.playerSky, 0.05), heldLight > 0 ? 0.92 : 0],
      rain: this.rain,
      lightning: this.lightning,
    };
    this.renderer.rain.update(dt, this.rain, cam, [2.2, 1.6], this.rainTop);
    this.renderer.render(cam, env, dt);
    this.ui.setUnderwater(underwater && !title);

    const sunY = this.renderer.sunDirection(this.dayTime)[1];
    this.audio.update({ daylight: Math.max(0, Math.min(1, sunY * 4 + 0.3)) * (1 - this.rain), outdoor: this.playerSky, underwater, altitude: ey, rain: this.rain }, this.time);

    if (this.debug && !title) this.ui.setDebug(this.debugLines());
    else this.ui.setDebug(null);
  }

  /** Debug/automation helper: place the camera and render some frames synchronously. */
  async debugView(o: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number; time?: number; frames?: number }) {
    const p = this.player;
    if (o.x !== undefined) p.x = o.x;
    if (o.y !== undefined) p.y = o.y;
    if (o.z !== undefined) p.z = o.z;
    if (o.yaw !== undefined) p.yaw = (o.yaw * Math.PI) / 180;
    if (o.pitch !== undefined) p.pitch = (o.pitch * Math.PI) / 180;
    if (o.time !== undefined) this.dayTime = o.time;
    p.flying = true;
    this.timeFrozen = true;
    this.renderer.resetHistory();
    for (let i = 0; i < (o.frames ?? 40); i++) {
      this.update(1 / 60);
      this.render(1 / 60);
      this.input.endFrame();
      await new Promise((r) => setTimeout(r, 4));
    }
  }

  private debugLines(): string[] {
    const p = this.player;
    const r = this.renderer;
    const st = r.stats;
    const w = this.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const deg = ((p.yaw * 180) / Math.PI + 360) % 360;
    const facing = deg < 45 || deg >= 315 ? 'north (-Z)' : deg < 135 ? 'east (+X)' : deg < 225 ? 'south (+Z)' : 'west (-X)';
    const hours = (6 + this.dayTime * 24) % 24;
    const hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
    const biome = BIOME_NAMES[w.gen.biomeAt(p.x, p.z)] ?? '?';
    const gs = w.stats;
    const look = this.hit ? `${B.BLOCKS[this.hit.block].displayName} @ ${this.hit.x} ${this.hit.y} ${this.hit.z}` : '-';
    return [
      `Voxelcraft  ${Math.round(this.fps)} fps (${this.frameMs.toFixed(1)} ms)`,
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Block: ${bx} ${by} ${bz}  Chunk: ${bx >> 4} ${bz >> 4}`,
      `Facing: ${facing} (${deg.toFixed(1)} / ${((p.pitch * 180) / Math.PI).toFixed(1)})`,
      `Biome: ${biome}   Sky exposure: ${this.playerSky.toFixed(2)}`,
      `Time: ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}  day ${this.dayCount}`,
      `Mode: ${p.creative ? 'creative' : 'survival'}${p.flying ? ' (flying)' : ''}${p.inWater ? ' (swimming)' : ''}`,
      `Chunks: ${w.chunks.size} loaded, ${st.chunksVisible} visible, ${w.pendingCount()} pending, ${this.uploads.size} uploads`,
      `Jobs: ${w.pool.queued} queued, ${w.pool.inFlight} running  gen ${(gs.genMs / Math.max(1, gs.genCount)).toFixed(1)}ms  mesh ${(gs.meshMs / Math.max(1, gs.meshCount)).toFixed(1)}ms`,
      `Quads: ${(st.quads / 1000).toFixed(0)}k  shadow ${(st.shadowQuads / 1000).toFixed(0)}k  draws ${st.drawCalls}`,
      `Chunk GPU memory: ${st.gpuMemMB.toFixed(1)} MB`,
      `Render: ${r.width}x${r.height} -> ${r.canvasW}x${r.canvasH}`,
      `Looking at: ${look}`,
      `Seed: ${this.seedLabel}`,
    ];
  }
}

