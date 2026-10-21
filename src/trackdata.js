// Track centreline: turtle-built closed circuit, resampled at ~1 m, with frames, curvature,
// AI speed profile and racing line. Pure JS so it can be tested headless.
import { clamp } from './util.js';

export const ROAD_HALF = 9.0;            // asphalt half width (m)
export const WALL_D = ROAD_HALF + 0.45;  // inner face of the concrete barriers
export const SIDEWALK_IN = ROAD_HALF + 1.15;
export const SIDEWALK_OUT = ROAD_HALF + 7.5;

const DEG = Math.PI / 180;
const G = 9.81;

// Math-space turtle (x right, y up, +a = left turn). 'A' and 'B' are solved so the loop closes.
const LAYOUT = [
  { L: 380 },                        // 0  start / finish straight
  { R: 150, a: 90 },                 // 1  fast sweeper
  { L: 100 },
  { R: 70, a: -45 }, { R: 70, a: 45 }, // chicane
  { L: 120 },
  { R: 50, a: 90 },                  // 6  90° onto the back straight
  { L: 450 },                        // 7  back straight (tunnel)
  { R: 90, a: -40 }, { R: 90, a: 40 }, // esses
  { L: 80 },
  { R: 38, a: 90 },                  // 11 tight left
  { L: 110 },
  { R: 260, a: -16 }, { R: 260, a: 16 }, // flat-out kink
  { L: 'A' },                        // 15 harbour straight
  { R: 60, a: -90 },
  { L: 60 },
  { R: 28, a: 180 },                 // 18 hairpin
  { L: 'B' },                        // 19 run back to the line
];

function runTurtle(free) {
  let x = 0, y = 0, h = 0, len = 0;
  const pts = [[0, 0]];
  const segStart = [];
  const freeDir = {};
  for (const seg of LAYOUT) {
    segStart.push(len);
    if (seg.L !== undefined) {
      const isFree = typeof seg.L === 'string';
      const L = isFree ? free[seg.L] : seg.L;
      if (isFree) freeDir[seg.L] = [Math.cos(h), Math.sin(h)];
      if (L > 0) {
        const n = Math.max(1, Math.ceil(L / 0.5));
        for (let i = 1; i <= n; i++) {
          x += (Math.cos(h) * L) / n;
          y += (Math.sin(h) * L) / n;
          pts.push([x, y]);
        }
        len += L;
      }
    } else {
      const ang = seg.a * DEG, arc = Math.abs(ang) * seg.R, n = Math.ceil(arc / 0.5);
      for (let i = 1; i <= n; i++) {
        const hm = h + (ang / n) * 0.5;
        x += (Math.cos(hm) * arc) / n;
        y += (Math.sin(hm) * arc) / n;
        h += ang / n;
        pts.push([x, y]);
      }
      len += arc;
    }
  }
  return { pts, x, y, freeDir, segStart, len };
}

function solveLayout() {
  const r0 = runTurtle({ A: 0, B: 0 });
  const [ax, ay] = r0.freeDir.A, [bx, by] = r0.freeDir.B;
  const det = ax * by - ay * bx;
  const A = (-r0.x * by + bx * r0.y) / det;
  const B = (-ax * r0.y + r0.x * ay) / det;
  return { A, B, run: runTurtle({ A, B }) };
}

export class TrackData {
  constructor() {
    const { A, B, run } = solveLayout();
    this.freeLengths = { A, B };
    let pts = run.pts;
    // drop the closing duplicate
    const last = pts[pts.length - 1];
    if (Math.hypot(last[0], last[1]) < 0.3) pts = pts.slice(0, -1);
    // world (x, z) = math (x, -y)
    let P = pts.map((p) => [p[0], -p[1]]);
    // soften curvature steps with a few closed moving-average passes (±5 m)
    const M = P.length, K = 10;
    for (let it = 0; it < 3; it++) {
      const Q = new Array(M);
      for (let i = 0; i < M; i++) {
        let sx = 0, sz = 0;
        for (let k = -K; k <= K; k++) {
          const p = P[(i + k + M) % M];
          sx += p[0];
          sz += p[1];
        }
        Q[i] = [sx / (2 * K + 1), sz / (2 * K + 1)];
      }
      P = Q;
    }
    // resample uniformly by arc length
    const cum = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) {
      const a = P[i], b = P[(i + 1) % M];
      cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const length = cum[M];
    const N = Math.round(length);
    const ds = length / N;
    this.N = N;
    this.ds = ds;
    this.length = length;
    const px = new Float64Array(N), pz = new Float64Array(N);
    let seg = 0;
    for (let i = 0; i < N; i++) {
      const s = i * ds;
      while (cum[seg + 1] < s) seg++;
      const t = (s - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      const a = P[seg], b = P[(seg + 1) % M];
      px[i] = a[0] + (b[0] - a[0]) * t;
      pz[i] = a[1] + (b[1] - a[1]) * t;
    }
    const tx = new Float64Array(N), tz = new Float64Array(N);
    const lx = new Float64Array(N), lz = new Float64Array(N);
    const heading = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      tx[i] = dx; tz[i] = dz;
      // left of travel direction (matches vehicle convention: forward (sin h, cos h), left (cos h, -sin h))
      lx[i] = dz; lz[i] = -dx;
      heading[i] = Math.atan2(dx, dz);
    }
    const kappa = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      kappa[i] = ((tx[b] - tx[a]) * lx[i] + (tz[b] - tz[a]) * lz[i]) / (2 * ds);
    }
    Object.assign(this, { px, pz, tx, tz, lx, lz, heading, kappa });
    this.kappaSmooth = this.smoothArray(kappa, Math.round(12 / ds));

    // feature placement (turtle lengths scaled to the smoothed loop)
    const sc = length / run.len;
    const ss = (i, off = 0) => (run.segStart[i] + off) * sc;
    this.startS = 60;
    this.tunnel = [ss(7, 95), ss(7, 345)];
    this.bridges = [
      { s: ss(0, 255), angle: 0.32, len: 120 },
      { s: ss(15, Math.max(40, A * 0.55)), angle: -0.25, len: 110 },
    ];
    this.segStartS = run.segStart.map((v) => v * sc);

    this.buildSpeedProfile();
    this.buildRacingLine();
    this.buildLamps();
    this.buildGrid();
  }

  smoothArray(arr, half) {
    const N = this.N, out = new Float64Array(N);
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += arr[(k + N) % N];
    for (let i = 0; i < N; i++) {
      out[i] = acc / (2 * half + 1);
      acc += arr[(i + half + 1) % N] - arr[(i - half + N) % N];
    }
    return out;
  }

  wrapS(s) {
    const L = this.length;
    s %= L;
    return s < 0 ? s + L : s;
  }

  // Interpolated frame at arc length s. Returns a reused object unless `out` is given.
  sample(s, out = this._tmp || (this._tmp = {})) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    out.x = this.px[i] + (this.px[j] - this.px[i]) * t;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let dx = this.tx[i] + (this.tx[j] - this.tx[i]) * t;
    let dz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    out.tx = dx; out.tz = dz; out.lx = dz; out.lz = -dx;
    out.heading = Math.atan2(dx, dz);
    out.kappa = this.kappa[i] + (this.kappa[j] - this.kappa[i]) * t;
    out.index = i;
    return out;
  }

  valueAt(arr, s) {
    s = this.wrapS(s);
    const f = s / this.ds;
    const i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    return arr[i] + (arr[j] - arr[i]) * t;
  }

  // Nearest centreline point. `hint` is the previous sample index (local search) or -1.
  project(x, z, hint = -1, out = {}) {
    const { N, px, pz } = this;
    let best = -1, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -45; k <= 45; k++) {
        const i = (hint + k + N) % N;
        const dx = x - px[i], dz = z - pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD > 40 * 40) best = -1;
    }
    if (best < 0) {
      bestD = Infinity;
      for (let i = 0; i < N; i++) {
        const dx = x - px[i], dz = z - pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    const dx = x - px[best], dz = z - pz[best];
    const along = dx * this.tx[best] + dz * this.tz[best];
    out.s = this.wrapS(best * this.ds + along);
    out.d = dx * this.lx[best] + dz * this.lz[best];
    out.index = best;
    out.lx = this.lx[best]; out.lz = this.lz[best];
    out.tx = this.tx[best]; out.tz = this.tz[best];
    return out;
  }

  inTunnel(s) {
    s = this.wrapS(s);
    return s > this.tunnel[0] && s < this.tunnel[1];
  }
  tunnelFactor(s, ramp = 18) {
    s = this.wrapS(s);
    const [a, b] = this.tunnel;
    if (s < a - ramp || s > b + ramp) return 0;
    return clamp(Math.min((s - (a - ramp)) / (2 * ramp), ((b + ramp) - s) / (2 * ramp)), 0, 1);
  }

  buildSpeedProfile() {
    const { N, ds } = this;
    const MU = 1.5, C = 0.95 / (1420 * G), VTOP = 88, BRAKE = 8.5;
    const k = this.smoothArray(this.kappa.map(Math.abs), Math.round(10 / ds));
    const v = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const den = k[i] - MU * G * C;
      v[i] = den <= 1e-5 ? VTOP : Math.min(VTOP, Math.sqrt((MU * G) / den));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let n = N - 1; n >= 0; n--) {
        const i = n, j = (n + 1) % N;
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * BRAKE * ds));
      }
    }
    this.speedProfile = v;
  }

  buildRacingLine() {
    const { N, ds } = this;
    const k = this.smoothArray(this.kappa, Math.round(32 / ds));
    const lim = ROAD_HALF - 2.4;
    const d = new Float64Array(N);
    for (let i = 0; i < N; i++) d[i] = clamp(k[i] * 420, -lim, lim);
    this.racingLine = this.smoothArray(d, Math.round(20 / ds));
  }

  buildLamps() {
    const L = this.length;
    const count = Math.round(L / 36);
    this.lampSpacing = L / count;
    const lamps = [];
    const blocked = (s) => {
      const [a, b] = this.tunnel;
      if (s > a - 16 && s < b + 16) return true;
      for (const br of this.bridges) if (Math.abs(this.wrapS(s - br.s + L / 2) - L / 2) < 14) return true;
      return false;
    };
    for (let k = 0; k < count; k++) {
      const sL = k * this.lampSpacing, sR = sL + this.lampSpacing * 0.5;
      if (!blocked(sL)) lamps.push({ s: sL, side: 1 });
      if (!blocked(sR)) lamps.push({ s: sR, side: -1 });
    }
    this.lamps = lamps;
    this.lampBlocked = blocked;
  }

  // coarse spatial hash of centreline samples for "distance to track" queries
  buildGrid() {
    this.cell = 30;
    this.grid = new Map();
    for (let i = 0; i < this.N; i += 2) {
      const key = this.key(Math.floor(this.px[i] / this.cell), Math.floor(this.pz[i] / this.cell));
      let arr = this.grid.get(key);
      if (!arr) this.grid.set(key, (arr = []));
      arr.push(i);
    }
  }
  key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }
  distanceToTrack(x, z, maxR = 90) {
    const c = this.cell, r = Math.ceil(maxR / c);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = Infinity;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const arr = this.grid.get(this.key(cx + i, cz + j));
      if (!arr) continue;
      for (const k of arr) {
        const dx = x - this.px[k], dz = z - this.pz[k];
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  }

  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    return { minX, maxX, minZ, maxZ };
  }
}
