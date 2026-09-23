// Translucent forward pass: water (SSR reflections, refraction, absorption, sun glints) and ice.
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
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

uniform sampler2DArray uAlbedoTex;
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform int uWaterLayer;
uniform float uSSREnabled;
uniform float uCloudsEnabled;
uniform float uBlockLightIntensity;
uniform float uFarWater;       // 1 when drawing the far ocean plane
#include <chunkmask>

in vec2 vUV;
flat in int vLayer;
flat in vec3 vNormal;
flat in vec3 vTangent;
flat in vec3 vBitangent;
in vec2 vQuadUV;
flat in vec4 vSky;
flat in vec4 vBlock;
flat in vec4 vAO;
flat in vec3 vTint;
flat in uint vFlags;
in vec3 vPos;
in vec3 vWorld;

out vec4 fragColor;

float bilerp(vec4 c, vec2 uv) { return mix(mix(c.x, c.y, uv.x), mix(c.w, c.z, uv.x), uv.y); }

vec2 projectUv(vec3 p, out float depth) {
  vec4 clip = uViewProj * vec4(p, 1.0);
  vec3 ndc = clip.xyz / clip.w;
  depth = ndc.z * 0.5 + 0.5;
  return ndc.xy * 0.5 + 0.5;
}

// Screen-space reflection in camera-relative world space. Returns uv (x<0 if miss) and confidence.
vec3 traceSSR(vec3 P, vec3 R, float jitter) {
  float dist = length(P);
  float stepLen = 0.35 + dist * 0.015;
  vec3 p = P + R * stepLen * jitter;
  vec3 prev = p;
  for (int i = 0; i < 48; i++) {
    prev = p;
    p += R * stepLen;
    vec4 clip = uViewProj * vec4(p, 1.0);
    if (clip.w <= 0.05) break;
    vec3 ndc = clip.xyz / clip.w;
    vec2 uv = ndc.xy * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float sd = textureLod(uSceneDepth, uv, 0.0).r;
    float rd = ndc.z * 0.5 + 0.5;
    if (rd > sd && sd < 1.0) {
      float diff = linearizeDepth(rd) - linearizeDepth(sd);
      if (diff < stepLen * 2.5 + 0.6) {
        vec3 a = prev, b = p;
        for (int j = 0; j < 6; j++) {
          vec3 m = (a + b) * 0.5;
          float md;
          vec2 muv = projectUv(m, md);
          if (md > textureLod(uSceneDepth, muv, 0.0).r) b = m; else a = m;
        }
        float bd;
        vec2 buv = projectUv(b, bd);
        vec2 edge = min(buv, 1.0 - buv);
        float conf = smoothstep(0.0, 0.08, min(edge.x, edge.y)) * (1.0 - float(i) / 48.0);
        return vec3(buv, conf);
      }
    }
    stepLen *= 1.1;
  }
  return vec3(-1.0, -1.0, 0.0);
}

void main() {
  if (uFarWater > 0.5 && chunkMeshed(vPos)) discard;
  bool isWater = vLayer == uWaterLayer;
  vec2 screenUv = gl_FragCoord.xy * uResolution.zw;
  vec3 P = vPos;
  float dist = length(P);
  vec3 dir = P / dist;
  vec3 V = -dir;
  float skyL = bilerp(vSky, vQuadUV);
  float blkL = bilerp(vBlock, vQuadUV);
  float skyVis = skyL * skyL;
  vec3 faceN = gl_FrontFacing ? vNormal : -vNormal;
  bool underside = !gl_FrontFacing && vNormal.y > 0.5;

  vec3 N = faceN;
  float roughness = 0.02;
  if (isWater) {
    float strength = mix(0.55, 0.12, saturate(dist / 90.0));
    if (abs(vNormal.y) > 0.5) {
      N = waterNormal(vWorld.xz, strength);
      if (faceN.y < 0.0) N = -N;
    } else {
      N = normalize(faceN + waterNormal(vWorld.xz + vWorld.y, 0.3) * vec3(1.0, 0.0, 1.0) * 0.3);
    }
  } else {
    roughness = 0.08;
  }

  // Scene behind the surface
  float opaqueDepth = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).r;
  float opaqueDist = opaqueDepth >= 1.0 ? 2000.0 : length(reconstructPosition(screenUv, opaqueDepth));
  float thickness = max(opaqueDist - dist, 0.0);

  vec2 refrOff = N.xz * (isWater ? 0.045 : 0.02) * saturate(thickness * 0.4) / (1.0 + dist * 0.05);
  vec2 rUv = clamp(screenUv + refrOff, vec2(0.001), vec2(0.999));
  float rDepth = texture(uSceneDepth, rUv).r;
  if (rDepth < gl_FragCoord.z) rUv = screenUv;
  else {
    float rd = rDepth >= 1.0 ? 2000.0 : length(reconstructPosition(rUv, rDepth));
    thickness = max(rd - dist, 0.0);
  }
  vec3 behind = texture(uSceneColor, rUv).rgb;

  vec3 L = uLightDir.xyz;
  vec3 lightCol = uLightDir.w > 0.5 ? uSunIlluminance.rgb : uMoonIlluminance.rgb;
  float blocker;
  float shadow = uShadowInfo.w > 0.5 ? sampleShadow(P, vec3(0.0, 1.0, 0.0), max(L.y, 0.0), gl_FragCoord.xy, blocker) : 1.0;
  shadow *= smoothstep(0.05, 0.45, skyL);
  if (uCloudsEnabled > 0.5) shadow *= cloudShadow(P + uCameraAbs.xyz, L);

  vec3 color;
  if (isWater) {
    // Absorption + in-scattering along the refracted path (per block).
    vec3 sigmaA = vec3(0.34, 0.075, 0.042);
    vec3 sigmaS = vec3(0.012, 0.018, 0.02);
    vec3 sigmaT = sigmaA + sigmaS;
    float pathLen = underside ? 0.0 : thickness;
    vec3 Tw = exp(-sigmaT * pathLen);
    vec3 ambient = evalSH(vec3(0.0, 1.0, 0.0)) / PI * skyVis;
    float phase = henyeyGreenstein(dot(dir, L), 0.5);
    vec3 inS = (lightCol * shadow * phase * 2.0 + ambient) * sigmaS / sigmaT * (1.0 - Tw);
    vec3 torch = vec3(1.0, 0.57, 0.26) * uBlockLightIntensity * pow(blkL, 3.6) * 1.6;
    inS += torch * sigmaS / sigmaT * (1.0 - Tw) * 0.5;
    vec3 transmitted = behind * Tw + inS;

    // Fresnel (with total internal reflection when seen from below)
    float NdotV = max(dot(N, V), 0.0);
    float F;
    if (underside) {
      float sinT2 = 1.33 * 1.33 * (1.0 - NdotV * NdotV);
      F = sinT2 >= 1.0 ? 1.0 : 0.02 + 0.98 * pow5(1.0 - sqrt(1.0 - sinT2));
    } else {
      F = 0.02 + 0.98 * pow5(1.0 - NdotV);
    }

    // Reflection
    vec3 R = reflect(dir, N);
    if (!underside) R.y = abs(R.y);
    vec3 refl;
    vec3 fallback = underside
      ? vec3(0.02, 0.06, 0.07) * (evalSH(vec3(0.0, 1.0, 0.0)) / PI) * skyVis
      : skyRadiance(normalize(R), false) * mix(0.06, 1.0, skyVis);
    if (uSSREnabled > 0.5) {
      vec3 hit = traceSSR(P, R, ignT(gl_FragCoord.xy, uFrame));
      refl = hit.x >= 0.0 ? mix(fallback, texture(uSceneColor, hit.xy).rgb, hit.z) : fallback;
    } else refl = fallback;

    color = mix(transmitted, refl, F);
    // Sun / moon glint
    if (!underside) {
      vec3 H = normalize(L + V);
      float NdotL = max(dot(N, L), 0.0);
      float spec = D_GGX(max(dot(N, H), 0.0), 0.045) * V_SmithGGX(max(NdotV, 1e-3), NdotL, 0.045);
      color += lightCol * shadow * spec * NdotL * F_Schlick(vec3(0.02), max(dot(V, H), 0.0)).x * 1.0;
    }
    if (underside) color = behind * mix(1.0, 0.0, F) + refl * F;
  } else {
    // Ice / translucent solids
    vec4 alb = texture(uAlbedoTex, vec3(vUV, float(vLayer)));
    float NdotV = max(dot(N, V), 0.0);
    float F = 0.04 + 0.96 * pow5(1.0 - NdotV);
    vec3 R = reflect(dir, N);
    vec3 refl = skyRadiance(normalize(vec3(R.x, abs(R.y), R.z)), false) * mix(0.06, 1.0, skyVis);
    float NdotL = max(dot(faceN, L), 0.0);
    vec3 lit = alb.rgb * (lightCol * shadow * NdotL / PI + evalSH(faceN) / PI * skyVis);
    color = mix(behind * mix(vec3(1.0), alb.rgb, alb.a * 0.8), lit, alb.a * 0.35);
    color = mix(color, refl, F * 0.8);
  }

  if (uFog.w < 0.5) color = applyHaze(color, P, dir, dist, skyL);
  fragColor = vec4(color, 1.0);
}
