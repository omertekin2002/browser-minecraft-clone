import { GL, Program, RenderTarget, PingPong, FMT, registerInclude, createTexture2D } from './gl/GL';
import { FrameUniforms, U } from './FrameUniforms';
import { ChunkMeshes, ChunkGPU } from './ChunkMeshes';
import { buildTextures, TextureSet } from './textures/BlockTextures';
import { lightIlluminance } from './Atmosphere';
import {
  Mat4, mat4, mul, invert, perspective, viewFromBasis, frustumPlanes, aabbInFrustum, halton, cross, normalize, Vec3, dot,
} from './math';
import { textureLayer, DESTROY_LAYER_BASE } from '../world/textureNames';

import frameSrc from './shaders/frame.glsl?raw';
import commonSrc from './shaders/common.glsl?raw';
import atmosphereSrc from './shaders/atmosphere.glsl?raw';
import skySrc from './shaders/sky.glsl?raw';
import shadowsSrc from './shaders/shadows.glsl?raw';
import brdfSrc from './shaders/brdf.glsl?raw';
import cloudsCommonSrc from './shaders/clouds_common.glsl?raw';
import shSrc from './shaders/sh.glsl?raw';
import hazeSrc from './shaders/haze.glsl?raw';
import waterSrc from './shaders/water.glsl?raw';
import watermapSrc from './shaders/watermap.glsl?raw';

import chunkVert from './shaders/chunk.vert?raw';
import gbufferFrag from './shaders/gbuffer.frag?raw';
import shadowFrag from './shaders/shadow.frag?raw';
import fullscreenVert from './shaders/fullscreen.vert?raw';
import transmittanceFrag from './shaders/transmittance.frag?raw';
import multiscatterFrag from './shaders/multiscatter.frag?raw';
import skyviewFrag from './shaders/skyview.frag?raw';
import skyshFrag from './shaders/skysh.frag?raw';
import lightingFrag from './shaders/lighting.frag?raw';
import waterFrag from './shaders/water.frag?raw';
import noise3dFrag from './shaders/noise3d.frag?raw';
import weatherFrag from './shaders/weather.frag?raw';
import cloudsFrag from './shaders/clouds.frag?raw';
import cloudsTaaFrag from './shaders/clouds_taa.frag?raw';
import volumetricFrag from './shaders/volumetric.frag?raw';
import compositeFrag from './shaders/composite.frag?raw';
import taaFrag from './shaders/taa.frag?raw';
import bloomDownFrag from './shaders/bloom_down.frag?raw';
import bloomUpFrag from './shaders/bloom_up.frag?raw';
import luminanceFrag from './shaders/luminance.frag?raw';
import exposureFrag from './shaders/exposure.frag?raw';
import finalFrag from './shaders/final.frag?raw';
import outlineVert from './shaders/outline.vert?raw';
import outlineFrag from './shaders/outline.frag?raw';
import cloudShadowFrag from './shaders/cloudshadow.frag?raw';
import farVert from './shaders/far.vert?raw';
import farFrag from './shaders/far.frag?raw';
import farWaterVert from './shaders/farwater.vert?raw';
import chunkMaskSrc from './shaders/chunkmask.glsl?raw';
import { FarTerrain } from './FarTerrain';
import { EntityRenderer } from './Entities';
import entityVert from './shaders/entity.vert?raw';
import { Rain } from './Rain';
import rainVert from './shaders/rain.vert?raw';
import rainFrag from './shaders/rain.frag?raw';
import { TEXTURE_NAMES } from '../world/textureNames';

registerInclude('frame', frameSrc);
registerInclude('common', commonSrc);
registerInclude('atmosphere', atmosphereSrc);
registerInclude('sky', skySrc);
registerInclude('shadows', shadowsSrc);
registerInclude('brdf', brdfSrc);
registerInclude('clouds_common', cloudsCommonSrc);
registerInclude('sh', shSrc);
registerInclude('haze', hazeSrc);
registerInclude('water', waterSrc);
registerInclude('watermap', watermapSrc);
registerInclude('chunkmask', chunkMaskSrc);

export interface RenderSettings {
  renderScale: number;
  shadows: number; // 0 off, 1 low, 2 medium, 3 high
  shadowDistance: number;
  clouds: number; // 0 off, 1 fast, 2 fancy
  volumetric: boolean;
  ssr: boolean;
  taa: boolean;
  bloom: boolean;
  tonemap: number; // 0 AgX, 1 ACES
  fov: number; // degrees
  exposureBias: number;
  saturation: number;
  sharpen: number;
  cloudCoverage: number;
  renderDistance: number;
  farTerrain: boolean;
  parallax: boolean;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  renderScale: 1,
  shadows: 2,
  shadowDistance: 160,
  clouds: 2,
  volumetric: true,
  ssr: true,
  taa: true,
  bloom: true,
  tonemap: 0,
  fov: 75,
  exposureBias: 0,
  saturation: 1.05,
  sharpen: 0.5,
  cloudCoverage: 0.38,
  renderDistance: 10,
  farTerrain: true,
  parallax: true,
};

export interface CameraState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  fovDeg: number;
}

export interface EnvState {
  dayTime: number; // 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
  dayCount: number;
  time: number; // seconds (animation)
  underwater: boolean;
  waterSurfaceY: number;
  playerSky: number; // 0..1
  heldLight: number; // radius in blocks, 0 = none
  selection: [number, number, number] | null;
  breakBlock: [number, number, number, number] | null; // x,y,z,stage
  /** View-space model matrix of the held block (null = hidden). */
  heldModel: Mat4 | null;
  /** Light levels (0..1) at the player, used for the held item and particles. */
  playerLight: [number, number];
  /** Rain intensity 0..1 and lightning flash 0..1. */
  rain: number;
  lightning: number;
}

export interface RenderStats {
  chunksVisible: number;
  quads: number;
  shadowQuads: number;
  drawCalls: number;
  gpuMemMB: number;
}

interface CascadeParams {
  lr: Vec3;
  lu: Vec3;
  lf: Vec3;
  r: number;
  csx: number;
  csy: number;
  csz: number;
  zmin: number;
  zmax: number;
}

const SUN_ILLUM = 6.0;
const MOON_SCALE = 0.014;
const SUN_TILT = 0.45;
const NEAR = 0.07;
const FAR = 2500;

export class Renderer {
  readonly gl: GL;
  settings: RenderSettings = { ...DEFAULT_SETTINGS };
  readonly meshes: ChunkMeshes;
  readonly textureSet: TextureSet;
  stats: RenderStats = { chunksVisible: 0, quads: 0, shadowQuads: 0, drawCalls: 0, gpuMemMB: 0 };

  private frame: FrameUniforms;
  private vao: WebGLVertexArrayObject;
  private aniso: EXT_texture_filter_anisotropic | null;

  // programs
  private pGBuffer: Program;
  private pGBufferCutout: Program;
  private pShadow: Program;
  private pShadowCutout: Program;
  private pWater: Program;
  private pTransmittance: Program;
  private pMultiscatter: Program;
  private pSkyView: Program;
  private pSkySH: Program;
  private pLighting: Program;
  private pClouds: Program;
  private pCloudsTaa: Program;
  private pVolumetric: Program;
  private pComposite: Program;
  private pTaa: Program;
  private pBloomDown: Program;
  private pBloomUp: Program;
  private pLuminance: Program;
  private pExposure: Program;
  private pFinal: Program;
  private pOutline: Program;
  private pCloudShadow: Program;
  private pFar: Program;
  private pEntity: Program;
  private pRain: Program;
  readonly rain: Rain;
  entities!: EntityRenderer;
  private pFarWater: Program;
  /** Distant terrain streamed by the game (optional). */
  far: FarTerrain | null = null;
  private farColors = new Float32Array(30);

  // textures
  private albedoArray: WebGLTexture;
  private normalArray: WebGLTexture;
  private specularArray: WebGLTexture;
  private transmittanceLUT: RenderTarget;
  private multiscatterLUT: RenderTarget;
  private skyViewLUT: RenderTarget;
  private skySH: RenderTarget;
  private cloudShape: WebGLTexture;
  private cloudDetail: WebGLTexture;
  private weather: WebGLTexture;

  // targets
  private gbuffer!: RenderTarget;
  private hdrA!: RenderTarget;
  private fboTranslucent: WebGLFramebuffer;
  private hdrRefr!: RenderTarget;
  private depthCopy!: RenderTarget;
  private cloudRaw!: RenderTarget;
  private cloudHist!: PingPong;
  private vol!: RenderTarget;
  private hdrB!: RenderTarget;
  private taa!: PingPong;
  private bloom: RenderTarget[] = [];
  private lum!: RenderTarget;
  private exposure!: PingPong;
  private cloudShadowRT: RenderTarget;

  // shadows
  private shadowSize = 0;
  private shadowTex: WebGLTexture | null = null;
  private shadowFbos: WebGLFramebuffer[] = [];
  private cascadeParams: CascadeParams[] = [];
  private shadowsFresh = false;
  private samplerCmp: WebGLSampler;
  private samplerRaw: WebGLSampler;
  private cascadeMats: Mat4[] = [mat4(), mat4(), mat4(), mat4()];
  private cascadeRanges = new Float32Array(4);

  width = 1;
  height = 1;
  canvasW = 1;
  canvasH = 1;
  private frameIndex = 0;
  private prevViewProj: Mat4 = mat4();
  private prevCam: [number, number, number] = [0, 0, 0];
  private historyValid = false;
  private waterLayer = textureLayer('water');
  /** When true, each pass is timed with gl.finish() (debug only, slow). */
  profile = false;
  /** Profile only the whole frame (one query) instead of every pass. */
  profileTotal = false;
  /** Debug switches for performance experiments. */
  debug: { skipShadowRender: boolean; skipCloudPass: boolean; blit: string | null } =
    { skipShadowRender: false, skipCloudPass: false, blit: null };
  timings: Record<string, number> = {};
  private tMark = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required.');
    gl.getExtension('OES_texture_float_linear');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');

    this.frame = new FrameUniforms(gl);
    this.vao = gl.createVertexArray()!;
    this.meshes = new ChunkMeshes(gl);
    this.fboTranslucent = gl.createFramebuffer()!;

    const P = (name: string, vs: string, fs: string, defs: Record<string, string | number | boolean> = {}) => new Program(gl, name, vs, fs, defs);
    const md = { MULTI_DRAW: !!this.meshes.multiDraw };
    this.pGBuffer = P('gbuffer', chunkVert, gbufferFrag, { ...md });
    this.pGBufferCutout = P('gbuffer-cutout', chunkVert, gbufferFrag, { ...md, CUTOUT: true });
    this.pShadow = P('shadow', chunkVert, shadowFrag, { ...md, SHADOW: true });
    this.pShadowCutout = P('shadow-cutout', chunkVert, shadowFrag, { ...md, SHADOW: true, CUTOUT: true });
    this.pWater = P('water', chunkVert, waterFrag, { ...md });
    this.pTransmittance = P('transmittance', fullscreenVert, transmittanceFrag);
    this.pMultiscatter = P('multiscatter', fullscreenVert, multiscatterFrag);
    this.pSkyView = P('skyview', fullscreenVert, skyviewFrag);
    this.pSkySH = P('skysh', fullscreenVert, skyshFrag);
    this.pLighting = P('lighting', fullscreenVert, lightingFrag);
    this.pClouds = P('clouds', fullscreenVert, cloudsFrag);
    this.pCloudsTaa = P('clouds-taa', fullscreenVert, cloudsTaaFrag);
    this.pVolumetric = P('volumetric', fullscreenVert, volumetricFrag);
    this.pComposite = P('composite', fullscreenVert, compositeFrag);
    this.pTaa = P('taa', fullscreenVert, taaFrag);
    this.pBloomDown = P('bloom-down', fullscreenVert, bloomDownFrag);
    this.pBloomUp = P('bloom-up', fullscreenVert, bloomUpFrag);
    this.pLuminance = P('luminance', fullscreenVert, luminanceFrag);
    this.pExposure = P('exposure', fullscreenVert, exposureFrag);
    this.pFinal = P('final', fullscreenVert, finalFrag);
    this.pOutline = P('outline', outlineVert, outlineFrag);
    this.pCloudShadow = P('cloud-shadow', fullscreenVert, cloudShadowFrag);
    this.pFar = P('far', farVert, farFrag);
    this.pEntity = P('entity', entityVert, gbufferFrag, { ENTITY: true });
    this.pRain = P('rain', rainVert, rainFrag);
    this.rain = new Rain(gl);
    this.pFarWater = P('far-water', farWaterVert, waterFrag);
    this.cloudShadowRT = new RenderTarget(gl, 'cloudShadow', [{ ...FMT.r16f(gl), min: gl.LINEAR, mag: gl.LINEAR }], null, 256, 256);

    // Block textures
    this.textureSet = buildTextures();
    const ts = this.textureSet;
    this.albedoArray = this.createArray(ts.albedo, gl.SRGB8_ALPHA8, ts.count, ts.levels);
    this.normalArray = this.createArray(ts.normal, gl.RGBA8, ts.count, ts.levels);
    this.specularArray = this.createArray(ts.specular, gl.RGBA8, ts.count, ts.levels);
    this.computeFarColors();
    this.entities = new EntityRenderer(gl, ts.cutout);

    // Atmosphere LUTs
    const lutOpts = { ...FMT.rgba16f(gl), min: gl.LINEAR, mag: gl.LINEAR };
    this.transmittanceLUT = new RenderTarget(gl, 'transmittance', [lutOpts], null, 256, 64);
    this.multiscatterLUT = new RenderTarget(gl, 'multiscatter', [lutOpts], null, 32, 32);
    this.skyViewLUT = new RenderTarget(gl, 'skyview', [lutOpts], null, 192, 108);
    gl.bindTexture(gl.TEXTURE_2D, this.skyViewLUT.color);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    this.skySH = new RenderTarget(gl, 'skysh', [{ ...FMT.rgba16f(gl), min: gl.NEAREST, mag: gl.NEAREST }], null, 9, 1);
    this.bakeAtmosphere();

    // Cloud noise
    this.cloudShape = this.bakeNoise3D(128, 0);
    this.cloudDetail = this.bakeNoise3D(32, 1);
    this.weather = this.bakeWeather(512);

    // Shadow samplers
    this.samplerCmp = gl.createSampler()!;
    gl.samplerParameteri(this.samplerCmp, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.samplerCmp, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.samplerCmp, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.samplerParameteri(this.samplerCmp, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.samplerParameteri(this.samplerCmp, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.samplerCmp, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.samplerRaw = gl.createSampler()!;
    gl.samplerParameteri(this.samplerRaw, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.samplerRaw, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.samplerRaw, gl.TEXTURE_COMPARE_MODE, gl.NONE);
    gl.samplerParameteri(this.samplerRaw, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.samplerRaw, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720, window.devicePixelRatio || 1);
  }

  // ---------------------------------------------------------------------------
  // Resource creation
  // ---------------------------------------------------------------------------

  private createArray(levels: Uint8Array[], internalFormat: number, count: number, nLevels: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, nLevels, internalFormat, 16, 16, count);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let l = 0; l < nLevels; l++) {
      const s = 16 >> l;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, 0, s, s, count, gl.RGBA, gl.UNSIGNED_BYTE, levels[l]);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    return t;
  }

  private fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.drawCalls++;
  }

  private bakeAtmosphere() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.frame.upload();
    this.transmittanceLUT.bind();
    this.pTransmittance.use();
    this.fullscreen();
    this.multiscatterLUT.bind();
    this.pMultiscatter.use().tex('uTransmittanceLUT', 0, this.transmittanceLUT.color);
    this.fullscreen();
  }

  private bakeNoise3D(size: number, mode: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, t);
    const levels = Math.log2(size) + 1;
    gl.texStorage3D(gl.TEXTURE_3D, levels, gl.RGBA8, size, size, size);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, size, size);
    this.pNoise3D().use().f('uSize', size).i('uMode', mode);
    for (let z = 0; z < size; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z);
      this.noiseProgram!.f('uSlice', z);
      this.fullscreen();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    return t;
  }

  private noiseProgram: Program | null = null;
  private pNoise3D(): Program {
    if (!this.noiseProgram) this.noiseProgram = new Program(this.gl, 'noise3d', fullscreenVert, noise3dFrag);
    return this.noiseProgram;
  }

  private bakeWeather(size: number): WebGLTexture {
    const gl = this.gl;
    const t = createTexture2D(gl, size, size, { ...FMT.rgba8(gl), min: gl.LINEAR_MIPMAP_LINEAR, mag: gl.LINEAR, wrap: gl.REPEAT });
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    gl.viewport(0, 0, size, size);
    const p = new Program(gl, 'weather', fullscreenVert, weatherFrag);
    p.use().f('uSize', size);
    this.fullscreen();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  /** Average linear albedo of the textures that the distant terrain materials stand for. */
  private computeFarColors() {
    const names = ['grass_top', 'sand', 'stone', 'snow', 'gravel', 'oak_leaves', 'spruce_leaves', 'birch_leaves', 'dirt', 'clay'];
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    names.forEach((n, i) => {
      const t = this.textureSet.byName.get(n)!;
      const cut = this.textureSet.cutout[TEXTURE_NAMES.indexOf(n as (typeof TEXTURE_NAMES)[number])];
      let r = 0, g = 0, b = 0, w = 0;
      for (let k = 0; k < 256; k++) {
        const a = cut ? t.rgba[k * 4 + 3] / 255 : 1;
        r += lin(t.rgba[k * 4]) * a; g += lin(t.rgba[k * 4 + 1]) * a; b += lin(t.rgba[k * 4 + 2]) * a; w += a;
      }
      this.farColors[i * 3] = r / w; this.farColors[i * 3 + 1] = g / w; this.farColors[i * 3 + 2] = b / w;
    });
  }

  private ensureShadowMap() {
    const gl = this.gl;
    const want = this.settings.shadows === 0 ? 0 : this.settings.shadows === 1 ? 1024 : 2048;
    if (want === this.shadowSize && this.shadowTex) return;
    if (this.shadowTex) gl.deleteTexture(this.shadowTex);
    this.shadowSize = want;
    // A 1×1 array keeps shadow samplers valid while shadows are disabled.
    const size = want || 1;
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, size, size, 4);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    for (let i = 0; i < 4; i++) {
      if (!this.shadowFbos[i]) this.shadowFbos[i] = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbos[i]);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.shadowTex, 0, i);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.shadowsFresh = false;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    const gl = this.gl;
    void dpr;
    const W = Math.max(1, Math.round(cssW * this.settings.renderScale));
    const H = Math.max(1, Math.round(cssH * this.settings.renderScale));
    // The canvas matches the render resolution; the browser scales it to the window.
    this.canvasW = W;
    this.canvasH = H;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    if (W === this.width && H === this.height && this.gbuffer) return;
    this.width = W;
    this.height = H;
    const lin = (o: ReturnType<typeof FMT.rgba16f>) => ({ ...o, min: gl.LINEAR, mag: gl.LINEAR });
    const near = (o: ReturnType<typeof FMT.rgba16f>) => ({ ...o, min: gl.NEAREST, mag: gl.NEAREST });
    const hw = Math.max(1, Math.ceil(W / 2)), hh = Math.max(1, Math.ceil(H / 2));
    if (!this.gbuffer) {
      this.gbuffer = new RenderTarget(gl, 'gbuffer', [near(FMT.srgba8(gl)), near(FMT.rgba16f(gl)), near(FMT.rgba8(gl))], FMT.depth32f(gl), W, H);
      this.hdrA = new RenderTarget(gl, 'hdrA', [lin(FMT.rgba16f(gl))], null, W, H);
      this.hdrRefr = new RenderTarget(gl, 'hdrRefr', [lin(FMT.rgba16f(gl))], null, W, H);
      this.depthCopy = new RenderTarget(gl, 'depthCopy', [], FMT.depth32f(gl), W, H);
      this.cloudRaw = new RenderTarget(gl, 'cloudRaw', [lin(FMT.rgba16f(gl))], null, hw, hh);
      this.cloudHist = new PingPong(gl, 'cloudHist', [lin(FMT.rgba16f(gl))], hw, hh);
      this.vol = new RenderTarget(gl, 'vol', [lin(FMT.rgba16f(gl))], null, hw, hh);
      this.hdrB = new RenderTarget(gl, 'hdrB', [lin(FMT.rgba16f(gl))], null, W, H);
      this.taa = new PingPong(gl, 'taa', [lin(FMT.rgba16f(gl))], W, H);
      this.lum = new RenderTarget(gl, 'lum', [{ ...FMT.rg16f(gl), min: gl.LINEAR_MIPMAP_LINEAR, mag: gl.LINEAR }], null, 128, 64);
      this.exposure = new PingPong(gl, 'exposure', [near(FMT.rgba16f(gl))], 1, 1);
    } else {
      this.gbuffer.resize(W, H);
      this.hdrA.resize(W, H);
      this.hdrRefr.resize(W, H);
      this.depthCopy.resize(W, H);
      this.cloudRaw.resize(hw, hh);
      this.cloudHist.resize(hw, hh);
      this.vol.resize(hw, hh);
      this.hdrB.resize(W, H);
      this.taa.resize(W, H);
    }
    // Translucent FBO: hdrA color + gbuffer depth.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTranslucent);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.hdrA.color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.gbuffer.depth, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Bloom chain
    for (const b of this.bloom) b.dispose();
    this.bloom = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < 5; i++) {
      this.bloom.push(new RenderTarget(gl, 'bloom' + i, [lin(FMT.rgba16f(gl))], null, bw, bh));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    this.historyValid = false;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  sunDirection(dayTime: number): Vec3 {
    const th = dayTime * Math.PI * 2;
    return normalize([Math.cos(th), Math.sin(th) * Math.cos(SUN_TILT), Math.sin(th) * Math.sin(SUN_TILT)]);
  }

  render(cam: CameraState, env: EnvState, dt: number) {
    const gl = this.gl;
    const s = this.settings;
    this.stats.drawCalls = 0;
    this.collectTimings();
    this.mark('');
    this.frameIndex++;
    this.ensureShadowMap();
    const W = this.width, H = this.height;

    // ---- camera ----
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const fwd: Vec3 = [sy * cp, sp, -cy * cp];
    const right: Vec3 = [cy, 0, sy];
    const up = cross(right, fwd);
    const view = viewFromBasis(mat4(), right, up, fwd);
    const fovY = (cam.fovDeg * Math.PI) / 180;
    const aspect = W / H;
    const proj = perspective(mat4(), fovY, aspect, NEAR, FAR);
    const projJ = new Float64Array(proj) as Mat4;
    let jx = 0, jy = 0;
    if (s.taa) {
      const k = (this.frameIndex % 8) + 1;
      jx = (halton(k, 2) - 0.5) * 2 / W;
      jy = (halton(k, 3) - 0.5) * 2 / H;
      projJ[8] -= jx;
      projJ[9] -= jy;
    }
    const viewProj = mul(mat4(), projJ, view);
    const viewProjUnj = mul(mat4(), proj, view);
    const invViewProj = invert(mat4(), viewProj);
    const invProj = invert(mat4(), projJ);
    const invView = invert(mat4(), view);
    if (!this.historyValid) this.prevViewProj.set(viewProjUnj);
    const dX = cam.x - this.prevCam[0], dY = cam.y - this.prevCam[1], dZ = cam.z - this.prevCam[2];
    const moved = Math.hypot(dX, dY, dZ) > 8;
    const resetHistory = !this.historyValid || moved;

    // ---- sun / moon ----
    const sunDir = this.sunDirection(env.dayTime);
    const moonDir: Vec3 = [-sunDir[0], -sunDir[1], -sunDir[2]];
    const phase = ((env.dayCount % 8) + 8) % 8 / 8;
    const moonBright = 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
    const alt = Math.max(0, cam.y - 63);
    const sunIll = lightIlluminance(sunDir, alt, SUN_ILLUM);
    const moonIllRaw = lightIlluminance(moonDir, alt, SUN_ILLUM * MOON_SCALE * moonBright);
    const moonIll: Vec3 = [moonIllRaw[0] * 0.85, moonIllRaw[1] * 0.95, moonIllRaw[2] * 1.15];
    const sunUp = sunDir[1] > -0.03;
    const lightDir = sunUp ? sunDir : moonDir;

    // ---- frame uniforms ----
    const F = this.frame;
    F.mat(U.view, view);
    F.mat(U.proj, projJ);
    F.mat(U.viewProj, viewProj);
    F.mat(U.invViewProj, invViewProj);
    F.mat(U.invProj, invProj);
    F.mat(U.prevViewProj, this.prevViewProj);
    F.mat(U.viewProjUnjittered, viewProjUnj);
    F.mat(U.invView, invView);
    const wrap = (v: number) => ((v % 4096) + 4096) % 4096;
    F.vec4(U.cameraPos, wrap(cam.x), cam.y, wrap(cam.z), env.time);
    F.vec4(U.cameraDelta, dX, dY, dZ, this.frameIndex);
    F.vec4(U.sunDir, sunDir[0], sunDir[1], sunDir[2], Math.max(0, sunDir[1]));
    F.vec4(U.moonDir, moonDir[0], moonDir[1], moonDir[2], phase);
    F.vec4(U.lightDir, lightDir[0], lightDir[1], lightDir[2], sunUp ? 1 : 0);
    F.vec4(U.sunIlluminance, sunIll[0], sunIll[1] * 0.98, sunIll[2] * 0.95, 0);
    F.vec4(U.moonIlluminance, moonIll[0], moonIll[1], moonIll[2], 0);
    F.vec4(U.resolution, W, H, 1 / W, 1 / H);
    F.vec4(U.jitter, jx, jy, 0, 0);
    const farOn = s.farTerrain && !!this.far;
    const renderDist = farOn ? 1880 : s.renderDistance * 16;
    const dawn = Math.max(0, 1 - Math.abs(sunDir[1] - 0.05) * 6);
    F.vec4(U.fog, 0.00075 * (1 + env.rain * 5), renderDist, 0.08 + dawn * 1.0 + env.rain * 0.6, env.underwater ? 1 : 0);
    F.vec4(U.camera, NEAR, FAR, Math.tan(fovY / 2), aspect);
    F.vec4(U.wind, 0.8, 0.6, 1.0 + env.rain * 1.4, s.cloudCoverage + (0.97 - s.cloudCoverage) * Math.min(1, env.rain * 1.3));
    F.vec4(U.misc, env.rain, env.time, env.playerSky, env.heldLight);
    F.vec4(U.cameraAbs, cam.x, cam.y, cam.z, env.lightning);

    // ---- visibility ----
    const planes = frustumPlanes(viewProjUnj);
    const visible: Array<[ChunkGPU, number]> = [];
    for (const g of this.meshes.map.values()) {
      const ox = g.cx * 16 - cam.x, oz = g.cz * 16 - cam.z;
      if (!aabbInFrustum(planes, ox, g.minY - cam.y, oz, ox + 16, g.maxY + 1 - cam.y, oz + 16)) continue;
      const cx = ox + 8, cz = oz + 8;
      visible.push([g, cx * cx + cz * cz]);
    }
    visible.sort((a, b) => a[1] - b[1]);
    const visList = visible.map((v) => v[0]);
    this.stats.chunksVisible = visList.length;

    // ---- shadow cascades ----
    const shadowsOn = s.shadows > 0 && this.shadowSize > 0;
    // Near cascades every frame; the two far cascades alternate.
    let cascadeMask = 0b0011 | (this.frameIndex & 1 ? 0b1000 : 0b0100);
    if (!this.shadowsFresh || moved) cascadeMask = 0b1111;
    if (shadowsOn) this.setupCascades(cam, fwd, right, up, fovY, aspect, lightDir, cascadeMask);
    F.vec4(U.shadowInfo, this.shadowSize, 1 / Math.max(1, this.shadowSize), s.shadowDistance, shadowsOn ? 1 : 0);

    // Cloud shadow map (entry points at the cloud base, centred on the camera's own sun ray).
    const cloudsOn = s.clouds > 0;
    const lyc = Math.max(lightDir[1], 0.12);
    const csSize = 3072;
    const csTexel = csSize / 256;
    const ccx = Math.floor((cam.x + (lightDir[0] / lyc) * (230 - cam.y)) / csTexel) * csTexel;
    const ccz = Math.floor((cam.z + (lightDir[2] / lyc) * (230 - cam.y)) / csTexel) * csTexel;
    F.vec4(U.cloudShadow, ccx, ccz, csSize, cloudsOn ? 1 : 0);
    F.upload();

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    this.mark('setup');
    // ---- sky LUT + SH ----
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this.skyViewLUT.bind(true);
    this.pSkyView.use()
      .tex('uTransmittanceLUT', 0, this.transmittanceLUT.color)
      .tex('uMultiScatterLUT', 1, this.multiscatterLUT.color)
      .f('uMoonScale', MOON_SCALE * moonBright);
    this.fullscreen();
    this.skySH.bind(true);
    this.pSkySH.use().tex('uSkyView', 0, this.skyViewLUT.color).f('uSunIllum', SUN_ILLUM);
    this.fullscreen();

    this.mark('sky');
    // ---- shadow map ----
    this.stats.shadowQuads = 0;
    if (shadowsOn && !this.debug.skipShadowRender) {
      this.renderShadows(cam, cascadeMask);
      this.shadowsFresh = true;
    }
    if (cloudsOn) {
      this.cloudShadowRT.bind();
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
      this.pCloudShadow.use();
      this.bindCloudTextures(this.pCloudShadow, 0);
      this.fullscreen();
    }

    this.mark('shadows');
    // ---- G-buffer ----
    this.gbuffer.bind();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    const camFloor: Vec3 = [Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z)];
    let quads = 0;
    for (const [prog, range] of [[this.pGBuffer, 'opaque'], [this.pGBufferCutout, 'cutout']] as const) {
      prog.use()
        .tex('uAlbedoTex', 1, this.albedoArray, gl.TEXTURE_2D_ARRAY)
        .tex('uNormalTex', 2, this.normalArray, gl.TEXTURE_2D_ARRAY)
        .tex('uSpecularTex', 3, this.specularArray, gl.TEXTURE_2D_ARRAY)
        .tex('uQuads', 0, this.meshes.heapTex)
        .i('uDestroyBase', DESTROY_LAYER_BASE)
        .f('uPomDepth', s.parallax ? 0.07 : 0)
        .v3('uCameraFract', cam.x - camFloor[0], cam.y - camFloor[1], cam.z - camFloor[2]);
      if (env.breakBlock) {
        prog.iv3('uBreakBlock', env.breakBlock[0] - camFloor[0], env.breakBlock[1] - camFloor[1], env.breakBlock[2] - camFloor[2]);
        prog.i('uBreakStage', env.breakBlock[3]);
      } else prog.i('uBreakStage', -1);
      quads += this.meshes.draw(prog, visList, range, cam.x, cam.y, cam.z);
    }
    if (farOn) this.drawFar(cam);
    // Held block + particles
    {
      const E = this.pEntity.use();
      E.tex('uAlbedoTex', 1, this.albedoArray, gl.TEXTURE_2D_ARRAY)
        .tex('uNormalTex', 2, this.normalArray, gl.TEXTURE_2D_ARRAY)
        .tex('uSpecularTex', 3, this.specularArray, gl.TEXTURE_2D_ARRAY)
        .i('uDestroyBase', DESTROY_LAYER_BASE)
        .f('uPomDepth', 0)
        .i('uBreakStage', -1);
      this.entities.draw(E, cam, right, up, env.heldModel, env.playerLight[0], env.playerLight[1]);
      gl.enable(gl.CULL_FACE);
    }
    this.stats.quads = quads;
    this.stats.drawCalls += 2;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    this.mark('gbuffer');
    // ---- clouds ----
    if (cloudsOn && !this.debug.skipCloudPass) {
      this.cloudRaw.bind(true);
      this.pClouds.use();
      this.bindCloudTextures(this.pClouds, 0);
      this.pClouds.tex('uSkyView', 3, this.skyViewLUT.color)
        .tex('uTransmittanceLUT', 4, this.transmittanceLUT.color)
        .tex('uSkySH', 5, this.skySH.color)
        .f('uSunIllum', SUN_ILLUM)
        .i('uSteps', s.clouds === 1 ? 20 : 32);
      this.fullscreen();
      this.cloudHist.write.bind(true);
      this.pCloudsTaa.use()
        .tex('uCurrent', 0, this.cloudRaw.color)
        .tex('uHistory', 1, this.cloudHist.read.color)
        .f('uReset', resetHistory ? 1 : 0);
      this.fullscreen();
    }

    this.mark('clouds');
    // ---- lighting ----
    this.hdrA.bind(true);
    const L = this.pLighting.use();
    L.tex('uGAlbedo', 0, this.gbuffer.colors[0])
      .tex('uGNormal', 1, this.gbuffer.colors[1])
      .tex('uGMaterial', 2, this.gbuffer.colors[2])
      .tex('uGDepth', 3, this.gbuffer.depth)
      .tex('uSkySH', 4, this.skySH.color)
      .tex('uSkyView', 5, this.skyViewLUT.color)
      .tex('uTransmittanceLUT', 6, this.transmittanceLUT.color)
      .tex('uClouds', 7, cloudsOn ? this.cloudHist.write.color : null)
      .f('uSunIllum', SUN_ILLUM)
      .f('uBlockLightIntensity', 1.0)
      .f('uCloudsEnabled', cloudsOn ? 1 : 0);
    this.bindShadow(L, 8, 9);
    this.bindCloudTextures(L, 10);
    L.tex('uWaterMap', 14, this.meshes.waterMap);
    this.bindStarRot(L, env.dayTime);
    this.fullscreen();

    this.mark('lighting');
    // ---- translucent (water / ice) ----
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.hdrA.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.hdrRefr.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.gbuffer.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.depthCopy.fbo);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboTranslucent);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    const Wp = this.pWater.use();
    Wp.tex('uQuads', 0, this.meshes.heapTex)
      .tex('uAlbedoTex', 1, this.albedoArray, gl.TEXTURE_2D_ARRAY)
      .tex('uSceneColor', 2, this.hdrRefr.color)
      .tex('uSceneDepth', 3, this.depthCopy.depth)
      .tex('uSkySH', 4, this.skySH.color)
      .tex('uSkyView', 5, this.skyViewLUT.color)
      .tex('uTransmittanceLUT', 6, this.transmittanceLUT.color)
      .i('uWaterLayer', this.waterLayer)
      .f('uSSREnabled', s.ssr ? 1 : 0)
      .f('uCloudsEnabled', cloudsOn ? 1 : 0)
      .f('uSunIllum', SUN_ILLUM)
      .f('uBlockLightIntensity', 1.0);
    this.bindShadow(Wp, 8, 9);
    this.bindCloudTextures(Wp, 10);
    this.bindStarRot(Wp, env.dayTime);
    Wp.f('uFarWater', 0);
    this.setChunkMask(Wp, cam, 14);
    const tq = this.meshes.draw(Wp, visList, 'translucent', cam.x, cam.y, cam.z);
    this.stats.quads += tq;
    if (farOn) this.drawFarWater(cam);
    gl.disable(gl.DEPTH_TEST);
    this.unbindShadow(8, 9);

    this.mark('water');
    // ---- volumetric light ----
    if (s.volumetric) {
      this.vol.bind(true);
      const V = this.pVolumetric.use();
      V.tex('uDepth', 0, this.gbuffer.depth)
        .tex('uSkySH', 1, this.skySH.color)
        .i('uSteps', env.underwater ? 20 : 16)
        .f('uCloudsEnabled', cloudsOn ? 1 : 0)
        .f('uWaterSurfaceY', env.waterSurfaceY);
      this.bindShadow(V, 8, 9);
      this.bindCloudTextures(V, 10);
      this.fullscreen();
      this.unbindShadow(8, 9);
    }

    this.mark('volumetric');
    // ---- composite ----
    this.hdrB.bind(true);
    this.pComposite.use()
      .tex('uScene', 0, this.hdrA.color)
      .tex('uVolumetric', 1, this.vol.color)
      .tex('uDepth', 2, this.gbuffer.depth)
      .f('uVolumetricEnabled', s.volumetric ? 1 : 0);
    this.fullscreen();
    if (env.rain > 0.01 && !env.underwater) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const base = (lum(sunIll) * 0.09 + lum(moonIll) * 0.09) * (1 - env.rain * 0.4) + env.lightning * 0.8 + 0.006;
      this.pRain.use().tex('uDepth', 0, this.gbuffer.depth).v3('uRainColor', base * 0.85, base * 0.9, base);
      this.rain.draw(this.pRain, cam, env.rain, [2.2, 1.6]);
      gl.disable(gl.BLEND);
    }

    this.mark('composite');
    // ---- TAA ----
    let resolved: RenderTarget = this.hdrB;
    if (s.taa) {
      this.taa.write.bind(true);
      this.pTaa.use()
        .tex('uCurrent', 0, this.hdrB.color)
        .tex('uHistory', 1, this.taa.read.color)
        .tex('uDepth', 2, this.gbuffer.depth)
        .f('uReset', resetHistory ? 1 : 0);
      this.fullscreen();
      resolved = this.taa.write;
    }

    this.mark('taa');
    // ---- bloom (downsample) ----
    if (s.bloom) {
      let src = resolved.color;
      let sw = W, sh = H;
      for (let i = 0; i < this.bloom.length; i++) {
        const b = this.bloom[i];
        b.bind(true);
        this.pBloomDown.use().tex('uSrc', 0, src).v2('uSrcTexel', 1 / sw, 1 / sh).i('uFirst', i === 0 ? 1 : 0);
        this.fullscreen();
        src = b.color;
        sw = b.width;
        sh = b.height;
      }
    }

    // ---- exposure (metered from a clean downsample, before bloom accumulation) ----
    this.lum.bind(true);
    this.pLuminance.use().tex('uSrc', 0, s.bloom ? this.bloom[2].color : resolved.color);
    this.fullscreen();
    gl.bindTexture(gl.TEXTURE_2D, this.lum.color);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.exposure.write.bind(true);
    this.pExposure.use()
      .tex('uLum', 0, this.lum.color)
      .f('uLumLevel', 7)
      .tex('uPrevExposure', 1, this.exposure.read.color)
      .f('uDt', Math.min(dt, 0.1))
      .f('uReset', this.frameIndex < 3 ? 1 : 0)
      .v2('uRange', 0.08, 11)
      .f('uBias', s.exposureBias);
    this.fullscreen();

    // ---- bloom (upsample) ----
    if (s.bloom) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.bloom.length - 1; i > 0; i--) {
        const dst = this.bloom[i - 1], srcT = this.bloom[i];
        dst.bind();
        this.pBloomUp.use().tex('uSrc', 0, srcT.color).v2('uSrcTexel', 1 / srcT.width, 1 / srcT.height).f('uRadius', 1.0);
        this.fullscreen();
      }
      gl.disable(gl.BLEND);
    }

    this.mark('bloom+exposure');
    // ---- final ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvasW, this.canvasH);
    this.pFinal.use()
      .tex('uColor', 0, resolved.color)
      .tex('uBloom', 1, this.bloom[0].color)
      .tex('uExposureTex', 2, this.exposure.write.color)
      .f('uBloomStrength', s.bloom ? 0.012 : 0)
      .i('uTonemap', s.tonemap)
      .f('uSaturation', s.saturation)
      .f('uContrast', 1.03)
      .f('uVignette', 0.35)
      .f('uSharpen', s.taa ? s.sharpen : 0)
      .v2('uColorTexel', 1 / W, 1 / H)
      .f('uUnderwater', env.underwater ? 1 : 0);
    this.fullscreen();

    this.mark('final');
    // ---- selection outline ----
    if (env.selection) {
      const [bx, by, bz] = env.selection;
      const e = 0.002;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.pOutline.use()
        .v3('uBoxMin', bx - cam.x - e, by - cam.y - e, bz - cam.z - e)
        .v3('uBoxMax', bx + 1 - cam.x + e, by + 1 - cam.y + e, bz + 1 - cam.z + e)
        .v2('uViewport', this.canvasW, this.canvasH)
        .f('uThickness', Math.max(1.5, this.canvasH / 700))
        .tex('uDepth', 0, this.gbuffer.depth);
      gl.drawArrays(gl.TRIANGLES, 0, 72);
      gl.disable(gl.BLEND);
    }

    this.mark('outline');
    if (this.debug.blit) this.debugBlit(this.debug.blit);

    // ---- bookkeeping ----
    this.prevViewProj.set(viewProjUnj);
    this.prevCam = [cam.x, cam.y, cam.z];
    this.historyValid = true;
    this.taa.swap();
    this.cloudHist.swap();
    this.exposure.swap();
    this.stats.gpuMemMB = this.meshes.bytes / (1024 * 1024);
  }

  private timerExt: any = null;
  private activeQuery: WebGLQuery | null = null;
  private pendingQueries: Array<{ q: WebGLQuery; name: string }> = [];
  private freeQueries: WebGLQuery[] = [];

  /** Ends the GPU timer for the section that just finished (`name`) and starts the next one. */
  private mark(name: string) {
    if (!this.profile) return;
    if (this.profileTotal && name !== '' && name !== 'outline') return;
    if (this.profileTotal && name === 'outline') name = 'frame';
    const gl = this.gl;
    if (!this.timerExt) this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const ext = this.timerExt;
    if (!ext) return;
    if (this.activeQuery) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      if (name) this.pendingQueries.push({ q: this.activeQuery, name });
      else this.freeQueries.push(this.activeQuery);
      this.activeQuery = null;
    }
    if (name === 'outline' || name === 'frame') return;
    const q = this.freeQueries.pop() ?? gl.createQuery()!;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.activeQuery = q;
  }

  private collectTimings() {
    const gl = this.gl, ext = this.timerExt;
    if (!ext || this.pendingQueries.length === 0) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    const still: Array<{ q: WebGLQuery; name: string }> = [];
    for (const pq of this.pendingQueries) {
      if (!gl.getQueryParameter(pq.q, gl.QUERY_RESULT_AVAILABLE)) { still.push(pq); continue; }
      const ns = gl.getQueryParameter(pq.q, gl.QUERY_RESULT) as number;
      if (!disjoint) {
        const ms = ns / 1e6;
        const prev = this.timings[pq.name];
        this.timings[pq.name] = prev === undefined ? ms : prev * 0.85 + ms * 0.15;
      }
      this.freeQueries.push(pq.q);
    }
    this.pendingQueries = still;
  }

  /** Forces temporal history to reset (e.g. after teleporting). */
  resetHistory() {
    this.historyValid = false;
  }

  /** Debug: copies an intermediate render target to the screen (e.g. 'cloudRaw', 'vol', 'hdrA'). */
  private debugBlit(name: string) {
    const gl = this.gl;
    const rt = (this as unknown as Record<string, RenderTarget | PingPong>)[name];
    const target = rt instanceof PingPong ? rt.write : rt;
    if (!target || !(target instanceof RenderTarget)) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, this.canvasW, this.canvasH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private setChunkMask(p: Program, cam: CameraState, unit: number) {
    const ccx = Math.floor(cam.x / 16), ccz = Math.floor(cam.z / 16);
    p.tex('uChunkMask', unit, this.meshes.chunkMask).iv2('uCamChunk', ccx, ccz).v2('uCamChunkFrac', cam.x - ccx * 16, cam.z - ccz * 16);
  }

  private drawFar(cam: CameraState) {
    const gl = this.gl;
    const far = this.far!;
    gl.disable(gl.CULL_FACE);
    const p = this.pFar.use();
    p.tex('uFarMap', 0, far.tex);
    this.setChunkMask(p, cam, 1);
    gl.uniform3fv(p.loc('uMatColors'), this.farColors);
    const wrap = (v: number) => ((v % 4096) + 4096) % 4096;
    p.f('uCameraY', cam.y).v2('uCameraWrap', wrap(cam.x), wrap(cam.z));
    const ctx = Math.floor(cam.x / 8), ctz = Math.floor(cam.z / 8);
    // Inner level: one vertex per texel (8 blocks).
    const N0 = 160;
    const o0x = ctx - N0 / 2, o0z = ctz - N0 / 2;
    p.iv2('uOriginTexel', o0x, o0z).i('uTexStep', 1).i('uGridN', N0)
      .v2('uOriginRel', o0x * 8 + 4 - cam.x, o0z * 8 + 4 - cam.z).v4('uInner', 0, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, N0 * N0 * 6);
    // Outer level: every 4th texel (32 blocks), with a hole where the inner level is.
    const N1 = 120;
    const o1x = Math.floor(ctx / 4) * 4 - (N1 / 2) * 4, o1z = Math.floor(ctz / 4) * 4 - (N1 / 2) * 4;
    const innerCx = (o0x + N0 / 2) * 8 + 4 - cam.x, innerCz = (o0z + N0 / 2) * 8 + 4 - cam.z;
    p.iv2('uOriginTexel', o1x, o1z).i('uTexStep', 4).i('uGridN', N1)
      .v2('uOriginRel', o1x * 8 + 4 - cam.x, o1z * 8 + 4 - cam.z).v4('uInner', innerCx, innerCz, (N0 / 2) * 8 - 12, 1);
    gl.drawArrays(gl.TRIANGLES, 0, N1 * N1 * 6);
    this.stats.drawCalls += 2;
    gl.enable(gl.CULL_FACE);
  }

  private drawFarWater(cam: CameraState) {
    const gl = this.gl;
    const p = this.pFarWater.use();
    const wrap = (v: number) => ((v % 4096) + 4096) % 4096;
    const N = 96, step = 40;
    const ox = Math.floor(cam.x / step) * step - (N / 2) * step, oz = Math.floor(cam.z / step) * step - (N / 2) * step;
    p.i('uGridN', N).f('uStep', step).v2('uOriginRel', ox - cam.x, oz - cam.z).v2('uCameraWrap', wrap(cam.x), wrap(cam.z))
      .f('uCameraY', cam.y).i('uWaterLayerV', this.waterLayer).f('uFarWater', 1);
    // Share the water program's other uniforms by re-binding the same textures on the same units.
    p.tex('uSceneColor', 2, this.hdrRefr.color)
      .tex('uSceneDepth', 3, this.depthCopy.depth)
      .tex('uSkySH', 4, this.skySH.color)
      .tex('uSkyView', 5, this.skyViewLUT.color)
      .tex('uTransmittanceLUT', 6, this.transmittanceLUT.color)
      .i('uWaterLayer', this.waterLayer)
      .f('uSSREnabled', this.settings.ssr ? 1 : 0)
      .f('uCloudsEnabled', this.settings.clouds > 0 ? 1 : 0)
      .f('uSunIllum', SUN_ILLUM)
      .f('uBlockLightIntensity', 1.0);
    this.bindShadow(p, 8, 9);
    this.bindCloudTextures(p, 10);
    this.setChunkMask(p, cam, 14);
    gl.drawArrays(gl.TRIANGLES, 0, N * N * 6);
    this.stats.drawCalls++;
  }

  private bindCloudTextures(p: Program, unit: number, withShadowMap = true) {
    const gl = this.gl;
    if (withShadowMap && p !== this.pCloudShadow) p.tex('uCloudShadowMap', unit + 3, this.cloudShadowRT.color);
    p.tex('uCloudShape', unit, this.cloudShape, gl.TEXTURE_3D)
      .tex('uCloudDetail', unit + 1, this.cloudDetail, gl.TEXTURE_3D)
      .tex('uWeather', unit + 2, this.weather);
  }

  private bindStarRot(p: Program, dayTime: number) {
    // Stars rotate with the sun around the tilted celestial axis.
    const th = -dayTime * Math.PI * 2;
    const ax = normalize([0, -Math.sin(SUN_TILT), Math.cos(SUN_TILT)]);
    const c = Math.cos(th), sn = Math.sin(th), t = 1 - c;
    const [x, y, z] = ax;
    const m = new Float32Array([
      t * x * x + c, t * x * y + sn * z, t * x * z - sn * y,
      t * x * y - sn * z, t * y * y + c, t * y * z + sn * x,
      t * x * z + sn * y, t * y * z - sn * x, t * z * z + c,
    ]);
    this.gl.uniformMatrix3fv(p.loc('uStarRot'), false, m);
  }

  private bindShadow(p: Program, unitCmp: number, unitRaw: number) {
    const gl = this.gl;
    p.tex('uShadowCmp', unitCmp, this.shadowTex, gl.TEXTURE_2D_ARRAY);
    gl.bindSampler(unitCmp, this.samplerCmp);
    p.tex('uShadowRaw', unitRaw, this.shadowTex, gl.TEXTURE_2D_ARRAY);
    gl.bindSampler(unitRaw, this.samplerRaw);
    gl.uniform4fv(p.loc('uCascadeDepthRange'), this.cascadeRanges);
  }

  private unbindShadow(unitCmp: number, unitRaw: number) {
    this.gl.bindSampler(unitCmp, null);
    this.gl.bindSampler(unitRaw, null);
  }

  private setupCascades(cam: CameraState, fwd: Vec3, right: Vec3, up: Vec3, fovY: number, aspect: number, L: Vec3, mask: number) {
    const s = this.settings;
    const D = s.shadowDistance;
    const n = 0.1;
    const lambda = 0.8;
    const splits = [n];
    for (let i = 1; i <= 4; i++) {
      const f = i / 4;
      splits.push(lambda * n * Math.pow(D / n, f) + (1 - lambda) * (n + (D - n) * f));
    }
    const tanY = Math.tan(fovY / 2), tanX = tanY * aspect;
    const res = this.shadowSize;
    // Light basis: a fixed axis perpendicular to the sun's orbit keeps the basis stable over the day.
    const axis: Vec3 = normalize([0, -Math.sin(SUN_TILT), Math.cos(SUN_TILT)]);
    const lf: Vec3 = [-L[0], -L[1], -L[2]];
    const lr = normalize(cross(lf, axis));
    const lu = normalize(cross(lr, lf));
    const camAbs: Vec3 = [cam.x, cam.y, cam.z];
    const F = this.frame;
    const sizeVec: number[] = [];
    for (let i = 0; i < 4; i++) {
      if (mask & (1 << i) || !this.cascadeParams[i]) {
        const a = splits[i], b = splits[i + 1];
        let c: Vec3;
        let r: number;
        if (i < 2) {
          // Near cascades: bounding sphere of the view-frustum slice.
          const corners: Vec3[] = [];
          for (const d of [a, b]) {
            for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
              corners.push([
                fwd[0] * d + right[0] * sx * tanX * d + up[0] * sy * tanY * d,
                fwd[1] * d + right[1] * sx * tanX * d + up[1] * sy * tanY * d,
                fwd[2] * d + right[2] * sx * tanX * d + up[2] * sy * tanY * d,
              ]);
            }
          }
          c = [0, 0, 0];
          for (const p of corners) { c[0] += p[0] / 8; c[1] += p[1] / 8; c[2] += p[2] / 8; }
          r = 0;
          for (const p of corners) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]));
          r = Math.ceil(r * 4) / 4 + 0.5;
        } else {
          // Far cascades (updated every other frame): camera-centred, rotation invariant.
          c = [0, 0, 0];
          r = b * 1.2;
        }
        const texel = (2 * r) / res;
        const cAbs: Vec3 = [camAbs[0] + c[0], camAbs[1] + c[1], camAbs[2] + c[2]];
        const csx = Math.floor(dot(cAbs, lr) / texel) * texel;
        const csy = Math.floor(dot(cAbs, lu) / texel) * texel;
        const csz = dot(cAbs, lf);
        const ext = 220;
        this.cascadeParams[i] = { lr, lu, lf, r, csx, csy, csz, zmin: -r - ext, zmax: r + 32 };
      }
      const P = this.cascadeParams[i];
      const sZ = 2 / (P.zmax - P.zmin);
      const m = this.cascadeMats[i];
      m.fill(0);
      m[0] = P.lr[0] / P.r; m[4] = P.lr[1] / P.r; m[8] = P.lr[2] / P.r; m[12] = (dot(camAbs, P.lr) - P.csx) / P.r;
      m[1] = P.lu[0] / P.r; m[5] = P.lu[1] / P.r; m[9] = P.lu[2] / P.r; m[13] = (dot(camAbs, P.lu) - P.csy) / P.r;
      m[2] = P.lf[0] * sZ; m[6] = P.lf[1] * sZ; m[10] = P.lf[2] * sZ; m[14] = (dot(camAbs, P.lf) - P.csz - P.zmin) * sZ - 1;
      m[15] = 1;
      F.mat(U.shadowMat + i * 16, m);
      this.cascadeRanges[i] = P.zmax - P.zmin;
      sizeVec.push(2 * P.r);
    }
    F.vec4(U.cascadeSplits, splits[1], splits[2], splits[3], splits[4]);
    F.vec4(U.cascadeSize, sizeVec[0], sizeVec[1], sizeVec[2], sizeVec[3]);
  }

  private renderShadows(cam: CameraState, mask: number) {
    const gl = this.gl;
    const S = this.shadowSize;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    const all = [...this.meshes.map.values()];
    const mf = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      if (!(mask & (1 << i))) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbos[i]);
      gl.viewport(0, 0, S, S);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const m = this.cascadeMats[i];
      const list: ChunkGPU[] = [];
      for (const g of all) {
        if (g.opaqueLit + g.cutoutLit === 0) continue;
        const ox = g.cx * 16 - cam.x, oz = g.cz * 16 - cam.z;
        const y0 = g.minY - cam.y, y1 = g.maxY + 1 - cam.y;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
        for (let k = 0; k < 8; k++) {
          const px = ox + (k & 1 ? 16 : 0), py = k & 2 ? y1 : y0, pz = oz + (k & 4 ? 16 : 0);
          const x = m[0] * px + m[4] * py + m[8] * pz + m[12];
          const y = m[1] * px + m[5] * py + m[9] * pz + m[13];
          const z = m[2] * px + m[6] * py + m[10] * pz + m[14];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
        }
        if (maxX < -1 || minX > 1 || maxY < -1 || minY > 1 || minZ > 1) continue;
        list.push(g);
      }
      for (let k = 0; k < 16; k++) mf[k] = m[k];
      this.pShadow.use().tex('uQuads', 0, this.meshes.heapTex).m4('uShadowViewProj', mf);
      this.stats.shadowQuads += this.meshes.draw(this.pShadow, list, 'opaqueLit', cam.x, cam.y, cam.z);
      this.pShadowCutout.use().tex('uQuads', 0, this.meshes.heapTex).m4('uShadowViewProj', mf).tex('uAlbedoTex', 1, this.albedoArray, gl.TEXTURE_2D_ARRAY);
      this.stats.shadowQuads += this.meshes.draw(this.pShadowCutout, list, 'cutoutLit', cam.x, cam.y, cam.z);
      this.stats.drawCalls += 2;
    }
    gl.disable(gl.DEPTH_TEST);
  }
}
