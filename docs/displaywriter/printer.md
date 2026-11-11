# Printwheel printer (5218) — research notes for the physical simulation

Scope: the daisywheel "printwheel" printer of the 1981 word processor (models A01 at 40 cps and A02 at 60 cps; the
1983 A03/A04 redesign is noted where it adds facts). Every value has a citation. **Inferred** marks a value derived
by us, with the method stated. Repository ground rule: none of the names or marks below go into the product. They
are here only to identify the sources.

## Sources and citation keys

| Key | Document | Pages |
|---|---|---|
| MIM | SY20-8520-0, 5218 Printer Maintenance Information Manual, Mar 1981 (A01/A02) | 284 |
| MIM83 | SY20-8578-0, 5218 Printer Models A03/A04 Maintenance Information Manual, May 1983 (bitsavers, downloaded) | 288 |
| SET | GA23-1007-1, 5218 Printwheel Printer Setup Procedures, May 1981 | 60 |
| GIM | G544-0851-5, Displaywriter General Information Manual, May 1982 | — |
| MD | 6580 Machine Description, Nov 1983 | — |
| ORG | S544-2036-0, Operator Reference Guide, Textpack 4, Feb 1982 | — |
| PH | bitsavers `pdf/ibm/5218/pictures/` photos `5218.jpg`, `5218_1.jpg` … `5218_5.jpg` | — |

`p.N` is the PDF page: the number of form feeds before the line, plus 1. Page numbers were checked against
renders for MIM p.18, 20, 51, 52, 57, 58, 87, 91 and 186.

Local copies of the photos and manuals were made during research and are not committed; fetch them again from
the Bitsavers `pdf/ibm/5218/` directory.

---

## 1. The machine as a whole

| Item | Value | Source |
|---|---|---|
| Models | A01: 40 cps, open-loop escapement, left margin switch. A02: 60 cps, optical encoder on the escapement motor, margin sensed through the encoder. Otherwise identical | MIM p.172; GIM p.28 |
| Speed rating | "10-pitch rated burst" 40 or 60 cps; actual time per page depends on the text | GIM p.28; MD (Printwheel Printers) |
| Printing | Bidirectional: prints with the carrier moving left or right | MIM p.172; GIM p.28 |
| Weight | about 29 kg (64 lb), a two-person lift | SET p.10 |
| Sheet feeder option | about 11.3 kg, sits on top of the printer, latches into the cover openings | SET p.22–23 |
| Overall dimensions | **Not found in any source.** Inferred from PH `5218_2.jpg` (top view) and `5218_1.jpg` (front), using the paper slot as the scale: it must pass 392 mm paper, so its inner width is taken as about 400 to 410 mm. Result: width about 0.70 to 0.79 m, depth about 0.55 to 0.60 m, height about 0.20 to 0.25 m. Low confidence (±10 %) | inferred |
| Cover | Off-white or light warm-grey plastic, matte finish to cut glare. A top cover over a bottom cover, and a lift-up operator access cover in the centre. The access cover is held by a magnetic latch on A01/A02 (a spring clip on A03/A04). Behind it, a tinted transparent window and a perforated "acoustic filter" form the paper slot at the rear top. Two square openings in the top take the paper handler latches, or snap-in cover inserts when no handler is fitted | GIM p.104 (matte); MIM p.183, MIM83 p.134 (latch); SET p.11, p.16 (inserts, "acoustic filter" with a paper-alignment triangle); PH 5218_1/5218_2 (colour, layout) |
| Mechanism mounting | The printer mechanism sits on shock mounts inside the covers. The bottom cover is lined with acoustic material | MIM p.29–31 (shock mount screws), p.63 (acoustic material) |
| Power switch | Rocker on the front right face (red rocker in a dark bezel, "I/O") | MIM p.17 item 1; PH 5218_1 |
| Fan | Printer fan at the right rear, driven from the AC line | MIM p.17 item 10, p.21, p.191 (J2 is the AC fan feed); PH 5218_5 |
| Power-on self-test | about 15 s of internal checks, then only Power On lit | SET p.15–16 |
| Rear panel | Attachment panel: the controller connector (twisted-pair serial), a connector for the paper handler, and the AC inlet. The photo shows a round multi-pin socket, a DE-9 and an IEC inlet | MIM p.194; PH 5218_3 |

### Operator panel
On the front face, centred, angled for a standing or seated operator, with every light and control reachable from
the front (GIM p.104). It has 8 switches, 10 LEDs and a two-digit 7-segment display. The display data is shifted
serially into a 25-bit register (MIM p.180).

| Element | Function (short) | Source |
|---|---|---|
| LEDs, two rows of five, left | Power On, On Line, Ribbon, Ready, Printer Excep, Release, Setup, Load Paper, Change Font, Diag Mode | MIM p.182; SET p.16 |
| Two-digit red display | Error codes, the font number needed, diagnostics | MIM p.182, p.122–126 |
| Start, Stop | Make the printer ready; finish what is buffered, centre the carrier and go not ready | MIM p.181 |
| Print Test, Cancel | Print every petal (two lines); cancel and report to the controller | MIM p.181, p.131 |
| Load, Release | Feed a sheet to the first writing line; open the bail and reverse the feed rollers | MIM p.181 |
| Paper Up, Paper Down | First press moves 1/48 in. Held 250 ms, 7/48 in more. After a further 350 ms, steps of 8/48 in every 66 ms | MIM p.181 |
| Colours (photo) | Black panel in a tan/beige frame. Start green, Stop yellow-orange, the other keys blue. A blank black area on the right | PH 5218_1, 5218.jpg |
| Ribbon saver switch (A03/A04 only) | Quality or economy ribbon mode | MIM83 p.74 |

---

## 2. Platen and paper handling

| Item | Value | Source |
|---|---|---|
| Platen diameter | **Not given.** Inferred at about 40 to 45 mm. Method: in PH `5218_4.jpg` the platen's visible length is about 9.8 times its diameter. Its length must exceed the 392 mm maximum paper, so about 410 to 420 mm is assumed. Check: index steps of 1/96 in at 180 steps per revolution move the paper 1.875 in per motor revolution. A 42 mm platen then needs a belt reduction of about 2.8:1, which is plausible | inferred |
| Platen length | ≥ 392 mm (it handles paper up to 392 mm / 15.43 in). Inferred about 410 to 420 mm | MIM p.172; GIM p.28 |
| Platen surface | Black rubber (photo). End play 0.03 to 0.15 mm set by the platen gear | PH 5218_4; MIM p.36 |
| Knobs | No operator platen knob is mentioned or visible. Paper is moved by the Paper Up/Down keys. The only knob in the manuals is the **ribbon advance knob** on the carrier | MIM p.95, p.181; PDG (S544-2000-2) p.25 |
| Maximum writing line | 335 mm (13.2 in) | MIM p.172; GIM p.28 |
| Paper width (manual feed) | 80 to 392 mm | GIM p.28 |
| Feed | **Friction**: platen plus feed rollers. Six roller modules on a rod under the platen, each with a front and a rear roller and a paper aligner. A cam deflector arm with spring fingers rocks the modules front-to-rear to engage or release the paper | MIM p.186 |
| Cam | Driven by a DC cam motor through a worm and idler gear. 5 positions: 1 home (front feed roller engaged), 2 tractor, 3 rear feed roller, 4 paper release, 5 bail open with front feed roller. Home is sensed by a magnet and reed switch, positions 2 to 5 by a second reed switch. Error 76 if no feedback within 1 s | MIM p.186 (figure), p.113, p.124 |
| Paper bail | Opened and closed by a pawl on the cam, so it is motorised. Opens automatically on Load or Release | MIM p.186, p.181 |
| Paper path | The sheet is dropped into the slot at the rear top and aligned left on a triangle mark on the acoustic filter. Load feeds it to the first writing line ("up to the top of the card holder"). A reflective first-writing-line sensor under the platen sees the paper edge (used with the paper handlers) | SET p.16–17; MIM p.190 |
| Line feed motor | Permanent-magnet stepper, 180 steps per revolution, open loop, reversible. Drives the platen through a timing belt. 1 step = 1/96 in = 0.2646 mm. It also drives the tractor or sheet feeder through a gear. Belt tension: 2.5 to 3 mm deflection under 450 g | MIM p.184, p.186, p.38 |
| Line feed time | **Not given.** Bound from the Paper Up auto-repeat: 8/48 in (16 steps) every 66 ms, so at least about 240 steps/s and 64 mm/s sustained. Inferred: one 6 lpi line feed (16 steps) takes ≤ 66 ms including settle | MIM p.181 (inferred) |
| Line spacing | Vertical resolution 1/96 in. Operator spacings: 5.1 (special order), 5.3, 6 or 8 lines/in, plus 24 lines/in (1.06 mm) for forms alignment. Half, single, 1½, double or triple spacing | MIM p.172; GIM p.28, p.47 |
| Index command range | 0 to 2047/96 in, forward or reverse (reverse registration not guaranteed) | MIM p.198 |
| Tractor option | Forward only. Forms 64 to 381 mm edge to edge (51 to 370 mm hole to hole). Up to an original plus 5 copies, ≤ 0.6 mm thick. Fed from up to 915 mm below the platen. After Load with a tractor, 250 mm of paper advances | MIM p.204, p.181; GIM p.96–97 |
| Sheet feeder option | Two trays of about 200 sheets each, an output stack of about 400. Sits on top of the printer | GIM p.29; SET p.22–35 |

---

## 3. Printwheel

| Item | Value | Source |
|---|---|---|
| Characters | Up to 96 different characters. The print test prints "all petals" | MIM p.172, p.131 |
| Spokes | 96 (inferred: 96 characters on a 96-step motor, so 1 step = 1 petal = 3.75°, and home is lowercase "a") | MIM p.187 (inferred) |
| Packaging | The wheel lives in a plastic **printwheel cartridge** that also carries ribbon guides. It snaps in, and the part number is on the front of the case | MIM p.57; MD; GIM p.104; ORG (line 26241) |
| Diameter, material | **Not in any source.** Modelling assumption: about 70 to 80 mm, moulded plastic petals with the glyph at each tip. Unverified | open |
| Arrangement | Not given. The hammer force groups say that punctuation, medium and large glyphs are spread around the wheel. Print test order: a–z, A–Z, 0–9 forward, then the symbols in reverse | MIM p.189, p.131, p.118 |
| Mounting | On a print wheel hub clamped to the selection motor shaft with a screw. The hub has an "extended part" (a key). Hub-to-shaft gap 0 to 0.1 mm | MIM p.58, p.85, p.89 |
| Changing | Open the access cover. Push the selection home lever right and turn the wheel by hand until the lever drops into the home opening. Press the pull-back latch right and lift the ribbon plate: a cable pulls the selection motor back from the platen. Lift the cartridge out. The ribbon can stay in place | MIM p.91, p.45; GIM p.28 |
| Pitches | 10, 12 and 15 pitch and proportional (PSM), one wheel per pitch. Typestyle numbers: 1–31 for 10 pitch, 80–111 for 12, 215–230 for 15 | GIM p.28; MD; ORG (lines 1470–1480, 7807–7810) |
| PSM widths | 3 to 7 units per character (for example i=3, a=5, m=7, M=7, digits 5). Unit size not stated | ORG App. E |
| Change Font | When a different wheel is needed, the panel LED lights and the display shows which | MIM p.182 |
| Cartridge clearances | Ribbon guides to platen 1.54 to 1.83 mm. Cardholder to ribbon guides 0.35 to 0.45 mm. Cardholder to platen about 0.76 mm | MIM p.57 |

---

## 4. Printwheel drive (selection)

| Item | Value | Source |
|---|---|---|
| Motor | 3-phase, 96 steps per revolution, **variable-reluctance stepper**. It is not a DC servo, but it has closed-loop commutation: 3 reluctance pickups, one per phase, feed back to the driver | MIM p.184, p.187 |
| Home sensing | A 4th reluctance pickup gives home (lowercase "a"). There is also a manual selection home lever and opening | MIM p.187, p.52 |
| Move rule | The step count is computed from the current position, the wheel turns the **shortest way** (so ≤ 48 steps = 180°) and detents | MIM p.187 |
| Positioning time | **Not given** (average, maximum and acceleration all absent). Bound: at 60 cps a full character cycle is 16.7 ms (25 ms at 40 cps). Selection overlaps the carrier move, so the average select-and-settle time must fit well inside that, and the worst case (48 steps) is absorbed by the firmware slowing down | inferred |
| Monitoring | A periodic position check (error 58). Home must be reached within 32 three-step moves (error 56). The hammer is cancelled if selection is late (error 55, recoverable) | MIM p.123 |
| Mounting | The motor sits in a front and a rear clamp whose four support arms rest on the carrier eccentric shafts. Its distance to the platen is set by a screw, and pull-back springs and a cable retract it when the ribbon plate is raised. Its axis runs front-to-back, with the wheel at the rear end facing the platen (inferred from the top views on MIM p.52 and p.91 and from PH 5218_2) | MIM p.52, p.45, p.85 |

---

## 5. Hammer

| Item | Value | Source |
|---|---|---|
| Actuator | A solenoid whose armature **is** the hammer. Energising it throws the armature towards the platen to strike the petal. It is spring loaded | MIM p.189, p.52 |
| Feedback | A magnet on the back of the armature moves in a sense coil, which gives flight time and direction. There is also an impact sensor | MIM p.189, p.184 |
| Force control | Current amplitude and on-time are adjusted **adaptively** until the measured flight time is right. After power-on, the first 6 to 8 characters of each force group can print uneven while it adapts | MIM p.189 |
| Force groups | 3: low (punctuation and symbols, 5 characters on the US wheel, for example `-` and `:`), medium (27 characters: `anrcslf)LIJ(/17+?=xvzjyitoe`), high (29 characters: `mdhkVGUFBZHPRSNCTDEAOMYW9K3X2`) | MIM p.117–118 (tests 45–47), p.189 |
| Per-character velocity | The armature velocity for each character is sent with the selection move | MIM p.189 |
| Controller impression levels | The Print command carries an impression level: 0 means use the printer's table, and the controller can choose among 4 levels | MIM p.199 |
| Energy, force, dwell | **Not given** (no joules, newtons, coil current or ms) | open |
| Geometry | Hammer assembly clamped to the selection motor body (a saddle clamp), with a rotatable "nose cone". Homing aligns the motor and nose cone so the hammer passes freely through the alignment tool's opening. Hammer tip 0.05 to 0.15 mm from the front face of the alignment tool | MIM p.87, p.52, p.51 |
| Timing errors | 60: no impact within the expected time after the intended impact point. 63: cannot regulate force. 64: late hit on the last character. 45: hammer cancelled because of the escapement timing | MIM p.123 |

---

## 6. Ribbon

| Item | Value | Source |
|---|---|---|
| Cartridge | A snap-in cartridge on the carrier's ribbon plate, held by left and right latches. The operator changes it without touching the ribbon | MIM p.188, p.56; MD |
| Ribbon size | 11.6 mm × 122 m (A01/A02). MIM83 gives 11.8 mm × 122 m | MIM p.188; MIM83 p.137 |
| Yield | About 1 million characters per cartridge. On A03/A04: 340,000 in quality mode, 1 million in economy | MIM p.188; MIM83 p.137 |
| Type | **Not stated.** Inferred: a multi-strike film. 122 m / 1e6 characters gives about 0.12 mm of advance per character, far less than a glyph width, so impressions must overlap, and the lift mechanism moves the ribbon up and down between tracks. A single-strike film would need much more length | inferred |
| Feed | Ribbon stepper motor → gear train → drive pinion (backlash 0.038 to 0.09 mm) → a rubber ribbon belt over 7 rollers → the take-up spool. The ribbon advance knob doubles as the drive capstan. Run by the escapement processor | MIM p.188, p.55, p.95 |
| Lift | A ribbon lift cam with a follower lever and lift arm on the carrier. "Both spools turn and the ribbon moves up and down", and the used area should be centred on the ribbon | MIM p.54, p.61 |
| Feed per test | Diagnostic 52 advances about 8.5 mm (1/3 in). On A03/A04 8 to 15 mm in quality mode, 2 to 7 mm in economy | MIM p.119; MIM83 p.113 |
| End of ribbon | A transparent section seen by an optical sensor at the cardholder. The Ribbon LED lights with about 200 characters left. The printer still runs with no cartridge | MIM p.188, p.182 |

---

## 7. Carriage (carrier) and escapement

| Item | Value | Source |
|---|---|---|
| Drive | A permanent-magnet stepper, 200 steps per revolution, **directly coupled to a leadscrew**. There are no drive cables or belt. The "left and right carrier cables" are flexible signal cables | MIM p.184–185, p.62 |
| Lead | 21.16 mm (0.833 in) per revolution, so 1/240 in (0.106 mm) per step | MIM p.185 |
| Follower | A sprung leadscrew follower (two follower halves, parallel and square to the screw) | MIM p.42, p.80 |
| Guidance | Front carrier support shaft, carrier roller shaft and a sprung bottom bearing. Eccentric shafts set the carrier height (character top and bottom coverage) | MIM p.43, p.80–81, p.63 |
| Position sense | A01: open loop, plus a left margin switch. A02: two optical sensors at 90° on the motor, one half-cycle per step | MIM p.185, p.172 |
| Steps per character | 24 at 10 pitch, 20 at 12 pitch, 16 at 15 pitch (inferred from 1/240 in per step) | inferred |
| Carrier speed while printing | At the 60 cps rating and 10 pitch: 6 in/s = 152 mm/s = 1440 steps/s = 432 rpm leadscrew. At 40 cps: 102 mm/s (inferred from the rating) | inferred |
| "Print on the move" | The carrier does **not** stop for each character. The escapement processor needs the next print data before a move ends (error 47), and a hammer fire is cancelled if it is out of step with the escapement (error 45) | MIM p.123 |
| Escape command | Relative move of 0 to 2047/240 in, left or right. Consecutive escapes are summed and executed at the next print | MIM p.197 |
| Travel | Writing line 335 mm. Mechanical travel slightly more (not given) | MIM p.172 |
| Max slew speed, acceleration | **Not given.** A04 "drives the escapement motor at a higher speed" than A03. The home test moves "slowly" | MIM83 p.129; MIM p.113 |
| Cover interlock | Opening the cover while ready stops the escapement at once and loses position (error 06) | MIM p.183 |

---

## 8. Throughput

| Item | Value | Source |
|---|---|---|
| Rated | 40 cps (A01) or 60 cps (A02), "10-pitch rated burst" | GIM p.28; MIM p.172 |
| Real text | Only "actual printing time per page will vary". No measured figure | GIM p.28 |
| Data link | 9600 bit/s, 11-bit frames, 2-byte commands, so 2.3 ms per command and about 430 commands/s. This does not limit speed at 60 cps (inferred) | MIM p.175, p.194 |

---

## 9. One print cycle (inferred sequence; durations bounded, not measured)

The manuals give the structure and the error conditions, but no timing chart. Our reconstruction for A02 at
60 cps, 10 pitch:

| # | Phase | What moves | Duration | Basis |
|---|---|---|---|---|
| 0 | Packet arrives | The attachment processor turns the Print or Escape/Print command into a packet for the escapement, selection and index processors | ≪ 1 ms | MIM p.174 |
| 1 | Escapement | The carrier keeps moving 24 steps per character at about 1440 steps/s | 16.7 ms per character (whole cycle) | MIM p.185, p.123; rate inferred |
| 2 | Select (overlapped) | The wheel steps the shortest way, 0 to 48 steps | Must finish before the impact point. Not given | MIM p.187 |
| 3 | Settle / detent | The wheel detents. The firmware checks position | Not given | MIM p.187, p.123 |
| 4 | Fire hammer | Solenoid pulse sized to the force group or impression level. Flight time measured. Impact timed to the carrier position | Flight time not given | MIM p.189, p.123 |
| 5 | Dwell and return | The spring returns the armature | Not given | — |
| 6 | Ribbon feed (and lift) | The ribbon stepper advances about 0.1 to 0.4 mm per character on average and the lift cam moves the track | Not given | MIM p.188, p.61; inferred |
| 7 | Index (end of line) | 16 steps for 6 lpi. The next line can print in the reverse direction | ≤ 66 ms | MIM p.181, p.172; inferred |

Suggested simulation budget (assumption): select 5 to 12 ms (worst case 48 steps), hammer flight 2 to 3 ms with
1 to 2 ms of contact, all inside the 16.7 ms carrier step. A long wheel move delays the impact point, so the
carrier must slow down.

---

## 10. Noise sources

| Source | Character | Source |
|---|---|---|
| Hammer solenoid impact through ribbon on paper on platen | Sharp click per character, at three strengths (force groups). The dominant sound | MIM p.189 |
| Selection stepper (VR, 3-phase) | Stepping whir and buzz per move, with a short detent tick | MIM p.187 |
| Escapement stepper and leadscrew | Continuous hum at the step rate (about 1440 Hz fundamental at 60 cps, inferred) while the carrier moves, plus screw and follower rumble | MIM p.185 |
| Index stepper and timing belt | Short burst per line feed. Repeating clicks on Paper Up (66 ms period) | MIM p.181, p.186 |
| Ribbon stepper and gear train | Small tick or whine per character | MIM p.188 |
| Cam motor (DC, worm) | Whirr and clunk on Load, Release and bail open | MIM p.186 |
| Fan | Steady broadband airflow | MIM p.17 |
| Damping | The covers are designed for low noise: an acoustic filter at the paper slot, acoustic material in the bottom cover, a shock-mounted mechanism. No dB figure | GIM p.104; SET p.16; MIM p.63, p.29 |

---

## 11. Interface to the word processor (high level)

| Item | Value | Source |
|---|---|---|
| Link | Twisted-pair serial, 9600 bit/s full duplex. Each frame is a start bit, 8 data bits, parity and a stop bit, with odd parity by default. Cables of 6, 30 and 60 m | MIM p.175, p.194–195 |
| Exchange | The controller sends a 2-byte command, the printer answers with 1 byte (a response ID or status). One more command may be sent while "receive ready" is shown | MIM p.194, p.203 |
| Per character | **Print**: character code plus impression level, which also executes the summed escape and index moves. Or **Escape/Print**: a relative move of 0 to 63/120 in plus the character. Escape and Index are separate relative moves | MIM p.196–200 |
| Other | End-of-Data and Pause (idle and sync), paper handling, Read Status, Restore, Wrap Data. Power-on handshake: the printer sends X'80' every 2 to 100 ms until the controller wraps 8 bytes | MIM p.201–203 |
| Unknown character | Prints an underscore | MIM p.199 |

So the controller tells the printer **where** (relative 1/240 in and 1/96 in moves), **what** (a wheel character
code) and optionally **how hard**. The printer's own processors plan wheel moves, hammer energy, ribbon feed and
on-the-move timing. That split fits the project plan: the word-processor software layer commands the mechanism.

---

## 12. Figures and photos for 3D modelling

| Reference | What it shows |
|---|---|
| MIM p.18 | Perspective of the whole mechanism in its bottom cover, with numbered parts (platen, carrier, escapement motor, cam, fan, cards) and the cam detail |
| MIM p.20 | Top-view plan of the mechanism (platen, carrier, leadscrew, index motor, power supply, card cage): best for proportions |
| MIM p.21, p.22 | Back view, and the bottom of the mechanism in service position (leadscrew, coupler, ribbon motor drive) |
| MIM p.47–48 | Carrier top view, alignment tool to platen |
| MIM p.51, p.52 | Top view of the hammer, nose cone, selection motor and clamps |
| MIM p.57 | Top view of the carrier with the ribbon cartridge (two spool lobes) and cardholder |
| MIM p.58, p.87 | Print wheel hub side views. Hammer assembly perspective |
| MIM p.91, p.94, p.95 | Wheel change (pull-back latch). Ribbon plate. Ribbon belt routing over 7 rollers |
| MIM p.180 | Control panel layout |
| MIM p.186 | The 5 cam positions: platen, feed rollers and bail side view |
| MIM p.173 | Block diagram of processors and motors |
| SET p.10–18 | Exterior drawings: cover raised, cartridge locations, panel, paper slot |
| PH `5218_1.jpg` | Front elevation, closed: panel, colours, power rocker, window |
| PH `5218_2.jpg` | Top view, access cover open: carrier, leadscrew, platen, acoustic filter |
| PH `5218_3.jpg` | Rear attachment panel |
| PH `5218_4.jpg` | Top view, covers off: platen with belt pulley, leadscrew, carrier, card cage, power-supply heat sink |
| PH `5218_5.jpg` | Rear: power supply heat sink, card cage, fan |
| PH `5218.jpg` | Mechanism with the top cover off and a European-language panel (showing error 44) |

---

## 13. Open questions (biggest first)

1. Wheel positioning time (average and maximum), the acceleration profile, and the motor torque and inertia.
2. Hammer energy or force per group, coil current and pulse width, flight time, dwell, and the moving mass.
3. Overall dimensions (estimated from photos only, ±10 %) and platen diameter and length (inferred about 42 × 415 mm).
4. Printwheel diameter, material, petal layout and glyph height.
5. Ribbon type (multi-strike film is inferred), the lift travel and the number of tracks.
6. Carrier slew speed and acceleration for returns and tabs. Line feed time (only bounded at ≤ 66 ms per 6 lpi line).
7. Measured throughput on real text, and the sound level.
8. The PSM unit size (1/60 in? not stated), and the low-force character list (OCR lost 3 of the 5).
9. Possible sources: the Problem Determination Guide S544-2000-1 (14 MB, 1981, not read), the MAPs SY20-8524-0, the
   5218 Printer Driver G570-2063, and the Customer Planning Guide G544-0852 (dimensions; not on bitsavers).
