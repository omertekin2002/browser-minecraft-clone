// Bakes cloud transmittance along the light direction into a 2D map (entry point at the cloud base).
precision highp float;
precision highp sampler3D;
#include <frame>
#include <common>
#include <clouds_common>
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 entry = uCloudShadowParams.xy + (vUv - 0.5) * uCloudShadowParams.z;
  vec3 p = vec3(entry.x, CLOUD_BOTTOM - 0.5, entry.y);
  fragColor = vec4(cloudShadowMarch(p, uLightDir.xyz), 0.0, 0.0, 1.0);
}
