// AudioWorklet entry: hosts the MechanicalSim and the acoustic model on the audio thread. Bundled for
// both `vite dev` and `vite build` through the `?worker&url` import in src/sim/client.js. Everything
// runs from typed arrays; the only allocation in the audio path is the snapshot buffer pool.
import { createMechanism, createAudioEngine } from '../sim/host-factory.js';

/** Run the mechanism once on a scratch instance so the JIT has compiled the hot paths before audio starts. */
function warmUp(machine, geometry, glyphs) {
  const sim = createMechanism({ machine, geometry, glyphs });
  const eng = createAudioEngine(sim, sampleRate);
  const buf = new Float32Array(128);
  if (sim.warmUp) sim.warmUp(); else sim.pressKey(10, 28, 0.09);
  for (let i = 0; i < 180; i++) eng.process(buf, 128);
}

class TypewriterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { machine, geometry, glyphs, state } = options.processorOptions;
    this.sim = createMechanism({ machine, geometry, glyphs });
    warmUp(machine, geometry, glyphs);
    if (state) this.sim.importState(state);
    this.engine = createAudioEngine(this.sim, sampleRate);
    this.mono = new Float32Array(128);
    this.pool = [];
    this.grabs = new Map();
    this.engine.onSnapshot = (snap, events) => {
      const buf = this.pool.pop() ?? new Float32Array(snap.length);
      buf.set(snap);
      const msg = { t: 's', snap: buf };
      if (events.length) msg.ev = events.slice();
      this.port.postMessage(msg, [buf.buffer]);
    };
    this.port.onmessage = (e) => this.onCommand(e.data);
    this.port.postMessage({ t: 'ready', sampleRate });
  }

  onCommand(m) {
    const sim = this.sim;
    switch (m.c) {
      case 'pressKey': sim.pressKey(m.k, m.f, m.d, m.g); break;
      case 'flickBell': sim.flickBell(); break;
      case 'dev': sim.command?.(m.msg); break;
      case 'grab': this.grabs.set(m.id, sim.grab(m.dof, m.index, m.opts)); break;
      case 'moveGrab': { const g = this.grabs.get(m.id); if (g !== undefined) sim.moveGrab(g, m.target); break; }
      case 'release': { const g = this.grabs.get(m.id); if (g !== undefined) { sim.release(g); this.grabs.delete(m.id); } break; }
      case 'setEnv': sim.setEnv(m.env); break;
      case 'setParam': sim.setParam(m.path, m.value); break;
      case 'setTimeScale': this.engine.setTimeScale(m.s); break;
      case 'setAudioEnabled': this.engine.setEnabled(m.b); break;
      case 'paper': this.engine.setPaperSpeed(m.v); break;
      case 'samples': this.engine.loadSamples(m.pcm, m.manifest); break;
      case 'samplesStatus': this.port.postMessage({ samplesStatus: { loaded: this.engine.sampler.loaded, counts: this.engine.sampler.counts, pcmLen: this.engine.sampler.pcm?.length ?? 0, paperV: this.engine.sampler.paperV } }); break;
      case 'ret': if (m.buf) this.pool.push(new Float32Array(m.buf)); break;
      case 'export': this.port.postMessage({ t: 'state', state: sim.exportState(), reqId: m.reqId }); break;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const n = out[0]?.length ?? 128;
    if (this.mono.length !== n) this.mono = new Float32Array(n);
    this.engine.process(this.mono, n);
    for (let ch = 0; ch < out.length; ch++) out[ch].set(this.mono);
    return true;
  }
}

registerProcessor('typewriter-sim', TypewriterProcessor);
