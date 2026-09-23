// Sky-view LUT: in-scattered radiance for unit sun illuminance, with the moon folded in.
precision highp float;
#include <frame>
#include <common>
#include <atmosphere>
uniform sampler2D uTransmittanceLUT;
uniform sampler2D uMultiScatterLUT;
uniform float uMoonScale;
in vec2 vUv;
out vec4 fragColor;
const float STEPS = 30.0;

void main() {
  vec3 viewPos = atmoCameraPos();
  vec3 rayDir = skyViewDir(vUv);
  float atmoDist = rayIntersectSphere(viewPos, rayDir, atmosphereRadiusMM);
  float groundDist = rayIntersectSphere(viewPos, rayDir, groundRadiusMM);
  float tMax = groundDist < 0.0 ? atmoDist : groundDist;

  vec3 sunDir = uSunDir.xyz, moonDir = uMoonDir.xyz;
  float cS = dot(rayDir, sunDir), cM = dot(rayDir, moonDir);
  float mieS = getMiePhase(cS), rayS = getRayleighPhase(-cS);
  float mieM = getMiePhase(cM), rayM = getRayleighPhase(-cM);
  bool moonOn = uMoonScale > 0.0 && moonDir.y > -0.2;

  vec3 lum = vec3(0.0), transmittance = vec3(1.0);
  float t = 0.0;
  for (float i = 0.0; i < STEPS; i += 1.0) {
    float newT = ((i + 0.3) / STEPS) * tMax;
    float dt = newT - t;
    t = newT;
    vec3 p = viewPos + t * rayDir;
    vec3 rs, ext; float ms;
    getScatteringValues(p, rs, ms, ext);
    vec3 sampleT = exp(-dt * ext);
    vec3 sunT = sampleTransmittanceLUT(uTransmittanceLUT, p, sunDir);
    vec3 psiS = sampleMultiScatterLUT(uMultiScatterLUT, p, sunDir);
    vec3 inS = rs * (rayS * sunT + psiS) + ms * (mieS * sunT + psiS);
    if (moonOn) {
      vec3 moonT = sampleTransmittanceLUT(uTransmittanceLUT, p, moonDir);
      vec3 psiM = sampleMultiScatterLUT(uMultiScatterLUT, p, moonDir);
      inS += (rs * (rayM * moonT + psiM) + ms * (mieM * moonT + psiM)) * uMoonScale;
    }
    lum += transmittance * (inS - inS * sampleT) / ext;
    transmittance *= sampleT;
  }
  fragColor = vec4(lum, 1.0);
}
