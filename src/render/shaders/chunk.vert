// Attribute-less chunk rendering: every quad is one RGBA32UI texel of the shared quad heap,
// 6 vertices per quad. All chunks of a pass are drawn with one multi-draw; gl_DrawID picks the chunk.
#ifdef MULTI_DRAW
#extension GL_ANGLE_multi_draw : require
#endif
precision highp float;
precision highp int;
precision highp usampler2D;

#include <frame>
#include <common>

uniform usampler2D uQuads;
uniform vec4 uChunkData[256]; // xy: chunk origin - camera (xz), zw: chunk origin wrapped to [0, 4096)
uniform float uChunkY;        // -camera y
#ifdef MULTI_DRAW
#define DRAW_ID gl_DrawID
#else
uniform int uDrawID;
#define DRAW_ID uDrawID
#endif
#ifdef SHADOW
uniform mat4 uShadowViewProj;
#endif

out vec2 vUV;
flat out int vLayer;
#ifndef SHADOW
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
#endif

const vec3 FACE_U[8] = vec3[8](vec3(0,0,-1), vec3(0,0,1), vec3(1,0,0), vec3(1,0,0), vec3(1,0,0), vec3(-1,0,0), vec3(1,0,1), vec3(-1,0,1));
const vec3 FACE_V[8] = vec3[8](vec3(0,1,0), vec3(0,1,0), vec3(0,0,-1), vec3(0,0,1), vec3(0,1,0), vec3(0,1,0), vec3(0,1,0), vec3(0,1,0));
const int CORNER[6] = int[6](0, 1, 2, 0, 2, 3);

void main() {
  int quad = gl_VertexID / 6;
  int corner = CORNER[gl_VertexID % 6];
  uvec4 q = texelFetch(uQuads, ivec2(quad & 4095, quad >> 12), 0);
  vec4 cd = uChunkData[DRAW_ID];
  vec3 chunkOffset = vec3(cd.x, uChunkY, cd.y);
  vec3 chunkWorld = vec3(cd.z, 0.0, cd.w);

  vec3 origin = vec3(float(q.x & 511u) - 32.0, float(q.x >> 18u), float((q.x >> 9u) & 511u) - 32.0) * 0.0625;
  int face = int(q.y & 7u);
  float su = float(((q.y >> 3u) & 255u) + 1u) * 0.0625;
  float sv = float(((q.y >> 11u) & 255u) + 1u) * 0.0625;
  int layer = int(q.y >> 19u);
  uint flags = (q.w >> 16u) & 255u;

  vec2 cuv = vec2(corner == 1 || corner == 2 ? 1.0 : 0.0, corner >= 2 ? 1.0 : 0.0);
  vec3 U = FACE_U[face];
  vec3 V = FACE_V[face];
  bool flip = (flags & 32u) != 0u;
  if (flip) { origin += U * su; U = -U; }
  vec3 local = origin + U * (cuv.x * su) + V * (cuv.y * sv);

  // Texture coordinates come from the position so they tile across merged quads.
  vec2 uv;
  if (face == 0) uv = vec2(-local.z, -local.y);
  else if (face == 1) uv = vec2(local.z, -local.y);
  else if (face == 2 || face == 3) uv = vec2(local.x, local.z);
  else if (face == 4) uv = vec2(local.x, -local.y);
  else if (face == 5) uv = vec2(-local.x, -local.y);
  else uv = vec2(flip ? 1.0 - cuv.x : cuv.x, -local.y);

  vec3 world = chunkWorld + local;

  // Wind
  uint wave = flags & 3u;
  float windStrength = uWind.z;
  if (wave == 1u) {
    float t = uTime;
    vec3 w = world;
    local += vec3(sin(t * 1.7 + w.x * 0.6 + w.y * 0.35),
                  sin(t * 2.1 + w.z * 0.55 + w.x * 0.25) * 0.5,
                  cos(t * 1.45 + w.z * 0.7 + w.y * 0.4)) * 0.03 * windStrength;
  } else if (wave == 2u && cuv.y > 0.5) {
    float t = uTime;
    float gust = sin(t * 0.7 + dot(world.xz, vec2(0.11, 0.07))) * 0.5 + 0.5;
    float sway = sin(t * 2.3 + world.x * 0.45 + world.z * 0.35);
    local.xz += uWind.xy * (0.05 + 0.14 * gust) * windStrength * (0.6 + 0.4 * sway);
    local.xz += vec2(sin(t * 3.3 + world.z * 1.3), cos(t * 2.9 + world.x * 1.1)) * 0.025 * windStrength;
  }

  vec3 rel = local + chunkOffset;
  vUV = uv;
  vLayer = layer;

#ifdef SHADOW
  gl_Position = uShadowViewProj * vec4(rel, 1.0);
  // Pancaking: casters in front of the near plane still occlude.
  gl_Position.z = max(gl_Position.z, -gl_Position.w + 1e-4);
#else
  vPos = rel;
  vWorld = world;
  vec3 N, T, B;
  if (face == 0) { N = vec3(1,0,0); T = vec3(0,0,-1); B = vec3(0,-1,0); }
  else if (face == 1) { N = vec3(-1,0,0); T = vec3(0,0,1); B = vec3(0,-1,0); }
  else if (face == 2) { N = vec3(0,1,0); T = vec3(1,0,0); B = vec3(0,0,1); }
  else if (face == 3) { N = vec3(0,-1,0); T = vec3(1,0,0); B = vec3(0,0,1); }
  else if (face == 4) { N = vec3(0,0,1); T = vec3(1,0,0); B = vec3(0,-1,0); }
  else if (face == 5) { N = vec3(0,0,-1); T = vec3(-1,0,0); B = vec3(0,-1,0); }
  else { T = normalize(FACE_U[face]); B = vec3(0,-1,0); N = normalize(cross(U, V)); }
  vNormal = N; vTangent = T; vBitangent = B;
  vQuadUV = cuv;
  vSky = vec4(float(q.z & 15u), float((q.z >> 4u) & 15u), float((q.z >> 8u) & 15u), float((q.z >> 12u) & 15u)) / 15.0;
  vBlock = vec4(float((q.z >> 16u) & 15u), float((q.z >> 20u) & 15u), float((q.z >> 24u) & 15u), float((q.z >> 28u) & 15u)) / 15.0;
  vAO = vec4(float(q.w & 3u), float((q.w >> 2u) & 3u), float((q.w >> 4u) & 3u), float((q.w >> 6u) & 3u)) / 3.0;
  uint tintType = (flags >> 2u) & 7u;
  float tT = float((q.w >> 8u) & 255u) / 255.0;
  float tH = float(q.w >> 24u) / 255.0;
  vec3 tint = vec3(1.0);
  if (tintType == 1u) tint = grassTint(tT, tH);
  else if (tintType == 2u) tint = foliageTint(tT, tH);
  else if (tintType == 3u) tint = vec3(0.50, 0.65, 0.33);
  else if (tintType == 4u) tint = vec3(0.38, 0.58, 0.38);
  vTint = srgbToLinear(tint);
  vFlags = flags;
  gl_Position = uViewProj * vec4(rel, 1.0);
#endif
}
