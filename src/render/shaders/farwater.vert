// Ocean plane beyond the chunk render distance, shaded by water.frag.
precision highp float;
precision highp int;
#include <frame>
#include <common>

uniform int uGridN;
uniform float uStep;
uniform vec2 uOriginRel;
uniform vec2 uCameraWrap;
uniform float uCameraY;
uniform int uWaterLayerV;

out vec2 vUV;
flat out int vLayer;
flat out vec3 vNormal;
flat out vec3 vTangent;
flat out vec3 vBitangent;
out vec2 vQuadUV;
flat out vec4 vSky;
flat out vec4 vBlock;
flat out vec4 vAO;
flat out vec3 vTint;
flat out uint vFlags;
out vec3 vPos;
out vec3 vWorld;

// Counter-clockwise when seen from above so the surface is front-facing for water.frag.
const int CORNER[6] = int[6](0, 3, 2, 0, 2, 1);

void main() {
  int quad = gl_VertexID / 6;
  int corner = CORNER[gl_VertexID % 6];
  ivec2 q = ivec2(quad % uGridN, quad / uGridN);
  vec2 cv = vec2(corner == 1 || corner == 2 ? 1.0 : 0.0, corner >= 2 ? 1.0 : 0.0);
  vec2 rel = uOriginRel + (vec2(q) + cv) * uStep;
  const float SEA = 62.875;
  vPos = vec3(rel.x, SEA - uCameraY, rel.y);
  vWorld = vec3(uCameraWrap.x + rel.x, SEA, uCameraWrap.y + rel.y);
  vUV = vWorld.xz;
  vLayer = uWaterLayerV;
  vNormal = vec3(0.0, 1.0, 0.0);
  vTangent = vec3(1.0, 0.0, 0.0);
  vBitangent = vec3(0.0, 0.0, 1.0);
  vQuadUV = vec2(0.0);
  vSky = vec4(1.0);
  vBlock = vec4(0.0);
  vAO = vec4(1.0);
  vTint = vec3(1.0);
  vFlags = 0u;
  gl_Position = uViewProj * vec4(vPos, 1.0);
}
