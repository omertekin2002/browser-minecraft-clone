// Distant terrain into the G-buffer (same lighting pipeline as blocks).
precision highp float;
precision highp int;
#include <frame>
#include <common>

uniform vec3 uMatColors[10];
#include <chunkmask>
uniform vec4 uInner; // xy: inner-level centre (camera-relative), z: half size, w: 1 for the outer level

in vec3 vPos;
in vec3 vWorld;
in vec3 vNormal;
flat in float vMat;
flat in vec2 vTint;

layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oMaterial;

void main() {
  if (chunkMeshed(vPos)) discard;
  if (uInner.w > 0.5 && max(abs(vPos.x - uInner.x), abs(vPos.z - uInner.y)) < uInner.z) discard;
  vec3 N = normalize(vNormal);
  int m = int(vMat + 0.5);
  vec3 col = uMatColors[m];
  if (m == 0) col *= srgbToLinear(grassTint(vTint.x, vTint.y));
  else if (m == 5) col *= srgbToLinear(foliageTint(vTint.x, vTint.y));
  else if (m == 6) col *= srgbToLinear(vec3(0.38, 0.58, 0.38));
  else if (m == 7) col *= srgbToLinear(vec3(0.50, 0.65, 0.33));
  float steep = smoothstep(0.78, 0.5, N.y);
  if (m == 0 || m == 3 || m == 8 || m == 1) col = mix(col, uMatColors[2], steep);
  float nv = valueNoise2(vWorld.xz * 0.045) * 0.6 + valueNoise2(vWorld.xz * 0.19) * 0.4;
  col *= 0.78 + 0.44 * nv;
  bool canopy = m >= 5 && m <= 7;
  if (canopy) col *= 0.7 + 0.6 * valueNoise2(vWorld.xz * 0.32);
  float sss = canopy ? 12.0 : 0.0;
  oAlbedo = vec4(col, (6.0 + 8.0 * sss) / 255.0);
  oNormal = vec4(octEncode(N), 1.0, 0.0);
  oMaterial = vec4(m == 3 ? 0.3 : 0.08, 0.04, canopy ? 0.8 : 1.0, 0.0);
}
