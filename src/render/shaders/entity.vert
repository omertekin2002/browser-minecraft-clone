// Custom geometry (held block, break particles) written to the G-buffer with the same outputs as
// chunk.vert so gbuffer.frag can shade it.
precision highp float;
precision highp int;
#include <frame>
#include <common>

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aTangent;  // xyz tangent, w bitangent sign
layout(location = 3) in vec2 aUV;
layout(location = 4) in float aLayer;
layout(location = 5) in vec2 aLight;   // sky, block (0..1)
layout(location = 6) in vec3 aTint;    // linear tint (1 = none)

uniform mat4 uModel;      // view-space model matrix (held item) or identity (world particles)
uniform int uViewSpace;   // 1: aPos is in view space (held item), 0: camera-relative world

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

void main() {
  vec3 N, T, P;
  if (uViewSpace == 1) {
    vec4 vp = uModel * vec4(aPos, 1.0);
    // View-space → camera-relative world (rotation only) for lighting.
    P = mat3(uInvView) * vp.xyz;
    N = normalize(mat3(uInvView) * mat3(uModel) * aNormal);
    T = normalize(mat3(uInvView) * mat3(uModel) * aTangent.xyz);
    gl_Position = uProj * vp;
  } else {
    P = aPos;
    N = aNormal;
    T = aTangent.xyz;
    gl_Position = uViewProj * vec4(P, 1.0);
  }
  vUV = aUV;
  int L = int(aLayer + 0.5);
  vLayer = L & 1023;
  vNormal = N;
  vTangent = T;
  vBitangent = normalize(cross(N, T)) * aTangent.w;
  vQuadUV = vec2(0.0);
  vSky = vec4(aLight.x);
  vBlock = vec4(aLight.y);
  vAO = vec4(1.0);
  vTint = aTint;
  vFlags = L >= 1024 ? 128u : 0u;
  vPos = P;
  vWorld = P + uCameraPos.xyz;
}
