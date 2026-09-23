precision highp float;
#include <frame>
#include <common>
uniform sampler2D uDepth;
uniform vec3 uRainColor;
in float vAlpha;
in float vV;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uResolution.zw;
  float sd = texture(uDepth, uv).r;
  if (sd < 1.0 && linearizeDepth(gl_FragCoord.z) > linearizeDepth(sd)) discard;
  float a = vAlpha * smoothstep(0.0, 0.25, vV) * smoothstep(1.0, 0.6, vV);
  fragColor = vec4(uRainColor * a, a);
}
