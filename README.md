# Midnight Apex

A night street race in the browser, inspired by Need for Speed. One fully playable scene: a 2.69 km
rain-soaked harbour circuit with a tunnel, a hairpin and flat-out kinks, raced against five AI
rivals. Everything (car, city, textures, sound) is generated procedurally at load time; the only
dependency is three.js r160 from the jsDelivr CDN.

## Run it

ES modules need to be served over HTTP:

```sh
cd opus-5.5-3d-car
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle | W / ↑ | RT |
| Brake, reverse when stopped | S / ↓ | LT |
| Steer | A D / ← → | Left stick |
| Handbrake (drift) | Space | X / B |
| Nitrous | Shift / N | A / RB |
| Camera (chase, close, bonnet, bumper) | C | Y |
| Reset to track | R | Back |
| Manual gears | T to toggle, Q / E to shift | |
| Pause | Esc / P | Start |
| Mute | M | |

Touch controls appear on phones and tablets. At the start, hold throttle so the needle sits
between 5,200 and 7,400 rpm when the lights go green for a perfect launch.

Nitrous refills from drifting, slipstreaming behind rivals, overtaking and slowly over time.

## What's in the scene

- **Rendering**: HDR pipeline (MSAA half-float target → bloom → speed blur, chromatic fringe, ACES
  tone map, grade, grain). The wet road samples a half-resolution planar reflection with
  roughness-driven streak blur, puddle masks and raindrop ripples; street-lamp pools are computed
  analytically in the road shader, while the six nearest lamps become real point lights that sweep
  across the car's clear-coat.
- **Car**: lofted superellipse body with real wheel arches, a cabin split into paint, glass, trim
  and chrome, decals that conform to the body (LED headlights and light bar, intakes, skirts),
  ten-spoke wheels that swap to a blur disc at speed, brake calipers and discs that glow when hot.
- **City**: ~1,000 instanced buildings with procedural windows, storefronts and signage, neon signs
  and billboards, an overpass, a tiled tunnel, a harbour with a suspension bridge, and a moonlit sky.
- **Driving**: bicycle-model physics at 120 Hz with load transfer, Pacejka-style tyres, a friction
  circle at the driven axle, a 6-speed box and drift assists (see `src/vehicle.js`).
- **Rivals**: track-space AI with a curvature speed profile, racing line, overtaking and
  rubber-banding; they trade impulses with you in contacts.
- **Sound**: a V8 synthesized from per-cylinder combustion pulses, crossfaded across three rpm
  layers, plus turbo, blow-off, overrun pops, tyres, wind, rain and spatialized rival engines.

Graphics quality (Pause → Graphics) drops automatically if the frame rate stays below ~40 fps.

## Layout

```
index.html        HUD, menus, styles, import map
src/main.js       boot, race state machine, frame loop
src/trackdata.js  circuit centreline, speed profile, racing line (no three.js; testable in Node)
src/vehicle.js    vehicle dynamics (no three.js)
src/ai.js         rival drivers (no three.js)
src/collide.js    barrier and car-to-car contacts
src/track.js      road, barriers, lamps, tunnel, bridges, gantry geometry
src/world.js      sky, environment map, city, harbour
src/materials.js  road / building / sky / light-cone shaders
src/car.js        procedural car model
src/fx.js         particles and skid marks
src/rain.js       rain streaks
src/audio.js      synthesized audio
src/hud.js        tachometer, minimap, standings, tags
src/post.js       post-processing chain
```
