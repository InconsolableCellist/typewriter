# Typewriter

Three writing machines on a desk in the browser (WebGL2, Web Audio), each built as a simulation and not as an
animation:

- `frontstrike1926`, an open-frame front-strike manual typewriter, c. 1926;
- `element1971`, an electric single-element office typewriter, c. 1971;
- `wordproc1980`, the IBM Displaywriter word processor, c. 1980: display station, keyboard, dual 8-inch diskette unit
  and printwheel printer.

Live at **https://typewriter.foxipso.com**. The two typewriters are generic machines of their period, with no specific
make or model. The word processor is a particular product, recreated from IBM's manuals.

On the typewriters, the mechanism, paper and ribbon are integrated, so print darkness, spacing, jams and skew come out of
the simulation. On the word processor, the printer, diskette drives and keys are integrated mechanisms in the same way.
Their firmware is a set of controllers that can only switch motor phases and coil currents and read sensors. The
editing software is a reimplementation of IBM's Textpack 4 from the manuals; it is not an emulator. The sections below
say, subsystem by subsystem, what is simulated and to what depth. The contracts are in `docs/ARCHITECTURE.md`, and the
word processor's design and research are in `docs/displaywriter/`.

This project was substantially created using AI-assisted tooling.

## Running it

```
npm install
npm run dev        # http://127.0.0.1:5317
npm test           # Node tests (424 in 35 files)
npm run e2e        # browser test, under a private Xvfb, never your display
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://127.0.0.1:5317
```

**Deploy.** The site is Cloudflare Workers static assets with no Worker script: `npm run build`, then
`npx wrangler deploy` uploads `dist/` as it is (`wrangler.jsonc`, route `typewriter.foxipso.com`). `public/_headers` is
copied into `dist/` and sets caching. Asset fetches carry the build id (`src/asset-version.js`).

**Choosing a machine.** The **machine** menu in the Settings panel (bottom left) lists all three and remembers the
choice. `?machine=frontstrike1926`, `?machine=element1971` or `?machine=wordproc1980` selects one in the URL. Switching
machines reloads the page, and a visit downloads only that machine's family of code and assets.

**On every machine.** The Settings panel sets the time of day (drag the sky strip) and the weather: rain and
thunderstorms, with lightning, and thunder that arrives after the flash by the time sound takes to cover the distance.
**weather sound** turns the weather's audio off. Finished pages go to a pile on the desk; click the pile to browse
them and save them as PDF. Pages last for the current session.

## The front-strike typewriter, c. 1926 (`frontstrike1926`)

![The open-frame front-strike typewriter on the walnut desk, a sheet of typed paper in the carriage, the banker's lamp and ashtray beside it](docs/images/frontstrike1926.png)

A manual typebar machine on an open, japanned cast frame, with a moving carriage, a mainspring drawband, a margin bell
and a line-space lever. It has 41 type bars (82 characters, 10 per inch) and six controls: the space bar, two shifts,
shift lock, backspace and margin release. Type on your keyboard, or drag any part: keys, type bars, levers, the
carriage release, knobs, ribbon, paper. Drag empty space to orbit, right-drag to pan, use the wheel to zoom, and
double-click empty space to reset the view. Click the paper stack on the left to wind in a fresh sheet. Hold a platen
knob and move the pointer up or down to roll it. The carriage release is a toggle: click it, slide the carriage, click
it again. The banker's lamp comes on after dark, and its pull chain works. The **Print Point** window shows a live
close-up of the line being typed, the slug and the ribbon. Drag the paper over the lit cigarette at your own risk; the **ashtray** button hides the ashtray and
lighter.

### What is simulated, and how deeply

| Subsystem | Model | Depth |
|---|---|---|
| Mechanism (`src/sim/mechanics.js`, `actions.js`) | Every degree of freedom is integrated with symplectic Euler at **384 kHz** (8 substeps per audio sample at 48 kHz), with real one-sided contacts and per-element sleeping. These DOFs are the keys, bars, universal bar, rocker, fixed and loose dogs on a toothed rack, carriage, shift, platen with a detent star wheel, line-space lever and pawl, bell hammer, ribbon vibrator, paper release and bail | Rigid-body dynamics with contact. Nothing in the code says "if a key is pressed, advance the carriage". Spacing, ratcheting on return, failure to space on a weak press, and jams all emerge |
| Key to bar | A one-way link: the key can only pull the bar, so the last 14 % of the arc is ballistic free flight. A press under about 20 N does not reach the platen | Integrated. The key force curve in the definition (5.7 N at first movement, about 15 N near bottom) is measured from the model, not imposed |
| Jams | Active bars collide with each other near the type guide (segment-to-segment distance). A jam stays until you pull a bar back | Emergent |
| Slug on platen | Hunt-Crossley contact over a force-indentation table computed for each glyph face: a Winkler foundation integrated over the glyph's 96 x 96 height field (0.05 mm texels), with slug skew and the curvature mismatch | Pre-computed contact law. A period sees higher pressure than a W and can perforate the paper |
| Paper (`src/soft/paper.js`) | A 30 x 70 XPBD sheet at **480 Hz** substeps on the main thread, colliding with the platen, pan, table and desk. The grip at the feed rolls and bail is a stick-slip force balance | Soft body, with one approximation: paper is nearly rigid in its plane, so the in-plane force balance is solved on the sheet as a rigid lamina (3 DOF) and the XPBD mesh follows |
| Ribbon (`src/soft/ribbon.js`) | A rope of variable free length between two spool DOFs, past guide posts and the vibrator fork. The 5 m ribbon carries a 2D ink map at 6 px/mm that depletes where it is struck | 1D soft body with a 2D ink map |
| Ink and emboss (`src/soft/print.js`) | Each strike event becomes a pressure field from the slug's relief, skew and measured indentation, applied where the strike meets the actual sheet. Ink transfer follows pressure, ribbon ink, weave and paper fibre noise; embossing and perforation have their own thresholds | Physically based, with calibrated constants (`inkHalfPressure`, `perforationPressure` in the definition) |
| Machine condition | Per-bar skew, offset and leverage scatter from a fixed seed | Randomised within set limits |
| Typing on the PC keyboard | Each keydown applies a fixed, timed finger force (a calibrated Hill-type finger) with a little randomness. This is the one sanctioned shortcut | Approximated. The strength of your real keystroke is not measured |
| Sound (`src/audio/`) | Recorded cuts from "ASMR Typing on 1950s Typewriter", supplied by the owner, are played by contact events (slug, key bottoming, bar return, shift stops, each rack tooth, each platen detent, carriage stop, bell), with level and brightness set by the measured force or speed. Bar-on-bar clashes and carriage rail noise come from a modal model fitted to a public-domain recording (resonators plus 24 ms and 12 ms measured body responses, commuted synthesis), which also voices everything until the samples load. A small synthetic room and a radiation filter follow | Recorded, triggered by physics. The return ratchet and its end-stop thud are not fitted to any recording (`public/assets/audio/SOURCES.md`) |
| Rendering (`src/render/`) | three.js with an HDRI room, PCSS contact-hardening shadows (12 blocker and 16 filter taps), GTAO at half resolution with a Poisson denoise folded into the materials, a cavity term, 4x MSAA plus SMAA, and procedural Blender frame and texture sets (`docs/assets.md`) | Visual only. The frame and textures are generated, not scanned from a real machine |

## The electric single-element typewriter, c. 1971 (`element1971`)

![The electric single-element typewriter on the desk, its type element at the print point of a sheet in the fixed platen](docs/images/element1971.png)

A motor-driven office machine with a fixed platen and a carrier that travels along it. A one-revolution clutch tilts
and rotates a type element to one of 88 characters (4 bands by 22 columns) and throws it at the paper at a set
strength, however hard you press. Enter is its powered Return. Delete is the correction key: it backs up one space, and
retyping the wrong letter lifts it off with the correction tape. Hold space or backspace to repeat. Tab runs the carrier
to the next set stop, or past every stop for as long as you hold it. Click the top cover to open it. The carrier's
momentum sways the table a little when it stops hard, and the lamp's pull chain swings with it.

### What is simulated, and how deeply

| Subsystem | Model | Depth |
|---|---|---|
| Motor (`src/sim/element-action.js`) | A two-pole induction motor on 60 Hz with a Kloss torque curve, rotor inertia and fan load, about 3450 rpm, driving the print shaft at 3.71:1 (15.5 cycles a second) | Integrated. A load too heavy for the motor stalls it, and switching it off stops everything |
| Clutches and cams | Print, operational (space, backspace, index, return) and shift shafts, each with a one-revolution clutch, a latch and a stop. The cams are tabulated profiles; their followers are coupled to the shafts by stiff springs, so the motor feels each cam's load | Integrated shafts and followers. The cam shapes are smooth chosen profiles, not measured from a real machine |
| Selection | Binary latches into a whiffletree, then tilt and rotate tapes into the element's tilt and rotate DOFs, with detents. A floppy tape or a mistimed stop mis-seats the element and prints the wrong face or a seat error | Integrated (the tests pin the element's resulting motion) |
| Strike | A cam-thrown rocker carries the element into the platen through the same glyph-face contact law as the manual machine. The impression control shortens the cam rise and so sets the throw speed | Integrated. The impact does not depend on the finger |
| Keys, rollover and type-ahead | Key levers trip interposers. A second key struck during a cycle waits and then prints, and further keys wait at the block | Integrated |
| Carrier, margins, tab, line space | The common mechanism of the manual machine, solved in the carrier's frame. The power return winds the carrier with a force that tracks a speed of 1.05 m/s (24 N at most) and slows over the last 14 mm to the margin. Tab runs to a stop with real stop contact | The return drive is a speed-tracking force, not a modelled clutch and drum. Everything else is integrated |
| Correction tape | A lift-off tape on the carrier, lifted by its own cam on a correcting stroke. It takes 97 % of the ink in the struck area and leaves the dent | Integrated lift; the ink removal is a fixed fraction scaled by pressure |
| Paper, ribbon, ink | `SoftWorld`, as on the manual machine, with the ribbon riding the carrier | As above |
| Table sway (`src/render/desk-sway.js`) | One lateral mass on a spring (6.5 Hz, 30 kg), driven by the carrier's momentum changes | A one-mode model, outside the mechanism |
| Element motion blur | The element is drawn at several poses across the frame time | Rendering only |
| Sound | Cut from a recording, supplied by the owner, of an electric single-element typewriter: print cycles, space, backspace, correction, return start and stop, tab, a carrier-running loop and the bell. Each cut is played by the mechanism's clutch and carrier events. The motor hum and the key touches are synthesised (`src/audio/element-synth.js`): oscillators locked to the rotor speed, and damped sine pings | Recorded and synthesised. The recorded print cycle plays at one level, since the strike strength is fixed |

## The IBM Displaywriter, c. 1980 (`wordproc1980`)

![The IBM Displaywriter on the desk: the daisywheel printer on the left, the display station and its keyboard in the middle with green text on the screen, the dual diskette unit on the right](docs/images/wordproc1980.png)

The whole system is on the desk: the display station (a 25-line green-phosphor display on its electronics module), the
84-key keyboard, the 6360 dual 8-inch diskette unit, and the 5218 printwheel printer with its sheet feeder. It runs our
reimplementation of Textpack 4. The menus, prompts, function keys, stored codes, formats, pagination, spelling and
printing behave as the manuals document them. Documents are stored on the simulated diskettes, timed by the simulated
drives, and kept between visits in IndexedDB. Printing runs the printwheel, carrier, hammer and platen mechanisms onto
paper, and finished pages go to the pile. Open a drive's lever to change diskettes, and use the printer's panel keys,
cover and power switch, the module's power rocker, and the display's contrast and brightness knobs, tilt and swivel.
The quick-start packet and sticky notes on the desk explain the keystrokes. The binder on the diskette unit and the
shelf beside the desk link to IBM's scanned manuals on Bitsavers.

The machine starts warm, at TASK SELECTION. `?cold` starts with everything switched off: switch on each unit, then
the power-on test and the program load run (about 15 s for the printer's self-test and about 10 s for the program
load).

**Keys.** Type on your keyboard, or click the machine's keys. Left Alt is CODE. Right Alt or keypad Enter is ENTER.
Enter is RET (carrier return). Esc is CANCL. F1 to F10 are REQST, PRINT, FIND, GO TO, MOVE, LINE ADJ, SPELL, CHG FMT,
GET and PAGE END. The **keys** button in Settings lists the rest. Keys with no PC counterpart are clicked.

**Moving around.** The camera moves only when you ask it to. It stands at one of five **stations**, each seen
head-on: Desk, Printer, Computer, Diskettes and Shelf. The arrows at the window's edges walk along the row (hover to
see where one goes; on a touch screen they are always named), and the bar at the top lists the stations. Each station
has **focus items**, which are closer looks: for example Screen, Keyboard, Notes, Controls and Rear at the Computer;
Slots, Levers, Desk file, Manual and Quick start at the Diskettes; Panel, Mechanism and Paper path at the Printer.
**Way markers**, circles with an arrow, sit over each place you can go from here. They fade when the pointer is still,
and the bar's ◉ button hides them. **Back** returns from a focus item to its station. Clicking a key or a control
never moves the camera. **Free view** (the ◎ button) lets you look around freely: drag to orbit, right-drag or
Shift-drag to pan, use the wheel or pinch to zoom. Turning free view off returns the camera to the nearest station.
These shortcuts never reach the machine: Ctrl+Shift+← and → for the neighbouring station, Ctrl+Shift+↓ for Back,
Ctrl+Shift+↑ for free view, or keypad 4, 6, 2 and 5. `?view=computer/keyboard` starts at a given view.

**Screen card.** The card at the top left shows the display's picture flat and readable, whatever the camera shows.
Fold it from its header, resize it from its corner, or hide it with the **screen card** button in Settings. The
**sheet feeder** button switches the printer's feeder off, and you then lay each sheet by clicking the fresh stack.

### What is simulated, and how deeply

The design fixes three kinds of thing (`docs/displaywriter/architecture.md` section 2):

- **Mechanisms**, integrated from forces.
- **Controllers**, the real machine's firmware. They run on deadlines, may only set motor phases and coil currents and
  read sensors, and never write a mechanical state. Tests check this for the printer and the drives.
- **Software**, logic on a simulated clock that reaches the units only through device commands and completions.

In the browser, durations such as characters per second, seek, settle, rotational latency and spin-up are outcomes
of the mechanisms, not scripted. The research docs mark every value that is *assumed* or *tuned* rather than
documented, with the page it rests on.

| Subsystem | Model | Depth |
|---|---|---|
| **Software** (`src/wp/`) | Textpack 4 rewritten from IBM's manuals (Operator Reference Guide, training books, the 13 worked keystroke examples): power-on test codes and program load, TASK SELECTION and its menu tree, the typing screen with every editing function listed in architecture 7.8, format menus, pagination with keeps and widow control, Menu Bypass, Work Diskette Tasks (delete, duplicate, rename, erase, initialise, condense, recover), the print spooler with background printing, and Spelling Tasks. It runs as generator tasks on a simulated clock, with no DOM and no wall clock, so it runs headless in Node | **The real software's behaviour, rewritten, not emulated.** No 8086 code, ROM or microcode is used or run; the CPU is not simulated. Program Diskette Tasks other than the work station description, merge, math, column layout and a few others are present as menus only. Messages the manuals do not quote are our own plain wording, marked `source: 'ours'` |
| Spelling | A public-domain word list (12dicts, 72,499 words, 114 KB packed), loaded from a `dictionary` entry on the program diskette. Hyphenation points come from rules, because the list has none | Behaviour as documented (no suggestions, as on the real machine). The dictionary is not IBM's |
| Diskette file system (`src/wp/disk/`) | Raw sector images in the documented geometry: Diskette 1 (77 tracks, 1 side, 1,110 data sectors of 256 bytes) and Diskette 2D (77 tracks, 2 sides, 3,848 data sectors). Volume label, free map, index, document heads and page chains are our own layout. The program diskette's segments are sized so the documented waits come out of the drive | Geometry, capacities and timing are faithful. **The on-disk format is ours**, because IBM's is not documented |
| **Diskette drives** (`src/sim/wp/diskette-mech.js`) | Per drive: a capacitor-start induction motor (1800 rpm synchronous) on a belt to the hub; the lever with a detent at each end; the collet, cammed from the lever, gripping the diskette by friction so it spins up because the hub drags it; the diskette's slide in its guide; a head stepper (1.8 degrees a track, a stop pin behind track 00); the head-load solenoid, bail and arm with a dashpot | Rigid-body dynamics at 384 kHz with contact. The diskette turns at 360 rpm (index period within 0.6 ms of 166.7 ms) because of the motor and a 4.94:1 pulley ratio; the drive is ready 0.29 s after the lever switch makes. The lever cannot close on a half-inserted diskette |
| Diskette adapter (`diskette-ctl.js`) | One step every 5 ms and 35 ms settle (documented). Recalibrate is at least 77 reverse steps against the stop pin (420 to 435 ms). The head loads after the settle (41 ms in the model; **40 ms assumed**, as no figure is documented) and lifts after 2 s idle. Sectors are found by the ID fields the mechanism reports as they pass the head, with three retries; the index period is watched for ready | Firmware logic over sensors. Sector bytes stay with the software; the mechanism decides when they arrive |
| **Printer mechanism** (`src/sim/wp/printer-mech.js`, `stepper.js`) | A 96-petal printwheel on a three-phase variable-reluctance stepper (torque from phase currents with first-order lag) and a viscous inertia damper; each petal a sprung DOF. A carrier on a leadscrew (200 steps a revolution, 1/240 in a step) through a sprung follower. The platen turned by a belt from the index stepper (1/96 in a step). A hammer armature thrown by its coil current into the petal, and the petal's face into ribbon, paper and platen through the same glyph-face contact tables as the typewriters. The ribbon stepper and lift cam, the paper-handling cam motor with its followers and bail, the access cover, panel keys, power rocker and fan | Rigid-body and motor dynamics at 384 kHz with contact. Steppers can lose steps when asked too much. Ink appears only from strike events |
| Printer controller (`printer-ctl.js`) | Command FIFO, an escapement planner that fires on the move, closed-loop wheel selection from the rotor pickups, a hammer flight-time servo per force group (the first six to eight characters of each group after power-on print unevenly, as the manual says), index, ribbon, paper cam, panel, cover interlock (error 06) and a 15 s self-test | Firmware logic over sensors. Results: 60 cps on a 10-pitch line (documented rating), 45 to 60 cps on English prose, at least 30 cps on the worst alternation, and a 16-step line feed within 66 ms |
| Printer parameters | Documented: 96 petals, step sizes, the 60 cps rating, ribbon size. **Assumed or tuned**: printer depth, wheel radius and inertia, petal order (by English letter frequency from home `a`), carrier mass, slew and ramp. Selection torque (0.518 N m) and hammer energies (1.14 / 2.09 / 3.18 mJ) are tuned by `tools/wp/calibrate_printer.mjs` to the 60 cps rating and to the ink model | Calibrated where the sources are silent (`docs/displaywriter/architecture.md` 6.4 to 6.8, 13.3) |
| Paper and ribbon in the printer | The typewriters' `SoftWorld` in the printer's frame: the sheet, the film ribbon on the carrier, ink and emboss. The sheet feeder's hopper and pick are modelled | The paper's path inside the feeder is not modelled (no source shows it); the soft body lays the delivered sheet on the stacker plate |
| **Keyboard** (`src/sim/wp/keyboard-mech.js`, `keyboard-ctl.js`) | 84 key modules, each a stem and a capacitive fly plate (the module the service manual describes) in one conservative system: return spring, a toggle spring and the plate's snap. Make (at 1.75 mm), break (at 1.25 mm), hysteresis and the tactile drop all emerge. The scanner reads the pad capacitance: one position every 52 µs, a pass every 5 ms, typematic after 350 ms at 14 a second, a 4-byte buffer, one byte a millisecond over the link | Integrated at 384 kHz on the main thread, where the browser's key events arrive. Force within the documented 40 to 75 g and travel 1.5 to 3 mm; the exact curve, scan period and link time are **assumed** |
| Station | The electronics module's power and its shaded-pole fan (about 3000 rpm), integrated against air drag. The display's tilt and swivel are a heavy joint with mass, stick-slip friction and viscous drag. The knobs and the rear panel's self-test LEDs are logic | The fan is integrated. Tilt, swivel and the knobs are simple models on the main thread, outside the mechanism host |
| **CRT** (`src/render/wp/crt.js`) | A GPU character generator. The software's 4 KB buffer (80 x 25, a character and an attribute per cell) is a texture, and the font is our own 8 x 16 drawing to the documented cell metrics. A phosphor pass draws the 640 x 400 raster at 2 x 2 samples a dot into a 1280 x 800 half-float target with two after-glow components, **30 ms and 250 ms**. A curved glass picks up the room's reflections and adds halation from the target's mips. The spot defocuses toward the corners. The cathode warms up over about 6 s, and at switch-off the deflection collapses to a fading spot | Modelled: the dot raster, attributes (reverse, bright, underline, blink), the two-component decay, halation, warm-up and switch-off. **Not modelled**: the beam's scan in time and refresh flicker, the deflection geometry, the real phosphor's spectrum and decay curve (the type is undocumented, so both constants are assumed). The scan-line gaps, mains beat, grain and snow are stylised: lines finer than about 3.5 screen pixels are thinned to every 2nd or 4th line to avoid moiré. The IBM character ROM was not used |
| Screen light | A green spot light from the glass toward the keyboard, with a 512 px shadow map updated every third frame, plus a wide unshadowed wash. Its intensity is the lit fraction of the buffer times the beam level and contrast. At night it is the room's main light | Approximated: two lights, not area emission from the glass |
| **Sound**, recorded | From the owner's recordings (`public/assets/audio/SOURCES.md`, architecture 10.4): single head steps, seek bodies played as overlapping 12 ms grains at each step so any seek length sounds right, and head-load clacks, all from a video of a running Displaywriter, triggered by the drive mechanism and scaled by its speeds. Key presses and releases are cut from a recording of an IBM beam spring keyboard, triggered by each stem's felt and top-stop contacts and scaled by stem speed | Recorded, triggered by the mechanism. The recordings' own level balance is kept within 2 to 4 dB (tested). The key sounds come from a beam spring keyboard, the closest recording available, and are sorted by level and spectrum, not by identified key |
| Sound, generated from analysis | The running machine's hum and air: the 16 strongest tones and the third-octave noise floor of the recording's idle stretches, rebuilt as wandering sinusoids and band-passed noise and scaled to this machine's 60 Hz line, following the drive motors' and fan's speeds. The display's 15.03 kHz line whistle | Synthesised to a measured spectrum (bands within 3 to 3.5 dB, tones within 1 dB). Nothing loops |
| Sound, synthesised | The whole printer (no recording of it exists): strikes, carrier, wheel selection, line feed, ribbon, cam motor and fan, from the mechanism's contact forces and motor torque ripple exciting small modal bodies, heard through the covers. The keyboard speaker's click and 960 Hz beep (measured from the recording) through a small cone model. The drive levers and the diskette sliding in, which are placeholders. The display's bearing creaking as it turns | Synthesised from forces. All the printer levels are **assumed**: no recording and no dB figure exist |

Models: each unit is built procedurally in Blender (`tools/blender/build_wp_*.py`) to the documented sizes and
compared with reference photographs (see below). `docs/displaywriter/models.md` lists what is still not matched for
each unit. The key legends use a Helvetica stand-in, and the 92-character and Dvorak keyboards are not modelled.

## How it is verified

- **Node tests** (`npm test`; 424 tests in 35 files, all passing at the time of writing; none needs a browser):
  - `mech`, `mech_stress`, `mech_acoustics`: the manual machine. Key force and impact speed, one pitch per keystroke
    only after release, failure to space on a weak press, jams that form and clear, English at 120 to 140 wpm with no
    jam, the line-space lever, bell and margins. Energy never exceeds the work done, every stiff contact is within the
    integrator's stability limit, extreme grabs stay bounded, and modal states return to exact zero.
  - `element`: the motor speed and cycle rate, selection, rollover and type-ahead, shift, correction, return and tab,
    stalls, mistimed clutches and floppy tapes, and the energy budget.
  - `soft`, `soft_clearance`, `soft_integration`, `pages`, `burn`: paper feed, skew and grip, ribbon clearances, and
    ink and perforation from real strikes.
  - `wp_*` (24 files), for the word processor:
    - The 13 keystroke scripts of `docs/displaywriter/software-screens.md`, checked cell by cell against 25 x 80
      screen fixtures transcribed from the manual's grids (`tests/fixtures/wp-screens/`).
    - The editing functions, typing, pagination, spelling and work-diskette tasks.
    - The printer at 60 cps, column accuracy within 0.03 mm, no lost steps in 1000 random moves, and the flight-time
      servo. The definition must match what the calibration tool computes.
    - The drives against the analytic timing model (within 4 ms over 20 operations), plus spin-up, recalibrate,
      retries and lever interlocks.
    - The key force curve and scanner, the CRT font's metrics, the sound levels against the recording, the view
      graph and the desk layout.
    - Neither controller writes a mechanical state.
  - `terminal`: the teletype mode's parser.
- **Browser tests**, run only through `tests/e2e/xrun.sh` (a private Xvfb): `smoke.mjs` (`npm run e2e`) loads the page
  in Chromium and takes screenshots; `pages.mjs` retires a sheet, browses it and saves it as PDF; `terminal.mjs`
  covers terminal mode.
- **Reference photographs.** The word processor's units are modelled from IBM's drawings and photographs (Bitsavers,
  the 1982 brochure, the setup and service manuals) and the owner's photographs in `docs/displaywriter/refs/owner/`.
  Each unit was rendered from each photograph's viewpoint and checked side by side
  (`tools/blender/render_wp_*.py`, `compare_wp_*.py`). For the keyboard, the cameras of two photographs were solved
  from 15 known points each (4 and 6 px rms), and the browser's own render was matched to them;
  `docs/displaywriter/review/` holds before and after images.
- **Recordings.** The sound levels are checked against levels measured in the source recordings, and the fitted modal
  model has A/B excerpts in `tools/audio/proofs/`.

## Terminal mode

A typewriter can be used as a paper teletype on a real shell on your own computer. Everything you type goes to the
shell, and the machine prints only what the shell sends back: every character is a key press on a real bar, through
the real strike, ink and sound paths. It is not a screen terminal: there is no cursor addressing and no scrolling back.

To start it, run the bridge explicitly in one terminal and the page in another, then open the URL the bridge prints:

```
npm run term       # prints http://127.0.0.1:5317/?terminal=<token>&termport=5318
npm run dev
```

The bridge is never started by anything else. Alternatively click TTY in the panel's action row and paste that URL.
Leaving terminal mode (the exit button, or closing the tab) hangs up the shell.

- **Keys.** Plain keys, Enter, Backspace, Tab, Ctrl-letter and the arrow keys go to the shell. Ctrl-C also clears the
  print queue. Browser-owned shortcuts (Ctrl-W, Ctrl-T, Ctrl-N, F5) are not delivered; paste with Ctrl-Shift-V.
- **Printing.** Lines wrap at the machine's printable width (75 columns at 10 cpi), which the shell is told as
  `COLUMNS`. `TERM=dumb`, `PAGER=cat`. Tabs are expanded to spaces. BS steps the carriage back and the next character
  overstrikes; a shell's BS, space, BS erase counts as one step back, since nothing can be erased on paper. BEL rings
  the bell. A new sheet is fed automatically when one runs out.
- **Pace.** Standard pace is set by the mechanism's own state (key up, escapement at rest, carriage arriving) and is
  about 8 characters a second (slower across shift changes; a carriage return costs about a second). The **fast** button
  switches on `typing.unlimited` (no bar collisions, one pitch per keystroke), about 35 characters a second, which is
  not realistic; it goes back to the panel's own setting when you leave fast mode.
- **Prompt.** Under bash, your `~/.bashrc` still runs, then the prompt is set to a plain `$ `, since a screen prompt
  would be typed out in full for every command.
- **Unsupported.** Full-screen programs (`vim`, `top`, `less` without `PAGER=cat`, and anything using the alternate
  screen or cursor addressing): the strip at the top of the page says so when one is detected. Colours and titles are
  stripped. Non-ASCII characters print as `?`.

### Security model

This exposes a shell to a browser, so the bridge (`tools/term-server.py`, Python standard library only) is deliberately
narrow:

- It binds `127.0.0.1` only and has no option to bind anything else. It never listens on any other interface.
- Every run generates a new 256-bit random token, printed inside the page URL. A connection without the correct token
  is refused (constant-time comparison). The token lives only as long as that run.
- The `Origin` header must be the local page's origin (`--page-origin`, default `http://127.0.0.1:5317` and
  `http://localhost:5317`) and the `Host` header must be `127.0.0.1` or `localhost` on the bridge's port, which covers
  cross-site pages and DNS rebinding.
- One session at a time; a second connection is refused while one is open. When the page goes away the shell is hung up.
- It runs only your own `$SHELL` as you, with `TERM=dumb`, `PAGER=cat` and `COLUMNS` set; no other program and no
  remote access.
- Stop it with Ctrl-C in its terminal. Treat the printed URL like a password while it is running.

Output back to the page is flow controlled: when the print queue is long the bridge stops reading from the PTY, so a
long-running program blocks instead of filling memory (a real teletype's serial line behaved the same way).

## Credits and licences

The code is released under the MIT licence (see `LICENSE`).

- HDRI: "Combination Room" from Poly Haven, CC0.
- Recordings, fitted acoustic data and proofs: see `public/assets/audio/SOURCES.md`.
- Spelling word list: 12dicts, public domain (`docs/assets.md`).
- Generated assets and their caveats: see `docs/assets.md`.
