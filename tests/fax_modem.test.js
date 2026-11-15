// The fax modems (M3): V.21 channel 2, V.27ter and V.29, transmitted and received as real 8 kHz line audio through
// the channel model; the scramblers and constellations; the T.30 modem port over audio. Constants marked [M] in the
// sources are from memory of the Recommendations; docs/fax/research.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTransmitter, createReceiver, bitSource, zerosSource, tcfBits, modulationForRate, ErrorCounter, MODEMS } from '../src/fax/modem/index.js';
import { V29Scrambler, V29Descrambler, V27terScrambler, V27terDescrambler, Prbs7 } from '../src/fax/modem/scrambler.js';
import { v29Point, PHASE_CHANGE, V29Transmitter } from '../src/fax/modem/v29.js';
import { V27terTransmitter } from '../src/fax/modem/v27ter.js';
import { V21 } from '../src/fax/modem/v21.js';
import { AudioLink, runAudioCall, TRAINING_SECONDS } from '../src/fax/modem/audio-port.js';
import { Channel, PRESETS } from '../src/fax/line/channel.js';
import { Rng, LINE_RATE, rmsToDbm0 } from '../src/fax/line/levels.js';
import { T30Caller } from '../src/fax/t30/caller.js';
import { T30Answerer } from '../src/fax/t30/answerer.js';
import { T30Endpoint } from '../src/fax/t30/endpoint.js';
import { stubSource } from '../src/fax/t30/stub-page.js';

const R = LINE_RATE;
const HIGH = [['v29', 9600], ['v29', 7200], ['v29', 4800], ['v27ter', 4800], ['v27ter', 2400]];

function randomBits(n, seed) {
  const rng = new Rng(seed), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = rng.bit();
  return out;
}

/** TX -> channel -> RX. Returns the received bits and the receiver's stats. */
function loopback(kind, rate, channel, data, { seed = 3, block = 256 } = {}) {
  const tx = createTransmitter(kind, { rate, source: bitSource(data) });
  const got = [];
  let trained = null, carrierOn = 0;
  const rx = createReceiver(kind, { rate, sink: { bit: (b) => got.push(b), trained: (r) => { trained = r; }, carrier: (on) => { if (on) carrierOn++; } } });
  const ch = new Channel(channel, { seed });
  const buf = new Float32Array(block), out = new Float32Array(block);
  let tail = 0, samples = 0;
  while (!tx.done || tail < 0.1 * R) {
    tx.process(buf, 0, block);
    if (tx.done) tail += block;
    ch.process(buf, 0, out, 0, block);
    rx.process(out, 0, block);
    samples += block;
  }
  let errors = 0;
  for (let i = 0; i < data.length; i++) if (got[i] !== data[i]) errors++;
  return { got, errors, trained, stats: rx.stats, carrierOn, seconds: samples / R };
}

/** Real FFT power spectrum (Hann), radix 2. */
function spectrum(x, fs = R) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (x.length - 1)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k), u = i + k, v = u + len / 2;
      const tr = re[v] * wr - im[v] * wi, ti = re[v] * wi + im[v] * wr;
      re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
    }
  }
  const p = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return { p, df: fs / n };
}
const bandShare = ({ p, df }, f1, f2) => {
  let a = 0, s = 0;
  for (let i = 1; i < p.length; i++) { s += p[i]; if (i * df >= f1 && i * df <= f2) a += p[i]; }
  return a / s;
};
const centroid = ({ p, df }) => { let a = 0, s = 0; for (let i = 1; i < p.length; i++) { a += i * df * p[i]; s += p[i]; } return a / s; };

function render(kind, rate, bits) {
  const tx = createTransmitter(kind, { rate, source: bitSource(bits) });
  const chunks = [];
  while (!tx.done) { const b = new Float32Array(256); tx.process(b, 0, 256); chunks.push(b); }
  const out = new Float32Array(chunks.length * 256);
  chunks.forEach((c, i) => out.set(c, i * 256));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

test('scramblers: self-synchronising both ways, V.27ter guard breaks repeating patterns, the training PRBS has period 127', () => {
  for (const [S, D, sync] of [[V29Scrambler, V29Descrambler, 23], [V27terScrambler, V27terDescrambler, 12]]) {
    const data = randomBits(5000, 1), s = new S(), d = new D();
    d.reset(0x5a5a5);                     // a receiver starting in the wrong state
    let errs = 0;
    for (let i = 0; i < data.length; i++) if (d.descramble(s.scramble(data[i])) !== data[i] && i >= sync + 40) errs++;
    assert.equal(errs, 0, S.name);
  }
  // V.27ter: a long run of ones in, the line never repeats with period 1 for more than about 33 bits.
  const s = new V27terScrambler();
  let run = 0, maxRun = 0, prev = -1;
  for (let i = 0; i < 4000; i++) { const b = s.scramble(1); run = b === prev ? run + 1 : 1; prev = b; maxRun = Math.max(maxRun, run); }
  assert.ok(maxRun < 40, `run ${maxRun}`);
  const p = new Prbs7(), seq = Array.from({ length: 254 }, () => p.next());
  assert.deepEqual(seq.slice(0, 127), seq.slice(127));
  for (let per = 1; per < 127; per++) assert.ok(seq.slice(0, 127).some((b, i) => b !== seq[i + per]), `period ${per}`);
});

test('V.29 constellation and phase code: 16 points, Gray-coded phase changes', () => {
  const pts = new Set();
  for (let p = 0; p < 8; p++) for (const q of [0, 1]) pts.add(v29Point(p, q).join(','));
  const want = ['3,0', '0,3', '-3,0', '0,-3', '5,0', '0,5', '-5,0', '0,-5', '1,1', '-1,1', '-1,-1', '1,-1', '3,3', '-3,3', '-3,-3', '3,-3'];
  assert.deepEqual([...pts].sort(), want.sort());
  // Neighbouring phase changes (45 degrees apart) differ in exactly one bit.
  const inv = new Array(8); PHASE_CHANGE.forEach((c, b) => { inv[c] = b; });
  for (let c = 0; c < 8; c++) { const x = inv[c] ^ inv[(c + 1) & 7]; assert.ok(x && !(x & (x - 1)), `phase ${c}`); }
  assert.deepEqual([...PHASE_CHANGE], [1, 0, 2, 3, 6, 7, 5, 4]);
});

test('training durations: the real sequences, and what the T.30 port reports', () => {
  assert.ok(Math.abs(V29Transmitter.trainingSeconds() - 608 / 2400) < 1e-9);
  assert.ok(Math.abs(TRAINING_SECONDS[4800] - (0.205 + 1096 / 1600)) < 1e-9);
  assert.ok(Math.abs(TRAINING_SECONDS[2400] - (0.205 + 1180 / 1200)) < 1e-9);
  // A transmitter's audio lasts its training plus the data plus the pulse tail.
  for (const [kind, rate] of HIGH) {
    const bits = new Uint8Array(rate);       // one second of zeros
    const x = render(kind, rate, bits);
    const tr = modulationForRate(rate) === kind ? TRAINING_SECONDS[rate] : V29Transmitter.trainingSeconds();
    const secs = x.length / R;
    assert.ok(secs >= tr + 1 && secs <= tr + 1 + 0.06, `${kind} ${rate}: ${secs} s`);
    // Level: -10 dBm0 over the data.
    const lvl = rmsToDbm0(Math.sqrt(x.subarray(Math.round((tr + 0.1) * R), Math.round((tr + 0.9) * R)).reduce((s, v) => s + v * v, 0) / (0.8 * R)));
    assert.ok(Math.abs(lvl + 10) < 0.7, `${kind} ${rate} level ${lvl.toFixed(2)}`);
  }
});

test('spectra: each modem sits in its band, V.21 on its two tones', () => {
  const data = randomBits(20000, 4);
  const cases = [['v29', 9600, 1700, 200, 3200], ['v29', 4800, 1700, 200, 3200], ['v27ter', 4800, 1800, 600, 3000], ['v27ter', 2400, 1800, 900, 2700]];
  for (const [kind, rate, fc, lo, hi] of cases) {
    const x = render(kind, rate, data.subarray(0, rate * 2));
    const tr = Math.round((kind === 'v29' ? 0.26 : TRAINING_SECONDS[rate] + 0.01) * R);
    const s = spectrum(x.subarray(tr, tr + 8192));
    assert.ok(Math.abs(centroid(s) - fc) < 60, `${kind} ${rate} centroid ${centroid(s).toFixed(0)}`);
    assert.ok(bandShare(s, lo, hi) > 0.97, `${kind} ${rate} in ${lo}-${hi}: ${bandShare(s, lo, hi)}`);
  }
  const ones = render('v21', 300, new Uint8Array(300).fill(1)), zeros = render('v21', 300, new Uint8Array(300));
  const s1 = spectrum(ones.subarray(800, 4896)), s0 = spectrum(zeros.subarray(800, 4896));
  assert.ok(bandShare(s1, 1630, 1670) > 0.95, 'mark 1650 Hz');
  assert.ok(bandShare(s0, 1830, 1870) > 0.95, 'space 1850 Hz');
  const mixed = render('v21', 300, randomBits(600, 5));
  assert.ok(bandShare(spectrum(mixed.subarray(800, 800 + 8192 * 2)), 1400, 2100) > 0.95, 'V.21 in its channel');
});

test('V.21: HDLC-like bits through every preset with no errors', () => {
  const flags = []; for (let i = 0; i < 38; i++) flags.push(0, 1, 1, 1, 1, 1, 1, 0);
  const data = Uint8Array.from([...flags, ...randomBits(6000, 6)]);
  for (const preset of Object.keys(PRESETS)) {
    const r = loopback('v21', 300, preset, data);
    // The carrier detector may take the first bits of the preamble (it is there for that): align on the data.
    let best = Infinity;
    for (let off = -16; off <= 0; off++) {
      let e = 0;
      for (let i = flags.length; i < data.length; i++) if (r.got[i + off] !== data[i]) e++;
      best = Math.min(best, e);
    }
    assert.equal(best, 0, `${preset}: ${best} errors`);
    assert.equal(r.carrierOn, 1, preset);
  }
});

test('loop-back, every high-speed modem and rate: 100 kbit with no errors on the clean and typical lines', () => {
  const data = randomBits(100000, 8);
  for (const [kind, rate] of HIGH) {
    for (const preset of ['clean', 'typical']) {
      const r = loopback(kind, rate, preset, data);
      assert.ok(r.trained, `${kind} ${rate} ${preset} trained`);
      assert.equal(r.errors, 0, `${kind} ${rate} ${preset}: ${r.errors} errors`);
    }
  }
});

test('the bad line: V.29 9600 makes errors, 4800 (V.29 and V.27ter) gets through clean', () => {
  const data = randomBits(100000, 9);
  const r96 = loopback('v29', 9600, 'bad', data);
  assert.ok(r96.errors / data.length > 1e-4, `9600 BER ${r96.errors / data.length}`);
  for (const [kind, rate] of [['v29', 4800], ['v27ter', 4800], ['v27ter', 2400]]) {
    const r = loopback(kind, rate, 'bad', data);
    assert.equal(r.errors, 0, `${kind} ${rate}: ${r.errors} errors`);
  }
});

test('TCF judgement emerges from the signal: 1.5 s of zeros, error-free on typical, errors at 9600 on bad', () => {
  for (const [preset, rate, clean] of [['typical', 9600, true], ['bad', 9600, false], ['bad', 4800, true]]) {
    const n = tcfBits(rate);
    const r = loopback(modulationForRate(rate), rate, preset, new Uint8Array(n));
    const c = new ErrorCounter(() => 0);
    for (let i = 0; i < n; i++) c.push(r.got[i]);
    assert.equal(c.errors === 0, clean, `${preset} ${rate}: ${c.errors} errors`);
    assert.ok(r.trained.mseDb < -12, `training quality ${r.trained.mseDb}`);
  }
});

test('bit error rate against SNR, every rate (the table in the report)', (t) => {
  const snrs = [30, 26, 23, 20, 17, 14, 11];
  const rows = [];
  const table = {};
  for (const [kind, rate] of HIGH) {
    const data = randomBits(Math.max(20000, rate * 3), 10);
    const row = [];
    for (const snr of snrs) {
      const r = loopback(kind, rate, { ...PRESETS.typical, snrDb: snr }, data, { seed: snr });
      row.push(r.trained ? r.errors / data.length : 1);
    }
    table[`${kind} ${rate}`] = row;
    rows.push(`${`${kind} ${rate}`.padEnd(12)} ${row.map((b) => (b === 0 ? '0' : b.toExponential(1)).padStart(8)).join(' ')}`);
  }
  t.diagnostic(`BER vs SNR (dB) ${snrs.map((s) => String(s).padStart(8)).join(' ')}`);
  for (const r of rows) t.diagnostic(r);
  // Clean at 30 dB for all; at 17 dB 9600 is in trouble and 2400 is not; error rates rise as SNR falls.
  for (const k of Object.keys(table)) assert.equal(table[k][0], 0, k);
  assert.ok(table['v29 9600'][4] > 1e-4);
  assert.equal(table['v27ter 2400'][4], 0);
  assert.ok(table['v29 9600'][6] > table['v29 9600'][4]);
});

test('the T.30 stack over audio: a page at 9600 on a typical line, and a step-down on a bad one', () => {
  const run = (preset) => {
    const link = new AudioLink({ preset, seed: 3 });
    const evA = [], evB = [];
    const A = new T30Endpoint(new T30Caller({ ident: '+1 555 0100', source: stubSource({ pages: 1, lines: 60 }) }), link.a, { name: 'A', onEvent: (a, t) => evA.push({ t, ...a }) });
    const B = new T30Endpoint(new T30Answerer({ ident: '+1 555 0199' }), link.b, { name: 'B', onEvent: (a, t) => evB.push({ t, ...a }) });
    runAudioCall([A, B], link, { until: 120 });
    return { link, evA, evB };
  };
  const ok = run('typical');
  const recv = ok.evB.find((e) => e.type === 'page-received');
  assert.equal(recv.response, 'MCF');
  assert.equal(ok.evA.find((e) => e.type === 'hangup').reason, 'complete');
  const tcfRates = ok.link.a.log.filter((l) => l.kind === 'tcf').map((l) => l.rate);
  assert.deepEqual(tcfRates, [9600]);
  const frames = ok.link.b.log.filter((l) => l.kind === 'v21').map((l) => l.frames.join(' '));
  assert.deepEqual(frames, ['CSI DIS', 'CFR', 'MCF']);
  const bad = run('bad');
  const rates = bad.link.a.log.filter((l) => l.kind === 'tcf').map((l) => l.rate);
  assert.equal(rates[0], 9600);
  assert.ok(rates.at(-1) < 9600, `stepped down: ${rates}`);
  assert.ok(bad.link.b.log.some((l) => l.kind === 'v21' && l.frames.includes('FTT')));
  assert.equal(bad.evA.find((e) => e.type === 'hangup').reason, 'complete');
});

test('cost per second of audio, transmit and receive, against the plan budget (7.2: a call under 15 % of a core)', (t) => {
  const lines = [];
  const data = randomBits(100000, 12);
  for (const [kind, rate] of [['v21', 300], ...HIGH]) {
    const bits = data.subarray(0, rate * 4);
    let t0 = performance.now();
    const x = render(kind, rate, bits);
    const txMs = (performance.now() - t0) / (x.length / R);
    let rxMs0 = 0;
    for (let pass = 0; pass < 2; pass++) {      // the second pass, once the code is compiled
      const rx = createReceiver(kind, { rate, sink: {} });
      t0 = performance.now();
      for (let i = 0; i < x.length; i += 128) rx.process(x, i, Math.min(128, x.length - i));
      rxMs0 = performance.now() - t0;
    }
    const rxMs = rxMs0 / (x.length / R);
    lines.push(`${`${kind} ${rate}`.padEnd(12)} TX ${txMs.toFixed(2).padStart(6)} ms/s   RX ${rxMs.toFixed(2).padStart(6)} ms/s`);
    assert.ok(rxMs < 60 && txMs < 30, `${kind} ${rate} too slow`);
  }
  const ch = new Channel('typical'), x = new Float32Array(10 * R), y = new Float32Array(10 * R);
  let t0 = performance.now();
  ch.process(x, 0, y, 0, x.length);
  lines.push(`channel      ${((performance.now() - t0) / 10).toFixed(2)} ms/s`);
  for (const l of lines) t.diagnostic(l);
});

test('worklet hygiene: the line and modem modules use no DOM, timers or structuredClone', () => {
  for (const dir of ['src/fax/line', 'src/fax/modem']) {
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/.*$/gm, '');
      for (const bad of ['window', 'document', 'setTimeout', 'setInterval', 'structuredClone', 'Math.random', 'performance.now']) {
        assert.ok(!new RegExp(`\\b${bad.replace('.', '\\.')}\\b`).test(src), `${f} uses ${bad}`);
      }
    }
  }
  assert.deepEqual(Object.keys(MODEMS), ['v21', 'v27ter', 'v29']);
  assert.equal(V21.mark, 1650);
});
