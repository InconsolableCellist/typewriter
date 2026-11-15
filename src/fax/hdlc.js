// HDLC framing as ITU-T T.30 uses it on the V.21 channel 2 control link (T.30 section 5.3, which takes the frame
// structure from ISO/IEC 3309; [M] = from memory of the Recommendation, the text could not be fetched here).
//
//   flag 0x7E | address 0xFF | control 0x03 or 0x13 | FCF | FIF ... | FCS (16 bits) | flag 0x7E
//
// - Octets go on the line least significant bit first [M].
// - Zero insertion: after five consecutive 1s inside a frame the transmitter inserts a 0, the receiver removes it.
// - The frame check sequence is the ITU-T CRC-16 (x^16 + x^12 + x^5 + 1), register preset to all ones, the ones
//   complement of the remainder sent, low octet first. Check value of the ASCII string "123456789" is 0x906E.
// - Seven or more consecutive 1s abort a frame; the receiver then hunts for a flag.
// - T.30 starts every V.21 transmission with 1 s +-15 % of flags (the preamble) [M]; frames are separated by at least
//   one flag and the transmission ends with a flag after the last frame's FCS.
//
// Bits here are Uint8Arrays of 0/1, one element a bit, in line order. Pure: no DOM, timers or clock.

export const FLAG = 0x7e;
export const ADDRESS = 0xff;                    // "all stations", the only address T.30 uses on the PSTN [M]
export const CONTROL = 0x03;                    // 1100 0000 in line order: not the last frame of the transmission
export const CONTROL_FINAL = 0x13;              // 1100 1000: the final frame (P/F bit set) [M]
export const V21_BIT_RATE = 300;
/** Preamble: 1 s of flags at 300 bit/s is 37.5 flags; 38 is 1.013 s, inside the +-15 % tolerance [M]. */
export const PREAMBLE_FLAGS = 38;

const FLAG_BITS = [0, 1, 1, 1, 1, 1, 1, 0];     // 0x7E least significant bit first (symmetric anyway)

/** CRC-16/X.25 (ITU-T V.42 / HDLC): reflected polynomial 0x8408, preset 0xFFFF, result inverted. */
export function crc16(bytes, start = 0, end = bytes.length) {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return (crc ^ 0xffff) & 0xffff;
}

/** The frame with its FCS appended, low octet first. */
export function appendFcs(bytes) {
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes);
  const fcs = crc16(bytes);
  out[bytes.length] = fcs & 0xff;
  out[bytes.length + 1] = fcs >>> 8;
  return out;
}

/** True when the last two octets are the FCS of the rest. */
export function checkFcs(bytesWithFcs) {
  const n = bytesWithFcs.length;
  if (n < 3) return false;
  const fcs = crc16(bytesWithFcs, 0, n - 2);
  return bytesWithFcs[n - 2] === (fcs & 0xff) && bytesWithFcs[n - 1] === fcs >>> 8;
}

/** Pushes the bits of `bytes` (LSB first) onto `out`, inserting a 0 after every run of five 1s. Returns `out`. */
export function stuffBits(bytes, out = []) {
  let ones = 0;
  for (let i = 0; i < bytes.length; i++) {
    for (let k = 0; k < 8; k++) {
      const b = (bytes[i] >>> k) & 1;
      out.push(b);
      if (b) {
        if (++ones === 5) { out.push(0); ones = 0; }
      } else ones = 0;
    }
  }
  return out;
}

/** Inverse of stuffBits for a frame body without flags: drops the 0 after five 1s; null on six 1s or ragged length. */
export function unstuffBits(bits) {
  const out = [];
  let ones = 0;
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i];
    if (ones === 5) {
      if (b) return null;
      ones = 0;
      continue;
    }
    out.push(b);
    ones = b ? ones + 1 : 0;
  }
  if (out.length % 8) return null;
  const bytes = new Uint8Array(out.length / 8);
  for (let i = 0; i < out.length; i++) bytes[i >> 3] |= out[i] << (i & 7);
  return bytes;
}

/**
 * The line bits of one V.21 transmission: `preambleFlags` flags, then each frame (address, control, FCF, FIF and
 * FCS, stuffed) followed by `gapFlags` flags; the last frame is followed by `closingFlags` flags. `frames` are the
 * octets without FCS. Returns { bits, frameSpans: [[startBit, endBit], ...] } (spans exclude the flags).
 */
export function encodeHdlc(frames, { preambleFlags = PREAMBLE_FLAGS, gapFlags = 1, closingFlags = 1 } = {}) {
  const out = [];
  const spans = [];
  for (let i = 0; i < preambleFlags; i++) out.push(...FLAG_BITS);
  frames.forEach((f, idx) => {
    const s = out.length;
    stuffBits(appendFcs(f), out);
    spans.push([s, out.length]);
    const n = idx === frames.length - 1 ? closingFlags : gapFlags;
    for (let i = 0; i < n; i++) out.push(...FLAG_BITS);
  });
  return { bits: Uint8Array.from(out), frameSpans: spans };
}

/**
 * A streaming HDLC receiver. Push bits in any chunking; it returns the frames that closed on those bits as
 * { bytes, ok, reason, bitIndex }:
 *   ok true:  bytes is address .. FIF (FCS removed and verified);
 *   ok false: reason 'fcs' (FCS mismatch, bytes still given without the FCS), 'align' (not a whole number of
 *             octets), or 'short' (fewer than address, control, FCF and FCS). Aborts and over-long frames are
 *             counted in `stats`, not returned.
 * Bit errors never wedge it: a frame broken by errors fails its FCS or alignment and the receiver resynchronises on
 * the next flag. The bit buffer is allocated once.
 */
export class HdlcDecoder {
  constructor({ maxBytes = 260 } = {}) {
    this.maxBits = (maxBytes + 2) * 8 + 8;
    this.buf = new Uint8Array(this.maxBits + 8);
    this.stats = { flags: 0, frames: 0, good: 0, fcsErrors: 0, otherErrors: 0, aborts: 0 };
    this.reset();
  }

  reset() {
    this.len = 0;        // unstuffed bits since the last flag
    this.ones = 0;       // consecutive 1s seen on the line
    this.synced = false; // a flag has been seen since the last abort
    this.bitIndex = 0;   // bits pushed in total
    this.flagRun = 0;    // flags in a row (preamble length)
  }

  push(bit, out = []) {
    this.bitIndex++;
    if (bit) {
      this.ones++;
      if (this.ones === 7) {          // abort (or idle ones): drop whatever was being received
        if (this.synced && this.len > 8) this.stats.aborts++;
        this.synced = false;
        this.len = 0;
        this.flagRun = 0;
      }
      if (this.ones >= 7) return out;
      this._append(1);
      return out;
    }
    // A zero.
    const ones = this.ones;
    this.ones = 0;
    if (ones === 5) return out;       // stuffed zero
    if (ones === 6) {                 // a flag: the last seven buffered bits were its 0111111
      this.stats.flags++;
      const n = this.len - 7;
      if (this.synced && n > 0) { this._close(n, out); this.flagRun = 1; }
      else this.flagRun++;
      this.synced = true;
      this.len = 0;
      return out;
    }
    this._append(0);
    return out;
  }

  pushBits(bits, out = []) {
    for (let i = 0; i < bits.length; i++) this.push(bits[i], out);
    return out;
  }

  _append(b) {
    if (this.len >= this.maxBits + 7) { // too long for a T.30 frame: give up until the next flag
      if (this.synced) this.stats.otherErrors++;
      this.synced = false;
      this.len = 0;
      return;
    }
    this.buf[this.len++] = b;
  }

  _close(n, out) {
    this.stats.frames++;
    const at = this.bitIndex;
    if (n % 8) { this.stats.otherErrors++; out.push({ bytes: null, ok: false, reason: 'align', bitIndex: at }); return; }
    const all = new Uint8Array(n / 8);
    for (let i = 0; i < n; i++) all[i >> 3] |= this.buf[i] << (i & 7);
    if (all.length < 5) { this.stats.otherErrors++; out.push({ bytes: null, ok: false, reason: 'short', bitIndex: at }); return; }
    const ok = checkFcs(all);
    const bytes = all.subarray(0, all.length - 2);
    if (ok) this.stats.good++;
    else this.stats.fcsErrors++;
    out.push({ bytes, ok, reason: ok ? null : 'fcs', bitIndex: at });
  }
}

/** Convenience: decode a whole transmission's bits into frames. */
export function decodeHdlc(bits) {
  return new HdlcDecoder().pushBits(bits);
}
