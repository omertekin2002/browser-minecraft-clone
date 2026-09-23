// Log-luminance with centre-weighted metering (reduced via mipmaps).
precision highp float;
#include <frame>
#include <common>
uniform sampler2D uSrc;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float lum = max(luminance(c), 1e-5);
  vec2 d = (vUv - 0.5) * vec2(1.0, 1.3);
  float w = exp(-dot(d, d) * 5.0) + 0.15;
  fragColor = vec4(log2(lum) * w, w, 0.0, 1.0);
}
