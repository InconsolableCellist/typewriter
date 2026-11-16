// Small IIR building blocks for the line: biquads (RBJ cookbook forms) in cascades, and Butterworth band-passes.
// State is held in typed arrays allocated once; process() works in place on a block.

const BUTTER_Q = {           // Q of each second-order section of an even-order Butterworth filter
  2: [0.7071067811865476],
  4: [0.5411961001461970, 1.3065629648763766],
  6: [0.5176380902050415, 0.7071067811865476, 1.9318516525781366],
};

/** Coefficients [b0, b1, b2, a1, a2] (a0 normalised to 1). */
export function biquadCoeffs(type, f0, fs, q) {
  const w = 2 * Math.PI * f0 / fs, c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * q);
  let b0, b1, b2;
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else if (type === 'highpass') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; }
  else throw new Error(`biquad type ${type}`);
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** A cascade of biquads, transposed direct form II, float64 state. */
export class BiquadCascade {
  constructor(sections) {
    this.n = sections.length;
    this.c = new Float64Array(this.n * 5);
    this.z = new Float64Array(this.n * 2);
    sections.forEach((s, i) => this.c.set(s, i * 5));
  }
  reset() { this.z.fill(0); }
  /** Filter one sample. */
  step(x) {
    const c = this.c, z = this.z;
    for (let i = 0, j = 0, k = 0; i < this.n; i++, j += 5, k += 2) {
      const y = c[j] * x + z[k];
      z[k] = c[j + 1] * x - c[j + 3] * y + z[k + 1];
      z[k + 1] = c[j + 2] * x - c[j + 4] * y;
      x = y;
    }
    if (Math.abs(x) < 1e-25) {         // flush denormals: an idle line decays toward zero for ever otherwise
      for (let k = 0; k < z.length; k++) if (Math.abs(z[k]) < 1e-25) z[k] = 0;
      if (Math.abs(x) < 1e-30) x = 0;
    }
    return x;
  }
  process(buf, offset = 0, n = buf.length - offset) {
    for (let i = offset, e = offset + n; i < e; i++) buf[i] = this.step(buf[i]);
    return buf;
  }
}

/** Butterworth band-pass as a high-pass and a low-pass cascade of the given even orders. */
export function butterBandpass(fLow, fHigh, fs, { orderLow = 4, orderHigh = 6 } = {}) {
  const secs = [];
  for (const q of BUTTER_Q[orderLow]) secs.push(biquadCoeffs('highpass', fLow, fs, q));
  for (const q of BUTTER_Q[orderHigh]) secs.push(biquadCoeffs('lowpass', fHigh, fs, q));
  return new BiquadCascade(secs);
}

export function butterLowpass(f, fs, order = 4) {
  return new BiquadCascade(BUTTER_Q[order].map((q) => biquadCoeffs('lowpass', f, fs, q)));
}

export function butterHighpass(f, fs, order = 4) {
  return new BiquadCascade(BUTTER_Q[order].map((q) => biquadCoeffs('highpass', f, fs, q)));
}

/** Noise power gain of a filter (sum of its squared impulse response), measured once at construction time. */
export function powerGain(filter, n = 8000) {
  filter.reset();
  let s = 0;
  for (let i = 0; i < n; i++) { const y = filter.step(i === 0 ? 1 : 0); s += y * y; }
  filter.reset();
  return s;
}
