# Dedicated word processor, c. 1980: hardware research (display station, keyboard, diskette unit, planning)

Research notes for the `wordproc1980` machine (see `docs/displaywriter/plan.md`). Everything below is summarised
from the manuals in my own words; numbers and short labels are quoted as facts. Ground rule reminder: the real
machine's name, logo and model numbers appear here only as research context and must not appear in the build.

## Source key

PDF page numbers (`p.N`) are the page index in the PDF file (checked with `pdftotext -f N -l N`, since the OCR
text of PSM and ST has fewer form feeds than the PDFs have pages).

| Id | Document |
|---|---|
| MD | 6580 Machine Description (Nov 1983), 6 pp. p.1 = 6360 diskette unit, p.3-6 = 6580 display station |
| GIM | G544-0851-5 General Information Manual (May 1982) |
| CSG | G544-0858-5 Customer Setup Guide (Jun 1982) (Section 1 = single system, pp. 18-58) |
| PSM | S241-6248-2 Product Support Manual 6360/6580 (May 1982) |
| ST | S241-6247-2 Service Theory (May 1982) |
| BRO | G552-0323-1 Brochure (1982) |
| ORG | S544-2036-0 Operator Reference Guide, Textpack 4 / Reportpack (Feb 1982, with 1982-83 TNLs) |
| PSP | GA23-1007-1 5218 Printwheel Printer Setup Procedures (May 1981) |
| PH | Bitsavers photos `pdf/ibm/6580_Displaywriter/photos/` (file names given) |
| RE | Bitsavers `pdf/ibm/6580_Displaywriter/re/dw_CPU_ICs.txt` and `photos/IBM_PN.txt` (chip identifications by a collector, not IBM) |

"Inferred" means not stated in a source; the method is given.

---

## 1. Display station (25-line display on the electronics module)

### 1.1 What the display station is, physically

The display station is three cable-connected modules: the **electronics module** (the logic and power box), the
**display module** (CRT) that sits on top of it, and the **keyboard module** (MD p.3; GIM p.19; ORG p.27).
So yes, the logic box is part of the display station: it is the flat base under the monitor. The display's
swivel foot drops into a round recess (turntable) in the electronics module's top cover and is held by an
interlock; to remove it you lift it straight up (CSG p.23 figure; ST p.28 fig. 2; ST p.33; PSM p.46 figure).
The display cable leaves the **bottom** of the display so it does not foul the electronics module when the display
tilts or turns (ST p.28). The diskette adapter card is *not* in the electronics module: it sits in the diskette
unit and is reached through a 56-wire bus-extension cable (ST p.73, p.76, p.101).

### 1.2 Dimensions and weights

| Item | Value | Source |
|---|---|---|
| Electronics module W x D x H | 483 x 356 x 178 mm (19 x 14 x 7 in) | MD p.4 |
| Electronics module weight | 14 kg (30 lb); 13.6 kg on the carton | MD p.4; CSG p.20 |
| 25-line display module W x D x H | 381 x 348 x 292 mm (15 x 13.7 x 11.5 in) | MD p.5 |
| 25-line display weight | 6.6 kg (MD) / 6.8 kg (15 lb) (ST, CSG) | MD p.5; ST p.28; CSG p.22 |
| 25-line display cable | 610 mm (24 in) per MD; ST says 254 mm (10 in), 15-pin connector | MD p.5; ST p.28 (conflict, see open questions) |
| Large (66-line) display W x D x H, weight, cable | 316 x 404 x 404 mm, 17.55 kg, 483 mm (not used by this project) | MD p.5 |
| Base footprint of the station | 483 x 356 mm (the electronics module) | MD p.4 |
| Stacked height, desk to display top | about 470 mm | Inferred: 178 + 292 mm, assuming the display height is measured from its own swivel foot |
| Power cord | 3 m (9.8 ft), 115 V 60 Hz 15 A grounded (US) | MD p.5 |

### 1.3 Tilt and swivel

| Item | Value | Source |
|---|---|---|
| Tilt | 20 degrees ("0 to 20"), backwards from upright (side view arrow) | ST p.28 text and fig. 2; GIM p.104; MD p.5 |
| Swivel | 12 degrees left and 12 degrees right of centre | ST p.28; GIM p.104 |
| Swivel total | MD says "30-degree rotate range" | MD p.4 (differs from 2 x 12 = 24; use the service figure 12 each way) |
| Feel | "should tilt and rotate freely" once seated | CSG p.23 |

### 1.4 CRT and raster (25-line display)

| Item | Value | Source |
|---|---|---|
| CRT diagonal | 305 mm (12 in) | ST p.28; ORG p.28 |
| Visible screen | 245 mm wide x 170 mm high | ST p.28 |
| Dot raster | 640 columns x 400 rows | ST p.28 |
| Dot size | 0.32 mm wide x 0.34 mm high | ST p.28 |
| Raster size on glass | about 205 x 136 mm | Inferred: 640 x 0.32 and 400 x 0.34. ST p.28 also gives the "typing area" as 136 mm high (matches 400 rows) but 245 mm wide (matches the glass, not the raster) |
| Character box | 8 x 16 dots; 80 x 25 boxes | ST p.28; MD p.5 |
| Character pitch / line pitch | about 2.56 mm / 5.44 mm | Inferred from dot size |
| Phosphor colour | green | GIM p.104 (ergonomics table); green text in BRO screen photos (pp. 8-11, 13) |
| Phosphor persistence | not specified; manual notes a brief "after image" when a character changes | PSM p.7 (25-line) and p.16 (large); GIM p.104 credits "high refresh rate and phosphor characteristics" for stability |
| Refresh | the whole screen is swept "approximately 35 times per second" | ST p.76 (see open questions: low for a non-interlaced CRT) |
| Screen surface | non-reflective, to minimise glare | GIM p.104 |
| High voltage | up to 14 kV, no bleeder resistor | ST p.28; PSM p.7 |
| Raster visible with brightness fully up | yes, a normal background raster | ST p.32; PSM p.7; CSG p.40 says a bright background and horizontal lines are normal before adjusting |
| Signals in the display cable | video, horizontal drive, vertical drive, +12 V, +5 V, ground (the brightness line is unused and grounded) | ST p.31 |
| Own power supply / switch | none: the 25-line display is powered with DC from the electronics module (large display: own AC feed from panel 2 connector 12) | ST p.31, p.37, p.79 |

### 1.5 Character cell and glyphs (ST p.28-29, figs. 4-6)

Rows of the 8 x 16 box are numbered 0-F, columns 1-8.

| Feature | Rows / size | Source |
|---|---|---|
| Upper case and digits | 9 rows high, rows 3-B; width 5-7 dots (I, 0, 1: 5 wide; most capitals 6; G J Q T Y Z and 4: 7) | ST p.28 fig. 4, p.29 fig. 5 |
| Lower case x-height | 6 rows (a c e n o s v w x z: 6 x 6; m u: 7 x 6) | ST p.28 fig. 4 |
| Ascenders (b d f h k t) | 6 x 9 (same top as capitals) | ST p.28 fig. 4 |
| Descenders (g p r y: 6 x 7; q: 7 x 7; j: 4 x 10) | drop one row or more below the baseline (y reaches row C in fig. 5) | ST p.28-29 |
| Narrow i, l | 3 x 9 | ST p.28 |
| Underscore | the full 8-dot row D | ST p.29 fig. 5 |
| Cursor | the full 8-dot row E, always brighter than text; the character above it is also brightened | ST p.29; GIM p.21 |
| Half index (super/subscript) | glyph moved up or down 3 dots; one level only | ST p.29 fig. 6; MD p.4 |
| Fonts in hardware | two 256-character fonts on the display adapter card (font 1 text and graphic symbols, font 2 symbols, fractions, small figures) | ST p.30; PSM p.8 |
| Display buffer | 4 KB RAM on the display adapter card | ST p.76 |

Rows 0-2 are blank above capitals and row F is blank (inferred from fig. 5: no glyph dots there).

### 1.6 Attributes

| Attribute | Behaviour | Source |
|---|---|---|
| Underline | dots in row D | ST p.29 |
| Reverse video | character dots off, background dots on; used for selected menu items, highlighted blocks and unrecognised words after spelling check | ST p.30; MD p.4; ORG p.29 ff. |
| Brightened (intensified) | cursor and the character over it; the prompt line is "highlighted"; "character brightening when cursored" | ST p.29; ORG p.33; MD p.4 |
| Blink | exists: the message symbol `==>` flashes when messages wait; diagnostic sequences shown "blinking" | ORG p.411-413; ST p.180 |
| Cursor blink | not stated anywhere; every source describes a steady brightened underline | GIM p.21; ST p.29 (open question) |
| Scale-line cursor | a highlighted position on the scale line | GIM p.21; ORG p.31 |

### 1.7 Screen regions (25 x 80)

| Line(s) | Use | Source |
|---|---|---|
| 1-2 | status lines (task/function, document name, insert or replace mode, keystroke save, symbol identification; diskette names left/right, page, line, keyboard number, pitch) | GIM p.19-20; ORG p.29-31 |
| 3 | scale line (margins, tabs, centre, cursor position; positions 10-90 shown) | GIM p.20; ORG p.31 |
| 4-23 | viewport: 20 lines of text or menu | GIM p.20; ORG p.28 |
| 24 | prompt line (highlighted) | GIM p.20; ORG p.33 |
| 25 | message line | GIM p.21; ORG p.33 |

Horizontal segmenting: lines up to 999 characters (MD says 255) shown 80 at a time, scrolling 60 with 20 of
overlap (GIM p.21; MD p.4).

### 1.8 Controls

| Control | Kind and position | Source |
|---|---|---|
| Power switch | rocker marked I (on) and O (off), in a recess on the top surface at the front left corner of the electronics module; it switches all AC and DC for the whole work station, including the diskette unit | CSG p.29, p.40 (figures); ORG p.33; ST p.78 |
| Contrast | round knob, front right of the display bezel, upper of the two | ST p.28 fig. 3; PSM p.7; ORG p.28 |
| Brightness | round knob, below the contrast knob; clockwise = brighter | ST p.28 fig. 3, p.32; PSM p.7; CSG p.40 |
| Setup instruction | turn both knobs fully clockwise at first power-on, then back off for comfort | CSG p.40 |
| Large display | brightness knob only | MD p.4; ORG p.28 |
| Rear panel 1 (electronics module, left as seen from the back) | eight status LEDs A-H in a vertical strip; sockets 0 (printer), 1, 2 (display), 3 (Memory Record push button), 4 (communications, covered), 5 (diskette signal), 6A/6B (printer sharing, covered), 7 (keyboard) | PH main_assy/Displaywriter_back.JPG; CSG p.27; ST p.80, p.165 |
| Rear panel 2 (power supply back, right) | 8 switched AC out to diskette unit, 9 AC in, 10 DC out to diskette unit, 11 DC for communications, fuse | ST p.79; CSG p.27, p.29 |

The right-hand strip of the display bezel carries the maker's badge above the two knobs (BRO p.18 photo;
CSG p.40 drawing).

### 1.9 Fan, noise, power-on

| Item | Value | Source |
|---|---|---|
| Cooling | one fan in the power supply draws air through the electronics module; runs whenever power is on | ST p.79; ST p.187 (MAP checks the fan runs) |
| Display fan | none mentioned (inferred: convection only; no fan in any display figure) | ST p.27-33; PSM p.7-9 |
| Noise claims | "low levels of heat and noise" | MD p.4; GIM p.104 |
| Power supply protection | thermal, over/under-voltage and overcurrent shutdown; LEDs A, B, C on panel 1 show which | ST p.79-80 |
| Power-on reset, then BAT | a self-test in ROS, 10-20 s depending on memory size; early progress shown on LEDs D-H, later at the bottom of the screen | ST p.165-166 |
| Power-on tone | a short tone (under 1 s) at the start of the DMA test; a continuous tone means the DMA test failed | ST p.167 |
| End of BAT | the maker's logo appears on screen, about 25 s after switch-on | ST p.166; CSG p.40 |
| Next step | insert the program diskette in the left slot and close the lever; the drive buzzes and the program loads (IPL) | CSG p.42-43; ORG p.56 |

### 1.10 Logic unit

| Item | Value | Source |
|---|---|---|
| Processor | Intel 8086 with 8284 clock generator, 8257-5 DMA, 8259A interrupt controller, 8253-5 timer, 8255A-5, two 8251 serial chips | RE (collector's chip list; IBM manuals never name the chip, ST p.74 says "single chip microprocessor") |
| Clock | not found | open question |
| ROS | BAT, resident diagnostics, IPL and Memory Record program | ST p.74; MD p.4 |
| Timer | counts 50 ms intervals since IPL | ST p.75 |
| Interrupt levels | 0 printer sharing, 1-2 comms and printer/mag card, 3 keyboard, 4 diskette, 6 software timer, 7 comms error, plus NMI | ST p.75 |
| RAM | 128 KB minimum, steps of 64 KB (32 KB on some upgrades); models up to 448 KB; in 1982 a memory card held up to 192 KB and an extender took the total to 384 KB | MD p.3-4, p.6; ST p.75-76 |
| Memory card types | "Type A" and "Type B" memory cards (not keyboards) | ST p.76; PSM p.130 |
| Textpack 4 needs | 256 KB | ST p.75 |
| Card cage | cards stand vertically on a distribution board: system card (B), display adapter (D), memory (E), extender (F), printer sharing, communications | ST p.72-77; PSM p.46 figure; PH main_assy/inside.JPG, Displaywriter_cardcage.JPG |
| Power supply outputs | +24, +12, +12, +8.5, +5 (16 A), -5, -12 V | ST p.79 |

---

## 2. Keyboard

### 2.1 Physical

| Item | Value | Source |
|---|---|---|
| W x D x H | 538 x 213 x 101 mm (21 x 8 x 4 in) | MD p.5 |
| Weight | 5 kg (11 lb); carton 6.8 kg | MD p.5; CSG p.18 |
| Key surface slope | 12 degrees | GIM p.104 |
| Cable | 1 m (3.3 ft), detachable at the electronics module (panel 1 socket 7, a 15-pin D socket in the photo), runs through a groove in the underside of the electronics module | MD p.5; CSG p.21, p.27; ST p.57; PH Displaywriter_back.JPG |
| Coiled or straight cable | not stated | open question |
| Construction | cast/sheet frame, key assembly, contamination shield, pad card (capacitor plates), bottom plate; logic card and speaker at the rear; top cover held by four captive screws from underneath | PSM p.30 figure, p.37; ST p.67 |
| Serial label | under the left side | ORG p.21 |
| Keycap pitch | about 19 mm | Inferred: standard IBM pitch; consistent with 23.5 key pitches spanning the photo's key field (PH keyboard/KBD_2.JPG) inside a 538 mm case |
| Keycap profile | sculpted, cylindrical tops, Selectric/Office System 6 style; key fronts carry second legends | GIM p.22; PH keyboard/KBD_2.JPG |
| Enter key | sits about 3 mm lower than the space bar to avoid accidental presses | ST p.62 |
| Feet, adjustable angle | not stated | open question |

### 2.2 Switch technology and feel

| Item | Value | Source |
|---|---|---|
| Principle | capacitive: each key module carries a "fly plate" resting on two capacitor plates on the pad card; pressing the key lifts the fly plate away, changing capacitance | ST p.58-59 |
| Springs | key modules have a compression return spring; a flat spring on the key stem engages the fly-plate spring | ST p.58, p.68 |
| Buckling spring? | never mentioned; the documents describe a fly-plate module, not a buckling spring | ST p.58, p.68 (the plan's working assumption is unconfirmed) |
| Force | 40 to 75 g, by key | GIM p.104 |
| Travel | 1.5 to 3 mm ("key displacements") | GIM p.104 |
| Feedback | "audible and tactile" | GIM p.104 |
| Shift lock | latches down (no compression spring; held by a flat spring); released by either Shift | ST p.58; PSM p.31 |
| Make/break keys | Shift, Shift Lock, Code, Control (position 3) send on press and release | ST p.58 |
| Typematic | every other key is typematic at the keyboard; the software decides which act so | ST p.58 |
| Typematic delay | 350 ms | PSM p.33 (data-flow chart) |
| Typematic rate | about 14 per second | ST p.58; PSM p.33 |
| Repeat stops | on release, or on pressing another typematic key | ST p.58 |

### 2.3 Sound

| Item | Value | Source |
|---|---|---|
| Key click | produced electronically by a speaker in the keyboard after each valid keystroke and on each typematic repeat; triggered by a "Click" line from the system | ST p.56, p.62, p.65 |
| Tone | 1 kHz; duration and repetition set by software | ST p.62, p.65 |
| Long beep | a message needs attention | ORG p.53 |
| Short beep | cursor passes the last typing line of the page; typing into the hot zone near the right margin when Auto Carrier Return is off | ORG p.53 |
| Speaker | round speaker on the keyboard frame at the rear, 2-pin lead to the logic card, powered from +8.5 V | ST p.62, p.64; PSM p.30; PH keyboard/KBD_3.JPG |
| Mechanical sound | the modules themselves give some "audible" feedback (GIM p.104); its character is undocumented | open question |

### 2.4 Keyboard-to-logic protocol (high level)

The keyboard has its own microprocessor on a logic card. It scans the pad card as a 12 x 8 drive/sense matrix
continuously, keeps a 4-entry buffer (overrun replaces the 4th entry with an error code), and sends one byte per
event over a synchronous serial link: data, data clock, data strobe after each byte, and an acknowledge from the
system before the next byte. Each byte holds a 7-bit key position plus one bit meaning press/release (make/break
keys) or repeat (typematic keys). At power-on reset the keyboard runs its own test, sends two completion bytes and
then an ID byte set by eight jumpers (the country arrangement). Other cable lines: POR, Click, Speaker Tone,
+5 V, +8.5 V, grounds. (ST p.59-65; PSM p.31-33.)

### 2.5 "Type A versus Type B"

In these manuals Type A and Type B are **memory cards**, not keyboard modules (ST p.76; PSM p.130). The keyboard
variants are the **96-character** (standard) and **92-character** (optional) keyboards (MD p.3, p.5; GIM p.22),
plus a Dvorak option; the jumper-set ID selects the national arrangement (ST p.56, p.63). The physical difference
between 92 and 96 is not drawn in these sources (open question).

### 2.6 Layout (96-character keyboard)

Sources: key position numbers and typematic/make-break marks from PSM p.34; engraved legends from GIM p.22 and
PH keyboard/KBD_2.JPG; Textpack 4 functions from the template, ORG p.35-44. "T" = typematic, "M" = make/break,
"N-A" = not active. Unmarked keys are typematic at the keyboard but software treats them as single-action.
Key widths are in key units (u, about 19 mm), measured on PH keyboard/KBD_2.JPG where the drawings are schematic
(models.md, Keyboard).

All keycaps are the same pearl white with dark legends: no colour-coded keys (GIM p.22; PH KBD_2.JPG). Keys with a
CODE function have a second legend on the key front (shaded in ORG p.35's drawing).

**Overall arrangement** (GIM p.22-23; PSM p.34; ORG p.35): three groups side by side with gaps between them.

| Group | Rows used | Make-up |
|---|---|---|
| Left: work station control keys | 5 rows, 2 columns: from one row *above* the number row down to the shift row | positions 82, 83 / 1, 2 / 3, 4 / 5, 6 / 7, 8 |
| Centre: main typing block | number row to space-bar row | positions 9-65 and 84 |
| Right upper: function control keys | 2 rows x 4: the row above the number row and the number row | positions 66-73 |
| Right lower: cursor control keys | 2 rows x 4: lock row and shift row (a gap at the tab row) | positions 74-81 |

**Left group** (rows from top; legend / CODE function)

| Row | Left key | Right key |
|---|---|---|
| above number row | 82, blank (N-A in PSM p.34); TP4: MATH REQUEST / CONSTNT | 83, blank (N-A); TP4: COLUMN ADD / ROW ADD |
| number row | 1, blank (N-A); TP4: + (add) / x (multiply) | 2, blank (N-A); TP4: - (subtract) / ÷ (divide) |
| tab row | 3 M, blank: CONTROL | 4, blank (N-A); TP4: KEY PLAYBCK / KEY SAVE |
| lock row | 5: REQST, front CANCL | 6: PRINT, front KYB CHG |
| shift row | 7: END; TP4 CODE function SCREEN FORMAT | 8: MSG, front REPLY |

TP4 functions on blank keys come from the template (ORG p.35-37). PSM p.34 (May 1982) marks 82, 83, 1, 2 and 4 as
not active, yet Textpack 4 assigns them functions: either later keyboards enable them or the N-A marking reflects
the keyboard as first shipped (open question).

**Main block**

| Row | Keys left to right (pos legend; front legend) |
|---|---|
| Number row | 9 °/± · 10 !/1 · 11 @/2 · 12 #/3 · 13 $/4 · 14 %/5 · 15 ¢/6 · 16 &/7 · 17 */8 (TP4 INSERT/REPLACE) · 18 (/9, STOP · 19 )/0 · 20 underscore/hyphen T · 21 +/= · 22 BKSP T, REQD (1.75 u) · gap · 84 INDEX T (isolated, a narrow cap about 0.8 u) |
| Tab row | 23 TAB, REQD (about 1.5 u) · 24-33 Q W E R T Y U I O P (fronts: Y ½↑, U BEGIN UND, I WORD UND) · 34 ¼/½ · 35 [/] · 36 RETURN T (tall inverted-L key spanning tab and lock rows, 1.25 u over a 1 u leg; legend RET in the photo, RETURN in GIM p.22) |
| Lock row | 37 LOCK M (about 1.75 u; drawings show a small square stub at its right) · 38-46 A S D F G H J K L (fronts: H ½↓, J END UND; TP4: K SWITCH, L NEXT VARIABL) · 47 :/; (TP4 VARIABL) · 48 "/' · 49 ³/² · (lower leg of RETURN) |
| Shift row | 50 SHIFT M (about 1.25 u) · 51 ¶/§ · 52-58 Z X C V B N M (front: C CTR/CENTER; TP4: M comma separator) · 59 ,/, · 60 ./. · 61 ?// · 62 SHIFT M (2.5 u) |
| Space row | 63 CODE M (2 u, from under Z-X) · 64 space bar T (5.5 u), front REQUIRED (required space) · 65 ENTER (1.25 u, recessed 3 mm) |

**Right upper: function control keys** (66-73)

| Pos | Legend | CODE (front) | TP4 function |
|---|---|---|---|
| 66 | DEL | (TP4 OVERSTRIKE) | Delete / Overstrike |
| 67 | MOVE | COPY | Move / Copy |
| 68 | LINE ADJ | | Line Adjust |
| 69 | SPELL | | Spell |
| 70 | CHG FMT | INSTR | Change Format / Instruction |
| 71 | GET | | Get |
| 72 | PAGE END | REQD | Page End / Required Page End |
| 73 | blank, N-A in hardware | | TP4 template: COLUMN / LAYOUT |

**Right lower: cursor control keys** (74-81)

| Pos | Legend | Front (CODE) | TP4 function |
|---|---|---|---|
| 74 T | ↑ | ↖ with bar | Cursor up / Boundary up |
| 75 T | ↓ | ↙ | Cursor down / Boundary down |
| 76 | FIND | (TP4 GLOBAL, not engraved) | Find / Global |
| 77 | blank | | TP4 SCREEN DOWN / SCREEN UP |
| 78 T | ← | |← | Cursor left / Boundary left |
| 79 T | → | →| | Cursor right / Boundary right |
| 80 | GO TO | (TP4 MENU BYPASS) | Go To / Menu Bypass |
| 81 | blank | | TP4 SCREEN RIGHT / SCREEN LEFT |

Notes: "Some special keys have additional function but are not marked" (ORG p.34); the template supplies them.
The physical top row of the left and right groups sits one row above the number row (PSM p.34 drawing;
KBD_2.JPG), which gives the keyboard its stepped silhouette.

---

## 3. Diskette unit (6360)

### 3.1 Enclosure

| Item | Value | Source |
|---|---|---|
| W x D x H | 254 x 398 x 292 mm (10 x 15.7 x 11.5 in) | MD p.1 |
| Weight | single 11 kg (24 lb); dual 16 kg (35 lb) | MD p.1 |
| Cables | three, all 1 m (40 in): AC (3-wire, from panel 2 socket 8), DC (16-wire, panel 2 socket 10), signal (56-wire shielded bus extension, panel 1 socket 5) | ST p.101; CSG p.27; MD p.1 |
| Placement | either side of the display station, operator's choice ("left- or right-handed") | GIM p.24; MD p.1 |
| Covers | top cover slides off to the rear (two screws or, later, two quarter-turn fasteners at the back); front cover slides forward after four screws | PSM p.61; ST p.110 |
| Serial label | under the left side | ORG p.21 |
| Internal arrangement | each drive stands on edge (diskette vertical); diskette guide at the front, hub, collet and head carriage in the middle, AC motor with pulley/fan and the stepper motor at the rear; diskette adapter card behind the drives; file control card on the right side of each drive | PSM p.50 figure; ST p.98, p.103 fig. 19 |

### 3.2 Single versus dual

| Item | Value | Source |
|---|---|---|
| Models | 010 single, Diskette 1 only; 011 dual, Diskette 1; 020 single, 1 or 2D; 022 dual, 1 or 2D | MD p.1 |
| Front | two vertical slots side by side in both versions; on the single unit the right slot is blocked | GIM p.24-25; ORG p.54 figure |
| Dual use | two identical, interchangeable drives aligned with two pins and joined by brackets; only one is accessed at a time | ST p.103 |
| Which slot | single-diskette tasks and the setup test use the left slot | CSG p.42; ORG p.30 (status line G = left slot) |

### 3.3 Slot, handle (load lever) and latching

There is no door. Each slot has a rotating **operator handle** ("load lever") near the bottom of the slot:

| State / action | Detail | Source |
|---|---|---|
| Open | handle turned to vertical, in line with the slot | ST p.90; CSG p.42 |
| Insert | diskette pushed in edge-first, head-window edge first, label facing the handle side, square into the guide | ST p.90; CSG p.42 |
| Closed | handle turned 90 degrees to horizontal, across the slot, trapping the diskette | ST p.90; CSG p.42 |
| What closing does | an actuator roll on the collet actuator rod pushes a large flat spring and the spring-loaded collet into the hub, clamping the diskette centre; it also releases the head-load bail so the solenoid can work | ST p.92, p.95 |
| Sound on closing | "the Diskette Unit should make a buzzing sound" | CSG p.42; also "buzzing sounds" during tests, CSG p.48 |
| Handle marking | "1" on Diskette 1 drives, "1/2D" on 2D drives | ST p.90; ORG p.54; CSG p.41 |
| Adjustment | handle within 0.1 mm of the diskette guide; collet 2 mm clear of the diskette with the handle open | ST p.105; PSM p.56 |

### 3.4 Indicator lights

No activity or power lights are described for the diskette unit in any of these manuals, and the drawings and
photos show none (GIM p.25 fig.; ORG p.54 fig.; BRO p.18 photo). The small square at the top left of the front is
the maker's badge (BRO p.18 photo; inferred from its position and the badge seen there). Open question whether any
later unit had a light.

### 3.5 Drive mechanics and timing

| Item | Value | Source |
|---|---|---|
| Diskette speed | 360 rpm; index pulse every 166.7 ms (accepted 162.5-170.9 ms) | ST p.93 |
| Motor | AC, capacitor start, 1800 rpm, belt to the hub pulley | ST p.91 |
| Belt ratio | 5:1 | Inferred: 1800 / 360 |
| Motor running | AC motors and the fan run continuously whenever system power is on (no motor on/off) | ST p.101 |
| Index sensing | LED and phototransistor through the index hole; 1.5-3.0 ms pulse per turn; 2D drive uses a dual LED that also detects the diskette type | ST p.93, p.98 |
| Stepper | 24 V DC, 1.8 degrees per track, steel band drive to the head carriage on two guide rods; four-phase sequence on two "access" lines | ST p.96, p.100 |
| Step time | 5 ms per step | ST p.97 |
| Settle | 35 ms added after the last step | ST p.97 |
| Recalibrate | 77 reverse steps against a hard stop pin on the stepper pulley, then read track 00 | ST p.100 |
| Head load | solenoid pulls the head-load bail through a cable; the spring-loaded load arm presses the diskette onto the head (2D: two heads pressed together) | ST p.94-95 |
| Head-load time | not stated | open question |
| Write current | reduced from track 43 inward (2D also raises read gain from track 43) | ST p.98 |
| Retries | three additional read/write retries before a prompt | ST p.102 |
| Noise sources | AC motor and belt, fan (continuous); head-load solenoid; stepper (5 ms steps, 77-step recalibrate against a stop); "buzzing" on load | ST p.91, p.95-101; CSG p.42 |

### 3.6 Media and formats

| Item | Diskette 1 | Diskette 2D | Source |
|---|---|---|---|
| Sides | one | two, double density | GIM p.24; ORG p.55 |
| Tracks | 77 (00-76) | 77 per side | ST p.87 |
| Track 00 | index track, 26 sectors x 128 bytes, not for data | same | ST p.87 |
| Data tracks | 01-74, with 75-76 as spares | same | ST p.87 |
| Sectors per data track | 15 x 256 bytes | 26 x 256 bytes | ST p.87 |
| Customer capacity | 284,160 bytes | 985,088 bytes | MD p.1 (= 74 x 15 x 256, and 74 x 26 x 256 x 2: inferred check, exact match) |
| Recording | single density FM (inferred: standard for 15 x 256 on 8-inch) | double density | GIM p.24 for 2D; FM inferred |
| Label | grey permanent label with a bold "1" | terra cotta (burnt orange) label with a bold "2D" | MD p.1 |
| Size | 203.2 mm (8 in) square jacket, kept in an envelope | same | MD p.1 |
| Compatibility | data format not compatible with other IBM diskette products | | MD p.1 |

### 3.7 Controller

The diskette adapter card in the diskette unit carries its own microprocessor, a counter, drive control and bus
interface; it does CRC, track counting, step timing, head-load control and speed monitoring, and is shared by both
drives (ST p.76, p.97). The photo of that card shows an NEC chip marked **D765D** (the uPD765 floppy controller),
an Intel 40-pin processor and a 24.0 MHz crystal (PH floppy/Floppy_Assy.jpg, floppy/Floppy_T.jpg; reading of the
markings is mine).

---

## 4. Physical planning for the whole system

The Customer Planning Guide (G544-0852), which holds furniture dimensions and clearances, is referenced (CSG p.4;
GIM p.5) but is not on Bitsavers. What the available sources give:

### 4.1 Units

| Unit | W x D x H (mm) | Weight | Cable(s) and where they exit | Source |
|---|---|---|---|---|
| Electronics module | 483 x 356 x 178 | 14 kg | all sockets on the rear (panels 1 and 2); power cord 3 m into panel 2 socket 9 | MD p.4-5; CSG p.27-29 |
| 25-line display | 381 x 348 x 292 | 6.6-6.8 kg | 610 mm (or 254 mm) cable from the display's underside to panel 1 socket 2 | MD p.5; ST p.28; CSG p.27 |
| Keyboard | 538 x 213 x 101 | 5 kg | 1 m cable from the keyboard's rear, under the electronics module in a groove, to panel 1 socket 7 | MD p.5; CSG p.21; PSM p.30 (rear exit inferred from the exploded view and CSG p.19) |
| Diskette unit, single / dual | 254 x 398 x 292 | 11 / 16 kg | three 1 m cables from the rear (inferred from CSG p.27 drawing) to sockets 5, 8, 10 | MD p.1; ST p.101 |
| 5218 printwheel printer | not in these sources | 29 kg; sheet-feed handler 11.3 kg | printer cable 6 m standard (30 m and 60 m options) to panel 1 socket 0 | PSP p.10, p.22, p.57 |
| 6361 mag card unit (not modelled) | 305 x 483 x 673 | 30 kg | 4.5 m | MD p.2 |

### 4.2 Arrangement and furniture

| Item | Value | Source |
|---|---|---|
| Recommended layout | display station centre with keyboard in front; diskette unit beside it on the right (as drawn) or left; printer separate | CSG p.37 figure; GIM p.24 |
| Diskette distance | limited by the 1 m cables | ST p.101 |
| Keyboard distance | limited by the 1 m cable | MD p.5 |
| Display Station Platform accessory | for desks at least 18 in (457 mm) deep; cable raceway and rear cover for the electronics module; keyboard tilts up and locks; pebble grey | MD p.6 |
| Work station furniture | adjustable terminal base (separate platforms for display and keyboard), rectangular height-adjustable extension for the diskette unit, printer stand; pearl white, oak or walnut | MD p.6 |
| Minimum width estimate (station + diskette side by side) | about 740 mm plus a gap | Inferred: 483 + 254 mm |
| Minimum depth estimate (station + keyboard) | about 570 mm plus a gap | Inferred: 356 + 213 mm |

---

## 5. Colours and finishes

| Part | Colour / finish | Source |
|---|---|---|
| All covers | matte paint finish, low glare | GIM p.104 |
| Display station | "Pearl White with Pebble Gray" | MD p.5 |
| Display bezel | screen framed by a dark surround inside a pearl-white housing; the darker parts are probably the pebble-grey element | BRO p.1, p.18 photos (inferred which part is pebble grey) |
| Electronics module | pearl white cover; rear panels black with white numbering; base moulding light grey | BRO p.18; PH main_assy/Displaywriter_back.JPG, inside.JPG |
| Keyboard case | pearl white, fine texture (warm beige with age in the photo) | PH keyboard/KBD_1.JPG; BRO p.18 |
| Keycaps | pearl white with black legends; matte | GIM p.22, p.104 |
| Inside the keyboard | dark contamination shield (seen only with the cover off) | PH keyboard/KBD_2.JPG, KBD_3.JPG |
| Diskette unit | pearl white; slots and load levers dark (black) | MD p.1; BRO p.18; CSG p.42 |
| Diskette labels | grey "1", terra cotta "2D"; black jacket | MD p.1; BRO p.1 |
| Display Station Platform | pebble grey | MD p.6 |
| Mag card unit | pearl white with black face plate | MD p.2 |
| Pearl white rationale | keeps a reflectance ratio under 3:1 between work station, keyboard and copy | GIM p.104 |

Pearl White and Pebble Gray are names only; no colour values are given anywhere (open question).

---

## 6. Figures and photos most useful for 3D modelling

| Doc / file | Page | What it shows |
|---|---|---|
| ST | p.28 | 25-line display front, right side (tilt), top (swivel); mounting on the electronics module turntable; character sizes |
| ST | p.29 | character box grid with underscore, cursor, super/subscript (dot-exact) |
| CSG | p.23 | display lowered onto the electronics module's round turntable; front of the electronics module (power-switch recess) |
| CSG | p.27, p.29 | rear of the electronics module: panel 1 and 2 sockets and cable routing to display, keyboard, diskette unit |
| CSG | p.37, p.40 | assembled work station in operating position; display controls and power switch close-ups |
| CSG | p.42 | diskette unit front: lever open/closed close-ups, diskette insertion |
| PSM | p.7 | 25-line display front with contrast and brightness knobs |
| PSM | p.30 | keyboard exploded view (key assembly, pad card, plates, logic card, speaker, cable) |
| PSM | p.34 | keyboard key-position diagram, 96-character, with T/M/N-A marks |
| PSM | p.46 | electronics module top cover (turntable recess, vents) and card cage |
| PSM | p.50 | diskette drive mechanism (motor, pulley/fan, hub, collet, head carriage, stepper, bail, handle) |
| PSM | p.61 | diskette unit covers (top slides back, front slides forward) |
| ST | p.90 | diskette in the drive with handle open and closed |
| ST | p.103 | dual drive assembly |
| GIM | p.22 | keyboard drawing with all legends |
| GIM | p.25 | single diskette unit front |
| ORG | p.28 | 25-line and large display, control positions |
| ORG | p.35 | 96-character keyboard drawing (CODE fronts shaded) and the Textpack 4 keyboard template |
| ORG | p.54 | single and dual diskette unit fronts |
| BRO | p.1 | colour photo: display station and diskette in use (scale reference: 8-inch diskette in hand) |
| BRO | p.18 | product photos: display station (25 and 66-line), diskette unit, printers |
| PH | keyboard/KBD_2.JPG | keyboard from above, cover off, every keycap legible |
| PH | keyboard/KBD_3.JPG | keyboard logic card, speaker, ID jumper block |
| PH | keyboard/KBD_1.JPG | case texture and colour (label close-up) |
| PH | main_assy/Displaywriter_back.JPG | rear panel 1 and 2 in detail |
| PH | main_assy/inside.JPG | electronics module opened: base moulding, card cage, power supply |
| PH | floppy/Floppy_Assy.jpg, Floppy_T.jpg | diskette adapter card |

---

## 7. Checks against the plan's working assumptions

| Assumption | Result |
|---|---|
| 8086 at about 5 MHz | 8086 + 8284 confirmed by a collector's chip list (RE); clock not found |
| 8-inch drives at 360 rpm, 2D double-sided double-density | confirmed (ST p.93; GIM p.24) |
| Capacitive buckling-spring keyboard on a coiled cable | capacitive confirmed; buckling spring not mentioned (fly-plate modules); cable 1 m, coiling not stated |
| Green phosphor, tilting and swivelling | confirmed (GIM p.104; ST p.28) |
| NEC 765 diskette controller | confirmed by photo marking "NEC D765D" on the diskette adapter card |
| Type A / Type B keyboard modules | not so: Type A/B are memory cards; keyboards are 96- or 92-character |

## 8. Open questions

1. CPU clock frequency (8284 crystal value not readable in the photos).
2. Refresh: ST p.76 says about 35 full sweeps per second; check whether that is a simplification (for example
   interlace) before building flicker into the shader. Horizontal frequency is not given anywhere.
3. Phosphor type (P39 or P31) and persistence time: only "green" and "after image remains for a short time".
4. Whether the cursor blinks; all sources describe a steady brightened underline.
5. Display cable length: 610 mm (MD) versus 254 mm (ST).
6. Swivel: 12 degrees each way (ST, GIM) versus a "30-degree rotate range" (MD).
7. Keyboard: feet or angle adjustment, cable coiled or straight, exact key widths, mechanical sound of the
   fly-plate modules, full force curve (only 40-75 g and 1.5-3 mm given), the small stub beside LOCK in the drawings.
8. Physical layout difference between the 92- and 96-character keyboards.
9. Diskette unit: head-load time, motor run-up behaviour (motors run whenever power is on), and whether any unit
   has an activity light (none documented).
10. 5218 printer dimensions and the Customer Planning Guide G544-0852 (furniture and clearances): not in these sources.
11. Colour values for Pearl White and Pebble Gray; which exact parts of the display are Pebble Gray.
12. What the square at the front right of the electronics module top is (a badge, inferred, or something else).
13. Whether keys marked N-A in PSM p.34 (82, 83, 1, 2, 4, 73) are active on keyboards used with Textpack 4, which assigns them functions.
