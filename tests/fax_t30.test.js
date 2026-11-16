// Fax milestone M2: HDLC framing, the T.30 frames and both ends of the T.30 call procedure over an ideal bit pipe.
// Whole-call scripts are compared with signal ladders (who sent what, in order) and their timelines with the
// Recommendation's figures. Constants marked [M] in the sources are from memory of T.30; see docs/fax/research.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { crc16, appendFcs, checkFcs, stuffBits, unstuffBits, encodeHdlc, decodeHdlc, HdlcDecoder, PREAMBLE_FLAGS, CONTROL, CONTROL_FINAL } from '../src/fax/hdlc.js';
import {
  FCF, encodeFrame, decodeFrame, encodeIdent, decodeIdent, buildDIS, parseDIS, buildDCS, parseDCS, buildDTC,
  DCS_RATE_CODES, DIS_RATE_CODES, CAPS_BITS, describeFrame, scanMsFor,
} from '../src/fax/t30/frames.js';
import { T30_TIMERS, T30_TIMING, TimerSet } from '../src/fax/t30/timers.js';
import { T30Caller } from '../src/fax/t30/caller.js';
import { T30Answerer } from '../src/fax/t30/answerer.js';
import { T30Endpoint } from '../src/fax/t30/endpoint.js';
import { stubSource, stubChecker, A4_LINES } from '../src/fax/t30/stub-page.js';
import { IdealBitPipe, runCall, TRAINING_SECONDS } from '../src/fax/transport.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} not within ${tol} of ${b}`);

/** A two-ended call: caller on port A, answerer on port B. */
function call({ caller = {}, answerer = {}, pipe = {}, until = 600, actions = [] } = {}) {
  const p = new IdealBitPipe(pipe);
  const A = new T30Endpoint(new T30Caller({ ident: '+1 555 0100', ...caller }), p.a, { name: 'A' });
  const B = new T30Endpoint(new T30Answerer({ ident: '+1 555 0199', ...answerer }), p.b, { name: 'B' });
  const end = runCall([A, B], p, { until, actions: actions.map(([t, f]) => [t, (tt) => f(tt, A, B)]) });
  return { pipe: p, A, B, end, ladder: p.ladder() };
}
const events = (ep, type) => ep.events.filter((e) => e.type === type);
const hangup = (ep) => events(ep, 'hangup')[0];
const log = (r, pred) => r.pipe.log.filter(pred);

// ---------------------------------------------------------------------------------------------------------------
// HDLC

test('HDLC: CRC-16 check value, FCS append and check', () => {
  const s = Uint8Array.from('123456789', (c) => c.charCodeAt(0));
  assert.equal(crc16(s), 0x906e);
  const f = appendFcs(s);
  assert.deepEqual([f[9], f[10]], [0x6e, 0x90], 'low octet first');
  assert.ok(checkFcs(f));
  f[3] ^= 0x10;
  assert.ok(!checkFcs(f));
});

test('HDLC: zero insertion after five 1s at every position, and its inverse', () => {
  for (let pos = 0; pos < 24; pos++) {
    for (let run = 4; run <= 8; run++) {
      let v = 0n;
      for (let i = 0; i < run; i++) v |= 1n << BigInt(pos + i);
      const bytes = new Uint8Array(5);
      for (let i = 0; i < 5; i++) bytes[i] = Number((v >> BigInt(8 * i)) & 0xffn);
      const bits = stuffBits(bytes);
      let ones = 0;
      for (const b of bits) { ones = b ? ones + 1 : 0; assert.ok(ones <= 5, 'never six 1s in a row'); }
      assert.equal(bits.length, 40 + Math.floor(run / 5));
      assert.deepEqual(unstuffBits(bits), bytes);
    }
  }
  assert.deepEqual(stuffBits([0xff]), [1, 1, 1, 1, 1, 0, 1, 1, 1]);
});

test('HDLC: preamble, frames and flags decode back; aborts and FCS failures are reported', () => {
  const f1 = encodeFrame({ name: 'CSI', final: false, fif: encodeIdent('123') });
  const f2 = encodeFrame({ name: 'DIS', fif: buildDIS({}) });
  const { bits, frameSpans } = encodeHdlc([f1, f2]);
  assert.equal(frameSpans.length, 2);
  for (let i = 0; i < PREAMBLE_FLAGS * 8; i += 8) assert.deepEqual([...bits.slice(i, i + 8)], [0, 1, 1, 1, 1, 1, 1, 0]);
  const out = decodeHdlc(bits);
  assert.equal(out.length, 2);
  assert.ok(out.every((f) => f.ok));
  assert.deepEqual(out[0].bytes, f1);
  assert.deepEqual(out[1].bytes, f2);
  // An FCS failure: flip one bit inside frame 2's body.
  const bad = bits.slice();
  bad[frameSpans[1][0] + 30] ^= 1;
  const out2 = decodeHdlc(bad);
  assert.ok(out2[0].ok);
  assert.equal(out2.filter((f) => !f.ok).length, 1);
  assert.ok(['fcs', 'align'].includes(out2.find((f) => !f.ok).reason));
  // An abort (seven 1s) inside frame 1 loses it; frame 2 still decodes.
  const ab = bits.slice();
  for (let i = 0; i < 7; i++) ab[frameSpans[0][0] + 10 + i] = 1;
  const d = new HdlcDecoder();
  const out3 = d.pushBits(ab);
  assert.equal(d.stats.aborts, 1);
  assert.ok(out3.some((f) => f.ok && f.bytes[2] === FCF.DIS));
  assert.ok(!out3.some((f) => f.ok && f.bytes[2] === FCF.CSI));
});

test('HDLC: the decoder survives a bit error at every position and resynchronises on the next flag', () => {
  const frames = [encodeFrame({ name: 'TSI', final: false, x: 1, fif: encodeIdent('+44 20 7946 0000') }), encodeFrame({ name: 'DCS', x: 1, fif: buildDCS({ rate: 9600 }) })];
  const { bits, frameSpans } = encodeHdlc([...frames, encodeFrame({ name: 'MCF' })], { preambleFlags: 4 });
  const third = encodeFrame({ name: 'MCF' });
  for (let i = 0; i < frameSpans[1][1]; i++) {
    const b = bits.slice();
    b[i] ^= 1;
    const d = new HdlcDecoder();
    const out = d.pushBits(b);
    // No false frame is ever accepted, and the frame after the damaged one is always recovered.
    for (const f of out) if (f.ok) assert.ok(frames.some((g) => g.length === f.bytes.length && g.every((x, k) => x === f.bytes[k])) || f.bytes.every((x, k) => x === third[k]), `bit ${i}`);
    assert.ok(out.some((f) => f.ok && f.bytes.length === third.length && f.bytes[2] === FCF.MCF), `MCF recovered after an error at bit ${i}`);
  }
  // Chunked input gives the same frames as one push.
  const d1 = new HdlcDecoder(), d2 = new HdlcDecoder();
  const one = d1.pushBits(bits);
  const chunked = [];
  for (let i = 0; i < bits.length; i += 7) d2.pushBits(bits.subarray(i, i + 7), chunked);
  assert.deepEqual(chunked.map((f) => [...f.bytes]), one.map((f) => [...f.bytes]));
});

// ---------------------------------------------------------------------------------------------------------------
// Frames

test('frames: FCF codes, the X bit and the control field', () => {
  // Written form in line order, reversed into the octet [M].
  const written = { DIS: '00000001', CSI: '00000010', NSF: '00000100', DTC: '10000001', CIG: '10000010', DCS: '01000001', TSI: '01000010', CFR: '00100001', FTT: '00100010', EOM: '01110001', MPS: '01110010', EOP: '01110100', 'PRI-EOP': '01111100', MCF: '00110001', RTP: '00110011', RTN: '00110010', DCN: '01011111', CRP: '01011000' };
  for (const [name, w] of Object.entries(written)) {
    let v = 0;
    for (let i = 0; i < 8; i++) v |= (w[i] === '1' ? 1 : 0) << i;
    assert.equal(FCF[name], v, name);
  }
  for (const name of Object.keys(FCF)) {
    for (const x of [0, 1]) {
      const fr = decodeFrame(encodeFrame({ name, x, final: x === 1 }));
      assert.equal(fr.name, name);
      assert.ok(fr.valid);
      assert.equal(fr.final, x === 1);
      if (!['DIS', 'CSI', 'NSF', 'DTC', 'CIG', 'NSC'].includes(name)) assert.equal(fr.x, x, `${name} X`);
    }
  }
  assert.equal(encodeFrame({ name: 'DCS', x: 1 })[2], 0x83);
  assert.equal(encodeFrame({ name: 'DIS', x: 1 })[2], 0x80, 'DIS has no X bit');
  assert.equal(encodeFrame({ name: 'MCF', final: false })[1], CONTROL);
  assert.equal(encodeFrame({ name: 'MCF' })[1], CONTROL_FINAL);
  assert.equal(decodeFrame(Uint8Array.of(0xff, 0x13, 0x77)).name, null);
  assert.equal(decodeFrame(Uint8Array.of(0x00, 0x13, 0x8c)).valid, false);
});

test('frames: CSI/TSI/CIG identification is 20 characters, last first, space padded', () => {
  const fif = encodeIdent('+1 555 0100');
  assert.equal(fif.length, 20);
  assert.equal(fif[19], '+'.charCodeAt(0));
  assert.equal(fif[0], 32);
  assert.equal(fif[9], '0'.charCodeAt(0));
  assert.equal(decodeIdent(fif), '+1 555 0100');
  assert.equal(decodeIdent(encodeIdent('12345678901234567890123')), '12345678901234567890');
});

test('frames golden: DIS and DCS built from fields give the octets of the bit table, and parse back', () => {
  // Bits set: 10 (receive), 11 and 12 (V.27ter + V.29), 15 (fine), 19 (A4 + B4), 21 and 22 (20 ms / 10 ms).
  const dis = buildDIS({ rates: [9600, 7200, 4800, 2400], fine: true, widths: [215], lengths: ['A4', 'B4'], scan: { standard: 20, fine: 10 } });
  assert.deepEqual([...dis], [0x00, 0x4e, 0x34]);
  const p = parseDIS(dis);
  assert.equal(p.rateCode, '1100');
  assert.deepEqual(p.rates, [9600, 7200, 4800, 2400]);
  assert.deepEqual(p.modems, ['V.27ter', 'V.29']);
  assert.equal(p.fine, true);
  assert.equal(p.twoD, false);
  assert.deepEqual(p.widths, [215]);
  assert.deepEqual(p.lengths, ['A4', 'B4']);
  assert.deepEqual(p.scan, { standard: 20, fine: 10 });
  assert.equal(p.canReceive, true);
  assert.equal(p.readyToTransmit, false);
  assert.equal(p.extend24, false);
  // Polling bit and the extension octet.
  const dtc = buildDTC({ readyToTransmit: true, rates: [4800, 2400], twoD: true, ecm: true, scan: { standard: 0, fine: 0 } });
  assert.deepEqual([...dtc], [0x00, 0x8b, 0xf0, 0x04]);
  const q = parseDIS(dtc);
  assert.equal(q.readyToTransmit, true);
  assert.deepEqual(q.rates, [4800, 2400]);
  assert.equal(q.twoD, true);
  assert.equal(q.ecm, true);
  assert.equal(q.extend24, true);
  assert.deepEqual(q.scan, { standard: 0, fine: 0 });
  // DCS at each base-procedure rate: octet 2 is bit 10 plus the rate code (and bit 15 for fine).
  const want = { 9600: 0x06, 7200: 0x0e, 4800: 0x0a, 2400: 0x02 };
  for (const [rate, o1] of Object.entries(want)) {
    const d = buildDCS({ rate: Number(rate), scanMs: 20 });
    assert.deepEqual([...d], [0x00, o1, 0x00], `DCS ${rate}`);
    assert.equal(parseDCS(d).rate, Number(rate));
  }
  const dcs = buildDCS({ rate: 9600, fine: true, scanMs: 10, length: 'B4', width: 255 });
  assert.deepEqual([...dcs], [0x00, 0x46, 0x25]);
  const r = parseDCS(dcs);
  assert.deepEqual([r.rate, r.modem, r.fine, r.scanMs, r.length, r.width], [9600, 'V.29', true, 10, 'B4', 255]);
  // Every DCS rate code decodes, V.17 ones flagged as reserved for later.
  for (const [code, v] of Object.entries(DCS_RATE_CODES)) {
    const fif = new Uint8Array(3);
    for (let i = 0; i < 4; i++) if (code[i] === '1') fif[(10 + i) >> 3] |= 1 << ((10 + i) & 7);
    const d = parseDCS(fif);
    assert.equal(d.rate, v.rate);
    assert.equal(d.v17Reserved, !!v.reservedForLater);
  }
  assert.ok(DIS_RATE_CODES['1101'].reservedForLater);
  assert.ok(CAPS_BITS.every((b) => b.memory), 'every bit position is marked as from memory');
  assert.equal(describeFrame(decodeFrame(encodeFrame({ name: 'DCS', fif: dcs }))), 'DCS(9600,F,10ms)');
  // Short or damaged fields parse without throwing.
  assert.equal(parseDIS(new Uint8Array(1)).short, true);
});

test('frames golden: the extended field to bit 48 (super fine, bit 46) and the extend chain', () => {
  // Octet 4 carries only extend bit 32, octet 5 only extend bit 40, octet 6 bits 41 (super fine) and 46.
  const dis = buildDIS({ rates: [9600, 7200, 4800, 2400], fine: true, twoD: true, superFine: true, scanHalfAtHigher: true });
  assert.deepEqual([...dis], [0x00, 0xce, 0x80, 0x80, 0x80, 0x21]);
  const p = parseDIS(dis);
  assert.deepEqual([p.octets, p.extend24, p.extend32, p.extend40, p.extend48], [6, true, true, true, false]);
  assert.equal(p.superFine, true);
  assert.equal(p.scanHalfAtHigher, true);
  assert.equal(p.ecm, false);
  assert.equal(scanMsFor({ scan: { standard: 20, fine: 10 }, scanHalfAtHigher: true }, 'superfine'), 5);
  assert.equal(scanMsFor({ scan: { standard: 20, fine: 10 }, scanHalfAtHigher: false }, 'superfine'), 10);
  const dcs = parseDCS(buildDCS({ rate: 7200, superFine: true, twoD: true, scanMs: 5 }));
  assert.deepEqual([dcs.rate, dcs.vres, dcs.fine, dcs.twoD, dcs.scanMs, dcs.octets], [7200, 'superfine', false, true, 5, 6]);
  // Option bits beyond a broken extend chain are ignored; octets after it are counted, not read.
  const broken = Uint8Array.of(0x00, 0xce, 0x00, 0x04, 0xff, 0xff);
  const b = parseDIS(broken);
  assert.deepEqual([b.octets, b.trailing, b.ecm, b.superFine], [3, 3, false, false]);
});

test('frames: a 1999 far end\'s DIS of any length parses, unknown bits ignored (plan P3)', () => {
  // V.17 rate code, ECM, MMR, 300 and 400 dpi, selective polling, and two octets past bit 48 (the last ends the chain).
  const dis = buildDIS({ rateCode: '1101', fine: true, twoD: true, ecm: true, t6: true, uncompressed: true, superFine: true, res300: true, res400: true, selectivePolling: true, extra: Uint8Array.of(0x81, 0x7f) });
  assert.equal(dis.length, 8);
  const p = parseDIS(dis);
  assert.deepEqual(p.rates, [9600, 7200, 4800, 2400]);
  assert.ok(p.v17Reserved && p.ecm && p.t6 && p.res300 && p.res400 && p.selectivePolling);
  assert.deepEqual([...p.extra], [0x81, 0x7f]);
  // Random FIFs of every length never throw.
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  for (let n = 0; n < 40; n++) {
    const f = Uint8Array.from({ length: n }, rnd);
    parseDIS(f);
    parseDCS(f);
  }
  // An unknown rate code falls back to its V.29 and V.27ter bits.
  const odd = new Uint8Array(3);
  odd[1] = 0x04 | 0x08 | 0x10 | 0x20;   // bits 11 to 14 all set: '1111', not a defined code
  assert.equal(parseDIS(odd).rateCode, '1111');
  assert.deepEqual(parseDIS(odd).rates, [9600, 7200, 4800, 2400]);
});

test('timers: T1 35 s, T2 6 s, T3 10 s, T4 3 s; TimerSet expires in order', () => {
  assert.deepEqual({ ...T30_TIMERS }, { T1: 35, T2: 6, T3: 10, T4: 3 });
  const ts = new TimerSet();
  ts.start('T4', 1, 3);
  ts.start('T1', 0, 35);
  assert.equal(ts.deadline, 4);
  assert.deepEqual(ts.expire(3.9), []);
  assert.deepEqual(ts.expire(40), ['T4', 'T1']);
  assert.equal(ts.deadline, Infinity);
});

// ---------------------------------------------------------------------------------------------------------------
// Whole calls

const PAGE = { lines: 60 };

test('call: one page at 9600, the clean ladder, and the page arrives bit for bit', () => {
  const src = stubSource({ pages: 1, ...PAGE });
  let sentBits = null;
  const r = call({ caller: { source: src }, pipe: { delay: 0.02, hook: (tx) => { if (tx.kind === 'page') sentBits = Uint8Array.from(tx.bits); } } });
  assert.deepEqual(r.ladder, ['A CNG', 'B CED', 'B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A EOP', 'B MCF', 'A DCN']);
  assert.deepEqual(hangup(r.A), { t: hangup(r.A).t, type: 'hangup', reason: 'complete', ok: true });
  assert.equal(hangup(r.B).reason, 'complete');
  const got = events(r.B, 'page-received');
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].bits, sentBits);
  assert.deepEqual(got[0].result, { lines: 60, badLines: 0, maxConsecutiveBad: 0 });
  assert.equal(r.A.station.remote.ident, '+1 555 0199');
  assert.equal(r.B.station.remote.ident, '+1 555 0100');
  assert.equal(r.B.station.remote.dcs.rate, 9600);
  assert.equal(r.B.station.remote.dcs.fine, true);
  assert.equal(r.B.station.remote.dcs.scanMs, 10, 'fine: the receiver\'s 10 ms');
  assert.equal(r.A.station.pagesSent, 1);
  assert.equal(r.B.station.pagesReceived, 1);
});

test('call: the X bit is 1 in the caller\'s frames and 0 in the answerer\'s', () => {
  const seen = [];
  call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { hook: (tx) => { if (tx.kind === 'v21') for (const f of decodeHdlc(tx.bits)) seen.push([tx.from, decodeFrame(f.bytes)]); } } });
  for (const [from, fr] of seen) if (!['DIS', 'CSI', 'NSF', 'DTC', 'CIG'].includes(fr.name)) assert.equal(fr.x, from === 'A' ? 1 : 0, `${from} ${fr.name}`);
  assert.ok(seen.length >= 6);
});

test('call: a late-1990s far end with NSF, V.17, ECM and MMR in its DIS: the FO-70 side picks V.29 9600 and MR', () => {
  const nsf = Uint8Array.of(0x00, 0x00, 0x7a, 0x12, 0x34, 0x56, 0x78);   // country code and maker code, opaque
  const r = call({
    caller: { source: stubSource({ pages: 1, ...PAGE }) },
    answerer: { nsf, advertise: { rateCode: '1101', ecm: true, t6: true, res300: true, selectivePolling: true } },
  });
  assert.deepEqual(r.ladder.slice(2, 6), ['B NSF CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR']);
  assert.deepEqual([...r.A.station.remote.nsf], [...nsf]);
  const d = r.B.station.remote.dcs;
  assert.deepEqual([d.rate, d.modem, d.twoD, d.ecm, d.t6, d.v17Reserved], [9600, 'V.29', true, false, false, false]);
  assert.ok(hangup(r.A).ok && hangup(r.B).ok);
});

test('call: an NSS before TSI and DCS is skipped by the FO-70 answering', () => {
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }), nss: Uint8Array.of(0xad, 0x00, 0x99) } });
  assert.deepEqual(r.ladder.slice(3, 6), ['A NSS TSI DCS', 'A TCF 9600', 'B CFR']);
  assert.ok(hangup(r.B).ok);
});

test('call: super fine when both ends have it, fine when the far end does not', () => {
  const sf = call({ caller: { source: stubSource({ pages: 1, ...PAGE }), vres: 'superfine' } });
  assert.deepEqual([sf.B.station.remote.dcs.vres, sf.B.station.remote.dcs.scanMs], ['superfine', 10]);
  assert.equal(events(sf.B, 'page-received')[0].accepted, true);
  const f = call({ caller: { source: stubSource({ pages: 1, ...PAGE }), vres: 'superfine' }, answerer: { caps: { superFine: false } } });
  assert.equal(f.B.station.remote.dcs.vres, 'fine');
  const std = call({ caller: { source: stubSource({ pages: 1, ...PAGE }), vres: 'standard' } });
  assert.deepEqual([std.B.station.remote.dcs.vres, std.B.station.remote.dcs.scanMs], ['standard', 20]);
});

test('call: three pages, MPS, MPS, EOP', () => {
  const r = call({ caller: { source: stubSource({ pages: 3, ...PAGE }) } });
  assert.deepEqual(r.ladder.slice(2), ['B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A MPS', 'B MCF', 'A PAGE 9600', 'A MPS', 'B MCF', 'A PAGE 9600', 'A EOP', 'B MCF', 'A DCN']);
  assert.deepEqual(events(r.A, 'page-sent').map((e) => [e.page, e.response]), [[0, 'MCF'], [1, 'MCF'], [2, 'MCF']]);
  assert.equal(r.B.station.pagesReceived, 3);
  assert.ok(hangup(r.A).ok && hangup(r.B).ok);
});

test('call: EOM returns to phase B with a fresh DIS before the next page', () => {
  const r = call({ caller: { source: stubSource({ pages: 2, ...PAGE }), eomAfter: [0] } });
  assert.deepEqual(r.ladder.slice(2), ['B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A EOM', 'B MCF', 'B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A EOP', 'B MCF', 'A DCN']);
  assert.equal(r.B.station.pagesReceived, 2);
});

test('call: FTT steps down 9600 -> 7200 -> 4800 when TCF fails at the higher rates', () => {
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { tcfErrorRate: (rate) => (rate > 4800 ? 1e-3 : 0) } });
  assert.deepEqual(r.ladder.slice(2), ['B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B FTT', 'A TSI DCS', 'A TCF 7200', 'B FTT', 'A TSI DCS', 'A TCF 4800', 'B CFR', 'A PAGE 4800', 'A EOP', 'B MCF', 'A DCN']);
  const tcf = r.B.station.log.filter((e) => e.what === 'tcf');
  assert.deepEqual(tcf.map((e) => e.ok), [false, false, true]);
  assert.ok(tcf[0].errors > 0 && tcf[2].errors === 0);
  assert.equal(r.B.station.remote.dcs.rate, 4800);
  assert.ok(hangup(r.A).ok);
});

test('call: training fails at every rate: FTT at 2400 ends the call with DCN', () => {
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { tcfErrorRate: 1e-2 } });
  assert.deepEqual(r.ladder.filter((s) => s.includes('TCF')), ['A TCF 9600', 'A TCF 7200', 'A TCF 4800', 'A TCF 2400']);
  assert.equal(r.ladder.at(-1), 'A DCN');
  assert.equal(hangup(r.A).reason, 'training-failed');
  assert.equal(hangup(r.B).reason, 'remote-dcn');
});

/** Flip every `step`-th bit of the page data from bit `from` on, for the given page transmissions (by seq). */
const damagePages = (seqs, { step = 97, from = 0 } = {}) => (tx) => {
  if (tx.kind === 'page' && seqs.includes(tx.seq)) for (let i = from; i < tx.bits.length; i += step) tx.bits[i] ^= 1;
};

test('call: RTN after too many bad lines: retrain one rate lower and send the page again', () => {
  const r = call({ caller: { source: stubSource({ pages: 2, ...PAGE }) }, pipe: { hook: damagePages([1]) } });
  assert.deepEqual(r.ladder.slice(2), [
    'B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A MPS', 'B MCF',
    'A PAGE 9600', 'A EOP', 'B RTN',                                  // page 2 damaged
    'A TSI DCS', 'A TCF 7200', 'B CFR', 'A PAGE 7200', 'A EOP', 'B MCF', // retrain, resend
    'A DCN']);
  assert.deepEqual(events(r.A, 'page-sent').map((e) => [e.page, e.response]), [[0, 'MCF'], [1, 'RTN'], [1, 'MCF']]);
  const rej = events(r.B, 'page-received').find((e) => !e.accepted);
  assert.ok(rej.result.badLines / rej.result.lines > 0.05);
  assert.equal(r.B.station.pagesReceived, 2);
  assert.ok(hangup(r.A).ok);
});

test('call: RTN every time: three resends, then DCN', () => {
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { hook: damagePages([0, 1, 2, 3, 4, 5]) } });
  assert.deepEqual(r.ladder.filter((s) => s.includes('PAGE')), ['A PAGE 9600', 'A PAGE 7200', 'A PAGE 4800', 'A PAGE 2400']);
  assert.equal(r.ladder.filter((s) => s === 'B RTN').length, 4);
  assert.equal(hangup(r.A).reason, 'page-rejected');
  assert.equal(r.B.station.pagesReceived, 0);
});

test('call: RTP for a few bad lines: the page is kept, the next page follows a retrain at the same rate', () => {
  // One line in 20 damaged in page 1: between the MCF and RTP limits.
  const hook = (tx) => { if (tx.kind === 'page' && tx.seq === 0) for (let ln = 5; ln < 60; ln += 20) tx.bits[ln * 212 + 40] ^= 1; };
  const r = call({ caller: { source: stubSource({ pages: 2, ...PAGE }) }, pipe: { hook } });
  assert.deepEqual(r.ladder.slice(2), ['B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A MPS', 'B RTP', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A EOP', 'B MCF', 'A DCN']);
  assert.equal(r.B.station.pagesReceived, 2);
  assert.equal(events(r.B, 'page-received')[0].result.badLines, 3);
});

test('call: no response: DCS is sent three times, T4 apart, then DCN', () => {
  // Everything the answerer sends after its first DIS is lost.
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { hook: (tx) => (tx.from === 'B' && tx.kind === 'v21' && tx.seq > 0 ? 'drop' : undefined) } });
  assert.deepEqual(r.ladder.slice(2), ['B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR (lost)', 'A TSI DCS', 'A TCF 9600', 'B CFR (lost)', 'A TSI DCS', 'A TCF 9600', 'B CFR (lost)', 'A DCN']);
  const a = log(r, (e) => e.from === 'A');
  const tcfs = a.filter((e) => e.kind === 'tcf');
  const dcs = a.filter((e) => e.kind === 'v21' && e.frames.includes('DCS'));
  for (let i = 1; i < 3; i++) near(dcs[i].start - tcfs[i - 1].end, T30_TIMERS.T4, 1e-9, 'T4 after the TCF');
  near(a.at(-1).start - tcfs[2].end, T30_TIMERS.T4, 1e-9);
  assert.equal(hangup(r.A).reason, 'no-response');
  assert.equal(hangup(r.B).reason, 'remote-dcn');
});

test('call: a lost MCF: EOP is repeated after T4 and answered again, the page counted once', () => {
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { hook: (tx) => (tx.from === 'B' && tx.kind === 'v21' && tx.frames?.includes('MCF') && tx.seq === 2 ? 'drop' : undefined) } });
  assert.deepEqual(r.ladder.slice(-5), ['A EOP', 'B MCF (lost)', 'A EOP', 'B MCF', 'A DCN']);
  assert.equal(r.B.station.pagesReceived, 1);
  assert.equal(events(r.B, 'page-received').length, 1);
  assert.ok(hangup(r.A).ok && hangup(r.B).ok);
});

test('call: a post-message command heard with a bad FCS draws CRP and is repeated', () => {
  let hit = 0;
  const hook = (tx) => { if (tx.from === 'A' && tx.frames?.includes('EOP') && !hit++) tx.bits[tx.bits.length - 20] ^= 1; };
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { hook } });
  assert.deepEqual(r.ladder.slice(-5), ['A EOP', 'B CRP', 'A EOP', 'B MCF', 'A DCN']);
  assert.equal(r.B.station.pagesReceived, 1);
  assert.ok(hangup(r.A).ok && hangup(r.B).ok);
});

test('call: a DCS heard with a bad FCS: the answerer repeats DIS and the caller sends DCS again', () => {
  const hook = (tx) => { if (tx.from === 'A' && tx.kind === 'v21' && tx.seq === 0) tx.bits[tx.bits.length - 60] ^= 1; };
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { hook } });
  assert.deepEqual(r.ladder.slice(2, 9), ['B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR']);
  // The repeated DIS waits T4 from the damaged DCS, so it does not land on the TCF.
  const L = r.pipe.log;
  assert.ok(L[5].start >= L[4].end);
  assert.ok(hangup(r.A).ok);
});

test('call: the answerer repeats DIS every T4 until T1, then disconnects', () => {
  // A caller that never speaks after CNG: every V.21 transmission of A is lost (none happen anyway).
  const r = call({ caller: { source: null, poll: false }, pipe: { hook: (tx) => (tx.from === 'B' ? undefined : tx.kind === 'tone' ? undefined : 'drop') } });
  // The caller with nothing to send hangs up; the answerer, deaf to it, keeps offering DIS.
  const dis = log(r, (e) => e.from === 'B' && e.kind === 'v21' && e.frames.includes('DIS'));
  assert.ok(dis.length >= 6, `${dis.length} DIS`);
  for (let i = 1; i < dis.length; i++) near(dis[i].start - dis[i - 1].end, T30_TIMERS.T4, 1e-9);
  assert.equal(hangup(r.B).reason, 'T1');
  assert.ok(dis.at(-1).start < T30_TIMERS.T1);
});

test('call: nobody answers: the caller sends CNG every 3.5 s and gives up at T1 without DCN', () => {
  const p = new IdealBitPipe();
  const A = new T30Endpoint(new T30Caller({ source: stubSource({ pages: 1, ...PAGE }) }), p.a);
  p.b.listen({ v21Carrier() {}, v21Bits() {}, tone() {}, hsCarrier() {}, hsBits() {} });
  runCall([A], p);
  const cng = p.log.filter((e) => e.tone === 'CNG');
  assert.equal(cng.length, 10);
  for (let i = 1; i < cng.length; i++) near(cng[i].start - cng[i - 1].start, 3.5, 1e-9);
  near(cng[0].end - cng[0].start, 0.5, 1e-12);
  assert.deepEqual([hangup(A).reason, hangup(A).t], ['T1', 35]);
  assert.ok(!p.log.some((e) => e.kind === 'v21'));
});

test('call: polling: the caller receives the called station\'s document (DIS bit 9, CIG + DTC)', () => {
  const r = call({ caller: { poll: true }, answerer: { source: stubSource({ pages: 2, ...PAGE }) } });
  assert.deepEqual(r.ladder, ['A CNG', 'B CED', 'B CSI DIS', 'A CIG DTC', 'B TSI DCS', 'B TCF 9600', 'A CFR', 'B PAGE 9600', 'B MPS', 'A MCF', 'B PAGE 9600', 'B EOP', 'A MCF', 'B DCN']);
  assert.equal(r.A.station.remote.dis.readyToTransmit, true);
  assert.equal(r.A.station.pagesReceived, 2);
  assert.equal(r.B.station.pagesSent, 2);
  assert.ok(hangup(r.A).ok && hangup(r.B).ok);
  assert.equal(r.B.station.remote.ident, '+1 555 0100', 'CIG');
});

test('call: polling a machine with nothing to send ends with DCN', () => {
  const r = call({ caller: { poll: true } });
  assert.deepEqual(r.ladder.slice(2), ['B CSI DIS', 'A DCN']);
  assert.equal(hangup(r.A).reason, 'nothing-to-poll');
});

test('call: STOP pressed mid-page: DCN follows the page, both ends hang up', () => {
  const r = call({ caller: { source: stubSource({ pages: 3, ...PAGE }) }, actions: [[13, (t, A) => A.abort(t)]] });
  assert.deepEqual(r.ladder.slice(2), ['B CSI DIS', 'A TSI DCS', 'A TCF 9600', 'B CFR', 'A PAGE 9600', 'A DCN']);
  assert.equal(hangup(r.A).reason, 'aborted');
  assert.equal(hangup(r.B).reason, 'remote-dcn');
  const page = log(r, (e) => e.kind === 'page')[0];
  assert.ok(page.start < 13 && page.end > 13);
  near(log(r, (e) => e.frames?.includes('DCN'))[0].start - page.end, T30_TIMING.gap, 1e-9);
});

test('call: STOP at the receiving end between pages', () => {
  const r = call({ caller: { source: stubSource({ pages: 3, ...PAGE }) }, actions: [[13.9, (t, A, B) => B.abort(t)]] });
  assert.ok(r.ladder.includes('B DCN'));
  assert.equal(hangup(r.B).reason, 'aborted');
  assert.equal(hangup(r.A).reason, 'remote-dcn');
});

// ---------------------------------------------------------------------------------------------------------------
// The timeline against the Recommendation's figures [M]

test('timeline: V.21 preamble and frames at 300 bit/s, 75 ms gaps, TCF 1.5 s, CED and CNG', () => {
  const delay = 0.05;
  const r = call({ caller: { source: stubSource({ pages: 1, ...PAGE }) }, pipe: { delay } });
  const L = r.pipe.log;
  const get = (from, pred) => L.find((e) => e.from === from && pred(e));
  // Preamble: 38 flags at 300 bit/s = 1.013 s, within 1 s +- 15 %.
  near((PREAMBLE_FLAGS * 8) / 300, 1.0, 0.15);
  for (const e of L.filter((x) => x.kind === 'v21')) {
    near(e.end - e.start, e.bits / 300, 1e-9, 'V.21 at 300 bit/s');
    assert.ok(e.end - e.start > 1.0);
  }
  // CSI + DIS: preamble, CSI (3 + 20 + 2 octets) and DIS (3 + 6 + 2: super fine is in octet 6) with stuffing and flags.
  const dis = get('B', (e) => e.frames?.includes('DIS'));
  const disBits = encodeHdlc([encodeFrame({ name: 'CSI', final: false, fif: encodeIdent('+1 555 0199') }), encodeFrame({ name: 'DIS', fif: buildDIS({ rates: [9600, 7200, 4800, 2400], fine: true, superFine: true, twoD: true, lengths: ['A4', 'B4'], scan: { standard: 20, fine: 10 } }) })]).bits.length;
  assert.equal(dis.bits, disBits);
  near(dis.end - dis.start, disBits / 300, 1e-9);
  // CED: 2.0 s after answering, 3.0 s long (2.6 to 4 s); DIS 75 ms after it.
  const ced = get('B', (e) => e.tone === 'CED');
  near(ced.start, T30_TIMING.cedDelay, 1e-9);
  const cedLen = ced.end - ced.start;
  assert.ok(cedLen >= 2.6 && cedLen <= 4.0);
  near(dis.start - ced.end, 0.075, 1e-9);
  // CNG 0.5 s.
  near(get('A', (e) => e.tone === 'CNG').end - get('A', (e) => e.tone === 'CNG').start, 0.5, 1e-12);
  // Turnarounds: 75 ms after the far end's signal arrives (one line delay after it ends).
  const dcs = get('A', (e) => e.frames?.includes('DCS'));
  near(dcs.start - (dis.end + delay), 0.075, 1e-9, 'DIS -> DCS');
  const tcf = get('A', (e) => e.kind === 'tcf');
  near(tcf.start - dcs.end, 0.075, 1e-9, 'DCS -> TCF');
  near(tcf.end - tcf.start - tcf.training, 1.5, 1e-9, 'TCF 1.5 s');
  near(tcf.training, TRAINING_SECONDS[9600], 1e-12);
  assert.equal(tcf.bits, 14400);
  const cfr = get('B', (e) => e.frames?.includes('CFR'));
  near(cfr.start - (tcf.end + delay), 0.075, 1e-9, 'TCF -> CFR');
  const page = get('A', (e) => e.kind === 'page');
  near(page.start - (cfr.end + delay), 0.075, 1e-9, 'CFR -> page');
  const eop = get('A', (e) => e.frames?.includes('EOP'));
  near(eop.start - page.end, 0.075, 1e-9, 'page -> EOP');
  const mcf = get('B', (e) => e.frames?.includes('MCF'));
  near(mcf.start - (eop.end + delay), 0.075, 1e-9, 'EOP -> MCF');
  const dcn = get('A', (e) => e.frames?.includes('DCN'));
  near(dcn.start - (mcf.end + delay), 0.075, 1e-9, 'MCF -> DCN');
});

test('timeline: T.4 page time is training plus bits / rate, with lines padded to the minimum scan time', () => {
  for (const [rate, tcfErr] of [[9600, 0], [4800, (r) => (r > 4800 ? 1e-2 : 0)]]) {
    const r = call({ caller: { source: stubSource({ pages: 1 }), fine: false }, pipe: { tcfErrorRate: tcfErr } });
    const page = r.pipe.log.find((e) => e.kind === 'page');
    assert.equal(page.rate, rate);
    near(page.end - page.start, TRAINING_SECONDS[rate] + page.bits / rate, 1e-9);
    // A4 standard: 1145 lines, each at least 20 ms of bits (the receiver's minimum for 3.85 lines/mm).
    const minBits = A4_LINES.standard * Math.ceil(rate * 0.02);
    assert.ok(page.bits >= minBits, `${page.bits} >= ${minBits}`);
    const secs = page.bits / rate;
    if (rate === 9600) assert.ok(secs >= 22.9 && secs < 30, `${secs} s of page at ${rate}`);
    else near(secs, (A4_LINES.standard * 212 + 72) / rate, 1e-9, 'at 4800 the lines are longer than 20 ms');
    assert.equal(events(r.B, 'page-received')[0].result.lines, A4_LINES.standard);
  }
});

test('stub page: lines, fill to the minimum scan line time, damage counted as bad lines', () => {
  const src = stubSource({ pages: 1, lines: 40 });
  const check = stubChecker();
  const bits = src.pageBits(0, { rate: 9600, scanMs: 40 });
  assert.ok(bits.length >= 40 * 384);
  assert.deepEqual(check(bits), { lines: 40, badLines: 0, maxConsecutiveBad: 0 });
  const b = bits.slice();
  b[384 * 10 + 50] ^= 1;
  b[384 * 11 + 50] ^= 1;
  assert.deepEqual(check(b), { lines: 40, badLines: 2, maxConsecutiveBad: 2 });
});

test('determinism: the same call twice gives the same timeline', () => {
  const run = () => call({ caller: { source: stubSource({ pages: 2, ...PAGE }) }, pipe: { tcfErrorRate: (r) => (r > 7200 ? 3e-4 : 0), seed: 7 } }).pipe.log.map((e) => [e.from, e.kind, e.start, e.end]);
  assert.deepEqual(run(), run());
});

test('purity: the T.30 stack imports only itself and uses no DOM, wall clock, timers or Math.random', () => {
  const root = new URL('../src/fax/', import.meta.url).pathname;
  const files = [path.join(root, 'hdlc.js'), path.join(root, 'transport.js'), ...fs.readdirSync(path.join(root, 't30')).map((f) => path.join(root, 't30', f))];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
      const target = path.resolve(path.dirname(f), m[1]);
      assert.ok(m[1].startsWith('.') && target.startsWith(root) && !target.includes('/t4/') && !target.includes('/modem/'), `${f} imports ${m[1]}`);
    }
    const code = src.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of [/\bwindow\s*[.[]/, /\bdocument\s*\./, /\bperformance\s*\./, /\bDate\s*[.(]/, /\bnew\s+Date\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bMath\.random\b/]) assert.ok(!re.test(code), `${f} uses ${re}`);
  }
});
