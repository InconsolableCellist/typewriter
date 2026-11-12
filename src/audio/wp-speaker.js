// The keyboard's small speaker (architecture 5.4): a 0.5 ms click after each accepted keystroke and a gated 1 kHz
// square-wave tone for the beeps, through a small cone's band-pass. Web Audio on the main thread until the word
// processor's audio engine runs in the worklet.
export class WpSpeaker {
  constructor() { this.ctx = null; }

  /** Call from a user gesture: browsers start audio only then. */
  unlock() {
    if (this.ctx) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = ctx;
      // A 40 mm cone in a plastic case: little below 600 Hz, a resonance near 2.5 kHz, rolling off above 6 kHz.
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
      const peak = ctx.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 2500; peak.Q.value = 2; peak.gain.value = 8;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      this.out = ctx.createGain(); this.out.gain.value = 0.25;
      hp.connect(peak).connect(lp).connect(this.out).connect(ctx.destination);
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
    o.type = 'square'; o.frequency.value = 1000;
    g.gain.setValueAtTime(0.35, t); g.gain.setValueAtTime(0, t + ms / 1000);
    o.connect(g).connect(this.input); o.start(t); o.stop(t + ms / 1000 + 0.01);
  }
}
