precision highp float;
precision highp int;
precision highp sampler2DArray;

#include <frame>
#include <common>

uniform sampler2DArray uAlbedoTex;
uniform sampler2DArray uNormalTex;
uniform sampler2DArray uSpecularTex;
uniform ivec3 uBreakBlock;   // block position relative to floor(camera)
uniform vec3 uCameraFract;   // camera - floor(camera)
uniform int uBreakStage;     // -1 = none
uniform int uDestroyBase;
uniform float uPomDepth;   // 0 disables parallax occlusion mapping
#if defined(ENTITY)
uniform float uFlash;      // blend toward white (primed TNT)
#endif

in vec2 vUV;
flat in int vLayer;
flat in vec3 vNormal;
flat in vec3 vTangent;
flat in vec3 vBitangent;
in vec2 vQuadUV;
flat in vec4 vSky;
flat in vec4 vBlock;
flat in vec4 vAO;
flat in vec3 vTint;
flat in uint vFlags;
in vec3 vPos;
in vec3 vWorld;

layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oMaterial;

float bilerp(vec4 c, vec2 uv) { return mix(mix(c.x, c.y, uv.x), mix(c.w, c.z, uv.x), uv.y); }

// Parallax occlusion mapping on the texture height maps (normal texture alpha = height).
vec2 parallaxUV(vec2 uv, float layer, float dist) {
  float fade = 1.0 - smoothstep(10.0, 18.0, dist);
  if (uPomDepth <= 0.0 || fade <= 0.0) return uv;
  vec3 V = normalize(-vPos);
  vec3 vt = vec3(dot(V, vTangent), dot(V, vBitangent), dot(V, vNormal));
  if (vt.z <= 0.05) return uv;
  const float STEPS = 20.0;
  float layerDepth = 1.0 / STEPS;
  vec2 delta = vt.xy / vt.z * uPomDepth * fade / STEPS;
  vec2 cur = uv;
  float d = 0.0;
  float h = 1.0 - textureLod(uNormalTex, vec3(cur, layer), 0.0).a;
  for (int i = 0; i < 20; i++) {
    if (d >= h) break;
    cur -= delta;
    d += layerDepth;
    h = 1.0 - textureLod(uNormalTex, vec3(cur, layer), 0.0).a;
  }
  return cur;
}

void main() {
#if defined(ENTITY)
  vec3 tc = vec3(vUV, float(vLayer));
#else
  // Plants and waving leaves keep their flat texture.
  bool pom = (vFlags & 67u) == 0u;
  vec3 tc = vec3(pom ? parallaxUV(vUV, float(vLayer), length(vPos)) : vUV, float(vLayer));
#endif
  vec4 albedo = texture(uAlbedoTex, tc);
#if defined(CUTOUT)
  if (albedo.a < 0.5) discard;
  float tintMask = 1.0;
#elif defined(ENTITY)
  bool cutoutTex = (vFlags & 128u) != 0u;
  if (cutoutTex && albedo.a < 0.5) discard;
  float tintMask = cutoutTex ? 1.0 : albedo.a;
#else
  float tintMask = albedo.a;
#endif
  albedo.rgb *= mix(vec3(1.0), vTint, tintMask);
#if defined(ENTITY)
  albedo.rgb = mix(albedo.rgb, vec3(1.0), uFlash);
#endif

  vec3 nts = texture(uNormalTex, tc).xyz * 2.0 - 1.0;
  vec3 N = normalize(vTangent * nts.x + vBitangent * nts.y + vNormal * nts.z);
  int faceIdx;
  vec3 an = abs(vNormal);
  if ((vFlags & 64u) != 0u) { N = normalize(vec3(nts.x * 0.3, 1.0, nts.y * 0.3)); faceIdx = 6; }
  else if (an.x > 0.9) faceIdx = vNormal.x > 0.0 ? 0 : 1;
  else if (an.y > 0.9) faceIdx = vNormal.y > 0.0 ? 2 : 3;
  else if (an.z > 0.9) faceIdx = vNormal.z > 0.0 ? 4 : 5;
  else faceIdx = 6;

  vec4 spec = texture(uSpecularTex, tc);
  float sky = bilerp(vSky, vQuadUV);
  float blk = bilerp(vBlock, vQuadUV);
  float ao = bilerp(vAO, vQuadUV);

  if (uBreakStage >= 0) {
    vec3 bp = floor(vPos + uCameraFract - vNormal * 0.02);
    if (ivec3(bp) == uBreakBlock) {
      float crack = texture(uAlbedoTex, vec3(vUV, float(uDestroyBase + uBreakStage))).a;
      albedo.rgb *= mix(1.0, 0.2, crack);
    }
  }

  float sss = spec.b;
  oAlbedo = vec4(albedo.rgb, (float(faceIdx) + 8.0 * floor(sss * 31.0 + 0.5)) / 255.0);
  oNormal = vec4(octEncode(N), sky, blk);
  oMaterial = vec4(spec.r, spec.g, ao, spec.a);
}
