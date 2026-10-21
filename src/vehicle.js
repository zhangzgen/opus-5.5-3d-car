// Planar vehicle dynamics: bicycle model with load transfer, Pacejka-style tyres, friction
// circle at the driven axle, six-speed box with auto/manual shifting, nitrous, and arcade assists
// (speed-sensitive steering, drift countersteer, yaw stability). Pure JS – runs headless too.
import { clamp, lerp, linTable } from './util.js';

const G = 9.81;
const TORQUE = [[0, 330], [1000, 430], [2000, 520], [3000, 600], [4000, 660], [5000, 700], [6000, 702], [7000, 672], [7800, 615], [8400, 540]];

export class Vehicle {
  constructor(opt = {}) {
    this.mass = opt.mass ?? 1420;
    this.inertia = opt.inertia ?? 2350;
    this.a = 1.31;              // CG → front axle
    this.b = 1.39;              // CG → rear axle
    this.L = this.a + this.b;
    this.cgH = 0.46;
    this.wheelR = 0.345;
    this.gearRatios = [3.1, 2.15, 1.63, 1.3, 1.07, 0.89];
    this.reverseRatio = 3.2;
    this.finalDrive = 3.55;
    this.driveEff = 0.88;
    this.idleRPM = 950;
    this.maxRPM = 8300;
    this.shiftUpRPM = 7850;
    this.shiftDownRPM = 4200;
    this.muF = opt.mu ?? 1.62;
    this.muR = opt.mu ?? 1.66;
    this.downforce = 1.0;       // N per (m/s)²
    this.dragC = 0.39;
    this.rollC = 13;
    this.brakeForce = 23000;
    this.maxSteer = 0.6;
    this.torqueScale = opt.torqueScale ?? 1;
    this.assist = true;
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.steer = 0;
    this.rpm = this.idleRPM;
    this.gear = 1;
    this.shiftTimer = 0;
    this.revTimer = 0;
    this.ax = 0; this.ay = 0;
    this.axF = 0;
    this.nitro = 1;
    this.nitroActive = false;
    this.slipF = 0; this.slipR = 0; this.beta = 0;
    this.wheelspin = 0;
    this.wheelOmega = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.limiter = false;
    this.manual = false;
    this.events = [];
    this.lastShift = 0;
    this.clutchSlip = 0;
    this.offThrottleTime = 0;
    this.driftMode = 0;
    this.prevBeta = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }

  engineTorque(rpm) { return linTable(TORQUE, rpm) * this.torqueScale; }

  shift(dir) {
    if (this.shiftTimer > 0) return;
    if (dir > 0 && this.gear >= 1 && this.gear < 6) { this.gear++; this.shiftTimer = 0.16; this.events.push({ type: 'shift', up: true }); }
    else if (dir < 0 && this.gear > 1) { this.gear--; this.shiftTimer = 0.12; this.events.push({ type: 'shift', up: false }); }
  }

  // inp: { throttle 0..1, brake 0..1, steer -1..1 (+ = right), handbrake 0/1, nitro 0/1 }
  step(dt, inp) {
    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    const fx = sinH, fz = cosH, lx = cosH, lz = -sinH;
    const vF = this.vx * fx + this.vz * fz;
    const vL = this.vx * lx + this.vz * lz;
    const speed = Math.hypot(vF, vL);
    let throttle = clamp(inp.throttle, 0, 1);
    let brake = clamp(inp.brake, 0, 1);
    const hand = inp.handbrake ? 1 : 0;

    // ---- reverse handling: hold brake at standstill to engage reverse
    if (this.gear > 0) {
      if (brake > 0.2 && throttle < 0.05 && vF < 0.8) {
        this.revTimer += dt;
        if (this.revTimer > 0.35) { this.gear = -1; this.revTimer = 0; }
      } else this.revTimer = 0;
    } else if (this.gear === -1) {
      if (throttle > 0.1 && vF > -1.0) { this.gear = 1; }
      else { const t = throttle; throttle = brake; brake = t; }
    }

    // ---- nitrous
    this.nitroActive = !!inp.nitro && this.nitro > 0.01 && throttle > 0.1 && this.gear > 0;
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - dt * 0.2);

    // ---- steering (speed sensitive, with drift countersteer assist)
    this.beta = speed > 3 ? Math.atan2(vL, Math.abs(vF)) : 0;
    const steerLimit = Math.max(0.15, this.maxSteer / (1 + (speed * speed) / (22 * 22)));
    let steerTarget = -clamp(inp.steer, -1, 1) * steerLimit;
    if (this.assist && speed > 6) steerTarget += clamp(this.beta * 0.62, -0.42, 0.42) * Math.sign(vF || 1);
    steerTarget = clamp(steerTarget, -this.maxSteer, this.maxSteer);
    const rate = 3.2 + speed * 0.02;
    this.steer += clamp(steerTarget - this.steer, -rate * dt, rate * dt);
    const delta = this.steer;

    // ---- loads with longitudinal transfer
    const Fdown = this.downforce * speed * speed;
    const Ftot = this.mass * G + Fdown;
    this.axF = lerp(this.axF, this.ax, 1 - Math.exp(-10 * dt));
    const wt = (this.cgH / this.L) * this.mass * this.axF;
    const Fzf = Math.max(0.2 * Ftot, (Ftot * this.b) / this.L - wt);
    const Fzr = Math.max(0.2 * Ftot, (Ftot * this.a) / this.L + wt);

    // ---- gearbox + engine
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const gi = this.gear;
    const ratio = gi > 0 ? this.gearRatios[gi - 1] * this.finalDrive : gi === -1 ? -this.reverseRatio * this.finalDrive : 0;
    const wheelW = vF / this.wheelR;
    const rpmWheel = Math.abs(wheelW * ratio) * (60 / (2 * Math.PI));
    // clutch slip at launch keeps the engine in its power band
    const launchRPM = this.idleRPM + throttle * 4200;
    let rpmTarget = Math.max(rpmWheel, this.idleRPM);
    if (rpmWheel < launchRPM && throttle > 0.05 && Math.abs(vF) < 12) {
      this.clutchSlip = 1 - rpmWheel / launchRPM;
      rpmTarget = Math.max(rpmWheel, lerp(rpmWheel, launchRPM, clamp(1 - Math.abs(vF) / 12, 0, 1)));
    } else this.clutchSlip = 0;
    if (this.shiftTimer > 0) rpmTarget = this.rpm - 2500 * dt * 4;
    rpmTarget += this.wheelspin * 2200;
    this.rpm = lerp(this.rpm, clamp(rpmTarget, this.idleRPM * 0.9, this.maxRPM + 150), 1 - Math.exp(-(this.shiftTimer > 0 ? 18 : 14) * dt));
    this.limiter = this.rpm >= this.maxRPM - 20 && throttle > 0.5;

    // auto shifting
    if (!this.manual && this.gear > 0 && this.shiftTimer <= 0) {
      if (this.rpm > this.shiftUpRPM && this.gear < 6 && this.wheelspin < 0.3 && Math.abs(vF) > 5) this.shift(1);
      else if (this.gear > 1) {
        const lowerRPM = rpmWheel * (this.gearRatios[this.gear - 2] / this.gearRatios[this.gear - 1]);
        if (this.rpm < this.shiftDownRPM && lowerRPM < this.shiftUpRPM - 900) this.shift(-1);
      }
    }

    let torque = 0;
    if (this.shiftTimer <= 0 && this.gear !== 0) {
      torque = this.engineTorque(this.rpm) * throttle;
      if (this.nitroActive) torque *= 1.5;
      if (this.rpm > this.maxRPM) torque *= 0.0;
    }
    // engine braking on lift
    const engBrake = throttle < 0.05 && this.gear > 0 && this.shiftTimer <= 0 ? -(this.rpm / this.maxRPM) * 110 : 0;
    let Fdrive = ((torque + engBrake) * ratio * this.driveEff) / this.wheelR;
    if (this.gear === -1) Fdrive = clamp(Fdrive, -6000, 6000);

    // ---- tyres
    const pac = (al) => Math.sin(1.45 * Math.atan(8.5 * al));
    const vFa = Math.max(Math.abs(vF), 4.5);
    const vLf = vL + this.yawRate * this.a;
    const vLr = vL - this.yawRate * this.b;
    const dirSign = vF >= -0.5 ? 1 : -1;
    const af = Math.atan2(vLf, vFa) - delta * dirSign;
    const ar = Math.atan2(vLr, vFa);
    this.slipF = af;
    this.slipR = ar;

    const capF = this.muF * Fzf;
    const capR = this.muR * Fzr * (hand ? 0.5 : 1);

    // brakes (front biased), ABS-like clamp at the friction limit
    let FbF = 0, FbR = 0;
    if (brake > 0 && Math.abs(vF) > 0.25) {
      FbF = -Math.sign(vF) * Math.min(brake * this.brakeForce * 0.62, capF * 0.95);
      FbR = -Math.sign(vF) * Math.min(brake * this.brakeForce * 0.38, capR * 0.95);
    }
    if (hand && Math.abs(vF) > 0.4) FbR += -Math.sign(vF) * Math.min(5200, capR * 0.9);

    // traction limit at the rear (wheelspin → loss of lateral grip → power oversteer)
    let FxR = Fdrive + FbR;
    const longCapR = capR * (this.assist && !hand ? 0.97 : 1.0);
    this.wheelspin = 0;
    if (Math.abs(FxR) > longCapR) {
      this.wheelspin = clamp((Math.abs(FxR) - longCapR) / capR, 0, 1.5);
      FxR = Math.sign(FxR) * longCapR;
    }
    // hard launch spin for effects
    if (this.clutchSlip > 0.3 && throttle > 0.9 && Math.abs(vF) < 6) this.wheelspin = Math.max(this.wheelspin, 0.35 * this.clutchSlip);

    const useR = clamp(Math.abs(FxR) / capR, 0, 1);
    const latR = Math.sqrt(Math.max(0.0, 1 - useR * useR));
    // arcade drift: once the tail is out with throttle held (or handbrake), rear grip relaxes so the slide can be held
    const driftIntent = hand || (Math.abs(this.beta) > 0.2 && speed > 11 && speed < 45 && throttle > 0.4);
    this.driftMode = lerp(this.driftMode || 0, driftIntent ? 1 : 0, 1 - Math.exp(-(driftIntent ? 8 : 3) * dt));
    let Fyr = -capR * pac(ar) * Math.max(0.3, latR) * (1 - Math.min(0.5, this.wheelspin * 0.5)) * lerp(1, 0.82, this.driftMode);
    const useF = clamp(Math.abs(FbF) / capF, 0, 1);
    const latF = Math.sqrt(Math.max(0.0, 1 - useF * useF));
    let Fyf = -capF * pac(af) * Math.max(0.35, latF);

    // low speed: blend towards a kinematic model to kill jitter
    const lowK = clamp(1 - speed / 4, 0, 1);

    const cd = Math.cos(delta), sd = Math.sin(delta);
    let Flong = FxR + FbF * cd - Fyf * sd;
    let Flat = Fyr + Fyf * cd + FbF * sd;
    Flong -= this.dragC * vF * speed + this.rollC * vF;
    Flat -= this.dragC * 1.6 * vL * speed;
    let Tz = this.a * (Fyf * cd + FbF * sd) - this.b * Fyr;

    // yaw stability assist: strongly fights over-rotation, only gently helps rotation
    const betaDot = (this.beta - (this.prevBeta ?? this.beta)) / dt;
    this.prevBeta = this.beta;
    if (this.assist && speed > 4) {
      const wMax = (0.9 * this.muR * G * (Ftot / (this.mass * G))) / Math.max(speed, 1);
      const kin = clamp((vF * Math.tan(delta)) / this.L, -wMax, wMax);
      const drifting = hand || this.driftMode > 0.5;
      const err = kin - this.yawRate;
      const over = Math.sign(err) !== Math.sign(this.yawRate) && Math.abs(this.yawRate) > Math.abs(kin);
      const k = over ? (drifting ? 700 : 2600) : (drifting ? 300 : 700);
      Tz += err * k * clamp(speed / 20, 0, 1);
      // keep slides below ~38° so drifts stay catchable
      const bl = 0.58;
      if (Math.abs(this.beta) > bl) {
        const sp = clamp(speed / 12, 0, 1);
        Tz += (this.beta - Math.sign(this.beta) * bl) * 42000 * sp;
        if (Math.sign(betaDot) === Math.sign(this.beta)) Tz += betaDot * 2600 * sp;
      }
    }
    // momentum retention while sliding: refund part of the scrub from the tyres
    if (this.driftMode > 0.05 && speed > 8) {
      const ux = vF / speed, uz = vL / speed;
      const along = (FxR + FbF * cd - Fyf * sd) * ux + (Fyr + Fyf * cd + FbF * sd) * uz;
      if (along < 0) {
        const refund = -along * 0.45 * this.driftMode * (throttle > 0.3 ? 1 : 0.4);
        Flong += refund * ux;
        Flat += refund * uz;
      }
    }

    this.ax = Flong / this.mass;
    this.ay = Flat / this.mass;
    this.vx += ((fx * Flong + lx * Flat) / this.mass) * dt;
    this.vz += ((fz * Flong + lz * Flat) / this.mass) * dt;
    this.yawRate += (Tz / this.inertia) * dt;

    if (lowK > 0) {
      const kin = (vF * Math.tan(delta)) / this.L;
      this.yawRate = lerp(this.yawRate, kin, lowK * 0.5);
      // bleed lateral sliding at walking pace
      const nvL = vL * (1 - lowK * 0.3);
      this.vx += lx * (nvL - vL);
      this.vz += lz * (nvL - vL);
      if (throttle < 0.05 && brake < 0.05 && speed < 0.6) { this.vx *= 0.9; this.vz *= 0.9; }
    }
    this.yawRate *= 1 - 0.15 * dt;

    this.heading += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // visual wheel speed (spins up when the rears break traction)
    const targetOmega = wheelW + Math.sign(Fdrive || 1) * this.wheelspin * 40;
    this.wheelOmega = lerp(this.wheelOmega, brake > 0.9 && Math.abs(vF) < 0.5 ? 0 : targetOmega, 1 - Math.exp(-20 * dt));
    this.throttle = throttle;
    this.brake = brake;
    this.handbrake = hand;
    if (throttle < 0.1) this.offThrottleTime += dt; else this.offThrottleTime = 0;
  }

  // Rigid body impulse at world-space offset r from the CG along normal n (unit, pointing away from the obstacle).
  applyContact(rx, rz, nx, nz, restitution = 0.25, friction = 0.4) {
    const vpx = this.vx + this.yawRate * rz;
    const vpz = this.vz - this.yawRate * rx;
    const vn = vpx * nx + vpz * nz;
    if (vn >= 0) return 0;
    const rn = rz * nx - rx * nz;
    const denom = 1 / this.mass + (rn * rn) / this.inertia;
    const j = (-(1 + restitution) * vn) / denom;
    this.vx += (j * nx) / this.mass;
    this.vz += (j * nz) / this.mass;
    this.yawRate += (rn * j) / this.inertia;
    // friction along the surface
    const tx = -nz, tz = nx;
    const vt = (this.vx + this.yawRate * rz) * tx + (this.vz - this.yawRate * rx) * tz;
    const rt = rz * tx - rx * tz;
    const dt = 1 / this.mass + (rt * rt) / this.inertia;
    const jt = clamp(-vt / dt, -friction * j, friction * j);
    this.vx += (jt * tx) / this.mass;
    this.vz += (jt * tz) / this.mass;
    this.yawRate += (rt * jt) / this.inertia;
    return -vn;
  }
}
