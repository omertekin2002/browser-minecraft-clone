// Eye adaptation (1×1): smoothly moves exposure towards the metered target.
precision highp float;
uniform sampler2D uLum;
uniform float uLumLevel;
uniform sampler2D uPrevExposure;
uniform float uDt;
uniform float uReset;
uniform vec2 uRange;
uniform float uBias;
out vec4 fragColor;
void main() {
  vec2 s = textureLod(uLum, vec2(0.5), uLumLevel).rg;
  float avgLum = exp2(s.x / max(s.y, 1e-5));
  // Partial adaptation: bright scenes (snow, clouds) stay bright and night stays dark-ish.
  float target = clamp(0.21 * pow(avgLum, -0.72), uRange.x, uRange.y) * exp2(uBias);
  float prev = texelFetch(uPrevExposure, ivec2(0), 0).r;
  float rate = target < prev ? 2.2 : 1.1;
  float e = (uReset > 0.5 || prev <= 0.0) ? target : exp2(mix(log2(prev), log2(target), 1.0 - exp(-uDt * rate)));
  fragColor = vec4(e, avgLum, target, 1.0);
}
