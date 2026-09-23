#define PI 3.14159265359
#define TAU 6.28318530718
#define saturate(x) clamp(x, 0.0, 1.0)

float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float sq(float x) { return x * x; }
float pow5(float x) { float x2 = x * x; return x2 * x2 * x; }

vec3 srgbToLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 linearToSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

vec2 signNotZero(vec2 v) { return vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0); }
vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  return n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * signNotZero(n.xy);
}
vec3 octDecode(vec2 e) {
  vec3 n = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * signNotZero(n.xy);
  return normalize(n);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

// Interleaved gradient noise, animated per frame (golden-ratio offset) for TAA.
float ign(vec2 pixel) {
  return fract(52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));
}
float ignT(vec2 pixel, int frame) {
  return fract(ign(pixel) + float(frame % 64) * 0.61803398875);
}

float valueNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

// Camera-relative world position from a depth-buffer value and screen uv.
vec3 reconstructPosition(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 w = uInvViewProj * clip;
  return w.xyz / w.w;
}
vec3 viewDirection(vec2 uv) {
  vec4 clip = vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec4 w = uInvViewProj * clip;
  return normalize(w.xyz / w.w);
}
float linearizeDepth(float d) {
  float z = d * 2.0 - 1.0;
  float n = uCamera.x, f = uCamera.y;
  return 2.0 * n * f / (f + n - z * (f - n));
}

float henyeyGreenstein(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosT, 1e-4), 1.5));
}

// Biome tint colours (sRGB), t: cold..hot, h: dry..wet.
vec3 grassTint(float t, float h) {
  vec3 cold = vec3(0.50, 0.68, 0.55);
  vec3 temperate = vec3(0.49, 0.74, 0.31);
  vec3 hotDry = vec3(0.75, 0.71, 0.33);
  vec3 hotWet = vec3(0.33, 0.73, 0.15);
  vec3 hot = mix(hotDry, hotWet, h);
  vec3 c = t < 0.5 ? mix(cold, temperate, t * 2.0) : mix(temperate, hot, t * 2.0 - 1.0);
  return mix(c, c * vec3(0.9, 1.0, 0.85), h * 0.4);
}
vec3 foliageTint(float t, float h) {
  vec3 c = grassTint(t, h);
  return c * vec3(0.82, 0.92, 0.8);
}
