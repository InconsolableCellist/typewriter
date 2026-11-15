// The modem interface the T.30 layer plugs into (M2 works against an ideal bit pipe; a thin adapter joins the two).
//
// Everything runs on line samples at 8 kHz (LINE_RATE): time is the count of samples handed to process(). Pure
// modules, no DOM, no timers, no structuredClone; each modem allocates its buffers once, so process() can run in the
// AudioWorklet block by block.
//
// ── Transmit ─────────────────────────────────────────────────────────────────────────────────────────────────────
//   const tx = createTransmitter(kind, { rate, source, levelDbm0 })
//     kind    'v21' | 'v27ter' | 'v29'      (or modulationForRate(rate) for the T.30 speed)
//     rate    bit/s: v21 300; v27ter 4800, 2400; v29 9600, 7200, 4800
//     source  { nextBit(): 0 | 1 | -1 }  pulled as the modem needs bits; -1 ends the transmission. For V.21 the bits
//             are the HDLC line bits (preamble flags, stuffed frames, closing flag: src/fax/hdlc.js encodeHdlc().bits);
//             for the high-speed modems they are TCF zeros or the T.4 page bits, sent after the modem's own training.
//             bitSource(array) wraps a Uint8Array of 0/1; zerosSource(n) gives TCF.
//   tx.process(out, offset, n)  writes n samples (overwrites; zeros once done) and returns how many carried signal
//   tx.done                     true once the last bit and the pulse tail have gone
//   Training is automatic: a high-speed transmitter always begins with its Recommendation's training sequence
//   (V.29: about 253 ms; V.27ter: about 0.9 s at 4800 and 1.2 s at 2400 with its echo-protection tone).
//
// ── Receive ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   const rx = createReceiver(kind, { rate, sink, deframer })
//     sink.bit(b)          each received bit (high speed: descrambled data after training; V.21: while carrier on)
//     sink.carrier(on)     carrier detect changes (the T.30 "carrier lost" and "V.21 heard" events)
//     sink.trained(report) high speed only: training finished, report = { mseDb } (equaliser error, lower is better)
//     sink.frame(f)        with a deframer: each frame it closes (e.g. new HdlcDecoder() from src/fax/hdlc.js,
//                          whose push(bit, out) returns closed frames { bytes, ok, reason })
//   rx.process(x, offset, n)    takes n line samples
//   rx.stats                    { carrier, trained, trainingMseDb, mseDb, symbols, bits, state, ... } (live)
//   The receiver knows nothing about the data: TCF judgement is the T.30 layer counting zeros in sink.bit (an
//   ErrorCounter against () => 0 does it), so CFR/FTT and RTN follow from what the receiver really decoded.
//
// ── Ideal bit pipe → modems ──────────────────────────────────────────────────────────────────────────────────────
//   T.30 "send these V.21 bits"          → createTransmitter('v21', { source: bitSource(bits) })
//   T.30 "train and send at R"           → createTransmitter(modulationForRate(R), { rate: R, source })
//   T.30 "listen for V.21 / for R"       → createReceiver(...) on the same samples; both may run at once, as the
//                                          Recommendation requires at the start of each page
//   T.30 "silence for t"                 → write zeros (75 ms before a reply, for example)

import { V21Transmitter, V21Receiver, V21 } from './v21.js';
import { V27terTransmitter, V27terReceiver, V27TER } from './v27ter.js';
import { V29Transmitter, V29Receiver, V29 } from './v29.js';
import { ErrorCounter } from './rx-common.js';
import { LINE_RATE } from '../line/levels.js';

export { LINE_RATE, ErrorCounter, V21, V27TER, V29 };

export const MODEMS = Object.freeze({
  v21: { rates: [300] },
  v27ter: { rates: [4800, 2400] },
  v29: { rates: [9600, 7200, 4800] },
});

/** The modem T.30 uses for a message speed: 9600 and 7200 on V.29, 4800 and 2400 on V.27ter. */
export function modulationForRate(rate) {
  if (rate === 9600 || rate === 7200) return 'v29';
  if (rate === 4800 || rate === 2400) return 'v27ter';
  if (rate === 300) return 'v21';
  throw new Error(`no fax modem for ${rate} bit/s`);
}

export function createTransmitter(kind, { rate, source, levelDbm0, ...opts } = {}) {
  const o = { source, ...opts };
  if (levelDbm0 != null) o.levelDbm0 = levelDbm0;
  if (kind === 'v21') return new V21Transmitter(o);
  if (kind === 'v27ter') return new V27terTransmitter({ rate: rate ?? 4800, ...o });
  if (kind === 'v29') return new V29Transmitter({ rate: rate ?? 9600, ...o });
  throw new Error(`unknown modem ${kind}`);
}

export function createReceiver(kind, { rate, sink = {}, deframer = null, ...opts } = {}) {
  let s = sink;
  if (deframer) {
    const frames = [];
    s = {
      ...sink,
      bit(b) {
        if (sink.bit) sink.bit(b);
        deframer.push(b, frames);
        while (frames.length) { const f = frames.shift(); if (sink.frame) sink.frame(f); }
      },
    };
  }
  if (kind === 'v21') return new V21Receiver({ sink: s, ...opts });
  if (kind === 'v27ter') return new V27terReceiver({ rate: rate ?? 4800, sink: s, ...opts });
  if (kind === 'v29') return new V29Receiver({ rate: rate ?? 9600, sink: s, ...opts });
  throw new Error(`unknown modem ${kind}`);
}

/** A bit source over an array of 0/1. */
export function bitSource(bits) {
  let i = 0;
  return { nextBit: () => (i < bits.length ? bits[i++] : -1), get position() { return i; } };
}

/** n zeros: the training check (TCF) is 1.5 s of zeros at the message speed. */
export function zerosSource(n) {
  let i = 0;
  return { nextBit: () => (i++ < n ? 0 : -1) };
}

/** TCF length in bits at a rate (1.5 s [M]). */
export const tcfBits = (rate) => Math.round(1.5 * rate);
