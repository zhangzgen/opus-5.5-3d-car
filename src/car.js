// Procedural supercar. The body is a loft of superellipse sections (with wheel arches cut in),
// the cabin is a second loft split into paint / glass / trim, and lights, intakes and skirts are
// patches that conform exactly to the body surface.
import * as THREE from 'three';
import { interpTable, clamp, lerp, damp } from './util.js';
import * as T from './textures.js';

export const CAR = {
  wheelR: 0.345,
  frontZ: 1.36,
  rearZ: -1.34,
  trackHalf: 0.83,
  halfLen: 2.3,
  halfWidth: 0.99,
};

const Z_TAIL = -2.3, Z_NOSE = 2.3;
const ROUND_R = 0.27, ROUND_MIN = 0.34;
const TOP = [[-2.3, 0.8], [-2.2, 0.93], [-2.0, 0.98], [-1.6, 0.99], [-1.2, 0.975], [-0.6, 0.95], [0.0, 0.92], [0.55, 0.885], [1.0, 0.86], [1.4, 0.845], [1.8, 0.8], [2.1, 0.72], [2.3, 0.6]];
const BOT = [[-2.3, 0.4], [-2.15, 0.26], [-1.9, 0.17], [-1.2, 0.14], [1.2, 0.14], [1.9, 0.15], [2.15, 0.18], [2.3, 0.28]];
const HW = [[-2.3, 0.84], [-2.15, 0.93], [-1.85, 0.985], [-1.34, 1.0], [-0.85, 0.972], [0.0, 0.952], [0.8, 0.96], [1.36, 0.99], [1.85, 0.955], [2.15, 0.885], [2.3, 0.79]];
const NX = [[-2.3, 3.0], [-1.8, 4.4], [0, 4.8], [1.8, 4.2], [2.3, 2.9]];
const NY = [[-2.3, 3.0], [-1.8, 4.6], [0, 5.0], [1.8, 4.4], [2.3, 3.0]];
const ARCHES = [{ z: CAR.frontZ, r: 0.405 }, { z: CAR.rearZ, r: 0.41 }];

const CZ0 = -1.55, CZ1 = 0.74;
const ROOF = [[-1.55, 0.95], [-1.3, 1.04], [-1.0, 1.135], [-0.65, 1.2], [-0.25, 1.222], [0.05, 1.2], [0.3, 1.12], [0.52, 1.02], [0.74, 0.895]];
const CHW_TOP = [[-1.55, 0.48], [-1.0, 0.57], [-0.3, 0.615], [0.3, 0.63], [0.74, 0.66]];

const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

function endRound(z) {
  let e = 1;
  if (z > Z_NOSE - ROUND_R) {
    const t = (z - (Z_NOSE - ROUND_R)) / ROUND_R;
    e = Math.sqrt(Math.max(0, 1 - t * t));
  } else if (z < Z_TAIL + ROUND_R) {
    const t = (Z_TAIL + ROUND_R - z) / ROUND_R;
    e = Math.sqrt(Math.max(0, 1 - t * t));
  }
  return ROUND_MIN + (1 - ROUND_MIN) * e;
}

function archCut(z) {
  let y = -1;
  for (const a of ARCHES) {
    const dz = z - a.z;
    if (Math.abs(dz) < a.r) y = Math.max(y, CAR.wheelR + Math.sqrt(a.r * a.r - dz * dz));
  }
  return y;
}

function section(z) {
  const top = interpTable(TOP, z), bot = interpTable(BOT, z), hw = interpTable(HW, z);
  const e = endRound(z);
  return { cy: (top + bot) / 2, hh: ((top - bot) / 2) * e, hw: hw * e, nx: interpTable(NX, z), ny: interpTable(NY, z), cut: archCut(z), top };
}

export function bodyPoint(z, phi, out = new THREE.Vector3()) {
  const S = section(z);
  const c = Math.cos(phi), s = Math.sin(phi);
  const x = S.hw * sgnPow(c, 2 / S.nx);
  let y = S.cy + S.hh * sgnPow(s, 2 / S.ny);
  if (y < S.cut) y = S.cut;
  return out.set(x, y, z);
}

function cabinPoint(z, phi, out = new THREE.Vector3()) {
  const S = section(z);
  const roof = interpTable(ROOF, z);
  const y0 = S.top - 0.17;
  const cy = (roof + y0) / 2, hh = Math.max(0.005, (roof - y0) / 2);
  const hwB = S.hw - 0.1, hwT = interpTable(CHW_TOP, z);
  const c = Math.cos(phi), s = Math.sin(phi);
  const yn = sgnPow(s, 2 / 3.2);
  const xn = sgnPow(c, 2 / 3.0);
  const w = lerp(hwB, hwT, (yn + 1) / 2);
  return out.set(w * xn, cy + hh * yn, z);
}

function stationsBody() {
  const zs = new Set();
  for (let z = Z_TAIL; z <= Z_NOSE + 1e-6; z += 0.04) zs.add(+z.toFixed(4));
  for (let z = Z_TAIL; z < Z_TAIL + ROUND_R; z += 0.01) zs.add(+z.toFixed(4));
  for (let z = Z_NOSE - ROUND_R; z <= Z_NOSE; z += 0.01) zs.add(+z.toFixed(4));
  for (const a of ARCHES) {
    for (let z = a.z - a.r; z <= a.z + a.r; z += 0.02) zs.add(+z.toFixed(4));
    for (const d of [-a.r - 0.004, -a.r + 0.002, a.r - 0.002, a.r + 0.004]) zs.add(+(a.z + d).toFixed(4));
  }
  zs.add(Z_NOSE);
  zs.add(Z_TAIL);
  return [...zs].filter((z) => z >= Z_TAIL && z <= Z_NOSE).sort((a, b) => a - b);
}

// Generic loft over (zs × ns) with outward winding; optional per-quad material classifier.
function loft(zs, ns, pointFn, classify = null, groups = 1) {
  const P = ns + 1;
  const pos = new Float32Array(zs.length * P * 3);
  const uv = new Float32Array(zs.length * P * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < zs.length; i++) for (let j = 0; j <= ns; j++) {
    const phi = -Math.PI / 2 + (j / ns) * Math.PI * 2;
    pointFn(zs[i], phi, v);
    const o = i * P + j;
    pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
    uv[o * 2] = (j / ns) * 6.0;
    uv[o * 2 + 1] = zs[i] - Z_TAIL;
  }
  const lists = Array.from({ length: groups }, () => []);
  for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < ns; j++) {
    const a = i * P + j, b = a + P;
    const g = classify ? classify((zs[i] + zs[i + 1]) / 2, -Math.PI / 2 + ((j + 0.5) / ns) * Math.PI * 2) : 0;
    lists[g].push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx = [];
  let start = 0;
  lists.forEach((l, gi) => {
    for (let k = 0; k < l.length; k++) idx.push(l[k]);
    geo.addGroup(start, l.length, gi);
    start += l.length;
  });
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // orientation check: the top-centre vertex of the middle station must face up
  const mid = Math.floor(zs.length / 2), jt = Math.round(ns / 2);
  if (geo.attributes.normal.getY(mid * P + jt) < 0) {
    const ia = geo.index.array;
    for (let k = 0; k < ia.length; k += 3) {
      const t = ia[k + 1];
      ia[k + 1] = ia[k + 2];
      ia[k + 2] = t;
    }
    geo.computeVertexNormals();
  }
  return geo;
}

// End cap fan closing the loft at station z.
function capGeometry(z, ns, pointFn, facing) {
  const pos = [], idx = [];
  const v = new THREE.Vector3();
  let cx = 0, cy = 0;
  const ring = [];
  for (let j = 0; j < ns; j++) {
    pointFn(z, -Math.PI / 2 + (j / ns) * Math.PI * 2, v);
    ring.push(v.clone());
    cx += v.x; cy += v.y;
  }
  pos.push(cx / ns, cy / ns, z);
  for (const p of ring) pos.push(p.x, p.y, p.z);
  for (let j = 0; j < ns; j++) {
    const a = 1 + j, b = 1 + ((j + 1) % ns);
    if (facing > 0) idx.push(0, a, b);
    else idx.push(0, b, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (Math.sign(g.attributes.normal.getZ(0)) !== Math.sign(facing)) {
    g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]]));
    g.computeVertexNormals();
  }
  const uv = new Float32Array((ns + 1) * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Patch conforming to the body: u along phi (p0 → p1), v along z (z0 → z1).
function bodyPatch(z0, z1, p0, p1, nz, np, off = 0.004, fn = bodyPoint) {
  const pos = new Float32Array((nz + 1) * (np + 1) * 3);
  const uv = new Float32Array((nz + 1) * (np + 1) * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), d1 = new THREE.Vector3(), d2 = new THREE.Vector3();
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= np; j++) {
    const z = lerp(z0, z1, i / nz), p = lerp(p0, p1, j / np);
    fn(z, p, a);
    fn(z + 0.002, p, b);
    fn(z, p + 0.002, c);
    d1.subVectors(b, a);
    d2.subVectors(c, a);
    n.crossVectors(d2, d1).normalize();
    // outward: away from the section centre line
    const S = section(z);
    if (a.x * n.x + (a.y - S.cy) * n.y + a.z * 0.5 * n.z < 0) n.negate();
    const o = i * (np + 1) + j;
    pos[o * 3] = a.x + n.x * off;
    pos[o * 3 + 1] = a.y + n.y * off;
    pos[o * 3 + 2] = a.z + n.z * off;
    uv[o * 2] = j / np;
    uv[o * 2 + 1] = i / nz;
  }
  const idx = [];
  for (let i = 0; i < nz; i++) for (let j = 0; j < np; j++) {
    const q = i * (np + 1) + j, r = q + np + 1;
    idx.push(q, q + 1, r, q + 1, r + 1, r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure faces point outward
  const mi = Math.floor(nz / 2) * (np + 1) + Math.floor(np / 2);
  const px = pos[mi * 3], py = pos[mi * 3 + 1], pz = pos[mi * 3 + 2];
  const S = section(pz);
  const nn = g.attributes.normal;
  if (px * nn.getX(mi) + (py - S.cy) * nn.getY(mi) + pz * 0.5 * nn.getZ(mi) < 0) {
    const ia = g.index.array;
    for (let k = 0; k < ia.length; k += 3) {
      const t = ia[k + 1];
      ia[k + 1] = ia[k + 2];
      ia[k + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

// ------------------------------------------------------------------ shared materials
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const flake = T.flakeNormalMap();
  flake.repeat.set(5, 5);
  const carbon = T.carbonTexture();
  carbon.repeat.set(6, 6);
  const honey = T.honeycombTexture();
  honey.repeat.set(3, 2);
  const head = T.headlightTextures();
  const tail = T.taillightTextures();
  SHARED = {
    flake,
    head,
    tail,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x07090c, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7 }),
    trim: new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.1, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    carbon: new THREE.MeshPhysicalMaterial({ map: carbon, color: 0xffffff, metalness: 0.25, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.06 }),
    grille: new THREE.MeshStandardMaterial({ map: honey, color: 0xffffff, metalness: 0.4, roughness: 0.6 }),
    under: new THREE.MeshStandardMaterial({ color: 0x060607, metalness: 0, roughness: 0.9 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0d0d0e, metalness: 0, roughness: 0.8, side: THREE.DoubleSide }),
    rimInner: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.8, roughness: 0.45, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x55575b, metalness: 0.9, roughness: 0.32 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: 0xd0d4da, metalness: 1, roughness: 0.12, clearcoat: 0.5 }),
    exhaustIn: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    mirror: new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.05 }),
    gap: new THREE.MeshBasicMaterial({ color: 0x010101 }),
    shadowTex: T.softRectTexture(128, 0.5),
    glowTex: T.radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.55)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]),
    beamTex: beamTexture(),
    blurTex: wheelBlurTexture(),
    geo: buildSharedGeometry(),
  };
  return SHARED;
}

function beamTexture() {
  const w = 128, h = 256, c = T.makeCanvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 1 - y / (h - 1); // 0 near the car (bottom), 1 far (top)
    const u = (x / (w - 1)) * 2 - 1;
    const spread = 0.25 + v * 0.75;
    const lat = Math.max(0, 1 - Math.pow(Math.abs(u) / spread, 2.5));
    const fall = Math.pow(1 - v, 1.4) * Math.min(1, v * 10);
    const a = lat * fall;
    const i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// What multi-spoke rims look like at speed: a soft radial smear instead of strobing spokes.
function wheelBlurTexture() {
  const s = 256, c = T.makeCanvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#3a3c40');
  g.addColorStop(0.3, '#55585d');
  g.addColorStop(0.34, '#8e9298');
  g.addColorStop(0.62, '#6f7378');
  g.addColorStop(0.86, '#9a9ea4');
  g.addColorStop(0.93, '#2b2c2f');
  g.addColorStop(1, '#c9ccd1');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (let r = 20; r < s / 2; r += 5) {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildSharedGeometry() {
  const NS = 84;
  const zs = stationsBody();
  const body = loft(zs, NS, bodyPoint);
  const capF = capGeometry(Z_NOSE, NS, bodyPoint, 1);
  const capR = capGeometry(Z_TAIL, NS, bodyPoint, -1);

  // cabin: 0 = paint, 1 = glass, 2 = black trim, 3 = chrome window surround
  const czs = [];
  for (let z = CZ0; z <= CZ1 + 1e-6; z += 0.025) czs.push(+z.toFixed(4));
  const classify = (z, phi) => {
    const yn = sgnPow(Math.sin(phi), 2 / 3.2);
    const xn = sgnPow(Math.cos(phi), 2 / 3.0);
    const ax = Math.abs(xn);
    if (yn < -0.35) return 0;
    if (z > 0.1) {
      if (ax < 0.8) return 1;
      return 2; // A-pillars
    }
    if (z < -1.02) {
      if (ax < 0.7 && yn > 0.15) return 1;
      return 0;
    }
    if (yn > 0.8 && ax < 0.86) return 0; // roof panel
    if (z > -0.44 && z < -0.38) return 2; // B-pillar
    if (ax > 0.55) {
      if (yn > 0.8) return 0;
      if (yn > 0.74 || z < -0.98 || z > 0.06) return 3; // chrome DLO surround
      return 1;
    }
    return 0;
  };
  const cabin = loft(czs, 96, cabinPoint, classify, 4);

  // undertray between the wheels (fills the wheel wells with darkness)
  const under = new THREE.BoxGeometry(1.36, 0.5, 4.1);
  under.translate(0, 0.42, 0);

  const head = [
    bodyPatch(1.84, 2.268, 0.04, 1.08, 18, 24, 0.005),
    bodyPatch(1.84, 2.268, Math.PI - 0.04, Math.PI - 1.08, 18, 24, 0.005),
  ];
  const tail = bodyPatch(-2.3, -2.04, 0.22, Math.PI - 0.22, 16, 64, 0.005);
  const grille = bodyPatch(1.98, 2.296, Math.PI + 0.5, Math.PI * 2 - 0.5, 14, 30, 0.004);
  const diffuser = bodyPatch(-2.3, -1.98, Math.PI + 0.42, Math.PI * 2 - 0.42, 14, 30, 0.004);
  const intakes = [
    bodyPatch(-0.92, -0.56, -0.18, 0.34, 10, 10, 0.004),
    bodyPatch(-0.92, -0.56, Math.PI + 0.18, Math.PI - 0.34, 10, 10, 0.004),
  ];
  const skirts = [
    bodyPatch(-0.9, 0.93, -0.78, -0.42, 30, 6, 0.004),
    bodyPatch(-0.9, 0.93, Math.PI + 0.78, Math.PI + 0.42, 30, 6, 0.004),
  ];
  // door shut lines
  const doorLines = [];
  for (const zl of [0.98, -0.82]) {
    doorLines.push(bodyPatch(zl - 0.004, zl + 0.004, -0.62, 1.0, 1, 30, 0.0015));
    doorLines.push(bodyPatch(zl - 0.004, zl + 0.004, Math.PI + 0.62, Math.PI - 1.0, 1, 30, 0.0015));
  }
  const hoodVents = [
    bodyPatch(1.2, 1.58, 1.18, 1.36, 8, 6, 0.003),
    bodyPatch(1.2, 1.58, Math.PI - 1.18, Math.PI - 1.36, 8, 6, 0.003),
  ];

  // rear wing
  const foil = new THREE.Shape();
  foil.moveTo(-0.16, 0.0);
  foil.bezierCurveTo(-0.12, 0.02, 0.05, 0.022, 0.16, 0.006);
  foil.lineTo(0.16, -0.004);
  foil.bezierCurveTo(0.05, -0.02, -0.1, -0.04, -0.16, -0.012);
  foil.closePath();
  const wing = new THREE.ExtrudeGeometry(foil, { depth: 1.78, bevelEnabled: false, curveSegments: 10 });
  wing.translate(0, 0, -0.89);
  wing.rotateY(Math.PI / 2);
  const plates = new THREE.BoxGeometry(0.01, 0.13, 0.3);
  const stand = new THREE.BoxGeometry(0.016, 0.13, 0.07);

  // wheel parts (left side; mirrored for the right)
  const tireProf = [[0.24, 0.128], [0.282, 0.137], [0.322, 0.134], [0.339, 0.122], [0.345, 0.1], [0.346, 0], [0.345, -0.1], [0.339, -0.122], [0.322, -0.134], [0.282, -0.137], [0.24, -0.128]];
  const tire = new THREE.LatheGeometry(tireProf.map(([r, y]) => new THREE.Vector2(r, y)), 56);
  tire.rotateZ(Math.PI / 2);
  const barrel = new THREE.CylinderGeometry(0.232, 0.232, 0.22, 40, 1, true);
  barrel.rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(0.229, 0.011, 8, 48);
  lip.rotateY(Math.PI / 2);
  lip.translate(0.112, 0, 0);
  const spokes = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + (k % 2 ? 0.1 : -0.1);
    const sp = new THREE.BoxGeometry(0.03, 0.17, 0.028);
    sp.translate(0, 0.142, 0);
    sp.rotateX(a);
    // dish: spokes lean outward toward the lip
    sp.translate(0.088, 0, 0);
    spokes.push(sp);
  }
  const face = new THREE.CylinderGeometry(0.075, 0.08, 0.04, 24);
  face.rotateZ(Math.PI / 2);
  face.translate(0.095, 0, 0);
  const cap = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 16);
  cap.rotateZ(Math.PI / 2);
  cap.translate(0.118, 0, 0);
  const blurDisc = new THREE.CircleGeometry(0.226, 40);
  blurDisc.rotateY(Math.PI / 2);
  blurDisc.translate(0.104, 0, 0);
  const disc = new THREE.CylinderGeometry(0.185, 0.185, 0.03, 36);
  disc.rotateZ(Math.PI / 2);
  disc.translate(0.01, 0, 0);
  const caliper = new THREE.BoxGeometry(0.06, 0.17, 0.1);
  caliper.translate(0.045, 0.15, -0.06);
  caliper.rotateX(0.5);

  const exhaust = new THREE.CylinderGeometry(0.052, 0.058, 0.16, 20, 1, true);
  exhaust.rotateX(Math.PI / 2);
  const exhaustInner = new THREE.CircleGeometry(0.048, 16);
  exhaustInner.rotateY(Math.PI);

  const mirrorHead = new THREE.SphereGeometry(1, 16, 10);
  mirrorHead.scale(0.07, 0.055, 0.12);
  const mirrorStalk = new THREE.BoxGeometry(0.12, 0.025, 0.05);

  const plate = new THREE.PlaneGeometry(0.42, 0.105);

  return { body, capF, capR, cabin, under, doorLines, head, tail, grille, diffuser, intakes, skirts, hoodVents, wing, plates, stand, tire, barrel, lip, spokes: mergeGeos(spokes), face, cap, disc, blurDisc, caliper, exhaust, exhaustInner, mirrorHead, mirrorStalk, plate };
}

function mergeGeos(list) {
  const pos = [], nrm = [], idx = [];
  let off = 0;
  for (const g0 of list) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let k = 0; k < p.length; k++) { pos.push(p[k]); nrm.push(n[k]); }
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setIndex(idx);
  return out;
}

// ------------------------------------------------------------------ car instance
export function createCar(opts = {}) {
  const S = shared();
  const G = S.geo;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: opts.paint ?? 0x123a8c,
    metalness: 0.6,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    normalMap: S.flake,
    normalScale: new THREE.Vector2(0.12, 0.12),
    envMapIntensity: 1.15,
  });
  const headMat = new THREE.MeshStandardMaterial({ map: S.head.map, emissiveMap: S.head.emissive, emissive: 0xffffff, emissiveIntensity: 7, alphaTest: 0.5, roughness: 0.08, metalness: 0.3, transparent: false });
  const tailMat = new THREE.MeshStandardMaterial({ map: S.tail.map, emissiveMap: S.tail.emissive, emissive: 0xffffff, emissiveIntensity: 3, alphaTest: 0.5, roughness: 0.15, metalness: 0.1 });
  const caliperMat = new THREE.MeshPhysicalMaterial({ color: opts.caliper ?? 0xc8161a, roughness: 0.35, clearcoat: 1 });
  const rimMat = new THREE.MeshPhysicalMaterial({ color: opts.rim ?? 0x8e939a, metalness: 1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const blurMat = new THREE.MeshStandardMaterial({ map: S.blurTex, color: new THREE.Color(opts.rim ?? 0x8e939a).lerp(new THREE.Color(0xffffff), 0.35), metalness: 0.85, roughness: 0.42 });
  const discMat = S.disc.clone();
  discMat.emissive = new THREE.Color(1.0, 0.22, 0.03);
  discMat.emissiveIntensity = 0;

  const add = (geo, mat, parent = body, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  add(G.body, paint);
  add(G.capF, paint);
  add(G.capR, paint);
  add(G.cabin, [paint, S.glass, S.trim, S.chrome]);
  for (const g of G.doorLines) add(g, S.gap, body, false);
  add(G.under, S.under);
  for (const g of G.head) add(g, headMat, body, false);
  add(G.tail, tailMat, body, false);
  add(G.grille, S.grille, body, false);
  add(G.diffuser, S.carbon, body, false);
  for (const g of G.skirts) add(g, S.carbon, body, false);
  for (const g of G.hoodVents) add(g, S.grille, body, false);

  // rear wing on stanchions
  if (opts.wing !== false) {
    const wing = add(G.wing, opts.wingPaint ? paint : S.carbon);
    wing.position.set(0, 1.14, -2.0);
    wing.rotation.x = -0.06;
    for (const sx of [-0.89, 0.89]) {
      const p = add(G.plates, S.carbon);
      p.position.set(sx, 1.12, -2.01);
    }
    for (const sx of [-0.42, 0.42]) {
      const st = add(G.stand, S.trim);
      st.position.set(sx, 1.06, -1.97);
    }
  }
  // splitter lip
  const splitter = add(new THREE.BoxGeometry(1.46, 0.02, 0.28), S.carbon);
  splitter.position.set(0, 0.15, 1.98);

  // exhausts
  const exhaustLocal = [];
  for (const sx of [-0.5, -0.36, 0.36, 0.5]) {
    const e = add(G.exhaust, S.chrome, body, false);
    e.position.set(sx, 0.3, -2.22);
    const ei = add(G.exhaustInner, S.exhaustIn, body, false);
    ei.position.set(sx, 0.3, -2.25);
    exhaustLocal.push(new THREE.Vector3(sx, 0.3, -2.33));
  }
  // mirrors
  for (const sd of [1, -1]) {
    const mh = add(G.mirrorHead, paint);
    mh.position.set(sd * 1.0, 1.0, 0.5);
    const glassM = add(new THREE.PlaneGeometry(0.1, 0.07), S.mirror, body, false);
    glassM.position.set(sd * 1.0, 1.0, 0.379);
    glassM.rotation.y = Math.PI;
    const ms = add(G.mirrorStalk, S.trim);
    ms.position.set(sd * 0.92, 0.97, 0.52);
  }
  // number plate
  if (opts.plate) {
    const pl = new THREE.Mesh(G.plate, new THREE.MeshStandardMaterial({ map: T.plateTexture(opts.plate), roughness: 0.4 }));
    pl.position.set(0, 0.6, -2.305);
    pl.rotation.y = Math.PI;
    body.add(pl);
  }

  // wheels
  const wheels = [];
  for (const [isFront, sd] of [[true, 1], [true, -1], [false, 1], [false, -1]]) {
    const wr = new THREE.Group();
    wr.position.set(sd * CAR.trackHalf, CAR.wheelR, isFront ? CAR.frontZ : CAR.rearZ);
    const steer = new THREE.Group();
    wr.add(steer);
    const mir = new THREE.Group();
    mir.scale.x = sd;
    steer.add(mir);
    const spin = new THREE.Group();
    mir.add(spin);
    add(G.tire, S.tire, spin);
    add(G.barrel, S.rimInner, spin, false);
    add(G.lip, rimMat, spin, false);
    const spokes = add(G.spokes, rimMat, spin);
    const face = add(G.face, rimMat, spin, false);
    const capM = add(G.cap, S.trim, spin, false);
    const blur = add(G.blurDisc, blurMat, spin, false);
    blur.visible = false;
    add(G.disc, discMat, spin, false);
    add(G.caliper, caliperMat, mir, false);
    root.add(wr);
    wheels.push({ root: wr, steer, spin, isFront, side: sd, angle: 0, sharp: [spokes, face, capM], blur });
  }

  // contact shadow + underglow decals (not mirrored in reflections)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 5.0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, map: S.shadowTex, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  );
  shadow.position.y = 0.02;
  shadow.layers.set(1);
  shadow.renderOrder = 2;
  root.add(shadow);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: S.shadowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 6.0).rotateX(-Math.PI / 2), glowMat);
  glow.position.y = 0.025;
  glow.layers.set(1);
  glow.renderOrder = 3;
  glow.visible = false;
  root.add(glow);

  // fake headlight beams on the road (used for rivals; the player gets real spot lights)
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.85, 0.75).multiplyScalar(0.55), map: S.beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 24).rotateX(-Math.PI / 2), beamMat);
  beam.position.set(0, 0.03, 2.3 + 12);
  beam.layers.set(1);
  beam.renderOrder = 3;
  root.add(beam);

  // light glows (billboards) for headlights / tail lights
  const mkGlow = (color, size) => {
    const m = new THREE.SpriteMaterial({ map: S.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(m);
    sp.scale.set(size, size, 1);
    body.add(sp);
    return sp;
  };
  const headGlows = [mkGlow(new THREE.Color(1.6, 1.6, 1.7), 0.55), mkGlow(new THREE.Color(1.6, 1.6, 1.7), 0.55)];
  headGlows[0].position.set(0.68, 0.72, 2.2);
  headGlows[1].position.set(-0.68, 0.72, 2.2);
  const tailGlows = [mkGlow(new THREE.Color(2.5, 0.1, 0.05), 0.7), mkGlow(new THREE.Color(2.5, 0.1, 0.05), 0.7), mkGlow(new THREE.Color(2.5, 0.1, 0.05), 0.7)];
  tailGlows[0].position.set(0.72, 0.8, -2.28);
  tailGlows[1].position.set(-0.72, 0.8, -2.28);
  tailGlows[2].position.set(0, 0.8, -2.3);

  const state = { brake: 0, reverse: 0, glowColor: null, roll: 0, pitch: 0, heave: 0, rollV: 0, pitchV: 0 };
  const tmpV = new THREE.Vector3();

  const car = {
    root, body, wheels, paint, headMat, tailMat, beam, beamMat, shadow, glow, exhaustLocal,
    headGlows, tailGlows,
    setPaint(hex) { paint.color.set(hex); },
    setUnderglow(color) {
      if (!color) { glow.visible = false; return; }
      glow.visible = true;
      glowMat.color.set(color).multiplyScalar(0.55);
    },
    // speed (m/s), steer (rad), wheelOmega (rad/s), ax / ay (m/s²) in car frame, brake 0..1
    update(dt, s, camera) {
      const omega = s.wheelOmega ?? s.speed / CAR.wheelR;
      const blurred = Math.abs(omega) > 38;
      for (const w of wheels) {
        w.angle += omega * dt;
        w.spin.rotation.x = w.angle;
        if (w.isFront) w.steer.rotation.y = s.steer;
        if (w.blur.visible !== blurred) {
          w.blur.visible = blurred;
          for (const m of w.sharp) m.visible = !blurred;
        }
      }
      // brake discs glow after hard stops from speed
      const spd = Math.abs(s.speed ?? omega * CAR.wheelR);
      state.heat = Math.min(1.6, (state.heat || 0) * Math.exp(-dt * 0.35) + (s.heatBrake ?? s.brake ?? 0) * spd * spd * dt * 0.00012);
      discMat.emissiveIntensity = Math.max(0, state.heat - 0.25) * 3;
      // spring-damper body motion driven by accelerations
      const kRoll = 0.0095, kPitch = 0.0085;
      const targetRoll = clamp(-(s.ay ?? 0) * kRoll, -0.07, 0.07);
      const targetPitch = clamp((s.ax ?? 0) * kPitch, -0.05, 0.05);
      state.rollV += ((targetRoll - state.roll) * 140 - state.rollV * 14) * dt;
      state.roll += state.rollV * dt;
      state.pitchV += ((targetPitch - state.pitch) * 160 - state.pitchV * 15) * dt;
      state.pitch += state.pitchV * dt;
      body.rotation.z = state.roll;
      body.rotation.x = state.pitch;
      body.position.y = (s.bump ?? 0) - Math.abs(state.roll) * 0.25;
      // lights
      const br = s.brake ?? 0;
      state.brake = damp(state.brake, br, 20, dt);
      tailMat.emissiveIntensity = 2.6 + state.brake * 9;
      for (const g of tailGlows) {
        const k = 0.45 + state.brake * 1.6;
        g.material.color.setRGB(2.5 * k, 0.09 * k, 0.04 * k);
      }
      if (camera) {
        // fade glows by facing: head glows only seen from the front, tail glows from behind
        tmpV.setFromMatrixPosition(camera.matrixWorld).sub(root.position);
        const near = clamp((tmpV.length() - 3.2) * 0.8, 0, 1); // bonnet / bumper cams sit inside the glow
        tmpV.normalize();
        const fwdX = Math.sin(root.rotation.y), fwdZ = Math.cos(root.rotation.y);
        const facing = tmpV.x * fwdX + tmpV.z * fwdZ;
        const hf = clamp((facing - 0.1) * 1.6, 0, 1) * near, tf = clamp((-facing - 0.05) * 1.6, 0, 1) * near;
        for (const g of headGlows) g.material.opacity = hf;
        for (const g of tailGlows) g.material.opacity = tf;
      }
    },
  };
  return car;
}
