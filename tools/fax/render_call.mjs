#!/usr/bin/env node
// Renders a whole fax call to a WAV at 48 kHz and a spectrogram PNG, from the real signals: the exchange (dial tone,
// DTMF dialling, ringback, 20 Hz ringing), the real T.30 stack at both ends (src/fax/t30/) driving the modems through
// the audio modem port (CNG, CED, V.21 CSI/DIS and TSI/DCS, V.29 training and TCF at 9600, CFR, a page of V.29
// data, EOP/MCF, DCN), then both ends hang up. What is heard is the calling machine's line, as its monitor speaker
// would play it: its own transmission plus what comes back from the far end.
//
// The page is M2's stub page (src/fax/t30/stub-page.js: EOLs, fill, RTC around a self-checking payload), until the
// T.4 coder is wired to the T.30 source in a later milestone.
//
// Usage: node tools/fax/render_call.mjs [--out FILE.wav] [--preset typical|clean|noisy|bad] [--lines N] [--seed N]
//   The PNG goes next to the WAV (same name, .png). Python 3 with numpy and matplotlib draws it when present
//   (run with -I); otherwise a small built-in PNG writer draws a plain grey spectrogram.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { LINE_RATE, AUDIO_RATE } from '../../src/fax/line/levels.js';
import { Exchange } from '../../src/fax/line/exchange.js';
import { DtmfDialler } from '../../src/fax/line/dtmf.js';
import { upsampleAll } from '../../src/fax/line/resample.js';
import { AudioModemPort } from '../../src/fax/modem/audio-port.js';
import { ToneDetector, signatures } from '../../src/fax/modem/tone-detect.js';
import { T30Caller } from '../../src/fax/t30/caller.js';
import { T30Answerer } from '../../src/fax/t30/answerer.js';
import { T30Endpoint } from '../../src/fax/t30/endpoint.js';
import { stubSource } from '../../src/fax/t30/stub-page.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const OUT = opt('out', '/tmp/claude-0/-home-user-typewriter/f8518805-a6b0-5ba3-88f6-f2782e19df73/scratchpad/fax_call.wav');
const PRESET = opt('preset', 'typical');
const LINES = +opt('lines', 400);
const SEED = +opt('seed', 7);
const R = LINE_RATE, B = 80;            // 10 ms blocks

const events = [];
const note = (t, who, what) => { events.push({ t, who, what }); };

const ex = new Exchange({ ports: { A: '5551001', B: '5551002' }, preset: PRESET, seed: SEED,
  onEvent: (e) => { if (['offHook', 'digit', 'ringOn', 'answer', 'onHook', 'busy', 'reorder'].includes(e.type)) note(e.t / R, `exchange ${e.port}`, e.type + (e.digit ? ` ${e.digit}` : '')); } });
const portA = new AudioModemPort({ name: 'A' }), portB = new AudioModemPort({ name: 'B' });
const A = new T30Endpoint(new T30Caller({ ident: '+1 555 1001', source: stubSource({ pages: 1, lines: LINES }), vres: 'standard' }), portA,
  { name: 'A', onEvent: (a, t) => note(t, 'T.30 A', a.type + (a.reason ? ` ${a.reason}` : '') + (a.response ? ` ${a.response}` : '')) });
const Bep = new T30Endpoint(new T30Answerer({ ident: '+1 555 1002' }), portB,
  { name: 'B', onEvent: (a, t) => note(t, 'T.30 B', a.type + (a.reason ? ` ${a.reason}` : '') + (a.response ? ` ${a.response}` : '')) });

const io = {
  A: { loop: new Uint8Array(B), tx: new Float32Array(B), rx: new Float32Array(B), ring: null },
  B: { loop: new Uint8Array(B), tx: new Float32Array(B), rx: new Float32Array(B), ring: new Float32Array(B) },
};
// The caller's own dial-tone detector decides when to dial, as the machine's would.
const dialDetect = new ToneDetector({ sigs: signatures().filter((s) => s.name === 'dial') });
let dialler = null, aStarted = false, bStarted = false, heardDial = false;
let aHook = 0, bHook = 0, ringsSeen = 0, answerAt = Infinity, hangA = Infinity, hangB = Infinity, endAt = Infinity;
const line = [];                         // what the calling machine's line carries, at 8 kHz

for (let n = 0; n < 240 * R && n < endAt; n += B) {
  const t = n / R;
  if (t >= 0.4 && t < hangA) aHook = 1;
  if (!heardDial && dialDetect.events.length) { heardDial = true; note(t, 'FO-70', 'dial tone heard: dialling'); dialler = new DtmfDialler('5551002'); }
  io.A.tx.fill(0); io.B.tx.fill(0);
  // B, the far machine, answers in the silence after the second ring.
  const ringOns = ex.events.filter((e) => e.type === 'ringOn' && e.port === 'B').length;
  if (ringOns !== ringsSeen) { ringsSeen = ringOns; if (ringOns === 2) answerAt = t + 2.0 + 1.0; }
  if (t >= answerAt && t < hangB) bHook = 1;
  io.A.loop.fill(aHook); io.B.loop.fill(bHook);
  // Endpoints: the caller's T.30 begins when dialling ends (its CNG sounds under the ringback); the answerer's at answer.
  if (dialler && dialler.done && !aStarted) { aStarted = true; A.start(t + 0.5); note(t + 0.5, 'FO-70', 'dialled: T.30 phase A (CNG)'); }
  if (ex.state('B') === 'talk' && !bStarted) { bStarted = true; Bep.start(t); }
  if (aStarted) A.advance(t);
  if (bStarted) Bep.advance(t);
  portA.produce(io.A.tx, 0, B);
  portB.produce(io.B.tx, 0, B);
  if (dialler) dialler.process(io.A.tx, 0, B);
  ex.process(B, io);
  portA.consume(io.A.rx, 0, B);
  portB.consume(io.B.rx, 0, B);
  dialDetect.process(io.A.rx, 0, B);
  for (let i = 0; i < B; i++) line.push(io.A.tx[i] + io.A.rx[i]);
  // Hang up after the call: the caller 0.4 s after its DCN, the answerer when it has heard it.
  if (A.done && portA.idle && hangA === Infinity) hangA = t + 0.4;
  if (Bep.done && portB.idle && hangB === Infinity) hangB = t + 0.6;
  if (t >= hangA && t >= hangB && endAt === Infinity) endAt = n + 1.0 * R;
  if (t >= hangA) aHook = 0;
  if (t >= hangB) bHook = 0;
}

for (const [who, port] of [['A', portA], ['B', portB]]) {
  for (const l of port.log) {
    const what = l.kind === 'v21' ? `V.21 ${l.frames.join(' ')}` : l.kind === 'tone' ? l.tone : `${l.kind === 'tcf' ? 'TCF' : 'page'} ${l.rate} (training ${(l.rate >= 7200 ? 'V.29' : 'V.27ter')})`;
    note(l.start, `line ${who}`, `${what} until ${l.end.toFixed(2)} s`);
  }
}
events.sort((a, b) => a.t - b.t);

const x8 = Float32Array.from(line);
const x48 = upsampleAll(x8);
// WAV, 16-bit mono at 48 kHz. Line full scale is the codec's; leave 1 dB of headroom.
const gain = 0.89 * 32767;
const pcm = Buffer.alloc(44 + x48.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + x48.length * 2, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(AUDIO_RATE, 24);
pcm.writeUInt32LE(AUDIO_RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(x48.length * 2, 40);
let peak = 0;
for (let i = 0; i < x48.length; i++) { const v = Math.max(-1, Math.min(1, x48[i])); peak = Math.max(peak, Math.abs(v)); pcm.writeInt16LE(Math.round(v * gain), 44 + 2 * i); }
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, pcm);

const PNG = OUT.replace(/\.wav$/i, '') + '.png';
const marks = events.filter((e) => /^line|exchange A|exchange B/.test(e.who) && !/digit/.test(e.what)).map((e) => [e.t, `${e.who.replace('line ', '')}: ${e.what.replace(/ until.*/, '')}`]);
if (!drawWithPython(x8, PNG, marks)) drawWithNode(x8, PNG);

console.log(`call on a '${PRESET}' line, ${(x8.length / R).toFixed(1)} s; peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
for (const e of events) console.log(`${e.t.toFixed(3).padStart(8)} s  ${e.who.padEnd(12)} ${e.what}`);
console.log(`WAV ${OUT}\nPNG ${PNG}`);

function drawWithPython(x, png, labels) {
  const raw = png.replace(/\.png$/, '.f32');
  fs.writeFileSync(raw, Buffer.from(x.buffer));
  fs.writeFileSync(raw + '.json', JSON.stringify(labels));
  const py = `
import sys, json, numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
raw, png = sys.argv[1], sys.argv[2]
x = np.fromfile(raw, dtype=np.float32)
marks = json.load(open(raw + '.json'))
fs = ${R}
fig, ax = plt.subplots(figsize=(max(16, len(x) / fs / 3), 6), dpi=110)
ax.specgram(x, NFFT=256, Fs=fs, noverlap=192, cmap='magma', vmin=-110, vmax=-20)
ax.set_ylim(0, 4000); ax.set_xlabel('time (s)'); ax.set_ylabel('Hz')
ax.set_title('Fax call on the calling machine\\'s line (8 kHz line samples)')
for i, (t, s) in enumerate(marks):
    ax.axvline(t, color='w', lw=0.4, alpha=0.5)
    ax.text(t, 3950 - (i % 6) * 190, s, color='w', fontsize=6, va='top', rotation=0)
fig.tight_layout(); fig.savefig(png)
`;
  const r = spawnSync('python3', ['-I', '-c', py, raw, png], { encoding: 'utf8' });
  fs.rmSync(raw, { force: true }); fs.rmSync(raw + '.json', { force: true });
  if (r.status !== 0) { console.error((r.stderr || '').slice(-400)); return false; }
  return true;
}

function drawWithNode(x, png) {
  const N = 256, hop = 64, cols = Math.floor((x.length - N) / hop), rows = N / 2;
  const img = Buffer.alloc((cols + 1) * rows);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < rows; k++) {
      let sr = 0, si = 0;
      for (let i = 0; i < N; i += 2) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N), v = x[c * hop + i] * w, a = 2 * Math.PI * k * i / N; sr += v * Math.cos(a); si -= v * Math.sin(a); }
      re[k] = sr; im[k] = si;
      const db = 10 * Math.log10(sr * sr + si * si + 1e-14);
      img[(rows - 1 - k) * (cols + 1) + 1 + c] = Math.max(0, Math.min(255, Math.round((db + 60) * 3)));
    }
  }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(cols, 0); ihdr.writeUInt32BE(rows, 4); ihdr[8] = 8; ihdr[9] = 0;
  fs.writeFileSync(png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
}
