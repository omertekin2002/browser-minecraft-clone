// Generates one slice of the tileable cloud noise volumes.
precision highp float;
#include <frame>
#include <common>
uniform float uSlice;
uniform float uSize;
uniform int uMode; // 0: shape (Perlin-Worley + Worley fBm), 1: detail (Worley fBm)
out vec4 fragColor;

vec3 gradP(vec3 c, float period) {
  c = mod(c, period);
  return normalize(hash33(c + 0.123) * 2.0 - 1.0);
}

float perlinP(vec3 p, float period) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(gradP(i, period), f);
  float n100 = dot(gradP(i + vec3(1, 0, 0), period), f - vec3(1, 0, 0));
  float n010 = dot(gradP(i + vec3(0, 1, 0), period), f - vec3(0, 1, 0));
  float n110 = dot(gradP(i + vec3(1, 1, 0), period), f - vec3(1, 1, 0));
  float n001 = dot(gradP(i + vec3(0, 0, 1), period), f - vec3(0, 0, 1));
  float n101 = dot(gradP(i + vec3(1, 0, 1), period), f - vec3(1, 0, 1));
  float n011 = dot(gradP(i + vec3(0, 1, 1), period), f - vec3(0, 1, 1));
  float n111 = dot(gradP(i + vec3(1, 1, 1), period), f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float worleyP(vec3 p, float period) {
  vec3 i = floor(p), f = fract(p);
  float md = 1.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(x, y, z);
        vec3 pt = o + hash33(mod(i + o, period) + 7.31) - f;
        md = min(md, dot(pt, pt));
      }
  return 1.0 - sqrt(md);
}

float perlinFbm(vec3 p, float freq, int octaves) {
  float s = 0.0, a = 1.0, n = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= octaves) break;
    s += perlinP(p * freq, freq) * a;
    n += a;
    a *= 0.5;
    freq *= 2.0;
  }
  return s / n;
}

float worleyFbm(vec3 p, float freq) {
  return worleyP(p * freq, freq) * 0.625 + worleyP(p * freq * 2.0, freq * 2.0) * 0.25 + worleyP(p * freq * 4.0, freq * 4.0) * 0.125;
}

float remap01(float v, float l0, float h0, float l1, float h1) {
  return l1 + (v - l0) * (h1 - l1) / (h0 - l0);
}

void main() {
  vec3 uvw = vec3(gl_FragCoord.xy, uSlice + 0.5) / uSize;
  if (uMode == 0) {
    float pf = clamp(perlinFbm(uvw, 4.0, 5) * 0.75 + 0.5, 0.0, 1.0);
    float w1 = worleyFbm(uvw, 4.0);
    float pw = clamp(remap01(pf, 0.0, 1.0, w1 * 0.9, 1.0), 0.0, 1.0);
    fragColor = vec4(pw, worleyFbm(uvw, 4.0), worleyFbm(uvw, 8.0), worleyFbm(uvw, 16.0));
  } else {
    fragColor = vec4(worleyFbm(uvw, 2.0), worleyFbm(uvw, 4.0), worleyFbm(uvw, 8.0), 1.0);
  }
}
