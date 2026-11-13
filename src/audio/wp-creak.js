// The display's plastic bearing creaking as it is turned (tilt and swivel): a short run of stick-slip clicks through
// the resonances of the moulded shell, made on the main thread with Web Audio like the key sounds. Synthesised: the
// owner's recordings have no turning of the display. Levels are placeholders, under a key press.
export class CreakVoice {
  constructor() { this.ctx = null; this.out = null; }

  attach(ctx) {
    if (this.ctx || !ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.22;
    this.out.connect(ctx.destination);
  }

  /** strength 0..1; speed rad/s (a faster turn: a shorter, brighter creak). */
  play(strength, speed = 0) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const sr = ctx.sampleRate, dur = 0.05 + 0.14 * strength * (1 - Math.min(0.6, speed));
    const n = Math.round(sr * dur), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    // Stick-slip impulses at a wandering rate (a creak's pitch), each a small decaying click; a noise breath under them.
    let t = 0, rate = 70 + 160 * Math.random() + 120 * Math.min(1, speed);
    while (t < n) {
      const amp = (0.4 + 0.6 * Math.random()) * Math.sin(Math.PI * t / n);
      const len = Math.round(sr * 0.0012);
      for (let i = 0; i < len && t + i < n; i++) d[t + i] += amp * Math.exp(-i / (sr * 0.0003)) * (i % 2 ? -1 : 1);
      rate *= 0.97 + 0.08 * Math.random();
      t += Math.max(4, Math.round(sr / rate));
    }
    for (let i = 0; i < n; i++) d[i] += 0.05 * (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    // The shell's resonances: two band-passes, a little different each time.
    const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = 700 + 500 * Math.random(); b1.Q.value = 6;
    const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = 1800 + 1400 * Math.random(); b2.Q.value = 9;
    const g1 = ctx.createGain(); g1.gain.value = 1.4;
    const g2 = ctx.createGain(); g2.gain.value = 0.9;
    const level = ctx.createGain(); level.gain.value = 0.15 + 0.85 * strength;
    src.connect(b1).connect(g1).connect(level);
    src.connect(b2).connect(g2).connect(level);
    level.connect(this.out);
    src.start();
  }

  /** The cabinet reaching a stop: a dull plastic knock. */
  knock(speed) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const sr = ctx.sampleRate, n = Math.round(sr * 0.08), buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.012));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = Math.min(1, 0.3 + speed);
    src.connect(lp).connect(g).connect(this.out);
    src.start();
  }
}
