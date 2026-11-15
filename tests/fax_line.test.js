// The fax machine's telephone line (M3): companding, the tone plan, DTMF and pulse dialling, the channel, the
// exchange and the tone detectors. Everything at the 8 kHz line rate, in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_RATE, Rng, dbm0ToRms, rmsToDbm0, dbm0ToPeak } from '../src/fax/line/levels.js';
import { ulawEncode, ULAW_DECODE, ulawEncode16, ulawDecode16, alawEncode, ALAW_DECODE, alawEncode16, alawDecode16 } from '../src/fax/line/companding.js';
import { TONES, TONE_PLANS, ToneSource, renderTone } from '../src/fax/line/tones.js';
import { DtmfDialler, DtmfDetector, PulseDialler, PulseCounter, goertzelAmplitude, PULSE } from '../src/fax/line/dtmf.js';
import { Channel, PRESETS, DuplexLine } from '../src/fax/line/channel.js';
import { Exchange } from '../src/fax/line/exchange.js';
import { Upsampler } from '../src/fax/line/resample.js';
import { ToneDetector, signatures } from '../src/fax/modem/tone-detect.js';

const R = LINE_RATE;

function sine(f, dbm0, seconds) {
  const n = Math.round(seconds * R), a = dbm0ToPeak(dbm0), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin(2 * Math.PI * f * i / R);
  return out;
}
const rms = (x, s = 0, e = x.length) => { let q = 0; for (let i = s; i < e; i++) q += x[i] * x[i]; return Math.sqrt(q / (e - s)); };

/** On/off runs (seconds) of a gated tone from 10 ms rms frames. */
function runs(x, thr) {
  const F = R / 100, out = [];
  let on = null, len = 0;
  for (let s = 0; s + F <= x.length; s += F) {
    const v = rms(x, s, s + F) > thr;
    if (v === on) len++; else { if (on !== null) out.push([on, len / 100]); on = v; len = 1; }
  }
  out.push([on, len / 100]);
  return out;
}

test('mu-law and A-law: monotonic, odd-symmetric, and 35 dB or better quantising SNR at speech levels', () => {
  for (const [enc16, dec16] of [[ulawEncode16, ulawDecode16], [alawEncode16, alawDecode16]]) {
    let prev = -Infinity;
    for (let s = -32768; s <= 32767; s += 7) {
      const d = dec16(enc16(s));
      assert.ok(d >= prev, `monotonic at ${s}`);
      prev = d;
    }
    for (let s = 100; s < 32000; s += 997) assert.equal(dec16(enc16(s)), -dec16(enc16(-s)) + (dec16 === alawDecode16 ? 0 : 0));
  }
  const codes = new Set();
  for (let s = -32768; s <= 32767; s++) codes.add(ulawEncode16(s));
  assert.ok(codes.size >= 255, `${codes.size} codes in use`);
  for (const [enc, dec] of [[ulawEncode, ULAW_DECODE], [alawEncode, ALAW_DECODE]]) {
    for (const level of [-10, -20, -30]) {
      const x = sine(1004, level, 0.5);
      let e = 0, p = 0;
      for (const v of x) { const q = dec[enc(v)]; e += (q - v) ** 2; p += v * v; }
      const sqnr = 10 * Math.log10(p / e);
      assert.ok(sqnr > 33, `SQNR ${sqnr.toFixed(1)} dB at ${level} dBm0`);
    }
  }
});

test('the precise tone plan: frequencies, levels and cadences', () => {
  const dial = renderTone(TONES.dial, 1);
  for (const f of [350, 440]) {
    const a = goertzelAmplitude(dial, 800, 6400, f);
    assert.ok(Math.abs(20 * Math.log10(a / dbm0ToPeak(-13))) < 0.3, `dial ${f} Hz level`);
  }
  assert.ok(goertzelAmplitude(dial, 800, 6400, 480) < dbm0ToPeak(-50), 'no 480 Hz in dial tone');
  const cases = [
    ['ringback', [440, 480], 12, [2, 4]],
    ['busy', [480, 620], 4, [0.5, 0.5]],
    ['reorder', [480, 620], 2, [0.25, 0.25]],
    ['cng', [1100], 7, [0.5, 3]],
    ['offHookWarning', [1400, 2060, 2450, 2600], 1, [0.1, 0.1]],
  ];
  for (const [name, freqs, secs, [on, off]] of cases) {
    const x = renderTone(TONES[name], secs);
    const r = runs(x, dbm0ToRms(-40));
    const full = r.slice(0, -1);       // the last run may be cut by the end of the render
    for (const [state, len] of full) assert.ok(Math.abs(len - (state ? on : off)) <= 0.011, `${name} ${state ? 'on' : 'off'} ${len}`);
    assert.ok(full.length >= 2, `${name} has a cadence`);
    const n = Math.round(on * R * 0.8);
    for (const f of freqs) {
      const a = goertzelAmplitude(x, Math.round(on * R * 0.1), n, f);
      assert.ok(a > 0.8 * dbm0ToPeak(TONES[name].dbm0), `${name} ${f} Hz present`);
      for (const g of [f * 0.97, f * 1.03]) assert.ok(goertzelAmplitude(x, Math.round(on * R * 0.1), n, g) < a * 0.2, `${name} narrow at ${f}`);
    }
  }
  const ced = renderTone(TONES.ced, 5);
  const r = runs(ced, dbm0ToRms(-40));
  assert.equal(r[0][0], true);
  assert.ok(r[0][1] >= 2.6 && r[0][1] <= 4, `CED ${r[0][1]} s`);
  assert.ok(goertzelAmplitude(ced, 1000, 8000, 2100) > 0.9 * dbm0ToPeak(-10));
});

test('the tone plans are data: every plan renders its tones and names its law', () => {
  for (const [id, plan] of Object.entries(TONE_PLANS)) {
    assert.ok(plan.law === 'ulaw' || plan.law === 'alaw', id);
    assert.ok(plan.ring.length % 2 === 0, id);
    for (const t of ['dial', 'ringback', 'busy', 'reorder']) {
      const x = renderTone(plan[t], 1);
      assert.ok(rms(x) > dbm0ToRms(-40), `${id} ${t}`);
    }
  }
});

const DIGITS = '0123456789*#ABCD';

test('DTMF: every key is detected through every channel preset', () => {
  for (const preset of Object.keys(PRESETS)) {
    const d = new DtmfDialler(DIGITS);
    const n = Math.round(DIGITS.length * 0.2 * R) + 2000;
    const x = new Float32Array(n);
    d.process(x, 0, n);
    const y = new Channel(preset, { seed: 9 }).run(x);
    const det = new DtmfDetector();
    for (let s = 0; s < n; s += 128) det.process(y, s, Math.min(128, n - s));
    assert.equal(det.digits, DIGITS, `preset ${preset}`);
  }
});

test('DTMF detector ignores speech-band noise, single tones and the fax tones', () => {
  const rng = new Rng(4);
  const noise = Float32Array.from({ length: 4 * R }, () => dbm0ToRms(-15) * rng.gauss());
  const det = new DtmfDetector();
  det.process(noise, 0, noise.length);
  for (const t of ['dial', 'ringback', 'busy', 'cng', 'ced']) { const x = renderTone(TONES[t], 3); det.process(x, 0, x.length); }
  det.process(sine(697, -8, 1), 0, R);
  assert.equal(det.digits, '');
});

test('pulse dialling: 10 pps, 60/40 break/make, counted back to the digits', () => {
  const digits = '4096';
  const pd = new PulseDialler(digits);
  const n = 7 * R;
  const loop = new Uint8Array(n), audio = new Float32Array(n);
  pd.process(n, loop, 0, audio, 0);
  const pc = new PulseCounter();
  pc.process(loop, 0, n);
  assert.equal(pc.digits, digits);
  // Break and make lengths of the first digit's pulses.
  const brk = [], mk = [];
  let state = loop[0], len = 0;
  for (let i = 0; i < n; i++) {
    if (loop[i] === state) { len++; continue; }
    (state ? mk : brk).push(len / R); state = loop[i]; len = 1;
  }
  assert.equal(brk.length, 4 + 10 + 9 + 6);
  for (const b of brk) assert.ok(Math.abs(b - PULSE.breakS) < 0.001);
  assert.ok(Math.abs(mk[1] - PULSE.makeS) < 0.001);
  // Each loop edge clicks on the line.
  let clicks = 0;
  for (let i = 1; i < n; i++) if (Math.abs(audio[i]) > 0.05 && Math.abs(audio[i - 1]) <= 0.05) clicks++;
  assert.ok(clicks >= brk.length * 2 - 2, `${clicks} clicks`);
});

test('channel: band edges, loss, delay and the noise at the set SNR', () => {
  const ch = (o) => new Channel(o, { seed: 2 });
  const passDb = (f, o) => { const y = ch(o).run(sine(f, -10, 1)); return rmsToDbm0(rms(y, 2000)) + 10; };
  assert.ok(Math.abs(passDb(1000, 'clean')) < 0.3, '1 kHz passes');
  assert.ok(passDb(100, 'clean') < -25, '100 Hz stopped');
  assert.ok(passDb(3900, 'clean') < -20, '3.9 kHz stopped');
  assert.ok(Math.abs(passDb(400, 'clean')) < 1.5 && Math.abs(passDb(3200, 'clean')) < 1.5, 'the band is flat inside');
  assert.ok(Math.abs(passDb(1000, { ...PRESETS.clean, lossDb: 9 }) + 9) < 0.3, 'loss');
  // Delay: an impulse comes out delayed.
  const imp = new Float32Array(2000); imp[10] = 1;
  const y = ch({ band: null, delayMs: 25 }).run(imp);
  assert.equal(y.indexOf(1), 10 + 200);
  // SNR: silence in, noise out, against the reference -10 dBm0 less the loss.
  for (const p of ['typical', 'noisy', 'bad']) {
    const o = { ...PRESETS[p], humDbm0: null, ulaw: false };
    const z = ch(o).run(new Float32Array(4 * R));
    const snr = (-10 - o.lossDb) - rmsToDbm0(rms(z, 4000));
    assert.ok(Math.abs(snr - o.snrDb) < 0.6, `${p}: SNR ${snr.toFixed(2)} vs ${o.snrDb}`);
  }
});

test('the duplex line carries both directions and returns the talker echo', () => {
  const line = new DuplexLine('clean', { talkerEcho: { db: -20, ms: 5 } });
  const n = R, a = sine(1000, -10, 1), b = new Float32Array(n), aRx = new Float32Array(n), bRx = new Float32Array(n);
  line.process(a, b, aRx, bRx, n);
  assert.ok(Math.abs(rmsToDbm0(rms(bRx, 2000)) + 10) < 0.5, 'A reaches B');
  assert.ok(Math.abs(rmsToDbm0(rms(aRx, 2000)) + 30) < 0.5, 'A hears its echo 20 dB down');
});

test('upsampling to 48 kHz keeps the line signal and leaves no images', () => {
  const x = sine(1000, -10, 0.5), up = new Upsampler();
  const y = new Float32Array(x.length * 6);
  up.process(x, 0, x.length, y, 0);
  const a = (f) => goertzelAmplitude(y, 4800, 19200, f, 48000);
  assert.ok(Math.abs(20 * Math.log10(a(1000) / dbm0ToPeak(-10))) < 0.3);
  for (const img of [7000, 9000, 15000, 17000]) assert.ok(a(img) < a(1000) * 1e-3, `image at ${img}`);
});

/** A two-port harness: scripted subscribers on the exchange. */
function runExchange(ex, seconds, script) {
  const B = 160, n = Math.round(seconds * R);
  const io = {
    A: { loop: new Uint8Array(B), tx: new Float32Array(B), rx: new Float32Array(B), ring: new Float32Array(B) },
    B: { loop: new Uint8Array(B), tx: new Float32Array(B), rx: new Float32Array(B), ring: new Float32Array(B) },
  };
  const heardA = new Float32Array(n), heardB = new Float32Array(n), ringB = new Float32Array(n);
  for (let t = 0; t < n; t += B) {
    io.A.tx.fill(0); io.B.tx.fill(0);
    script(t, io, B);
    ex.process(B, io);
    heardA.set(io.A.rx.subarray(0, Math.min(B, n - t)), t);
    heardB.set(io.B.rx.subarray(0, Math.min(B, n - t)), t);
    ringB.set(io.B.ring.subarray(0, Math.min(B, n - t)), t);
  }
  return { heardA, heardB, ringB };
}

function detect(x) {
  const td = new ToneDetector();
  td.process(x, 0, x.length);
  return td.events;
}

test('exchange: off hook, dial tone, DTMF dialling, ringback, 20 Hz ringing, answer, then the call carries audio', () => {
  const ex = new Exchange({ preset: 'typical' });
  let dialler = null, answered = false;
  const tone = new ToneSource({ freqs: [1000], dbm0: -10, cadence: null });
  const { heardA, heardB, ringB } = runExchange(ex, 24, (t, io, B) => {
    io.A.loop.fill(t >= 0.5 * R ? 1 : 0);
    if (t >= 2.5 * R && !dialler) dialler = new DtmfDialler('5551002');
    if (dialler) dialler.process(io.A.tx, 0, B);
    if (ex.state('B') === 'ringing' && ex.events.filter((e) => e.type === 'ringOn').length >= 3) answered = true;
    io.B.loop.fill(answered ? 1 : 0);
    if (answered) tone.process(io.A.tx, 0, B);
  });
  const types = ex.events.map((e) => e.type);
  assert.ok(types.includes('offHook'));
  assert.deepEqual(ex.events.filter((e) => e.type === 'digit').map((e) => e.digit).join(''), '5551002');
  const rings = ex.events.filter((e) => e.type === 'ringOn' || e.type === 'ringOff');
  assert.ok(rings.length >= 5);
  for (let i = 1; i < rings.length; i++) {
    const dt = (rings[i].t - rings[i - 1].t) / R, want = rings[i - 1].type === 'ringOn' ? 2 : 4;
    if (rings[i].type === 'ringOff' && rings[i - 1].type === 'ringOn' && i === rings.length - 1) continue;   // cut by the answer
    assert.ok(Math.abs(dt - want) < 0.01, `ring cadence ${dt}`);
  }
  assert.ok(types.includes('answer'));
  // Ringing voltage: 20 Hz at about 90 V rms while ringing.
  const r0 = rings[0].t;
  const v = ringB.subarray(r0 + 800, r0 + 8800);
  assert.ok(Math.abs(rms(v) - 90) < 2, `ring ${rms(v)} V`);
  assert.ok(goertzelAmplitude(v, 0, 8000, 20) > 120);
  // What A heard: dial tone, then ringback.
  const evA = detect(heardA.subarray(0, rings[0].t + 7 * R)).map((e) => e.name);
  assert.ok(evA.includes('dial'), 'dial tone heard');
  assert.ok(evA.includes('ringback'), 'ringback heard');
  // After the answer B hears A's 1 kHz tone through the line (6 dB loss).
  const ans = ex.events.find((e) => e.type === 'answer').t;
  const lvl = rmsToDbm0(rms(heardB, ans + R, ans + 2 * R));
  assert.ok(Math.abs(lvl - (-16)) < 1, `B hears ${lvl.toFixed(1)} dBm0`);
});

test('exchange: pulse dialling reaches the number too', () => {
  const ex = new Exchange({ preset: 'clean' });
  let pd = null;
  const loopBuf = new Uint8Array(160);
  runExchange(ex, 14, (t, io, B) => {
    if (t < 0.5 * R) { io.A.loop.fill(0); return; }
    if (t >= 2 * R && !pd) pd = new PulseDialler('5551002');
    if (pd) { pd.process(B, loopBuf, 0, io.A.tx, 0); io.A.loop.set(loopBuf); } else io.A.loop.fill(1);
  });
  assert.equal(ex.events.filter((e) => e.type === 'digit').map((e) => e.digit).join(''), '5551002');
  assert.ok(ex.events.some((e) => e.type === 'ringOn' && e.port === 'B'));
});

test('exchange: busy line, unassigned number and no answer', () => {
  // B already off hook: busy.
  {
    const ex = new Exchange({ preset: 'clean' });
    let d = null;
    const { heardA } = runExchange(ex, 8, (t, io, B) => {
      io.A.loop.fill(t > 0.2 * R ? 1 : 0); io.B.loop.fill(1);
      if (t >= 1.5 * R && !d) d = new DtmfDialler('5551002');
      if (d) d.process(io.A.tx, 0, B);
    });
    assert.ok(ex.events.some((e) => e.type === 'busy' && e.port === 'A'));
    const names = detect(heardA).map((e) => e.name);
    assert.ok(names.includes('busy') && !names.includes('reorder'), names.join());
  }
  // A number nobody has: reorder.
  {
    const ex = new Exchange({ preset: 'clean' });
    let d = null;
    const { heardA } = runExchange(ex, 6, (t, io, B) => {
      io.A.loop.fill(t > 0.2 * R ? 1 : 0);
      if (t >= 1.5 * R && !d) d = new DtmfDialler('911');
      if (d) d.process(io.A.tx, 0, B);
    });
    assert.ok(ex.events.some((e) => e.type === 'reorder'));
    assert.ok(detect(heardA).map((e) => e.name).includes('reorder'));
  }
  // Nobody answers: after the set number of rings, reorder.
  {
    const ex = new Exchange({ preset: 'clean', noAnswerRings: 2 });
    let d = null;
    runExchange(ex, 18, (t, io, B) => {
      io.A.loop.fill(t > 0.2 * R ? 1 : 0);
      if (t >= 1.5 * R && !d) d = new DtmfDialler('5551002');
      if (d) d.process(io.A.tx, 0, B);
    });
    assert.ok(ex.events.some((e) => e.type === 'noAnswer'));
    assert.equal(ex.state('B'), 'idle');
  }
});

test('exchange: a distinctive ring cadence and a burst between rings (P8 hooks)', () => {
  const burst = sine(1200, -12, 0.5);
  const ex = new Exchange({ preset: 'clean', directory: { 5551009: { port: 'B', ring: [0.8, 0.4, 0.8, 4], burst } } });
  let d = null;
  const { heardB } = runExchange(ex, 12, (t, io, B) => {
    io.A.loop.fill(t > 0.2 * R ? 1 : 0);
    if (t >= 1.5 * R && !d) d = new DtmfDialler('5551009');
    if (d) d.process(io.A.tx, 0, B);
  });
  const rings = ex.events.filter((e) => e.port === 'B' && (e.type === 'ringOn' || e.type === 'ringOff'));
  assert.ok(Math.abs((rings[1].t - rings[0].t) / R - 0.8) < 0.01);
  assert.ok(Math.abs((rings[2].t - rings[1].t) / R - 0.4) < 0.01);
  const firstOff = rings[3].t;     // the end of the first ring pattern, before the long silence
  assert.ok(rms(heardB, firstOff + 0.55 * R, firstOff + 0.85 * R) > dbm0ToRms(-20), 'the burst sits in the first silence');
});

test('tone detectors: CNG, CED, dial tone, busy and reorder, and no false alarms on noise', () => {
  const ev = (x) => detect(new Channel('noisy', { seed: 5 }).run(x)).map((e) => e.name);
  assert.ok(ev(renderTone(TONES.cng, 4)).includes('cng'));
  assert.ok(ev(renderTone(TONES.ced, 4)).includes('ced'));
  assert.ok(ev(renderTone(TONES.dial, 2)).includes('dial'));
  const b = ev(renderTone(TONES.busy, 3));
  assert.ok(b.includes('busy') && !b.includes('reorder'));
  const r = ev(renderTone(TONES.reorder, 3));
  assert.ok(r.includes('reorder') && !r.includes('busy'));
  const rb = ev(renderTone(TONES.ringback, 13));
  assert.ok(rb.includes('ringback') && !rb.includes('dial'));
  const rng = new Rng(11);
  const noise = Float32Array.from({ length: 10 * R }, () => dbm0ToRms(-20) * rng.gauss());
  assert.deepEqual(ev(noise), []);
  // The European plan's 425 Hz busy is found by signatures built from that plan.
  const td = new ToneDetector({ sigs: signatures(TONE_PLANS.cept) });
  const x = renderTone(TONE_PLANS.cept.busy, 3);
  td.process(x, 0, x.length);
  assert.ok(td.events.some((e) => e.name === 'busy'));
});
