// Scan bytes to key events. A scan byte is the keyboard's own report (HW 2.4, architecture 5.2): bits 0 to 6 the key
// position (HW 2.6, PSM p.34), bit 7 a flag. Make/break keys (both SHIFTs, LOCK, CODE, CONTROL) send flag 0 on press
// and 1 on release; every other key sends flag 0 on press and flag 1 for each typematic repeat. Which repeats act is
// the software's choice (architecture 7.4): the keys the service manual marks typematic, plus LINE ADJ and the
// column-add key that the reference guide calls repeat-action (SR 2.5).

// position: [name, lower, upper]. Character keys carry their two characters; function keys only a name.
const TABLE = {
  1: ['PLUS'], 2: ['MINUS'], 3: ['CONTROL'], 4: ['KEY PLAYBCK'], 5: ['REQST'], 6: ['PRINT'], 7: ['END'], 8: ['MSG'],
  9: ['±', '±', '°'], 10: ['1', '1', '!'], 11: ['2', '2', '@'], 12: ['3', '3', '#'], 13: ['4', '4', '$'],
  14: ['5', '5', '%'], 15: ['6', '6', '¢'], 16: ['7', '7', '&'], 17: ['8', '8', '*'], 18: ['9', '9', '('],
  19: ['0', '0', ')'], 20: ['-', '-', '_'], 21: ['=', '=', '+'], 22: ['BKSP'], 23: ['TAB'],
  24: ['q'], 25: ['w'], 26: ['e'], 27: ['r'], 28: ['t'], 29: ['y'], 30: ['u'], 31: ['i'], 32: ['o'], 33: ['p'],
  34: ['½', '½', '¼'], 35: [']', ']', '['], 36: ['RETURN'], 37: ['LOCK'],
  38: ['a'], 39: ['s'], 40: ['d'], 41: ['f'], 42: ['g'], 43: ['h'], 44: ['j'], 45: ['k'], 46: ['l'],
  47: [';', ';', ':'], 48: ["'", "'", '"'], 49: ['²', '²', '³'], 50: ['SHIFT'], 51: ['§', '§', '¶'],
  52: ['z'], 53: ['x'], 54: ['c'], 55: ['v'], 56: ['b'], 57: ['n'], 58: ['m'],
  59: [',', ',', ','], 60: ['.', '.', '.'], 61: ['/', '/', '?'], 62: ['SHIFT'], 63: ['CODE'], 64: ['SPACE', ' ', ' '],
  65: ['ENTER'], 66: ['DEL'], 67: ['MOVE'], 68: ['LINE ADJ'], 69: ['SPELL'], 70: ['CHG FMT'], 71: ['GET'],
  72: ['PAGE END'], 73: ['COLUMN'], 74: ['UP'], 75: ['DOWN'], 76: ['FIND'], 77: ['SCREEN DOWN'], 78: ['LEFT'],
  79: ['RIGHT'], 80: ['GO TO'], 81: ['SCREEN RIGHT'], 82: ['MATH REQUEST'], 83: ['COLUMN ADD'], 84: ['INDEX'],
};
for (const k of Object.keys(TABLE)) {
  const e = TABLE[k];
  if (e.length === 1 && e[0].length === 1) e.push(e[0], e[0].toUpperCase());   // letters
}

export const KEY_TABLE = TABLE;
export const POS = {};
for (const [p, e] of Object.entries(TABLE)) if (!(e[0] in POS)) POS[e[0]] = +p;
POS.SHIFT_RIGHT = 62;

export const MAKE_BREAK = new Set([3, 37, 50, 62, 63]);
export const TYPEMATIC = new Set([20, 22, 84, 36, 64, 74, 75, 78, 79, 68, 83]);
export const ERROR_BYTE = 0x7f;

/**
 * Tracks the modifiers from their make and break bytes and turns every other byte into
 * { pos, name, ch, code, control, shift, repeat }, or null for a modifier, an overrun or a repeat that does not act.
 */
export class KeyDecoder {
  constructor() { this.down = new Set(); }

  get shift() { return this.down.has(50) || this.down.has(62) || this.down.has(37); }   // LOCK is a shift lock
  get code() { return this.down.has(63); }
  get control() { return this.down.has(3); }

  decode(byte) {
    if (byte === ERROR_BYTE) return null;
    const pos = byte & 0x7f, flag = byte >> 7;
    const e = TABLE[pos];
    if (!e) return null;
    if (MAKE_BREAK.has(pos)) {
      if (flag) this.down.delete(pos); else this.down.add(pos);
      return null;
    }
    if (flag && !TYPEMATIC.has(pos)) return null;
    const shift = this.shift;
    const ch = e.length > 1 ? (shift ? e[2] : e[1]) : null;
    return { pos, name: e[0], ch, code: this.code, control: this.control, shift, repeat: flag === 1 };
  }
}

/** Scan bytes for one keystroke: modifiers made, the key, modifiers broken. For tests and scripted input. */
export function strokeBytes(pos, { shift = false, code = false, control = false, repeat = false } = {}) {
  const mods = [];
  if (control) mods.push(3);
  if (code) mods.push(63);
  if (shift) mods.push(50);
  return [...mods, pos | (repeat ? 0x80 : 0), ...mods.reverse().map((p) => p | 0x80)];
}

/** Position and shift for a character, or null if no key types it. */
export function keyForChar(ch) {
  for (const [p, e] of Object.entries(TABLE)) {
    if (e.length < 3) continue;
    if (e[1] === ch) return { pos: +p, shift: false };
    if (e[2] === ch) return { pos: +p, shift: true };
  }
  return null;
}
