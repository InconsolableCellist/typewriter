// The operation panel: the key map and the LCD model.
//
// The keys, as the operation manual's panel drawing names them [OM p.8-9] and the service manual's key matrix wires
// them [SM p.6-15/pdf78]: under the LCD five rapid keys A B C D E/POLL (Speed Dial 01-05; E/POLL is the polling key
// when POLLING is set to YES [OM p.79]); the round pad of START, STOP and COPY/HELP; VOLUME, FUNCTION and
// RESOLUTION/RECEPTION MODE beside the keypad; the keypad 1-9, *, 0, # with ABC DEF GHI JKL MNO PQRS TUV WXYZ on 2-9;
// SPEED DIAL, REDIAL, HOLD/SEARCH and SPEAKER at the right. 27 keys. The handset's hook switch is not a key: it reaches
// the firmware from the ncu (devices.md).
//
// The LCD: one line of 16 digits [OM p.2]. It shows upper and lower case (REDIAL changes case in name entry, OM p.22),
// the symbols of name entry, and the arrow that points to the reception mode's legend printed by the window [OM p.28]:
// ▲ under TEL or FAX above the window, ▼ over TEL/FAX or A.M. below it.

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

/** What a key gives after its digit in name entry: SPACE = 1 1, A = 2 2 ... S = 7 7 7 7 7, Z = 9 9 9 9 9 [OM p.22]. */
export const KEY_LETTERS = Object.freeze({
  1: ' ', 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '',
});
/** The symbols # and * step through in name entry [OM p.22]. */
export const SYMBOLS = './!"#$%&\'()*+,-:;<=>?@[¥]^_`{|}→←';

/** The real keyboard's keys (plan decision 14): digits, * and # are the keypad, Enter START, Esc STOP. */
export const KEYBOARD = Object.freeze({
  Enter: 'START', Escape: 'STOP', c: 'COPY_HELP', r: 'REDIAL', f: 'FUNCTION', s: 'SPEAKER',
  F1: 'A', F2: 'B', F3: 'C', F4: 'D', F5: 'E',
});

// ---- the LCD --------------------------------------------------------------------------------------------------------

export const LCD_COLUMNS = 16;
const LCD_SET = new Set(' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./!"#$%&\'()*+,-:;<=>?@[¥]^_`{|}→←▲▼');

/** A character as the LCD can show it; anything else a space. */
export function lcdChar(ch) {
  return LCD_SET.has(ch) ? ch : LCD_SET.has(ch.toUpperCase()) ? ch.toUpperCase() : ' ';
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
