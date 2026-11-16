# Fax architecture: the Sharp FO-70

How the fourth machine is put together, in the form of `docs/displaywriter/architecture.md`. Written at M0 with
the mechanical half of M4 and M5; the plan is `plan.md`. The owner's service manual and operation manual
(`refs/`) have since been read: `hardware.md` is the cited fact base, and every value in the definition carries
**[S p.N]** (the service manual's page) or **[S OM p.N]** (the operation manual's), **[M]** typical (memory of
machines of the class) or **[A]** assumed (ours). Section 8 lists what the manuals settled and what they changed.

Three other pieces of work plug into this one; section 4 is their contract.

| Area | Owner | Plugs in through |
|---|---|---|
| `src/fax/thermal/`, `src/fax/image/` (head and paper physics, CIS and video, T.4 page sources) | another agent | 4.1, 4.2 |
| `src/fax/firmware/`, `src/fax/remote/` (the machine's firmware, the correspondents) | another agent | 4.3, 4.4 |
| `tools/blender/build_fax_*.py`, `src/render/fax/`, `public/assets/models/fax_fo70.glb` (the model) | another agent | 6.2 |

## 1. Where things live

| Piece | File | Notes |
|---|---|---|
| Definition | `src/machine/faxfo70.js` | id `faxfo70`, menu name "Sharp FO-70 facsimile, c. 1999", `kind: 'fax'`, `action.type: 'thermal-fax'`. Units (body and handset), block-out boxes, desk layout, cameras, protocol capabilities, and `mech`, the mechanism definition |
| Geometry | `src/machine/fax-geometry.js` | `deriveFaxGeometry`: unit boxes (`placeUnits`, shared with the Displaywriter in `wp-geometry.js`) and the block-out parts in world space |
| Registry | `src/machine/index.js` | In `MACHINES` and `KITS`; in `UNLISTED` until M7, so selectable by `?machine=faxfo70` and shown in the picker only with `?wp`. `geometryFor` is now a table by `machine.kind` |
| Views | `src/machine/fax-views.js` | The view graph as data (`FAX_GRAPH`) and the fallback boxes (`faxBoxes`); run by `src/interact/wp-views.js` |
| Mechanism host | `src/sim/fax/` | `index.js` (`FaxSim`), one body per service-manual block (section 3), five controllers, `layout.js`, `ports.js`, `friction.js` |
| Shared mechanism code | `src/sim/common/stepper.js`, `inputs.js` | Moved from `src/sim/wp/`, which re-exports them, so every word processor import still works |
| Host and worklet | `src/sim/host-factory.js`, `src/audio/worklet-fax.js`, `src/sim/worklet-url.js` | A third row in `HOSTS`; the fax's own worklet bundle (38 kB), picked by `isFaxFamily` |
| Audio | `src/audio/fax-engine.js` | `FaxAudioEngine`, the interface of `WpAudioEngine`; placeholders only (section 5) |
| Kit | `src/kits/fax.js`, `src/kits/fax/blockout.js` | Stage, desk, block-out or model, desk things, views, room, SimClient (section 6) |
| Loading screen | `index.html` | A thermal-paper look and "SHARP FO-70 / facsimile, c. 1999" for `?machine=faxfo70` |
| Tests | `tests/fax_layout.test.js`, `fax_views.test.js`, `fax_mech.test.js`, `worklet_entries.test.js` | Section 7 |

## 2. The definition

Coordinates as the other machines: SI units, x right, y up, z toward the operator, origin at the desk reference
point. The body is 304 x 236 x 122 mm and 2.6 kg [S]; it stands at x = 0, z = -0.07 so the received pages have room
in front. The handset (54 x 42 x 218 mm [A]) lies on a cradle along the left side, its top the machine's top, as in
the owner's photograph (`refs/owner/sharp_fo70_top.png`; the FO-235 photograph is another machine). Colours from the
photograph: lilac grey `0xa7a2b6` and a cream panel `0xd9d1b4` [A].

`blockout` names boxes in the body's frame: `cradle`, `cabinet`, `panel`, `display`, `documentTable`,
`documentSlot`, `paperExit`, `documentExit`, `rollBay`, `rear`. The kit builds them, the views frame them, and the
model's view is expected to provide parts of the same names (6.2).

`deskLayout`: the received pile in front of the machine (no tray [A]), the document folder right, the card index of
numbers left, the boxed spare roll behind the folder, the wall socket behind, and the typewriters' lamp behind the
card index. `capabilities` is the table the firmware hands the protocol stack (rates 9600 to 2400, MH and MR, the
three resolutions, 64 halftone levels, no ECM, no memory).

`mech` has one block per service-manual block: `drive`, `feeder`, `printer` (head, platen, roll), `cutter`, `liu`,
`panel` and `cover`. Each value is commented with its mark; derived values (train ratios, changeover steps, the
pre-feed distance) are computed from the others in the file, not typed in.

## 3. The mechanism host

`FaxSim` has the interface of `WordprocSim`: `step()`, `command(msg)`, `grab/moveGrab/release`, `setEnv`,
`setParam(path, value)`, `writeSnapshot(s)`, `drainEvents(out)`, `exportState()` / `importState(s)`, `warmUp()`,
`ports`, `acQ`/`acN`, `layout`. It runs at `SUBSTEP_HZ` (384 kHz). Every body sleeps when nothing moves it; a warm
idle machine costs a few comparisons a substep. Measured in Node: about ten times real time while feeding.

Each substep: the hands (`Inputs`), then every controller whose deadline has come, then the bodies. The drive and the
two paths are integrated together: `DriveMech.prepare()` computes each train's tooth torque from the present state;
the document path and the strip each solve their roller nip against their train (`friction.js nipForce`: the force
that keeps the two surfaces together this substep, up to mu N, so they stick or slip as the forces say); the drive
then integrates the motor, the swing arm and both trains with the nip torques.

### 3.1 Drive unit (`drive-mech.js`, `drive-ctl.js`)

**The manual's drive** (`drive.layout: 'single-planetary'`; hardware.md 4.2): ONE pulse motor, the "TX/RX MOTOR",
with planet levers A, B and C, a mode lever and a cam gear with a cam switch; the cutter has no motor of its own. Our
reading of it, since the manual gives the parts and not their working: one 7.5-degree [M] permanent-magnet stepper
(`src/sim/common/stepper.js`) with a swing gear on its pinion. The arm is dragged round with the pinion by the
friction on the planet's axle, so it follows the motor until it lands on a stop and the planet meshes: forward
rotation drives the scanning train (feed and separation rollers), reverse the recording train (platen, through an
idler). Each train is a rotor with its inertia and bearing friction, coupled through a tooth stiffness with backlash.
A change of direction therefore costs real lost motion (the swing, about 3.2 motor steps, plus backlash) and lands
with a clack. The meshed planet stays in until the arm backs off a tooth's depth, so the motor's ring at the end of a
move does not unmesh it.

On the recording side the mode cam chooses the train: the platen (cam at home, cam switch made) or the cutter's crank
(planet lever C). A **jog**, a part swing toward the scanning side and back that never reaches it, steps the cam; a
full changeover does not [A]. `drive.mode` holds the jog's steps.

The drive controller queues moves (`move({ owner, train, steps, rate, watch })`), ramps the step rate, adds the
definition's `changeoverSteps` at a change of direction, holds at half current for 50 ms and then switches off. A
watched move asks its owner after every counted step whether to stop (a sensor seen). Trains: `scan`, `record`,
`cut`, and `jog`.

One motor step is half a super-fine line [A], so standard, fine and super fine are 8, 4 and 2 steps; the train
ratios are derived from the roller radii so that this holds at the roller.

### 3.2 Document path (`scanner-mech.js`, `scan-ctl.js`)

Positions along the path are measured from the separation nip: document sensor -12 mm (in the table), registration
sensor +12, feed roller +24, the CIS read line +32 [A]. Up to five sheets [S] wait on the table; the bottom one sits
in the separation nip. The separation roller runs at 0.7 of the feed roller's surface speed on a one-way clutch [M],
against a pad that drags the sheet; once the feed roller has the sheet it pulls it through, and the next sheet
follows with a gap, which the registration sensor sees. Each sheet is a rigid lamina with its position (leading
edge), speed and mass, and the skew and side offset it was laid with (carried for the scanner). A hand on a sheet is
a DOF (`grab('document')`): a sheet held back slips and the pre-feed reports a misfeed.

The scan controller watches the document sensor (debounced), and runs `prefeed` (to the registration sensor and on
to 2 mm past the read line, or `misfeed`, or `noDocument`), `line` at a resolution, and `eject` (until the
registration sensor clears, then past the feed roller).

### 3.3 Head frame, roll, cover and cutter (`head-mech.js`, `cutter-mech.js`, `print-ctl.js`)

The strip from the roll to the platen is inextensible, so it is one DOF: `u`, the paper paid out past the head line
since the roll was loaded. A point of the paper has a strip coordinate `c`; it stands `u - c` beyond the head. The
roll's radius follows from the paper left on it (core 6.35 mm, 65 um paper [M]); its inertia, seen at the strip,
falls as it is used. The platen moves the strip only by friction at the nip under the head's force (4.5 N [A]),
against the head's glaze and the roll's drag. The paper sensor is a lever just before the head.

The operation panel is the roll cover: it lifts on its rear hinge past upright and rests open [A]; gravity shuts it
onto a latch; a hand lifts it (`grab('cover')`). The door sensor reports it, and the print controller refuses a line
while it is open; the head stays on the platen (paper is pushed through the slot by hand, OM p.18), so
`cover.liftsHead` is false.

The cutter (hardware.md 4.4: no motor; planet lever C, the cutter gear and the cutter plate's crank work the cutter
arm; a cutter switch reads home) is the load on the drive's cutter train, and divides the strip where the blade
passes: the event `{ dev: 'print', ev: 'cut', from, to, length }` gives the piece in strip coordinates. The print
controller's cycle: a jog steps the mode cam to the cutter (the cam switch opens), the cutter train turns until the
cutter switch has opened and made again, and a jog brings the cam home; a crank not home within a turn and a half
is `cutterJam`, and the next feed jogs the cam home first. It also prints a line (strobe, the strobe time, then a line feed) and feeds paper,
and reports the paper sensor and the cover switch.

### 3.4 Snapshot (`layout.js`) and sounds (`ports.js`)

The snapshot carries the motor angle and speed, the swing arm, both rollers, the first moving sheet and the tray
count, the strip's payout and leading end, the roll's radius and length left, head down, cover angle, cutter cam and
blade, the hook plunger and handset, both relay armatures, every sensor as the controllers read it, the line loop,
and every key's travel. Ports: the stepper's torque, the arm on its stops, both trains' tooth torques, the cutter's
current and speed, the blade's shear, the strip's speed. Acoustic onsets (`FAC`): planet stop, cut, cam home, relay,
hook, key, cover, sheet out, pick.

### 3.5 Telephone (`liu-mech.js`, `liu-ctl.js`)

One clapper relay, `cml`, the line connecting and dial pulse relay (hardware.md 5.2); the handset is switched by
gates, not a relay. Each coil's current lags its drive; the pull grows as the gap closes; the contact makes at 80 % of travel,
so pull-in takes a few milliseconds. The hook switch is a plunger in the cradle held down by the handset's weight; a
finger on it is a DOF (`grab('hook')`). `liu.lineLoop()` is what the exchange sees: closed when the handset is off
hook or `cml` is made. The controller sets coils and reports the hook switch, debounced.

### 3.6 Panel (`panel-mech.js`, `panel-ctl.js`)

27 keys (`mech.panel.keys`, one VOLUME key, as the panel drawing and key matrix show: hardware.md 3), each a stem on a
rubber dome whose force rises, buckles and rises again; the contact makes near the bottom. A finger is `command({ dev: 'panel', op: 'finger', key, force })` or `grab('key', i)`. The controller scans every
5 ms and reports a key after two equal scans: `{ dev: 'panel', ev: 'key', key, down }`.

### 3.7 The controller rule

Every controller is built with a frozen `io` of drive commands and sensor reads, imports nothing, and never sees the
host or a body: `tests/fax_mech.test.js` checks the `io` key sets, wraps them in proxies during a run of every
operation, and scans the sources for assignments to positions, speeds or currents.

| Controller | `io` |
|---|---|
| `DriveCtl` | `setMotor(state, amp)` |
| `ScanCtl` | `docSensor()`, `regSensor()` (and asks `DriveCtl` for steps) |
| `PrintCtl` | `strobe(dots, energy)`, `cutterHome()`, `camHome()`, `paperSensor()`, `coverClosed()` (and asks `DriveCtl` for the paper and the cutter) |
| `LiuCtl` | `setRelay(name, amps)`, `hookOn()` |
| `PanelCtl` | `keyContact(i)` |

## 4. Interfaces for the other work

### 4.1 Thermal head and paper (`src/fax/thermal/`)

The print controller calls `io.strobe(dots, energy)` once a dot line; the head mechanism checks that the head is down
and paper is under it, then calls the attached thermal model **once per printed line**:

```js
sim.attachThermal({
  /** Returns the line's darkness, Uint8Array(1728), 0 white .. 255 black. */
  printLine({ dots, energy, coated, coord, t, speed }) { ... },
});
```

- `dots`: Uint8Array(1728), 0 or 1, left to right as the head sees the paper.
- `energy`: strobe energy per dot in joules, a number or a Float32Array(1728) (the firmware's history compensation
  goes here).
- `coated`: the roll is in coating side toward the head; false prints nothing.
- `coord`: the strip coordinate under the head line (m); `t` the host's time (s); `speed` the strip's speed (m/s).

The model keeps its own state (dot and substrate temperatures) and should give it as `exportState()` /
`importState(s)` if it is to survive the handover to the audio thread; the host does not yet carry it. With no model
attached (`attachThermal(null)`), a dot marks black when its energy reaches `mech.printer.markEnergy` on the coated
side. The host emits `{ dev: 'print', ev: 'line', coord, darkness }` for the kit to paint the strip, and
`{ dev: 'print', ev: 'cut', from, to, length }` when a page is cut.

### 4.2 Contact image sensor (`src/fax/image/`)

The feeder reports where the read line falls on the document: `sim.scanLine()` returns null when no sheet covers the
line, else `{ id, y, length, width, skew, offset, faceDown, lift, speed }`: the sheet's id (the kit's handle on its
reflectance image), `y` the distance from its leading edge to the read line (m, growing as it feeds), its size, the
skew and side offset it was laid with (rad, m), whether it is face down (face up reads the back: blank), its lift off
the glass (0 now: the feed roller presses it flat) and its speed (for motion smear). The scan controller's `ready`
and `line` events carry the same object as `at`. Sheets are laid with
`command({ dev: 'feeder', op: 'load', sheets: [{ id, length, width, skew, offset, faceDown }] })`; page images cross
to the host separately (plan 7.2) and are looked up by `id`.

### 4.3 Firmware (`src/fax/firmware/`)

The firmware runs in the host, in the worklet, on the host's clock:

```js
sim.attachFirmware({ nextT, service(t), device(e, t) });   // null detaches
```

`service(t)` is called when `t >= nextT`, after the controllers; `device(e, t)` hears every device event as it is
emitted. It drives the machine only through the controllers in `sim.ctl`:

| Call | Reply event |
|---|---|
| `sim.ctl.scan.command({ op: 'prefeed', id }, t)` | `{ dev: 'scan', ev: 'ready', id, at }` or `ev: 'error', error: 'noDocument' / 'misfeed'` |
| `sim.ctl.scan.command({ op: 'line', id, res }, t)` (`res`: `standard`, `fine`, `superfine`) | `{ dev: 'scan', ev: 'line', id, res, at }` |
| `sim.ctl.scan.command({ op: 'eject', id }, t)` | `{ dev: 'scan', ev: 'ejected', id }` or `error: 'jam'` |
| `sim.ctl.print.command({ op: 'line', id, dots, energy, res }, t)` | `{ dev: 'print', ev: 'line', id }` or `error: 'coverOpen' / 'noPaper'` |
| `sim.ctl.print.command({ op: 'feed', id, lines, res } or { op: 'feed', id, steps }, t)` | `{ dev: 'print', ev: 'feed', id }` |
| `sim.ctl.print.command({ op: 'cut', id }, t)` | `{ dev: 'print', ev: 'cut', id }` or `error: 'cutterJam'` |
| `sim.ctl.liu.command({ op: 'relay', name: 'cml', on })` | none; `sim.liu.lineLoop()` for the exchange |
| unsolicited | `scan/document {present}`, `print/paper {present}`, `print/cover {closed}`, `liu/hook {offHook}`, `panel/key {key, down}`, `feeder/out {id}` |

Commands queue per controller; scan and print moves share the one motor through `DriveCtl`, so copy mode alternates
by itself. The firmware's own state is its own to export. The same commands reach the host from the page as
`client.command({ dev: 'scan' | 'print' | 'liu', ... })` (tests use these).

### 4.4 Line

`sim.liu.lineLoop()` is the subscriber loop's state for `src/fax/line/exchange.js`; the handset's earpiece and the
monitor speaker join the audio engine in M7 (`src/fax/modem/audio-port.js` produces and consumes the line samples).

## 5. Audio

`FaxAudioEngine` steps the host at the audio rate as `WpAudioEngine` does and publishes snapshots at 250 Hz. Its
voices are placeholders, all [A]: the stepper's torque change ringing three modes of a light case, the cutter motor's
buzz at its commutation rate with its current, and short knocks for the onsets. Silent when the machine waits. No
sprite is fetched (`audio.samples: false`). The worklet entry carries only `FaxSim`, its bodies and controllers,
`src/sim/common/` and this engine; the line, modems and firmware join it in M6 and M7.

### 5.1 M7: the working machine, its threads and its sound

**One host, one clock, one thread at a time.** `src/sim/fax/station.js` (`FaxStation extends FaxSim`, built by
`host-factory.js` and the fax worklet entry) is the whole machine: the mechanism; the firmware through
`src/fax/firmware/sim-devices.js` on the host's clock (its `service(t)` runs after the controllers in the substep);
the CIS and video stage over the sheet images (`src/fax/image/sheet-scan.js`); the thermal head and paper as the head's
model (`thermalModel`); and the exchange of the card index (`src/fax/remote/`), whose calls are real modem audio on an
`AudioLink`. Before the first gesture and with `?localsim` it runs on the page (`LocalHost`); after the gesture it runs
in the fax AudioWorklet (plan 7.2), where `FaxAudioEngine` steps it 8 substeps an output sample. Nothing of a call is
streamed between threads, so a slow frame cannot starve the modems or the speaker.

**What crosses the thread boundary.** In: commands (`doc place` with the sheet's reflectance image, once; `doc raw`,
the raw CIS lines; `panel tap` or `finger`; `handset`; the cover grab). Out, with the 250 Hz snapshots: each printed
line's darkness (`print line`), the cut pieces (`print cut`), the LCD's text (`lcd`), the ringer (`ringer`), the
firmware's settings and journal to store (`store`), and the feeder's `scan ready` and `feeder out`.

**The CIS is read ahead.** A CIS line costs about a millisecond (1728 elements by about 49 taps), and the firmware's
memory-less pacing (devices.md) reads a whole page when the station asks for it: 2.4 s for a fine page, which would
stall the audio thread. So when a sheet reaches the read line (`scan ready`), the kit's worker
(`src/fax/image/scan-worker.js`) reads its raw 8-bit lines at standard, fine and super fine from the same pose, with
the same sensor seed, and hands them in; the host then runs only the video stage (shading, white tracking, threshold
or halftone, microseconds a line). A line the worker has not delivered yet is read in place (a glitch at worst).

**The handover.** The firmware's tasks are generators and cannot be copied, so `exportState()` carries the mechanism,
the store (settings, journal) and the page images, and the audio thread boots the firmware afresh on them. The handover
is at the first gesture, when the machine is standing by.

**The line's audio** (`src/sim/fax/line-tap.js`). The switchboard steps its `AudioLink` in 20 ms blocks on the
firmware's clock, each when its first sample is due; the tap keeps each block (what the FO-70 hears, plus 0.35 of its
own transmission as sidetone) in a ring at 8 kHz. The exchange's call-progress tones (dial tone, ringback, busy,
reorder) arrive only as events at call level, so the tap synthesises them from the North American tone plan
(`TONE_PLANS.na`) with their cadences; the dialler's DTMF digits and the Front Desk's voice samples likewise. The engine
reads the tap at the host's time, sample by sample, linearly interpolated to the output rate:

| Listener | Rule | Level [A] |
|---|---|---|
| Monitor speaker | `ncu.monitor(level)`: the firmware turns it on for automatic dialling and the handshake and off at DCS or the receive phase (main.js), and SPEAKER keeps it on; band 350 to 3800 Hz | volume 0 to 3: 0, 0.35, 0.7, 1.1 |
| Handset earpiece | While the handset is off its cradle (`liu.onCradle`); band 300 to 3000 Hz | 0.3 |
| Ringer | `beeper.ring(on, { volume, pattern })`: a 1000/1250 Hz warble at 16 Hz, the cadence from the exchange's ringing (the TEL/FAX pseudo ring 1 s on, 2 s off) | 0.1 a volume step |
| Beeper | `beeper.beep`: key 60 ms, end 1.5 s, error four short, at 2730 Hz | 0.07 |

The mechanism's voices (stepper, cutter motor and blade, relays, hook, keys) are as above, from the ports and onsets.

**Known approximations.** A received page is printed once its data has arrived (the T.30 checker gets the page
whole), line by line through the head; a real memory-less machine prints as it decodes. Feed lines run at motor speed
within each pacing chunk. The cutter feeds the strip 16 mm (the head to the blade, and 2 mm) before it cuts. A sheet
shorter than about 24 mm never reaches the feed roller and is not fed.

## 6. Kit and views

### 6.1 Views

`src/interact/wp-views.js` now takes its graph as data: `viewSpec(id, graph)`, `poseOf(id, boxes, aspect, fov,
graph)`, `new ViewNav({ graph, ... })`; `WP_GRAPH` is the default, so the Displaywriter is unchanged. The fax's graph
(`FAX_GRAPH`): stations Desk, Numbers, Fax, Received, Documents left to right; focus items at the Fax: Panel, Display,
Feeder, Paper (with a note to lift the panel), Handset, Rear; and Spare roll, Cards, Pages and Folder at the others.
`wp-markers.js` and `wp-nav.js` are used unchanged.

### 6.2 The model swap

The kit looks for `src/render/fax/fo70-view.js` with `import.meta.glob`, so it builds with or without it. If present it
calls `buildFo70View(machine, { renderer, geometry })` (or the module's `buildFo70` or default export), which may be
async, and expects `{ group, parts }` in **the body's frame** (origin on the desk under the body's centre, x right,
y up, z toward the operator), optionally `update(state, layout)` called every frame. The kit uses these parts if
present: `handset` (a node it hides when lifted, until the model animates it), `cover` (the panel's pivot: the kit
sets `rotation.x = -cover angle`), `panel`, `display`, `rollBay`, and `keys` (meshes in `mech.panel.keys` order, for
later picking). On any failure, or with `?blockout`, the block-out stands in (`src/kits/fax/blockout.js`).

### 6.3 The rest

`?cold` starts with no roll. The first pointer or key gesture makes the AudioContext and hands the mechanism to the
fax worklet (`?localsim` keeps it on the page). The room's time of day, weather, lamp and rain come from the
typewriters' environment (`src/render/environment.js`, `src/audio/ambience.js`), remembered under `fax.atmosphere`.

## 7. Tests

| Test | What it proves |
|---|---|
| `fax_layout` | Registry, menu name, unlisted, kit and host present; 304 x 236 x 122 mm and 2.6 kg; handset on the cradle within the outline; block-out inside the body; desk things in the board field, none overlapping, the lamp clear; pitches a whole number of steps; marks present and the drive marked assumed |
| `fax_views` | The graph, every framed box present, arrows and Back, focus items, the paper's note, framing at two aspects; the Displaywriter's graph unchanged |
| `fax_mech` | A sheet past both sensors, ten lines at each resolution within 3 % of pitch, eject; two sheets part with a gap; a held sheet misfeeds; the paper fed a line at a time at 3.85, 7.7 and 15.4 lines/mm (mean within 1 %, each line within 10 %), the planet staying meshed; strobe and the thermal model swap, a backwards roll prints nothing; cover open refuses; a cutter cycle (one cut at the blade, home again) and a jam; paper out; roll radius; hook switch, hook flash, relay pull-in; panel keys and a light touch; export/import mid-move by a plain deep copy with `structuredClone` deleted, both runs then identical; firmware attach; controller purity; sleep |
| `worklet_entries` | The fax entry bundles only its family, the others not the fax; the fax worklet takes over a warm state with no `structuredClone` or `setTimeout`, feeds, cuts and sounds |

## 8. What the manuals settled

The owner's service manual (SM) and operation manual (OM) were read in full (hardware.md). Each value below is in
`src/machine/faxfo70.js` or the firmware with its page.

| Value | Was | Now | Source |
|---|---|---|---|
| Number of motors | One stepper [M hypothesis] | One pulse motor, "TX/RX MOTOR" | SM p.4-1, 4-2, 3-7 |
| Drive layout | Swing gear, forward scan, reverse record [A] | Planet levers A, B, C, mode lever, cam gear and cam switch; our reading keeps the swing gear and adds the mode cam [A] | SM p.3-7 fig. 5 |
| Cutter drive | Own 12 V DC motor, worm, cam [A] | No motor: planet lever C, cutter gear, cutter plate crank, cutter arm; cutter switch | SM p.3-7, 3-9, 4-3 |
| Motor drive | 2-phase, amplitude [A] | Unipolar, ULN2003A, phases TPA/TPB and complements, +24 V through FU100 | SM p.6-5 |
| Step angle | 7.5 deg [M] | Not given | - |
| Gear teeth | Derived [A] | 17/30Z (2), 17/36Z, 17/43Z, idlers 25Z (3), 30Z; scanner 17/28Z, 17/23Z; path not given | SM p.3-4, 3-7 |
| Document path | Separation roller on a clutch, feed roller [M] | One feed roller against a separation rubber plate; driven back roller over the CIS; front sensor and document sensor | SM p.3-1, 3-4, 3-6 |
| Feeder capacity | 5 [S] | 5 (10 in the paper table) | SM p.1-1, 1-3 |
| Head | 1728, 4 blocks [A] | 1728, 8/mm, 4 strobes, 10 ms a line, +24 V VTH by relay RY1, thermistor, rank | SM p.3-2, 4-3, 5-2, 6-5 |
| Head supply | 12 V, 700 ohm [A] | 24 V [S]; 2800 ohm [A] keeping the dot power | SM p.6-5 |
| Head lift | Panel lifts the head at 1.5 deg [A] | Head stays down; paper pushed through the slot | OM p.18, SM p.1-6 |
| Print width | 216 mm [A] | 210 mm effective; roll 216 mm, shims for 210 | SM p.1-1, 1-6 |
| Roll core | 1/2 in [M] | 12.7 mm | OM p.1 |
| CIS | 1728 [S] | 1728, 8/mm, 5 ms line, 2 V on white, LED from +24 V | SM p.5-12 |
| Relays | CML and TEL [A] | One: CML (line and dial pulse) | SM p.5-10 |
| Hook switch | Plunger [A] | On the TEL/LIU PWB, via hook switch lever and joint lever | SM p.3-3, 3-12 |
| Panel keys | 28, VOLUME pair [A] | 27, one VOLUME; key matrix SEN0-SEN6 x KEN1A-KEN4A | OM p.8, SM p.6-15 |
| Memory, ECM | None [A] | None: 256 kbit SRAM is line memory; no ECM frames | SM p.5-2, 7-1 |
| Modem | V.29/V.27ter [A] | FM209: V.29, V.27ter, V.21; 9600-2400, fallback | SM p.5-6 |
| LCD messages | 4 [S summary], the rest [A] | OM's Messages and Signals and display figures; SM's power-on and diagnostics | OM p.90-91 etc. |
| Error codes | E-01 to E-17 [A] | Communication error code table 0-13; report NOTE COM.E-0 to 7, JAM, NO PAPER, CANCEL | SM p.2-19, OM p.51 |
| Menus | FUNCTION 1-6 [A] | FUNCTION 2 lists, 3 entry, 4 options, 9 * 8 # 7 diagnostics | OM, SM p.2-2 |
| Standby line | "NOV-16 09:30 FAX" [A] | "16-NOV 09:30" and the mode arrow | OM p.28 |
| Reception mode order | FAX, TEL, TEL/FAX, A.M. [A] | TEL, FAX, TEL/FAX, A.M. | OM p.28 |
| Rings | 2 [A] | 2 (2-5); TEL/FAX 2, pseudo ring 30 s, CNG 5 s | OM p.52-54 |
| Redial | 2 x 5 min [M] | 2 x 5 min, RECALLING, also when unanswered | OM p.49, p.91 |
| Speed dial | 35 | 01-05 rapid, 06-40 speed | OM p.40 |
| Name entry | Letters first [A] | Digit first, SPEAKER, REDIAL case, symbols; 24 characters | OM p.22 |
| Date entry | MM-DD-YYYY [A] | Day, month, year, hour, minute | OM p.25 |
| Reports | Transmission, activity, setup, tel, help [A] | Transaction report (figure), Telephone Number List, Anti Junk Number List, Help List | OM p.50-51, p.81 |
| Polling | E/POLL with no document [A] | POLLING option; dial, then E/POLL | OM p.79-80 |
| Market | North America [A, decision 5] | FO-70RA, 220-240 V; Hong Kong OM edition; country select list | SM cover, p.2-4; OM p.75 |

Still assumed: roller radii and speeds, sensor positions, forces, the swing gear's numbers, step rates, the cam's
working, the cutter's geometry and numbers, the cover's angle and torques, the dome curve, debounce and poll periods,
the audio levels, the line's tone plan and cadences (the manuals give none), and the texts the manuals do not show
(hardware.md 12).
