// Contact resolution: car footprint vs. the circuit barriers, and car vs. car (three circles each).
import { WALL_D } from './trackdata.js';

// footprint sample points: [forward, left] in metres
const PTS = [[2.2, 0.9], [2.2, -0.9], [-2.25, 0.92], [-2.25, -0.92], [1.3, 0.99], [1.3, -0.99], [0, 0.97], [0, -0.97], [-1.3, 1.0], [-1.3, -1.0]];

export function collideWalls(v, proj) {
  const sinH = Math.sin(v.heading), cosH = Math.cos(v.heading);
  let hit = null;
  for (const [cf, cl] of PTS) {
    const rx = sinH * cf + cosH * cl, rz = cosH * cf - sinH * cl;
    const d = proj.d + rx * proj.lx + rz * proj.lz;
    let pen = 0, nx = 0, nz = 0, side = 0;
    if (d > WALL_D) { pen = d - WALL_D; nx = -proj.lx; nz = -proj.lz; side = 1; }
    else if (d < -WALL_D) { pen = -WALL_D - d; nx = proj.lx; nz = proj.lz; side = -1; }
    if (pen > 0 && (!hit || pen > hit.pen)) hit = { rx, rz, nx, nz, pen, side };
  }
  if (!hit) return null;
  v.x += hit.nx * hit.pen;
  v.z += hit.nz * hit.pen;
  hit.impact = v.applyContact(hit.rx, hit.rz, hit.nx, hit.nz, 0.15, 0.3);
  hit.px = v.x + hit.rx;
  hit.pz = v.z + hit.rz;
  return hit;
}

const OFFS = [-1.4, 0, 1.4];
const RAD = 0.97;

// Bodies expose: x, z, heading, vx, vz, yawRate, mass, inertia.
export function collideBodies(A, B) {
  const dx0 = A.x - B.x, dz0 = A.z - B.z;
  if (dx0 * dx0 + dz0 * dz0 > 36) return null;
  const sa = Math.sin(A.heading), ca = Math.cos(A.heading);
  const sb = Math.sin(B.heading), cb = Math.cos(B.heading);
  let best = null;
  for (const oa of OFFS) for (const ob of OFFS) {
    const ax = A.x + sa * oa, az = A.z + ca * oa;
    const bx = B.x + sb * ob, bz = B.z + cb * ob;
    const dx = ax - bx, dz = az - bz;
    const d = Math.hypot(dx, dz);
    const pen = 2 * RAD - d;
    if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0, cx: (ax + bx) / 2, cz: (az + bz) / 2 };
  }
  if (!best) return null;
  const { nx, nz, pen, cx, cz } = best;
  const ima = 1 / A.mass, imb = 1 / B.mass;
  const corr = pen / (ima + imb);
  A.x += nx * corr * ima; A.z += nz * corr * ima;
  B.x -= nx * corr * imb; B.z -= nz * corr * imb;
  const rax = cx - A.x, raz = cz - A.z, rbx = cx - B.x, rbz = cz - B.z;
  const vax = A.vx + A.yawRate * raz, vaz = A.vz - A.yawRate * rax;
  const vbx = B.vx + B.yawRate * rbz, vbz = B.vz - B.yawRate * rbx;
  const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
  if (vn >= 0) return { ...best, impact: 0 };
  const rna = raz * nx - rax * nz, rnb = rbz * nx - rbx * nz;
  const j = (-(1 + 0.3) * vn) / (ima + imb + (rna * rna) / A.inertia + (rnb * rnb) / B.inertia);
  A.vx += j * nx * ima; A.vz += j * nz * ima; A.yawRate += (rna * j) / A.inertia;
  B.vx -= j * nx * imb; B.vz -= j * nz * imb; B.yawRate -= (rnb * j) / B.inertia;
  // a little tangential friction so side swipes trade speed
  const tx = -nz, tz = nx;
  const vt = (vax - vbx) * tx + (vaz - vbz) * tz;
  const jt = Math.max(-0.25 * j, Math.min(0.25 * j, -vt / (ima + imb) * 0.5));
  A.vx += jt * tx * ima; A.vz += jt * tz * ima;
  B.vx -= jt * tx * imb; B.vz -= jt * tz * imb;
  return { ...best, impact: -vn };
}
