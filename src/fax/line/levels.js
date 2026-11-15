// The line's sample rate, level scale and a seeded noise source, shared by the line and the modems.
//
// Sample rate. Everything on the telephone line runs at 8000 samples a second: the rate of the exchange's codec, so
// the mu-law companding (companding.js) is the real quantiser at its real rate. It divides the mechanism clock exactly
// (384 kHz / 48 = 8 kHz, src/sim/rate.js) and the audio rate exactly (48 kHz / 6), so listeners upsample by a fixed
// 6:1 polyphase filter (resample.js). The plan (7.2) proposed 9600; 8000 was chosen in M3 because the codec is 8 kHz
// and a 6:1 ratio to 48 kHz is as exact as 5:1. The modems' fractional samples per symbol (10/3 at 2400 baud, 20/3 at
// 1200) are handled by rational pulse tables in the transmitters and an interpolator in the receivers.
//
// Level scale. A line sample is a float where 1.0 is the mu-law codec's largest decoded value (32124 on the 16-bit scale).
// G.711: a sine at the codec's full scale is +3.17 dBm0 [M], so 0 dBm0 is a sine of peak 10^(-3.17/20).
//
// Pure: no DOM, no timers.

export const LINE_RATE = 8000;
export const AUDIO_RATE = 48000;
export const UPSAMPLE = AUDIO_RATE / LINE_RATE;      // 6
export const SUBSTEPS_PER_LINE_SAMPLE = 48;          // 384 kHz mechanism clock / 8 kHz

export const FULL_SCALE_DBM0 = 3.17;                 // [M] G.711 mu-law: full-scale sine = +3.17 dBm0
export const DBM0_PEAK = 10 ** (-FULL_SCALE_DBM0 / 20);   // peak of a 0 dBm0 sine, ~0.694
export const DBM0_RMS = DBM0_PEAK / Math.SQRT2;            // rms of 0 dBm0, ~0.491

/** Peak amplitude of a sine at `dbm0`. */
export const dbm0ToPeak = (dbm0) => DBM0_PEAK * 10 ** (dbm0 / 20);
/** RMS of any signal at `dbm0`. */
export const dbm0ToRms = (dbm0) => DBM0_RMS * 10 ** (dbm0 / 20);
/** Level in dBm0 of a signal with this RMS. */
export const rmsToDbm0 = (rms) => 20 * Math.log10(Math.max(rms, 1e-12) / DBM0_RMS);
export const dbToGain = (db) => 10 ** (db / 20);

/** Nominal transmit level of the fax modems and fax tones [A]: real machines send -9 to -15 dBm; ours sends -10. */
export const MODEM_TX_DBM0 = -10;

/**
 * A small deterministic noise source (xorshift32 with a Box-Muller pair). Seeded so a call is identical in Node and in
 * the worklet; no Math.random.
 */
export class Rng {
  constructor(seed = 0x9e3779b9) { this.s = (seed >>> 0) || 0x9e3779b9; this.spare = 0; this.hasSpare = false; }
  /** Uniform in [0, 1). */
  next() {
    let s = this.s;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this.s = s;
    return s / 4294967296;
  }
  bit() { return this.next() < 0.5 ? 0 : 1; }
  /** Standard normal. */
  gauss() {
    if (this.hasSpare) { this.hasSpare = false; return this.spare; }
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * v;
    this.spare = r * Math.sin(a); this.hasSpare = true;
    return r * Math.cos(a);
  }
}
