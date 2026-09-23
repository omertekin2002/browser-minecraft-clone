// Highest water block per column around the player (toroidal 1024² map).
uniform highp sampler2D uWaterMap;
float waterSurfaceAt(vec3 pAbs) {
  ivec2 c = ivec2(floor(pAbs.xz)) & 1023;
  float top = texelFetch(uWaterMap, c, 0).r;
  return top < -100.0 ? -1000.0 : top + 0.875;
}
