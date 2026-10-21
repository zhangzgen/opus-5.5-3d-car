// Midnight Apex — bootstrap, race state machine and the frame loop.
import * as THREE from 'three';
import { TrackData, ROAD_HALF } from './trackdata.js';
import { buildTrack } from './track.js';
import { buildWorld } from './world.js';
import { createCar, CAR } from './car.js';
import { Vehicle } from './vehicle.js';
import { AIDriver } from './ai.js';
import { collideWalls, collideBodies } from './collide.js';
import { autopilot } from './autopilot.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { FX } from './fx.js';
import { AudioSystem } from './audio.js';
import { HUD } from './hud.js';
import { Post } from './post.js';
import { PlanarReflection } from './reflection.js';
import { Rain } from './rain.js';
import { clamp, lerp, damp, formatTime, ordinal, smoothstep } from './util.js';

const PAINTS = [
  { name: 'Midnight Blue', hex: 0x0d2a74 },
  { name: 'Rosso Corsa', hex: 0x9c0b0b },
  { name: 'Pearl White', hex: 0xd6d7d9 },
  { name: 'Volt Lime', hex: 0x6fbf12 },
  { name: 'Sunset Orange', hex: 0xd0480b },
  { name: 'Stealth Black', hex: 0x0a0b0d },
  { name: 'Ultraviolet', hex: 0x3f1785 },
  { name: 'Liquid Silver', hex: 0x878d95 },
];
const GLOWS = { off: null, cyan: 0x16d8ff, magenta: 0xff1e9a, amber: 0xffa21a };
const RIVALS = [
  { name: 'KAI', paint: 0xa9adb3, rim: 0x18191b, caliper: 0xf0b000, css: '#d4d8de', skill: 1.0, bias: 0.6, wing: true, glow: null },
  { name: 'VEGA', paint: 0x8e0c14, rim: 0x80858c, caliper: 0xd8d8d8, css: '#ff4d4d', skill: 0.988, bias: -0.8, wing: false, glow: 0xff2020 },
  { name: 'MIRAGE', paint: 0xbfc1c0, rim: 0x232427, caliper: 0xc8161a, css: '#f4f4f0', skill: 0.978, bias: 1.2, wing: true, glow: null },
  { name: 'JINX', paint: 0x4c167a, rim: 0x9aa0a8, caliper: 0x2a8cff, css: '#b06bff', skill: 0.968, bias: -1.4, wing: true, glow: 0x9a3cff },
  { name: 'ROOK', paint: 0x121316, rim: 0xb08d3a, caliper: 0xc8161a, css: '#8d99a6', skill: 0.958, bias: 0.0, wing: false, glow: 0x18ff7a },
];
const QUALITY = [
  { pr: 0.75, refl: 0, shadow: 0 },
  { pr: 1.0, refl: 0.35, shadow: 1024 },
  { pr: 1.5, refl: 0.5, shadow: 2048 },
];
const STEP = 1 / 120;

// Clamp every lit fragment so razor-sharp clear-coat highlights can't overflow the half-float
// HDR buffer (Inf → NaN would be smeared across the screen by the bloom pass).
THREE.ShaderChunk.opaque_fragment = THREE.ShaderChunk.opaque_fragment.replace(
  'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
  'gl_FragColor = vec4( clamp( outgoingLight, vec3( 0.0 ), vec3( 24.0 ) ), diffuseColor.a );'
);
const $ = (id) => document.getElementById(id);

const G = {
  state: 'loading',
  laps: 3,
  difficulty: 1,
  paint: 0,
  glow: 'cyan',
  rain: true,
  quality: 2,
  t: 0,
  raceTime: 0,
  stateTime: 0,
  acc: 0,
  pausedFrom: null,
  drift: { pts: 0, mult: 1, time: 0, calm: 0, active: false },
  wrongWay: 0,
  stuckTime: 0,
  unstick: 0,
  lastPos: 6,
  launchBoost: 0,
  scrape: 0,
  resultsShown: false,
};

let renderer, scene, camera, track, trackMeshes, world, post, reflection, hud, input, rig, fx, audio, rain;
let racers = [], player = null;
let pointLights = [], headSpots = [];
let quality = QUALITY[2];

function progress(p, label) {
  $('loadFill').style.width = `${Math.round(p * 100)}%`;
  $('loadStep').textContent = label;
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

async function init() {
  await progress(0.04, 'Warming up the renderer');
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('stage').appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('loadStep').textContent = 'Graphics context lost — reload the page'; });

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.15, 6500);
  camera.layers.enable(1);

  try {
    await Promise.race([
      Promise.all(['600 64px Teko', '500 22px Teko', '600 16px Rajdhani', '700 16px Rajdhani'].map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* fonts are optional */ }

  await progress(0.12, 'Surveying the circuit');
  track = new TrackData();
  trackMeshes = buildTrack(track);
  scene.add(trackMeshes.group);

  await progress(0.3, 'Building the harbour district');
  world = buildWorld(scene, renderer, track, trackMeshes);

  await progress(0.55, 'Preparing the cars');
  buildRacers();
  fx = new FX(scene);
  rain = new Rain(scene);

  for (let i = 0; i < 6; i++) {
    const l = new THREE.PointLight(0xffb070, 0, 50, 2);
    scene.add(l);
    pointLights.push(l);
  }

  reflection = new PlanarReflection(quality.refl || 0.5);
  post = new Post(renderer, scene, camera);
  hud = new HUD(track);
  input = new Input();
  input.bindTouch({ tLeft: 'left', tRight: 'right', tGas: 'gas', tBrake: 'brake', tNitro: 'nitro' });
  rig = new CameraRig(camera);
  audio = new AudioSystem();
  onResize();
  window.addEventListener('resize', onResize);

  await progress(0.72, 'Compiling shaders');
  placeGrid();
  updateVisuals(0.016);
  rig.orbit(0.016, player.car.root.position, player.veh.heading, { radius: 6.3, sweep: { side: 1, range: 1.25 } });
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { /* compile is a warm-up only */ }
  await progress(0.92, 'Polishing the paint');
  renderFrame(0.016);
  await progress(1, 'Ready');

  setupUI();
  setState('menu');
  $('loading').classList.add('done');
  setTimeout(() => ($('loading').hidden = true), 700);
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ racers
function buildRacers() {
  const pc = PAINTS[G.paint];
  const pcar = createCar({ paint: pc.hex, wing: true, plate: 'APEX 01', rim: 0x2b2d31, caliper: 0xd9a400 });
  pcar.beam.visible = false;
  scene.add(pcar.root);
  player = { name: 'YOU', css: '#ffb52e', isPlayer: true, car: pcar, veh: new Vehicle(), proj: {}, hint: -1 };
  // headlights
  for (const sx of [0.62, -0.62]) {
    const sp = new THREE.SpotLight(0xfff1dc, 1900, 110, 0.4, 0.6, 2);
    sp.position.set(sx, 0.72, 2.05);
    sp.target.position.set(sx * 0.6, -1.4, 24);
    pcar.body.add(sp, sp.target);
    headSpots.push(sp);
  }
  racers = [player];
  RIVALS.forEach((r, i) => {
    const car = createCar({ paint: r.paint, rim: r.rim, caliper: r.caliper, wing: r.wing, plate: r.name });
    car.setUnderglow(r.glow);
    scene.add(car.root);
    racers.push({ name: r.name, css: r.css, isPlayer: false, car, def: r, ai: null, idx: i });
  });
  player.car.setUnderglow(GLOWS[G.glow]);
}

function gridSlot(i) {
  const row = Math.floor(i / 2);
  return { s: track.startS - 8 * (row + 1) - (i % 2 ? 4 : 0), d: i % 2 ? -3.6 : 3.6 };
}

function placeGrid() {
  // player starts last on the grid (P6) — work through the field
  const order = [1, 2, 3, 4, 5, 0];
  order.forEach((ri, slot) => {
    const r = racers[ri];
    const g = gridSlot(slot);
    r.lap = 0; r.lapMax = 0; r.finished = false; r.finishTime = 0; r.bestLap = 0; r.lapStart = 0; r.lastLapTime = 0;
    if (r.isPlayer) {
      const f = track.sample(g.s);
      r.veh.reset(f.x + f.lx * g.d, f.z + f.lz * g.d, f.heading);
      r.veh.nitro = 0.6;
      r.hint = -1;
      r.proj = track.project(r.veh.x, r.veh.z, -1, r.proj);
      r.hint = r.proj.index;
      r.sPrev = r.proj.s;
      r.s = g.s;
    } else {
      r.ai = new AIDriver(track, { s: g.s, d: g.d, name: r.name, skill: r.def.skill, bias: r.def.bias, difficulty: G.difficulty, seed: r.idx + 1 });
      r.s = g.s;
    }
    r.gridIndex = slot;
  });
  G.raceTime = 0;
  G.stuckTime = 0;
  G.unstick = 0;
  G.wrongWay = 0;
  G.launchBoost = 0;
  G.drift = { pts: 0, mult: 1, time: 0, calm: 0, active: false };
  G.lastPos = 6;
  G.resultsShown = false;
  fx?.clear();
}

// ------------------------------------------------------------------ UI
const store = {
  get(k, d) { try { const v = localStorage.getItem('midnight-apex:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('midnight-apex:' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};

function saveSettings() {
  if (G.restoring) return;
  store.set('settings', { paint: G.paint, glow: G.glow, laps: G.laps, difficulty: G.difficulty, rain: G.rain });
}

function showPB() {
  const pb = store.get('pb', 0);
  $('trackInfo').textContent = `${(track.length / 1000).toFixed(2)} km · 1 tunnel · 6 cars${pb ? ` · Your best ${formatTime(pb)}` : ''}`;
}

function setupUI() {
  const sw = $('swatches');
  PAINTS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.id = `paint-${i}`;
    b.setAttribute('aria-label', p.name);
    b.setAttribute('aria-pressed', String(i === G.paint));
    b.innerHTML = `<i style="background:#${p.hex.toString(16).padStart(6, '0')}"></i>`;
    b.addEventListener('click', () => {
      G.paint = i;
      player.car.setPaint(p.hex);
      $('paintName').textContent = p.name;
      sw.querySelectorAll('.swatch').forEach((x, k) => x.setAttribute('aria-pressed', String(k === i)));
      saveSettings();
    });
    sw.appendChild(b);
  });
  const seg = (id, fn) => {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      fn(b.dataset.v);
    }));
  };
  seg('glowSeg', (v) => { G.glow = v; player.car.setUnderglow(GLOWS[v]); saveSettings(); });
  seg('lapSeg', (v) => { G.laps = +v; saveSettings(); });
  seg('weatherSeg', (v) => { G.rain = v === 'rain'; saveSettings(); });
  seg('diffSeg', (v) => { G.difficulty = +v; saveSettings(); });
  seg('qualSeg', (v) => setQuality(+v));
  seg('soundSeg', (v) => audio.setEnabled(v === '1'));
  showPB();
  $('startBtn').addEventListener('click', startRace);
  $('resumeBtn').addEventListener('click', () => togglePause(false));
  $('restartBtn').addEventListener('click', () => { togglePause(false); startRace(); });
  $('quitBtn').addEventListener('click', () => { togglePause(false); toMenu(); });
  $('againBtn').addEventListener('click', startRace);
  $('garageBtn').addEventListener('click', toMenu);
  // restore the viewer's last garage choices
  const saved = store.get('settings', null);
  if (saved) {
    G.restoring = true;
    $(`paint-${saved.paint}`)?.click();
    $(`glow-${saved.glow}`)?.click();
    $(`laps-${saved.laps}`)?.click();
    $(`diff-${saved.difficulty}`)?.click();
    $(saved.rain === false ? 'weather-dry' : 'weather-rain')?.click();
    G.restoring = false;
  }
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) G.touch = true;
  document.addEventListener('visibilitychange', () => { if (document.hidden && (G.state === 'race' || G.state === 'countdown')) togglePause(true); });
}

function setQuality(q) {
  G.quality = q;
  quality = QUALITY[q];
  if (quality.refl) reflection.scale = quality.refl;
  renderer.shadowMap.enabled = quality.shadow > 0;
  if (quality.shadow) {
    world.moon.shadow.mapSize.set(quality.shadow, quality.shadow);
    world.moon.shadow.map?.dispose();
    world.moon.shadow.map = null;
  }
  scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
  onResize();
}

function setState(s) {
  G.state = s;
  G.stateTime = 0;
  $('menu').hidden = s !== 'menu';
  hud.show(s === 'countdown' || s === 'race' || s === 'finished');
  $('touch').hidden = !(G.touch && (s === 'race' || s === 'countdown'));
  $('results').hidden = true;
  if (s !== 'countdown' && s !== 'race') hud.center('');
}

function toMenu() {
  showPB();
  placeGrid();
  setState('menu');
  audio.silenceRivals();
  hud.clearTags();
}

function startRace() {
  audio.init();
  placeGrid();
  setState('countdown');
  rig.ready = false;
  hud.center('');
  hud.hint(G.touch ? 'Hold Gas to rev · launch at the green' : 'Hold W to rev · launch at the green');
  trackMeshes.startLights.set(0);
  G.countStep = -1;
}

function togglePause(on) {
  if (on && (G.state === 'race' || G.state === 'countdown' || G.state === 'finished')) {
    G.pausedFrom = G.state;
    G.state = 'paused';
    $('pause').hidden = false;
    if (audio.ctx) audio.ctx.suspend();
  } else if (!on && G.state === 'paused') {
    G.state = G.pausedFrom;
    $('pause').hidden = true;
    if (audio.ctx) audio.ctx.resume();
  }
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, quality.pr);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post?.setSize(w, h, pr);
  reflection?.setSize(w * pr, h * pr);
  hud?.sizeCanvases();
}

// ------------------------------------------------------------------ simulation
function playerInput() {
  return { throttle: input.throttle, brake: input.brake, steer: input.steer, handbrake: input.handbrake, nitro: input.nitro };
}

function stepPhysics(dt) {
  const v = player.veh;
  const racing = G.state === 'race' || G.state === 'finished';
  let inp;
  if (G.state === 'countdown' || G.state === 'menu') inp = { throttle: G.state === 'countdown' ? input.throttle : 0, brake: 0, steer: 0, handbrake: 0, nitro: 0 };
  else if (player.finished || (G.debug && G.debug.auto)) {
    inp = autopilot(v, track, player.proj, { pace: player.finished ? 0.72 : G.debug.pace || 1 });
    if (G.debug && G.debug.auto && !player.finished) { inp.nitro = !!G.debug.nitro; if (G.debug.hand) inp.handbrake = 1; if (G.debug.steer) inp.steer = G.debug.steer; }
    // nose into a wall: back out and try again
    if (G.unstick > 0) {
      G.unstick -= dt;
      inp = { throttle: 0, brake: 1, steer: -inp.steer, handbrake: 0, nitro: 0 };
    } else if (G.stuckTime > 1.2) { G.unstick = 1.3; G.stuckTime = 0; }
  }
  else inp = playerInput();

  if (!racing) {
    // engine free-revs against the clutch while held on the line
    const target = v.idleRPM + inp.throttle * 7200;
    v.rpm = lerp(v.rpm, target + (inp.throttle > 0.9 && v.rpm > 8000 ? -600 * Math.random() : 0), 1 - Math.exp(-(inp.throttle > v.rpm / 9000 ? 7 : 4) * dt));
    v.throttle = inp.throttle;
    v.limiter = v.rpm > 8000;
    v.vx = v.vz = v.yawRate = 0;
    v.gear = 1;
  } else {
    if (G.launchBoost > 0) G.launchBoost -= dt;
    v.step(dt, inp);
    if (G.launchBoost > 0 && v.speed < 30) {
      const f = 2400 / v.mass * dt;
      v.vx += Math.sin(v.heading) * f;
      v.vz += Math.cos(v.heading) * f;
    }
  }
  player.proj = track.project(v.x, v.z, player.hint, player.proj);
  player.hint = player.proj.index;
  const hit = collideWalls(v, player.proj);
  if (hit) onWallHit(hit);
  else G.scrape = Math.max(0, G.scrape - dt * 6);

  // rivals
  const ctxRacers = racers.map((r) => ({ s: r.isPlayer ? r.s : r.ai.s, d: r.isPlayer ? r.proj.d : r.ai.d, v: r.isPlayer ? v.speed : r.ai.v }));
  const ctx = { racers: ctxRacers, playerS: player.s, racing, finished: false };
  for (let i = 1; i < racers.length; i++) {
    const r = racers[i];
    ctx.finished = r.finished;
    // the driver logic sees everyone but itself
    r.ai.update(dt, { ...ctx, racers: ctxRacers.filter((_, k) => k !== i) });
  }
  for (let i = 1; i < racers.length; i++) {
    const a = racers[i].ai;
    const c = collideBodies(v, a);
    if (c && c.impact > 0.4) {
      a.absorb();
      onCarHit(c, racers[i]);
    } else if (c) a.absorb();
    for (let j = i + 1; j < racers.length; j++) {
      const b = racers[j].ai;
      const cc = collideBodies(a, b);
      if (cc) { a.absorb(); b.absorb(); }
    }
  }
  // player unwrapped distance
  let ds = player.proj.s - player.sPrev;
  if (ds < -track.length / 2) ds += track.length;
  if (ds > track.length / 2) ds -= track.length;
  player.s += ds;
  player.sPrev = player.proj.s;
  for (let i = 1; i < racers.length; i++) racers[i].s = racers[i].ai.s;
}

function onWallHit(hit) {
  const v = player.veh;
  G.scrape = Math.min(1, G.scrape + 0.25);
  if (hit.impact > 2.5) {
    audio.impact(clamp(hit.impact / 18, 0.1, 1));
    rig.bump(clamp(hit.impact / 14, 0.1, 1));
    fx.sparks(hit.px, 0.4, hit.pz, hit.nx, hit.nz, v.vx, v.vz, Math.round(clamp(hit.impact * 2, 6, 40)));
    if (G.drift.active && G.drift.pts > 200) {
      hud.toast('Drift lost', 'warn');
      G.drift = { pts: 0, mult: 1, time: 0, calm: 0, active: false };
    }
  } else if (v.speed > 6 && Math.random() < 0.6) {
    fx.sparks(hit.px, 0.35, hit.pz, hit.nx, hit.nz, v.vx, v.vz, 2);
  }
}

function onCarHit(c, other) {
  const k = clamp(c.impact / 12, 0.08, 1);
  audio.impact(k * 0.8);
  rig.bump(k * 0.8);
  if (c.impact > 4) fx.sparks(c.cx, 0.5, c.cz, c.nx, c.nz, player.veh.vx, player.veh.vz, Math.round(6 + k * 20));
}

function updateLaps() {
  const L = track.length;
  for (const r of racers) {
    const prog = r.s - track.startS;
    r.progress = prog;
    const lapNow = Math.floor(prog / L) + 1;
    if (lapNow > r.lapMax) {
      if (r.lapMax >= 1 && G.raceTime > 1) {
        const lt = G.raceTime - r.lapStart;
        r.lastLapTime = lt;
        if (!r.bestLap || lt < r.bestLap) r.bestLap = lt;
        if (r.isPlayer && !r.finished) {
          const pb = store.get('pb', 0);
          if (!pb || lt < pb) { store.set('pb', lt); if (pb) hud.toast('New personal best', 'gold', 2200); }
        }
        if (r.isPlayer && !r.finished) {
          if (lapNow === G.laps) hud.toast('Final lap', 'gold', 2200);
          else if (lapNow <= G.laps) hud.toast(`Lap ${formatTime(lt)}`, r.bestLap === lt ? 'gold' : '');
        }
      }
      r.lapStart = G.raceTime;
      r.lapMax = lapNow;
      if (lapNow > G.laps && !r.finished) {
        r.finished = true;
        r.finishTime = G.raceTime;
        if (r.isPlayer) onPlayerFinish();
      }
    }
    r.lap = Math.max(1, r.lapMax);
  }
}

function standings() {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
}

function onPlayerFinish() {
  const pos = standings().indexOf(player) + 1;
  G.finishPos = pos;
  setState('finished');
  hud.center(`${pos}<span style="color:var(--amber)">${ordinal(pos)}</span>`, pos === 1 ? 'You own the night' : 'Finished', pos === 1 ? 'var(--amber)' : '');
  hud.hint('');
  audio.beep(pos === 1 ? 1046 : 660, 0.5, 0.2);
}

function showResults() {
  G.resultsShown = true;
  const st = standings();
  const avg = (r) => (r.progress > 50 ? r.progress / Math.max(G.raceTime, 1) : 30);
  const rows = st.map((r, i) => {
    let time = r.finished ? r.finishTime : G.raceTime + Math.max(0, G.laps * track.length - r.progress) / avg(r);
    return `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><i style="background:${r.css}"></i>${r.isPlayer ? 'You' : r.name}</td><td class="t">${r.bestLap ? formatTime(r.bestLap) : '—'}</td><td class="t">${r.finished ? '' : '≈ '}${formatTime(time)}</td></tr>`;
  });
  $('resBody').innerHTML = rows.join('');
  const pos = G.finishPos || st.indexOf(player) + 1;
  $('resTitle').innerHTML = `${pos}<span>${ordinal(pos)}</span>`;
  $('resLede').textContent = pos === 1 ? 'Harbor District Circuit · Victory' : `Harbor District Circuit · ${G.laps} laps`;
  $('results').hidden = false;
}

function updateDrift(dt) {
  const v = player.veh;
  const D = G.drift;
  const beta = Math.abs(v.beta);
  const sliding = beta > 0.24 && v.speed > 13 && G.scrape < 0.3;
  if (sliding) {
    if (!D.active) { D.active = true; D.time = 0; D.mult = 1; }
    D.time += dt;
    D.calm = 0;
    D.mult = Math.min(5, 1 + Math.floor(D.time / 1.8));
    D.pts += dt * v.speed * beta * 34 * D.mult;
  } else if (D.active) {
    D.calm += dt;
    if (D.calm > 0.5) {
      if (D.pts > 150) {
        hud.toast(`+${Math.round(D.pts).toLocaleString('en-US')} drift`, 'gold');
        v.nitro = Math.min(1, v.nitro + D.pts / 9000);
      }
      G.drift = { pts: 0, mult: 1, time: 0, calm: 0, active: false };
    }
  }
  hud.drift(G.drift.pts, G.drift.mult, G.drift.active && G.drift.pts > 60);
}

function updateRaceEvents(dt) {
  const v = player.veh;
  // passive refill + slipstream
  v.nitro = Math.min(1, v.nitro + dt * 0.012);
  let drafting = false;
  for (let i = 1; i < racers.length; i++) {
    const a = racers[i].ai;
    const ds = a.s - player.s, dd = a.d - player.proj.d;
    if (ds > 5 && ds < 24 && Math.abs(dd) < 2.4 && v.speed > 30) drafting = true;
  }
  if (drafting) {
    v.nitro = Math.min(1, v.nitro + dt * 0.05);
    G.draftTime = (G.draftTime || 0) + dt;
    if (G.draftTime > 0.8 && !G.draftShown) { hud.toast('Slipstream', 'blue'); G.draftShown = true; }
  } else { G.draftTime = 0; G.draftShown = false; }
  // overtakes
  const pos = standings().indexOf(player) + 1;
  if (pos < G.lastPos && G.raceTime > 3) {
    hud.toast(pos === 1 ? 'Taking the lead' : `Overtake · P${pos}`, 'gold');
    v.nitro = Math.min(1, v.nitro + 0.08);
  }
  G.lastPos = pos;
  // wrong way
  const fwd = Math.sin(v.heading) * player.proj.tx + Math.cos(v.heading) * player.proj.tz;
  const velDot = v.vx * player.proj.tx + v.vz * player.proj.tz;
  if (fwd < -0.3 && velDot < -2) G.wrongWay += dt; else G.wrongWay = Math.max(0, G.wrongWay - dt * 2);
  if (G.wrongWay > 1.2) hud.center('Wrong way', G.touch ? 'Turn around' : 'Press R to reset', 'var(--red)');
  else if (G.state === 'race' && G.stateTime > 1.2) hud.center('');
  // stuck against a wall: suggest (then perform) a reset
  if (v.speed < 1.5 && (v.throttle > 0.4 || v.brake > 0.4) && G.raceTime > 4) G.stuckTime += dt;
  else G.stuckTime = Math.max(0, G.stuckTime - dt * 2);
  if (G.stuckTime > 2.5 && G.wrongWay < 1.2) hud.hint(G.touch ? 'Stuck? Hold Brk to reverse' : 'Stuck? Press R to reset');
  else if (G.state === 'race') hud.hint('');
  if (G.stuckTime > 7) { resetPlayer(); G.stuckTime = 0; }
  // nitrous start
  if (v.nitroActive && !G.wasNitro) audio.nitroStart();
  G.wasNitro = v.nitroActive;
}

function resetPlayer() {
  const v = player.veh;
  const s = player.proj.s;
  const f = track.sample(s - 4);
  const d = clamp(player.proj.d, -(ROAD_HALF - 2.5), ROAD_HALF - 2.5);
  v.reset(f.x + f.lx * d, f.z + f.lz * d, f.heading);
  v.nitro = Math.max(v.nitro, 0.2);
  player.proj = track.project(v.x, v.z, -1, player.proj);
  player.hint = player.proj.index;
  let ds = player.proj.s - player.sPrev;
  if (ds < -track.length / 2) ds += track.length;
  if (ds > track.length / 2) ds -= track.length;
  player.s += ds;
  player.sPrev = player.proj.s;
  rig.ready = false;
  hud.toast('Reset');
}

// ------------------------------------------------------------------ frame
function loop(now) {
  requestAnimationFrame(loop);
  const t = now / 1000;
  const dt = Math.min(0.05, G.lastT ? t - G.lastT : 0.016);
  G.lastT = t;
  input.update(dt, player.veh.speed);
  handleKeys();
  if (G.state !== 'paused') {
    update(dt);
    renderFrame(dt);
  }
  input.endFrame();
  perfMonitor(dt);
}

function handleKeys() {
  if (input.hit('Escape', 'KeyP')) {
    if (G.state === 'paused') togglePause(false);
    else togglePause(true);
  }
  if (G.state === 'menu' && input.hit('Enter', 'NumpadEnter')) startRace();
  if (G.state === 'finished' && G.resultsShown && input.hit('Enter')) startRace();
  if (input.hit('KeyC') && G.state !== 'menu') hud.toast(rig.cycle());
  if (input.hit('KeyR') && G.state === 'race') resetPlayer();
  if (input.hit('KeyM')) { audio.setEnabled(!audio.enabled); hud.toast(audio.enabled ? 'Sound on' : 'Sound off'); }
  if (input.hit('KeyE') && G.state === 'race') { player.veh.manual = true; player.veh.shift(1); }
  if (input.hit('KeyQ') && G.state === 'race') { player.veh.manual = true; player.veh.shift(-1); }
  if (input.hit('KeyT') && G.state === 'race') { player.veh.manual = !player.veh.manual; hud.toast(player.veh.manual ? 'Manual gears (Q / E)' : 'Automatic gears'); }
}

function update(dt) {
  G.t += dt;
  G.stateTime += dt;
  if (G.state === 'countdown') updateCountdown();
  if (G.state === 'race' || G.state === 'finished') G.raceTime += dt;

  G.acc += dt;
  let n = 0;
  while (G.acc >= STEP && n < 8) {
    stepPhysics(STEP);
    G.acc -= STEP;
    n++;
  }
  if (n === 8) G.acc = 0;

  const v = player.veh;
  for (const e of v.events) {
    if (e.type === 'shift') {
      audio.shiftClunk();
      if (e.up && v.rpm > 6000 && Math.random() < 0.75) { audio.pop(0.8); G.popFlash = 0.08; }
    }
  }
  v.events.length = 0;
  // overrun crackle
  if (v.throttle < 0.05 && v.rpm > 4200 && v.offThrottleTime < 1.6 && Math.random() < dt * 9 && (G.state === 'race' || G.state === 'finished')) {
    audio.pop(0.5 + Math.random() * 0.4);
    G.popFlash = 0.06;
  }

  if (G.state === 'finished') {
    if (v.speed < 1.5 && v.throttle > 0.4) G.stuckTime += dt; else G.stuckTime = Math.max(0, G.stuckTime - dt * 2);
  }
  if (G.state === 'race' || G.state === 'finished') {
    updateLaps();
    if (G.state === 'race') {
      updateDrift(dt);
      updateRaceEvents(dt);
      const st = standings();
      const pos = st.indexOf(player) + 1;
      hud.race({
        pos, total: racers.length, lap: player.lap, laps: G.laps,
        lapTime: G.raceTime - player.lapStart, raceTime: G.raceTime, best: player.bestLap,
        board: st.map((r) => ({ name: r.isPlayer ? 'You' : r.name, me: r.isPlayer, css: r.css })),
      });
      if (G.stateTime < 1.1) hud.center('Go!', '', 'var(--good)');
    } else if (G.stateTime > 2.6 && !G.resultsShown) {
      hud.center('');
      showResults();
    }
  }
  updateVisuals(dt);
  updateAudio(dt);
}

function updateCountdown() {
  const t = G.stateTime;
  const step = t < 0.6 ? -1 : t < 3.6 ? Math.floor((t - 0.6) / 1.0) : 3;
  if (step !== G.countStep) {
    G.countStep = step;
    if (step >= 0 && step < 3) {
      hud.center(String(3 - step), 'Get ready', 'var(--ink)');
      audio.beep(440, 0.16, 0.22);
      trackMeshes.startLights.set(Math.min(5, Math.round((step + 1) * 5 / 3)));
    }
    if (step === 3) {
      trackMeshes.startLights.set('green');
      audio.beep(880, 0.45, 0.25);
      hud.center('Go!', '', 'var(--good)');
      hud.hint('');
      const rpm = player.veh.rpm;
      if (rpm > 5200 && rpm < 7400) { hud.toast('Perfect launch', 'gold'); G.launchBoost = 1.1; player.veh.nitro = Math.min(1, player.veh.nitro + 0.1); }
      else if (rpm >= 7400) hud.toast('Too many revs', 'warn');
      else if (rpm < 2500) hud.toast('Bogged down', 'warn');
      setState('race');
      hud.center('Go!', '', 'var(--good)');
    }
  }
}

const _tmp = new THREE.Vector3();
function updateVisuals(dt) {
  const v = player.veh;
  const pc = player.car;
  pc.root.position.set(v.x, 0, v.z);
  pc.root.rotation.y = v.heading;
  const brakeLight = v.brake > 0.1 || (v.gear === -1 && v.throttle > 0.1) ? 1 : v.handbrake ? 0.7 : 0;
  pc.update(dt, { wheelOmega: v.wheelOmega, steer: v.steer, ax: clamp(v.ax, -12, 12), ay: clamp(v.ay, -14, 14), brake: brakeLight, bump: v.speed > 1 ? Math.sin(G.t * 31) * 0.0015 * clamp(v.speed / 60, 0, 1) : 0 }, camera);
  for (let i = 1; i < racers.length; i++) {
    const a = racers[i].ai;
    const car = racers[i].car;
    car.root.position.set(a.x, 0, a.z);
    car.root.rotation.y = a.heading;
    car.update(dt, { speed: a.v, steer: a.steerVis, ax: a.ax, ay: a.ay, brake: a.brake > 0.05 ? 1 : 0, heatBrake: a.brake }, camera);
  }
  // tunnel darkening of sky light + env reflections
  for (const r of racers) {
    const tf = track.tunnelFactor(r.s);
    r.car.paint.envMapIntensity = lerp(1.15, 0.28, tf);
  }
  const ptf = track.tunnelFactor(player.s);
  world.hemi.intensity = lerp(world.hemiBase, 0.03, ptf);
  world.moon.intensity = lerp(world.moonBase, 0.0, ptf);
  // shadow camera follows the player
  world.moon.target.position.set(v.x, 0, v.z);
  world.moon.position.set(v.x + world.moonDir.x * 120, world.moonDir.y * 120, v.z + world.moonDir.z * 120);
  updateEffects(dt);
  updateCamera(dt);
}

function updateCamera(dt) {
  const v = player.veh;
  const vstate = { x: v.x, z: v.z, heading: v.heading, vx: v.vx, vz: v.vz, speed: v.speed, ax: v.ax, yawRate: v.yawRate, nitro: G.nitroVis || 0 };
  const dc = G.debug && G.debug.cam;
  if (dc) {
    if (dc.noGlow) for (const r of racers) for (const g of [...r.car.headGlows, ...r.car.tailGlows]) g.visible = false;
    const c = player.car.root;
    const P = new THREE.Vector3(...dc.pos), Lk = new THREE.Vector3(...dc.look);
    if (dc.local) { c.localToWorld(P); c.localToWorld(Lk); }
    camera.position.copy(P);
    camera.up.set(0, 1, 0);
    camera.lookAt(Lk);
    camera.fov = dc.fov || 40;
    camera.updateProjectionMatrix();
  } else if (G.state === 'menu') rig.orbit(dt, player.car.root.position, v.heading, { radius: 6.3, speed: 0.22, sweep: { side: player.proj.d < 0 ? 1 : -1, range: 1.25 } });
  const w = window.innerWidth, h = window.innerHeight;
  if (G.state === 'menu' && w > 760 && !dc) {
    camera.setViewOffset(w, h, -w * 0.15, 0, w, h);
  } else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  else if (G.state === 'countdown') rig.intro(clamp(G.stateTime / 3.2, 0, 1), vstate);
  else if (G.state === 'finished' && G.stateTime > 1.2) rig.orbit(dt, player.car.root.position, v.heading, { radius: 7.5, height: 1.6, speed: 0.12, fov: 48 });
  else rig.chase(dt, player.car, vstate);
  camera.updateMatrixWorld();
}

function updateEffects(dt) {
  const v = player.veh;
  G.nitroVis = damp(G.nitroVis || 0, v.nitroActive ? 1 : 0, 6, dt);
  // player wheels: smoke, skids, spray
  const sinH = Math.sin(v.heading), cosH = Math.cos(v.heading);
  const wheelPos = (fwd, left) => [v.x + sinH * fwd + cosH * left, v.z + cosH * fwd - sinH * left];
  const slipR = Math.abs(v.slipR), slipF = Math.abs(v.slipF);
  const rearK = clamp(Math.max((slipR - 0.13) * 3, v.wheelspin * 1.4, v.handbrake && v.speed > 3 ? 0.6 : 0), 0, 1);
  const frontK = clamp(v.brake > 0.8 && v.speed > 12 ? 0.25 : (slipF - 0.22) * 2, 0, 1);
  const rate = 60 * dt;
  [[CAR.rearZ, CAR.trackHalf, rearK, 'pr0'], [CAR.rearZ, -CAR.trackHalf, rearK, 'pr1'], [CAR.frontZ, CAR.trackHalf, frontK, 'pf0'], [CAR.frontZ, -CAR.trackHalf, frontK, 'pf1']].forEach(([fz, lx, k, id]) => {
    const [x, z] = wheelPos(fz, lx);
    fx.skids.add(id, x, z, sinH, cosH, v.speed > 1.5 ? k : 0);
    if (k > 0.05 && v.speed > 2 && Math.random() < k * rate * 0.8) fx.tireSmoke(x, z, v.vx, v.vz, k);
    if (v.speed > 14 && fz < 0 && Math.random() < clamp((v.speed - 14) / 40, 0, 1) * rate * 0.7) fx.spray(x - sinH * 0.4, z - cosH * 0.4, v.vx, v.vz, clamp(v.speed / 60, 0.3, 1));
  });
  // exhaust: nitrous flames + overrun pops
  G.popFlash = Math.max(0, (G.popFlash || 0) - dt);
  if (v.nitroActive || G.popFlash > 0) {
    for (const e of player.car.exhaustLocal) {
      _tmp.copy(e);
      player.car.body.localToWorld(_tmp);
      for (let k = 0; k < 2; k++) fx.flame(_tmp.x, _tmp.y, _tmp.z, -sinH, 0.02, -cosH, v.nitroActive ? 1 : 0.8, v.nitroActive, v.vx, v.vz);
    }
  }
  // rivals: spray behind them on the wet road, smoke if knocked sideways
  for (let i = 1; i < racers.length; i++) {
    const a = racers[i].ai;
    const dCam = Math.hypot(a.x - camera.position.x, a.z - camera.position.z);
    if (dCam > 120) continue;
    const s = Math.sin(a.heading), c = Math.cos(a.heading);
    const slide = clamp(Math.abs(a.dv) / Math.max(a.v, 5) * 3 + Math.abs(a.wobbleV) * 0.4 - 0.3, 0, 1);
    for (const lx of [CAR.trackHalf, -CAR.trackHalf]) {
      const x = a.x + s * CAR.rearZ + c * lx, z = a.z + c * CAR.rearZ - s * lx;
      if (a.v > 14 && Math.random() < clamp((a.v - 14) / 40, 0, 1) * rate * 0.5) fx.spray(x - s * 0.4, z - c * 0.4, a.vx, a.vz, clamp(a.v / 60, 0.3, 1));
      if (slide > 0.05 && Math.random() < slide * rate) fx.tireSmoke(x, z, a.vx, a.vz, slide);
      fx.skids.add(`a${i}${lx}`, x, z, s, c, a.v > 2 ? slide : 0);
    }
  }
  fx.update(dt);
}

function assignPointLights() {
  const v = player.veh;
  const cands = trackMeshes.lightCandidates;
  const best = [];
  for (const c of cands) {
    const dx = c.x - v.x, dz = c.z - v.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > c.range * c.range) continue;
    best.push({ c, d2 });
  }
  best.sort((a, b) => a.d2 - b.d2);
  for (let i = 0; i < pointLights.length; i++) {
    const L = pointLights[i];
    const b = best[i];
    // keep every light "visible" so the shader light count never changes (that would recompile)
    if (!b) { L.intensity = 0; continue; }
    const d = Math.sqrt(b.d2);
    L.position.set(b.c.x, b.c.y, b.c.z);
    L.color.setHex(b.c.color);
    L.distance = b.c.range * 1.25;
    L.intensity = b.c.intensity * smoothstep(b.c.range, b.c.range * 0.55, d);
  }
}

const _rv = new THREE.Vector3(), _rh = new THREE.Vector3(), _rd = new THREE.Vector3();
function renderFrame(dt) {
  world.update(G.t, camera);
  assignPointLights();
  const pv = player.veh;
  rain.enabled = G.rain;
  _rv.set(pv.vx, 0, pv.vz);
  _rh.set(0, 0.7, 2.2);
  player.car.body.localToWorld(_rh);
  _rd.set(Math.sin(pv.heading), -0.06, Math.cos(pv.heading)).normalize();
  rain.update(dt, camera, _rv, pointLights, _rh, _rd);
  const rk = G.rain ? 1 : 0;
  G.rainK = damp(G.rainK ?? rk, rk, 2, dt);
  trackMeshes.roadMat.userData.uniforms.uTime.value = G.t;
  trackMeshes.roadMat.userData.uniforms.uRain.value = G.rainK;
  audio.setRain(G.rainK);
  const ru = trackMeshes.roadMat.userData.uniforms, wu = world.waterMat.userData.uniforms;
  const reflOn = quality.refl > 0 && reflection.enabled && !(G.debug && G.debug.noRefl);
  ru.uReflOn.value = reflOn ? 1 : 0;
  wu.uReflOn.value = reflOn ? 1 : 0;
  if (quality.shadow) renderer.shadowMap.needsUpdate = true;
  if (reflOn) {
    reflection.render(renderer, scene, camera);
    ru.uReflTex.value = reflection.target.texture;
    ru.uReflMatrix.value.copy(reflection.matrix);
    wu.uReflTex.value = reflection.target.texture;
    wu.uReflMatrix.value.copy(reflection.matrix);
  }
  const v = player.veh;
  post.u.uSpeed.value = clamp((v.speed - 22) / 62, 0, 1) * (G.state === 'race' || G.state === 'finished' ? 1 : 0);
  post.u.uNitro.value = G.nitroVis || 0;
  post.u.uExposure.value = lerp(1.0, 1.08, track.tunnelFactor(player.s));
  const dbg = G.debug || {};
  if (dbg.noPost) {
    renderer.setRenderTarget(null);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.render(scene, camera);
    renderer.toneMapping = THREE.NoToneMapping;
    return;
  }
  post.bloom.enabled = !dbg.noBloom;
  post.render(dt);
}

function updateAudio(dt) {
  if (!audio.ready) return;
  const v = player.veh;
  const slip = clamp(Math.max((Math.abs(v.slipR) - 0.14) * 2.6, v.wheelspin, v.handbrake && v.speed > 4 ? 0.7 : 0, v.brake > 0.85 && v.speed > 15 ? 0.3 : 0), 0, 1) * clamp(v.speed / 6, 0, 1);
  audio.updatePlayer(v, { slip, scrape: G.scrape * clamp(v.speed / 10, 0, 1), wet: 1, engineVol: 1 });
  const lst = { x: camera.position.x, z: camera.position.z, vx: v.vx, vz: v.vz, rx: 0, rz: 0 };
  const e = camera.matrixWorld.elements;
  lst.rx = e[0]; lst.rz = e[2];
  audio.updateRivals(racers.slice(1).map((r) => r.ai), lst);
  // rival tags
  if (G.state === 'race') {
    const st = standings();
    hud.tags(racers.slice(1).map((r) => ({ x: r.ai.x, z: r.ai.z, name: r.name, css: r.css, pos: st.indexOf(r) + 1 })), camera);
    hud.drawTach(v, v.nitro, v.nitroActive);
    hud.drawMinimap(v, racers.slice(1).map((r) => ({ x: r.ai.x, z: r.ai.z, css: r.css })));
  } else if (G.state === 'countdown' || G.state === 'finished') {
    hud.clearTags();
    hud.drawTach(v, v.nitro, false);
    hud.drawMinimap(v, racers.slice(1).map((r) => ({ x: r.ai.x, z: r.ai.z, css: r.css })));
  }
}

// adaptive resolution: drop render scale if the frame time stays high
const perf = { acc: 0, n: 0, cool: 3 };
function perfMonitor(dt) {
  G.fps = G.fps ? G.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
  if (G.state === 'paused' || G.state === 'loading') return;
  perf.acc += dt; perf.n++;
  perf.cool -= dt;
  if (perf.acc > 2) {
    const avg = perf.acc / perf.n;
    perf.acc = 0; perf.n = 0;
    if (perf.cool <= 0 && avg > 1 / 40 && G.quality > 0) {
      setQuality(G.quality - 1);
      document.querySelectorAll('#qualSeg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === G.quality)));
      perf.cool = 6;
    }
  }
}

// debug hooks for automated screenshots
window.__game = {
  G, THREE, get audio() { return audio; }, get scene() { return scene; }, get post() { return post; }, get player() { return player; }, get racers() { return racers; }, get track() { return track; },
  startRace, toMenu, setQuality, resetPlayer, rig: () => rig, input: () => input,
  skipCountdown() { G.stateTime = 3.65; },
};

init().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  $('loadStep').innerHTML = `<span class="load-err">Could not start: ${String(err.message || err)}</span>`;
});
