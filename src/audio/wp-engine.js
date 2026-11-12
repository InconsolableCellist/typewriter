// Drives the word processor's mechanism host at the audio rate, voices it (wp-synth.js) and publishes its snapshots,
// with the interface of AudioEngine so LocalHost and the worklet run it unchanged. Stereo: the printer, station and
// diskette buses are panned by where the units stand (architecture.md 10.1); the worklet writes both channels when
// `stereo` is set. Each block first steps the mechanism, capturing one probe frame per sample, then renders the
// voices, so the two costs are measured apart (`voiceNs`, `mechNs`: wall time per sample, smoothed).
import { SUBSTEP_HZ } from '../sim/mechanics.js';
import { WP_PORT } from '../sim/wp/ports.js';
import { RadiationFilter, Room } from './room.js';
import { WpSynth, StereoLimiter } from './wp-synth.js';

const SNAPSHOT_HZ = 250;
const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

export class WpAudioEngine {
  /** opts.levels: overrides of the voices' levels (wp-synth.js LEVEL), for calibration and tests. */
  constructor(sim, sampleRate, opts = {}) {
    this.sim = sim;
    this.sr = sampleRate;
    this.stereo = true;
    this.subPerFrame = SUBSTEP_HZ / sampleRate;
    this.subAcc = 0;
    this.timeScale = 1;
    this.enabled = true;
    this.snap = new Float32Array(sim.layout.length);
    this.snapCount = 0;
    this.snapEvery = Math.max(1, Math.round(sampleRate / SNAPSHOT_HZ));
    this.dspLoad = 0;
    this.voiceNs = 0; this.mechNs = 0;          // smoothed wall time per sample of the voices and of the mechanism
    this.voiceMsTotal = 0; this.voiceSamples = 0; // totals, for a measurement over a whole run
    this.voiceLastNs = 0;                         // the last block's, per sample
    this.rms = 0; this.rmsAcc = 0; this.rmsN = 0;
    this.onSnapshot = null;       // (Float32Array, events[]) => void
    this.evtBuf = [];
    this.synth = new WpSynth(sim, sampleRate, opts);
    this.room = new Room(sampleRate);
    this.radL = new RadiationFilter(sampleRate); this.radR = new RadiationFilter(sampleRate);
    // A short look-ahead keeps a strike's onset within a millisecond of its contact.
    this.limiter = new StereoLimiter(sampleRate, { lookaheadS: 0.0005 });
    this.bufL = new Float32Array(128); this.bufR = new Float32Array(128);
    this.gain = 1;
  }

  setTimeScale(s) { this.timeScale = Math.max(0, Math.min(1, s)); }
  setEnabled(b) { this.enabled = !!b; }
  setPaperSpeed() {}
  loadSamples() {}

  /**
   * Advance n audio frames. out: left (or mono) Float32Array, or null to run the mechanism without rendering; outR:
   * right, or omitted for a mono mix into out.
   */
  process(out, n, outR = null) {
    const t0 = now(), sim = this.sim, ports = sim.ports, sub = this.subPerFrame * this.timeScale, synth = this.synth;
    const render = this.enabled && !!out;
    if (render) synth.ensure(n);
    for (let i = 0; i < n; i++) {
      this.subAcc += sub;
      let k = this.subAcc | 0;
      this.subAcc -= k;
      const nSub = k;
      while (k-- > 0) sim.step();
      if (nSub > 1) for (let p = 0; p < WP_PORT.COUNT; p++) ports[p] /= nSub;   // forces averaged over the sample
      if (render) synth.capture(i);
      ports.fill(0);
      sim.acN = 0;               // every voice keys on forces and speeds; no onset needs the queue (architecture.md 10.3 item 2)
      if (++this.snapCount >= this.snapEvery) { this.snapCount = 0; this.publish(); }
    }
    const t1 = now();
    if (render) {
      if (this.bufL.length < n) { this.bufL = new Float32Array(n); this.bufR = new Float32Array(n); }
      const L = this.bufL, R = this.bufR;
      synth.render(n, L, R);
      const room = this.room, lim = this.limiter, g = this.gain;
      for (let i = 0; i < n; i++) {
        const l = L[i] * g, r = R[i] * g, mid = 0.5 * (l + r);
        const wet = room.tick(mid) - mid;
        lim.tick2(this.radL.tick(l + wet), this.radR.tick(r + wet));
        const yl = lim.l, yr = lim.r;
        if (outR) { out[i] = yl; outR[i] = yr; } else out[i] = 0.5 * (yl + yr);
        this.rmsAcc += 0.5 * (yl * yl + yr * yr);
      }
      this.rmsN += n;
      const t2 = now();
      this.voiceMsTotal += t2 - t1; this.voiceSamples += n;
      this.voiceLastNs = ((t2 - t1) * 1e6) / n;
      this.voiceNs = this.voiceNs * 0.95 + this.voiceLastNs * 0.05;
    } else {
      synth.primed = false;
      if (out) out.fill(0, 0, n);
      if (outR) outR.fill(0, 0, n);
    }
    this.mechNs = this.mechNs * 0.95 + ((t1 - t0) * 1e6 / n) * 0.05;
    this.dspLoad = this.dspLoad * 0.95 + ((now() - t0) / ((n * 1000) / this.sr)) * 0.05;
    return out;
  }

  publish() {
    const sim = this.sim;
    sim.writeSnapshot(this.snap);
    this.snap[sim.layout.dspLoad] = this.dspLoad;
    if (this.rmsN > 0) {
      this.rms = this.rms * 0.9 + Math.sqrt(this.rmsAcc / this.rmsN) * 0.1;
      this.rmsAcc = 0; this.rmsN = 0;
    }
    this.snap[sim.layout.rms] = this.rms;
    this.evtBuf.length = 0;
    sim.drainEvents(this.evtBuf);
    if (this.onSnapshot) this.onSnapshot(this.snap, this.evtBuf);
  }
}
