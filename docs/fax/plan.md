# Fax machine, c. 1988: research notes and plan

A fourth machine for the desk: a desktop Group 3 facsimile machine with a thermal paper roll, a document feeder, a
handset and a telephone line. You put a page in, dial, and hear the real call. The page is scanned by a modelled
optical path, coded as a real CCITT T.4 bit stream, carried by a real T.30 session over modem signals synthesised from
those bits, decoded at the other end and burned into thermal paper by a modelled head. **Not an emulator**: no ROM
or firmware of any machine is used. The machine's behaviour is rebuilt from its manuals and the protocol from the
CCITT Recommendations.

Status: **plan only** (2026-11-15). No product code exists. The supporting notes, with every source and what could
not be reached, are in `research.md` beside this file. This plan follows the form of `docs/displaywriter/plan.md`;
an `architecture.md` in the form of the Displaywriter's is the first deliverable of M0, written once the chosen
machine's manuals have been read.

**The one large caveat.** The hosts that hold fax service manuals (ManualsLib, manualmachine, archive.org,
Bitsavers and its mirrors, itu.int) were blocked from the planning session. The documents were *located* by search
but **not read** (`research.md` sections 1 and 2). So this plan fixes the kind of machine, the depth and the
architecture, and names a machine provisionally. Hardware figures below are marked *typical* where they come from
general knowledge of such machines, and M0 replaces each with a cited value, as `docs/displaywriter/hardware.md`
does.

| File | Contents |
|---|---|
| `plan.md` | This file: candidates, depth, what you fax to, input, models, audio, architecture, milestones, decisions, risks |
| `research.md` | Reachability, the documents located, the three generations, protocol facts with their standing, free-tier limits, test oracles, free media found |
| `architecture.md`, `hardware.md`, `protocol.md`, `models.md` | To be written in M0, in the Displaywriter's formats |

## Ground rules

- **Accuracy over convenience.** Documents go in face down. The paper roll goes in coating side toward the head. The
  keys do what the machine's keys do, in the machine's order. A page sent face up arrives blank, as it really did.
- **Physics first** (`docs/ARCHITECTURE.md`). The feeder, the platen roller, the cutter, the hook switch, the keys
  and the head's heat are mechanisms. The machine's firmware is a set of controllers that may only switch motor
  phases, coil and strobe currents and relays, and read sensors; a test enforces it, as for the Displaywriter.
- **The line is a signal.** Everything on the telephone line is audio samples produced from the bits and tones that
  are really being exchanged. Nothing on the line is a recording, and nothing is played "for effect".
- **No original code, ROMs or font art.** The header-line and report character set is our own bitmap font drawn to
  the look. spandsp and libtiff are read as behaviour references and used offline as test oracles; no code is copied.
- **The camera moves only when asked**; stations, focus items and way markers as on the Displaywriter.
- **A fax visit downloads only the fax family**, and adds nothing to the other machines' visits.

## 1. Candidate machines

Sources and their standing are in `research.md` section 2; ids such as X-TRM refer to it.

| | A. Analogue Group 1/2 | B. Group 3 office desktop, thermal roll | C. Small home machine, thermal roll |
|---|---|---|---|
| Example | Xerox Telecopier 400 (1970s), Exxon Qwip 1200 (1975 to 1985) | **Xerox Telecopier 7017 (1988 to 1991)**; Ricoh FAX 77/80; Sharp FO-220; NEC Nefax 2; Murata M900 | Sharp FO-50/FO-70, Panasonic KX-F90, Canon Fax-B100 (1990s) |
| Look | A low box with a lid over a drum, a cradle or cups for the telephone handset | A beige or grey wedge about 35 x 38 x 17 cm, 9 kg: sloping document tray at the back, panel with keypad and one-touch keys in front, received pages leaving from the front or top, usually a handset at the left | The same at two thirds the size, with a handset and often an answering machine |
| Scanning | The sheet wrapped on a drum turning at about 180 rpm under a lamp and photocell on a leadscrew | Sheet fed by rollers past a fixed line: lamp, lens and CCD (1728 elements across 216 mm), or a contact image sensor from about 1988 | Contact image sensor |
| Printing | Stylus burning electrosensitive paper on a second drum (Qwip), or pressure/carbon | Page-wide thermal head, 1728 dots at 8 dots/mm, on thermal paper drawn from a 30 to 100 m roll; automatic cutter | The same, 30 m roll, tear bar or small cutter |
| Protocol | T.2 (FM, 6 minutes a page) or T.3 (AM, 3 minutes); the operators talk first, then place the handsets; no digital handshake | T.30 over V.21; pages by V.29 (9600, 7200) and V.27ter (4800, 2400); T.4 Modified Huffman and Modified READ | The same, later with ECM and MMR |
| Sounds | A motor and a drum for six minutes; a warbling tone on the line that *is* the picture | Dial tone, dialling, ringing, the 2100 Hz answer, V.21 burble, the training burst and hiss, steppers, the cutter, the end beep | The same, thinner |
| Documentation found | None by search. Museum photographs (The Henry Ford, Ingenium). The 1985 Data Decisions survey lists specifications | **A 194-page service-level Technical Reference Manual of 1988 (X-TRM), an operator's Product Manual (X-PM) and an archive.org item (X-IA) for the 7017**; a field service manual for the Ricoh (R-FSM); an operator's manual for the Sharp (S-220); Ricoh's Group 3 training manual (R-G3) | The most service manuals (S-70 with exploded views; Brother; Panasonic), and free-licence photographs on Commons |
| How well it can be simulated | Mechanically simple and lovely to watch. But the "protocol" is one analogue tone, a page takes 3 to 6 minutes of nothing happening, and nothing in the brief's protocol list (T.30, V.21, V.27ter, V.29, MH, MR) applies. Electrosensitive paper needs a new print model with no source | **Everything in the brief applies.** Two steppers, a cutter, a head and a hook switch are a far smaller mechanism than the Displaywriter's printer. The protocols are public standards that can be tested bit for bit | The same simulation with a less interesting object; the 1990s date sits oddly after 1926, 1971 and 1980 |

**Recommendation: B, and provisionally the Xerox Telecopier 7017 of 1988.**

1. It is the only candidate for which both a service manual and an operator's manual were found, the pairing that
   made the Displaywriter possible (Product Support Manual plus Operator Reference Guide).
2. 1988 is the height of the fax years, and the desk's dates then run 1926, 1971, 1980, 1988.
3. Xerox coined "Telecopier" in 1966; the name carries the history without needing the 1966 machine.
4. It is a plain 9600 bit/s thermal machine: exactly the standard set (V.21, V.27ter, V.29, MH, MR) and no more.
   The 7017SF's store-and-forward memory is an option we leave out.

**What could overturn it** (checked first in M0): the manuals turn out thin on the mechanism; or the owner can get
hold of a different thermal machine to photograph and record, which outweighs everything else (decision 1). The
fall-backs, in order: Ricoh FAX 77 (field service manual plus the training manual), Sharp FO-220 (operator's manual
only, Group 2 compatible), a generic machine "c. 1988" built from the Ricoh training manual with no make, as the two
typewriters are.

Machine A is not wasted: a Group 1 drum machine with its handset cups would be a fine fifth machine later, and the
telephone line built here would serve it unchanged.

## 2. What is simulated, and how deeply

Depth words are the README's: *integrated* (from forces), *emergent*, *firmware logic over sensors*, *calibrated*,
*approximated*, *not modelled*. Two more are needed here: **exact** (bit for bit, or sample for sample, to a public
standard, with a test) and **signal** (the real waveform is generated and the real receiver processes it).

| Subsystem | Model | Depth |
|---|---|---|
| **Document feed** | Tray and sliding guides; a separation roller against a friction pad; feed and exit rollers on one stepper (the `stepper.js` motor model, torque from phase currents); the sheet a rigid lamina with three degrees of freedom (along, across, yaw) under roller and pad friction; two photo-interrupter sensors with flags | Integrated. Skew comes from how the sheet was laid and where the guides stand. Pulling or holding the sheet while it feeds stretches or squeezes the copy. Two sheets can go through together if the pad is worn (a condition setting). **Approximated**: the sheet's bending over the path is drawn from a curve, not solved |
| **Reading optics** | The document's reflectance image sampled where the sheet really is at each line: lamp profile with fall-off toward the ends, lens blur (one point-spread width) and the element's aperture, integration over the line period while the sheet moves, shot and dark noise, 1728 elements | Modelled per line. Darker edges before shading correction, motion smear in the feed direction and soft fine detail come out of it. **Not modelled**: the lens's geometry, the mirrors, colour (the lamp's colour makes some inks drop out on a real machine; one spectral weight per ink is the most we do) |
| **Video processing** | Shading correction from a white reference read at power-on; white-level tracking (background removal); a fixed threshold moved by the contrast control; halftone by an ordered dither matrix giving 16 levels; standard resolution by reading every second fine line | Firmware logic on sensor values. The dither matrix and whether standard mode ORs line pairs are **assumed** until the manual says |
| **Coding (T.4)** | Modified Huffman and Modified READ (K = 2 standard, 4 fine), EOL, tag bits, fill to the negotiated minimum line time, return to control; the decoder with the standard's error rules (a bad line is replaced by the one before, counted, and the page rejected past a limit) | **Exact.** A page on the line is a valid Group 3 stream that libtiff decodes. Bit-exact tests against fixtures (7.3) |
| **Call control (T.30)** | The phase A to E state machines of both ends as the Recommendation's flow charts give them: CNG, CED, preamble, HDLC frames with zero insertion and frame check, DIS/DCS with the real capability bits, CSI/TSI, training and TCF, CFR/FTT with step-down through 9600, 7200, 4800, 2400, post-page EOP/MPS/EOM and MCF/RTP/RTN, DCN, the timers T1, T2, T4 and three tries, polling | **Exact** for the 1988 base procedure. **Not modelled**: error correction mode, MMR, the non-standard facilities frames of any maker (ours sends none), Group 2 fall-back, V.17 and later |
| **Modems** | Transmitters for V.21 channel 2, V.27ter and V.29: scrambler, differential or QAM mapping, the training sequences, pulse shaping, carrier. Receivers that work on the audio: V.21 by discriminator; the others with gain control, symbol timing recovery, an adaptive equaliser trained on the sequence, carrier tracking and a slicer; the TCF error count decides CFR or FTT | **Signal.** The sound on the line is the page's bits. Bit errors, failed training, step-down and RTN happen because the receiver really failed on a bad line. **Approximated**: transmitter filters and levels are ours, to the Recommendations' spectra, not a Rockwell chip's; both ends share one sample clock unless the line model adds an offset |
| **Telephone line and exchange** | The subscriber loop (48 V battery, loop current, hook state), a digital exchange of the period: dial tone, digit collection from DTMF or 10 pps pulses, audible ringing and busy by the precise tone plan, 20 Hz ringing current to the called machine, answer supervision, disconnect. The speech path: 300 to 3400 Hz, 8 kHz companded to 8 bits (the real quantising noise), loss, a little hybrid echo, noise and optional impulse hits by line quality | **Signal** for everything audible; the exchange is logic. Line quality is a per-number property plus a seed. **Not modelled**: trunks, long-distance delay beyond a fixed figure, billing |
| **Network control unit** | Line relay, pulse-dial relay, ring detector, transformer, monitor speaker with its volume slider, the handset and its hook switch as a sprung contact, the line cord's plug | Relays and the hook switch integrated as small armatures (their clicks come from their contacts). Lifting the handset during a call puts room noise on the line, as it did |
| **Thermal head** | 1728 resistive dots in four strobe blocks. Each dot has two thermal states (the element, and the glaze under it) driven by strobe energy; the substrate warms over a page and a thermistor reads it. The 24 V supply sags with the number of dots on in a block | Integrated per printed line (not per substep; a line is 2.5 to 20 ms). Trailing shadows after dense black, lighter print when the head is cold or many dots fire, come out of it. The time constants are **calibrated** to a head data sheet (ROHM) and to photographs of real output |
| **Head drive firmware** | Strobe width from the thermistor and from each dot's recent history (the "history control" real machines used), block sequencing, platen step timing | Firmware logic over sensors |
| **Thermal paper** | Coating darkness as a function of the peak temperature each point reached, with a threshold near 70 to 100 degrees C; the paper's position under the head from the platen roller and its own slip; two-sided (only the coated side marks) | Physically based with **calibrated** constants. A roll put in backwards prints nothing. Heat from elsewhere darkens it too: the desk's cigarette and lighter scorch it black before it burns. A fast scratch marks it |
| **Fading and age** | Each received page keeps its own age and light exposure; the image loses density and the ground yellows slowly; a patch left under the lamp fades faster | **Approximated**: one rate law with two constants, no chemistry. Whether pages age across visits is decision 12 |
| **Paper roll and path** | The roll as a rotor whose radius and inertia fall as it is used; drag in its trough; the strip from roll to head to cutter to the exit as a chain of segments with width, with a rest curvature set by the radius it was wound at | Roll and platen integrated. The strip is a soft body on the main thread like the ribbon. The curl is stronger near the end of the roll, because it is. The red end-of-roll stripe appears in the last metre |
| **Cutter** | A blade on its own motor or solenoid with a home sensor; the cut sheet falls, curled, onto the tray and the pile | Integrated blade; the cut itself is a rule (the strip divides where the blade passes). A jam is possible when the strip has been pulled askew |
| **Panel and display** | Every key a stem with a rubber-dome force curve and a contact; a scanned matrix; the 16-character LCD (or LEDs, per the manual) with our own 5 x 7 font; the beeper | Keys integrated as on the Displaywriter's panel. LCD contrast with viewing angle is a shader, **approximated** |
| **Machine firmware** | Standby, send, receive (automatic and manual), copy, on-hook and handset dialling, redial, one-touch and speed-dial programming, the clock, the header line on every sent page, resolution and contrast, polling, the user switches | The real machine's behaviour from its operator's manual, rewritten. Runs on the simulated clock with no DOM, so it runs in Node |
| **Reports** | Transmission report, activity journal after a set number of calls, the telephone list, each rendered by the machine's character generator and printed on the thermal printer | As documented; the layouts transcribed from the manual's figures into fixtures |
| **Errors** | Document jam and misfeed, cover open, out of paper, cutter jam, head overheat; no dial tone, busy, no answer (T1), failed training at every speed, RTN, line drop in mid-page (carrier lost, T2), the far end out of paper; each with the machine's own error code | Emergent where a mechanism or the line causes it; the codes and the recovery steps as documented |
| **The far end** | A second complete T.30, T.4 and modem stack with a thin virtual scanner and printer (timing models, no mechanism) | The protocol side is the same exact code. Its mechanism is **not modelled** |
| **Sound** | Section 6 | Line sounds exact; mechanism synthesised from forces, replaced by recordings when the owner has them |

**Candidly approximated, in one place.** The document's bending; the lens and lamp beyond one blur and one profile;
the dither matrix until documented; the modem's filters; the thermal constants; fading; the LCD; the far end's
mechanism; the cutter's cut; and the whole machine's firmware timing where the manual is silent. Each will be a row
in `architecture.md`'s gap table with its default and the one place it is isolated.

**A consequence worth stating.** A real machine of this class has no page memory. The feeder runs only as fast as
the modem takes lines, and the far end prints only as fast as lines arrive. So in the simulation the document creeps
through dense passages and runs through white space, the receiving head does the same a moment later, and at 2400
bit/s it all slows to a crawl. None of that is scripted.

## 3. What do you fax to?

### 3.1 The options

| Option | What it is | For | Against |
|---|---|---|---|
| **A. A telephone exchange in the browser, with correspondents** | The exchange and a handful of far-end machines run in the page. A card index on the desk lists their numbers | Works offline and at once; nothing to moderate; the full protocol runs at both ends; every error mode can be given a number to dial; costs nothing to host | Nobody real is there |
| **B. Real faxing between visitors** | Each visitor's machine has a number; a Cloudflare Worker with a Durable Object relays calls between two open browsers | The real thing: a page you fed comes out of someone else's machine | A Worker script where there is none today; strangers can send each other images; free-plan limits; needs two people at once |
| **C. The site's other machines** | A page typed on a typewriter or printed by the Displaywriter becomes a document you can fax; and their pages can be faxed *to* you | Ties the desk together; gives the user real documents of their own to send | Pages today live in memory for one session and are lost when the machine is switched (a page reload) |

### 3.2 Recommendation

**Build A, with C inside it; design for B and build it last, as an opt-in private line, only if the owner wants it.**

**A, the correspondents.** Fictitious numbers in the reserved 555-01xx range, on a card index beside the machine
(a focus item, like the Displaywriter's notes). A first set, each exercising something real:

| Number | Who answers | What it shows |
|---|---|---|
| The office down the hall | A machine that receives your page and, a minute later, calls you back and sends it to you as received | The whole loop both ways; your machine ringing and answering |
| An information line (fax-back) | Polling: you call and *receive* a document (a notice, a menu, a weather map) | Polling, which the machine really had; halftone pictures |
| A correspondent who replies | Receives, then later sends a short written reply of our own text, chosen by what you sent (cover sheet or not, page count) | A reason to leave the machine on |
| A busy line; a line that rings out; a disconnected number | Busy tone and redial; T1 expiry; the intercept tones | Call failures |
| A bad long-distance line | A machine behind a noisy, lossy line | Failed training, step-down to 4800 or 2400, RTN and resending |
| A machine that is out of paper | Answers, then refuses in phase B | The far end's faults and their codes |
| Your own number | Busy | The honest answer |

Plus **copy**: the COPY key scans and prints locally with no line, as on the real machine. It is the first thing
that works on the desk and the natural A/B test against a real machine.

**C, the other machines.** An "out tray": each machine's finished-page viewer gains "send to the fax's tray", which
stores the page image in IndexedDB (the Displaywriter already keeps diskettes there). The fax kit shows those pages
as paper in its document tray. In the other direction, "the office down the hall" can hold the newest page from the
out tray and send it when polled, so a page typed on the 1926 machine can arrive, properly, by fax. No server is
involved.

**B, between visitors: what it would take, and why it comes last.**

- *Free plan* (`research.md` section 5; **to be checked again on the day**): Workers allow 100,000 requests a day at
  10 ms CPU each; Durable Objects on the free plan are SQLite-backed, with 100,000 requests and 13,000 GB-s a day;
  20 incoming WebSocket messages count as one request; a hibernating object with open sockets costs no duration.
  KV allows about 1,000 writes a day and is eventually consistent, so it cannot ring a telephone. **Durable Objects
  are the right tool and KV is not.** Static assets stay free and uncounted if the Worker is bound only to a
  `/line/*` path.
- *Design.* One Durable Object per call. It relays what a fax-over-IP gateway relays (the approach of T.38): the
  T.30 frames and the coded page data, not audio. Each browser's exchange plays a local far-end modem from those
  bits, so each visitor still hears a true line. A page is 20 to 60 KB; at one message per quarter second a
  one-page call is about 300 messages, 15 billed requests, and under two minutes of object time (about 15 GB-s).
  The free plan then allows on the order of 800 calls a day before the duration limit, and nothing is stored.
- *Abuse.* An open fax number is a way to put an arbitrary image on a stranger's screen. The real network's answer
  was junk fax, and the web's would be worse. So, if B is built:
  1. No directory and no public numbers. A line exists only between two people: one creates a private line and gets
     a long random number (an invite) to pass on by their own means.
  2. Off by default; a visitor must plug the machine into "the outside line", and a notice says who can reach it.
  3. Manual receive by default: the machine rings and the visitor presses START.
  4. Nothing is stored on the server; both browsers must be open; a call is one-to-one and rate limited per
     address; a line expires.
  5. A "block and unplug" control, and no logging of page content, stated plainly on the page.
  These remove the stranger problem by design, which no moderation of ours could.
- *Cost in the project's own terms.* The site is "static assets with no Worker script" today (README). B adds a
  script, a binding, a migration, a deploy step and a thing that can run out. That is a real change for a feature
  that needs two people present. It is milestone M10 and can be dropped without loss to the rest.

## 4. Input: what you send

All of these become one thing: a sheet with a reflectance image, a size and a face, lying in the document tray.

| Source | Notes | Recommended |
|---|---|---|
| **Pages from the site's other machines** (the out tray, 3.2 C) | The archive's page image is already a photograph-like render with ink | Yes, M8 |
| **Sample documents** | Our own: a letter, a form with ruled boxes, a hand-drawn map, a photograph for halftone, and **our own test chart** in the manner of the CCITT charts (line pairs, text sizes, grey steps, a skew ruler). They lie in a folder on the desk | Yes, M7: the machine must work before the visitor makes anything |
| **A cover sheet** | A pad of period cover sheets (TO, FROM, DATE, PAGES, a message box) that you fill in by typing in an overlay or by pen | Yes, M8 |
| **Pen on paper** | A blank sheet at a "writing" focus item; the pointer is a felt pen, with pressure from speed. Signatures and sketches are what fax was *for* | Yes, M8, kept simple |
| **An uploaded image** | Stays in the browser (in option A nothing leaves it). Scaled onto a sheet at a chosen size; a photograph shows what halftone mode does | Yes, M8. If B is ever built, uploaded images are the abuse case, and the private-line rules above are what answer it |
| **PDF upload** | Needs a PDF renderer in the bundle | No |

Real handling is kept: up to the documented number of sheets in the feeder, face down, fed from the bottom; the
guides must be set; a sheet with a folded corner or a staple (a property of some sample documents) jams.

## 5. Models and assets

- **Built in Blender, procedurally, one builder per part**, as `docs/displaywriter/models.md` prescribes:
  `tools/blender/build_fax_body.py` (lower case, upper cover on its hinge, document tray, guides, exit tray, panel,
  keys, LCD window, the head frame and platen roller visible with the cover up, cutter, roll trough),
  `build_fax_handset.py` (handset, cradle, hook plunger), and small parts built in code at run time: the coiled
  handset cord and the line cord (curves), the paper roll (a cylinder whose radius is state) and the strip (the
  soft body's mesh).
- **Standard**: that of `element1971` and the Displaywriter: documented overall sizes within 2 mm, moulded shells
  with wall thickness, real gaps and bevels, every part the operator touches a separate node on its pivot, textured
  plastics. Camera-matched comparison with every reference photograph before a part is called done
  (`render_fax_*.py`, `compare_fax_*.py`), images kept in `docs/fax/review/`.
- **Reference photographs needed.** The manuals' line drawings and exploded views give geometry; photographs give
  colour, texture, legends and wear. Wanted, of the chosen machine: front, both sides, rear (jacks and switches),
  top with the tray up, the panel square-on and close, the cover open showing the head and roller, the roll trough,
  the handset and cradle, the underside label area (for placement only), and a sheet of its real output next to a
  ruler. **The owner is asked for any photographs they have or can take (decision 1), and for any thermal fax
  output they have kept**, even faded: a faded page is the reference for fading.
- **Legends and marks**: decision 3.
- **Thermal paper**: a roll (white, faintly glossy on the coated side, matte and slightly cream on the back), the
  cardboard core, a spare boxed roll on the desk; a paper material with a sheen difference between the faces; the
  red end-of-roll stripe.
- **The desk**: the shared `desk.glb` and room. The machine is small (about 0.35 x 0.38 m), so the desk also carries
  the document folder, the card index of numbers, the cover-sheet pad and pen, the received-pages pile, the spare
  roll, the ashtray and the lamp (there is room for it again), and a telephone socket on the wall behind with the
  line cord to it. Decision 10.
- **Budget**: at most 600 KB of models shipped (meshopt, then gzip), reuse of `walnut_desk`, `paper_fibre` and the
  Displaywriter's pebble plastic set where the colour allows, no texture over 1024 px on a part this small. Target
  for a fax visit: under the Displaywriter's 7.8 MB to the first keystroke (`docs/perf-review.md`).

## 6. Audio

| Sound | Source | Exactness |
|---|---|---|
| Dial tone, audible ringing, busy, reorder, intercept tones | Sums of sines at the precise tone plan's frequencies and cadences, through the line model | Exact by construction; tested to 0.5 % and to the cadence |
| DTMF digits; dial pulses | Two sines per digit with the machine's timing; loop breaks at 10 a second with the relay's click | Exact frequencies; timing from the manual |
| CNG and CED | 1100 Hz and 2100 Hz gated by the T.30 state machines | Exact |
| V.21 signalling, V.27ter and V.29 training and page data | The transmitters of section 2, fed the real frames and the real coded page | Exact in content: every second of it is this call's bits. Its timbre is the Recommendations' spectrum through our filters, which is where a recording of a real machine would be used to tune, not to replace |
| How you hear the line | The monitor speaker (a small cone model like `wp-speaker.js`, on during dialling and until training succeeds, by the machine's rule) and the handset earpiece at the Handset focus item (the whole call, quietly, band-limited) | The speaker and earpiece responses are **assumed** |
| Feed and platen steppers, gears, rollers | Synthesised from the motors' torque ripple and step impacts exciting small modal bodies in the plastic case, as the Displaywriter's printer is | Synthesised from forces; levels **assumed** until a recording exists |
| Cutter, cover latch, hook switch, handset set down, keys, relays, document guides | Contact events from the mechanism | The same |
| Beeper | A piezo model; frequency and lengths from the manual or a recording | Exact once measured |
| Paper: the strip sliding out, a sheet dropping on the pile, tearing | The typewriters' paper loops as a start, scaled by the strip's speed | Recorded (existing cuts), approximate fit |
| Ringer | An electronic warble through the speaker, or a bell, per the machine | From the manual or a recording |

**Recordings that would help most, in order** (decision 2):

1. A real thermal fax machine making a **copy** of a page with text and a black band: both steppers, the head, the
   cutter and the beep, with no line needed. Microphone 30 cm above the panel, no music or speech, and the room's
   silence for ten seconds first.
2. The same machine **receiving** and **sending** one page, with the monitor speaker audible.
3. Each control on its own: every kind of key, the handset lifted and replaced, the cover opened and shut, a roll
   dropped in, paper torn off.
4. A direct electrical recording of a call (a telephone recording adapter) to tune the transmit filters and levels.

Any machine of the class is useful; the chosen model is best. Sources and terms would be recorded in
`public/assets/audio/SOURCES.md` as now. No free recording of a 1980s machine's mechanism was found
(`research.md` section 7).

**Verification without an audio device**: `tools/render_wav.mjs` already renders the engines to WAV in Node. A full
call is rendered to a WAV and a spectrogram image for the owner to hear and see; tests measure tone frequencies,
cadences, levels and the modem spectra with numpy, as `tools/audio/measure.py` does.

## 7. Architecture

### 7.1 Where things live

| Piece | Where | Notes |
|---|---|---|
| Machine definition | `src/machine/fax1988.js`, `fax-geometry.js`, registered in `src/machine/index.js` with `action.type: 'thermal-fax'`; listed in `UNLISTED` until M7 | Every parameter in SI units with its source. `geometryFor` becomes a table by family instead of the `kind === 'system'` test |
| Kit | `src/kits/fax.js`, parts in `src/kits/fax/` (line, documents, tray, store) | A third entry in `KITS`; `main.js` unchanged |
| Mechanism host | `src/sim/fax/`: `index.js` (`FaxSim`), `feeder-mech.js`, `printer-mech.js` (platen, roll, head pressure, cutter), `ncu-mech.js` (relays, hook switch), `panel-mech.js`, `layout.js`, `ports.js`, reusing `src/sim/wp/stepper.js` and `inputs.js` (moved to a shared folder) | Behind the same `SimClient` contract; a third row in `host-factory.js` `HOSTS`. 384 kHz like the others (`SUBSTEP_HZ`); the fax has perhaps a dozen degrees of freedom, most asleep |
| Controllers | `src/sim/fax/scan-ctl.js`, `print-ctl.js`, `ncu-ctl.js`, `panel-ctl.js` | Frozen I/O objects exactly as `printerIO` in `src/sim/wp/index.js`: set phases, strobes and relays, read sensors. `tests/fax_controllers.test.js` proves none writes a mechanical state |
| Thermal model | `src/fax/thermal/head.js`, `paper.js` | Pure functions of strobe energy and history; called once per printed line by the mechanism host |
| Optics and video | `src/fax/image/optics.js`, `video.js` | Pure; one call per scanned line |
| **Protocol stack** | `src/fax/t4/` (`tables.js`, `encode.js`, `decode.js`), `src/fax/hdlc.js`, `src/fax/t30/` (`frames.js`, `caller.js`, `answerer.js`, `timers.js`), `src/fax/modem/` (`v21.js`, `v27ter.js`, `v29.js`, `scrambler.js`, `rx-common.js`), `src/fax/line/` (`exchange.js`, `tones.js`, `dtmf.js`, `channel.js`, `companding.js`) | **Its own module with no DOM, no timers and no mechanism imports.** Time is a sample count handed in. Typed arrays allocated once. Runs in Node, on the main thread and in the worklet unchanged |
| Far ends | `src/fax/remote/` (`virtual-fax.js`, `directory.js`, `documents/`) | The same stack with a virtual scanner and printer |
| Firmware | `src/fax/firmware/` (`main.js`, `dial.js`, `reports.js`, `chargen.js`, `messages.js`) | Generator tasks on the simulated clock, like `src/wp/sched.js`; reaches the machine only through the controllers |
| Audio | `src/audio/fax-engine.js` (steps the host, renders the mechanism's voices and the line's listeners), `fax-synth.js`, `fax-line-tap.js`; worklet entry `src/audio/worklet-fax.js`; a third branch in `src/sim/worklet-url.js` and in `tests/worklet_entries.test.js` | Stereo, with the interface of `WpAudioEngine` |
| Rendering | `src/render/fax/` (`body-view.js`, `strip-view.js`, `lcd.js`, `roll.js`, `documents.js`) | The strip's texture is written line by line from the head model's output |
| Views | The graph in `src/interact/wp-views.js` becomes data passed in (`STATIONS`, `FOCUS`, order); the fax supplies `src/machine/fax-views.js`. `wp-markers.js` and `wp-nav.js` are reused as they are | Stations: Desk, Fax, Documents, Tray, Numbers. Focus items at the Fax: Panel, Display, Feeder, Paper (cover up), Handset, Rear |
| Pages | The existing `src/pages/` pile, viewer and PDF export take received faxes (a thermal-paper look in `composePage`) | Plus the IndexedDB out tray and in tray |
| Tools | `tools/fax/make_vectors.py` (fixtures from libtiff), `tools/fax/render_call.mjs` (a call to WAV and spectrogram), `tools/fax/calibrate_thermal.mjs`, `tools/blender/build_fax_*.py` | |

### 7.2 Threads, rates and the audio budget

- **One clock.** The mechanism's substep count is the only time. The line runs at 9600 samples a second, derived
  from it: 40 substeps a line sample, an exact 5:1 ratio to 48 kHz and enough for a 3400 Hz channel; a 44.1 kHz
  context resamples the listeners' taps only. The modems, both T.30 state machines, the exchange and the far end all
  step on line samples, so a call is deterministic and identical in Node and in the worklet.
- **In the worklet**: `FaxSim`, the controllers, the firmware, the whole protocol stack, the far end, and the voices.
  All of it obeys the worklet rules already tested for the other families: no `structuredClone`, `setTimeout` or
  DOM, and no allocation in the block path (`docs/perf-review.md` recommendation 25).
- **The page images cross once.** When a sheet is laid in the tray the kit sends its reflectance image to the host
  as a transferable buffer (about 4 MB a page at 8 x 7.7 per mm). The scan then runs wholly in the host, so a slow
  frame on the main thread cannot starve a transmission. In the other direction the host emits each printed line's
  darkness (216 or 1728 bytes) with the snapshot events, and the main thread paints the strip.
- **Main thread**: the strip and falling-sheet soft bodies, rendering, the LCD, the document handling, storage.
- **Budget, to be measured in M3 and M5 and then fixed as tests**: idle under 2 % of real time on the reference
  core (nothing turns when the machine waits); a call with both modems receiving under 15 %; worst block under one
  quantum. The demodulators run at 2400 symbols a second with short equalisers, far below the typewriters' contact
  solver; the risk is allocation and denormals, not arithmetic.
- **Before the first gesture** the same host runs on the main thread (`LocalHost`), as for every machine.
- **Rendering cost**: one small machine, a strip and a pile; no second view; the LCD is a tiny texture. The
  redraw-only-on-change rule and the governor apply unchanged.

### 7.3 Tests with golden vectors (Node)

1. **Code tables**: every terminating and make-up code of T.4 against the Recommendation's tables, transcribed once
   into a fixture and proof-read against RFC 804's copy.
2. **Our chart, both ways**: `tools/fax/make_vectors.py` draws our test chart and other pages, and has libtiff
   encode them as Group 3 one-dimensional and two-dimensional. Tests: our decoder reads libtiff's stream to the
   identical bitmap; our encoder's stream, wrapped as a TIFF, is read by libtiff to the identical bitmap (checked
   when fixtures are made, and the result hashed into the fixture); and where the options coincide the two streams
   are bit-identical.
3. **Round trip** on random and adversarial lines: all white, all black, alternating single pixels, runs of exactly
   63, 64, 1728 and 2560, a one-pixel change between lines for every READ mode.
4. **Decoder under damage**: flipped bits never crash or run past the line; the bad-line count and the
   previous-line substitution match the rule.
5. **HDLC**: the frame check on the standard check string, zero insertion at every position, flags, aborted frames.
6. **T.30 frames**: DIS and DCS built and parsed bit by bit against worked examples in the Recommendation's tables;
   whole-call scripts (the Displaywriter's "13 keystroke scripts" idea): the sequence of frames and tones of a clean
   one-page call, a two-page call, a retrain, an RTN and resend, a timeout, a poll, each compared with a transcribed
   signal ladder.
7. **Modems**: constellation points and scrambler sequences against the Recommendations' tables; loop-back with no
   noise has zero errors; error rate against signal-to-noise ratio within a set margin of theory; the transmit
   spectrum inside a mask; V.21 tones within tolerance; and, if spandsp can be run offline, our receiver decodes a
   WAV spandsp transmitted and its receiver decodes ours (fixtures made once, not a dependency).
8. **End to end, the headline test**: our chart, through optics, MH, T.30, V.29, the channel, the far end's modem,
   decoder and virtual printer: bit-identical on a clean line; on a set noisy line, a step-down to 4800 and a page
   with at most the allowed bad lines; and the call's duration within a stated range of the manual's "seconds per
   page" figure for its own test chart.
9. **Mechanism**: feed speed and line pitch (3.85 and 7.7 lines a millimetre within tolerance), no lost steps, skew
   from a skewed start, the cutter's cycle, the hook switch, out-of-paper and jam sensing, energy bounded.
10. **Thermal**: density against strobe energy matches the calibration; the cold-head and many-dots cases move the
    right way; a roll in backwards prints nothing.
11. **Firmware**: keystroke scripts against LCD fixtures and report fixtures transcribed from the manual.
12. **Budgets and hygiene**: worklet entry bundles only its family; no forbidden globals; the audio budget.

## 8. Milestones

Each is shippable behind `UNLISTED`, and each ends in Node tests before anything is judged in the browser, because
this container's browser draws at well under one frame a second.

| M | Deliverable | Accepted when (Node) | Then in the browser |
|---|---|---|---|
| **M0** | Read the manuals and the Recommendations (hosts allowed, or PDFs supplied). Write `hardware.md`, `protocol.md`, `architecture.md` with every [M] of `research.md` replaced by a clause or page. Scaffold: definition, kit, registry, host and worklet entries, the view graph made data, block-out boxes on the desk | All existing tests pass unchanged; `fax_layout`, `fax_views` and worklet-entry tests pass; the owner's decisions are recorded | A grey block stands on the desk at `?machine=fax1988`; stations work |
| **M1** | T.4: tables, MH and MR encoder and decoder, fill, RTC, damage rules; `make_vectors.py` and fixtures | 7.3 items 1 to 4. A page file our encoder wrote opens in any TIFF viewer | none |
| **M2** | HDLC and T.30, both ends, over an ideal bit pipe; the virtual fax; timers; polling | 7.3 items 5 and 6 | none |
| **M3** | The line: exchange, tones, DTMF and pulse, channel and companding; V.21, V.27ter and V.29 transmit and receive; `render_call.mjs` | 7.3 items 7 and 8 (with an ideal scanner). **The owner gets a WAV of a whole call to listen to** | none |
| **M4** | Feeder mechanism and scan controller; optics and video processing; resolution, contrast, halftone | 7.3 item 9 (feeder); the chart scanned straight gives a stated minimum of resolved line pairs; skewed, the skew measured in the output equals the sheet's | none |
| **M5** | Platen, roll, head pressure, cutter; thermal head and paper; print controller; calibration tool | 7.3 items 9 (printer) and 10; a copy of the chart, end to end in the host, within a stated density and geometry tolerance of the original | none |
| **M6** | Firmware: panel, LCD, dialling, send, receive, copy, programming, header line, reports, error codes | 7.3 item 11; no controller writes a mechanical state | none |
| **M7** | **On the desk.** Models to the standard, views and markers, every control, the strip and the falling sheet, the LCD, the audio engine and voices, the correspondents and sample documents. Camera-matched review images. **First public version**: listed in the menu | Models test (`tests/models.test.js` fixtures), view graph, audio levels and budget | e2e under `xrun.sh`: lay a sheet, press COPY, a page reaches the pile; dial the office, the page comes back; screenshots at each station |
| **M8** | Documents: the out tray from the other machines, cover sheets, pen, image upload; the in tray kept between visits; fading | Storage round trips; fading law; upload scaling | e2e: a typewriter page is sent to the tray, the machine is switched, the page is faxed |
| **M9** | The full directory, every error mode with its recovery, line quality, redial, journal; `?cold` (unplugged, no roll, clock unset) | Each error script | e2e of a failed call and a jam cleared by hand |
| **M10** | *Optional (decision 8).* The private line between two visitors: Worker, Durable Object, relay, the rules of 3.2 | The relay end to end in Node against a local `workerd`; limits and expiry | Two browsers, one page |
| **M11** | Finish: budgets measured and fixed as tests, README section with its own depth table, `docs/assets.md`, `SOURCES.md`, the contract in `docs/ARCHITECTURE.md` | Everything green; download and audio figures recorded in `docs/perf-review.md`'s form | A last look by the owner on real hardware (GPU and sound), which this container cannot give |

M1, M2 and M3 need nothing from the machine's manual and can start the day the plan is approved. M4 to M6 wait on M0.

## 9. Decisions for the owner

Numbered, each with options and a recommendation, in the manner of `docs/displaywriter/architecture.md` 13.2.

| # | Question | Options | Recommendation |
|---|---|---|---|
| 1 | **Which machine** | (a) Xerox Telecopier 7017, 1988, provisional on its manuals; (b) another thermal G3 machine **that you own, can borrow or can buy** to photograph and record; (c) Ricoh FAX 77/80; (d) Sharp FO-220; (e) a generic machine "c. 1988" with no make; (f) an analogue Group 1 drum machine | **(b) if you can get one, else (a).** A real machine in your hands outweighs any manual: photographs, output samples and recordings all come from it. Tell me which and I will find its manuals |
| 2 | **Recordings and photographs** | Supply any you have or can make (the list in sections 5 and 6); or none, and everything mechanical is synthesised with assumed levels, as the Displaywriter's printer was | Supply what you can. The copy-mode recording alone would fix most of the levels |
| 3 | **Names and marks** | (a) As for the Displaywriter: the maker's name and model on the machine and in its reports as documented, drawn by us; (b) no marks, as on the typewriters | (a) if a specific machine is chosen, for the same reason as before; (b) follows automatically from 1(e) |
| 4 | **Machine id and menu name** | `fax1988`; or the model's name | `fax1988`, shown in the menu with the model's name if 3(a) |
| 5 | **Country and line** | (a) North America: precise tone plan, DTMF with a pulse switch, letter paper, 60 Hz, mu-law; (b) UK or Europe: other tones and ringing cadence, A4, A-law | (a), matching the other machines' 60 Hz and the manuals found. A4 documents are still accepted, as the machine did |
| 6 | **Depth of the modems** | (a) Real transmitters and real receivers on the audio, errors emergent; (b) real transmitters, but the bits also pass on a side channel and errors are drawn from the line's noise figure | **(a).** It is the heart of "the line sounds are genuine", it is testable in Node, and (b) remains a fall-back per modem if a receiver proves stubborn (risk 3) |
| 7 | **Protocol scope** | (a) The 1988 base: V.21, V.27ter, V.29, MH, MR, polling; (b) add error correction mode and MMR; (c) add Group 2 fall-back | (a). (b) only if the chosen machine really had it |
| 8 | **What you fax to** | (a) The in-browser exchange with correspondents and the site's other machines; (b) also a private line between two visitors through a Worker and Durable Object, opt-in, nothing stored, no directory; (c) an open public exchange between all visitors | **(a) now; (b) as the optional last milestone; not (c)**, which cannot be made safe on a hobby site |
| 9 | **Correspondents' content** | (a) Our own short texts and drawings, as the Displaywriter's sample documents; (b) also pages that refer to the site's other machines (a memo typed on the 1926 machine, a Displaywriter printout) | (b): it makes the desk one office |
| 10 | **Desk** | (a) The shared desk with the fax alone and its props (card index, folder, cover-sheet pad, spare roll, pile, lamp, ashtray, wall socket); (b) a new side table; (c) on the Displaywriter's desk beside it | (a). (c) would make every Displaywriter visit download the fax |
| 11 | **Start-up** | (a) Warm: plugged in, roll loaded, clock set, a few numbers programmed, standing by; `?cold` gives an unplugged machine with no roll and the clock unset; (b) always cold | (a), as for the Displaywriter |
| 12 | **The machine's clock and date** | (a) The visitor's real date and time, printed in the header line (a 1988 machine prints two-digit years happily); (b) a fixed date in 1988; (c) unset until the visitor sets it | (a) warm, (c) under `?cold`. Setting the clock by the real key sequence works either way |
| 13 | **Received pages and age** | (a) Kept between visits in IndexedDB, and they fade and yellow with real elapsed time; (b) session only, with a time-lapse control to show fading; (c) both | (c): real ageing is the truthful behaviour, and the control lets it be seen today |
| 14 | **Real keyboard** | (a) Digits, `*` and `#` are the keypad; Enter is START; Esc is STOP; `C` copy, `R` redial, `H` hook, `F` function; everything else is clicked; (b) clicks only | (a), listed under the **keys** button, and the navigation shortcuts never reach the machine |
| 15 | **Hearing the line** | (a) Only as the machine allows: monitor speaker until training succeeds, and the handset when lifted; (b) also a Settings switch "line monitor" that keeps the speaker on for the whole call | (a) by default and (b) as an honest extra, off by default and labelled as not original |
| 16 | **A "line card"** (the counterpart of the Screen card) | A small flat panel showing the call as a signal ladder with frame names, speed, line count and a spectrum strip; or nothing | Yes, hidden by default: it is the telemetry panel of this machine and teaches what the noises are |
| 17 | **Call speed** | (a) Always real time (a page takes 30 to 90 s); (b) a "fast" switch like the terminal mode's, clearly marked unreal | (a) only. The wait is the experience, and the mechanism is watching to do |
| 18 | **Paper supply** | (a) The roll runs down across visits and must be replaced from the spare box (it then refills); (b) endless | (a), with the red stripe and the out-of-paper refusal; it costs nothing and is true |
| 19 | **Faults on by default** | (a) A machine in good order; jams and bad lines only where the visitor causes or dials them; (b) occasional random faults | (a), as the Displaywriter; a "condition" setting may come later |
| 20 | **Test charts** | (a) Our own chart only; (b) also buy and ship the ITU set | (a). The ITU images are sold, and ours can be made to test more |
| 21 | **Uploaded images** | (a) Allowed, kept in the browser; (b) not offered | (a) with decision 8(a); to be looked at again if 8(b) is taken up |
| 22 | **Night** | (a) The lamp as on the typewriters, plus the machine's own small lights (LCD backlight if it has one, LEDs, the lamp's glow at the scan slot while reading); (b) dim only | (a): the scan lamp leaking light at the document slot is one of the machine's best moments |

## 10. Risks and unknowns

| Risk or unknown | Effect | Mitigation |
|---|---|---|
| 1. **No manual has been read.** The 7017's documents may be thin, or the machine may differ from the *typical* description (a contact sensor, no handset, no cutter) | Hardware figures and the control list change | M0 comes first and is cheap. M1 to M3 do not depend on it. Three fall-back machines are named. Every typical figure lives in one definition file |
| 2. The hosts stay blocked | M0 cannot be done from a cloud session | The owner downloads the PDFs listed in `research.md` section 2 into `docs/fax/refs/`, or allows the hosts |
| 3. A V.29 or V.27ter receiver that trains reliably is real DSP work | M3 slips | They are standard designs with a free reference to read (spandsp). Tests grow from loop-back at no noise. Decision 6(b) is the per-modem fall-back, and the sound is unaffected by it |
| 4. Facts in `research.md` marked [M] are from memory (frame codes, timer values, training lengths, the V.27ter symbol rates) | A wrong constant would make the stack self-consistent but not standard | Each is checked against the Recommendation in M0; the libtiff and spandsp oracles catch what reading misses |
| 5. The 1988 editions of T.4 and T.30 differ in details from today's | Anachronisms | Use the Blue Book (11/1988) texts, which the ITU lists on its site (to be confirmed readable in M0; RFC 804 carries the 1981 T.4 text meanwhile) |
| 6. Audio-thread cost of two modems, two state machines and a mechanism | Glitches on slow devices | The line rate is 9600 Hz, not 384 kHz; budgets become tests in M3; the far end can move to the main thread behind the same interface if ever needed |
| 7. A 4 MB transfer per page to the worklet, and several pages in the feeder | A pause when a sheet is laid | Transferable buffers; send each page when it reaches the separation roller; standard resolution halves it |
| 8. The paper strip is a new soft body (a curled ribbon with width that is cut and falls) | The most visible new physics; could look wrong | It is built on the ribbon's rope and the sheet's XPBD, both proven here. A falling sheet that settles to a stored curled pose is the fall-back |
| 9. Thermal constants and fading have no measured source | The print could look too clean or too crude | Calibrate against the owner's samples of real output (decision 2) and Commons photographs; keep the constants in the definition |
| 10. No recording of the mechanism | Assumed levels, as for the Displaywriter's printer | Decision 2; the sample path stays open |
| 11. Marks and the look of a current company's old product | The same question as IBM's | Decision 3; everything is drawn by us; no logo artwork is traced |
| 12. Cross-visitor faxing: abuse, limits that change, a server to look after | Harm to visitors or to the site | Last and optional; private lines only; nothing stored; free-plan figures re-checked on the day (`research.md` 5 notes a conflicting statement) |
| 13. The ITU test charts are not free | No standard chart in the repository | Our own chart (decision 20) |
| 14. Verification is blind and deaf here: software rendering under one frame a second, no audio device | Looks and sound cannot be judged in the container | Node tests carry correctness; WAV and spectrogram renders and camera-matched stills go to the owner; M11 is the owner's pass on real hardware |
| 15. `wp-views.js` and `geometryFor` are written for one system machine | Small refactors in shared code | Done in M0 as pure moves under the existing tests, as the kit split was |
| 16. Scope: reports, programming menus and every user switch of a real machine add up | M6 grows | Fix the core in `architecture.md` as the Displaywriter's 7.8 did (send, receive, copy, dial, redial, one-touch, header, transmission report, journal); the rest are present as documented menus that say so |
| 17. Unknown until read: the scan sensor type, lamp, motor step angles and gear ratios, cutter type, roll length, LCD size, key list, switch settings, error codes, report layouts, the test-chart page time, dimensions and weight | Placeholders | The gap table of `architecture.md`, each with a default and one place it is isolated |
