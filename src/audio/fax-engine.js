// Drives the fax's mechanism host at the audio rate and voices it, with the interface of WpAudioEngine (wp-engine.js),
// so LocalHost and the worklet (worklet-fax.js) run it unchanged. M0 voices only (docs/fax/architecture.md 5):
// silence when the machine waits, and simple synthesised placeholders for the mechanism, each from the mechanism's own
// ports and onsets: the drive stepper's torque ripple ringing two modes of the light case, the cutter train's rasp
// and its blade, and short damped knocks for the swing gear's clack, the cut, the relays, the hook
// switch and the keys. M7 adds the line and the machine's own sounders (`sim.tap`, src/sim/fax/line-tap.js, when the host
// is the whole station): the monitor speaker on the line by the firmware's rule (dialling and handshake, muted for the
// pages) at its volume setting, the handset's earpiece while the handset is off its cradle, the electronic ringer and
// the piezo beeper. Each is read at the host's own time as it is stepped, so it is sample-aligned with the mechanism
// and the call. The levels and the small speaker's band are ASSUMED until a recording.
import { SUBSTEP_HZ } from '../sim/rate.js';
import { FAX_PORT, FAC } from '../sim/fax/ports.js';

const SNAPSHOT_HZ = 250;
const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

/** A two-pole resonator: a mode of the case struck or driven by x. */
class Mode {
  constructor(sr, hz, q) {
    const w = (2 * Math.PI * hz) / sr, r = Math.exp(-w / (2 * q));
    this.a1 = 2 * r * Math.cos(w); this.a2 = -r * r; this.g = 1 - r;
    this.y1 = 0; this.y2 = 0;
  }
  tick(x) { const y = this.a1 * this.y1 + this.a2 * this.y2 + this.g * x; this.y2 = this.y1; this.y1 = y; return y; }
}

// Levels and modes [A]: the placeholders' only tuning, until the owner's recordings (plan 10).
/** The monitor speaker's gain for volume settings 0-3, the earpiece's, the ringer's and the beeper's [A]. */
export const LINE_LEVEL = { speaker: [0, 0.35, 0.7, 1.1], earpiece: 0.3, ringer: 1, beeper: 1 };

/** A first-order band: the small speaker or the earpiece (high-pass hp Hz, low-pass lp Hz). */
class Band {
  constructor(sr, hp, lp) { this.a = Math.exp(-2 * Math.PI * hp / sr); this.b = 1 - Math.exp(-2 * Math.PI * lp / sr); this.x1 = 0; this.y1 = 0; this.z = 0; }
  tick(x) { const y = this.a * (this.y1 + x - this.x1); this.x1 = x; this.y1 = y; this.z += this.b * (y - this.z); return this.z; }
}

export const LEVEL = { motor: 900, planet: 0.25, cut: 0.5, cutterBuzz: 0.04, relay: 0.12, hook: 0.2, key: 0.08, sheet: 0.05 };
const CASE_MODES = [[740, 9], [1930, 14], [3400, 18]];       // Hz, Q of a 2.6 kg thin ABS case [A]
const KNOCK_MODES = [[2600, 6], [5200, 8]];                  // small hard contacts [A]

export class FaxAudioEngine {
  constructor(sim, sampleRate) {
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
    this.dspLoad = 0; this.rms = 0; this.rmsAcc = 0; this.rmsN = 0;
    this.onSnapshot = null;
    this.evtBuf = [];
    this.levels = { ...LEVEL };
    this.caseModes = CASE_MODES.map(([f, q]) => new Mode(sampleRate, f, q));
    this.knockModes = KNOCK_MODES.map(([f, q]) => new Mode(sampleRate, f, q));
    this.lastTe = 0; this.buzzPhase = 0; this.noise = 0x1234567;
    this.knock = 0;              // the knocks' excitation for this sample
    this.bufL = new Float32Array(128);
    this.tap = sim.tap ?? null;
    this.speakerBand = new Band(sampleRate, 350, 3800);
    this.earBand = new Band(sampleRate, 300, 3000);
    this.piezoBand = new Band(sampleRate, 600, 6000);
  }

  /** The line's listeners and the sounders at the host's time: the speaker, the earpiece, ringer and beeper. */
  lineVoice() {
    const tap = this.tap, t = this.sim.t, L = LINE_LEVEL;
    const g = L.speaker[tap.monitor] ?? 0;
    const offHook = !this.sim.liu.onCradle;
    let y = 0;
    if (g > 0 || offHook) {
      const line = tap.lineAt(t);
      if (g > 0) y += this.speakerBand.tick(line * g);
      if (offHook) y += this.earBand.tick(line * L.earpiece);
    }
    const r = tap.ringerAt(t), b = tap.beepAt(t);
    if (r !== 0 || b !== 0) y += this.piezoBand.tick(r * L.ringer + b * L.beeper);
    return y;
  }

  setTimeScale(s) { this.timeScale = Math.max(0, Math.min(1, s)); }
  setEnabled(b) { this.enabled = !!b; }
  setPaperSpeed() {}
  loadSamples() {}                // no recordings of the FO-70 yet

  /** Onsets queued by the mechanism this sample, as knocks into the small modes. */
  readOnsets() {
    const sim = this.sim, q = sim.acQ, L = this.levels;
    let k = 0;
    for (let n = 0; n < sim.acN; n++) {
      const code = q[n * 3 + 1], kind = Math.floor(code / 64), mag = Math.abs(q[n * 3 + 2]);
      switch (kind) {
        case FAC.PLANET_STOP: k += L.planet * Math.min(1, mag / 60); break;
        case FAC.CUT: k += L.cut; break;
        case FAC.CAM_HOME: k += 0.3 * L.cut * Math.min(1, mag / 20); break;
        case FAC.CUTTER_SWITCH: k += 0.2 * L.cut; break;
        case FAC.RELAY: k += L.relay * Math.min(1, mag / 0.3); break;
        case FAC.HOOK: k += L.hook * Math.min(1, mag / 0.5); break;
        case FAC.KEY: k += L.key * Math.min(1, mag / 0.2); break;
        case FAC.COVER: k += 0.6 * Math.min(1, mag / 2); break;
        case FAC.SHEET_OUT: case FAC.PICK: k += L.sheet; break;
      }
    }
    sim.acN = 0;
    return k;
  }

  /** One sample of the mechanism's voices from the ports averaged over the sample. */
  voice(knock) {
    const p = this.sim.ports, L = this.levels;
    // The stepper: its torque's change is what kicks the case each step.
    const Te = p[FAX_PORT.MOTOR];
    const dT = Te - this.lastTe; this.lastTe = Te;
    let drive = dT * L.motor;
    // The cutter: no motor of its own (the stepper drives it, service manual p.3-7), so its voice is the gear train's
    // rasp while the crank turns, with its tooth load, and the blade's shear.
    const w = p[FAX_PORT.CUTTER_SPEED], mesh = Math.abs(p[FAX_PORT.CUT_MESH]);
    if (Math.abs(w) > 0.5) {
      this.noise = (this.noise * 1664525 + 1013904223) >>> 0;
      drive += L.cutterBuzz * Math.min(1, 0.3 + mesh * 20) * (this.noise / 4294967296 - 0.5);
      drive += p[FAX_PORT.BLADE] * 0.4;
    }
    let y = 0;
    const cm = this.caseModes, km = this.knockModes;
    for (let j = 0; j < cm.length; j++) y += cm[j].tick(drive);
    for (let j = 0; j < km.length; j++) y += km[j].tick(knock);
    return y;
  }

  /** Advance n audio frames. out: left (or mono), or null to run the mechanism silently; outR: right. */
  process(out, n, outR = null) {
    const t0 = now(), sim = this.sim, ports = sim.ports, sub = this.subPerFrame * this.timeScale;
    const render = this.enabled && !!out;
    if (render && this.bufL.length < n) this.bufL = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.subAcc += sub;
      let k = this.subAcc | 0;
      this.subAcc -= k;
      const nSub = k;
      while (k-- > 0) sim.step();
      if (nSub > 1) for (let p = 0; p < FAX_PORT.COUNT; p++) ports[p] /= nSub;
      const knock = this.readOnsets();
      if (render) this.bufL[i] = this.voice(knock) + (this.tap ? this.lineVoice() : 0);
      ports.fill(0);
      if (++this.snapCount >= this.snapEvery) { this.snapCount = 0; this.publish(); }
    }
    if (render) {
      for (let i = 0; i < n; i++) {
        const x = this.bufL[i];
        const y = x / (1 + Math.abs(x));             // soft limit
        out[i] = y; if (outR) outR[i] = y;
        this.rmsAcc += y * y;
      }
      this.rmsN += n;
    } else {
      if (out) out.fill(0, 0, n);
      if (outR) outR.fill(0, 0, n);
    }
    this.dspLoad = this.dspLoad * 0.95 + ((now() - t0) / ((n * 1000) / this.sr)) * 0.05;
    return out;
  }

  publish() {
    const sim = this.sim;
    sim.writeSnapshot(this.snap);
    this.snap[sim.layout.dspLoad] = this.dspLoad;
    if (this.rmsN > 0) { this.rms = this.rms * 0.9 + Math.sqrt(this.rmsAcc / this.rmsN) * 0.1; this.rmsAcc = 0; this.rmsN = 0; }
    this.snap[sim.layout.rms] = this.rms;
    this.evtBuf.length = 0;
    sim.drainEvents(this.evtBuf);
    if (this.onSnapshot) this.onSnapshot(this.snap, this.evtBuf);
  }
}
