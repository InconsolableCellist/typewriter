// The operation panel: the key map and the LCD model.
//
// Keys, as read from the owner's photograph of an FO-70 panel (docs/fax/refs/owner/sharp_fo70_top.png, 474 px square,
// legends read at about 4 px a letter, so each is marked):
//   under the LCD, five small rapid keys  A  B  C  D  E/POLL                                        [photo]
//   a round four-way pad: STOP above it, START at its left, COPY/HELP at its right; the left and right
//     segments carry triangle marks; the lower segment's legend could not be read (not mapped)      [photo]
//   between the pad and the keypad: VOLUME, FUNCTION, RESOLUTION/RECEPTION MODE                     [photo]
//   the keypad 1-9, *, 0, # with letters ABC DEF GHI JKL MNO PRS TUV WXY on 2-9                      [photo]
//   on the right: SPEED DIAL, REDIAL, HOLD/SEARCH, SPEAKER                                          [photo, S]
// The handset's hook switch is not a key: it reaches the firmware from the ncu (devices.md).
//
// The LCD: 16 characters on one line [S]. Its character set is not known; we take upper-case letters, digits, space
// and the punctuation below, and fold lower case to upper [A].

export const KEYS = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#',
  'A', 'B', 'C', 'D', 'E',                 // rapid keys; E is also POLL [photo]
  'SPEED_DIAL', 'REDIAL', 'HOLD_SEARCH', 'SPEAKER',
  'VOLUME', 'FUNCTION', 'RESOLUTION',       // RESOLUTION is RESOLUTION/RECEPTION MODE
  'START', 'STOP', 'COPY_HELP',
]);

/** Printed legends, for the kit's labels and the help list. */
export const LEGENDS = Object.freeze({
  A: 'A', B: 'B', C: 'C', D: 'D', E: 'E/POLL',
  SPEED_DIAL: 'SPEED DIAL', REDIAL: 'REDIAL', HOLD_SEARCH: 'HOLD/SEARCH', SPEAKER: 'SPEAKER',
  VOLUME: 'VOLUME', FUNCTION: 'FUNCTION', RESOLUTION: 'RESOLUTION/RECEPTION MODE',
  START: 'START', STOP: 'STOP', COPY_HELP: 'COPY/HELP',
});

export const DIGIT_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#']);
export const RAPID_KEYS = ['A', 'B', 'C', 'D', 'E'];
export const isDigitKey = (k) => DIGIT_KEYS.has(k);
export const isRapidKey = (k) => RAPID_KEYS.includes(k);

/** Letters on the keypad for name entry: 2-9 from the photograph; Q and Z on 1 are ours [A]. */
export const KEY_LETTERS = Object.freeze({
  1: 'QZ', 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PRS', 8: 'TUV', 9: 'WXY', 0: '',
});
/** Symbols offered by repeated presses of * in name entry [A]. */
export const SYMBOLS = "-./&'#@()+,:!?";

/** The real keyboard's keys (plan decision 14): digits, * and # are the keypad, Enter START, Esc STOP. */
export const KEYBOARD = Object.freeze({
  Enter: 'START', Escape: 'STOP', c: 'COPY_HELP', r: 'REDIAL', f: 'FUNCTION', s: 'SPEAKER',
  F1: 'A', F2: 'B', F3: 'C', F4: 'D', F5: 'E',
});

// ---- the LCD --------------------------------------------------------------------------------------------------------

export const LCD_COLUMNS = 16;
const LCD_SET = new Set(' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-./&\'#@()+,:!?*%=_');

/** A character as the LCD can show it: lower case folded, anything else a space [A]. */
export function lcdChar(ch) {
  const u = ch.toUpperCase();
  return LCD_SET.has(u) ? u : ' ';
}

/** Text as 16 LCD characters (cut or padded). align: 'left' | 'right' | 'center'. */
export function lcdText(s, align = 'left') {
  let t = Array.from(String(s), lcdChar).join('');
  if (t.length > LCD_COLUMNS) t = align === 'right' ? t.slice(-LCD_COLUMNS) : t.slice(0, LCD_COLUMNS);
  const pad = LCD_COLUMNS - t.length;
  if (align === 'right') return ' '.repeat(pad) + t;
  if (align === 'center') return ' '.repeat(pad >> 1) + t + ' '.repeat(pad - (pad >> 1));
  return t + ' '.repeat(pad);
}

/** Two texts on one line: `a` at the left, `b` at the right. */
export function lcdPair(a, b) {
  const right = Array.from(String(b), lcdChar).join('');
  const left = Array.from(String(a), lcdChar).join('').slice(0, Math.max(0, LCD_COLUMNS - right.length - 1));
  return lcdText(left + ' '.repeat(Math.max(1, LCD_COLUMNS - left.length - right.length)) + right);
}

/** The LCD's state: 16 characters and an optional cursor column. Every change goes to devices.lcd.show. */
export class Lcd {
  constructor(device) {
    this.device = device;
    this.text = lcdText('');
    this.cursor = null;
    this.history = [];      // every distinct text shown, for tests: { t, text }
    this.now = () => 0;
  }

  show(s, { align = 'left', cursor = null } = {}) {
    const text = lcdText(s, align);
    if (text === this.text && cursor === this.cursor) return;
    this.text = text;
    this.cursor = cursor;
    this.history.push({ t: this.now(), text });
    if (this.history.length > 2000) this.history.splice(0, 1000);
    this.device?.show(text, { cursor });
  }

  /** Has any text matching `re` been shown since time t? */
  shownSince(re, t = 0) { return this.history.some((h) => h.t >= t && re.test(h.text)); }
}
