// Small math helpers shared by every module (no three.js dependency so physics can run headless).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential smoothing.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cubic Hermite interpolation through a sorted [[x, y], ...] table.
export function interpTable(tbl, x) {
  const n = tbl.length;
  if (x <= tbl[0][0]) return tbl[0][1];
  if (x >= tbl[n - 1][0]) return tbl[n - 1][1];
  let i = 0;
  while (i < n - 2 && x > tbl[i + 1][0]) i++;
  const x0 = tbl[i][0], x1 = tbl[i + 1][0];
  const h = x1 - x0;
  const t = (x - x0) / h;
  const p1 = tbl[i][1], p2 = tbl[i + 1][1];
  const im = Math.max(0, i - 1), ip = Math.min(n - 1, i + 2);
  const m1 = i === 0 ? p2 - p1 : ((p2 - tbl[im][1]) / (x1 - tbl[im][0])) * h;
  const m2 = i + 1 === n - 1 ? p2 - p1 : ((tbl[ip][1] - p1) / (tbl[ip][0] - x0)) * h;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
}

// Linear interpolation in a sorted table (cheap, for torque curves etc).
export function linTable(tbl, x) {
  const n = tbl.length;
  if (x <= tbl[0][0]) return tbl[0][1];
  if (x >= tbl[n - 1][0]) return tbl[n - 1][1];
  let i = 0;
  while (i < n - 2 && x > tbl[i + 1][0]) i++;
  const t = (x - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
  return tbl[i][1] + (tbl[i + 1][1] - tbl[i][1]) * t;
}

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// Smooth 1D value noise in [-1, 1].
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
}

export function formatTime(t) {
  if (!isFinite(t) || t < 0) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};
