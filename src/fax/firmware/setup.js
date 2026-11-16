// The user settings and the FUNCTION key's modes, as the FO-10/FO-50/FO-70 operation manual gives them
// (docs/fax/refs/sharp_fo10_50_70_operation_manual.pdf; "OM p.N" is the manual's printed page, its figure is PDF page
// N + 102) and the service manual's soft switches behind them (softswitch.js):
//
//   FUNCTION            FUNCTION MODE                                      [OM p.90]
//   FUNCTION 2          LISTING MODE: * the Anti Junk Number List, # the Telephone Number List, START prints [OM p.81]
//   FUNCTION 3          ENTRY MODE; # steps forward, * back, through
//                         FAX/TEL. # MODE, OWN NUMBER SET, DATE & TIME SET, STORE JUNK #, PRIORITY CALL #
//                         [OM p.20, 24, 41, 73, 77: one # for the first, three for DATE & TIME SET, two * for STORE JUNK #]
//   FUNCTION 4          OPTION SETTING <-> PRESS * OR #; # steps forward, * back, through the eleven options below,
//                         each shown alternately with its prompt; a choice stores it and moves to the next
//                         [OM p.14, 50, 54, 57, 58, 66-69, 75, 79; SM p.2-1]
//   FUNCTION 9 * 8 # 7  the service diagnostics (diag.js) [SM p.2-2]
//
// Settings persist through a storage interface (devices.md).

import { msg } from './messages.js';
import { isDigitKey, isRapidKey, RAPID_KEYS, KEY_LETTERS, SYMBOLS, lcdPair } from './panel.js';
import { defaultSoftSwitches } from './softswitch.js';

export const STORAGE_KEY = 'faxfo70.settings';
export const JOURNAL_KEY = 'faxfo70.journal';
export const SPEED_COUNT = 40;           // 01-05 on the rapid keys, 06-40 by SPEED DIAL [OM p.40]
export const JUNK_COUNT = 5;             // [OM p.77]
export const NAME_MAX = 24;              // own name: up to 24 characters [OM p.22]
export const NUMBER_MAX = 20;            // own number and auto-dial numbers: max. 20 digits [OM p.21, p.74]

/** The reception modes in the order the RESOLUTION/RECEPTION MODE key steps through them [OM p.28]. */
export const RX_MODES = ['TEL', 'FAX', 'TEL/FAX', 'A.M.'];

/** The transaction report's conditions [OM p.50]. */
export const REPORT_CHOICES = [['ALWAYS', 'ALWAYS PRINT'], ['ERROR', 'ERROR PRINT'], ['SEND', 'SEND ONLY'], ['NEVER', 'NEVER PRINT']];

const yesNo = (key) => ({ key, kind: 'yesno' });
/**
 * The OPTION SETTING's options, in the order # steps through them from OPTION SETTING (FUNCTION 4 # is NUMBER OF
 * RINGS, ## TEL/FAX REMOTE #, ### TRANSACTION LIST, #### DIAL MODE, ##### QUIET DETECT TM., ###### QUIET START TIME;
 * * is CALLER-ID, ** POLLING, *** FAX SIGNAL RX, **** DUPLEX RINGING, ***** FAX RX A.M. FAILS) [OM figures p.14, 50,
 * 54, 57, 58, 66, 67, 68, 69, 75, 79]. The titles are the manual's displays; the prompts the manual does not show
 * are ours [A].
 */
export const OPTIONS = Object.freeze([
  { key: 'rings', title: 'NUMBER OF RINGS', kind: 'digit', min: 2, max: 5, prompt: (v) => `ENTER (2-5) (${v})` },        // [OM p.54]
  { key: 'remoteCode', title: 'TEL/FAX REMOTE #', kind: 'digit', min: 0, max: 9, prompt: (v) => `ENTER (0-9) (${v})` },   // [OM p.57; prompt A]
  { key: 'report', title: 'TRANSACTION LIST', kind: 'report', prompt: (v) => `ENTER (1-4) (${REPORT_CHOICES.findIndex(([k]) => k === v) + 1})` },  // [OM p.50; prompt A]
  { key: 'dialMode', title: 'DIAL MODE', kind: 'dial', prompt: () => '1=TONE, 2=PULSE' },                               // [SM p.2-1, OM p.14]
  { key: 'quietDetectS', title: 'QUIET DETECT TM.', kind: 'two', min: 0, max: 10, prompt: (v) => `ENTER (00-10)(${String(v).padStart(2, '0')})` },  // [OM p.66]
  { key: 'quietStartS', title: 'QUIET START TIME', kind: 'two', min: 0, max: 15, prompt: (v) => `ENTER (00-15)(${String(v).padStart(2, '0')})` },  // [OM p.68]
  { ...yesNo('amFailsFax'), title: 'FAX RX A.M.FAILS' },      // [OM p.67: "FAX RX A.M. FAILS", 17 characters on a 16-digit LCD]
  { ...yesNo('duplex'), title: 'DUPLEX RINGING' },            // [OM p.75]
  { ...yesNo('faxSignalRx'), title: 'FAX SIGNAL RX' },        // [OM p.58]
  { ...yesNo('pollingKey'), title: 'POLLING' },               // [OM p.79]
  { ...yesNo('callerId'), title: 'CALLER-ID' },               // [OM p.69]
].map((o) => (o.kind === 'yesno' ? { ...o, prompt: () => '1=YES,2=NO' } : o)));

/** Factory settings: the operation manual's where it gives them, else ours [A]. A warm start then programs the desk. */
export function defaultSettings() {
  return {
    version: 2,
    clock: { set: true, offsetMs: 0 },
    ownNumber: '', ownName: '',
    rxMode: 'FAX',                 // [A] the factory reception mode is not stated
    rings: 2,                      // [OM p.53-54: FAX and TEL/FAX answer on two rings; 2-5]
    remoteCode: 5,                 // [OM p.57: 5 * * from an extension]
    report: 'ERROR',               // [OM p.50: set at the factory to print only when an error occurs]
    dialMode: 'TONE',              // [OM p.14: the fax machine is set for tone dialling]
    quietDetectS: 6,               // [OM p.65: set to 6 seconds at the factory]
    quietStartS: 5,                // [OM p.68: 5 seconds at the factory]
    amFailsFax: false,             // [OM p.67: turned off at the factory]
    duplex: false,                 // [OM p.75]
    faxSignalRx: true,             // [OM p.58: reception begins on a fax tone heard after answering]
    pollingKey: false,             // [OM p.79; SM SW-J1 No. 7, initial 0]
    callerId: false,               // [OM p.69: turned on by the user]
    priority: '',                  // [OM p.73: one number]
    junk: Array(JUNK_COUNT).fill(''),
    speed: Array(SPEED_COUNT).fill(null),     // { number, name } or null
    volume: { speaker: 2, ringer: 2 },        // 1 low, 2 middle, 3 high; ringer 0 off [SM SW-J1: both middle]
    callers: [],                              // the Caller ID list: the most recent 20 [OM p.72]
    country: 'HK',                            // the country select [SM p.2-4]; this manual's edition is Hong Kong's [OM p.75]
    softSwitches: defaultSoftSwitches(),
  };
}

/** A storage interface kept in memory (Node tests; the kit gives one backed by IndexedDB or localStorage). */
export class MemoryStorage {
  constructor(init = {}) { this.data = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)])); this.writes = 0; }
  load(key) { const s = this.data.get(key); return s == null ? null : JSON.parse(s); }
  save(key, value) { this.data.set(key, JSON.stringify(value)); this.writes++; }
}

/** Settings loaded over the defaults (unknown or missing fields take the default). */
export function loadSettings(storage) {
  const base = defaultSettings();
  const saved = storage?.load(STORAGE_KEY);
  if (!saved || typeof saved !== 'object') return { settings: base, loaded: false };
  const s = { ...base, ...saved, clock: { ...base.clock, ...(saved.clock ?? {}) }, volume: { ...base.volume, ...(saved.volume ?? {}) },
    softSwitches: { ...base.softSwitches, ...(saved.softSwitches ?? {}) } };
  if (!RX_MODES.includes(s.rxMode)) s.rxMode = base.rxMode;
  s.speed = Array.from({ length: SPEED_COUNT }, (_, i) => saved.speed?.[i] ?? null);
  s.junk = Array.from({ length: JUNK_COUNT }, (_, i) => saved.junk?.[i] ?? '');
  return { settings: s, loaded: true };
}

/** Digits only, for dialling and comparisons (a pause, '-', dials as a pause). */
export const digitsOf = (s) => String(s ?? '').replace(/[^0-9*#-]/g, '');

/** The speed dial entry (1-based) a rapid key stands for: A-E are 01-05 [OM p.45]. */
export const rapidIndex = (key) => RAPID_KEYS.indexOf(key) + 1;

/** Alternate between two texts every `s` seconds until a key; returns the key (null after the timeout). */
export function* alternate(ui, a, b, timeout = ui.MENU_TIMEOUT, s = 1.5) {
  const end = ui.now + timeout;
  for (let i = 0; ui.now < end; i++) {
    ui.show(i % 2 ? b : a);
    const k = yield* ui.key(Math.min(s, end - ui.now));
    if (k != null) return k;
  }
  return null;
}

// ---- entry helpers (generators run by the firmware's task; `ui` is the firmware) -------------------------------------

/**
 * Digits for a number. Dialled numbers: 0-9, * and #, REDIAL a pause ('-', two seconds) [OM p.41, p.47]. The own
 * number (`ident`): # a space [OM p.21]. SPEED DIAL backspaces [OM p.21, p.41]; in direct keypad dialling STOP does
 * too, and leaves when nothing is left [OM p.47] (`stopBackspace`). Ends on a key of `ends` (START by default), and
 * returns { text, key }; null on a timeout. STOP otherwise throws (the firmware's Stop).
 */
export function* numberEntry(ui, { title = msg('ENTER_FAX_NO'), initial = '', ident = false, max = NUMBER_MAX, first = null,
  ends = ['START'], stopBackspace = false } = {}) {
  let s = initial;
  const put = (k) => {
    if (s.length >= max) return;
    if (ident) s += k === '#' ? ' ' : k === '*' ? '+' : k;
    else s += k;
  };
  if (first) put(first);
  for (;;) {
    ui.show(s ? s : title, { align: s ? 'right' : 'left', cursor: s ? Math.min(s.length, 15) : null });
    const k = yield* (stopBackspace ? ui.keyOrStop(ui.ENTRY_TIMEOUT) : ui.key(ui.ENTRY_TIMEOUT));
    if (k == null) return null;
    if (k === 'STOP') { if (!s) ui.throwStop(); s = s.slice(0, -1); continue; }
    if (ends.includes(k)) return { text: s, key: k };
    if (isDigitKey(k)) put(k);
    else if (k === 'REDIAL' && !ident && s.length < max) s += '-';
    else if (k === 'SPEED_DIAL') s = s.slice(0, -1);
  }
}

/**
 * A name from the keypad [OM p.22]: each press of a key steps through its digit, then its letters (2: 2 A B C, 7: 7 P Q
 * R S, 1: 1 and a space; "SHARP = 77777 444 22 7777 77"); another key moves on. SPEAKER moves the cursor forward (to
 * enter two letters from one key), HOLD/SEARCH back; SPEED DIAL clears the character at the cursor; REDIAL changes
 * case; # and * step through the symbols. START returns the name.
 */
export function* nameEntry(ui, { initial = '', max = NAME_MAX, title = msg('ENTER_NAME') } = {}) {
  const chars = Array.from(initial);
  let cur = chars.length, last = null, idx = 0, lower = false;
  const caseOf = (c) => (lower ? c.toLowerCase() : c.toUpperCase());
  const view = () => { const s = chars.join(''); const from = Math.max(0, cur - 15); return { text: s.slice(from, from + 16), cursor: cur - from }; };
  for (;;) {
    const v = view();
    ui.show(chars.length ? v.text : title, { cursor: v.cursor });
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return null;
    if (k === 'START') return chars.join('').trimEnd();
    if (k === 'SPEAKER') { if (last != null) cur = Math.min(chars.length, cur + 1); else if (cur < chars.length) cur++; last = null; continue; }
    if (k === 'HOLD_SEARCH') { cur = Math.max(0, cur - 1); last = null; continue; }
    if (k === 'SPEED_DIAL') { if (last != null) { chars.splice(cur, 1); last = null; } else if (cur > 0) { cur--; chars.splice(cur, 1); } continue; }
    if (k === 'REDIAL') { lower = !lower; if (last != null) chars[cur] = caseOf(chars[cur]); continue; }
    const cycle = k === '*' || k === '#' ? SYMBOLS : /^[0-9]$/.test(k) ? k + KEY_LETTERS[k] : null;
    if (!cycle) continue;
    const sym = k === '*' || k === '#';
    if (last != null && (k === last || (sym && (last === '*' || last === '#')))) {
      idx = (idx + (k === '*' ? cycle.length - 1 : 1)) % cycle.length;
      chars[cur] = caseOf(cycle[idx]);
      last = k;
      continue;
    }
    if (last != null) cur++;
    if (cur >= max) { last = null; continue; }
    idx = 0; last = k;
    if (cur < chars.length) chars[cur] = caseOf(cycle[0]); else chars.push(caseOf(cycle[0]));
  }
}

/**
 * Date and time [OM p.25]: the current date shown, then two digits for the day, two for the month, four for the year,
 * two each for the hour and minute; SPEED DIAL moves the cursor back; START starts the clock. The display's layout is
 * ours [A]: DD-MM-YYYY HH:MM. Returns { y, mo, d, h, mi } or null.
 */
export function* dateEntry(ui, wall) {
  const p2 = (n) => String(n).padStart(2, '0');
  const d = new Date(wall);
  const s = `${p2(d.getUTCDate())}-${p2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`.split('');
  const slots = [0, 1, 3, 4, 6, 7, 8, 9, 11, 12, 14, 15];
  let i = 0;
  for (;;) {
    ui.show(s.join(''), { cursor: slots[i] });
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return null;
    if (/^[0-9]$/.test(k)) { s[slots[i]] = k; i = Math.min(i + 1, slots.length - 1); continue; }
    if (k === 'SPEED_DIAL') { i = Math.max(0, i - 1); continue; }
    if (k === 'START') {
      const t = s.join('');
      const dd = +t.slice(0, 2), mo = +t.slice(3, 5), y = +t.slice(6, 10), h = +t.slice(11, 13), mi = +t.slice(14, 16);
      if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || h > 23 || mi > 59 || y < 1990) { ui.beep('error'); i = 0; continue; }
      return { y, mo, d: dd, h, mi };
    }
  }
}

/** Two digits 01-40 for a speed dial number ("to enter numbers 1 through 9, first enter 0" [OM p.46]). */
export function* twoDigits(ui, text, { min = 1, max = SPEED_COUNT, rapid = true } = {}) {
  let s = '';
  for (;;) {
    ui.show(s ? lcdPair(text, s) : text);
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return null;
    if (rapid && isRapidKey(k)) return rapidIndex(k);
    if (/^[0-9]$/.test(k)) {
      s += k;
      if (s.length === 2) {
        const n = +s;
        if (n >= min && n <= max) return n;
        ui.beep('error'); s = '';
      }
    }
  }
}

/** SPEED DIAL: two digits 01-40. Returns the 1-based index or null. */
export function* chooseSpeed(ui) { return yield* twoDigits(ui, msg('SPEED_NO')); }

// ---- the FUNCTION modes -------------------------------------------------------------------------------------------------

const ENTRY = ['M_FAXTEL', 'M_OWN', 'M_DATE', 'M_JUNK', 'M_PRIORITY'];

/** FUNCTION: FUNCTION MODE, then 2, 3, 4 or the diagnostic sequence. */
export function* functionMenu(ui) {
  ui.show(msg('FUNCTION_MODE'));
  const k = yield* ui.key(ui.MENU_TIMEOUT);
  if (k === '2') return yield* listingMode(ui);
  if (k === '3') return yield* entryMode(ui);
  if (k === '4') return yield* optionSetting(ui);
  if (k === '9') return yield* ui.diagnostics();
  if (k != null) ui.beep('error');
}

function* stepList(ui, start, items, i, k) {
  if (k === '#') return i == null ? 0 : (i + 1) % items.length;
  if (k === '*') return i == null ? items.length - 1 : (i + items.length - 1) % items.length;
  return i;
}

/** FUNCTION 3: ENTRY MODE [OM p.20, 24, 41, 73, 77]. */
function* entryMode(ui) {
  let i = null;
  for (;;) {
    const k = yield* (i == null ? ui.showKey(msg('M_ENTRY'))
      : ENTRY[i] === 'M_FAXTEL' || ENTRY[i] === 'M_JUNK' || ENTRY[i] === 'M_PRIORITY' ? alternate(ui, msg(ENTRY[i]), msg('SET_CLEAR'))
        : ui.showKey(msg(ENTRY[i])));
    if (k == null) return;
    if (k === '#' || k === '*') { i = yield* stepList(ui, 0, ENTRY, i, k); continue; }
    if (i == null) continue;
    const item = ENTRY[i];
    if (item === 'M_FAXTEL' && (k === '1' || k === '2')) yield* autoDial(ui, k === '1');
    else if (item === 'M_JUNK' && (k === '1' || k === '2')) yield* junkNumbers(ui, k === '1');
    else if (item === 'M_PRIORITY' && (k === '1' || k === '2')) yield* priorityNumber(ui, k === '1');
    else if (item === 'M_OWN' && k === 'START') { yield* ownNumber(ui); i = ENTRY.indexOf('M_DATE'); }
    else if (item === 'M_DATE' && k === 'START') yield* setDate(ui);
  }
}

function* stored(ui) { ui.save(); ui.beep('key'); }

/** FAX/TEL. # MODE: 1=SET or 2=CLEAR, then ENTER SPEED #, the number, START, the name, START; again from ENTER SPEED # until STOP [OM p.41-44]. */
function* autoDial(ui, set) {
  for (;;) {
    const n = yield* (set ? alternateDigits(ui, msg('FAXTEL_SET'), msg('ENTER_SPEED')) : twoDigits(ui, msg('ENTER_SPEED'), { rapid: false }));
    if (n == null) return;
    if (!set) {
      const k = yield* ui.key(ui.ENTRY_TIMEOUT);
      if (k !== 'START') return;
      ui.settings.speed[n - 1] = null; yield* stored(ui); continue;
    }
    const cur = ui.settings.speed[n - 1];
    const num = yield* numberEntry(ui, { initial: cur?.number ?? '' });
    if (num == null) return;
    if (!digitsOf(num.text)) { ui.settings.speed[n - 1] = null; yield* stored(ui); continue; }
    const name = yield* nameEntry(ui, { initial: cur?.name ?? '' });
    if (name == null) return;
    ui.settings.speed[n - 1] = { number: num.text, name };
    yield* stored(ui);
  }
}

/** FAX/TEL. # SET and ENTER SPEED # shown in turn while two digits are entered. */
function* alternateDigits(ui, a, b) {
  const k = yield* alternate(ui, a, b);
  if (k == null || !/^[0-9]$/.test(k)) return null;
  for (let s = k; ;) {
    ui.show(lcdPair(b, s));
    const k2 = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k2 == null) return null;
    if (!/^[0-9]$/.test(k2)) continue;
    s += k2;
    const n = +s;
    if (n >= 1 && n <= SPEED_COUNT) return n;
    ui.beep('error');
    return null;
  }
}

/** OWN NUMBER SET: START, ENTER FAX #, the number (# a space), START, ENTER YOUR NAME, the name, START [OM p.21-23]. */
function* ownNumber(ui) {
  const n = yield* numberEntry(ui, { title: msg('ENTER_FAX_NO'), initial: ui.settings.ownNumber, ident: true });
  if (n == null) return;
  const name = yield* nameEntry(ui, { initial: ui.settings.ownName, title: msg('ENTER_YOUR_NAME') });
  if (name == null) return;
  ui.settings.ownNumber = n.text.trim();
  ui.settings.ownName = name;
  yield* stored(ui);
}

function* setDate(ui) {
  const r = yield* dateEntry(ui, ui.wallMs());
  if (!r) return;
  ui.setClock(r);
  yield* stored(ui);
}

/** STORE JUNK #: 1=SET or 2=CLEAR, a digit 1-5, the number, START [OM p.77-78]. */
function* junkNumbers(ui, set) {
  for (;;) {
    ui.show(msg('JUNK_NO'));
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return;
    if (!/^[1-5]$/.test(k)) continue;
    const j = +k - 1;
    if (!set) { const go = yield* ui.key(ui.ENTRY_TIMEOUT); if (go !== 'START') return; ui.settings.junk[j] = ''; yield* stored(ui); continue; }
    const num = yield* numberEntry(ui, { initial: ui.settings.junk[j] ?? '' });
    if (num == null) return;
    ui.settings.junk[j] = num.text;
    yield* stored(ui);
  }
}

/** PRIORITY CALL #: 1=SET (the number, START) or 2=CLEAR [OM p.73-74]. */
function* priorityNumber(ui, set) {
  if (!set) { ui.settings.priority = ''; yield* stored(ui); return; }
  const num = yield* numberEntry(ui, { initial: ui.settings.priority });
  if (num == null) return;
  ui.settings.priority = num.text;
  yield* stored(ui);
}

/** The prompt shown in turn with an option's title. */
const promptOf = (o, s) => o.prompt(o.kind === 'yesno' ? (s[o.key] ? 1 : 2) : s[o.key]);

/** FUNCTION 4: OPTION SETTING <-> PRESS * OR #; each option alternates with its prompt; a choice stores and moves on. */
function* optionSetting(ui) {
  const s = ui.settings;
  let i = null;
  for (;;) {
    const o = i == null ? null : OPTIONS[i];
    const k = yield* (o ? alternate(ui, o.title, promptOf(o, s)) : alternate(ui, msg('M_OPTION'), msg('PRESS_STAR_HASH')));
    if (k == null) return;
    if (k === '#' || k === '*') { i = yield* stepList(ui, 0, OPTIONS, i, k); continue; }
    if (!o || !/^[0-9]$/.test(k)) continue;
    const d = +k;
    let ok = false, said = null;
    if (o.kind === 'digit' && d >= o.min && d <= o.max) { s[o.key] = d; ok = true; }
    else if (o.kind === 'two') {
      ui.show(lcdPair(o.title, k));
      const k2 = yield* ui.key(ui.ENTRY_TIMEOUT);
      if (k2 == null) return;
      const v = d * 10 + (/^[0-9]$/.test(k2) ? +k2 : NaN);
      if (v >= o.min && v <= o.max) { s[o.key] = v; ok = true; }
    } else if (o.kind === 'report' && d >= 1 && d <= 4) { s.report = REPORT_CHOICES[d - 1][0]; ok = true; }
    else if (o.kind === 'dial' && (d === 1 || d === 2)) { s.dialMode = d === 1 ? 'TONE' : 'PULSE'; ok = true; said = d === 1 ? 'TONE_SELECTED' : 'PULSE_SELECTED'; }
    else if (o.kind === 'yesno' && (d === 1 || d === 2)) { s[o.key] = d === 1; ok = true; }
    if (!ok) { ui.beep('error'); continue; }
    ui.save(); ui.beep('key');
    if (said) { const k3 = yield* ui.flash(msg(said), 1.5); if (k3 === '#' || k3 === '*') { i = yield* stepList(ui, 0, OPTIONS, i, k3); continue; } if (k3 != null) continue; }
    i = (i + 1) % OPTIONS.length;      // a choice moves on to the next option [OM p.54]
  }
}

/** FUNCTION 2: LISTING MODE; * the Anti Junk Number List, # the Telephone Number List; START prints [OM p.81]. */
function* listingMode(ui) {
  let pick = null;
  for (;;) {
    const k = yield* ui.showKey(pick ? msg(pick === 'junk' ? 'L_JUNK' : 'L_TEL') : msg('M_LIST'));
    if (k == null) return;
    if (k === '*') pick = 'junk';
    else if (k === '#') pick = 'tel';
    else if (k === 'START' && pick) { yield* ui.printList(pick); return; }
  }
}

/** Is a calling number or a TSI on the Anti Junk Number List? Compared on the last seven digits [A]. */
export function isJunk(settings, number) {
  const d = digitsOf(number).replace(/-/g, '');
  if (d.length < 4) return false;
  const tail = (x) => x.slice(-7);
  return settings.junk.some((j) => { const jd = digitsOf(j).replace(/-/g, ''); return jd.length >= 4 && tail(jd) === tail(d); });
}
