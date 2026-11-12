// The word processor's 84-key keyboard (96-character layout): physical position, size, legends and the service
// manual's typematic (T) and make/break (M) marks. Positions are the service numbers of PSM p.34; widths and offsets
// are in key units (u = 19.05 mm), measured on the photograph keyboard/KBD_2.JPG where it and the drawings (GIM p.22,
// PSM p.34) disagree: BKSP 1.75 u, RETURN 1.25 u over a 1 u leg, the right SHIFT 2.5 u, CODE 2 u from under Z-X, a
// 5.5 u space bar, ENTER 1.25 u, and a narrow INDEX standing alone (docs/displaywriter/hardware.md 2.6, models.md).
// Rows: 0 is the row above the number row (left and right groups only), 1 numbers, 2 tab, 3 lock, 4 shift, 5 space.
// x is the key's left edge in u from the keyboard's left key edge. A `tall` key (RETURN) spans its row and the next,
// its lower leg `leg` u wide at its right.

export const KEY_UNIT = 0.01905;

const k = (pos, row, x, w, top, opts = {}) => ({ pos, row, x, w, top, front: opts.front ?? '', mark: opts.mark ?? '', tall: !!opts.tall, ...(opts.leg ? { leg: opts.leg } : {}) });

const NUM_ROW = [[9, '°', '±'], [10, '!', '1'], [11, '@', '2'], [12, '#', '3'], [13, '$', '4'], [14, '%', '5'], [15, '¢', '6'], [16, '&', '7'], [17, '*', '8'], [18, '(', '9'], [19, ')', '0'], [20, '_', '-'], [21, '+', '=']];
const MAIN = 2.5;           // the main block starts after the left group and a half-key gap
const INDEX = MAIN + 14.95; // INDEX stands a little apart from BKSP, 0.8 u wide
const RIGHT = INDEX + 1.2;  // the right groups start 0.4 u past INDEX

export const KEYS = [
  // Left group: two columns, rows 0 to 4.
  k(82, 0, 0, 1, ''), k(83, 0, 1, 1, ''),
  k(1, 1, 0, 1, ''), k(2, 1, 1, 1, ''),
  k(3, 2, 0, 1, '', { mark: 'M' }), k(4, 2, 1, 1, ''),
  k(5, 3, 0, 1, 'REQST', { front: 'CANCL' }), k(6, 3, 1, 1, 'PRINT', { front: 'KYB\nCHG' }),
  k(7, 4, 0, 1, 'END'), k(8, 4, 1, 1, 'MSG', { front: 'REPLY' }),
  // Number row.
  ...NUM_ROW.map(([pos, up, low], i) => k(pos, 1, MAIN + i, 1, `${up}\n${low}`, { mark: pos === 20 ? 'T' : '', front: { 18: 'STOP' }[pos] })),
  k(22, 1, MAIN + 13, 1.75, 'BKSP', { front: 'REQD', mark: 'T' }),
  k(84, 1, INDEX, 0.8, 'INDEX', { mark: 'T' }),
  // Tab row.
  k(23, 2, MAIN, 1.5, 'TAB', { front: 'REQD' }),
  ...'QWERTYUIOP'.split('').map((ch, i) => k(24 + i, 2, MAIN + 1.5 + i, 1, ch, { front: { Y: '½⇧', U: 'BEGIN\nUND', I: 'WORD\nUND' }[ch] })),
  k(34, 2, MAIN + 11.5, 1, '¼\n½'), k(35, 2, MAIN + 12.5, 1, '[\n]'),
  k(36, 2, MAIN + 13.5, 1.25, 'RET', { mark: 'T', tall: true, leg: 1 }),
  // Lock row.
  k(37, 3, MAIN, 1.75, 'LOCK', { mark: 'M' }),
  ...'ASDFGHJKL'.split('').map((ch, i) => k(38 + i, 3, MAIN + 1.75 + i, 1, ch, { front: { H: '½⇩', J: 'END\nUND' }[ch] })),
  k(47, 3, MAIN + 10.75, 1, ':\n;'), k(48, 3, MAIN + 11.75, 1, '"\n\''), k(49, 3, MAIN + 12.75, 1, '³\n²'),
  // Shift row.
  k(50, 4, MAIN, 1.25, 'SHIFT', { mark: 'M' }), k(51, 4, MAIN + 1.25, 1, '¶\n§'),
  ...'ZXCVBNM'.split('').map((ch, i) => k(52 + i, 4, MAIN + 2.25 + i, 1, ch, { front: { C: 'CTR' }[ch] })),
  k(59, 4, MAIN + 9.25, 1, ',\n,'), k(60, 4, MAIN + 10.25, 1, '.\n.'), k(61, 4, MAIN + 11.25, 1, '?\n/'),
  k(62, 4, MAIN + 12.25, 2.5, 'SHIFT', { mark: 'M' }),
  // Space row.
  k(63, 5, MAIN + 3, 2, 'CODE', { mark: 'M' }),
  k(64, 5, MAIN + 5, 5.5, '', { front: 'REQUIRED', mark: 'T' }),
  k(65, 5, MAIN + 10.5, 1.25, 'ENTER'),
  // Right upper: function control keys, rows 0 and 1.
  k(66, 0, RIGHT, 1, 'DEL'), k(67, 0, RIGHT + 1, 1, 'MOVE', { front: 'COPY' }), k(68, 0, RIGHT + 2, 1, 'LINE\nADJ'), k(69, 0, RIGHT + 3, 1, 'SPELL'),
  k(70, 1, RIGHT, 1, 'CHG\nFMT', { front: 'INSTR' }), k(71, 1, RIGHT + 1, 1, 'GET'), k(72, 1, RIGHT + 2, 1, 'PAGE\nEND', { front: 'REQD' }), k(73, 1, RIGHT + 3, 1, ''),
  // Right lower: cursor control keys, rows 3 and 4.
  k(74, 3, RIGHT, 1, '↑', { front: '↖', mark: 'T' }), k(75, 3, RIGHT + 1, 1, '↓', { front: '↙', mark: 'T' }), k(76, 3, RIGHT + 2, 1, 'FIND'), k(77, 3, RIGHT + 3, 1, ''),
  k(78, 4, RIGHT, 1, '←', { front: '⇤', mark: 'T' }), k(79, 4, RIGHT + 1, 1, '→', { front: '⇥', mark: 'T' }), k(80, 4, RIGHT + 2, 1, 'GO TO'), k(81, 4, RIGHT + 3, 1, ''),
];

/** Extent of the key field in u, for centring it on the keyboard. */
export const KEY_FIELD = { w: RIGHT + 4, rows: 6 };

export const KEY_BY_POS = Object.fromEntries(KEYS.map((key, i) => [key.pos, { ...key, index: i }]));
