uniform sampler2D uSkySH;
// Irradiance from the 9-coefficient sky SH (divide by PI for Lambertian radiance).
vec3 evalSH(vec3 n) {
  vec3 c0 = texelFetch(uSkySH, ivec2(0, 0), 0).rgb;
  vec3 c1 = texelFetch(uSkySH, ivec2(1, 0), 0).rgb;
  vec3 c2 = texelFetch(uSkySH, ivec2(2, 0), 0).rgb;
  vec3 c3 = texelFetch(uSkySH, ivec2(3, 0), 0).rgb;
  vec3 c4 = texelFetch(uSkySH, ivec2(4, 0), 0).rgb;
  vec3 c5 = texelFetch(uSkySH, ivec2(5, 0), 0).rgb;
  vec3 c6 = texelFetch(uSkySH, ivec2(6, 0), 0).rgb;
  vec3 c7 = texelFetch(uSkySH, ivec2(7, 0), 0).rgb;
  vec3 c8 = texelFetch(uSkySH, ivec2(8, 0), 0).rgb;
  const float A0 = 3.141593, A1 = 2.094395, A2 = 0.785398;
  vec3 e = A0 * 0.282095 * c0
    + A1 * 0.488603 * (c1 * n.y + c2 * n.z + c3 * n.x)
    + A2 * (1.092548 * c4 * n.x * n.y + 1.092548 * c5 * n.y * n.z + 0.315392 * c6 * (3.0 * n.z * n.z - 1.0)
          + 1.092548 * c7 * n.x * n.z + 0.546274 * c8 * (n.x * n.x - n.y * n.y));
  return max(e, vec3(0.0));
}
