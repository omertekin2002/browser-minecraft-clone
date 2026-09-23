precision highp float;
#include <frame>
#include <common>
#include <atmosphere>
in vec2 vUv;
out vec4 fragColor;
const float STEPS = 40.0;
void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float sunTheta = acos(clamp(sunCosTheta, -1.0, 1.0));
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(0.0, sunCosTheta, -sin(sunTheta)));
  if (rayIntersectSphere(pos, sunDir, groundRadiusMM) > 0.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float atmoDist = rayIntersectSphere(pos, sunDir, atmosphereRadiusMM);
  float t = 0.0;
  vec3 transmittance = vec3(1.0);
  for (float i = 0.0; i < STEPS; i += 1.0) {
    float newT = ((i + 0.3) / STEPS) * atmoDist;
    float dt = newT - t;
    t = newT;
    vec3 rs, ext; float ms;
    getScatteringValues(pos + t * sunDir, rs, ms, ext);
    transmittance *= exp(-dt * ext);
  }
  fragColor = vec4(transmittance, 1.0);
}
