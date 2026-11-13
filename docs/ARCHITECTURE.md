# Typewriter: architecture contract

A physical simulation of a typewriter. Nothing is animated: bar motion, print quality,
skew and sound are all consequences of integrating the mechanism (sound uses recorded samples, triggered and scaled by the physics). If a behaviour needs a special
case ("if key pressed, advance carriage"), it is wrong. Add the missing physics instead. The real keyboard is the one
sanctioned shortcut: a keydown fires a fixed timed finger press with a little randomness.

Reference for quality: a dark studio render of the machine, orbitable, with a compact telemetry
panel at bottom left (scope on top, two columns of live values).

## Layout and ownership
| Path | Contents |
|---|---|
| `src/machine/` | Machine definitions (SI units, all parameters) and `geometry.js`. New machine = new definition. |
| `src/sim/`, `src/audio/` | Rigid mechanism, contacts, modal body, AudioWorklet host. |
| `src/soft/` | Paper and ribbon soft bodies, ink and emboss deposition. Main thread. |
| `src/render/`, `src/interact/`, `src/ui/`, `src/main.js`, `index.html` | three.js scene, picking and drag mapping, telemetry, Print Point window. |
| `src/pages/` | Finished-page archive, desk pile and viewer, PDF export, fresh-paper stack. |
| `src/terminal/` | Paper teletype mode: output parser, key map and the driver that works the real keys. |
| `tools/`, `public/assets/` | Asset generation (Blender, Qwen-Image through ComfyUI) and baked data. |

## Threads and rates
- **AudioWorklet**: `MechanicalSim` at 384 kHz (8x oversampled, per-element sleeping), driving a modal
  acoustic model at the audio rate. Publishes a state snapshot about every 4 ms and events on contact end.
- **Main**: `SoftWorld` (paper XPBD, ribbon rope) at fixed substeps, three.js render.
- `LocalHost` runs the same `MechanicalSim` on the main thread until audio is unlocked by a first
  gesture and in tests. `MechanicalSim` has no DOM or audio dependencies and runs in Node.

## Mechanical model (src/sim)
Every DOF is integrated (symplectic Euler, unconditional sleeping when at rest) with real unilateral contacts.
- Key: x (m), finger force, return spring, felt bottom stop. Coupled to the bar by a ONE-WAY link
  (`linkage`): the link can only pull, so the last ~14 % of the bar's arc is ballistic free flight. Too
  gentle a press never reaches the platen. Impact speed depends on the force history.
- Bar: theta (rad, 0 rest, `thetaTravel` nominal impact), bearing Coulomb and viscous friction, return
  spring, felt rest pad, lateral deflection in the type guide. Active bars collide with each other near
  the guide (segment-segment distance), so a jam is emergent and must be cleared by moving a bar.
- Slug contact: Hunt-Crossley over a pre-computed F(delta) for the actual glyph face (Winkler foundation
  integrated over the height field, including slug skew and the slug/platen curvature mismatch).
  Small faces (a period) see higher pressure, so they can perforate paper, as on a real machine.
- Universal bar, rocker, fixed and loose dogs against a sawtooth rack with real tooth contact, so
  spacing, ratcheting on carriage return, and failure to space on a weak press all emerge.
- Carriage: x, mass, drawband, rail stiction, end stops, margin stops, carriage release lever, shift DOF.
- Line-space lever: lever DOF drives a pawl on the platen ratchet. At the end of lever travel it pushes
  the carriage, so one continuous drag indexes the platen and then returns the carriage.
- Platen: psi with detent star wheel potential, Coulomb and viscous bearing.
- Bell: hammer DOF tripped by a carriage finger. Vibrator lift, ribbon pawl, paper release and bail
  are DOFs driven by the mechanism or the user.

## Single-element machine (`src/sim/element-action.js`)
`element1971` is a second print action behind the same Action interface. A motor runs one-revolution clutches that drive the print, operational and shift shafts through cams. Selection goes through binary latches and a whiffletree into tilt and rotate DOFs; the print rocker throws the element at the platen from a low rest position. The platen is fixed and the carrier moves. To keep the common code unchanged, the carriage DOF, `SoftWorld` and the printer are all solved in the carrier's frame: `carriageX` is minus the carrier's world x, `SoftWorld.carrierOffset` converts between frames, and the paper and ribbon meshes and the Print Point camera are offset by it. The sheet is shifted by the frame's motion each substep, so it stays still in the world.

## Acoustics (src/audio)
Recorded samples triggered by physical events. Slug contact, key bottoming, bar return, shift stops, each rack
tooth on return, each platen detent, carriage stop and bell queue `AC` events from the mechanism, drained at
audio rate; `src/audio/sampler.js` plays cuts from `public/assets/audio/samples/` with level and brightness set by
the measured force or speed. Each key hashes to a stable set of cuts. Paper loops follow soft-body speed.
A modal layer voices bar-bar metal, and is the fallback until samples load. `src/audio/element-synth.js` voices the electric machine's motor and clutches from the mechanism's state.
The word processor's sound is `docs/displaywriter/architecture.md` section 10: synthesis from forces and speeds, and recorded cuts (`samples_wp`, `samples_wpkeys`) triggered by its mechanisms' events.
Sources and terms for the recordings are in `public/assets/audio/SOURCES.md`.

## Contract: SimClient (`src/sim/client.js`)
```js
const sim = await createSimClient({ machine, geometry, glyphs, audioContext /* optional */ });
sim.layout                    // from makeLayout(geometry)
sim.state                     // latest Float32Array snapshot (src/sim/layout.js)
sim.on('strike', evt => ...)  // and 'event' for all others: {type:'bell'|'dog'|...}
sim.pressKey(keyIndex, peakForceN, durationS)        // a timed finger (keyboard typing, clicks)
const g = sim.grab(dof, index, { target, k, c, maxF }) // virtual spring on a DOF, for dragging
sim.moveGrab(g, target); sim.release(g);
sim.setEnv({ paperCaliperM, ribbonCaliperM, ribbonInGap, paperPresent, paperStrength });
sim.setParam('carriage.mass', 2.4); sim.setTimeScale(0.01); sim.setAudioEnabled(bool);
sim.unlockAudio(audioContext)  // moves from LocalHost to the worklet, keeping state
```
Grabbable DOFs: `key[i]`, `bar[i]`, `carriage`, `platen`, `lsLever`, `paperRelease`, `carriageRelease`,
`bail`, `marginL`, `marginR`, `ribbonSelector`. Targets use the DOF's own units (m or rad).
Ribbon-spool DOFs live in `SoftWorld`.

Strike event, emitted at the end of contact:
`{type:'strike', bar, caseIndex, tBegin, duration, carriageX, platenPsi, shiftY, lateral, vImpact, peakForce,
maxIndent, restitution, skewRad, vibratorLift, ribbonInGap, trace:{dt, force:Float32Array, indent:Float32Array}}`

## Contract: glyphs (`src/machine/glyphs.js`, owned by src/soft)
`public/assets/glyphs.bin` is 94 96x96 Uint8 height fields (the 80 machine slugs, then the characters added for terminal mode) (see `glyphs.json`, 0.05 mm texels, 255 = printing
face). `tools/bake_glyphs.py` documents the format. `loadGlyphs()` works in the browser and Node.

## Contract: SoftWorld (`src/soft/index.js`)
```js
const soft = new SoftWorld({ machine, geometry, glyphs });
soft.step(dtSeconds, sim.state, sim.layout);            // fixed internal substeps
soft.paper    // {positions:Float32Array, nx, ny, indices, uvs, normalsDirty}
soft.ribbon   // {positions:Float32Array (centreline), up:Float32Array, count, spoolL, spoolR}
soft.env()    // argument for sim.setEnv
soft.applyStrike(evt)
soft.grabPaper(worldPoint) -> id; soft.grabRibbon(worldPoint) -> id; soft.grabSpool(side) -> id
soft.moveGrab(id, worldPointOrAngle); soft.release(id)
soft.spawnSheet(pose)
soft.inkTexture      // {data:Uint8Array RG (ink, emboss), width, height, dirty:[{x,y,w,h}]}
soft.ribbonTexture   // {data, width, height, dirty} window around the print point
soft.readouts()      // {skewDeg, lateralMm, ribbonTensionN, ribbonSlackMm, inkAtPoint, ...}
```

## System machines (`kind: 'system'`)
The word processor (`src/machine/wordproc1980.js`) is one definition with several units, each placed on the desk
(`src/machine/wp-geometry.js`). `src/main.js` only chooses the machine and loads its family's kit
(`src/kits/typewriter.js` or `src/kits/wordproc.js`), so a visit downloads one family. The word processor's
mechanisms run in their own host, `WordprocSim` (`src/sim/wp/`), behind the same `SimClient` contract and
transport; `src/sim/host-factory.js` picks the host by `action.type`. There, besides integrated mechanisms, live
**controllers**: the firmware of the real machine (keyboard scanner, printer processors, diskette adapter). They
run on deadlines, may only switch phases, set coil currents and read sensors, and never write a mechanical state;
tests enforce this. The **software** (`src/wp/`, a reimplementation of Textpack 4) is plain modules on a simulated
clock that reach the units only through a device interface: `VirtualDevices` in Node, the kit's devices in the
browser. The printer reuses `SoftWorld` (with `origin`, in the printer's frame), the strike event, ink and the page
pile unchanged. The full design is `docs/displaywriter/architecture.md`.

## Testing
Node tests use `node --test tests/*.test.js`. Browser tests run ONLY through `tests/e2e/xrun.sh` (private Xvfb),
never on the real display, with Chromium flags `--use-angle=vulkan --ignore-gpu-blocklist --enable-features=Vulkan
--autoplay-policy=no-user-gesture-required` and playwright-core (`~/.cache/ms-playwright` has build 1208).
