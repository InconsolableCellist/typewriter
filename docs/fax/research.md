# Fax machine: research notes

Notes behind `plan.md`, gathered 2026-11-15 in a cloud session. Everything is summarised in my own words; numbers
and short labels are quoted as facts.

**How far to trust this file.** Most of the hosts that hold fax manuals were blocked from the session (section 1), so
**no service manual has been read yet**. Three kinds of statement appear below and are marked:

- **[S]** taken from a source that was read or from a search result that quoted it; the source is named.
- **[M]** from memory of the CCITT/ITU-T Recommendations and of the machines. Believed right, **not checked against
  the text**. Milestone M0 of the plan checks every one of them.
- **[A]** an assumption or a design default of ours.

## 1. What could and could not be reached

| Host | Result from this session |
|---|---|
| `en.wikipedia.org`, `commons.wikimedia.org`, `upload.wikimedia.org` | Reachable with `curl` (rate limited); not with the fetch tool |
| `collection.sciencemuseumgroup.org.uk`, `sharktastica.co.uk`, `registry.npmjs.org`, `pypi.org` | Reachable |
| `bitsavers.org` | HTTP 403 |
| `www.mirrorservice.org`, `ftp.mirrorservice.org`, `copernicus.mirrorservice.org` | Blocked by the proxy or timed out; `kuiper.mirrorservice.org` answers but returns 404 for the Bitsavers tree |
| `archive.org`, `web.archive.org` | Blocked |
| `www.manualslib.com`, `manualmachine.com`, `manuals.online`, `elektrotanya.com` | Blocked |
| `www.itu.int`, `www.rfc-editor.org` | Blocked |
| `developers.cloudflare.com`, `www.cloudflare.com` | Blocked (figures below come from search summaries of those pages) |
| `www.computerhistory.org`, `www.thehenryford.org`, `vt100.net` | Blocked |

Web search worked and returned summaries and addresses, which is how the documents in section 2 were located.
**The next session needs these hosts allowed**, or the owner can download the PDFs and drop them in
`docs/fax/refs/`:

```
www.manualslib.com  manualmachine.com  manuals.online  elektrotanya.com  archive.org  web.archive.org
www.itu.int  www.rfc-editor.org  datatracker.ietf.org
bitsavers.org  www.mirrorservice.org  ftp.mirrorservice.org
developers.cloudflare.com
freesound.org  www.youtube.com (reference recordings, to listen and measure only)
```

## 2. Documents located

| Id | Document | Where | Read? |
|---|---|---|---|
| X-TRM | *Xerox Telecopier 7017 / 7017SF Technical Reference Manual*, 194 pages, page footers dated 6/88 to 12/88. Eight sections: service call procedures, image quality, repair and adjustment, parts lists, wiring, the store-and-forward option | https://www.manualslib.com/manual/1466884/Xerox-Telecopier-7017.html ; https://manualmachine.com/xerox/telecopier7017/19926321-technical-reference-manual | No (host blocked). Section list and dates from search summaries |
| X-IA | "Xerox Manual: Xerox 7010 7017 SF" | https://archive.org/details/xerox-70107017sfsmpc | No. Contents unknown; the item name suggests a service manual and parts catalogue |
| X-PM | *Xerox Telecopier 7017 Product Manual* (operator's) | https://manuals.online/xerox/printer/telecopier-7017/product-manual/1rq9q | No |
| X-UP | UsedPrice listing: 7017 and 7017SF made 1988 to 1991, thermal printing, 9.6 kbit/s | https://www.usedprice.com/items/computer/xerox/fax-machine/index.html | Search summary only |
| R-FSM | *Ricoh FAX77 / FAX80 / FAX85 Field Service Manual* | https://manualmachine.com/ricoh/facsimilefax80/22319847-field-service-manual | No. Search summary gives: thermal printing with automatic cutter, roll 216 mm x 100 m; 12.8 x 15.3 x 6.9 in, 9 kg; test-page times 20 / 14 / 13 s; FAX77 has MH and MR, the others add MMR and ECM |
| R-G3 | Ricoh *Group 3 Facsimile* basic training manual (scanner, thermal printing, coding, protocol, modems) | https://manualmachine.com/ricoh/g3basic/8593812-basiceur | No. **Wanted whatever machine is chosen**: it is a manufacturer's own explanation of how a G3 machine works |
| S-220 | *Sharp FO-220 Operation Manual*, 133 pages. "Compact, desktop digital unit"; talks to Group 3 and Group 2 machines; FINE and HALF-TONE modes, TALK and POLLING | https://www.manualslib.com/manual/490235/Sharp-Fo-220.html | No. Date not established |
| S-70 | *Sharp FO-50 / FO-70 Service Manual*, 102 pages: general description, mechanism blocks (operation panel, scanner frame, CIS unit, drive unit, head frame and thermal head), diagrams, drive units for the tear-off model (FO-50) and the cutter model (FO-70) | https://www.manualslib.com/manual/970612/Sharp-Fo-70.html ; https://elektrotanya.com/sharp_fo-50_fo-70.pdf/download.html | No. One listing carries "(c) 1999", so this is a 1990s machine, not a 1980s one |
| M-900 | *Murata M-900* user manual, 16 pages | https://www.manualslib.com/manual/297250/Murata-M-900.html | No |
| B-100 | Brother FAX-100 schematics | https://manualmachine.com/brother/100/5136228-schematic/ | No |
| P-F90 | Panasonic KX-F90: two photographs on white on Wikimedia Commons (`File:Panasonic KX-F90.jpg` and a crop) | https://commons.wikimedia.org/wiki/Category:Fax_machines_with_white_background | Listed, not viewed |
| N-2 | NEC Nefax 2 photographs (`File:Fax Nec 1.jpg`, `Fax Nec 2.jpg`, CC BY-SA 4.0) | https://commons.wikimedia.org/wiki/Category:Fax_machines | Listed, not viewed |
| DD-85 | Data Decisions, *Communications Systems* (1985), "Facsimile Terminals" survey, July 1985: over 94 models from 19 vendors (Xerox Telecopier 298, 400-1, 458, 488, 498-1; Murata Multifax 7100, 7200; Ricoh; and others) with scanning technique, resolution, speed and dimensions per model | https://www.mirrorservice.org/sites/www.bitsavers.org/pdf/dataDecisions/1985_Communications_Systems/Vol2_750.pdf | No (blocked). **The best single survey of the candidates of 1985** |
| Q-HF | Qwip facsimile transceiver, 1975 to 1985, The Henry Ford, object 7198 | https://www.thehenryford.org/collections-and-research/digital-collections/artifact/7198 | Search summary |
| Q-IN | Qwip 1200 at Ingenium, 1988.0629.001 | https://collection.ingeniumcanada.org/en/item/1988.0629.001 | Search summary |
| ROHM | ROHM KF2008-GK11A thermal printhead for facsimiles: 1728 dots at 0.125 mm pitch (8 dots/mm), 216 mm print width, 24 V, 5.0 ms print cycle, 0.80 ms pulse, 432 dots energised at once (four strobe blocks) | https://dtsheet.com/doc/1039661/rohm-kf2008 ; https://manualmachine.com/datasheet/kf2008gk11a/4246336-datasheet-rohm | Search summary. A later head than 1988, but the same format |
| WP-FAX | Wikipedia, "Fax" | https://en.wikipedia.org/wiki/Fax | **Read** |
| WP-TP | Wikipedia, "Thermal paper" | https://en.wikipedia.org/wiki/Thermal_paper | **Read** |
| WP-PTP | Wikipedia, "Precise tone plan"; "Ringing (telephony)" | https://en.wikipedia.org/wiki/Precise_tone_plan ; https://en.wikipedia.org/wiki/Ringing_(telephony) | **Read** |
| RFC804 | RFC 804, the CCITT draft of Recommendation T.4 (1981): the full text with the code tables, free to read | https://www.rfc-editor.org/rfc/rfc804 | Search summary |
| T.4, T.30 | CCITT Recommendations T.4 and T.30 (Blue Book, 11/1988, the edition of the chosen machine's year) | https://www.itu.int/rec/T-REC-T.4 ; https://www.itu.int/rec/T-REC-T.30 | No (blocked) |
| V.21, V.27ter, V.29 | CCITT Recommendations | https://www.itu.int/rec/T-REC-V | No (blocked) |
| T.24 | ITU-T T.24, the standardised digitised test charts (the eight "CCITT images"). The text is free, the image set is sold | https://www.itu.int/rec/T-REC-T.24-199806-S/en | Search summary |
| HYLA | "Implementing ITU T.30", HylaFAX | https://hylafax.sourceforge.io/t30.php | Search summary |
| SPAN | spandsp: a free software T.4 / T.30 / V.21 / V.27ter / V.29 implementation with fax tests (`tests/fax_tests.c`, `tsb85_tests.c`) | https://github.com/freeswitch/spandsp | Not read. A behaviour reference and an offline test oracle only; **no code is copied** (the Displaywriter plan's rule for MAME) |
| CF-DO | Cloudflare Durable Objects pricing and limits | https://developers.cloudflare.com/durable-objects/platform/pricing/ | Search summary |
| CF-W | Cloudflare Workers limits | https://developers.cloudflare.com/workers/platform/limits/ | Search summary |

## 3. The three generations

### 3.1 Group 1 and Group 2 (analogue), 1966 to about 1982

- Xerox's Magnafax Telecopier of 1966 weighed 46 lb (21 kg), connected to any telephone line and sent a letter-size
  page in about six minutes [S WP-FAX].
- How they work [S WP-FAX]: the document spins on a drum; reflected light falls on a photocell; the photocell's
  current sets the frequency of a tone; the tone reaches the line through an acoustic coupler holding the telephone
  handset; the receiver demodulates the tone and drives a stylus on paper on a drum turning at the same rate.
- Group 1 is Recommendation T.2: six minutes a page, 96 lines per inch, frequency modulation. Group 2 is T.3 with
  T.30: three minutes a page, 96 lines per inch, amplitude modulation with a vestigial sideband. Both withdrawn in
  1996 [S WP-FAX; modulation types S DD-85 summary].
- Qwip (Exxon Enterprises, an in-house venture of 1972, sold 1975 to 1985) was the low-priced transceiver of the
  1970s: the sheet wraps round a drum, the two operators first talk on the telephone, then each puts the handset in
  the machine [S Q-HF, Wikipedia "Exxon Enterprises"]. It printed with a stylus on electrosensitive paper [M].
- Group 1 figures from memory [M]: 180 rpm drum (180 lines a minute), white 1500 Hz and black 2300 Hz in North
  America (T.2 gives 1300 to 2100 Hz), no handshake beyond a phasing burst, the page lost if the line clicks.
- Documentation: no manual was found by search. Museum pages give photographs only.

### 3.2 Group 3 desktop machines with thermal paper, 1980 to about 1995

- Recommendation T.4 (1980) made digital machines of different makers work together, at well under a minute a page;
  the fax machine then became ordinary office equipment through the 1980s and 1990s [S WP-FAX].
- Machines of the 1970s to the 1990s usually printed on rolls of direct thermal paper; plain-paper machines (thermal
  transfer, ink-jet, laser) took over in the mid 1990s [S WP-FAX].
- Typical construction [M, to be replaced by the chosen machine's manual]:
  - **Document path.** A sloping feed tray with sliding guides; a separation roller against a friction pad takes the
    bottom sheet; feed rollers carry it over the scan line and out. One stepper drives the whole path. Two sensors:
    document present, and leading edge at the scan line. Documents go in **face down**.
  - **Reading.** Around 1988 a fluorescent or LED-array lamp lights the sheet through a glass, and a lens (often by
    way of mirrors) reduces the 216 mm line onto a CCD of 1728 or 2048 elements. The contact image sensor, a
    page-wide detector with a rod-lens array and LEDs, with very little depth of field [S Wikipedia "Contact image
    sensor"], replaced it in small machines from about 1988 to 1990.
  - **Printing.** A page-wide thick-film thermal head, 1728 dots at 8 dots/mm, pressed by springs against a rubber
    platen roller that a second stepper turns; the roller draws the paper off the roll. The dots are strobed in four
    blocks of 432 so the supply is not overloaded [S ROHM]. A thermistor on the head lets the controller shorten the
    pulse as the head warms.
  - **Cutter.** A rotary or guillotine blade after the head, driven by its own motor or by a solenoid; cheaper
    machines have a serrated tear bar.
  - **Line.** A network control unit: line relay (off hook), a transformer, a ring detector, a pulse-dial relay or
    a DTMF generator, a monitor speaker, and usually a handset.
  - **Electronics.** One 8-bit microprocessor, a modem chip set (Rockwell R96F or a Japanese equivalent), a
    character generator for the header line and the reports, a 16-character LCD or a few LEDs.
- Sounds [M]: dial tone and dialling in the monitor speaker; the far end's 2100 Hz answer tone; the V.21 "burble";
  the training burst and the page's hiss until the speaker mutes; steppers; the cutter's chop; a beep at the end.

### 3.3 Late-1980s and 1990s home and small-office machines

The same machine made smaller and cheaper: a contact image sensor, a short roll (30 m), a tear bar or a small cutter,
a handset on the left, often a telephone answering machine. Service documents for these are the easiest to find
(S-70, Brother, Panasonic), and photographs with free licences exist (P-F90, the Canon Fax-B100 and B115 categories
on Commons), but they are 1990s objects.

## 4. Protocol facts the build will use

All **[M]** unless marked; each gets a clause number in M0.

**T.4 (the page).**
- 1728 picture elements across 215 mm; 3.85 lines/mm (standard) and 7.7 lines/mm (fine) [S RFC804 summary]. An A4
  page is 1728 x 1145 in standard [S WP-FAX], twice the lines in fine.
- One-dimensional coding, Modified Huffman: alternating white and black runs, each a make-up code (multiples of 64,
  to 1728, with extended codes to 2560) and a terminating code (0 to 63); every line starts with a white run.
- End of line: `000000000001`. Fill bits (zeros) may precede an EOL, never inside the data. Return to control: six
  EOLs [S RFC804 summary].
- Minimum transmission time of a coded line: 20 ms standard, with 0, 5, 10 and 40 ms negotiable; the sender pads
  with fill. Maximum 5 s a line in the 1981 text [S RFC804 summary].
- Two-dimensional coding, Modified READ: each EOL is followed by a tag bit (1: the next line is one-dimensional);
  at most K - 1 two-dimensional lines after each one-dimensional line, K = 2 in standard and 4 in fine; pass,
  horizontal and seven vertical modes.
- Modified Huffman compresses ordinary text by a factor of about 20; a page takes on the order of 10 to 60 s at
  9600 bit/s [S WP-FAX gives the factor and 10 s].

**T.30 (the call).**
- Phase A: the caller sends CNG, 1100 Hz for 0.5 s every 3.5 s; the answerer waits about 2 s then sends CED,
  2100 Hz for 2.6 to 4 s [S search summary of Dialogic and GL pages], then 75 ms of silence.
- Phases B, D and E use V.21 channel 2 at 300 bit/s: 1650 Hz for a 1, 1850 Hz for a 0. Each transmission starts
  with one second of HDLC flags (the preamble), then frames: flag `7E`, address `FF`, control `03` or `13` (final),
  the facsimile control field, an information field, a 16-bit frame check, zero insertion after five ones.
- Frames: the answerer's NSF, CSI and DIS; the caller's TSI and DCS; then the caller sends the modem training and
  the training check, 1.5 s of zeros at the message speed (TCF); the answerer replies CFR (go) or FTT (retrain, and
  the caller steps the speed down). After a page: EOP, MPS or EOM; replies MCF, RTP or RTN; finally DCN.
- Timers: T1 35 s to make contact, T2 6 s, T4 3 s for a reply, three tries, then disconnect.
- The receiver must listen for both the high-speed carrier and V.21 at the start of each page [S HYLA summary].

**The modems.**
- V.29: carrier 1700 Hz, 2400 baud; 16 points for 9600 bit/s, 8 for 7200 [S Reeve table by search, for 9600];
  scrambler 1 + x^-18 + x^-23; a training sequence of about a quarter of a second in four segments (silence,
  alternations, equaliser conditioning, scrambled ones).
- V.27ter: carrier 1800 Hz; 4800 bit/s as eight-phase differential at 1600 baud; 2400 bit/s as four-phase at
  1200 baud; scrambler 1 + x^-6 + x^-7 with guards against repeating patterns; a long training sequence.
  (A search summary doubted the 1600 baud figure by reading a table for the 2400 bit/s mode; the Recommendation
  decides.)
- V.17 (1991) and V.34 are later than the machine and out of scope.

**The line (North America).**
- Dial tone 350 + 440 Hz at -13 dBm; audible ringing 440 + 480 Hz, 2 s on and 4 s off; busy 480 + 620 Hz, 0.5 s on
  and off; reorder the same at 0.25 s; frequencies within 0.5 % [S WP-PTP].
- Ringing current: 60 to 105 V rms at 20 Hz on top of the -48 V supply [S WP-PTP].
- DTMF: rows 697, 770, 852, 941 Hz; columns 1209, 1336, 1477 Hz. Pulse dialling: 10 pulses a second, 60 % break.
- The channel: 300 to 3400 Hz, companded to 8 bits at 8 kHz in a digital exchange (mu-law in North America).

**Thermal paper** [S WP-TP]. A coating of a leuco dye, an acidic developer (bisphenol A at the time), a sensitiser
and a stabiliser; the sensitiser melts at about 100 degrees C, the practical lower limit for colour. The image fades
with heat, humidity, light, oils and plasticisers; a hot cup darkens the sheet; a fingernail drawn fast across it
leaves a mark. Thermal fax copies are not accepted by archives because the coating is fragile [S WP-FAX].

## 5. Cloudflare free plan (for the cross-visitor option)

From search summaries of Cloudflare's own pages (CF-DO, CF-W); the pages themselves were blocked. **Check them again
on the day this is built**: one result still showed the older statement that Durable Objects need the paid plan.

| Item | Free-plan figure |
|---|---|
| Workers | 100,000 requests a day, 10 ms CPU a request, 128 MB, 50 subrequests; 1,000 requests a minute burst; error 1027 when over |
| Static assets | Requests for static assets do not invoke a Worker and are not counted [M] |
| Durable Objects | SQLite-backed objects only. 100,000 requests a day (HTTP, RPC sessions, WebSocket messages, alarms); 13,000 GB-s of duration a day; 5 GB stored; operations fail when a limit is reached |
| WebSockets on a Durable Object | 20 incoming messages are billed as one request; outgoing messages and protocol pings are free; with the hibernation API an idle object with open sockets is not billed for duration |
| KV | 100,000 reads a day; 1,000 writes a day [M]; 1 GB. Eventually consistent, so unsuitable for signalling a call |

A Durable Object is billed for 128 MB while awake, so 13,000 GB-s is about 28 hours of awake time a day in total.

## 6. Test oracles available in this container

- Pillow 12.3 with libtiff 4.7.1 writes and reads TIFF with `compression="group3"` and `"group4"` (checked here).
  That gives an independent encoder and decoder for Modified Huffman and for the two-dimensional codes, to produce
  fixtures offline (`tools/fax/make_vectors.py`); the Node tests then read only the committed fixtures.
- numpy 2.5 and scipy 1.18 for measuring spectra of rendered audio, as `tools/audio/` already does.
- The ITU's eight test charts are sold, not free; our own chart is drawn instead (plan, 7.3).

## 7. Recordings and photographs with usable licences found so far

| Item | Licence | Use |
|---|---|---|
| `File:WWS Laserfax.ogg`, Work With Sounds / Werstas, a Canon L-140 of 2008 | CC BY 4.0 | A laser machine: only its line sounds are relevant, and those are synthesised anyway |
| `File:Faxhellorp.ogg`, `File:De-Faxgerät.ogg` | Not established (rate limited) | To check |
| `File:Fax-Phone Switch (ca. 1988).webm`, M. Schönherr | CC BY-SA 4.0 | Period context |
| `File:Fax Nec 1.jpg`, `Fax Nec 2.jpg` (NEC Nefax 2) | CC BY-SA 4.0 | A mid-1980s desktop machine, for general proportions |
| `File:Panasonic KX-F90.jpg` | To check | A small home machine of about 1990 |
| `File:ThermalPaperG3-TMG.JPG`, `File:Fax machine printing.jpg` (CC BY 2.0) | As stated | The look of thermal fax output |

No free recording of a 1980s thermal machine's mechanism was found. The owner's own recording is the best source
(plan, section 6).
