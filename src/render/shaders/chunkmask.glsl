// 64×64 toroidal mask of chunk columns that currently have a block mesh (far terrain hides there).
uniform highp sampler2D uChunkMask;
uniform ivec2 uCamChunk;
uniform vec2 uCamChunkFrac; // camera xz minus camera chunk origin
bool chunkMeshed(vec3 relPos) {
  ivec2 d = ivec2(floor((relPos.xz + uCamChunkFrac) / 16.0));
  if (abs(d.x) > 31 || abs(d.y) > 31) return false;
  return texelFetch(uChunkMask, (uCamChunk + d) & 63, 0).r > 0.5;
}
