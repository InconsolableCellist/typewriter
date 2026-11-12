// The keyboard's mechanical sound (architecture.md 10.4): recordings of a beam spring keyboard, played when a key's stem
// meets its felt (the press: the spring's snap and the cap bottoming) and when it comes home on its top stop (the
// release), each at a level set by the stem's speed. The events come from the keyboard's own mechanism
// (src/sim/wp/keyboard-mech.js), which runs on the main thread in the kit's KeyboardHost, so the cuts are played there
// through Web Audio on the same AudioContext as the worklet, scheduled at the event's own mechanism time. The speaker's
// click and beep are a separate, electrical sound (wp-speaker.js).
import { KEYS } from '../machine/wp-keys.js';

// Levels, from the Displaywriter recording (tools/audio/wp_levels.json): a key's press peaks 26 dB over the running
// machine's idle RMS, which the worklet plays at BED_DBFS. The beam spring recording sets the rest: releases sit at
// their own recorded level against the presses (about 5 dB under), and each cut keeps its level within its set.
export const BED_DBFS = -50;
export const PRESS_OVER_BED_DB = 26.3;
export const V_PRESS = 1.29;      // m/s: a stem's speed at the felt under the default 1.2 N finger
export const V_RELEASE = 1.0;     // m/s: a stem's speed coming home on its spring
const HOLD_S = 0.03;              // a felt rebound within this long is part of the same press
const SPACE = 64;

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

/** Which recorded set a key sounds like: the space bar, the wide keys (1.25 u and over, and RETURN), the rest. */
export function keyClass(i) {
  const k = KEYS[i];
  if (!k) return 'key';
  if (k.pos === SPACE) return 'space';
  return k.w >= 1.25 || k.tall ? 'wide' : 'key';
}

/**
 * Chooses the cut, gain and rate for each key event; pure, so Node tests run it. Each key keeps a stable small set of
 * cuts per set (a hash of its position), taken in turn, with a little level and rate variation so repeats differ.
 */
export class KeyVoicer {
  constructor(manifest) {
    const p = manifest.peakNorm ?? 0.7;
    this.sets = {};
    for (const it of manifest.items) (this.sets[it.set] ??= []).push(it);
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    // The reference: the median press of the alphanumeric keys, in source units.
    this.ref = med(this.sets.key_press.map((it) => it.scale ?? it.srcPk / p));
    this.target = 10 ** ((BED_DBFS + PRESS_OVER_BED_DB) / 20) / p;   // per sprite unit: the sprite's cuts peak at p
    this.last = new Float64Array(KEYS.length).fill(-1e9);
    this.rr = new Uint32Array(KEYS.length);
    this.rng = 0x2545f491;
  }

  rand() { let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x; return (x >>> 0) / 4294967296; }

  /** A cut for this key from a set: three per key, by its hash, taken in turn. */
  pick(i, set) {
    const pool = this.sets[set] ?? this.sets[set.replace(/^(space|wide)/, 'key')];
    if (!pool?.length) return null;
    const h = fnv(`${KEYS[i]?.pos ?? i}/${set}`), m = pool.length;
    const own = [h % m, (h >>> 8) % m, (h >>> 16) % m];
    return pool[own[this.rr[i]++ % 3]];
  }

  /** { kind, key, v, t } -> { item, gain, rate } or null: the gain is per unit of the sprite (its samples peak at 0.7). */
  voice(e) {
    const press = e.kind === 'press';
    if (press) {
      if (e.v < 0.05 || e.t - this.last[e.key] < HOLD_S) return null;
      this.last[e.key] = e.t;
    } else if (e.v < 0.05) return null;
    const item = this.pick(e.key, `${keyClass(e.key)}_${press ? 'press' : 'release'}`);
    if (!item) return null;
    const speed = press ? Math.min(1.5, Math.pow(e.v / V_PRESS, 0.8)) : Math.min(1.3, Math.pow(e.v / V_RELEASE, 0.6));
    const scale = item.scale ?? item.srcPk / 0.7;
    const gain = (this.target / this.ref) * scale * speed * (0.9 + 0.2 * this.rand());
    return { item, gain, rate: 1 + (this.rand() - 0.5) * 0.03 };
  }
}

/** Web Audio side: fetches the sprite once audio is unlocked and plays each event's cut at its mechanism time. */
export class WpKeySampler {
  constructor(dir = 'samples_wpkeys') { this.dir = dir; this.ctx = null; this.buf = null; this.voicer = null; }

  /** ctx: the running AudioContext (the one the worklet uses). Never throws: without the sprite the keys are silent. */
  async attach(ctx) {
    if (this.ctx) return;
    this.ctx = ctx;
    try {
      const base = `/assets/audio/${this.dir}/`;
      const manifest = await (await fetch(`${base}manifest.json`)).json();
      this.buf = await ctx.decodeAudioData(await (await fetch(base + manifest.sprite)).arrayBuffer());
      this.voicer = new KeyVoicer(manifest);
      this.out = ctx.createGain(); this.out.gain.value = 1; this.out.connect(ctx.destination);
    } catch (e) { console.warn('key sounds not loaded', e); }
  }

  /**
   * e: a KeyboardHost sound event; now: the mechanism clock at this call. An event lies at most a frame in the past:
   * it is scheduled that much before a short fixed lead, so the spacing of presses and releases is kept.
   */
  play(e, now) {
    if (!this.voicer) return;
    const v = this.voicer.voice(e);
    if (!v) return;
    const ctx = this.ctx, when = Math.max(ctx.currentTime, ctx.currentTime + 0.01 + (e.t - now));
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = this.buf; src.playbackRate.value = v.rate;
    g.gain.value = v.gain;
    src.connect(g).connect(this.out);
    src.start(when, v.item.o, v.item.d);
  }
}
