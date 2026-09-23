precision highp float;
#include <frame>
#include <common>
#include <atmosphere>
uniform sampler2D uTransmittanceLUT;
in vec2 vUv;
out vec4 fragColor;
const float MS_STEPS = 20.0;
const int SQRT_SAMPLES = 8;

vec3 sphericalDir(float theta, float phi) {
  return vec3(sin(phi) * sin(theta), cos(phi), sin(phi) * cos(theta));
}

void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = acos(clamp(sunCosTheta, -1.0, 1.0));
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));

  vec3 lumTotal = vec3(0.0), fms = vec3(0.0);
  float invSamples = 1.0 / float(SQRT_SAMPLES * SQRT_SAMPLES);
  for (int i = 0; i < SQRT_SAMPLES; i++) {
    for (int j = 0; j < SQRT_SAMPLES; j++) {
      float theta = PI * (float(i) + 0.5) / float(SQRT_SAMPLES);
      float phi = acos(clamp(1.0 - 2.0 * (float(j) + 0.5) / float(SQRT_SAMPLES), -1.0, 1.0));
      vec3 rayDir = sphericalDir(theta, phi);
      float atmoDist = rayIntersectSphere(pos, rayDir, atmosphereRadiusMM);
      float groundDist = rayIntersectSphere(pos, rayDir, groundRadiusMM);
      float tMax = groundDist > 0.0 ? groundDist : atmoDist;
      float cosTheta = dot(rayDir, sunDir);
      float miePhase = getMiePhase(cosTheta);
      float rayleighPhase = getRayleighPhase(-cosTheta);
      vec3 lum = vec3(0.0), lumFactor = vec3(0.0), transmittance = vec3(1.0);
      float t = 0.0;
      for (float s = 0.0; s < MS_STEPS; s += 1.0) {
        float newT = ((s + 0.3) / MS_STEPS) * tMax;
        float dt = newT - t;
        t = newT;
        vec3 p = pos + t * rayDir;
        vec3 rs, ext; float mss;
        getScatteringValues(p, rs, mss, ext);
        vec3 sampleT = exp(-dt * ext);
        vec3 scatteringNoPhase = rs + mss;
        lumFactor += transmittance * (scatteringNoPhase - scatteringNoPhase * sampleT) / ext;
        vec3 sunT = sampleTransmittanceLUT(uTransmittanceLUT, p, sunDir);
        vec3 inS = (rs * rayleighPhase + mss * miePhase) * sunT;
        lum += transmittance * (inS - inS * sampleT) / ext;
        transmittance *= sampleT;
      }
      if (groundDist > 0.0) {
        vec3 hitPos = pos + groundDist * rayDir;
        if (dot(pos, sunDir) > 0.0) {
          hitPos = normalize(hitPos) * groundRadiusMM;
          lum += transmittance * atmoGroundAlbedo * sampleTransmittanceLUT(uTransmittanceLUT, hitPos, sunDir);
        }
      }
      fms += lumFactor * invSamples;
      lumTotal += lum * invSamples;
    }
  }
  vec3 psi = lumTotal / (1.0 - fms);
  fragColor = vec4(psi, 1.0);
}
