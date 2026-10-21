// Rain: GPU-animated streaks that wrap around the camera. Drops are only visible where light
// catches them — near street lamps and in the player's headlight cones — like real night rain.
import * as THREE from 'three';

const COUNT = 3200;

export class Rain {
  constructor(scene) {
    const seeds = new Float32Array(COUNT * 2 * 3);
    const ends = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random();
      for (let k = 0; k < 2; k++) {
        seeds.set([a, b, c], (i * 2 + k) * 3);
        ends[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(56, 26, 56) },
      uFall: { value: new THREE.Vector3(1.2, -12.5, 0.6) },
      uVel: { value: new THREE.Vector3() },
      uLights: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -100, 0, 0)) },
      uHead: { value: new THREE.Vector3() },
      uHeadDir: { value: new THREE.Vector3(0, 0, 1) },
      uAmount: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCam, uBox, uFall, uVel, uHead, uHeadDir;
        uniform vec4 uLights[6];
        uniform float uAmount;
        varying float vA;
        void main() {
          vec3 speed = uFall * (0.85 + aSeed.z * 0.3);
          vec3 origin = uCam - uBox * 0.5;
          vec3 p = mod(aSeed * uBox + speed * uTime - origin, uBox) + origin;
          vec3 rel = speed - uVel;
          p -= rel * 0.024 * aEnd;
          // light catching the drop
          float lit = 0.0;
          for (int i = 0; i < 6; i++) {
            vec3 d = p - uLights[i].xyz;
            lit += uLights[i].w / (1.0 + dot(d, d) * 0.02);
          }
          vec3 h = p - uHead;
          float hd = length(h);
          float cone = smoothstep(0.82, 0.95, dot(h / max(hd, 0.001), uHeadDir));
          lit += cone * 2.2 / (1.0 + hd * hd * 0.004);
          float near = length(p - uCam);
          vA = clamp(lit, 0.0, 2.5) * smoothstep(1.2, 4.0, near) * (1.0 - smoothstep(18.0, 28.0, near)) * step(0.0, p.y) * uAmount;
          vA *= 0.55 + 0.45 * aSeed.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          gl_FragColor = vec4(vec3(0.62, 0.68, 0.78) * vA * 0.32, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.layers.set(1);
    scene.add(this.mesh);
    this.enabled = true;
  }

  // lights: array of { position, intensity } (the active street-lamp point lights)
  update(dt, camera, vel, lights, head, headDir) {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    u.uVel.value.copy(vel);
    for (let i = 0; i < 6; i++) {
      const L = lights[i];
      if (L && L.intensity > 0) u.uLights.value[i].set(L.position.x, L.position.y, L.position.z, Math.min(1.6, L.intensity / 1400));
      else u.uLights.value[i].set(0, -100, 0, 0);
    }
    u.uHead.value.copy(head);
    u.uHeadDir.value.copy(headDir);
  }
}
