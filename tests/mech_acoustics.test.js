// Sound and integration tests: the audio is a function of the contact forces.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/frontstrike1926.js';
import element from '../src/machine/element1971.js';
import up, { deriveUpstrikeGeometry } from '../src/machine/upstrike1889.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { MechanicalSim, SUBSTEP_HZ } from '../src/sim/mechanics.js';
import { AudioEngine } from '../src/audio/engine.js';
import { loadGlyphsNode } from '../src/sim/harness.js';
import { createSimClient } from '../src/sim/client.js';
import { renderScenario, analyse, bandDb } from '../tools/render_wav.mjs';
import { readSamples } from '../tools/audio/node_samples.mjs';

const glyphs = await loadGlyphsNode();
const geo = deriveGeometry(machine);

test('a keystroke is broadband and decays in the expected time', async () => {
  const r = await renderScenario('strike');
  console.log('  ', JSON.stringify({ peak: r.peak, dc: r.dc, bands: r.bandsDbRel, fall: r.dBelowPeak }));
  assert.ok(!r.clip, 'no clipping');
  assert.ok(r.peak > 0.25 && r.peak <= 0.9, `peak ${r.peak}`);
  assert.ok(Math.abs(r.dc) < 1e-4, 'dc free');
  const b = Object.fromEntries(r.bandsDbRel.map((x) => [x.hz, x.dB]));
  for (const band of ['200-500', '500-1000', '1000-2500', '2500-5000']) assert.ok(b[band] > -24, `${band} too weak: ${b[band]}`);
  assert.ok(b['5000-10000'] > -36, `5-10 kHz: ${b['5000-10000']}`);
  const t40 = r.dBelowPeak.find(([d]) => d === -40)[1];
  assert.ok(t40 !== null && t40 < 0.28, `-40 dB after ${t40} s`);
  // the keystroke has decayed to inaudible quickly, not ringing forever
  const samples = r.samples;
  const tail = samples.subarray(Math.floor(0.45 * 48000));
  const tailPeak = tail.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(tailPeak < r.peak * 0.05, `tail ${tailPeak}`);
});

test('no clipping, DC or denormal residue: after silence every modal state is exactly zero', async () => {
  const sim = new MechanicalSim({ machine, geometry: geo, glyphs });
  const eng = new AudioEngine(sim, 48000);
  const key = geo.keys.findIndex((k) => k.lower === 'r');
  const buf = new Float32Array(128);
  sim.pressKey(key, 28, 0.09);
  let maxAbs = 0, sum = 0, n = 0;
  for (let i = 0; i < Math.round(48000 * 12) / 128; i++) {
    eng.process(buf, 128);
    for (const v of buf) { if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v); sum += v; n++; }
  }
  assert.ok(maxAbs < 1, 'clip');
  assert.ok(Math.abs(sum / n) < 1e-5, `dc ${sum / n}`);
  // Measure that per-block cost in idle is tiny and flat (denormals would make it large and slow).
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) eng.process(buf, 128);
  const tIdle = performance.now() - t0;
  const blockReal = (2000 * 128) / 48000 * 1000;
  console.log(`  idle cost ${(tIdle / blockReal * 100).toFixed(3)} % of real time`);
  assert.ok(tIdle < 0.1 * blockReal, `idle load ${tIdle}`);
  for (const k of Object.keys(eng.body.banks)) {
    const b = eng.body.banks[k];
    assert.equal(b.awake, false, `${k} bank still awake after silence`);
    for (const v of b.y1) assert.equal(v, 0, 'residual modal state');
  }
});

test('element1971: idle after typing costs what a fresh idle does, with no subnormal state left behind', () => {
  const eg = deriveGeometry(element);
  const sim = new MechanicalSim({ machine: element, geometry: eg, glyphs });
  const eng = new AudioEngine(sim, 48000);
  const buf = new Float32Array(128);
  const blocks = (s) => Math.round((s * 48000) / 128);
  const run = (s) => { for (let i = blocks(s); i > 0; i--) eng.process(buf, 128); };
  // Best of a few short runs: the least disturbed by whatever else this machine is doing.
  const cost = () => {
    let best = Infinity;
    for (let r = 0; r < 4; r++) {
      const t0 = performance.now();
      run(0.5);
      best = Math.min(best, (performance.now() - t0) / (blocks(0.5) * 128 / 48));
    }
    return best;
  };
  run(1);
  const fresh = cost();
  for (const ch of 'thequick') { sim.pressKey(eg.keys.findIndex((k) => k.kind === 'print' && k.lower === ch), 12, 0.05); run(0.25); }
  run(13);
  const after = cost();
  console.log(`  element idle: fresh ${(fresh * 100).toFixed(1)} %, after typing ${(after * 100).toFixed(1)} % of real time`);
  // The decaying states are flushed to zero, not left to crawl through the subnormal range (many times slower on x86).
  const a = sim.action;
  const states = { tilt: a.tilt, tiltV: a.tiltV, rot: a.rot, rotV: a.rotV, radY1: eng.rad.y1, radLp: eng.rad.lp, ...Object.fromEntries([...eng.room.fbState].map((v, i) => [`fb${i}`, v])) };
  for (const [k, v] of Object.entries(states)) assert.ok(v === 0 || Math.abs(v) > 1e-20, `${k} = ${v}`);
  // Before the flush this was three times the fresh cost and never recovered.
  assert.ok(after < fresh * 1.5 + 0.01, `after typing ${after} against fresh ${fresh}`);
});

function renderKeys(presses, seconds, { bypass = false } = {}) {
  const sim = new MechanicalSim({ machine, geometry: geo, glyphs });
  const eng = new AudioEngine(sim, 48000);
  eng.limiterBypass = bypass;
  const key = (c) => geo.keys.findIndex((k) => k.kind === 'print' && k.lower === c);
  const N = Math.round(seconds * 48000), out = new Float32Array(N), buf = new Float32Array(128);
  let next = 0, n = 0;
  const pending = presses.slice();
  while (n < N) {
    while (pending.length && pending[0][0] <= n / 48000) { const [, c, f] = pending.shift(); sim.pressKey(key(c), f, 0.09); }
    eng.process(buf, 128);
    out.set(buf.subarray(0, Math.min(128, N - n)), n); n += 128; next++;
  }
  return out;
}
const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const dB = (v) => 20 * Math.log10(v);
const hfOverLf = (x, peakI) => {
  const seg = x.subarray(peakI - 96, peakI + 1440);
  const low = bandDb(seg, 48000, [[200, 1000]])[0].dB, high = bandDb(seg, 48000, [[5000, 20000]])[0].dB;
  return high - low;
};

test('an ordinary stroke sits at a healthy level and strokes keep their dynamics', () => {
  const peaks = [22, 28, 50].map((f) => peakOf(renderKeys([[0.02, 'e', f]], 0.6)));
  const db = peaks.map(dB);
  console.log('   peak dBFS at 22/28/50 N finger:', db.map((v) => v.toFixed(2)).join(' '));
  assert.ok(db[1] > -7.5 && db[1] < -4.5, `ordinary stroke ${db[1]} dBFS`);
  assert.ok(db[1] - db[0] > 2 && db[2] - db[1] > 2, `no flattening: ${db}`);
  assert.ok(db[2] < -0.5, 'limiter ceiling keeps hard hits under 0 dBFS');
});

test('a harder hit is brighter, not just louder', () => {
  const r = [22, 28, 50].map((f) => { const x = renderKeys([[0.02, 'e', f]], 0.6, { bypass: true }); let i = 0, m = 0; for (let k = 0; k < x.length; k++) if (Math.abs(x[k]) > m) { m = Math.abs(x[k]); i = k; } return { x, i }; });
  const ratio = r.map(({ x, i }) => hfOverLf(x, i));
  console.log('   HF/LF dB at 22/28/50 N:', ratio.map((v) => v.toFixed(1)).join(' '));
  assert.ok(ratio[1] > ratio[0] + 2 && ratio[2] > ratio[1] + 2, `brightness ${ratio}`);
});

test('two identical strokes are never identical waveforms', () => {
  const x = renderKeys([[0.02, 'e', 28], [0.7, 'e', 28]], 1.4);
  const win = (t0) => { let m = 0, i = 0; for (let k = t0 * 48000 | 0; k < (t0 + 0.35) * 48000; k++) if (Math.abs(x[k]) > m) { m = Math.abs(x[k]); i = k; } return x.subarray(i - 48, i + 2880); };
  const a = win(0.05), b = win(0.75);
  let e = 0, ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; e += d * d; ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  const diffDb = 10 * Math.log10(e / aa);
  const corr = ab / Math.sqrt(aa * bb);
  console.log('   difference', diffDb.toFixed(1), 'dB, correlation', corr.toFixed(4));
  assert.ok(diffDb > -30, `strokes nearly identical: ${diffDb} dB`);
  assert.ok(corr < 0.995, `correlation ${corr}`);
});

test('dsp load is comfortable for the worklet budget while typing', () => {
  const sim = new MechanicalSim({ machine, geometry: geo, glyphs });
  const eng = new AudioEngine(sim, 48000);
  const keys = [..."thequickbrownfoxjumpsoverthelazydog"].map((ch) => geo.keys.findIndex((k) => k.kind === 'print' && k.lower === ch));
  const buf = new Float32Array(128);
  const N = Math.ceil((6 * 48000) / 128);
  let t = 0, w = 0, worst = 0;
  let nextPress = 0, idx = 0;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const tb = (i * 128) / 48000;
    while (tb >= nextPress && idx < keys.length) {
      sim.pressKey(keys[idx++], 28, 0.09);
      nextPress = tb + 0.1;                         // 10 cps, fast typist
    }
    const a = performance.now();
    eng.process(buf, 128);
    const d = performance.now() - a;
    if (i > 8) { t += d; worst = Math.max(worst, d); w++; }
  }
  const blockMs = (128 / 48000) * 1000;
  const mean = t / w;
  console.log(`  mean block ${mean.toFixed(3)} ms of ${blockMs.toFixed(3)} ms (${(100 * mean / blockMs).toFixed(1)} %), worst ${worst.toFixed(2)} ms, engine load ${eng.dspLoad.toFixed(3)}`);
  assert.ok(mean < 0.5 * blockMs, `mean ${mean} ms`);
  // A snapshot reports the same measured load.
  sim.writeSnapshot(eng.snap);
});

test('the same MechanicalSim types on a blind-writer upstrike machine', () => {
  const g2 = deriveUpstrikeGeometry(up);
  assert.ok(g2.nPrint >= 20, 'keys');
  const s = new MechanicalSim({ machine: up, geometry: g2, glyphs });
  const k = g2.keys.findIndex((x) => x.lower === 'a');
  const x0 = s.carriageX();
  s.pressKey(k, 24, 0.08);
  const events = [];
  for (let i = 0; i < SUBSTEP_HZ * 0.6; i++) { s.step(); s.drainEvents(events); }
  const strikes = events.filter((e) => e.type === 'strike');
  console.log(`  upstrike: strikes ${strikes.length}, v ${strikes[0]?.vImpact.toFixed(2)}, carriage moved ${Math.abs(s.carriageX() - x0) * 1e3} mm`);
  assert.ok(strikes.length >= 1, 'upstrike did not strike');
  assert.ok(strikes[0].vImpact > 0.5 && strikes[0].vImpact < 6, 'speed');
  assert.ok(Math.abs(Math.abs(s.carriageX() - x0) - up.escapement.pitch) < 0.2e-3, 'spacing');
});

test('createSimClient works in Node as a LocalHost and exposes the contract', async () => {
  const c = await createSimClient({ machine, geometry: geo, glyphs, autoRun: false });
  assert.ok(c.layout.length > 10);
  assert.equal(c.state.length, c.layout.length);
  const strikes = [];
  const others = [];
  c.on('strike', (e) => strikes.push(e)).on('event', (e) => others.push(e));
  const k = geo.keys.findIndex((x) => x.lower === 'j');
  c.pressKey(k, 24, 0.075);
  c.advance(0.2);
  assert.ok(c.state[c.layout.time] > 0.1, 'time advanced in snapshot');
  assert.ok(c.state[c.layout.barTheta + k] >= 0);
  assert.equal(strikes.length, 1, 'strike event delivered');
  const e = strikes[0];
  for (const f of ['bar', 'caseIndex', 'tBegin', 'duration', 'carriageX', 'platenPsi', 'shiftY', 'lateral', 'vImpact', 'peakForce', 'maxIndent', 'restitution', 'skewRad', 'vibratorLift', 'ribbonInGap', 'trace']) assert.ok(f in e, `event missing ${f}`);
  assert.ok(e.trace.force instanceof Float32Array && e.trace.dt > 0);
  // grabs work and move the DOF
  const g = c.grab('bar', 3, { target: 0.5, k: 8, c: 0.05, maxF: 2 });
  c.advance(0.1);
  assert.ok(c.state[c.layout.barTheta + 3] > 0.3, 'grab moved the bar');
  c.moveGrab(g, 0);
  c.advance(0.1);
  c.release(g);
  c.advance(0.2);
  c.setEnv({ paperPresent: false });
  c.setParam('carriage.mass', 2.1);
  c.setTimeScale(0.5);
  c.setTimeScale(1);
  c.setAudioEnabled(false);
  assert.ok(c.state[c.layout.time] > 0.3);
  assert.equal(c.state[c.layout.dspLoad] >= 0, true);
});

// ---- Recorded samples triggered by the mechanism ----
const samples = readSamples();
const keyOf = (c) => geo.keys.findIndex((k) => k.lower === c);
const SPACE = geo.keys.findIndex((k) => k.id === 'space');

function sampled(schedule, seconds) {
  const sim = new MechanicalSim({ machine, geometry: geo, glyphs });
  const eng = new AudioEngine(sim, 48000);
  eng.loadSamples(samples.pcm, samples.manifest);
  const plays = [];
  const play = eng.sampler.play.bind(eng.sampler);
  eng.sampler.play = (set, ...r) => { if (set) plays.push({ set: set.set, srcT: set.srcT }); play(set, ...r); };
  const acts = schedule(sim, eng).sort((a, b) => a[0] - b[0]);
  const n = Math.round(seconds * 48000 / 128), buf = new Float32Array(128), out = new Float32Array(n * 128);
  for (let b = 0, f = 0; b < n; b++) {
    while (f < acts.length && acts[f][0] <= b * 128 / 48000) acts[f++][1]();
    eng.process(buf, 128);
    out.set(buf, b * 128);
  }
  return { out, plays, sim, eng, counts: plays.reduce((m, p) => ({ ...m, [p.set]: (m[p.set] ?? 0) + 1 }), {}) };
}
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const db = (x) => 20 * Math.log10(x + 1e-12);

test('samples: strength sets level and tier, with soft clearly soft and hard not flattened', () => {
  const at = (f) => sampled((s) => [[0.02, () => s.pressKey(keyOf('e'), f, 0.09)]], 0.5);
  const [a, b, c] = [22, 28, 50].map(at);
  assert.equal(a.counts.strike_soft, 1); assert.equal(b.counts.strike_med, 1); assert.equal(c.counts.strike_hard, 1);
  const [pa, pb, pc] = [a, b, c].map((r) => db(peak(r.out)));
  console.log('   peaks dBFS', pa.toFixed(1), pb.toFixed(1), pc.toFixed(1));
  assert.ok(pb > -9 && pb < -4, `nominal ${pb}`);
  assert.ok(pb - pa > 4, `soft ${pa} vs nominal ${pb}`);
  assert.ok(pc - pb > 1.5, `hard ${pc} vs nominal ${pb}`);
  assert.ok(pc < -0.5, `hard ${pc}`);
});

test('samples: each key has its own stable small set, rotated so repeats differ', () => {
  const run = (c) => sampled((s) => [0, 1, 2, 3, 4, 5].map((i) => [0.02 + i * 0.4, () => s.pressKey(keyOf(c), 28, 0.09)]), 2.8).plays.filter((p) => p.set === 'strike_med').map((p) => p.srcT);
  const e1 = run('e'), e2 = run('e'), t = run('t');
  assert.deepEqual(e1, e2, 'same key, same recordings');
  const se = new Set(e1), st = new Set(t);
  assert.ok(se.size >= 2 && se.size <= 4, `set size ${se.size}`);
  for (let i = 1; i < e1.length; i++) assert.notEqual(e1[i], e1[i - 1], 'consecutive repeats differ');
  assert.notDeepEqual([...se].sort(), [...st].sort(), 'different keys, different recordings');
});

test('samples: the spacebar uses its own recordings and no slug sound', () => {
  const r = sampled((s) => [[0.02, () => s.pressKey(SPACE, 28, 0.09)]], 0.6);
  assert.equal(r.counts.space, 1);
  for (const k of Object.keys(r.counts)) assert.ok(!k.startsWith('strike'), k);
});

test('samples: a press that does not strike makes only a light touch', () => {
  for (const f of [6, 14]) {
    const r = sampled((s) => [[0.02, () => s.pressKey(keyOf('e'), f, 0.09)]], 0.9);
    assert.equal(r.counts.touch, 1, `${f} N: ${JSON.stringify(r.counts)}`);
    for (const k of Object.keys(r.counts)) assert.ok(!k.startsWith('strike'), k);
    assert.ok(db(peak(r.out)) < -14, `${f} N peak ${db(peak(r.out))}`);
  }
});

test('samples: the rack ratchet makes one grain per tooth and the end stop sounds once', () => {
  const P = machine.escapement.pitch;
  const r = sampled((s) => {
    s.q = 40 * P; s.escAwake = true;
    return [[0.05, () => { s._g = s.grab('carriage', 0, { target: s.carriageX() - s.q0Sign * 0.12, k: 3000, c: 80, maxF: 60 }); }], [1.4, () => s.release(s._g)]];
  }, 1.8);
  console.log('   return', JSON.stringify(r.counts));
  assert.ok(r.counts.ratchet >= 36 && r.counts.ratchet <= 42, `ratchet ${r.counts.ratchet}`);
});

test('samples: the platen knob clicks once per detent notch', () => {
  const step = 2 * Math.PI / machine.platen.detentNotches;
  const r = sampled((s) => {
    const a = [[0.02, () => { s._g = s.grab('platen', 0, { target: 0, k: 3, c: 0.05, maxF: 2.5 }); }]];
    for (let t = 0; t < 1.5; t += 0.008) a.push([0.0201 + t, () => s.moveGrab(s._g, step * 8 * t / 1.5)]);
    return a;
  }, 1.8);
  assert.ok(r.counts.knob >= 7 && r.counts.knob <= 9, `knob ${r.counts.knob}`);
});

test('samples: paper sound follows the motion and is silent when the paper is still', () => {
  const r = sampled((s, e) => [[0.5, () => e.setPaperSpeed(0.3)], [1.5, () => e.setPaperSpeed(0)]], 3.0);
  const span = (a, b) => peak(r.out.subarray(Math.floor(a * 48000), Math.floor(b * 48000)));
  assert.equal(span(0, 0.45), 0, 'silent before');
  assert.ok(span(0.8, 1.4) > 0.005, 'audible while moving');
  assert.equal(span(2.8, 3.0), 0, 'silent after');
});

test('samples: nothing plays when nothing physical happens', () => {
  const r = sampled(() => [], 1.0);
  assert.deepEqual(r.counts, {});
  assert.equal(peak(r.out), 0);
});
