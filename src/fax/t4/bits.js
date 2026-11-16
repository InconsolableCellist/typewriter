// Bit writer and reader over Uint8Array, in either bit order.
//
// A T.4 stream is a sequence of bits. On the telephone line each octet is sent least significant bit first (T.4
// and T.30 both say so), so 'lsb' packs the first bit of the stream into bit 0 of the first byte; this is TIFF
// FillOrder 2. 'msb' packs it into bit 7, which is TIFF FillOrder 1 and what libtiff writes by default.
//
// Internally both classes work MSB-first and translate whole bytes through a reversal table, so the bit order costs
// nothing per bit. Pure module.

export const REVERSE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b;
    t[i] = r;
  }
  return t;
})();

function checkOrder(order) {
  if (order !== 'lsb' && order !== 'msb') throw new Error(`bit order must be 'lsb' or 'msb', not ${order}`);
  return order;
}

export class BitWriter {
  /** @param {{order?: 'lsb'|'msb', capacity?: number}} [o] */
  constructor({ order = 'lsb', capacity = 1 << 16 } = {}) {
    this.order = checkOrder(order);
    this.buf = new Uint8Array(Math.max(16, capacity));
    this.reset();
  }

  reset() {
    this.byte = 0; // index of the byte being filled
    this.acc = 0; // bits of the partial byte, MSB-first
    this.nacc = 0; // number of bits in acc (0..7)
  }

  /** Bits written so far. */
  get bitLength() {
    return this.byte * 8 + this.nacc;
  }

  _grow() {
    const nb = new Uint8Array(this.buf.length * 2);
    nb.set(this.buf);
    this.buf = nb;
  }

  /** Write the low `len` bits of `code`, most significant first (len <= 24). */
  put(code, len) {
    let acc = (this.acc << len) | (code & ((1 << len) - 1));
    let n = this.nacc + len;
    while (n >= 8) {
      n -= 8;
      if (this.byte >= this.buf.length) this._grow();
      this.buf[this.byte++] = (acc >>> n) & 0xff;
    }
    this.acc = acc & ((1 << n) - 1);
    this.nacc = n;
  }

  /** Write `n` zero bits (any n). */
  zeros(n) {
    while (n > 16) {
      this.put(0, 16);
      n -= 16;
    }
    if (n > 0) this.put(0, n);
  }

  /** Pad with zeros to the next byte boundary. */
  align() {
    if (this.nacc) this.put(0, 8 - this.nacc);
  }

  /** The bytes written, padded with zeros to a whole byte, in this writer's bit order (a new array). */
  finish() {
    const n = this.byte + (this.nacc ? 1 : 0);
    const out = new Uint8Array(n);
    out.set(this.buf.subarray(0, this.byte));
    if (this.nacc) out[this.byte] = (this.acc << (8 - this.nacc)) & 0xff;
    if (this.order === 'lsb') for (let i = 0; i < n; i++) out[i] = REVERSE[out[i]];
    return out;
  }
}

export class BitReader {
  /** @param {Uint8Array} data @param {{order?: 'lsb'|'msb', start?: number, end?: number}} [o] */
  constructor(data, { order = 'lsb', start = 0, end = data.length } = {}) {
    this.order = checkOrder(order);
    this.setData(data, start, end);
  }

  setData(data, start = 0, end = data.length) {
    this.data = data;
    this.start = start;
    this.end = end;
    this.pos = 0; // in bits from `start`
    this.bitEnd = (end - start) * 8;
  }

  _byte(i) {
    const j = this.start + i;
    if (j >= this.end) return 0;
    const b = this.data[j];
    return this.order === 'lsb' ? REVERSE[b] : b;
  }

  /** Bits left. */
  get remaining() {
    return this.bitEnd - this.pos;
  }

  /** The next n bits (n <= 16), MSB-first; zeros past the end. Does not advance. */
  peek(n) {
    const i = this.pos >>> 3;
    const w = (this._byte(i) << 16) | (this._byte(i + 1) << 8) | this._byte(i + 2);
    return (w >>> (24 - (this.pos & 7) - n)) & ((1 << n) - 1);
  }

  skip(n) {
    this.pos += n;
  }

  read(n) {
    const v = this.peek(n);
    this.pos += n;
    return v;
  }

  bit() {
    return this.read(1);
  }

  /** Advance to the next byte boundary. */
  align() {
    this.pos = (this.pos + 7) & ~7;
  }
}
