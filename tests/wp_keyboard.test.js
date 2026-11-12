// The word processor's key modules and scanner (architecture.md 5.1, 5.2): make, break and hysteresis from the
// integrated fly plate, force within the documented 40-75 g, scan bytes, typematic, make/break keys, the buffer,
// the LOCK detent, and the speaker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyboardMech } from '../src/sim/wp/keyboard-mech.js';
import { KeyboardCtl } from '../src/sim/wp/keyboard-ctl.js';

const H = 1 / 384000;
function rig() {
  const mech = new KeyboardMech(), events = [];
  const ctl = new KeyboardCtl(mech, (e) => events.push(e));
  let t = 0;
  const run = (s, each) => { const n = Math.round(s / H); for (let j = 0; j < n; j++) { each?.(t); mech.step(H); t += H; ctl.advance(t); if (events.length && ctl.awaitAck) ctl.command({ op: 'ack' }, t); } };
  return { mech, ctl, events, run, get t() { return t; } };
}
const idx = (mech, pos) => mech.index.get(pos);
const plateUp = (mech, i) => mech.y[i] > mech.P.Y / 2;

test('a slowly rising finger force makes near 1.75 mm and a falling one breaks near 1.25 mm', () => {
  const r = rig(), i = idx(r.mech, 38);   // A
  let make = null, brk = null, peak = 0;
  r.run(0.4, (t) => {
    const f = t < 0.2 ? 0.8 * t / 0.2 : 0.8 * (0.4 - t) / 0.2;
    r.mech.setForce(i, Math.max(0, f));
    if (make === null && plateUp(r.mech, i)) make = r.mech.x[i];
    if (make !== null && brk === null && !plateUp(r.mech, i)) brk = r.mech.x[i];
    if (make === null) peak = Math.max(peak, f);
  });
  assert.ok(make !== null && brk !== null, 'made and broke');
  assert.ok(Math.abs(make - 0.00175) < 0.0003, `make at ${(make * 1000).toFixed(2)} mm`);
  assert.ok(Math.abs(brk - 0.00125) < 0.0003, `break at ${(brk * 1000).toFixed(2)} mm`);
  const grams = peak / 9.81 * 1000;
  assert.ok(grams > 40 && grams < 75, `actuation force ${grams.toFixed(0)} g`);
});

test('a tap sends one scan byte with the key position, and nothing on release', () => {
  const r = rig(), i = idx(r.mech, 38);
  r.mech.setForce(i, 1.0); r.run(0.05); r.mech.setForce(i, 0); r.run(0.1);
  assert.deepEqual(r.events.map((e) => e.byte), [38]);
  assert.equal(r.events[0].dev, 'kbd');
});

test('holding a typematic key repeats after 350 ms at 14 per second', () => {
  const r = rig(), i = idx(r.mech, 64);   // space bar, T
  r.mech.setForce(i, 1.4); r.run(1.0); r.mech.setForce(i, 0); r.run(0.05);
  const first = r.events[0], repeats = r.events.filter((e) => e.byte === (64 | 0x80));
  assert.equal(first.byte, 64);
  assert.ok(Math.abs(repeats[0].t - first.t - 0.35) < 0.012, `first repeat after ${(repeats[0].t - first.t).toFixed(3)} s`);
  const rate = (repeats.length - 1) / (repeats.at(-1).t - repeats[0].t);
  assert.ok(Math.abs(rate - 14) < 0.5, `rate ${rate.toFixed(1)} /s`);
});

test('make/break keys report press and release; SHIFT does not repeat', () => {
  const r = rig(), i = idx(r.mech, 50);
  r.mech.setForce(i, 1.0); r.run(0.6); r.mech.setForce(i, 0); r.run(0.05);
  assert.deepEqual(r.events.map((e) => e.byte), [50, 50 | 0x80]);
});

test('four bytes buffer; a fifth while the link is held replaces the last with the overrun byte', () => {
  const r = rig();
  r.ctl.awaitAck = true;   // the system does not acknowledge
  const keys = [38, 39, 40, 41, 42].map((p) => idx(r.mech, p));
  for (const i of keys) { r.mech.setForce(i, 1.0); r.run(0.02); r.mech.setForce(i, 0); r.run(0.02); r.ctl.awaitAck = true; }
  assert.deepEqual(r.ctl.buffer, [38, 39, 40, 0x7f]);
});

test('LOCK stays down in its detent until a SHIFT is pressed', () => {
  const r = rig(), lock = idx(r.mech, 37), shift = idx(r.mech, 50);
  r.mech.setForce(lock, 1.2); r.run(0.05); r.mech.setForce(lock, 0); r.run(0.1);
  assert.ok(r.mech.lockLatched && plateUp(r.mech, lock), 'held down');
  r.mech.setForce(shift, 1.0); r.run(0.05); r.mech.setForce(shift, 0); r.run(0.1);
  assert.ok(!r.mech.lockLatched && !plateUp(r.mech, lock), 'released by SHIFT');
});

test('the speaker gives a 0.5 ms click and a gated 1 kHz tone', () => {
  const r = rig();
  r.ctl.command({ op: 'click' }, 1.0);
  assert.equal(r.ctl.speaker(1.0002), 1); assert.equal(r.ctl.speaker(1.0006), 0);
  r.ctl.command({ op: 'tone', ms: 60 }, 2.0);
  let flips = 0, last = r.ctl.speaker(2.0);
  for (let t = 2.0; t < 2.06; t += 1e-5) { const s = r.ctl.speaker(t); if (s !== last) flips++; last = s; }
  assert.ok(Math.abs(flips - 120) <= 3, `${flips} edges in 60 ms`);
  assert.equal(r.ctl.speaker(2.07), 0);
});

test('state export and import round-trip mid-press', () => {
  const r = rig(), i = idx(r.mech, 38);
  r.mech.setForce(i, 1.0); r.run(0.004);
  const m2 = new KeyboardMech(); m2.importState(JSON.parse(JSON.stringify(r.mech.exportState())));
  assert.equal(m2.x[i], r.mech.x[i]); assert.equal(m2.y[i], r.mech.y[i]);
});

test('the browser host registers every tap however slowly frames come', async () => {
  const { KeyboardHost } = await import('../src/kits/wp/keyboard-host.js');
  const { KEY_BY_POS } = await import('../src/machine/wp-keys.js');
  const I = (pos) => KEY_BY_POS[pos].index;
  const seq = []; let t = 0.1;
  const tap = (pos, shift) => { if (shift) { seq.push([t, I(50), 1.2]); t += 0.04; } seq.push([t, I(pos), 1.2], [t + 0.11, I(pos), 0]); t += 0.31; if (shift) { seq.push([t, I(50), 0]); t += 0.08; } };
  for (const p of [43, 32, 33, 33, 31]) tap(p);
  tap(45, true); tap(19); tap(10);
  const expected = '43,32,33,33,31,50,45,178,19,10';
  for (const frame of [1 / 60, 0.5, 1.2, 3]) {
    let now = 0; const bytes = [];
    const h = new KeyboardHost((e) => bytes.push(e.byte), () => now);
    let k = 0;
    for (let f = 0; f <= t + frame + 0.5; f += frame) { while (k < seq.length && seq[k][0] <= f) { now = seq[k][0]; h.press(seq[k][1], seq[k][2]); k++; } now = f; h.advance(f); }
    assert.equal(bytes.join(','), expected, `frames ${frame} s apart`);
  }
});
