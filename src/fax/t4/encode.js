// T.4 / T.6 encoder: Modified Huffman (1-D), Modified READ (2-D, parameter K) and Modified Modified READ (T.6).
//
// The page as sent by a Group 3 machine (T.4 4.1): EOL, then each coded line followed by fill (zeros, only before
// an EOL) and the EOL that ends it, the last line's EOL being the first of the six of RTC. "Total coded scan line"
// for the minimum transmission time is the line's data, its fill and the EOL after it (T.4 4.1.3), so the fill is
// computed when that EOL is written. In MR every EOL carries a tag bit: 1 if the next line is coded 1-D, 0 if 2-D
// (T.4 4.2.1.3.4); RTC is then six EOL+1. MMR has no EOLs, no fill and no K, and ends with EOFB (two EOLs),
// padded to a byte (T.6 2.2, 2.4).
//
// Options that real streams differ in and that a TIFF records in T4Options (tag 292):
//   alignEol  pad so each EOL ends on a byte boundary (T4Options bit 2; libtiff's FAXMODE_BYTEALIGN of EOLs)
//   leadingEol  the EOL before the first line (T.4 requires it; on by default)
//   rtc  six EOLs after the last line (T.4 requires it; libtiff does not write it into a TIFF strip)
//
// Pure module. One instance holds its line buffers and bit writer; encode as many pages as you like.

import { BitWriter } from './bits.js';
import { ENC_WHITE, ENC_BLACK, ENC_MODE, EOL_CODE, EOL_LEN, RTC_EOLS, EOFB_EOLS } from './tables.js';
import { allocChanges, rowToChanges, strideOf } from './lines.js';

const CODINGS = ['mh', 'mr', 'mmr'];

export class T4Encoder {
  /**
   * @param {object} [o]
   * @param {number} [o.width] pels per line (1728, 2048 or 2432 for A4, B4, A3; any positive width works)
   * @param {'mh'|'mr'|'mmr'} [o.coding]
   * @param {number} [o.k] MR only: at most k - 1 2-D lines after each 1-D line (2 standard, 4 fine resolution)
   * @param {number} [o.minLineBits] minimum bits in a total coded scan line (msltBits(ms, bitRate)); MH and MR
   * @param {boolean} [o.alignEol] fill so that every EOL ends on a byte boundary
   * @param {boolean} [o.leadingEol] write the EOL before the first line
   * @param {boolean} [o.rtc] write RTC (MH, MR) or EOFB (MMR) at the end of the page
   * @param {'lsb'|'msb'} [o.bitOrder] packing of the bits into bytes (lsb: as sent on the line)
   */
  constructor({
    width = 1728, coding = 'mh', k = 2, minLineBits = 0, alignEol = false, leadingEol = true, rtc = true,
    bitOrder = 'lsb',
  } = {}) {
    if (!(width > 0 && Number.isInteger(width))) throw new Error(`bad width ${width}`);
    if (!CODINGS.includes(coding)) throw new Error(`coding must be one of ${CODINGS}`);
    if (coding === 'mr' && !(k >= 1 && Number.isInteger(k))) throw new Error(`bad K ${k}`);
    this.width = width;
    this.stride = strideOf(width);
    this.coding = coding;
    this.k = k;
    this.minLineBits = minLineBits;
    this.alignEol = alignEol;
    this.leadingEol = leadingEol;
    this.rtc = rtc;
    this.w = new BitWriter({ order: bitOrder, capacity: 1 << 15 });
    this.cur = allocChanges(width);
    this.ref = allocChanges(width);
    this.nCur = 0;
    this.nRef = 0;
    this.startPage();
  }

  /** Begin a new page (discards anything not yet finished). */
  startPage() {
    this.w.reset();
    this.lines = 0;
    this.lineStart = -1; // bit position where the previous line's data began
    this.kLeft = 0; // MR: 2-D lines still allowed before the next 1-D line
    this.nRef = 0;
    this.ref[0] = this.ref[1] = this.ref[2] = this.width; // T.6: the line before the first is all white
    this.fillBits = 0;
  }

  /** Bits written so far on this page. */
  get bitLength() {
    return this.w.bitLength;
  }

  _putRun(tab, run) {
    const w = this.w;
    while (run >= 2624) {
      w.put(tab.muCode[40], tab.muLen[40]);
      run -= 2560;
    }
    if (run >= 64) {
      const m = run >>> 6;
      w.put(tab.muCode[m], tab.muLen[m]);
      run &= 63;
    }
    w.put(tab.termCode[run], tab.termLen[run]);
  }

  /** Write fill and an EOL (with its tag bit in MR). `tag1D`: the next line is 1-D. */
  _eol(tag1D) {
    const w = this.w;
    const eolBits = EOL_LEN + (this.coding === 'mr' ? 1 : 0);
    let fill = 0;
    if (this.minLineBits > 0 && this.lineStart >= 0) {
      const used = w.bitLength - this.lineStart + eolBits;
      if (used < this.minLineBits) fill = this.minLineBits - used;
    }
    if (this.alignEol) {
      const end = (w.bitLength + fill + EOL_LEN) & 7;
      if (end) fill += 8 - end;
    }
    w.zeros(fill);
    this.fillBits += fill;
    if (this.coding === 'mr') w.put((EOL_CODE << 1) | (tag1D ? 1 : 0), EOL_LEN + 1);
    else w.put(EOL_CODE, EOL_LEN);
  }

  _encode1D(t, n) {
    const width = this.width;
    let pos = 0;
    let color = 0;
    for (let i = 0; pos < width; i++) {
      const next = i < n ? t[i] : width;
      this._putRun(color ? ENC_BLACK : ENC_WHITE, next - pos);
      pos = next;
      color ^= 1;
    }
  }

  _encode2D(cur, nc, ref) {
    const w = this.w;
    const width = this.width;
    let a0 = -1;
    let color = 0;
    let ia = 0;
    let ib = 0;
    for (;;) {
      while (cur[ia] <= a0 && ia < nc) ia++;
      const a1 = ia < nc ? cur[ia] : width;
      while (ib > 0 && ref[ib - 1] > a0) ib--;
      while (ref[ib] <= a0 || (ib & 1) !== color) ib++;
      const b1 = ref[ib];
      const b2 = ref[ib + 1];
      if (b2 < a1) {
        w.put(ENC_MODE.passCode, ENC_MODE.passLen);
        a0 = b2;
      } else {
        const d = a1 - b1;
        if (d >= -3 && d <= 3) {
          w.put(ENC_MODE.vCode[d + 3], ENC_MODE.vLen[d + 3]);
          a0 = a1;
          color ^= 1;
        } else {
          const a2 = ia + 1 < nc ? cur[ia + 1] : width;
          w.put(ENC_MODE.horizCode, ENC_MODE.horizLen);
          this._putRun(color ? ENC_BLACK : ENC_WHITE, a1 - (a0 < 0 ? 0 : a0));
          this._putRun(color ? ENC_WHITE : ENC_BLACK, a2 - a1);
          a0 = a2;
        }
      }
      if (a0 >= width) break;
    }
  }

  /** Encode one packed row (stride bytes from src[off]). */
  encodeRow(src, off = 0) {
    const t = this.cur;
    const n = rowToChanges(src, off, this.width, t);
    this.nCur = n;
    if (this.coding === 'mmr') {
      this._encode2D(t, n, this.ref);
    } else {
      const oneD = this.coding === 'mh' || this.kLeft === 0;
      if (this.lines > 0 || this.leadingEol) this._eol(oneD);
      this.lineStart = this.w.bitLength;
      if (oneD) {
        this._encode1D(t, n);
        this.kLeft = this.k - 1;
      } else {
        this._encode2D(t, n, this.ref);
        this.kLeft--;
      }
    }
    // the coded line becomes the reference line
    const r = this.ref;
    this.ref = this.cur;
    this.cur = r;
    this.nRef = n;
    this.lines++;
  }

  /** End the page with RTC (or EOFB) as configured; returns the stream as bytes in the configured bit order. */
  finishPage() {
    const w = this.w;
    if (this.coding === 'mmr') {
      if (this.rtc) for (let i = 0; i < EOFB_EOLS; i++) w.put(EOL_CODE, EOL_LEN);
    } else if (this.rtc) {
      this._eol(true);
      for (let i = 1; i < RTC_EOLS; i++) {
        if (this.coding === 'mr') w.put((EOL_CODE << 1) | 1, EOL_LEN + 1);
        else w.put(EOL_CODE, EOL_LEN);
      }
    }
    const out = w.finish();
    return out;
  }

  /** Encode a whole packed bitmap of `height` rows (1 = black, stride = ceil(width / 8)). */
  encodePage(bitmap, height) {
    if (bitmap.length < height * this.stride) throw new Error('bitmap too short for its height');
    this.startPage();
    for (let y = 0; y < height; y++) this.encodeRow(bitmap, y * this.stride);
    return this.finishPage();
  }
}

/** One-shot convenience. */
export function encodePage(bitmap, height, options) {
  return new T4Encoder(options).encodePage(bitmap, height);
}
