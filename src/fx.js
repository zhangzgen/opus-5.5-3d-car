// GPU billboard particles (smoke, wet-road spray, sparks, exhaust flame) and tyre skid marks.
import * as THREE from 'three';
import * as T from './textures.js';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iCol;
attribute vec2 iSize;
attribute vec3 iVel;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = uv;
  vCol = iCol;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec2 corner = position.xy;
  float s = iSize.x;
  vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
  float vl = length(vv.xy);
  vec2 offs;
  if (vl > 0.0005) {
    vec2 ax = vv.xy / vl;
    vec2 ay = vec2(-ax.y, ax.x);
    offs = ax * corner.x * (s + vl) + ay * corner.y * s;
  } else {
    float c = cos(iSize.y), si = sin(iSize.y);
    offs = vec2(c * corner.x - si * corner.y, si * corner.x + c * corner.y) * s;
  }
  mv.xy += offs;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vCol.rgb * t.rgb, vCol.a * t.a);
}`;

class Particles {
  constructor(max, map, additive) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3); this.aCol = mk(4); this.aSize = mk(2); this.aVel = mk(3);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iCol', this.aCol);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 8 : 7;
    this.additive = additive;
    // particle state (struct of arrays)
    const F = (n = 1) => new Float32Array(max * n);
    this.p = F(3); this.v = F(3); this.c = F(4);
    this.life = F(); this.maxLife = F(); this.s0 = F(); this.s1 = F(); this.rot = F(); this.rotV = F();
    this.drag = F(); this.grav = F(); this.stretch = F(); this.fadeIn = F();
    this.count = 0;
  }

  spawn(o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.c[i * 4] = o.r; this.c[i * 4 + 1] = o.g; this.c[i * 4 + 2] = o.b; this.c[i * 4 + 3] = o.a;
    this.life[i] = 0; this.maxLife[i] = o.life;
    this.s0[i] = o.s0; this.s1[i] = o.s1 ?? o.s0;
    this.rot[i] = o.rot ?? Math.random() * 6.28; this.rotV[i] = o.rotV ?? (Math.random() - 0.5) * 1.5;
    this.drag[i] = o.drag ?? 1; this.grav[i] = o.grav ?? 0; this.stretch[i] = o.stretch ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.08;
  }

  kill(i) {
    const j = --this.count;
    if (i === j) return;
    for (const [arr, n] of [[this.p, 3], [this.v, 3], [this.c, 4]]) for (let k = 0; k < n; k++) arr[i * n + k] = arr[j * n + k];
    for (const arr of [this.life, this.maxLife, this.s0, this.s1, this.rot, this.rotV, this.drag, this.grav, this.stretch, this.fadeIn]) arr[i] = arr[j];
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) { this.kill(i); i--; continue; }
      const dr = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= dr; this.v[i * 3 + 1] = this.v[i * 3 + 1] * dr - this.grav[i] * dt; this.v[i * 3 + 2] *= dr;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.p[i * 3 + 1] = 0.02; this.v[i * 3 + 1] *= -0.35; this.v[i * 3] *= 0.6; this.v[i * 3 + 2] *= 0.6; }
      this.rot[i] += this.rotV[i] * dt;
    }
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, V = this.aVel.array;
    for (let i = 0; i < this.count; i++) {
      const t = this.life[i] / this.maxLife[i];
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      const fade = Math.min(1, this.life[i] / this.fadeIn[i]) * (1 - t) * (1 - t * 0.3);
      if (this.additive) {
        C[i * 4] = this.c[i * 4] * fade; C[i * 4 + 1] = this.c[i * 4 + 1] * fade; C[i * 4 + 2] = this.c[i * 4 + 2] * fade; C[i * 4 + 3] = 1;
      } else {
        C[i * 4] = this.c[i * 4]; C[i * 4 + 1] = this.c[i * 4 + 1]; C[i * 4 + 2] = this.c[i * 4 + 2]; C[i * 4 + 3] = this.c[i * 4 + 3] * fade;
      }
      S[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      S[i * 2 + 1] = this.rot[i];
      const st = this.stretch[i];
      V[i * 3] = this.v[i * 3] * st; V[i * 3 + 1] = this.v[i * 3 + 1] * st; V[i * 3 + 2] = this.v[i * 3 + 2] * st;
    }
    this.geo.instanceCount = this.count;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aVel.needsUpdate = true;
  }
}

class SkidMarks {
  constructor(max = 3000) {
    this.max = max;
    const pos = new Float32Array(max * 4 * 3);
    const col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    this.mesh.layers.set(1);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.head = 0;
    this.trails = new Map();
  }

  // id: wheel key; (x, z) contact point; (tx, tz) rolling direction; a = darkness 0..1
  add(id, x, z, tx, tz, a, width = 0.27) {
    let tr = this.trails.get(id);
    const lx = tz * width * 0.5, lz = -tx * width * 0.5;
    if (!tr || a <= 0.02) {
      if (a > 0.02) this.trails.set(id, { x, z, lx, lz, a });
      else this.trails.delete(id);
      return;
    }
    const dx = x - tr.x, dz = z - tr.z;
    if (dx * dx + dz * dz < 0.09) return;
    if (dx * dx + dz * dz > 9) { this.trails.set(id, { x, z, lx, lz, a }); return; }
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const P = this.aPos.array, C = this.aCol.array, y = 0.012;
    const v = i * 4;
    P.set([tr.x + tr.lx, y, tr.z + tr.lz, tr.x - tr.lx, y, tr.z - tr.lz, x + lx, y, z + lz, x - lx, y, z - lz], v * 3);
    const c = 0.012;
    C.set([c, c, c, tr.a * 0.7, c, c, c, tr.a * 0.7, c, c, c, a * 0.7, c, c, c, a * 0.7], v * 4);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.trails.set(id, { x, z, lx, lz, a });
  }

  clear() {
    this.aCol.array.fill(0);
    this.aCol.needsUpdate = true;
    this.trails.clear();
  }
}

export class FX {
  constructor(scene) {
    this.smoke = new Particles(900, T.smokeTexture(), false);
    this.glow = new Particles(1400, T.radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64), true);
    this.skids = new SkidMarks(3200);
    scene.add(this.smoke.mesh, this.glow.mesh, this.skids.mesh);
    this.tmp = 0;
  }

  tireSmoke(x, z, vx, vz, k) {
    const g = 0.2 + Math.random() * 0.08;
    this.smoke.spawn({
      x: x + (Math.random() - 0.5) * 0.3, y: 0.25, z: z + (Math.random() - 0.5) * 0.3,
      vx: vx * 0.15 + (Math.random() - 0.5) * 1.5, vy: 0.5 + Math.random() * 0.9, vz: vz * 0.15 + (Math.random() - 0.5) * 1.5,
      r: g, g: g * 0.97, b: g * 0.95, a: 0.42 * k, life: 1.8 + Math.random() * 1.8, s0: 0.8, s1: 5.2 + Math.random() * 2.4,
      drag: 1.4, fadeIn: 0.15,
    });
  }

  spray(x, z, vx, vz, k) {
    this.smoke.spawn({
      x: x + (Math.random() - 0.5) * 0.25, y: 0.15, z: z + (Math.random() - 0.5) * 0.25,
      vx: vx * 0.55 + (Math.random() - 0.5) * 1.6, vy: 0.4 + Math.random() * 1.2, vz: vz * 0.55 + (Math.random() - 0.5) * 1.6,
      r: 0.16, g: 0.16, b: 0.17, a: 0.13 * k, life: 0.45 + Math.random() * 0.35, s0: 0.35, s1: 2.4, drag: 2.6, fadeIn: 0.05,
    });
  }

  sparks(x, y, z, nx, nz, vx, vz, n) {
    for (let i = 0; i < n; i++) {
      const sp = 3 + Math.random() * 7;
      this.glow.spawn({
        x, y, z,
        vx: vx * 0.7 + nx * sp * 0.5 + (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 4, vz: vz * 0.7 + nz * sp * 0.5 + (Math.random() - 0.5) * 4,
        r: 9, g: 4.2, b: 1.2, a: 1, life: 0.25 + Math.random() * 0.45, s0: 0.05, s1: 0.03, drag: 0.6, grav: 9.8, stretch: 0.03, fadeIn: 0.01,
      });
    }
  }

  flame(x, y, z, dx, dy, dz, k, nitro, cvx = 0, cvz = 0) {
    const sp = 9 + Math.random() * 6;
    const col = nitro ? [1.2, 2.2, 7.0] : [7.5, 3.2, 0.8];
    this.glow.spawn({
      x, y, z,
      vx: cvx + dx * sp + (Math.random() - 0.5) * 0.6, vy: dy * sp + Math.random() * 0.4, vz: cvz + dz * sp + (Math.random() - 0.5) * 0.6,
      r: col[0] * k, g: col[1] * k, b: col[2] * k, a: 1,
      life: 0.06 + Math.random() * 0.08, s0: 0.22, s1: 0.08, drag: 4, stretch: 0.045, fadeIn: 0.005,
    });
  }

  update(dt) {
    this.smoke.update(dt);
    this.glow.update(dt);
  }

  clear() {
    this.smoke.count = 0;
    this.glow.count = 0;
    this.skids.clear();
  }
}
