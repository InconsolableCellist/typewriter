# Dedicated word processor, c. 1980: research notes and plan

A third machine for the desk: a faithful physical recreation of the IBM 6580 Displaywriter System. It is a display
station with a separate keyboard, a diskette unit and a daisywheel printer. It also needs software that feels like the
real editor to use. **Not an emulator.** The editor's behaviour is reimplemented from the manuals.

Status: **research done, architecture decided** (2026-11-11). The filled spec is in four files beside this one,
with a PDF page cited for every value. The design that the build follows is in `architecture.md`; where this
plan and that document differ, that document is right.

| File | Contents |
|---|---|
| `hardware.md` | Display station, electronics module, keyboard, diskette unit, physical planning, colours |
| `printer.md` | The 5218 printwheel printer: mechanism, steppers, hammer, ribbon, panel, interface |
| `software-reference.md` | Textpack 4: every key and CODE combination, control codes, prompts and messages, format menus, limits |
| `software-screens.md` | Textpack 4: start-up, the menu tree with 80 x 25 grids, the typing screen, 13 keystroke scripts for tests |
| `architecture.md` | Module layout, interfaces, threads, data structures, tuning method, tests, budgets, milestones, open questions |

Corrections to the assumptions below, from the research:
- The keyboard uses **capacitive "fly-plate" key modules**, not buckling springs. The click is electronic, from a
  speaker in the keyboard that also sounds the 1 kHz beeps. Typematic: 350 ms delay, about 14 per second.
- The diskette unit has **no doors**: each vertical slot has a lever (vertical open, horizontal closed). The drives
  spin at 360 rpm from an always-on AC motor; steps take 5 ms and settling 35 ms.
- The logic is a flat **electronics module** (483 x 356 x 178 mm) that the display sits on.
- The desk fits: about 0.75 (printer, estimated) + 0.48 (module) + 0.25 (diskettes) m across, so no wider desk needed.
  The laid-out row spans x = -0.90 to +0.66 m on the 2.0 m desk (`architecture.md`, 3.1).
- Gaps the research could not fill: printer dimensions and dynamics (wheel inertia, hammer energy), phosphor
  persistence, the CPU clock, head-load time, and the full message list (the *Prompts and Messages Guide*,
  S544-2122, is not on Bitsavers).

## Ground rules
- **Names and marks: allowed for this machine** (owner, 2026-11-11). Unlike `element1971`, the power-on screen
  shows the initials and the menu titles keep the product names, as documented. The definition id is
  `wordproc1980`.
- **No original code, ROMs or font art.** Behaviour, layouts, prompts, timings and dimensions come from the
  documentation. The CRT character set is our own bitmap font, drawn to match the look (cell size, stroke weight,
  descenders), not traced from a dump. Message wording that has to match for authenticity is short functional UI
  text; keep it to what the manuals show the operator.
- **Physics first** (`docs/ARCHITECTURE.md`): keys, the printer and the diskette drives are mechanisms, not
  animations. The software layer is the one place where logic stands in for physics, as the real machine's
  firmware did.
- **No recordings available for now.** All sound is synthesised from mechanism state, like
  `src/audio/element-synth.js`. Leave a sample path open (`audio.samples`) for later.

## Network: what the next session needs
These hosts were blocked in the cloud session. On a local Claude Code session, or a cloud environment that allows
them, the research can go ahead:

```
bitsavers.org  www.bitsavers.org  bitsavers.mirrorservice.org  ftp.mirrorservice.org  kuiper.mirrorservice.org
sharktastica.co.uk  en.wikipedia.org  commons.wikimedia.org  upload.wikimedia.org
www.computerhistory.org  collection.sciencemuseumgroup.org.uk  raw.githubusercontent.com
typewriter.foxipso.com  typewriter.dan-a7b.workers.dev   (to check deploys)
```

## Sources
Bitsavers directory: `pdf/ibm/6580_Displaywriter/` (mirrors: `ftp.mirrorservice.org/sites/www.bitsavers.org/...`,
`kuiper.mirrorservice.org/sites/www.bitsavers.org/...`). List the whole directory first. It probably also holds operator
guides and Textpack references beyond those found by search.

| Document | What to take from it |
|---|---|
| S241-6248-1 / -2 *Displaywriter 6360, 6580 Product Support Manual* (May 1981, May 1982); -3 copy on sharktastica.co.uk | **The main physical source.** Exploded views, part names, keyboard modules (Type A / Type B), diskette drive mechanics, adjustments with tolerances, timings, power-on sequence, error codes |
| *6580 Machine Description* (Nov 1983) | Configurations; display 25 x 80 or 66 x 100 (large display); 6360 diskette unit single or dual; diskette 1 / 2D media |
| G544-0851-3 / -5 *General Information Manual* (Oct 1981, 1982) | Configurations, keyboard and function keys, printer models and speeds, physical planning (dimensions, weights, clearances, power) |
| G320-0158-0 *Technical Manual for the Technical Coordinator* (Jul 1984) | Diskette formats, system diskette, utilities, document structure, limits |
| *IBM Displaywriter and TEXTPACK 4* | Editor behaviour, screens, menus, prompts, function-key semantics |
| Operator / reference guides (if on Bitsavers) | Exact screen layouts and messages, step-by-step task flows |
| Printer manuals (5215, 5218, 5258 if found) | Mechanism, speed, printwheel geometry, carriage, platen, paper path, noise |
| MAME `ibm6580` driver (Sergey Svishchev, 2017; `src/mame/ibm/ibm6580*.cpp`, FDC uses an NEC 765) | Hardware behaviour reference only (keyboard protocol, display timing, FDC). Read it; do not copy code or ROMs |
| Photos: Computer History Museum catalogue 102685352 and 102665264, Science Museum Group co38528 and co38533 (diskettes), Muzeul de Calculatoare (2018), Wikimedia Commons | Proportions, colours, finish, labels' positions (not their text), cable routing. Prefer CC-licensed Commons images for anything kept in the repo |
| classiccmp.org threads (6360 filesystem, interface, CP/M-86) | Diskette format details, drive behaviour |

## Established so far (from search results, not yet read in full)
- The large display shows 66 lines x 100 characters; the standard display shows 25 x 80 (*Machine Description*).
- The 6360 diskette unit comes as a single or dual drive and takes "Diskette 1" or "2D" media (*Machine Description*).
- The diskette controller is an NEC 765 (classiccmp, consistent with the MAME driver).
- The Product Support Manual's contents list Type A and Type B keyboard modules.
- A MAME driver exists and is incomplete. A full emulator is out of scope anyway.

## Working assumptions to check (from memory, unverified)
Checked by the research; kept for the record. Results are in `hardware.md` section 7 and at the top of this file.
The keyboard is not buckling spring, and Type A / Type B are memory cards, not keyboard modules.
- Announced 1980. Logic is an Intel 8086 at about 5 MHz.
- The 8-inch drives are double-density, double-sided on 2D media, and spin at 360 rpm (standard for 8-inch).
- The keyboard is a capacitive buckling-spring design of the period, as a separate unit on a coiled cable.
- The printers are an element printer (5215), a daisywheel "printwheel" printer (5218) and an ink-jet printer (5258).
  Speeds are probably in the tens of characters per second.
- The CRT is green phosphor on a tilting and swivelling display.
- The editing software went through several "Textpack" releases. Pick one version (probably Textpack 4, since
  its manual is on Bitsavers) and stick to it.

## Spec sheet to fill in
Every entry needs a value and a source (`doc id, page`). Where only photos give a value, say so and give the method
(for example, scaled from a known 8-inch diskette or a keycap pitch).

**Display station**
- Overall dimensions and weight; tilt and swivel ranges; base footprint
- CRT: diagonal, phosphor colour and persistence, raster size on the glass, overscan, curvature, bezel and filter
- Character cell (dots), the character box within it, line spacing; cursor shape and blink rate; attributes
  (underline, reverse, intensified, blink); status and prompt line layout
- Controls: power, brightness, contrast (positions and kinds)
- Fan and power-supply noise sources (for synthesis)

**Keyboard**
- Dimensions, profile, angle, feet; cable
- Layout: every key's position, size and legend function (the function cluster and coloured keys); the Type A
  versus Type B difference
- Switch: force curve (pre-travel, buckling point, bottom-out), travel, actuation point, reset hysteresis; keycap
  profile per row; key pitch
- Typematic delay and rate, if any; any audible click (mechanical, or electronic from the display)

**Diskette unit**
- Enclosure dimensions; one or two drives; door, latch and lever mechanics; activity lights
- Drive: rotation speed, track-to-track step time, settle time, head-load time and sound, tracks and sectors,
  sector size per format, capacity per media type
- Format and file-system model as the software sees it (index, documents, labels)

**Printer** (choose one, most likely the daisywheel)
- Dimensions; platen diameter and length; paper path and bail; cover
- Printwheel: spoke count, character placement, diameter, rotation speed and acceleration, selection time
- Hammer: energy settings, impression control; ribbon (carbon or fabric, cartridge geometry, lift)
- Carriage: travel, speed, bidirectional or not; line feed time; pitch options (10, 12, 15, PS)
- Characters per second (nominal, and measured over real text); acoustic character

**Software (editor)**
- Power-on sequence and timing; loading the program diskette; first screen
- Task Selection menu and its tree: Create, Revise, Print, Paginate, Spell, Diskette utilities, and so on
- Typing screen: format line, status line, prompt line, scale line, cursor movement keys, insert and overstrike
  behaviour, word wrap, required space and carrier return, Page End, Paginate
- Function keys: each one's exact behaviour, prompts and error messages (Copy, Move, Delete, Find, Format,
  Instr, Code combinations)
- Document storage: naming, document index screen, timings (how long a save or a page read takes)
- Printing: queueing, background print while editing, the printer's status shown on the display

## How it fits the code
Decided in `architecture.md`. The first-cut mapping that stood here is replaced by this summary.

| Piece | Where | Notes |
|---|---|---|
| Machine definition | `src/machine/wordproc1980.js`, `wp-geometry.js`, `wp-keys.js`, registered in `src/machine/index.js` | One definition with five units (station, display, keyboard, diskette, printer), their placements, the desk layout and camera presets |
| App structure | `src/kits/typewriter.js`, `src/kits/wordproc.js`, loaded by `main.js` | The shared stage, desk, room, panel and loop stay in `main.js`. Switching machines is a page reload, as now |
| Mechanisms | `src/sim/wp/` (`WordprocSim`), behind the same `SimClient` contract | **Not** an `Action` inside `MechanicalSim`: none of the typewriter's common mechanism exists here. Keys are stems with capacitive fly plates; steppers and the hammer are integrated DOFs timed by controllers (keyboard scanner, printer processors, diskette adapter) |
| Printer | `printer-mech.js`, `printer-ctl.js` in `src/sim/wp/` | Moving carrier over a fixed platen in the `element1971` carrier frame. Emits the existing `strike` event, so `SoftWorld`, ink, emboss, the page pile and PDF export are reused |
| Software layer | `src/wp/` | Plain modules, no DOM, runs in Node. Generator tasks on a simulated clock. Input is scan bytes; output is an 80 x 25 buffer with attributes, speaker, diskette and printer commands. It never places ink |
| Diskettes | Data and file layout in `src/wp/disk/`; drive mechanics in `src/sim/wp/diskette-mech.js` | No doors: a lever per slot. Timing comes from the mechanism in the browser and from an analytic model of the same drive in Node tests. Work diskettes persist in IndexedDB |
| CRT | `src/render/wp/crt.js` | 80 x 25 data texture, our own 8 x 16 font, phosphor pass with two decay components, curved glass with halation in the shader (no bloom pass) |
| Sound | `src/audio/wp-engine.js`, `src/audio/wp-synth.js` | Synthesised from mechanism forces, speeds and events on three panned buses. The click and beep are the keyboard speaker |
| Assets | `tools/blender/build_wp_*.py`, `tools/wp/`, `docs/assets.md` | Procedural shells with clearance checks. Under 2 MB added per visit; nothing added to a typewriter visit |
| Tests | `tests/wp_*.test.js`, `tests/e2e/wp.mjs` | The 13 keystroke scripts, keyboard force curve and scan, printer cps, diskette timing, an e2e run that types, prints and reloads |

Pages typed and printed go to the existing finished-page pile and PDF export, as now.

## Phases
Phase 1 (research) is done. The build follows the milestones of `architecture.md` section 11, each shippable:

| M | Deliverable |
|---|---|
| M0 | Scaffolding: kits, units, desk layout, mechanism-host factory, block-out bodies. No visible change |
| M1 | Software kernel in Node: scheduler, screen, keys, start-up, menus |
| M2 | Storage and typing: diskette images and files, create and revise, the typing screen |
| M3 | Editing functions, format menus, pagination, Menu Bypass |
| M4 | On the desk: font, CRT, station, display and keyboard with the key mechanism, click and beep. First public version |
| M5 | Printer mechanism and controller, headless, tuned to 60 cps; print formatter and spooler |
| M6 | Printer on the desk: model, paper in and pages out, ink, sound |
| M7 | Diskette unit: mechanism, levers, inserting diskettes, sound |
| M8 | Finish: cold start, errors, spelling, budgets, contract documents |

## Decisions
- **Display: standard 25 x 80** (decided). The 66 x 100 large display was a real configuration, but less common, and it needs a bigger monitor.
- **Desk layout** (decided). The machine dominates the desk: the printer on the left, the dual 8-inch diskette
  unit on the right, and the display station in the middle at the front with the keyboard in front of it. The
  ashtray sits on the machine. The desk lamp is removed for lack of space, and the cables run out at the back.
  If the measured footprints do not fit the 2.0 x 1.2 m desk (`desk.glb`), widen the desk (decided).
- **Printer: the daisywheel printwheel printer (5218)** (decided).
- **Software release: Textpack 4** (decided).

## Owner's decisions on the architecture's questions (2026-11-11)
Full table in `architecture.md` section 13.2.
- **Warm start** at TASK SELECTION. `?cold` is fully physical: switch on each unit at its own power switch, then the
  real self-test and program load.
- **Names and marks are allowed** on this machine (initials on the power-on screen, product names in menu titles).
- **One combined program diskette** (a documented configuration), no volume swapping.
- **Diskettes persist** between visits; a document left open needs recovery, as after a power cut.
- **Sheet feeder, no hand model:** the printer's sheet feeder feeds each sheet automatically, with a toggle for
  manual feed.
- **Real keyboard:** the two Alt keys are CODE and ENTER, Enter is RETURN, function keys reach the function clusters.
- **Ashtray** on top of the diskette unit; fresh paper and finished pages in front of the printer.
- **Night:** just dim, lit mainly by the green glow of the screen.
- **Spelling:** a shipped public-domain word list (browsers have no script API for spell checking), in M8.
- **Stereo** output; **three sample documents** of our own text on the first work diskette.
