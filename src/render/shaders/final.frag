// Final: sharpen, bloom, exposure, night-vision shift, AgX/ACES tonemap, grading, vignette, dither.
precision highp float;
precision highp sampler2D;
#include <frame>
#include <common>
uniform sampler2D uColor;
uniform sampler2D uBloom;
uniform sampler2D uExposureTex;
uniform float uBloomStrength;
uniform int uTonemap;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uSharpen;
uniform vec2 uColorTexel;
uniform float uUnderwater;
in vec2 vUv;
out vec4 fragColor;

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float minEv = -12.47393, maxEv = 4.026069;
  v = m * v;
  v = clamp(log2(max(v, vec3(1e-10))), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  return agxContrast(v);
}
vec3 agxEotf(vec3 v) {
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return mi * v;
}
vec3 agxLook(vec3 v) {
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = pow(max(v, vec3(0.0)), vec3(1.25));
  return l + 1.35 * (v - l);
}
vec3 acesFitted(vec3 c) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = inM * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) {
    uv += vec2(sin(uv.y * 22.0 + uTime * 2.2), cos(uv.x * 18.0 + uTime * 1.8)) * 0.0018;
  }
  vec3 c = texture(uColor, uv).rgb;
  if (uSharpen > 0.0) {
    vec3 n = texture(uColor, uv + vec2(0.0, uColorTexel.y)).rgb;
    vec3 s = texture(uColor, uv - vec2(0.0, uColorTexel.y)).rgb;
    vec3 e = texture(uColor, uv + vec2(uColorTexel.x, 0.0)).rgb;
    vec3 w = texture(uColor, uv - vec2(uColorTexel.x, 0.0)).rgb;
    vec3 mn = min(c, min(min(n, s), min(e, w)));
    vec3 mx = max(c, max(max(n, s), max(e, w)));
    vec3 amp = sqrt(saturate(min(mn, 2.0 - mx) / max(mx, 1e-4)));
    vec3 wgt = -amp * uSharpen * 0.2;
    c = max((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), vec3(0.0));
  }
  vec3 bloom = texture(uBloom, uv).rgb;
  c = mix(c, bloom, uBloomStrength);
  float exposure = texelFetch(uExposureTex, ivec2(0), 0).r;
  c *= exposure;

  // Scotopic (night) vision: desaturate and shift toward blue when adapted to darkness.
  float night = smoothstep(2.5, 6.5, log2(max(exposure, 1e-4)));
  float l = luminance(c);
  c = mix(c, l * vec3(0.62, 0.8, 1.15), night * 0.55);

  if (uTonemap == 0) c = agxEotf(agxLook(agx(c)));
  else c = linearToSrgb(acesFitted(c));

  c = max(c, vec3(0.0));
  float lg = luminance(c);
  c = mix(vec3(lg), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  vec2 d = vUv - 0.5;
  c *= mix(1.0, smoothstep(0.85, 0.2, length(d * vec2(1.1, 1.0))), uVignette);
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) / 255.0;
  fragColor = vec4(saturate(c), 1.0);
}
