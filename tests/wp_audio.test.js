// The word processor's sound (architecture.md 10): voices synthesised from the mechanism's forces, torques and speeds,
// and the owner's recordings (10.4) played from the mechanism's own events, on three buses panned by where the units
// stand. Node runs the whole mechanism and renders the audio blocks the worklet would.
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
import { BED_DBFS, RECORDED, HUM_LIFT_DB } from '../src/audio/wp-sampler.js';
import { KeyVoicer, keyClass, BED_DBFS as KEY_BED_DBFS, PRESS_OVER_BED_DB, V_PRESS } from '../src/audio/wp-keys.js';
import { KeyboardHost } from '../src/kits/wp/keyboard-host.js';
import { KEY_BY_POS } from '../src/machine/wp-keys.js';
import { WAC } from '../src/sim/wp/ports.js';
import { readSamples } from '../tools/audio/node_samples.mjs';
import { WpHum } from '../src/audio/wp-hum.js';
import { HUM } from '../src/audio/wp-hum-data.js';

const glyphs = await loadGlyphs('glyphs_wp');
const SR = 48000, BLOCK = 128;
const DISKS = [{ mediaId: 'PROG', type: '2D' }, { mediaId: 'WORK01', type: '2D' }];
const ORDER = wordproc1980.printer.wheel.order;
const PROSE = 'It was the best of times, it was the worst of times, it was the age of wisdom';
// Every source that only sounds when a part moves or a contact changes; what is left are the motors and fans.
const MOVING = ['hammer', 'impact', 'selection', 'escapement', 'index', 'ribbon', 'follower', 'cam', 'carrierStop', 'caseClick',
  'headStep', 'headStop', 'headLoad', 'collet', 'leverClick', 'impactClick', 'wheelWhir', 'rumble', 'camWhirr'];
const only = (keys) => Object.fromEntries(Object.keys(LEVEL).map((k) => [k, keys.includes(k) || /^(petal|platen|carrier|frame|cabinet|chassis|lever)$/.test(k) ? LEVEL[k] : 0]));

let sprite = null;          // the recorded sprite, decoded once with ffmpeg
const wpSamples = () => (sprite ??= readSamples('samples_wp'));

/** The host and its engine; render() runs blocks and returns both channels with the sim time of each sample. */
class Rig {
  constructor({ levels, cold = false, samples = false } = {}) {
    const machine = structuredClone(wordproc1980);
    this.sim = new WordprocSim({ machine, geometry: geometryFor(machine), glyphs, cold, drives: DISKS });
    this.eng = new WpAudioEngine(this.sim, SR, { levels });
    if (samples) { const { pcm, manifest } = wpSamples(); this.eng.loadSamples(pcm, manifest); }
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
  const r = new Rig({ samples: true });
  r.render(0.05);
  r.print([...text(PROSE), 0x3000 | 16]);
  r.sim.command({ dev: 'disk', op: 'transfer', id: 1, drive: 0, side: 0, track: 50, sector: 1, count: 8 });
  const blocks = [];
  const t0 = performance.now();
  r.render(1.0, (rig) => { if (rig.eng.voiceLastNs > 0) blocks.push(rig.eng.voiceLastNs); });
  const all = ((performance.now() - t0) * 1e6) / SR;
  assert.ok(r.eng.sampler.counts.disk_seek > 0, 'the recorded seek played');
  const synth = r.eng.synth, sampler = r.eng.sampler, chunks = [];
  for (let c = 0; c < 200; c++) {
    const c0 = performance.now();
    for (let k = 0; k < 1024; k++) { synth.capture(k & 127); sampler.capture(k & 127); }
    sampler.nT = 0;
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

// ---- the recordings (architecture.md 10.4) -------------------------------------------------------------------------

/** Mid RMS and peak of a stretch, in dBFS. */
const level = (o, from = 0, to = o.L.length) => {
  let e = 0, p = 0;
  for (let i = from; i < to; i++) { const m = 0.5 * (o.L[i] + o.R[i]); e += m * m; p = Math.max(p, Math.abs(m)); }
  return { rms: db(e / Math.max(1, to - from)), peak: 20 * Math.log10(Math.max(p, 1e-15)) };
};

test('the recorded sprite plays from the mechanism: steps, a seek and the head load, at the recorded levels', (t) => {
  const r = new Rig({ samples: true });
  r.eng.sampler.humLift = 1;   // the recording's own balance (HUM_LIFT_DB lifts only the hum, for small speakers)
  r.render(1.0);
  assert.deepEqual(r.eng.sampler.counts, {}, 'nothing moves, nothing is triggered');
  const idle = level(r.render(0.5));
  r.sim.command({ dev: 'disk', op: 'recalibrate', id: 1, drive: 0 });
  r.render(0.9);
  // A seek of 40 tracks: the first step rings alone, every later one plays a grain of a recorded seek's buzz.
  const lands = [];
  const cap = r.eng.sampler.capture.bind(r.eng.sampler);
  r.eng.sampler.capture = (i) => { for (let e = 0; e < r.sim.acN; e++) if (r.sim.acQ[e * 3] === WAC.HEAD_LAND) lands.push(r.sim.t); cap(i); };
  r.eng.sampler.counts = {};
  r.sim.command({ dev: 'disk', op: 'transfer', id: 2, drive: 0, side: 0, track: 40, sector: 1, count: 1 });
  const seek = r.render(0.2);
  const c = r.eng.sampler.counts;
  assert.ok(c.disk_seek >= 35 && c.disk_seek <= 40 && c.disk_step === 1, `one step alone, then a grain a step: ${JSON.stringify(c)}`);
  const rest = r.render(0.4);
  assert.ok(r.eng.sampler.counts.disk_load >= 1 && lands.length >= 1, 'the pad landing plays a head load');
  // One track on: a single step.
  r.render(1.0);
  r.eng.sampler.counts = {};
  r.sim.command({ dev: 'disk', op: 'transfer', id: 3, drive: 0, side: 0, track: 41, sector: 1, count: 1 });
  const one = r.render(0.04);
  assert.deepEqual(r.eng.sampler.counts, { disk_step: 1 });
  assert.ok(finite(seek) && finite(rest) && finite(one));
  // Levels against the idle machine, as measured in the recording (tools/audio/wp_levels.json).
  const lSeek = level(seek, 0, Math.round(0.19 * SR)).rms - idle.rms, lStep = level(one).peak - idle.rms;
  const i0 = rest.t.findIndex((x) => x >= lands.at(-1) - 0.002), lLoad = level(rest, i0, i0 + Math.round(0.06 * SR)).peak - idle.rms;
  t.diagnostic(`idle ${idle.rms.toFixed(1)} dBFS; seek RMS +${lSeek.toFixed(1)} dB (recorded +${RECORDED.seekRms}); single step peak ` +
    `+${lStep.toFixed(1)} (+${RECORDED.stepPeak}); head load peak +${lLoad.toFixed(1)} (+${RECORDED.headLoadPeak})`);
  assert.ok(Math.abs(idle.rms - BED_DBFS) < 1.5, `idle ${idle.rms.toFixed(1)} dBFS`);
  assert.ok(Math.abs(lSeek - RECORDED.seekRms) < 3, `seek ${lSeek.toFixed(1)} dB`);
  assert.ok(Math.abs(lStep - RECORDED.stepPeak) < 4, `step ${lStep.toFixed(1)} dB`);
  assert.ok(Math.abs(lLoad - RECORDED.headLoadPeak) < 4, `head load ${lLoad.toFixed(1)} dB`);
});

test('a strike stands over the idle machine as documented, and over a seek', (t) => {
  const r = new Rig({ samples: true });
  r.eng.sampler.humLift = 1;
  r.render(1.0);
  const idle = level(r.render(0.5));
  let pk = -200;
  for (const ch of 'mwe') { r.print(text(ch)); pk = Math.max(pk, level(r.render(0.15)).peak); }
  t.diagnostic(`strike peak ${pk.toFixed(1)} dBFS, ${(pk - idle.rms).toFixed(1)} dB over the idle machine`);
  // 10.4: the recording has no printing, so a strike keeps its assumed level, about 32 dB over the idle machine.
  assert.ok(pk - idle.rms > 28 && pk - idle.rms < 38, `${(pk - idle.rms).toFixed(1)} dB`);
  assert.ok(pk - idle.rms > RECORDED.seekRms + 15, 'a strike well over a seek');
});

test('the hums run while their units are powered and stop when they are not', () => {
  const r = new Rig({ samples: true });
  r.render(1.0);
  const on = level(r.render(0.5));
  const loops = r.eng.sampler.loops;
  assert.deepEqual(loops.map((L) => L.kind).sort(), ['fan', 'motor']);
  assert.ok(loops.every((L) => L.g > 0.9), loops.map((L) => L.g).join(' '));
  r.sim.setStationPower(false);
  const g = r.sim.grab('printerPower', 0, { target: -0.1 });
  r.render(0.3); r.sim.release(g);
  r.render(1.0);
  const off = level(r.render(0.5));
  assert.ok(off.rms < on.rms - 10, `on ${on.rms.toFixed(1)}, off ${off.rms.toFixed(1)} dBFS`);
  // Cold: nothing runs until the module is switched on; then the fan and the motors run up and the hum comes.
  const c = new Rig({ samples: true, cold: true });
  c.sim.setStationPower(false);                     // as the kit does for ?cold
  const cold = level(c.render(0.5));
  assert.ok(c.eng.sampler.loops.every((L) => L.g < 1e-3) && cold.rms < BED_DBFS - 20, `cold ${cold.rms.toFixed(1)} dBFS`);
  c.sim.setStationPower(true);
  c.render(3.0);
  const up = level(c.render(0.5));
  assert.ok(up.rms > BED_DBFS - 4, `after power on ${up.rms.toFixed(1)} dBFS`);
});

test('the keyboard mechanism sounds its presses and releases, at the level measured against the machine', () => {
  // The mechanism: a press meets the felt, a release comes home on the top stop; each an event with the stem's speed.
  const heard = [];
  const kb = new KeyboardHost(() => {}, () => 0);
  kb.onSound = (e) => heard.push(e);
  const A = KEY_BY_POS[38].index, SPACE = KEY_BY_POS[64].index, SHIFT = KEY_BY_POS[50].index;
  kb.press(A, 1.2); kb.advance(0.06);
  kb.queue.push({ t: 0.06, i: A, f: 0 }); kb.advance(0.2);
  // The stem meets the felt, rebounds on it a few times, and later comes home once.
  const presses = heard.filter((e) => e.kind === 'press'), releases = heard.filter((e) => e.kind === 'release');
  assert.ok(Math.abs(presses[0].v - V_PRESS) < 0.1 && presses[0].t > 0.003 && presses[0].t < 0.01, JSON.stringify(presses[0]));
  assert.ok(presses.slice(1).every((e, k) => e.v < 0.6 * presses[k].v && e.t - presses[0].t < 0.02), JSON.stringify(presses));
  assert.ok(releases.length === 1 && releases[0].v > 0.5 && releases[0].t > 0.06, JSON.stringify(releases));
  const { manifest } = readSamples('samples_wpkeys');
  const voiced = new KeyVoicer(manifest);
  assert.deepEqual(heard.map((e) => voiced.voice(e)?.item.set).filter(Boolean), ['key_press', 'key_release'], 'the rebounds are part of the press');
  // A slower stem is quieter.
  const gain = (v) => { const kv = new KeyVoicer(manifest); let s = 0; for (let k = 0; k < 30; k++) s += kv.voice({ kind: 'press', key: A, v, t: k }).gain; return s; };
  assert.ok(gain(0.6) < 0.7 * gain(V_PRESS));
  // Classes: the space bar and the wide keys have their own cuts.
  const kv = new KeyVoicer(manifest);
  assert.equal(keyClass(SPACE), 'space'); assert.equal(keyClass(SHIFT), 'wide'); assert.equal(keyClass(A), 'key');
  assert.match(kv.voice({ kind: 'press', key: SPACE, v: 1.2, t: 10 }).item.set, /^space_press/);
  assert.match(kv.voice({ kind: 'release', key: SHIFT, v: 1, t: 10 }).item.set, /^wide_release/);
  assert.equal(kv.voice({ kind: 'press', key: SPACE, v: 1.2, t: 10.01 }), null, 'a felt rebound is part of the same press');
  // Repeats differ: a key cycles through its own cuts, with varied level and rate.
  const v4 = [0, 1, 2, 3].map((k) => kv.voice({ kind: 'press', key: A, v: V_PRESS, t: 20 + k }));
  assert.ok(new Set(v4.map((v) => v.item.id)).size > 1 || new Set(v4.map((v) => v.gain.toFixed(4))).size > 1);
  assert.ok(new Set(v4.map((v) => v.rate.toFixed(4))).size > 1);
  // Level: a typical press peaks PRESS_OVER_BED_DB over the idle machine, as in the recording; releases under it.
  assert.equal(KEY_BED_DBFS, BED_DBFS);
  assert.ok(Math.abs(PRESS_OVER_BED_DB - RECORDED.keyPressPeak) < 0.5);
  const median = (kind) => {
    const v = new KeyVoicer(manifest), out = [];
    for (let k = 0; k < 600; k++) {
      const x = v.voice({ kind, key: [A, SPACE, SHIFT, KEY_BY_POS[24 + (k % 10)].index][k % 4], v: kind === 'press' ? V_PRESS : 1.0, t: k });
      if (x) out.push(20 * Math.log10(0.7 * x.gain));
    }
    return out.sort((a, b) => a - b)[out.length >> 1];
  };
  const p = median('press'), rl = median('release');
  assert.ok(Math.abs(p - (BED_DBFS + PRESS_OVER_BED_DB)) < 2, `press ${p.toFixed(1)} dBFS`);
  assert.ok(rl < p - 2 && rl > BED_DBFS + RECORDED.keyReleasePeak - 4, `release ${rl.toFixed(1)} dBFS`);
});

test('the hum is lifted for small speakers, and only it', () => {
  const r = new Rig({ samples: true });
  r.render(1.0);
  const lifted = level(r.render(0.5)).rms;
  r.eng.sampler.humLift = 1;
  r.render(0.3);
  const plain = level(r.render(0.5)).rms;
  assert.ok(Math.abs(lifted - plain - HUM_LIFT_DB) < 2, `lift ${(lifted - plain).toFixed(1)} dB`);
});

// ---- the generated hum (10.4 item 4) and the latch (10.4 item 7) ---------------------------------------------------

/** In-place radix-2 FFT of re, im (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const w = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(w * k), s = Math.sin(w * k), a = i + k, b = a + len / 2;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}
/** One-sided power spectral density (per Hz) by Welch's method, Hann windows of n, half overlap. */
function psd(x, sr, n = 32768) {
  const win = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const w2 = win.reduce((s, v) => s + v * v, 0), p = new Float64Array(n / 2 + 1);
  let m = 0;
  for (let o = 0; o + n <= x.length; o += n / 2, m++) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[o + i] * win[i];
    fft(re, im);
    for (let k = 0; k <= n / 2; k++) p[k] += ((k === 0 || k === n / 2 ? 1 : 2) * (re[k] ** 2 + im[k] ** 2)) / (sr * w2);
  }
  for (let k = 0; k < p.length; k++) p[k] /= m;
  return { p, df: sr / n };
}
const bandOf = ({ p, df }, lo, hi) => { let s = 0; for (let k = Math.ceil(lo / df); k * df < hi && k < p.length; k++) s += p[k] * df; return s; };

/** s seconds of the generated hum alone, motor plus fan. */
function humAlone(s, opts) {
  const h = new WpHum(SR, opts), n = Math.round(s * SR), x = new Float64Array(n), buf = new Float64Array(2 * BLOCK);
  for (let o = 0; o < n; o += BLOCK) {
    h.motor.fill(buf, 0, BLOCK); h.fan.fill(buf, BLOCK, BLOCK);
    for (let i = 0; i < BLOCK && o + i < n; i++) x[o + i] = buf[i] + buf[BLOCK + i];
  }
  return { h, x };
}

test('the idle hum is generated: it has no loop period', (t) => {
  // The machine as heard, through the engine: 4 s apart, the idle sound is not the same sound.
  const r = new Rig({ samples: true });
  r.render(1.0);
  assert.ok(r.eng.sampler.loops.every((L) => L.voice), 'the hum voices are generated, not cut from the sprite');
  const o = r.render(8.5), N = 4 * SR, a0 = Math.round(0.25 * SR);
  const mid = (i) => 0.5 * (o.L[i] + o.R[i]);
  const corr = (lag) => {
    let xy = 0, xx = 0, yy = 0;
    for (let i = a0; i < a0 + N; i++) { const x = mid(i), y = mid(i + lag); xy += x * y; xx += x * x; yy += y * y; }
    return xy / Math.sqrt(xx * yy);
  };
  const r4 = corr(4 * SR), r1 = corr(1);
  t.diagnostic(`autocorrelation at 4 s ${r4.toFixed(3)} (one sample ${r1.toFixed(3)})`);
  assert.ok(Math.abs(r4) < 0.2, `4 s apart the hum correlates at ${r4.toFixed(3)}; a 4 s loop would at 1`);
  assert.ok(r1 > 0.5, 'the measure itself is sound: adjacent samples correlate');
  // And the two 4 s windows differ sample by sample by about as much as they are loud.
  let d = 0, e = 0;
  for (let i = a0; i < a0 + N; i++) { d += (mid(i) - mid(i + N)) ** 2; e += mid(i) ** 2; }
  assert.ok(d / e > 1.5, `difference ${(d / e).toFixed(2)} of the power`);
});

test('the generated hum has the analysed level and spectrum', (t) => {
  // At the recorded machine's 50 Hz line, the hum is the recording's analysis (tools/audio/wp_hum.json) at scale 1.
  const { h, x } = humAlone(16, { mainsHz: 50 });
  const S = psd(x, SR), dbp = (pw) => 10 * Math.log10(pw);
  const total = dbp(x.reduce((s, v) => s + v * v, 0) / x.length);
  t.diagnostic(`hum ${total.toFixed(2)} dBFS, analysis ${HUM.modelRmsDb} (motor ${dbp(h.motor.power).toFixed(2)}, fan ${dbp(h.fan.power).toFixed(2)})`);
  assert.ok(Math.abs(total - HUM.modelRmsDb) < 0.6, `RMS ${total.toFixed(2)} dBFS against ${HUM.modelRmsDb}`);
  assert.ok(Math.abs(dbp(h.motor.power) - HUM.motor.rmsDb) < 1 && Math.abs(dbp(h.fan.power) - HUM.fan.rmsDb) < 1);
  // The noise floor in third-octave bands, the tones' lines (+-4 Hz) left out: within 3 dB of the analysis where the band
  // is within 15 dB of the loudest, 6 dB elsewhere (the floor rises 15 dB an octave to 200 Hz, steeper than the bank's skirts). Then each tone: its line's power over the floor, within 2 dB.
  const bands = [...HUM.motor.bands, ...HUM.fan.bands], tones = [...HUM.motor.tones, ...HUM.fan.tones];
  const nearTone = (f) => tones.some((u) => Math.abs(f - u.hz) < 4);
  const floorOf = (lo, hi) => {
    let s = 0, n = 0, m = 0;
    for (let k = Math.ceil(lo / S.df); k * S.df < hi && k < S.p.length; k++) { n++; if (!nearTone(k * S.df)) { s += S.p[k] * S.df; m++; } }
    return { pw: (s * n) / Math.max(1, m), density: s / Math.max(1, m * S.df) };
  };
  const top = Math.max(...bands.map((b) => b.db)), off = [];
  for (const b of bands) {
    if (b.hz * 2 ** (1 / 6) > 0.45 * SR || b.db < top - 40) continue;
    const e = dbp(floorOf(b.hz * 2 ** (-1 / 6), b.hz * 2 ** (1 / 6)).pw) - b.db;
    off.push(`${Math.round(b.hz)}:${e.toFixed(1)}`);
    assert.ok(Math.abs(e) < (b.db > top - 15 ? 3 : 6), `${b.hz} Hz band ${e.toFixed(1)} dB off the analysis`);
  }
  t.diagnostic(`noise bands, dB off the analysis: ${off.join(' ')}`);
  const toneOff = [];
  // Lines closer than 8 Hz (220 and 224 Hz, 850 and 852 Hz) are measured together.
  const groups = [];
  for (const u of [...tones].sort((x, y) => x.hz - y.hz)) {
    const g = groups.at(-1);
    if (g && u.hz - g.hi < 8) { g.hi = u.hz; g.pw += 10 ** (u.db / 10); } else groups.push({ lo: u.hz, hi: u.hz, pw: 10 ** (u.db / 10) });
  }
  for (const u of groups) {
    const fl = floorOf(u.lo - 30, u.hi + 30).density, w = u.hi - u.lo + 8;
    const e = dbp(bandOf(S, u.lo - 4, u.hi + 4) - fl * w) - dbp(u.pw);
    toneOff.push(`${u.lo}:${e.toFixed(1)}`);
    assert.ok(Math.abs(e) < 2, `${u.lo} Hz tone ${e.toFixed(1)} dB off the analysis`);
  }
  t.diagnostic(`tones, dB off: ${toneOff.join(' ')}`);
  // The tones: each line stands over its neighbourhood; at this machine's 60 Hz line the motors' play at 1.2 times.
  const line = (Sx, hz) => dbp(bandOf(Sx, hz - 3, hz + 3)) - dbp(bandOf(Sx, hz + 10, hz + 40) / 5);
  assert.ok(line(S, 100.1) > 6 && line(S, 220.2) > 10, `100 Hz ${line(S, 100.1).toFixed(1)}, 220 Hz ${line(S, 220.2).toFixed(1)} dB`);
  const S60 = psd(humAlone(8, { mainsHz: 60 }).x, SR);
  assert.ok(line(S60, 120.1) > 6 && line(S60, 264.2) > 10 && line(S60, 100.1) < 3, 'the hum at 120 Hz on a 60 Hz line');
});

test('the hum plays at the old loops\' level: the idle machine at BED_DBFS, lifted by HUM_LIFT_DB', () => {
  const r = new Rig({ samples: true });
  r.render(1.0);
  const lifted = level(r.render(1.0)).rms;
  assert.ok(Math.abs(lifted - (BED_DBFS + HUM_LIFT_DB)) < 1.5, `idle ${lifted.toFixed(1)} dBFS`);
});

/** Run a rig, adding an acoustic event at the first sample of the next block; the peak of the 40 ms after it. */
function eventPeak(r, type, a, b) {
  let pending = true;
  const cap = r.eng.synth.capture.bind(r.eng.synth);
  r.eng.synth.capture = (i) => { if (pending) { r.sim.ac(type, a, b); pending = false; } cap(i); };
  const o = r.render(0.04);
  r.eng.synth.capture = cap;
  return level(o).peak;
}

test('the latch and the diskette sound from their contact events, louder with speed', (t) => {
  const r = new Rig({ samples: true });
  r.eng.sampler.humLift = 1;
  r.render(1.0);
  const idle = level(r.render(0.3));
  // Drive 0 is warm-started with its lever closed: a LEVER event is it reaching its closed end.
  const shut = eventPeak(r, WAC.LEVER, 0, 25); r.render(0.3);
  const home = eventPeak(r, WAC.SLIDE_HOME, 0, 1.0); r.render(0.3);
  const tick = eventPeak(r, WAC.SLIDE_IN, 0, 1.0); r.render(0.3);
  // The scaling with speed, with the hum out of the way.
  r.eng.sampler.humLift = 0;
  r.render(0.5);
  const pair = (type, fast, slow) => { const a = eventPeak(r, type, 0, fast); r.render(0.3); const b = eventPeak(r, type, 0, slow); r.render(0.3); return [a, b]; };
  const [shutQ, shutSlow] = pair(WAC.LEVER, 25, 8), [homeQ, homeSlow] = pair(WAC.SLIDE_HOME, 1.0, 0.3), [tickQ, tickSlow] = pair(WAC.SLIDE_IN, 1.0, 0.3);
  t.diagnostic(`idle ${idle.rms.toFixed(1)} dBFS RMS, ${idle.peak.toFixed(1)} peak; lever shut ${shut.toFixed(1)} (alone ${shutQ.toFixed(1)}, ` +
    `at 8 rad/s ${shutSlow.toFixed(1)}), diskette home ${home.toFixed(1)} (${homeQ.toFixed(1)}, at 0.3 m/s ${homeSlow.toFixed(1)}), ` +
    `past the lip ${tick.toFixed(1)} (${tickQ.toFixed(1)}, ${tickSlow.toFixed(1)}) dBFS peak`);
  // The lever closing near the assumed -28 dBFS peak: over a seek's RMS, under a strike.
  assert.ok(Math.abs(shut - -28) < 3, `lever ${shut.toFixed(1)} dBFS`);
  assert.ok(shut > BED_DBFS + RECORDED.seekRms + 5, 'a lever clack stands over a seek');
  assert.ok(home > idle.peak + 4 && tick > idle.rms + 6, 'the diskette is heard over the machine');
  assert.ok(home < shut + 2 && tick < home, 'a tick under the knock home');
  // (v / ref)^0.8: a third of the speed is 7.6 to 8.4 dB down (less where the quiet machine's own peaks come through).
  for (const [n, fast, slow, ratio] of [['lever', shutQ, shutSlow, 25 / 8], ['home', homeQ, homeSlow, 1 / 0.3], ['lip', tickQ, tickSlow, 1 / 0.3]]) {
    const want = 16 * Math.log10(ratio);
    assert.ok(fast - slow > 4 && fast - slow < want + 2, `${n}: ${(fast - slow).toFixed(1)} dB for ${ratio.toFixed(2)} times the speed (${want.toFixed(1)})`);
  }
});

test('the mechanism emits the lever and diskette contacts, and they sound', () => {
  const r = new Rig({ samples: true });
  r.eng.sampler.humLift = 0;         // against the quiet machine: the latch's sounds alone stand out
  const seen = [];
  const cap = r.eng.synth.capture.bind(r.eng.synth);
  r.eng.synth.capture = (i) => { for (let e = 0; e < r.sim.acN; e++) seen.push({ k: r.sim.acQ[e * 3], a: r.sim.acQ[e * 3 + 1], v: r.sim.acQ[e * 3 + 2] }); cap(i); };
  r.render(1.0);
  const idle = level(r.render(0.3));
  const step = (fn, s) => { seen.length = 0; const g = fn(); const o = r.render(s); r.sim.release(g); return { ev: seen.slice(), lv: level(o) }; };
  const open = step(() => r.sim.grab('lever', 0, { target: -0.2 }), 0.5);
  const pull = step(() => r.sim.grab('disketteSlide', 0, { target: -0.01 }), 0.8);
  r.sim.command({ dev: 'disk', op: 'media', drive: 0, mediaId: null });
  r.sim.command({ dev: 'disk', op: 'media', drive: 0, mediaId: 'NEW' });
  const push = step(() => r.sim.grab('disketteSlide', 0, { target: 0.3 }), 0.8);
  const close = step(() => r.sim.grab('lever', 0, { target: Math.PI / 2 + 0.2 }), 0.5);
  const has = (s, k) => s.ev.some((e) => e.k === k && e.a === 0 && e.v > 0.1);
  assert.ok(has(open, WAC.LEVER) && has(close, WAC.LEVER), 'the lever reaches its ends');
  assert.ok(has(pull, WAC.SLIDE_OUT), 'the diskette leaves the guide');
  assert.ok(has(push, WAC.SLIDE_IN) && has(push, WAC.SLIDE_HOME), 'a diskette enters the guide and meets its stop');
  for (const [n, s] of Object.entries({ open, pull, push, close })) assert.ok(s.lv.peak > idle.peak + 6, `${n}: ${s.lv.peak.toFixed(1)} dBFS peak`);
  assert.ok(pull.lv.rms > idle.rms + 3 && push.lv.rms > idle.rms + 3, `the jacket scrapes in its guide: ${pull.lv.rms.toFixed(1)}, ${push.lv.rms.toFixed(1)} against ${idle.rms.toFixed(1)} dBFS`);
});
