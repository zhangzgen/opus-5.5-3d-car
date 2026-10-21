// Chase / bumper / bonnet cameras plus the cinematic orbit and the countdown swoop.
import * as THREE from 'three';
import { damp, dampAngle, clamp, lerp, noise1, wrapAngle, smoothstep } from './util.js';

const MODES = [
  { name: 'Chase', dist: 6.3, height: 1.85, look: 1.05, fov: 60, ahead: 3.5 },
  { name: 'Close chase', dist: 4.8, height: 1.42, look: 0.95, fov: 63, ahead: 3.0 },
  { name: 'Bonnet', mount: [0, 1.08, 0.45], fov: 68 },
  { name: 'Bumper', mount: [0, 0.5, 2.42], fov: 72 },
];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.yaw = 0;
    this.fov = 60;
    this.shake = 0;
    this.t = 0;
    this.distLag = 0;
    this.roll = 0;
    this.ready = false;
    this._v = new THREE.Vector3();
    this._l = new THREE.Vector3();
  }

  get modeName() { return MODES[this.mode].name; }
  cycle() {
    this.mode = (this.mode + 1) % MODES.length;
    return MODES[this.mode].name;
  }
  bump(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  // veh: { x, z, heading, vx, vz, speed, ax, yawRate, nitro }
  chase(dt, car, veh) {
    this.t += dt;
    const m = MODES[this.mode];
    const cam = this.camera;
    const speed = veh.speed;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const speedShake = Math.pow(clamp(speed / 90, 0, 1), 2) * 0.03 + veh.nitro * 0.02;
    const sh = speedShake + this.shake * 0.25;
    const nx = noise1(this.t * 23.1) * sh, ny = noise1(this.t * 19.7 + 40) * sh;
    const fovT = (m.fov ?? 60) + 13 * Math.pow(clamp(speed / 85, 0, 1), 1.4) + veh.nitro * 9;
    this.fov = damp(this.fov, fovT, 3, dt);
    cam.fov = this.fov;

    if (m.mount) {
      const p = this._v.set(m.mount[0], m.mount[1], m.mount[2]);
      car.body.localToWorld(p);
      cam.position.copy(p);
      cam.position.x += nx * 0.3;
      cam.position.y += ny * 0.3;
      const l = this._l.set(m.mount[0], m.mount[1] - 0.05, m.mount[2] + 20);
      car.body.localToWorld(l);
      cam.up.set(0, 1, 0);
      cam.lookAt(l);
      this.yaw = veh.heading;
      this.ready = true;
      cam.updateProjectionMatrix();
      return;
    }

    const velYaw = speed > 4 ? Math.atan2(veh.vx, veh.vz) : veh.heading;
    const slip = wrapAngle(velYaw - veh.heading);
    const targetYaw = veh.heading + clamp(slip, -0.9, 0.9) * 0.5;
    if (!this.ready) { this.yaw = targetYaw; this.ready = true; }
    this.yaw = dampAngle(this.yaw, targetYaw, 5.0 + speed * 0.03, dt);
    this.distLag = damp(this.distLag, clamp(veh.ax * 0.05, -0.45, 0.8), 3.5, dt);
    const dist = m.dist + speed * 0.011 + this.distLag;
    const h = m.height + speed * 0.0025;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    cam.position.set(veh.x - sy * dist + cy * nx, h + ny, veh.z - cy * dist - sy * nx);
    this._l.set(veh.x + sy * m.ahead, m.look, veh.z + cy * m.ahead);
    cam.up.set(0, 1, 0);
    cam.lookAt(this._l);
    this.roll = damp(this.roll, clamp(-veh.yawRate * 0.022 * clamp(speed / 30, 0, 1), -0.06, 0.06), 4, dt);
    cam.rotateZ(this.roll);
    cam.updateProjectionMatrix();
  }

  // sweep: null = full circle, otherwise { side: +1 left / -1 right, range } keeps the camera on the open side
  orbit(dt, target, heading, { radius = 6.8, height = 1.35, speed = 0.16, fov = 42, phase = 0, sweep = null } = {}) {
    this.t += dt;
    const cam = this.camera;
    const a = sweep
      ? heading + sweep.side * (Math.PI / 2 + Math.sin(this.t * speed + phase) * sweep.range)
      : heading + Math.PI + 0.9 + this.t * speed + phase;
    const h = height + Math.sin(this.t * 0.31) * 0.35;
    cam.position.set(target.x + Math.sin(a) * radius, h, target.z + Math.cos(a) * radius);
    cam.up.set(0, 1, 0);
    cam.lookAt(target.x, 0.62, target.z);
    cam.fov = fov;
    this.fov = fov;
    cam.updateProjectionMatrix();
    this.ready = false;
  }

  // countdown swoop: u 0 → 1 moves from a low front three-quarter view to the chase slot
  intro(u, veh) {
    const cam = this.camera;
    const e = smoothstep(0, 1, u);
    const m = MODES[this.mode].mount ? MODES[0] : MODES[this.mode];
    const ang = veh.heading + Math.PI + lerp(2.5, 0, e);
    const r = lerp(6.8, m.dist, e), h = lerp(0.9, m.height, e);
    cam.position.set(veh.x + Math.sin(ang) * r, h, veh.z + Math.cos(ang) * r);
    const sy = Math.sin(veh.heading), cy = Math.cos(veh.heading);
    cam.up.set(0, 1, 0);
    cam.lookAt(veh.x + sy * lerp(0, m.ahead, e), lerp(0.6, m.look, e), veh.z + cy * lerp(0, m.ahead, e));
    cam.fov = lerp(40, m.fov, e);
    this.fov = cam.fov;
    cam.updateProjectionMatrix();
    this.yaw = veh.heading;
    this.ready = u >= 1;
  }
}
