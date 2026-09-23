// Temporal accumulation for the half-res cloud buffer (clouds are distant: reproject by direction).
precision highp float;
#include <frame>
#include <common>
uniform sampler2D uCurrent;
uniform sampler2D uHistory;
uniform float uReset;
in vec2 vUv;
out vec4 fragColor;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 maxPx = textureSize(uCurrent, 0) - 1;
  // 3×3 tent filter of the current frame: cancels the alternating-row pattern of the dithered march.
  vec4 cur = vec4(0.0);
  vec4 mn = vec4(1e9), mx = vec4(-1e9);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec4 c = texelFetch(uCurrent, clamp(px + ivec2(x, y), ivec2(0), maxPx), 0);
      float w = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
      cur += c * w;
      mn = min(mn, c);
      mx = max(mx, c);
    }
  }
  cur /= 16.0;
  vec3 dir = viewDirection(vUv);
  vec4 pc = uPrevViewProj * vec4(dir, 0.0);
  vec2 prevUv = pc.xy / pc.w * 0.5 + 0.5;
  vec4 hist = texture(uHistory, prevUv);
  // Clamp only as much as the camera moved: a still camera accumulates freely.
  float motion = length((prevUv - vUv) * vec2(textureSize(uCurrent, 0)));
  float widen = mix(4.0, 1.25, saturate(motion * 0.5));
  vec4 center = (mn + mx) * 0.5, ext = (mx - mn) * 0.5 * widen + vec4(vec3(0.02 * luminance(cur.rgb) + 1e-3), 0.03);
  hist = clamp(hist, center - ext, center + ext);
  bool valid = pc.w > 0.0 && all(greaterThan(prevUv, vec2(0.0))) && all(lessThan(prevUv, vec2(1.0))) && uReset < 0.5;
  fragColor = valid ? mix(cur, hist, mix(0.96, 0.85, saturate(motion * 0.25))) : cur;
}
