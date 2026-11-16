// A small seeded generator for the image and thermal models: uniform and Gaussian draws with no allocation, so a scan
// or a print is repeatable from its seed. Pure module.

export class Rng {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
    this.spare = 0;
    this.hasSpare = false;
  }

  /** Uniform in [0, 1) (mulberry32). */
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let x = this.s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal (Box-Muller, the second value kept for the next call). */
  gauss() {
    if (this.hasSpare) { this.hasSpare = false; return this.spare; }
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    this.hasSpare = true;
    return r * Math.cos(2 * Math.PI * v);
  }
}

/** erf by Abramowitz and Stegun 7.1.26 (error under 1.5e-7). */
export function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** The standard normal distribution function. */
export const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
