// Render size and the quality governor, shared by every kit through createScene (docs/perf-review.md,
// recommendations 5, 6 and 24). Pure logic, no three.js, so it runs under node --test.

export const MAX_PIXELS = 3.2e6;   // the render budget: no window is drawn at more than this many pixels for supersampling

/**
 * The device's tier: 'phone' on a coarse pointer (a touch screen with no mouse), else 'desktop'. ?tier=phone or
 * ?tier=desktop overrides it.
 */
export function deviceTier({ search = '', coarse = false } = {}) {
  const q = new URLSearchParams(search).get('tier');
  if (q === 'phone' || q === 'desktop') return q;
  return coarse ? 'phone' : 'desktop';
}

/** What a tier changes: the pixel-ratio cap, the AO tier to start on, PCSS taps, the key shadow and anisotropy. */
export const TIERS = {
  desktop: { maxRatio: 2, aoTier: 0, pcssSamples: 16, pcssBlocker: 12, keyShadow: 2048, maxAniso: Infinity, headScale: 2 },
  phone: { maxRatio: 1.5, aoTier: 1, pcssSamples: 8, pcssBlocker: 8, keyShadow: 1024, maxAniso: 4, headScale: 1.5 },
};

/**
 * Framebuffer pixels per CSS pixel. By default the display's own (devicePixelRatio), never above the tier's cap or the
 * pixel budget; with `supersample` (granted by the governor when frames show room) up to the budget as before. The
 * governor's `quality` scales it down, but never below one framebuffer pixel per CSS pixel (or the display's own, if
 * that is less).
 */
export function renderPixelRatio({ w, h, dpr = 1, quality = 1, supersample = false, maxRatio = 2 }) {
  const budget = Math.sqrt(MAX_PIXELS / Math.max(1, w * h));
  const display = dpr > 0 ? dpr : 1;
  const native = Math.min(display, maxRatio, budget);
  const r = supersample ? Math.max(native, Math.min(budget, maxRatio)) : native;
  const floor = Math.min(1, display);
  return Math.min(maxRatio, Math.max(floor, r * quality));
}

/**
 * Watches frame intervals (rAF timestamps, ms) and says when to step quality down, or when there is room to step up.
 * - A window is about `windowMs` of frames; a window whose mean interval is over `slowMs` is slow, and `slowWindows`
 *   slow windows in a row step down. Long frames count as slow frames: only a gap over `maxGapMs` (a tab switch, a
 *   breakpoint) is left out, so a device at 5 fps steps down in seconds.
 * - Nothing is decided in the first `warmupMs` (loading, first shader compiles).
 * - With `canSupersample`, `fastWindows` windows at or under `fastMs` in a row return 'up' once; the mean then is the
 *   baseline, and any later window over max(baseline * 1.3, fastMs + 4) returns 'revert' (and no more 'up' for good).
 */
export class Governor {
  constructor({ start = 0, warmupMs = 15000, windowMs = 2000, slowMs = 24, slowWindows = 3, fastMs = 17.5, fastWindows = 3, maxGapMs = 1000, canSupersample = false } = {}) {
    Object.assign(this, { warmupMs, windowMs, slowMs, slowWindows, fastMs, fastWindows, maxGapMs, canSupersample });
    this.start = start; this.last = null;
    this.sum = 0; this.n = 0; this.slow = 0; this.fast = 0;
    this.supersampled = false; this.baseline = 0; this.probed = false;
    this.lastMean = 0;
  }

  /** One frame at time `now` (ms). Returns null, 'down', 'up' or 'revert'. */
  sample(now) {
    const last = this.last; this.last = now;
    if (last === null) return null;
    const d = now - last;
    if (!(d > 0) || d > this.maxGapMs) return null;   // a tab switch: not a frame
    this.sum += d; this.n++;
    if (this.sum < this.windowMs) return null;
    const mean = this.sum / this.n; this.sum = 0; this.n = 0; this.lastMean = mean;
    if (now < this.start + this.warmupMs) return null;
    if (this.supersampled && mean > Math.max(this.baseline * 1.3, this.fastMs + 4)) {
      this.supersampled = false; this.slow = 0; this.fast = 0;
      return 'revert';
    }
    if (mean > this.slowMs) {
      this.fast = 0;
      if (++this.slow >= this.slowWindows) { this.slow = 0; return 'down'; }
      return null;
    }
    this.slow = 0;
    if (mean <= this.fastMs && this.canSupersample && !this.probed) {
      if (++this.fast >= this.fastWindows) {
        this.fast = 0; this.probed = true; this.supersampled = true; this.baseline = mean;
        return 'up';
      }
    } else this.fast = 0;
    return null;
  }

  /** Supersampling was given up for another reason (a step down): never ask for it again. */
  dropSupersample() { this.supersampled = false; this.probed = true; }
}
