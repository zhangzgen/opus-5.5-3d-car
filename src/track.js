// Track geometry: road surface, barriers, sidewalks, street lamps, tunnel, bridges, start gantry.
import * as THREE from 'three';
import { ROAD_HALF, WALL_D, SIDEWALK_IN, SIDEWALK_OUT } from './trackdata.js';
import { createRoadMaterial, createConeMaterial } from './materials.js';
import * as T from './textures.js';
import { smoothstep, clamp } from './util.js';

const LAMP_POLE_D = ROAD_HALF + 2.1;
const LAMP_HEAD_D = ROAD_HALF - 1.2;
const LAMP_H = 9.3;

export function buildTrack(data) {
  const group = new THREE.Group();
  group.name = 'track';
  const lightCandidates = [];
  const { N, ds, length: L } = data;

  // ------------------------------------------------------------------ road surface
  const roadMat = createRoadMaterial(data);
  const lampMask = new Float64Array(N);
  for (let i = 0; i < N; i++) lampMask[i] = data.lampBlocked(i * ds) ? 0 : 1;
  const lampMaskS = data.smoothArray(lampMask, 14);
  const kS = data.kappaSmooth;
  const cols = [ROAD_HALF + 1.2, 4.5, 0, -4.5, -(ROAD_HALF + 1.2)];
  const CH = 100;
  for (let c0 = 0; c0 < N; c0 += CH) {
    const c1 = Math.min(N, c0 + CH);
    const rows = c1 - c0 + 1;
    const pos = new Float32Array(rows * cols.length * 3);
    const nrm = new Float32Array(rows * cols.length * 3);
    const ruv = new Float32Array(rows * cols.length * 2);
    const road = new Float32Array(rows * cols.length * 4);
    const kap = new Float32Array(rows * cols.length);
    for (let r = 0; r < rows; r++) {
      const i = (c0 + r) % N;
      const s = (c0 + r) * ds;
      const tf = data.tunnelFactor(s, 12);
      const k = kS[i];
      const kerbL = tf > 0 ? 0 : smoothstep(1 / 150, 1 / 85, k);
      const kerbR = tf > 0 ? 0 : smoothstep(1 / 150, 1 / 85, -k);
      for (let c = 0; c < cols.length; c++) {
        const d = cols[c];
        const o = r * cols.length + c;
        pos[o * 3] = data.px[i] + data.lx[i] * d;
        pos[o * 3 + 1] = 0;
        pos[o * 3 + 2] = data.pz[i] + data.lz[i] * d;
        nrm[o * 3 + 1] = 1;
        ruv[o * 2] = d;
        ruv[o * 2 + 1] = s;
        road[o * 4] = tf;
        road[o * 4 + 1] = lampMaskS[i];
        road[o * 4 + 2] = kerbL;
        road[o * 4 + 3] = kerbR;
        kap[o] = k;
      }
    }
    const idx = [];
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols.length - 1; c++) {
      const a = r * cols.length + c, b = a + cols.length;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aRoadUv', new THREE.BufferAttribute(ruv, 2));
    g.setAttribute('aRoad', new THREE.BufferAttribute(road, 4));
    g.setAttribute('aKappa', new THREE.BufferAttribute(kap, 1));
    g.setIndex(idx);
    fixWinding(g);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, roadMat);
    m.receiveShadow = true;
    m.layers.set(1);
    group.add(m);
  }

  // ------------------------------------------------------------------ barriers
  const concreteTex = T.concreteTexture();
  const paintedTex = T.paintedBarrierTexture();
  const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.88, metalness: 0, color: 0xb0b0ac });
  const paintedMat = new THREE.MeshStandardMaterial({ map: paintedTex, roughness: 0.6, metalness: 0, color: 0xc8c8c8 });
  const profile = [[0, 0], [0, 0.08], [0.17, 0.32], [0.23, 0.82], [0.38, 0.82], [0.45, 0.32], [0.6, 0.08], [0.6, 0]];
  const BCH = 48;
  for (const side of [1, -1]) {
    for (let c0 = 0; c0 < N; c0 += BCH) {
      const c1 = Math.min(N, c0 + BCH);
      let kmax = 0;
      for (let i = c0; i < c1; i++) kmax = Math.max(kmax, Math.abs(kS[i]));
      const painted = kmax > 1 / 95;
      const geo = sweepProfile(data, c0, c1, { profile, dOf: (d) => side * (WALL_D + d), uRepeat: 4 });
      const mesh = new THREE.Mesh(geo, painted ? paintedMat : concreteMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // reflective markers along the barrier tops
  {
    const pts = [];
    for (let s = 0; s < L; s += 8) for (const side of [1, -1]) pts.push({ s, side });
    const geo = new THREE.BoxGeometry(0.06, 0.07, 0.16);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.1, 0.25) });
    const inst = new THREE.InstancedMesh(geo, mat, pts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    pts.forEach((pt, n) => {
      const f = data.sample(pt.s);
      p.set(f.x + f.lx * pt.side * (WALL_D + 0.22), 0.74, f.z + f.lz * pt.side * (WALL_D + 0.22));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading);
      inst.setMatrixAt(n, m4.compose(p, q, sc));
    });
    group.add(inst);
  }

  // ------------------------------------------------------------------ sidewalks
  const swTex = T.sidewalkTexture();
  const swMat = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.78, metalness: 0, color: 0x9a9894 });
  const swProfile = [[SIDEWALK_IN - WALL_D, 0], [SIDEWALK_IN - WALL_D, 0.16], [SIDEWALK_OUT - WALL_D, 0.16]];
  for (const side of [1, -1]) {
    for (let c0 = 0; c0 < N; c0 += BCH) {
      const c1 = Math.min(N, c0 + BCH);
      const mid = ((c0 + c1) / 2) * ds;
      if (data.inTunnel(mid)) continue;
      const geo = sweepProfile(data, c0, c1, { profile: swProfile, dOf: (d) => side * (WALL_D + d), uRepeat: 2, vRepeat: 2 });
      const mesh = new THREE.Mesh(geo, swMat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ------------------------------------------------------------------ street lamps
  const lamps = data.lamps;
  {
    const parts = [];
    const pole = new THREE.CylinderGeometry(0.09, 0.15, LAMP_H + 0.2, 10);
    pole.translate(0, (LAMP_H + 0.2) / 2, 0);
    parts.push(pole);
    const base = new THREE.CylinderGeometry(0.24, 0.28, 0.6, 10);
    base.translate(0, 0.3, 0);
    parts.push(base);
    const armLen = LAMP_POLE_D - LAMP_HEAD_D;
    const arm = new THREE.BoxGeometry(armLen + 0.2, 0.1, 0.12);
    arm.translate(armLen / 2, LAMP_H + 0.05, 0);
    parts.push(arm);
    const head = new THREE.BoxGeometry(1.0, 0.2, 0.42);
    head.translate(armLen, LAMP_H - 0.06, 0);
    parts.push(head);
    const geo = mergeSimple(parts);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.7 });
    const inst = new THREE.InstancedMesh(geo, mat, lamps.length);
    inst.castShadow = true;
    const lens = new THREE.PlaneGeometry(0.86, 0.32);
    lens.rotateX(Math.PI / 2);
    lens.translate(armLen, LAMP_H - 0.17, 0);
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.7, 0.42).multiplyScalar(26), side: THREE.DoubleSide });
    const lensInst = new THREE.InstancedMesh(lens, lensMat, lamps.length);
    const cone = new THREE.ConeGeometry(3.6, LAMP_H - 0.3, 24, 1, true);
    cone.translate(0, -(LAMP_H - 0.3) / 2, 0);
    const coneInst = new THREE.InstancedMesh(cone, createConeMaterial(new THREE.Color(1.0, 0.66, 0.36), 0.05), lamps.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    lamps.forEach((lp, n) => {
      const f = data.sample(lp.s);
      const dx = -lp.side * f.lx, dz = -lp.side * f.lz;
      q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      p.set(f.x + f.lx * lp.side * LAMP_POLE_D, 0, f.z + f.lz * lp.side * LAMP_POLE_D);
      m4.compose(p, q, one);
      inst.setMatrixAt(n, m4);
      lensInst.setMatrixAt(n, m4);
      const hx = f.x + f.lx * lp.side * LAMP_HEAD_D, hz = f.z + f.lz * lp.side * LAMP_HEAD_D;
      coneInst.setMatrixAt(n, new THREE.Matrix4().makeTranslation(hx, LAMP_H - 0.2, hz));
      lightCandidates.push({ x: hx, y: LAMP_H - 0.5, z: hz, s: lp.s, intensity: 2300, color: 0xffb070, range: 46 });
    });
    group.add(inst, lensInst, coneInst);
    coneInst.renderOrder = 5;
  }

  // ------------------------------------------------------------------ tunnel
  buildTunnel(data, group, lightCandidates);

  // ------------------------------------------------------------------ bridges
  const bridgeRects = [];
  for (const br of data.bridges) buildBridge(data, br, group, bridgeRects, lightCandidates);

  // ------------------------------------------------------------------ chevrons on the outside of tight corners
  {
    const tex = T.chevronTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(1.6, 0.8);
    const up = new THREE.Vector3(0, 1, 0);
    for (let s = 0; s < L; s += 10) {
      const k = data.valueAt(kS, s);
      if (Math.abs(k) < 1 / 70 || data.inTunnel(s)) continue;
      const outside = k > 0 ? -1 : 1;
      const f = data.sample(s);
      const t = new THREE.Vector3(f.tx, 0, f.tz);
      const n = new THREE.Vector3(-outside * f.lx, 0, -outside * f.lz);
      const m = new THREE.Mesh(geo, mat);
      m.matrixAutoUpdate = false;
      const d = outside * (WALL_D + 0.3);
      m.matrix.makeBasis(t, up, n).setPosition(f.x + f.lx * d, 1.3, f.z + f.lz * d);
      group.add(m);
      // support post
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), concreteMat);
      post.position.set(f.x + f.lx * (d + outside * 0.05), 0.9, f.z + f.lz * (d + outside * 0.05));
      group.add(post);
    }
  }

  // ------------------------------------------------------------------ start / finish gantry
  const startLights = buildGantry(data, group, lightCandidates);

  lightCandidates.sort((a, b) => a.s - b.s);
  return { group, roadMat, lightCandidates, bridgeRects, startLights, concreteMat };
}

// Sweep a 2D profile (x = offset from base line, y = height) along samples [c0, c1].
// Winding is chosen automatically so the surface faces toward (faceIn) or away from the centreline.
function sweepProfile(data, c0, c1, { step = 2, profile, dOf, uRepeat = 4, vRepeat = 0, faceIn = true }) {
  const { N, ds } = data;
  const rows = [];
  for (let i = c0; i <= c1; i += step) rows.push(Math.min(i, c1));
  if (rows[rows.length - 1] !== c1) rows.push(c1);
  const P = profile.length;
  const profV = [0];
  for (let k = 1; k < P; k++) profV.push(profV[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  const pos = new Float32Array(rows.length * P * 3);
  const uv = new Float32Array(rows.length * P * 2);
  rows.forEach((ii, r) => {
    const i = ii % N;
    for (let k = 0; k < P; k++) {
      const d = dOf(profile[k][0]);
      const o = r * P + k;
      pos[o * 3] = data.px[i] + data.lx[i] * d;
      pos[o * 3 + 1] = profile[k][1];
      pos[o * 3 + 2] = data.pz[i] + data.lz[i] * d;
      uv[o * 2] = (ii * ds) / uRepeat;
      uv[o * 2 + 1] = vRepeat > 0 ? profV[k] / vRepeat : profV[k] / profV[P - 1];
    }
  });
  const idx = [];
  for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < P - 1; k++) {
    const a = r * P + k, b = a + P;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orientation test on the second profile vertex of the middle row
  const rt = Math.floor(rows.length / 2), it = rows[rt] % N, kt = 1;
  const n = g.attributes.normal;
  const d = dOf(profile[kt][0]);
  const sgn = d >= 0 ? -1 : 1;
  const dot = n.getX(rt * P + kt) * data.lx[it] * sgn + n.getZ(rt * P + kt) * data.lz[it] * sgn + n.getY(rt * P + kt) * 0.0;
  if ((dot > 0) !== faceIn) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i += 3) {
      const t = ia[i + 1];
      ia[i + 1] = ia[i + 2];
      ia[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  return g;
}

// Ensure an upward-facing strip has +y normals by checking the first triangle.
function fixWinding(g) {
  const p = g.attributes.position.array, idx = g.index.array;
  const a = idx[0] * 3, b = idx[1] * 3, c = idx[2] * 3;
  const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
  const ny = uz * vx - ux * vz;
  if (ny < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
}

export function mergeSimple(geos) {
  let count = 0, icount = 0;
  const gs = geos.map((g) => (g.index ? g : g.toNonIndexed()));
  for (const g of gs) {
    count += g.attributes.position.count;
    icount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const idx = new Uint32Array(icount);
  let vo = 0, io = 0;
  for (const g of gs) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = vo + i;
      io += g.attributes.position.count;
    }
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

function buildTunnel(data, group, lightCandidates) {
  const [t0, t1] = data.tunnel;
  const { ds } = data;
  const i0 = Math.floor(t0 / ds), i1 = Math.ceil(t1 / ds);
  const WW = ROAD_HALF + 2.3, HH = 6.0, CH = 7.3;
  // inner surface profile from right floor, up and over, to left floor (d, y)
  const inner = [[-WW, 0], [-WW, HH], [-(WW - 1.4), CH], [WW - 1.4, CH], [WW, HH], [WW, 0]];
  const outer = [[-(WW + 1.2), 0], [-(WW + 1.2), HH + 0.4], [-(WW - 1.0), CH + 1.4], [WW - 1.0, CH + 1.4], [WW + 1.2, HH + 0.4], [WW + 1.2, 0]];
  const tile = T.tileTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: tile, roughness: 0.3, metalness: 0, color: 0xb9b3a6, emissive: new THREE.Color(0.05, 0.024, 0.008), emissiveMap: tile });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x5b5a57, roughness: 0.9 });
  const mk = (prof, mat, faceIn) => {
    const g = sweepProfile(data, i0, i1, { profile: prof, dOf: (d) => d, uRepeat: 2, vRepeat: 2, faceIn });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  mk(inner, wallMat, true);
  mk(outer, shellMat, false);
  // portals: concrete frames at both ends
  for (const s of [t0, t1]) {
    const f = data.sample(s);
    const frame = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2 * WW + 3, 1.8, 1.4), shellMat);
    top.position.y = CH + 0.7;
    frame.add(top);
    for (const sd of [1, -1]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.6, CH + 1.6, 1.4), shellMat);
      col.position.set(sd * (WW + 0.6), (CH + 1.6) / 2, 0);
      frame.add(col);
    }
    // amber warning strip on the portal
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2 * WW - 1, 0.18, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.3) }));
    strip.position.set(0, CH + 0.2, s === t0 ? -0.72 : 0.72);
    frame.add(strip);
    frame.position.set(f.x, 0, f.z);
    frame.rotation.y = f.heading;
    frame.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(frame);
  }
  // ceiling fittings
  const fitGeo = new THREE.BoxGeometry(0.4, 0.12, 1.5);
  const fitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.5, 0.16).multiplyScalar(14) });
  const fits = [];
  for (let s = Math.ceil(t0 / 6) * 6; s < t1; s += 6) for (const u of [4.2, -4.2]) fits.push([s, u]);
  const inst = new THREE.InstancedMesh(fitGeo, fitMat, fits.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  fits.forEach(([s, u], n) => {
    const f = data.sample(s);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading);
    p.set(f.x + f.lx * u, CH - 0.08, f.z + f.lz * u);
    inst.setMatrixAt(n, m4.compose(p, q, one));
  });
  group.add(inst);
  for (let s = t0 + 6; s < t1 - 3; s += 12) {
    const f = data.sample(s);
    lightCandidates.push({ x: f.x, y: CH - 0.6, z: f.z, s, intensity: 650, color: 0xff8a33, range: 30 });
  }
}

function buildBridge(data, br, group, rects, lightCandidates) {
  const f = data.sample(br.s);
  const t = new THREE.Vector3(f.tx, 0, f.tz);
  const left = new THREE.Vector3(f.lx, 0, f.lz);
  const axis = left.clone().multiplyScalar(Math.cos(br.angle)).addScaledVector(t, Math.sin(br.angle)).normalize();
  const center = new THREE.Vector3(f.x, 0, f.z);
  const yaw = Math.atan2(axis.x, axis.z);
  const g = new THREE.Group();
  g.position.copy(center);
  g.rotation.y = yaw;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6, metalness: 0.5 });
  const W = 13, BOT = 8.2, TH = 1.5;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, TH, br.len), concrete);
  deck.position.y = BOT + TH / 2;
  g.add(deck);
  // girders underneath
  for (const x of [-4, 0, 4]) {
    const gird = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, br.len), concrete);
    gird.position.set(x, BOT - 0.4, 0);
    g.add(gird);
  }
  // railings + lamps
  const railGeo = new THREE.BoxGeometry(0.12, 1.1, br.len);
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) {
    const r = new THREE.Mesh(railGeo, dark);
    r.position.set(x, BOT + TH + 0.55, 0);
    g.add(r);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.9, 1.0).multiplyScalar(18) });
  const underMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.75, 1.0).multiplyScalar(6) });
  for (let z = -br.len / 2 + 6; z < br.len / 2; z += 12) {
    for (const x of [-W / 2 + 0.4, W / 2 - 0.4]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 6), dark);
      pole.position.set(x, BOT + TH + 2.5, z);
      g.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25), lightMat);
      head.position.set(x * 0.94, BOT + TH + 5, z);
      g.add(head);
    }
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, br.len - 2), underMat);
  strip.position.set(0, BOT - 0.82, 0);
  g.add(strip);
  // piers placed clear of the barriers on both sides
  const cross = Math.max(0.35, Math.cos(br.angle));
  const pierD = (ROAD_HALF + 5.5) / cross;
  for (const zz of [-pierD, pierD, -br.len / 2 + 4, br.len / 2 - 4]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(W - 3, BOT, 1.6), concrete);
    pier.position.set(0, BOT / 2, zz);
    g.add(pier);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(g);
  rects.push({ x: center.x, z: center.z, ax: axis.x, az: axis.z, halfLen: br.len / 2 + 4, halfW: W / 2 + 4 });
  // light from the underside strip onto cars passing below
  lightCandidates.push({ x: f.x, y: BOT - 1.2, z: f.z, s: br.s, intensity: 500, color: 0x9cc4ff, range: 26 });
}

function buildGantry(data, group, lightCandidates) {
  const f = data.sample(data.startS);
  const g = new THREE.Group();
  g.position.set(f.x, 0, f.z);
  g.rotation.y = f.heading;
  const steel = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.45, metalness: 0.8 });
  const span = 2 * (ROAD_HALF + 1.9);
  for (const sd of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8.6, 0.7), steel);
    leg.position.set(sd * span / 2, 4.3, 0);
    g.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.8, 1.6, 0.9), steel);
  beam.position.y = 8.0;
  g.add(beam);
  const signTex = T.gantryTexture();
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(2.6, 2.6, 2.6) });
  for (const face of [1, -1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.62, span * 0.62 / 8), signMat);
    sign.position.set(0, 8.05, -face * 0.47);
    sign.rotation.y = face > 0 ? Math.PI : 0;
    g.add(sign);
  }
  // five start lights on the side facing the grid
  const lights = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.01, 0.01) });
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), mat);
    bulb.position.set((i - 2) * 0.95, 6.75, -0.47);
    bulb.rotation.y = Math.PI;
    g.add(bulb);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.3), steel);
    housing.position.set((i - 2) * 0.95, 6.75, -0.3);
    g.add(housing);
    lights.push(mat);
  }
  g.traverse((o) => { if (o.isMesh && o.material === steel) { o.castShadow = true; } });
  group.add(g);
  lightCandidates.push({ x: f.x, y: 7.0, z: f.z, s: data.startS, intensity: 900, color: 0xfff1d8, range: 30 });
  return {
    set(state) {
      // state: number of red lights lit (0..5) or 'green'
      lights.forEach((m, i) => {
        if (state === 'green') m.color.setRGB(0.2, 6, 0.8);
        else if (i < state) m.color.setRGB(9, 0.25, 0.12);
        else m.color.setRGB(0.05, 0.01, 0.01);
      });
    },
  };
}
