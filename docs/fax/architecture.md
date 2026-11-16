# Fax architecture: the Sharp FO-70

How the fourth machine is put together, in the form of `docs/displaywriter/architecture.md`. Written at M0 with
the mechanical half of M4 and M5; the plan is `plan.md`, the sources `research.md` section 8. Nothing of the FO-70
has yet been read at source, so every value in the definition carries the plan's mark: **[S]** documented (a search
summary that quoted a named document), **[M]** typical (memory of machines of the class), **[A]** assumed (ours).
Section 8 lists what the service manual must replace.

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

**Assumed design** (`drive.layout: 'single-planetary'`; plan 2 and risk 21): one 7.5-degree permanent-magnet stepper
(`src/sim/common/stepper.js`) with a swing gear on its pinion. The arm is dragged round with the pinion by the
friction on the planet's axle, so it follows the motor until it lands on a stop and the planet meshes: forward
rotation drives the scanning train (feed and separation rollers), reverse the recording train (platen, through an
idler). Each train is a rotor with its inertia and bearing friction, coupled through a tooth stiffness with backlash.
A change of direction therefore costs real lost motion (the swing, about 3.2 motor steps, plus backlash) and lands
with a clack. The meshed planet stays in until the arm backs off a tooth's depth, so the motor's ring at the end of a
move does not unmesh it.

The drive controller queues moves (`move({ owner, train, steps, rate, watch })`), ramps the step rate, adds the
definition's `changeoverSteps` at a change of direction, holds at half current for 50 ms and then switches off. A
watched move asks its owner after every counted step whether to stop (a sensor seen). If the manual shows two
motors, `drive-mech.js` and `drive-ctl.js` change; nothing else knows the count.

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
onto a latch; a hand lifts it (`grab('cover')`). Lifted more than 1.5 degrees, the head is off the platen and nothing
prints or feeds.

The cutter (**assumed design**: guillotine blade on an eccentric cam, one turn a cut, through a self-locking worm from
its own small DC motor, with a home switch on the cam) loads its motor while the blade shears, and divides the strip
where the blade passes: the event `{ dev: 'print', ev: 'cut', from, to, length }` gives the piece in strip
coordinates. The print controller's cycle: motor on, cam leaves home, comes back, dynamic brake 30 ms, off; no
return within 1.5 s is `cutterJam`. It also prints a line (strobe, the strobe time, then a line feed) and feeds paper,
and reports the paper sensor and the cover switch.

### 3.4 Snapshot (`layout.js`) and sounds (`ports.js`)

The snapshot carries the motor angle and speed, the swing arm, both rollers, the first moving sheet and the tray
count, the strip's payout and leading end, the roll's radius and length left, head down, cover angle, cutter cam and
blade, the hook plunger and handset, both relay armatures, every sensor as the controllers read it, the line loop,
and every key's travel. Ports: the stepper's torque, the arm on its stops, both trains' tooth torques, the cutter's
current and speed, the blade's shear, the strip's speed. Acoustic onsets (`FAC`): planet stop, cut, cam home, relay,
hook, key, cover, sheet out, pick.

### 3.5 Telephone (`liu-mech.js`, `liu-ctl.js`)

Two clapper relays [A]: `cml` (the machine seizes the line) and `tel` (the handset switched out while the machine has
the line). Each coil's current lags its drive; the pull grows as the gap closes; the contact makes at 80 % of travel,
so pull-in takes a few milliseconds. The hook switch is a plunger in the cradle held down by the handset's weight; a
finger on it is a DOF (`grab('hook')`). `liu.lineLoop()` is what the exchange sees: closed when the handset is off
hook or `cml` is made. The controller sets coils and reports the hook switch, debounced.

### 3.6 Panel (`panel-mech.js`, `panel-ctl.js`)

28 keys (`mech.panel.keys`), each a stem on a rubber dome whose force rises, buckles and rises again; the contact
makes near the bottom. Keys named in the manuals are [S]; FUNCTION, the volume pair, COPY/HELP, START and STOP are
[A]. A finger is `command({ dev: 'panel', op: 'finger', key, force })` or `grab('key', i)`. The controller scans every
5 ms and reports a key after two equal scans: `{ dev: 'panel', ev: 'key', key, down }`.

### 3.7 The controller rule

Every controller is built with a frozen `io` of drive commands and sensor reads, imports nothing, and never sees the
host or a body: `tests/fax_mech.test.js` checks the `io` key sets, wraps them in proxies during a run of every
operation, and scans the sources for assignments to positions, speeds or currents.

| Controller | `io` |
|---|---|
| `DriveCtl` | `setMotor(state, amp)` |
| `ScanCtl` | `docSensor()`, `regSensor()` (and asks `DriveCtl` for steps) |
| `PrintCtl` | `strobe(dots, energy)`, `setCutter(volts, closed)`, `cutterHome()`, `paperSensor()`, `coverClosed()` (and asks `DriveCtl`) |
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
| `sim.ctl.liu.command({ op: 'relay', name: 'cml' or 'tel', on })` | none; `sim.liu.lineLoop()` for the exchange |
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

## 8. Assumed values the manual should replace

The first thing M0 reads (research.md 8.8). Each is in `src/machine/faxfo70.js` with its mark.

| Value | Now | Mark | Manual's place |
|---|---|---|---|
| Number of motors and the drive layout | One stepper, swing gear, forward = scan, reverse = record | [M] hypothesis, assumed | S-70 drive unit (cutter model) |
| Motor | 48 steps/rev, 0.04 N m, rotor 4e-7 kg m2, damping | [M] / [A] | Drive unit parts list |
| Steps per line | 8 / 4 / 2 (one step = 1/30.8 mm) | [A] | Drive unit, gear ratios |
| Gear trains | Ratios derived from roller radii; tooth stiffness, backlash 0.3 deg, inertias | [A] | Drive unit exploded view |
| Swing gear | +-12 deg travel, drag, mesh window and release | [A] | Drive unit |
| Step rates | 200 start, 600 max, ramp 4000 steps/s2, hold half current 50 ms | [A] | Circuit description, motor driver |
| Roller radii | Platen 6 mm, feed 8 mm, separation 9 mm; separation speed 0.7 of feed | [A] / [M] | Scanner frame, head frame |
| Document path | Sensors at -12 and +12 mm, feed roller +24, read line +32 | [A] | Scanner frame and CIS unit |
| Feeder forces | Separation 1.5 N, pad 1.5 N mu 0.6, feed 2 N, glass mu 0.2 | [A] / [M] | Scanner frame |
| Document size | US letter, 75 g/m2 | [A] (decision 5) | Specifications p.3, market |
| Head force, friction | 4.5 N, platen mu 0.9, glaze mu 0.15 | [A] / [M] | Head frame unit |
| Strobe blocks and time | 4 blocks, 1.2 ms each | [A] | Control PWB, head drive |
| Default mark energy | 0.25 mJ a dot (replaced by the thermal model) | [A] | Head data sheet |
| Roll | 216 mm wide, 65 um, 52 g/m2, 1/2 in core, 7.5 m left at a warm start | [M] / [A] | Specifications; FO-20PR |
| Print width | 216 mm (one summary says 210) | [A] | Specifications p.3 |
| Strip path | Cutter 14 mm, exit 30 mm beyond the head; 40 mm roll to head; paper sensor 5 mm before the head | [A] | Head frame, cutter |
| Cutter design | Guillotine on a cam, worm, own DC motor 12 V, home switch -8 to +45 deg | [A] | Drive unit (cutter model) |
| Cutter numbers | Motor R, kt, inertia; ratio 60; cut torque 0.12 N m; cam friction; 1.5 s timeout | [A] | Same; error code table p.31 |
| Relays | Two clapper relays, CML and TEL; armature numbers | [A] | TEL/LIU PWB circuit |
| Hook switch | Plunger 6 mm, 0.6 N, make at 4 mm; handset 0.17 kg | [A] | Cabinet, handset |
| Panel keys | FUNCTION, VOLUME pair, COPY/HELP, START, STOP; dome curve | [A] / [M] | Operation panel figure (S-70-OM) |
| Cover | Panel lifts on its rear hinge to 95 deg, latch, head lifts at 1.5 deg | [M] / [A] | Operation panel block, installation chapter |
| Handset size and body block-out | From the owner's photograph | [A] | Exploded views |
| Debounce and poll periods | 5 to 30 ms | [A] | Firmware is ours |
| Audio levels and modes | Placeholders | [A] | A recording (plan 10) |
