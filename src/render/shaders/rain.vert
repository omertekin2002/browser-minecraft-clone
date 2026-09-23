// Instanced rain streaks: each instance is a thin quad stretched along the fall direction.
precision highp float;
#include <frame>
layout(location = 0) in vec4 aDrop; // xyz: camera-relative position (streak bottom), w: alpha
uniform vec3 uFall;                  // fall velocity direction * streak length
uniform float uWidth;
out float vAlpha;
out float vV;
void main() {
  int c = gl_VertexID;
  float v = (c == 1 || c == 2 || c == 4) ? 1.0 : 0.0;   // along the streak
  float u = (c == 2 || c == 4 || c == 5) ? 0.5 : -0.5;  // across
  vec3 p = aDrop.xyz + uFall * v;
  vec3 toCam = normalize(-p);
  vec3 side = normalize(cross(normalize(uFall), toCam));
  p += side * u * uWidth;
  vAlpha = aDrop.w;
  vV = v;
  gl_Position = uViewProjUnjittered * vec4(p, 1.0);
}
