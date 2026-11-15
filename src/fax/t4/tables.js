// ITU-T T.4 code tables (Modified Huffman and Modified READ) and the lookup tables the decoder is built from.
//
// The codes are written as bit strings in transmission order (the first bit sent is on the left). The terminating
// and make-up tables are T.4 Tables 1 and 2 (1988 numbering, 2/T.4 and 3/T.4 in the 1981 draft, RFC 804); the
// extended make-up codes for 1792 to 2560 are T.4 Table 3 / T.6 Table 3, shared by both colours; the
// two-dimensional mode codes are T.4 Table 4. Every code here is exercised against libtiff 4.7.1 by
// tests/fax_t4.test.js (the "every run length" fixture decodes libtiff's stream for every white and black run from
// 0 to 2560, and our encoder's stream of the same page is byte-identical to libtiff's).
//
// Pure module: no DOM, no timers, no Node-only imports.

/** White terminating codes, run lengths 0 to 63. */
export const WHITE_TERM = Object.freeze([
  '00110101', '000111', '0111', '1000', '1011', '1100', '1110', '1111',
  '10011', '10100', '00111', '01000', '001000', '000011', '110100', '110101',
  '101010', '101011', '0100111', '0001100', '0001000', '0010111', '0000011', '0000100',
  '0101000', '0101011', '0010011', '0100100', '0011000', '00000010', '00000011', '00011010',
  '00011011', '00010010', '00010011', '00010100', '00010101', '00010110', '00010111', '00101000',
  '00101001', '00101010', '00101011', '00101100', '00101101', '00000100', '00000101', '00001010',
  '00001011', '01010010', '01010011', '01010100', '01010101', '00100100', '00100101', '01011000',
  '01011001', '01011010', '01011011', '01001010', '01001011', '00110010', '00110011', '00110100',
]);

/** Black terminating codes, run lengths 0 to 63. */
export const BLACK_TERM = Object.freeze([
  '0000110111', '010', '11', '10', '011', '0011', '0010', '00011',
  '000101', '000100', '0000100', '0000101', '0000111', '00000100', '00000111', '000011000',
  '0000010111', '0000011000', '0000001000', '00001100111', '00001101000', '00001101100', '00000110111', '00000101000',
  '00000010111', '00000011000', '000011001010', '000011001011', '000011001100', '000011001101', '000001101000', '000001101001',
  '000001101010', '000001101011', '000011010010', '000011010011', '000011010100', '000011010101', '000011010110', '000011010111',
  '000001101100', '000001101101', '000011011010', '000011011011', '000001010100', '000001010101', '000001010110', '000001010111',
  '000001100100', '000001100101', '000001010010', '000001010011', '000000100100', '000000110111', '000000111000', '000000100111',
  '000000101000', '000001011000', '000001011001', '000000101011', '000000101100', '000001011010', '000001100110', '000001100111',
]);

/** White make-up codes, run lengths 64, 128, ... 1728 (index i is 64 * (i + 1)). */
export const WHITE_MAKEUP = Object.freeze([
  '11011', '10010', '010111', '0110111', '00110110', '00110111', '01100100', '01100101',
  '01101000', '01100111', '011001100', '011001101', '011010010', '011010011', '011010100', '011010101',
  '011010110', '011010111', '011011000', '011011001', '011011010', '011011011', '010011000', '010011001',
  '010011010', '011000', '010011011',
]);

/** Black make-up codes, run lengths 64, 128, ... 1728. */
export const BLACK_MAKEUP = Object.freeze([
  '0000001111', '000011001000', '000011001001', '000001011011', '000000110011', '000000110100', '000000110101', '0000001101100',
  '0000001101101', '0000001001010', '0000001001011', '0000001001100', '0000001001101', '0000001110010', '0000001110011', '0000001110100',
  '0000001110101', '0000001110110', '0000001110111', '0000001010010', '0000001010011', '0000001010100', '0000001010101', '0000001011010',
  '0000001011011', '0000001100100', '0000001100101',
]);

/** Extended make-up codes, both colours, run lengths 1792, 1856, ... 2560. */
export const EXT_MAKEUP = Object.freeze([
  '00000001000', '00000001100', '00000001101', '000000010010', '000000010011', '000000010100', '000000010101',
  '000000010110', '000000010111', '000000011100', '000000011101', '000000011110', '000000011111',
]);

/** End of line: eleven zeros and a one. */
export const EOL = '000000000001';
export const EOL_CODE = 0x001;
export const EOL_LEN = 12;

/** Two-dimensional mode codes (T.4 Table 4). Vertical modes are indexed by a1 - b1 + 3 (VL3 ... V0 ... VR3). */
export const MODE = Object.freeze({
  PASS: '0001',
  HORIZ: '001',
  V: Object.freeze(['0000010', '000010', '010', '1', '011', '000011', '0000011']),
  EXT: '0000001', // followed by three bits; 0000001111 enters uncompressed mode (not used by Group 3 machines)
});

/** The longest run a single make-up code covers. Longer runs repeat the 2560 code (T.4 4.1.1.1 note). */
export const MAX_MAKEUP = 2560;

/** Return to control: six EOLs (T.4 4.1.4). */
export const RTC_EOLS = 6;
/** End of facsimile block (T.6 2.4): two EOLs. */
export const EOFB_EOLS = 2;

const codeOf = (s) => parseInt(s, 2);

/**
 * Encoder tables: for each colour, code and length of terminating codes (0..63) and make-up codes (index n for a
 * run of 64 * n, n = 1..40, covering both the basic and the extended make-ups).
 */
function buildEncodeTables(term, makeup) {
  const termCode = new Uint16Array(64);
  const termLen = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    termCode[i] = codeOf(term[i]);
    termLen[i] = term[i].length;
  }
  const muCode = new Uint16Array(41);
  const muLen = new Uint8Array(41);
  for (let n = 1; n <= 27; n++) {
    muCode[n] = codeOf(makeup[n - 1]);
    muLen[n] = makeup[n - 1].length;
  }
  for (let n = 28; n <= 40; n++) {
    muCode[n] = codeOf(EXT_MAKEUP[n - 28]);
    muLen[n] = EXT_MAKEUP[n - 28].length;
  }
  return Object.freeze({ termCode, termLen, muCode, muLen });
}

export const ENC_WHITE = buildEncodeTables(WHITE_TERM, WHITE_MAKEUP);
export const ENC_BLACK = buildEncodeTables(BLACK_TERM, BLACK_MAKEUP);

/** Number of bits the decoder peeks at once: long enough for the longest code (13 bits, black make-ups). */
export const PEEK_BITS = 13;
const PEEK_SIZE = 1 << PEEK_BITS;

/** Decoder entry meanings (in the run value table). Runs are >= 0. */
export const D_INVALID = -1;
/** Seven or more leading zeros that are no code: an EOL, fill before one, or damage. */
export const D_ZEROS = -2;

/**
 * A direct lookup table over the next PEEK_BITS bits: run value (0..63 terminating, multiples of 64 make-up) and
 * code length. Entries with no code are D_INVALID, or D_ZEROS when the window starts with eight zeros (no run code
 * of either colour starts with more than seven).
 */
function buildDecodeTable(term, makeup) {
  const val = new Int16Array(PEEK_SIZE).fill(D_INVALID);
  const len = new Uint8Array(PEEK_SIZE);
  const put = (bits, v) => {
    const n = bits.length;
    const base = codeOf(bits) << (PEEK_BITS - n);
    for (let i = 0; i < 1 << (PEEK_BITS - n); i++) {
      if (val[base | i] !== D_INVALID) throw new Error(`T.4 table: prefix clash at ${bits}`);
      val[base | i] = v;
      len[base | i] = n;
    }
  };
  for (let i = 0; i < 64; i++) put(term[i], i);
  for (let n = 1; n <= 27; n++) put(makeup[n - 1], 64 * n);
  for (let n = 28; n <= 40; n++) put(EXT_MAKEUP[n - 28], 64 * n);
  for (let i = 0; i < PEEK_SIZE >> 8; i++) {
    if (val[i] === D_INVALID) val[i] = D_ZEROS; // window starts with 00000000
  }
  return Object.freeze({ val, len });
}

export const DEC_WHITE = buildDecodeTable(WHITE_TERM, WHITE_MAKEUP);
export const DEC_BLACK = buildDecodeTable(BLACK_TERM, BLACK_MAKEUP);

/** Two-dimensional mode values in the mode table. */
export const M_PASS = 1;
export const M_HORIZ = 2;
export const M_V0 = 10; // vertical: M_V0 + (a1 - b1), so 7..13
export const M_EXT = 20;
export const M_ZEROS = 21; // 0000000: an EOL or damage

/** Mode lookup over the next 7 bits: value and length. */
function buildModeTable() {
  const val = new Int8Array(128).fill(D_INVALID);
  const len = new Uint8Array(128);
  const put = (bits, v) => {
    const n = bits.length;
    const base = codeOf(bits) << (7 - n);
    for (let i = 0; i < 1 << (7 - n); i++) {
      val[base | i] = v;
      len[base | i] = n;
    }
  };
  put(MODE.PASS, M_PASS);
  put(MODE.HORIZ, M_HORIZ);
  for (let d = -3; d <= 3; d++) put(MODE.V[d + 3], M_V0 + d);
  put(MODE.EXT, M_EXT);
  val[0] = M_ZEROS;
  len[0] = 0;
  for (let i = 0; i < 128; i++) if (val[i] === D_INVALID) throw new Error('T.4 mode table incomplete');
  return Object.freeze({ val, len });
}

export const DEC_MODE = buildModeTable();

/** Mode codes as numbers for the encoder. */
export const ENC_MODE = Object.freeze({
  passCode: codeOf(MODE.PASS), passLen: MODE.PASS.length,
  horizCode: codeOf(MODE.HORIZ), horizLen: MODE.HORIZ.length,
  vCode: Uint8Array.from(MODE.V, codeOf), vLen: Uint8Array.from(MODE.V, (s) => s.length),
});

/** Standard line widths in picture elements (T.4 2.2: A4, B4 and A3). */
export const WIDTHS = Object.freeze({ A4: 1728, B4: 2048, A3: 2432 });

/** Bits of a coded scan line at a minimum scan line time (T.30 MSLT, in ms) and a signalling rate (bit/s). */
export function msltBits(ms, bitRate) {
  return Math.ceil((ms * bitRate) / 1000);
}
