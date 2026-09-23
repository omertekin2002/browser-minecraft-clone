// Tileable 2D weather map: R = large cumulus fields, G = cellular detail.
precision highp float;
#include <frame>
#include <common>
uniform float uSize;
out vec4 fragColor;

vec2 grad2(vec2 c, float period) {
  c = mod(c, period);
  float a = hash12(c + 3.7) * TAU;
  return vec2(cos(a), sin(a));
}
float perlin2(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(grad2(i, period), f);
  float b = dot(grad2(i + vec2(1, 0), period), f - vec2(1, 0));
  float c = dot(grad2(i + vec2(0, 1), period), f - vec2(0, 1));
  float d = dot(grad2(i + vec2(1, 1), period), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float worley2(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  float md = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y);
    vec2 pt = o + hash22(mod(i + o, period) + 1.7) - f;
    md = min(md, dot(pt, pt));
  }
  return 1.0 - sqrt(md);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float s = 0.0, a = 1.0, n = 0.0, freq = 4.0;
  for (int o = 0; o < 6; o++) { s += perlin2(uv * freq, freq) * a; n += a; a *= 0.5; freq *= 2.0; }
  float p = clamp(s / n * 0.9 + 0.5, 0.0, 1.0);
  float w = worley2(uv * 10.0, 10.0) * 0.6 + worley2(uv * 22.0, 22.0) * 0.4;
  fragColor = vec4(p, w, perlin2(uv * 3.0, 3.0) * 0.5 + 0.5, 1.0);
}
