// The FO-70's mechanism host (docs/fax/architecture.md 3; plan 7.3 item 9): a sheet fed past the document sensors, the
// paper fed a line at a time at the three documented pitches, a cutter cycle, the hook switch and the relays, the
// panel keys, the state carried across a handover without structuredClone, and the rule that a controller only
// switches phases and coils and reads sensors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import faxfo70 from '../src/machine/faxfo70.js';
import { geometryFor } from '../src/machine/index.js';
import { createMechanism } from '../src/sim/host-factory.js';
import { FaxSim } from '../src/sim/fax/index.js';
import { clone } from '../src/sim/clone.js';

// setParam writes through to the machine object, so each sim gets its own copy.
const fresh = (opts = {}) => { const machine = clone(faxfo70); return new FaxSim({ machine, geometry: geometryFor(machine), ...opts }); };
const M = faxfo70.mech;
const deg = Math.PI / 180;

class Run {
  constructor(sim) { this.sim = sim; this.events = []; }
  /** Step for up to `seconds`, stopping early once until(this) is true (checked every millisecond). */
  run(seconds, until = null) {
    const sim = this.sim, n = Math.round(seconds / sim.h), every = Math.round(1e-3 / sim.h);
    for (let i = 0; i < n; i++) {
      sim.step();
      if (i % every === 0) { sim.drainEvents(this.events); if (until?.(this)) return true; }
    }
    sim.drainEvents(this.events);
    return until ? !!until(this) : true;
  }
  ev(dev, ev, id) { return this.events.filter((e) => e.dev === dev && (ev == null || e.ev === ev) && (id === undefined || e.id === id)); }
  done(dev, id) { return this.events.find((e) => e.dev === dev && e.id === id && e.ev !== 'document' && e.ev !== 'paper' && e.ev !== 'cover') ?? null; }
  /** Send a controller command and run until its reply. */
  op(msg, seconds = 6) { this.sim.command(msg); this.run(seconds, () => !!this.done(msg.dev, msg.id)); return this.done(msg.dev, msg.id); }
}

// ---- registry and host --------------------------------------------------------------------------------------------

test('the host factory builds a FaxSim for the FO-70, with its snapshot layout', () => {
  const sim = createMechanism({ machine: clone(faxfo70), geometry: geometryFor(faxfo70) });
  assert.ok(sim instanceof FaxSim);
  assert.equal(sim.layout.keyX + M.panel.keys.length, sim.layout.length);
  const snap = new Float32Array(sim.layout.length);
  sim.writeSnapshot(snap);
  assert.ok(snap.every(Number.isFinite));
  assert.equal(snap[sim.layout.onCradle], 1);
  assert.equal(snap[sim.layout.coverClosed], 1);
  assert.equal(snap[sim.layout.paperSensor], 1, 'the warm start has the starter roll in');
  assert.ok(Math.abs(snap[sim.layout.rollRemaining] - M.printer.roll.warmRemaining) < 0.05);
});

// ---- the document path --------------------------------------------------------------------------------------------

test('a sheet is fed past the document and registration sensors, scanned line by line, and run out', () => {
  const sim = fresh(), r = new Run(sim);
  assert.equal(sim.scanner.docSensor(), false);
  sim.command({ dev: 'feeder', op: 'load', sheets: [{ id: 'memo', length: 0.1 }] });
  r.run(0.1, (x) => x.ev('scan', 'document').length > 0);
  assert.deepEqual(r.ev('scan', 'document').map((e) => e.present), [true], 'the controller sees the sheet laid on the table');
  assert.equal(sim.scanner.regSensor(), false);
  // Pre-feed: the separation roller takes it to the registration sensor, then on to the first line.
  const ready = r.op({ dev: 'scan', op: 'prefeed', id: 1 });
  assert.equal(ready?.ev, 'ready', JSON.stringify(ready));
  assert.ok(sim.scanner.regSensor(), 'the registration sensor sees the sheet');
  const at = sim.scanLine();
  assert.equal(at?.id, 'memo');
  assert.ok(at.y > 0 && at.y < 0.004, `the first line falls just inside the leading edge: ${at.y}`);
  assert.equal(ready.at.id, 'memo', 'the ready event carries the line position');
  // Ten lines at each resolution move the sheet under the sensor by ten pitches.
  for (const res of ['standard', 'fine', 'superfine']) {
    const y0 = sim.scanLine().y;
    for (let k = 0; k < 10; k++) assert.equal(r.op({ dev: 'scan', op: 'line', res, id: `${res}${k}` })?.ev, 'line');
    const pitch = (sim.scanLine().y - y0) / 10, want = 0.001 / M.drive.linesPerMm[res];
    assert.ok(Math.abs(pitch - want) / want < 0.03, `${res}: ${pitch * 1e3} mm a line, want ${want * 1e3}`);
  }
  // Run it out: the registration sensor clears, the feed roller lets it go, the table is empty.
  assert.equal(r.op({ dev: 'scan', op: 'eject', id: 9 })?.ev, 'ejected');
  r.run(0.3);
  assert.equal(r.ev('feeder', 'out').length, 1);
  assert.equal(sim.scanner.nOut, 1);
  assert.equal(sim.scanner.regSensor(), false);
  assert.equal(sim.scanner.docSensor(), false);
  assert.equal(sim.scanLine(), null);
  assert.deepEqual(r.ev('scan', 'document').map((e) => e.present), [true, false]);
});

test('two sheets part: the second follows with a gap, and pre-feed on an empty table says so', () => {
  const sim = fresh(), r = new Run(sim);
  sim.command({ dev: 'feeder', op: 'load', sheets: [{ id: 'A', length: 0.06 }, { id: 'B', length: 0.06 }] });
  assert.equal(r.op({ dev: 'scan', op: 'prefeed', id: 1 })?.ev, 'ready');
  // While A runs out, the registration sensor sees a gap between A's trailing edge and B's leading edge.
  let gap = false, wasA = false;
  sim.command({ dev: 'scan', op: 'eject', id: 2 });
  r.run(6, (x) => {
    const reg = sim.scanner.regSensor();
    if (reg && sim.scanner.moving.some((s) => s.id === 'A' && s.s - s.length < M.feeder.path.regSensor)) wasA = true;
    if (wasA && !reg) gap = true;
    return !!x.done('scan', 2);
  });
  assert.ok(gap, 'the sheets part at the registration sensor');
  assert.equal(r.ev('feeder', 'out')[0]?.id, 'A');
  assert.ok(sim.scanner.moving.some((s) => s.id === 'B'), 'B follows');
  assert.equal(r.op({ dev: 'scan', op: 'eject', id: 3 })?.ev, 'ejected');
  r.run(0.3);
  assert.deepEqual(r.ev('feeder', 'out').map((e) => e.id), ['A', 'B']);
  assert.equal(r.op({ dev: 'scan', op: 'prefeed', id: 4 })?.error, 'noDocument');
});

test('a sheet held back by a hand slips on its rollers, and the pre-feed reports a misfeed', () => {
  const sim = fresh(), r = new Run(sim);
  sim.command({ dev: 'feeder', op: 'load', sheets: [{ id: 'held', length: 0.1 }] });
  const g = sim.grab('document', 0, { target: -0.002, maxF: 6 });
  const res = r.op({ dev: 'scan', op: 'prefeed', id: 1 }, 8);
  sim.release(g);
  assert.equal(res?.error, 'misfeed');
  assert.ok(sim.scanner.moving[0].s < M.feeder.path.regSensor, 'the sheet never reached the sensor');
});

// ---- the recording path -------------------------------------------------------------------------------------------

test('the paper is fed a line at a time at the documented 3.85, 7.7 and 15.4 lines/mm', () => {
  const sim = fresh(), r = new Run(sim);
  for (const res of ['standard', 'fine', 'superfine']) {
    const want = 0.001 / M.drive.linesPerMm[res];
    // The first line after the change of direction takes up the swing gear and the backlash; the pitch is measured after.
    assert.equal(r.op({ dev: 'print', op: 'feed', lines: 1, res, id: `${res}-first` })?.ev, 'feed');
    r.run(0.02);
    const us = [sim.head.u];
    for (let k = 0; k < 8; k++) {
      assert.equal(r.op({ dev: 'print', op: 'feed', lines: 1, res, id: `${res}${k}` })?.ev, 'feed');
      r.run(0.02);
      us.push(sim.head.u);
    }
    const pitches = us.slice(1).map((u, i) => u - us[i]);
    const mean = (us[us.length - 1] - us[0]) / pitches.length;
    assert.ok(Math.abs(mean - want) / want < 0.01, `${res}: mean ${mean * 1e3} mm, want ${want * 1e3}`);
    for (const p of pitches) assert.ok(Math.abs(p - want) / want < 0.1, `${res}: one line ${p * 1e3} mm`);
    assert.equal(sim.drive.meshed(), 1, 'the planet stays in the recording train');
  }
  // The scanning train did not turn while the platen fed.
  assert.ok(Math.abs(sim.drive.trains[0].w) < 1e-3);
});

test('printing a line strobes the head where the paper is, and the thermal model can be swapped in', () => {
  const sim = fresh(), r = new Run(sim);
  const dots = new Uint8Array(M.printer.dots); dots.fill(1, 100, 200);
  const line = r.op({ dev: 'print', op: 'line', id: 1, dots, energy: 0.4e-3, res: 'fine' });
  assert.equal(line?.ev, 'line');
  const printed = r.ev('print', 'line').find((e) => e.darkness);
  assert.equal(printed.darkness.length, M.printer.dots);
  assert.equal(printed.darkness[150], 255); assert.equal(printed.darkness[50], 0);
  // The head marks only the coated side: a roll put in backwards prints nothing with the default rule.
  const calls = [];
  sim.attachThermal({ printLine: (a) => { calls.push(a); return new Uint8Array(a.dots.length).fill(7); } });
  r.op({ dev: 'print', op: 'line', id: 2, dots, energy: 0.4e-3, res: 'fine' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].coated, true);
  assert.ok(calls[0].coord > printed.coord, 'the next line lands further down the paper');
  sim.attachThermal(null);
  sim.command({ dev: 'roll', op: 'load', length: 30, coated: false });
  r.op({ dev: 'print', op: 'line', id: 3, dots, energy: 0.4e-3, res: 'fine' });
  assert.ok(r.ev('print', 'line').filter((e) => e.darkness).pop().darkness.every((d) => d === 0));
});

test('with the operation panel open the door sensor refuses a line; the head stays on the platen (service manual p.1-6)', () => {
  const sim = fresh(), r = new Run(sim);
  const g = sim.grab('cover', 0, { target: 80 * deg });
  r.run(0.8);
  assert.ok(!sim.head.coverClosed() && sim.head.headDown(), `the cover opens: ${sim.head.a}`);
  assert.equal(r.ev('print', 'cover').pop()?.closed, false);
  assert.equal(r.op({ dev: 'print', op: 'line', id: 1, dots: new Uint8Array(M.printer.dots), energy: 0 })?.error, 'coverOpen');
  sim.release(g);
  r.run(2, () => sim.head.coverClosed());
  assert.ok(sim.head.coverClosed(), 'it falls shut on its latch');
  r.run(0.1);
  assert.equal(r.ev('print', 'cover').pop()?.closed, true);
});

test('a cutter cycle off the one motor: a jog steps the mode cam to the cutter, the crank turns once and parts the strip, a jog brings the cam home', () => {
  const sim = fresh(), r = new Run(sim);
  // Paper beyond the cutter: the starter roll's end and two centimetres of print.
  r.op({ dev: 'print', op: 'feed', steps: Math.round(0.02 / M.drive.advancePerStep), id: 0 });
  const lead = sim.head.lead, t0 = sim.t;
  let left = false, camAway = false, cutMeshed = false;
  const done = (() => {
    sim.command({ dev: 'print', op: 'cut', id: 1 });
    r.run(3, (x) => {
      if (!sim.cutter.home()) left = true;
      if (!sim.drive.camHome()) camAway = true;
      if (sim.drive.meshed() === 2) cutMeshed = true;
      return !!x.done('print', 1);
    });
    return r.done('print', 1);
  })();
  assert.equal(done?.ev, 'cut', JSON.stringify(done));
  assert.ok(camAway, 'the mode cam left home: the cam switch opened');
  assert.ok(cutMeshed, 'the planet meshed with the cutter train');
  assert.ok(left, 'the crank left home');
  assert.ok(sim.drive.camHome(), 'the mode cam is home again');
  const cuts = r.ev('print', 'cut').filter((e) => e.length !== undefined);
  assert.equal(cuts.length, 1, 'one cut');
  assert.ok(Math.abs(cuts[0].from - lead) < 1e-9);
  // The jog that brings the cam home ends with a few steps on the platen: a tenth of a millimetre.
  assert.ok(Math.abs(cuts[0].to - (sim.head.u - M.printer.cutterAt)) < 0.3e-3, 'the strip parts at the blade');
  assert.ok(sim.t - t0 < 1.5, `a cycle takes ${sim.t - t0} s`);
  r.run(0.3);
  assert.ok(sim.cutter.home(), `the crank rests at home: ${sim.cutter.cam() / deg} deg`);
  assert.ok(Math.abs(sim.cutter.w) < 1e-3);
  // The platen is driven again after the cut.
  const u0 = sim.head.u;
  r.op({ dev: 'print', op: 'feed', lines: 4, res: 'standard', id: 9 });
  assert.ok(sim.head.u - u0 > 0.5 * 4 / 3.85e3, 'paper feeds after a cut');
  // A second cut with no paper fed since parts nothing new.
  r.op({ dev: 'print', op: 'cut', id: 2 });
  assert.equal(r.ev('print', 'cut').filter((e) => e.length !== undefined).length, 1);
});

test('a cutter held by a jam is reported, and the mode cam is brought home', () => {
  const sim = fresh(), r = new Run(sim);
  sim.setParam('mech.cutter.cutTorque', 5);          // far beyond what the motor can shear
  r.op({ dev: 'print', op: 'feed', steps: Math.round(0.02 / M.drive.advancePerStep), id: 0 });
  assert.equal(r.op({ dev: 'print', op: 'cut', id: 1 })?.error, 'cutterJam');
  // The jam cleared, the next feed first brings the mode cam home and then drives the platen.
  sim.setParam('mech.cutter.cutTorque', M.cutter.cutTorque);
  const u0 = sim.head.u;
  assert.equal(r.op({ dev: 'print', op: 'feed', lines: 4, res: 'standard', id: 2 })?.ev, 'feed');
  assert.ok(sim.drive.camHome(), 'the cam is back at the platen');
  assert.ok(sim.head.u > u0, 'and the paper moves');
  assert.equal(r.ev('print', 'cut').filter((e) => e.length !== undefined).length, 0);
});

test('the paper runs out: the sensor reports it, and a line is refused', () => {
  const sim = fresh(), r = new Run(sim);
  sim.command({ dev: 'roll', op: 'load', length: 0.05 });
  r.op({ dev: 'print', op: 'feed', steps: Math.round(0.06 / M.drive.advancePerStep), id: 0 });
  r.run(0.2);
  assert.equal(r.ev('print', 'paper').pop()?.present, false);
  assert.equal(r.op({ dev: 'print', op: 'line', id: 1, dots: new Uint8Array(M.printer.dots), energy: 0 })?.error, 'noPaper');
});

test('the roll\'s radius falls as it is used', () => {
  const sim = fresh();
  sim.command({ dev: 'roll', op: 'load', length: 30 });
  const full = sim.head.rollRadius();
  assert.ok(full > 0.022 && full < 0.030, `a 30 m roll is about 50 mm across: ${full * 2}`);
  sim.command({ dev: 'roll', op: 'load', length: 30, used: 29 });
  assert.ok(sim.head.rollRadius() < full * 0.5);
  assert.ok(sim.head.stripMass() < 0.05);
});

// ---- telephone ----------------------------------------------------------------------------------------------------

test('the hook switch: lifting the handset closes the loop, putting it down opens it; the line relay closes it too', () => {
  const sim = fresh(), r = new Run(sim);
  assert.ok(sim.liu.hookOn() && !sim.liu.lineLoop());
  sim.command({ dev: 'handset', op: 'lift' });
  r.run(0.3);
  assert.ok(!sim.liu.hookOn() && sim.liu.lineLoop());
  assert.deepEqual(r.ev('liu', 'hook').map((e) => e.offHook), [true]);
  sim.command({ dev: 'handset', op: 'replace' });
  r.run(0.3);
  assert.ok(sim.liu.hookOn() && !sim.liu.lineLoop());
  assert.deepEqual(r.ev('liu', 'hook').map((e) => e.offHook), [true, false]);
  // A finger on the plunger is a hook flash.
  sim.command({ dev: 'handset', op: 'lift' });
  r.run(0.2);
  const g = sim.grab('hook', 0, { target: M.liu.hook.travel + 0.004 });
  r.run(0.1);
  assert.ok(sim.liu.hookOn(), 'pressed down by hand');
  sim.release(g);
  r.run(0.2);
  assert.ok(!sim.liu.hookOn());
  sim.command({ dev: 'handset', op: 'replace' });
  r.run(0.2);
  // The line relay: it pulls in a few milliseconds after its coil is switched, and drops out after.
  const t0 = sim.t;
  sim.command({ dev: 'liu', op: 'relay', name: 'cml', on: true });
  r.run(0.1, () => sim.liu.relayMade('cml'));
  const pull = sim.t - t0;
  assert.ok(pull > 5e-4 && pull < 0.02, `pull-in ${pull * 1e3} ms`);
  assert.ok(sim.liu.lineLoop(), 'the machine has the line');
  sim.command({ dev: 'liu', op: 'relay', name: 'cml', on: false });
  r.run(0.1);
  assert.ok(!sim.liu.relayMade('cml') && !sim.liu.lineLoop());
});

// ---- panel --------------------------------------------------------------------------------------------------------

test('a panel key pressed and let go is reported once down and once up', () => {
  const sim = fresh(), r = new Run(sim);
  sim.command({ dev: 'panel', op: 'finger', key: 'start', force: 2.5 });
  r.run(0.05);
  sim.command({ dev: 'panel', op: 'finger', key: 'start', force: 0 });
  r.run(0.05);
  assert.deepEqual(r.ev('panel', 'key').map((e) => [e.key, e.down]), [['start', true], ['start', false]]);
  // A touch too light to buckle the dome makes no contact.
  sim.command({ dev: 'panel', op: 'finger', key: '5', force: 1.0 });
  r.run(0.05);
  sim.command({ dev: 'panel', op: 'finger', key: '5', force: 0 });
  r.run(0.05);
  assert.equal(r.ev('panel', 'key').length, 2);
});

// ---- state transfer -----------------------------------------------------------------------------------------------

test('export and import mid-move, by a plain deep copy with no structuredClone, continues identically', () => {
  const a = fresh(), ra = new Run(a);
  a.command({ dev: 'feeder', op: 'load', sheets: [{ id: 'x', length: 0.08 }] });
  a.command({ dev: 'scan', op: 'prefeed', id: 1 });
  a.command({ dev: 'print', op: 'feed', lines: 3, res: 'fine', id: 2 });
  a.command({ dev: 'print', op: 'cut', id: 3 });
  a.command({ dev: 'handset', op: 'lift' });
  a.command({ dev: 'liu', op: 'relay', name: 'cml', on: true });
  ra.run(0.7);
  const b = fresh(), rb = new Run(b);
  const saved = globalThis.structuredClone;
  delete globalThis.structuredClone;
  try {
    b.importState(clone(a.exportState()));
  } finally { globalThis.structuredClone = saved; }
  assert.deepEqual(b.exportState(), a.exportState(), 'the state survives the copy');
  ra.events.length = 0;
  ra.run(1.5); rb.run(1.5);
  assert.deepEqual(b.exportState(), a.exportState(), 'and both run on the same');
  assert.deepEqual(rb.events, ra.events);
});

// ---- firmware ---------------------------------------------------------------------------------------------------

test('firmware attaches to the host: it hears device events as they happen and drives the controllers on the clock', () => {
  const sim = fresh(), r = new Run(sim);
  const heard = [];
  const fw = {
    nextT: 0.01, ticks: 0,
    service(t) { this.ticks++; this.nextT = t + 0.01; },
    device(e, t) {
      heard.push([e.dev, e.ev, t]);
      if (e.dev === 'scan' && e.ev === 'document' && e.present) sim.ctl.scan.command({ op: 'prefeed', id: 'fw' }, t);
    },
  };
  sim.attachFirmware(fw);
  sim.command({ dev: 'feeder', op: 'load', sheets: [{ id: 'auto', length: 0.08 }] });
  r.run(4, (x) => !!x.done('scan', 'fw'));
  assert.equal(r.done('scan', 'fw')?.ev, 'ready', 'a sheet laid on the table is pre-fed by the firmware');
  assert.ok(fw.ticks > 50, 'serviced on the clock');
  assert.ok(heard.some(([d, ev]) => d === 'scan' && ev === 'ready'));
  sim.attachFirmware(null);
  const n = fw.ticks;
  r.run(0.1);
  assert.equal(fw.ticks, n, 'detached');
});

// ---- the rules ----------------------------------------------------------------------------------------------------

test('no controller writes a mechanical state: they only switch phases, coils and strobes and read sensors', async () => {
  const sim = fresh(), r = new Run(sim);
  const allowed = {
    drive: ['setMotor'],
    scan: ['docSensor', 'regSensor'],
    print: ['strobe', 'cutterHome', 'camHome', 'paperSensor', 'coverClosed'],
    liu: ['setRelay', 'hookOn'],
    panel: ['keyContact'],
  };
  const used = {};
  for (const [name, keys] of Object.entries(allowed)) {
    const ctl = sim.ctl[name];
    assert.ok(Object.isFrozen(ctl.io), `${name}: io is frozen`);
    assert.deepEqual(new Set(Object.keys(ctl.io)), new Set(keys), name);
    used[name] = new Set();
    ctl.io = new Proxy(ctl.io, {
      get: (o, k) => { used[name].add(k); return o[k]; },
      set: () => { throw new Error(`the ${name} controller wrote to io`); },
    });
  }
  sim.command({ dev: 'feeder', op: 'load', sheets: [{ id: 'p', length: 0.06 }] });
  r.op({ dev: 'scan', op: 'prefeed', id: 1 });
  r.op({ dev: 'scan', op: 'line', id: 2 });
  r.op({ dev: 'print', op: 'line', id: 3, dots: new Uint8Array(M.printer.dots), energy: 0.3e-3 });
  r.op({ dev: 'print', op: 'cut', id: 4 });
  sim.command({ dev: 'liu', op: 'relay', name: 'cml', on: true });
  sim.command({ dev: 'panel', op: 'finger', key: 'stop', force: 3 });
  r.run(0.2);
  for (const [name, keys] of Object.entries(allowed)) for (const k of used[name]) assert.ok(keys.includes(k), `${name}: io.${k}`);
  for (const file of ['drive-ctl', 'scan-ctl', 'print-ctl', 'liu-ctl', 'panel-ctl']) {
    const src = await readFile(new URL(`../src/sim/fax/${file}.js`, import.meta.url), 'utf8');
    assert.ok(!/^import /m.test(src), `${file}.js imports nothing`);
    assert.ok(!/\b(mech|drive|scanner|head|cutter|liu|panel|motor|sheet|sh)\.(th|w|phi|phiV|psi|s|v|u|a|av|x|hx|hv|lead|i|volts)\b\s*=[^=]/.test(src), `${file}.js assigns no position, speed or current`);
    assert.ok(!/\bsim\b/.test(src), `${file}.js never sees the host`);
  }
});

test('asleep when idle: a warm machine with nothing to do does no work', () => {
  const sim = fresh();
  for (let i = 0; i < Math.round(0.05 / sim.h); i++) sim.step();
  assert.ok(!sim.scanner.awake && !sim.cutter.awake && !sim.panel.awake, 'the bodies sleep');
  sim.command({ dev: 'panel', op: 'finger', key: '1', force: 2 });
  assert.ok(sim.panel.awake);
});
