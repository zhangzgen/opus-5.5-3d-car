// Custom shading: wet asphalt with planar reflections + analytic lamp pools, procedural
// building facades, night sky, and volumetric lamp cones.
import * as THREE from 'three';
import { ROAD_HALF } from './trackdata.js';

const NOISE_GLSL = /* glsl */ `
float rHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float rNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), u.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float rFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * rNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// ---------------------------------------------------------------- road
const ROAD_PARS = /* glsl */ `
#define ROAD_HALF ${ROAD_HALF.toFixed(2)}
uniform sampler2D uReflTex;
uniform float uReflOn;
uniform float uLampSpacing;
uniform float uLampU;
uniform float uLampH;
uniform float uLampI;
uniform float uTunI;
uniform float uDash;
uniform float uStartS;
uniform float uWet;
uniform float uTime;
uniform float uRain;
uniform vec3 uLampColor;
uniform vec3 uTunColor;
varying vec2 vRoadUv;
varying vec4 vRoad;
varying float vKappa;
varying vec3 vWPos;
varying vec4 vReflCoord;
${NOISE_GLSL}
float lineMask(float x, float w) { float aa = fwidth(x) * 0.8 + 0.002; return 1.0 - smoothstep(w - aa, w + aa, abs(x)); }
float roadPuddle;
float roadWet;
float roadPaint;
`;

const ROAD_ALBEDO = /* glsl */ `
vec2 ruv = vRoadUv;
vec2 wpz = vWPos.xz;
float au = abs(ruv.x);
float nBig = rFbm(wpz * 0.06);
float nMid = rNoise(wpz * 0.9);
float grit = rHash(floor(wpz * 70.0));
vec3 asph = vec3(0.085, 0.084, 0.088) * (0.7 + 0.6 * nBig) * (0.8 + 0.4 * grit) * (0.9 + 0.2 * nMid);
float patchN = rHash(floor(wpz / vec2(9.0, 6.0)) + 3.7);
asph *= mix(1.0, 0.7, step(0.9, patchN));
float lanePos = mod(ruv.x + ROAD_HALF, 4.5);
float wear = smoothstep(0.9, 0.0, abs(lanePos - 1.2)) + smoothstep(0.9, 0.0, abs(lanePos - 3.3));
asph *= 1.0 + 0.1 * wear;
roadPuddle = smoothstep(0.57, 0.68, rFbm(wpz * 0.032 + vec2(13.1, 7.7)));
roadPuddle = max(roadPuddle, smoothstep(ROAD_HALF - 1.6, ROAD_HALF - 0.2, au) * smoothstep(0.35, 0.6, rNoise(wpz * 0.15)));
roadWet = uWet * (0.72 + 0.28 * roadPuddle);
float dashOn = step(fract(ruv.y / uDash), 0.42);
float m = lineMask(au - (ROAD_HALF - 0.5), 0.09);
m = max(m, dashOn * lineMask(ruv.x, 0.075));
m = max(m, dashOn * lineMask(au - 4.5, 0.075));
float sd = ruv.y - uStartS;
float chk = (1.0 - step(1.25, abs(sd))) * (1.0 - step(ROAD_HALF - 0.6, au));
float cellC = mod(floor(ruv.x / 0.62) + floor(sd / 0.62), 2.0);
float slot = 0.0;
for (int r = 1; r <= 3; r++) {
  float rs = uStartS - 8.0 * float(r);
  for (int c = 0; c < 2; c++) {
    float cu = c == 0 ? 3.6 : -3.6;
    float ss = sd + 8.0 * float(r) + (c == 0 ? 0.0 : 4.0);
    float du = ruv.x - cu;
    float bracket = (1.0 - step(0.1, abs(ss))) * (1.0 - step(1.3, abs(du)));
    bracket = max(bracket, (1.0 - step(0.08, abs(abs(du) - 1.25))) * step(-1.6, ss) * (1.0 - step(0.0, ss)));
    slot = max(slot, bracket);
  }
}
m = max(m, slot);
m *= 0.55 + 0.45 * smoothstep(0.15, 0.7, rNoise(wpz * 3.0));
roadPaint = m;
vec3 alb = mix(asph, vec3(0.6), m);
alb = mix(alb, vec3(cellC * 0.68 + 0.015), chk);
roadPaint = max(roadPaint, chk * cellC);
float kerbSide = ruv.x > 0.0 ? vRoad.z : vRoad.w;
float kz = step(ROAD_HALF - 0.95, au) * kerbSide;
float kstripe = step(0.5, fract(ruv.y / 2.0));
alb = mix(alb, mix(vec3(0.5, 0.025, 0.02), vec3(0.62), kstripe), kz);
roadPaint = max(roadPaint, kz);
alb *= mix(1.0, 0.5, roadWet * (1.0 - roadPaint * 0.6));
diffuseColor.rgb *= alb;
`;

const ROAD_ROUGH = /* glsl */ `
float roughnessFactor = mix(0.85, 0.42, roadWet);
roughnessFactor = mix(roughnessFactor, 0.04, roadPuddle * uWet);
roughnessFactor = mix(roughnessFactor, 0.6, roadPaint * 0.55);
`;

const ROAD_FINAL = /* glsl */ `
outgoingLight *= mix(1.0, 0.1, vRoad.x);
{
  vec3 lampE = vec3(0.0);
  float cosK = clamp(1.0 - vKappa * ruv.x, 0.4, 1.6);
  float sp = uLampSpacing;
  for (int side = 0; side < 2; side++) {
    float off = side == 0 ? 0.0 : 0.5 * sp;
    float lu = side == 0 ? uLampU : -uLampU;
    float k0 = floor((ruv.y - off) / sp + 0.5);
    for (int j = -1; j <= 1; j++) {
      float lv = (k0 + float(j)) * sp + off;
      vec3 L = vec3(lu - ruv.x, uLampH, (lv - ruv.y) * cosK);
      float r2 = dot(L, L);
      float c = uLampH * inversesqrt(r2);
      lampE += uLampColor * (uLampI * c * c * c / r2);
    }
  }
  lampE *= vRoad.y;
  vec3 tunE = vec3(0.0);
  if (vRoad.x > 0.001) {
    float k0 = floor(ruv.y / 6.0 + 0.5);
    for (int row = 0; row < 2; row++) {
      float lu = row == 0 ? 4.2 : -4.2;
      for (int j = -2; j <= 2; j++) {
        float lv = (k0 + float(j)) * 6.0;
        vec3 L = vec3(lu - ruv.x, 6.6, lv - ruv.y);
        float r2 = dot(L, L);
        float c = 6.6 * inversesqrt(r2);
        tunE += uTunColor * (uTunI * c * c / r2);
      }
    }
  }
  vec3 E = mix(lampE, tunE, vRoad.x);
  outgoingLight += diffuseColor.rgb * RECIPROCAL_PI * E;
  vec3 Vv = normalize(cameraPosition - vWPos);
  float NoV = clamp(Vv.y, 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  // broad wet sheen from the lamp pools themselves (keeps near-field road alive)
  outgoingLight += E * 0.0025 * roadWet * fres;
  if (uReflOn > 0.5) {
    vec2 rp = vReflCoord.xy / vReflCoord.w;
    vec2 jit = (vec2(rNoise(wpz * 9.0), rNoise(wpz * 9.0 + 9.1)) - 0.5) * 0.0045 * (1.0 - roadPuddle);
    // raindrop ripples in standing water
    if (uRain > 0.01 && roadPuddle > 0.05) {
      vec2 rr = wpz * 1.7;
      vec2 cb = floor(rr);
      vec2 rip = vec2(0.0);
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
        vec2 c = cb + vec2(float(i), float(j));
        float h = rHash(c);
        vec2 ctr = c + vec2(rHash(c + 3.17), rHash(c + 7.71));
        float t = fract(uTime * 1.25 + h * 7.0);
        vec2 d = rr - ctr;
        float r = length(d);
        float rad = t * 0.8;
        float band = 1.0 - smoothstep(0.0, 0.08, abs(r - rad));
        rip += (d / max(r, 0.001)) * (1.0 - t) * band * sin((r - rad) * 55.0);
      }
      jit += rip * 0.01 * roadPuddle * uRain;
    }
    float blur = roughnessFactor * 0.075;
    vec3 refl = vec3(0.0);
    float wsum = 0.0;
    for (int i = -4; i <= 4; i++) {
      float fi = float(i) / 4.0;
      float w = 1.0 - abs(fi) * 0.65;
      refl += texture2D(uReflTex, rp + jit + vec2(fi * blur * 0.16, fi * blur)).rgb * w;
      wsum += w;
    }
    refl /= wsum;
    float amt = fres * roadWet * mix(0.35, 1.0, 1.0 - roughnessFactor);
    outgoingLight = outgoingLight * (1.0 - amt * 0.6) + refl * amt;
  }
}
`;

export function createRoadMaterial(track) {
  const L = track.length;
  const uniforms = {
    uReflTex: { value: null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflOn: { value: 0 },
    uLampSpacing: { value: track.lampSpacing },
    uLampU: { value: ROAD_HALF - 1.2 },
    uLampH: { value: 9.3 },
    uLampColor: { value: new THREE.Color(1.0, 0.68, 0.38) },
    uLampI: { value: 1700 },
    uTunI: { value: 260 },
    uTunColor: { value: new THREE.Color(1.0, 0.52, 0.18) },
    uDash: { value: L / Math.round(L / 12) },
    uStartS: { value: track.startS },
    uWet: { value: 1.0 },
    uTime: { value: 0 },
    uRain: { value: 1.0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, envMapIntensity: 0.2 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aRoadUv;
attribute vec4 aRoad;
attribute float aKappa;
uniform mat4 uReflMatrix;
varying vec2 vRoadUv;
varying vec4 vRoad;
varying float vKappa;
varying vec3 vWPos;
varying vec4 vReflCoord;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vec4 rwp = modelMatrix * vec4(transformed, 1.0);
vWPos = rwp.xyz;
vReflCoord = uReflMatrix * rwp;
vRoadUv = aRoadUv;
vRoad = aRoad;
vKappa = aKappa;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROAD_PARS}`)
      .replace('#include <map_fragment>', ROAD_ALBEDO)
      .replace('#include <roughnessmap_fragment>', ROAD_ROUGH)
      .replace(
        '#include <lights_fragment_begin>',
        THREE.ShaderChunk.lights_fragment_begin.replace(
          'getPointLightInfo( pointLight, geometryPosition, directLight );',
          'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color = vec3( 0.0 );'
        )
      )
      .replace('#include <opaque_fragment>', `${ROAD_FINAL}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'road-v2';
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---------------------------------------------------------------- buildings
const BLD_FRAG = /* glsl */ `
{
  vec3 bN = vBNrm;
  float side = 1.0 - step(0.5, abs(bN.y));
  bool xFace = abs(bN.x) > 0.5;
  float faceU = xFace ? vBPos.z * sign(bN.x) : -vBPos.x * sign(bN.z);
  float faceW = xFace ? vBScale.z : vBScale.x;
  float fu = faceU + faceW * 0.5;
  float fy = vBPos.y;
  float seed = vBld.x;
  float style = vBld.y;
  float litFrac = vBld.z;
  float faceId = xFace ? (bN.x > 0.0 ? 1.0 : 2.0) : (bN.z > 0.0 ? 3.0 : 4.0);
  float floorH = 3.3 + fract(seed * 13.7) * 0.8;
  float colW = mix(1.7, 2.9, fract(seed * 7.13));
  vec2 g = vec2(fu / colW, (fy - 0.4) / floorH);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float win;
  if (style < 0.4) win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.84);
  else if (style < 0.72) win = step(0.38, f.y) * step(f.y, 0.88) * step(0.04, f.x) * step(f.x, 0.96);
  else win = step(0.04, f.x) * step(f.x, 0.96) * step(0.08, f.y) * step(f.y, 0.96);
  float edge = step(0.7, fu) * step(fu, faceW - 0.7);
  win *= side * edge * step(4.6, fy) * step(fy, vBScale.y - 1.0);
  vec2 lc = style >= 0.4 && style < 0.72 ? vec2(floor(cell.x / 3.0), cell.y) : cell;
  float h1 = bHash(lc + vec2(seed * 91.7, faceId * 17.3));
  float h2 = bHash(lc.yx * 1.7 + vec2(faceId * 3.1, seed * 13.1));
  float lit = step(1.0 - litFrac, h1);
  vec3 warm = vec3(1.0, 0.6, 0.3);
  vec3 neutral = vec3(1.0, 0.86, 0.68);
  vec3 cool = vec3(0.6, 0.78, 1.0);
  vec3 wcol = h2 < 0.5 ? warm : (h2 < 0.82 ? neutral : cool);
  float wint = (0.25 + 1.2 * h2 * h2) * uWinI;
  if (h2 > 0.965) wint *= 0.55 + 0.45 * sin(uTime * 9.0 + h1 * 60.0) * sin(uTime * 3.7 + h1 * 20.0);
  // interior depth cue: lit windows brighter toward their lower half (ceiling lights)
  wint *= 0.75 + 0.5 * smoothstep(0.9, 0.3, f.y);
  vec3 bEmit = win * lit * wcol * wint;
  float shopOn = step(0.5, fract(seed * 3.7));
  float shop = side * edge * shopOn * step(0.45, fy) * step(fy, 3.2);
  vec3 shopCol = 0.5 + 0.5 * cos(6.2831 * (fract(seed * 5.3) + vec3(0.0, 0.33, 0.67)));
  shopCol = mix(vec3(1.0, 0.8, 0.6), shopCol * shopCol, 0.3);
  float bayI = floor(fu / 5.5);
  float bayU = fract(fu / 5.5);
  float bayH = bHash(vec2(bayI, seed));
  float bays = step(0.08, bayU) * step(bayU, 0.92) * step(0.22, bayH);
  float mull = step(0.06, fract(fu / 1.4));
  // ceiling lights inside: brighter toward the top of the glazing, shelves cut across the lower part
  float shopGrad = 0.35 + 0.65 * smoothstep(0.6, 3.0, fy);
  float shelves = 1.0 - 0.75 * step(0.5, bayH) * (step(0.92, fract(fy / 0.7)) * step(fy, 2.3));
  float goods = 0.75 + 0.5 * bHash(floor(vec2(fu * 3.0, fy * 4.0)) + seed);
  vec3 bayCol = mix(shopCol, vec3(1.0, 0.9, 0.75), step(0.7, bayH));
  bEmit += shop * bays * mull * bayCol * shopGrad * shelves * goods * 0.55 * uWinI;
  // storefront sign band above the glazing: blocky "lettering" in a saturated colour
  float signBand = side * edge * shopOn * step(3.4, fy) * step(fy, 4.15) * step(0.35, bayH);
  vec3 signCol = 0.5 + 0.5 * cos(6.2831 * (bayH * 3.1 + vec3(0.0, 0.33, 0.67)));
  float letters = step(0.5, bHash(floor(vec2(fu * 4.5, fy * 9.0)) + bayI * 3.0)) * step(0.18, bayU) * step(bayU, 0.82) * step(3.55, fy) * step(fy, 4.0);
  bEmit += signBand * signCol * signCol * (0.12 + letters * 2.4) * uWinI;
  shop = max(shop * bays, signBand * 0.6);
  float topBand = side * step(vBScale.y - 0.6, fy) * step(0.82, fract(seed * 2.9));
  bEmit += topBand * vec3(0.4, 0.8, 1.0) * 3.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.015, 0.018, 0.022), max(win, shop));
  bWin = max(win, shop);
  bEmitG = bEmit;
}
`;

export function createBuildingMaterial() {
  const uniforms = { uTime: { value: 0 }, uWinI: { value: 1.25 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aBld;
varying vec3 vBPos;
varying vec3 vBNrm;
varying vec4 vBld;
varying vec3 vBScale;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 bScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
#else
vec3 bScale = vec3(1.0);
#endif
vBPos = position * bScale;
vBNrm = normal;
vBld = aBld;
vBScale = bScale;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uWinI;
varying vec3 vBPos;
varying vec3 vBNrm;
varying vec4 vBld;
varying vec3 vBScale;
float bWin;
vec3 bEmitG;
float bHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BLD_FRAG}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, bWin);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += bEmitG;`)
      .replace(
        '#include <lights_fragment_begin>',
        THREE.ShaderChunk.lights_fragment_begin.replace(
          'getPointLightInfo( pointLight, geometryPosition, directLight );',
          'getPointLightInfo( pointLight, geometryPosition, directLight ); directLight.color = vec3( 0.0 );'
        )
      );
  };
  mat.customProgramCacheKey = () => 'bld-v3';
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---------------------------------------------------------------- sky
export function createSkyMaterial(moonDir) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMoon: { value: moonDir.clone().normalize() }, uBoost: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uMoon;
      uniform float uBoost;
      varying vec3 vDir;
      ${NOISE_GLSL}
      float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.004, 0.006, 0.017);
        vec3 mid = vec3(0.016, 0.018, 0.042);
        vec3 horizon = vec3(0.17, 0.085, 0.06);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.2, h));
        col = mix(col, zenith, smoothstep(0.18, 0.75, h));
        vec2 cp = d.xz / max(h + 0.08, 0.06);
        float c = rFbm(cp * 0.9 + vec2(uTime * 0.004, 0.0));
        float cl = smoothstep(0.42, 0.82, c) * smoothstep(0.0, 0.2, h);
        vec3 cloudCol = mix(vec3(0.11, 0.06, 0.045), vec3(0.03, 0.03, 0.05), smoothstep(0.04, 0.55, h));
        col = mix(col, cloudCol, cl * 0.9);
        vec3 sp = d * 260.0;
        vec3 ci = floor(sp);
        float sh = h31(ci);
        vec3 off = vec3(h31(ci + 1.3), h31(ci + 2.7), h31(ci + 4.1)) - 0.5;
        float sd = length(fract(sp) - 0.5 - off * 0.6);
        float star = step(0.985, sh) * smoothstep(0.12, 0.0, sd) * smoothstep(0.08, 0.35, h) * (1.0 - cl);
        col += star * vec3(0.75, 0.8, 1.0) * (0.25 + 0.2 * sin(uTime * 3.0 + sh * 80.0));
        float md = dot(d, uMoon);
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99945, 0.99965, md) * 7.0 * (1.0 - cl * 0.7);
        col += vec3(0.32, 0.36, 0.5) * pow(max(md, 0.0), 260.0) * 0.6;
        col += vec3(0.12, 0.14, 0.22) * pow(max(md, 0.0), 18.0) * 0.12;
        if (h < 0.0) col = mix(horizon, vec3(0.03, 0.02, 0.018), smoothstep(0.0, -0.12, h));
        gl_FragColor = vec4(col * uBoost, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

// ---------------------------------------------------------------- volumetric lamp cones
export function createConeMaterial(color, strength = 0.05) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      varying float vCamD;
      void main() {
        vY = uv.y;
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
        im = instanceMatrix;
        #endif
        vec4 wp = modelMatrix * im * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix * im) * normal);
        vV = cameraPosition - wp.xyz;
        vCamD = length(vV);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      varying float vCamD;
      void main() {
        float rim = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
        float y = clamp(vY, 0.0, 1.0);
        float a = rim * rim * y * sqrt(y) * uStrength;
        a *= smoothstep(3.0, 9.0, vCamD) * (1.0 - smoothstep(180.0, 320.0, vCamD));
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}
