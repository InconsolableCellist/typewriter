// The PC keyboard on the word processor's keyboard (docs/displaywriter/architecture.md 5.3, owner's answer 6 in 13.2).
// Maps KeyboardEvent.code (the physical key, not the character) to a machine key position (wp-keys.js). A chord is
// two simulated fingers: CODE (63) held while the key is tapped.

const LETTERS = 'QWERTYUIOPASDFGHJKLZXCVBNM';
const LETTER_POS = { Q: 24, W: 25, E: 26, R: 27, T: 28, Y: 29, U: 30, I: 31, O: 32, P: 33, A: 38, S: 39, D: 40, F: 41, G: 42, H: 43, J: 44, K: 45, L: 46, Z: 52, X: 53, C: 54, V: 55, B: 56, N: 57, M: 58 };

export const KEYMAP = {
  ...Object.fromEntries([...LETTERS].map((ch) => [`Key${ch}`, LETTER_POS[ch]])),
  Digit1: 10, Digit2: 11, Digit3: 12, Digit4: 13, Digit5: 14, Digit6: 15, Digit7: 16, Digit8: 17, Digit9: 18, Digit0: 19,
  Minus: 20, Equal: 21, Backquote: 9,
  BracketLeft: 34, BracketRight: 35, Semicolon: 47, Quote: 48, Backslash: 49, IntlBackslash: 51,
  Comma: 59, Period: 60, Slash: 61,
  Backspace: 22, Tab: 23, CapsLock: 37, ShiftLeft: 50, ShiftRight: 62, Space: 64, Enter: 36,
  AltLeft: 63, AltRight: 65, NumpadEnter: 65, ControlLeft: 3,
  ArrowUp: 74, ArrowDown: 75, ArrowLeft: 78, ArrowRight: 79,
  F1: 5, F2: 6, F3: 76, F4: 80, F5: 67, F6: 68, F7: 69, F8: 70, F9: 71, F10: 72,
  PageDown: 77, Delete: 66, End: 7, Insert: 8,
};

/** Keys reached as CODE + another key. */
export const CHORDS = {
  Escape: [63, 5],      // CANCL
  PageUp: [63, 77],     // SCREEN UP
  Home: [63, 78],       // boundary left
};

export const CODE_KEY = 63;
