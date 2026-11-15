// T.4 / T.6 decoder with a Group 3 receiver's handling of damaged lines.
//
// A line is in error when a code is not in the tables, a run takes the line past its width, an EOL arrives before
// the line is complete, the line is complete but no EOL follows, or the stream ends inside it. The receiver then
// looks for the next EOL (eleven or more zeros and a one) from where the bad line began and carries on from there:
// the damage costs one line, or more if an EOL was destroyed. The damaged line is replaced (the plan's rule, 2:
// "a bad line is replaced by the one before, counted") either by the line before it ('repeat', the default) or by
// a white line ('blank'), and counted. In MR, the 2-D lines
// after a damaged line are coded against a line the receiver does not have, so with `propagate` (the default) they
// are replaced and counted as well, up to the next 1-D line. MMR has no EOLs and so no resync: the first error ends
// the page, and the remaining lines (if the height is known) are replaced and counted.
//
// The counts are what the T.30 layer needs for MCF / RTP / RTN: errorLines, the longest run of consecutive error
// lines, and a flag per line.
//
// Pure module. One instance holds its line buffers and grows its page buffer as pages need.

import { BitReader } from './bits.js';
import {
  DEC_WHITE, DEC_BLACK, DEC_MODE, PEEK_BITS, D_ZEROS, M_PASS, M_HORIZ, M_V0, M_ZEROS,
} from './tables.js';
import { allocChanges, changesToRow, strideOf } from './lines.js';

const CODINGS = ['mh', 'mr', 'mmr'];

// Results of decoding one line.
const OK = 0;
const ERR = 1; // damage; the reader is somewhere inside it
const ERR_EOL = 2; // damage ended by an EOL, which has been consumed

export class T4Decoder {
  /**
   * @param {object} [o]
   * @param {number} [o.width]
   * @param {'mh'|'mr'|'mmr'} [o.coding]
   * @param {'lsb'|'msb'} [o.bitOrder]
   * @param {'repeat'|'blank'} [o.damage] what replaces a damaged line
   * @param {boolean} [o.propagate] MR: also replace the 2-D lines that follow a damaged line, to the next 1-D line
   * @param {number} [o.rtcEols] consecutive EOLs taken as RTC (T.4 sends 6; receivers commonly accept fewer)
   */
  constructor({
    width = 1728, coding = 'mh', bitOrder = 'lsb', damage = 'repeat', propagate = true, rtcEols = 2,
  } = {}) {
    if (!CODINGS.includes(coding)) throw new Error(`coding must be one of ${CODINGS}`);
    if (damage !== 'repeat' && damage !== 'blank') throw new Error(`damage must be 'repeat' or 'blank'`);
    this.width = width;
    this.stride = strideOf(width);
    this.coding = coding;
    this.damage = damage;
    this.propagate = propagate;
    this.rtcEols = rtcEols;
    this.r = new BitReader(new Uint8Array(0), { order: bitOrder });
    this.cur = allocChanges(width);
    this.ref = allocChanges(width);
    this.nRef = 0;
    this.page = new Uint8Array(this.stride * 64);
    this.flags = new Uint8Array(64);
  }

  // --- bit-level helpers ---------------------------------------------------------------------------------------

  /**
   * If the next bits are fill and an EOL (any zeros, at least eleven of them, then a one), consume them and return
   * true. Otherwise leave the reader where it was and return false.
   */
  _eolAhead() {
    const r = this.r;
    const p = r.pos;
    let z = 0;
    while (r.pos < r.bitEnd) {
      if (r.peek(8) === 0 && r.remaining >= 8) {
        r.pos += 8;
        z += 8;
        continue;
      }
      if (r.bit() === 0) {
        z++;
        continue;
      }
      if (z >= 11) return true;
      break;
    }
    r.pos = p;
    return false;
  }

  /** Skip to just after the next EOL; false if the data ends first. */
  _resync() {
    const r = this.r;
    let z = 0;
    while (r.pos < r.bitEnd) {
      if (z >= 3 && r.remaining >= 8 && r.peek(8) === 0) {
        r.pos += 8;
        z += 8;
        continue;
      }
      if (r.bit() === 0) z++;
      else if (z >= 11) return true;
      else z = 0;
    }
    return false;
  }

  /** Read one run (make-ups and a terminating code). Returns the run, or -1 (damage) or -2 (zeros: EOL?). */
  _run(tab) {
    const r = this.r;
    let run = 0;
    for (;;) {
      if (r.pos >= r.bitEnd) return -1;
      const w = r.peek(PEEK_BITS);
      const v = tab.val[w];
      if (v < 0) return v === D_ZEROS ? -2 : -1;
      r.pos += tab.len[w];
      if (r.pos > r.bitEnd) return -1;
      run += v;
      if (v < 64) return run;
      if (run > this.width) return -1;
    }
  }

  /** The damage result after a code failed: an EOL here (premature end of line) is consumed and reported. */
  _fail(v) {
    if (v === -2 && this._eolAhead()) return ERR_EOL;
    return ERR;
  }

  // --- line decoders -------------------------------------------------------------------------------------------

  /** Push a changing element; equal neighbours (zero-length runs) cancel. */
  static _push(t, n, x) {
    if (n > 0 && t[n - 1] === x) return n - 1;
    t[n] = x;
    return n + 1;
  }

  _line1D() {
    const width = this.width;
    const t = this.cur;
    let n = 0;
    let a0 = 0;
    let color = 0;
    while (a0 < width) {
      const run = this._run(color ? DEC_BLACK : DEC_WHITE);
      if (run < 0) return this._fail(run);
      a0 += run;
      if (a0 > width) return ERR;
      if (a0 < width) n = T4Decoder._push(t, n, a0);
      color ^= 1;
    }
    t[n] = t[n + 1] = t[n + 2] = width;
    this.nCur = n;
    return OK;
  }

  _line2D() {
    const r = this.r;
    const width = this.width;
    const t = this.cur;
    const ref = this.ref;
    let n = 0;
    let a0 = -1;
    let color = 0;
    let ib = 0;
    while (a0 < width) {
      while (ib > 0 && ref[ib - 1] > a0) ib--;
      while (ref[ib] <= a0 || (ib & 1) !== color) ib++;
      const b1 = ref[ib];
      const b2 = ref[ib + 1];
      if (r.pos >= r.bitEnd) return ERR;
      const w = r.peek(7);
      const mode = DEC_MODE.val[w];
      if (mode === M_ZEROS) return this._fail(-2);
      r.pos += DEC_MODE.len[w];
      if (mode === M_PASS) {
        if (b2 >= width) return ERR;
        a0 = b2;
      } else if (mode === M_HORIZ) {
        const start = a0 < 0 ? 0 : a0;
        const r1 = this._run(color ? DEC_BLACK : DEC_WHITE);
        if (r1 < 0) return this._fail(r1);
        const r2 = this._run(color ? DEC_WHITE : DEC_BLACK);
        if (r2 < 0) return this._fail(r2);
        const a1 = start + r1;
        const a2 = a1 + r2;
        if (a2 > width) return ERR;
        if (a1 < width) n = T4Decoder._push(t, n, a1);
        if (a2 < width) n = T4Decoder._push(t, n, a2);
        a0 = a2;
      } else if (mode >= M_V0 - 3 && mode <= M_V0 + 3) {
        const a1 = b1 + (mode - M_V0);
        if (a1 <= a0 || a1 > width || a1 < 0) return ERR;
        if (a1 < width) t[n++] = a1;
        a0 = a1;
        color ^= 1;
      } else {
        return ERR; // extension (uncompressed mode) is not supported by this receiver
      }
      if (r.pos > r.bitEnd) return ERR;
    }
    if (a0 > width) return ERR;
    t[n] = t[n + 1] = t[n + 2] = width;
    this.nCur = n;
    return OK;
  }

  // --- the page --------------------------------------------------------------------------------------------------

  _ensure(rows) {
    if (rows * this.stride > this.page.length) {
      let cap = this.page.length;
      while (cap < rows * this.stride) cap *= 2;
      const p = new Uint8Array(cap);
      p.set(this.page);
      this.page = p;
    }
    if (rows > this.flags.length) {
      let cap = this.flags.length;
      while (cap < rows) cap *= 2;
      const f = new Uint8Array(cap);
      f.set(this.flags);
      this.flags = f;
    }
  }

  /** Emit row y: decoded (ok) or the replacement for a damaged line. */
  _emit(y, ok) {
    this._ensure(y + 1);
    const off = y * this.stride;
    const width = this.width;
    if (ok) {
      changesToRow(this.cur, this.nCur, width, this.page, off);
      const tmp = this.ref;
      this.ref = this.cur;
      this.cur = tmp;
      this.nRef = this.nCur;
      const t = this.ref;
      t[this.nRef] = t[this.nRef + 1] = t[this.nRef + 2] = width;
      this.flags[y] = 0;
    } else {
      if (this.damage === 'repeat' && y > 0) {
        this.page.copyWithin(off, off - this.stride, off);
        // the reference stays the previous line, which is what was printed
      } else {
        this.page.fill(0, off, off + this.stride);
        this.nRef = 0;
        this.ref[0] = this.ref[1] = this.ref[2] = width;
      }
      this.flags[y] = 1;
      this.errorLines++;
      this.run++;
      if (this.run > this.maxConsecutive) this.maxConsecutive = this.run;
    }
    if (ok) this.run = 0;
  }

  /**
   * Decode a page.
   * @param {Uint8Array} data the coded stream
   * @param {{height?: number, start?: number, end?: number}} [o] height: lines expected (needed for MMR streams
   *   without EOFB; for MH and MR it stops decoding there, otherwise RTC or the end of the data does)
   * @returns {{width: number, height: number, bitmap: Uint8Array, lineErrors: Uint8Array, errorLines: number,
   *   maxConsecutive: number, rtc: boolean, bits: number}} bitmap and lineErrors are views into this
   *   instance's buffers, valid until the next decode
   */
  decodePage(data, { height = Infinity, start = 0, end = data.length } = {}) {
    const r = this.r;
    r.setData(data, start, end);
    this.errorLines = 0;
    this.maxConsecutive = 0;
    this.run = 0;
    this.nRef = 0;
    this.ref[0] = this.ref[1] = this.ref[2] = this.width;
    let y = 0;
    let rtc = false;
    if (this.coding === 'mmr') {
      rtc = this._pageMMR(height);
      y = this._rows;
    } else {
      // T.4: the page starts with an EOL (and fill before it); tolerate a stream without one.
      const mr = this.coding === 'mr';
      let tag = 1; // MR: the tag bit after the last EOL (1: the next line is 1-D)
      const afterEol = () => {
        if (mr) tag = r.pos < r.bitEnd ? r.bit() : 1;
      };
      let haveEol = this._eolAhead();
      if (haveEol) afterEol();
      let eols = haveEol ? 1 : 0; // consecutive EOLs with no line between them
      let tainted = false; // MR: a damaged line since the last 1-D line
      while (y < height) {
        if (r.pos >= r.bitEnd || this._trailingZerosOnly()) break;
        if (haveEol && this._eolAhead()) {
          afterEol();
          if (++eols >= this.rtcEols) {
            rtc = true;
            break;
          }
          continue;
        }
        // EOLs with no line between them, short of RTC: each stands for a lost line
        for (; eols > 1 && y < height; eols--) this._emit(y++, false);
        if (y >= height) break;
        eols = 0;
        const oneD = !mr || !haveEol || tag === 1;
        if (oneD) tainted = false;
        const lineStart = r.pos;
        let res = oneD ? this._line1D() : this._line2D();
        if (res === OK) {
          // a complete line is followed by an EOL, or by the end of the data (a TIFF strip carries no RTC)
          if (this._eolAhead()) {
            afterEol();
            haveEol = true;
            eols = 1;
          } else if (this._trailingZerosOnly()) {
            r.pos = r.bitEnd;
            haveEol = false;
          } else {
            res = ERR; // too long: data where the EOL should be
          }
          if (res === OK && tainted && this.propagate) {
            this._emit(y++, false); // coded against a line we do not have
            continue;
          }
        }
        if (res === OK) {
          this._emit(y++, true);
          continue;
        }
        this._emit(y++, false);
        if (mr) tainted = true;
        if (res === ERR) {
          // Look for the next EOL from where this line began: the last code read may have taken some of its zeros
          r.pos = lineStart;
          haveEol = this._resync();
          if (!haveEol) break;
        }
        // ERR_EOL: the EOL that cut the line short has been consumed
        afterEol();
        haveEol = true;
        eols = 1;
      }
    }
    return {
      width: this.width,
      height: y,
      bitmap: this.page.subarray(0, y * this.stride),
      lineErrors: this.flags.subarray(0, y),
      errorLines: this.errorLines,
      maxConsecutive: this.maxConsecutive,
      rtc,
      bits: r.pos,
    };
  }

  /** Only zeros remain (byte padding at the end of a strip). */
  _trailingZerosOnly() {
    const r = this.r;
    const p = r.pos;
    while (r.pos < r.bitEnd) {
      if (r.bit() !== 0) {
        r.pos = p;
        return false;
      }
    }
    r.pos = p;
    return true;
  }

  _pageMMR(height) {
    const r = this.r;
    let y = 0;
    let eofb = false;
    while (y < height) {
      if (r.pos >= r.bitEnd || this._trailingZerosOnly()) break;
      // EOFB: EOL EOL
      if (r.peek(12) === 1) {
        const p = r.pos;
        r.pos += 12;
        if (r.peek(12) === 1) {
          r.pos += 12;
          eofb = true;
          break;
        }
        r.pos = p;
      }
      const res = this._line2D();
      if (res === OK) {
        this._emit(y++, true);
        continue;
      }
      // no resync in T.6: the rest of the page is lost
      if (height === Infinity) {
        this._emit(y++, false);
      } else {
        while (y < height) this._emit(y++, false);
      }
      break;
    }
    this._rows = y;
    return eofb;
  }
}

/** One-shot convenience; copies the bitmap out of the decoder's buffers. */
export function decodePage(data, options = {}) {
  const d = new T4Decoder(options);
  const res = d.decodePage(data, options);
  return { ...res, bitmap: res.bitmap.slice(), lineErrors: res.lineErrors.slice() };
}
