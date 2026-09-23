// Volumetric cloud density field shared by the cloud, lighting and fog passes.
uniform highp sampler3D uCloudShape;
uniform highp sampler3D uCloudDetail;
uniform highp sampler2D uWeather;

const float CLOUD_BOTTOM = 230.0;
const float CLOUD_TOP = 410.0;
const float CLOUD_SIGMA = 0.055;

float remap(float v, float l0, float h0, float l1, float h1) {
  return l1 + (v - l0) * (h1 - l1) / (h0 - l0);
}

vec2 cloudWind() {
  return uWind.xy * uMisc.y * 7.0;
}

float cloudCoverageAt(vec2 xz) {
  vec2 w = xz + cloudWind();
  vec4 wm = texture(uWeather, w / 16000.0);
  // Weather map values are ~N(0.5, 0.13): produce fields of clear sky and cloud around the global coverage.
  return saturate(uWind.w + (wm.r - 0.5) * 2.2 + (wm.g - 0.5) * 0.35);
}

// p: absolute world position. lod 0 = full detail, 1 = no detail erosion.
float cloudDensity(vec3 p, int lod) {
  float h = (p.y - CLOUD_BOTTOM) / (CLOUD_TOP - CLOUD_BOTTOM);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  float coverage = cloudCoverageAt(p.xz);
  if (coverage <= 0.02) return 0.0;
  vec2 wind = cloudWind();
  vec3 q = p + vec3(wind.x, 0.0, wind.y) + vec3(h * 80.0, 0.0, h * 30.0);
  vec4 lf = texture(uCloudShape, q / 1400.0);
  // Normalised Perlin-Worley (raw range ~0.5..0.9) and Worley fBm (mean ~0.46).
  float pw = saturate((lf.r - 0.52) / 0.36);
  float wf = lf.g * 0.625 + lf.b * 0.25 + lf.a * 0.125;
  float F = saturate(pw * 0.85 + (wf - 0.46) * 0.9 + 0.08);
  // Cumulus profile: flat bases; denser cells tower higher.
  float top = 0.4 + 0.6 * saturate(F * 1.3 - 0.2);
  float profile = smoothstep(0.0, 0.07, h) * smoothstep(top, top * 0.5, h);
  float base = remap(F * profile, 1.0 - coverage, 1.0, 0.0, 1.0);
  if (base <= 0.0) return 0.0;
  if (lod == 0) {
    vec3 hf = texture(uCloudDetail, q / 300.0 + vec3(0.0, uMisc.y * 0.003, 0.0)).rgb;
    float hfbm = hf.r * 0.625 + hf.g * 0.25 + hf.b * 0.125;
    // Wispy at the base, billowy towards the top.
    float erosion = mix(1.0 - hfbm, hfbm, saturate(h * 4.0));
    base = remap(base, erosion * 0.3, 1.0, 0.0, 1.0);
  }
  return saturate(base * (1.6 + uMisc.x * 1.2));
}

uniform highp sampler2D uCloudShadowMap;

// Fraction of direct light reaching a point through the cloud layer (looked up in the cloud shadow map).
float cloudShadow(vec3 pAbs, vec3 L) {
  if (uCloudShadowParams.w < 0.5 || pAbs.y > CLOUD_TOP) return 1.0;
  float ly = max(L.y, 0.12);
  vec2 entry = pAbs.xz + L.xz / ly * (CLOUD_BOTTOM - pAbs.y);
  vec2 uv = (entry - uCloudShadowParams.xy) / uCloudShadowParams.z + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
  return texture(uCloudShadowMap, uv).r;
}

// Direct evaluation along the light ray (used to build the cloud shadow map).
float cloudShadowMarch(vec3 pAbs, vec3 L) {
  float ly = max(L.y, 0.12);
  vec3 Ld = normalize(vec3(L.x, ly, L.z));
  float t0 = max((CLOUD_BOTTOM - pAbs.y) / Ld.y, 0.0);
  float t1 = (CLOUD_TOP - pAbs.y) / Ld.y;
  float od = 0.0;
  float dt = (t1 - t0) / 8.0;
  for (int i = 0; i < 8; i++) {
    od += cloudDensity(pAbs + Ld * (t0 + (float(i) + 0.5) * dt), 1) * dt;
  }
  return mix(0.06, 1.0, exp(-od * CLOUD_SIGMA * 0.65));
}
