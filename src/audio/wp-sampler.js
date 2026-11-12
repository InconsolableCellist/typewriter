// The word processor's recorded sounds on the audio thread (architecture.md 10.4): cuts from the owner's recording of a
// running Displaywriter (public/assets/audio/samples_wp), played when the mechanism makes them happen and scaled by its
// speeds, over the running machine's recorded hum. Each head step that crosses a track plays a single step's ring when
// it comes alone, or a short grain of a recorded seek's buzz when it follows another step, so a seek of any length
// sounds as the recorded ones do at the drive's step rate; the head-load pad landing plays a head-load clack, and
// lifting it the same clack, softer. Two loops carry the idle machine: below 450 Hz the drive motors' hum and tones,
// following the motors' speeds and power; above it the air, following the station fan's speed. Every cut plays at its
// recorded scale times one gain, so the recording's own balance between a seek, a step and the hum is kept. The printer
// and the levers stay synthesised (wp-synth.js): nothing in the recording is usable for them.
import { WAC } from '../sim/wp/ports.js';
import { fanSteadyOmega } from '../sim/wp/station-mech.js';

export const BED_DBFS = -50;    // the idle machine's RMS at the operator's chair, as wp-synth's assumed idle level
/** Ratios measured in the recording (tools/audio/wp_levels.json), in dB against the idle machine's RMS. */
export const RECORDED = {
  stepPeak: 17.2, headLoadPeak: 17.3, seekRms: 12.4, keyPressPeak: 26.3, keyReleasePeak: 15.3, beepRms: 17.5, crtLineRms: -18.0,
};
/** wp-synth levels replaced by the recordings while they are loaded: the drive motors and the station fan are in the bed
 * loops, the steps and the head load in the cuts. */
export const REPLACED = { stationFan: 0, stationHum: 0, motorRotor: 0, motorHum: 0, motorAir: 0, headLoad: 0 };
/** And scaled: the stepper's own tick stays under the recorded steps at a fifth; the pulley on its stop pin, which the
 * recording has nothing of, is brought down so that a recalibrate sits about 15 dB over the idle machine, as the program
 * load's first access (93.9 s) does in the recording. */
export const SCALED = { headStep: 0.2, headStop: 0.05 };

const V = 24;                   // voices
const GRAIN_S = 0.012;          // a seek grain: Hann window
const STEP_REF_S = 0.005;       // the drive's step time; at this rate the grains overlap to the recorded buzz
const ALONE_S = 0.02;           // a step with none in the 20 ms before it rings as a single step
const W_STEP = 7;               // rad/s: the head rotor's speed crossing a track in a seek's run, for the level of a grain
const W_ALONE = 3;              // rad/s: and in a single step from rest
const V_LAND = 0.027;           // m/s: the arm's speed as the pad lands under the solenoid
const SMOOTH = 0.0015;          // loop gain smoothing per sample
const MAXT = 64;                // triggers per block
const SET = ['disk_step', 'disk_seek', 'disk_load'];
const RECORDED_MAINS_HZ = 50;   // the recorded machine's line (dc4.nl, the Netherlands; its hum is at 100 Hz)

export class WpSampler {
  constructor(sim, sampleRate) {
    this.sim = sim; this.sr = sampleRate; this.loaded = false;
    this.counts = {};
    this.s = 0x51ed2701;
    this.pos = new Float64Array(V); this.end = new Float64Array(V); this.start = new Float64Array(V);
    this.inc = new Float64Array(V); this.gain = new Float64Array(V); this.win = new Float64Array(V);
    this.bus = new Uint8Array(V); this.active = new Uint8Array(V);
    this.tI = new Int32Array(MAXT); this.tSet = new Uint8Array(MAXT); this.tG = new Float64Array(MAXT); this.nT = 0;
    this.track = new Float64Array(2); this.lastStep = new Float64Array(2).fill(-1e9); this.landed = new Uint8Array(2);
    this.primed = false;
    this.n = 0;                 // samples rendered, the clock for ALONE_S
    this.loops = [];
  }

  rand() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x; return (x >>> 0) / 4294967296; }

  /** pcm: mono at this sample rate; manifest: public/assets/audio/samples_wp/manifest.json. */
  load(pcm, manifest) {
    const sr = this.sr, p = manifest.peakNorm ?? 0.7;
    this.pcm = pcm; this.sets = {};
    for (const it of manifest.items) {
      const cut = { o: Math.round(it.o * sr), n: Math.round(it.d * sr), scale: it.scale ?? it.srcPk / p, rms: it.rms ?? 0 };
      (this.sets[it.set] ??= []).push(cut);
    }
    const motor = this.sets.bed_motor?.[0], fan = this.sets.bed_fan?.[0];
    const bed = Math.hypot(motor?.rms ?? 0, fan?.rms ?? 0) || 1;
    // One gain for everything, so the recording's balance is kept; the root 2 undoes the constant-power pan, so the
    // idle machine's mid (the mono mix, as the recording was measured) sits at BED_DBFS.
    this.unit = (Math.SQRT2 * 10 ** (BED_DBFS / 20)) / bed;
    // A Hann grain every STEP_REF_S keeps the recorded buzz's power: mean(hann^2) = 3/8 per grain length.
    this.grainGain = 1 / Math.sqrt((0.375 * GRAIN_S) / STEP_REF_S);
    this.grainN = Math.round(GRAIN_S * sr);
    const D = this.sim.diskette, S = this.sim.station;
    if (D) { const d = D.blank(); D.steady(d); this.wmRun = d.wm; }
    this.fanRun = S ? fanSteadyOmega(S.def.fan) : 1;
    this.loops = [];
    // The recorded machine ran on a 50 Hz line (its hum is at 100 Hz); the AC motors' hum and speeds scale with the line,
    // so the motors' band plays at this machine's line frequency over the recording's.
    const mains = this.sim.m.station?.mainsHz ?? 60;
    if (motor && D) this.loops.push({ ...motor, bus: 2, ph: 0, g: 0, tg: 0, kind: 'motor', rate: mains / RECORDED_MAINS_HZ });
    if (fan && S) this.loops.push({ ...fan, bus: 1, ph: 0, g: 0, tg: 0, kind: 'fan', rate: 1 });
    this.loaded = true;
    this.primed = false;
  }

  /** Sample i of the block: the mechanism's onsets this sample (the WAC queue is still full) and its track crossings. */
  capture(i) {
    if (!this.loaded) return;
    const sim = this.sim, D = sim.diskette;
    if (!D) return;
    if (!this.primed) {
      for (let k = 0; k < 2; k++) { this.track[k] = Math.round(D.headTrack(k)); this.landed[k] = D.drives[k].landed ? 1 : 0; }
      this.primed = true;
    }
    const now = this.n + i;
    for (let k = 0; k < 2; k++) {
      const x = D.headTrack(k);
      if (Math.abs(x - this.track[k]) >= 0.6) {
        this.track[k] = Math.round(x);
        // Level with the rotor's speed as it crosses: a step from rest crosses slower than one in a seek's run.
        const w = Math.abs(D.st[k].w), alone = now - this.lastStep[k] > ALONE_S * this.sr;
        this.trigger(i, alone ? 0 : 1, Math.max(0.5, Math.min(1.4, Math.sqrt(w / (alone ? W_ALONE : W_STEP)))));
        this.lastStep[k] = now;
      }
      const l = D.drives[k].landed ? 1 : 0;
      if (l !== this.landed[k]) {
        if (!l) this.trigger(i, 2, 0.35 * Math.max(0.3, Math.min(1.3, Math.abs(D.drives[k].yv) / V_LAND)));   // the pad lifting
        this.landed[k] = l;
      }
    }
    const q = sim.acQ;
    for (let e = 0; e < sim.acN; e++) {
      if (q[e * 3] === WAC.HEAD_LAND) this.trigger(i, 2, Math.max(0.3, Math.min(1.4, Math.pow(Math.abs(q[e * 3 + 2]) / V_LAND, 0.8))));
    }
  }

  trigger(i, set, g) {
    if (this.nT >= MAXT) return;
    this.tI[this.nT] = i; this.tSet[this.nT] = set; this.tG[this.nT] = g; this.nT++;
  }

  /** Start a voice on a cut of set `set` (index in SET) at gain g relative to its recorded level. */
  play(set, g) {
    const pool = this.sets[SET[set]];
    if (!pool?.length) return;
    const name = SET[set];
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    const c = pool[(this.rand() * pool.length) | 0];
    let v = -1, left = Infinity;
    for (let k = 0; k < V; k++) {
      if (!this.active[k]) { v = k; break; }
      const r = this.end[k] - this.pos[k];
      if (r < left) { left = r; v = k; }
    }
    const vary = 0.9 + 0.2 * this.rand();
    let o = c.o, n = c.n, gain = g * vary * c.scale * this.unit;
    if (set === 1) {                       // a grain from anywhere in the buzz
      n = Math.min(this.grainN, c.n - 2);
      o = c.o + Math.floor(this.rand() * Math.max(1, c.n - n - 1));
      gain *= this.grainGain;
      this.win[v] = n;
    } else this.win[v] = 0;
    this.start[v] = o; this.pos[v] = o; this.end[v] = o + n - 2;
    this.inc[v] = 1 + (this.rand() - 0.5) * 0.02;
    this.gain[v] = gain; this.bus[v] = 2; this.active[v] = 1;
  }

  /** Loop targets from the mechanism's slow quantities, once a block. */
  block() {
    const sim = this.sim, D = sim.diskette, S = sim.station;
    for (const L of this.loops) {
      if (L.kind === 'motor') {
        let u = 0;
        for (let k = 0; k < 2; k++) { const r = D.drives[k].wm / this.wmRun; u += 0.5 * r * r; }
        L.tg = (D.powered ? 1 : 0.25) * u;      // the twice-line hum stops with the power; the rotors' tones run down
      } else {
        const r = Math.max(0, S.fan / this.fanRun);
        L.tg = Math.pow(r, 2.5);
      }
    }
  }

  /**
   * Render n samples into L and R (added to what is there), with the station's and diskette unit's pan gains. The
   * recorded room is in the cuts, so the engine adds this after its own room.
   */
  render(n, outL, outR, pan) {
    if (!this.loaded) { this.nT = 0; return; }
    this.block();
    const { pos, end, inc, gain, win, start, active, pcm, loops } = this;
    const [sL, sR, dL, dR] = pan;
    let t = 0;
    for (let i = 0; i < n; i++) {
      while (t < this.nT && this.tI[t] === i) { this.play(this.tSet[t], this.tG[t]); t++; }
      let ys = 0, yd = 0;
      for (let v = 0; v < V; v++) {
        if (!active[v]) continue;
        const p = pos[v], k = p | 0, f = p - k;
        let y = (pcm[k] + (pcm[k + 1] - pcm[k]) * f) * gain[v];
        if (win[v] > 0) { const s = Math.sin((Math.PI * (p - start[v])) / win[v]); y *= s * s; }
        yd += y;
        const np = p + inc[v];
        if (np >= end[v]) active[v] = 0; else pos[v] = np;
      }
      for (let l = 0; l < loops.length; l++) {
        const L = loops[l], ph = L.ph;
        let nx = ph + L.rate;                     // a loop runs on while silent, so it comes back where it would be
        if (nx >= L.n - 1) nx -= L.n - 1;
        L.ph = nx;
        if (L.tg === 0 && L.g < 1e-5) { L.g = 0; continue; }
        L.g += (L.tg - L.g) * SMOOTH;
        const k = ph | 0, a = pcm[L.o + k];
        const y = (a + (pcm[L.o + k + 1] - a) * (ph - k)) * L.g * this.unit;
        if (L.bus === 1) ys += y; else yd += y;
      }
      outL[i] += sL * ys + dL * yd;
      outR[i] += sR * ys + dR * yd;
    }
    this.nT = 0;
    this.n += n;
  }
}
