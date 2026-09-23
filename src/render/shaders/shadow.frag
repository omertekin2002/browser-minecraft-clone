precision highp float;
precision highp int;
precision highp sampler2DArray;
#ifdef CUTOUT
uniform sampler2DArray uAlbedoTex;
in vec2 vUV;
flat in int vLayer;
#endif
void main() {
#ifdef CUTOUT
  if (texture(uAlbedoTex, vec3(vUV, float(vLayer))).a < 0.5) discard;
#endif
}
