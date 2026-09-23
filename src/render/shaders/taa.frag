// Temporal anti-aliasing: reprojection via depth, Catmull-Rom history, variance clipping in YCoCg.
precision highp float;
precision highp sampler2D;
#include <frame>
#include <common>
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform sampler2D uDepth;
uniform float uReset;
in vec2 vUv;
out vec4 fragColor;

vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 tm(vec3 c) { return c / (1.0 + luminance(c)); }
vec3 itm(vec3 c) { return c / max(1.0 - luminance(c), 1e-4); }

vec3 sampleHistory(vec2 uv) {
  vec2 texSize = uResolution.xy;
  vec2 samplePos = uv * texSize;
  vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  vec2 f = samplePos - texPos1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 offset12 = w2 / w12;
  vec2 tp0 = (texPos1 - 1.0) / texSize;
  vec2 tp3 = (texPos1 + 2.0) / texSize;
  vec2 tp12 = (texPos1 + offset12) / texSize;
  vec3 r = vec3(0.0);
  r += texture(uHistory, vec2(tp12.x, tp0.y)).rgb * w12.x * w0.y;
  r += texture(uHistory, vec2(tp0.x, tp12.y)).rgb * w0.x * w12.y;
  r += texture(uHistory, vec2(tp12.x, tp12.y)).rgb * w12.x * w12.y;
  r += texture(uHistory, vec2(tp3.x, tp12.y)).rgb * w3.x * w12.y;
  r += texture(uHistory, vec2(tp12.x, tp3.y)).rgb * w12.x * w3.y;
  float ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / ws, vec3(0.0));
}

vec3 clipAABB(vec3 bmin, vec3 bmax, vec3 q) {
  vec3 pc = 0.5 * (bmax + bmin);
  vec3 ec = 0.5 * (bmax - bmin) + 1e-5;
  vec3 v = q - pc;
  vec3 a = abs(v / ec);
  float m = max(a.x, max(a.y, a.z));
  return m > 1.0 ? pc + v / m : q;
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 maxPx = ivec2(uResolution.xy) - 1;
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), cur = vec3(0.0);
  float closest = 1.0;
  ivec2 cpx = px;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 q = clamp(px + ivec2(x, y), ivec2(0), maxPx);
      vec3 c = toYCoCg(tm(texelFetch(uCurrent, q, 0).rgb));
      if (x == 0 && y == 0) cur = c;
      m1 += c;
      m2 += c * c;
      float d = texelFetch(uDepth, q, 0).r;
      if (d < closest) { closest = d; cpx = q; }
    }
  }
  m1 /= 9.0;
  m2 /= 9.0;
  vec3 sigma = sqrt(max(m2 - m1 * m1, vec3(0.0)));
  vec3 bmin = m1 - 1.2 * sigma, bmax = m1 + 1.2 * sigma;

  vec2 cuv = (vec2(cpx) + 0.5) * uResolution.zw;
  bool sky = closest >= 1.0;
  vec3 P = sky ? viewDirection(cuv) * 1e5 : reconstructPosition(cuv, closest);
  vec4 cu = uViewProjUnjittered * vec4(P, 1.0);
  vec4 pv = uPrevViewProj * vec4(sky ? P : P + uCameraDelta.xyz, 1.0);
  vec2 velocity = (cu.xy / cu.w - pv.xy / pv.w) * 0.5;
  // The held item is attached to the camera: it does not move on screen.
  if (closest < 0.005) velocity = vec2(0.0);
  vec2 prevUv = vUv - velocity;

  vec3 hist = toYCoCg(tm(sampleHistory(prevUv)));
  hist = clipAABB(bmin, bmax, hist);
  float speed = length(velocity * uResolution.xy);
  float feedback = mix(0.93, 0.8, saturate(speed / 16.0));
  bool offscreen = any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)));
  if (offscreen || uReset > 0.5 || pv.w <= 0.0) feedback = 0.0;
  vec3 res = mix(cur, hist, feedback);
  fragColor = vec4(itm(fromYCoCg(res)), 1.0);
}
