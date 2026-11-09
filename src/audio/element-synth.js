// Synthesised voices of the electric single-element machine. No recordings of this machine exist, so the motor,
// clutch, ball-settle and carrier-return sounds are made here from what the mechanism is doing: a few oscillators locked to
// the rotor speed, and damped sine pings fired by the mechanism's events. Ball strikes stay on the recorded strike samples.
// All deterministic tones and ringing modes; nothing here is noise-based.
import { AC } from '../sim/ports.js';

const VOICES = 24;
const TAU = 2 * Math.PI;
// Partial multiples of rotor speed, with levels chosen to sit in the body's mid-range: quiet and steady.
const PARTIALS = [
  { r: 1, a: 0.20 }, { r: 2, a: 0.90 }, { r: 3, a: 0.22 }, { r: 4, a: 0.28 },
  { r: 7, a: 0.16 }, { r: 8, a: 0.05 }, { r: 14, a: 0.05 },
];
const HUM_LEVEL = 0.0035;                  // overall level of the running motor (roughly -49 dBFS)
const MAGNET_F = 120;                      // twice line frequency; beats slowly against the rotor partial

export class ElementSynth {
  constructor(sim, sampleRate) {
    this.sim = sim; this.sr = sampleRate;
    this.dt = 1 / sampleRate;
    this.phase = new Float64Array(PARTIALS.length);
    this.gain = 0;
    this.magnetPhase = 0;
    this.smooth = 1 - Math.exp(-60 / sampleRate);
    this.vFreq = new Float64Array(VOICES); this.vPhase = new Float64Array(VOICES);
    this.vAmp = new Float64Array(VOICES); this.vDec = new Float64Array(VOICES); this.vUsed = new Uint8Array(VOICES);
    this.vNext = 0;
    this.retPhase = 0; this.retPhase2 = 0; this.retLevel = 0;
    this.wRated = sim.m.element.motor.ratedOmega;
  }

  ping(freqs, amp, tau) {
    for (let i = 0; i < freqs.length; i++) {
      const v = this.vNext; this.vNext = (v + 1) % VOICES;
      this.vFreq[v] = freqs[i]; this.vPhase[v] = 0; this.vAmp[v] = amp * (i === 0 ? 1 : 0.55 / (i + 1));
      this.vDec[v] = Math.exp(-1 / (tau * (1 - 0.15 * i) * this.sr));
      this.vUsed[v] = 1;
    }
  }

  fire(type, a, b) {
    switch (type) {
      case AC.CLUTCH:
        if (a === 2) this.ping([280, 860, 2100], 0.06, 0.014);          // shift clutch
        else if (a === 3) this.ping([620, 1680], 0.018 + 0.0006 * Math.min(b, 120), 0.006);   // latch catching the tang
        else if (a === 4) this.ping([340, 1120], 0.05, 0.012);          // return or tab latch letting go
        else this.ping([240, 720, 1900], 0.05, 0.012);                  // cycle or op clutch tripping
        break;
      case AC.SETTLE:
        if (a === 1) this.ping([1750, 3900], 0.006 + 0.0002 * Math.min(b, 40), 0.004);        // detent pawl seats the ball
        else if (a === 2) this.ping([310, 1050], 0.05, 0.012);          // shift cam stops
        else this.ping([170, 560], 0.022, 0.012);                       // cycle shaft stops
        break;
      case AC.KEY_BOTTOM:
        if (b > 0.03) this.ping([880, 2400], Math.min(0.012, 0.03 * b), 0.004);
        break;
      default: break;
    }
  }

  tick() {
    const a = this.sim.action, ws = a.motorW;
    const speed = ws / this.wRated;
    const target = (a.motorOn || speed > 0.02) ? Math.min(1.1, speed * speed) : 0;
    this.gain += (target - this.gain) * this.smooth;
    const f0 = ws / TAU;
    let y = 0;
    if (this.gain > 1e-5) {
      const g = this.gain;
      for (let i = 0; i < PARTIALS.length; i++) {
        const p = PARTIALS[i];
        this.phase[i] = (this.phase[i] + TAU * p.r * f0 * this.dt) % TAU;
        y += p.a * Math.sin(this.phase[i]);
      }
      // Magnetic hum at twice line frequency only while powered; its beat against 2 x rotor speed is the slip.
      if (a.motorOn) {
        this.magnetPhase = (this.magnetPhase + TAU * MAGNET_F * this.dt) % TAU;
        y += 0.5 * Math.min(1, speed) * Math.sin(this.magnetPhase);
      }
      y *= HUM_LEVEL * g;
    } else { this.gain = 0; }
    // Carrier return: the tape drum whirr, a tone and its second harmonic locked to carrier speed.
    const sim = this.sim, retV = a.returnLatched ? Math.min(1.4, Math.max(0, -sim.qV)) : 0;
    this.retLevel += (retV - this.retLevel) * this.smooth * 0.8;
    if (this.retLevel > 1e-3) {
      const f = 210 + 620 * this.retLevel;
      this.retPhase = (this.retPhase + TAU * f * this.dt) % TAU;
      this.retPhase2 = (this.retPhase2 + TAU * 2.51 * f * this.dt) % TAU;
      y += this.retLevel * (0.012 * Math.sin(this.retPhase) + 0.005 * Math.sin(this.retPhase2));
    }
    for (let v = 0; v < VOICES; v++) {
      if (!this.vUsed[v]) continue;
      const amp = this.vAmp[v];
      if (amp < 1e-6) { this.vUsed[v] = 0; continue; }
      this.vPhase[v] = (this.vPhase[v] + TAU * this.vFreq[v] * this.dt) % TAU;
      y += amp * Math.sin(this.vPhase[v]);
      this.vAmp[v] = amp * this.vDec[v];
    }
    return y;
  }
}
