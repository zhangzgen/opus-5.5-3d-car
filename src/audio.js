// Fully synthesized sound: V8 engine built from per-cylinder combustion pulses rendered into
// three looping rpm layers (crossfaded like a sample-based engine), plus tyres, wind, wet-road
// hiss, turbo, blow-off, nitrous, impacts and the countdown beeps.
import { clamp, lerp, mulberry32 } from './util.js';

function makeNoise(ctx, secs) {
  const len = Math.floor(ctx.sampleRate * secs);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = last * 0.6 + w * 0.4;
    d[i] = last * 1.4;
  }
  return b;
}

function synthEngine(ctx, rpm, { f1, f2, tau1, tau2, noise, uneven, seed }) {
  const sr = ctx.sampleRate;
  const cyl = 8;
  const firingHz = (rpm / 60) * (cyl / 2);
  const nF = Math.round(sr / firingHz);
  const base = ((sr / nF) * 60 * 2) / cyl;
  const cycles = Math.max(8, Math.round((1.3 * firingHz) / cyl));
  const len = nF * cyl * cycles;
  const data = new Float32Array(len);
  const rnd = mulberry32(seed);
  const pattern = [1, 0.78, 0.93, 0.72, 0.98, 0.8, 0.9, 0.75];
  const amps = pattern.map((a) => 1 - (1 - a) * uneven * 3);
  const pulseLen = Math.min(len, Math.round(sr * Math.max(tau1, tau2) * 7));
  const TAU = Math.PI * 2;
  for (let k = 0; k < cyl * cycles; k++) {
    const start = k * nF + Math.round((rnd() - 0.5) * nF * 0.05);
    const A = amps[k % cyl] * (0.85 + rnd() * 0.3);
    const ph = rnd() * 0.6;
    const nz = noise * (0.7 + rnd() * 0.6);
    for (let i = 0; i < pulseLen; i++) {
      const t = i / sr;
      const e1 = Math.exp(-t / tau1), e2 = Math.exp(-t / tau2);
      const s = A * (e1 * Math.sin(TAU * f1 * t + ph) * 0.9 + e2 * Math.sin(TAU * f2 * t) * 0.4 + (rnd() * 2 - 1) * nz * Math.exp(-t / (tau1 * 0.5)));
      data[(start + i + len) % len] += s;
    }
  }
  for (let i = 0; i < len; i++) {
    const t = i / nF;
    data[i] += 0.28 * Math.sin(TAU * t) + 0.1 * uneven * 4 * Math.sin(TAU * t * 0.5 + 0.4) + 0.06 * Math.sin(TAU * t * 2 + 1.1);
  }
  // soft clip, then a loop-continuous DC blocker (two passes so the state wraps cleanly)
  let px = 0, py = 0, mx = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < len; i++) {
      const x = Math.tanh(data[i] * 1.35);
      const y = x - px + 0.996 * py;
      px = x; py = y;
      if (pass === 1) { data[i] = y; mx = Math.max(mx, Math.abs(y)); }
    }
  }
  for (let i = 0; i < len; i++) data[i] *= 0.9 / (mx || 1);
  const buf = ctx.createBuffer(1, len, sr);
  buf.getChannelData(0).set(data);
  return { buffer: buf, base };
}

function shaperCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

class EngineVoice {
  constructor(sys, dest, spatial = false) {
    const ctx = sys.ctx;
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.8;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = shaperCurve(1.8);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.srcs = sys.layers.map((L) => {
      const s = ctx.createBufferSource();
      s.buffer = L.buffer;
      s.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(g).connect(this.filter);
      s.start(0, Math.random() * L.buffer.duration);
      return { s, g, base: L.base, lc: Math.log(L.base) };
    });
    this.filter.connect(this.shaper).connect(this.out);
    if (spatial) {
      this.pan = ctx.createStereoPanner();
      this.out.connect(this.pan).connect(dest);
    } else this.out.connect(dest);
  }
  set(rpm, load, vol, rateMul = 1, pan = 0) {
    const t = this.ctx.currentTime;
    rpm = clamp(rpm, 600, 9200);
    const lr = Math.log(rpm);
    const n = this.srcs.length;
    for (let i = 0; i < n; i++) {
      const L = this.srcs[i];
      let w;
      if (i === 0 && lr <= L.lc) w = 1;
      else if (i === n - 1 && lr >= L.lc) w = 1;
      else if (lr < L.lc) w = clamp(1 - (L.lc - lr) / (L.lc - this.srcs[i - 1].lc), 0, 1);
      else w = clamp(1 - (lr - L.lc) / (this.srcs[i + 1].lc - L.lc), 0, 1);
      L.s.playbackRate.setTargetAtTime((rpm / L.base) * rateMul, t, 0.015);
      L.g.gain.setTargetAtTime(Math.sqrt(w), t, 0.03);
    }
    this.filter.frequency.setTargetAtTime(380 + load * 4200 + rpm * 0.42, t, 0.04);
    this.out.gain.setTargetAtTime(vol * (0.32 + 0.68 * load), t, 0.035);
    if (this.pan) this.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  }
  stop() {
    for (const L of this.srcs) try { L.s.stop(); } catch (e) { /* already stopped */ }
    this.out.disconnect();
  }
}

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
    this.rivals = [];
    this.boost = 0;
    this.lastThrottle = 0;
    this.scrape = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.noise = makeNoise(ctx, 2.5);
    this.layers = [
      synthEngine(ctx, 1100, { f1: 82, f2: 205, tau1: 0.011, tau2: 0.005, noise: 0.2, uneven: 0.12, seed: 3 }),
      synthEngine(ctx, 2900, { f1: 150, f2: 410, tau1: 0.0055, tau2: 0.0025, noise: 0.28, uneven: 0.08, seed: 5 }),
      synthEngine(ctx, 5800, { f1: 280, f2: 760, tau1: 0.0028, tau2: 0.0013, noise: 0.36, uneven: 0.05, seed: 7 }),
    ];
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.62;
    this.engineBus.connect(this.master);
    this.player = new EngineVoice(this, this.engineBus);

    const loopNoise = (filterType, f, q, gain = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = 0.9 + Math.random() * 0.2;
      const fl = ctx.createBiquadFilter();
      fl.type = filterType;
      fl.frequency.value = f;
      fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      s.connect(fl).connect(g).connect(this.master);
      s.start(0, Math.random() * 2);
      return { s, f: fl, g };
    };
    this.wind = loopNoise('lowpass', 300, 0.5);
    this.roar = loopNoise('lowpass', 150, 0.7);
    this.hiss = loopNoise('bandpass', 3200, 0.6);
    this.squeal = loopNoise('bandpass', 1700, 9);
    this.scrapeN = loopNoise('bandpass', 2600, 2.5);
    this.nitroN = loopNoise('bandpass', 900, 0.6);
    this.rainN = loopNoise('highpass', 1800, 0.4);
    this.rainLow = loopNoise('lowpass', 700, 0.5);
    // tonal squeal component
    this.sqOsc = ctx.createOscillator();
    this.sqOsc.type = 'sawtooth';
    this.sqOsc.frequency.value = 820;
    const sqF = ctx.createBiquadFilter();
    sqF.type = 'bandpass';
    sqF.frequency.value = 1300;
    sqF.Q.value = 4;
    this.sqG = ctx.createGain();
    this.sqG.gain.value = 0;
    this.sqOsc.connect(sqF).connect(this.sqG).connect(this.master);
    this.sqOsc.start();
    // turbo whine
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboG = ctx.createGain();
    this.turboG.gain.value = 0;
    this.turbo.connect(this.turboG).connect(this.master);
    this.turbo.start();
    this.ready = true;
  }

  setRain(k) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.rainN.g.gain.setTargetAtTime(0.05 * k, t, 0.5);
    this.rainLow.g.gain.setTargetAtTime(0.035 * k, t, 0.5);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }

  // per-frame update of the player's car sounds
  updatePlayer(v, info) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const thr = v.throttle;
    const load = clamp(thr * (v.shiftTimer > 0 ? 0.25 : 1) + (v.limiter ? -0.4 : 0) + (v.nitroActive ? 0.2 : 0), 0, 1);
    const limWobble = v.limiter ? Math.sin(t * 70) * 160 : 0;
    this.player.set(v.rpm + limWobble, load, info.engineVol ?? 1);
    const speed = v.speed;
    const sp = clamp(speed / 90, 0, 1.3);
    this.wind.g.gain.setTargetAtTime(sp * sp * 0.32, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(250 + speed * 22, t, 0.1);
    this.roar.g.gain.setTargetAtTime(sp * 0.3, t, 0.1);
    this.hiss.g.gain.setTargetAtTime(sp * 0.07 * (info.wet ?? 1), t, 0.1);
    const slip = clamp(info.slip ?? 0, 0, 1);
    this.squeal.g.gain.setTargetAtTime(Math.pow(slip, 1.5) * 0.16, t, 0.05);
    this.squeal.f.frequency.setTargetAtTime(1500 + slip * 500 + Math.random() * 120, t, 0.05);
    this.sqG.gain.setTargetAtTime(Math.pow(slip, 1.8) * 0.045, t, 0.05);
    this.sqOsc.frequency.setTargetAtTime(760 + slip * 260 + Math.random() * 60, t, 0.03);
    this.scrapeN.g.gain.setTargetAtTime(clamp(info.scrape ?? 0, 0, 1) * 0.35, t, 0.04);
    this.nitroN.g.gain.setTargetAtTime(v.nitroActive ? 0.16 : 0, t, 0.08);
    // turbo spool + blow-off when lifting from boost
    this.boost = lerp(this.boost, thr * clamp(v.rpm / 7000, 0, 1), 0.08);
    this.turbo.frequency.setTargetAtTime(1900 + this.boost * 4200, t, 0.05);
    this.turboG.gain.setTargetAtTime(this.boost * this.boost * 0.012, t, 0.05);
    if (this.lastThrottle > 0.7 && thr < 0.2 && this.boost > 0.45) this.blowOff(this.boost);
    this.lastThrottle = thr;
  }

  burst(dur, type, f0, f1, q, gain, when = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  blowOff(k) { this.burst(0.42, 'bandpass', 2800, 900, 1.6, 0.22 * k); }
  pop(k = 1) {
    this.burst(0.07 + Math.random() * 0.05, 'lowpass', 1600, 300, 0.8, 0.5 * k);
    if (Math.random() < 0.5) this.burst(0.05, 'lowpass', 1200, 200, 0.8, 0.35 * k, 0.06 + Math.random() * 0.05);
  }
  nitroStart() { this.burst(0.6, 'bandpass', 500, 2400, 0.8, 0.3); }
  shiftClunk() { this.burst(0.05, 'lowpass', 500, 120, 1, 0.18); }

  impact(k) {
    if (!this.ready) return;
    k = clamp(k, 0, 1);
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * k + 0.05, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
    this.burst(0.3, 'lowpass', 3500, 400, 0.7, 0.55 * k + 0.05);
    if (k > 0.4) this.burst(0.5, 'highpass', 4000, 2500, 0.7, 0.15 * k, 0.03);
  }

  beep(freq, dur = 0.18, gain = 0.25) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // rival engines with distance attenuation, stereo pan and doppler
  updateRivals(list, listener) {
    if (!this.ready) return;
    while (this.rivals.length < list.length) this.rivals.push(new EngineVoice(this, this.engineBus, true));
    list.forEach((r, i) => {
      const dx = r.x - listener.x, dz = r.z - listener.z;
      const d = Math.hypot(dx, dz) + 0.01;
      const att = 1 / (1 + (d / 14) * (d / 14));
      const pan = (dx * listener.rx + dz * listener.rz) / d;
      const vRel = ((r.vx - listener.vx) * dx + (r.vz - listener.vz) * dz) / d; // + = moving away
      const dop = clamp(343 / (343 + vRel), 0.8, 1.25);
      this.rivals[i].set(r.rpm, r.throttle, att * 0.55, dop, pan);
    });
  }

  silenceRivals() {
    for (const r of this.rivals) r.set(800, 0, 0);
  }
}
