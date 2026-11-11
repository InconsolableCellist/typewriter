// Drives the word processor's mechanism host at the audio rate and publishes its snapshots, with the interface of
// AudioEngine so LocalHost and the worklet run it unchanged. The machine's voices (architecture.md 10) arrive with
// the printer on the desk; until then it renders silence and drains the acoustic events it would voice.
import { SUBSTEP_HZ } from '../sim/mechanics.js';

const SNAPSHOT_HZ = 250;
const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

export class WpAudioEngine {
  constructor(sim, sampleRate) {
    this.sim = sim;
    this.sr = sampleRate;
    this.subPerFrame = SUBSTEP_HZ / sampleRate;
    this.subAcc = 0;
    this.timeScale = 1;
    this.snap = new Float32Array(sim.layout.length);
    this.snapCount = 0;
    this.snapEvery = Math.max(1, Math.round(sampleRate / SNAPSHOT_HZ));
    this.dspLoad = 0;
    this.onSnapshot = null;       // (Float32Array, events[]) => void
    this.evtBuf = [];
  }

  setTimeScale(s) { this.timeScale = Math.max(0, Math.min(1, s)); }
  setEnabled() {}
  setPaperSpeed() {}
  loadSamples() {}

  /** Advance n audio frames (out: mono Float32Array or null). */
  process(out, n) {
    const t0 = now(), sim = this.sim, ports = sim.ports, sub = this.subPerFrame * this.timeScale;
    for (let i = 0; i < n; i++) {
      this.subAcc += sub;
      let k = this.subAcc | 0;
      this.subAcc -= k;
      while (k-- > 0) sim.step();
      ports.fill(0);
      sim.acN = 0;
      if (out) out[i] = 0;
      if (++this.snapCount >= this.snapEvery) { this.snapCount = 0; this.publish(); }
    }
    this.dspLoad = this.dspLoad * 0.95 + ((now() - t0) / ((n * 1000) / this.sr)) * 0.05;
    return out;
  }

  publish() {
    const sim = this.sim;
    sim.writeSnapshot(this.snap);
    this.snap[sim.layout.dspLoad] = this.dspLoad;
    this.evtBuf.length = 0;
    sim.drainEvents(this.evtBuf);
    if (this.onSnapshot) this.onSnapshot(this.snap, this.evtBuf);
  }
}
