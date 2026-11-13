# Dedicated word processor, c. 1980: architecture

Design decisions for the `wordproc1980` machine. It is written for the engineer who builds it: every option is
closed here, with the reason, so that implementation and testing do not re-decide them. Read `plan.md` first
(goals, ground rules, the owner's decisions), then `hardware.md`, `printer.md`, `software-reference.md` and
`software-screens.md` (the research this document cites as HW, PR, SR and SS with their section numbers).

Status: design, 2026-11-11. No code exists yet. Section 13 lists what the owner still has to confirm; each item
has a default, and the plan in section 11 proceeds on the defaults.

Contents: 1 summary; 2 physics and logic; 3 multi-unit machine; 4 mechanism host; 5 keyboard; 6 printer;
7 software; 8 diskettes; 9 display; 10 audio; 11 plan and milestones; 12 tests, budgets; 13 risks, questions, gaps.

---

## 1. Summary of decisions

| # | Decision | Why |
|---|---|---|
| 1 | The machine is **one definition with five units** (`station`, `display`, `keyboard`, `diskette`, `printer`), each with its own local coordinates and a placement on the desk. The desk layout, camera presets, shadow extent and prop positions come from the definition | One registry entry and one picker entry, like the other machines. Nothing in the scene hard-codes where things stand |
| 2 | `main.js` becomes a shell plus a **kit** per machine family, loaded with a dynamic import: `src/kits/typewriter.js` (today's code, moved) and `src/kits/wordproc.js`. Switching machines stays a page reload | The two families share the stage, desk, room, panel and loop and nothing else. Code splitting keeps each visit from downloading the other family |
| 3 | The mechanisms run in a **separate mechanism host**, `WordprocSim` (`src/sim/wp/`), behind the unchanged `SimClient` contract. It is **not** a new `Action` inside `MechanicalSim` | `MechanicalSim`'s common mechanism (universal bar, dogs and rack, drawband, line-space lever, bell, shift) does not exist here, keys do not drive the print mechanism, and three of the four bodies have DOFs with no place in it. See 4.1 |
| 4 | The printer still emits the **existing `strike` event** and publishes `carriageX`, `platenPsi`, `vibratorLift`, `ribbonPawlTravel`, `paperRelease` and `bail` under the existing layout names, in the carrier frame used by `element1971`. `SoftWorld`, `Printer`, the page archive, the pile and the PDF export are reused with one added option (`origin`) | The ink, emboss, paper and page pipeline is the expensive, tested part. It needs no second implementation |
| 5 | Steppers, the hammer and the keys are **integrated DOFs**. Their timing comes from **controllers** (keyboard scanner, printer processors, diskette adapter) that run in the same thread as event-driven logic and can only switch phases, set coil currents and read sensors | This is the legitimate departure from "nothing is animated": the real machine has firmware. The controllers never set a position (section 2) |
| 6 | The Textpack reimplementation lives in `src/wp/` as plain modules with no DOM, no three.js and no wall clock. It is a **scheduler of generator tasks over a simulated clock**. All waiting is waiting for a device completion or a timer on that clock | Runs headless in Node. A test jumps the clock, so a 10 s program load takes microseconds. Type-ahead, CANCL levels and background printing fall out of the task model |
| 7 | The software runs **on the main thread, in process**, behind a device interface that a Worker could implement later | Simplest thing that meets the click-latency budget (5.5). No third thread, no port transfer into the worklet |
| 8 | Diskette **data** lives with the software (`src/wp/disk/`): raw sector images in the documented geometry with our own index and file layout. Diskette **motion and timing** live in the mechanism host. Node tests use an analytic timing model of the same drive | The real format is undocumented, so only geometry, capacities and timings are faithful. Splitting data from motion keeps megabytes out of the audio thread |
| 9 | Work diskettes **persist** in IndexedDB. The machine starts **warm** (powered, program loaded, TASK SELECTION on screen, a sheet in the printer); `?cold` gives the full power-on | A visitor should be typing within seconds, and should find yesterday's document. The 35 s cold start is there for those who want it |
| 10 | One **combined program diskette** (2D) in the left drive, work diskette in the right | A documented Textpack 4 configuration (SS 2) that removes the three-volume swapping without inventing anything |
| 11 | The CRT is a **GPU character generator**: an 80 x 25 two-byte data texture (the 4 KB display buffer), a font atlas of our own 8 x 16 glyphs, a phosphor pass with two decay components into a 1280 x 800 half-float target, and a curved glass material with in-shader halation. No canvas, no post-process bloom | 4 KB uploaded only when the screen changes; under 1 ms of GPU time; exact dots at any zoom |
| 12 | All sound is synthesised in a `WpAudioEngine` (`src/audio/wp-engine.js`) from mechanism forces, speeds and events, on three stereo-panned buses. The keyboard click and beep are an electrical pulse and a 1 kHz tone through a small-speaker model | No recordings exist. The existing engine's bar and sample voices do not apply; its room, radiation filter, limiter and resonator bank are reused |
| 13 | Added download for a word-processor visit is at most **2 MB**, and a typewriter visit gains **0 bytes** | Free-tier hosting. The plan's 5 MB was a first guess |

What is overruled in `plan.md` is listed in 11.1.

---

## 2. Physics and logic: where this machine departs from the contract

`docs/ARCHITECTURE.md` says nothing is animated and a special case means missing physics. This machine has three
kinds of thing, and the line between them is fixed here.

| Kind | Examples | Rule |
|---|---|---|
| **Mechanism** | Key stems and fly plates; the wheel, carrier, platen, ribbon and head steppers; leadscrew and follower; hammer armature, petal and platen contact; paper and ribbon; levers, collet, diskette slide; power rocker, knobs, cover, tilt and swivel; fans and AC motors | Integrated every substep from forces. Position is never assigned. Grabbable where a hand can reach it |
| **Controller** (firmware of the real machine) | Keyboard scanner and typematic timer; printer attachment, escapement, selection, hammer and index processors; diskette adapter (step timing, head load, sector wait) | Event-driven logic in the mechanism thread. Inputs are sensors (capacitance, reluctance pickups, encoder, index pulse, reed switches, the hammer sense coil). Outputs are phase states, coil currents and status. It may fail, as the real one does (late selection, lost position, not ready) |
| **Software** | Power-on test, program load, Textpack | Logic on a simulated clock. It talks to devices only through commands and completions |

Must hold, and is tested:

1. No controller or software writes a mechanical state. A carrier arrives because its motor turned the screw.
2. No ink is placed by software. Ink appears only from a `strike` event through `SoftWorld.applyStrike`.
3. No duration is scripted in the browser build. Characters per second, line-feed time, seek, settle, rotational
   latency and spin-up are outcomes. The analytic timing model (8.4) exists only for Node tests of the software
   and for checking the mechanism against the documented figures.
4. No sound is triggered by intent. Sound comes from contact forces, rotor speeds and mechanism events. The one
   exception is the keyboard speaker, which is an electrical transducer driven by the Click and Tone lines.
5. A scan event exists only because a fly plate left its pad. The real keyboard presses a key with a finger.

Sanctioned shortcuts, all through the same grabs a pointer makes: the real keyboard (a held finger), a scripted
hand that inserts a diskette or lays a sheet in the printer, and the warm start.

---

## 3. Multi-unit machine

### 3.1 Definition shape

`src/machine/wordproc1980.js`. SI units. World axes as now (x right, y up, z toward the typist), world origin
at the desk reference point where a typewriter stands. Each unit has local coordinates with the same axes and
its origin on the surface it stands on, under its centre.

```js
export default {
  id: 'wordproc1980',
  name: 'Dedicated word processor, c. 1980',
  kind: 'system',                                   // absent on the typewriters
  action: { type: 'printwheel-system' },            // selects the kit, the mechanism host and the audio engine
  audio: { samples: false },                        // no sprite is fetched; the path stays open for later
  glyphs: 'glyphs_wp',                              // printwheel faces (12.3)
  textures: ['walnut_desk', 'paper', 'wp_plastic'], // the only studio texture sets this machine loads

  units: {
    station:  { size: [0.483, 0.178, 0.356], mass: 14,  place: { x: 0.12,    z: -0.13 }, model: 'wp_station.glb' },
    display:  { size: [0.381, 0.292, 0.348], mass: 6.6, on: 'station', at: [0, 0.178, -0.004],
                tilt: [0, 20 * deg], swivel: [-12 * deg, 12 * deg], model: 'wp_display.glb' },
    keyboard: { size: [0.538, 0.101, 0.213], mass: 5,   place: { x: 0.12,    z: 0.20 },  slope: 12 * deg, model: 'wp_keyboard.glb' },
    diskette: { size: [0.254, 0.292, 0.398], mass: 16,  place: { x: 0.5285,  z: -0.13 }, model: 'wp_diskette.glb' },
    printer:  { size: [0.74, 0.23, 0.58],    mass: 29,  place: { x: -0.5315, z: -0.19 }, model: 'wp_printer.glb' },
  },

  deskLayout: {
    extent: { halfX: 1.05, halfZ: 0.75 },           // shadow frustum and contact-shade bounds
    freshStack: { x: -0.76, z: 0.36 },              // in front of the printer
    pagePile:   { x: -0.48, z: 0.36 },
    ashtray:    { on: 'diskette', at: [0.0, 0.292, 0.05] },
    disketteHolder: { x: 0.80, z: -0.05 },
    lamp: false,                                    // owner's decision: no desk lamp
    cablesOut: 'back',
  },
  cameras: {
    operator: { position: [0.12, 0.42, 0.66], target: [0.12, 0.30, 0.04] },    // default: raster at least 640 px wide at 1600 x 1000
    overview: { position: [0.0, 0.95, 2.0],   target: [-0.05, 0.15, -0.05] },
    keyboard: { position: [0.12, 0.48, 0.62], target: [0.12, 0.06, 0.20] },
    printer:  { position: [-0.53, 0.62, 0.70], target: [-0.53, 0.16, -0.16] },
    diskette: { position: [0.62, 0.36, 0.62], target: [0.53, 0.15, 0.07] },
  },
  defaultCamera: 'operator',

  keyboard: { /* 5.1 parameters; key table imported from ./wp-keys.js */ },
  display:  { /* 9: raster, phosphor, knobs */ },
  diskettes: { /* 8: drive parameters */ },
  system:   { /* power supply, fan, self-test durations */ },
  printer:  { /* 6: a machine-shaped block, see below */ },
};
```

`size` is width, height, depth. The display's size, the module's size and the others are documented (HW 1.2,
2.1, 3.1). The printer's is the mid-range of the photo estimate (PR 1), so it is the one number likely to move;
placements are computed in the file from sizes and two gaps (40 mm between bodies, 45 mm between module and
keyboard), not typed in. With these values the row spans x = -0.90 to +0.66 on a field of +/-0.948, and
z = -0.48 to +0.31 on a field of -0.51 to +0.59, so **the existing desk fits and `desk.glb` does not change**.

`printer` is **machine-shaped**: it carries the blocks the soft bodies and face tables already read, in
printer-unit coordinates, so they need no knowledge of the system around it.

```js
printer: {
  action: { fixedPlaten: true },
  platen: { radius: 0.021223, length: 0.415, center: [0, 0.150, -0.060], rubberE, rubberNu, rubberDepth, huntCrossleyAlpha, surfaceFriction, inertia },
  printPoint: { beta: 0 },                          // the petal meets the platen on its front, at axle height
  slug: { faceHeight, faceWidth, reliefDepth, caseOffset: 0, faceRadius, foundationKPerM2, ... },
  paper: { ...as the typewriters, feed-roll and bail angles for this path... },
  ribbon: { film: true, width: 0.0116, length: 122, tracks: 3, ... },
  bodyProxy: { ... },
  carriage: { typingDirection: -1, travel: 0.340 },
  escapement: { pitch: 0.0254 / 12 },               // read by consumers that want a nominal pitch
  wheel, selection, hammer, carrier, index, ribbonFeed, cam, panel, cover, fan,   // 6.2
},
```

### 3.2 Registry and geometry

```js
// src/machine/index.js
export const MACHINES = { frontstrike1926, element1971, wordproc1980 };
export const DEFAULT_MACHINE = 'frontstrike1926';
export const KITS = {                               // by action.type; definitions stay plain data (they are cloned into the worklet)
  'typebar-frontstrike': () => import('../kits/typewriter.js'),
  'single-element':      () => import('../kits/typewriter.js'),
  'printwheel-system':   () => import('../kits/wordproc.js'),
};
export function geometryFor(machine) { /* deriveGeometry or deriveWordprocGeometry */ }
```

`src/machine/wp-geometry.js` exports `deriveWordprocGeometry(m)`:

```js
{
  system: true,
  units: { station: { origin:[x,0,z] }, display: {...}, keyboard: {...}, diskette: {...}, printer: {...} },   // world placements
  keys: [ { pos: 1..84, id, row, pos3: [x,y,z] /* keyboard-local, on the 12 degree slope */, width, travel, cls, typematic, makeBreak } ],
  nKeys: 84,
  printer: {                                         // the geometry SoftWorld and buildFaceTables take
    printPoint, printNormal, strikeDown,
    bars: [ { index, lower: ch, upper: ch, skew: 0, offsetX: 0, offsetY: 0 } ],   // 96 petals; "bar" i is petal i
    nPrint: 96, keys: [], nKeys: 0,
    wheel: { center, axis, radius, petalStep: 2 * Math.PI / 96, order: 'a...'}  // 6.2
  },
}
```

### 3.3 `main.js`, kits and the scene

`main.js` keeps what every machine shares: stage, materials, desk, room, environment, ambience, panel shell,
machine picker, orbit, the audio-unlock gesture, the frame loop and the quality governor. Everything else moves.

```js
// src/kits/*.js
export async function mount(ctx): Promise<Kit>
// ctx  = { stage, canvas, params, machine, geometry, mats, desk, orbit, panel, environment, onUnlock(fn) }
// Kit  = { sim, soft?, update(dt, now), afterRender?(), debug }     // debug is merged into window.__tw
```

- `src/kits/typewriter.js` is the present body of `main()` from `createAtlases` to `installTerminal`, moved
  without edits other than taking its inputs from `ctx`. It is the first commit of the work and must leave
  every existing test and e2e script green before anything else lands.
- `src/kits/wordproc.js` builds the unit views, the mechanism client, the software, the CRT, the printer's
  `SoftWorld`, pages, props and input.

Changes to shared scene code, all backward compatible:

| File | Change |
|---|---|
| `src/render/desk-layout.js` (new) | `deskSpot(machine, name)` returns `machine.deskLayout[name]`, or today's constant plus `deskSpread` when the machine has no layout. `desk-pile.js`, `fresh-stack.js`, `desk-props.js` and `environment.js` call it instead of adding `deskSpread` themselves |
| `src/render/desk.js` | The contact shade takes up to four rectangles (`uFoot[4]`, `vec4` centre and half-size); `setFootprints(boxes)`. `setFootprint(box)` remains as a wrapper |
| `src/render/scene.js` | `stage.fitShadow({ halfX, halfZ })` resizes the key light's shadow camera; called with `deskLayout.extent`. The map stays 2048 (1.0 mm per texel at this extent) |
| `src/render/environment.js` | `deskLayout.lamp === false` builds no lamp. In the dark a room light with no visible fixture holds the key light at 35 % of its day level, so the CRT is the brightest thing in view |
| `src/render/desk-props.js` | The ashtray group is parented to the unit named in `deskLayout.ashtray.on`; the ember position used for burning is taken from its world matrix |
| `src/render/materials.js` | `loadStudioTextures(..., { only: machine.textures })` |
| `src/interact/orbit.js` | `orbit.flyTo(preset)`; `keepInView: false` drops the pull toward the home target; `rotate()` applies at once. The views are in 3.5 |
| `src/interact/drag.js` | One generic part kind, `{ kind: 'dof', dof, index, mode: 'rotary' | 'linear' | 'toggle', axis, range, label }`, mapped to `sim.grab`. Every word-processor control uses it; keys keep the existing `key` kind |
| `src/ui/panel.js` | `panel.setReadouts([{ label, get(state, layout) }])` supplied by the kit; the typewriter sliders are hidden when `machine.kind === 'system'` |

Unit views live in `src/render/wp/`: `units.js` (one `THREE.Group` per unit at its placement, GLB loading,
footprints), `station-view.js` (module, display on its turntable with tilt and swivel, knobs, power rocker, CRT),
`keyboard-view.js`, `diskette-view.js`, `printer-view.js`. Each has `update(state, layout)` and a list of
pickables, like `ElementView`.

Units are axis-aligned on the desk (no yaw), except the display, whose swivel and tilt are DOFs. The printer is
the unit the `SoftWorld` runs in, and a yawed soft-body frame is not worth its cost.

### 3.4 `SoftWorld` in a unit

`new SoftWorld({ machine: def.printer, geometry: geo.printer, glyphs, origin: geo.units.printer.origin })`.
`origin` (default `[0, 0, 0]`) is subtracted in `_toFrame`, so pointer grabs and the burn test take world points
as now. The paper and ribbon meshes are added to the printer's group instead of the scene, which places them
with no further change. `HeadView` gets the same `origin` and `followX = () => -soft.carrierOffset`, so the
Print Point window works for the printer. The sheet's desk plane is still y = 0.

Two small edits inside `src/soft`: `RibbonSim.weave()` returns 1 when `ribbon.film` is set, and the film uses
its own `depletionPerStrike`. Nothing else in `src/soft` changes.

### 3.5 Views: stations, focus items and the free view

Five bodies across a desk are too much for the typewriters' orbit, and the owner found the camera hard to steer
and given to jumping. The camera now moves only when the user asks it to, and the ways of asking are visible.

| Piece | File | What it does |
|---|---|---|
| Model | `src/interact/wp-views.js` | `STATIONS`, `FOCUS`, the framing (`framePose`, `poseOf`) and `ViewNav`, the state machine. No DOM, no three.js; tested in Node |
| Pointer | `src/interact/wp-pointer.js` | Picking (`makePicker`), the press, click, drag, wheel and pinch rules, and the hover highlight |
| Controls | `src/ui/wp-nav.js` | The edge arrows, the bar, the hover label and the keyboard shortcuts |
| Screen card | `src/ui/wp-screen-card.js` | The phosphor picture flat in the insets (9.4) |

**Stations.** Desk (the overview), Printer, Computer (module, display and keyboard) and Diskettes (the unit and the
desk file). Each is seen head-on from a fixed elevation at the nearest distance that holds its units with a margin,
worked out for the window's shape, so a tall phone window stands back for the width. The three units form a row,
printer to diskettes, walked by an arrow at each edge of the window (named on hover, always named on a touch
screen); the row has no wrap-around. The desk is the overview above the row: Back goes up to it, and its arrows go
down to the row's ends. The bar at the top lists the stations too.

**Focus items** are closer looks within a station, chosen from the bar's second row or by clicking the object:

| Station | Focus items |
|---|---|
| Desk | Paper (the fresh stack and the page pile) |
| Computer | Screen, Keyboard, Controls (power switch and the display's knobs, from a little to the right), Rear (from behind) |
| Diskettes | Slots, Levers, Desk file |
| Printer | Panel, Mechanism (from above; the bar says to click the cover if it is closed), Paper path (from the left) |

Each item frames a named box. The kit takes the boxes from the parts themselves (`Box3` of the face mesh, the
rocker and knobs, the slots and drive fronts, the levers, the panel keys, the platen and carrier, and so on), once,
after the units are built; `fallbackBoxes(geometry, machine)` derives the same names from the unit boxes alone, for
the tests and for a part a model does not have. The camera never opens the cover or moves a part: a view is only a
camera.

**Clicks.** What is under the pointer is decided in this order: a key (held down for as long as the button is), a
control (a pickable whose `part()` is not null, worked on release if the pointer moved less than 5 px), then, by
where the ray meets the units, the smallest navigation box holding that point: a focus item of this station, or
another station by its units. Only that last kind is highlighted on hover (an outline and a faint fill over its box,
drawn over everything, and a label such as "Keyboard · look closer"), and only it moves the camera. A press on a key
or a control never starts an orbit, whatever the pointer does next. There is no double-click reset.

**Free view** is a mode, switched by the ◎ button or a shortcut. In it a drag on empty space orbits, a right or
Shift drag pans, the wheel or a pinch zooms toward the pointer, a one-finger drag orbits; nothing is highlighted and
nothing pulls the camera anywhere. Leaving it (the button, the shortcut or Back) glides to the station whose head-on
view is nearest the camera, its target counting double. At a station a drag or the wheel does nothing but show a
note naming the free view.

**Touch and small windows.** The arrows, the bar's buttons and the ◎ toggle are ordinary buttons, so a tap works
them; with no hover (`@media (hover: none)`) the arrows always show their station's name and the buttons grow to
finger size. Below 640 px of width the bar moves down above the panel, clear of the Screen card, and the long hint
line is hidden (only for this machine: `body.wp-views`). A tap on a highlighted object works as a click; a pinch
zooms and a one-finger drag orbits only in the free view.

**Glides.** Every move is `Orbit.flyTo` with smoothstep easing, 0.55 to 1.0 s by distance. A change of window shape
frames the same view again at once.

**Shortcuts.** The machine takes nearly every key of the PC keyboard (5.3), Escape included (CANCL), so the views
use Ctrl+Shift chords, taken in the capture phase before the machine's keyboard handler sees them: Ctrl+Shift+←
and → the neighbouring station, ↓ Back, ↑ the free view. The numeric keypad, which the machine does not use, has
4 and 6, 2 (or 0) and 5 (or the decimal point) for the same. Ctrl and Shift go down on the machine first; Textpack
gives CONTROL and SHIFT alone no function. Back is therefore not on Escape. The test checks that no shortcut
shadows a key of `KEYMAP` or `CHORDS`.

**What made the old camera jump.** The kit's own pointer code called `orbit.rotate()` on a drag, and `rotate()` only
changed the angles: `Orbit.update()` does not apply them while a drag is held (`drag.js` calls `orbit.apply()`
itself, the kit did not). The camera stood still through the drag and then leapt the whole way at release, or, if
the pointer was held still before release, at the next pan, zoom or glide. A press on a control or a key that
wobbled a pixel or two added to the same pending turn, and any double-click (two quick clicks on a key or a lever)
sent the camera back to the overview. `rotate()` now applies at once (the typewriters already applied after it, so
they are unchanged), the kit no longer has a double-click reset or turns on control presses, and the word processor
builds its `Orbit` with `keepInView: false`, which drops `clampTarget`'s pull toward the home target. At the old
presets that clamp never bit (the desk extent of 1.05 m is wider than any preset's offset), so it was not the cause,
but in a free view it would hold the target near the desk's centre.

`?view=computer/keyboard` starts at a view; the old `?cam=` names still work (`LEGACY_CAMERAS`), and
`machine.cameras` is no longer read by the kit.

### 3.6 The physical controls

Every control the operator touches works in the browser. A control is a pickable for the pointer (3.5) whose
`part()` gives its hover label and what it does: `onClick`, or `onDrag(dx, dy)` and `onDragEnd` for a knob or the
display's cabinet, and `onWheel(deltaY)` while the pointer is over it. A drag on a control never orbits; a control
with no `onClick` passes a click on to the view behind it (the cabinet to the Screen), and its label names both.
Where the mechanism host has a DOF, a hand grabs it (`sim.grab`); where the real part has no simulated DOF, its
position is view-side state. The pure logic is `src/kits/wp/controls.js`, tested by `tests/wp_controls.test.js`.

| Control | Worked by | What drives what |
|---|---|---|
| Station power rocker | click | `wordproc.js switchPower`: the rocker's pose, `station` power in the host (fan and drive motors run down, and their sound), `crt.setPower` (the raster collapses to the spot), `WpSystem.powerOff()` (saves due are written, every task stops). On again: a new system, `cold` with `t0` at the kit's clock, runs the power-on test and loads the program as `?cold` does |
| Rear LEDs A to H | (no input) | `stationLeds(t)` from the time the station was switched on: all on for 1.2 s, then one stepping A to H at 0.3 s, then G alone while it runs; all off when off |
| Contrast knob | drag (up or right is clockwise), wheel | `crtDrive`: the phosphor pass's character gain, 0.3 to 1.7 of nominal |
| Brightness knob | drag, wheel | `crtDrive`: the picture's level (`uBright` times 0.55 to 1.45) and the bare raster's glow (`uRaster` 0.002 to 0.042). The Screen card shares these uniforms. A faint detent tick (`WpSpeaker.tick`) every 1/24 of the turn |
| Display tilt and swivel | drag on the cabinet: up leans back, sideways turns | `parts.display.setTilt/setSwivel`, clamped to 0 to 20 degrees and 12 degrees either way (HW 1.3); the glass and its spill light are in the tilt node and follow. Knobs, tilt and swivel are remembered in `localStorage['typewriter.wp.display']` |
| Keyboard card window | click | lifts 32 degrees on a hinge along its back edge, and lays back |
| Printer panel keys | click (a 160 ms press) | the `panelKey` DOF; the controller's panel scan does the rest: Start, Stop, Print Test (off line), Cancel, Load, Release, Paper Up and Down |
| Printer LEDs | (no input) | the controller's `leds` bits in the snapshot, in `LED` order, dark with the power off |
| Printer power switch | click | the `printerPower` DOF; on again, the controller's self-test (Diag Mode lit) |
| Printer cover | click | the `printerCover` DOF to its open stop or seat; open, the interlock stops printing and lights Printer Exception (error 06) |
| Ribbon advance knob | drag sideways (forward only) | a hand on the `ribbonKnob` DOF, the ribbon motor's shaft; the knob is the capstan (radius 6 mm, assumed). With the printer on, the motor's holding current holds it, as it would a finger; switched off, the ribbon advances and the soft ribbon with it |
| Feeder gate | click | the sheet feeder's flag (`makeFeeder`), shared with the panel's **sheet feeder** button; each shows the other's change. The gate turns 55 degrees about the stacker plate's normal for manual feed |
| Paper trays | click | slide 110 mm out to the rear and back (view-side) |
| Diskette levers, diskettes | click | the `lever` and `disketteSlide` DOFs (8.6). The 6360 has no power switch of its own: the station's rocker runs its motors |

The Controls focus frames the rocker and knobs, the Rear focus the LEDs, the Panel focus the keys, LEDs, display
and the printer's power switch, Mechanism the ribbon knob (it rides the carrier), and Paper path the gate and trays.

---

## 4. Mechanism host

### 4.1 Why not an `Action`

The first-cut mapping in the plan put the printer behind the `Action` interface as `element1971` is. That
interface exists so different print actions can share `MechanicalSim`'s keys, universal bar, escapement dogs,
carriage on a drawband, line-space lever, bell and shift. Here none of that is shared:

- The carrier is positioned by a stepper on a leadscrew. There is no rack, no dog and no mainspring. Reusing
  the carriage DOF would mean holding the dogs off, zeroing the drawband and moving the bell out of reach, then
  pushing the carriage with a force that pretends to be a screw.
- The keys are in another body and do not act on the printer. `stepKeys` couples every key to the universal bar,
  the vibrator, the shift and the backspace pawl.
- Printing starts from a command queue, not from a key.
- The display station and the diskette unit have about twenty DOFs and three controllers with nowhere to live.

So the host is new and the contract around it is kept. What is reused, by import: `buildFaceTables` and the
Hunt-Crossley contact (`src/sim/faces.js`), the strike event shape, the snapshot and event transport
(`LocalHost`, the worklet, `SimClient`), the sleeping pattern, grab and finger semantics, `SUBSTEP_HZ`.
`src/sim/mechanics.js`, `actions.js` and `element-action.js` are not edited, so the two existing machines
cannot regress.

### 4.2 Modules

```
src/sim/host-factory.js        createMechanism({ machine, geometry, glyphs }), createAudioEngine(sim, sampleRate)
src/sim/wp/index.js            WordprocSim: owns time, inputs, sub-mechanisms, controllers, snapshot, events
src/sim/wp/layout.js           makeWpLayout(geometry)
src/sim/wp/ports.js            WP_PORT (contact forces for audio), WAC (acoustic events)
src/sim/wp/inputs.js           fingers (Hill-type, as MechanicalSim) and grabs, shared by all sub-mechanisms
src/sim/wp/stepper.js          Stepper2Phase, StepperVR3: the two motor models (6.3)
src/sim/wp/keyboard-mech.js    84 stems and fly plates              src/sim/wp/keyboard-ctl.js   scanner, typematic, buffer, click, tone
src/sim/wp/station-mech.js     power rocker, PSU fan, knobs, tilt, swivel, CRT heater and HV states
src/sim/wp/diskette-mech.js    two drives                           src/sim/wp/diskette-ctl.js   adapter
src/sim/wp/printer-mech.js     wheel, carrier, platen, hammer, ribbon, cam, cover, panel keys
src/sim/wp/printer-ctl.js      attachment, planner, selection, hammer, index, panel, self-test
```

`LocalHost` and `src/audio/worklet.js` construct through `host-factory.js` instead of naming `MechanicalSim` and
`AudioEngine`. The worklet gains one command, `case 'dev': sim.command(m)`, and calls `sim.warmUp?.()`.

### 4.3 Interface

```js
export class WordprocSim {
  constructor({ machine, geometry, glyphs })
  kind = 'wordproc'; h = 1 / 384000; t; layout; ports /* Float64Array(WP_PORT.COUNT) */;
  step()                                  // one substep
  pressKey(k, peakForceN, durationS)      // timed finger on keyboard key index k (0..83)
  grab(dof, index, { target, k, c, maxF }) -> id;  moveGrab(id, target);  release(id)
  command(msg)                            // device commands from the software (7.6)
  setEnv(env)                             // from SoftWorld.env(): paperPresent, paperEdgeV, calipers, ribbonInGap
  setParam(path, value)
  writeSnapshot(Float32Array);  drainEvents(out)
  exportState();  importState(s)          // every sub-mechanism and controller, structured-cloneable
  carriageX()                             // minus the carrier's x in printer coordinates
}
```

Grabbable DOFs: `key[0..83]`, `panelKey[0..7]`, `powerSwitch`, `printerPower`, `knob[0..1]` (contrast,
brightness), `displayTilt`, `displaySwivel`, `lever[0..1]`, `disketteSlide[0..1]`, `printerCover`, `ribbonKnob`.

`SimClient` gains two generic members, no-ops on the typewriters: `sim.command(msg)` and
`sim.on('device', fn)`. Device events travel in the snapshot message's event list (250 Hz), like every other
event.

Snapshot layout (`makeWpLayout`). Names shared with `makeLayout` mean the same thing, which is what lets
`SoftWorld._readState` run unchanged:

| Group | Fields |
|---|---|
| Common | `time`, `dspLoad`, `rms`, `lastForce` |
| Keyboard | `keyX[84]`, `keyV[84]`, `speaker` |
| Station | `power`, `fanOmega`, `displayTilt`, `displaySwivel`, `knobContrast`, `knobBrightness`, `crtHeat`, `crtHV` |
| Diskette, per drive | `lever`, `slide`, `clamp`, `diskOmega`, `diskAngle`, `headTrack`, `headLoad`, `motorOmega` |
| Printer, soft-body names | `carriageX`, `carriageV`, `platenPsi`, `platenOmega`, `shiftY` (0), `vibratorLift` (ribbon lift), `ribbonPawlTravel` (ribbon fed, m), `ribbonSelector` (0), `paperRelease`, `bail` |
| Printer, own | `printerPower`, `cover`, `wheelTheta`, `wheelOmega`, `hammerX`, `cam`, `panelKeyX[8]`, `leds`, `digits`, `fifo` |

### 4.4 Threads and rates

| What | Thread | Rate |
|---|---|---|
| `WordprocSim` mechanisms | AudioWorklet; main thread in `LocalHost` before the first gesture; Node in tests | 384 kHz substeps, each DOF group asleep when at rest |
| Controllers | Same, called from `step()` | Event-driven: each holds a deadline and runs when `t` passes it (resolution 2.6 us). Keyboard matrix: one position every 52 us, a full scan every 5 ms |
| `WpAudioEngine` | Same | Audio rate, 3 buses |
| Snapshot and device events | To main | 250 Hz |
| `WpSystem` (ROM, Textpack, file system, print spooler) | Main | On each device event and each snapshot: `sys.advance(simTime)` |
| Screen buffer to GPU | Main | Only when the buffer version changes, at most once a frame |
| CRT phosphor pass | GPU | Each frame while the picture is changing or blinking; skipped when static |
| `SoftWorld` | Main | 480 Hz substeps, as now |
| Diskette store | Main, IndexedDB | After each completed write, coalesced over 1 s |

---

## 5. Keyboard

### 5.1 Keys as mechanisms

84 keys, positions 1 to 84 (HW 2.6). The key table (`src/machine/wp-keys.js`) gives each key its position
number, row, offset and width in key units (19.05 mm), legends (top and front), force class, and the typematic
and make/break marks of the service manual.

Each key is two DOFs in one conservative system:

- **Stem** `x` (m, 0 at rest, positive down), mass `m_s`.
- **Fly plate** `y` (m, 0 seated on the pad card, `Y` lifted), mass `m_p`. It is integrated only while in
  transit and sleeps on either stop.

```
U(x, y)  = F0 x + k x^2 / 2  -  Kt (x - xc)(y - Y/2)  -  A (y - Y/2)^2 / 2
stem:   m_s x'' = F_finger - (F0 + k x) + Kt (y - Y/2) - c x' - stops(x)
plate:  m_p y'' = Kt (x - xc) + A (y - Y/2) - cp y' - stops(y)
```

The first two terms are the compression return spring. The third is the flat spring on the stem that toggles
the plate; the fourth is the plate's own snap. A seated plate leaves when `x > xc + A Y / (2 Kt)` (**make**),
and a lifted plate returns when `x < xc - A Y / (2 Kt)` (**break**). Hysteresis, the tactile drop of `Kt Y` in
the stem force at the snap, and the plate's landing speed all come out of the integration.

| Parameter | Value | Basis |
|---|---|---|
| Full travel | 3.2 mm | "1.5 to 3 mm" (HW 2.2): actuation near 1.5 mm, bottom near 3 mm |
| `xc`, `Y` | 1.5 mm, 0.5 mm | Chosen: make 1.75 mm, break 1.25 mm |
| `Kt`, `A` | 240 N/m, 240 N/m | Tactile drop 0.12 N; hysteresis 0.5 mm |
| `F0`, `k` | 0.30 N, 103 N/m | Peak 0.54 N (55 g) at make for a typing key |
| Force class scale | alpha 1.0, wide keys 1.18, space bar 1.36, ENTER 1.18 | Peaks span the documented 40 to 75 g (HW 2.2) |
| `m_s`, `m_p` | 2.5 g, 0.15 g | Cap and stem; a plate of this size |
| Stops | felt at bottom (k 9e4 N/m, c 16), hard at top | As `element1971`'s keys |
| ENTER | Seat 3 mm lower than the space bar | HW 2.1 |
| LOCK | No return spring; a detent holds it down; either SHIFT releases it through a link force | HW 2.2 |

A key's sense signal is the pad capacitance `C(y) = C0 / (1 + y / y0)` with `y0 = 0.1 mm`.

### 5.2 From a press to a scan event

The scanner (`keyboard-ctl.js`) is the keyboard's own microprocessor (HW 2.4).

1. It visits one matrix position every 52 us (12 x 8 = 96 positions, 5 ms per pass; the period is an assumption).
2. A position reads **down** when `C / C0 < 0.45` and **up** when `C / C0 > 0.60`.
3. A change produces one byte: bits 0 to 6 the key position, bit 7 the flag. Make/break keys (both SHIFTs, LOCK,
   CODE, CONTROL) send on press (flag 0) and on release (flag 1). Every other key sends on press only.
4. Typematic, for every non-make/break key: after 350 ms down, a byte with flag 1 (repeat) every 71.4 ms
   (14 per second). It stops on release or when another typematic key goes down.
5. Bytes go to a 4-entry buffer; an overrun replaces the fourth entry with the error byte `0x7F`.
6. The serial link sends one byte per 1 ms (assumed) and waits for the system's acknowledge. Each sent byte is a
   device event `{ type: 'device', dev: 'kbd', ev: 'scan', byte, t }`.

Which repeats act is the software's choice (7.4), as on the real machine.

### 5.3 The real keyboard and the pointer

`src/interact/wp-keyboard.js` maps `KeyboardEvent.code` (physical position, not the character) to a key index
through `src/interact/wp-keymap.js`. A keydown starts a grab on the key's stem with a spring toward 1.3 x travel
and `maxF` of the panel's touch force (default 1.2 N); the keyup releases it, no sooner than 40 ms after the
press. Holding is real, so SHIFT, CODE and typematic need no special code. `e.repeat` is ignored: repeats come
from the simulated keyboard.

Default map (the owner may change it, see 13.2):

| Real key | Machine key | Real key | Machine key |
|---|---|---|---|
| Letters, digits, `-` `=` `;` `'` `,` `.` `/` | Same position (10 to 61) | `AltLeft` | 63 CODE |
| `Backquote` | 9 degree / plus-minus | `AltRight`, `NumpadEnter` | 65 ENTER |
| `BracketLeft`, `BracketRight` | 34 quarter / half, 35 brackets | `ControlLeft` | 3 CONTROL |
| `Backslash`, `IntlBackslash` | 49 superscripts, 51 paragraph / section | `Enter` | 36 RETURN |
| `Backspace`, `Tab`, `CapsLock`, Shifts, `Space` | 22, 23, 37, 50 and 62, 64 | Arrows | 74, 75, 78, 79 |
| `F1` `F2` `F3` `F4` | 5 REQST, 6 PRINT, 76 FIND, 80 GO TO | `PageDown`, `PageUp` | 77 SCREEN DOWN; chord CODE+77 |
| `F5` `F6` `F7` `F8` `F9` `F10` | 67 MOVE, 68 LINE ADJ, 69 SPELL, 70 CHG FMT, 71 GET, 72 PAGE END | `Delete`, `End`, `Insert` | 66 DEL, 7 END, 8 MSG |
| `Escape` | chord CODE+5 (CANCL) | `Home` | chord CODE+78 (boundary left) |

CODE and ENTER sit either side of the space bar on the machine, as the two Alt keys do on a PC keyboard. A chord
alias is two simulated fingers (CODE held, the key tapped, CODE released), not an injected event. `preventDefault`
is called for every mapped key. On layouts that report AltGr as `ControlLeft` + `AltRight`, the `ControlLeft`
that arrives in the same task as `AltRight` is dropped. Keys with no real counterpart (the math column, KEY
PLAYBCK, COLUMN, SCREEN RIGHT) are pressed with the pointer. The panel has a "keys" card showing the map.

Pointer presses use the existing `key` drag kind against `keyX`.

### 5.4 Click and beep

The system raises Click after each keystroke it accepts and each repeat it honours (HW 2.3). So the click is a
software output: `devices.kbd.click()` becomes `sim.command({ dev: 'kbd', op: 'click' })`, and the controller
drives the speaker with a 0.5 ms pulse. `devices.kbd.tone(ms)` gates a 1 kHz square wave: 200 ms for the short
beep, 400 ms for the long one (the short beep as measured in the owner's recording, 10.4; the long one assumed). The
speaker model is in 10.2 and 10.4.

### 5.5 Latency budget

Fly plate leaves the pad to click heard: scan up to 5 ms, link 1 ms, snapshot up to 4 ms, main-thread turnaround
1 to 3 ms (the handler runs in `port.onmessage`, not in the frame loop), command back and one audio block 3 ms.
Target: median under 12 ms, 95th percentile under 25 ms at 60 frames per second. If a slow main thread makes the
jitter audible, the software moves to a Worker behind the same device interface (7.6); nothing else changes.

---

## 6. Printer

### 6.1 What is physics and what is controller

| Physics (`printer-mech.js`) | Controller (`printer-ctl.js`) |
|---|---|
| Wheel rotor and wheel under phase torque, friction and the petal drag | Shortest-way step count, which phase is on (from the three pickups), when to brake, when "seated" is true |
| Carrier stepper rotor, leadscrew, sprung follower, carrier mass on its shafts, end stops | Step schedule: speed, ramps, direction; position from the encoder; margin from the encoder |
| Index stepper rotor, timing belt as a spring, platen, paper drag | Step schedule for 1/96 in moves |
| Coil current (R, L), armature force, armature flight, petal pickup, glyph face on ribbon, paper and platen (`faces.js` tables, Hunt-Crossley), rebound, return spring, backstop | Current amplitude and on-time per force group, firing instant, flight-time servo, cancel if selection or escapement is late |
| Ribbon stepper and take-up, lift cam follower | Feed per character, track sequence |
| Cam motor, worm, cam, feed-roll rocker and bail (drive `paperRelease` and `bail`) | Cam position requests, reed-switch feedback, error 76 |
| Cover hinge and its magnetic latch, panel keys, power rocker, fan | Panel logic, LEDs, two-digit display, cover interlock (error 06), 15 s self-test |
| Paper, ribbon rope, ink and emboss (`SoftWorld`, unchanged) | Nothing |

### 6.2 Geometry and the carrier frame

The platen is fixed and the carrier moves, so the printer uses the `element1971` frame: the snapshot's
`carriageX` is minus the carrier's x, `SoftWorld` is built with `fixedPlaten`, and the paper and ribbon meshes
and the Print Point camera are offset by `carrierOffset`. The ribbon cartridge rides the carrier, so `RibbonSim`
runs between two spool positions on the carrier as it does for the element machine.

The wheel's axis runs front to back, below the print line. The petal at the top is in front of the print point
and the hammer, clamped above the selection motor, drives it straight back into the platen (PR 4, 5). The print
point is at axle height on the platen's front (`beta = 0`). A selection error at impact is an angle on the
wheel, so it moves the character sideways by `r x error`; it is reported in the strike's `lateral`.

Petal order is not documented. Home (index 0) is lowercase `a` (PR 4). The rest are placed by English frequency,
alternately either side of home, so common letters need short moves; `geometry.printer.wheel.order` holds the
string. The 96 characters are exactly the 96-character keyboard's (HW 2.6).

### 6.3 Motor models (`stepper.js`)

Both integrate a rotor angle and, per phase, a current with a first-order lag (chopper drive), so torque falls
off with step rate and a motor asked for too much loses step, as a real one does.

```
Stepper2Phase (carrier 200 steps/rev, index 180, ribbon, diskette head 200):
  T = -K (iA sin(N th) - iB cos(N th)) - Td sin(4 N th) - b th' - Tc sgn(th'),   N = steps/rev / 4
  di/dt = (i_cmd - i) / tauE                       full step, two phases on

StepperVR3 (wheel, 96 steps/rev, 3 phases, 32 rotor teeth):
  T = sum over k of -(1/2) L1 Nr ik^2 sin(Nr th - 2 pi k / 3) - b th' - Tc sgn(th')
```

The wheel's controller commutates from the rotor pickups (closed loop): it energises the phase that gives the
largest torque in the wanted direction for the first part of a move, the opposite for the second part, then
holds the target phase. The switch point comes from a table indexed by remaining steps, filled by the
calibration tool (6.6).

### 6.4 Parameters

| Item | Value | Status |
|---|---|---|
| Wheel | 96 petals, 3.75 degrees apart, tip radius 38 mm | Count documented; radius assumed (PR 3) |
| Wheel, hub and rotor inertia | 3.5e-6 kg m^2 (wheel 1.0e-6, hub and rotor 2.5e-6) | Assumed from geometry |
| Selection peak torque | 0.25 N m | **Tuned**, see 6.6 |
| Carrier screw | 200 steps/rev, lead 21.16 mm, 1/240 in per step | Documented |
| Carrier | 1.2 kg; rotor and screw 2.4e-5 kg m^2; follower 2e5 N/m; holding torque 0.45 N m; `tauE` 0.4 ms | Assumed |
| Print speed limit | 1440 steps/s (152.4 mm/s) | From 60 cps at 10 pitch |
| Slew limit and ramp | 3000 steps/s, 40 000 steps/s^2 | Assumed; a test proves no lost steps |
| Minimum character cycle | 14 ms | Assumed; keeps 12 pitch under 72 cps |
| Platen | Radius 21.223 mm, length 415 mm, 2e-4 kg m^2 | Inferred 40 to 45 mm; this radius makes the belt ratio exactly 2.8 |
| Index | 180 steps/rev, 1/96 in per step, 400 steps/s | Documented steps; rate from the 66 ms bound |
| Hammer | Armature 6 g, petal 0.2 g, free travel 0.5 mm, petal travel 1.7 mm less the paper and ribbon calipers, return spring 1.5 N + 300 N/m | Gaps from PR 3; masses assumed |
| Impact energy, low / medium / high group | 2.5 / 5 / 8 mJ before calibration | **Tuned**, see 6.6 |
| Ribbon | Film, 11.6 mm x 122 m, three tracks, 0.37 mm advance per character | Size documented; rest inferred (PR 6) |
| Paper | Letter, as the typewriters (`paper.width`, `paper.height`) | Textpack default (SR 7.3) |

### 6.5 The print cycle

The software sends 16-bit commands in the documented shape (PR 11); the encoding is ours:

| Word | Meaning |
|---|---|
| `0x1000 | impression << 8 | petal` | PRINT at the position reached by the pending moves; impression 0 uses the wheel's table |
| `0x2000 | dir << 11 | n` | ESCAPE n / 240 in, n up to 2047 |
| `0x3000 | dir << 11 | n` | INDEX n / 96 in |
| `0x5000 | k` | PAPER: 1 load, 2 release and eject, 3 bail open, 4 bail close |
| `0x6000 | k` | CONTROL: 1 restore to left margin, 2 end of data, 3 read status |

The attachment holds a 32-command FIFO. The software keeps it topped up against a credit count returned in
`{ dev: 'printer', ev: 'credit', n }`. The real link allowed one command ahead; the deeper queue is our
tolerance for a busy main thread and changes no timing.

The planner looks ahead over the queued PRINTs of a line:

```
for each character i:  impact_i = max( impact_{i-1} + 14 ms,
                                       arrive(x_i) at <= 1440 steps/s,
                                       wheelReady_i + flight_g )
carrier step times follow so that it passes x_i at impact_i without stopping; fire_i = impact_i - flight_g
```

`wheelReady` and `flight` are the controller's own estimates (the move table and the servoed flight time). The
carrier slows for a long wheel move and stops only at line ends, for an index, or when the queue runs dry.
Printing runs in either direction; the software chooses the direction per line (7.7). If the pickups do not
report "seated" at `fire_i`, the fire is cancelled and retried one cycle later (the documented recoverable
error 55).

**Flight-time servo.** After each strike the controller has the time from current-on to the impact sensor
(in the model: first platen contact). Per force group it corrects the on-time:
`tOn_g += 0.35 (flightTarget_g - flightMeasured) x dTon/dFlight`. On power-on `tOn_g` starts 20 % off, so the
first six to eight characters of each group print uneven and then settle (PR 5). Paper and ribbon thickness reach
the mechanism through `setEnv`, change the gap, and the servo follows.

**Strike event.** Emitted at the end of contact with the fields of the existing contract: `bar` = petal index,
`caseIndex` 0, `carriageX` and `platenPsi` at peak force, `lateral` = tip radius x selection error, `vImpact`,
`peakForce`, `maxIndent`, `vibratorLift` = ribbon lift, `ribbonInGap`, `trace`. `SoftWorld.applyStrike` does
the rest.

### 6.6 Choosing the missing numbers

`tools/wp/calibrate_printer.mjs` runs the headless mechanism and writes the tuned constants; a test asserts the
definition still matches what the tool computes.

1. **Selection torque** against the documented 60 cps. The mean shortest-way move over random petals is 24
   steps. Tune the peak torque so a 24-step move, its settle and a medium-group flight take 15.0 +/- 0.3 ms,
   inside the 16.7 ms cycle of the rating. With the inertia above this is about 0.25 N m.
2. **Hammer energy** against the ink model. For each force group, take its faces from the face tables
   (`energy[]` is already tabulated per face) and find the energy at which the peak face pressure is 1.6 x
   `paper.inkHalfPressure` for the group's median face. Check that the smallest face in the group stays under
   `paper.perforationPressure`. The three energies give the three impact speeds and, with the gap, the three
   flight-time targets.
3. **Result to verify**: 60 +/- 1 cps on a 10-pitch line of short wheel moves (carrier limited), 45 to 60 cps
   on English prose, at least 30 cps on the worst alternation with no cancelled fires, a 16-step line feed
   within 66 ms.

### 6.7 Paper in, pages out

Feed is friction, with motorised rollers and bail (PR 2). `PaperSim`'s existing roll and bail patches serve;
`printer.paper` gives their angles for this path, the cam drives `paperRelease` and `bail`, and the index
stepper turns the platen. The rear slot and its window stand in for the paper table.

- **Load.** The operator (or, on a click of the fresh stack, an invisible scripted grab in `src/interact/wp-hands.js`,
  like the typewriter's `Hands`; there is no hand model) lays a sheet in the slot: `soft.spawnSheet({ onTable })`. LOAD on the panel, or the software's PAPER load,
  opens the bail and feeds until the first-writing-line sensor sees the edge. The sensor reads
  `env.paperEdgeV`, a new field of `SoftWorld.env()` (the sheet's `v` at the print point, or -1).
- **Eject.** At a page end the software sends PAPER release. The controller feeds forward until the sheet leaves
  the rollers; `PaperSim.onEjected` fires as it does today, the sheet is parked, `onSheetRetired` archives the
  page image and `DeskPile` receives it at `deskLayout.pagePile`. No new page path.
- **Sheet feeder.** The 5218's optional sheet feeder, modelled as part of the printer: a hopper on top of the
  rear slot holding a stack, and a pick roller driven by the feed cam that pushes the top sheet into the slot when
  the printer reports Load Paper, so a multi-page document prints unattended. A toggle (on by default) switches it
  off for manual feed: the hopper empties onto the fresh stack and the operator lays each sheet. No hand model.

### 6.8 Decisions made in implementation (M5)

Choices the design left open, settled while building the headless printer, each with its reason. Calibrated numbers
are in `src/machine/wp-printer-cal.js`, written by `tools/wp/calibrate_printer.mjs`.

1. **Selection is a closed loop on a switching curve, not a per-move brake point.** "A table indexed by remaining
   steps" is read as the braking speed for each distance still to go: the loop pulls while the rotor is slower than
   the table and brakes while it is faster. Per-move brake points were tried first and gave erratic, non-monotone
   seat times (a 1/8-step pickup cannot place a fixed switch point well). The table is `sqrt(2 a r)` scaled by one
   calibrated factor (`brakeScale` 0.65).
2. **The pickups give speed as well as position.** A reluctance pickup's EMF goes with speed, so the controller reads
   the rotor speed directly (`io.wheelSpeed`) and its position in eighths of a step. Speed from the time between
   eighth-step crossings was too stale near the target to damp the hold.
3. **Inside a capture distance (half a step) the wheel is servoed**, by choosing the phase that pushes the right way
   and its current (PD on position and pickup speed), then seated and held on the target phase. A viscous inertia
   damper (a ring in silicone) on the shaft adds mechanical damping. Without these, a single-phase VR hold rings for
   tens of milliseconds.
4. **Commutation is advanced by the coil current's rise time** (0.2 ms of speed), as chopper drives do.
5. **Selection peak torque is 0.518 N m**, about twice the 0.25 N m first estimate: current rise time, the damper ring
   and the settle all count against the 15.0 ms target of 6.6 item 1 (met at 14.95 ms).
6. **Hammer energies are lower than the first guess**: 1.14 / 2.09 / 3.18 mJ (0.61 / 0.82 / 1.01 m/s) for the
   low, medium and high groups, from 1.6 x the half-ink pressure on the median 12-pitch face. The largest pressure
   on any group's smallest face is 80 MPa, under the 158 MPa perforation pressure. On-times 1.64 / 1.38 / 1.23 ms
   at 2.2 / 2.8 / 3.4 A give flight targets of 3.20 / 2.74 / 2.43 ms.
7. **Force groups for unlisted characters**: the manual lists 61 characters (three of the five low ones lost in OCR;
   `.,-:'` are taken as the low five). Every other petal joins the group whose median face area is nearest its own.
8. **The power-on on-time error is +20 %**, not -20 %: with 20 % less on-time the armature stops short of the platen
   and there is no flight time to servo on. Heavier first characters that settle in eight strikes are what the manual
   describes.
9. **The next selection waits for the hammer to clear the petals** (calibrated `hammerClear`, 2.5 ms after impact),
   not merely for the rebound: a wheel turned under a forward nose catches the next petal. The planner allows for
   this and for how late an impact can come after its planned knot (`impactLag`, 0.55 ms).
10. **Firing on the move uses the plan and the encoder together**: at each encoder edge the controller measures how
    far the motor runs behind its profile and fires so that peak force falls on the column, allowing for the
    follower's lag (`carrierLag`, 0.15 step, calibrated). Columns land within 0.020 mm, both directions within 0.014 mm.
11. **The planner works on knot speeds**: constant acceleration between character knots, each knot no faster than
    its intervals' average speed allowed by `impact_i = max(...)`, then backward and forward passes for the ramp.
    A line starts with a run-up from where the carrier stopped; with less than 2 steps of run-up the first character
    is printed at rest. A turn, an overstrike, an index or a late character that the carrier could not slow for ends
    a segment; the carrier runs out a ramp's length past the last character and stops on a whole step.
12. **A cancelled fire (55 or 45) stops the carrier and takes the character again from rest**; it is reported as a
    recoverable error.
13. **Wheel and petals**: 96 petals carry the 94 distinct characters of the 96-character keyboard; the comma and
    period, which print the same in both cases, are on two petals each. Only the petal at the top meets the platen.
    Each petal is its own sprung DOF, so a struck petal rings and returns while the wheel turns on.
14. **Ribbon**: one ribbon-motor step feeds 0.031 mm; four steps a character (0.123 mm, a third of 0.37 mm, giving
    about a million characters on 122 m) also turn the lift cam a third of a turn, so successive characters fall on
    tracks 0, 1, 2 (lift 0, 3.87, 7.73 mm). Feeding at 600 steps/s keeps the lift follower on its cam.
15. **Index**: a start rate of 250 steps/s (a stepper can start there from rest) ramping to 400; full holding current
    and a damped belt. A 16-step feed settles within 5 % of a step in 60 ms. Escape and index words accumulate and
    run at the next print or end of data; an index after a line's last character starts while the carrier runs out.
16. **Homing at power-on** drives the carrier left at 40 % current until the encoder stops following (the left
    stop) and takes logical 0 as 26 steps out from there; at full current it would compress the follower, and a
    stepper driven on against a stop can run backwards. The wheel steps until the home pickup answers (error 56
    after 32 three-step moves); the cam runs home. The internal checks take 14.8 s, so the whole test takes about 15 s (SET p.15).
17. **Command encoding details**: escape and index direction is bit 11 (1 = left or reverse); PRINT impression 1 to 3
    selects the low, medium or high group, and 4 is treated as high (no data on a fourth level). Credits are
    coalesced into one `{ ev: 'credit', n }` per snapshot.
18. **Paper cam motor**: switched off, its terminals are shorted, so it brakes on its back EMF and stops inside the
    position's dwell; the worm never lets the followers drive it back.
19. **Strike event**: the existing fields, plus `selectionError` (rad) and the pressure fields the element machine
    already adds. `lateral` is tip radius x selection error.
20. **Audio**: `WpAudioEngine` (`src/audio/wp-engine.js`) has the AudioEngine interface and drives the host silently
    until the voices of section 10 arrive; it drains the acoustic events.
21. **Glyphs**: `glyphs_wp.gz.bin` (44 KB) and `.json`, baked by `tools/bake_glyphs.py --set wp` from the existing
    font at 12 pitch; `loadGlyphs(set)` reads a gzipped set with `DecompressionStream` or `zlib`.

---

## 7. Software

### 7.1 Layout

```
src/wp/index.js            createSystem({ devices, store, options }) -> WpSystem
src/wp/sched.js            clock, timers, generator tasks, key queue
src/wp/screen.js           the 80 x 25 buffer and its regions
src/wp/charset.js          8-bit character set (Latin-1 positions), symbol font codes, printwheel map
src/wp/keys.js             key positions -> KeyEvent, modifier state
src/wp/rom.js              power-on test, program load
src/wp/font/               8 x 16 font data (9.2)
src/wp/textpack/menus.js           the menu tree as data
src/wp/textpack/menu-runner.js     menu and prompt coroutines
src/wp/textpack/messages.js        every prompt and message string, keyed, with its source
src/wp/textpack/tasks/             typing.js, paginate.js, print.js, index.js, workdisk.js, request.js, bypass.js, spell.js
src/wp/textpack/spell/             dictionary.js (the word list and supplement), hyphen.js (hyphen points)
src/wp/textpack/editor/            buffer.js, codes.js, format.js, layout.js, view.js, commands.js
src/wp/textpack/print/             formatter.js, spooler.js
src/wp/disk/                       geometry.js, image.js, fs.js, library.js, store.js
src/wp/devices/virtual.js          analytic devices for Node (and `?wpdevices=virtual`); the printer in virtual-printer.js
src/wp/devices/timing.js           the timing formulas
src/wp/testkit.js                  keystroke-script runner and screen matchers
```

Rule, enforced by a test that greps the tree: nothing under `src/wp/` imports from outside it, and nothing in it
names `window`, `document`, `performance`, `Date`, `setTimeout` or `Math.random`.

### 7.2 Time and tasks

```js
const sys = createSystem({ devices, store });
sys.advance(t)            // set the clock to simulated time t (s); run timers that are due
sys.deviceEvent(evt)      // a scan byte, a diskette completion, printer credit or status, power
sys.screen                // 7.5
sys.idle                  // no task is runnable and no timer is pending
```

A task is a generator. It yields a request and is resumed with the answer:

```js
function* createDocument(sys) {
  const name = yield* promptLine(sys, 'docName', { suggest: sys.lastDocument });      // waits for keys
  const disk = yield* chooseDiskette(sys);
  if (yield* sys.fs.exists(disk, name)) return sys.messages.post('exists', { name }); // waits for the drive
  ...
}
```

Requests: `key()` (next key event from the queue), `wait(seconds)`, `io(request)` (a device operation),
`join(task)`. The scheduler runs every runnable task until it blocks, with no microtasks, so a test drives the
whole system with synchronous calls. Consequences that come for free:

- **Type-ahead and batch menu access** (SR 3.3): keys queue until the foreground task asks for one.
- **CANCL levels** (SR 3.2): `promptLine` and `runMenu` implement the four levels once.
- **Background printing**: the spooler is a second task. Its messages go to the message queue.
- **Real time without slow tests**: in the browser, `io` completes when the mechanism reports it and the clock
  is the mechanism's time (so slow motion slows the software too). In Node, `VirtualDevices` answers each
  request with a completion time from `timing.js`, and `runUntilIdle()` jumps the clock from deadline to
  deadline.

### 7.3 State

| Object | Contents |
|---|---|
| `sys.power`, `sys.rom` | Off, self-test stage, waiting for a program diskette, loading, running |
| `sys.program` | Which segments are in memory (nucleus, typing, work diskette, spelling). Entering a task family whose segment is not loaded reads it from the program diskette |
| `sys.settings` | Work station description, format defaults, menu abbreviations (stored on the program diskette image) |
| `sys.keys` | Modifier state, the key queue, keystroke save (250 keys) |
| `sys.screen` | 7.5 |
| `sys.prompt`, `sys.messages` | The prompt line with its input field; the message queue and the blinking indicator |
| `sys.doc` | The open document: name, diskette, comment, document and alternate formats, page table, flags, the page in memory |
| `sys.printQueue` | Up to 6 jobs; PRINT-key jobs up to 25 pages |
| `sys.fs`, `sys.library` | Mounted volumes by drive; the diskette images |

**The page buffer** (`editor/buffer.js`) is a gap buffer of `Uint16` units for the one page in memory:

| Range | Meaning |
|---|---|
| `0x0020` to `0x00FF` | A character in the machine's set (Latin-1 positions, so `¢ § ° ± ² ³ ¶ ¼ ½` need no table) |
| `0x0100` to `0x01FF` | A parameterless control code: carrier return, required carrier return, tab, required tab, required space, required hyphen, syllable hyphen, required backspace, page end, required page end, index, index return, zero index carrier return, half index up and down, centre, begin and end underline, word underline, character underline, stop, switch, substitute, begin and end keep |
| `0x8000 | n` | A reference to `page.objects[n]`: format change, format return, alternate format, typestyle change, overstrike begin (with its character), include, variable, keyboard change, skip to line, page number, spelling marks |

`editor/codes.js` is the table for every code: its status-line name and symbol (SR 5), whether it takes a
column with Display Codes off, whether BKSP may delete it, what it does to an indent, what it prints.

**Line endings are stored.** A wrap inserts a regular carrier return code after the spaces at the break; the
spaces stay. Auto Adjust re-flows from the cursor line to the next required carrier return by removing and
re-inserting regular returns only, so removing every regular return from a paragraph gives back exactly what was
typed. This matches the machine's behaviour that moved text is not re-adjusted, that LINE ADJ exists, and that a
carrier return has a name on the status line. `editor/layout.js` turns a line of codes into columns (tabs by
kind, indent levels, centring, zero-width codes) and is the single implementation used by the screen, by
pagination and by the print formatter.

**The menu tree is data** (`menus.js`), with rows and columns taken from the grids in SS 2:

```js
printDocument: {
  title: 'PRINT DOCUMENT', titleRow: 4, status: 'Print Document', finishedLine: true,
  cols: { id: 3, item: 7, choice: 39, possible: 53 },
  items: [
    { id: 'a', row: 8,  item: 'Print From Page',    key: 'from',     def: 0, kind: 'page',  possible: ['0 = First Page', ...] },
    { id: 'c', row: 12, item: 'Print Quantity',     key: 'quantity', def: 1, kind: 'int', min: 1, max: 99, possible: ['1 - 99'] },
    ...
  ],
},
typingTasks: { title: 'TYPING TASKS', titleRow: 4, items: [ { id: 'a', row: 8, item: 'Create Document', go: 'createDocument' }, ... ] },
```

`runMenu(sys, def, values)` draws it, runs the long and short forms, highlights changed choices, validates,
and returns the values or a cancel. Menus outside the core (Program Diskette, Merge, Feature, Key-To-Print) are
present as data whose items post a "not available" message.

### 7.4 Input

`sys.deviceEvent({ dev: 'kbd', ev: 'scan', byte })` goes to `keys.js`, which tracks SHIFT (either), LOCK, CODE
and CONTROL from their make and break bytes and produces:

```js
{ pos, name /* 'RETURN', 'DEL', 'a', ... */, ch /* character with the current shift, or null */,
  code, control, shift, repeat }
```

Repeats are honoured for the keys the service manual marks typematic: hyphen, BKSP, INDEX, RETURN, space and the
four cursor keys, plus LINE ADJ and the column-add keys that the reference guide calls repeat-action. Other
repeats are dropped, without a click. Every accepted key and honoured repeat calls `devices.kbd.click()`.

### 7.5 Output

```js
sys.screen = {
  chars: Uint8Array(2000), attrs: Uint8Array(2000),   // 4 KB, the size of the real display buffer
  cursor: { row, col, on }, version,                  // version increments on any change
  text(row?) -> string,                               // for tests and e2e
}
// attr bits: 1 underline, 2 reverse, 4 bright, 8 blink, 16 half index up, 32 half index down, 64 symbol font
```

`screen.js` owns the regions (status lines 1 and 2 with the field columns of SS 0, the scale line, rows 4 to 23,
prompt, message). `editor/view.js` draws the typing screen; `menu-runner.js` draws menus. Nothing else writes
cells.

### 7.6 Devices

The software sees one interface. `KitDevices` (in the kit) implements it over `sim.command` and
`sim.on('device')`; `VirtualDevices` implements it with `timing.js`.

```js
devices = {
  kbd:     { click(), tone(ms) },
  disk:    { transfer({ id, drive, side, track, sector, count, write }), recalibrate({ id, drive }), status(drive) },
  printer: { send(Uint16Array), credit, status },
  power:   { on },
}
// completions and unsolicited events arrive through sys.deviceEvent:
{ dev: 'disk', id, ok, error /* 'notReady' | 'seek' | 'crc' */ }      { dev: 'disk', ev: 'ready' | 'notReady', drive, mediaId, type }
{ dev: 'printer', ev: 'credit', n }   { dev: 'printer', ev: 'status', bits, code }   { dev: 'printer', ev: 'pageOut' }
{ dev: 'kbd', ev: 'scan', byte }      { dev: 'power', ev: 'on' | 'off' }
```

Sector bytes never cross to the mechanism. A transfer command carries the address; when it completes, the
software copies between its buffer and the image in `sys.library`.

### 7.7 From a document to the printer

Compare `src/terminal/driver.js`: that driver works keys and waits on the machine's state; this one sends
commands and waits on credit. Neither places ink.

1. `print/formatter.js` (pure) turns a page into device-resolution operations: characters with their escapes in
   1/240 in, indexes in 1/96 in. It applies margins, tabs by kind, centring, justification (spare space
   distributed alternately from the left and the right, SR 4.20), underline as an overstruck underscore with no
   escape, half index as a 1/2-line index up or down, headers, footers and page numbers.
2. `print/spooler.js` (a task) takes jobs from the queue, reads pages from the diskette, orders each line's
   operations left to right or right to left, whichever start is nearer the carrier, encodes them (6.5) and
   sends them as credit allows. It posts the operator messages (printer not ready, load paper, change the
   printwheel, printed) and handles Cancel on Error.
3. The printer controller does the rest.

Decisions made in implementation (M5), where the design left a choice open:

1. **Where things land.** Scale position p is struck p/pitch in right of the paper's left edge, which lies at logical 0
   (the left end of the writing line, where the sheet is aligned), so the default margin 18 at 12 pitch is 1.5 in.
   Line n is n - 1 lines below the top edge, so the default First Typing Line 7 is 1 in down (ORG p.180); after a
   load the print line stands at the top edge. M6 lays the sheet and stops the load to match.
2. **Line heights** for Lines/in 1 to 5 are 18, 16, 12, 4 and 19/96 in (5.08 an inch rounded); Line Spacing
   multiplies them, rounded; a half index is half the line height. Escapement is 24, 20 and 16/240 in at 10, 12 and
   15 pitch; proportional typestyles print at 20, as the screen shows them at 12 pitch (TB2 p.161).
3. **Justification** spreads whole positions, only on lines that wrapped (a regular carrier return ends them), only over
   the blanks after the line's last tab or centre code; the odd positions go from the left on one justified line and
   from the right on the next, the alternation running on through a job. Half-Justify takes half, rounded down.
4. **Second strikes.** Underline and overstrike characters follow their character with no escape; a continuous
   underline also runs under the blanks and tabs between underlined text (stretched ones included), not under
   trailing blanks. A Substitute code prints `_`, a syllable hyphen only on the line it ends, and Stop and Switch
   codes print nothing (the print-time pause is in WSPG, not our sources).
5. **Direction**: each line starts from whichever end is nearer the last strike; half indexes are index moves inside
   the line; a line on more than one printwheel is printed once per typestyle.
6. **Printwheel.** Before the first line that needs a typestyle other than the last one confirmed (none at
   start-up), and once the printer has taken everything sent, `Put on printer element (086 001)` (typestyle and
   keyboard number, TB2 p.553) is posted. START on the printer (the attachment reports it as a status with
   `key: 'start'`) or REQST e answers it; errors meanwhile (the cover opened for the change) are part of it.
7. **A sheet** is: PAPER load (Automatic Feed) and wait for the paper event; a load that finds no paper, and every
   sheet with Manual Feed, posts `Load paper in printer; press LOAD.` and waits for the operator's LOAD. Then
   RESTORE, the lines, PAPER eject. Continuous Paper indexes on to the next form by the Paper or Envelope Size (Other
   counts as letter). END OF DATA closes a job, and its `done` posts `(name) printed.`
8. **Credit** starts at the FIFO depth (`devices.printer.credit`, 32), each send spends it and `credit` events return
   it; it is reset when the printer is switched on or its queue is cleared from the panel.
9. **Errors**: a stopping error is posted (the cover with its own wording). With Cancel on Error Yes the job ends at
   once and its sheet is ejected after the printer has printed what it holds; otherwise printing goes on after
   START from where it stopped. Errors 55 and 45 are the printer's own retries and are not shown.
10. **Pages.** A Print Document job reads each page from the diskette when it reaches it; a missing diskette is asked
    for on the message line, since the operator may be in another task. The document open in the typing area cannot
    be queued by Print Document (`already in use`). A PRINT-key job carries a copy of each page, so END never waits
    for printing (TB2 p.160 says it may) and later stores cannot take sectors from under the spooler. A document's
    PRINT pages gather in one job, up to 25, while it is queued or printing; PRINT on the last page makes a new page.
11. **Request tasks**: the print queue display and Change Printing Order share a layout of our own (title centred on
    row 4, `#` and the footnote as ORG p.134); a chosen job goes next after the one printing. Request and Release
    Printer and Start Printer (shared printers) stay "not available". Print Index of Diskette Contents prints the
    fixed form of ORG p.494, twelve documents a page, and is refused while anything is queued ("ignored if the
    printer is busy").
12. **The virtual printer** (`devices/virtual-printer.js`) takes the same commands and reports the same events as the
    controller: 1440 steps/s on the move and at least 14 ms a character (60 cps at 10 pitch), other moves at 3000
    steps/s ramped at 40 000, an index ramped from 250 to 400 steps/s (16 steps in 53 ms), a cam move 0.3 s, 15 s to
    test itself after power-on. In the browser it stays switched off until the printer is on the desk (M6), so a job
    queues and asks for it.

### 7.8 Scope

In scope: start-up and program load; TASK SELECTION; Typing Tasks (create, revise, paginate, index, print);
the typing screen with every function in SR 4.1 to 4.19, 4.22, 4.23, 4.25, 4.27 to 4.29; format menus (SR 7.1
to 7.7); Work Diskette Tasks a to i; Request Tasks; Menu Bypass; Spelling Tasks (last milestone). Present as
menus only: Program Diskette Tasks other than Work Station Description, Feature, Key-To-Print, Merge, math,
column layout, final-form documents, alternate tasks.

### 7.9 Decisions made in implementation

Choices the research and this document left open, made while building M1 to M3, with the page they rest on.

| Where | Decision | Source |
|---|---|---|
| Clicks | A task names the keys it accepts. A key it does not accept (a cursor key in a menu, say) is dropped with no click, so "accepted" in HW 2.3 is decided where the key is used, not when it arrives | HW 2.3; 13.3 (no click for invalid keys); ORG p.32 |
| LOCK | A shift lock: it shifts every key, digits included, until either SHIFT releases it | HW 2.2, 2.6 |
| Attributes | The prompt line is bright. Changed YOUR CHOICE values, an item chosen ahead (TYPING TASKS after END) and selections are reverse video | HW 1.6 (reverse for selected menu items); ORG p.33 |
| Message line | The waiting-message indicator is `==>`, blinking, in columns 1 to 3 of row 25; a shown message starts in column 5 | SR 1 (`==>`); TB1 p.13 (bottom left) |
| TASK SELECTION | Title on row 3, items packed into rows 4 to 23 as the SS 2.1 grid | SS 2.1, ORG p.233 |
| Program segments | One task-family segment (typing, work diskette, spelling) in memory at a time beside the nucleus. While one loads, TASK SELECTION stays up with the chosen task highlighted | TB2 p.68, p.74; 8.2 |
| Program-diskette prompt | `Insert desired program or feature diskette; press ENTER`, the nearest attested wording | TB2 p.610; SS 1 item 7 |
| Power-on test | 05 at 3 s, 06 at 4 s, 09 at 7 s, `*11*` and the initials at 10 s ("a few seconds" each) | TP4 p.1 |
| Re-IPL | CONTROL+RET then ENTER on TASK SELECTION; the initials return after 3 s ("a few seconds") | ORG p.59 |
| Index entries | 124 bytes, two per sector: a chain sector's 4-byte header leaves 252 bytes, so 8.2's 128-byte entries do not fit two to a sector | 8.2 |
| Logical sectors | Both sides of a track before the next track, so one seek serves 52 sectors of a 2D diskette. The program load then takes 8.8 s from the lever closing | 8.1; SS 1 (about 10 s) |
| Drive | The head unloads after 2 s with no command; spin-up to ready 0.5 s | 8.4 (head load assumed); 12.1 (ready under 0.6 s) |
| Right margin | A word moves down when its last character would stand past the right margin (90). The E2 grid's third line has 74 characters, one past it, so the E2 fixture differs from the grid in rows 6 to 8 | SR 4.1 ("would pass the right margin"); SS E2 |
| Name prompts | The diskette-name prompt always follows the document-name prompt, suggesting the last diskette used (blank at first), even with one work diskette in place; the last document is suggested on every document-name prompt, Create included | SS E2, E3; TB1 p.12 |
| End of page | The Page End that closes a page always shows `▲` and is not named in field E | SS 3.1 (E blank on entry); TB1 p.10 |
| Regular return | CODE+RET gives a regular carrier return, which adjusting moves like a wrap return: with Adjust Line Endings Yes it is adjusted away; it stands where adjusting is off | SR 4.2 |
| BKSP | Does nothing at the start of a line, so it never joins lines | ORG p.258 ("ignored at the left margin") |
| Non-Typing Area | Up and down keep the cursor's column, past a short line's end if need be; characters typed there are dropped with no click | ORG p.560 |
| Pages and the cursor | Down from the last line shows the next page, up from the first line the previous page's last line | 13.3; SR 4.7 (SCREEN UP to the previous page) |
| Page numbers | A page made by PAGE END at the end of a document is the next whole number; one made inside it is n.1, then n.1.1 | ORG p.489, 490 |
| Storing | Page and head chains are written and marked in the free map before the index entry is rewritten; the entry write is the commit | 8.2 |
| Diskette out | A volume whose diskette is taken out is detached; END then reports `Error on Diskette` and leaves the typing area with the document still marked open | TB1 p.11; ORG p.132, p.497 |
| Erase or Initialize | A blank diskette is initialized: every data track written (about 37 s on 2D), then `Type new diskette name; press ENTER.` (ours). A named one is erased (label, map, index) and keeps its name. The second ENTER of E12 answers `Contents of diskette will be erased. Press ENTER to continue or press CANCL.` (ours) | TP4 p.2, 3; SS E12 |
| Index display | 15 documents a screen; the arrow keys page a screen at a time; names cut to 18 characters as the grid's columns allow | SS 2.8; ORG p.132 |
| Completion messages | Work diskette completions are posted to the message queue (indicator and long beep), like the other completion messages | TB1 p.13 |
| Suggested names | The first character typed replaces a suggestion; BKSP edits it; CANCL clears it. The scripts type names over suggestions | SS E3, E9; TB1 p.12, 13 |
| Selecting by typing | Typed characters build a string, and the highlight runs through its first occurrence after where typing began; when the string does not occur, the last character alone moves to its next occurrence, so each SPACE takes one more word | TB1 p.23; ORG p.352, 355 |
| Selecting by RET | RET extends to the next required line end, CODE+RET to the next line end of any kind | ORG p.354 |
| Selection and pages | A DEL, MOVE, COPY or OVERSTRIKE highlight stays on its page; at "To where?" the cursor may go to another page, by GO TO too | ORG p.355; TB2 p.117 |
| Page End in a deletion | Deleting the Page End that closes a page joins the next page onto it; the document's last Page End stays | ORG p.489 |
| E6 blank line | The blank line's code reads `Req'd Carrier Ret`: with the default Non-Coded setting RET gives a required return. SS writes `Carrier Return` | ORG p.246, 505; SS E6 |
| FIND | From the unit after the cursor through the following pages. The argument is what the keys give; CHG FMT matches any format change, INSTR any keep, OVERSTRIKE any overstrike code. No match: the cursor stays, a short beep, `Not found.` (ours) | ORG p.380 to 382; 13.3 |
| GLOBAL | From the cursor to the end of the document. Automatic reports "phrases found", Prompted "phrases changed", as ORG has it (TB2 p.135 differs). A word is letters, digits and apostrophes. A replacement re-adjusts its paragraph | ORG p.388 to 393 |
| GO TO | ENTER alone on the last page stays there; a page that does not exist goes to the last Page End | ORG p.393, 394 |
| Format change codes | One code per CHG FMT, holding every value changed; its name follows what it changes (page, typestyle only, line). ENTER on it reviews and rewrites it. A change re-adjusts the rest of its page | ORG p.303, 384, 385, 559 |
| CHG FMT within a line | A FORMAT SELECTION with Typestyle Number (same pitch only) and Return Typestyle; its layout is ours | SR 4.13 |
| Menus with no choices | ENTER on an empty prompt leaves a menu that shows "When finished with this menu, press ENTER." (FORMAT SELECTION) | SS 2.4 |
| Overstrike | The highlighted characters show as the overstrike character | ORG p.484 ("sometimes only the overstriking character shows") |
| Pagination | The document from the chosen page is one stream: adjusted, then cut so each page fits between the First and Last Typing Lines; a Required Page End ends a page; a keep moves whole to the next page. With Exact Line Count No, a paragraph's last line is kept on its page (one line past the Last Typing Line) and its first line is not left alone at a page foot. Adjust Page Endings No keeps the pages and adjusts within them. All pages are renumbered with whole numbers | ORG p.210, 211, 490, 491; ORG p.175 |
| Menu Bypass | `create` and `revise` go to CREATE OR REVISE DOCUMENT (ORG), not straight to the typing area (TB1 p.42). The diskette is taken without asking when one work diskette is in place. Format items act only where allowed: margins, line format and return line format at a line start; page format, header and footer, return all, begin using document or alternate format at the page start. Not over TASK SELECTION or the program diskette tasks | ORG p.445 to 448 |
| Duplicate and Condense Diskette | The receiving diskette must be named and keeps its name. Condense erases it, then writes the documents in creation order, so they lie unfragmented | ORG p.118, 135; SR 9 |
| Recover Documents | Each document left open is named, ENTER recovers it; a page that cannot be read becomes a Substitute code; the free map is rebuilt from what the index reaches | ORG p.218, 219, 497 |
| REQST | Not over the program diskette tasks | ORG p.501 |
| Word list (M8) | 12dicts `3of6all` and `2of12`, public domain, 72 499 words, 114 KB packed (docs/assets.md). All-capital abbreviations are left out, so FIFO and ABC are unknown, as E10 has them | SS E10 |
| Loading the dictionary | The list is fetched when the spelling segment first loads (`options.wordList`, a function; the kit calls `sys.provideWordList`) and kept for the session; the segment's load waits for it. With no list, Spelling Tasks still comes up and Check Document answers `Spelling dictionary not available.` (ours) | 12.3 |
| Dictionary on the diskette | A 512-sector `dictionary` entry beside the segments on the program diskette. Checking a page reads the sectors that hold its words, in runs; a hyphenation decision reads its word's sector. The spelling segment loads in about 2.8 s | 8.2 |
| Lookup | A lower-case entry also matches the word Capitalised or in CAPITALS, a capitalised entry (Monday) only those; `'s` and `s'` possessives by the base word. Words with digits are not checked; a hyphenated word is checked part by part; an apostrophe belongs to a word only between letters. Syllable hyphens, underline and half-index codes inside a word do not split it | ours |
| Suggestions | None: CHECK SPELLING OF WORD offers leave, remove and retype only | ORG p.110 |
| Prompted stops | ENTER takes the word as right for the rest of this check; SPELL leaves it marked, and later occurrences are marked without a stop; a retyped word replaces the old one (codes inside it are lost), re-adjusts its paragraph and is checked in its turn; END stops prompting and the rest is marked as Automatic marks it. "Words marked" counts marked occurrences | SS E10; TB2 p.70, 71 |
| Spelling marks | Two `smark` objects (`Spelling Mark Begin`, `Spelling Mark End`, a filled square, no column, not deleted by BKSP). The letters between show in reverse video; marks print nothing. A new check takes the marks off words now known and keeps them on words still unknown. CANCL in the typing area removes the pair around the cursored word; FIND then SPELL finds the next Begin mark and puts the cursor on the word's first letter | HW 1.6; SR 3.2, 4.9, 4.26 |
| CHECK SPELLING OF WORD | Shows the page in memory, so a word on one of a page's first two lines stands above the third text line (the grid shows the previous page's end there). Status A `Spell Check`, E `U.S. English`, C and L blank; no scale line; the retyped word on the prompt line | ORG p.110 |
| Order of a check | All the spelling stops of the chosen pages, then pagination with all the hyphenation stops, which is the order of E10's stops. The menu stays up, status `Spell Check`, between stops. Messages, posted: `(name) paginated`, then `Spelling Check complete. Words marked: n`. Then TASK SELECTION flashes and TYPING TASKS returns with Revise Document highlighted and its name prompt started; after SPELL, SPELLING TASKS likewise starts Check Document | TB2 p.69, 72; SR 4.26 |
| Pages checked | System Page Numbers blank: from HYPHENATE AND PAGINATE's item b on, or every page with Hyphenation/Pagination No; else the pages named, ten at most. Preserve Page Numbers Yes: no HYPHENATE AND PAGINATE menu, the check only | ORG p.108, p.211, p.517 |
| Print Paginated Pages | Yes queues the document with the Paper Handling chosen once it is paginated; other tasks are not held up (TB2 p.69 says they are) | TB2 p.69 |
| Hyphenation decisions | Asked about a word crossing the right margin when moving it down would end the line before the zone (right margin - Zone Width + 1). The cursor moves from the word's first character (down) to just past its last, punctuation counting (kept, past the margin); in between a syllable hyphen goes in before the cursor, or the line breaks after a hyphen already there. A point whose hyphen would pass the margin is refused with a short beep. END abandons the rest: those words go down | ORG p.395; TB2 p.579, 585 |
| Dictionary hyphenation | The list has no hyphen points, so they come from rules (vowel groups; consonants shared so the next syllable starts with an English onset; -ing, -ment, -ness, -less, -ful; two letters before a break, three after) applied to words the dictionary knows. The suggestion is the last point that fits. An unknown word, or one after End Spelling Check, has none: prompted, the cursor starts on its first character; automatic, it goes down | ORG p.167, p.402 |
| LINE ADJ | Adjusts from the cursored line to the paragraph's end, the lines above keeping their endings, and asks only about the cursored line. The typing program has no dictionary, so the cursor starts on the word's first character | SR 4.19; TB2 p.579 |
| Syllable hyphen | One that ends a line takes a column and shows as `-`, as it prints | ORG p.562 |
| Supplement | Kept in memory with the dictionary. Load Supplement adds a document's unknown words (500 words, 4500 characters at most); Store writes them to a `supplement` entry on the program diskette, read again when Spelling Tasks next loads with a fresh list; Create Document Of Supplemental Words writes one word to a line after `Press ENTER to continue or press CANCL.`. Their completion messages are posted | ORG p.305, p.345, p.425, p.521, p.527 |
| Not available | Choose Spelling Language Dictionary and the Language For Spelling Check instruction (one dictionary, U.S. English); GLOBAL with SPELL as its Search For | ORG p.393 |

---

## 8. Diskettes

### 8.1 Geometry and images

`disk/geometry.js` holds the documented formats (HW 3.6):

| | Diskette 1 | Diskette 2D |
|---|---|---|
| Sides, tracks | 1, 77 | 2, 77 |
| Track 00 | 26 x 128 bytes, the label track | Same |
| Data tracks 01 to 74 | 15 x 256 bytes | 26 x 256 bytes per side |
| Tracks 75, 76 | Spare | Spare |
| Data sectors | 1110 (284 160 bytes) | 3848 (985 088 bytes) |

`disk/image.js`: an image is `{ id, type, bytes: Uint8Array, version }` with every sector at its physical
address. A blank diskette is all zeros and reads as unformatted (`******` on the status line).

### 8.2 Our file layout

The machine's own format is not documented, so this is ours, inside the real geometry. Logical sector numbers
(LSN) run over tracks 01 to 74 in track order.

| Structure | Where | Contents |
|---|---|---|
| Volume label | Track 00, sector 1 | Signature, format version, name (6), kind (work, program), media type |
| Free map | LSN 0 onward, 1 bit per sector | Allocation |
| Index | A chain starting after the free map; 2 entries of 128 bytes per sector | Name (44), comment (44), type, flags (open, needs recovery), first LSN, sector count, length, creation order |
| Document head | First chain of a document | Formats, flags, and the page table: system page number and first LSN per page |
| Page | One chain per page | The page's code units and its object table |

Every sector of a chain starts with a 4-byte header (next LSN, bytes used). Chained allocation fragments with
use, which makes Condense Diskette do real work and makes seeks real. "Available" and "Unusable" on the index
screen come from the free map. A document is marked open when it is created or revised and closed by END;
a mount that finds it open shows `*` and Recover Documents rebuilds it from its last stored pages. A page is
stored when the operator leaves it, on PRINT, and on END. The index is displayed in creation order.

The program diskette's image is procedural: its index lists the program segments with their sizes, and reads
return zeros. Sizes are set so the documented waits come out of the drive (8.4): nucleus 180 KB, typing 60 KB,
work diskette tasks 40 KB, spelling 50 KB plus the dictionary. Its settings sector is real and persisted.

### 8.3 The drive as a mechanism

Per drive (`diskette-mech.js`): the lever (0 open, 90 degrees closed, a detent at each end); the diskette's
slide in the guide; the collet (kinematic from the lever through the actuator rod and flat spring); the AC motor
(capacitor-start induction model as `element1971`'s, 1800 rpm) and belt to the hub; the diskette's own angle,
coupled to the hub by clamp friction, so it spins up in a few tenths of a second after the lever closes; the
head stepper (`Stepper2Phase`, 1.8 degrees per track, band to the carriage, a hard stop behind track 00); the
head-load solenoid, bail and arm.

The adapter (`diskette-ctl.js`): one step every 5 ms, 35 ms settle after the last, recalibrate as 77 reverse
steps against the stop, head load (40 ms assumed), then it waits for the wanted sector to arrive under the head
by the diskette's angle from the index pulse, transfers at the rotation rate, and retries three times. It
reports not ready when the index period leaves 162.5 to 170.9 ms or the lever opens. Both drives' motors run
whenever the station is powered.

Closing a lever with a diskette in place therefore gives, unscripted: clamp, spin-up, index pulses in range,
`ready`, then the software's label read, whose recalibrate at 200 steps per second is the documented buzz.

### 8.4 Timing model for tests

`devices/timing.js`, pure functions of the documented figures:

```
seek(n)        = 5 ms x n + 35 ms               recalibrate = 77 x 5 ms + 35 ms
headLoad       = 40 ms (assumed)                rotation    = 166.7 ms
latency(t, s)  = time from t until sector s reaches the head, from the angle at t
transfer(n)    = n x rotation / sectorsPerTrack
```

Targets that fix the free numbers: program load to TASK SELECTION 10 +/- 2 s (SS 1); a one-page document
stored in under 1.5 s. The mechanism is tested against this model (12.1).

### 8.5 Persistence

`disk/store.js` defines `{ load(id), save(id, bytes), list(), remove(id) }`. `IdbStore` (in the kit, not in
`src/wp/`) keeps one record per work diskette in IndexedDB database `wordproc1980`, version-stamped;
`MemoryStore` serves Node. An image is saved after each completed write, coalesced over 1 s, and on `pagehide`.
Which diskette is in which drive, the lever positions and the settings sector are saved alongside. The panel has
"Reset diskettes".

First run: the combined program diskette in the left drive; a work diskette named `WORK01` with three short
sample documents of our own text in the right; two blank diskettes in the holder.

A document that is open when the page is closed is, on the next visit, a document that needs recovery, exactly
as after a power cut; keystrokes since its page was last stored are lost. A `beforeunload` prompt appears while
a document is open.

### 8.6 Handling diskettes

Diskettes stand in a holder on the desk (`deskLayout.disketteHolder`). A diskette is in the holder, in the hand,
or in a slot guide.

- **By hand.** Drag a diskette from the holder; near an open slot it enters the guide and becomes the drive's
  `disketteSlide` DOF, pushed home against friction and an end stop. The lever is a rotary `dof` part. It cannot
  close on a half-inserted diskette (contact), and can close on an empty slot.
- **By click.** Clicking a diskette in the holder, or the lever of a loaded drive, runs an invisible scripted grab
  (`wp-hands.js`, no hand model) that does the same thing through the same contacts.

The kit tells the mechanism which diskette entered a guide (`{ dev: 'disk', op: 'media', drive, mediaId, type }`).
The label shows the diskette's name as handwriting and the media mark.

### 8.7 Decisions made in implementation (M7, headless)

Choices left open above, settled while building `diskette-mech.js`, `diskette-ctl.js` and their place in
`WordprocSim`. Parameters are in the definition's `diskettes` block; everything not in HW 3 is marked assumed there.

1. **Speed is an outcome of the motor.** The induction motor runs below its 1800 rpm, so the pulley ratio is not the
   synchronous 5:1 but 4.94:1, computed in the definition so the diskette turns at 360 rpm with the head loaded on a
   middle track. With the head lifted it runs 0.24 % fast; index periods stay within 0.6 ms of 166.7 ms.
2. **The collet grips by friction**, as a bristle that sticks up to mu N r and slips beyond it. The collet's travel is
   a cam on the lever angle that peaks at 80 degrees, so the flat spring (15.5 N closed) resists closing and then
   holds the lever closed; a bistable detent works at both ends. With no diskette the collet seats in the hub with the
   same force, so the lever feels the same. The collet grips from about 17 degrees, so the diskette is at the hub's
   speed before the lever switch makes; ready follows 0.29 s after the switch (two index pulses, one in-range period).
3. **Lever against diskette** is one contact in the lever's plane, resolved toward whichever went in less: a
   half-inserted diskette stops the lever at 30 degrees, a closed lever stops a diskette at the mouth or holds one
   home, and a diskette within the 1.5 mm of the tip's chamfer is pushed home. When the diskette is the one pushed,
   the reaction goes into the lever's pivot and is not modelled.
4. **The slide** sticks under its guide's 0.25 N of friction (and the collet's grip once clamped) and stops on an
   elastic end stop; let go after a hard push it springs off by under a millimetre. The collet centres a diskette
   within 3 mm of home.
5. **The read channel is the only data-side sensor.** At each sector boundary, with the head loaded and settled (pad
   in contact, arm under 2 mm/s), within 0.2 of a track centre and the diskette within 4 % of speed, the mechanism
   interrupts the adapter with the ID field: the physical track under the head and the sector now starting. Sectors
   are equal angles from the index hole, as the model has them. A transfer starts at the wanted sector's ID and ends
   at the ID after its last sector, so rotational latency and transfer time are the diskette's own turning.
6. **A misplaced head is found by its ID fields**: a track that does not match is a seek error, answered by a
   recalibrate and a retry, three retries at most (then `seek`). A sector not found within three turns is the same.
7. **Recalibrate steps back at least 77 times and ends on track 00's phase** (77 to 80 steps, 420 to 435 ms against
   the model's 420): the adapter knows the track modulo four from its own phase count, and the stop pin, 0.6 of a step
   behind track 00, lets the rotor buzz between the pin and track 1 until the last phase pulls it to track 00. After
   power-on the track is unknown and the first transfer recalibrates first, as `devices/virtual.js` does.
8. **The head loads after the settle**, not during the seek, as in the model. The arm is slowed by a dashpot so it
   does not bounce; it is readable 41 ms after the solenoid is switched on (40 ms assumed in `timing.js`). It lifts
   after 2 s idle. With the lever under 70 degrees the bail holds it lifted (HW 3.3).
9. **Not ready** comes at once from the lever switch (80 degrees), from an index period outside 162.5 to 170.9 ms,
   or from a missing pulse (a watchdog at 170.9 ms). It ends the operation in hand with `notReady`. A command to a drive
   that is not ready answers `notReady` after two turns, as the model does.
10. **The kit places a diskette at the mouth** (`op: 'media'`, slide depth 0) and takes one only from there; from then
    on it moves by forces. Which diskette it is (`mediaId`) is the host's knowledge, added to `ready` events and to
    `diskStatus(drive)`; the type comes from the media LED. Disk device events carry the time `t` they happened.
11. **Warm start**: `new WordprocSim({ drives: [media, media] })` puts the diskettes home with their levers closed and
    every speed at its running value, computed rather than settled. The spinning parts sleep once their speeds stop
    changing; anything that changes a load (lever, slide, head, arm, a parameter) wakes them. Two idle drives cost about
    9 ms of computation per simulated second in Node, half again the idle printer's. `cold` starts the motors from
    rest; they are at speed in 0.2 s.
12. **One adapter for both drives**, one operation at a time, queued in order; each drive has its own head-unload
    timer and ready line. The snapshot carries per drive `lever`, `slide` (-1 when empty), `clamp`, `diskOmega`,
    `diskAngle`, `headTrack`, `headLoad`, `motorOmega` and `diskReady`.

---

## 9. Display

### 9.1 Pipeline

```
sys.screen (chars, attrs, cursor)                       CPU, 4 KB
   -> gridTex   80 x 25 RG8, uploaded when version changes
fontTex  256 x 256 R8: two fonts of 256 glyphs, 8 x 16 each
   -> phosphor pass: one full-screen triangle into phosphorRT 1280 x 800 RG16F (2 x 2 samples per dot), mipmapped
        lit   = glyph dot at this position (attributes, cursor, blink phase, half-index shift) x 3-tap beam profile x video gain
        fast' = max(fast x exp(-dt / 30 ms), lit)        R
        slow' = max(slow x exp(-dt / 250 ms), lit)       G
   -> glass material on a curved mesh (a spherical cap, 24 x 16 segments, radius 0.60 m, in the bezel of wp_display.glb)
        MeshPhysicalMaterial (dark faceplate, roughness 0.32, so the room HDRI reflects softly) with onBeforeCompile:
        uv        = raster mapping of the surface point, shifted by view parallax through 8 mm of glass
        emission  = green x (0.8 fast + 0.2 slow) x row profile + raster level from the brightness knob
        halation  = textureLod(phosphorRT, uv, 4) x k1 + textureLod(phosphorRT, uv, 6) x k2
```

- **Raster**: 640 x 400 dots of 0.32 x 0.34 mm, 205 x 136 mm on a 245 x 170 mm glass (HW 1.4).
- **Attributes** (HW 1.6): underline is row D; the cursor is row E, with its cell brightened; reverse inverts the
  cell; bright scales gain; blink is 2.5 Hz at 50 % (rate assumed); half index shifts the glyph 3 dots.
- **Row structure** is analytic in the glass shader and fades to its mean as the row frequency on screen
  approaches one cycle per two pixels (from `fwidth`), so there is no moire at a distance. Mipmaps and
  anisotropic filtering handle oblique views.
- **Persistence**: phosphor type is not documented. The two-component decay gives the brief after-image the
  manual mentions. Refresh flicker is not modelled.
- **Bloom** is the in-shader halation from the target's own mips. A post-process bloom pass would cost every
  machine a millisecond and bloom everything else in the scene.
- **Knobs**: contrast scales the video gain; brightness raises the raster level, visible fully up (HW 1.4).
- **Spill**: one shadowless green spot light from the screen toward the keyboard, its intensity from the lit
  fraction of the buffer (a per-glyph coverage table summed on change). Dropped by the quality governor first.
- **Warm-up and switch-off**: `crtHeat` and `crtHV` are first-order states in `station-mech.js` (6 s and 0.3 s);
  the shader multiplies by them, and the persistence does the rest.

### 9.2 Font

Our own drawing, to the metrics of HW 1.5: capitals and digits 9 rows on rows 3 to B, x-height 6 rows,
descenders to row C, underscore on row D, cursor on row E. Source of truth: `tools/wp/font8x16.txt` (one glyph
per block of sixteen 8-character lines). `tools/wp/build_font.mjs` writes `src/wp/font/font8x16.js` (8 KB of
data, committed). Font 1 is text at Latin-1 positions; font 2 holds the code symbols of SR 5, the scale-line
marks, the status-line bars and the large initials of the start-up screen, drawn as block glyphs. A Node test checks the metrics.

### 9.3 Cost

| Step | Cost |
|---|---|
| Grid upload | 4 KB `texSubImage2D`, only on change (a few times a second while typing, never more than once a frame) |
| Phosphor pass | 1.0 M fragments, two fetches each, plus mip generation: about 0.4 ms on an integrated GPU. Skipped once the picture has been static for 1.5 s with nothing blinking |
| Glass | About ten fetches per covered pixel |
| Budget | 0.8 ms GPU and 0.1 ms CPU per frame at 1600 x 1000 on an Intel UHD 620 class GPU |

Fallback when half-float targets cannot be rendered to: RGBA8 with the two components in R and G and a dither.

### 9.4 Reading the screen

The "Screen" card (`src/ui/wp-screen-card.js`) sits in the insets where the typewriters show Print Point, and is
on by default, so the screen can be read whatever the camera shows (3.5). It draws the CRT's phosphor target
(`crt.texture`) flat on the main canvas into the card's rectangle after the frame, as `HeadView` does, through a
shader that shares the glass's tube uniforms: the same scan lines (fading to their mean where a line is under two
pixels), after-glow, halation from the target's mips, vignette, mains beat, grain, warm-up and switch-off spot, with
a slight barrel and a dark faceplate instead of the room's reflections, tone-mapped and encoded by itself. Its
header folds it; its corner resizes it, the height following the tube's shape (1.56:1) and never reaching down into
the panel; the **screen card** button in the panel hides it. All three are remembered
(`localStorage['typewriter.wp.screenCard']`). It replaces the plan of opening by itself when the raster on screen
was small: the owner asked for it always there.

---

## 10. Audio

### 10.1 Engine

`src/audio/wp-engine.js` exports `WpAudioEngine` with the public surface of `AudioEngine` (`process`, `publish`,
`onSnapshot`, `setTimeScale`, `setEnabled`, `setPaperSpeed`, `loadSamples`, `dspLoad`). It steps `WordprocSim`
the same way, reads `WP_PORT` forces and `WAC` events, and renders three buses with constant-power pan (printer
left, station and keyboard centre, diskette unit right) through the existing `Room` and `Limiter`. The worklet
writes left and right when the engine reports `stereo`. `Bank` from `modal.js` provides the resonant bodies.
`loadSamples` installs the recorded sprite `audio.samples` names (`samples_wp`, 10.4); with `alone` the client fetches
only that sprite, not the typewriters', and with `samples: false` none.

### 10.2 Voices (`src/audio/wp-synth.js`)

| Sound | Driven by | Synthesis |
|---|---|---|
| Key bottoming and return | `WAC.KEY_BOTTOM`, `WAC.KEY_TOP` with speed | Short plastic modes of cap and frame into a keyboard-case bank |
| Fly plate snap | `WAC.PLATE` with the plate's landing speed | A faint tick; this is the modules' own "audible" feedback |
| Click | The Click line | A 0.5 ms pulse through a small-speaker model: resonance 450 Hz, Q 2, cone break-up near 2.8 kHz |
| Beep | The Tone line | 1 kHz square, gated, through the same speaker |
| Station fan | `fanOmega` | Filtered noise scaled by speed squared, plus blade-pass partials |
| CRT | Nothing | No whine: the line frequency is not documented and is probably above hearing |
| Drive motors and belt | `motorOmega`, `diskOmega` | Rotor partials and twice-line hum as `ElementSynth`; jacket rub noise while clamped |
| Head steps | `WAC.STEP` per step, with rotor speed | Tick into a drive-chassis bank. At 200 steps per second the ticks are the buzz |
| Head load | Contact force on the bail | Clunk through the same bank |
| Lever and collet | Detent and clamp contact forces | Click |
| Hammer | `WP_PORT.HAMMER` force each sample | Commuted through a cover-and-frame bank plus a direct path; the three force groups sound different because the forces are |
| Selection | Phase torque ripple times speed; `WAC.SEAT` | Whir at the commutation rate into a carrier bank; a tick on seating |
| Carrier | Step-rate torque ripple; follower and shaft friction | A tone at the step rate (1440 Hz at 60 cps) and screw rumble |
| Line feed, paper keys | Index rotor and belt force | Short bursts |
| Ribbon feed, cam motor | Their rotor speeds and stop contacts | Tick; whirr and clunk |
| Printer fan | Fan speed | Filtered noise |
| Printer cover | `cover` | A low-pass and 6 dB on the printer bus; opening the cover brightens it |
| Paper | Soft-body speed, as now | The existing paper loops via `setPaperSpeed` if samples are present; otherwise filtered noise |

### 10.3 Decisions made in implementation (sound)

Choices left open above, settled while building `WpAudioEngine` (`src/audio/wp-engine.js`) and its voices
(`src/audio/wp-synth.js`). Levels are the `LEVEL` table there; every number in it is assumed, since there is no
recording and no dB figure (PR 10, HW 1.9).

1. **Capture, then render.** Each audio block first steps the mechanism, reading one probe frame per sample (21
   values: the port forces averaged over the sample's substeps, the motors' torques and the fast speeds), then renders
   the block from the frames. The voices' cost is then measured apart from the mechanism's (`voiceNs`, `mechNs`).
   Slow quantities (fan and motor speeds, power, the access cover) are read once a block.
2. **Voices key on forces, torques and speeds only.** Every onset the `WAC` queue marks is also a contact force in a
   port, so the queue is cleared each sample and nothing reads it. Nothing in the audio code knows a command.
3. **A structure rings from the change in the force on it.** Each modal body (petal, platen, carrier, frame,
   cabinet; drive chassis, lever) is driven by the per-sample change of the contact forces and of the motors' reaction
   torques (over a 20 mm mounting radius) acting on it; the petal face's force, which is zero at rest, drives the
   platen and petal directly. A steady load is silent, and with nothing moving every body sleeps.
4. **Motor tones are not synthesised; they emerge.** The steppers keep their electromagnetic torque from the last
   substep (`Stepper2Phase.Te`, `StepperVR3.Te`, read only by the sound). Its ripple rings the body each motor is
   bolted to, so the carrier whines at its step rate (1440 Hz at 60 cps, about 20 dB over its neighbours), a line feed
   buzzes at 400 steps per second, seeks tick at 200 per second and a recalibrate buzzes against the stop.
5. **The hard click is the hammer's nose catching the petal**, about 1.3 ms before the face meets the paper (a stiff
   contact, `WP_PORT.ARMATURE` with the armature forward). The face on ribbon, paper and rubber lasts 0.45 to 0.9 ms
   and is the thud under it; the sound of that contact starts within a millisecond of the strike event's `tBegin`
   (tested). The armature landing on its backstop is the same port with the armature home, voiced at a third as a
   faced stop.
6. **The step motors sit in resilient grommets** (a first-order high pass at 800 Hz on the escapement motor's
   reaction): without it the torque of each start and stop outweighed the strikes when printing slowly.
7. **The printer's enclosure**: the mechanism's sound reaches the room through the covers (a two-pole low pass at
   1.6 kHz, 7 kHz and +6 dB with the access cover open), the paper slot's perforated filter (0.15 of it, low passed at
   6 kHz) and, below the shock mounts' 300 Hz, the covers' own modes. The fan blows through its grille outside all of
   that. The wheel's petal-pass whir (96 per turn, 3 to 7 kHz) is therefore faint, as the acoustic filter intends.
8. **Air and rotors**: fans and drive pulleys give band-passed noise at amplitude (speed / synchronous speed)^2.5 and a
   blade-pass partial (blades: printer 5, station 7, assumed); the drive motors add 1x and 2x rotor partials and a
   24-bar slot harmonic, and hum at 120 Hz (twice the 60 Hz line, with its 240 Hz partial) in proportion to their
   stator current, which rises with slip; a clamped diskette rubs its liner, more with the pad loaded. All the mains hum
   shares one oscillator, so the units' hums are in phase as on one line.
9. **Stereo**: each bus is panned by its unit's bearing from the operator's chair (`cameras.operator`), full at 45
   degrees: printer -0.83, station 0, diskettes +0.61, constant power. The room is fed the mid and its reverberation
   added to both sides; a radiation filter on each side; a linked stereo limiter with a 0.5 ms look-ahead (the
   typewriters' 1.5 ms would delay a strike past a millisecond). The worklet writes left and right when the engine has
   `stereo`; the typewriters' engines do not, and stay mono on both channels. A mono caller gets the mid.
10. **The station is a mechanism now** (`src/sim/wp/station-mech.js`): its power and the power supply's fan, a shaded-pole
    motor on the line integrated against air drag (about 3000 rpm), in the snapshot as `power` and `fanOmega`. The warm
    start computes its running speed, and the printer fan's. `{ dev: 'station', op: 'power', on }` (or
    `setStationPower`) switches it, and the diskette motors with it; the rocker DOF arrives with the station's view.
11. **No CRT whine by default** (10.2): `machine.audio.crtWhine`, a level factor, enables a faint 15.72 kHz line
    whistle while the station is powered. Revised in 10.4: on, at 15.03 kHz, as measured.
12. **Rendering is skipped** while the output is null or audio is disabled (`LocalHost` before the first gesture); the
    mechanism runs as before, and the voices start again from the present state, without a jump.
13. **Budget**: the voices may take 1 microsecond a sample (5 % of a 48 kHz sample period; 12.2 allows a load of 0.35
    while printing and the mechanism alone takes about 0.2 in Node). Measured in Node with a line printing, a line feed
    and a transfer at once: 0.45 to 0.6 microseconds (rendering, plus 0.03 for reading the mechanism); idle about 0.2.
14. **Not voiced here**: the keyboard (its speaker stays on the main thread, `wp-speaker.js`; its keys are voiced
    there too, 10.4), paper sliding (`setPaperSpeed` is a no-op), the power rockers and the ribbon knob.

### 10.4 Decisions made with the owner's recordings (sound)

The owner supplied two recordings (`public/assets/audio/SOURCES.md`): a running Displaywriter, from a video of the
machine with its printer, and typing on an IBM beam spring keyboard. `tools/audio/cut_wp_samples.py` finds and classifies
the events in both (its docstring lists them with their times), cuts them, takes the noise of the room and the running
machine out of the cuts by static spectral subtraction, and writes two sprites with manifests; the level ratios it
measures are in `tools/audio/wp_levels.json`. Each manifest item carries `scale`, the source amplitude of one unit of
the sprite, so a cut played at its `scale` keeps its recorded level.

1. **What the recordings hold.** The Displaywriter recording (197 s): the machine off until 52 s (handling, speech;
   unused); power on at 52.0 (100 Hz hum: a 50 Hz line); a 15.03 kHz line from 60.7 s (the display's deflection);
   murmured speech to 93 s; from 93.9 s the machine alone: program load (a first long access at 93.9, single steps
   0.3 to 0.7 s apart from 96.4 to 105.9, sharp head-load clacks at 99.5, 104.6 and 106.4, seeks of 100 to 480 ms to
   117.2), idle, keystrokes from 128.5 with the speaker's beep at 160.1 (960 Hz, 0.2 s), eleven seeks of about 250 ms
   from 172.4 to 178.6, idle 184 to 190.5. No printing anywhere (no train of strikes), and no lever, insertion or
   recalibrate against the stop that could be told apart. The beam spring recording (240 s): six finger snaps to
   3.8 s (unused), then fast typing, about 17 key sounds a second, in a reverberant room.
2. **The sprites.** `samples_wp` (117 KB, 14.4 s, Opus 64 kbps mono): 16 single steps, 3 head loads, 19 seek bodies
   (the run of each buzz, within 10 dB of its loudest), and two 4 s loops of the idle machine (118.6 s) split at
   450 Hz: `bed_motor` (the twice-line hum and the drive motors' tones) and `bed_fan` (the air). `samples_wpkeys`
   (74 KB, 6.5 s): 16 presses and 16 releases of the alphanumeric keys, 8 and 8 of the wide keys and of the space bar.
   A press is a key sound louder than the median of its neighbours within 1.5 s, a release one quieter; the space bar
   and wide keys are the presses (and releases) with the most low-frequency body (the top 15 % and the next 15 %).
   This is a classification by sound, not an identification of keys.
3. **Triggers, all from the mechanism** (`src/audio/wp-sampler.js` in the worklet). A head stepper's rotor crossing a
   track: a step with none in the 20 ms before it plays a single step's ring; a later one plays a 12 ms Hann grain from
   anywhere in a recorded seek body, so at the drive's 5 ms step time the grains overlap into the recorded buzz, and a
   seek of any length sounds like the recorded ones. The level follows the rotor's speed at the crossing. The pad
   landing (`WAC.HEAD_LAND`, the arm's speed) plays a head-load clack; the pad lifting the same at 0.35. So 10.3 item 2
   no longer holds for the recordings: the sampler reads the `WAC` queue before the engine clears it.
4. **The hums run while powered**: `bed_motor` at the mean of the two drive motors' (speed / running speed)^2, a
   quarter of that with the power off (the hum stops with the line; the rotors' tones run down); `bed_fan` at
   (station fan speed / running speed)^2.5. The recorded line was 50 Hz and this machine's is `station.mainsHz` (60), so
   `bed_motor` plays at 1.2 times its rate: the hum at 120 Hz, the motors' tones up with their speed. While the sprite
   is loaded the synthesised station fan, drive motors, drive air and head load are off and the step and stop-pin
   couplings scaled (`REPLACED`, `SCALED`); the printer, its fan, the levers, collet, diskette slide and the jacket's rub
   stay synthesised. The recorded sounds join after the synthetic room and radiation filter, since they carry their own.
5. **The keyboard on the main thread.** Its mechanism and scanner already run there (`KeyboardHost`), driven by the
   real keyboard's events; moving them to the audio thread would route every finger and scan byte through the worklet
   and back. So the keyboard's mechanism queues its own acoustic events (`KeyboardMech.sound`: a stem meeting its felt,
   with its speed, and coming home on its top stop), the host hands them out with their mechanism time, and
   `src/audio/wp-keys.js` plays the cuts through Web Audio on the worklet's `AudioContext`, each scheduled a fixed 10 ms
   after the frame plus its offset into the frame, so presses and releases keep their spacing. A felt rebound within 30 ms
   is part of the press. Each key keeps three cuts of its set, in turn, with 10 % level and 1.5 % rate variation; level
   goes with (speed / 1.29 m/s)^0.8 for a press, (speed / 1 m/s)^0.6 for a release.
6. **Levels.** One gain for each sprite. The worklet sets the idle machine's mid at -50 dBFS (the synthesis's assumed
   idle), and every cut plays at its recorded scale times that gain, so the recording's balance holds. Targets, in dB
   over the idle machine's RMS, as measured in the recording and in `tests/wp_audio.test.js` (tolerance):

   | Sound | Recorded | Measured in Node | Test |
   |---|---|---|---|
   | Seek, RMS | +12.4 | +13.1 | 3 dB |
   | Single step, peak | +17.2 | +15.9 | 4 dB |
   | Head load, peak | +17.3 | +19.3 | 4 dB |
   | Recalibrate, RMS (from the first access at 93.9 s) | +15 | +14.5 | |
   | Key press, peak (median) | +26.3 | +26.3 | 2 dB |
   | Key release, peak | +15.3 | +21 (the beam spring recording's own 5 dB under a press) | |
   | Beep, RMS | +17.5 | set by `WpSpeaker` (out 0.072) | |
   | Display line whistle, RMS | -18.0 | `audio.crtWhine` 14 | |
   | Printer strike, peak | none recorded | +31.5 (assumed level kept) | 28 to 38 dB |

   A strike stands about 19 dB over a seek, and a key press about 14 dB over a seek.
7. **The speaker** (`wp-speaker.js`): the beep is a 960 Hz square wave, as measured (the manual's 1 kHz is nominal);
   the cone's resonance moves to 2.9 kHz (+4 dB) with a dip at 4.8 kHz (-20 dB), fitted to the recorded beep's third
   and fifth harmonics; its output is set for the beep's recorded level; the short beep lasts 200 ms, as the one beep
   in the recording does (`TONE_MS` in `src/wp/index.js`; the long beep's 400 ms stays assumed).
8. **The display's line whistle** is on (decision 11 above revised): 15.03 kHz, 18 dB under the idle machine.
9. **Cost**: with the sprite loaded, printing, a line feed and a transfer at once, the voices take about 0.6 to 0.7
   microseconds a sample in Node (the sampler adds about 0.05); within 13's budget.
10. **Left open.** The printer has no recording: strikes, carrier, selection, line feed, paper handling, the cover and
   the printer fan stay synthesised, at the levels assumed in 10.3. A recording of the 5218 printing would replace them
   the same way. The lever, the diskette's insertion and a recalibrate against the stop pin are not in the recording.
   The press and release split, and the key classes, are by level and spectrum; a recording of single keys, the space
   bar and the wide keys pressed slowly would make them exact. The power rocker's clack (52.0 s) is recorded but the
   rocker is not yet a mechanism, so it is not played.

---

## 11. Plan

### 11.1 What changes from `plan.md`

| Plan | Now | Why |
|---|---|---|
| Printer as `src/sim/printwheel-action.js` behind the `Action` interface | A separate mechanism host, `src/sim/wp/`, with the same client contract and strike event | 4.1 |
| Keyboard as `src/sim` key DOFs "as now", buckling spring, timed finger press from the real keyboard | Its own stems and fly plates in the host; a real key is a held finger | The research found fly plates; make/break keys and typematic need the hold |
| Diskette timing model in `src/wp/diskette.js` plus DOFs for door and latch | Data in `src/wp/disk/`, motion in `src/sim/wp/diskette-mech.js`, the timing model only for Node | No doors; the browser's timing must come from the mechanism |
| `src/render/crt.js` with bloom | `src/render/wp/crt.js`, halation in the glass shader, no bloom pass | 9.1 |
| `src/audio/wp-synth.js` | Plus `wp-engine.js` | The existing engine is built around typebars and samples |
| Phases: research, editor, CRT and keyboard, printer, diskette unit, polish | Milestones M0 to M8 below | A scaffolding step first; storage with the editor; the printer proven headless before it is drawn |
| Under 5 MB added per visit | Under 2 MB, and nothing added to a typewriter visit | 12.3 |
| Program diskettes Vol. 01 to 03 implied | One combined program diskette | Decision 10 |

The owner's decisions (25 x 80 display, daisywheel printer, Textpack 4, the desk arrangement, ashtray on the
machine, no lamp, cables out the back) all stand. The desk does not need widening.

### 11.2 Milestones

Each one ends with the listed tests green, all existing tests green, and something that can ship.

| M | Deliverable | Tests | Ships as |
|---|---|---|---|
| **M0 Scaffolding** | Kits; `KITS` and `geometryFor`; `desk-layout.js`; multi-rectangle desk shade; `fitShadow`; `flyTo`; `host-factory.js`; the definition with units and layout; grey block-out bodies. The machine is listed only with `?wp` | Existing unit and e2e tests unchanged; `wp_layout.test.js` (no overlap, inside the desk field, cable lengths) | No visible change |
| **M1 Software kernel** | `sched`, `screen`, `charset`, `keys`, `rom`, `menu-runner`, `messages`, TASK SELECTION and TYPING TASKS, `VirtualDevices`, `testkit` | E1; menu runner (long and short form, the four CANCL levels, type-ahead); key decoding and typematic | Node only |
| **M2 Storage and typing** | `disk/*`; create and revise; the typing screen; insert and replace; wrap and adjust; returns, tabs, required codes; cursor, scrolling, segmenting; END; index display; work diskette tasks a to d and g | E2, E12; file system (capacity, fragmentation, recovery flag); buffer and layout units | Node only |
| **M3 Editing** | DEL, MOVE, COPY, OVERSTRIKE, FIND, GLOBAL, GO TO, GET; format menus and format codes; display codes; underline, centre, half index; pagination; Menu Bypass; remaining work diskette tasks | E5 to E9, E11, E13 | Node only |
| **M4 On the desk** | Font; CRT; station, display and keyboard models and views; key mechanism, scanner, click and beep; station fan; `KitDevices` with virtual diskette and printer devices; IndexedDB; real-keyboard map; "Screen" card. Picker entry on | `wp_keyboard.test.js`; font metrics; `e2e/wp.mjs` (boot warm, type, screen text and pixels, persistence across reload) | **First public version**: a working editor on a CRT with a mechanical keyboard. Printing queues and asks for a printer |
| **M5 Printer, headless** | `stepper.js`, `printer-mech.js`, `printer-ctl.js`, the calibration tool, `glyphs_wp`, formatter, spooler | `wp_printer.test.js` (6.6 item 3 and 12.1); formatter units; E3, E4 against the virtual printer | Node only |
| **M6 Printer on the desk** | Printer model and view; `SoftWorld` with `origin`; film ribbon; load, eject, pile; panel keys, LEDs and display; cover; Print Point window; printer sound; sheet feeder | e2e: print a two-line document, count strikes, ink where expected, one page in the pile, PDF export | Printing |
| **M7 Diskette unit** | `diskette-mech.js`, `diskette-ctl.js` replacing the virtual disk in the browser; model; levers, insertion, holder; drive sound | `wp_disk.test.js`; e2e: remove and insert the work diskette, open a document | Diskettes are physical |
| **M8 Finish** | Cold start and self-test; CRT warm-up; errors (no diskette, lever opened mid-write, cover open, out of paper, end of ribbon); Spelling Tasks with the dictionary (E10); `docs/ARCHITECTURE.md` and `docs/assets.md` sections; budget audit | E10; error paths; size and frame-time checks in e2e | Complete |

M5 can run in parallel with M3 and M4; it depends only on M0.

**Progress.** M0 done (2026-11-11). One deviation from 3.3: `src/kits/typewriter.js` holds the whole of the old
`main()`, including the stage, desk, room, loop and governor, and `src/main.js` is only the chooser and kit loader.
The shared parts move up into `main.js` in M4, when the word-processor kit needs them, so the boundary is drawn
from real use. `src/kits/wordproc.js` builds its own stage, desk and orbit for now. `host-factory.js` has no
word-processor host yet and throws for it; the kit does not create a mechanism until M4.

M1 done (2026-11-11): the software kernel in `src/wp/` (scheduler, screen, keys, start-up, menus as data and the
menu runner, messages, virtual devices, the diskette layout the program load needs, testkit), tested by
`tests/wp_kernel.test.js`. Decisions taken while building are listed in 7.9.

M2 done (2026-11-11): diskette layout and file system, create and revise, the typing screen with insert and
replace, adjust, returns, tabs and required codes, cursor, scrolling, segmenting, page ends, END, the index display
and Work Diskette Tasks a to d and g. Tests: `wp_editor` (E2, E12), `wp_typing`, `wp_fs`, `wp_buffer`, `wp_workdisk`.

M3 done (2026-11-11): DEL, MOVE, COPY, OVERSTRIKE, FIND, GLOBAL, GO TO, GET; the format menus (FORMAT SELECTION and
its variants, LINE FORMAT, MARGINS AND TABS, PAGE FORMAT, HEADER AND FOOTER values) and format change codes;
SCREEN FORMAT; INSTR keeps; pagination; Menu Bypass; Work Diskette Tasks e, f and h. Tests: `wp_editor` (E5 to E9,
E11, E13), `wp_functions`. Not done in M3: header and footer text (its two menu items answer "not available"),
the LINE ADJ hyphenation prompt (it comes with dictionary hyphenation in M8), END cancelling a pagination under
way, KYB CHG (one keyboard only). Print and Spell answer "not available" until M5 and M8.

M5 headless printer done (2026-11-11): `stepper.js`, `printer-mech.js`, `printer-ctl.js`, the `WordprocSim` host
with its layout, ports and inputs, registration in `host-factory.js`, `glyphs_wp`, the definition's printer block,
the calibration tool, and `tests/wp_printer.test.js`. Decisions are listed in 6.8. Not done in M5, because they
depend on the editor being built in parallel: the formatter, the spooler and E3, E4 against the virtual printer.

M5 printing software done (2026-11-11): `print/formatter.js`, `print/spooler.js`, `tasks/print.js` (Print Document,
the PRINT key, the queue display, Change Printing Order, Continue Printing, Print Index of Diskette Contents), the
virtual printer, and the Menu Bypass entries for them. Tests: `wp_print` (formatter units, encoding, spooler, E3, E4)
and `wp_print_mech` (the spooler driving the headless mechanism; under half a second). Decisions are listed at the end
of 7.7. Not done: header and footer text and page numbers (no header text exists yet, M3), proportional spacing,
blocking Duplicate, Condense and Change Diskette Name while a job prints (ORG p.98, p.118), dropping the queue on a
re-IPL, the shared-printer requests, and the kit's link to the mechanism (M6).

M7 headless diskette unit done (2026-11-11): `diskette-mech.js` (motor, belt, hub, collet, diskette, lever, slide, head
stepper and stop, head-load arm, index sensor, read channel) and `diskette-ctl.js` (step timing, settle, recalibrate,
head load and unload, sector search, retries, ready and not ready) for both drives in `WordprocSim`, with the
`diskettes` block in the definition, the snapshot fields, the `lever` and `disketteSlide` DOFs and the disk device
commands and events. Tests: `tests/wp_disk.test.js` (insertion and the lever, ready after spin-up, 20 transfers within
4 ms of the analytic model, recalibrate against the stop, not ready mid-transfer, no controller writing a mechanical
state, export and import). Decisions are listed in 8.7. Not done, because they need the browser: `KitDevices` over
the host's disk commands in place of the virtual disk, the drive model and view, the holder and the scripted hand,
drive sound, and the e2e run; so the software in Node still uses `VirtualDevices`, and the 12.1 checks that run the
software on the mechanism (program load, lever opened mid-write leaving a document that needs recovery) wait for it.

Sound done (2026-11-12): `WpAudioEngine` voices the printer, the diskette unit and the station from the mechanism's
forces, torques and speeds (`src/audio/wp-synth.js`), on three panned buses, in stereo through the worklet; the
station's power and fan (`station-mech.js`) joined the host for it. Tests: `tests/wp_audio.test.js` (a printed line, a
line feed and a transfer sound and stay finite; energy rises with print rate; a strike's sound starts within a
millisecond of its contact; idle output is exactly the motors and fans, steady; the pans; the station fan; the voices'
cost). Decisions are listed in 10.3. Not done: listening in a browser and tuning the levels by ear (they are set
against the targets in `LEVEL`'s comment), paper sound, the station's rocker and knobs, and the keyboard's own
mechanical sound in the worklet.

M8 spelling done (2026-11-12): the word list (`public/assets/wordlist_en.gz.bin` from public-domain 12dicts,
`tools/wp/build_wordlist.py`, `src/kits/wp/wordlist.js`), `spell/dictionary.js` and `spell/hyphen.js`, and
`tasks/spell.js`: SPELL in the typing area, SPELLING TASKS, Check Document with CHECK DOCUMENT, HYPHENATE AND PAGINATE
DOCUMENT and the CHECK SPELLING OF WORD screen, spelling marks in reverse video, FIND SPELL and CANCL on a marked word,
dictionary hyphenation in pagination (prompted and automatic), the LINE ADJ `Hyphenate where?` left from M3, the
supplement tasks, and the spelling abbreviations of Menu Bypass. The dictionary sits on the program diskette and is
read as pages are checked. Tests: `wp_spell` (E10; the list, lookup, hyphen points, words, marks, automatic and
retyped checks, LINE ADJ, automatic hyphenation, supplements, the fetch, Menu Bypass). Decisions are listed in 7.9.
Not done: Choose Spelling Language Dictionary and the Language For Spelling Check instruction, GLOBAL with SPELL,
showing the previous page above a word near a page's top on CHECK SPELLING OF WORD, and holding other tasks while
paginated pages print.

M4, M6, M7 and M8 in the browser done (2026-11-12): the kit runs the software on the CRT with the simulated keyboard
(main-thread keyboard host with time-stamped fingers), one mechanism client for the printer, diskette unit and station,
the printer's paper and ribbon as soft bodies in its frame with the sheet feeder and page pile, the diskette unit's
levers, diskettes and holder, the printer's panel keys, cover and power switch, the cold start with the module's rocker,
hover labels, and a panel with the feeder toggle and key map. Unit models are built in code (no GLB files: Blender was
not available, and code costs no download). Checked in a browser: typing through the menus, printing a document onto
a fed sheet, revising a document read through the drives, Spelling Tasks with the word list fetched. Measured first
visit: about 5.0 MB, of which 4.3 MB are the room and desk shared with the typewriters; the word processor adds about
0.7 MB, plus 114 KB of word list on the first Spelling Tasks. The shared AudioWorklet bundle grew from 119 KB to about
190 KB (unpacked) because it carries the word processor's host. Still listed only with `?wp`.

---

## 12. Tests, performance, assets

### 12.1 Tests

All Node tests run under `node --test tests/*.test.js`; browser tests only through `tests/e2e/xrun.sh`.

| File | What it proves |
|---|---|
| `wp_editor.test.js` | The 13 scripts of SS 4, written with `testkit`: `run(sys, 'a ENTER a ENTER "First Letter" ENTER "WORK01" ENTER ENTER')`, then `expectRow(sys, 24, ...)`, `expectScreen(sys, fixture)`. Fixtures are 25 x 80 text files in `tests/fixtures/wp-screens/`, transcribed once from the grids in SS (a `~` cell matches anything). The training documents the scripts name are not available, so fixture documents of our own contain the words the scripts act on |
| `wp_menus.test.js`, `wp_buffer.test.js`, `wp_layout_text.test.js`, `wp_paginate.test.js`, `wp_fs.test.js`, `wp_format.test.js` | The units named in M1 to M3 |
| `wp_print.test.js`, `wp_print_mech.test.js` | The formatter's columns and lines, encoding, the spooler against the virtual printer, E3 and E4; a short document through the real printer mechanism |
| `wp_purity.test.js` | `src/wp/` imports nothing outside itself and uses no wall clock or DOM |
| `wp_keyboard.test.js` | Slow-press force curve per class (peak 40 to 75 g, make 1.5 to 2.2 mm, break at least 0.3 mm above); a 30 g press does not actuate; a 20 ms tap gives one make; hold 1 s gives one make and nine repeats +/- 1; five keys inside 10 ms give four bytes and an overrun; energy of stem and plate is conserved without damping |
| `wp_printer.test.js` | Full mechanism in Node: cps targets of 6.6; strike x within 0.03 mm of commanded; bidirectional registration within 0.05 mm; no lost carrier steps in 1000 random moves; selection error under a quarter step at every impact; flight time within 5 % of target by the eighth strike of a group; face pressure in the ink window and under perforation; 16-step feed within 66 ms; cover opened while printing stops the carrier and reports 06; export and import mid-line continues identically. Kept under 8 simulated seconds |
| `wp_disk.test.js` | The formulas of 8.4; program load 10 +/- 2 s; the mechanism within 5 % of the model over 20 random operations; spin-up to ready under 0.6 s; lever opened mid-write gives an error and a document that needs recovery |
| `tests/e2e/wp.mjs` | `?machine=wordproc1980`: no console errors; `__tw.wp.screen.text()` shows TASK SELECTION; real key events create and type a document; a screenshot of the raster has text where the buffer has it; PRINT produces strikes and ink and a page in the pile; reload finds the document; frame-time and GPU-time thresholds. A second run with `?wpdevices=virtual` covers the software and CRT quickly; one run with `?cold` covers start-up; one switches machines through the picker both ways |

### 12.2 Performance targets

| Measure | Target |
|---|---|
| Frame rate | 60 per second at 1600 x 1000 on an Intel UHD 620 class GPU with the existing governor |
| Triangles and draw calls added | Under 120 k and under 60 (keycaps are instanced per profile; legends from a canvas atlas) |
| CRT | 9.3 |
| Main thread per frame, added | Views 0.5 ms; software 0.1 ms; soft world as today (the sheet sleeps unless feeding) |
| Audio thread | `dspLoad` under 0.05 idle and under 0.35 while printing, on a 2018 laptop |
| Key to click | 5.5 |
| Warm start to typing | Under 3 s after assets load |

### 12.3 Asset budget

| Asset | Size | Notes |
|---|---|---|
| Kit JavaScript (software, host, views, shaders), gzip | 120 KB | Its own chunk; the typewriter kit likewise |
| `wp_station.glb`, `wp_display.glb`, `wp_keyboard.glb`, `wp_diskette.glb`, `wp_printer.glb` | 1.1 MB together | Procedural, `tools/blender/build_wp_*.py`, with clearance checks against the moving parts as the existing builders do. No badges, no lettering |
| `wp_plastic` texture set (pebble normal and roughness, 1024, AVIF) | 250 KB | One set for all pearl-white covers; colour in the material |
| `glyphs_wp.gz.bin` and `.json` | 80 KB | 96 faces at 12 pitch from the existing font, baked by `tools/bake_glyphs.py --set wp`; unpacked with `DecompressionStream` in the browser and `zlib` in Node |
| Font, key legends, diskette labels | 0 | In the JavaScript; canvas at run time |
| Spelling word list, gzip | 150 KB (114 KB built) | `wordlist_en.gz.bin`, fetched when Spelling Tasks first loads, behind the program-load wait |
| **Total for a first visit** | **under 2 MB** (1.7 MB without spelling) | |
| Not fetched on a word-processor visit | `frame.glb`, `enclosure.glb`, `element_enclosure.glb`, both sample sprites, every texture set not in `machine.textures` | More is saved than added |

---

## 13. Risks, open questions, gaps

### 13.1 Risks

| Risk | Mitigation |
|---|---|
| Moving `main.js` into a kit breaks a typewriter | It is the first commit, a pure move, gated by the whole existing test and e2e suite |
| Click jitter from a busy main thread | Budget in 5.5, measured in e2e; the Worker fallback needs no interface change |
| The wheel and carrier models do not reach 60 cps, or ring at impact | M5 is headless and comes before any drawing; one tuned scalar per motor; the planner slows the carrier instead of failing |
| `PaperSim` assumes a typewriter's paper path | The printer's path is the same topology (table, feed rolls under the platen, bail above the line). If the motorised load cannot be made reliable, the fallback is the existing `Hands.loadPaper` sequence driving the index stepper's target |
| The film ribbon does not suit `RibbonSim` | It is a rope between two spools on the carrier, as on the element machine; only weave and depletion differ |
| The scope of Textpack | The core is fixed in 7.8; everything else is a menu with a message. M4 ships without M3 being complete if need be |
| Stiff contacts at 384 kHz | Same substep and the same stability test as `element.test.js` (omega x dt under 0.6 for every spring) |
| IndexedDB unavailable or cleared | `MemoryStore` fallback with a message; first-run diskettes are rebuilt |
| Screen text too small on phones and small windows | The Screen card (9.4) |

### 13.2 Owner's answers (2026-11-11)

These replace the defaults that were proposed here.

| # | Question | Decision |
|---|---|---|
| 1 | Start-up | Warm start at TASK SELECTION by default. The cold start (`?cold`) is fully physical: the user switches on each unit at its own power switch (electronics module, printer), then the real self-test and loading sequence runs |
| 2 | Names and marks | **The no-marks rule is lifted for this machine.** The power-on screen shows the initials and the menu titles keep the product names, as documented. Everything is still drawn by us: our own font and artwork, no ROM or code |
| 3 | Program diskettes | One combined program diskette (a real configuration) |
| 4 | Persistence | Diskettes persist between visits; authentic recovery of a document left open; a leave-page prompt while one is open |
| 5 | Paper feed | **No hand model.** The printer's sheet feeder (a real 5218 option) feeds each sheet automatically, on by default, with a toggle for feeding by hand |
| 6 | Real-keyboard map | As tabled in 5.3 |
| 7 | Ashtray | On top of the diskette unit |
| 8 | Paper | Fresh stack and finished pile in front of the printer, left of the keyboard |
| 9 | Night lighting | Just dim, with the green glow of the screen as the main light; no fixture |
| 10 | Spelling | A public-domain word list in M8. Browsers have no API that checks a word list from script (the `spellcheck` attribute only underlines editable fields), so the list ships with the machine |
| 11 | Stereo | Yes |
| 12 | Sample documents | Three short pieces of our own text |

### 13.3 Gaps in the research

| Gap | Default | Where it is isolated |
|---|---|---|
| Printer size (+/- 10 %) | 0.74 x 0.58 x 0.23 m | `units.printer.size`; placements recompute |
| Wheel radius, inertia, torque, positioning time | 6.4, tuned by 6.6 | `printer.wheel`, `printer.selection` |
| Hammer mass, energy, flight time | 6.4, tuned by 6.6 | `printer.hammer` |
| Petal order | Frequency order from home `a` | `geometry.printer.wheel.order` |
| Carrier slew and ramp, line-feed rate | 3000 steps/s, 40 000 steps/s^2, 400 steps/s | `printer.carrier`, `printer.index` |
| Ribbon type and lift | Multi-strike film, three tracks | `printer.ribbon` |
| Key force curve beyond 40 to 75 g and 1.5 to 3 mm | 5.1 | `keyboard` |
| Keyboard scan period, link byte time | 5 ms, 1 ms | `keyboard.scan` |
| Beep lengths; whether invalid keys beep | 200 ms (measured, 10.4) and 400 ms; no beep, no click | `messages.js`, `keys.js` |
| Phosphor type and persistence; refresh; cursor blink | Two-component decay 30 and 250 ms; no flicker; steady cursor | `display.phosphor` |
| Blink rate of the message arrow | 2.5 Hz | `display.blinkHz` |
| Head-load time | 40 ms | `diskettes.headLoadS` |
| On-disk format, documents per diskette, program sizes | 8.2 | `disk/` |
| Full prompt and message list | The strings quoted in SR 6 and SS, plus plain wording of our own for the rest, each marked `source: 'ours'` | `messages.js` |
| Status-line field text for Insert and Replace | `Ins`, `Repl` (SS 3.1) | `editor/view.js` |
| Default tab grid | Every 5 positions (SS 3.1) | `editor/format.js` |
| Segment width; step of the SCREEN keys | 60 positions with 20 of overlap (HW 1.7); SR 4.7 as written | `editor/view.js` |
| Find with no match | Cursor stays; a short beep; message of our own | `editor/commands.js` |
| Typing past the last typing line | Allowed, with the beep (SS 3.2) | `editor/commands.js` |
| Case of menu ID letters | Either accepted | `menu-runner.js` |
| Cursor movement across a page end | Down from the last line shows the next page | `editor/commands.js` |
| Colours of the covers | Pearl white `#d9d4c4`, pebble grey `#8f8d86`, to be judged against the brochure photos | `wp-materials.js` |
| Keyboard feet, cable form, the 92-character layout | None; straight cable; not built | Models |
