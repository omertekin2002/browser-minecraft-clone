// Projects the sky (plus a lit ground hemisphere) onto 9 L2 spherical-harmonic coefficients.
precision highp float;
#include <frame>
#include <common>
#include <atmosphere>
uniform sampler2D uSkyView;
uniform float uSunIllum;
out vec4 fragColor;

float shBasis(int i, vec3 d) {
  if (i == 0) return 0.282095;
  if (i == 1) return 0.488603 * d.y;
  if (i == 2) return 0.488603 * d.z;
  if (i == 3) return 0.488603 * d.x;
  if (i == 4) return 1.092548 * d.x * d.y;
  if (i == 5) return 1.092548 * d.y * d.z;
  if (i == 6) return 0.315392 * (3.0 * d.z * d.z - 1.0);
  if (i == 7) return 1.092548 * d.x * d.z;
  return 0.546274 * (d.x * d.x - d.y * d.y);
}

void main() {
  int coef = int(gl_FragCoord.x);
  const int NT = 24, NP = 48;
  vec3 zenith = texture(uSkyView, skyViewUV(vec3(0.0, 1.0, 0.0))).rgb * uSunIllum;
  vec3 sunLight = (uSunIlluminance.rgb * max(uSunDir.y, 0.0) + uMoonIlluminance.rgb * max(uMoonDir.y, 0.0));
  vec3 groundRad = vec3(0.18, 0.2, 0.14) / PI * (sunLight + zenith * PI * 0.8);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < NT; i++) {
    float theta = (float(i) + 0.5) / float(NT) * PI;
    float st = sin(theta), ct = cos(theta);
    for (int j = 0; j < NP; j++) {
      float phi = (float(j) + 0.5) / float(NP) * TAU;
      vec3 d = vec3(st * cos(phi), ct, st * sin(phi));
      vec3 L = d.y > -0.02 ? texture(uSkyView, skyViewUV(d)).rgb * uSunIllum : groundRad;
      if (d.y > -0.02) {
        L = mix(L, vec3(luminance(L)) * vec3(0.78, 0.8, 0.86), uMisc.x * 0.85) * (1.0 - uMisc.x * 0.45);
        L += vec3(0.55, 0.6, 0.8) * uCameraAbs.w * 0.9;
      }
      sum += L * shBasis(coef, d) * st;
    }
  }
  sum *= (PI / float(NT)) * (TAU / float(NP));
  fragColor = vec4(sum, 1.0);
}
