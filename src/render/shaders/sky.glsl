// Sky radiance: atmosphere LUT + sun disk + moon (with phases) + stars + milky way.
uniform sampler2D uSkyView;
uniform sampler2D uTransmittanceLUT;
uniform float uSunIllum;
uniform mat3 uStarRot;

const float SUN_RADIUS = 0.0095;
const float MOON_RADIUS = 0.022;

vec3 sampleSky(vec3 dir) {
  vec3 c = texture(uSkyView, skyViewUV(dir)).rgb * uSunIllum;
  // Rain: grey overcast and lightning flashes.
  float rain = uMisc.x;
  c = mix(c, vec3(luminance(c)) * vec3(0.78, 0.8, 0.86), rain * 0.85) * (1.0 - rain * 0.45);
  return c + vec3(0.55, 0.6, 0.8) * uCameraAbs.w * 0.9;
}

// Sky colour used for fog / haze: clamps the direction just above the horizon.
vec3 sampleSkyHorizon(vec3 dir) {
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));
  return sampleSky(d);
}

vec3 sunTransmittance(vec3 dir) {
  return sampleTransmittanceLUT(uTransmittanceLUT, atmoCameraPos(), dir);
}

vec3 moonDisk(vec3 dir, out float coverage) {
  coverage = 0.0;
  vec3 md = uMoonDir.xyz;
  float c = dot(dir, md);
  if (c < cos(MOON_RADIUS * 1.2)) return vec3(0.0);
  vec3 right = normalize(cross(md, vec3(0.0, 1.0, 0.0) + vec3(1e-4, 0.0, 0.0)));
  vec3 up = cross(right, md);
  vec2 l = vec2(dot(dir, right), dot(dir, up)) / tan(MOON_RADIUS);
  float r2 = dot(l, l);
  coverage = smoothstep(1.0, 0.96, sqrt(r2));
  if (r2 >= 1.0) return vec3(0.0);
  vec3 n = vec3(l, sqrt(1.0 - r2));
  float phase = uMoonDir.w * TAU;
  vec3 L = normalize(vec3(sin(phase), 0.15, cos(phase)));
  // procedural surface: maria + craters
  vec2 q = l * 3.0 + 7.0;
  float maria = smoothstep(0.35, 0.7, valueNoise2(q * 1.3) * 0.6 + valueNoise2(q * 3.1) * 0.4);
  float crater = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 g = l * (4.0 + float(i) * 5.0);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5 - (hash22(id) - 0.5) * 0.5;
    float cr = length(f);
    float h = hash12(id + float(i) * 13.0);
    if (h > 0.55) crater += smoothstep(0.25, 0.18, cr) * (1.0 - smoothstep(0.18, 0.1, cr)) * 0.5;
  }
  float albedo = mix(0.75, 0.42, maria) + crater * 0.25;
  float lit = max(dot(n, L), 0.0);
  float earthshine = 0.012;
  vec3 col = vec3(albedo) * (lit + earthshine) * vec3(1.0, 0.97, 0.92);
  return col * coverage;
}

vec3 starField(vec3 dir, float skyLum) {
  float vis = saturate(1.0 - skyLum * 350.0);
  if (vis <= 0.0 || dir.y < -0.05) return vec3(0.0);
  vec3 d = uStarRot * dir;
  vec3 result = vec3(0.0);
  float pixelAngle = 2.0 * uCamera.z * uResolution.w;
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 90.0 : 190.0;
    vec3 p = d * scale;
    vec3 cell = floor(p);
    vec3 h = hash33(cell + float(layer) * 71.0);
    if (h.x < (layer == 0 ? 0.08 : 0.12)) {
      vec3 center = cell + 0.2 + 0.6 * hash33(cell + 19.0);
      float dist = length(p - center);
      float size = max(0.06, pixelAngle * scale * 0.9);
      float bright = pow(h.y, layer == 0 ? 6.0 : 10.0) * (layer == 0 ? 60.0 : 25.0) + 0.3;
      float twinkle = 0.75 + 0.25 * sin(uTime * (2.0 + h.z * 5.0) + h.y * 90.0);
      vec3 tint = mix(vec3(0.65, 0.78, 1.0), vec3(1.0, 0.82, 0.62), h.z);
      result += tint * bright * twinkle * exp(-sq(dist / size) * 2.5) * 0.02;
    }
  }
  // Milky way band
  float band = exp(-sq(d.y * 3.2));
  float mw = valueNoise2(d.xz * 9.0 + d.y * 4.0) * 0.6 + valueNoise2(d.xz * 23.0) * 0.4;
  result += vec3(0.55, 0.62, 0.85) * band * smoothstep(0.35, 0.9, mw) * 0.0035;
  return result * vis * smoothstep(-0.05, 0.1, dir.y);
}

// Full sky radiance for a direction.
vec3 skyRadiance(vec3 dir, bool withSunDisk) {
  // Below the horizon the world is fogged out to the horizon colour (matches the render-distance fade).
  vec3 col = dir.y < 0.015 ? sampleSkyHorizon(dir) * mix(1.0, 0.82, saturate(-dir.y * 3.0)) : sampleSky(dir);
  float skyLum = luminance(col) / max(uSunIllum, 1e-3);
  if (dir.y > -0.1) {
    float moonCov;
    vec3 moon = moonDisk(dir, moonCov);
    vec3 moonT = sunTransmittance(uMoonDir.xyz);
    col = col + moon * moonT * uSunIllum * 0.9;
    col += starField(dir, skyLum) * (1.0 - moonCov) * uSunIllum;
    if (withSunDisk) {
      float cs = dot(dir, uSunDir.xyz);
      float edge = cos(SUN_RADIUS);
      if (cs > edge - 0.0002) {
        float r = acos(clamp(cs, -1.0, 1.0)) / SUN_RADIUS;
        float limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - r * r, 0.0)));
        float disk = smoothstep(1.02, 0.98, r);
        col += sunTransmittance(uSunDir.xyz) * uSunIllum * 90.0 * limb * disk;
      }
    }
  }
  return col;
}
