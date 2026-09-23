// Aerial haze + valley mist + render-distance fade into the sky colour.
vec3 applyHaze(vec3 color, vec3 P, vec3 dir, float dist, float skyL) {
  float outdoor = smoothstep(0.0, 0.6, max(skyL, uMisc.z));
  float haze = (1.0 - exp(-dist * uFog.x)) * outdoor;
  // Low-lying mist in valleys (stronger at dawn).
  float wy = P.y + uCameraAbs.y;
  float mist = uFog.z * (1.0 - exp(-dist * 0.012)) * exp(-max(wy - 60.0, 0.0) / 14.0) * outdoor;
  float edge = smoothstep(uFog.y * 0.7, uFog.y * 0.97, length(P.xz));
  float f = saturate(max(haze + mist, edge));
  return mix(color, sampleSkyHorizon(dir), f);
}
