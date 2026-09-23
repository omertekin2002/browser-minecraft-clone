// Deferred lighting: sun/moon with PCSS shadows + cloud shadows, subsurface foliage, SH sky ambient,
// warm block light, emission, sky reflections, aerial haze. Sky pixels get the atmosphere + clouds.
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
precision highp sampler3D;

#include <frame>
#include <common>
#include <atmosphere>
#include <sky>
#include <shadows>
#include <brdf>
#include <clouds_common>
#include <sh>
#include <haze>
#include <water>
#include <watermap>

uniform sampler2D uGAlbedo;
uniform sampler2D uGNormal;
uniform sampler2D uGMaterial;
uniform sampler2D uGDepth;
uniform sampler2D uClouds;
uniform float uBlockLightIntensity;
uniform float uCloudsEnabled;

in vec2 vUv;
out vec4 fragColor;

const vec3 FACE_N[7] = vec3[7](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,1,0));

float cloudEntry(vec3 dir) {
  float y = uCameraAbs.y;
  if (y < CLOUD_BOTTOM) return dir.y > 0.0 ? (CLOUD_BOTTOM - y) / dir.y : 1e9;
  if (y > CLOUD_TOP) return dir.y < 0.0 ? (CLOUD_TOP - y) / dir.y : 1e9;
  return 0.0;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  float depth = texelFetch(uGDepth, px, 0).r;
  vec3 dir = viewDirection(vUv);

  if (depth >= 1.0) {
    vec3 sky = skyRadiance(dir, true);
    if (uCloudsEnabled > 0.5) {
      vec4 cl = texture(uClouds, vUv);
      sky = sky * cl.a + cl.rgb;
    }
    fragColor = vec4(sky, 1.0);
    return;
  }

  vec3 P = reconstructPosition(vUv, depth);
  float dist = length(P);
  vec3 V = -P / dist;
  vec4 ga = texelFetch(uGAlbedo, px, 0);
  vec3 albedo = ga.rgb;
  int mb = int(ga.a * 255.0 + 0.5);
  int faceIdx = mb & 7;
  float sss = float(mb >> 3) / 31.0;
  vec3 geoN = FACE_N[min(faceIdx, 6)];
  vec4 gn = texelFetch(uGNormal, px, 0);
  vec3 N = octDecode(gn.xy);
  float skyL = gn.z, blkL = gn.w;
  vec4 gm = texelFetch(uGMaterial, px, 0);
  float smoothness = gm.r;
  float f0v = gm.g;
  float ao = gm.b;
  float emission = gm.a;

  bool metal = f0v > 0.9;
  // Rain: exposed surfaces get darker and glossy; flat tops collect puddles.
  float wet = 0.0, puddle = 0.0;
  if (uMisc.x > 0.01) {
    vec3 Pw = P + uCameraAbs.xyz;
    float exposedToSky = smoothstep(0.86, 0.97, skyL);
    wet = uMisc.x * exposedToSky * (faceIdx == 2 ? 1.0 : faceIdx == 6 ? 0.6 : 0.55);
    if (faceIdx == 2) {
      float pn = valueNoise2(Pw.xz * 0.35) * 0.65 + valueNoise2(Pw.xz * 1.3) * 0.35;
      puddle = smoothstep(0.5, 0.62, pn) * smoothstep(0.35, 0.8, uMisc.x) * exposedToSky;
    }
    // Vegetation (green-dominant albedo) takes a soft sheen rather than a glossy film.
    float veg = saturate((albedo.g - max(albedo.r, albedo.b)) * 10.0);
    if (!metal) albedo *= mix(1.0, 0.6, wet);
    // A water film fills the micro relief: flatter normals, moderate gloss; puddles are mirrors.
    // Per-texel normals left in the film make grazing-angle Fresnel flicker texel by texel.
    smoothness = mix(smoothness, mix(0.55, 0.4, veg), wet * 0.7);
    smoothness = mix(smoothness, 0.97, puddle);
    f0v = metal ? f0v : mix(f0v, 0.02, wet);
    N = normalize(mix(N, geoN, max(puddle, wet * 0.9)));
  }
  float roughness = max(sq(1.0 - smoothness), 0.03);
  vec3 F0 = metal ? albedo : vec3(f0v);
  vec3 diffuse = metal ? vec3(0.0) : albedo;
  float aoF = 0.28 + 0.72 * pow(ao, 1.4);
  float NdotV = max(dot(N, V), 1e-4);

  vec3 L = uLightDir.xyz;
  vec3 lightCol = uLightDir.w > 0.5 ? uSunIlluminance.rgb : uMoonIlluminance.rgb;
  float NdotL = dot(N, L);
  float geoNdotL = faceIdx < 6 ? dot(geoN, L) : 1.0;
  vec3 Pabs = P + uCameraAbs.xyz;

  // Surfaces under water: sunlight is absorbed on its way down and focused into caustics.
  float wTop = waterSurfaceAt(Pabs + geoN * 0.05);
  float wDepth = wTop - Pabs.y;
  vec3 waterSky = vec3(1.0);
  if (wDepth > 0.02) {
    vec3 sigmaT = vec3(0.34, 0.075, 0.042) + vec3(0.006, 0.01, 0.011);
    float ly = max(L.y, 0.2);
    vec2 cp = Pabs.xz - L.xz / ly * wDepth;
    float caus = caustics(cp * 0.85, uTime * 0.9);
    lightCol *= exp(-sigmaT * wDepth / ly) * (0.4 + caus * 1.5) * 0.95;
    waterSky = exp(-sigmaT * wDepth);
  }

  float shadow = 0.0;
  float blockerDist = 0.0;
  bool facing = geoNdotL > 0.0 || sss > 0.0;
  if (facing && dot(lightCol, lightCol) > 0.0) {
    shadow = uShadowInfo.w > 0.5 ? sampleShadow(P, faceIdx < 6 ? geoN : vec3(0.0, 1.0, 0.0), max(geoNdotL, 0.0), gl_FragCoord.xy, blockerDist) : 1.0;
    shadow *= smoothstep(0.05, 0.45, skyL);
    if (uCloudsEnabled > 0.5) shadow *= cloudShadow(Pabs, L);
  }

  vec3 direct = vec3(0.0);
  if (NdotL > 0.0 && geoNdotL > -0.01 && shadow > 0.0) {
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);
    vec3 F = F_Schlick(F0, VdotH);
    vec3 spec = D_GGX(NdotH, roughness) * V_SmithGGX(NdotV, NdotL, roughness) * F;
    vec3 diff = diffuse / PI * (1.0 - F);
    direct = (diff + spec) * NdotL * lightCol * shadow;
  }
  if (sss > 0.0 && shadow > 0.0) {
    float back = saturate(dot(-V, L));
    float phase = 0.3 + 2.2 * pow(back, 8.0);
    float trans = exp(-blockerDist * 1.2);
    float wrap = faceIdx == 6 ? 1.0 : saturate(-geoNdotL * 0.8 + 0.4);
    direct += diffuse * lightCol * shadow * sss * trans * phase * wrap * 0.3 / PI;
  }

  // Sky ambient (SH irradiance, occluded by the Minecraft sky-light level)
  float skyVis = skyL * skyL;
  vec3 skyIrr = evalSH(N);
  vec3 ambient = diffuse * skyIrr / PI * skyVis * aoF * waterSky;

  // Block light (torches, lava, glowstone)
  float blI = pow(blkL, 3.6) * 1.6 + pow(blkL, 1.4) * 0.04;
  float flicker = 1.0 + 0.04 * sin(uTime * 13.0 + Pabs.x * 1.3) * sin(uTime * 7.3 + Pabs.z);
  vec3 torch = vec3(1.0, 0.57, 0.26) * uBlockLightIntensity * flicker;
  vec3 blockLight = diffuse * torch * blI * aoF;
  // Held light source
  if (uMisc.w > 0.0) {
    float hl = saturate(1.0 - dist / uMisc.w);
    blockLight += diffuse * torch * pow(hl, 3.0) * 0.55 * saturate(dot(N, V) * 0.6 + 0.4) * aoF;
  }

  vec3 emissive = albedo * emission * emission * 6.0;
  vec3 minAmb = diffuse * vec3(0.55, 0.62, 0.8) * 0.0025 * aoF;

  // Environment specular (sky reflection, occluded by sky light)
  vec3 R = reflect(-V, N);
  vec2 ab = envBRDFApprox(roughness, NdotV);
  vec3 envCol = mix(sampleSky(normalize(vec3(R.x, max(R.y, 0.02), R.z))), evalSH(R) / PI, saturate(roughness * 1.5));
  vec3 envSpec = envCol * (F0 * ab.x + ab.y) * skyVis * aoF;
  envSpec += torch * blI * (F0 * ab.x + ab.y) * 0.15 * aoF;

  vec3 color = direct + ambient + blockLight + emissive + minAmb + envSpec;

  if (uFog.w < 0.5) color = applyHaze(color, P, dir, dist, skyL);

  if (uCloudsEnabled > 0.5 && cloudEntry(dir) < dist) {
    vec4 cl = texture(uClouds, vUv);
    color = color * cl.a + cl.rgb;
  }
  fragColor = vec4(color, 1.0);
}
