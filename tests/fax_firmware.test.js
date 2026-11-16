// The Sharp FO-70's firmware (src/fax/firmware/) and the correspondents (src/fax/remote/), driven by keystroke
// scripts on virtual devices over the ideal transport (one test over real modem audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, press, untilLcd, testSheet, TEST_WALL } from '../src/fax/firmware/testkit.js';
import { MESSAGES, ERRORS, noteFor, commCode } from '../src/fax/firmware/messages.js';
import { lcdText, LCD_COLUMNS, KEYS } from '../src/fax/firmware/panel.js';
import { MemoryStorage, STORAGE_KEY } from '../src/fax/firmware/setup.js';
import { inkOf } from '../src/fax/firmware/page.js';
import { CARDS } from '../src/fax/remote/directory.js';
import { infoSheet, replyNote, stampRaster } from '../src/fax/remote/documents/index.js';
import { voiceSamples } from '../src/fax/remote/voice.js';
import { Raster, COLUMNS } from '../src/fax/firmware/chargen.js';

const last = (fw, kind) => fw.journal.filter((e) => !kind || e.kind === kind).at(-1);
const shown = (fw, re) => fw.lcd.history.some((h) => re.test(h.text));

test('the LCD message table: 16 characters at most, in the LCD set, each marked', () => {
  for (const [id, m] of Object.entries(MESSAGES)) {
    assert.ok(m.text.length <= LCD_COLUMNS, `${id} is ${m.text.length} characters`);
    assert.equal(lcdText(m.text).trimEnd(), m.text, `${id} has characters the LCD lacks`);
    assert.ok(m.mark === 'A' || (m.mark === 'S' && /^(OM|SM) p\./.test(m.page)), id);
  }
  for (const e of Object.values(ERRORS)) if (e.lcd) assert.ok(MESSAGES[e.lcd], e.lcd);
  // The operation manual's display messages (OM p.90-91), word for word.
  for (const t of ['CHECK PAPER', 'COVER OPEN', 'DOCUMENT JAMMED', 'FUNCTION MODE', 'HOLD', 'LINE BUSY', 'LINE ERROR', 'NO DATA',
    'NO # STORED', 'OFF HOOK', 'ON HOOK DIAL', 'OUT OF PAPER', 'OVER HEAT', 'PAPER JAMMED', 'READY TO SEND', 'RECALLING',
    'SEARCH DIAL', 'TOTAL PAGE(S)']) assert.ok(Object.values(MESSAGES).some((m) => m.text === t && m.mark === 'S'), t);
  // The communication error codes (SM p.2-19) as the transaction report prints them (OM p.51).
  assert.equal(noteFor({ result: 'OK' }), 'OK');
  assert.equal(noteFor({ result: 'NO_RESPONSE', code: commCode('TX', { reason: 'no-response', lastRx: 'DIS' }) }), 'COM.E-1');
  assert.equal(commCode('TX', { reason: 'remote-dcn', lastRx: 'DCN' }), 7);
  assert.equal(commCode('TX', { reason: 'page-rejected', lastRx: 'RTN' }), 6);
  assert.equal(commCode('RX', { reason: 'T2', lastRx: 'MPS' }), 5);
  assert.equal(commCode('RX', { reason: 'T2', lastRx: 'BAD' }), 0);
  assert.equal(noteFor({ result: 'STOPPED' }), 'CANCEL');
  assert.equal(noteFor({ result: 'PAPER' }), 'NO PAPER');
  assert.equal(noteFor({ result: 'DOC_JAM' }), 'JAM');
  assert.equal(KEYS.length, 27);
});

test('warm start: the real date and time and the reception mode on the LCD, the desk programmed', () => {
  const { fw } = boot();
  // "05-NOV 10:30" and the arrow to FAX (OM p.28).
  assert.equal(fw.lcd.text, '16-NOV 09:30   ▲');
  assert.ok(fw.lcd.history.some((h) => h.text.trim() === 'WAIT A MOMENT'), 'power on (SM p.7-2)');
  fw.runFor(61);
  assert.equal(fw.lcd.text, '16-NOV 09:31   ▲');
  assert.equal(fw.settings.speed[0].number, '555-0142');
  assert.equal(fw.settings.ownNumber, '+1 555 0100');
});

test('send a page to the Records Room; a minute later it calls back with the page, stamped', () => {
  const { fw, devices, dir } = boot();
  const sheet = testSheet({ seed: 2 });
  devices.insertDocument([sheet]);
  fw.runFor(2);
  assert.equal(fw.lcd.text.trim(), 'READY TO SEND');
  press(fw, 'A');
  assert.ok(untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TOTAL PAGE\(S\) 01/);
  assert.ok(shown(fw, /^RECORDS ROOM/) && shown(fw, /SENDING +P\.01/));
  const tx = last(fw, 'TX');
  assert.equal(tx.result, 'OK');
  assert.equal(tx.pages, 1);
  assert.equal(tx.remote, '+1 555 0142');
  // The feed was paced by the line: several feed commands spread over the page's time on the line.
  assert.ok(devices.log.feeds.length >= 2);
  const office = dir.lookup('555-0142');
  assert.equal(office.fax.inbox.length, 1);
  // The header line went with the page.
  assert.ok(inkOf(office.fax.inbox[0]) > inkOf({ rows: sheet.rows }) / 2);
  // The call back: rings, FAX mode answers on the second ring, prints, cuts.
  assert.ok(untilLcd(fw, /INCOMING CALL/, 120));
  assert.ok(untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TOTAL PAGE\(S\) 01/);
  const rx = last(fw, 'RX');
  assert.equal(rx.result, 'OK');
  assert.equal(rx.pages, 1);
  assert.equal(devices.output.length, 1);
  const page = devices.output[0];
  // The stamp is on it: more ink than the page that went out.
  assert.ok(inkOf(page) > inkOf(office.fax.inbox[0]) * 0.5 + 2000, `ink ${inkOf(page)}`);
  assert.equal(devices.sb.state, 'idle');
});

test('busy: LINE BUSY, then automatic redial twice at five minutes; the taxi office answers on the third try', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'SPEED 07');
  assert.equal(fw.lcd.text.trim(), 'TAXI OFFICE');
  press(fw, 'START');
  assert.ok(untilLcd(fw, /LINE BUSY/, 30));
  assert.ok(untilLcd(fw, /RECALLING/, 10));
  assert.ok(untilLcd(fw, /TOTAL PAGE\(S\) 01/, 700));
  assert.equal(devices.log.dials.length, 3);
  const gap = devices.log.dials[2].t - devices.log.dials[1].t;
  assert.ok(gap > 300 && gap < 320, `redial interval ${gap}`);
  assert.equal(last(fw, 'TX').result, 'OK');
  assert.equal(fw.journal.length, 1);
});

test('always busy: three tries, then LINE BUSY and the transaction report prints', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'SPEED 06 START');
  fw.runFor(700);
  assert.equal(devices.log.dials.length, 3);
  assert.equal(last(fw, 'TX').result, 'BUSY');
  assert.match(fw.lcd.text, /LINE BUSY/);
  assert.equal(devices.output.length, 1, 'the transmission report (TRANS. REPORT: ERROR)');
  assert.ok(fw.log.some((l) => l.what === 'print' && l.kind === 'transaction'));
  press(fw, 'STOP');                               // clears the message; the document stays
  assert.equal(fw.lcd.text.trim(), 'READY TO SEND');
});

test('TEL/FAX mode: a voice call pseudo-rings the handset; a fax call is received', () => {
  const { fw, devices, sb, dir } = boot();
  press(fw, 'RES');                                // FAX -> TEL/FAX (OM p.28)
  assert.equal(fw.settings.rxMode, 'TEL/FAX');
  fw.runFor(3);
  assert.equal(fw.lcd.text[13], '▼', 'the arrow points down to TEL/FAX');
  // A person calls.
  const person = dir.caller();
  assert.ok(sb.callIn(person));
  assert.ok(untilLcd(fw, /PICK UP HANDSET/, 30));
  assert.ok(devices.log.rings.some((r) => r.pattern === 'pseudo' && r.on));
  devices.liftHandset();
  fw.runFor(5);
  assert.match(fw.lcd.text, /TELEPHONE/);
  assert.ok(sb.log.some((l) => l.what === 'progress' && l.signal === 'voice' && /hello/.test(l.text)));
  devices.replaceHandset();
  fw.runFor(10);
  assert.equal(fw.journal.length, 0, 'a voice call is not a reception');
  // A fax machine calls.
  const sender = dir.sender([testSheet({ seed: 3 })]);
  const mark = fw.lcd.history.length;
  assert.ok(sb.callIn(sender));
  assert.ok(untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TOTAL PAGE\(S\) 01/);
  assert.ok(!fw.lcd.history.slice(mark).some((h) => /PICK UP/.test(h.text)), 'CNG heard before any pseudo ring');
  assert.equal(devices.output.length, 1);
  assert.equal(last(fw, 'RX').pages, 1);
});

test('polling: POLLING set to YES, SPEED DIAL and the number of the information line, E/POLL; the day\'s sheet prints', () => {
  const { fw, devices } = boot();
  press(fw, 'FUNCTION 4 * *');                     // POLLING (OM p.79)
  assert.match(fw.lcd.text, /POLLING|1=YES,2=NO/);
  press(fw, '1 STOP');
  assert.equal(fw.settings.pollingKey, true);
  press(fw, 'SPEED 02');
  press(fw, 'POLL');
  assert.ok(untilLcd(fw, /POLLING/, 5));
  assert.ok(untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 200));
  assert.match(fw.lcd.text, /TOTAL PAGE\(S\) 01/);
  const e = last(fw, 'POLL');
  assert.equal(e.result, 'OK');
  assert.equal(e.remote, '+1 555 0167');
  assert.equal(devices.output.length, 1);
  assert.ok(devices.output[0].height > 2000, 'a letter-size sheet');
  assert.ok(inkOf(devices.output[0]) > 50000);
});

test('copy: two sheets scanned and printed in blocks, each cut', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet({ seed: 1 }), testSheet({ seed: 2, height: 300 })]);
  fw.runFor(2);
  press(fw, 'COPY');
  assert.ok(untilLcd(fw, /COPYING +P\.01/, 5));
  fw.runFor(60);
  assert.equal(devices.output.length, 2);
  assert.deepEqual(devices.output.map((p) => p.height), [240, 300]);
  assert.deepEqual(devices.output[0].rows, testSheet({ seed: 1 }).rows);
  assert.ok(shown(fw, /TOTAL PAGE\(S\) 02/));
  assert.match(fw.lcd.text, /16-NOV/);
  assert.ok(devices.log.feeds.length >= 4);
});

test('out of paper during a reception: the call ends, OUT OF PAPER, NO PAPER on the report; no paper, no answer', () => {
  const { fw, devices, sb, dir } = boot({ paperMm: 20 });
  const sender = dir.sender([testSheet({ height: 400 }), testSheet({ height: 400, seed: 2 })]);
  assert.ok(sb.callIn(sender));
  fw.runFor(50);
  assert.equal(fw.lcd.text.trim(), 'OUT OF PAPER');
  const e = last(fw, 'RX');
  assert.equal(e.result, 'PAPER');
  assert.equal(noteFor(e), 'NO PAPER');
  assert.ok(!sender.sent.at(-1).result.ok, 'the sender did not finish');
  assert.equal(sb.state, 'idle');
  assert.equal(devices.output.length, 0, 'the part page stays on the roll, uncut');
  // The sender tries again a minute later: the machine rings but does not answer.
  fw.runFor(120);
  assert.ok(sb.calls.filter((c) => c.direction === 'out').length >= 2);
  assert.equal(fw.journal.length, 1);
  devices.loadPaper();
  fw.runFor(1);
  assert.doesNotMatch(fw.lcd.text, /OUT OF PAPER/);
});

test('STOP in the middle of a call: DCN between signals; during a page the line is let go', () => {
  {
    const { fw, devices, dir } = boot();
    devices.insertDocument([testSheet()]);
    fw.runFor(2);
    press(fw, 'A');
    fw.runFor(13);                                   // answered: the office's CED is going
    assert.match(fw.lcd.text, /RECORDS ROOM/);
    press(fw, 'STOP');
    fw.runFor(10);
    assert.equal(last(fw, 'TX').result, 'STOPPED');
    assert.equal(devices.sb.state, 'idle');
    const call = dir.lookup('555-0142').fax.calls[0];
    assert.ok(call.station.log.some((l) => l.what === 'rx' && l.frames.includes('DCN')), 'the office heard DCN');
    assert.equal(devices.feeder.status().loaded, true, 'the document was not sent: it stays');
  }
  {
    const { fw, devices, dir } = boot();
    devices.insertDocument([testSheet({ height: 1600 })]);
    fw.runFor(2);
    press(fw, 'A');
    assert.ok(untilLcd(fw, /SENDING/, 60));
    fw.runFor(2);
    press(fw, 'STOP');
    fw.runFor(3);
    assert.equal(last(fw, 'TX').result, 'STOPPED');
    assert.equal(devices.sb.state, 'idle');
    assert.equal(dir.lookup('555-0142').fax.calls[0].result.ok, false);
    fw.runFor(120);
    assert.equal(fw.journal.filter((e) => e.kind === 'RX').length, 0, 'nothing comes back');
    assert.equal(noteFor(last(fw, 'TX')), 'CANCEL');
    assert.match(fw.lcd.text, /16-NOV/, 'the half-sent sheet was fed out');
  }
});

test('STOP while dialling and STOP in the menu', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, '555');
  press(fw, 'STOP STOP');                          // STOP backspaces a keyed number (OM p.47)
  assert.equal(fw.lcd.text.trim(), '5');
  press(fw, 'STOP STOP');
  assert.equal(fw.lcd.text.trim(), 'READY TO SEND');
  press(fw, 'FUNCTION');
  assert.equal(fw.lcd.text.trim(), 'FUNCTION MODE');
  press(fw, 'STOP');
  assert.equal(fw.lcd.text.trim(), 'READY TO SEND');
  press(fw, 'STOP');                               // STOP in standby ejects the document
  fw.runFor(2);
  assert.match(fw.lcd.text, /16-NOV/);
  assert.equal(devices.feeder.status().docPresent, false);
});

test('every report and list prints', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'A');
  untilLcd(fw, /TOTAL PAGE\(S\) 01/, 120);
  fw.runUntil(() => last(fw, 'RX'), 300);          // the Records Room's call back, out of the way
  fw.runFor(5);
  const before = devices.output.length;
  press(fw, 'FUNCTION 2 # START');                 // LISTING MODE: the Telephone Number List (OM p.81)
  fw.runFor(30);
  press(fw, 'FUNCTION 2 * START');                 // and the Anti Junk Number List
  fw.runFor(30);
  press(fw, 'HELP');
  fw.runFor(30);
  press(fw, 'FUNCTION 4 # # #');                   // TRANSACTION LIST (OM p.50): 1 ALWAYS PRINT
  assert.match(fw.lcd.text, /TRANSACTION LIST|ENTER \(1-4\)/);
  press(fw, '1 STOP');
  assert.equal(fw.settings.report, 'ALWAYS');
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'COPY');
  fw.runFor(30);
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'C');                                  // a send, and its report
  untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 120);
  fw.runFor(30);
  const printed = devices.output.slice(before);
  const kinds = fw.log.filter((l) => l.what === 'print').map((l) => l.kind);
  for (const k of ['tel', 'junk', 'help', 'transaction']) assert.ok(kinds.includes(k), k);
  assert.ok(printed.length >= 4);
  for (const p of printed) assert.ok(inkOf(p) > 3000 && p.height > 200, `${p.height} rows`);
});

test('setup persists: own number and name, a speed dial, an option, the reception mode', () => {
  const storage = new MemoryStorage();
  const { fw } = boot({ storage });
  press(fw, 'FUNCTION 3 # #');                     // ENTRY MODE, OWN NUMBER SET (OM p.20-21)
  assert.equal(fw.lcd.text.trim(), 'OWN NUMBER SET');
  press(fw, 'START');
  press(fw, 'SPEED*11 5550111 START');             // SPEED DIAL backspaces; a new number
  press(fw, 'SPEED*8 2*3 3*2 START');              // B (2 A B), D (3 D)
  assert.equal(fw.settings.ownNumber, '5550111');
  assert.equal(fw.settings.ownName, 'BD');
  press(fw, 'STOP FUNCTION 3 #');                  // FAX/TEL. # MODE, 1=SET (OM p.41)
  press(fw, '1 12 5550177 START 6*2 SPEAKER 6*3 START STOP');
  assert.deepEqual(fw.settings.speed[11], { number: '5550177', name: 'MN' });
  press(fw, 'FUNCTION 4 #');                       // NUMBER OF RINGS, ENTER (2-5) (2) (OM p.54)
  assert.match(fw.lcd.text, /NUMBER OF RINGS|ENTER \(2-5\) \(2\)/);
  press(fw, '4');
  assert.match(fw.lcd.text, /TEL\/FAX REMOTE #|ENTER/, 'on to the next option');
  press(fw, 'STOP');
  assert.equal(fw.settings.rings, 4);
  press(fw, 'RES');
  assert.equal(fw.settings.rxMode, 'TEL/FAX');
  assert.ok(storage.load(STORAGE_KEY));
  const again = boot({ storage });
  assert.equal(again.fw.settings.ownNumber, '5550111');
  assert.deepEqual(again.fw.settings.speed[11], { number: '5550177', name: 'MN' });
  assert.equal(again.fw.settings.rings, 4);
  assert.equal(again.fw.lcd.text[13], '▼');
});

test('name entry: each key gives its digit, then its letters; SPEAKER moves on, REDIAL changes case (OM p.22)', () => {
  const { fw } = boot();
  press(fw, 'FUNCTION 3 # # START START');
  press(fw, 'SPEED*8 4*3 3*3 5*4 SPEAKER 5*4 6*4 1*2 REDIAL 7*5 START');
  assert.equal(fw.settings.ownName, 'HELLO s');
});

test('the clock is set from the menu; a cold start asks for it', () => {
  const { fw } = boot({ cold: true });
  assert.ok(fw.lcd.history.some((h) => /DATE & TIME SET/.test(h.text)) || (fw.runFor(4), shown(fw, /DATE & TIME SET/)));
  // FUNCTION 3 # # #, START, day, month, year, hour, minute, START, STOP (OM p.24-26).
  press(fw, 'FUNCTION 3 # # # START 2 5 1 2 1 9 9 9 2 3 5 9 START [1.5] STOP');
  assert.equal(fw.settings.clock.set, true);
  fw.runFor(3);
  assert.equal(fw.lcd.text, '25-DEC 23:59   ▲');
  fw.runFor(60);
  assert.equal(fw.lcd.text, '26-DEC 00:00   ▲');
  void TEST_WALL;
});

test('a bad long-distance line: training fails at 9600 and 7200, the page goes at 4800', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'E');
  assert.ok(untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 200));
  assert.equal(last(fw, 'TX').mode, 'G3 4800');
  assert.equal(last(fw, 'TX').result, 'OK');
});

test('far-end faults: out of paper (E-08), a dead number, no answer (T1, E-03), the own number busy', () => {
  const run = (script) => {
    const { fw, devices } = boot();
    devices.insertDocument([testSheet()]);
    fw.runFor(2);
    press(fw, script);
    fw.runFor(80);
    return fw;
  };
  let fw = run('SPEED 08 START');
  assert.equal(last(fw, 'TX').result, 'INCOMPAT');
  assert.equal(noteFor(last(fw, 'TX')), 'CANCEL');
  assert.equal(fw.lcd.text.trim(), 'LINE ERROR');
  // No answer: LINE BUSY, and the machine will redial (RECALLING, OM p.91).
  fw = run('SPEED 10 START');
  assert.ok(shown(fw, /LINE BUSY/) && fw.redial);
  fw = run('SPEED 09 START');
  assert.ok(shown(fw, /LINE BUSY/) && fw.redial);
  fw = run('5550100 START');
  assert.ok(shown(fw, /LINE BUSY/));
});

test('the handset: dial the front desk, a person answers "hello?"; SPEAKER dialling', () => {
  const { fw, devices, sb } = boot();
  devices.liftHandset();
  fw.runFor(1);
  assert.match(fw.lcd.text, /TELEPHONE/);
  press(fw, '5550123');
  fw.runFor(25);
  const voice = sb.log.filter((l) => l.what === 'progress' && l.signal === 'voice');
  assert.ok(voice.length >= 1);
  assert.ok(voice[0].samples instanceof Float32Array && voice[0].samples.length > 2000);
  devices.replaceHandset();
  fw.runFor(2);
  assert.match(fw.lcd.text, /16-NOV/);
  assert.equal(sb.state, 'idle');
  press(fw, 'SPEAKER');
  assert.match(fw.lcd.text, /ON HOOK DIAL/);
  assert.equal(devices.seized, true);
  press(fw, 'SPEAKER');
  assert.equal(devices.seized, false);
});

test('a manual send: handset, dial, hear the far machine, START, hang up', () => {
  const { fw, devices, dir } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  devices.liftHandset();
  fw.runFor(0.5);
  press(fw, '5550188');
  fw.runFor(20);
  press(fw, 'START');
  devices.replaceHandset();
  assert.ok(untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TOTAL PAGE\(S\) 01/);
  assert.equal(dir.lookup('555-0188').fax.inbox.length, 1);
  // The correspondent writes back in a few minutes.
  assert.ok(fw.runUntil(() => last(fw, 'RX'), 400));
  fw.runFor(30);
  assert.equal(devices.output.length, 1);
});

test('faults at the machine: DOCUMENT JAMMED and COVER OPEN', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet({ jam: true })]);
  fw.runFor(3);
  assert.equal(fw.lcd.text.trim(), 'DOCUMENT JAMMED');
  devices.removeDocument();
  fw.runFor(1);
  assert.match(fw.lcd.text, /16-NOV/);
  devices.openCover();
  fw.runFor(1);
  assert.equal(fw.lcd.text.trim(), 'COVER OPEN');
  devices.closeCover();
  fw.runFor(1);
  assert.match(fw.lcd.text, /16-NOV/);
});

test('fax blocking: a junk number\'s fax is cut off', () => {
  const { fw, devices, sb, dir } = boot();
  fw.settings.junk[0] = '555-0180';
  assert.ok(sb.callIn(dir.sender([testSheet()], { ident: '+1 555 0180' })));
  fw.runFor(90);
  assert.equal(last(fw, 'RX').result, 'BLOCKED');
  assert.equal(devices.output.length, 0);
});

test('the correspondents\' documents and the voice are drawn', () => {
  const info = infoSheet(TEST_WALL);
  assert.equal(info.height, 2151);
  assert.ok(inkOf(info) > 50000);
  assert.deepEqual(infoSheet(TEST_WALL).rows, info.rows, 'seeded');
  const note = replyNote({ pages: 2, wallMs: TEST_WALL, seed: 4 });
  assert.ok(inkOf(note) > 20000);
  assert.ok(stampRaster(TEST_WALL).ink > 5000);
  const v = voiceSamples('hello?');
  assert.ok(v.length > 0.4 * 8000 && Math.max(...v.map(Math.abs)) < 1);
  assert.equal(CARDS.filter((c) => /^555-01\d\d$/.test(c.number)).length, CARDS.length);
  const r = new Raster(40);
  r.text(0, 0, 'FO-70');
  assert.ok(r.ink > 50 && COLUMNS >= 80);
});

test('over real modem audio: a page to the Records Room on a typical line', () => {
  const { fw, devices, dir } = boot({ transport: 'audio' });
  devices.insertDocument([testSheet({ height: 120 })]);
  fw.runFor(2);
  press(fw, 'A');
  assert.ok(untilLcd(fw, /TOTAL PAGE|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TOTAL PAGE\(S\) 01/);
  assert.equal(dir.lookup('555-0142').fax.inbox.length, 1);
  assert.equal(dir.lookup('555-0142').fax.calls[0].result.reason, 'complete', 'the office heard DCN');
});

test('Caller ID shows the calling name and number between rings; Duplex Ringing answers only the fax cadence', () => {
  const { fw, sb, dir, devices } = boot();
  press(fw, 'RES RES RES');                        // FAX -> TEL/FAX -> A.M. -> TEL: the machine only rings
  fw.runFor(3);
  assert.equal(fw.settings.rxMode, 'TEL');
  press(fw, 'FUNCTION 4 * 1 STOP');                // CALLER-ID: YES (OM p.69)
  assert.equal(fw.settings.callerId, true);
  assert.ok(sb.callIn(dir.caller({ name: 'AUNT EDNA' })));
  fw.runFor(6);
  assert.ok(shown(fw, /AUNT EDNA/));
  fw.runFor(80);
  assert.equal(fw.journal.length, 0);
  assert.equal(fw.settings.callers.length, 1, 'the Caller ID list');
  // Duplex Ringing: the short cadence is a voice call and rings on; the long one is a fax, answered after two rings.
  press(fw, 'RES');                                // TEL -> FAX
  fw.runFor(3);
  assert.equal(fw.settings.rxMode, 'FAX');
  press(fw, 'FUNCTION 4 * * * * 1 STOP');          // DUPLEX RINGING: YES (OM p.75)
  assert.equal(fw.settings.duplex, true);
  assert.ok(sb.callIn(dir.sender([testSheet()]), { maxRings: 4 }));
  fw.runFor(40);
  assert.equal(fw.journal.length, 0);
  assert.ok(sb.callIn(dir.sender([testSheet()], { number: '555-0182' }), { pattern: 'distinctive' }));
  assert.ok(untilLcd(fw, /TOTAL PAGE\(S\) 01/, 120));
  assert.equal(devices.output.length, 1);
});

// ---- on the mechanism host (src/sim/fax/) through sim-devices.js -------------------------------------------------------

async function simMachine(opts = {}) {
  const { default: faxfo70 } = await import('../src/machine/faxfo70.js');
  const { geometryFor } = await import('../src/machine/index.js');
  const { FaxSim } = await import('../src/sim/fax/index.js');
  const { clone } = await import('../src/sim/clone.js');
  const { attachToSim } = await import('../src/fax/firmware/sim-devices.js');
  const machine = clone(faxfo70);
  const sim = new FaxSim({ machine, geometry: geometryFor(machine) });
  const { fw, devices } = attachToSim(sim, { options: { wallClockMs: TEST_WALL }, ...opts });
  const run = (s) => { const end = sim.t + s, out = []; while (sim.t < end) { sim.step(); if (sim.events.length) sim.drainEvents(out); } return out; };
  return { sim, fw, devices, run };
}

test('on the mechanism host: a sheet is drawn in and copied, line by line through the head, and cut', async () => {
  const bars = (pose) => { const r = new Uint8Array(216); if (Math.floor(pose.y * 1000) % 4 === 0) r.fill(0xff, 20, 100); return r; };
  const { sim, fw, run } = await simMachine({ sampleLine: bars });
  run(1.3);
  assert.equal(fw.lcd.text, '16-NOV 09:30   ▲');
  sim.command({ dev: 'feeder', op: 'load', sheets: [{ id: 's1', length: 0.035 }] });
  run(2.5);
  assert.equal(fw.lcd.text.trim(), 'READY TO SEND');
  sim.command({ dev: 'panel', op: 'finger', key: 'copyHelp', force: 2 });
  run(0.1);
  sim.command({ dev: 'panel', op: 'finger', key: 'copyHelp', force: 0 });
  let lines = 0, cuts = 0, dark = 0;
  for (let i = 0; i < 40 && !fw.log.some((l) => l.what === 'copy'); i++) {
    for (const e of run(0.5)) {
      if (e.dev === 'print' && e.darkness) { lines++; if (e.darkness[400] > 128) dark++; }
      if (e.dev === 'print' && e.ev === 'cut' && e.length) cuts++;
    }
  }
  assert.equal(fw.log.find((l) => l.what === 'copy')?.pages, 1, fw.lcd.history.map((h) => `${h.t.toFixed(2)} ${h.text}`).join(' / '));
  assert.ok(lines > 220 && lines < 290, `${lines} lines`);
  assert.ok(dark > lines / 6 && dark < lines / 2, `${dark} dark of ${lines}`);
  assert.equal(cuts, 1);
});

test('on the mechanism host: SPEAKER closes the line relay, the exchange sees the loop and gives dial tone', async () => {
  const { Switchboard } = await import('../src/fax/remote/switchboard.js');
  const { Directory } = await import('../src/fax/remote/directory.js');
  const { sim, fw, devices, run } = await simMachine();
  const dir = new Directory({ clock: fw.clock });
  const sb = new Switchboard({ clock: fw.clock, directory: dir });
  dir.attach(sb);
  devices.setLine(sb);
  run(1.2);
  assert.equal(sim.liu.lineLoop(), false);
  sim.command({ dev: 'panel', op: 'finger', key: 'speaker', force: 2 });
  run(0.05);
  sim.command({ dev: 'panel', op: 'finger', key: 'speaker', force: 0 });
  run(0.4);
  assert.match(fw.lcd.text, /ON HOOK DIAL/);
  assert.equal(sim.liu.lineLoop(), true);
  assert.ok(sb.log.some((l) => l.what === 'progress' && l.signal === 'dialtone'));
  sim.command({ dev: 'handset', op: 'lift' });
  run(0.3);
  assert.equal(fw.state.handset, true);
});
