// The word processor's sound (architecture.md 10): every voice is synthesised from the mechanism's forces, torques and
// speeds, on three buses panned by where the units stand. Node runs the whole mechanism and renders the audio blocks
// the worklet would.
import test from 'node:test';
import assert from 'node:assert/strict';
import wordproc1980 from '../src/machine/wordproc1980.js';
import frontstrike1926 from '../src/machine/frontstrike1926.js';
import { geometryFor } from '../src/machine/index.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { WordprocSim } from '../src/sim/wp/index.js';
import { WpAudioEngine } from '../src/audio/wp-engine.js';
import { LEVEL } from '../src/audio/wp-synth.js';
import { createMechanism, createAudioEngine } from '../src/sim/host-factory.js';

const glyphs = await loadGlyphs('glyphs_wp');
const SR = 48000, BLOCK = 128;
const DISKS = [{ mediaId: 'PROG', type: '2D' }, { mediaId: 'WORK01', type: '2D' }];
const ORDER = wordproc1980.printer.wheel.order;
const PROSE = 'It was the best of times, it was the worst of times, it was the age of wisdom';
// Every source that only sounds when a part moves or a contact changes; what is left are the motors and fans.
const MOVING = ['hammer', 'impact', 'selection', 'escapement', 'index', 'ribbon', 'follower', 'cam', 'carrierStop', 'caseClick',
  'headStep', 'headStop', 'headLoad', 'collet', 'leverClick', 'impactClick', 'wheelWhir', 'rumble', 'camWhirr'];
const only = (keys) => Object.fromEntries(Object.keys(LEVEL).map((k) => [k, keys.includes(k) || /^(petal|platen|carrier|frame|cabinet|chassis|lever)$/.test(k) ? LEVEL[k] : 0]));

/** The host and its engine; render() runs blocks and returns both channels with the sim time of each sample. */
class Rig {
  constructor({ levels, cold = false } = {}) {
    const machine = structuredClone(wordproc1980);
    this.sim = new WordprocSim({ machine, geometry: geometryFor(machine), glyphs, cold, drives: DISKS });
    this.eng = new WpAudioEngine(this.sim, SR, { levels });
    this.events = [];
    this.eng.onSnapshot = (_s, ev) => this.events.push(...ev);
    this.queue = [];
  }
  print(words) { this.queue.push(...words); return this; }
  feed() {
    const room = 32 - this.sim.printerCtl.fifo.length;
    if (room > 0 && this.queue.length) this.sim.command({ dev: 'printer', words: this.queue.splice(0, room) });
  }
  render(seconds, each) {
    const blocks = Math.round((seconds * SR) / BLOCK), n = blocks * BLOCK;
    const L = new Float32Array(n), R = new Float32Array(n), t = new Float64Array(n);
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
    for (let b = 0; b < blocks; b++) {
      this.feed();
      each?.(this, b);
      const t0 = this.sim.t;
      this.eng.process(l, BLOCK, r);
      L.set(l, b * BLOCK); R.set(r, b * BLOCK);
      for (let i = 0; i < BLOCK; i++) t[b * BLOCK + i] = t0 + (i + 1) / SR;
    }
    return { L, R, t };
  }
  get strikes() { return this.events.filter((e) => e.type === 'strike'); }
}

/** Words for text at 10 pitch (24 escapement steps), a space folded into the next character's escape. */
function text(s) {
  const w = [];
  let gap = 0;
  for (const ch of s) {
    if (ch === ' ') { gap += 24; continue; }
    w.push(0x2000 | (gap + 24), 0x1000 | ORDER.indexOf(ch));
    gap = 0;
  }
  return w;
}
const energy = (o, ch = 'M', from = 0, to = o.L.length) => {
  let e = 0;
  for (let i = from; i < to; i++) {
    const v = ch === 'L' ? o.L[i] : ch === 'R' ? o.R[i] : 0.5 * (o.L[i] + o.R[i]);
    e += v * v;
  }
  return e / Math.max(1, to - from);
};
const db = (e) => 10 * Math.log10(Math.max(e, 1e-30));
const finite = (o) => o.L.every(Number.isFinite) && o.R.every(Number.isFinite);
const peak = (o) => { let p = 0; for (let i = 0; i < o.L.length; i++) p = Math.max(p, Math.abs(o.L[i]), Math.abs(o.R[i])); return p; };

test('a printed line, a line feed and a diskette transfer sound, and stay finite and inside full scale', () => {
  const idle = new Rig();
  idle.render(0.2);
  const quiet = idle.render(0.5);
  const r = new Rig();
  r.render(0.2);
  r.print([...text(PROSE.slice(0, 40)), 0x3000 | 16]);
  r.sim.command({ dev: 'disk', op: 'transfer', id: 1, drive: 1, side: 0, track: 30, sector: 3, count: 4 });
  const o = r.render(1.4);
  assert.ok(finite(o), 'finite');
  assert.ok(peak(o) < 0.95, `peak ${peak(o)}`);
  assert.ok(r.strikes.length >= 30, `${r.strikes.length} strikes`);
  assert.ok(r.events.some((e) => e.dev === 'disk' && e.id === 1 && e.ok), 'the transfer completed');
  const eIdle = energy(quiet), ePrint = energy(o);
  assert.ok(db(ePrint) - db(eIdle) > 10, `printing ${db(ePrint).toFixed(1)} dB over idle ${db(eIdle).toFixed(1)} dB`);
  // The line feed alone: the 16 steps after the last character are louder than the motors and fans.
  const feed = new Rig();
  feed.render(0.2);
  feed.print([0x3000 | 16, 0x6002]);
  const f = feed.render(0.08);
  assert.ok(db(energy(f)) - db(eIdle) > 10, `line feed ${db(energy(f)).toFixed(1)} dB`);
  // The transfer alone: seek ticks and head load over the drives' hum.
  const disk = new Rig();
  disk.render(0.2);
  disk.sim.command({ dev: 'disk', op: 'transfer', id: 2, drive: 0, side: 0, track: 60, sector: 1, count: 2 });
  const d = disk.render(0.6);
  assert.ok(finite(d) && db(energy(d)) - db(eIdle) > 6, `seek and transfer ${db(energy(d)).toFixed(1)} dB`);
});

test('energy rises with the print rate', () => {
  const words = text('the quick brown fox jumps over the lazy dog and the cat');
  const slow = new Rig(), fast = new Rig();
  slow.render(0.2); fast.render(0.2);
  // One character every 240 ms against the queue kept full.
  const pairs = [];
  for (let i = 0; i < words.length; i += 2) pairs.push(words.slice(i, i + 2));
  const os = slow.render(1.0, (rig, b) => { if (b % 90 === 0 && pairs.length) rig.print(pairs.shift()); });
  fast.print(words);
  const of = fast.render(1.0);
  const ns = slow.strikes.length, nf = fast.strikes.length;
  assert.ok(nf > 3 * ns && ns >= 4, `${ns} slow and ${nf} fast strikes`);
  const es = energy(os), ef = energy(of);
  assert.ok(db(ef) - db(es) > 3, `fast ${db(ef).toFixed(1)} dB, slow ${db(es).toFixed(1)} dB`);
});

test('a strike sounds within a millisecond of the petal reaching the paper', () => {
  // Two identical machines, one of them deaf to the petal face's force: what differs is the strike's own sound.
  const a = new Rig(), b = new Rig({ levels: { impact: 0 } });
  const t = [], oa = { L: [], R: [] }, ob = { L: [], R: [] };
  for (const ch of 'mw.') {      // one character at a time, each from rest, so each strike starts in quiet
    const w = text(ch);
    a.print(w.slice()); b.print(w.slice());
    const x = a.render(0.15), y = b.render(0.15);
    t.push(...x.t); oa.L.push(...x.L); oa.R.push(...x.R); ob.L.push(...y.L); ob.R.push(...y.R);
  }
  assert.equal(a.strikes.length, 3);
  const D = (i) => Math.abs(0.5 * (oa.L[i] + oa.R[i]) - 0.5 * (ob.L[i] + ob.R[i]));
  const at = (x) => t.findIndex((v) => v > x);
  for (const s of a.strikes) {
    const t0 = s.tBegin;
    let pk = 0;
    for (let i = at(t0 - 0.005); i < at(t0 + 0.005); i++) pk = Math.max(pk, D(i));
    let k = at(t0 - 0.005);
    while (D(k) <= 0.05 * pk) k++;
    assert.ok(pk > 1e-3, `strike ${pk}`);
    assert.ok(t[k] >= t0 - 1e-4 && t[k] <= t0 + 1e-3, `onset ${((t[k] - t0) * 1e3).toFixed(3)} ms after first contact`);
  }
  assert.equal(D(at(a.strikes[0].tBegin - 1e-4) - 1), 0, 'nothing before the first contact');
});

test('with nothing moving, only the motors and fans are heard, steadily', () => {
  const a = new Rig(), b = new Rig({ levels: Object.fromEntries(MOVING.map((k) => [k, 0])) });
  // After the warm start's first moments have died away in the room.
  a.render(1.0); b.render(1.0);
  const oa = a.render(0.6), ob = b.render(0.6);
  let diff = 0;
  for (let i = 0; i < oa.L.length; i++) diff = Math.max(diff, Math.abs(oa.L[i] - ob.L[i]), Math.abs(oa.R[i] - ob.R[i]));
  assert.ok(diff < 1e-9, `idle output equals the motors and fans alone (max difference ${diff})`);
  const pv = a.eng.synth.printer, dv = a.eng.synth.diskette;
  for (const body of [pv.petal, pv.platen, pv.carrier, pv.frame, pv.cabinet, dv.chassis, dv.lever]) assert.equal(body.awake, false);
  // Not silent: the drives' motors, the fans; and steady, 50 ms at a time within 1.5 dB.
  const e = energy(oa);
  assert.ok(db(e) > -65 && db(e) < -40, `idle ${db(e).toFixed(1)} dBFS`);
  const w = SR / 20;
  for (let k = 0; k + w <= oa.L.length; k += w) assert.ok(Math.abs(db(energy(oa, 'M', k, k + w)) - db(e)) < 1.5, `window ${k / w}`);
  // With the station and the printer switched off, the motors and fans run down and the room goes quieter.
  const off = new Rig();
  off.render(0.1);
  off.sim.setStationPower(false);
  const g = off.sim.grab('printerPower', 0, { target: -0.1 });
  off.render(0.3);
  off.sim.release(g);
  const oo = off.render(0.5);
  assert.ok(!off.sim.station.powered() && !off.sim.printer.powered());
  assert.ok(db(energy(oo, 'M', oo.L.length / 2)) < db(e) - 6, `off ${db(energy(oo, 'M', oo.L.length / 2)).toFixed(1)} dBFS`);
});

test('the printer is heard to the left, the diskette unit to the right and the station in the middle', () => {
  const { pan } = new Rig().eng.synth;
  assert.ok(pan.printer < -0.5 && pan.diskette > 0.3 && Math.abs(pan.station) < 1e-9, JSON.stringify(pan));
  const pr = new Rig({ levels: only(['hammer', 'impact', 'impactClick']) });
  pr.render(0.1);
  pr.print(text('mmmm'));
  const op = pr.render(0.4);
  assert.ok(energy(op, 'L') > 3 * energy(op, 'R'), 'strikes: left');
  const dk = new Rig({ levels: only(['headStep', 'headStop']) });
  dk.render(0.1);
  dk.sim.command({ dev: 'disk', op: 'recalibrate', id: 1, drive: 1 });
  const od = dk.render(0.5);
  assert.ok(energy(od, 'R') > 2 * energy(od, 'L'), 'recalibrate buzz: right');
  const st = new Rig({ levels: only(['stationFan']) });
  const os = st.render(0.2);
  assert.ok(Math.abs(db(energy(os, 'L')) - db(energy(os, 'R'))) < 0.01, 'station fan: centre');
});

test('the station fan is a mechanism: it runs at speed warm, runs up cold, and is in the snapshot', () => {
  const warm = new Rig(), L = warm.sim.layout, s = new Float32Array(L.length);
  warm.sim.writeSnapshot(s);
  const F = wordproc1980.station.fan;
  assert.ok(s[L.power] === 1 && s[L.fanOmega] > 0.75 * F.syncOmega && s[L.fanOmega] < F.syncOmega, `${s[L.fanOmega]} rad/s`);
  const cold = new Rig({ cold: true });
  cold.render(0.1);
  const w1 = cold.sim.station.fan;
  cold.render(0.1);
  assert.ok(w1 > 5 && cold.sim.station.fan > w1, `${w1} then ${cold.sim.station.fan} rad/s`);
  const st = cold.sim.exportState();
  assert.equal(st.station.fan, cold.sim.station.fan);
});

test('the voices stay inside their budget of 1 microsecond a sample', (t) => {
  // Printing a line with a line feed while a drive seeks and transfers: every voice is busy. The engine times the
  // rendering of each block; reading the probe frame from the mechanism is timed here in chunks on the same state.
  // Medians, so that other test files running alongside (a preempted block) do not decide it.
  const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const r = new Rig();
  r.render(0.05);
  r.print([...text(PROSE), 0x3000 | 16]);
  r.sim.command({ dev: 'disk', op: 'transfer', id: 1, drive: 0, side: 0, track: 50, sector: 1, count: 8 });
  const blocks = [];
  const t0 = performance.now();
  r.render(1.0, (rig) => { if (rig.eng.voiceLastNs > 0) blocks.push(rig.eng.voiceLastNs); });
  const all = ((performance.now() - t0) * 1e6) / SR;
  const synth = r.eng.synth, chunks = [];
  for (let c = 0; c < 200; c++) {
    const c0 = performance.now();
    for (let k = 0; k < 1024; k++) synth.capture(k & 127);
    chunks.push(((performance.now() - c0) * 1e6) / 1024);
  }
  const render = median(blocks), capture = median(chunks), voices = render + capture;
  t.diagnostic(`voices ${voices.toFixed(0)} ns a sample (rendering ${render.toFixed(0)}, reading the mechanism ${capture.toFixed(0)}); ` +
    `mechanism and voices ${all.toFixed(0)} ns; one sample is ${(1e9 / SR).toFixed(0)} ns`);
  assert.ok(voices < 1000, `${voices.toFixed(0)} ns a sample`);
});

test('the typewriters keep their mono engine; a mono caller of this one gets the mid', () => {
  const tw = createMechanism({ machine: frontstrike1926, geometry: geometryFor(frontstrike1926) });
  assert.ok(!createAudioEngine(tw, SR).stereo);
  const a = new Rig(), b = new Rig();
  const m = new Float32Array(BLOCK), l = new Float32Array(BLOCK), r = new Float32Array(BLOCK);
  for (let k = 0; k < 20; k++) { a.eng.process(m, BLOCK); b.eng.process(l, BLOCK, r); }
  for (let i = 0; i < BLOCK; i++) assert.ok(Math.abs(m[i] - 0.5 * (l[i] + r[i])) < 1e-7);
  // Rendering nothing (LocalHost before the gesture) still runs the mechanism and its snapshots.
  const c = new Rig(), t0 = c.sim.t;
  c.eng.process(null, BLOCK);
  assert.ok(c.sim.t > t0);
});
