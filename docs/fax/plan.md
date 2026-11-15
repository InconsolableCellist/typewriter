# Fax machine: the Sharp FO-70, c. 1999. Research notes and plan

A fourth machine for the desk: the **Sharp FO-70**, a small Group 3 facsimile machine with a thermal paper roll, an
automatic cutter, a five-sheet document feeder, a handset and a telephone line. You put a page in, dial, and hear the
real call. The page is scanned by a modelled contact image sensor, coded as a real T.4 bit stream, carried by a real
T.30 session over modem signals synthesised from those bits, decoded at the other end and burned into thermal paper
by a modelled head. **Not an emulator**: no ROM or firmware of any machine is used. The machine's behaviour is
rebuilt from its manuals and the protocol from the CCITT / ITU-T Recommendations.

Status: **plan, re-scoped to the FO-70** (2026-11-15). The owner has chosen the machine (decision 1). Protocol work
has started under `src/fax/` (M1, M2 and M3 in parallel); nothing else exists. The supporting notes, with every
source and what could not be reached, are in `research.md` beside this file; its section 8 holds everything found
about the FO-70. This plan follows the form of `docs/displaywriter/plan.md`; an `architecture.md` in the form of the
Displaywriter's is the first deliverable of M0, written once the FO-70's manuals have been read.

**The one large caveat, unchanged.** The hosts that hold the FO-70's manuals (ManualsLib, manualmachine, manualzz,
manymanuals, manuallib, manualsonline, elektrotanya, archive.org, global.sharp) and itu.int are blocked from the
cloud sessions. The FO-50 / FO-70 service manual and operation manual were **located and their contents lists and
specification lines seen through search summaries, but not read**. Every FO-70 figure below carries one of three
marks:

- **[S]** from a search summary that quoted a named document (the document is in `research.md` 2 and 8);
- **[M]** from memory of machines of this class or of the Recommendations, not checked;
- **[A]** an assumption or a design default of ours.

Nothing about the FO-70 is yet **read at source**. M0 replaces each mark with a page number, as
`docs/displaywriter/hardware.md` does.

| File | Contents |
|---|---|
| `plan.md` | This file: changes for the protocol work, the machine, depth, what you fax to, input, models, audio, architecture, milestones, decisions, what the owner should supply, risks |
| `research.md` | Reachability, the documents located, the three generations, protocol facts with their standing, free-tier limits, test oracles, free media found, and the FO-70 (section 8) |
| `architecture.md`, `hardware.md`, `protocol.md`, `models.md` | To be written in M0, in the Displaywriter's formats |

## Changes for the protocol work

For the three agents building M1 (T.4), M2 (HDLC and T.30) and M3 (line, exchange, modems) under `src/fax/`.
**The FO-70 does not add a modem, an error-correction layer or a new coder.** It is a 9600 bit/s machine that codes
in MH and MR. What it changes is small and listed here in full.

**Not needed (do not build):**

| Item | Standing |
|---|---|
| **V.17** (14 400 bit/s) | Not needed. The FO-70's top speed is 9600 bit/s "with automatic fallback to lower speeds" **[S]**; its successor's brochure says 9600 to 2400 **[S]**. That is V.29 (9600, 7200) and V.27ter (4800, 2400), as already planned **[A: the mapping to Recommendations is the standard one; the manual will name them]** |
| **MMR** (T.6) | Not needed. The specification's compression line reads "MR, MH, Sharp (H2)" **[S]** |
| **ECM** (T.30 Annex A, HDLC page frames, PPS/PPR) | Not needed **[A]**. No specification line found for the FO-70, the FO-51 or the FO-71 mentions it, and Sharp's lists for machines that have it do say so. To be confirmed from the service manual's specification page (page 3). If it turns out to be present it becomes a later milestone, not part of M2 |
| **Sharp "H2"** | Not built. It is Sharp's own coding, used only between two Sharp machines and negotiated in the non-standard frames (NSF, NSS). It is not published. Our FO-70 therefore sends no NSF and always works in the standard modes |

**Needed beyond the 1988 base:**

| # | Layer | Change | Standing |
|---|---|---|---|
| P1 | T.4 (M1) | **A third vertical resolution, super fine, 15.4 lines/mm**, beside 3.85 and 7.7. Horizontal stays 1728 elements at 8 per mm. The coder and decoder must take the resolution as a parameter, with **K = 8** for Modified READ at 15.4 lines/mm (K = 2 standard, 4 fine). An A4 page is about 4574 lines in super fine. Add fixtures at this resolution | Resolution list **[S]**. K = 8 is **[M]**: check it against T.4 (1993 or later) |
| P2 | T.30 (M2) | **DIS and DCS longer than 24 bits.** Super fine is announced in the extended field: bit 41 is "R8 x 15.4 lines/mm" **[M]**, so frames must build and parse the extend bits (24, 32, 40) and at least 48 bits of information field. Bit 46 gives the minimum line time at the higher resolution **[M]** | **[M]**, to be checked against T.30 (1996), Table 2 |
| P3 | T.30 (M2) | **Tolerate what a 1999 far end offers.** The FO-70 is a late-1990s machine and the far ends are its contemporaries. Their DIS may set V.17, ECM, MMR, 300 dpi and further extend bits. The parser must accept a DIS of any length, ignore bits it does not know, and the caller must choose only from what both ends have. One virtual far end should offer the full later set, as a test that the FO-70 side picks V.29 and MR | **[A]** design rule |
| P4 | T.30 (M2) | **NSF, NSS and NSC are received and skipped, never sent.** A real far end may send NSF before CSI and DIS. The frame layer must pass over a non-standard frame with any content and country code without error | **[A]** |
| P5 | Editions | Work from **T.4 and T.30 of 1993 to 1996**, not the Blue Book of 1988. The base procedure is the same; the extended DIS bits and super fine are in the later texts | **[M]** |
| P6 | Modem and tones (M3) | **Tone detectors as well as generators.** The FO-70's TEL/FAX mode answers the call, listens for the caller's CNG (1100 Hz), and rings the user if it hears none **[S: the mode exists; M: how it works]**. Its answering-machine mode does the same alongside an external machine. So the receive side needs a narrow 1100 Hz detector with the CNG cadence, and call-progress detection (dial tone before dialling, busy for automatic redial). A Goertzel bank on the line samples is enough | **[S]** for the modes, **[M]** for the procedure |
| P7 | Line and exchange (M3) | **The tone plan, ringing cadence and companding law are a data table, not constants.** Decision 5 still defaults to North America, but every FO-50 / FO-70 document found so far is for a 220 to 240 V market (Australia "A", "RA", "AAR", Thailand "TH", Germany "DE", South Africa) and **no North American variant has been confirmed** (decision 24). If the owner picks one of those markets, the exchange must switch to its tones, cadences and A-law by changing the table | **[S]** for the variants found |
| P8 | Line and exchange (M3), optional | **Ringing with a pattern, and a data burst between rings.** The operation manual lists Distinctive Ring and Caller ID as special functions **[S]**. Both are optional later work (decision 27), but the exchange should not make them hard: ringing cadence per call, and room to send a 1200 bit/s FSK burst (Bell 202 in North America) between the first and second ring **[M]** | Hooks only, now |
| P9 | T.30 (M2) | **Polling stays in scope**: the operation manual has a polling section **[S]** | No change |
| P10 | Pacing | **The no-memory pacing stays.** No memory figure for the FO-70 has been found. Its successor, the FO-71, has 448 KB and receives up to 17 pages into memory when the paper runs out **[S]**; the FO-70's operation manual contents, as far as search showed them, list no such section. Until the manual says otherwise the FO-70 scans and prints in step with the line, and the minimum scan line time it declares is honest | **[A]**, to be confirmed |
| P11 | Timing targets | The specification's "approx. 15 seconds" a page **[S]** is, by Sharp's usual footnote, for Sharp's special mode (H2) at standard resolution, excluding the protocol **[M]**. It is **not** a target for our MH and MR calls. The end-to-end test's duration range is computed from our own coded size at 9600 bit/s | **[M]** |

Nothing in the list changes a file name or a module boundary in section 7.1. `src/fax/modem/` gains `tone-detect.js`.

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

## 1. The machine

**Decided (decision 1): the Sharp FO-70**, the cutter model of the FO-50 / FO-70 pair. The FO-50 is the same machine
with a tear bar. Sources and their standing are in `research.md` sections 2 and 8; ids such as S-70 refer to it.

### 1.1 What is known about the FO-70

| Item | Value | Mark |
|---|---|---|
| Maker, models | Sharp Corporation. FO-50 (paper torn off by hand) and FO-70 (automatic cutter); some markets also had an FO-10. Related chassis: UX-8, UX-40 | **[S]** S-70, S-70-OM |
| Date | A copy of the service manual carries "(c) 1999 by Sharp Corporation"; the operation manual states the machine is Year 2000 compliant; the successors FO-51 and FO-71 have a brochure dated May 2002. So: **introduced about 1998 to 1999, a late-1990s design** | **[S]**; the exact year is not established |
| Size and weight | 304 x 236 x 122 mm, about 2.6 kg (a retailer's figures for the FO-50; Sharp's own page gives the same for the FO-51) | **[S]**; the FO-70 with its cutter may differ by a few millimetres **[A]** |
| Modem | 9600 bit/s with automatic fallback | **[S]** |
| Coding | MR, MH, Sharp (H2) | **[S]** |
| Error correction mode | None found | **[A]** |
| Resolution | 8 elements/mm across; 3.85 (standard), 7.7 (fine and halftone), 15.4 (super fine) lines/mm | **[S]** |
| Halftone | 64 levels | **[S]** |
| Scanner | Contact image sensor, 1728 elements at 8 per mm: sensor, rod lens, LED light source, light-conducting plate, control circuit. Effective scanning width 210 mm | **[S]** (the CIS description is from the FO-90A / FO-70AAR manual) |
| Feeder | Automatic, up to 5 sheets of 20 lb paper, face down | **[S]** |
| Printing | Thermal head on a thermal paper roll; a 10 m starter roll came with the machine, the replacement is the 30 m FO-20PR roll; print width 210 mm | **[S]**; roll width 210 or 216 mm by market **[A]** |
| Cutter | Automatic, in its own "drive unit (cutter model)" | **[S]** |
| Page memory | Not established. The FO-71 has 448 KB (17 pages) | **[A]** none, until read |
| Display | 16-character LCD | **[S]** |
| Dialling | 5 rapid (one-touch) keys, 35 two-digit speed-dial numbers | **[S]** |
| Keys named in the manuals | Number keys, rapid keys, SPEED DIAL, REDIAL, SPEAKER, HOLD/SEARCH, RESOLUTION/RECEPTION MODE (one key: resolution with a document in the feeder, reception mode without) | **[S]**. FUNCTION, COPY/HELP, START, STOP and the volume keys are on the sibling panels and expected here **[A]** |
| Telephone | A handset for ordinary calls and for sending and receiving by hand; SPEAKER for on-hook dialling; HOLD | **[S]** |
| Answering machine | None built in. A chapter covers connecting an external one, with a reception mode for it | **[S]** |
| Reception modes | FAX and TEL/FAX are named; TEL and A.M. are expected | **[S]** / **[A]** |
| Special functions | Caller ID and Distinctive Ring (subscription services), blocking unwanted faxes, polling; reports and lists | **[S]** |
| Mains | 220 to 240 V, 50/60 Hz in the FO-10 / FO-50 / FO-70 manual found | **[S]**; whether a 120 V model existed is open (decision 24) |
| Colour | Not established | **[A]** light grey or off-white |
| Service manual | 102 pages (other editions 96 and 78). Chapter 1 general description (specifications on page 3, operation panel); adjustments and troubleshooting with an **error code table on page 31**; circuit descriptions of the control board, the TEL/LIU board, the power supply board and the CIS unit; **mechanism blocks: operation panel, scanner frame and CIS unit, drive unit frame, head frame unit and thermal head; separate drive units for the non-cutter model (FO-50) and the cutter model (FO-70)**; parts lists | **[S]** contents list only |

### 1.2 What the choice changes

1. **The date moves from 1988 to about 1999.** The desk's dates run 1889, 1926, 1971, 1980, 1999. The machine is the
   cheap end of the fax years, the kind that stood in a small shop or a home office, not the office machine of 1988.
2. **It is smaller and simpler than the machine first planned.** About 30 x 24 x 12 cm and 2.6 kg, where the plan
   assumed 35 x 38 x 17 cm and 9 kg. A contact image sensor replaces the lamp, lens and CCD. The whole mechanism is
   four blocks.
3. **The protocol barely moves** (the section above): the same modems and coders, plus super fine.
4. **The documentation is better matched.** There is a service manual with the mechanism in blocks and exploded
   views and an operation manual for the same model, the pairing that made the Displaywriter possible.
5. **It has no free photograph and no recording.** Nothing of the FO-50 or FO-70 was found on Wikimedia Commons,
   and no listing photographs could be opened from here. The owner's own photographs matter more than before
   (section 10).

The candidates considered before the choice (an analogue Group 1 drum machine, the Xerox Telecopier 7017 of 1988,
the Ricoh FAX 77) are in `research.md` section 3 and in this file's history. A Group 1 drum machine would still be a
fine later machine, and the telephone line built here would serve it unchanged.

## 2. What is simulated, and how deeply

Depth words are the README's: *integrated* (from forces), *emergent*, *firmware logic over sensors*, *calibrated*,
*approximated*, *not modelled*. Two more are needed here: **exact** (bit for bit, or sample for sample, to a public
standard, with a test) and **signal** (the real waveform is generated and the real receiver processes it).

The mechanical rows follow the service manual's own blocks **[S]**: operation panel, scanner frame and CIS unit,
drive unit (cutter model), head frame unit and thermal head. What is inside each block is **[M]** or **[A]** until
the manual is read; the block list itself is from the manual's contents.

| Subsystem | Model | Depth |
|---|---|---|
| **Scanner frame: document feed** | The sloping document table and its sliding guides; a separation roller against a rubber separation pad that lets one of up to five sheets through, bottom sheet first **[A]**; a feed roller that carries the sheet across the sensor's glass and presses it there; a document sensor and a leading-edge sensor (levers in photo-interrupters). The sheet is a rigid lamina with three degrees of freedom (along, across, yaw) under roller and pad friction | Integrated. Skew comes from how the sheet was laid and where the guides stand. Pulling or holding the sheet while it feeds stretches or squeezes the copy. Two sheets can go through together if the pad is worn (a condition setting). **Approximated**: the sheet's bending over the path is drawn from a curve, not solved |
| **CIS unit** | A page-wide contact image sensor: an LED light source feeding a light-conducting plate, a rod-lens array at 1:1, and 1728 sensor elements at 8 per mm, behind a strip of glass **[S]**. The document's reflectance is sampled where the sheet really is at each line: the LED's profile along the plate, the rod lens's blur, which grows quickly as the sheet lifts off the glass (a contact sensor has almost no depth of field), the element's aperture, integration over the line period while the sheet moves, and noise | Modelled per line. A creased or curled sheet goes soft where it lifts; motion smear in the feed direction; uneven light before shading correction. **Not modelled**: the rod lenses one by one. The LED's colour makes some inks drop out; one spectral weight per ink is the most we do, and the colour is **[A]** yellow-green until the manual gives it |
| **Video processing** | Shading correction against a white reference; white-level tracking; a threshold moved by the contrast setting; halftone at **64 levels** **[S]** by dither or error diffusion (which one is **[A]**); standard, fine and **super fine** line pitches (3.85, 7.7, 15.4 lines/mm) by the feed step and by combining lines | Firmware logic on sensor values. The halftone method and how standard mode is derived are **assumed** until the manual says |
| **Coding (T.4)** | Modified Huffman and Modified READ (K = 2 standard, 4 fine, 8 super fine), EOL, tag bits, fill to the negotiated minimum line time, return to control; the decoder with the standard's error rules (a bad line is replaced by the one before, counted, and the page rejected past a limit) | **Exact.** A page on the line is a valid Group 3 stream that libtiff decodes. Bit-exact tests against fixtures (7.3). **Not modelled**: MMR (the machine has none **[S]**), Sharp's H2 |
| **Call control (T.30)** | The phase A to E state machines of both ends as the Recommendation's flow charts give them: CNG, CED, preamble, HDLC frames with zero insertion and frame check, DIS/DCS with the real capability bits including the extended field for super fine, CSI/TSI, training and TCF, CFR/FTT with step-down through 9600, 7200, 4800, 2400, post-page EOP/MPS/EOM and MCF/RTP/RTN, DCN, the timers T1, T2, T4 and three tries, polling | **Exact** for the standard procedure the FO-70 uses. **Not modelled**: error correction mode and V.17 (the machine is taken to have neither, **[A]**; a far end may offer them and is answered correctly); non-standard facilities (received and skipped; ours sends none); Group 2 |
| **Modems** | Transmitters for V.21 channel 2, V.27ter and V.29: scrambler, differential or QAM mapping, the training sequences, pulse shaping, carrier. Receivers that work on the audio: V.21 by discriminator; the others with gain control, symbol timing recovery, an adaptive equaliser trained on the sequence, carrier tracking and a slicer; the TCF error count decides CFR or FTT. Tone detectors for CNG, dial tone and busy | **Signal.** The sound on the line is the page's bits. Bit errors, failed training, step-down and RTN happen because the receiver really failed on a bad line. **Approximated**: transmitter filters and levels are ours, to the Recommendations' spectra, not the machine's modem chip's (the FO-71 uses a Conexant CX20438 **[S]**; the FO-70's chip is not established); both ends share one sample clock unless the line model adds an offset |
| **Telephone line and exchange** | The subscriber loop (48 V battery, loop current, hook state), a digital exchange: dial tone, digit collection from DTMF or 10 pps pulses, audible ringing and busy from a tone-plan table, 20 Hz ringing current to the called machine with a cadence per call, answer supervision, disconnect. The speech path: 300 to 3400 Hz, 8 kHz companded to 8 bits (the real quantising noise), loss, a little hybrid echo, noise and optional impulse hits by line quality | **Signal** for everything audible; the exchange is logic. Line quality is a per-number property plus a seed. **Not modelled**: trunks, long-distance delay beyond a fixed figure, billing. Caller ID and distinctive ring: decision 27 |
| **TEL/LIU board** | The line interface: line relay, pulse-dial relay or electronic switch, ring detector, transformer, the monitor speaker with its volume steps, the handset and its hook switch as a sprung contact, the jacks for the line and for an extension telephone or answering machine, the line cord's plug | Relays and the hook switch integrated as small armatures (their clicks come from their contacts). Lifting the handset during a call puts room noise on the line, as it did. The handset is a working telephone to the exchange: you hear dial tone, ringing, a far machine's tones (decision 23) |
| **Drive unit (cutter model)** | The motor or motors and their gear trains for the document feed, the recording platen and the cutter. **Hypothesis [M]**: as in other small Sharp machines, **one** stepper drives everything, with a planetary gear that swings to the scanning train in one direction of rotation and to the recording train in the other, and the cutter taken off the same motor. If so, copy mode cannot scan and print at once and must alternate or buffer | Integrated: the `stepper.js` motor model, gear trains with backlash, the swinging planet as a mechanism with its own state, so the changeover takes real time and makes its own sound. **The count of motors and the gear ratios are the first thing M0 reads**; the model is built per the manual, not per the hypothesis |
| **Head frame unit and thermal head** | The head on a sprung frame pressed against the rubber platen roller; 1728 resistive dots strobed in blocks **[S: ROHM data sheet for the format]**. Each dot has two thermal states (the element, and the glaze under it) driven by strobe energy; the substrate warms over a page and a thermistor reads it. The supply sags with the number of dots on in a block. Super fine prints at half the fine step | Integrated per printed line (not per substep). Trailing shadows after dense black, lighter print when the head is cold or many dots fire, come out of it. The time constants are **calibrated** to a head data sheet and to photographs of real output |
| **Head drive firmware** | Strobe width from the thermistor and from each dot's recent history, block sequencing, platen step timing | Firmware logic over sensors |
| **Thermal paper** | Coating darkness as a function of the peak temperature each point reached, with a threshold near 70 to 100 degrees C; the paper's position under the head from the platen roller and its own slip; two-sided (only the coated side marks) | Physically based with **calibrated** constants. A roll put in backwards prints nothing. Heat from elsewhere darkens it too: the desk's cigarette and lighter scorch it black before it burns. A fast scratch marks it |
| **Fading and age** | Each received page keeps its own age and light exposure; the image loses density and the ground yellows slowly; a patch left under the lamp fades faster | **Approximated**: one rate law with two constants, no chemistry. Whether pages age across visits is decision 13 |
| **Paper roll and path** | The roll (10 m starter or 30 m **[S]**) lying loose in its compartment under the panel **[A]**, a rotor whose radius and inertia fall as it is used; the strip from roll to head to cutter to the exit slot as a chain of segments with width, with a rest curvature set by the radius it was wound at; a paper sensor | Roll and platen integrated. The strip is a soft body on the main thread like the ribbon. The curl is stronger near the end of the roll, because it is. A 30 m roll of this size is wound on a small core, so the last pages curl hard |
| **Cutter** | The FO-70's blade after the head **[S]**, with its drive and a home sensor; the cut sheet falls, curled, in front of the machine | Integrated blade; the cut itself is a rule (the strip divides where the blade passes). A jam is possible when the strip has been pulled askew. Type (rotary or guillotine) and drive are **[A]** until read. The FO-50's tear bar is not built (decision 25) |
| **Operation panel** | The panel block, which is also the top of the scanner frame and lifts to load paper and clear jams **[A]**. Every key a stem with a rubber-dome force curve and a contact; a scanned matrix; the 16-character LCD **[S]** with our own 5 x 7 font; the beeper | Keys integrated as on the Displaywriter's panel. LCD contrast with viewing angle is a shader, **approximated** |
| **Machine firmware** | Standby, send, receive in each reception mode (FAX, TEL, TEL/FAX, A.M.), copy, handset and SPEAKER dialling, redial, HOLD, the 5 rapid keys and 35 speed-dial numbers and their programming, the clock, the header line on every sent page, resolution and contrast, polling, blocking of listed numbers, the user settings | The real machine's behaviour from its operation manual, rewritten. Runs on the simulated clock with no DOM, so it runs in Node |
| **Reports** | The lists the manual documents (expected: transmission report, activity report, telephone number list **[A]**), each rendered by the machine's character generator and printed on the thermal printer | As documented; the layouts transcribed from the manual's figures into fixtures |
| **Errors** | Document jam and misfeed, cover open, out of paper, cutter jam, head overheat; no dial tone, busy, no answer (T1), failed training at every speed, RTN, line drop in mid-page, the far end out of paper | Emergent where a mechanism or the line causes it; the codes from the service manual's error code table (page 31 **[S]**) and the display messages from the operation manual |
| **The far end** | A second complete T.30, T.4 and modem stack with a thin virtual scanner and printer (timing models, no mechanism) | The protocol side is the same exact code. Its mechanism is **not modelled** |
| **Sound** | Section 6 | Line sounds exact; mechanism synthesised from forces, replaced by recordings when the owner has them |

**Candidly approximated, in one place.** The document's bending; the CIS beyond one profile, one blur and one lift
law; the halftone method until documented; the modem's filters; the thermal constants; fading; the LCD; the far
end's mechanism; the cutter's cut; and the whole machine's firmware timing where the manual is silent. Each will be
a row in `architecture.md`'s gap table with its default and the one place it is isolated.

**A consequence worth stating.** As far as is known the FO-70 has no page memory (**[A]**, protocol change P10). The
feeder runs only as fast as the modem takes lines, and the far end prints only as fast as lines arrive. So in the
simulation the document creeps through dense passages and runs through white space, the receiving head does the
same a moment later, and at 2400 bit/s it all slows to a crawl. None of that is scripted. **If the manual shows a
memory** (the FO-71's 448 KB is the likely size), three things change: the scan runs ahead of the line into the
buffer, a page can be received with no paper and printed later, and copy mode scans first and prints after. The
firmware and the pacing note are then rewritten in M0; the protocol stack is unaffected.

## 3. What do you fax to?

### 3.1 The options

| Option | What it is | For | Against |
|---|---|---|---|
| **A. A telephone exchange in the browser, with correspondents** | The exchange and a handful of far-end machines run in the page. A card index on the desk lists their numbers | Works offline and at once; nothing to moderate; the full protocol runs at both ends; every error mode can be given a number to dial; costs nothing to host | Nobody real is there |
| **B. Real faxing between visitors** | Each visitor's machine has a number; a Cloudflare Worker with a Durable Object relays calls between two open browsers | The real thing: a page you fed comes out of someone else's machine | A Worker script where there is none today; strangers can send each other images; free-plan limits; needs two people at once |
| **C. The site's other machines** | A page typed on a typewriter or printed by the Displaywriter becomes a document you can fax; and their pages can be faxed *to* you | Ties the desk together; gives the user real documents of their own to send | Pages today live in memory for one session and are lost when the machine is switched (a page reload) |

### 3.2 Recommendation

**Build A, with C inside it; design for B and build it last, as an opt-in private line, only if the owner wants it.**
The owner has decided this way (decision 8).

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

- **Built in Blender, procedurally, one builder per service-manual block**, as `docs/displaywriter/models.md`
  prescribes. The blocks are the manual's own **[S]**, so each builder has its exploded view to work from:

  | Builder | Parts |
  |---|---|
  | `tools/blender/build_fo70_cabinet.py` | Lower cabinet, paper compartment, exit slot, rear panel with the jacks, feet, the handset cradle moulded at the left **[A]** |
  | `build_fo70_panel.py` | Operation panel on its hinge: number keys, the 5 rapid keys, the function keys, LCD window, legends, the document table and sliding guides |
  | `build_fo70_scanner.py` | Scanner frame: separation roller and pad, feed roller, sensor levers, the CIS unit with its glass strip |
  | `build_fo70_drive.py` | Drive unit (cutter model): motor, gear trains, the swinging gear if there is one |
  | `build_fo70_head.py` | Head frame unit, thermal head, springs, platen roller |
  | `build_fo70_cutter.py` | Cutter blade, guide and drive |
  | `build_fo70_handset.py` | Handset, hook plunger |

  Small parts are built in code at run time: the coiled handset cord and the line cord (curves), the paper roll (a
  cylinder whose radius is state) and the strip (the soft body's mesh).
- **Size**: 304 x 236 x 122 mm, 2.6 kg **[S]**. This is a small object: at the desk station it fills far less of the
  view than the Displaywriter, so the Fax station stands close, and the Panel and Paper focus items closer still.
- **Standard**: that of `element1971` and the Displaywriter: documented overall sizes within 2 mm, moulded shells
  with wall thickness, real gaps and bevels, every part the operator touches a separate node on its pivot, textured
  plastics. Camera-matched comparison with every reference photograph before a part is called done
  (`render_fo70_*.py`, `compare_fo70_*.py`), images kept in `docs/fax/review/`.
- **Reference photographs.** The manuals' line drawings and exploded views give geometry; photographs give colour,
  texture, legends and wear. **None has been found with a free licence, and none could be opened from here.**
  Wikimedia Commons holds no FO-50 or FO-70; its one Sharp fax is a UX-D63CL photographed in 2020 (CC BY-SA 4.0), a
  later and different machine. So the look depends on the owner's photographs (section 10) and, failing those, on
  the manuals' drawings with the colour **assumed**.
- **Legends and marks**: decided (decision 3). The maker's name and the model as on the machine, and in the header
  line and reports as documented, drawn by us as on the Displaywriter. No logo artwork is traced.
- **Thermal paper**: a roll (white, faintly glossy on the coated side, matte and slightly cream on the back), the
  core, a spare boxed 30 m roll on the desk; a paper material with a sheen difference between the faces; the
  end-of-roll stripe if the paper of the time carried one.
- **The desk**: the shared `desk.glb` and room. The machine is about 0.30 x 0.24 m, so the desk also carries the
  document folder, the card index of numbers, the cover-sheet pad and pen, the received pages (which curl and
  collect in front of the machine, since it has no tray **[A]**), the spare roll, the ashtray and the lamp, and a
  telephone socket on the wall behind with the line cord to it. Decision 10.
- **Budget**: at most 500 KB of models shipped (meshopt, then gzip), reuse of `walnut_desk`, `paper_fibre` and the
  Displaywriter's pebble plastic set where the colour allows, no texture over 1024 px on a part this small. Target
  for a fax visit: under the Displaywriter's 7.8 MB to the first keystroke (`docs/perf-review.md`).

## 6. Audio

| Sound | Source | Exactness |
|---|---|---|
| Dial tone, audible ringing, busy, reorder, intercept tones | Sums of sines at the tone plan's frequencies and cadences, through the line model | Exact by construction; tested to 0.5 % and to the cadence |
| DTMF digits; dial pulses | Two sines per digit with the machine's timing; loop breaks at 10 a second with the relay's click | Exact frequencies; timing from the manual |
| CNG and CED | 1100 Hz and 2100 Hz gated by the T.30 state machines | Exact |
| V.21 signalling, V.27ter and V.29 training and page data | The transmitters of section 2, fed the real frames and the real coded page | Exact in content: every second of it is this call's bits. Its timbre is the Recommendations' spectrum through our filters, which is where a recording of a real machine would be used to tune, not to replace |
| How you hear the line | The monitor speaker (a small cone model like `wp-speaker.js`): on after the SPEAKER key, and during automatic dialling until the handshake, by the machine's own rule; its level from the volume keys. And the handset earpiece when the handset is lifted (band-limited, quiet, heard at the Handset focus item) | The speaker and earpiece responses are **assumed** |
| The drive unit: stepper, gear trains, the changeover between scanning and recording if one motor does both | Synthesised from the motor's torque ripple, gear mesh and step impacts exciting small modal bodies in a light plastic case. A 2.6 kg machine is a thin shell: it rattles more and rings higher than the Displaywriter's printer | Synthesised from forces; levels **assumed** until a recording exists |
| The cutter | The blade's stroke and return from the mechanism's contact events. This is the FO-70's signature sound and the one most worth a recording | The same |
| Panel lifted and shut, hook switch, handset set down, keys, relays, document guides, a roll dropped in | Contact events from the mechanism | The same |
| Beeper | A piezo model; key beep, end-of-call beeps and the error alarm, with frequency and lengths from the manual or a recording | Exact once measured |
| Ringer | Electronic, through the speaker or the piezo, with the ringer volume setting; the TEL/FAX mode's own ringing to call the user to the handset | From the manual or a recording |
| Paper: the strip sliding out, a cut sheet dropping, a sheet torn | The typewriters' paper loops as a start, scaled by the strip's speed | Recorded (existing cuts), approximate fit |

**No recording of an FO-50 or FO-70 was found**, nor a video of one. The recordings that would help most are listed
in section 10 for the owner. Any thermal machine of the class is useful; an FO-70 is best. Sources and terms would
be recorded in `public/assets/audio/SOURCES.md` as now.

**Verification without an audio device**: `tools/render_wav.mjs` already renders the engines to WAV in Node. A full
call is rendered to a WAV and a spectrogram image for the owner to hear and see; tests measure tone frequencies,
cadences, levels and the modem spectra with numpy, as `tools/audio/measure.py` does.

## 7. Architecture

### 7.1 Where things live

The protocol stack's paths are **unchanged** from the first plan, since work on them has started. The machine's own
files are renamed from `fax1988` to **`faxfo70`** (decision 4), and the mechanism host is divided as the service
manual divides the machine.

| Piece | Where | Notes |
|---|---|---|
| Machine definition | `src/machine/faxfo70.js`, `fax-geometry.js`, registered in `src/machine/index.js` with `action.type: 'thermal-fax'`; listed in `UNLISTED` until M7 | Every parameter in SI units with its source and its mark ([S], [M], [A], then a page number). `geometryFor` becomes a table by family instead of the `kind === 'system'` test |
| Kit | `src/kits/fax.js`, parts in `src/kits/fax/` (line, documents, tray, store) | A third entry in `KITS`; `main.js` unchanged |
| Mechanism host | `src/sim/fax/`: `index.js` (`FaxSim`), then one file per block of the manual: `scanner-mech.js` (document table, separation, feed roller, sensors; the sheet), `drive-mech.js` (motor or motors, gear trains, the changeover gear), `head-mech.js` (head frame, springs, platen roller, paper roll), `cutter-mech.js`, `liu-mech.js` (relays, hook switch), `panel-mech.js` (keys, the panel's hinge and latch), `layout.js`, `ports.js`; reusing `src/sim/wp/stepper.js` and `inputs.js` (moved to a shared folder) | Behind the same `SimClient` contract; a third row in `host-factory.js` `HOSTS`. 384 kHz like the others (`SUBSTEP_HZ`); the FO-70 has perhaps ten degrees of freedom, most asleep |
| Controllers | `src/sim/fax/scan-ctl.js`, `print-ctl.js` (head strobes, platen steps, cutter), `drive-ctl.js` (which train the motor is on, if one motor serves both), `liu-ctl.js`, `panel-ctl.js` | Frozen I/O objects exactly as `printerIO` in `src/sim/wp/index.js`: set phases, strobes and relays, read sensors. `tests/fax_controllers.test.js` proves none writes a mechanical state |
| Thermal model | `src/fax/thermal/head.js`, `paper.js` | Pure functions of strobe energy and history; called once per printed line by the mechanism host |
| CIS and video | `src/fax/image/cis.js`, `video.js` | Pure; one call per scanned line. `cis.js` takes the sheet's lift off the glass as an input |
| **Protocol stack** | `src/fax/t4/` (`tables.js`, `encode.js`, `decode.js`), `src/fax/hdlc.js`, `src/fax/t30/` (`frames.js`, `caller.js`, `answerer.js`, `timers.js`), `src/fax/modem/` (`v21.js`, `v27ter.js`, `v29.js`, `scrambler.js`, `rx-common.js`, **`tone-detect.js`**), `src/fax/line/` (`exchange.js`, `tones.js`, `dtmf.js`, `channel.js`, `companding.js`) | **Its own module with no DOM, no timers and no mechanism imports.** Time is a sample count handed in. Typed arrays allocated once. Runs in Node, on the main thread and in the worklet unchanged. It knows nothing of the FO-70: the machine's capabilities (speeds, coders, resolutions, line times) are handed in as a table from `faxfo70.js`, and the tone plan as a table from `tones.js` |
| Far ends | `src/fax/remote/` (`virtual-fax.js`, `directory.js`, `documents/`) | The same stack with a virtual scanner and printer, each with its own capability table (one offers V.17, ECM and MMR in its DIS, which the FO-70 declines) |
| Firmware | `src/fax/firmware/` (`main.js`, `dial.js`, `rxmode.js` for the reception modes, `reports.js`, `chargen.js`, `messages.js`) | Generator tasks on the simulated clock, like `src/wp/sched.js`; reaches the machine only through the controllers |
| Audio | `src/audio/fax-engine.js` (steps the host, renders the mechanism's voices and the line's listeners), `fax-synth.js`, `fax-line-tap.js`; worklet entry `src/audio/worklet-fax.js`; a third branch in `src/sim/worklet-url.js` and in `tests/worklet_entries.test.js` | Stereo, with the interface of `WpAudioEngine` |
| Rendering | `src/render/fax/` (`body-view.js`, `strip-view.js`, `lcd.js`, `roll.js`, `documents.js`) | The strip's texture is written line by line from the head model's output |
| Views | The graph in `src/interact/wp-views.js` becomes data passed in (`STATIONS`, `FOCUS`, order); the fax supplies `src/machine/fax-views.js`. `wp-markers.js` and `wp-nav.js` are reused as they are | Stations: Desk, Fax, Documents, Received, Numbers. Focus items at the Fax: Panel, Display, Feeder, Paper (panel lifted: roll, head, cutter), Handset, Rear |
| Pages | The existing `src/pages/` pile, viewer and PDF export take received faxes (a thermal-paper look in `composePage`) | Plus the IndexedDB out tray and in tray |
| Tools | `tools/fax/make_vectors.py` (fixtures from libtiff), `tools/fax/render_call.mjs` (a call to WAV and spectrogram), `tools/fax/calibrate_thermal.mjs`, `tools/blender/build_fo70_*.py` | |

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
   63, 64, 1728 and 2560, a one-pixel change between lines for every READ mode; at each of K = 2, 4 and 8.
4. **Decoder under damage**: flipped bits never crash or run past the line; the bad-line count and the
   previous-line substitution match the rule.
5. **HDLC**: the frame check on the standard check string, zero insertion at every position, flags, aborted frames.
6. **T.30 frames**: DIS and DCS built and parsed bit by bit against worked examples in the Recommendation's tables,
   including the extended field (super fine) and a DIS that offers V.17, ECM and MMR, which the FO-70 side declines;
   a non-standard frame before DIS is skipped;
   whole-call scripts (the Displaywriter's "13 keystroke scripts" idea): the sequence of frames and tones of a clean
   one-page call, a two-page call, a retrain, an RTN and resend, a timeout, a poll, each compared with a transcribed
   signal ladder.
7. **Modems**: constellation points and scrambler sequences against the Recommendations' tables; loop-back with no
   noise has zero errors; error rate against signal-to-noise ratio within a set margin of theory; the transmit
   spectrum inside a mask; V.21 tones within tolerance; and, if spandsp can be run offline, our receiver decodes a
   WAV spandsp transmitted and its receiver decodes ours (fixtures made once, not a dependency).
8. **End to end, the headline test**: our chart, through the CIS model, MH, T.30, V.29, the channel, the far end's modem,
   decoder and virtual printer: bit-identical on a clean line; on a set noisy line, a step-down to 4800 and a page
   with at most the allowed bad lines; and the call's duration within a stated range of the figure computed from
   the coded size and the speed (not the manual's "15 seconds", which is for Sharp's own mode, P11).
9. **Mechanism**: feed speed and line pitch (3.85, 7.7 and 15.4 lines a millimetre within tolerance), no lost steps, skew
   from a skewed start, the cutter's cycle, the hook switch, out-of-paper and jam sensing, energy bounded.
10. **Thermal**: density against strobe energy matches the calibration; the cold-head and many-dots cases move the
    right way; a roll in backwards prints nothing.
11. **Firmware**: keystroke scripts against LCD fixtures and report fixtures transcribed from the manual.
12. **Budgets and hygiene**: worklet entry bundles only its family; no forbidden globals; the audio budget.

## 8. Milestones

Each is shippable behind `UNLISTED`, and each ends in Node tests before anything is judged in the browser, because
this container's browser draws at well under one frame a second. **M1, M2 and M3 are under way in parallel**; the
changes the FO-70 makes to them are items P1 to P11 at the top of this file.

| M | Deliverable | Accepted when (Node) | Then in the browser |
|---|---|---|---|
| **M0** | **Read the FO-50 / FO-70 service manual and operation manual** (hosts allowed, or the PDFs put in `docs/fax/refs/`), and T.4 and T.30 of 1993 to 1996. Settle first: ECM or not, memory or not, the number of motors, the market variant, the year. Write `hardware.md`, `protocol.md`, `architecture.md` with every [S], [M] and [A] replaced by a page or a clause. Scaffold: definition, kit, registry, host and worklet entries, the view graph made data, block-out boxes on the desk | All existing tests pass unchanged; `fax_layout`, `fax_views` and worklet-entry tests pass; the owner's decisions are recorded | A grey block of 304 x 236 x 122 mm stands on the desk at `?machine=faxfo70`; stations work |
| **M1** | T.4: tables, MH and MR encoder and decoder at **three resolutions** (K = 2, 4, 8), fill, RTC, damage rules; `make_vectors.py` and fixtures | 7.3 items 1 to 4. A page file our encoder wrote opens in any TIFF viewer | none |
| **M2** | HDLC and T.30, both ends, over an ideal bit pipe; **DIS and DCS with the extended field**; non-standard frames skipped; a far end that offers more than the FO-70 has; the virtual fax; timers; polling | 7.3 items 5 and 6 | none |
| **M3** | The line: exchange with its tone plan as a table, tones, DTMF and pulse, channel and companding; V.21, V.27ter and V.29 transmit and receive; **CNG and call-progress detectors**; `render_call.mjs` | 7.3 items 7 and 8 (with an ideal scanner). **The owner gets a WAV of a whole call to listen to** | none |
| **M4** | Scanner frame and CIS: feeder mechanism and scan controller; the CIS and video processing; three resolutions, contrast, 64-level halftone | 7.3 item 9 (feeder); the chart scanned straight gives a stated minimum of resolved line pairs; skewed, the skew measured in the output equals the sheet's; a sheet lifted off the glass blurs by the stated law | none |
| **M5** | Drive unit, head frame and cutter: motor and gear trains, platen, roll, head pressure, the cutter's cycle; thermal head and paper; print controller; calibration tool | 7.3 items 9 (printer) and 10; a copy of the chart, end to end in the host, within a stated density and geometry tolerance of the original; the cut lands within tolerance of the page end | none |
| **M6** | Firmware: panel, LCD, dialling by handset, SPEAKER, rapid key and speed dial, send, receive in each reception mode, copy, programming, header line, reports, error codes | 7.3 item 11; no controller writes a mechanical state | none |
| **M7** | **On the desk.** Models to the standard, views and markers, every control, the strip and the falling cut sheet, the LCD, the audio engine and voices, the correspondents and sample documents. Camera-matched review images. **First public version**: listed in the menu | Models test (`tests/models.test.js` fixtures), view graph, audio levels and budget | e2e under `xrun.sh`: lay a sheet, press COPY, a cut page lands in front of the machine; dial the office, the page comes back; screenshots at each station |
| **M8** | Documents: the out tray from the other machines, cover sheets, pen, image upload; the in tray kept between visits; fading | Storage round trips; fading law; upload scaling | e2e: a typewriter page is sent to the tray, the machine is switched, the page is faxed |
| **M9** | The full directory, every error mode with its recovery, line quality, redial, the reports; blocking of listed numbers; `?cold` (unplugged, no roll, clock unset). Optional here: Caller ID and distinctive ring (decision 27) | Each error script | e2e of a failed call and a jam cleared by hand |
| **M10** | *Optional, and later (decision 8).* The private line between two visitors: Worker, Durable Object, relay, the rules of 3.2 | The relay end to end in Node against a local `workerd`; limits and expiry | Two browsers, one page |
| **M11** | Finish: budgets measured and fixed as tests, README section with its own depth table, `docs/assets.md`, `SOURCES.md`, the contract in `docs/ARCHITECTURE.md` | Everything green; download and audio figures recorded in `docs/perf-review.md`'s form | A last look by the owner on real hardware (GPU and sound), which this container cannot give |

**What the FO-70 did to the scope.** Added: super fine (M1, M2, M4, M5), the extended DIS (M2), tone detectors
(M3), the reception modes (M6). Not added: V.17, ECM, MMR. Removed: the lamp, lens and CCD model, a second stepper
if the drive unit has one motor, the exit tray, and about a third of the modelling work, because the machine is
small. Held open until the manual is read: page memory (it would change the pacing note of section 2, copy mode in
M6 and add reception to memory in M9).

M1, M2 and M3 need nothing from the machine's manual beyond items P1 to P11. M4 to M6 wait on M0.

## 9. Decisions for the owner

**Decided** are marked. The rest keep their recommendation as the provisional default that work proceeds on.

| # | Question | Options | Standing |
|---|---|---|---|
| 1 | **Which machine** | | **Decided: the Sharp FO-70** (cutter model of the FO-50 / FO-70) |
| 2 | **Recordings and photographs** | Supply any you have or can make (the list in section 10); or none, and the look comes from the manuals' drawings and everything mechanical is synthesised with assumed levels | Open. Supply what you can: nothing free was found for this model. The photographs of the panel and a copy-mode recording matter most |
| 3 | **Names and marks** | | **Decided: as on the Displaywriter.** The maker's name and the model on the machine and in its header line and reports as documented, drawn by us |
| 4 | **Machine id and menu name** | (a) `faxfo70`; (b) `fax1999`; (c) `fax1998` | **Proposed: `faxfo70`**, shown in the menu as "Sharp FO-70 facsimile, c. 1999". The year is known only as "about 1998 to 1999" from a copyright line and a Year 2000 notice, and an id should not need renaming when the manual's cover settles it. `fax1999` is the alternative if the id must match the others' pattern |
| 5 | **Country and line** | (a) North America: precise tone plan, DTMF with a pulse switch, letter paper, 120 V 60 Hz, mu-law; (b) the market of the variant modelled (decision 24): for Australia or the UK other tones and ringing cadence, A4, 240 V 50 Hz, A-law | Provisional default **(a)**, as before. **But see decision 24**: no North American FO-70 has been confirmed. The exchange takes its tone plan as a table (P7), so the choice stays cheap |
| 6 | **Depth of the modems** | (a) Real transmitters and real receivers on the audio, errors emergent; (b) real transmitters, but the bits also pass on a side channel and errors are drawn from the line's noise figure | Provisional default **(a)**; (b) remains a fall-back per modem if a receiver proves stubborn (risk 3) |
| 7 | **Protocol scope** | (a) What the FO-70 has: V.21, V.27ter, V.29, MH, MR, three resolutions, polling; (b) add ECM, MMR or V.17 | Provisional default **(a), to match the FO-70**. (b) only for whatever the service manual shows the machine really had. Sharp's H2 mode is not built in either case |
| 8 | **What you fax to** | | **Decided: the in-browser exchange with correspondents and the site's other machines now.** The private line between two visitors (Worker and Durable Object, opt-in, nothing stored, no directory) is optional and later (M10). An open public exchange is not built |
| 9 | **Correspondents' content** | (a) Our own short texts and drawings; (b) also pages that refer to the site's other machines (a memo typed on the 1926 machine, a Displaywriter printout) | Provisional default (b): it makes the desk one office |
| 10 | **Desk** | (a) The shared desk with the fax alone and its props (card index, folder, cover-sheet pad, spare roll, received pages, lamp, ashtray, wall socket); (b) a new side table; (c) on the Displaywriter's desk beside it | Provisional default (a). The FO-70 is small enough for (c), but that would make every Displaywriter visit download the fax |
| 11 | **Start-up** | (a) Warm: plugged in, roll loaded, clock set, a few numbers programmed, standing by; `?cold` gives an unplugged machine with no roll and the clock unset; (b) always cold | Provisional default (a), as for the Displaywriter |
| 12 | **The machine's clock and date** | (a) The visitor's real date and time, printed in the header line; (b) a fixed date in 1999; (c) unset until the visitor sets it | Provisional default (a) warm, (c) under `?cold`. The machine is Year 2000 compliant **[S]**, so the real date is one it can show |
| 13 | **Received pages and age** | (a) Kept between visits in IndexedDB, and they fade and yellow with real elapsed time; (b) session only, with a time-lapse control to show fading; (c) both | Provisional default (c) |
| 14 | **Real keyboard** | (a) Digits, `*` and `#` are the keypad; Enter is START; Esc is STOP; `C` copy, `R` redial, `H` hook, `F` function, `S` speaker; everything else is clicked; (b) clicks only | Provisional default (a), listed under the **keys** button |
| 15 | **Hearing the line** | (a) Only as the machine allows: the monitor speaker by its own rule and the SPEAKER key, and the handset when lifted; (b) also a Settings switch "line monitor" that keeps the speaker on for the whole call | Provisional default (a), with (b) as an honest extra, off by default and labelled as not original |
| 16 | **A "line card"** | A small flat panel showing the call as a signal ladder with frame names, speed, line count and a spectrum strip; or nothing | Provisional default: yes, hidden by default |
| 17 | **Call speed** | (a) Always real time; (b) a "fast" switch, clearly marked unreal | Provisional default (a) only |
| 18 | **Paper supply** | (a) The roll runs down across visits and must be replaced from the spare box; the machine starts with the 10 m starter roll part used and a 30 m spare; (b) endless | Provisional default (a) |
| 19 | **Faults on by default** | (a) A machine in good order; jams and bad lines only where the visitor causes or dials them; (b) occasional random faults | Provisional default (a) |
| 20 | **Test charts** | (a) Our own chart only; (b) also buy and ship the ITU set | Provisional default (a) |
| 21 | **Uploaded images** | (a) Allowed, kept in the browser; (b) not offered | Provisional default (a); to be looked at again if the private line of decision 8 is ever built |
| 22 | **Night** | (a) The lamp as on the typewriters, plus the machine's own small lights (the LCD, any LEDs, the CIS's LED glow at the document slot while reading); (b) dim only | Provisional default (a) |
| 23 | **The handset** (new) | The FO-70 has one **[S]**. (a) A working telephone to the exchange: lift it, hear dial tone, dial, hear ringing, busy or a far machine's tones; send and receive by hand with START; HOLD works; a voice call reaches only recorded silence or a correspondent's tones, since nobody is there; (b) also let one or two correspondents "answer" with a short spoken recording; (c) a prop that only lifts | Recommended **(a)**. It is how manual sending worked and it is the best way to hear the line. (b) needs voice recordings and is not worth it |
| 24 | **Which market's FO-70** (new) | The documents found are for 220 to 240 V markets: service manuals numbered for "A", "RA", "AAR", "TH" and "DE" variants and a South African listing **[S]**. The operation manual lists Caller ID and Distinctive Ring, which fit North America or Australia. (a) Model the variant whose manual is read in M0, and take its mains, paper size, legends and tone plan together; (b) model that variant's machine but keep it on a North American line; (c) find a North American FO-70, if one existed | Recommended **(a) if you have a particular machine in mind or in hand: tell me its rating plate and the letters after "FO-70"**. Otherwise (b), which keeps decision 5 as it stands and changes nothing on the machine but the plug |
| 25 | **FO-50 or FO-70** (new) | (a) The FO-70 only, with its cutter; (b) also offer the FO-50 as a variant: the same machine with a serrated bar, where you tear each page off by hand | **Decided by the choice of machine: (a).** (b) is cheap to add later, since one manual covers both and only the drive unit differs, and tearing a page off is a pleasing thing to do. Not planned unless asked |
| 26 | **An answering machine** (new) | The FO-70 has none built in; it has a jack and a reception mode for an external one **[S]**. (a) Leave the jack empty; the A.M. mode is in the menu and behaves as it would with nothing connected; (b) put an answering machine on the desk | Recommended (a). (b) is a fifth machine |
| 27 | **Caller ID and Distinctive Ring** (new) | Both are in the operation manual **[S]**. (a) Present in the menus, off, as on a line without the services; (b) the exchange also provides them: a calling number shown on the LCD between the first and second ring, and a second number with its own ringing pattern | Recommended (a) now and (b) in M9 if wanted. The exchange is built so that (b) is an addition, not a change (P8) |

## 10. What the owner should supply

Nothing free was found for this model: no photograph on Wikimedia Commons, no recording, no video, and the listing
sites cannot be opened from here. In order of value:

**Documents** (or allow the hosts in `research.md` section 1):

1. The FO-50 / FO-70 **service manual** PDF (102 pages; `research.md` S-70).
2. The FO-50 / FO-70 **operation manual** PDF (S-70-OM).
3. If you have a machine: the **rating plate** on the underside (model suffix, voltage, date of manufacture). It
   settles the year and decision 24 at once.

**Photographs** of an FO-70 (yours, or saved from a listing with its address, for reference only and not for
shipping). Daylight or an even lamp, no flash, a ruler or a sheet of paper in the picture for scale:

| # | View | What it settles |
|---|---|---|
| 1 | Front, square on, at the machine's own height | Proportions, the exit slot, the handset |
| 2 | Left side and right side, square on | The wedge profile, the cradle, the panel's hinge line |
| 3 | Top, straight down | The panel's layout, the document table and guides |
| 4 | **The panel close up, square on, sharp enough to read every legend** | Every key, its legend, colour and size; the LCD window. The most valuable single picture |
| 5 | Three-quarter view from the front left and the front right | Shape, colour and texture of the plastics |
| 6 | Rear and underside | The jacks and their marks, any switch, the label's place |
| 7 | **Paper loading: the panel lifted, with and without a roll** | The paper compartment, the head frame, the platen roller, how the roll lies and which way the paper leads |
| 8 | **The cutter**, as close as the camera focuses, and the exit slot from the front | The blade, its guide, where the cut falls |
| 9 | The scanner with the panel lifted: the CIS's glass strip, the rollers, the separation pad | The scanner frame |
| 10 | The handset off the cradle; the cord's ends | The hook switch, the handset's shape |
| 11 | The LCD showing the standby display, and one menu | The character cell, the font, the contrast |
| 12 | **A received page and a copy, flat beside a ruler**, and any old thermal fax you have kept, however faded | The print's density, the header line's font, the cut's edge, the curl, and what fading looks like |
| 13 | A printed report or number list, if the machine will print one | The report layouts and the character generator |

**Recordings.** A telephone's voice memo is enough; uncompressed is better. Put the microphone about 30 cm above
the panel, no speech or music, and record ten seconds of the room's silence first:

| # | Recording | What it settles |
|---|---|---|
| 1 | **Copy mode**: one page with text and a broad black band, from pressing the key to the cut sheet landing | The motor, the gear changeover, the head, **the cutter**, the beeps: nearly every level, with no line needed |
| 2 | **A send**: one page to any fax number, speaker on | The dialling, the monitor speaker's tone, when it mutes, the scan's pace |
| 3 | **A receive**: one page, from the first ring | The ringer, the answer, the print's pace against the line, the cutter, the end beeps |
| 4 | Each control alone: a number key, a rapid key, START, the handset lifted and set down, the panel opened and shut, a roll dropped in, a sheet pushed into the feeder | The small sounds |
| 5 | If you can: the line itself during a call, from a telephone recording adapter | The transmit filters and levels of the real modem |

Any thermal fax machine of the same class is useful if an FO-70 cannot be had; say which it was.

## 11. Risks and unknowns

| Risk or unknown | Effect | Mitigation |
|---|---|---|
| 1. **The FO-70's manuals have been located, not read.** Every figure in section 1.1 is from search summaries; the drive unit's layout, ECM and memory are not established | Hardware figures, the control list and the pacing note may change | M0 comes first and is cheap. M1 to M3 depend only on items P1 to P11. Every figure lives in one definition file with its mark |
| 2. The hosts stay blocked | M0 cannot be done from a cloud session | The owner downloads the two PDFs (section 10) into `docs/fax/refs/`, or allows the hosts listed in `research.md` section 1 |
| 3. A V.29 or V.27ter receiver that trains reliably is real DSP work | M3 slips | They are standard designs with a free reference to read (spandsp). Tests grow from loop-back at no noise. Decision 6(b) is the per-modem fall-back, and the sound is unaffected by it |
| 4. Facts in `research.md` marked [M] are from memory (frame codes, timer values, training lengths, the V.27ter symbol rates) | A wrong constant would make the stack self-consistent but not standard | Each is checked against the Recommendation in M0; the libtiff and spandsp oracles catch what reading misses |
| 5. Editions: the FO-70 is a machine of about 1999, and the first notes were written against the 1988 texts | Missing extended DIS bits and super fine; or anachronisms the other way | Work from T.4 and T.30 of 1993 to 1996 (P5); RFC 804 carries the 1981 T.4 text meanwhile, and the code tables have not changed |
| 6. Audio-thread cost of two modems, two state machines and a mechanism | Glitches on slow devices | The line rate is 9600 Hz, not 384 kHz; budgets become tests in M3; the far end can move to the main thread behind the same interface if ever needed |
| 7. A 4 MB transfer per page to the worklet, and several pages in the feeder | A pause when a sheet is laid | Transferable buffers; send each page when it reaches the separation roller; standard resolution halves it |
| 8. The paper strip is a new soft body (a curled ribbon with width that is cut and falls) | The most visible new physics; could look wrong | It is built on the ribbon's rope and the sheet's XPBD, both proven here. A falling sheet that settles to a stored curled pose is the fall-back |
| 9. Thermal constants and fading have no measured source | The print could look too clean or too crude | Calibrate against the owner's samples of real output (section 10, photograph 12) and Commons photographs of thermal output; keep the constants in the definition |
| 10. No recording and no photograph of an FO-70 was found | Assumed sound levels; assumed colour and legends | Section 10; the sample path stays open; the manuals' drawings give the geometry meanwhile |
| 11. Marks and the look of a current company's old product | The same question as IBM's | Decided (decision 3): real names, everything drawn by us, no logo artwork traced |
| 12. Cross-visitor faxing: abuse, limits that change, a server to look after | Harm to visitors or to the site | Last and optional; private lines only; nothing stored; free-plan figures re-checked on the day (`research.md` 5 notes a conflicting statement) |
| 13. The ITU test charts are not free | No standard chart in the repository | Our own chart (decision 20) |
| 14. Verification is blind and deaf here: software rendering under one frame a second, no audio device | Looks and sound cannot be judged in the container | Node tests carry correctness; WAV and spectrogram renders and camera-matched stills go to the owner; M11 is the owner's pass on real hardware |
| 15. `wp-views.js` and `geometryFor` are written for one system machine | Small refactors in shared code | Done in M0 as pure moves under the existing tests, as the kit split was |
| 16. Scope: reports, programming menus and every user switch of a real machine add up | M6 grows | Fix the core in `architecture.md` as the Displaywriter's 7.8 did (send, receive, copy, dial, redial, one-touch, header, transmission report, journal); the rest are present as documented menus that say so |
| 17. Unknown until read: the number of motors and the gear changeover, step angles and ratios, the cutter's type and drive, the CIS's LED colour, the head's strobe scheme, the halftone method, the full key list and legends, user and service settings, the error codes, report layouts, the reception modes' timings, the colour | Placeholders | The gap table of `architecture.md`, each with a default and one place it is isolated |
| 18. **ECM or page memory turns out to be present** | M2 would need Annex A (HDLC page frames, PPS, PPR); the firmware would buffer, and the pacing note of section 2 is wrong | Checked first in M0 from the service manual's specification page. Both are additions behind the capability table: the stack as built stays valid, since an ECM machine still makes non-ECM calls |
| 19. **The market variant.** The documents found are for 220 to 240 V markets; a North American FO-70 is unconfirmed | Legends, paper width, mains, tone plan and companding law may all differ from the provisional North American default | Decision 24; the tone plan and law are tables (P7); the roll and document widths are definition parameters |
| 20. The year is "about 1998 to 1999" from a copyright line and a Year 2000 notice | A wrong year in the menu or the id | The id proposed is `faxfo70` (decision 4); the menu says "c. 1999" until the manual's cover or a rating plate settles it |
| 21. One motor may serve scanner, printer and cutter through a changeover gear | Copy mode and the mechanism's timing are quite different from a two-motor machine | The drive unit is its own file and controller (7.1); nothing else assumes the count |
