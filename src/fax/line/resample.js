// 8 kHz line to 48 kHz audio, for listening (the monitor speaker, the handset, render_call.mjs). A fixed 6:1 polyphase
// interpolator: a Kaiser-windowed sinc low-pass at 3.8 kHz, 16 taps a phase. The line is already band-limited to
// 3.4 kHz by the channel, so nothing of the signal is lost; the images above 4 kHz are strongly attenuated.
// Block based, state allocated once.

import { UPSAMPLE } from './levels.js';

const TAPS_PER_PHASE = 16;

function besselI0(x) {
  let s = 1, t = 1;
  for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; }
  return s;
}

function design(L, taps, cutoff, beta) {
  const n = L * taps, h = new Float64Array(n), mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const t = (i - mid) / L;                       // in input samples
    const x = 2 * Math.PI * cutoff * t;
    const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;
    const r = (i - mid) / (mid + 1);
    h[i] = sinc * besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
  }
  // Split into phases; each phase normalised to unity gain at DC.
  const phases = new Float32Array(n);
  for (let p = 0; p < L; p++) {
    let s = 0;
    for (let k = 0; k < taps; k++) s += h[k * L + p];
    for (let k = 0; k < taps; k++) phases[p * taps + k] = h[k * L + p] / s;
  }
  return phases;
}

// cutoff in cycles per input sample: 3800 Hz of 8000.
const PHASES = design(UPSAMPLE, TAPS_PER_PHASE, 3800 / 8000, 7);

export class Upsampler {
  constructor() {
    this.hist = new Float32Array(TAPS_PER_PHASE * 2);
    this.pos = 0;
  }
  reset() { this.hist.fill(0); this.pos = 0; }
  /** Writes n * 6 samples to `out` from n line samples. Returns the output index after the last sample. */
  process(input, inOffset, n, out, outOffset = 0) {
    const T = TAPS_PER_PHASE, h = this.hist;
    let o = outOffset;
    for (let i = 0; i < n; i++) {
      this.pos = (this.pos + 1) % T;
      h[this.pos] = h[this.pos + T] = input[inOffset + i];
      // newest sample at h[pos + T], then back in time to h[pos + 1]
      for (let p = 0; p < UPSAMPLE; p++) {
        let s = 0;
        const base = p * T;
        for (let k = 0; k < T; k++) s += PHASES[base + k] * h[this.pos + T - k];
        out[o++] = s;
      }
    }
    return o;
  }
}

/** Convenience for tools: a whole line buffer at 48 kHz. */
export function upsampleAll(line) {
  const out = new Float32Array(line.length * UPSAMPLE);
  new Upsampler().process(line, 0, line.length, out, 0);
  return out;
}
