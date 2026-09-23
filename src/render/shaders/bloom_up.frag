precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
uniform float uRadius;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 t = uSrcTexel * uRadius;
  vec3 s = texture(uSrc, vUv + vec2(-t.x, t.y)).rgb + texture(uSrc, vUv + vec2(0.0, t.y)).rgb * 2.0 + texture(uSrc, vUv + vec2(t.x, t.y)).rgb
         + texture(uSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0 + texture(uSrc, vUv).rgb * 4.0 + texture(uSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0
         + texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0 + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb;
  fragColor = vec4(s / 16.0, 1.0);
}
