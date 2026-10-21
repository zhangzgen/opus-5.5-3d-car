// Rival drivers. They move in track space (s along the centreline, d lateral) with a speed
// controller fed by the curvature speed profile, a racing line, overtaking/avoidance and
// rubber-banding. A body proxy lets them trade impulses with the player.
import { ROAD_HALF } from './trackdata.js';
import { clamp, lerp, damp } from './util.js';

export const DIFFICULTY = [
  { pace: 0.86, band: 0.06, accel: 0.85 },  // Street
  { pace: 0.93, band: 0.05, accel: 0.95 },  // Pro
  { pace: 0.985, band: 0.035, accel: 1.0 }, // Legend
];

export class AIDriver {
  constructor(track, { s, d, name, skill = 1, bias = 0, difficulty = 1, seed = 1 }) {
    this.track = track;
    this.name = name;
    this.s = s;              // unwrapped distance along the track
    this.d = d;
    this.v = 0;
    this.dv = 0;
    this.skill = skill;
    this.bias = bias;
    this.diff = DIFFICULTY[difficulty];
    this.seed = seed;
    this.mass = 1400;
    this.inertia = 2400;
    this.x = 0; this.z = 0; this.heading = 0;
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.wobble = 0; this.wobbleV = 0;
    this.launchDelay = 0.15 + ((seed * 0.37) % 1) * 0.35;
    this.ax = 0; this.ay = 0;
    this.steerVis = 0;
    this.rpm = 1000;
    this.gear = 1;
    this.throttle = 0;
    this.brake = 0;
    this.started = false;
    this.goTime = 0;
    this.overtakeSide = 0;
    this.syncWorld();
  }

  syncWorld() {
    const f = this.track.sample(this.s);
    this.x = f.x + f.lx * this.d;
    this.z = f.z + f.lz * this.d;
    const slip = Math.atan2(this.dv, Math.max(this.v, 3));
    this.heading = f.heading + slip + this.wobble;
    const lx = f.lx, lz = f.lz;
    this.vx = f.tx * this.v + lx * this.dv;
    this.vz = f.tz * this.v + lz * this.dv;
    this.yawRate = this.v * f.kappa + this.wobbleV;
    this._f = f;
  }

  // ctx: { dt, racers (all racers: {s (unwrapped), d, v}), playerS, racing }
  update(dt, ctx) {
    const tr = this.track;
    if (!ctx.racing) {
      this.v = damp(this.v, 0, 3, dt);
      this.syncWorld();
      return;
    }
    if (!this.started) {
      this.goTime += dt;
      if (this.goTime < this.launchDelay) { this.syncWorld(); return; }
      this.started = true;
    }
    // ---- speed target
    const look = this.s + 6 + this.v * 0.35;
    let vt = Math.min(tr.valueAt(tr.speedProfile, look), tr.valueAt(tr.speedProfile, this.s + 2));
    vt *= this.diff.pace * this.skill;
    // rubber band (only while the race is on)
    const gap = this.s - ctx.playerS; // + = ahead of the player
    const band = this.diff.band;
    if (gap > 40) vt *= 1 - band * clamp((gap - 40) / 160, 0, 1);
    else if (gap < -30) vt *= 1 + band * 1.4 * clamp((-gap - 30) / 200, 0, 1);
    if (ctx.finished) vt *= 0.75;

    // ---- traffic: follow / pick an overtaking side
    let dTarget = tr.valueAt(tr.racingLine, this.s + 18) * (0.75 + 0.25 * this.skill) + this.bias;
    let blocked = Infinity;
    for (const o of ctx.racers) {
      if (o === this) continue;
      const ds = o.s - this.s;
      const dd = o.d - this.d;
      if (ds > 0 && ds < 26 && Math.abs(dd) < 2.7) {
        if (o.v < this.v + 1.5) {
          blocked = Math.min(blocked, ds);
          if (!this.overtakeSide) {
            const roomL = ROAD_HALF - 1.6 - o.d, roomR = o.d + ROAD_HALF - 1.6;
            this.overtakeSide = roomL > roomR ? 1 : -1;
          }
          dTarget = o.d + this.overtakeSide * 3.4;
        }
      }
      // side by side: keep a car's width apart
      if (Math.abs(ds) < 5.2 && Math.abs(dd) < 2.4) dTarget += (dd > 0 ? -1 : 1) * (2.4 - Math.abs(dd)) * 1.5;
    }
    if (blocked === Infinity) this.overtakeSide = 0;
    if (blocked < 12) vt = Math.min(vt, this.v - (12 - blocked) * 0.25);
    dTarget = clamp(dTarget, -(ROAD_HALF - 1.5), ROAD_HALF - 1.5);

    // ---- longitudinal dynamics
    const P = 440000 * this.diff.accel;
    const aMax = Math.min(8.8, P / (this.mass * Math.max(this.v, 4))) - (0.39 * this.v * this.v) / this.mass;
    let acc;
    if (this.v < vt) { acc = Math.min(aMax, (vt - this.v) * 3); this.throttle = clamp(acc / Math.max(aMax, 0.1), 0.2, 1); this.brake = 0; }
    else { acc = -Math.min(9.5, (this.v - vt) * 2.5); this.throttle = 0; this.brake = clamp(-acc / 9, 0, 1); }
    this.v = Math.max(0, this.v + acc * dt);
    this.ax = acc;

    // ---- lateral dynamics
    const da = clamp((dTarget - this.d) * 2.2 - this.dv * 2.4, -7, 7);
    this.dv = clamp(this.dv + da * dt, -5, 5);
    this.d += this.dv * dt;
    const lim = ROAD_HALF - 1.15;
    if (this.d > lim) { this.d = lim; this.dv = Math.min(this.dv, 0); }
    if (this.d < -lim) { this.d = -lim; this.dv = Math.max(this.dv, 0); }

    const k = tr.valueAt(tr.kappa, this.s);
    const scale = clamp(1 - k * this.d, 0.6, 1.4);
    this.s += (this.v * dt) / scale;

    // collision wobble decays
    this.wobbleV += (-this.wobble * 30 - this.wobbleV * 7) * dt;
    this.wobble += this.wobbleV * dt;

    this.ay = this.v * this.v * k + da;
    this.steerVis = damp(this.steerVis, clamp(Math.atan(2.7 * (k + da / Math.max(this.v * this.v, 25))) * 1.3, -0.5, 0.5), 10, dt);
    // engine model for sound: simple 6-speed mapping
    const kmh = this.v * 3.6;
    const bands = [0, 70, 115, 160, 205, 250, 400];
    let g = 1;
    while (g < 6 && kmh > bands[g]) g++;
    this.gear = g;
    const lo = bands[g - 1], hi = bands[g];
    this.rpm = lerp(this.rpm, (g === 1 ? 1500 : 4600) + ((kmh - lo) / (hi - lo)) * (g === 1 ? 6000 : 3200), 1 - Math.exp(-8 * dt));
    this.syncWorld();
  }

  // apply a world-space velocity change from a collision impulse
  absorb() {
    const f = this._f || this.track.sample(this.s);
    const along = this.vx * f.tx + this.vz * f.tz;
    const lat = this.vx * f.lx + this.vz * f.lz;
    this.v = Math.max(0, along);
    this.dv = clamp(lat, -7, 7);
    this.wobbleV += clamp(this.yawRate - this.v * f.kappa - this.wobbleV, -3, 3);
    // project the (possibly pushed) position back into track space
    const p = this.track.project(this.x, this.z, f.index);
    let ds = p.s - this.track.wrapS(this.s);
    if (ds > this.track.length / 2) ds -= this.track.length;
    if (ds < -this.track.length / 2) ds += this.track.length;
    this.s += ds;
    this.d = clamp(p.d, -(ROAD_HALF - 1.0), ROAD_HALF - 1.0);
  }
}
