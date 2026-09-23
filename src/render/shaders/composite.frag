// Applies volumetric light / fog (depth-aware upsample) and underwater absorption.
precision highp float;
precision highp sampler2D;
#include <frame>
#include <common>
uniform sampler2D uScene;
uniform sampler2D uVolumetric;
uniform sampler2D uDepth;
uniform float uVolumetricEnabled;
in vec2 vUv;
out vec4 fragColor;

vec4 upsampleVolumetric(vec2 uv, float depthLin) {
  ivec2 hs = textureSize(uVolumetric, 0);
  vec2 hp = uv * vec2(hs) - 0.5;
  ivec2 base = ivec2(floor(hp));
  vec2 f = fract(hp);
  ivec2 maxFull = ivec2(uResolution.xy) - 1;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      ivec2 q = clamp(base + ivec2(i, j), ivec2(0), hs - 1);
      float d = linearizeDepth(texelFetch(uDepth, min(q * 2, maxFull), 0).r);
      float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      w *= 1.0 / (0.02 + abs(d - depthLin) / max(depthLin, 0.5));
      sum += texelFetch(uVolumetric, q, 0) * w;
      wsum += w;
    }
  }
  return sum / max(wsum, 1e-6);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 c = texelFetch(uScene, px, 0).rgb;
  float depth = texelFetch(uDepth, px, 0).r;
  float dist = depth >= 1.0 ? 1e6 : length(reconstructPosition(vUv, depth));
  if (uFog.w > 0.5) {
    vec3 sigmaT = vec3(0.34, 0.075, 0.042) + vec3(0.006, 0.01, 0.011);
    c *= exp(-sigmaT * min(dist, 400.0));
  }
  if (uVolumetricEnabled > 0.5) {
    vec4 vf = upsampleVolumetric(vUv, linearizeDepth(depth));
    c = c * vf.a + vf.rgb;
  }
  fragColor = vec4(max(c, vec3(0.0)), 1.0);
}
