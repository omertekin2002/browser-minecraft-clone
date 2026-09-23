// Distant terrain: an attribute-less grid (one clipmap level per draw) displaced by the far height map.
precision highp float;
precision highp int;
precision highp sampler2D;
#include <frame>
#include <common>

uniform highp sampler2D uFarMap;
uniform ivec2 uOriginTexel; // world texel of grid vertex (0,0)
uniform int uTexStep;       // texels between vertices
uniform int uGridN;         // quads per side
uniform vec2 uOriginRel;    // camera-relative xz of vertex (0,0)
uniform float uCameraY;
uniform vec2 uCameraWrap;   // camera xz wrapped to [0,4096)

out vec3 vPos;
out vec3 vWorld;
out vec3 vNormal;
flat out float vMat;
flat out vec2 vTint;

const int CORNER[6] = int[6](0, 1, 2, 0, 2, 3);

vec4 fetchT(ivec2 t) { return texelFetch(uFarMap, t & 511, 0); }

void main() {
  int quad = gl_VertexID / 6;
  int corner = CORNER[gl_VertexID % 6];
  ivec2 q = ivec2(quad % uGridN, quad / uGridN);
  ivec2 base = uOriginTexel + q * uTexStep;
  float h00 = fetchT(base).r, h10 = fetchT(base + ivec2(uTexStep, 0)).r;
  float h01 = fetchT(base + ivec2(0, uTexStep)).r, h11 = fetchT(base + ivec2(uTexStep)).r;
  if (min(min(h00, h10), min(h01, h11)) < -1000.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  ivec2 cv = ivec2(corner == 1 || corner == 2 ? 1 : 0, corner >= 2 ? 1 : 0);
  ivec2 t = base + cv * uTexStep;
  vec4 s = fetchT(t);
  float hl = fetchT(t - ivec2(uTexStep, 0)).r, hr = fetchT(t + ivec2(uTexStep, 0)).r;
  float hd = fetchT(t - ivec2(0, uTexStep)).r, hu = fetchT(t + ivec2(0, uTexStep)).r;
  if (hl < -1000.0) hl = s.r;
  if (hr < -1000.0) hr = s.r;
  if (hd < -1000.0) hd = s.r;
  if (hu < -1000.0) hu = s.r;
  float span = float(uTexStep) * 8.0;
  vNormal = normalize(vec3(hl - hr, 2.0 * span, hd - hu));
  vec2 rel = uOriginRel + vec2(q + cv) * span;
  vec3 pos = vec3(rel.x, s.r - uCameraY, rel.y);
  vPos = pos;
  vWorld = vec3(uCameraWrap.x + rel.x, s.r, uCameraWrap.y + rel.y);
  vMat = s.g;
  vTint = s.ba;
  gl_Position = uViewProj * vec4(pos, 1.0);
}
