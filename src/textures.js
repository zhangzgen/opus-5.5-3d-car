// Procedural canvas textures: everything in the game is generated at load time.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(canvas, { srgb = true, repeat = false, aniso = 8, mips = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = mips;
  t.needsUpdate = true;
  return t;
}

function noiseFill(ctx, w, h, base, amp, rnd, size = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
    const n = (rnd() - 0.5) * amp;
    for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
      const i = ((y + yy) * w + (x + xx)) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] + n));
      d[i + 1] = Math.max(0, Math.min(255, base[1] + n));
      d[i + 2] = Math.max(0, Math.min(255, base[2] + n));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, w, h, rnd, count, color, rMin, rMax, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h, r = rMin + rnd() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${alpha * rnd()})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// Concrete barrier: one 4 m segment per repeat (u along track), profile across v.
export function concreteTexture() {
  const w = 512, h = 128, c = makeCanvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(11);
  noiseFill(ctx, w, h, [150, 150, 146], 26, rnd, 2);
  blotches(ctx, w, h, rnd, 60, '60,58,52', 6, 40, 0.35);
  blotches(ctx, w, h, rnd, 30, '200,200,195', 6, 30, 0.2);
  // grime toward the base (v = 0 is the road side bottom)
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(25,22,18,0.75)');
  g.addColorStop(0.35, 'rgba(25,22,18,0.15)');
  g.addColorStop(1, 'rgba(25,22,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // painted top band: alternating red / white blocks like a street circuit
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, 3, h);
  ctx.fillRect(w - 2, 0, 2, h);
  return tex(c, { repeat: true });
}

export function paintedBarrierTexture() {
  const w = 512, h = 128, c = makeCanvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(12);
  ctx.fillStyle = '#d9d9d4';
  ctx.fillRect(0, 0, w / 2, h);
  ctx.fillStyle = '#b3201b';
  ctx.fillRect(w / 2, 0, w / 2, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  blotches(ctx, w, h, rnd, 50, '40,36,30', 5, 30, 0.35);
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(20,18,15,0.8)');
  g.addColorStop(0.4, 'rgba(20,18,15,0.1)');
  g.addColorStop(1, 'rgba(20,18,15,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, 3, h);
  return tex(c, { repeat: true });
}

export function sidewalkTexture() {
  const w = 256, h = 256, c = makeCanvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(21);
  noiseFill(ctx, w, h, [92, 90, 88], 20, rnd, 2);
  blotches(ctx, w, h, rnd, 40, '30,28,26', 5, 30, 0.4);
  ctx.strokeStyle = 'rgba(20,20,20,0.7)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(w, i * 64); ctx.stroke();
  }
  return tex(c, { repeat: true });
}

export function tileTexture() {
  const w = 256, h = 256, c = makeCanvas(w, h), ctx = c.getContext('2d');
  const rnd = mulberry32(31);
  ctx.fillStyle = '#c9c4b8';
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = 185 + rnd() * 30;
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 14})`;
    ctx.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
  }
  blotches(ctx, w, h, rnd, 30, '50,45,35', 8, 40, 0.35);
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(30,25,20,0.7)');
  g.addColorStop(0.3, 'rgba(30,25,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return tex(c, { repeat: true });
}

export function radialTexture(stops, size = 128) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return tex(c, { srgb: false });
}

export function smokeTexture() {
  const s = 128, c = makeCanvas(s, s), ctx = c.getContext('2d');
  const rnd = mulberry32(41);
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * s * 0.22;
    const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r, rr = s * (0.16 + rnd() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(255,255,255,${0.16 + rnd() * 0.12})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.25, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return tex(c, { srgb: false });
}

export function flakeNormalMap() {
  const s = 256, c = makeCanvas(s, s), ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const rnd = mulberry32(51);
  for (let i = 0; i < s * s; i++) {
    const nx = (rnd() - 0.5) * 0.55, ny = (rnd() - 0.5) * 0.55;
    img.data[i * 4] = 128 + nx * 127;
    img.data[i * 4 + 1] = 128 + ny * 127;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: true });
}

export function carbonTexture() {
  const s = 128, c = makeCanvas(s, s), ctx = c.getContext('2d');
  ctx.fillStyle = '#121314';
  ctx.fillRect(0, 0, s, s);
  const n = 16, cs = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const twill = (x + y) % 4 < 2;
    const g = twill ? ctx.createLinearGradient(x * cs, y * cs, x * cs + cs, y * cs) : ctx.createLinearGradient(x * cs, y * cs, x * cs, y * cs + cs);
    g.addColorStop(0, '#16181a');
    g.addColorStop(0.5, twill ? '#2c2f33' : '#232528');
    g.addColorStop(1, '#141517');
    ctx.fillStyle = g;
    ctx.fillRect(x * cs, y * cs, cs, cs);
  }
  return tex(c, { repeat: true });
}

export function honeycombTexture() {
  const w = 256, h = 128, c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#2a2c30';
  ctx.lineWidth = 2;
  const r = 7;
  for (let row = 0; row < 14; row++) for (let col = 0; col < 24; col++) {
    const x = col * r * 1.75 + (row % 2) * r * 0.87, y = row * r * 1.5;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
  }
  return tex(c, { repeat: true });
}

// Headlight decal laid on the body patch: u = around the section (side → top), v = along length (rear → nose).
export function headlightTextures() {
  const w = 256, h = 256;
  const base = makeCanvas(w, h), bc = base.getContext('2d');
  const emi = makeCanvas(w, h), ec = emi.getContext('2d');
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, w, h);
  // housing outline: slanted blade, wider toward the nose (bottom of canvas = nose)
  const shape = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(18, 210);
    ctx.bezierCurveTo(40, 150, 120, 95, 236, 60);
    ctx.lineTo(244, 150);
    ctx.bezierCurveTo(170, 175, 90, 210, 40, 246);
    ctx.closePath();
  };
  bc.clearRect(0, 0, w, h);
  shape(bc);
  const g = bc.createLinearGradient(0, 60, 0, 246);
  g.addColorStop(0, '#1b1f24');
  g.addColorStop(1, '#0b0d10');
  bc.fillStyle = g;
  bc.fill();
  bc.lineWidth = 5;
  bc.strokeStyle = '#3a3f46';
  bc.stroke();
  // projector lenses
  for (const [x, y, r] of [[150, 128, 20], [196, 112, 17]]) {
    const rg = bc.createRadialGradient(x - 4, y - 4, 2, x, y, r);
    rg.addColorStop(0, '#e9eef5');
    rg.addColorStop(0.4, '#6e7680');
    rg.addColorStop(1, '#14171b');
    bc.fillStyle = rg;
    bc.beginPath(); bc.arc(x, y, r, 0, Math.PI * 2); bc.fill();
    const eg = ec.createRadialGradient(x, y, 0, x, y, r);
    eg.addColorStop(0, '#ffffff');
    eg.addColorStop(0.6, '#cfe0ff');
    eg.addColorStop(1, '#000');
    ec.fillStyle = eg;
    ec.beginPath(); ec.arc(x, y, r, 0, Math.PI * 2); ec.fill();
  }
  // LED daytime running blade along the upper edge
  for (const ctx of [bc, ec]) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(34, 206);
    ctx.bezierCurveTo(58, 160, 130, 112, 230, 78);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(60, 226);
    ctx.lineTo(100, 202);
    ctx.stroke();
  }
  return { map: tex(base), emissive: tex(emi) };
}

// Tail light decal: u across the rear (left → right), v from tail bottom → deck.
export function taillightTextures() {
  const w = 512, h = 128;
  const base = makeCanvas(w, h), bc = base.getContext('2d');
  const emi = makeCanvas(w, h), ec = emi.getContext('2d');
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, w, h);
  bc.clearRect(0, 0, w, h);
  // smoked lens band across the rear
  bc.fillStyle = '#1a0607';
  bc.beginPath();
  bc.moveTo(8, 40); bc.lineTo(504, 40); bc.lineTo(496, 96); bc.lineTo(16, 96);
  bc.closePath();
  bc.fill();
  // LED light bar
  for (const ctx of [bc, ec]) {
    ctx.fillStyle = '#ff1a10';
    ctx.fillRect(40, 60, 432, 7);
    // C-shaped end clusters
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ff2014';
    for (const s of [1, -1]) {
      const x0 = s > 0 ? 18 : w - 18;
      ctx.beginPath();
      ctx.moveTo(x0 + s * 80, 46);
      ctx.lineTo(x0 + s * 4, 46);
      ctx.lineTo(x0 + s * 10, 90);
      ctx.lineTo(x0 + s * 86, 90);
      ctx.stroke();
    }
  }
  // reverse light (white) small blocks: drawn only to base; emissive driven separately
  bc.fillStyle = '#d8d8d8';
  bc.fillRect(226, 74, 60, 10);
  return { map: tex(base), emissive: tex(emi) };
}

export function plateTexture(text) {
  const w = 256, h = 64, c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e6df';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = '#15171a';
  ctx.font = 'bold 40px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  return tex(c);
}

export function softRectTexture(size = 128, inner = 0.55) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = Math.abs(x / (size - 1) * 2 - 1), v = Math.abs(y / (size - 1) * 2 - 1);
    const du = Math.max(0, (u - inner) / (1 - inner)), dv = Math.max(0, (v - inner) / (1 - inner));
    const d = Math.min(1, Math.sqrt(du * du + dv * dv));
    const a = Math.pow(1 - d, 1.6);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}

export function chevronTexture() {
  const w = 256, h = 128, c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#c4161c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f4f4f0';
  for (let i = 0; i < 3; i++) {
    const x = 30 + i * 80;
    ctx.beginPath();
    ctx.moveTo(x, 14); ctx.lineTo(x + 34, 14); ctx.lineTo(x + 70, 64); ctx.lineTo(x + 34, 114); ctx.lineTo(x, 114); ctx.lineTo(x + 36, 64);
    ctx.closePath();
    ctx.fill();
  }
  return tex(c);
}

// Neon sign: glowing tube text on a dark backing. Returns texture + aspect.
export function neonTexture(text, color, { font = 'Teko', size = 120, sub = null, vertical = false, frame = true } = {}) {
  const pad = 40;
  const meas = makeCanvas(8, 8).getContext('2d');
  meas.font = `600 ${size}px "${font}", "Arial Narrow", sans-serif`;
  let w, h;
  const chars = [...text];
  if (vertical) {
    w = size * 1.25 + pad * 2;
    h = chars.length * size * 1.02 + pad * 2;
  } else {
    w = Math.ceil(meas.measureText(text).width) + pad * 2;
    h = Math.ceil(size * (sub ? 1.45 : 1.05)) + pad * 2;
  }
  w = Math.min(2048, w);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#07080a';
  ctx.fillRect(0, 0, w, h);
  ctx.font = meas.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const draw = (blur, alpha, col, lw) => {
    ctx.shadowColor = col;
    ctx.shadowBlur = blur;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    if (vertical) chars.forEach((ch, i) => ctx.fillText(ch, w / 2, pad + size * 0.55 + i * size * 1.02));
    else {
      ctx.fillText(text, w / 2, sub ? pad + size * 0.52 : h / 2 + size * 0.06);
      if (sub) {
        ctx.font = `600 ${Math.round(size * 0.32)}px "Rajdhani", Arial, sans-serif`;
        ctx.fillText(sub, w / 2, pad + size * 1.22);
        ctx.font = meas.font;
      }
    }
    if (frame) ctx.strokeRect(10, 10, w - 20, h - 20);
  };
  draw(28, 0.9, color, 6);
  draw(6, 1, '#ffffff', 2);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  return { texture: tex(c), aspect: w / h };
}

// Large lit advertising billboard with simple fictional brand art.
export function billboardTexture(kind) {
  const w = 1024, h = 512, c = makeCanvas(w, h), ctx = c.getContext('2d');
  const designs = {
    volt: () => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0b1f3a'); g.addColorStop(1, '#05070d');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c8ff2e';
      ctx.beginPath(); ctx.moveTo(640, 40); ctx.lineTo(540, 270); ctx.lineTo(620, 270); ctx.lineTo(560, 480); ctx.lineTo(780, 200); ctx.lineTo(690, 200); ctx.lineTo(760, 40); ctx.fill();
      ctx.font = '700 150px Teko, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.fillText('VOLT', 60, 250);
      ctx.font = '600 50px Rajdhani, sans-serif'; ctx.fillStyle = '#c8ff2e'; ctx.fillText('ENERGY · ZERO SUGAR', 64, 330);
    },
    ramen: () => {
      ctx.fillStyle = '#a3140f'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd35a';
      ctx.beginPath(); ctx.arc(780, 300, 170, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#ffefd0'; ctx.fillRect(600, 296, 360, 10);
      ctx.font = '700 130px Teko, sans-serif'; ctx.fillStyle = '#fff4e0'; ctx.fillText('KAIJU', 60, 210);
      ctx.fillText('RAMEN', 60, 330);
      ctx.font = '600 44px Rajdhani, sans-serif'; ctx.fillStyle = '#ffd35a'; ctx.fillText('OPEN UNTIL 4 AM', 64, 410);
    },
    radio: () => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#3b0a57'); g.addColorStop(1, '#ff3d7f');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 8;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(820, 260, 40 + i * 45, -0.9, 0.9); ctx.stroke(); }
      ctx.font = '700 170px Teko, sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('88.1', 60, 280);
      ctx.font = '600 52px Rajdhani, sans-serif'; ctx.fillText('NIGHTWAVE FM', 66, 360);
    },
    tyres: () => {
      ctx.fillStyle = '#111316'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffb52e'; ctx.lineWidth = 40;
      ctx.beginPath(); ctx.arc(800, 256, 170, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(800, 256, 110, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '700 140px Teko, sans-serif'; ctx.fillStyle = '#ffb52e'; ctx.fillText('GRIPLINE', 50, 250);
      ctx.font = '600 48px Rajdhani, sans-serif'; ctx.fillStyle = '#e8e8e8'; ctx.fillText('WET WEATHER PERFORMANCE', 56, 330);
    },
    hotel: () => {
      ctx.fillStyle = '#071c22'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#39e6d0';
      ctx.font = '700 150px Teko, sans-serif'; ctx.fillText('HOTEL', 60, 230);
      ctx.fillStyle = '#ffffff'; ctx.fillText('MERIDIAN', 60, 360);
      ctx.font = '600 44px Rajdhani, sans-serif'; ctx.fillStyle = '#39e6d0'; ctx.fillText('SKY BAR · LEVEL 52', 66, 440);
    },
  };
  (designs[kind] || designs.volt)();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, w - 10, h - 10);
  return tex(c);
}

export function gantryTexture() {
  const w = 1024, h = 128, c = makeCanvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = '#050608';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffb52e';
  ctx.font = 'italic 600 104px Teko, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('MIDNIGHT APEX', w / 2, h / 2 + 8);
  // checker ends
  for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#ffffff' : '#000000';
    ctx.fillRect(j * 32 + 8, i * 14 + 8, 32, 14);
    ctx.fillRect(w - 72 + j * 32, i * 14 + 8, 32, 14);
  }
  return tex(c);
}
