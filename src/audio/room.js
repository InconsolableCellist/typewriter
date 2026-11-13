// Radiation filter and a small synthetic room. The radiated pressure of a compact source goes with the
// volume acceleration, so the filter is mostly a sub-audio roll-off and a very gentle high roll-off; the
// room gives early reflections off a desk and walls and a short diffuse tail (a small quiet study).

// Far below anything audible; decaying states are snapped to zero under it so they never go subnormal.
const TINY = 1e-20;

function delaySamples(ms, sr) { return Math.max(1, Math.round((ms / 1000) * sr)); }

export class RadiationFilter {
  constructor(sampleRate, fHP = 55, fLP = 19000) {
    this.a = Math.exp(-2 * Math.PI * fHP / sampleRate);
    this.b = Math.exp(-2 * Math.PI * fLP / sampleRate);
    this.x1 = 0; this.y1 = 0; this.lp = 0;
  }

  tick(x) {
    // first order high pass (exact DC block) then one-pole low pass
    // States that decay to zero are flushed below 1e-20: subnormal floats are many times slower on x86.
    let y = x - this.x1 + this.a * this.y1;
    if (y < TINY && y > -TINY) y = 0;
    this.x1 = x; this.y1 = y;
    let lp = y + (this.lp - y) * this.b;
    if (lp < TINY && lp > -TINY) lp = 0;
    this.lp = lp;
    return lp;
  }
}

/**
 * Look-ahead soft-knee peak compressor. Below the knee (-6 dBFS) it is transparent; above it, peaks rise at
 * a reduced slope, so a harder hit still has a higher peak than a lighter one, and only the most extreme
 * contacts reach the ceiling (-1 dBFS).
 */
export class Limiter {
  constructor(sampleRate, { kneeDb = -6, ratio = 0.45, ceiling = 0.89, lookaheadS = 0.0015, releaseS = 0.08 } = {}) {
    this.knee = Math.pow(10, kneeDb / 20);
    this.ratio = ratio;
    this.ceiling = ceiling;
    this.L = Math.max(1, Math.round(lookaheadS * sampleRate));
    this.buf = new Float32Array(this.L);
    this.need = new Float32Array(this.L).fill(1);
    this.pos = 0;
    this.g = 1;
    this.rel = Math.exp(-1 / (releaseS * sampleRate));
  }

  /** Gain needed for a peak of amplitude a. y = knee * (a / knee)^ratio above the knee. */
  want(a) {
    if (a <= this.knee) return 1;
    const y = this.knee * Math.pow(a / this.knee, this.ratio);
    return Math.min(y, this.ceiling) / a;
  }

  tick(x) {
    const a = x < 0 ? -x : x;
    const p = this.pos;
    const delayed = this.buf[p];
    this.buf[p] = x;
    this.need[p] = this.want(a);
    this.pos = (p + 1) % this.L;
    let m = 1;
    for (let i = 0; i < this.L; i++) if (this.need[i] < m) m = this.need[i];
    this.g = m < this.g ? m : m + (this.g - m) * this.rel;
    const y = delayed * this.g;
    return y > 1 ? 1 : (y < -1 ? -1 : y);
  }
}

export class Room {
  constructor(sampleRate, { t60 = 0.3, wet = 0.07 } = {}) {
    this.sr = sampleRate;
    this.wet = wet;
    // Early reflections: tapped delay (desk, near wall, ceiling).
    this.tapMs = [2.9, 5.1, 7.7, 11.3, 14.9, 21.7];
    this.tapG = [0.34, 0.27, 0.22, 0.16, 0.13, 0.09];
    this.earlyLen = delaySamples(26, sampleRate);
    this.early = new Float32Array(this.earlyLen);
    this.earlyPos = 0;
    this.taps = this.tapMs.map((ms) => delaySamples(ms, sampleRate));
    // Diffuse tail: 4-line feedback delay network with Householder mixing and one-pole damping.
    const ms = [21.1, 26.3, 31.7, 37.9];
    this.lines = ms.map((m) => new Float32Array(delaySamples(m, sampleRate)));
    this.pos = new Int32Array(4);
    this.g = ms.map((m) => Math.pow(10, (-3 * (m / 1000)) / t60));
    this.damp = new Float64Array(4);
    const fd = Math.exp(-2 * Math.PI * 5200 / sampleRate);
    this.fd = fd;
    this.fbState = new Float64Array(4);
    this.out = new Float64Array(4);
  }

  tick(x) {
    const e = this.early;
    let pos = this.earlyPos;
    e[pos] = x;
    let w = 0;
    const eLen = this.earlyLen;
    for (let i = 0; i < 6; i++) {
      let p = pos - this.taps[i];
      if (p < 0) p += eLen;
      w += this.tapG[i] * e[p];
    }
    pos++; if (pos >= eLen) pos = 0;
    this.earlyPos = pos;
    const lines = this.lines, posL = this.pos, out = this.out, fb = this.fbState;
    for (let i = 0; i < 4; i++) out[i] = lines[i][posL[i]];
    // Householder feedback matrix: x_i - (2/N) * sum
    const sum = (out[0] + out[1] + out[2] + out[3]) * 0.5;
    const input = x * 0.5 + w * 0.5;
    for (let i = 0; i < 4; i++) {
      let v = out[i] - sum;
      // One pole damping in the loop
      let f = fb[i] * this.fd + v * (1 - this.fd);
      if (f < TINY && f > -TINY) f = 0;
      fb[i] = f;
      const next = input + fb[i] * this.g[i];
      const L = lines[i];
      L[posL[i]] = next;
      if (++posL[i] >= L.length) posL[i] = 0;
    }
    return x + this.wet * (w + (out[0] + out[1] + out[2] + out[3]));
  }
}
