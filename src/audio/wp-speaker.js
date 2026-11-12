// The keyboard's small speaker (architecture 5.4, 10.4): a 0.5 ms click after each accepted keystroke and a gated
// square-wave tone for the beeps, through a small cone's band-pass. Web Audio on the main thread until the word
// processor's audio engine runs in the worklet.
const TONE_HZ = 960;      // the beep in the owner's recording; the manual's 1 kHz (HW 2.3) is nominal

export class WpSpeaker {
  constructor() { this.ctx = null; }

  /** Call from a user gesture: browsers start audio only then. */
  unlock() {
    if (this.ctx) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;
      // A 40 mm cone in a plastic case: little below 600 Hz, a resonance near 2.9 kHz and a dip near 4.8 kHz, rolling
      // off above 6 kHz. The resonance and the dip are fitted to the beep in the owner's recording (architecture 10.4):
      // its third harmonic 6.5 dB under the fundamental (a square wave's is 9.5 dB), its fifth 34 dB under (14 dB).
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
      const peak = ctx.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 2900; peak.Q.value = 2; peak.gain.value = 4;
      const dip = ctx.createBiquadFilter(); dip.type = 'peaking'; dip.frequency.value = 4800; dip.Q.value = 3; dip.gain.value = -20;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      // Level: the beep's RMS 17.5 dB over the idle machine's, which the worklet plays at -50 dBFS.
      this.out = ctx.createGain(); this.out.gain.value = 0.072;
      hp.connect(peak).connect(dip).connect(lp).connect(this.out).connect(ctx.destination);
      this.input = hp;
      const n = Math.round(ctx.sampleRate * 0.004), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      const pulse = Math.round(ctx.sampleRate * 0.0005);
      for (let i = 0; i < n; i++) d[i] = i < pulse ? 1 : -0.6 * Math.exp(-(i - pulse) / (ctx.sampleRate * 0.0006));
      this.clickBuf = buf;
      ctx.resume();
    } catch (e) { console.warn('no audio', e); }
  }

  click() {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.clickBuf; s.connect(this.input); s.start();
  }

  tone(ms) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = 'square'; o.frequency.value = TONE_HZ;
    g.gain.setValueAtTime(0.35, t); g.gain.setValueAtTime(0, t + ms / 1000);
    o.connect(g).connect(this.input); o.start(t); o.stop(t + ms / 1000 + 0.01);
  }
}
