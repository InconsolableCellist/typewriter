// The Sharp FO-70's firmware (src/fax/firmware/) and the correspondents (src/fax/remote/), driven by keystroke
// scripts on virtual devices over the ideal transport (one test over real modem audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, press, untilLcd, testSheet, TEST_WALL } from '../src/fax/firmware/testkit.js';
import { MESSAGES, ERRORS } from '../src/fax/firmware/messages.js';
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
    assert.ok(m.mark === 'S' || m.mark === 'A', id);
  }
  for (const e of Object.values(ERRORS)) if (e.lcd) assert.ok(MESSAGES[e.lcd], e.lcd);
  assert.equal(KEYS.length, 27);
});

test('warm start: the real date and time and the reception mode on the LCD, the desk programmed', () => {
  const { fw } = boot();
  assert.equal(fw.lcd.text, 'NOV-16 09:30 FAX');
  fw.runFor(61);
  assert.equal(fw.lcd.text, 'NOV-16 09:31 FAX');
  assert.equal(fw.settings.speed[0].number, '555-0142');
  assert.equal(fw.settings.ownNumber, '+1 555 0100');
});

test('send a page to the Records Room; a minute later it calls back with the page, stamped', () => {
  const { fw, devices, dir } = boot();
  const sheet = testSheet({ seed: 2 });
  devices.insertDocument([sheet]);
  fw.runFor(2);
  assert.equal(fw.lcd.text.trim(), 'DOCUMENT READY');
  press(fw, 'A');
  assert.ok(untilLcd(fw, /TRANSMISSION OK|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TRANSMISSION OK/);
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
  assert.ok(untilLcd(fw, /RECEPTION OK|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /RECEPTION OK/);
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
  assert.ok(untilLcd(fw, /REDIAL WAIT 4:5/, 10));
  assert.ok(untilLcd(fw, /TRANSMISSION OK/, 700));
  assert.equal(devices.log.dials.length, 3);
  const gap = devices.log.dials[2].t - devices.log.dials[1].t;
  assert.ok(gap > 300 && gap < 320, `redial interval ${gap}`);
  assert.equal(last(fw, 'TX').result, 'OK');
  assert.equal(fw.journal.length, 1);
});

test('always busy: three tries, then E-02 and the transmission report prints', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'SPEED 06 START');
  fw.runFor(700);
  assert.equal(devices.log.dials.length, 3);
  assert.equal(last(fw, 'TX').result, 'BUSY');
  assert.match(fw.lcd.text, /LINE BUSY/);
  assert.equal(devices.output.length, 1, 'the transmission report (TRANS. REPORT: ERROR)');
  assert.ok(fw.log.some((l) => l.what === 'print' && l.kind === 'transmission'));
  press(fw, 'STOP');                               // clears the message; the document stays
  assert.equal(fw.lcd.text.trim(), 'DOCUMENT READY');
});

test('TEL/FAX mode: a voice call pseudo-rings the handset; a fax call is received', () => {
  const { fw, devices, sb, dir } = boot();
  press(fw, 'RES RES');                            // FAX -> TEL -> TEL/FAX
  assert.equal(fw.settings.rxMode, 'TEL/FAX');
  fw.runFor(3);
  assert.match(fw.lcd.text, /T\/F$/);
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
  assert.ok(untilLcd(fw, /RECEPTION OK|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /RECEPTION OK/);
  assert.ok(!fw.lcd.history.slice(mark).some((h) => /PICK UP/.test(h.text)), 'CNG heard before any pseudo ring');
  assert.equal(devices.output.length, 1);
  assert.equal(last(fw, 'RX').pages, 1);
});

test('polling: E/POLL, the information line by its rapid key, START; the day\'s sheet prints', () => {
  const { fw, devices } = boot();
  press(fw, 'POLL');
  assert.match(fw.lcd.text, /POLLING/);
  press(fw, 'B START');
  assert.ok(untilLcd(fw, /RECEPTION OK|LINE ERROR/, 200));
  assert.match(fw.lcd.text, /RECEPTION OK/);
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
  assert.match(fw.lcd.text, /NOV-16/);
  assert.ok(devices.log.feeds.length >= 4);
});

test('out of paper during a reception: the call ends, CHECK PAPER, E-13; no paper, no answer', () => {
  const { fw, devices, sb, dir } = boot({ paperMm: 20 });
  const sender = dir.sender([testSheet({ height: 400 }), testSheet({ height: 400, seed: 2 })]);
  assert.ok(sb.callIn(sender));
  fw.runFor(50);
  assert.equal(fw.lcd.text.trim(), 'CHECK PAPER');
  const e = last(fw, 'RX');
  assert.equal(e.result, 'PAPER');
  assert.equal(ERRORS[e.result].code, 'E-13');
  assert.ok(!sender.sent.at(-1).result.ok, 'the sender did not finish');
  assert.equal(sb.state, 'idle');
  assert.equal(devices.output.length, 0, 'the part page stays on the roll, uncut');
  // The sender tries again a minute later: the machine rings but does not answer.
  fw.runFor(120);
  assert.ok(sb.calls.filter((c) => c.direction === 'out').length >= 2);
  assert.equal(fw.journal.length, 1);
  devices.loadPaper();
  fw.runFor(1);
  assert.doesNotMatch(fw.lcd.text, /CHECK PAPER/);
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
    assert.equal(devices.output.length, 0, 'nothing comes back');
    assert.match(fw.lcd.text, /NOV-16/, 'the half-sent sheet was fed out');
  }
});

test('STOP while dialling and STOP in the menu', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, '555');
  press(fw, 'STOP');
  assert.equal(fw.lcd.text.trim(), 'DOCUMENT READY');
  press(fw, 'FUNCTION FUNCTION STOP');
  assert.equal(fw.lcd.text.trim(), 'DOCUMENT READY');
  press(fw, 'STOP');                               // STOP in standby ejects the document
  fw.runFor(2);
  assert.match(fw.lcd.text, /NOV-16/);
  assert.equal(devices.feeder.status().docPresent, false);
});

test('every report and list prints', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'A');
  untilLcd(fw, /TRANSMISSION OK/, 120);
  untilLcd(fw, /RECEPTION OK/, 200);               // the Records Room's call back, out of the way
  fw.runFor(5);
  const before = devices.output.length;
  for (const n of ['1', '2', '3', '4', '5']) {
    press(fw, `FUNCTION 6 ${n}`);
    fw.runFor(30);
  }
  press(fw, 'HELP');
  fw.runFor(30);
  const printed = devices.output.slice(before);
  const kinds = fw.log.filter((l) => l.what === 'print').map((l) => l.kind);
  for (const k of ['tel', 'setup', 'activity', 'transmission', 'help']) assert.ok(kinds.includes(k), k);
  assert.ok(printed.length >= 6);
  for (const p of printed) assert.ok(inkOf(p) > 3000 && p.height > 200, `${p.height} rows`);
});

test('setup persists: own number and name, a speed dial, an option, the reception mode', () => {
  const storage = new MemoryStorage();
  const { fw } = boot({ storage });
  press(fw, 'FUNCTION 2');
  fw.runFor(2);
  press(fw, 'HOLD*11 5550111 START');              // clear the stored number, type a new one
  press(fw, 'HOLD*8 2*2 # 3 START');              // B, then D
  assert.equal(fw.settings.ownNumber, '5550111');
  assert.equal(fw.settings.ownName, 'BD');
  press(fw, 'STOP FUNCTION 3 12 5550177 START 6 # 6*2 START STOP');
  assert.deepEqual(fw.settings.speed[11], { number: '5550177', name: 'MN' });
  press(fw, 'FUNCTION 4 4 START STOP');            // # OF RINGS: 4
  assert.equal(fw.settings.rings, 4);
  press(fw, 'RES');
  assert.equal(fw.settings.rxMode, 'TEL');
  assert.ok(storage.load(STORAGE_KEY));
  const again = boot({ storage });
  assert.equal(again.fw.settings.ownNumber, '5550111');
  assert.deepEqual(again.fw.settings.speed[11], { number: '5550177', name: 'MN' });
  assert.equal(again.fw.settings.rings, 4);
  assert.match(again.fw.lcd.text, / TEL$/);
});

test('name entry cycles the keypad letters', () => {
  const { fw } = boot();
  press(fw, 'FUNCTION 2');
  fw.runFor(2);
  press(fw, 'START HOLD*8 4*2 3*2 5*3 # 5*3 6*3 START');
  assert.equal(fw.settings.ownName, 'HELLO');
});

test('the clock is set from the menu; a cold start asks for it', () => {
  const { fw } = boot({ cold: true });
  assert.ok(fw.lcd.history.some((h) => /SET DATE&TIME/.test(h.text)) || (fw.runFor(4), shown(fw, /SET DATE&TIME/)));
  press(fw, 'FUNCTION 1 1 2 2 5 1 9 9 9 2 3 5 9 START [1.5] STOP');
  assert.equal(fw.settings.clock.set, true);
  fw.runFor(3);
  assert.equal(fw.lcd.text, 'DEC-25 23:59 FAX');
  fw.runFor(60);
  assert.equal(fw.lcd.text, 'DEC-26 00:00 FAX');
  void TEST_WALL;
});

test('a bad long-distance line: training fails at 9600 and 7200, the page goes at 4800', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet()]);
  fw.runFor(2);
  press(fw, 'E');
  assert.ok(untilLcd(fw, /TRANSMISSION OK|LINE ERROR/, 200));
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
  assert.equal(fw.lcd.text.trim(), 'LINE ERROR');
  fw = run('SPEED 10 START');
  assert.equal(last(fw, 'TX').result, 'NO_ANSWER');
  fw = run('SPEED 09 START');
  assert.equal(last(fw, 'TX').result, 'NO_ANSWER');
  assert.ok(last(fw, 'TX').durationS > 34);
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
  assert.match(fw.lcd.text, /NOV-16/);
  assert.equal(sb.state, 'idle');
  press(fw, 'SPEAKER');
  assert.match(fw.lcd.text, /ON-HOOK DIAL/);
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
  assert.ok(untilLcd(fw, /TRANSMISSION OK|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TRANSMISSION OK/);
  assert.equal(dir.lookup('555-0188').fax.inbox.length, 1);
  // The correspondent writes back in a few minutes.
  assert.ok(untilLcd(fw, /RECEPTION OK/, 400));
  assert.equal(devices.output.length, 1);
});

test('faults at the machine: DOCUMENT JAMMED and COVER OPEN', () => {
  const { fw, devices } = boot();
  devices.insertDocument([testSheet({ jam: true })]);
  fw.runFor(3);
  assert.equal(fw.lcd.text.trim(), 'DOCUMENT JAMMED');
  devices.removeDocument();
  fw.runFor(1);
  assert.match(fw.lcd.text, /NOV-16/);
  devices.openCover();
  fw.runFor(1);
  assert.equal(fw.lcd.text.trim(), 'COVER OPEN');
  devices.closeCover();
  fw.runFor(1);
  assert.match(fw.lcd.text, /NOV-16/);
});

test('fax blocking: a junk number\'s fax is cut off', () => {
  const { fw, devices, sb, dir } = boot();
  fw.settings.blocking = true;
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
  assert.ok(untilLcd(fw, /TRANSMISSION OK|LINE ERROR/, 120));
  assert.match(fw.lcd.text, /TRANSMISSION OK/);
  assert.equal(dir.lookup('555-0142').fax.inbox.length, 1);
  assert.equal(dir.lookup('555-0142').fax.calls[0].result.reason, 'complete', 'the office heard DCN');
});

test('Caller ID shows the calling name between rings; Distinctive Ring answers only its own pattern', () => {
  const { fw, sb, dir, devices } = boot();
  press(fw, 'RES');                                // TEL: the machine only rings
  fw.runFor(3);
  fw.settings.callerId = true;
  assert.ok(sb.callIn(dir.caller({ name: 'AUNT EDNA' })));
  fw.runFor(4);
  assert.equal(fw.lcd.text.trim(), 'AUNT EDNA');
  fw.runFor(80);
  assert.equal(fw.journal.length, 0);
  // FAX mode with Distinctive Ring: a call on the normal pattern is left to ring; the distinctive one is answered.
  press(fw, 'RES RES RES');                        // TEL -> TEL/FAX -> A.M. -> FAX
  fw.runFor(3);
  assert.equal(fw.settings.rxMode, 'FAX');
  fw.settings.distinctive = true;
  assert.ok(sb.callIn(dir.sender([testSheet()]), { maxRings: 4 }));
  fw.runFor(40);
  assert.equal(fw.journal.length, 0);
  assert.ok(sb.callIn(dir.sender([testSheet()], { number: '555-0182' }), { pattern: 'distinctive' }));
  assert.ok(untilLcd(fw, /RECEPTION OK/, 120));
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
  run(0.3);
  assert.equal(fw.lcd.text, 'NOV-16 09:30 FAX');
  sim.command({ dev: 'feeder', op: 'load', sheets: [{ id: 's1', length: 0.035 }] });
  run(2.5);
  assert.equal(fw.lcd.text.trim(), 'DOCUMENT READY');
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
  run(0.2);
  assert.equal(sim.liu.lineLoop(), false);
  sim.command({ dev: 'panel', op: 'finger', key: 'speaker', force: 2 });
  run(0.05);
  sim.command({ dev: 'panel', op: 'finger', key: 'speaker', force: 0 });
  run(0.4);
  assert.match(fw.lcd.text, /ON-HOOK DIAL/);
  assert.equal(sim.liu.lineLoop(), true);
  assert.ok(sb.log.some((l) => l.what === 'progress' && l.signal === 'dialtone'));
  sim.command({ dev: 'handset', op: 'lift' });
  run(0.3);
  assert.equal(fw.state.handset, true);
});
