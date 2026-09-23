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
import * as I from '../world/items';
import { ItemStack, ITEMS, copyStack, maxStack } from '../world/items';
import { BIOME_NAMES } from '../world/gen/TerrainGenerator';
import type { MeshData } from '../world/mesh/Mesher';
import { FarTerrain } from '../render/FarTerrain';
import { compose, translation, rotationX, rotationY, rotationZ, scaling } from '../render/math';
import { Inventory, HOTBAR_SIZE, INVENTORY_SIZE } from './Inventory';
import { Menu, MenuKind, MenuHost } from './Menu';
import { TileEntities, FurnaceData, ChestData } from './TileEntities';
import { ItemEntities } from './ItemEntities';
import { toolOf, breakTime, blockDrops, toolWear } from './Mining';
import { Growth } from './Growth';
import { PlayerStats, Difficulty, DEATH_MESSAGES } from './Survival';
import { TntSystem, explode, exposure } from './Explosions';
import { drawCompass, drawClock } from '../render/textures/ItemTextures';
import { invalidateIcon } from '../ui/icons';

type State = 'title' | 'playing' | 'paused' | 'inventory' | 'dead';

function hashSeed(s: string): number {
  if (/^-?\d+$/.test(s.trim())) return parseInt(s.trim(), 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

/** The item a block gives when picked with the middle mouse button. */
function pickItem(block: number): number {
  block = B.baseBlock(block);
  if (B.SLAB_BASE[block]) return B.SLAB_BASE[block];
  if (B.isCrop(block)) return I.WHEAT_SEEDS;
  if (block === B.LIT_FURNACE) return B.FURNACE;
  if (block === B.FARMLAND) return B.DIRT;
  if (B.IS_LIQUID[block]) return 0;
  return ITEMS[block] ? block : 0;
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
  /** The player's items (hotbar = slots 0–8). */
  inv = new Inventory();
  stats = new PlayerStats();
  tiles = new TileEntities();
  drops = new ItemEntities();
  tnt = new TntSystem();
  growth: Growth | null = null;
  /** Open container (inventory, crafting table, furnace, chest). */
  menu: Menu | null = null;
  spawnPoint: [number, number, number] = [0.5, 80, 0.5];
  dayTime = 0.06;
  dayCount = 0;
  time = 0;
  timeFrozen = false;
  state: State = 'title';
  hit: RayHit | null = null;
  private breaking: { x: number; y: number; z: number; progress: number; block: number; tool: number } | null = null;
  private eating: { t: number; slot: number; id: number; bite: number } | null = null;
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
  private playerBlockLight = 0;
  private spawned = false;
  private autoplay = false;
  private titleYaw = 0;
  private saveTimer = 0;
  private loadStartChunks = 0;
  private swing = 1;
  private equip = 1;
  private lastHeld = -1;
  private lockTimer = 0;
  /** True for a brand-new world: the spawn gets moved to open ground once terrain exists. */
  private freshSpawn = false;
  private perfHintShown = false;
  private slowTime = 0;
  private hurtTilt = 0;
  /** Current animation frames of the compass needle and clock dial. */
  private compassFrame = -1;
  private clockFrame = -1;
  /** Camera shake from explosions (decays). */
  private shake = 0;
  private menuHost: MenuHost;
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
      toggleMode: () => this.toggleMode(),
      setTime: (t) => { this.dayTime = t; this.renderer.resetHistory(); },
      quitToTitle: () => this.quitToTitle(),
      respawn: () => this.respawn(),
    }, this.settings, this.renderer.textureSet, { drop: (s) => this.throwStack(s) });

    const game = this;
    this.menuHost = {
      inv: this.inv,
      get creative() { return game.player.creative; },
      drop: (s) => this.throwStack(s),
      crafted: () => this.audio.place('wood'),
    };
    this.inv.onChange = () => this.refreshHotbar();
    this.stats.armor = () => this.inv.armorValues();
    this.stats.wearArmor = (n) => this.wearArmor(n);
    this.stats.onDamage = () => {
      this.audio.hurt();
      this.hurtTilt = 1;
    };

    this.player.onStep = (b) => { if (b > 0) this.audio.step(B.BLOCKS[b].sound); };
    this.player.onLand = (b, dist) => {
      if (b > 0) this.audio.place(B.BLOCKS[b].sound);
      if (this.state !== 'title') this.stats.fall(dist, b === B.HAY_BLOCK, this.player.creative);
    };
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
    this.refreshHotbar();
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
      onRemoved: (x, y, z, id) => this.onBlockRemoved(x, y, z, id),
    });
    for (const [k, v] of saved) this.world.savedChunks.set(k, v);
    this.world.renderDistance = this.settings.renderDistance;
    this.far?.dispose();
    this.far = new FarTerrain(this.renderer.gl, this.world.pool);
    this.far.enabled = this.settings.farTerrain;
    this.renderer.far = this.far;
    this.growth = new Growth(this.world, (x, y, z, id) => this.onBlockRemoved(x, y, z, id));

    this.inv.clear();
    this.inv.selected = 0;
    this.stats.reset();
    const ps = this.save.loadPlayer();
    if (ps) {
      Object.assign(this.player, { x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw, pitch: ps.pitch, flying: ps.flying, creative: ps.creative ?? true });
      this.dayTime = ps.dayTime;
      this.dayCount = ps.dayCount ?? 0;
      if (ps.inv) this.inv.load(ps.inv);
      else if (Array.isArray(ps.hotbar)) {
        // Saves from before the item system stored nine block ids.
        ps.hotbar.forEach((id, i) => {
          if (id === B.WATER) id = I.WATER_BUCKET;
          else if (id === B.LAVA) id = I.LAVA_BUCKET;
          if (i < HOTBAR_SIZE && I.isValidItem(id)) this.inv.slots[i] = { id, count: maxStack(id) };
        });
      }
      if (ps.stats) this.stats.load(ps.stats);
      this.spawnPoint = Array.isArray(ps.spawn) && ps.spawn.length === 3 ? ps.spawn : [ps.x, ps.y, ps.z];
    } else {
      this.freshSpawn = true;
      const [sx, sy, sz] = this.world.gen.findSpawn();
      this.player.x = sx;
      this.player.y = sy + 0.01;
      this.player.z = sz;
      this.player.yaw = Math.PI * 0.25;
      this.player.pitch = -0.05;
      this.spawnPoint = [sx, sy + 0.01, sz];
      if (this.player.creative) this.giveDefaultHotbar();
    }
    const meta = this.save.loadMeta();
    this.tiles.load(meta?.tiles);
    this.drops.load(meta?.drops);
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
    this.refreshHotbar();
    if (this.autoplay) this.setState('playing');
  }

  private giveDefaultHotbar() {
    I.DEFAULT_HOTBAR.forEach((id, i) => { this.inv.slots[i] = { id, count: maxStack(id) }; });
    this.inv.changed();
  }

  private persist() {
    if (!this.world) return;
    this.save.savePlayer({
      x: this.player.x, y: this.player.y, z: this.player.z, yaw: this.player.yaw, pitch: this.player.pitch,
      dayTime: this.dayTime, dayCount: this.dayCount, flying: this.player.flying, creative: this.player.creative,
      inv: this.inv.serialize(), stats: this.stats.serialize(), spawn: this.spawnPoint,
    });
    this.save.saveMeta({ tiles: this.tiles.serialize(), drops: this.drops.serialize() });
    this.save.flush();
  }

  private async newWorld(seedStr: string) {
    seedStr = seedStr.trim() || String(Math.floor(Math.random() * 1e9));
    this.persist();
    this.world?.dispose();
    this.uploads.clear();
    this.renderer.meshes.dispose();
    this.tiles.clear();
    this.drops.clear();
    this.tnt.clear();
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
    else if (s === 'dead') this.ui.show('dead');
    else this.ui.show('title');
  }

  private play() {
    this.audio.init();
    this.audio.setVolume(this.settings.volume);
    if (this.menu) this.closeScreen(false);
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
    if (this.menu) this.closeScreen(false);
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
  // Containers
  // ---------------------------------------------------------------------------

  private openScreen(kind: MenuKind, tile: FurnaceData | ChestData | null, title: string) {
    this.breaking = null;
    this.eating = null;
    this.menu = new Menu(kind, this.menuHost, tile);
    this.ui.containers.open(this.menu, title);
    this.input.unlock();
    this.setState('inventory');
  }

  private closeScreen(resume = true) {
    const m = this.menu;
    if (!m) return;
    m.close();
    this.ui.containers.close();
    this.menu = null;
    if (m.chest) this.audio.chest(false);
    if (resume) this.play();
  }

  private openInventory() {
    if (this.player.creative) this.openScreen('creative', null, 'Creative Inventory');
    else this.openScreen('inventory', null, 'Inventory');
  }

  private refreshHotbar() {
    this.ui.setHotbar(this.inv.slots.slice(0, HOTBAR_SIZE), this.inv.selected);
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
    if (input.hit('KeyE')) {
      if (this.state === 'playing') this.openInventory();
      else if (this.state === 'inventory') this.closeScreen();
    }
    if (input.hit('Escape') && this.state === 'inventory') this.closeScreen();
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
          this.spawnPoint = [p.x, p.y, p.z];
        }
        this.unstick();
      }
    }

    // World simulation (furnaces keep smelting while menus are open).
    if (this.spawned) {
      this.tiles.tick(dt, (fu, burning) => this.setFurnaceLit(fu, burning));
      this.tnt.update(dt, this.getBlock, (t) => this.explodeAt(t.x, t.y + 0.5, t.z, 4));
      this.growth?.update(dt, p.x, p.z);
      this.drops.update(
        dt, this.getBlock, this.lightAt, { x: p.x, y: p.y, z: p.z, alive: !this.stats.dead && this.state !== 'title' },
        (s) => this.give(s), () => this.audio.pop(),
        (x, y, z) => { if (Math.hypot(x - p.x, y - p.y, z - p.z) < 16) this.audio.fizz(); },
      );
    }
    if (this.state === 'inventory') this.ui.containers.tick();

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
      if (input.wheel !== 0) this.selectSlot((this.inv.selected + input.wheel + 9) % 9);
      if (input.hit('KeyQ')) this.dropHeld(input.keys.has('ControlLeft') || input.keys.has('ControlRight') || input.keys.has('MetaLeft'));
    }
    p.canSprint = p.creative || this.stats.canSprint;
    p.update(dt, input, this.getBlock, this.time);
    if (p.y < -64 && p.creative) { p.y = 200; p.vy = 0; }

    if (this.state === 'playing' && this.spawned) this.interact(dt);
    else { this.breaking = null; this.eating = null; }
    this.swing = Math.min(1, this.swing + dt / 0.3);
    this.equip = Math.min(1, this.equip + dt / 0.22);
    this.hurtTilt = Math.max(0, this.hurtTilt - dt * 3);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const heldId = this.inv.held?.id ?? 0;
    if (heldId !== this.lastHeld) { this.lastHeld = heldId; this.equip = 0; }
    this.animateItems();
    this.renderer.entities.update(dt, (x, y, z) => {
      const b = this.world.getBlock(x, y, z);
      return b > 0 && B.IS_SOLID[b] === 1;
    });

    // Survival
    if (this.spawned && (this.state === 'playing' || this.state === 'inventory')) {
      this.stats.update(dt, {
        creative: p.creative,
        difficulty: this.settings.difficulty as Difficulty,
        eyeInWater: p.eyeInWater,
        inLava: p.inLava,
        wet: p.inWater || (this.rain > 0.3 && this.playerSky > 0.9),
        sprinting: p.sprinting,
        swimming: p.inWater,
        movedDist: p.movedDist,
        jumped: p.jumped,
        touchingCactus: this.touchingCactus(),
        headInBlock: B.IS_OPAQUE[Math.max(0, this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 1.62), Math.floor(p.z)))] === 1,
        inVoid: p.y < -64,
      });
      if (this.stats.dead) this.die();
    }
    this.ui.setStats(this.stats, this.inv.armorValues()[0], !p.creative);

    // One-time hint when the machine struggles with the current preset.
    if (this.state === 'playing' && this.spawned && !this.perfHintShown) {
      this.slowTime = this.fps < 32 ? this.slowTime + dt : Math.max(0, this.slowTime - dt);
      if (this.slowTime > 6) {
        this.perfHintShown = true;
        this.ui.toast('Running slowly? Try a lower preset or Render Resolution (Esc → Graphics)', 6000);
      }
    }

    // Save periodically (and fix furnaces whose chunk was unloaded while they changed state).
    this.saveTimer += dt;
    if (this.saveTimer > 10) {
      this.saveTimer = 0;
      for (const fu of this.tiles.furnaces()) this.setFurnaceLit(fu, fu.burn > 0);
      this.persist();
    }
  }

  /** The compass points at the world spawn and the clock shows the time of day, like Minecraft's. */
  private animateItems() {
    const p = this.player;
    const ts = this.renderer.textureSet;
    const shown = (s: { id: number } | null) => !!s && (s.id === I.COMPASS || s.id === I.CLOCK);
    const inInventory = this.inv.slots.some(shown);
    if (!inInventory && !this.drops.instances.some(shown) && !this.menu?.chest?.slots.some(shown)) return;
    let changed = false;
    const angle = Math.atan2(this.spawnPoint[0] - p.x, -(this.spawnPoint[2] - p.z)) - p.yaw;
    const cf = ((Math.round((angle / (Math.PI * 2)) * 32) % 32) + 32) % 32;
    if (cf !== this.compassFrame) {
      this.compassFrame = cf;
      const t = ts.byName.get('compass')!;
      drawCompass(t, (cf / 32) * Math.PI * 2);
      this.renderer.updateTextureLayer('compass', t);
      invalidateIcon(I.COMPASS);
      changed = true;
    }
    const kf = Math.floor(this.dayTime * 64) % 64;
    if (kf !== this.clockFrame) {
      this.clockFrame = kf;
      const t = ts.byName.get('clock')!;
      drawClock(t, kf / 64);
      this.renderer.updateTextureLayer('clock', t);
      invalidateIcon(I.CLOCK);
      changed = true;
    }
    if (changed && inInventory) {
      this.refreshHotbar();
      if (this.menu) this.ui.containers.render();
    }
  }

  /** Makes sure the player isn't inside terrain (after loading or respawning). */
  private unstick() {
    const p = this.player;
    let guard = 0;
    while (guard++ < 256 && (B.IS_SOLID[this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] || B.IS_SOLID[this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z))])) p.y += 1;
  }

  private selectSlot(i: number) {
    if (i === this.inv.selected) return;
    this.inv.selected = i;
    this.eating = null;
    this.refreshHotbar();
    const s = this.inv.held;
    if (s) this.ui.flashName(ITEMS[s.id].displayName);
  }

  // ---------------------------------------------------------------------------
  // Items in the world
  // ---------------------------------------------------------------------------

  /** Adds picked-up items to the inventory; returns how many fit. */
  private give(s: ItemStack): number {
    const left = this.inv.add(s);
    return s.count - left;
  }

  /** Throws a stack from the player's hands. */
  throwStack(s: ItemStack) {
    const p = this.player;
    const f = p.forward();
    this.drops.spawn(s, p.x + f[0] * 0.3, p.eyeY - 0.35 + f[1] * 0.3, p.z + f[2] * 0.3,
      [f[0] * 5 + p.vx * 0.5 + (Math.random() - 0.5) * 0.3, f[1] * 5 + 1.5, f[2] * 5 + p.vz * 0.5 + (Math.random() - 0.5) * 0.3], 2);
  }

  private dropHeld(all: boolean) {
    const s = this.inv.held;
    if (!s) return;
    const n = all ? s.count : 1;
    this.throwStack(copyStack(s, n));
    this.inv.consumeHeld(n);
    this.swing = 0;
  }

  /** Items popping out of a block. */
  private dropAt(x: number, y: number, z: number, stacks: ItemStack[]) {
    for (const s of stacks) this.drops.spawn(s, x + 0.5 + (Math.random() - 0.5) * 0.4, y + 0.35, z + 0.5 + (Math.random() - 0.5) * 0.4);
  }

  /** A block broke by itself (support removed, leaves decayed). */
  private onBlockRemoved(x: number, y: number, z: number, id: number) {
    if (!this.player.creative) this.dropAt(x, y, z, blockDrops(id, undefined));
    this.renderer.entities.spawnBreak(x, y, z, id);
  }

  /** Approximate light at a point for dropped items: open sky, and nearby light sources. */
  private lightAt = (x: number, y: number, z: number): [number, number] => {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    let sky = 1;
    for (let yy = by + 1; yy < Math.min(256, by + 96); yy++) {
      const b = this.world.getBlock(bx, yy, bz);
      if (b > 0 && B.LIGHT_OPACITY[b] >= 15) { sky = 0.2; break; }
    }
    let light = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const b = this.world.getBlock(bx + dx, by + dy, bz + dz);
      if (b > 0 && B.EMISSION[b]) light = Math.max(light, B.EMISSION[b] - Math.abs(dx) - Math.abs(dy) - Math.abs(dz));
    }
    return [sky, Math.max(0, light) / 15];
  };

  private setFurnaceLit(f: FurnaceData, burning: boolean) {
    const b = this.world.getBlock(f.x, f.y, f.z);
    const base = B.baseBlock(b), facing = B.facingOf(b);
    if (base === B.FURNACE && burning) this.world.setBlock(f.x, f.y, f.z, B.FACING[B.LIT_FURNACE][facing], false);
    else if (base === B.LIT_FURNACE && !burning) this.world.setBlock(f.x, f.y, f.z, B.FACING[B.FURNACE][facing], false);
  }

  private wearArmor(n: number) {
    let broke = false;
    for (let i = 0; i < 4; i++) {
      const s = this.inv.armor[i];
      if (s && Inventory.damage(s, n)) { this.inv.armor[i] = null; broke = true; }
    }
    if (broke) this.audio.toolBreak();
    this.inv.changed();
  }

  private touchingCactus(): boolean {
    const [x0, y0, z0, x1, y1, z1] = this.player.box;
    const e = 0.07;
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) {
      for (let z = Math.floor(z0 - e); z <= Math.floor(z1 + e); z++) {
        for (let x = Math.floor(x0 - e); x <= Math.floor(x1 + e); x++) {
          if (this.world.getBlock(x, y, z) !== B.CACTUS) continue;
          if (x0 - e < x + 15 / 16 && x1 + e > x + 1 / 16 && z0 - e < z + 15 / 16 && z1 + e > z + 1 / 16) return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Death
  // ---------------------------------------------------------------------------

  private die() {
    if (this.state === 'dead') return;
    const p = this.player;
    if (this.menu) this.closeScreen(false);
    this.breaking = null;
    this.eating = null;
    if (!p.creative) {
      const all = [...this.inv.slots, ...this.inv.armor].filter((s): s is ItemStack => !!s);
      for (const s of all) {
        const a = Math.random() * Math.PI * 2, v = Math.random() * 2.5;
        this.drops.spawn(s, p.x, p.y + 1, p.z, [Math.cos(a) * v, 2 + Math.random() * 2, Math.sin(a) * v], 1);
      }
      this.inv.slots.fill(null);
      this.inv.armor.fill(null);
      this.inv.changed();
    }
    this.input.unlock();
    this.setState('dead');
    this.ui.showDeath(`You ${DEATH_MESSAGES[this.stats.deathCause ?? 'fall']}`);
  }

  private respawn() {
    const p = this.player;
    this.stats.reset();
    [p.x, p.y, p.z] = this.spawnPoint;
    p.vx = p.vy = p.vz = 0;
    p.fallDistance = 0;
    this.unstick();
    this.renderer.resetHistory();
    this.play();
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  private interact(dt: number) {
    const p = this.player;
    const input = this.input;
    const f = p.forward();
    const reach = p.creative ? 5 : 4.5;
    this.hit = raycast(this.getBlock, p.x, p.eyeY, p.z, f[0], f[1], f[2], reach);
    this.breakCooldown -= dt;
    this.placeCooldown -= dt;
    const hit = this.hit;

    // Breaking
    if (input.buttons.has(0) && hit && !this.eating) {
      const def = B.BLOCKS[hit.block];
      if (p.creative) {
        if (this.breakCooldown <= 0) {
          this.breakBlock(hit.x, hit.y, hit.z);
          this.breakCooldown = 0.22;
        }
        this.breaking = null;
      } else {
        const held = this.inv.held?.id ?? 0;
        let br = this.breaking;
        if (!br || br.x !== hit.x || br.y !== hit.y || br.z !== hit.z || br.block !== hit.block || br.tool !== held) {
          br = this.breaking = { x: hit.x, y: hit.y, z: hit.z, progress: 0, block: hit.block, tool: held };
        }
        const time = breakTime(hit.block, toolOf(this.inv.held), p.eyeInWater, p.onGround);
        if (time === 0) {
          if (this.breakCooldown <= 0) {
            this.breakBlock(hit.x, hit.y, hit.z);
            this.breaking = null;
            this.breakCooldown = 0.15;
          }
        } else if (isFinite(time) && this.breakCooldown <= 0) {
          br.progress += dt / time;
          this.digSound -= dt;
          if (this.digSound <= 0) {
            this.audio.dig(def.sound);
            this.digSound = 0.24;
            this.renderer.entities.spawnDig(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.block);
            this.swing = 0;
          }
          if (br.progress >= 1) {
            this.breakBlock(hit.x, hit.y, hit.z);
            this.breaking = null;
            this.breakCooldown = 0.25;
          }
        }
      }
    } else {
      this.breaking = null;
    }

    // Using / placing
    if (input.clicked.has(2)) {
      this.placeCooldown = 0.22;
      this.use(hit);
    } else if (input.buttons.has(2) && !this.eating && this.placeCooldown <= 0 && hit) {
      this.placeCooldown = 0.22;
      const held = this.inv.held;
      if (held && ITEMS[held.id]?.block && !ITEMS[held.id].food) this.placeBlock(hit);
    }
    this.updateEating(dt);

    // Pick block
    if (hit && input.clicked.has(1)) this.pickBlock(hit.block);
  }

  private breakBlock(x: number, y: number, z: number) {
    const id = this.world.getBlock(x, y, z);
    const p = this.player;
    if (id <= 0 || (id === B.BEDROCK && !p.creative)) return;
    const held = this.inv.held;
    const tool = toolOf(held);
    this.world.setBlock(x, y, z, B.AIR);
    this.audio.breakBlock(B.BLOCKS[id].sound);
    this.renderer.entities.spawnBreak(x, y, z, id);
    this.swing = 0;
    // Containers spill their contents.
    const base = B.baseBlock(id);
    if (base === B.CHEST || base === B.BARREL || base === B.FURNACE || base === B.LIT_FURNACE) this.dropAt(x, y, z, this.tiles.remove(x, y, z));
    if (id === B.OAK_LOG || id === B.BIRCH_LOG || id === B.SPRUCE_LOG) this.growth?.logRemoved(x, y, z);
    if (p.creative) return;
    this.dropAt(x, y, z, blockDrops(id, tool));
    this.stats.exhaust(0.005);
    const wear = toolWear(id, tool);
    if (wear > 0 && this.inv.damageHeld(wear)) this.toolBroke(held!);
  }

  /** A TNT explosion: destroys blocks, sets off nearby TNT, drops some items, hurts and pushes the player. */
  private explodeAt(x: number, y: number, z: number, power: number) {
    const p = this.player;
    const { destroyed } = explode(this.world, x, y, z, power);
    const dig = { type: 'pickaxe' as const, tier: B.TIER_DIAMOND, speed: 1, damage: 1 };
    destroyed.forEach(([bx, by, bz, id], i) => {
      const base = B.baseBlock(id);
      if (this.world.getBlock(bx, by, bz) !== id) return;
      this.world.setBlock(bx, by, bz, B.AIR);
      if (base === B.TNT) { this.tnt.prime(bx, by, bz, 0.5 + Math.random()); return; }
      if (base === B.CHEST || base === B.BARREL || base === B.FURNACE || base === B.LIT_FURNACE) this.dropAt(bx, by, bz, this.tiles.remove(bx, by, bz));
      if (Math.random() < 1 / power) this.dropAt(bx, by, bz, blockDrops(id, dig));
      if (i % 3 === 0) this.renderer.entities.spawnBreak(bx, by, bz, id);
    });
    const cx = p.x, cy = p.y + 0.9, cz = p.z;
    const dist = Math.hypot(cx - x, cy - y, cz - z);
    this.audio.explode(Math.min(1, dist / 48));
    this.shake = Math.max(this.shake, Math.max(0, 1 - dist / 24));
    if (dist < power * 2) {
      const impact = (1 - dist / (power * 2)) * exposure(this.world, x, y, z, p.box);
      if (impact > 0) {
        this.stats.damage(Math.floor(((impact * impact + impact) / 2) * 7 * power * 2 + 1), 'explosion', p.creative);
        const k = (impact * 14) / Math.max(0.1, dist);
        p.vx += (cx - x) * k; p.vy += (cy - y) * k + impact * 4; p.vz += (cz - z) * k;
      }
    }
  }

  private toolBroke(s: ItemStack) {
    const p = this.player;
    this.audio.toolBreak();
    const f = p.forward();
    this.renderer.entities.spawnItemCrumbs(p.x + f[0] * 0.6, p.eyeY - 0.3, p.z + f[2] * 0.6, s.id, 10);
    this.ui.flashName(`${ITEMS[s.id].displayName} broke!`);
  }

  /** Right click: open containers, use the held item, or place a block. */
  private use(hit: RayHit | null) {
    const p = this.player;
    const held = this.inv.held;
    const def = held ? ITEMS[held.id] : undefined;
    if (hit && !(p.sneaking && held)) {
      const { x, y, z } = hit;
      const base = B.baseBlock(hit.block);
      switch (base) {
        case B.CRAFTING_TABLE: this.openScreen('crafting', null, 'Crafting Table'); return;
        case B.FURNACE: case B.LIT_FURNACE: this.openScreen('furnace', this.tiles.furnace(x, y, z), 'Furnace'); return;
        case B.CHEST: case B.BARREL:
          this.audio.chest(true);
          this.openScreen('chest', this.tiles.chest(x, y, z), base === B.CHEST ? 'Chest' : 'Barrel');
          return;
      }
    }
    if (!held || !def) return;
    if (held.id === I.BUCKET || held.id === I.WATER_BUCKET || held.id === I.LAVA_BUCKET) { this.useBucket(held.id); return; }
    if (def.tool?.type === 'hoe' && hit && this.till(hit)) return;
    if (held.id === I.BONE_MEAL && hit) {
      if (this.growth?.boneMeal(hit.x, hit.y, hit.z)) {
        if (!p.creative) this.inv.consumeHeld(1);
        this.renderer.entities.spawnItemCrumbs(hit.x + 0.5, hit.y + 0.8, hit.z + 0.5, I.BONE_MEAL, 12);
        this.audio.place('grass');
        this.swing = 0;
      }
      return;
    }
    if (held.id === I.FLINT_AND_STEEL) {
      if (hit && B.baseBlock(hit.block) === B.TNT) {
        this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
        this.tnt.prime(hit.x, hit.y, hit.z);
        this.audio.fizz();
        this.swing = 0;
        if (!p.creative && this.inv.damageHeld(1)) this.toolBroke(held);
      }
      return;
    }
    if (def.armor) { this.equipArmor(); return; }
    if (def.food && this.stats.canEat(def.food, p.creative)) {
      this.eating = { t: 0, slot: this.inv.selected, id: held.id, bite: 0.25 };
      return;
    }
    if (hit && def.block) this.placeBlock(hit);
  }

  private till(hit: RayHit): boolean {
    const { x, y, z } = hit;
    if ((hit.block !== B.GRASS && hit.block !== B.DIRT) || hit.ny < 0 || this.world.getBlock(x, y + 1, z) !== B.AIR) return false;
    this.world.setBlock(x, y, z, B.FARMLAND);
    this.audio.place('dirt');
    this.swing = 0;
    if (!this.player.creative) {
      const held = this.inv.held;
      if (held && this.inv.damageHeld(1)) this.toolBroke(held);
    }
    return true;
  }

  private equipArmor() {
    const held = this.inv.held;
    const a = held && ITEMS[held.id].armor;
    if (!held || !a) return;
    const cur = this.inv.armor[a.slot];
    this.inv.armor[a.slot] = held;
    this.inv.slots[this.inv.selected] = cur;
    this.inv.changed();
    this.audio.place(ITEMS[held.id].name.startsWith('leather') ? 'wool' : 'metal');
    this.equip = 0;
  }

  private useBucket(id: number) {
    const p = this.player;
    const f = p.forward();
    const hit = raycast(this.getBlock, p.x, p.eyeY, p.z, f[0], f[1], f[2], p.creative ? 5 : 4.5, true);
    if (!hit) return;
    if (id === I.BUCKET) {
      if (hit.block !== B.WATER && hit.block !== B.LAVA) return;
      this.world.setBlock(hit.x, hit.y, hit.z, B.AIR);
      if (hit.block === B.WATER) this.audio.splash(); else this.audio.fizz();
      if (!p.creative) {
        const left = this.inv.replaceHeld({ id: hit.block === B.WATER ? I.WATER_BUCKET : I.LAVA_BUCKET, count: 1 });
        if (left) this.throwStack(left);
      }
    } else {
      const liquid = id === I.WATER_BUCKET ? B.WATER : B.LAVA;
      let tx = hit.x, ty = hit.y, tz = hit.z;
      const hb = B.BLOCKS[hit.block];
      if (!hb.liquid && !hb.replaceable) { tx += hit.nx; ty += hit.ny; tz += hit.nz; }
      const cur = this.world.getBlock(tx, ty, tz);
      if (cur < 0 || (cur !== B.AIR && !B.BLOCKS[cur].replaceable)) return;
      if (cur > 0 && !B.BLOCKS[cur].liquid) this.onBlockRemoved(tx, ty, tz, cur);
      this.world.setBlock(tx, ty, tz, liquid);
      if (liquid === B.WATER) this.audio.splash(); else this.audio.fizz();
      if (!p.creative) this.inv.replaceHeld({ id: I.BUCKET, count: 1 });
    }
    this.swing = 0;
  }

  private updateEating(dt: number) {
    const e = this.eating;
    if (!e) return;
    const held = this.inv.held;
    const food = held && ITEMS[held.id].food;
    if (!this.input.buttons.has(2) || !held || !food || held.id !== e.id || this.inv.selected !== e.slot) {
      this.eating = null;
      return;
    }
    e.t += dt;
    e.bite -= dt;
    if (e.bite <= 0 && e.t > 0.3) {
      e.bite = 0.22;
      this.audio.eat();
      const p = this.player, f = p.forward();
      this.renderer.entities.spawnItemCrumbs(p.x + f[0] * 0.5, p.eyeY - 0.25 + f[1] * 0.5, p.z + f[2] * 0.5, held.id, 3);
    }
    if (e.t >= 1.6) {
      this.eating = null;
      this.stats.eat(food);
      this.audio.burp();
      if (!this.player.creative) {
        const rem = ITEMS[held.id].remainder;
        if (rem && held.count === 1) this.inv.slots[this.inv.selected] = { id: rem, count: 1 };
        else {
          this.inv.consumeHeld(1);
          if (rem && this.inv.add({ id: rem, count: 1 }) > 0) this.throwStack({ id: rem, count: 1 });
        }
        this.inv.changed();
      }
    }
  }

  private pickBlock(block: number) {
    const id = pickItem(block);
    if (!id) return;
    const inv = this.inv;
    const hot = inv.slots.findIndex((s, i) => i < HOTBAR_SIZE && s?.id === id);
    if (hot >= 0) { this.selectSlot(hot); return; }
    // The slot to fill: the selected one if empty, else the first empty hotbar slot, else the selected.
    let target = inv.selected;
    if (inv.slots[target]) {
      const empty = inv.slots.findIndex((s, i) => i < HOTBAR_SIZE && !s);
      if (empty >= 0) target = empty;
    }
    if (this.player.creative) {
      inv.slots[target] = { id, count: maxStack(id) };
    } else {
      const k = inv.slots.findIndex((s, i) => i >= HOTBAR_SIZE && i < INVENTORY_SIZE && s?.id === id);
      if (k < 0) return;
      const tmp = inv.slots[target];
      inv.slots[target] = inv.slots[k];
      inv.slots[k] = tmp;
    }
    inv.selected = target;
    inv.changed();
    this.ui.flashName(ITEMS[id].displayName);
  }

  private placeBlock(hit: RayHit): boolean {
    const p = this.player;
    const held = this.inv.held;
    const def = held ? ITEMS[held.id] : undefined;
    if (!held || !def || !def.block) return false;
    let id = def.block;
    const clicked = hit.block;
    // A slab on the matching half of the same slab makes a double slab.
    if (B.SLAB_BASE[id] && B.SLAB_BASE[clicked] === id &&
        ((hit.ny === 1 && !B.IS_TOP_SLAB[clicked]) || (hit.ny === -1 && B.IS_TOP_SLAB[clicked]))) {
      return this.setPlaced(hit.x, hit.y, hit.z, B.SLAB_FULL[clicked]);
    }
    let tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
    if (B.BLOCKS[clicked].replaceable && !B.BLOCKS[clicked].liquid) {
      tx = hit.x; ty = hit.y; tz = hit.z;
    }
    if (ty < 0 || ty > 255) return false;
    const cur = this.world.getBlock(tx, ty, tz);
    if (cur < 0) return false;
    if (B.SLAB_BASE[id]) {
      if (B.SLAB_BASE[cur] === id) return this.setPlaced(tx, ty, tz, B.SLAB_FULL[cur]);
      const top = hit.ny === -1 || (hit.ny === 0 && hit.py - Math.floor(hit.py) > 0.5);
      if (top) id = B.SLAB_OTHER[id];
    }
    if (cur !== B.AIR && !B.BLOCKS[cur].replaceable) return false;
    const bdef = B.BLOCKS[id];
    if (bdef.solid && p.intersectsBlock(tx, ty, tz, id)) return false;
    const below = this.world.getBlock(tx, ty - 1, tz);
    const plantSoil = B.isPlantSoil(below) || below === B.SAND || below === B.GRAVEL || below === B.CLAY;
    if (id === B.WHEAT_0) { if (below !== B.FARMLAND) return false; }
    else if (B.isSapling(id)) { if (!B.isPlantSoil(below)) return false; }
    else if (id === B.RED_MUSHROOM || id === B.BROWN_MUSHROOM) { if (below <= 0 || !B.IS_OPAQUE[below]) return false; }
    else if (id === B.SUGAR_CANE) {
      const water = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => this.world.getBlock(tx + dx, ty - 1, tz + dz) === B.WATER);
      if (below !== B.SUGAR_CANE && !(plantSoil && water)) return false;
    } else if (id === B.CACTUS) { if (below !== B.CACTUS && below !== B.SAND) return false; }
    else if (bdef.shape === B.Shape.CROSS && bdef.needsSupport) { if (!plantSoil) return false; }
    else if (bdef.needsSupport) { if (below <= 0 || !B.IS_SOLID[below]) return false; }
    if (cur === B.WATER && bdef.shape === B.Shape.CROSS) return false;
    // Orientable blocks turn their front toward the player.
    if (B.FACING[id]) {
      const f = p.forward();
      const facing = Math.abs(f[0]) > Math.abs(f[2]) ? (f[0] > 0 ? 3 : 1) : (f[2] > 0 ? 0 : 2);
      id = B.FACING[id][facing];
    }
    return this.setPlaced(tx, ty, tz, id);
  }

  private setPlaced(x: number, y: number, z: number, id: number): boolean {
    this.world.setBlock(x, y, z, id);
    const def = B.BLOCKS[id];
    if (id === B.WATER) this.audio.splash(); else this.audio.place(def.sound);
    this.swing = 0;
    if (!this.player.creative) this.inv.consumeHeld(1);
    return true;
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
      if (b > 0 && B.IS_SOLID[b] || b === B.WATER || B.isLeaves(b)) return y + 1;
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

  /** View-space transform of the held item (Minecraft-style swing / equip / eat animation). */
  private heldTransform(id: number) {
    const sp = this.swing >= 1 ? 0 : this.swing;
    const sq = Math.sqrt(sp);
    const p = this.player;
    const bob = this.settings.viewBobbing ? p.bob() : [0, 0, 0];
    const eq = 1 - this.equip;
    const swingOff = translation(-0.4 * Math.sin(sq * Math.PI) - bob[0] * 1.5, 0.2 * Math.sin(sq * Math.PI * 2) - bob[1] * 0.8, -0.2 * Math.sin(sp * Math.PI));
    if (!id) {
      // Empty hand: the arm reaching in from the lower right; swinging is a punch toward the crosshair.
      const k = Math.sin(sq * Math.PI);
      return compose(
        translation(-0.32 * k - bob[0] * 1.5, 0.08 * k - bob[1] * 0.8, -0.28 * Math.sin(sp * Math.PI)),
        translation(0.58, -0.58 - eq * 0.6, -0.55),
        rotationY(0.35 + k * 0.45),
        rotationX(1.9 + k * 0.25),
        scaling(1.0),
      );
    }
    // Eating: raise the food to the mouth and bob it.
    let eatT = 0;
    if (this.eating) eatT = Math.min(1, this.eating.t / 0.25);
    const eatBob = this.eating && this.eating.t > 0.3 ? Math.abs(Math.cos(this.eating.t * 13)) * 0.06 : 0;
    const base = compose(
      swingOff,
      translation(0.56 - eatT * 0.36, -0.54 - eq * 0.6 + eatT * 0.2 + eatBob, -0.78 + eatT * 0.08),
    );
    if (this.renderer.entities.isFlat(id)) {
      // Flat items and tools: seen from the back, handle toward the lower right, head up and left.
      return compose(base, translation(-0.04, 0.12, 0),
        rotationY(Math.PI - 0.8 + eatT * 0.5 + Math.sin(sp * sp * Math.PI) * -0.3),
        rotationZ(-0.25 + Math.sin(sq * Math.PI) * -0.3),
        rotationX(0.1 + Math.sin(sq * Math.PI) * -1.2 - eatT * 0.3),
        scaling(0.52));
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
    if (this.state === 'dead') ey = p.y + 0.4;
    if (this.shake > 0) {
      const a = this.shake * this.shake * 0.12;
      ex += (Math.random() - 0.5) * a; ey += (Math.random() - 0.5) * a; ez += (Math.random() - 0.5) * a;
    }
    // Hurt: a quick downward nod.
    pitch -= this.hurtTilt * this.hurtTilt * 0.06;
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
    const [, bl] = this.lightAt(ex, ey, ez);
    this.playerBlockLight += (bl - this.playerBlockLight) * (1 - Math.exp(-dt * 4));

    const heldStack = this.inv.held;
    const held = heldStack?.id ?? 0;
    const heldLight = title || held >= 256 ? 0 : B.EMISSION[held] ? B.EMISSION[held] * 0.55 : 0;
    this.renderer.entities.heldId = held;
    const heldModel = title || this.hudHidden || this.state === 'dead' ? null : this.heldTransform(held);
    const sel = !title && this.hit && this.state === 'playing' ? this.hit : null;
    const selBox = sel ? Array.from(B.BOX.subarray(sel.block * 6, sel.block * 6 + 6), (v) => v / 16) : undefined;
    const env: EnvState = {
      dayTime: this.dayTime,
      dayCount: this.dayCount,
      time: this.time,
      underwater,
      waterSurfaceY: waterSurface,
      playerSky: this.playerSky,
      heldLight,
      selection: sel ? [sel.x, sel.y, sel.z] : null,
      selectionBox: selBox,
      items: this.drops.instances,
      tnt: this.tnt.list,
      breakBlock: this.breaking && this.breaking.progress > 0 ? [this.breaking.x, this.breaking.y, this.breaking.z, Math.min(9, Math.floor(this.breaking.progress * 10))] : null,
      heldModel,
      playerLight: [Math.max(this.playerSky, 0.05), heldLight > 0 ? 0.92 : this.playerBlockLight],
      rain: this.rain,
      lightning: this.lightning,
    };
    this.renderer.rain.update(dt, this.rain, cam, [2.2, 1.6], this.rainTop);
    this.renderer.render(cam, env, dt);
    this.ui.setUnderwater(underwater && !title);
    this.ui.setHurt(this.stats.hurt, this.stats.fire > 0 && !p.creative);

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
      `Entities: ${this.drops.count} items, ${this.tiles.furnaces().length} furnaces`,
      `Looking at: ${look}`,
      `Seed: ${this.seedLabel}`,
    ];
  }
}
