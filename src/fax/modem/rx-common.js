// The shared machinery of the phase-modulated modems (V.27ter, V.29): a pulse-shaped transmitter and a receiver with
// gain control, carrier recovery, symbol timing recovery, an adaptive equaliser and a slicer. Each modem supplies a
// "profile": its carrier, baud, roll-off, constellation, mapping, scrambler and training (v27ter.js, v29.js).
//
// Transmitter
//   symbols -> square-root raised-cosine pulse (roll-off alpha, +-6 symbols) -> complex baseband -> carrier
//   The samples per symbol are rational (10/3 at 2400 baud and 8 kHz), so the pulse is tabulated on the exact grid of
//   offsets n*Q - k*P (P/Q samples a symbol) and no interpolation error is made.
//   Level: the passband RMS of data is `levelDbm0`; training points are on the same scale as data points.
//
// Receiver, per line sample
//   1. carrier detect on a 5 ms power average, on at -43 dBm0, off at -48 dBm0 after 25 ms below [M thresholds;
//      A hold-off];
//   2. mix to baseband at the nominal carrier; a matched square-root raised-cosine filter (+-4 symbols);
//   3. gain control: the matched output's power is tracked while the carrier is new and the gain frozen once the
//      training's alternation is recognised (the equaliser trims it after);
//   4. a cubic (Lagrange) interpolator gives two samples a symbol at instants set by a Gardner timing loop;
//   5. a fractionally spaced (T/2) complex LMS equaliser, trained on the known training symbols and then decision
//      directed, followed by a second-order decision-directed phase loop (carrier recovery);
//   6. slicer, differential decoding and the descrambler, in the profile.
// Training is found by the shape of the signal, as a real receiver does: the alternation segment is recognised by its
// symbol-to-symbol phase steps (independent of carrier phase); its first break gives the symbol's index in the known
// sequence. The gain and phase measured on the alternation seed the equaliser.
//
// Everything is allocated in the constructor; process() allocates nothing.

import { LINE_RATE, dbm0ToRms } from '../line/levels.js';

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }

/** Square-root raised-cosine impulse response at t symbols, unit energy per symbol. */
export function rrc(t, alpha) {
  const eps = 1e-9;
  if (Math.abs(t) < eps) return 1 - alpha + 4 * alpha / Math.PI;
  if (alpha > 0 && Math.abs(Math.abs(t) - 1 / (4 * alpha)) < eps) {
    return (alpha / Math.SQRT2) * ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * alpha)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * alpha)));
  }
  const num = Math.sin(Math.PI * t * (1 - alpha)) + 4 * alpha * t * Math.cos(Math.PI * t * (1 + alpha));
  const den = Math.PI * t * (1 - (4 * alpha * t) ** 2);
  return num / den;
}

/** Samples a symbol as a reduced fraction P/Q. */
export function samplesPerSymbol(rate, baud) {
  const g = gcd(rate, baud);
  return { P: rate / g, Q: baud / g };
}

/** A carrier table: cos and sin of 2 pi f n / rate over one exact period. */
function carrierTable(f, rate) {
  const g = gcd(rate, f), period = rate / g;
  const c = new Float64Array(period), s = new Float64Array(period);
  for (let n = 0; n < period; n++) { c[n] = Math.cos(2 * Math.PI * f * n / rate); s[n] = Math.sin(2 * Math.PI * f * n / rate); }
  return { c, s, period };
}

/**
 * Transmitter. `profile.nextSymbol(out)` writes the next symbol's re/im (constellation units) into out[0], out[1] and
 * returns false once the transmission has ended (then the pulse tails are sent and the transmitter is done).
 */
export class PskTransmitter {
  constructor(profile, { rate = LINE_RATE, levelDbm0 = -10, span = 6 } = {}) {
    this.profile = profile;
    const { P, Q } = samplesPerSymbol(rate, profile.baud);
    this.P = P; this.Q = Q; this.S = span;
    const half = span * P;
    this.half = half;
    this.pulse = new Float64Array(2 * half + 1);
    for (let d = -half; d <= half; d++) this.pulse[d + half] = rrc(d / P, profile.alpha);
    this.scale = Math.SQRT2 * dbm0ToRms(levelDbm0) / Math.sqrt(profile.symbolPower);
    this.R = 2 * span + 4;
    this.symRe = new Float64Array(this.R); this.symIm = new Float64Array(this.R);
    this.tmp = new Float64Array(2);
    this.kGen = -1;          // last symbol index generated
    this.n = 0;              // output sample index
    this.endK = Infinity;    // index of the first symbol after the end
    this.car = carrierTable(profile.carrier, rate);
    this.done = false;
  }

  _gen(k) {
    while (this.kGen < k) {
      const j = ++this.kGen, r = j % this.R;
      if (j >= this.endK || !this.profile.nextSymbol(this.tmp)) {
        if (this.endK === Infinity) this.endK = j;
        this.symRe[r] = 0; this.symIm[r] = 0;
      } else { this.symRe[r] = this.tmp[0]; this.symIm[r] = this.tmp[1]; }
    }
  }

  /** Writes n samples to out[offset..]; zeros once done. Returns the number of signal samples written. */
  process(out, offset, n) {
    const P = this.P, Q = this.Q, half = this.half, R = this.R, pulse = this.pulse, car = this.car;
    let made = 0;
    for (let i = 0; i < n; i++) {
      if (this.done) { out[offset + i] = 0; continue; }
      const tq = this.n * Q;
      const kLo = Math.ceil((tq - half) / P), kHi = Math.floor((tq + half) / P);
      this._gen(kHi);
      let re = 0, im = 0;
      for (let k = Math.max(0, kLo); k <= kHi; k++) {
        const g = pulse[tq - k * P + half], r = k % R;
        re += g * this.symRe[r]; im += g * this.symIm[r];
      }
      const ph = this.n % car.period;
      out[offset + i] = this.scale * (re * car.c[ph] - im * car.s[ph]);
      this.n++;
      made++;
      if (kLo > this.endK) this.done = true;
    }
    return made;
  }
}

const ST_IDLE = 0, ST_SEARCH = 1, ST_ALT = 2, ST_TRAIN = 3, ST_DATA = 4;
export const RX_STATES = ['idle', 'search', 'alternation', 'training', 'data'];

/**
 * Receiver. The profile supplies:
 *   baud, carrier, alpha
 *   known: { re: Float64Array, im: Float64Array } the training symbols the receiver may rely on, starting with the
 *          alternation segment; altLen (alternation symbols); dataStart (symbol index, counted from known[0], of the
 *          first data symbol: symbols between known.length and dataStart are decoded to sync the descrambler only)
 *   altMatch: consecutive alternation steps to recognise the segment
 *   slice(re, im, out): nearest constellation point into out[0..1], returns its index
 *   startData(re, im): the last training symbol, the reference for differential decoding
 *   decode(index, emit): bits of a decided symbol, before descrambling, to emit(bit)
 *   descramble(bit): bit
 * opts.sink: { bit(b), carrier(on), trained(report) } (all optional).
 */
export class PskReceiver {
  constructor(profile, { rate = LINE_RATE, sink = {}, eqSymbols = 12, mu = 0.008, onDbm0 = -43, offDbm0 = -48 } = {}) {
    this.p = profile;
    this.sink = sink;
    this.rate = rate;
    const sps = rate / profile.baud;
    this.sps = sps; this.halfT = sps / 2;
    // Carrier detect.
    this.pw = 0; this.pwA = 1 / (0.005 * rate);
    this.onLevel = dbm0ToRms(onDbm0) ** 2; this.offLevel = dbm0ToRms(offDbm0) ** 2;
    this.offHold = Math.round(0.025 * rate);
    this.cd = false; this.offRun = 0;
    // Down-mix and matched filter.
    this.car = carrierTable(profile.carrier, rate);
    this.n = 0;
    const mfHalf = Math.ceil(4 * sps);
    this.mfLen = 2 * mfHalf + 1;
    this.mf = new Float64Array(this.mfLen);
    let e = 0;
    for (let i = 0; i < this.mfLen; i++) { this.mf[i] = rrc((i - mfHalf) / sps, profile.alpha); e += this.mf[i] ** 2; }
    for (let i = 0; i < this.mfLen; i++) this.mf[i] /= Math.sqrt(e);
    this.bRe = new Float64Array(this.mfLen * 2); this.bIm = new Float64Array(this.mfLen * 2); this.bPos = 0;
    // Matched-filter output history for the interpolator (8 samples).
    this.zRe = new Float64Array(8); this.zIm = new Float64Array(8);
    // AGC.
    this.zp = 0; this.zpA = 1 / (0.003 * rate); this.gain = 1; this.agcFrozen = false;
    // Timing.
    this.tNext = 0; this.half = 0;     // half: 0 next is an on-time sample, 1 a midpoint
    this.midRe = 0; this.midIm = 0; this.prevRe = 0; this.prevIm = 0;
    this.kt = 0; this.ktInt = 0; this.tDrift = 0;
    // Equaliser (T/2 spaced).
    const N = 2 * eqSymbols + 1;
    this.N = N; this.centre = eqSymbols;        // the centre tap's delay in T/2 samples is N-1-centre... see _eq
    this.D = Math.floor(eqSymbols / 2);          // symbols of delay through the equaliser
    this.wRe = new Float64Array(N); this.wIm = new Float64Array(N);
    this.xRe = new Float64Array(2 * N); this.xIm = new Float64Array(2 * N); this.xPos = 0;
    this.mu = mu;
    // Phase loop.
    this.theta = 0; this.omega = 0;
    // Training.
    this.altCount = new Int32Array(2); this.altPar = 0; this.altSeen = 0;
    this.lastRawRe = 0; this.lastRawIm = 0; this.prevAltRe = 1; this.prevAltIm = 0;
    this.gRe = 0; this.gIm = 0;
    this.rawIndex = 0;
    this.dec = new Float64Array(2);
    this.state = ST_IDLE;
    // Expected alternation step angles (phase-free): step k -> known[k] * conj(known[k-1]).
    const K = profile.known;
    this.altStep = new Float64Array(4);
    for (let j = 0; j < 2; j++) {
      const a = j + 1, b = j;
      const re = K.re[a] * K.re[b] + K.im[a] * K.im[b], im = K.im[a] * K.re[b] - K.re[a] * K.im[b];
      const m = Math.hypot(re, im) || 1;
      this.altStep[2 * j] = re / m; this.altStep[2 * j + 1] = im / m;
    }
    // i0: the first index after the alternation's start whose symbol is more than 90 degrees from the alternation's
    // continuation (computed from the known sequence the same way the receiver will judge it).
    this.i0 = -1;
    for (let i = 2; i < K.re.length; i++) {
      const ar = K.re[i & 1], ai = K.im[i & 1];
      if (K.re[i] * ar + K.im[i] * ai < 0) { this.i0 = i; break; }
    }
    this.knownLen = K.re.length;
    this.altLen = profile.altLen;
    // Statistics.
    this.stats = { state: 'idle', carrier: false, trained: false, trainingMseDb: NaN, mseDb: NaN, symbols: 0, bits: 0, gainDb: 0, retrains: 0, timing: 0 };
    this.mseAcc = 0; this.mseN = 0; this.mseRun = 0;
    this.symPow = profile.symbolPower;
  }

  reset() {
    this.state = ST_IDLE; this.agcFrozen = false; this.zp = 0; this.gain = 1;
    this.wRe.fill(0); this.wIm.fill(0); this.xRe.fill(0); this.xIm.fill(0);
    this.theta = 0; this.omega = 0; this.altCount.fill(0); this.altSeen = 0;
    this.half = 0; this.tNext = this.n + 2;
    this.stats.trained = false;
  }

  _setState(s) { this.state = s; this.stats.state = RX_STATES[s]; }

  process(x, offset, n) {
    const mfLen = this.mfLen, mf = this.mf, car = this.car, bRe = this.bRe, bIm = this.bIm;
    for (let i = 0; i < n; i++) {
      const v = x[offset + i];
      // 1. carrier detect
      this.pw += this.pwA * (v * v - this.pw);
      if (!this.cd) {
        if (this.pw > this.onLevel) {
          this.cd = true; this.offRun = 0; this.stats.carrier = true;
          this.reset(); this._setState(ST_SEARCH);
          if (this.sink.carrier) this.sink.carrier(true);
        }
      } else if (this.pw < this.offLevel) {
        if (++this.offRun >= this.offHold) {
          this.cd = false; this.stats.carrier = false;
          this._setState(ST_IDLE);
          if (this.sink.carrier) this.sink.carrier(false);
        }
      } else this.offRun = 0;
      // 2. down-mix and matched filter (run always, so the history is warm when the carrier comes)
      const ph = this.n % car.period;
      this.bPos = this.bPos === 0 ? mfLen - 1 : this.bPos - 1;
      bRe[this.bPos] = bRe[this.bPos + mfLen] = v * car.c[ph];
      bIm[this.bPos] = bIm[this.bPos + mfLen] = -v * car.s[ph];
      const m = this.n++;
      if (this.state === ST_IDLE) continue;
      let zr = 0, zi = 0;
      for (let k = 0, p = this.bPos; k < mfLen; k++, p++) { zr += mf[k] * bRe[p]; zi += mf[k] * bIm[p]; }
      const h = m & 7;
      this.zRe[h] = zr; this.zIm[h] = zi;
      // 3. gain
      if (!this.agcFrozen && this.pw > this.onLevel) {
        this.zp += this.zpA * (zr * zr + zi * zi - this.zp);
        if (this.zp > 1e-12) this.gain = 1 / Math.sqrt(this.zp);
      }
      // 4. interpolation at the timing instants
      while (this.tNext <= m - 1) this._halfSample();
    }
  }

  _halfSample() {
    const t = this.tNext, f = Math.floor(t), mu = t - f;
    // cubic Lagrange on f-1, f, f+1, f+2
    const c0 = -mu * (mu - 1) * (mu - 2) / 6, c1 = (mu + 1) * (mu - 1) * (mu - 2) / 2;
    const c2 = -(mu + 1) * mu * (mu - 2) / 2, c3 = (mu + 1) * mu * (mu - 1) / 6;
    const i0 = (f - 1) & 7, i1 = f & 7, i2 = (f + 1) & 7, i3 = (f + 2) & 7;
    const g = this.gain;
    const re = g * (c0 * this.zRe[i0] + c1 * this.zRe[i1] + c2 * this.zRe[i2] + c3 * this.zRe[i3]);
    const im = g * (c0 * this.zIm[i0] + c1 * this.zIm[i1] + c2 * this.zIm[i2] + c3 * this.zIm[i3]);
    // into the equaliser's delay line
    const N = this.N;
    this.xPos = this.xPos === 0 ? N - 1 : this.xPos - 1;
    this.xRe[this.xPos] = this.xRe[this.xPos + N] = re;
    this.xIm[this.xPos] = this.xIm[this.xPos + N] = im;
    this.tNext += this.halfT;
    if (this.half === 1) { this.midRe = re; this.midIm = im; this.half = 0; return; }
    this.half = 1;
    // On-time sample: Gardner timing error.
    const e = (this.prevRe - re) * this.midRe + (this.prevIm - im) * this.midIm;
    const kt = this.state <= ST_ALT ? 0.08 : this.state === ST_TRAIN ? 0.02 : 0.004;
    const adj = Math.max(-0.3, Math.min(0.3, kt * e));
    this.tNext += adj; this.stats.timing += adj;
    this.prevRe = re; this.prevIm = im;
    this._symbol(re, im);
  }

  _symbol(re, im) {
    const K = this.p.known;
    if (this.state === ST_SEARCH) {
      // Steps between raw symbols, against the alternation's two possible steps.
      const sr = re * this.lastRawRe + im * this.lastRawIm, si = im * this.lastRawRe - re * this.lastRawIm;
      const mag = Math.hypot(sr, si), pwr = re * re + im * im;
      this.lastRawRe = re; this.lastRawIm = im;
      this.altSeen ^= 1;
      for (let h = 0; h < 2; h++) {
        const j = (this.altSeen + h) & 1;            // which of the two steps this symbol would be under hypothesis h
        const ok = pwr > 0.2 && mag > 0 && (sr * this.altStep[2 * j] + si * this.altStep[2 * j + 1]) > 0.8 * mag;
        this.altCount[h] = ok ? this.altCount[h] + 1 : 0;
        if (this.altCount[h] >= this.p.altMatch) {
          // Hypothesis h: the symbol just received is known[1 + j]'s parity, i.e. index parity (1 + j) & 1.
          this.altPar = (1 + j) & 1;
          this.gRe = 0; this.gIm = 0;
          this.agcFrozen = true;
          this._setState(ST_ALT);
          this._altEstimate(re, im, this.altPar, true);
          return;
        }
      }
      return;
    }
    if (this.state === ST_ALT) {
      this.altPar ^= 1;
      const ar = K.re[this.altPar], ai = K.im[this.altPar];
      // Judge against the continuation of the alternation, in the gain and phase measured so far.
      const gm = this.gRe * this.gRe + this.gIm * this.gIm || 1;
      const ur = (re * this.gRe + im * this.gIm) / gm, ui = (im * this.gRe - re * this.gIm) / gm;   // re/g
      if (ur * ar + ui * ai < 0 && this.i0 > 0) {
        // The break: this symbol is known[i0]. If the parity we assumed was off (a pure phase reversal has two),
        // the gain carries the ratio of the symbol we assumed last to the one the sequence really had.
        const kr = K.re[this.i0 - 1], ki = K.im[this.i0 - 1], km = kr * kr + ki * ki || 1;
        const qr = (this.prevAltRe * kr + this.prevAltIm * ki) / km, qi = (this.prevAltIm * kr - this.prevAltRe * ki) / km;
        const gr = this.gRe * qr - this.gIm * qi, gi = this.gRe * qi + this.gIm * qr;
        this.gRe = gr; this.gIm = gi;
        this.rawIndex = this.i0;
        this._startTraining();
        return;
      }
      this._altEstimate(re, im, this.altPar, false);
      return;
    }
    this.rawIndex++;
    this._equalise();
  }

  _altEstimate(re, im, par, first) {
    const K = this.p.known;
    const ar = K.re[par], ai = K.im[par], am = ar * ar + ai * ai;
    // g = r / a
    const gr = (re * ar + im * ai) / am, gi = (im * ar - re * ai) / am;
    const a = first ? 1 : 0.15;
    this.gRe += a * (gr - this.gRe); this.gIm += a * (gi - this.gIm);
    this.prevAltRe = ar; this.prevAltIm = ai;
  }

  _startTraining() {
    // Equaliser: the inverse of the measured gain on the tap that the symbol D symbols back sits on.
    this.wRe.fill(0); this.wIm.fill(0);
    const gm = this.gRe * this.gRe + this.gIm * this.gIm || 1;
    const c = 2 * this.D;
    this.wRe[c] = this.gRe / gm; this.wIm[c] = -this.gIm / gm;
    this.theta = 0; this.omega = 0;
    this.mseAcc = 0; this.mseN = 0;
    this._setState(ST_TRAIN);
    this.stats.gainDb = 20 * Math.log10(Math.sqrt(gm) * this.gain + 1e-12);
    this._equalise();
  }

  _equalise() {
    const N = this.N, wRe = this.wRe, wIm = this.wIm, xRe = this.xRe, xIm = this.xIm, p = this.xPos;
    let yr = 0, yi = 0;
    for (let k = 0; k < N; k++) {
      const a = xRe[p + k], b = xIm[p + k];
      yr += wRe[k] * a - wIm[k] * b; yi += wRe[k] * b + wIm[k] * a;
    }
    // Rotate by the phase loop.
    const ct = Math.cos(this.theta), st = Math.sin(this.theta);
    const rr = yr * ct + yi * st, ri = yi * ct - yr * st;
    const j = this.rawIndex - this.D;           // the symbol this output estimates
    let tr, ti;
    const training = this.state === ST_TRAIN;
    if (training && j < this.knownLen) {
      if (j < 0) return;
      tr = this.p.known.re[j]; ti = this.p.known.im[j];
    } else {
      if (training) {
        this.stats.trainingMseDb = 10 * Math.log10((this.mseN ? this.mseAcc / this.mseN : 1) / this.symPow + 1e-12);
        this.stats.trained = true;
        this._setState(ST_DATA);
        const L = this.knownLen - 1;
        this.p.startData(this.p.known.re[L], this.p.known.im[L]);
        this.mseAcc = 0; this.mseN = 0;
        if (this.sink.trained) this.sink.trained({ mseDb: this.stats.trainingMseDb });
      }
      const idx = this.p.slice(rr, ri, this.dec);
      tr = this.dec[0]; ti = this.dec[1];
      this.stats.symbols++;
      this._emitIdx = j;
      this.p.decode(idx, this._emit || (this._emit = (b) => this._bit(b)));
    }
    // Error, statistics, updates.
    const er = tr - rr, ei = ti - ri;
    const e2 = er * er + ei * ei;
    if (training) { if (j >= this.knownLen - 128) { this.mseAcc += e2; this.mseN++; } }
    else {
      this.mseRun += 0.01 * (e2 - this.mseRun);
      this.stats.mseDb = 10 * Math.log10(this.mseRun / this.symPow + 1e-12);
    }
    // Phase loop on the decision.
    const tm = tr * tr + ti * ti || 1;
    const pe = (ri * tr - rr * ti) / tm;
    const ka = training ? 0.05 : 0.02, kb = training ? 0.002 : 0.0004;
    this.omega += kb * pe; this.theta += ka * pe + this.omega;
    if (this.theta > Math.PI) this.theta -= 2 * Math.PI; else if (this.theta < -Math.PI) this.theta += 2 * Math.PI;
    // LMS on the error rotated back to the equaliser's output frame.
    const Er = er * ct - ei * st, Ei = ei * ct + er * st;
    const mu = training ? this.mu : this.mu * 0.5;
    const mr = mu * Er, mi = mu * Ei;
    for (let k = 0; k < N; k++) {
      const a = xRe[p + k], b = xIm[p + k];
      // w += mu * E * conj(x)
      wRe[k] += mr * a + mi * b; wIm[k] += mi * a - mr * b;
    }
  }

  _bit(b) {
    const d = this.p.descramble(b);
    if (this._emitIdx >= this.p.dataStart) {
      this.stats.bits++;
      if (this.sink.bit) this.sink.bit(d);
    }
  }
}

/** Counts bit errors against an expected bit generator (TCF zeros, or a test's known data). */
export class ErrorCounter {
  constructor(expected = () => 0) { this.expected = expected; this.bits = 0; this.errors = 0; this.firstError = -1; }
  push(bit) {
    if (bit !== this.expected(this.bits)) { if (this.firstError < 0) this.firstError = this.bits; this.errors++; }
    this.bits++;
  }
  get ber() { return this.bits ? this.errors / this.bits : 0; }
}
