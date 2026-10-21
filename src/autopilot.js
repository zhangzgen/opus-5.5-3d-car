// Pure-pursuit driver for the player's physics car (used after the finish line and in tests).
import { clamp, wrapAngle } from './util.js';

export function autopilot(v, track, proj, { pace = 1, line = 1 } = {}) {
  const speed = v.speed;
  const look = 9 + speed * 0.5;
  const sT = proj.s + look;
  const f = track.sample(sT);
  const dT = track.valueAt(track.racingLine, sT) * line;
  const dx = f.x + f.lx * dT - v.x, dz = f.z + f.lz * dT - v.z;
  const ang = wrapAngle(Math.atan2(dx, dz) - v.heading);
  const steer = clamp(-ang * 2.4, -1, 1);
  const vt = Math.min(track.valueAt(track.speedProfile, proj.s + 4 + speed * 0.45), track.valueAt(track.speedProfile, proj.s + 1)) * pace;
  return {
    steer,
    throttle: clamp((vt - speed) * 0.45, 0, 1),
    brake: clamp((speed - vt) * 0.3, 0, 1),
    handbrake: 0,
    nitro: 0,
  };
}
