# Dedicated word processor, c. 1980: research notes and plan

A third machine for the desk: a faithful physical recreation of the IBM 6580 Displaywriter System. It is a display
station with a separate keyboard, a diskette unit and a daisywheel printer. It also needs software that feels like the
real editor to use. **Not an emulator.** The editor's behaviour is reimplemented from the manuals.

Status: **research not started.** This file is the hand-off. It records what is already established, the sources to
read, the spec sheet to fill in, and how the machine fits the existing code. The session that wrote it could not reach
the sources (see *Network* below).

## Ground rules
- **No names or marks.** As with `element1971` and `docs/assets.md`, nothing shows a manufacturer name, logo or
  model number. The menu name is something like "Dedicated word processor, c. 1980", and the definition id
  is `wordproc1980`.
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
Do not build on these until a manual confirms them.
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
Same contracts as the other two machines (`docs/ARCHITECTURE.md`). New pieces:

| Piece | Where | Notes |
|---|---|---|
| Machine definition | `src/machine/wordproc1980.js`, registered in `src/machine/index.js` | Several bodies: display, keyboard, diskette unit, printer; each with dimensions, masses and camera presets |
| Keyboard mechanism | `src/sim/` key DOFs as now | Buckling-spring force curve; a key emits a *scan event* at the buckling point instead of driving a type bar. The real-keyboard shortcut stays the same (timed finger press) |
| Printer action | `src/sim/printwheel-action.js` behind the Action interface | Moving carriage over a fixed platen, the same frame trick as `element1971` (`SoftWorld.carrierOffset`). Wheel rotation DOF with motor torque limits; hammer DOF with Hunt-Crossley contact on the glyph face, so ink, emboss and paper are reused unchanged |
| Software layer | `src/wp/`: document model, editor, screens, diskette file system | Plain JS with no DOM, so it runs and tests in Node. Input is scan events; output is a character grid plus attributes. It drives the printer the way `src/terminal/driver.js` drives keys: by commanding the mechanism, never by placing ink |
| Diskette drives | `src/wp/diskette.js` (timing model) + mechanism DOFs for door, latch and head load | All file operations take real time (head load, seeks at the step rate, rotation latency) and queue sound events |
| CRT | `src/render/crt.js` | Character grid to texture with our own bitmap font; a phosphor shader with persistence (decay over frames), bloom, slight curvature, raster lines, glass reflection of the room HDRI |
| Sound | `src/audio/wp-synth.js` | Modal and noise synthesis: key buckle and bottom-out, fan hum, CRT whine (optional, quiet), head load clunk and seek ticks, printwheel whir, hammer, carriage, line feed |
| Assets | `tools/blender/build_wp_*.py`, `docs/assets.md` | Shells built procedurally to the spec sheet, with clearance checks like the existing builders. Materials reuse `materials.py` (textured plastic, painted steel), encoded as AVIF |
| Tests | `tests/wp-*.test.js`, `tests/e2e/` | Editor behaviour from manual examples (keystroke script, then expected screen), diskette timing, print timing in cps |

Pages typed and printed go to the existing finished-page pile and PDF export, as now.

## Phases
1. **Research.** Fill in the spec sheet above, with page references. Collect Commons photos, then decide the
   printer model and Textpack version. Deliverable: this file with every field filled in, plus reference images
   in `tools/gen/raw/` (gitignored) and their URLs listed here.
2. **Editor in Node.** Document model, typing screen, function keys, Task Selection menu, diskette timing.
   Keystroke-script tests taken from the manuals' worked examples. No graphics.
3. **CRT and keyboard on the desk.** Display station and keyboard models, the CRT shader and the bitmap font,
   with the editor running on screen. Synthesised key and fan sound.
4. **Printer.** The printwheel action, hammer and carriage physics, ink on the existing paper. Print from the editor.
5. **Diskette unit.** Model, door and latch interaction, inserting and removing diskettes on the desk, drive sounds.
6. **Polish.** Power-on sequence, errors (no diskette, door open, printer cover open), the size budget (target
   under 5 MB added per visit), performance on integrated GPUs.

## Decisions for the owner
- Which printer: the daisywheel (most natural next to the other two machines) or the element printer.
- Which software release to reproduce. Textpack 4 is suggested, because its manual is available.
- Desk layout: the word processor replaces the typewriter on the desk (as the machine menu does now), or shares it.
- Standard 25 x 80 display or the large 66 x 100 display.
