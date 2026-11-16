#!/usr/bin/env node
// Renders a whole fax call with a real page: our chart (src/fax/image/pages.js) scanned by the CIS model and the video
// path, coded by the T.4 coder, sent by the real T.30 stack over the modems, the exchange and a line of a preset
// (dial tone, DTMF, ringing, answer, CNG/CED, V.21, training, TCF, the page, EOP/MCF, DCN), decoded at the far end
// and printed by the thermal head model. Writes, per render:
//   <name>.wav            the calling machine's line at 48 kHz (its own transmission plus what comes back)
//   <name>_original.png   the page as laid in the feeder (grey reflectance, 8 dots a mm)
//   <name>_coded.png      the bilevel page the scanner coded (what was sent)
//   <name>_printout.png   the received thermal printout: the head's density on thermal paper's colours, 8 a mm
//   <name>_diff.png       printout against original: red where the print is darker, blue where lighter (on 1 mm
//                         averages); damaged lines (repeated by the decoder) marked orange in the left margin
//   <name>.json           the call's events, the page judgement and the timings
//
// Usage: node tools/fax/render_fax.mjs [--all] [--preset typical|clean|noisy|bad] [--vres standard|fine|superfine]
//          [--mode text|halftone] [--coding mh|mr] [--page chart|memo|cover|menu|drawing] [--name NAME] [--seed N]
//          [--out DIR]
//   --all renders the three of the report: typical (fine, halftone, MR), bad (fine, text, MR: step-down and
//   repeated lines) and super fine (typical line, text, MR).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { LINE_RATE, AUDIO_RATE } from '../../src/fax/line/levels.js';
import { Exchange } from '../../src/fax/line/exchange.js';
import { DtmfDialler } from '../../src/fax/line/dtmf.js';
import { upsampleAll } from '../../src/fax/line/resample.js';
import { AudioModemPort } from '../../src/fax/modem/audio-port.js';
import { ToneDetector, signatures } from '../../src/fax/modem/tone-detect.js';
import { T30Caller } from '../../src/fax/t30/caller.js';
import { T30Answerer } from '../../src/fax/t30/answerer.js';
import { T30Endpoint } from '../../src/fax/t30/endpoint.js';
import { PAGES } from '../../src/fax/image/pages.js';
import { PAPER } from '../../src/fax/image/canvas.js';
import { scannedSource, LPMM } from '../../src/fax/pages/scan-source.js';
import { thermalReceiver } from '../../src/fax/pages/receiver.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const OUT = opt('out', '/tmp/claude-0/-home-user-typewriter/f8518805-a6b0-5ba3-88f6-f2782e19df73/scratchpad/fax_render');
const R = LINE_RATE, B = 80;

const jobs = args.includes('--all')
  ? [
    { name: 'typical_fine_halftone', preset: 'typical', vres: 'fine', mode: 'halftone', coding: 'mr', page: 'chart' },
    { name: 'bad_fine_text', preset: 'bad', vres: 'fine', mode: 'text', coding: 'mr', page: 'chart' },
    { name: 'typical_superfine_text', preset: 'typical', vres: 'superfine', mode: 'text', coding: 'mr', page: 'chart' },
  ]
  : [{
    preset: opt('preset', 'typical'), vres: opt('vres', 'fine'), mode: opt('mode', 'halftone'), coding: opt('coding', 'mr'),
    page: opt('page', 'chart'),
  }];
for (const j of jobs) {
  j.name ??= opt('name', `${j.preset}_${j.vres}_${j.mode}`);
  j.seed = +opt('seed', 7);
  render(j);
}

function render({ name, preset, vres, mode, coding, page: pageName, seed }) {
  const timing = {};
  let t0 = performance.now();
  const page = PAGES[pageName]({ dpmm: 16 });
  timing.drawPageMs = performance.now() - t0;
  const src = scannedSource({ pages: [page], mode, seed });
  const rx = thermalReceiver();
  const events = [];
  const note = (t, who, what) => { events.push({ t: +t.toFixed(3), who, what }); };

  const ex = new Exchange({ ports: { A: '5551001', B: '5551002' }, preset, seed,
    onEvent: (e) => { if (['offHook', 'ringOn', 'answer', 'onHook', 'busy', 'reorder'].includes(e.type)) note(e.t / R, `exchange ${e.port}`, e.type); } });
  const portA = new AudioModemPort({ name: 'A' }), portB = new AudioModemPort({ name: 'B' });
  const A = new T30Endpoint(new T30Caller({ ident: '+1 555 1001', source: src, vres, twoD: coding === 'mr' }), portA,
    { name: 'A', onEvent: (a, t) => note(t, 'T.30 A', a.type + (a.reason ? ` ${a.reason}` : '') + (a.response ? ` ${a.response}` : '')) });
  const Bep = new T30Endpoint(new T30Answerer({ ident: '+1 555 1002', checker: rx.checker }), portB,
    { name: 'B', onEvent: (a, t) => note(t, 'T.30 B', a.type + (a.reason ? ` ${a.reason}` : '') + (a.response ? ` ${a.response}` : '')) });
  const io = {
    A: { loop: new Uint8Array(B), tx: new Float32Array(B), rx: new Float32Array(B), ring: null },
    B: { loop: new Uint8Array(B), tx: new Float32Array(B), rx: new Float32Array(B), ring: new Float32Array(B) },
  };
  const dialDetect = new ToneDetector({ sigs: signatures().filter((s) => s.name === 'dial') });
  let dialler = null, aStarted = false, bStarted = false, heardDial = false;
  let aHook = 0, bHook = 0, ringsSeen = 0, answerAt = Infinity, hangA = Infinity, hangB = Infinity, endAt = Infinity;
  const chunks = [];
  t0 = performance.now();
  for (let n = 0; n < 900 * R && n < endAt; n += B) {
    const t = n / R;
    if (t >= 0.4 && t < hangA) aHook = 1;
    if (!heardDial && dialDetect.events.length) { heardDial = true; dialler = new DtmfDialler('5551002'); note(t, 'FO-70', 'dial tone heard: dialling'); }
    io.A.tx.fill(0); io.B.tx.fill(0);
    const ringOns = ex.events.filter((e) => e.type === 'ringOn' && e.port === 'B').length;
    if (ringOns !== ringsSeen) { ringsSeen = ringOns; if (ringOns === 2) answerAt = t + 3.0; }
    if (t >= answerAt && t < hangB) bHook = 1;
    io.A.loop.fill(aHook); io.B.loop.fill(bHook);
    if (dialler && dialler.done && !aStarted) { aStarted = true; A.start(t + 0.5); }
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
    const c = new Float32Array(B);
    for (let i = 0; i < B; i++) c[i] = io.A.tx[i] + io.A.rx[i];
    chunks.push(c);
    if (A.done && portA.idle && hangA === Infinity) hangA = t + 0.4;
    if (Bep.done && portB.idle && hangB === Infinity) hangB = t + 0.6;
    if (t >= hangA && t >= hangB && endAt === Infinity) endAt = n + 1.0 * R;
    if (t >= hangA) aHook = 0;
    if (t >= hangB) bHook = 0;
  }
  timing.callWallMs = performance.now() - t0;
  for (const [who, port] of [['A', portA], ['B', portB]]) {
    for (const l of port.log) {
      const what = l.kind === 'v21' ? `V.21 ${l.frames.join(' ')}` : l.kind === 'tone' ? l.tone : `${l.kind === 'tcf' ? 'TCF' : 'page'} ${l.rate}`;
      note(l.start, `line ${who}`, `${what} until ${l.end.toFixed(2)} s`);
    }
  }
  events.sort((a, b) => a.t - b.t);
  const x8 = new Float32Array(chunks.length * B);
  chunks.forEach((c, k) => x8.set(c, k * B));
  timing.callSeconds = x8.length / R;

  fs.mkdirSync(OUT, { recursive: true });
  const base = path.join(OUT, name);
  writeWav(`${base}.wav`, upsampleAll(x8));

  // Images on a common grid of 8 dots a mm both ways
  const W = 1728, Hmm = page.heightMm, H = Math.round(Hmm * 8);
  const orig = new Float32Array(W * H);      // original density, 0 paper .. 1 ink
  const xoff = (W / 8 - page.widthMm) / 2;   // the page centred on the bar
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const xm = (x + 0.5) / 8 - xoff, ym = (y + 0.5) / 8;
      let r = PAPER;
      if (xm >= 0 && xm < page.widthMm) {
        let s = 0;
        const px = Math.floor(xm * page.dpmmX - 1), py = Math.floor(ym * page.dpmmY - 1);
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) s += page.data[Math.min(page.h - 1, py + 1 + dy) * page.w + Math.min(page.w - 1, px + 1 + dx)];
        r = s / 4 / 255;
      }
      orig[y * W + x] = Math.max(0, Math.min(1, (PAPER - r) / (PAPER - 0.06)));
    }
  }
  const g8 = new Uint8Array(W * H);
  for (let i = 0; i < g8.length; i++) g8[i] = Math.round((PAPER - orig[i] * (PAPER - 0.06)) * 255);
  writePng(`${base}_original.png`, W, H, g8, 1);

  const sent = src.scanned(0, rx.pages[0]?.params.vres ?? vres);
  const coded = resampleRows(sent.height, sent.stride, (y, x) => (sent.bitmap[y * sent.stride + (x >> 3)] >> (7 - (x & 7))) & 1, sent.lpmm, H, W);
  const cg = new Uint8Array(W * H);
  for (let i = 0; i < cg.length; i++) cg[i] = 255 - Math.round(coded[i] * 255);
  writePng(`${base}_coded.png`, W, H, cg, 1);

  const pages = [];
  rx.pages.forEach((pg, k) => {
    const pr = pg.print;
    const rowsPerMm = 1 / pr.pitchMm;
    const dens = resampleRows(pr.rows, W, (y, x) => pr.density[y * W + x] / 255, rowsPerMm, H, W);
    // thermal paper: a faintly blue-grey white ground, a blue-black image [A: the colours of the renderer to come]
    const rgb = new Uint8Array(W * H * 3);
    const ground = [236, 238, 234], ink = [34, 33, 52];
    for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) rgb[3 * i + c] = Math.round(ground[c] + (ink[c] - ground[c]) * dens[i]);
    const suffix = rx.pages.length > 1 ? `_p${k + 1}` : '';
    writePng(`${base}_printout${suffix}.png`, W, H, rgb, 3);
    // diff on 1 mm (8 x 8) averages, damaged lines marked
    const diff = new Uint8Array(W * H * 3);
    let sumAbs = 0, cells = 0;
    for (let cy = 0; cy < H; cy += 8) {
      for (let cx = 0; cx < W; cx += 8) {
        let a = 0, b = 0, m = 0;
        for (let y = cy; y < Math.min(H, cy + 8); y++) for (let x = cx; x < cx + 8; x++) { a += dens[y * W + x]; b += orig[y * W + x]; m++; }
        const d = (a - b) / m;
        sumAbs += Math.abs(d); cells++;
        for (let y = cy; y < Math.min(H, cy + 8); y++) {
          for (let x = cx; x < cx + 8; x++) {
            const i = 3 * (y * W + x), v = Math.min(1, Math.abs(d) * 2), lum = 255 - Math.round(60 * orig[y * W + x]);
            diff[i] = d > 0 ? lum : Math.round(lum * (1 - v));
            diff[i + 1] = Math.round(lum * (1 - v));
            diff[i + 2] = d < 0 ? lum : Math.round(lum * (1 - v));
          }
        }
      }
    }
    const lpmm = LPMM[pg.params.vres];
    pg.decoded.lineErrors.forEach((e, y) => {
      if (!e) return;
      const yy = Math.min(H - 1, Math.round(((y + 0.5) / lpmm) * 8));
      for (let x = 0; x < 40; x++) for (let dy = -1; dy <= 1; dy++) { const i = 3 * (Math.max(0, Math.min(H - 1, yy + dy)) * W + x); diff[i] = 255; diff[i + 1] = 140; diff[i + 2] = 0; }
    });
    writePng(`${base}_diff${suffix}.png`, W, H, diff, 3);
    pages.push({
      response: events.find((e) => e.who === 'T.30 B' && e.what.startsWith('page-received'))?.what,
      rate: pg.params.rate, vres: pg.params.vres, coding: pg.params.twoD ? 'MR' : 'MH', ...pg.result,
      repeatedLines: [...pg.decoded.lineErrors].reduce((s, v) => s + v, 0),
      meanAbsDensityError1mm: +(sumAbs / cells).toFixed(4), decodeMs: +pg.decodeMs.toFixed(1), printMs: +pr.ms.toFixed(1),
      printEnergyJ: +pr.energyJ.toFixed(2), headThermistorC: rx.head.thermistorC,
    });
  });
  const tx = src.timings.map((s) => ({ rate: s.rate, vres: s.vres, lines: s.lines, bits: s.bits, fillBits: s.fill, scanMs: +s.scanMs.toFixed(1), codeMs: +s.codeMs.toFixed(1), seconds: +(s.bits / s.rate).toFixed(2) }));
  const summary = { name, preset, vres, mode, coding, page: pageName, timing: { ...Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, +v.toFixed(1)])) }, sent: tx, received: pages, events };
  fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 1));
  console.log(`== ${name}: ${preset} line, ${vres}, ${mode}, ${coding.toUpperCase()}; call ${timing.callSeconds.toFixed(1)} s simulated in ${(timing.callWallMs / 1000).toFixed(1)} s`);
  for (const s of tx) console.log(`   sent  ${s.rate} bit/s ${s.vres} ${s.lines} lines ${s.bits} bits (${s.seconds} s of data, ${s.fillBits} fill), scan ${s.scanMs} ms, code ${s.codeMs} ms`);
  for (const p of pages) console.log(`   rcvd  ${p.rate} bit/s ${p.lines} lines, ${p.badLines} bad (max run ${p.maxConsecutiveBad}) -> ${p.response}; decode ${p.decodeMs} ms, print ${p.printMs} ms; mean |density error| on 1 mm ${p.meanAbsDensityError1mm}`);
  for (const e of events.filter((e) => /^line|T\.30/.test(e.who))) console.log(`   ${String(e.t.toFixed(2)).padStart(7)} s  ${e.who.padEnd(7)} ${e.what}`);
  console.log(`   ${base}.wav\n   ${base}_original.png\n   ${base}_coded.png\n   ${base}_printout.png\n   ${base}_diff.png`);
}


/** Resample rows at rowsPerMm to H rows at 8 a mm (box average over each output row's span). */
function resampleRows(rows, _stride, get, rowsPerMm, H, W) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const a = (y / 8) * rowsPerMm, b = ((y + 1) / 8) * rowsPerMm;
    let wsum = 0;
    for (let r = Math.floor(a); r < Math.ceil(b) && r < rows; r++) {
      const w = Math.min(b, r + 1) - Math.max(a, r);
      if (w <= 0) continue;
      wsum += w;
      for (let x = 0; x < W; x++) out[y * W + x] += w * get(r, x);
    }
    if (wsum > 0) for (let x = 0; x < W; x++) out[y * W + x] /= wsum;
  }
  return out;
}

function writeWav(file, x) {
  const gain = 0.89 * 32767;
  const pcm = Buffer.alloc(44 + x.length * 2);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + x.length * 2, 4); pcm.write('WAVE', 8); pcm.write('fmt ', 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(AUDIO_RATE, 24);
  pcm.writeUInt32LE(AUDIO_RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * gain), 44 + 2 * i);
  fs.writeFileSync(file, pcm);
}

function writePng(file, w, h, px, channels) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
  const rowLen = w * channels;
  const raw = Buffer.alloc((rowLen + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * rowLen, rowLen).copy(raw, y * (rowLen + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 0;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
