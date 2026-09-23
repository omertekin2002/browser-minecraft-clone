// Cascaded shadow maps (depth texture array, one layer per cascade) with PCSS soft shadows.
uniform highp sampler2DArrayShadow uShadowCmp;
uniform highp sampler2DArray uShadowRaw;
uniform vec4 uCascadeDepthRange; // world-space depth range (far - near) per cascade

const vec2 POISSON[16] = vec2[16](
  vec2(-0.94201624, -0.39906216), vec2(0.94558609, -0.76890725), vec2(-0.09418410, -0.92938870), vec2(0.34495938, 0.29387760),
  vec2(-0.91588581, 0.45771432), vec2(-0.81544232, -0.87912464), vec2(-0.38277543, 0.27676845), vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554), vec2(0.53742981, -0.47373420), vec2(-0.26496911, -0.41893023), vec2(0.79197514, 0.19090188),
  vec2(-0.24188840, 0.99706507), vec2(-0.81409955, 0.91437590), vec2(0.19984126, 0.78641367), vec2(0.14383161, -0.14100790)
);

// Sun angular diameter used for penumbrae (exaggerated a little for softer shadows).
const float PENUMBRA_SCALE = 0.022;

// Returns the cascade index (-1 if none) and its [0,1] coordinates. `fade` goes to 0 at the outer edge
// of the last cascade so shadows disappear smoothly with distance.
int findCascade(vec3 P, float dither, out vec3 coord, out float fade) {
  fade = 1.0;
  for (int i = 0; i < 4; i++) {
    vec3 c = (uShadowMat[i] * vec4(P, 1.0)).xyz * 0.5 + 0.5;
    vec2 e = min(c.xy, 1.0 - c.xy);
    float m = min(e.x, e.y);
    if (m > 0.004 && c.z < 0.999) {
      if (i < 3 && m < 0.06 && dither > m / 0.06) continue;
      if (i == 3) fade = smoothstep(0.004, 0.08, m);
      coord = c;
      return i;
    }
  }
  return -1;
}

// Visibility in [0,1]; blockerDist receives the average receiver-to-blocker distance (blocks).
float sampleShadow(vec3 P, vec3 geoN, float NdotL, vec2 pixel, out float blockerDist) {
  blockerDist = 0.0;
  float dither = ignT(pixel, uFrame);
  vec3 c;
  float fade;
  int ci = findCascade(P, dither, c, fade);
  if (ci < 0) return 1.0;
  float S = uShadowInfo.x;
  float texelWorld = uCascadeSize[ci] / S;
  vec3 Po = P + geoN * texelWorld * (0.9 + 1.6 * (1.0 - saturate(NdotL)));
  c = (uShadowMat[ci] * vec4(Po, 1.0)).xyz * 0.5 + 0.5;
  float range = uCascadeDepthRange[ci];
  float z = c.z - 0.05 / range;
  vec2 uvMin = vec2(1.0 / S), uvMax = vec2(1.0 - 1.0 / S);
  vec2 uv = clamp(c.xy, uvMin, uvMax);
  float layer = float(ci);

  float rot = dither * TAU;
  mat2 R = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  float worldToUv = 1.0 / uCascadeSize[ci];

  if (ci >= 2) {
    // Distant cascades: small fixed-radius PCF.
    float r = 1.5 / S;
    float sum = 0.0;
    for (int k = 0; k < 4; k++) {
      sum += texture(uShadowCmp, vec4(clamp(uv + R * POISSON[k * 4] * r, uvMin, uvMax), layer, z));
    }
    return mix(1.0, sum * 0.25, fade);
  }

  // PCSS blocker search
  float searchUv = max(0.6 * worldToUv, 2.0 / S);
  float bsum = 0.0, bcount = 0.0;
  for (int k = 0; k < 6; k++) {
    vec2 o = R * POISSON[k * 2 + 1] * searchUv;
    float d = texture(uShadowRaw, vec3(clamp(uv + o, uvMin, uvMax), layer)).r;
    if (d < z) { bsum += d; bcount += 1.0; }
  }
  if (bcount < 0.5) return 1.0;
  blockerDist = max(z - bsum / bcount, 0.0) * range;

  float penumbraWorld = max(blockerDist * PENUMBRA_SCALE, 0.03);
  float radiusUv = clamp(penumbraWorld * worldToUv, 0.75 / S, 16.0 / S);
  float sum = 0.0;
  for (int k = 0; k < 8; k++) {
    vec2 o = R * POISSON[k * 2] * radiusUv;
    sum += texture(uShadowCmp, vec4(clamp(uv + o, uvMin, uvMax), layer, z));
  }
  return sum / 8.0;
}

// Cheap single-tap shadow for volumetrics.
float shadowHard(vec3 P) {
  for (int i = 0; i < 4; i++) {
    vec3 c = (uShadowMat[i] * vec4(P, 1.0)).xyz * 0.5 + 0.5;
    if (all(greaterThan(c.xy, vec2(0.004))) && all(lessThan(c.xy, vec2(0.996))) && c.z < 0.999) {
      return texture(uShadowCmp, vec4(c.xy, float(i), c.z - 0.1 / uCascadeDepthRange[i]));
    }
  }
  return 1.0;
}
