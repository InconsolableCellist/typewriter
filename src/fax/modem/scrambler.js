// The self-synchronising scramblers of the high-speed fax modems, and the training-pattern generators.
//
// A register holds the line bits most recent first: bit 0 is the bit sent one bit ago, bit k the bit k + 1 ago.
//
// V.29: generating polynomial 1 + x^-18 + x^-23 [M]. Out = in XOR the line bits 18 and 23 back.
// V.27ter: 1 + x^-6 + x^-7 [M], with the Recommendation's guard against repeating patterns: when the line bits have
//   matched those 8 or 11 back for 33 bits in a row, the next bit is inverted [M; the exact comparison taps of the
//   Recommendation's figure are from memory]. The descrambler mirrors the same rule on the received bits, so the
//   inversion cancels.
// V.29 training segment 3 pattern: 1 + x^-6 + x^-7 run free from the state 0101010 [M].
//
// Both directions are pure state machines on one int; nothing is allocated.

export class V29Scrambler {
  constructor() { this.reg = 0; }
  reset(state = 0) { this.reg = state & 0x7fffff; }
  scramble(bit) {
    const out = (bit ^ (this.reg >>> 17) ^ (this.reg >>> 22)) & 1;
    this.reg = ((this.reg << 1) | out) & 0x7fffff;
    return out;
  }
}

export class V29Descrambler {
  constructor() { this.reg = 0; }
  reset(state = 0) { this.reg = state & 0x7fffff; }
  descramble(bit) {
    const out = (bit ^ (this.reg >>> 17) ^ (this.reg >>> 22)) & 1;
    this.reg = ((this.reg << 1) | (bit & 1)) & 0x7fffff;
    return out;
  }
}

const V27_GUARD = 33;

export class V27terScrambler {
  constructor() { this.reg = 0; this.count = 0; }
  reset(state = 0) { this.reg = state & 0xfff; this.count = 0; }
  scramble(bit) {
    let out = (bit ^ (this.reg >>> 5) ^ (this.reg >>> 6)) & 1;
    if (this.count >= V27_GUARD) { out ^= 1; this.count = 0; }
    else if (((this.reg >>> 7) ^ out) & ((this.reg >>> 10) ^ out) & 1) this.count = 0;
    else this.count++;
    this.reg = ((this.reg << 1) | out) & 0xfff;
    return out;
  }
}

export class V27terDescrambler {
  constructor() { this.reg = 0; this.count = 0; }
  reset(state = 0) { this.reg = state & 0xfff; this.count = 0; }
  descramble(bit) {
    bit &= 1;
    let out = (bit ^ (this.reg >>> 5) ^ (this.reg >>> 6)) & 1;
    if (this.count >= V27_GUARD) { out ^= 1; this.count = 0; }
    else if (((this.reg >>> 7) ^ bit) & ((this.reg >>> 10) ^ bit) & 1) this.count = 0;
    else this.count++;
    this.reg = ((this.reg << 1) | bit) & 0xfff;
    return out;
  }
}

/** The free-running pattern generator 1 + x^-6 + x^-7 (period 127). */
export class Prbs7 {
  constructor(state = 0b0101010) { this.reg = state & 0x7f; }
  next() {
    const out = ((this.reg >>> 5) ^ (this.reg >>> 6)) & 1;
    this.reg = ((this.reg << 1) | out) & 0x7f;
    return out;
  }
}
