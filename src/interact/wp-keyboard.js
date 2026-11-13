// The PC keyboard as a finger on the word processor's keys (architecture 5.3). A keydown presses the mapped key with a
// steady finger force and the keyup lifts it, no sooner than 40 ms after the press, so holding is real: SHIFT, CODE
// and typematic need nothing special. e.repeat is ignored, since repeats come from the simulated keyboard.
import { KEYMAP, CHORDS, CODE_KEY } from './wp-keymap.js';
import { KEY_BY_POS } from '../machine/wp-keys.js';

const TOUCH_N = 1.2;           // N, finger force; enough for every key class
const MIN_HOLD_S = 0.04;

export class WpKeyboardInput {
  /** press(index, forceN) drives a key; now() is the mechanism clock in s. */
  /**
   * enterIsEnter(): true while the machine waits on its prompt line (a menu choice, a name, a FIND string), where the
   * operator ends the answer with ENTER. The PC's Enter then presses ENTER; in the typing area it presses RETURN as its
   * place on the keyboard says. AltGr and keypad Enter are always ENTER.
   */
  constructor({ press, now, onFirstKey, enterIsEnter }) {
    this.press = press; this.now = now; this.onFirstKey = onFirstKey; this.enterIsEnter = enterIsEnter;
    this.held = new Map();       // e.code -> { indices, at }
    this.pending = [];           // releases waiting for the minimum hold
    this.altGrAt = -1;
    window.addEventListener('keydown', (e) => this.down(e));
    window.addEventListener('keyup', (e) => this.up(e));
    window.addEventListener('blur', () => { for (const code of [...this.held.keys()]) this.release(code); });
  }

  indicesFor(code) {
    if (code === 'Enter' && this.enterIsEnter?.()) code = 'NumpadEnter';
    const pos = KEYMAP[code];
    if (pos) return [KEY_BY_POS[pos].index];
    const chord = CHORDS[code];
    return chord ? chord.map((p) => KEY_BY_POS[p].index) : null;
  }

  down(e) {
    if (e.target?.closest?.('input, select, textarea')) return;
    if (e.ctrlKey && !['ControlLeft', 'ControlRight'].includes(e.code) && ['KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyL'].includes(e.code)) return;   // the browser's own
    const ids = this.indicesFor(e.code);
    if (!ids) return;
    e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    // AltGr arrives as ControlLeft then AltRight in the same task: drop the stray CONTROL.
    if (e.code === 'AltRight' && this.held.has('ControlLeft') && performance.now() - this.held.get('ControlLeft').wall < 5) this.release('ControlLeft', true);
    this.onFirstKey?.();
    this.held.set(e.code, { ids, at: this.now(), wall: performance.now() });
    if (ids.length === 2 && ids[0] === KEY_BY_POS[CODE_KEY].index) {
      // A chord: CODE goes down first, the key a moment later.
      this.press(ids[0], TOUCH_N);
      setTimeout(() => this.press(ids[1], TOUCH_N), 25);
    } else for (const i of ids) this.press(i, TOUCH_N);
  }

  up(e) {
    if (!this.held.has(e.code)) return;
    e.preventDefault();
    this.release(e.code);
  }

  release(code, immediate = false) {
    const h = this.held.get(code);
    if (!h) return;
    this.held.delete(code);
    const wait = immediate ? 0 : Math.max(0, MIN_HOLD_S - (this.now() - h.at)) * 1000;
    const lift = () => { for (const i of [...h.ids].reverse()) this.press(i, 0); };
    if (h.ids.length === 2) setTimeout(() => { this.press(h.ids[1], 0); setTimeout(() => this.press(h.ids[0], 0), 25); }, wait);
    else if (wait > 0) setTimeout(lift, wait); else lift();
  }
}
