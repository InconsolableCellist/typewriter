// A voice-band placeholder for the person who answers by telephone: no recording and no text-to-speech, but a
// synthesised two-syllable "hel-lo?" (a glottal buzz through two moving formants, the pitch rising at the end as a
// question does), at the line rate. Enough to tell a voice from a machine on the line. Pure.

import { LINE_RATE } from '../line/levels.js';

/** Syllables as [seconds, f0 start, f0 end, F1, F2, level]; a short gap between them. */
const HELLO = [
  [0.16, 150, 165, 480, 1900, 0.8],   // "heh"
  [0.04, 0, 0, 0, 0, 0],              // the l's closure
  [0.32, 160, 230, 520, 900, 1.0],    // "lo?" rising
];
const PHRASES = {
  'hello?': HELLO,
  'hello? anyone there?': [...HELLO, [0.25, 0, 0, 0, 0, 0], [0.18, 170, 160, 650, 1200, 0.8], [0.14, 160, 150, 400, 2200, 0.7], [0.3, 160, 210, 500, 1700, 0.9]],
};

/** Samples (Float32Array at `rate`) of a short phrase; unknown phrases sound like "hello?". */
export function voiceSamples(text = 'hello?', { rate = LINE_RATE, level = 0.25 } = {}) {
  const segs = PHRASES[String(text).toLowerCase()] ?? HELLO;
  const total = segs.reduce((s, x) => s + x[0], 0);
  const out = new Float32Array(Math.ceil(total * rate));
  let n = 0, phase = 0;
  // Two resonators (formants) per sample, coefficients set per segment.
  let y1a = 0, y2a = 0, y1b = 0, y2b = 0;
  for (const [dur, f0a, f0b, F1, F2, amp] of segs) {
    const len = Math.round(dur * rate);
    const res = (f, bw) => { const r = Math.exp(-Math.PI * bw / rate); return [2 * r * Math.cos(2 * Math.PI * f / rate), -r * r]; };
    const [a1, a2] = F1 ? res(F1, 90) : [0, 0];
    const [b1, b2] = F2 ? res(F2, 120) : [0, 0];
    for (let i = 0; i < len && n < out.length; i++, n++) {
      if (!amp) { out[n] = 0; continue; }
      const f0 = f0a + ((f0b - f0a) * i) / len;
      phase += f0 / rate;
      const pulse = phase >= 1 ? (phase -= 1, 1) : 0;
      const env = Math.min(1, i / (0.02 * rate), (len - i) / (0.03 * rate));
      const xa = pulse + a1 * y1a + a2 * y2a; y2a = y1a; y1a = xa;
      const xb = pulse + b1 * y1b + b2 * y2b; y2b = y1b; y1b = xb;
      out[n] = level * amp * env * (0.06 * xa + 0.03 * xb);
    }
  }
  return out;
}
