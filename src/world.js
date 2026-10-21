// The city around the circuit: sky, environment lighting, buildings, neon, harbour and skyline.
import * as THREE from 'three';
import { ROAD_HALF, SIDEWALK_OUT } from './trackdata.js';
import { createBuildingMaterial, createSkyMaterial } from './materials.js';
import * as T from './textures.js';
import { mulberry32, clamp, lerp } from './util.js';

export const HARBOUR_X = -378;

export function buildWorld(scene, renderer, data, trackInfo) {
  const rnd = mulberry32(20261020);
  const moonDir = new THREE.Vector3(-0.42, 0.38, -0.62).normalize();
  const updaters = [];

  // ---------------------------------------------------------------- sky + fog
  const skyMat = createSkyMaterial(moonDir);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.055, 0.035, 0.032), 0.00105);
  scene.background = null;

  // ---------------------------------------------------------------- environment (reflections on paint and glass)
  const envTex = buildEnvironment(renderer, moonDir);
  scene.environment = envTex;

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(new THREE.Color(0.32, 0.38, 0.55), new THREE.Color(0.12, 0.08, 0.06), 0.2);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(new THREE.Color(0.62, 0.72, 1.0), 0.32);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 260;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  scene.add(moon, moon.target);

  // ---------------------------------------------------------------- ground + harbour water
  const b = data.bounds();
  {
    const w = 3200, x0 = HARBOUR_X;
    const g = new THREE.PlaneGeometry(w, 5200);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.9, metalness: 0 });
    const m = new THREE.Mesh(g, mat);
    m.position.set(x0 + w / 2, -0.03, (b.minZ + b.maxZ) / 2);
    m.receiveShadow = true;
    m.layers.set(1);
    scene.add(m);
    // quay wall
    const quay = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.2, 3000), new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.9 }));
    quay.position.set(x0 + 1.0, -1.1, (b.minZ + b.maxZ) / 2);
    scene.add(quay);
  }
  const waterMat = createWaterMaterial();
  {
    const g = new THREE.PlaneGeometry(2600, 5200, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, waterMat);
    m.position.set(HARBOUR_X - 1300, -0.9, (b.minZ + b.maxZ) / 2);
    m.layers.set(1);
    scene.add(m);
  }

  // ---------------------------------------------------------------- buildings
  const bldMat = createBuildingMaterial();
  const blds = [];
  const occ = new Occupancy(b.minX - 900, b.minZ - 900, b.maxX + 900, b.maxZ + 900, 4);
  const inBridge = (x, z) => {
    for (const r of trackInfo.bridgeRects) {
      const dx = x - r.x, dz = z - r.z;
      const along = dx * r.ax + dz * r.az;
      const perp = -dx * r.az + dz * r.ax;
      if (Math.abs(along) < r.halfLen && Math.abs(perp) < r.halfW) return true;
    }
    return false;
  };
  const footprint = (cx, cz, w, d, yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw), pts = [];
    for (let a = -0.5; a <= 0.5001; a += 0.25) for (let bb = -0.5; bb <= 0.5001; bb += 0.25) {
      const lx = a * w, lz = bb * d;
      pts.push([cx + lx * c + lz * s, cz - lx * s + lz * c]);
    }
    return pts;
  };
  const tryPlace = (cx, cz, w, d, h, yaw, clear, extra = {}) => {
    if (cx < HARBOUR_X + 6 + Math.max(w, d) * 0.5 && !extra.allowWater) return false;
    const pts = footprint(cx, cz, w, d, yaw);
    for (const [x, z] of pts) {
      if (data.distanceToTrack(x, z, clear + 30) < clear) return false;
      if (inBridge(x, z)) return false;
    }
    if (!occ.free(cx, cz, w, d, yaw)) return false;
    occ.mark(cx, cz, w, d, yaw);
    blds.push({ x: cx, z: cz, w, d, h, yaw, ...extra });
    return true;
  };

  const clearTrack = SIDEWALK_OUT + 1.2;
  // frontage: a continuous wall of facades lining the circuit
  const frontage = [];
  for (const side of [1, -1]) {
    let s = rnd() * 10;
    while (s < data.length) {
      const along = 14 + rnd() * 22;
      const depth = 14 + rnd() * 18;
      const sm = s + along / 2;
      if (data.inTunnel(sm) || data.inTunnel(sm - along / 2) || data.inTunnel(sm + along / 2)) { s += along; continue; }
      const f = data.sample(sm);
      const off = SIDEWALK_OUT + 1.6 + depth / 2 + rnd() * 3;
      const cx = f.x + f.lx * side * off, cz = f.z + f.lz * side * off;
      const tall = rnd();
      const h = tall > 0.92 ? 70 + rnd() * 60 : tall > 0.65 ? 32 + rnd() * 30 : 12 + rnd() * 22;
      if (tryPlace(cx, cz, depth, along, h, f.heading, clearTrack, { front: true, side, s: sm })) {
        frontage.push(blds[blds.length - 1]);
      }
      s += along + 0.5 + rnd() * 3;
    }
  }
  // blocks filling the infield and the city beyond
  const cityC = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  for (let gx = b.minX - 520; gx < b.maxX + 520; gx += 46) {
    for (let gz = b.minZ - 520; gz < b.maxZ + 520; gz += 46) {
      const cx = gx + (rnd() - 0.5) * 10, cz = gz + (rnd() - 0.5) * 10;
      const w = 18 + rnd() * 20, d = 18 + rnd() * 20;
      const dc = Math.hypot(cx - cityC.x, cz - cityC.z);
      let h = 14 + rnd() * 30;
      if (rnd() < 0.35) h += rnd() * 60 * clamp(1 - dc / 700, 0.2, 1);
      if (dc < 220 && rnd() < 0.5) h = 70 + rnd() * 110; // downtown towers in the infield
      tryPlace(cx, cz, w, d, h, (rnd() - 0.5) * 0.08, ROAD_HALF + 24);
    }
  }
  // distant skyline ring (across the bay too)
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1150 + rnd() * 700;
    const cx = cityC.x + Math.cos(a) * r, cz = cityC.z + Math.sin(a) * r;
    const w = 25 + rnd() * 40, d = 25 + rnd() * 40;
    const h = 50 + Math.pow(rnd(), 1.5) * 230;
    tryPlace(cx, cz, w, d, h, rnd() * Math.PI, 60, { allowWater: true, far: true });
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(box, bldMat, blds.length);
  const aBld = new Float32Array(blds.length * 4);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const palette = [
    [0.13, 0.125, 0.12], [0.1, 0.105, 0.115], [0.15, 0.135, 0.12], [0.07, 0.08, 0.09], [0.18, 0.165, 0.145],
    [0.06, 0.065, 0.075], [0.12, 0.105, 0.095], [0.14, 0.145, 0.15],
  ];
  const col = new THREE.Color();
  blds.forEach((bd, i) => {
    q.setFromAxisAngle(up, bd.yaw);
    p.set(bd.x, 0, bd.z);
    s3.set(bd.w, bd.h, bd.d);
    inst.setMatrixAt(i, m4.compose(p, q, s3));
    const pc = palette[Math.floor(rnd() * palette.length)];
    const k = 0.75 + rnd() * 0.4;
    col.setRGB(pc[0] * k, pc[1] * k, pc[2] * k);
    inst.setColorAt(i, col);
    const style = bd.h > 60 && rnd() < 0.6 ? 0.8 + rnd() * 0.2 : rnd();
    aBld[i * 4] = rnd() * 100;
    aBld[i * 4 + 1] = style;
    aBld[i * 4 + 2] = 0.12 + rnd() * 0.42;
    aBld[i * 4 + 3] = 0;
  });
  box.setAttribute('aBld', new THREE.InstancedBufferAttribute(aBld, 4));
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = true;
  inst.receiveShadow = true;
  scene.add(inst);

  // ---------------------------------------------------------------- rooftop aviation beacons
  {
    const tall = blds.filter((bd) => bd.h > 75);
    const g = new THREE.SphereGeometry(0.6, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 0.4, 0.2) });
    const beacons = new THREE.InstancedMesh(g, mat, tall.length);
    tall.forEach((bd, i) => beacons.setMatrixAt(i, new THREE.Matrix4().makeTranslation(bd.x, bd.h + 1.2, bd.z)));
    scene.add(beacons);
    updaters.push((t) => {
      const on = Math.sin(t * 2.2) > 0.55 ? 1 : 0.04;
      mat.color.setRGB(12 * on, 0.4 * on, 0.2 * on);
    });
  }

  // ---------------------------------------------------------------- neon signs + billboards on the frontage
  const signs = buildSigns(scene, frontage, data, rnd, updaters);

  // ---------------------------------------------------------------- harbour: distant suspension bridge + cranes
  buildHarbour(scene, b, rnd, updaters);

  return {
    hemiBase: hemi.intensity, moonBase: moon.intensity,
    sky, skyMat, hemi, moon, moonDir, bldMat, waterMat, envTex, buildings: blds, signs,
    update(t, camera) {
      sky.position.copy(camera.position);
      skyMat.uniforms.uTime.value = t;
      bldMat.userData.uniforms.uTime.value = t;
      waterMat.userData.uniforms.uTime.value = t;
      for (const u of updaters) u(t);
    },
  };
}

class Occupancy {
  constructor(x0, z0, x1, z1, cell) {
    this.x0 = x0; this.z0 = z0; this.cell = cell;
    this.w = Math.ceil((x1 - x0) / cell);
    this.h = Math.ceil((z1 - z0) / cell);
    this.bits = new Uint8Array(this.w * this.h);
  }
  cells(cx, cz, w, d, yaw, fn) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const step = this.cell * 0.7;
    for (let a = -w / 2; a <= w / 2; a += step) for (let b = -d / 2; b <= d / 2; b += step) {
      const x = cx + a * c + b * s, z = cz - a * s + b * c;
      const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      if (fn(j * this.w + i) === false) return false;
    }
    return true;
  }
  free(cx, cz, w, d, yaw) {
    return this.cells(cx, cz, w + 3, d + 3, yaw, (k) => (this.bits[k] ? false : true));
  }
  mark(cx, cz, w, d, yaw) {
    this.cells(cx, cz, w, d, yaw, (k) => { this.bits[k] = 1; });
  }
}

const NEON_H = ['KAIJU RAMEN', 'OPEN 24H', 'HOTEL ORBIT', 'KARAOKE', 'NOODLE BAR', 'GARAGE 88', 'CLUB VOLT', 'SUSHI', 'ARCADE', 'LIVE MUSIC', 'MOTEL', 'BAR LUNA', 'DINER', 'TATTOO', 'PHARMACY', 'NIGHT OWL', 'GYOZA', 'JAZZ'];
const NEON_V = ['ホテル', 'ラーメン', 'カラオケ', '居酒屋', '電気', 'BAR', '寿司', '薬局', '酒', 'CAFE', '夜'];
const NEON_COLS = ['#ff2fa0', '#22e6ff', '#ffb52e', '#ff4040', '#4dff88', '#a46bff', '#fff2e0', '#ff7a1a'];

function buildSigns(scene, frontage, data, rnd, updaters) {
  const texCache = new Map();
  const getNeon = (text, color, vertical) => {
    const key = `${text}|${color}|${vertical}`;
    if (!texCache.has(key)) texCache.set(key, T.neonTexture(text, color, { vertical, size: vertical ? 110 : 120 }));
    return texCache.get(key);
  };
  const flicker = [];
  const billboards = ['volt', 'ramen', 'radio', 'tyres', 'hotel'].map((k) => T.billboardTexture(k));
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.6, metalness: 0.6 });
  let bbIdx = 0;
  frontage.forEach((bd, i) => {
    // the facade facing the road: building local +x or -x depending on side
    const yaw = bd.yaw;
    const nx = Math.cos(yaw), nz = -Math.sin(yaw); // local +x in world
    const toRoad = -bd.side; // left side buildings face -left, which is local -x
    const fx = nx * toRoad, fz = nz * toRoad;
    const faceX = bd.x + fx * (bd.w / 2 + 0.06), faceZ = bd.z + fz * (bd.w / 2 + 0.06);
    const tx = Math.sin(yaw), tz = Math.cos(yaw); // along the track
    const r = rnd();
    if (r < 0.34) {
      // horizontal sign flat on the facade
      const text = NEON_H[Math.floor(rnd() * NEON_H.length)];
      const color = NEON_COLS[Math.floor(rnd() * NEON_COLS.length)];
      const { texture, aspect } = getNeon(text, color, false);
      const h = 1.6 + rnd() * 1.6;
      const w = Math.min(bd.d * 0.8, h * aspect);
      const hh = w / aspect;
      const mat = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(3.2, 3.2, 3.2) });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
      const y = Math.min(bd.h - hh, 4.8 + rnd() * Math.min(10, bd.h * 0.3));
      const along = (rnd() - 0.5) * (bd.d - w) * 0.8;
      m.position.set(faceX + tx * along, y + hh / 2, faceZ + tz * along);
      m.lookAt(m.position.x + fx, m.position.y, m.position.z + fz);
      scene.add(m);
      if (rnd() < 0.18) flicker.push({ mat, phase: rnd() * 100, base: 3.2 });
    } else if (r < 0.62) {
      // vertical blade sign sticking out from the facade (reads down the street)
      const text = NEON_V[Math.floor(rnd() * NEON_V.length)];
      const color = NEON_COLS[Math.floor(rnd() * NEON_COLS.length)];
      const { texture, aspect } = getNeon(text, color, true);
      const hh = Math.min(bd.h * 0.7, 5 + rnd() * 5);
      const w = hh * aspect;
      const mat = new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(3.4, 3.4, 3.4), side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
      const along = (rnd() - 0.5) * bd.d * 0.7;
      const out = w / 2 + 0.3;
      m.position.set(faceX + tx * along + fx * out, 5 + rnd() * 4 + hh / 2, faceZ + tz * along + fz * out);
      m.lookAt(m.position.x + tx, m.position.y, m.position.z + tz);
      scene.add(m);
      if (rnd() < 0.15) flicker.push({ mat, phase: rnd() * 100, base: 3.4 });
    } else if (r < 0.72 && bd.h < 40) {
      // rooftop billboard with its frame
      const tex = billboards[bbIdx++ % billboards.length];
      const w = Math.min(18, bd.d * 0.9), hh = w / 2;
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
      // face oncoming traffic a little rather than straight across the road
      const ang = Math.atan2(fx, fz) + (bd.side > 0 ? 0.5 : -0.5);
      m.position.set(bd.x + fx * (bd.w / 2 - 2), bd.h + 2.2 + hh / 2, bd.z + fz * (bd.w / 2 - 2));
      m.rotation.y = ang;
      scene.add(m);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, hh + 0.6, 0.4), frameMat);
      fr.position.copy(m.position);
      fr.rotation.y = ang;
      fr.translateZ(-0.25);
      scene.add(fr);
      for (const sx of [-w / 3, w / 3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), frameMat);
        leg.position.copy(fr.position);
        leg.rotation.y = ang;
        leg.translateX(sx);
        leg.position.y = bd.h + 1.1;
        scene.add(leg);
      }
    }
  });
  updaters.push((t) => {
    for (const f of flicker) {
      const n = Math.sin(t * 23 + f.phase) * Math.sin(t * 7.3 + f.phase * 1.7);
      const on = n > 0.82 ? 0.15 : 1;
      f.mat.color.setScalar(f.base * on);
    }
  });
  return { count: frontage.length };
}

function buildHarbour(scene, b, rnd, updaters) {
  // far suspension bridge across the bay: towers + catenary light chains
  const x = HARBOUR_X - 1100;
  const z0 = b.minZ - 1500, z1 = b.maxZ + 900;
  const towers = [z0 + (z1 - z0) * 0.3, z0 + (z1 - z0) * 0.7];
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.7 });
  for (const tz of towers) {
    for (const dx of [-14, 14]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(6, 170, 6), towerMat);
      t.position.set(x + dx, 85, tz);
      scene.add(t);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(34, 5, 5), towerMat);
    cross.position.set(x, 150, tz);
    scene.add(cross);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 3, z1 - z0), towerMat);
  deck.position.set(x, 40, (z0 + z1) / 2);
  scene.add(deck);
  const pts = [];
  const cable = (za, zb, ya, yb, sag) => {
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const z = lerp(za, zb, t);
      const y = lerp(ya, yb, t) - sag * 4 * t * (1 - t);
      pts.push([z, y]);
    }
  };
  cable(z0, towers[0], 48, 168, 40);
  cable(towers[0], towers[1], 168, 168, 120);
  cable(towers[1], z1, 168, 48, 40);
  const g = new THREE.SphereGeometry(1.4, 6, 4);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.5, 3.5) });
  const inst = new THREE.InstancedMesh(g, mat, pts.length * 2);
  let n = 0;
  for (const [z, y] of pts) for (const dx of [-14, 14]) inst.setMatrixAt(n++, new THREE.Matrix4().makeTranslation(x + dx, y, z));
  scene.add(inst);
  // deck lights
  const dl = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 1.2) }), 120);
  for (let i = 0; i < 120; i++) dl.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x + (i % 2 ? 15 : -15), 42.5, lerp(z0, z1, Math.floor(i / 2) / 59)));
  scene.add(dl);
  // container cranes on the near shore with warning lights
  const craneMat = new THREE.MeshStandardMaterial({ color: 0x6b2a1d, roughness: 0.7 });
  const warn = new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 0.5, 0.2) });
  for (let i = 0; i < 4; i++) {
    const cz = b.minZ - 200 + i * 230 + rnd() * 40;
    const cx = HARBOUR_X - 60 - rnd() * 40;
    const grp = new THREE.Group();
    for (const [lx, lz] of [[-8, -6], [8, -6], [-8, 6], [8, 6]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 42, 1.2), craneMat);
      leg.position.set(lx, 21, lz);
      grp.add(leg);
    }
    const boom = new THREE.Mesh(new THREE.BoxGeometry(70, 2.5, 3), craneMat);
    boom.position.set(-18, 44, 0);
    grp.add(boom);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 4), warn);
    tip.position.set(-52, 46, 0);
    grp.add(tip);
    grp.position.set(cx, -0.9, cz);
    scene.add(grp);
  }
  updaters.push((t) => {
    const on = Math.sin(t * 1.7 + 1.0) > 0.6 ? 1 : 0.05;
    warn.color.setRGB(10 * on, 0.5 * on, 0.2 * on);
  });
}

function createWaterMaterial() {
  const uniforms = {
    uReflTex: { value: null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflOn: { value: 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0x03070b, roughness: 0.08, metalness: 0, envMapIntensity: 0.5 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform mat4 uReflMatrix;
varying vec3 vWPos;
varying vec4 vReflCoord;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vec4 wwp = modelMatrix * vec4(transformed, 1.0);
vWPos = wwp.xyz;
vReflCoord = uReflMatrix * vec4(wwp.x, 0.0, wwp.z, 1.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uReflTex;
uniform float uReflOn;
uniform float uTime;
varying vec3 vWPos;
varying vec4 vReflCoord;
float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <opaque_fragment>', `
{
  vec3 Vv = normalize(cameraPosition - vWPos);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(Vv.y, 0.0, 1.0), 5.0);
  if (uReflOn > 0.5) {
    vec2 w = vWPos.xz;
    vec2 rp = vReflCoord.xy / vReflCoord.w;
    vec2 jit = vec2(wNoise(w * 0.09 + vec2(uTime * 0.25, 0.0)) - 0.5, wNoise(w * 0.07 - vec2(0.0, uTime * 0.2) + 5.0) - 0.5) * 0.035;
    jit.x += sin(w.y * 0.6 + uTime * 1.1) * 0.0025;
    vec3 refl = vec3(0.0);
    for (int i = -3; i <= 3; i++) refl += texture2D(uReflTex, rp + jit + vec2(0.0, float(i) * 0.006)).rgb;
    refl /= 7.0;
    outgoingLight = outgoingLight * (1.0 - fres) + refl * fres * 0.92;
  }
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'water-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}

function buildEnvironment(renderer, moonDir) {
  const envScene = new THREE.Scene();
  const skyMat = createSkyMaterial(moonDir);
  skyMat.uniforms.uBoost.value = 1.8;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), skyMat);
  envScene.add(sky);
  const rnd = mulberry32(99);
  const warm = new THREE.Color(1.0, 0.62, 0.32), cool = new THREE.Color(0.55, 0.72, 1.0), pink = new THREE.Color(1.0, 0.25, 0.6);
  // lit city blocks around the horizon
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + rnd() * 0.05;
    const dist = 40 + rnd() * 12;
    const h = 2 + rnd() * 16, w = 2 + rnd() * 6;
    const c = rnd() < 0.6 ? warm.clone() : rnd() < 0.8 ? cool.clone() : pink.clone();
    c.multiplyScalar(0.25 + rnd() * rnd() * 2.2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(Math.cos(a) * dist, h / 2 - 1.5, Math.sin(a) * dist);
    m.lookAt(0, h / 2 - 1.5, 0);
    envScene.add(m);
  }
  // overhead street-lamp rows: give long glinting highlights on roofs and bonnets
  for (let i = -4; i <= 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.2), new THREE.MeshBasicMaterial({ color: warm.clone().multiplyScalar(14), side: THREE.DoubleSide }));
    m.rotation.x = Math.PI / 2;
    for (const side of [-7, 7]) {
      const mm = m.clone();
      mm.position.set(side, 10, i * 9);
      envScene.add(mm);
    }
  }
  // a broad soft panel overhead (sky glow)
  const top = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.06, 0.1), side: THREE.DoubleSide }));
  top.rotation.x = Math.PI / 2;
  top.position.y = 30;
  envScene.add(top);
  // dark ground so the lower hemisphere stays dim
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.018, 0.016, 0.016), side: THREE.DoubleSide }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.6;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02, 0.1, 200);
  pmrem.dispose();
  return rt.texture;
}
