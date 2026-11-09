// Plays recorded event samples at the moments the mechanism makes them happen. Every trigger comes from a
// contact or a rack/detent crossing in the simulation; level and brightness come from its force or speed.
import { AC } from '../sim/ports.js';

const V = 32;                 // voices
const REF_STRIKE_PK = 0.45;   // source amplitude of an ordinary keystroke, so cuts keep their recorded balance
const MAX_VOICE_GAIN = 2.5;
const TOUCH_WAIT_S = 0.035;   // how long a bottomed key waits for its slug before it counts as a missed press
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

class Rng { constructor(s) { this.s = s | 0 || 1; } next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x; return (x >>> 0) / 4294967296; } }

export class Sampler {
  constructor(sim, sampleRate) {
    this.sim = sim; this.sr = sampleRate; this.loaded = false;
    this.counts = {};           // triggers per set since start, for diagnostics
    this.rng = new Rng(0x71c0beef);
    this.pos = new Float64Array(V); this.end = new Float64Array(V); this.inc = new Float64Array(V);
    this.gain = new Float64Array(V); this.lpA = new Float64Array(V); this.lpY = new Float64Array(V);
    this.active = new Uint8Array(V);
    this.pendLeft = new Int32Array(sim.nKeys + 8); this.pendV = new Float64Array(sim.nKeys + 8); this.nPend = 0;   // key touches waiting to see whether a slug strike follows
    this.now = 0;
    this.lastTooth = 0; this.lastDet = 0; this.toothInit = false; this.detInit = false;
    this.toothGuard = 0; this.detGuard = 0; this.stopGuard = -1e9;
    this.lastStrike = new Float64Array(sim.nKeys + 8).fill(-1e9);
    this.lastPad = new Float64Array(sim.nKeys + 8).fill(-1e9);
    this.lastBottom = new Float64Array(sim.nKeys + 8).fill(-1e9);
    this.lastTop = new Float64Array(sim.nKeys + 8).fill(-1e9);
    this.clashHold = 0; this.clashMax = 0; this.clashGuard = 0;
    this.paperV = 0; this.vFilt = 0; this.loops = {};
  }

  load(pcm, manifest) {
    const sr = this.sr; const p = manifest.peakNorm ?? 0.7;
    this.unit = 1 / p;
    this.pcm = pcm; this.sets = {};
    // A cut far below the rest of its set is mostly room noise once normalised: leave it out.
    const levels = {};
    for (const it of manifest.items) (levels[it.set] ??= []).push(it.srcPk ?? REF_STRIKE_PK);
    for (const k in levels) levels[k] = levels[k].sort((a, b) => a - b)[levels[k].length >> 1];
    for (const it of manifest.items) {
      if ((it.srcPk ?? REF_STRIKE_PK) < 0.3 * levels[it.set]) continue;
      (this.sets[it.set] ??= []).push({
        set: it.set, srcT: it.srcT, o: Math.round(it.o * sr), n: Math.round(it.d * sr), lvl: it.lvl ?? 1, base: 0.5 * (it.srcPk ?? REF_STRIKE_PK) / REF_STRIKE_PK / p,
        loop: !!it.loop,
      });
    }
    // Each key keeps its own small set of recordings in each strength tier.
    const geo = this.sim.g;
    this.keyVar = [];
    for (let k = 0; k < geo.keys.length; k++) {
      const id = geo.keys[k].id ?? String(k);
      const tiers = {};
      for (const tier of ['strike_soft', 'strike_med', 'strike_hard', 'space', 'touch']) {
        const pool = this.sets[tier]; if (!pool?.length) continue;
        const h = fnv(id + '/' + tier); const m = pool.length;
        const a = h % m, b = ((h >>> 8) % (m - 1 || 1) + a + 1) % m, c = ((h >>> 16) % (m - 2 > 0 ? m - 2 : 1) + b + 1) % m;
        tiers[tier] = [a, b, c].filter((v, i, x) => x.indexOf(v) === i).map((i) => pool[i]);
      }
      this.keyVar.push({ tiers, rr: 0, isSpace: id === 'space' || geo.keys[k].id === 'space', isShift: /shift/i.test(id) });
    }
    this.rrGen = 0;
    for (const name of ['paper_rustle', 'paper_feed']) {
      const it = this.sets[name]?.[0];
      if (it) this.loops[name] = { o: it.o, n: it.n, base: it.base, pos: 0, g: 0, tg: 0 };
    }
    this.radius = this.sim.m.platen.radius;
    this.loaded = true;
  }

  setPaperSpeed(v) { this.paperV = Number.isFinite(v) ? v : 0; }

  /** Sample-accurate queue of acoustic events. */
  drain(sim) {
    if (sim.acN === 0) return;
    if (this.loaded) {
      const q = sim.acQ;
      for (let i = 0; i < sim.acN; i++) this.fire(q[i * 3], q[i * 3 + 1], q[i * 3 + 2]);
    }
    sim.acN = 0;
  }

  /** gain is relative to the cut's level in the recording, or to the sprite's own peak when `absolute`. */
  play(set, gain, lpHz = 0, absolute = false) {
    if (!set) return;
    this.counts[set.set] = (this.counts[set.set] ?? 0) + 1;
    let v = -1, bestLeft = Infinity;
    for (let i = 0; i < V; i++) {
      if (!this.active[i]) { v = i; bestLeft = -1; break; }
      const left = this.end[i] - this.pos[i];
      if (left < bestLeft) { bestLeft = left; v = i; }
    }
    const g = Math.min(MAX_VOICE_GAIN, gain * (0.92 + 0.16 * this.rng.next()));
    this.pos[v] = set.o; this.end[v] = set.o + set.n - 2;
    this.inc[v] = 1 + (this.rng.next() - 0.5) * 0.007;
    this.gain[v] = g * (absolute ? this.unit : set.base); this.lpY[v] = 0;
    this.lpA[v] = lpHz > 0 && lpHz < 0.45 * this.sr ? Math.exp(-2 * Math.PI * lpHz / this.sr) : 0;
    this.active[v] = 1;
  }

  pick(key, tier) {
    const pool = this.keyVar[key]?.tiers[tier];
    if (!pool || !pool.length) return null;
    return pool[this.keyVar[key].rr++ % pool.length];
  }

  fire(type, a, b) {
    switch (type) {
      case AC.STRIKE: this.strike(a | 0, b); break;
      case AC.KEY_BOTTOM: this.keyBottom(a | 0, b); break;
      case AC.PAD: if (b > 8 && this.now - this.lastPad[a | 0] > 0.05 * this.sr) { this.lastPad[a | 0] = this.now; this.play(this.choose('bar_return'), Math.min(1.4, Math.pow(b / 40, 0.9))); } break;
      case AC.SHIFT_DOWN: this.play(this.sets.shift_down?.[0], Math.min(1.6, Math.pow(Math.abs(b) / 0.25, 0.7) + 0.2)); break;
      case AC.SHIFT_UP: this.play(this.sets.shift_up?.[0], Math.min(1.6, Math.pow(Math.abs(b) / 0.25, 0.7) + 0.2)); break;
      case AC.LS_PICK: if (b > 0.05) this.play(this.choose('lever'), Math.min(1.4, 0.6 + 0.5 * Math.min(1, b / 6))); break;
      case AC.STOP: if (b > 0.03 && this.now - this.stopGuard > 0.12 * this.sr) this.stopGuard = this.now, this.play(this.choose('endstop'), Math.min(1.6, Math.pow(b / 0.9, 1.0)), Math.min(19000, 2500 + 14000 * b)); break;
      case AC.KEY_TOP: this.keyTop(a | 0, b); break;
      case AC.BELL: this.play(this.sets.bell?.[0], Math.min(1.5, Math.pow(b / 110, 0.8))); break;
      default: break;
    }
  }

  choose(name) { const s = this.sets[name]; return s ? s[this.rng.next() * s.length | 0] : null; }

  strike(bar, F) {
    const now = this.now;
    this.lastStrike[bar] = now;
    if (this.pendLeft[bar] > 0) { this.pendLeft[bar] = 0; this.nPend--; }
    if (!this.keyVar[bar]) return;
    const tier = F < 120 ? 'strike_soft' : F < 300 ? 'strike_med' : 'strike_hard';
    const s = this.pick(bar, tier);
    if (!s) return;
    // An ordinary stroke (150 N) sits near -6 dBFS. Below it the level falls fast so soft presses are soft; above it
    // the curve eases so the 200-340 N the keyboard path produces keeps its dynamics instead of pinning at the limiter.
    const amp = 0.58 * Math.pow(F / 150, F < 150 ? 1.2 : 0.55) * Math.max(0.75, Math.min(1.35, s.lvl));
    // Duller when soft: a cotton-wool contact excites less of the top end.
    this.play(s, Math.min(0.98, amp), Math.max(1400, Math.min(20000, 1800 * Math.pow(F / 40, 1.6))), true);
  }

  keyBottom(k, v) {
    const info = this.keyVar[k]; if (!info || v < 0.02) return;
    this.lastBottom[k] = this.now;
    if (info.isShift) return;
    if (info.isSpace) {
      const s = this.pick(k, 'space');
      if (s) this.play(s, Math.min(1.6, v / 0.26), Math.max(1800, Math.min(20000, 9000 * Math.pow(v / 0.26, 1.5))));
      return;
    }
    if (this.now - this.lastStrike[k] < 0.12 * this.sr) return;     // the strike cut already has this key's bottom in it
    if (this.pendLeft[k] === 0) this.nPend++;
    this.pendLeft[k] = Math.round(TOUCH_WAIT_S * this.sr); this.pendV[k] = v;
  }

  /** A press too light to bottom the key or throw the bar still lifts off a finger: the key settling on its top felt. */
  keyTop(k, v) {
    if (v < 0.02 || !this.keyVar[k] || this.keyVar[k].isShift) return;
    const hold = 0.7 * this.sr, now = this.now;
    if (now - this.lastStrike[k] < hold || now - this.lastBottom[k] < hold || now - this.lastTop[k] < 0.08 * this.sr) return;
    this.lastTop[k] = now;
    this.play(this.pick(k, 'touch'), Math.min(0.9, Math.pow(v / 0.35, 0.9)));
  }

  /** Per-sample physics that isn't a discrete contact in the mechanism: rack and detent teeth, clashes. */
  advance(sim, barbar) {
    if (!this.loaded) return;
    this.now++;
    if (this.nPend > 0) {
      for (let k = 0; k < this.pendLeft.length; k++) {
        if (this.pendLeft[k] > 0 && --this.pendLeft[k] === 0) {
          this.nPend--;
          this.play(this.pick(k, 'touch'), Math.min(1.6, 0.3 + Math.pow(this.pendV[k] / 0.35, 0.9)));
        }
      }
    }
    // Rack ratchet: one grain per tooth passed in the return direction, with the dogs on the rack.
    const q = sim.q, p = sim.p;
    if (p > 0) {
      const tooth = Math.floor(q / p + 0.5);
      if (!this.toothInit) { this.lastTooth = tooth; this.toothInit = true; }
      if (tooth !== this.lastTooth) {
        const speed = sim.qV < 0 ? -sim.qV : sim.qV;
        const released = sim.ax[1] / (sim.auxParams[1].hi || 1) > 0.5;
        if (tooth < this.lastTooth && speed > 0.02 && !released && this.now - this.toothGuard > 0.001 * this.sr) {
          this.toothGuard = this.now;
          this.play(this.choose('ratchet'), Math.min(0.9, Math.pow(speed / 0.2, 0.6)));
        }
        this.lastTooth = tooth;
      }
    }
    // Platen detent, per notch.
    const detN = sim.detN;
    if (detN > 0) {
      const d = Math.floor(sim.psi * detN / (2 * Math.PI) + 0.5);
      if (!this.detInit) { this.lastDet = d; this.detInit = true; }
      if (d !== this.lastDet) {
        this.lastDet = d;
        const w = Math.abs(sim.psiV);
        if (w > 0.15 && this.now - this.detGuard > 0.006 * this.sr) { this.detGuard = this.now; this.play(this.choose('knob'), Math.min(1.4, Math.pow(w / 4, 0.7)) * (sim.pawlEngaged ? 0.5 : 1)); }
      }
    }
    // Clash: bar against bar, level from the peak of the contact.
    if (this.clashHold > 0) {
      if (barbar > this.clashMax) this.clashMax = barbar;
      if (--this.clashHold === 0) { this.play(this.choose('clash'), Math.min(1.5, this.clashMax / 180)); this.clashGuard = this.now; }
    } else if (barbar > 60 && this.now - this.clashGuard > 0.03 * this.sr) { this.clashHold = Math.round(0.0015 * this.sr); this.clashMax = barbar; }
    // Paper loops follow the soft-body speed and the platen feed.
    const surface = Math.abs(sim.psiV) * this.radius;
    const v = this.paperV;
    const present = v > 0.004;
    const feed = present ? Math.min(v, surface + 0.05) : 0;
    const handled = present ? Math.max(0, v - surface) : 0;
    const L = this.loops;
    if (L.paper_feed) L.paper_feed.tg = feed > 0.005 ? Math.min(1.5, Math.pow(feed / 0.08, 0.7)) : 0;
    if (L.paper_rustle) L.paper_rustle.tg = handled > 0.01 ? Math.min(1.5, Math.pow(handled / 0.25, 0.7)) : 0;
  }

  tick() {
    if (!this.loaded) return 0;
    const { pos, end, inc, gain, lpA, lpY, active, pcm } = this;
    let out = 0;
    for (let v = 0; v < V; v++) {
      if (!active[v]) continue;
      const p = pos[v], i = p | 0, f = p - i;
      let y = (pcm[i] + (pcm[i + 1] - pcm[i]) * f) * gain[v];
      const a = lpA[v];
      if (a) { y = y + (lpY[v] - y) * a; lpY[v] = y; }
      out += y;
      const np = p + inc[v];
      if (np >= end[v]) active[v] = 0; else pos[v] = np;
    }
    const smooth = 0.0015;
    for (const key in this.loops) {
      const L = this.loops[key];
      if (L.tg === 0 && L.g < 1e-4) { L.g = 0; continue; }
      L.g += (L.tg - L.g) * smooth;
      out += pcm[L.o + (L.pos | 0)] * L.g * L.base;
      L.pos = (L.pos + 1) % L.n;
    }
    return out;
  }
}
