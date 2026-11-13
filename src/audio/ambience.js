// The room's weather, heard: a long rain loop, and thunder that arrives after the flash by the time sound takes to cross
// the distance. On the typewriters it has its own AudioContext, opened by the click that chooses the weather, and leaves
// the worklet alone; the word processor hands it the kit's shared context (`context`), which exists only after the
// first gesture, so a weather chosen before that is heard once attach() is called.
const BASE = '/assets/audio/ambience/';
const RAIN_LEVEL = { clear: 0, rain: 0.34, storm: 0.55 };
const CROSSFADE_S = 3.5, FADE_S = 2.5;
const SOUND_KM_PER_S = 0.343;
const GAP_S = [13, 48];                       // between strikes in a storm
const NEAR_KM = 0.28, FAR_KM = 3.4;

// One recorded roll, cut three ways so strikes do not sound alike: the whole thing, the crack alone, the rumble alone.
export const THUNDER_PARTS = { whole: { t: 0, d: 22.8 }, crack: { t: 0, d: 8.4 }, rumble: { t: 9.0, d: 13.8 } };

/** One lightning strike. The nearest are rare, bright and close behind their flash; the far ones are dim, late and dull. */
export function planStrike(rng = Math.random) {
  const u = rng();
  const km = NEAR_KM + (FAR_KM - NEAR_KM) * u * Math.sqrt(u);
  const near = 1 - (km - NEAR_KM) / (FAR_KM - NEAR_KM);
  return {
    km,
    flash: 0.28 + 0.72 * near * near,
    delayS: km / SOUND_KM_PER_S,
    gain: 0.3 + 0.7 * near,
    cutoffHz: 900 * Math.pow(10, near),      // air and walls take the top off a distant roll
    rate: (0.84 + 0.22 * near) * (0.97 + 0.06 * rng()),
    part: near > 0.72 ? (rng() < 0.5 ? 'whole' : 'crack') : near > 0.35 ? 'whole' : 'rumble',
    nextS: GAP_S[0] + (GAP_S[1] - GAP_S[0]) * rng(),
  };
}

export class Ambience {
  constructor({ environment, rng = Math.random, context = null }) {
    this.env = environment; this.rng = rng;
    this.shared = context;                    // () => an AudioContext, or null while there is none yet
    this.weather = 'clear';
    this.enabled = true;
    this.timers = new Set();
  }

  later(s, fn) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, s * 1000);
    this.timers.add(id);
    return id;
  }

  /** Opens the sound; false while a shared context is not there yet. */
  open() {
    if (this.ctx) { this.ctx.resume?.(); return true; }
    const ctx = this.shared ? this.shared() : new (window.AudioContext || window.webkitAudioContext)();
    if (!ctx) return false;
    this.ctx = ctx;
    ctx.resume?.();
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 1 : 0; this.master.connect(ctx.destination);
    this.rainBus = ctx.createGain(); this.rainBus.gain.value = 0; this.rainBus.connect(this.master);
    this.decks = [this.deck(), this.deck()];
    this.live = 0;
    this.watch = setInterval(() => this.loopRain(), 200);
    this.thunder = fetch(`${BASE}thunder.ogg`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch((e) => { console.warn('thunder not loaded', e); return null; });
    return true;
  }

  /** The shared context has just come up: start the rain for a weather chosen before it. */
  attach() { if (!this.ctx && this.weather !== 'clear') this.rain(); }

  deck() {
    const el = new Audio(`${BASE}rain.ogg`);
    el.preload = 'auto';
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(gain); gain.connect(this.rainBus);
    return { el, gain };
  }

  /** Two players of the one file: the idle one starts as the live one nears its end, and they cross with equal power. */
  loopRain() {
    const live = this.decks[this.live];
    if (live.el.paused || !Number.isFinite(live.el.duration) || live.el.currentTime < live.el.duration - CROSSFADE_S) return;
    const next = this.decks[1 - this.live], t = this.ctx.currentTime;
    next.el.currentTime = 0; next.el.play().catch(() => {});
    const curve = (up) => Float32Array.from({ length: 32 }, (_, i) => { const a = (i / 31) * Math.PI / 2; return up ? Math.sin(a) : Math.cos(a); });
    next.gain.gain.cancelScheduledValues(t); next.gain.gain.setValueCurveAtTime(curve(true), t, CROSSFADE_S);
    live.gain.gain.cancelScheduledValues(t); live.gain.gain.setValueCurveAtTime(curve(false), t, CROSSFADE_S);
    this.live = 1 - this.live;
  }

  /** Weather sounds on or off. The flashes and the rest of the room carry on either way. */
  setEnabled(on) {
    this.enabled = on;
    if (!this.master) return;
    const t = this.ctx.currentTime, g = this.master.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(on ? 1 : 0, t + 0.25);
  }

  setWeather(name) {
    if (name === this.weather || !(name in RAIN_LEVEL)) return;
    this.weather = name;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.rain();
    if (name === 'storm') this.later(2 + 6 * this.rng(), () => this.strike());   // the flashes run with or without sound
  }

  rain() {
    const name = this.weather;
    if (name === 'clear' && !this.ctx) return;
    if (!this.open()) return;
    const level = RAIN_LEVEL[name], t = this.ctx.currentTime, bus = this.rainBus.gain;
    bus.cancelScheduledValues(t); bus.setValueAtTime(bus.value, t); bus.linearRampToValueAtTime(level, t + FADE_S);
    const deck = this.decks[this.live];
    if (level > 0 && deck.el.paused) {
      deck.gain.gain.value = 1;
      deck.el.play().catch((e) => console.warn('rain did not start', e));
    } else if (level === 0) this.later(FADE_S + 0.1, () => { for (const d of this.decks) d.el.pause(); });
  }

  strike() {
    if (this.weather !== 'storm') return;
    const s = planStrike(this.rng);
    this.env?.flash?.(s.flash);
    this.later(s.delayS, () => this.roll(s));
    this.later(s.nextS, () => this.strike());
  }

  async roll(s) {
    if (!this.ctx) return;
    const buffer = await this.thunder;
    if (!buffer) return;
    const { ctx } = this, part = THUNDER_PARTS[s.part], t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.playbackRate.value = s.rate;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = s.cutoffHz; lp.Q.value = 0.5;
    const g = ctx.createGain();
    const length = part.d / s.rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(s.gain, t + 0.03);
    g.gain.setValueAtTime(s.gain, t + Math.max(0.05, length - 0.9)); g.gain.linearRampToValueAtTime(0, t + length);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t, part.t, part.d);
  }
}
