#!/usr/bin/env node
// Renders calibration and proof scenarios through the full mechanism and acoustic model.
// Usage: node tools/audio/render_proofs.mjs <outdir> [--ports] (also writes per-scenario strike timing)
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import machine from '../../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../../src/machine/geometry.js';
import { MechanicalSim } from '../../src/sim/mechanics.js';
import { AudioEngine } from '../../src/audio/engine.js';
import { loadGlyphsNode } from '../../src/sim/harness.js';
import { readSamples } from './node_samples.mjs';

const glyphs = await loadGlyphsNode();
const geo = deriveGeometry(machine);
const outDir = process.argv[2]; mkdirSync(outDir, { recursive: true });
const sr = 48000;
const samples = process.env.NO_SAMPLES ? null : readSamples();
const keyOf = (ch) => geo.keys.findIndex((k) => k.kind === 'print' && (k.lower === ch || k.upper === ch));

function writeWav(file, x) {
  const d = Buffer.alloc(x.length * 4);
  for (let i = 0; i < x.length; i++) d.writeFloatLE(x[i], i * 4);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
  writeFileSync(file, Buffer.concat([h, d]));
}

function render(seconds, setup) {
  const sim = new MechanicalSim({ machine, geometry: geo, glyphs });
  const eng = new AudioEngine(sim, sr);
  if (process.env.NO_LIMIT) eng.limiterBypass = true;
  const counts = {};
  if (samples) {
    eng.loadSamples(samples.pcm, samples.manifest);
    const play = eng.sampler.play.bind(eng.sampler);
    eng.sampler.play = (set, ...r) => { if (set) counts[set.set] = (counts[set.set] ?? 0) + 1; play(set, ...r); };
  }
  const acts = setup(sim, eng).sort((a, b) => a[0] - b[0]);
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const buf = new Float32Array(128);
  let next = 0, fi = 0;
  while (next < n) {
    const t = next / sr;
    while (fi < acts.length && acts[fi][0] <= t) acts[fi++][1]();
    eng.process(buf, 128);
    out.set(buf.subarray(0, Math.min(128, n - next)), next);
    next += 128;
  }
  return { out, sim, eng, counts };
}

const press = (sim, ch, f, d = 0.09) => () => sim.pressKey(keyOf(ch), f, d);
const P = machine.escapement.pitch;
const scenarios = {
  strike_soft: [0.6, (s) => [[0.02, press(s, 'e', 22)]]],
  strike_nominal: [0.6, (s) => [[0.02, press(s, 'e', 28)]]],
  strike_hard: [0.6, (s) => [[0.02, press(s, 'e', 50)]]],
  sentence: [22, (s) => {
    const text = 'the quick brown fox jumps over the lazy dog the quick brown fox jumps over the lazy dog';
    const a = []; let t = 0.05, i = 0;
    for (const ch of text) { i++; const f = 24 + 10 * ((i * 0.618) % 1); a.push([t, ch === ' ' ? () => s.pressKey(geo.keys.findIndex((k) => k.id === 'space'), f, 0.09) : press(s, ch, f)]); t += 0.19 + 0.09 * ((i * 0.37) % 1); }
    return a;
  }],
  return: [1.8, (s) => {
    s.q = 40 * P; s.escAwake = true;
    return [[0.1, () => { s._g = s.grab('carriage', 0, { target: s.carriageX() + s.q0Sign * -1 * 0.09, k: 3000, c: 80, maxF: 60 }); }], [1.2, () => s.release(s._g)]];
  }],
  bell: [4.0, (s) => {
    const qR = s.q0Sign * (s.ax[4] - s.xStart);
    s.q = qR - s.bellRing - 2.2 * P; s.escAwake = true;
    const a = [];
    for (let i = 0; i < 3; i++) a.push([0.2 + i * 0.22, press(s, 'n', 28)]);
    return a;
  }],
};
// Two neighbouring bars thrown almost together, so they clash in the guide.
scenarios.clash = [1.2, (s) => [[0.05, press(s, 'e', 34)], [0.058, press(s, 'r', 34)]]];
const space = () => geo.keys.findIndex((k) => k.id === 'space');
scenarios.soft_vs_hard = [3.2, (s) => [22, 22, 28, 28, 50, 50].map((f, i) => [0.05 + i * 0.5, press(s, 'e', f)])];
scenarios.same_key_vs_others = [4.2, (s) => [...'eeeetaoin'].map((c, i) => [0.05 + i * 0.45, press(s, c, 28)])];
scenarios.spaces = [2.6, (s) => [0, 1, 2, 3, 4].map((i) => [0.05 + i * 0.5, () => s.pressKey(space(), 28, 0.09)])];
scenarios.missed = [3.0, (s) => [6, 10, 14, 18].map((f, i) => [0.05 + i * 0.7, press(s, 'e', f)])];
scenarios.shift = [1.6, (s) => {
  const k = geo.keys.findIndex((x) => /shift/i.test(x.id) && !/lock/i.test(x.id));
  return [[0.1, () => s.pressKey(k, 30, 0.6)]];
}];
// The whole Enter stroke as the hand makes it: line-space swing, then the lever stop drags the carriage home.
scenarios.lever_return = [4.2, (s) => {
  s.q = 40 * P; s.escAwake = true;
  const a = [], travel = machine.lineSpace.travel, t0 = 0.2;
  a.push([t0, () => { s._g = s.grab('lsLever', 0, { target: s.getDof ? 0 : 0, k: 6, c: 0.09, maxF: 2.2 }); }]);
  for (let t = 0; t < 3.0; t += 0.008) {
    const f = Math.min(1, t / 0.26), swing = travel * f * f * (3 - 2 * f);
    const pull = t > 0.32 ? Math.min(travel + 0.9, travel + (t - 0.32) * 3.5) : swing;
    a.push([t0 + 0.0001 + t, () => s.moveGrab(s._g, pull)]);
  }
  a.push([t0 + 3.05, () => s.release(s._g)]);
  return a;
}];
// The platen knob turned by hand, slowly then briskly, notch by notch against the detent.
scenarios.knob = [3.2, (s) => {
  const a = [], t0 = 0.1, step = 2 * Math.PI / machine.platen.detentNotches;
  a.push([t0, () => { s._g = s.grab('platen', 0, { target: 0, k: 3.0, c: 0.05, maxF: 2.5 }); }]);
  for (let t = 0; t < 2.8; t += 0.008) {
    const psi = t < 1.4 ? step * 3 * (t / 0.7) : step * 6 + step * 10 * (t - 1.4) / 1.4 * 1.4;
    a.push([t0 + 0.0001 + t, () => s.moveGrab(s._g, psi)]);
  }
  a.push([t0 + 2.85, () => s.release(s._g)]);
  return a;
}];
// Paper: handled by hand (no platen motion), then silence, then fed by the platen as the soft body would report it.
scenarios.paper = [5.0, (s, e) => {
  const a = [[0.1, () => e.setPaperSpeed(0.25)], [0.7, () => e.setPaperSpeed(0.6)], [1.3, () => e.setPaperSpeed(0)]];
  a.push([2.2, () => { s._g = s.grab('platen', 0, { target: 0, k: 3.0, c: 0.05, maxF: 6 }); e.setPaperSpeed(0.06); }]);
  for (let t = 0; t < 1.6; t += 0.008) a.push([2.2001 + t, () => s.moveGrab(s._g, 4 * t)]);
  a.push([3.85, () => { s.release(s._g); e.setPaperSpeed(0); }]);
  return a;
}];
const report = {};
const names = process.argv[3] ? process.argv[3].split(',') : Object.keys(scenarios);
for (const name of names) {
  const [dur, setup] = scenarios[name];
  const { out, eng, counts } = render(dur, setup);
  let peak = 0; for (const v of out) { const a = Math.abs(v); if (a > peak) peak = a; }
  writeWav(path.join(outDir, `${name}.wav`), out);
  report[name] = { peakDbfs: +(20 * Math.log10(peak + 1e-12)).toFixed(2), dspLoadEMA: +eng.dspLoad.toFixed(4), events: counts };
}
console.log(JSON.stringify(report, null, 0).replaceAll('},"', '},\n"'));
