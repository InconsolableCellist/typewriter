// The machine's 8-bit character set. Text uses Latin-1 positions, so every character on the 96-character keyboard
// (HW 2.6: ± ° ¢ ¼ ½ ² ³ ¶ §) has its own code without a table. A second font (attribute bit 64) holds the code
// symbols of SR 5, the scale-line and status-line marks and the block glyphs of the start-up screen. Each symbol has
// a Unicode stand-in so `screen.text()` can be compared with the grids of software-screens.md.

// Symbol font codes. The stand-ins are the ones software-screens.md uses where it shows a glyph.
export const SYM = {
  BAR: 1,            // status-line field separator, a thin vertical bar
  CENTRE: 2,         // centre point on the scale line
  PAGE_END: 3,
  REQ_PAGE_END: 4,
  CR: 5,
  REQ_CR: 6,
  TAB: 7,
  REQ_TAB: 8,
  REQ_SPACE: 9,
  REQ_HYPHEN: 10,
  SYL_HYPHEN: 11,
  REQ_BKSP: 12,
  INDEX: 13,
  INDEX_RET: 14,
  ZICR: 15,
  HALF_UP: 16,
  HALF_DOWN: 17,
  CTR: 18,
  BEGIN_UND: 19,
  END_UND: 20,
  WORD_UND: 21,
  CHAR_UND: 22,
  SQUARE: 23,        // stop, switch, keyboard change, spelling mark, null codes
  SUBSTITUTE: 24,
  KEEP: 25,
  INSTR: 26,
  FMT_CHANGE: 27,    // boxed F
  FMT_RETURN: 28,    // boxed R
  ALT_FMT: 29,       // boxed 2
  OVS_BEGIN: 30,
  OVS_END: 31,
  BLOCK: 32,         // a full cell, for the large initials of the start-up screen
  TAB_CENTRE: 33,
  TAB_DECIMAL: 34,
  TAB_RIGHT: 35,
  PAPER_EDGE: 36,
  ARROW_DOWN: 37,
  ARROW_UP: 38,
  SEPARATOR: 39,     // CODE+M on the prompt line: document name / diskette name separator (an underlined comma)
  INCLUDE: 40,
  VARIABLE: 41,
};

export const SYMBOL_TEXT = new Array(256).fill('?');
const STAND_IN = {
  BAR: '|', CENTRE: '▼', PAGE_END: '▲', REQ_PAGE_END: '⧗', CR: '↵', REQ_CR: '↲', TAB: '⇥', REQ_TAB: '⇲',
  REQ_SPACE: '▾', REQ_HYPHEN: '‑', SYL_HYPHEN: '‐', REQ_BKSP: '⇤', INDEX: '⇓', INDEX_RET: '↰', ZICR: '⇐',
  HALF_UP: '↑', HALF_DOWN: '↓', CTR: '●', BEGIN_UND: '⇀', END_UND: '↼', WORD_UND: '‗', CHAR_UND: '▁',
  SQUARE: '■', SUBSTITUTE: '—', KEEP: '‡', INSTR: '╪', FMT_CHANGE: '⒡', FMT_RETURN: '⒭', ALT_FMT: '⑵',
  OVS_BEGIN: '⇉', OVS_END: '⇇', BLOCK: '█', TAB_CENTRE: '¦', TAB_DECIMAL: '•', TAB_RIGHT: '⊣', PAPER_EDGE: '▪',
  ARROW_DOWN: '↓', ARROW_UP: '↑', SEPARATOR: '‚', INCLUDE: '∤', VARIABLE: 'Ʉ',
};
for (const [k, s] of Object.entries(STAND_IN)) SYMBOL_TEXT[SYM[k]] = s;

// Stand-in to symbol code, so screen code can write a menu line that contains an arrow as plain text. Where two
// symbols share a stand-in, the first listed wins (the scale centre and the page-edge marks are written by code).
export const SYMBOL_OF = new Map();
for (const [k, s] of Object.entries(STAND_IN)) if (!SYMBOL_OF.has(s)) SYMBOL_OF.set(s, SYM[k]);

/** True for a code that the text font draws (Latin-1, printable). */
export function isText(code) {
  return (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff);
}

// The printwheel's petals in order from home (lowercase a), as the printer's definition places them
// (architecture 6.2); a test holds the two equal. The software sends petal numbers, so it needs the map. Comma and
// period are on two petals each; the first is used.
export const PETALS = "aeonhdcmfyb.kIS'MBHRE1LG2)9346:?jz/UQZ%#*=¢±½]²§.,¶³[¼°_+@$&XVK!qx;785YJ(OF0NDPW\"C-ATv,pgwulrsit";
const PETAL_OF = new Map();
[...PETALS].forEach((ch, i) => { if (!PETAL_OF.has(ch)) PETAL_OF.set(ch, i); });

/** The petal that prints a character code; one the wheel does not carry prints as an underscore (MIM p.199). */
export function petalOf(code) { return PETAL_OF.get(String.fromCharCode(code)) ?? PETAL_OF.get('_'); }
