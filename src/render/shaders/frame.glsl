// Per-frame uniforms shared by every program (std140, binding 0). Mirrored in FrameUniforms.ts.
layout(std140) uniform FrameUniforms {
  mat4 uView;              // rotation-only view (camera-relative world)
  mat4 uProj;              // jittered projection
  mat4 uViewProj;          // jittered view-projection
  mat4 uInvViewProj;       // inverse jittered view-projection
  mat4 uInvProj;
  mat4 uPrevViewProj;      // previous frame's unjittered view-projection
  mat4 uViewProjUnjittered;
  mat4 uInvView;
  mat4 uShadowMat[4];      // camera-relative world -> cascade atlas uv/depth
  vec4 uCameraPos;         // xyz: camera world pos wrapped to [0,4096), w: time (s)
  vec4 uCameraDelta;       // xyz: cam - prevCam, w: frame index
  vec4 uSunDir;            // xyz, w: sun elevation factor
  vec4 uMoonDir;           // xyz, w: moon phase 0..1
  vec4 uLightDir;          // xyz: shadow caster direction, w: 1 sun / 0 moon
  vec4 uSunIlluminance;    // rgb illuminance of the sun at the ground
  vec4 uMoonIlluminance;   // rgb
  vec4 uResolution;        // xy: render resolution, zw: 1/resolution
  vec4 uJitter;            // xy: current jitter (ndc), zw: previous
  vec4 uFog;               // x: haze density, y: render distance (blocks), z: mist, w: camera underwater
  vec4 uCascadeSplits;     // view distance where each cascade ends
  vec4 uShadowInfo;        // x: atlas size, y: 1/atlas size, z: max distance, w: enabled
  vec4 uCascadeSize;       // world-space width of each cascade
  vec4 uCamera;            // x: near, y: far, z: tan(fovY/2), w: aspect
  vec4 uWind;              // xy: direction, z: strength, w: cloud coverage
  vec4 uMisc;              // x: rain (0..1), y: cloud time, z: player sky light, w: held light
  vec4 uCameraAbs;         // xyz: absolute camera position, w: lightning flash (0..1)
  vec4 uCloudShadowParams; // xy: map centre (world xz at cloud base), z: map size (blocks), w: enabled
};
#define uTime uCameraPos.w
#define uFrame int(uCameraDelta.w)
