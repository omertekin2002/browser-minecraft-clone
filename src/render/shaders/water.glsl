// Animated water surface shared by the water shader and caustics.
float waterHeight(vec2 p) {
  float t = uTime;
  float h = 0.0;
  h += 0.30 * sin(dot(p, vec2(0.37, 0.13)) + t * 1.05 + valueNoise2(p * 0.13) * 3.0);
  h += 0.22 * sin(dot(p, vec2(-0.19, 0.43)) + t * 1.35 + valueNoise2(p * 0.19 + 7.0) * 3.0);
  h += 0.12 * (valueNoise2(p * 1.2 + vec2(t * 0.55, t * 0.3)) * 2.0 - 1.0);
  h += 0.07 * (valueNoise2(p * 2.6 - vec2(t * 0.8, -t * 0.45)) * 2.0 - 1.0);
  h += 0.035 * (valueNoise2(p * 5.1 + vec2(-t * 1.1, t * 0.9)) * 2.0 - 1.0);
  return h;
}

vec3 waterNormal(vec2 p, float strength) {
  const float e = 0.06;
  float hL = waterHeight(p - vec2(e, 0.0)), hR = waterHeight(p + vec2(e, 0.0));
  float hD = waterHeight(p - vec2(0.0, e)), hU = waterHeight(p + vec2(0.0, e));
  return normalize(vec3((hL - hR) * strength, 2.0 * e, (hD - hU) * strength));
}

// Tileable water caustics (after Dave Hoskins / joltz0r). Pattern tiles every 2π units; returns 0..1.
float caustics(vec2 pos, float t) {
  vec2 p = mod(pos, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
  t = t * 0.5 + 23.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
