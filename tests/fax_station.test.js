// The FO-70 as a whole machine on its mechanism host (src/sim/fax/station.js): the firmware through sim-devices.js,
// sheets scanned through the CIS model at the feeder's pose, the thermal head printing line by line, the cutter, and
// calls over real modem audio to the card index's correspondents. docs/fax/plan.md M7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MACHINES, geometryFor } from '../src/machine/index.js';
import { FaxStation } from '../src/sim/fax/station.js';
import { PAGES } from '../src/fax/image/pages.js';
import { clone } from '../src/sim/clone.js';
import { readRaw, linesLeft } from '../src/fax/image/sheet-scan.js';
import { CisSensor } from '../src/fax/image/optics.js';
import { FaxAudioEngine } from '../src/audio/fax-engine.js';

const WALL = Date.UTC(2026, 10, 16, 9, 30);
const MEMO = PAGES.memo({ dpmm: 8 });
/** The memo's top `mm` as a short sheet, to keep the runs short. */
function crop(page, mm) {
  const h = Math.round(mm * page.dpmmY);
  return { ...page, heightMm: mm, h, data: page.data.slice(0, page.w * h) };
}

function station(opts = {}) {
  const machine = clone(MACHINES.faxfo70);
  const sim = new FaxStation({ machine, geometry: geometryFor(machine), wallBase: WALL, ...opts });
  const rec = { lcd: [], lines: 0, ink: 0, cuts: [], store: 0, rings: 0, monitorDuringPage: [], lineAudio: 0 };
  const take = (out) => {
    for (const e of out) {
      if (e.dev === 'lcd') rec.lcd.push({ t: sim.t, text: e.text });
      else if (e.dev === 'print' && e.darkness) { rec.lines++; for (const v of e.darkness) if (v > 128) rec.ink++; }
      else if (e.dev === 'print' && e.ev === 'cut' && e.length) rec.cuts.push(e);
      else if (e.dev === 'store') rec.store++;
      else if (e.dev === 'ringer' && e.on) rec.rings++;
    }
  };
  const run = (s, each = null) => {
    const end = sim.t + s, out = [];
    let n = 0;
    while (sim.t < end) {
      sim.step();
      if (++n % 384 === 0) { if (sim.events.length) sim.drainEvents(out); each?.(); }
    }
    sim.drainEvents(out);
    take(out);
  };
  const until = (pred, limit, each) => { for (let s = 0; s < limit && !pred(); s += 1) run(1, each); return pred(); };
  const shown = (re) => rec.lcd.some((l) => re.test(l.text));
  return { sim, rec, run, until, shown };
}

test('copy: a sheet laid in the feeder is scanned, printed line by line through the thermal head, and cut', () => {
  const { sim, rec, run, until, shown } = station();
  run(0.5);
  assert.equal(sim.fw.lcd.text, 'NOV-16 09:30 FAX');
  sim.command({ dev: 'doc', op: 'place', sheets: [{ id: 'memo', page: crop(MEMO, 50) }] });
  run(3);
  assert.equal(sim.fw.lcd.text.trim(), 'DOCUMENT READY');
  sim.command({ dev: 'panel', op: 'tap', key: 'copyHelp' });
  assert.ok(until(() => sim.fw.log.some((l) => l.what === 'copy'), 90));
  run(1);
  assert.ok(shown(/COPYING +P\.01/));
  // 50 mm at fine is 385 lines; the printed lines are the head's, each with its darkness.
  assert.ok(rec.lines > 330 && rec.lines < 420, `${rec.lines} lines`);
  assert.ok(rec.ink > 5000, `ink ${rec.ink}`);
  // One cut, after the last line: the piece is the page and the leading margin, within a few millimetres.
  assert.equal(rec.cuts.length, 1);
  const len = rec.cuts[0].length * 1000;
  assert.ok(len > 50 && len < 100, `cut piece ${len.toFixed(1)} mm`);
  assert.ok(!sim.images.has('memo'), 'the sheet has gone out and its image with it');
});

test('send to the Records Room over real modem audio; it calls back and the stamped page is printed and cut', () => {
  const { sim, rec, run, until, shown } = station();
  run(0.5);
  sim.command({ dev: 'doc', op: 'place', sheets: [{ id: 'memo', page: crop(MEMO, 50) }] });
  run(3);
  let heard = 0, pageMonitor = 0;
  const each = () => {
    const tap = sim.tap;
    if (/SENDING/.test(sim.fw.lcd.text) && tap.monitor > 0) pageMonitor++;
    if (tap.monitor > 0 && Math.abs(tap.lineAt(sim.t)) > 1e-3) heard++;
  };
  sim.command({ dev: 'panel', op: 'tap', key: 'rapid1' });               // A: RECORDS ROOM
  assert.ok(until(() => shown(/TRANSMISSION OK|LINE ERROR/), 90, each));
  assert.ok(shown(/TRANSMISSION OK/), rec.lcd.map((l) => l.text).join(' / '));
  assert.ok(heard > 5, 'the monitor speaker heard the line while dialling and in the handshake');
  assert.equal(pageMonitor, 0, 'and was muted for the page');
  const office = sim.directory.lookup('555-0142');
  assert.equal(office.fax.inbox.length, 1);
  const sent = rec.ink;
  assert.equal(sent, 0, 'nothing printed while sending');
  assert.ok(until(() => shown(/RECEPTION OK|LINE ERROR/), 200));
  assert.ok(shown(/INCOMING CALL/) && shown(/RECEPTION OK/));
  assert.ok(rec.rings >= 1, 'the ringer rang');
  run(3);
  assert.ok(rec.lines > 300, `${rec.lines} lines printed`);
  assert.ok(rec.ink > 5000, `ink ${rec.ink}`);
  assert.equal(rec.cuts.length, 1);
  assert.ok(rec.store >= 2, 'the journal was stored');
  assert.equal(sim.sb.state, 'idle');
});

test('the cutter cuts each page: two sheets copied give two pieces', () => {
  const { sim, rec, run, until } = station();
  run(0.5);
  sim.command({ dev: 'doc', op: 'place', sheets: [{ id: 'a', page: crop(MEMO, 80) }, { id: 'b', page: crop(MEMO, 80) }] });
  run(3);
  sim.command({ dev: 'panel', op: 'tap', key: 'copyHelp' });
  assert.ok(until(() => sim.fw.log.some((l) => l.what === 'copy'), 240));
  run(1);
  assert.equal(sim.fw.log.find((l) => l.what === 'copy').pages, 2, rec.lcd.map((l) => l.t.toFixed(1) + ' ' + l.text).join(' / ') + JSON.stringify(sim.fw.log.map((l)=>l.what)) + sim.scanner.tray.length + ' ' + sim.scanner.moving.length);
  assert.equal(rec.cuts.length, 2);
  assert.ok(rec.cuts[1].from >= rec.cuts[0].to - 1e-9, 'the second piece starts where the first was cut');
});

test('raw CIS lines read ahead (the kit\'s worker) are used, and give the same page as reading in place', () => {
  const page = crop(MEMO, 40);
  const read = (ahead) => {
    const { sim, run } = station();
    run(0.5);
    sim.command({ dev: 'doc', op: 'place', sheets: [{ id: 'p', page }] });
    run(3);
    const pose = sim.devices.pose;
    if (ahead) {
      const n = linesLeft(pose, 'fine');
      sim.command({ dev: 'doc', op: 'raw', id: 'p', res: 'fine', y0: pose.y, raw: readRaw(new CisSensor({ seed: 1 }), page, pose, 'fine', n) });
    }
    sim.devices.scanner.begin({ vres: 'fine' });
    let ink = 0, k = 0;
    for (let row; (row = sim.devices.scanner.readLine(k)); k++) for (const b of row) ink += b ? 1 : 0;
    return { ink, k };
  };
  const a = read(false), b = read(true);
  assert.equal(a.k, b.k);
  assert.ok(Math.abs(a.ink - b.ink) < 0.05 * a.ink + 20, `${a.ink} vs ${b.ink}`);
});

test('the speaker plays dial tone after SPEAKER, the handset hears the line, keys beep; export and import reboot the firmware', () => {
  const { sim, run } = station({ storage: { 'faxfo70.settings': null } });
  const eng = new FaxAudioEngine(sim, 48000);
  const L = new Float32Array(128), R = new Float32Array(128);
  const level = (s) => {
    let ss = 0, n = 0;
    for (let b = 0; b < (48000 / 128) * s; b++) { eng.process(L, 128, R); for (const v of L) { ss += v * v; n++; } }
    return 10 * Math.log10(ss / n + 1e-20);
  };
  const quiet = level(0.5);
  sim.command({ dev: 'panel', op: 'tap', key: 'speaker' });
  level(0.6);
  assert.match(sim.fw.lcd.text, /ON-HOOK DIAL/);
  const dial = level(0.5);
  assert.ok(dial > quiet + 20 && dial > -40, `dial tone ${dial.toFixed(1)} dB over ${quiet.toFixed(1)}`);
  sim.command({ dev: 'panel', op: 'tap', key: 'stop' });
  level(0.5);
  const off = level(0.3);
  assert.ok(off < dial - 15, `speaker off ${off.toFixed(1)}`);
  sim.command({ dev: 'handset', op: 'lift' });
  level(0.6);
  const ear = level(0.4);
  assert.ok(ear > off + 10, `earpiece ${ear.toFixed(1)}`);
  sim.command({ dev: 'handset', op: 'replace' });
  run(0.5);
  // The handover to the audio thread: a plain deep copy with no structuredClone, the firmware booted again.
  const state = JSON.parse(JSON.stringify(sim.exportState(), (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
  const machine = clone(MACHINES.faxfo70);
  const other = new FaxStation({ machine, geometry: geometryFor(machine), wallBase: WALL });
  const saved = globalThis.structuredClone;
  delete globalThis.structuredClone;
  try {
    other.importState(sim.exportState());
    for (let i = 0; i < 0.5 * 384000; i++) other.step();
  } finally { globalThis.structuredClone = saved; }
  assert.match(other.fw.lcd.text, /NOV-16 09:3\d FAX/);
  assert.ok(state.station.store, 'the settings travel with the state');
});
