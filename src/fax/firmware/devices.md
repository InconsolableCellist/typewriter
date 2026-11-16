# The FO-70 firmware's device interface

The contract between the firmware (`src/fax/firmware/main.js`) and whatever runs the machine: the mechanism host
(`src/sim/fax/`, built by another agent) in the browser, or `VirtualDevices` (`virtual.js`) in Node tests. The
firmware is pure: no DOM and no timers. The host makes it with

```js
import { createFirmware } from './src/fax/firmware/main.js';
const fw = createFirmware({ devices, storage, options: { wallClockMs, desk, cold, t0 } });
```

and then, every block, moves its clock with `fw.advance(t)` (seconds, the same time base as the host's) and delivers
what the devices report with `fw.deviceEvent(evt)`. Keys may come as `fw.keyDown(name)` or as
`fw.deviceEvent({ dev: 'keys', ev: 'down', key })`. `fw.lcd.text` is the display; `fw.settings` and `fw.journal`
are what the storage holds.

- `options.wallClockMs`: the wall-clock time at `t0`, read with UTC fields (pass `Date.now() - offsetMinutes * 60000`
  so the LCD shows local time). Decision 12: the real date.
- `options.desk`: what a warm start programs when nothing is stored: `{ ownNumber, ownName, speed: [{ number, name }] }`.
  `src/fax/remote/directory.js`'s `deskProgramming()` gives the card index's numbers. Decision 11: warm.
- `options.cold`: no settings stored means the clock is unset (`?cold`).
- `devices.attach?.(fw)` is called first, so devices can reach `fw.clock` (`{ now(), at(t, fn), cancel(h) }`) and
  post events.

## Conventions

- **Events** are objects `{ dev, ev, ... }` handed to `fw.deviceEvent`. They may be delivered at any time; the
  firmware queues them and acts within the same call.
- **Commands** are method calls. A command that takes time is given an `id` and finishes with an event
  `{ dev, ev: 'done', id, ok, error?, ... }`. **Completion is never synchronous**: the done event comes from a later
  `advance`, even for a zero-length operation.
- **Pages and lines** are packed bilevel rows, 1728 pels, 216 bytes, first pel in the most significant bit,
  1 = black (as `src/fax/t4/` codes them). A page bitmap is `{ width: 1728, height, vres, rows }`.
- `vres` is `'standard'` (3.85 lines/mm), `'fine'` (7.7) or `'superfine'` (15.4) [S].
- The printer and the cutter are one mechanism (one motor [M]): their commands run in the order given. The feeder's
  commands also run in order.

## feeder: the document table, separation, feed roller and sensors

| Member | Meaning |
|---|---|
| `status() -> { docPresent, loaded, waiting }` | `docPresent`: the document sensor sees paper. `loaded`: a sheet's leading edge is at the read line. `waiting`: sheets on the table behind it |
| `load({ id })` | Draw the bottom sheet to the read line. Done `ok`, or `ok: false, error: 'jam' \| 'empty'` |
| `feed({ id, lines, vres, seconds })` | Move the loaded sheet `lines` line pitches at `vres`, spread over `seconds` (the paced motion, below). Done when moved |
| `eject({ id })` | Feed the loaded sheet out. Done when its trailing edge has left |
| event `{ dev: 'feeder', ev: 'doc', present }` | The document sensor changed (a sheet laid in, or the last one gone) |
| event `{ dev: 'feeder', ev: 'jam' }` | A misfeed or a sheet stuck (DOCUMENT JAMMED) |

## scanner: the CIS and video processing

| Member | Meaning |
|---|---|
| `begin({ vres, halftone, contrast })` | Lamp on, set up for a page. `halftone` asks the video stage for its 64-level halftone [S]; `contrast` is `'NORMAL'` or `'DARK'` |
| `readLine(k) -> Uint8Array(216) \| null` | Line `k` (from the leading edge) of the loaded sheet at the `vres` of `begin`, already thresholded or halftoned. `null` past the trailing edge. Synchronous |
| `end()` | Lamp off |

**Pacing, and its one approximation.** The FO-70 is taken to have no page memory (plan section 2), so the sheet
should move past the sensor only as fast as the modem takes its lines. The T.30 station as built asks for a page's
bits whole, so the firmware reads the sheet's lines when the page begins (`readLine` 0, 1, 2 ... in one go), codes
them, and then commands the motion along the page's real timeline: line *i* goes on the line at
`start + training + firstBit(i) / rate`, and the firmware sends `feeder.feed` in half-second chunks of that timeline
(dense passages creep, white space runs). A host should sample `readLine(k)` from the sheet **where line k will be
when the feed brings it to the glass**; this holds as long as nobody pulls the sheet during the page. The receiving
side prints each page when its data has arrived (before the post-message exchange), and paper running out ends the
call.

## printer: the thermal head, platen and roll

| Member | Meaning |
|---|---|
| `status() -> { paper, coverOpen }` | The paper sensor and the cover (operation panel) switch |
| `print({ id, rows, count, vres, contrast })` | Print `count` rows at `vres`. Done `ok`; or `ok: false, error: 'paper' \| 'cover'` with `printed` (rows that went down before the fault) |
| event `{ dev: 'printer', ev: 'paper', present }` | The paper sensor changed (roll ran out, roll loaded) |
| event `{ dev: 'printer', ev: 'cover', open }` | The panel was lifted or closed |

## cutter

| Member | Meaning |
|---|---|
| `cut({ id })` | Cut the strip after what has been printed. Done `ok`, or `ok: false, error: 'jam'` |

## ncu: the line interface (TEL/LIU board), hook switch, dialler and call-progress detector

| Member | Meaning |
|---|---|
| `status() -> { handsetOff, seized, line, extOffHook }` | `line: false` when the line cord is unplugged |
| `seize(on)` | The line relay: the machine takes the line (off hook) or lets it go. The loop is closed while the relay is closed **or** the handset is off hook (the hook switch is on the line itself) |
| `hold(on)` | HOLD: keep the line with the handset down |
| `dial({ id, digits, mode })` | Dial `digits` (0-9 * #) as DTMF or `'PULSE'`. Done when the last digit has gone |
| `monitor(level)` | The monitor speaker on the line: 0 off, 1-3 |
| event `{ dev: 'ncu', ev: 'handset', off }` | The handset's hook switch |
| event `{ dev: 'ncu', ev: 'ring', on, count, pattern }` | Ringing current detected (`pattern`: `'normal'` or `'distinctive'`) |
| event `{ dev: 'ncu', ev: 'callerId', number, name }` | Caller ID data after the first ring |
| event `{ dev: 'ncu', ev: 'progress', signal, text?, samples? }` | What the call-progress detector hears: `'dialtone'`, `'ringback'`, `'busy'`, `'reorder'`, `'answer'`, `'voice'` (with the words and samples, for the host to play) |
| event `{ dev: 'ncu', ev: 'released' }` | The far end has hung up (loop current interruption, or reorder after a call) |
| event `{ dev: 'ncu', ev: 'ext', off }` | An extension or answering machine on the EXT jack went off or on hook |

## line: the modem

| Member | Meaning |
|---|---|
| `port()` | The modem port of `src/fax/t30/endpoint.js` (`listen`, `sendV21`, `sendTone`, `sendHighSpeed`, `setHighSpeedRx`). One stable object for the machine's life; sends while no call is through go nowhere. The host gives an `AudioModemPort` on its exchange line; the tests give the switchboard's port over an ideal bit pipe |
| `trainingSeconds(rate)` | Optional: the training sequence's length at `rate`, for pacing |

The firmware also listens to the port's tones directly while TEL/FAX or A.M. mode waits for CNG.

## lcd, beeper, keys

| Member | Meaning |
|---|---|
| `lcd.show(text, { cursor })` | 16 characters (`panel.js`'s set), `cursor` a column or null |
| `beeper.beep(kind)` | `'key'`, `'error'`, `'end'` (end of a call) |
| `beeper.ring(on, { volume, pattern, sample })` | The ringer: `pattern` `'pseudo'` for TEL/FAX's pseudo ring; `sample` a short ring after VOLUME |
| `keys` | Key events arrive as `{ dev: 'keys', ev: 'down', key }` with `panel.js`'s names: `0-9 * #`, `A-E` (E is E/POLL), `SPEED_DIAL REDIAL HOLD_SEARCH SPEAKER VOLUME FUNCTION RESOLUTION START STOP COPY_HELP`. The object itself may offer `isDown(key)`; the firmware does not need it |

## storage

`{ load(key) -> value | null, save(key, value) }`, synchronous (the kit preloads IndexedDB or uses localStorage).
Keys `faxfo70.settings` and `faxfo70.journal`, JSON values. `setup.js`'s `MemoryStorage` is the Node one.
