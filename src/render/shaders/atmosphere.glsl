// Physically based atmosphere (after Hillaire 2020 / Helmer's reference). Distances in megameters.
const float groundRadiusMM = 6.360;
const float atmosphereRadiusMM = 6.460;
const vec3 rayleighScatteringBase = vec3(5.802, 13.558, 33.1);
const float mieScatteringBase = 2.6;
const float mieAbsorptionBase = 2.9;
const vec3 ozoneAbsorptionBase = vec3(0.650, 1.881, 0.085);
const vec3 atmoGroundAlbedo = vec3(0.3);
const vec2 TLUT_RES = vec2(256.0, 64.0);
const vec2 MSLUT_RES = vec2(32.0, 32.0);

float getMiePhase(float cosTheta) {
  const float g = 0.8;
  const float scale = 3.0 / (8.0 * PI);
  float num = (1.0 - g * g) * (1.0 + cosTheta * cosTheta);
  float denom = (2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 1e-5), 1.5);
  return scale * num / denom;
}

float getRayleighPhase(float cosTheta) {
  const float k = 3.0 / (16.0 * PI);
  return k * (1.0 + cosTheta * cosTheta);
}

void getScatteringValues(vec3 pos, out vec3 rayleighScattering, out float mieScattering, out vec3 extinction) {
  float altitudeKM = (length(pos) - groundRadiusMM) * 1000.0;
  float rayleighDensity = exp(-altitudeKM / 8.0);
  float mieDensity = exp(-altitudeKM / 1.2);
  rayleighScattering = rayleighScatteringBase * rayleighDensity;
  mieScattering = mieScatteringBase * mieDensity;
  float mieAbsorption = mieAbsorptionBase * mieDensity;
  vec3 ozoneAbsorption = ozoneAbsorptionBase * max(0.0, 1.0 - abs(altitudeKM - 25.0) / 15.0);
  extinction = rayleighScattering + mieScattering + mieAbsorption + ozoneAbsorption;
}

float rayIntersectSphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  if (c > 0.0 && b > 0.0) return -1.0;
  float discr = b * b - c;
  if (discr < 0.0) return -1.0;
  if (discr > b * b) return (-b + sqrt(discr));
  return -b - sqrt(discr);
}

vec3 sampleTransmittanceLUT(sampler2D lut, vec3 pos, vec3 sunDir) {
  float height = length(pos);
  vec3 up = pos / height;
  float cz = dot(sunDir, up);
  vec2 uv = vec2(clamp(0.5 + 0.5 * cz, 0.0, 1.0), clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
  uv = (uv * (TLUT_RES - 1.0) + 0.5) / TLUT_RES;
  return texture(lut, uv).rgb;
}

vec3 sampleMultiScatterLUT(sampler2D lut, vec3 pos, vec3 sunDir) {
  float height = length(pos);
  vec3 up = pos / height;
  float cz = dot(sunDir, up);
  vec2 uv = vec2(clamp(0.5 + 0.5 * cz, 0.0, 1.0), clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
  uv = (uv * (MSLUT_RES - 1.0) + 0.5) / MSLUT_RES;
  return texture(lut, uv).rgb;
}

// Camera position in atmosphere space (1 block = 1 m, sea level at y = 63).
vec3 atmoCameraPos() {
  return vec3(0.0, groundRadiusMM + 0.0002 + max(uCameraAbs.y - 63.0, 0.0) * 1e-6, 0.0);
}

float horizonElevation(float height) {
  return -acos(clamp(groundRadiusMM / height, -1.0, 1.0));
}

// Sky-view LUT parameterisation: u = absolute azimuth, v = non-linear elevation relative to the horizon.
vec2 skyViewUV(vec3 dir) {
  float height = length(atmoCameraPos());
  float e = asin(clamp(dir.y, -1.0, 1.0));
  float rel = e - horizonElevation(height);
  float v = 0.5 + 0.5 * sign(rel) * sqrt(min(abs(rel) / (0.5 * PI), 1.0));
  float az = atan(dir.x, -dir.z);
  return vec2(az / TAU + 0.5, v);
}

vec3 skyViewDir(vec2 uv) {
  float height = length(atmoCameraPos());
  float az = (uv.x - 0.5) * TAU;
  float s = uv.y < 0.5 ? -1.0 : 1.0;
  float c = uv.y < 0.5 ? 1.0 - 2.0 * uv.y : 2.0 * uv.y - 1.0;
  float rel = s * c * c * 0.5 * PI;
  float e = clamp(rel + horizonElevation(height), -0.5 * PI, 0.5 * PI);
  float ce = cos(e);
  return vec3(ce * sin(az), sin(e), -ce * cos(az));
}
