// Couples the mechanical simulation to the acoustic model at the audio rate. Used by the AudioWorklet
// and by Node tools; the worklet and LocalHost both drive a MechanicalSim through the same code path so
// the sound is a pure function of the contact forces.
import { ModalBody } from './modal.js';
import { RadiationFilter, Room, Limiter } from './room.js';
import { SUBSTEP_HZ } from '../sim/mechanics.js';
import { MASTER_CAL } from './measured_body.js';
import { PORT } from '../sim/ports.js';
import { Sampler } from './sampler.js';
import { ElementSynth } from './element-synth.js';

const MASTER = MASTER_CAL; // recording units to full scale, calibrated by tools/audio (see SOURCES.md)
const SNAPSHOT_HZ = 250;
const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

export class AudioEngine {
  constructor(sim, sampleRate) {
    this.sim = sim;
    this.sr = sampleRate;
    this.body = new ModalBody({ machine: sim.m, sampleRate, geometry: sim.g });
    this.rad = new RadiationFilter(sampleRate);
    this.room = new Room(sampleRate);
    this.limiter = new Limiter(sampleRate);
    this.sampler = new Sampler(sim, sampleRate);
    this.synth = sim.m.action?.type === 'single-element' ? new ElementSynth(sim, sampleRate) : null;
    this.sampler.synth = this.synth;
    this.subPerFrame = SUBSTEP_HZ / sampleRate;
    this.subAcc = 0;
    this.timeScale = 1;
    this.enabled = true;
    this.snap = new Float32Array(sim.layout.length);
    this.snapCount = 0;
    this.snapEvery = Math.max(1, Math.round(sampleRate / SNAPSHOT_HZ));
    this.dspLoad = 0;
    this.rms = 0;
    this.rmsAcc = 0; this.rmsN = 0;
    this.barForce = new Float64Array(sim.nPrint);
    this.onSnapshot = null;       // (Float32Array, events[]) => void
    this.evtBuf = [];
    this.gain = 1;
    this.limiterBypass = false;
    this.setMaster(1);
  }

  setMaster(g) { this.master = g * MASTER; }
  setTimeScale(s) { this.timeScale = Math.max(0, Math.min(1, s)); }
  setEnabled(b) { this.enabled = !!b; }
  setPaperSpeed(v) { this.sampler.setPaperSpeed(v); }
  /** Install the recorded samples (mono PCM at this sample rate, manifest per public/assets/audio/samples). */
  loadSamples(pcm, manifest) { this.sampler.load(pcm, manifest); this.body.setSampleMode(true); }

  /** Render n audio frames into out (mono Float32Array, may be null when audio disabled). */
  process(out, n) {
    const t0 = now();
    this.body.wander();   // slow wander of the contact conditions, once per block
    const sim = this.sim;
    const ports = sim.ports;
    const body = this.body;
    const sampler = this.sampler;
    const subPerFrame = this.subPerFrame * this.timeScale;
    const barForce = this.barForce;
    const rad = this.rad, room = this.room;
    const master = this.master;
    const enabled = this.enabled, synth = this.synth;
    for (let i = 0; i < n; i++) {
      // Advance the mechanism by the whole number of substeps owed to this sample
      this.subAcc += subPerFrame;
      let sub = this.subAcc | 0;
      this.subAcc -= sub;
      const nSub = sub;
      while (sub-- > 0) sim.step();
      // Average contact forces over the substeps of this sample (box low pass by 8)
      if (nSub > 0) {
        for (let p = 0; p < PORT.COUNT; p++) ports[p] /= nSub;
      }
      let y = 0;
      sampler.drain(sim);
      sampler.advance(sim, ports[PORT.BARBAR]);
      if (enabled) {
        y = body.tick(ports);
        // Each active bar flexes at the slug-force of the platen port share (shared SLUG, weighted):
        if (!sampler.loaded && sim.action.nActive > 0 && ports[PORT.SLUG] !== 0) {
          for (let a = 0; a < sim.action.nActive; a++) {
            const bar = sim.action.activeList[a];
            if (sim.action.inContact[bar]) {
              barForce[bar] = ports[PORT.SLUG]; body.exciteBar(bar);
              // Strike point: carriage position across the platen and which bar landed.
              body.setStrikePoint(sim.carriageX(), bar);
            }
          }
        }
        y += body.barTick(barForce);
        barForce.fill(0);
        y = rad.tick(y * master);
        y = room.tick(y);
        y += sampler.tick();    // recorded room already in the samples: not sent through the synthetic one
        if (synth) y += synth.tick();
        y = this.limiterBypass ? y : this.limiter.tick(y);
        this.rmsAcc += y * y;
      }
      this.rmsN++;
      for (let p = 0; p < PORT.COUNT; p++) ports[p] = 0;
      if (out) out[i] = y;
      if (++this.snapCount >= this.snapEvery) {
        this.snapCount = 0;
        this.publish();
      }
    }
    // Measure the load: wall time of this block divided by its duration
    const dt = now() - t0;
    const blockMs = (n * 1000) / this.sr;
    const load = dt / blockMs;
    this.dspLoad = this.dspLoad * 0.95 + load * 0.05;
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
