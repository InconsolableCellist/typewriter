// A real page through the whole stack: the chart scanned by the CIS model and the video path, coded by T.4, sent by
// T.30 over the ideal pipe and over the audio modems and line, decoded and printed by the thermal head.
// docs/fax/plan.md 7.3 item 8.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IdealBitPipe, runCall } from '../src/fax/transport.js';
import { AudioLink, runAudioCall } from '../src/fax/modem/audio-port.js';
import { T30Caller } from '../src/fax/t30/caller.js';
import { T30Answerer } from '../src/fax/t30/answerer.js';
import { T30Endpoint } from '../src/fax/t30/endpoint.js';
import { chartPage, memoPage } from '../src/fax/image/pages.js';
import { scannedSource, linesFor } from '../src/fax/pages/scan-source.js';
import { thermalReceiver } from '../src/fax/pages/receiver.js';

/** The top `heightMm` of a page (rows are contiguous, so a view is enough). */
const crop = (page, heightMm) => {
  const h = Math.round(heightMm * page.dpmmY);
  return { ...page, heightMm, h, data: page.data.subarray(0, page.w * h) };
};
const CHART = chartPage({ dpmm: 16 });

function call({ pages, vres = 'fine', twoD = true, audio = null, pipe = {}, mode = 'text', policy, until = 900 }) {
  const src = scannedSource({ pages, mode });
  const rx = thermalReceiver();
  const evA = [], evB = [];
  const link = audio ? new AudioLink({ preset: audio, seed: 3 }) : null;
  const p = audio ? null : new IdealBitPipe(pipe);
  const A = new T30Endpoint(new T30Caller({ ident: 'A', source: src, vres, twoD }), audio ? link.a : p.a, { name: 'A', onEvent: (a, t) => evA.push({ t, ...a }) });
  const B = new T30Endpoint(new T30Answerer({ ident: 'B', checker: rx.checker, policy }), audio ? link.b : p.b, { name: 'B', onEvent: (a, t) => evB.push({ t, ...a }) });
  const end = audio ? runAudioCall([A, B], link, { until }) : runCall([A, B], p, { until });
  return { src, rx, evA, evB, end, link, pipe: p, A, B };
}

const sameBitmap = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

test('clean line, real audio: the page decoded at the far end is bit-identical to the coded page; MCF', (t) => {
  const r = call({ pages: [CHART], vres: 'standard', twoD: true, audio: 'clean' });
  assert.equal(r.rx.pages.length, 1);
  const got = r.rx.pages[0], sent = r.src.scanned(0, 'standard');
  assert.equal(got.decoded.height, linesFor(297, 'standard'));
  assert.equal(got.decoded.height, sent.height);
  assert.ok(sameBitmap(got.decoded.bitmap, sent.bitmap), 'bit-identical');
  assert.equal(got.result.badLines, 0);
  assert.equal(r.evB.find((e) => e.type === 'page-received').response, 'MCF');
  assert.equal(r.evA.find((e) => e.type === 'hangup').reason, 'complete');
  // the call's length from the coded size at the rate (plan P11), not a manual's figure
  const tm = r.src.timings[0];
  const data = tm.bits / tm.rate;
  t.diagnostic(`standard MR, ${tm.lines} lines, ${tm.bits} bits = ${data.toFixed(1)} s at ${tm.rate}; call ${r.end.toFixed(1)} s; scan ${tm.scanMs.toFixed(0)} ms, decode ${got.decodeMs.toFixed(0)} ms, print ${got.print.ms.toFixed(0)} ms`);
  assert.ok(r.end > data + 5 && r.end < data + 25, `call ${r.end} s for ${data} s of data`);
  // the printout: standard lines printed twice, black where the coded page is black
  assert.equal(got.print.rows, 2 * sent.height);
  let agree = 0, n = 0;
  for (let y = 0; y < sent.height; y += 7) {
    for (let x = 0; x < 1728; x += 3) {
      const bit = (sent.bitmap[y * sent.stride + (x >> 3)] >> (7 - (x & 7))) & 1;
      const d = got.print.density[(2 * y + 1) * 1728 + x] / 255;
      agree += bit ? d > 0.9 : d < 0.1; n++;
    }
  }
  assert.ok(agree / n > 0.995, `printout agrees with the page ${agree / n}`);
});

test('ideal pipe: MH at fine and MR (K = 8) at super fine arrive bit-identical', () => {
  for (const [vres, twoD] of [['fine', false], ['superfine', true]]) {
    const r = call({ pages: [crop(CHART, 70)], vres, twoD });
    const got = r.rx.pages[0], sent = r.src.scanned(0, vres);
    assert.equal(got.params.vres, vres);
    assert.equal(got.decoded.height, sent.height);
    assert.ok(sameBitmap(got.decoded.bitmap, sent.bitmap), `${vres} bit-identical`);
    assert.equal(got.print.rows, sent.height);
  }
  // two pages, halftone
  const r = call({ pages: [crop(memoPage({ dpmm: 8 }), 40), crop(CHART, 40)], vres: 'fine', mode: 'halftone' });
  assert.equal(r.rx.pages.length, 2);
  r.rx.pages.forEach((pg, k) => assert.ok(sameBitmap(pg.decoded.bitmap, r.src.scanned(k, 'fine').bitmap), `page ${k}`));
});

test('line errors: damaged lines are repeated and counted by the decoder, and RTP or RTN follows from the counts', () => {
  const runs = [];
  for (const ber of [4e-5, 1e-3]) {
    const r = call({ pages: [crop(CHART, 90)], vres: 'fine', twoD: false, pipe: { pageErrorRate: ber, seed: 5 } });
    const first = r.rx.pages[0];
    const flags = first.decoded.lineErrors;
    const stride = first.decoded.stride, bm = first.decoded.bitmap;
    let counted = 0;
    for (let y = 0; y < flags.length; y++) {
      if (!flags[y]) continue;
      counted++;
      if (y > 0) assert.ok(sameBitmap(bm.subarray(y * stride, (y + 1) * stride), bm.subarray((y - 1) * stride, y * stride)), `line ${y} repeats ${y - 1}`);
    }
    assert.ok(counted > 0, `errors at ${ber}`);
    assert.equal(counted, first.result.badLines);
    const resp = r.evB.find((e) => e.type === 'page-received').response;
    assert.equal(resp, r.B.station.judgePage(first.result), 'the response is the judgement of the counts');
    runs.push({ ber, bad: counted, run: first.result.maxConsecutiveBad, resp, pagesSent: r.rx.pages.length });
  }
  // a few errors: kept (MCF or RTP); many: RTN, and the page is sent again after a retrain
  assert.ok(['MCF', 'RTP'].includes(runs[0].resp), JSON.stringify(runs));
  assert.equal(runs[1].resp, 'RTN', JSON.stringify(runs));
  assert.ok(runs[1].pagesSent > 1, 'resent after RTN');
  // a policy that keeps nothing with errors turns the first case into RTP or RTN
  const strict = call({ pages: [crop(CHART, 90)], vres: 'fine', twoD: false, pipe: { pageErrorRate: 4e-5, seed: 5 }, policy: { mcfMaxBadRatio: 0, mcfMaxRun: 0 } });
  assert.ok(['RTP', 'RTN'].includes(strict.evB.find((e) => e.type === 'page-received').response));
});

test('bad line, real audio: step-down by training, and the page judged from the decoder\'s own counts', (t) => {
  const r = call({ pages: [crop(CHART, 120)], vres: 'fine', twoD: true, audio: 'bad' });
  const tcf = r.link.a.log.filter((l) => l.kind === 'tcf').map((l) => l.rate);
  assert.equal(tcf[0], 9600);
  assert.ok(tcf.at(-1) < 9600, `stepped down ${tcf}`);
  const pg = r.rx.pages[0];
  const resp = r.evB.find((e) => e.type === 'page-received').response;
  t.diagnostic(`rates ${tcf.join(' ')}; page at ${pg.params.rate}: ${pg.result.lines} lines, ${pg.result.badLines} bad, longest run ${pg.result.maxConsecutiveBad} -> ${resp}`);
  assert.equal(resp, r.B.station.judgePage(pg.result));
  assert.equal(r.evA.find((e) => e.type === 'hangup').reason, 'complete');
});
