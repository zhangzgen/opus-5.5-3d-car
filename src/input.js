// Keyboard, gamepad and touch input folded into one analog control state.
import { clamp } from './util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.nitro = false;
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false };
    this.usingPad = false;
    this.padPrev = [];
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(ids) {
    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e) => { e.preventDefault(); this.touch[key] = true; el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.touch[key] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    };
    for (const [id, key] of Object.entries(ids)) bind(id, key);
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  // speed in m/s lets keyboard steering soften at high speed
  update(dt, speed = 0) {
    const k = this;
    let steerT = 0, thr = 0, brk = 0, hb = false, nos = false;
    if (k.down('KeyA', 'ArrowLeft') || k.touch.left) steerT -= 1;
    if (k.down('KeyD', 'ArrowRight') || k.touch.right) steerT += 1;
    if (k.down('KeyW', 'ArrowUp') || k.touch.gas) thr = 1;
    if (k.down('KeyS', 'ArrowDown') || k.touch.brake) brk = 1;
    if (k.down('Space')) hb = true;
    if (k.down('ShiftLeft', 'ShiftRight', 'KeyN') || k.touch.nitro) nos = true;

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = Math.abs(p.axes[0]) > 0.08 ? p.axes[0] : 0;
      const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
      if (ax || rt > 0.05 || lt > 0.05 || p.buttons.some((b) => b.pressed)) this.usingPad = true;
      if (this.usingPad) {
        if (ax) steerT = Math.sign(ax) * Math.pow(Math.abs(ax), 1.5);
        thr = Math.max(thr, rt);
        brk = Math.max(brk, lt);
        if (p.buttons[2]?.pressed || p.buttons[1]?.pressed) hb = true;
        if (p.buttons[0]?.pressed || p.buttons[5]?.pressed) nos = true;
        const edge = (i, code) => { if (p.buttons[i]?.pressed && !this.padPrev[i]) this.pressed.add(code); };
        edge(3, 'KeyC');
        edge(9, 'Escape');
        edge(8, 'KeyR');
        this.padPrev = p.buttons.map((b) => b.pressed);
      }
      break;
    }

    // keyboard steering ramps; analog sticks pass through
    if (this.usingPad) this.steer = steerT;
    else {
      const hi = clamp(speed / 60, 0, 1);
      const rateIn = 5.5 - hi * 2.5, rateOut = 7;
      const rate = steerT === 0 || Math.sign(steerT) !== Math.sign(this.steer) ? rateOut : rateIn;
      this.steer += clamp(steerT - this.steer, -rate * dt, rate * dt);
    }
    this.throttle = thr;
    this.brake = brk;
    this.handbrake = hb;
    this.nitro = nos;
  }

  endFrame() { this.pressed.clear(); }
}
