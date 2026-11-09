#!/usr/bin/env node
// Renders scenarios through the full mechanism + acoustics to WAV and prints spectral analysis.
// Usage: node tools/render_wav.mjs [--out DIR] [--sr 48000] [scenario ...]
//   scenarios: strike sentence return bell (default: all)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { MechanicalSim, SUBSTEP_HZ } from '../src/sim/mechanics.js';
import { AudioEngine } from '../src/audio/engine.js';
import { loadGlyphsNode } from '../src/sim/harness.js';

export function fftReal(x) {
  const n = 1 << Math.ceil(Math.log2(x.length));
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let ur = 1, ui = 0;
      for (let j = 0; j < len / 2; j++) {
        const k = i + j, l = k + len / 2;
        const tr = re[l] * ur - im[l] * ui, ti = re[l] * ui + im[l] * ur;
        re[l] = re[k] - tr; im[l] = im[k] - ti; re[k] += tr; im[k] += ti;
        const tmp = ur * wr - ui * wi; ui = ur * wi + ui * wr; ur = tmp;
      }
    }
  }
  return { re, im, n };
}

export function bandDb(signal, sr, bands) {
  const windowed = Float64Array.from(signal, (v, i) => v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (signal.length - 1 || 1))));
  const { re, im, n } = fftReal(windowed);
  const mag2 = (i) => re[i] * re[i] + im[i] * im[i];
  const df = sr / n;
  return bands.map(([f1, f2]) => {
    let s = 0;
    const i1 = Math.max(1, Math.floor(f1 / df)), i2 = Math.min((n >> 1) - 1, Math.ceil(f2 / df));
    for (let i = i1; i <= i2; i++) s += mag2(i);
    return { band: [f1, f2], dB: 10 * Math.log10(s + 1e-30) };
  });
}

export function analyse(signal, sr, label = '') {
  let peak = 0, sum = 0;
  for (const v of signal) { const a = Math.abs(v); if (a > peak) peak = a; sum += v; }
  const dc = sum / signal.length;
  // Envelope decay after the absolute peak: time to fall 40 dB below the peak (RMS over 2 ms hops)
  let peakI = 0;
  for (let i = 0; i < signal.length; i++) if (Math.abs(signal[i]) >= peak * 0.999) { peakI = i; break; }
  const hop = Math.round(sr * 0.002);
  const env = [];
  for (let i = peakI; i + hop < signal.length; i += hop) {
    let s = 0;
    for (let j = 0; j < hop; j++) s += signal[i + j] ** 2;
    env.push(Math.sqrt(s / hop));
  }
  const envDb = env.map((e) => 20 * Math.log10(e / (env[0] + 1e-20) + 1e-12));
  const fall = (db) => { const i = envDb.findIndex((v) => v < db); return i < 0 ? null : (i * hop) / sr; };
  const dBelow = [-20, -40, -60].map((d) => [d, fall(d)]);
  const bands = bandDb(signal.subarray(peakI), sr, [[80, 200], [200, 500], [500, 1000], [1000, 2500], [2500, 5000], [5000, 10000], [10000, 20000]]);
  const ref = Math.max(...bands.map((b) => b.dB));
  return {
    label, peak, clip: peak >= 1, dc, durationS: signal.length / sr, dBelowPeak: dBelow,
    bandsDbRel: bands.map((b) => ({ hz: `${b.band[0]}-${b.band[1]}`, dB: +(b.dB - ref).toFixed(1) })),
  };
}

function writeWav(file, samples, sr) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE((v * 32767) | 0, i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

function scenarioRunner(geo, sim, engine, sr) {
  const keyOf = (ch) => geo.keys.findIndex((k) => k.kind === 'print' && (k.lower === ch || k.upper === ch));
  const controlKey = (id) => geo.keys.findIndex((k) => k.id === id);
  const render = (seconds, actions) => {
    const n = Math.round(seconds * sr);
    const out = new Float32Array(n);
    const blocks = 128;
    let next = 0, fired = 0;
    const acts = actions.slice().sort((a, b) => a[0] - b[0]);
    const tmp = new Float32Array(blocks);
    while (next < n) {
      const m = Math.min(blocks, n - next);
      const blockT = next / sr;
      while (fired < acts.length && acts[fired][0] <= blockT) { acts[fired][1](); fired++; }
      engine.process(tmp, m);
      out.set(tmp.subarray(0, m), next);
      next += m;
    }
    return out;
  };
  return { keyOf, controlKey, render };
}

export async function renderScenario(name, { sr = 48000, outDir = null } = {}) {
  const glyphs = await loadGlyphsNode();
  const geo = deriveGeometry(machine);
  const sim = new MechanicalSim({ machine, geometry: geo, glyphs });
  const engine = new AudioEngine(sim, sr);
  const R = scenarioRunner(geo, sim, engine, sr);
  let actions, dur;
  const P = machine.escapement.pitch;
  switch (name) {
    case 'strike':
      dur = 0.6;
      actions = [[0.02, () => sim.pressKey(R.keyOf('e'), 28, 0.09)]];
      break;
    case 'sentence': {
      const text = 'the quick brown fox jumps over the lazy dog';
      const acts = [];
      let t = 0.02;
      for (const ch of text) {
        const key = ch === ' ' ? R.controlKey('space') : R.keyOf(ch);
        const f = 25 + 10 * ((t * 13.7) % 1);
        acts.push([t, () => sim.pressKey(key, f, 0.09)]);
        t += 0.15 + 0.07 * ((t * 7.3) % 1);
      }
      actions = acts; dur = t + 0.6;
      break;
    }
    case 'return':
      dur = 1.8;
      sim.q = 40 * P;
      sim.escAwake = true;
      actions = [[0.1, () => {
        const g = sim.grab('carriage', 0, { target: sim.carriageX() + sim.q0Sign * -1 * 0.09, k: 3000, c: 80, maxF: 60 });
        sim._rg = g;
      }], [1.2, () => sim.release(sim._rg)]];
      break;
    case 'bell': {
      dur = 2.5;
      const qR = sim.q0Sign * (sim.ax[4] - sim.xStart);
      sim.q = qR - sim.bellRing - 2.2 * P;
      sim.escAwake = true;
      const k = R.keyOf('n');
      actions = [];
      for (let i = 0; i < 5; i++) actions.push([0.2 + i * 0.22, () => sim.pressKey(k, 28, 0.09)]);
      break;
    }
    default: throw new Error('unknown scenario ' + name);
  }
  const t0 = performance.now();
  const samples = R.render(dur, actions);
  const elapsed = performance.now() - t0;
  const report = analyse(samples, sr, name);
  report.renderRealtimeFactor = +(elapsed / (dur * 1000)).toFixed(3);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeWav(path.join(outDir, `${name}.wav`), samples, sr);
  }
  report.samples = samples;
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let outDir = path.join(process.env.TMPDIR ?? '/tmp', 'typewriter-wav');
  let sr = 48000;
  const names = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') outDir = args[++i];
    else if (args[i] === '--sr') sr = +args[++i];
    else names.push(args[i]);
  }
  for (const name of names.length ? names : ['strike', 'sentence', 'return', 'bell']) {
    const r = await renderScenario(name, { sr, outDir });
    const { samples, ...rest } = r;
    console.log(JSON.stringify(rest));
  }
  console.log('wrote to', outDir);
}
