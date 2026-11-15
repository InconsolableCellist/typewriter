// G.711 mu-law companding, the North American exchange codec: 8-bit codes at 8 kHz (decision 5). The coder is the
// standard segment coder (bias 132, eight segments of sixteen steps, code word inverted on the line) [M; the algorithm
// is well known, and tests check its properties: monotonic, odd-symmetric, decode(encode(x)) within half a step].
// Line floats are scaled so 1.0 = 32124, the largest decoded magnitude on the 16-bit scale (levels.js).
//
// Tables allocated once at module load; encoding is a lookup on a 14-bit index.

const BIAS = 0x84;
const CLIP = 32635;
export const ULAW_MAX = 32124;

export function ulawEncode16(sample) {
  let sign = 0;
  if (sample < 0) { sign = 0x80; sample = -sample; }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

export function ulawDecode16(code) {
  code = ~code & 0xff;
  const sign = code & 0x80, exponent = (code >> 4) & 7, mantissa = code & 0x0f;
  const s = (((mantissa << 3) + BIAS) << exponent) - BIAS;
  return sign ? -s : s;
}

/** Decoded value of each code, as a line float. */
export const ULAW_DECODE = new Float32Array(256);
for (let c = 0; c < 256; c++) ULAW_DECODE[c] = ulawDecode16(c) / ULAW_MAX;

// Encoder table on the 16-bit value / 4 (the two low bits never change the code).
const ENC = new Uint8Array(1 << 14);
for (let i = 0; i < (1 << 14); i++) ENC[i] = ulawEncode16((i - 8192) * 4 + 2);

/** mu-law code of a line float. */
export function ulawEncode(x) {
  let i = Math.floor(x * ULAW_MAX * 0.25) + 8192;
  if (i < 0) i = 0; else if (i > 16383) i = 16383;
  return ENC[i];
}

export const ulawDecode = (code) => ULAW_DECODE[code & 0xff];

/** Encode and decode in place: the quantising noise of one pass through the exchange. */
export function ulawCompand(buf, offset = 0, n = buf.length - offset) {
  for (let i = offset, e = offset + n; i < e; i++) buf[i] = ULAW_DECODE[ulawEncode(buf[i])];
  return buf;
}

// ── A-law (G.711, the European law), for tone plans that use it (tones.js TONE_PLANS, plan P7) [M: the standard
// segment coder with even-bit inversion 0x55]. Floats scaled so 1.0 = 32256, A-law's largest decoded magnitude.

export const ALAW_MAX = 32256;
const SEG_END = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];

export function alawEncode16(pcm16) {
  let pcm = pcm16 >> 3, mask;
  if (pcm >= 0) mask = 0xd5; else { mask = 0x55; pcm = -pcm - 1; }
  let seg = 0;
  while (seg < 8 && pcm > SEG_END[seg]) seg++;
  if (seg >= 8) return 0x7f ^ mask;
  let aval = seg << 4;
  aval |= seg < 2 ? (pcm >> 1) & 0x0f : (pcm >> seg) & 0x0f;
  return aval ^ mask;
}

export function alawDecode16(a) {
  a ^= 0x55;
  let t = (a & 0x0f) << 4;
  const seg = (a & 0x70) >> 4;
  if (seg === 0) t += 8; else if (seg === 1) t += 0x108; else { t += 0x108; t <<= seg - 1; }
  return a & 0x80 ? t : -t;
}

export const ALAW_DECODE = new Float32Array(256);
for (let c = 0; c < 256; c++) ALAW_DECODE[c] = alawDecode16(c) / ALAW_MAX;
const AENC = new Uint8Array(1 << 14);
for (let i = 0; i < (1 << 14); i++) AENC[i] = alawEncode16((i - 8192) * 4 + 2);

export function alawEncode(x) {
  let i = Math.floor(x * ALAW_MAX * 0.25) + 8192;
  if (i < 0) i = 0; else if (i > 16383) i = 16383;
  return AENC[i];
}

/** One codec pass by law: 'ulaw' or 'alaw'. Returns a function x -> quantised x. */
export function compander(law) {
  if (law === 'alaw') return (x) => ALAW_DECODE[alawEncode(x)];
  if (law === 'ulaw') return (x) => ULAW_DECODE[ulawEncode(x)];
  return null;
}
