// Half-resolution volumetric cloud raymarch (independent of scene depth; composited later).
precision highp float;
precision highp int;
precision highp sampler3D;
#include <frame>
#include <common>
#include <atmosphere>
#include <sky>
#include <clouds_common>
#include <sh>
uniform int uSteps;
in vec2 vUv;
out vec4 fragColor;

float lightOD(vec3 p, vec3 L, float jitter) {
  float od = 0.0;
  float stepLen = 16.0;
  // Jittered start breaks the height-correlated banding of a fixed light march.
  p += L * stepLen * jitter;
  for (int i = 0; i < 5; i++) {
    p += L * stepLen * 0.5;
    od += cloudDensity(p, 1) * stepLen;
    p += L * stepLen * 0.5;
    stepLen *= 1.7;
  }
  return od * CLOUD_SIGMA;
}

void main() {
  vec3 dir = viewDirection(vUv);
  vec3 ro = uCameraAbs.xyz;
  float t0 = 0.0, t1 = 0.0;
  if (ro.y < CLOUD_BOTTOM) {
    if (dir.y <= 0.001) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    t0 = (CLOUD_BOTTOM - ro.y) / dir.y;
    t1 = (CLOUD_TOP - ro.y) / dir.y;
  } else if (ro.y > CLOUD_TOP) {
    if (dir.y >= -0.001) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    t0 = (CLOUD_TOP - ro.y) / dir.y;
    t1 = (CLOUD_BOTTOM - ro.y) / dir.y;
  } else {
    t0 = 0.0;
    t1 = dir.y > 0.001 ? (CLOUD_TOP - ro.y) / dir.y : dir.y < -0.001 ? (CLOUD_BOTTOM - ro.y) / dir.y : 20000.0;
  }
  if (t0 > 40000.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  t1 = min(t1, t0 + 3500.0);

  float len = t1 - t0;
  // Step count follows the segment length (grazing rays cross far more cloud layer).
  // Continuous step length (an integer step count would change between rows and cause banding).
  float quality = float(uSteps) / 32.0;
  float stepLen = clamp(len / (40.0 * quality), 12.0, 90.0);
  // R2 low-discrepancy dither + golden-ratio temporal offset (converges quickly under accumulation).
  float jitter = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402910)) + float(uFrame % 256) * 0.61803398875);
  float t = t0 + stepLen * jitter;

  bool sun = uLightDir.w > 0.5;
  vec3 L = uLightDir.xyz;
  vec3 lightCol = sun ? uSunIlluminance.rgb : uMoonIlluminance.rgb;
  float cosT = dot(dir, L);
  vec3 ambTop = evalSH(vec3(0.0, 1.0, 0.0)) / PI;
  vec3 ambBottom = evalSH(vec3(0.0, -1.0, 0.0)) / PI;
  float phaseDirect = mix(henyeyGreenstein(cosT, 0.8), henyeyGreenstein(cosT, -0.2), 0.3) + 0.06;
  float silver = henyeyGreenstein(cosT, 0.96) * 0.25;

  vec3 scat = vec3(0.0);
  float T = 1.0;
  for (int i = 0; i < 128; i++) {
    if (t >= t1) break;
    vec3 p = ro + dir * t;
    float d = cloudDensity(p, t < 9000.0 ? 0 : 1);
    if (d > 0.002) {
      float sigma = d * CLOUD_SIGMA;
      float od = lightOD(p, L, fract(jitter + float(i) * 0.38196601));
      // Single scattering + an energy-conserving multiple-scattering tail (decays much slower with depth).
      float direct = exp(-od) * (phaseDirect + silver);
      float multi = (exp(-od * 0.16) * 0.7 + exp(-od * 0.5) * 0.3) * 0.16;
      float powder = 1.0 - exp(-sigma * 90.0);
      float h = (p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
      vec3 amb = mix(ambBottom * 0.3 + ambTop * 0.25, ambTop * 0.9, saturate(h * 1.4));
      vec3 S = (lightCol * (direct + multi) * mix(0.65, 1.0, powder) + amb) * (1.0 - uMisc.x * 0.55)
             + vec3(0.6, 0.65, 0.9) * uCameraAbs.w * 0.35;
      float stepT = exp(-sigma * stepLen);
      scat += T * S * (1.0 - stepT);
      T *= stepT;
      if (T < 0.01) { T = 0.0; break; }
    }
    t += stepLen;
  }
  float fade = exp(-t0 * 0.000045);
  scat *= fade;
  T = mix(1.0, T, fade);
  fragColor = vec4(scat, T);
}
