// The FO-70's contact image sensor (CIS): one scan line of a document (docs/fax/plan.md 2, "CIS unit"; research.md 8.2:
// "monochrome, 1728 pixels, 8 dots/mm; made of sensor, rod lens, LED light source, light-conductive plate" [S]).
//
// What the line is made of, in the order light takes:
//   LED and light-conducting plate: the illumination along the bar, I(u). The LEDs sit at the ends of a plate that
//     spreads their light; the light falls off away from them and ripples with the plate's extraction pattern [A].
//   The document: a reflectance image (pages.js) placed by the feeder's pose (yMm, xMm, skewRad, liftMm, travelMm).
//     Off the sheet the sensor sees the white backing of the document path [A].
//   Rod-lens array (1:1): one Gaussian PSF. A contact sensor has almost no depth of field, so its width grows fast
//     as the sheet lifts off the glass: sigma = sqrt(s0^2 + (k * lift)^2) [A].
//   The element's aperture: a box of `apertureMm` across the bar.
//   Motion: the sheet moves `travelMm` during the line; the element integrates for `integrationDuty` of it, a box of
//     travel * duty along the feed.
//   The elements: per-element gain (PRNU), with a step per sensor chip (the bar is butted chips), dark offset per
//     element (DSNU) plus a common dark level, read noise and shot noise; an 8-bit ADC [A].
// Not modelled: the rod lenses one by one, the LED's colour against coloured inks (one spectral weight per ink is
//   the most the plan wants; our pages are grey), flare.
//
// The PSF, aperture and smear are separable and sampled with a grid of taps (spaced 0.05 mm, or half the sigma)
// whose weights are the exact box-Gaussian convolution at each tap. The taps are recomputed when the lift or travel
// changes; nothing is allocated per line. Pure module.

import { Rng, normCdf } from './rng.js';

/** The sensor's constants. Every one is assumed [A] until the CIS unit's page of the service manual is read. */
export const CIS = Object.freeze({
  elements: 1728,          // [S]
  pitchMm: 0.125,          // 8 per mm [S]
  chips: 18,               // 18 chips of 96 elements [A]
  apertureMm: 0.10,        // light-sensitive width of an element [A]
  psfSigmaMm: 0.035,       // rod-lens blur at contact, Gaussian sigma [A]
  liftBlurPerMm: 0.45,     // sigma added per mm of lift (in quadrature) [A]
  integrationDuty: 0.9,    // fraction of the line time the elements integrate [A]
  led: { endFalloff: 3.2, endRatio: 0.85, ripple: 0.025, ripplePeriodMm: 6.5 }, // LED plate profile [A]
  prnu: 0.02,              // element-to-element gain spread, 1 sigma [A]
  chipGainSpread: 0.04,    // chip-to-chip gain spread, 1 sigma [A]
  darkCounts: 8,           // common dark level, ADC counts [A]
  dsnuCounts: 1.5,         // element dark offset spread, 1 sigma [A]
  readNoise: 0.7,          // counts rms [A]
  shotNoise: 0.06,         // counts^2 of variance per count of signal [A]
  whiteCounts: 230,        // a reflectance of 1 at the brightest point of the light profile [A]
  adcMax: 255,             // 8-bit converter [A]
  backingReflectance: 0.90,// the document path's white backing, seen where there is no sheet [A]
  whiteReference: 0.92,    // the white reference strip read for shading correction [A]
});

const MAX_TAPS = 25;   // per axis
const TAP_MM = 0.05;   // tap spacing at contact; at least half the PSF's sigma when the sheet lifts

export class CisSensor {
  /** @param {object} [o] overrides of CIS, and `seed` for the fixed pattern and the noise */
  constructor(o = {}) {
    const c = { ...CIS, ...o, led: { ...CIS.led, ...(o.led ?? {}) } };
    this.c = c;
    this.n = c.elements;
    this.u = new Float64Array(this.n);        // element centre along the bar, mm from the bar's centre
    this.light = new Float64Array(this.n);    // illumination, 1 at the brightest element
    this.gain = new Float64Array(this.n);     // element gain (PRNU and chip steps)
    this.offset = new Float64Array(this.n);   // element dark offset (DSNU), counts
    this.refl = new Float64Array(this.n);     // the last line's effective reflectance, before the electronics
    this.tapX = new Float64Array(MAX_TAPS); this.wX = new Float64Array(MAX_TAPS);
    this.tapY = new Float64Array(MAX_TAPS); this.wY = new Float64Array(MAX_TAPS);
    this.nx = 1; this.ny = 1;
    this.dpx = new Float64Array(MAX_TAPS * MAX_TAPS); this.dpy = new Float64Array(MAX_TAPS * MAX_TAPS);
    this.w = new Float64Array(MAX_TAPS * MAX_TAPS);
    this.fixed = new Rng((o.seed ?? 1) * 7919 + 3);
    this.rng = new Rng((o.seed ?? 1) * 104729 + 11);
    const half = this.n / 2;
    const L = this.n * c.pitchMm;
    let maxI = 0;
    for (let i = 0; i < this.n; i++) {
      const u = (i + 0.5 - half) * c.pitchMm;
      this.u[i] = u;
      const s = (u + L / 2) / L; // 0 at one end, 1 at the other
      const l = c.led;
      const I = (Math.exp(-l.endFalloff * s) + l.endRatio * Math.exp(-l.endFalloff * (1 - s)))
        * (1 + l.ripple * Math.cos((2 * Math.PI * u) / l.ripplePeriodMm));
      this.light[i] = I;
      if (I > maxI) maxI = I;
    }
    for (let i = 0; i < this.n; i++) this.light[i] /= maxI;
    const perChip = this.n / c.chips;
    let chipGain = 1;
    for (let i = 0; i < this.n; i++) {
      if (i % perChip === 0) chipGain = 1 + c.chipGainSpread * this.fixed.gauss();
      this.gain[i] = chipGain * (1 + c.prnu * this.fixed.gauss());
      this.offset[i] = c.dsnuCounts * this.fixed.gauss();
    }
    this._lift = NaN; this._travel = NaN;
    this.setBlur(0, 0);
  }

  /** The current PSF sigma, mm. */
  get sigmaMm() { return Math.hypot(this.c.psfSigmaMm, this.c.liftBlurPerMm * this._lift); }

  /** Recompute the tap grid for a lift off the glass and a travel during the line (both mm). */
  setBlur(liftMm, travelMm) {
    if (liftMm === this._lift && travelMm === this._travel) return;
    this._lift = liftMm; this._travel = travelMm;
    const s = this.sigmaMm;
    const h = Math.max(TAP_MM, 0.5 * s);
    const count = (a) => Math.min(MAX_TAPS, 1 + 2 * Math.ceil((a / 2 + 2.5 * s) / h));
    const ax = this.c.apertureMm, ay = Math.max(1e-6, travelMm * this.c.integrationDuty);
    this.nx = count(ax); this.ny = count(ay);
    boxGaussTaps(ax, s, this.tapX, this.wX, this.nx);
    boxGaussTaps(ay, s, this.tapY, this.wY, this.ny);
    this._skew = NaN;
  }

  _rotateTaps(skew, dpmmX, dpmmY) {
    if (skew === this._skew && dpmmX === this._dx && dpmmY === this._dy) return;
    this._skew = skew; this._dx = dpmmX; this._dy = dpmmY;
    const cs = Math.cos(skew), sn = Math.sin(skew);
    let k = 0;
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++, k++) {
        const ax = this.tapX[i], ay = this.tapY[j];
        // machine frame (across the bar, along the feed) into the sheet's frame (rotated by -skew), into pixels
        this.dpx[k] = (ax * cs + ay * sn) * dpmmX;
        this.dpy[k] = (-ax * sn + ay * cs) * dpmmY;
        this.w[k] = this.wX[i] * this.wY[j];
      }
    }
  }

  /**
   * Scan one line. `page` is { widthMm, heightMm, dpmmX, dpmmY, w, h, data } (pages.js; data is reflectance x 255);
   * `pose` is where the sheet is: yMm (how far it has been fed: the page's y under the bar's centre when it is
   * straight, from its top edge), xMm (the page's centre line from the bar's centre, positive to higher elements),
   * skewRad (the sheet turned in its plane: page = R(-skew) (machine - offset)), liftMm, travelMm. `page` null reads
   * the white reference strip; `opts.led` false reads with the light off (the dark reference).
   * Writes `out` (Float32Array of elements) with ADC counts; returns it.
   */
  scanLine(page, pose, out, opts = {}) {
    const c = this.c;
    const n = this.n;
    const led = opts.led !== false;
    const refl = this.refl;
    if (!page) {
      for (let i = 0; i < n; i++) refl[i] = c.whiteReference;
    } else {
      const { yMm = 0, xMm = 0, skewRad = 0, liftMm = 0, travelMm = 0 } = pose ?? {};
      this.setBlur(liftMm, travelMm);
      const dX = page.dpmmX ?? page.dpmm, dY = page.dpmmY ?? page.dpmm;
      this._rotateTaps(skewRad, dX, dY);
      const cs = Math.cos(skewRad), sn = Math.sin(skewRad);
      const W = page.w, H = page.h, data = page.data, back = c.backingReflectance * 255;
      const dpx = this.dpx, dpy = this.dpy, wt = this.w, K = this.nx * this.ny;
      const cx = page.widthMm / 2;
      for (let i = 0; i < n; i++) {
        const a = this.u[i] - xMm;
        // page pixel coordinates of the element's centre (pixel centres at integer + 0.5): the bar's point
        // (a, 0) seen from a sheet fed yMm and turned by skewRad
        const px0 = (cx + a * cs + yMm * sn) * dX - 0.5;
        const py0 = (-a * sn + yMm * cs) * dY - 0.5;
        let acc = 0;
        for (let k = 0; k < K; k++) {
          const x = px0 + dpx[k], y = py0 + dpy[k];
          let v;
          if (x < -0.5 || y < -0.5 || x > W - 0.5 || y > H - 0.5) v = back;
          else {
            let ix = Math.floor(x), iy = Math.floor(y);
            let fx = x - ix, fy = y - iy;
            if (ix < 0) { ix = 0; fx = 0; } else if (ix >= W - 1) { ix = W - 2; fx = 1; }
            if (iy < 0) { iy = 0; fy = 0; } else if (iy >= H - 1) { iy = H - 2; fy = 1; }
            const o = iy * W + ix;
            const v0 = data[o] + (data[o + 1] - data[o]) * fx;
            const v1 = data[o + W] + (data[o + W + 1] - data[o + W]) * fx;
            v = v0 + (v1 - v0) * fy;
          }
          acc += wt[k] * v;
        }
        refl[i] = acc / 255;
      }
    }
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      const sig = led ? c.whiteCounts * this.light[i] * this.gain[i] * refl[i] : 0;
      const sd = Math.sqrt(c.readNoise * c.readNoise + c.shotNoise * sig);
      let v = c.darkCounts + this.offset[i] + sig + sd * rng.gauss();
      v = Math.round(v);
      out[i] = v < 0 ? 0 : v > c.adcMax ? c.adcMax : v;
    }
    return out;
  }
}

/**
 * Taps and weights for a box of width `a` convolved with a Gaussian of sigma `s`, sampled at m evenly spaced points
 * over its support (+-(a/2 + 2.5 s)); the weights are the kernel at each tap, normalised.
 */
export function boxGaussTaps(a, s, taps, w, m = taps.length) {
  const half = a / 2 + 2.5 * s;
  let sum = 0;
  for (let i = 0; i < m; i++) {
    const d = m === 1 ? 0 : -half + (2 * half * i) / (m - 1);
    taps[i] = d;
    const k = normCdf((d + a / 2) / s) - normCdf((d - a / 2) / s);
    w[i] = k;
    sum += k;
  }
  for (let i = 0; i < m; i++) w[i] /= sum;
}
