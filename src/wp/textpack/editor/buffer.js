// The page buffer (architecture 7.3): a gap buffer of 16-bit code units for the one page in memory. Units 0x20 to
// 0xFF are characters, 0x100 to 0x1FF parameterless control codes, 0x8000 | n a reference to the page's object n.

export class GapBuffer {
  constructor(units = [], capacity = 256) {
    const n = units.length;
    this.buf = new Uint16Array(Math.max(capacity, n * 2 + 16));
    this.buf.set(units, 0);
    this.gap0 = n;                       // the gap is [gap0, gap1)
    this.gap1 = this.buf.length;
  }

  get length() { return this.buf.length - (this.gap1 - this.gap0); }

  at(i) { return i < this.gap0 ? this.buf[i] : this.buf[i + this.gap1 - this.gap0]; }

  set(i, u) { if (i < this.gap0) this.buf[i] = u; else this.buf[i + this.gap1 - this.gap0] = u; }

  moveGap(i) {
    if (i < this.gap0) {
      const n = this.gap0 - i;
      this.buf.copyWithin(this.gap1 - n, i, this.gap0);
      this.gap0 = i; this.gap1 -= n;
    } else if (i > this.gap0) {
      const n = i - this.gap0;
      this.buf.copyWithin(this.gap0, this.gap1, this.gap1 + n);
      this.gap0 += n; this.gap1 += n;
    }
  }

  grow(need) {
    if (this.gap1 - this.gap0 >= need) return;
    const tail = this.buf.length - this.gap1;
    const next = new Uint16Array(Math.max(this.buf.length * 2, this.length + need + 64));
    next.set(this.buf.subarray(0, this.gap0), 0);
    next.set(this.buf.subarray(this.gap1), next.length - tail);
    this.gap1 = next.length - tail;
    this.buf = next;
  }

  insert(i, units) {
    this.moveGap(i);
    this.grow(units.length);
    this.buf.set(units, this.gap0);
    this.gap0 += units.length;
  }

  /** Remove n units from i; returns them. */
  delete(i, n) {
    const out = this.slice(i, i + n);
    this.moveGap(i);
    this.gap1 += n;
    return out;
  }

  slice(a = 0, b = this.length) {
    const out = new Uint16Array(Math.max(0, b - a));
    for (let i = a; i < b; i++) out[i - a] = this.at(i);
    return out;
  }

  toArray() { return this.slice(); }

  /** Replace the whole content. */
  reset(units) {
    this.buf = new Uint16Array(Math.max(256, units.length * 2 + 16));
    this.buf.set(units, 0);
    this.gap0 = units.length; this.gap1 = this.buf.length;
  }
}
