// Half-resolution volumetric light: sun/moon shafts through shadows and cloud gaps, valley mist,
// and underwater god rays.
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
precision highp sampler3D;
#include <frame>
#include <common>
#include <atmosphere>
#include <shadows>
#include <clouds_common>
#include <sh>
#include <water>

uniform sampler2D uDepth;
uniform int uSteps;
uniform float uCloudsEnabled;
uniform float uWaterSurfaceY;
in vec2 vUv;
out vec4 fragColor;

void main() {
  ivec2 fp = min(ivec2(gl_FragCoord.xy) * 2, ivec2(uResolution.xy) - 1);
  float depth = texelFetch(uDepth, fp, 0).r;
  vec2 uv = (vec2(fp) + 0.5) * uResolution.zw;
  vec3 dir = viewDirection(uv);
  float dist = depth >= 1.0 ? 1e6 : length(reconstructPosition(uv, depth));
  bool underwater = uFog.w > 0.5;
  float maxD = underwater ? 48.0 : 180.0;
  float D = min(dist, maxD);

  vec3 L = uLightDir.xyz;
  vec3 lightCol = uLightDir.w > 0.5 ? uSunIlluminance.rgb : uMoonIlluminance.rgb;
  float cosT = dot(dir, L);
  float jitter = ignT(gl_FragCoord.xy, uFrame);
  int steps = uSteps;
  float dt = D / float(steps);
  float outdoor = uMisc.z * uMisc.z;
  vec3 ambient = evalSH(vec3(0.0, 1.0, 0.0)) / PI * outdoor;

  vec3 inscatter = vec3(0.0);
  vec3 T = vec3(1.0);
  if (underwater) {
    vec3 sigmaA = vec3(0.34, 0.075, 0.042);
    vec3 sigmaS = vec3(0.006, 0.01, 0.011);
    vec3 sigmaT = sigmaA + sigmaS;
    float phase = mix(henyeyGreenstein(cosT, 0.55), 1.0 / (4.0 * PI), 0.55);
    for (int i = 0; i < 48; i++) {
      if (i >= steps) break;
      float t = (float(i) + jitter) * dt;
      vec3 P = dir * t;
      float wy = P.y + uCameraAbs.y;
      float depthBelow = max(uWaterSurfaceY - wy, 0.0);
      vec3 sunAtt = exp(-sigmaT * depthBelow / max(L.y, 0.2));
      float sh = uShadowInfo.w > 0.5 ? shadowHard(P) : 1.0;
      vec2 cp = (P.xz + uCameraPos.xz) - L.xz / max(L.y, 0.2) * depthBelow;
      float caus = 0.55 + caustics(cp * 0.9, uTime * 0.9) * 0.9;
      vec3 S = sigmaS * (lightCol * 0.9 * sunAtt * sh * caus * phase + ambient * exp(-sigmaT * depthBelow) * 0.35);
      vec3 stepT = exp(-sigmaT * dt);
      inscatter += T * S * (1.0 - stepT) / sigmaT;
      T *= stepT;
    }
    fragColor = vec4(inscatter, 1.0);
    return;
  }

  float phase = mix(henyeyGreenstein(cosT, 0.72), henyeyGreenstein(cosT, -0.2), 0.25);
  for (int i = 0; i < 48; i++) {
    if (i >= steps) break;
    float t = (float(i) + jitter) * dt;
    vec3 P = dir * t;
    float wy = P.y + uCameraAbs.y;
    float sigma = uFog.x * 0.7 + uFog.z * 0.02 * exp(-max(wy - 62.0, 0.0) / 12.0) * smoothstep(0.1, 0.6, uMisc.z);
    float sh = uShadowInfo.w > 0.5 ? shadowHard(P) : 1.0;
    if (uCloudsEnabled > 0.5) sh *= cloudShadow(P + uCameraAbs.xyz, L);
    vec3 S = sigma * (lightCol * sh * phase + ambient * 0.5);
    float stepT = exp(-sigma * dt);
    inscatter += T * S * (1.0 - stepT) / max(sigma, 1e-6);
    T *= stepT;
  }
  fragColor = vec4(inscatter, (T.r + T.g + T.b) / 3.0);
}
