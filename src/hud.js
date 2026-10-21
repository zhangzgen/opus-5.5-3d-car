// HUD: analog tachometer with gear + speed + nitrous gauge, rotating minimap, race board,
// floating rival tags, toasts and the drift score readout.
import * as THREE from 'three';
import { clamp, formatTime, ordinal } from './util.js';

const $ = (id) => document.getElementById(id);
const DISPLAY = '"Teko", "Arial Narrow", sans-serif';
const UI = '"Rajdhani", "Segoe UI", Arial, sans-serif';

export class HUD {
  constructor(track) {
    this.track = track;
    this.root = $('hud');
    this.tach = $('tach');
    this.tctx = this.tach.getContext('2d');
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.el = {
      pos: $('hudPos'), posSuf: $('hudPosSuf'), posOf: $('hudPosOf'), lap: $('hudLap'), lapTime: $('hudLapTime'),
      time: $('hudTime'), best: $('hudBest'), board: $('board'), toast: $('toast'), center: $('center-msg'),
      drift: $('drift'), driftPts: $('driftPts'), driftMul: $('driftMul'), tags: $('tags'), hint: $('hint'),
    };
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.sizeCanvases();
    window.addEventListener('resize', () => this.sizeCanvases());
    this.buildMapImage();
    this.tagEls = [];
    this.last = {};
    this._v = new THREE.Vector3();
  }

  sizeCanvases() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.tach, this.mini]) {
      const r = c.getBoundingClientRect();
      const w = Math.max(64, Math.round((r.width || c.width) * this.dpr));
      c.width = w;
      c.height = w;
    }
  }

  buildMapImage() {
    const tr = this.track;
    const b = tr.bounds();
    const pad = 80, scale = 1;
    const w = Math.ceil(b.maxX - b.minX + pad * 2), h = Math.ceil(b.maxZ - b.minZ + pad * 2);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= tr.N; i += 2) {
        const k = i % tr.N;
        const x = (tr.px[k] - b.minX + pad) * scale, y = (tr.pz[k] - b.minZ + pad) * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 34;
    path(); ctx.stroke();
    ctx.strokeStyle = 'rgba(235,240,245,0.9)';
    ctx.lineWidth = 18;
    path(); ctx.stroke();
    // tunnel section darker
    ctx.strokeStyle = 'rgba(255,181,46,0.9)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    const [t0, t1] = tr.tunnel;
    for (let s = t0; s <= t1; s += 4) {
      const f = tr.sample(s);
      const x = (f.x - b.minX + pad) * scale, y = (f.z - b.minZ + pad) * scale;
      if (s === t0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // start line
    const f = tr.sample(tr.startS);
    ctx.save();
    ctx.translate((f.x - b.minX + pad) * scale, (f.z - b.minZ + pad) * scale);
    ctx.rotate(Math.atan2(f.lz, f.lx));
    ctx.fillStyle = '#ff3d2e';
    ctx.fillRect(-14, -3, 28, 6);
    ctx.restore();
    this.mapImg = c;
    this.mapOff = { x: b.minX - pad, z: b.minZ - pad, scale };
  }

  show(on) { this.root.hidden = !on; }

  drawTach(v, nitroFrac, nitroActive) {
    const ctx = this.tctx, W = this.tach.width, H = this.tach.height;
    const s = W / 290;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(s, s);
    const cx = 150, cy = 150, R = 118;
    const maxR = 9000, red = 7800;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (r) => a0 + (a1 - a0) * clamp(r / maxR, 0, 1);
    // backdrop
    const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, R + 24);
    bg.addColorStop(0, 'rgba(6,8,11,0.78)');
    bg.addColorStop(0.82, 'rgba(6,8,11,0.6)');
    bg.addColorStop(1, 'rgba(6,8,11,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(cx, cy, R + 24, 0, Math.PI * 2); ctx.fill();
    // redline band
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(255,61,46,0.85)';
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, ang(red), a1); ctx.stroke();
    // rpm fill
    const rpm = v.rpm;
    const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
    grad.addColorStop(0, 'rgba(255,122,26,0.15)');
    grad.addColorStop(1, 'rgba(255,181,46,0.55)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.arc(cx, cy, R - 18, a0, ang(rpm)); ctx.stroke();
    // ticks + numerals
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r <= maxR; r += 250) {
      const a = ang(r), major = r % 1000 === 0;
      const r0 = major ? R - 16 : R - 9, r1 = R;
      ctx.strokeStyle = r >= red ? '#ff3d2e' : major ? 'rgba(237,241,244,0.95)' : 'rgba(237,241,244,0.45)';
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = r >= red ? '#ff3d2e' : 'rgba(237,241,244,0.85)';
        ctx.font = `500 22px ${DISPLAY}`;
        ctx.fillText(String(r / 1000), cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 31) + 2);
      }
    }
    // needle
    const na = ang(rpm);
    ctx.save();
    ctx.shadowColor = 'rgba(255,140,40,0.9)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = rpm > red ? '#ff4a3a' : '#ffb52e';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na) * 26, cy + Math.sin(na) * 26);
    ctx.lineTo(cx + Math.cos(na) * (R - 6), cy + Math.sin(na) * (R - 6));
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#0b0e12';
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
    // gear
    const gear = v.gear === -1 ? 'R' : String(v.gear);
    ctx.fillStyle = v.limiter || rpm > red ? '#ff4a3a' : '#edf1f4';
    ctx.font = `600 64px ${DISPLAY}`;
    ctx.fillText(gear, cx, cy + 6);
    // speed
    const kmh = Math.round(v.speed * 3.6);
    ctx.fillStyle = '#edf1f4';
    ctx.font = `500 58px ${DISPLAY}`;
    ctx.fillText(String(kmh), cx + 4, cy + 72);
    ctx.font = `600 12px ${UI}`;
    ctx.fillStyle = 'rgba(141,153,166,1)';
    ctx.fillText('KM/H', cx + 4, cy + 100);
    if (v.manual) { ctx.fillText('MANUAL', cx, cy - 44); }
    // nitrous arc in the open bottom of the dial
    const na0 = Math.PI * 0.62, na1 = Math.PI * 0.38;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(92,207,255,0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, R + 12, na0, na1, true); ctx.stroke();
    ctx.save();
    if (nitroActive) { ctx.shadowColor = '#5ccfff'; ctx.shadowBlur = 14; }
    ctx.strokeStyle = '#5ccfff';
    ctx.beginPath(); ctx.arc(cx, cy, R + 12, na0, na0 - (na0 - na1) * clamp(nitroFrac, 0, 1), true); ctx.stroke();
    ctx.restore();
    ctx.font = `600 11px ${UI}`;
    ctx.fillStyle = '#5ccfff';
    ctx.fillText('N₂O', cx, cy + R + 2);
    ctx.restore();
  }

  drawMinimap(player, racers) {
    const ctx = this.mctx, W = this.mini.width;
    const s = W / 190;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.scale(s, s);
    const c = 95, r = 88;
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,8,11,0.62)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    const zoom = 0.3;
    ctx.translate(c, c + 22);
    ctx.rotate(player.heading - Math.PI);
    ctx.scale(zoom, zoom);
    const o = this.mapOff;
    ctx.translate(-(player.x - o.x), -(player.z - o.z));
    ctx.drawImage(this.mapImg, 0, 0);
    for (const rc of racers) {
      ctx.fillStyle = rc.css;
      ctx.beginPath();
      ctx.arc(rc.x - o.x, rc.z - o.z, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#05070a';
      ctx.stroke();
    }
    ctx.restore();
    // player arrow
    ctx.fillStyle = '#ffb52e';
    ctx.beginPath();
    ctx.moveTo(c, c + 22 - 9);
    ctx.lineTo(c + 7, c + 22 + 7);
    ctx.lineTo(c, c + 22 + 3);
    ctx.lineTo(c - 7, c + 22 + 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(237,241,244,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  setText(key, el, text) {
    if (this.last[key] === text) return;
    this.last[key] = text;
    el.textContent = text;
  }

  race({ pos, total, lap, laps, lapTime, raceTime, best, board }) {
    this.setText('pos', this.el.pos, String(pos));
    this.setText('suf', this.el.posSuf, ordinal(pos));
    this.setText('of', this.el.posOf, `/${total}`);
    this.setText('lap', this.el.lap, `${Math.min(lap, laps)}/${laps}`);
    this.setText('lt', this.el.lapTime, formatTime(lapTime));
    this.setText('rt', this.el.time, formatTime(raceTime));
    this.setText('best', this.el.best, best ? `Best ${formatTime(best)}` : 'Best —');
    const key = board.map((b) => b.name + b.me).join('|');
    if (this.last.board !== key) {
      this.last.board = key;
      this.el.board.innerHTML = board
        .map((b, i) => `<div class="${b.me ? 'me' : ''}"><b class="num">${i + 1}</b><span>${b.name}</span><i style="background:${b.css}"></i></div>`)
        .join('');
    }
  }

  toast(text, cls = '', ms = 1600) {
    const d = document.createElement('div');
    d.className = `toast ${cls}`;
    d.textContent = text;
    this.el.toast.appendChild(d);
    while (this.el.toast.children.length > 3) this.el.toast.firstChild.remove();
    setTimeout(() => d.remove(), ms);
  }

  center(big, sub = '', color = '') {
    this.el.center.innerHTML = big ? `<div class="big" style="color:${color || 'var(--ink)'}">${big}</div>${sub ? `<div class="sub">${sub}</div>` : ''}` : '';
  }

  hint(text) { this.setText('hint', this.el.hint, text); }

  drift(points, mult, visible) {
    this.el.drift.style.opacity = visible ? '1' : '0';
    if (visible) {
      this.setText('dp', this.el.driftPts, Math.round(points).toLocaleString('en-US'));
      this.setText('dm', this.el.driftMul, `Drift ×${mult}`);
    }
  }

  tags(list, camera) {
    while (this.tagEls.length < list.length) {
      const d = document.createElement('div');
      d.className = 'tag';
      this.el.tags.appendChild(d);
      this.tagEls.push(d);
    }
    const w = window.innerWidth, h = window.innerHeight;
    // nearest first so the closest rival keeps its label when tags would overlap
    const items = list.map((t, i) => ({ t, i, d: Math.hypot(t.x - camera.position.x, t.z - camera.position.z) })).sort((a, b) => a.d - b.d);
    const placed = [];
    for (const { t, i, d: dist } of items) {
      const el = this.tagEls[i];
      const p = this._v.set(t.x, 1.75, t.z);
      p.project(camera);
      let vis = p.z < 1 && dist < 95 && dist > 7 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      const sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
      if (vis && placed.some(([x, y]) => Math.abs(x - sx) < 90 && Math.abs(y - sy) < 26)) vis = false;
      if (!vis) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      placed.push([sx, sy]);
      el.style.display = 'flex';
      const html = `<b class="num">${t.pos}</b>${t.name}`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; el.style.color = t.css; }
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = String(clamp(1.5 - dist / 70, 0.3, 1));
    }
  }

  clearTags() { for (const el of this.tagEls) el.style.display = 'none'; }
}
