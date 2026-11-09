// Output side of the paper teletype. Bytes from the PTY become a flat list of carriage operations; anything that
// needs a screen (colours, cursor addressing, titles) is stripped, across chunk boundaries. Pure: no DOM, no simulation.
//
// Ops: { t:'char', ch }  one printable ASCII character at the current column (a space is a 'char' too)
//      { t:'nl' }        carriage return and one line space, as the lever does them together
//      { t:'cr' }        carriage return with no line space (bare CR, with nothing after it to pair with)
//      { t:'bs' }        one step back; the next character overstrikes
//      { t:'bel' }       ring the bell
//      { t:'screen' }    a sequence that only makes sense on a screen was seen (at most once per sequence)
const ESC = 0x1b, CAN = 0x18, SUB = 0x1a, BEL = 0x07, BS = 0x08, HT = 0x09, LF = 0x0a, CR = 0x0d;
const MAX_SEQ = 256;           // longest CSI parameter string before the parser gives up and resets
const MAX_STRING = 8192;       // longest OSC/DCS/APC/PM/SOS body before the parser gives up and resets
const TAB = 8;

const GROUND = 0, ESCAPE = 1, CSI = 2, STRING = 3, STRING_ESC = 4, ESC_INTER = 5, UTF8 = 6;

export class TeletypeParser {
  constructor({ cols = 75 } = {}) {
    this.cols = cols;
    this.col = 0;
    this.state = GROUND;
    this.seq = '';
    this.stringLen = 0;
    this.pendingCR = false;
    this.utf8Left = 0;
  }

  /** Feed a chunk of bytes (Uint8Array or array of numbers); returns the ops it completes. */
  feed(bytes) {
    const out = [];
    for (let i = 0; i < bytes.length; i++) this.byte(bytes[i], out);
    return out;
  }

  /** Called when the stream has gone quiet: a CR held back in case an LF followed is now just a CR. */
  flush() {
    if (!this.pendingCR) return [];
    this.pendingCR = false;
    this.col = 0;
    return [{ t: 'cr' }];
  }

  byte(b, out) {
    switch (this.state) {
      case ESCAPE: return this.escape(b, out);
      case CSI: return this.csi(b, out);
      case STRING: return this.string(b);
      case STRING_ESC:
        // Inside a string, ESC either ends it (ESC \) or starts a new sequence and abandons it.
        if (b === 0x5c) { this.state = GROUND; return undefined; }
        this.state = GROUND;
        return this.byte(b, out);
      case ESC_INTER:
        if (b >= 0x20 && b <= 0x2f) return undefined;
        if (b === ESC) { this.state = ESCAPE; return undefined; }
        this.state = GROUND;
        return undefined;
      case UTF8:
        if ((b & 0xc0) === 0x80) {
          if (--this.utf8Left === 0) this.state = GROUND;
          return undefined;
        }
        this.state = GROUND;   // a truncated sequence: reprocess this byte normally
        return this.ground(b, out);
      default:
        return this.ground(b, out);
    }
  }

  ground(b, out) {
    if (this.pendingCR) {
      this.pendingCR = false;
      this.col = 0;
      if (b === LF) { out.push({ t: 'nl' }); return; }
      out.push({ t: 'cr' });
    }
    if (b >= 0x20 && b <= 0x7e) { this.printable(String.fromCharCode(b), out); return; }
    if (b >= 0x80) {
      // No type for it: one '?' for each character, however many bytes the character took.
      this.printable('?', out);
      if (b >= 0xc2 && b <= 0xf4) { this.utf8Left = b < 0xe0 ? 1 : b < 0xf0 ? 2 : 3; this.state = UTF8; }
      return;
    }
    switch (b) {
      case ESC: this.state = ESCAPE; return;
      case CR: this.pendingCR = true; return;
      case LF: this.col = 0; out.push({ t: 'nl' }); return;
      case BS: if (this.col > 0) { this.col--; out.push({ t: 'bs' }); } return;
      case BEL: out.push({ t: 'bel' }); return;
      case HT: {
        const stop = Math.min(this.cols, this.col + TAB - (this.col % TAB));
        while (this.col < stop) { this.col++; out.push({ t: 'char', ch: ' ' }); }
        return;
      }
      default: return;   // NUL, SO, SI, FF, VT, DEL and the rest have no meaning on this carriage
    }
  }

  /** Deferred wrap: the column limit is only acted on when one more character arrives, so a line of exactly `cols` then a newline is one line. */
  printable(ch, out) {
    if (this.col >= this.cols) { out.push({ t: 'nl' }); this.col = 0; }
    this.col++;
    out.push({ t: 'char', ch });
  }

  escape(b, out) {
    if (b === 0x5b) { this.state = CSI; this.seq = ''; return; }
    if (b === 0x5d || b === 0x50 || b === 0x58 || b === 0x5e || b === 0x5f) { this.state = STRING; this.stringLen = 0; return; }   // OSC DCS SOS PM APC
    if (b >= 0x20 && b <= 0x2f) { this.state = ESC_INTER; return; }                  // ESC ( B and friends
    if (b === ESC) return;
    if (b === CAN || b === SUB) { this.state = GROUND; return; }
    this.state = GROUND;                                                             // two-byte escape
    if (b === 0x63) out.push({ t: 'screen' });                                       // RIS, a full terminal reset
  }

  csi(b, out) {
    if (b === CAN || b === SUB) { this.state = GROUND; return; }
    if (b === ESC) { this.state = ESCAPE; return; }
    if (b < 0x20) return;
    if (b >= 0x20 && b <= 0x3f) {
      if (this.seq.length >= MAX_SEQ) { this.state = GROUND; return; }
      this.seq += String.fromCharCode(b);
      return;
    }
    this.state = GROUND;
    if (b >= 0x40 && b <= 0x7e && isScreenSeq(this.seq, b)) out.push({ t: 'screen' });
  }

  string(b) {
    if (b === BEL) { this.state = GROUND; return; }
    if (b === ESC) { this.state = STRING_ESC; return; }
    if (b === CAN || b === SUB) { this.state = GROUND; return; }
    if (++this.stringLen > MAX_STRING) this.state = GROUND;
  }
}

function isScreenSeq(params, final) {
  const f = String.fromCharCode(final);
  if (f === 'H' || f === 'f') return params !== '';                // cursor addressing; a bare ESC[H is only a home
  if (f === 'J') return params === '2' || params === '3';          // clear the whole screen
  if (f === 'h' || f === 'l') return /^\?(47|1047|1049)(;|$)/.test(params);   // alternate screen
  return false;
}
