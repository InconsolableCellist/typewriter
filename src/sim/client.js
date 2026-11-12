// SimClient: the contract between the mechanism and everything else. A LocalHost runs the same
// MechanicalSim on the main thread until audio is unlocked by a gesture (and in tests); after
// unlockAudio the worklet carries on from the same mechanical state, sample accurate from then on.
import { SUBSTEP_HZ } from './mechanics.js';
import { createMechanism, createAudioEngine } from './host-factory.js';
import { makeLayout } from './layout.js';
import { loadSamples } from '../audio/samples.js';

const WORKLET_NAME = 'typewriter-sim';
const HANDOVER_MIN_GAP_MS = 90;   // closest two replayed keystrokes may fall: the carriage must have stepped between them

/** Strikes, device events (replies from a word processor's devices) and everything else go to their own listeners. */
const channel = (e) => (e.type === 'strike' ? 'strike' : e.type === 'device' ? 'device' : 'event');

class Emitter {
  constructor() { this.handlers = new Map(); }
  on(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); return () => this.handlers.get(name).delete(fn); }
  emit(name, e) { this.handlers.get(name)?.forEach((fn) => fn(e)); }
}

/** Runs MechanicalSim synchronously. `advance` steps it; in the browser a timer calls advance on real time. */
export class LocalHost extends Emitter {
  /** options: anything else the machine's mechanism host takes at construction (the word processor's `drives`). */
  constructor({ machine, geometry, glyphs, autoRun = true, options = {} }) {
    super();
    this.sim = createMechanism({ ...options, machine, geometry, glyphs });
    this.layout = this.sim.layout;
    this.state = new Float32Array(this.layout.length);
    this.engine = createAudioEngine(this.sim, 48000);
    this.engine.setEnabled(false);
    this.engine.onSnapshot = (snap, events) => {
      this.state.set(snap);
      for (const e of events) this.deliver(e);
    };
    this.engine.publish();
    this.timeScale = 1;
    this.simTime = 0; // advanced seconds
    this.timer = null;
    this.last = null;
    this.acc = 0;
    if (autoRun && typeof performance !== 'undefined') this.startClock();
  }

  deliver(e) { this.emit(channel(e), e); }

  /** Advance the simulation by `seconds` of simulated time, in audio blocks (renders silently). */
  advance(seconds) {
    const blocks = Math.ceil((seconds * 48000) / 128);
    for (let i = 0; i < blocks; i++) this.engine.process(null, 128);
    this.simTime += (blocks * 128) / 48000;
  }

  startClock() {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const t = performance.now();
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      const t0 = performance.now();
      const blocks = Math.ceil((dt * 48000) / 128);
      for (let i = 0; i < blocks; i++) {
        this.engine.process(null, 128);
        if (performance.now() - t0 > 12) break; // keep the main thread responsive; sim falls behind
      }
    }, 8);
  }

  stopClock() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  pressKey(k, f, d, g) { this.sim.pressKey(k, f, d, g); }
  flickBell() { this.sim.flickBell(); }
  command(msg) { this.sim.command?.(msg); }
  grabRaw(dof, index, opts) { return this.sim.grab(dof, index, opts); }
  moveGrab(g, target) { this.sim.moveGrab(g, target); }
  releaseRaw(g) { this.sim.release(g); }
  setEnv(e) { this.sim.setEnv(e); }
  setParam(p, v) { return this.sim.setParam(p, v); }
  setTimeScale(s) { this.engine.setTimeScale(s); }
  setAudioEnabled() {}
  setPaperSpeed() {}
  exportState() { return this.sim.exportState(); }
  shutdown() { this.stopClock(); }
}

class WorkletHost extends Emitter {
  constructor(node, layout) {
    super();
    this.node = node;
    this.layout = layout;
    this.state = new Float32Array(layout.length);
    this.grabIds = 0;
    this.pending = new Map();
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 's') {
        this.state.set(m.snap);
        if (m.ev) for (const ev of m.ev) this.emit(channel(ev), ev);
        node.port.postMessage({ c: 'ret', buf: m.snap.buffer }, [m.snap.buffer]);
      } else if (m.t === 'ready') {
        this.sampleRate = m.sampleRate;
        this.pending.get('ready')?.();
      } else if (m.t === 'state') {
        this.pending.get('state' + m.reqId)?.(m.state);
      }
    };
  }

  whenReady() { return new Promise((resolve) => this.pending.set('ready', resolve)); }
  post(c, extra = {}) { this.node.port.postMessage({ c, ...extra }); }
  pressKey(k, f, d, g) { this.post('pressKey', { k, f, d, g }); }
  flickBell() { this.post('flickBell'); }
  command(msg) { this.post('dev', { msg }); }
  grabRaw(dof, index, opts) { const id = ++this.grabIds; this.post('grab', { id, dof, index, opts }); return id; }
  moveGrab(g, target) { this.post('moveGrab', { id: g, target }); }
  releaseRaw(g) { this.post('release', { id: g }); }
  setEnv(env) { this.post('setEnv', { env }); }
  setParam(path, value) { this.post('setParam', { path, value }); return true; }
  setTimeScale(s) { this.post('setTimeScale', { s }); }
  setAudioEnabled(b) { this.post('setAudioEnabled', { b }); }
  setPaperSpeed(v) { this.post('paper', { v }); }
  loadSamples(pcm, manifest) { this.node.port.postMessage({ c: 'samples', pcm, manifest }, [pcm.buffer]); }
  shutdown() {}
}

/** The public client. Survives the handover from LocalHost to the worklet. */
class SimClient {
  constructor({ machine, geometry, glyphs, host }) {
    this.machine = machine; this.geometry = geometry; this.glyphs = glyphs;
    this.host = host;
    this.layout = host.layout;
    this.grabs = new Map();    // client grab id -> { dof, index, opts }
    this.nextGrab = 1;
    this.listeners = new Map();
    this.timeScale = 1;
    this.audioEnabled = true;
    this.bind(host);
  }

  get state() { return this.host.state; }

  bind(host) {
    host.on('strike', (e) => this.emitLocal('strike', e));
    host.on('event', (e) => this.emitLocal('event', e));
    host.on('device', (e) => this.emitLocal('device', e));
  }

  emitLocal(name, e) { this.listeners.get(name)?.forEach((fn) => fn(e)); }
  on(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); return this; }

  // Between exporting the state and the worklet taking over, input waits and is replayed on the new host with the
  // gaps it was typed at. Fired together, a run of keystrokes would all land on one column.
  later(fn) {
    const now = performance.now();
    if (this.handover) { this.handover.push({ at: now, fn }); return; }
    if (now < (this.replayEnd ?? 0)) {
      setTimeout(fn, this.replayEnd - now);
      this.replayEnd += HANDOVER_MIN_GAP_MS;
      return;
    }
    fn();
  }

  replayHandover() {
    const queued = this.handover, t0 = this.handoverT0;
    this.handover = null;
    let last = -HANDOVER_MIN_GAP_MS;
    for (const { at, fn } of queued) {
      last = Math.max(at - t0, last + HANDOVER_MIN_GAP_MS);
      setTimeout(fn, last);
    }
    if (queued.length) this.replayEnd = performance.now() + last + HANDOVER_MIN_GAP_MS;
  }

  pressKey(k, f, d, g) { this.later(() => this.host.pressKey(k, f, d, g)); }
  /** Device commands to a mechanism host with devices (the word processor's printer); nothing on the typewriters. */
  command(msg) { this.later(() => this.host.command(msg)); }
  flickBell() { this.later(() => this.host.flickBell?.()); }

  grab(dof, index = 0, opts = {}) {
    const g = this.nextGrab++;
    this.grabs.set(g, { dof, index, opts: { ...opts }, raw: this.host.grabRaw(dof, index, opts) });
    return g;
  }

  moveGrab(g, target) {
    const rec = this.grabs.get(g);
    if (!rec) return;
    rec.opts.target = target;
    this.host.moveGrab(rec.raw, target);
  }

  release(g) {
    const rec = this.grabs.get(g);
    if (!rec) return;
    this.host.releaseRaw(rec.raw);
    this.grabs.delete(g);
  }

  setEnv(e) { this.host.setEnv(e); }
  setParam(p, v) { return this.host.setParam(p, v); }
  setTimeScale(s) { this.timeScale = s; this.host.setTimeScale(s); }
  setAudioEnabled(b) { this.audioEnabled = b; this.host.setAudioEnabled(b); }
  setPaperSpeed(v) { this.paperSpeed = v; this.host.setPaperSpeed(v); }

  /** Hand the mechanism over to the audio thread, keeping state and active grabs. */
  async unlockAudio(audioContext) {
    if (this.host instanceof WorkletHost) return this;
    this.unlocking = true;   // presses made during the handover reach only the old host, so the terminal driver holds off
    if (audioContext.state === 'suspended') await audioContext.resume();
    const { default: url } = await import('../audio/worklet.js?worker&url');
    await audioContext.audioWorklet.addModule(url);
    this.host.stopClock?.();   // the old host must not run on past the state it hands over, or early strikes double
    this.handover = []; this.handoverT0 = performance.now();
    const state = this.host.exportState();
    const glyphs = this.glyphs ? { N: this.glyphs.N, texelMm: this.glyphs.texelMm, chars: this.glyphs.chars, data: this.glyphs.data } : null;
    const node = new AudioWorkletNode(audioContext, WORKLET_NAME, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { machine: this.machine, geometry: this.geometry, glyphs, state },
    });
    node.connect(audioContext.destination);
    const host = new WorkletHost(node, this.layout);
    const ready = host.whenReady();
    host.state.set(this.host.state);
    this.bind(host);
    await ready;
    this.host.shutdown();
    this.host = host;
    // Re-establish hand grabs on the new host and restore settings
    for (const rec of this.grabs.values()) rec.raw = this.host.grabRaw(rec.dof, rec.index, rec.opts);
    this.host.setTimeScale(this.timeScale);
    this.host.setAudioEnabled(this.audioEnabled);
    this.node = node;
    this.replayHandover();
    this.unlocking = false;
    // Recorded samples arrive asynchronously; until then the modal body is the only voice.
    loadSamples(audioContext, (pcm, manifest) => host.loadSamples(pcm, manifest), this.machine.audio?.samples ?? null);
    return this;
  }

  /** Test hook: advance a LocalHost synchronously. No-op on the worklet (it runs on the audio clock). */
  advance(seconds) { this.host.advance?.(seconds); }
}

export async function createSimClient({ machine, geometry, glyphs, audioContext, autoRun, options } = {}) {
  const host = new LocalHost({ machine, geometry, glyphs, options, autoRun: autoRun ?? (typeof window !== 'undefined') });
  const client = new SimClient({ machine, geometry, glyphs, host });
  // Before a user gesture a context is suspended and resume() would never settle: stay local, the UI
  // calls unlockAudio() from its first gesture.
  if (audioContext && audioContext.state === 'running') await client.unlockAudio(audioContext);
  return client;
}

export { SUBSTEP_HZ, makeLayout };
