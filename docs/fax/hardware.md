# Sharp FO-70 facsimile: hardware and behaviour, from the manuals

The cited fact base for the `faxfo70` machine (see `plan.md`, `architecture.md`), in the form of
`docs/displaywriter/hardware.md`. Everything below is summarised from the owner's two manuals in my own words;
numbers, displays and short labels are quoted as facts. Where the code holds a value, the file is named.

## Source key

| Id | Document | File |
|---|---|---|
| SM | *Sharp FO-50 / FO-70 Service Manual*, No. 00ZFO50RA/SME, (c) 2000, for the **FO-50RA / FO-70RA**. A 106-page ManualsLib web print | `refs/sharp_fo70_service_manual.pdf` |
| OM | *Sharp FO-10 / FO-50 / FO-70 Operation Manual* (TINSQ4027XHZC, printed in Thailand). A 202-page ManualsLib print: PDF pages 4-102 are the text, 103-200 the page images | `refs/sharp_fo10_50_70_operation_manual.pdf` |

Citations give the manual's printed page. **SM p.X-Y**: the PDF page is found from the chapter starts
1-1 = pdf6, 2-1 = pdf16, 3-1 = pdf35, 4-1 = pdf49, 5-1 = pdf52, 6-1 = pdf64, 7-1 = pdf79, 8-1 = pdf81; the parts guide
is pdf88-106 (its own pages -1- to -16-, written "SM parts p.N"). **OM p.N**: the text is PDF page N + 4, the page
image with its figures and display boxes PDF page N + 102. Figures were read from renders (`pdftoppm -r 110` to 400).

"Inferred" marks a reading of ours, with its reason. **[A]** in code marks a value neither manual gives.

---

## 1. The machine and its market

- **Models.** FO-50: paper torn off by hand. FO-70: automatic cutter. FO-10 (OM only): no rapid keys, no automatic
  feeder (one page at a time), 10 speed dial numbers, no polling (OM p.1, p.8, p.33, p.79). We model the FO-70.
- **Edition.** SM is for the FO-50RA / FO-70RA (cover). OM is the edition with **Duplex Ringing for Hongkong Telecom's
  Homefax 2 and Faxline 2** (OM p.75) and Caller ID: a Hong Kong edition. Both: 220-240 V AC, 50/60 Hz (SM p.1-1, OM
  p.2), "grounded (2-prong)" (SM p.1-4) or "(3-prong)" (OM p.3). No North American edition among the documents.
- **ROM.** 27C010 EPROM, FZK0 in the FO-50, **FZL0** in the FO-70 (SM p.2-2; parts VHI27010FZL0G, SM parts p.9).
- **Country select** (diagnostics, SM p.2-4): HONG KONG (HK), INDIA (IN), MALAYSIA (MY), RUSSIAN (RA), SINGAPORE
  (SG), SOUTH AFRICA (ZA), TAIWAN (printed "AU"), THAILAND (TH), GENERAL AREA (GRU), GENERAL AREA (GRH), AUSTRALIA (A),
  CHINA (CN). It "sets line connecting parameters which correspond to each destination" and the soft switches'
  defaults (a memory clear must follow); **the parameters themselves are not listed.** The suffixes match Sharp's
  market codes, so "RA" is the Russian market. `faxfo70.js market`, `diag.js`.
- **Year.** SM (c) 2000; both manuals say the machine is Year 2000 compliant; examples use 1999 (OM p.25).

## 2. Specifications (SM p.1-1; OM p.1-2)

| Item | Value |
|---|---|
| Automatic dialling | Rapid keys 5; speed dialling 35 (numbers 01-05 rapid, 06-40 speed: OM p.40) |
| Paper | Starter roll 10 m; replacement FO-20PRw, 30 m, **12.7 mm core** (OM p.1). Sharp paper is **216 mm** wide; 210 mm paper takes the roll shims (SM p.1-6, OM p.17) |
| Cutting | FO-50: by hand. FO-70: automatic cutter |
| Modem | 9600 bit/s with automatic fallback |
| Transmission time | About 15 s (ITU-T chart 1, standard, Sharp special mode, phase C only) |
| Resolution | 8 pels/mm; standard 3.85, fine and halftone 7.7, super fine 15.4 lines/mm |
| Feeder | 5 pages (20 lb); "10 sheets max." in the paper table (SM p.1-3, p.3-1); FO-10 none |
| Halftone | 64 levels |
| Display | 16-digit LCD |
| Coding | MR, MH, Sharp (H2) |
| Line, compatibility | PSTN; ITU-T G3 |
| Documents | Automatic: 148-216 mm wide, 140-297 mm long, 52-80 g/m2. By hand, one sheet: to 600 mm long, to 157 g/m2 (OM p.31). Margins not read: 5 mm top and bottom, 4 mm sides (OM p.32) |
| Effective widths | Scanning 210 mm, printing 210 mm max. |
| Contrast | Automatic / Dark |
| Reception modes | Fax, Tel, Tel/Fax, A.M. |
| Copy, telephone | Yes; the telephone does not work in a power failure |
| Power | Standby 2.3 W, max. 115 W |
| Environment | 5-35 C, to 85 % RH (installation: 30-85 %) |
| Size, weight | **304 W x 236 D x 122 H mm, about 2.6 kg** |

No ECM and no page memory are mentioned anywhere; the protocol chart has neither (section 9), and the RAM is a
256 kbit "line memory" (section 5.1). `faxfo70.js capabilities`.

## 3. Operation panel (SM p.1-2; OM p.8-9; key matrix SM p.6-15)

The drawing (both manuals) and the operation panel PWB's matrix agree on **27 keys** and **one VOLUME key**:

| Matrix line | Keys (return lines KEN1A-KEN4A) |
|---|---|
| SEN0 | -, 1, 2, 3 |
| SEN1 | VOLUME, 4, 5, 6 |
| SEN2 | FUNC, 7, 8, 9 |
| SEN3 | RESO/MODE, *, 0, # |
| SEN4 | 01, 02, 03, 04 (rapid A-D) |
| SEN5 | 05 (rapid E/POLL), START, STOP, COPY |
| SEN6 | REDIAL, SPEED, HOLD, SPEAKER |
| SEN7 | REC, REPEAT, PLAY, DELETE: not fitted (N.M.), an answering machine model's |

The same PWB carries the LCD connector and the **document sensor switch ORGSNS** (SW-169-72AU).

Layout and legends (drawing): the LCD with **TEL FAX** printed above its right end and **TEL/FAX A.M.** below it;
under it the five rapid keys **A B C D E/POLL** in an arc with **STOP** printed over the round pad; the pad's left
segment **START**, its top **STOP**, its right **COPY/HELP**; VOLUME, FUNCTION and RESOLUTION/RECEPTION MODE in a
column left of the keypad; the keypad 1-9, *, 0, # with ABC DEF / GHI JKL MNO / PQRS TUV WXYZ; SPEED DIAL, REDIAL,
HOLD/SEARCH, SPEAKER in a column at the right; the panel release finger hold at the front right; the handset on its
rest at the left. (The drawing also labels the rapid keys "01 02 ... 09 10/POLL", a ten-key model's.)

Key functions (OM p.8-9): rapid keys dial automatically; FUNCTION selects the special functions; **VOLUME** sets the
speaker's volume after SPEAKER, the ringer's otherwise; SPEED DIAL dials a two-digit number; REDIAL redials the last
number; START begins transmission (speed, direct keypad or normal dialling); STOP cancels; COPY/HELP copies a loaded
document, else prints the Help List; RESOLUTION/RECEPTION MODE sets resolution with a document, else the reception
mode, shown by **an arrow in the display**; SPEAKER listens to the line ("not a speakerphone"); HOLD/SEARCH searches the
auto-dial numbers, or holds a call. `faxfo70.js mech.panel`, `firmware/panel.js`.

## 4. Mechanism

### 4.1 Document feed (SM p.3-1, p.3-2; scanner unit parts SM p.3-4, SM parts p.3; document guide upper SM p.3-6)

- A document set in the hopper trips the **front sensor** (FRSNS, a switch on the scanner frame), which starts the
  pulse motor; the **paper feed roller** takes the bottom sheet against the **separation rubber plate** (with
  separator plate and separate spring, in the upper document guide, over a feed plate and feed spring) and the feed
  **stops when the leading edge reaches the document sensor** (ORGSNS). Reading begins a set number of pulses later,
  and ends a set number of pulses after the trailing edge leaves the sensor; then the original is discharged. With
  the front sensor off, the drive stops after the discharge. The display shows **READY TO SEND** (OM p.33).
- **One** feed roller (NROLR2375) on its shaft; the white **back roller** over the CIS, driven through the back
  roller gear; reduction gears **17/28Z and 17/23Z**; the **CIS release levers** (the "green levers on each side of
  the white roller", OM p.83, p.92) lift it to clear a jam; two CIS springs press the CIS up.
- Hopper: left and right document guides on a pinion with a hopper spring (centred guides); widths 148-216 mm.
- Feeder capacity 5 sheets; more can be added gently while the last is being read (SM p.1-3).
- Code: `scanner-mech.js` keeps two rollers at different speeds; their roles map to the feed roller and the back
  roller (`faxfo70.js mech.feeder`). Sensor positions and speeds are [A].

### 4.2 Drive unit (SM p.3-7 fig. 5 cutter model, p.3-8 fig. 6 non-cutter; SM parts p.5-6)

- **One motor** (RMOTZ2148XHZZ), the "TX/RX MOTOR" of the wiring diagram (SM p.4-2), a flat can-stack pulse motor on
  a motor plate. Driven unipolar from +24 V (VMT, through IC protector FU100, KAB2402) by a **ULN2003A** whose inputs
  are the FC200's phases **TPA, TPB and their complements** (SM p.6-5): two phases on, full steps. Connector CNMT:
  TPAD, TPBD, /TPAD, /TPBD, VMT, VMT. Step angle and torque are not given.
- FO-70 parts: drive unit frame; motor plate; **planet levers A, B and C**, each with a planet gear and a planet gear
  spring (the detail: the spring and grease between lever and gear, a friction drive); **mode lever** with its own
  planet gear and spring; **cam gear** with cam spring and **cam switch** (CNCSW, signal CSWI); reduction gears
  **17/30Z (two), 17/36Z, 17/43Z**; idler gears **25Z (three), 30Z**; **cutter gear** with cutter gear spring;
  **cutter plate**; **cutter switch** (CNCUT, signal CUTI). FO-50: the same without planet lever C, the 17/36Z, the 30Z,
  one 17/30Z and the cutter parts.
- Recording drive (SM p.3-2): "via the pulse motor gear shaft, the reduction gear and the recording paper feed gear"
  to the platen roller. The FO-70's paper-out roller has its own PO gear (SM p.3-10).
- **Not given:** which planet drives which train, how the mode lever and cam choose, the pinion's and the roller gears'
  teeth, step counts per line. Inferred (ours): forward and reverse select scanning and recording by the swing gears;
  the cam and mode lever choose platen or cutter. `drive-mech.js`, `drive-ctl.js`.

### 4.3 Recording (SM p.3-2, p.3-9 to 3-11; head frame parts SM parts p.2)

- **Thermal head:** 1728 heat elements in one row, 8 dots/mm, with a 1728-bit shift register, latch and drivers;
  maximum recording speed **10 ms a line**; "divided into nine segments" for low power (SM p.3-2). The FC200 drives a
  "4 STROBE TPH" (SM p.5-2 fig. 3) and the head cable carries **STRB1-STRB4**, LATCH, PCLK, DATA, VTH (three pins),
  thermistor **THI**, **RANK**, MG (SM p.4-3). The supply **VTH is +24 V, switched by relay RY1** (DQ1U-24VDC) driven
  by VTHON (SM p.6-5). RANK 0 or 1 sorts heads by resistance and is printed at the end of the check pattern (SM
  p.2-3). Resistance and strobe times are not given. `thermal/head.js`.
- Head frame: platen roller with platen gear and two bearings; head holders; head springs 1 (three) and 2 (two);
  head guide; FO-70: two pinch rollers with springs, PO guide unit, **PO roller** (two rubbers) and PO gear, cutter
  guide upper, cutter cushion and **cutter unit** (PCUT-2040SCZZ).
- Recording is by pressing the head against the platen; uneven print comes from head alignment or platen concentricity
  (SM p.3-2).
- Paper loading (OM p.16-19, SM p.1-6): open the operation panel by its finger hold; flip up the **front paper guide**
  (press the knob so the metal guide's front is down); shims for 210 mm paper; the roll's shaft ends in notches, the
  leading edge unrolling as drawn (coated one side; backwards prints blank); **push the paper's edge through the slot
  until it comes out of the front opening**; flip the guide down; close the panel until it clicks. **FO-70: a short
  length is cut off.** So the head is not lifted by the panel. `head-mech.js` (`cover.liftsHead: false`).
- Paper end: **OUT OF PAPER** (OM p.19). Paper jam: **PAPER JAMMED**; remove the roll, remove cut pieces from the
  compartment (FO-70), cut off the wrinkled part, reload (OM p.93-94).

### 4.4 Cutter (SM p.3-5, p.3-7, p.3-9; SM parts p.2, p.6)

- **No cutter motor.** Planet lever C, the cutter gear and the cutter plate (a crank disc with a pin) work the
  **cutter arm** (with the cutter arm spring) on the cabinet, which closes the cutter unit's blade; the **cutter
  switch** reads home. The cutter "is built and adjusted to high precision": do not grip, press, twist, take apart or
  wipe the grease off its edge (SM p.3-9).
- Cutter aging (diagnostics) cuts pieces about 10 mm long repeatedly and counts them; it stops on STOP held, no paper,
  or a jam (SM p.2-4). `cutter-mech.js`, `print-ctl.js`.

### 4.5 Operation panel as the cover

- Grasp the finger hold and pull up (OM p.9, p.16); the **door sensor** (DRSNS, SM p.4-3, part QSW-M2296XHZZ) reads it;
  two panel lock lever springs; "press down on both front corners ... until it clicks" (OM p.35). COVER OPEN while
  open (OM p.90). Opening angle not given.

### 4.6 Telephone parts

- Handset on the handset rest, its cord in a socket marked with a handset symbol on the side (OM p.11). The hook
  switch (QSW-Z2263XHZZ) is on the TEL/LIU PWB, worked by the hook switch lever and joint lever (SM p.3-3, p.3-12).
- Back: **TEL. LINE** to the wall; **TEL. SET** (behind a seal) for an extension or an answering machine (OM p.14-15,
  p.62). The AC cord is fixed; no power switch (OM p.13). Speaker in the PWB case bottom (SM p.3-12).
- Accessories: original document support (fits at the rear), handset, handset cord, line cord, paper shaft, two roll
  shims, starter roll, operation manual (SM parts p.7, OM p.7).

## 5. Electronics

### 5.1 Control PWB (SM p.4-1, p.5-1 to 5-8, p.6-1 to 6-8)

- **FC200** (Conexant one-chip fax engine, 144-pin QFP): 8-bit CPU, 24-bit address, real-time clock, watchdog, DMA,
  operator panel interface (32 keys, 8 LEDs, LCD), scanner control and video processing (8-bit ADC, shading, 5 ms
  line, dither, error diffusion, MTF), T.4/T.6 codec, thermal printer interface (5 ms line, 4 strobes), motor phases
  PM[3:0] and SM[3:0]. Crystals 32.256 MHz and 32.768 kHz.
- **FM209** MONOFAX modem (128-pin TQFP): V.29, V.27ter (with short train), V.21 channel 2, T.4/T.30 HDLC at 9600,
  7200, 4800, 2400 and 300 bit/s; DTMF detect and three tone detectors; ring detector; V.23 / Type I Caller ID;
  receive range 0 to -43 dBm; programmable transmit level (SM p.5-6).
- **ROM** 27C010 (1 Mbit). **SRAM W24258S-70LE (256 kbit = 32 kbyte)**: "line memory for the main CPU system RAM area
  and coding/decoding process. Used as the transmission buffer", also the daily report and auto dials, backed up by
  the lithium battery (CR2032; about 5 years with the power off, OM p.44). **No page memory.**
- Sensors (SM p.4-3, p.5-11): FRSNS front sensor; ORGSNS document sensor; PSNS and PESNS (recording paper; PI1
  photo-interrupter, FO-70 only, and PI2); DRSNS door; CSWI cam switch; CUTI cutter switch; RHS, HS, CI from the LIU.

### 5.2 TEL/LIU PWB (SM p.5-9 to 5-11; parts SM parts p.11-12)

- Blocks: speech circuit (receiver volume electronic, 2 steps), dial transmission, speaker amplifier, ringer,
  external TEL off-hook detection, CI detection (a photocoupler).
- **One relay, CML** (RRLYZ3427SCZZ): "line connecting relay and DP generating relay"; with photocoupler PC1 it makes
  dial pulses. DTMF is made in the modem. The handset path is switched by gates (TELMUTE, TXMUTE, DPMUTE, SPMUTE), not
  a relay. Loop current with CML off (HS low) means an external phone is off hook.
- Ringer: the modem's tones through the speaker amplifier. Volumes: speaker and ringer low / middle / high by two bits;
  DTMF, key buzzer and DTMF monitor fixed.
- Jacks: CNLNJ (line), CNTLJ (TEL. SET), CNHJ (handset). `liu-mech.js`.

### 5.3 Power supply (SM p.5-12)

+5 V (4.75-5.25) and +24 V (24.0-26.0, SM p.2-1) from a switching regulator (RCC), fuses 1.6 A, inrush thermistor.
PSAVE line (power save; soft switch J2: after 180 s by default).

### 5.4 CIS (SM p.5-12)

Monochrome contact image sensor, **1728 pixels, 8 dots/mm**: sensor, rod lens, LED light source, light-conductive
plate, control circuit; focus pre-set. Signals (CNCIS): VO (about **2 V on white**), øT (start pulse 1.984 us wide, one
every **5 ms**), CISCLK, GLED (LED, +24 V, switched by LEDON), +5 V. Shading needs the UX-108 shading paper in the
diagnostics' shading mode (SM p.8-3). `image/optics.js`.

## 6. Behaviour (OM; display texts in `firmware/messages.js`)

- **Power on** (SM p.7-2): WAIT A MOMENT; STOP then MEMORY CLEAR? and START within 3 s: MEMORY CLEARED.
- **Standby:** "05-NOV 10:30" with the arrow: up to TEL or FAX, down to TEL/FAX or A.M. (OM p.28).
- **Reception modes** (OM p.27-28, p.52-58, p.62-68), stepped TEL, FAX, TEL/FAX, A.M.:
  - FAX: answers on **two rings** (2 to 5 settable, OM p.54). (SM's quick reference says four, SM p.1-9.)
  - TEL: answer by handset; on a fax tone the display shows RECEIVING and reception begins by itself (FAX SIGNAL RX),
    else START; from an extension **5 * *** (the 5 settable 0-9, TEL/FAX REMOTE #).
  - TEL/FAX: answers on two rings, listens **about five seconds** for a fax tone; else **pseudo rings 30 seconds**,
    then sends a fax tone so the caller can send by hand.
  - A.M.: the answering machine (on TEL. SET, answering within two rings) takes the call; the fax takes over on a fax
    tone or **more than four seconds of silence** (Quiet Detect Time, 6 s at the factory, 01-10, 00 off; Quiet
    Start Time 5 s, 00-15); FAX RX A.M. FAILS answers after 5 rings (off at the factory); three tone keys on an
    extension stop the take-over.
- **FUNCTION** (OM p.20-81; displays OM p.90):
  - FUNCTION shows FUNCTION MODE.
  - FUNCTION 2, LISTING MODE: * JUNK # (Anti Junk Number List), # TELEPHONE # (Telephone Number List), START prints.
  - FUNCTION 3, ENTRY MODE: # FAX/TEL. # MODE (1=SET,2=CLEAR; FAX/TEL. # SET and ENTER SPEED #), ## OWN NUMBER SET
    (ENTER FAX #, ENTER YOUR NAME), ### DATE & TIME SET; * PRIORITY CALL #, ** STORE JUNK # (1=SET,2=CLEAR, 1-5).
  - FUNCTION 4, OPTION SETTING alternating with PRESS * OR #: # NUMBER OF RINGS (ENTER (2-5) (2)), ## TEL/FAX REMOTE #,
    ### TRANSACTION LIST (1 ALWAYS PRINT, 2 ERROR PRINT, 3 SEND ONLY, 4 NEVER PRINT; factory: errors only), ####
    DIAL MODE (1=TONE, 2=PULSE; set for tone at the factory), ##### QUIET DETECT TM., ###### QUIET START TIME; *
    CALLER-ID (1=YES,2=NO), ** POLLING, *** FAX SIGNAL RX, **** DUPLEX RINGING, ***** FAX RX A.M. FAILS. Read as one
    ring of eleven items, # forward and * back. A choice moves to the next item (OM p.54).
- **Entering name and number** (OM p.21-22): own number up to 20 digits, # a space, SPEED DIAL backspace; name up to
  24 characters: each key gives its digit then its letters ("SHARP = 77777 444 22 7777 77"; SPACE = 1 1); SPEAKER
  moves the cursor forward (two letters from one key), HOLD/SEARCH back; SPEED DIAL clears; REDIAL changes case; # or *
  steps through ./!"#$%&'()*+,-:;<=>?@[¥]^_`{|}→←.
- **Date and time** (OM p.24-26): day, month, four-digit year, hour (00-23), minute; SPEED DIAL moves the cursor back;
  START starts the clock.
- **Auto-dial numbers** (OM p.40-44): 01-05 rapid keys A-E, 06-40 speed; REDIAL inserts a pause (two seconds, shown as
  a hyphen); no spaces; STOP after each.
- **Sending** (OM p.33-49): READY TO SEND; RESOLUTION/RECEPTION MODE steps STANDARD :AUTO, FINE :AUTO, SUPER FINE:AUTO,
  HALF TONE :AUTO, then the four at :DARK (defaults STANDARD and AUTO, for that document only); normal dialling by
  handset or SPEAKER and START on the tone; a rapid key sends by itself; SPEED DIAL + two digits + START; direct
  keypad + START (STOP backspaces); HOLD/SEARCH 1, a letter, # or *, START (NO DATA if none). REDIAL switches the
  speaker on and redials; START on the fax tone (OM p.39; SM SW-B1 No. 2). Automatic redial: **2 attempts, 5
  minutes apart**, RECALLING; STOP cancels (OM p.49).
- **Transaction Report** (OM p.50-51): after a send or reception per TRANSACTION LIST; not on demand; columns DATE
  START RECEIVER PAGES TIME NOTE, notes OK, P.FAIL, JAM, NO PAPER, COM.E-0 to COM.E-7, CANCEL (layout drawn in the
  figure). `firmware/reports.js`.
- **Copy** (OM p.59): load, set resolution and contrast, COPY/HELP. Copies are fine unless set otherwise (SM SW-C1).
- **Telephone** (OM p.60-61): handset or SPEAKER, dial by any method; chain dialling; REDIAL redials without lifting;
  HOLD/SEARCH holds (HOLD).
- **Caller ID** (OM p.69-74): name and number alternate from before the second ring; NO SERVICE, CALLER-ID ERROR,
  PRIVATE CALL; the last 20 calls (HOLD/SEARCH 2: REVIEWING CALLS, * newest, # oldest, 0 deletes one, 0 held 3 s all;
  START sends, lifting dials); PRIORITY CALL # rings specially for one number; junk numbers break voice calls too.
- **Duplex Ringing** (OM p.75): short cadence voice, long cadence fax answered after two rings; not with TEL/FAX.
- **Anti junk** (OM p.77-78): five numbers.
- **Polling** (OM p.79-80): POLLING set to YES turns E/POLL into the polling key (no longer a rapid key); dial (handset,
  SPEED DIAL, or the number keys) then E/POLL; POLLING shown.
- **Volume** (OM p.29-30): SPEAKER: MIDDLE / HIGH / LOW; RINGER: MIDDLE / HIGH / RINGER OFF: OK? (START) / LOW.
- **Signals** (OM p.91): end of a transaction a continuous tone 3 s; incomplete, 5 s of 1 s on / 1 s off (3 beeps);
  handset left off hook, rapid 0.7 s on / 0.3 s off. TOTAL PAGE(S) 01 shows the count.

## 7. Soft switches (SM p.2-4 to 2-17)

SW-A1 to SW-K1, eight bits each, transcribed with their initial settings in `firmware/softswitch.js`. Those the
firmware reads: modem start speed 9600 (A2), CED to DIS gap 75 ms (A3), transmit level -12 dBm by the table (A4;
the text says -10), redial 5 min and 2 times (B1, B2), wait after dialling 45 s (B3), pause 2 s, pulse 40 % make
(B4), rings 2 (D1), pseudo ring **30 s**, CNG count twice, CNG detect **5 s**, no post-answer tone, LA-SI-DO type,
pseudo ring 1 s on / 2 s off (E1), remote code 5 (F1), quiet detect 4 s, start 5 s (G1; the OM says 6 s factory),
OGM 100 ms, section 40 s (G3), quiet level -44 dBm (G4), busy tone 5 s, 4 pulses, 150-900 ms (H1, H2), ringer and
speaker middle, polling key off (J1), power save after 180 s (J2), report on error, 24-hour, day-month-year (J3).

## 8. Error codes (SM p.2-19; OM p.51)

The communication error code table, by **the final signal received**, for G3 transmission (0 incomplete frame;
1 NSF, DIS; 2 CFR; 3 FTT; 4 MCF; 5 PIP or PIN; 6 RTN or RTP; 7 no signal or DCN; 8, 11, 12, 13 retransmission,
remote cannot receive, after fallback, after the retransmission end command) and for G3 reception (0 incomplete; 1 NSS,
DCS; 2 NSC, DTC; 3 EOP; 4 EOM; 5 MPS; 6 PR1-Q; 7 no signal or DCN; 8-13 as above). Verbatim in
`messages.js COMM_CODES`. The transaction report prints them as **COM.E-0 to COM.E-7** (OM p.51); `commCode()` keeps
to those.

## 9. Protocol and power-on (SM p.7-1, p.7-2)

G3: CED; NSF, CSI, DIS; TSI, (DCS) or NSS; TCF; CFR; image; RTC; MPS / MCF; ...; EOP / MCF; DCN. The receiver goes "to
recording position" at CED; the transmitter inserts the document to the reading position after DIS and receives a
"next page insert command" after each page; "cut line printed" at each page end; recording paper ejected and document
ejected at the end. No ECM frames. The signal send mode sends 9600, 7200, 4800, 2400 bit/s, 300 bit/s flags, 2100 Hz
CED, 1100 Hz CNG and the pseudo ring (SM p.2-3).

## 10. Diagnostics (SM p.2-2 to 2-4)

FUNCTION 9 * 8 # 7: "ROM Ver. FZL0 *" for 2 s, DIAG MODE; START; items by * and # or direct key: SOFT SWITCH MODE,
ROM & RAM CHECK (A; buzzer counts 0/1/2), AGING MODE (10 sheets, one each 5 min), PANEL CHECK MODE, CHECK PATTERN (B;
two sheets: 35 mm stripes, 70 mm black, 35 mm white, RANK), SIGNAL SEND MODE (C), MEMORY CLEAR, SHADING MODE, ALL BLACK
PRINT (D; 2 m), AUTO FEEDER MODE (E), ENTRY DATA SEND / RECEIVE, CUTTER AGING (cutter model), COUNTRY SELECT. Soft
switch display "SFT SW-A1 = 0 0 0 0 0 0 0 0": FUNCTION sets the bit, # and * move, START the next switch, STOP ends
(the switch shown is not kept), COPY prints. `firmware/diag.js` builds the soft switch mode, memory clear, country
select, ROM & RAM check and panel check.

## 11. Where the documents disagree

| Item | One says | The other | Code |
|---|---|---|---|
| FAX mode rings | Four (SM quick reference p.1-9) | Two, 2-5 (OM p.53-54); SW-D1 initial 2 | 2 |
| Feeder capacity | 5 sheets (spec) | 10 sheets (paper table) | 5 |
| Head segments | 9 (SM p.3-2) | 4 strobes (SM p.4-3, p.5-2) | 4 |
| Dial mode default | Tone (OM p.14, SM p.1-5) | SW-B4 No. 2 initial 0 = pulse | Tone |
| Quiet detect time | 6 s (OM p.65) | 4 s (SW-G1 initial) | 6 (user option) |
| Transmit level | -10 dB (SM p.2-13 text) | 01100 = -12 dBm (table) | table |
| CNG in standby, SW-F2 No. 1 | table: 1 = yes | text: 1 stops it | table |
| "FAX/TEL # MODE" | SM quick reference | "FAX/TEL. # MODE" (OM display figure) | OM |
| Wall plug | 2-prong (SM) | 3-prong (OM) | - |

## 12. What neither manual gives

Line parameters per country; ring cadences and tone plans; the motor's step angle, torques and steps per line; the
gear path and the cam's operation; roller diameters; head resistance and strobe times; sensor positions; the cutter's
geometry; the operation panel's opening angle; the LCD texts while dialling, sending, receiving and copying (DIALING,
SENDING, COPYING are ours); the activity report (the machine has none) and the lists' layouts; the Help List's text;
the header line's layout.
