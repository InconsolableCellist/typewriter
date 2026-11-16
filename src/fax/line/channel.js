// The telephone channel between two subscribers, one direction at a time, at the line rate (8 kHz).
//
//   in -> flat delay -> + echo (a delayed, weaker copy) -> loss -> 300-3400 Hz band-pass
//      -> + noise (band-limited, at a set SNR) -> + mains hum -> mu-law codec -> out
//
// - Band-pass: Butterworth, 4th order high-pass at 300 Hz and 6th order low-pass at 3400 Hz [A: the shape of the
//   codec's anti-alias filter and the loop's transformer coupling are ours; the edges' group delay is what gives the
//   equalisers work, as a real line does].
// - mu-law (or A-law, with `law: 'alaw'`): the exchange's codec (companding.js), optional.
// - Delay: a fixed transmission delay in ms.
// - Echo: a single reflection in the path, `echo.db` below the direct signal and `echo.ms` later (a listener echo from
//   an impedance mismatch) [A: one reflection stands for the whole echo path].
// - Noise: white Gaussian noise band-limited by the same band-pass, scaled so its in-band power is `snrDb` below the
//   reference: the modem level (-10 dBm0) after the loss. So `snrDb` is the signal-to-noise ratio a fax modem sees.
// - Hum: 60 Hz and its third and fifth harmonics at `humDbm0` (the fundamental's level) [A].
// - Loss: in dB, flat.
// DuplexLine pairs two channels and adds the talker echo of each end's own transmission (the far hybrid).
//
// Block processing; every buffer allocated once at construction. Seeded noise, so a call is reproducible.

import { LINE_RATE, Rng, dbm0ToRms, dbm0ToPeak, dbToGain, MODEM_TX_DBM0 } from './levels.js';
import { butterBandpass, powerGain } from './filters.js';
import { compander } from './companding.js';

export const PRESETS = Object.freeze({
  /** The band-pass only: no codec, no noise. */
  clean: { band: [300, 3400], ulaw: false, delayMs: 0, echo: null, lossDb: 0, snrDb: null, humDbm0: null },
  /** A local call through a digital exchange. */
  typical: { band: [300, 3400], ulaw: true, delayMs: 12, echo: { db: -30, ms: 1.5 }, lossDb: 6, snrDb: 34, humDbm0: -70 },
  /** A long or old loop: more loss, more noise, a stronger reflection, audible hum. */
  noisy: { band: [300, 3400], ulaw: true, delayMs: 25, echo: { db: -24, ms: 2.5 }, lossDb: 10, snrDb: 26, humDbm0: -50 },
  /** Bad enough that 9600 bit/s fails and a fax steps down: 4800 still gets through [A, tuned to that outcome]. */
  bad: { band: [300, 3400], ulaw: true, delayMs: 40, echo: { db: -20, ms: 3 }, lossDb: 14, snrDb: 17, humDbm0: -42 },
});

export class Channel {
  constructor(opts = 'typical', { rate = LINE_RATE, seed = 1 } = {}) {
    const o = typeof opts === 'string' ? PRESETS[opts] : { ...PRESETS.clean, ...opts };
    if (!o) throw new Error(`unknown channel preset ${opts}`);
    this.opts = o;
    this.rate = rate;
    this.band = o.band ? butterBandpass(o.band[0], o.band[1], rate) : null;
    this.law = o.law || (o.ulaw ? 'ulaw' : null);       // 'ulaw', 'alaw' or none (the tone plan's law, P7)
    this.codec = compander(this.law);
    this.delayN = Math.round((o.delayMs || 0) * rate / 1000);
    this.echoN = o.echo ? Math.max(1, Math.round(o.echo.ms * rate / 1000)) : 0;
    this.echoG = o.echo ? dbToGain(o.echo.db) : 0;
    this.size = this.delayN + this.echoN + 1;
    this.ring = new Float32Array(this.size);
    this.wpos = 0;
    this.loss = dbToGain(-(o.lossDb || 0));
    this.rng = new Rng(seed * 2654435761 + 17);
    if (o.snrDb != null) {
      this.noiseBand = o.band ? butterBandpass(o.band[0], o.band[1], rate) : null;
      const g = this.noiseBand ? powerGain(this.noiseBand) : 1;
      const target = dbm0ToRms(MODEM_TX_DBM0 - (o.lossDb || 0) - o.snrDb);
      this.noiseSigma = target / Math.sqrt(g);
    } else { this.noiseBand = null; this.noiseSigma = 0; }
    this.humA = o.humDbm0 != null ? dbm0ToPeak(o.humDbm0) : 0;
    this.humPhase = 0;
  }

  reset() {
    this.ring.fill(0); this.wpos = 0;
    if (this.band) this.band.reset();
    if (this.noiseBand) this.noiseBand.reset();
  }

  /** Filters n samples from input[inOffset..] into output[outOffset..] (may be the same buffer). */
  process(input, inOffset, output, outOffset, n) {
    const size = this.size, ring = this.ring, w = 2 * Math.PI * 60 / this.rate;
    for (let i = 0; i < n; i++) {
      ring[this.wpos] = input[inOffset + i];
      let rd = this.wpos - this.delayN; if (rd < 0) rd += size;
      let x = ring[rd];
      if (this.echoN) { let re = rd - this.echoN; if (re < 0) re += size; x += this.echoG * ring[re]; }
      if (++this.wpos === size) this.wpos = 0;
      x *= this.loss;
      if (this.band) x = this.band.step(x);
      if (this.noiseSigma) {
        const nz = this.noiseSigma * this.rng.gauss();
        x += this.noiseBand ? this.noiseBand.step(nz) : nz;
      }
      if (this.humA) {
        const p = this.humPhase;
        x += this.humA * (Math.sin(p) + 0.3 * Math.sin(3 * p) + 0.1 * Math.sin(5 * p));
        this.humPhase = p + w > 2 * Math.PI ? p + w - 2 * Math.PI : p + w;
      }
      if (this.codec) x = this.codec(x);
      output[outOffset + i] = x;
    }
    return output;
  }

  /** Convenience: a whole buffer through a fresh pass. */
  run(input) {
    const out = new Float32Array(input.length);
    return this.process(input, 0, out, 0, input.length);
  }
}

/**
 * Both directions of a call. aTx/bTx are what each end sends; aRx/bRx what each hears. The far hybrid returns
 * `talkerEcho.db` of each end's own signal to it after the round trip plus `talkerEcho.ms` [A].
 */
export class DuplexLine {
  constructor(preset = 'typical', { rate = LINE_RATE, seed = 1, talkerEcho = { db: -22, ms: 2 }, maxBlock = 1024 } = {}) {
    this.aToB = new Channel(preset, { rate, seed: seed * 2 + 1 });
    this.bToA = new Channel(preset, { rate, seed: seed * 2 + 2 });
    const d = this.aToB.delayN;
    this.teN = talkerEcho ? 2 * d + Math.round(talkerEcho.ms * rate / 1000) + 1 : 0;
    this.teG = talkerEcho ? dbToGain(talkerEcho.db) : 0;
    this.teA = new Float32Array(this.teN + 1); this.teB = new Float32Array(this.teN + 1); this.tePos = 0;
    this.tmpA = new Float32Array(maxBlock); this.tmpB = new Float32Array(maxBlock);
  }
  process(aTx, bTx, aRx, bRx, n, offset = 0) {
    for (let s = 0; s < n; s += this.tmpA.length) {
      const m = Math.min(this.tmpA.length, n - s);
      this.aToB.process(aTx, offset + s, this.tmpB, 0, m);
      this.bToA.process(bTx, offset + s, this.tmpA, 0, m);
      for (let i = 0; i < m; i++) {
        let ea = 0, eb = 0;
        if (this.teN) {
          const p = this.tePos;
          ea = this.teA[p]; eb = this.teB[p];
          this.teA[p] = aTx[offset + s + i] * this.teG; this.teB[p] = bTx[offset + s + i] * this.teG;
          this.tePos = p + 1 > this.teN ? 0 : p + 1;
        }
        aRx[offset + s + i] = this.tmpA[i] + ea;
        bRx[offset + s + i] = this.tmpB[i] + eb;
      }
    }
  }
}
