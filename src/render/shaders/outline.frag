precision highp float;
#include <frame>
#include <common>
uniform sampler2D uDepth;
uniform vec2 uViewport;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uViewport;
  float sd = texture(uDepth, uv).r;
  float lineLin = linearizeDepth(gl_FragCoord.z);
  float sceneLin = sd >= 1.0 ? 1e6 : linearizeDepth(sd);
  if (lineLin > sceneLin + 0.03 + lineLin * 0.012) discard;
  fragColor = vec4(0.0, 0.0, 0.0, 0.55);
}
