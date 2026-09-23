precision highp float;
#include <frame>
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec2 uViewport;
uniform float uThickness;
const ivec2 EDGES[12] = ivec2[12](ivec2(0,1), ivec2(2,3), ivec2(4,5), ivec2(6,7), ivec2(0,2), ivec2(1,3), ivec2(4,6), ivec2(5,7), ivec2(0,4), ivec2(1,5), ivec2(2,6), ivec2(3,7));
vec3 corner(int i) { return mix(uBoxMin, uBoxMax, vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1))); }
void main() {
  int edge = gl_VertexID / 6;
  int k = gl_VertexID % 6;
  int vi = k == 0 ? 0 : k == 1 ? 1 : k == 2 ? 2 : k == 3 ? 0 : k == 4 ? 2 : 3;
  vec4 ca = uViewProjUnjittered * vec4(corner(EDGES[edge].x), 1.0);
  vec4 cb = uViewProjUnjittered * vec4(corner(EDGES[edge].y), 1.0);
  float nearW = 0.05;
  if (ca.w < nearW) ca = mix(ca, cb, (nearW - ca.w) / (cb.w - ca.w));
  if (cb.w < nearW) cb = mix(cb, ca, (nearW - cb.w) / (ca.w - cb.w));
  vec2 sa = ca.xy / ca.w, sb = cb.xy / cb.w;
  vec2 dpx = (sb - sa) * uViewport;
  vec2 dir = length(dpx) > 1e-4 ? normalize(dpx) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  bool useB = vi == 1 || vi == 2;
  float side = (vi == 0 || vi == 1) ? -1.0 : 1.0;
  vec4 c = useB ? cb : ca;
  vec2 offPx = nrm * side * uThickness * 0.5 + dir * (useB ? 1.0 : -1.0) * uThickness * 0.5;
  c.xy += offPx / uViewport * 2.0 * c.w;
  gl_Position = c;
}
