// The user settings and the FUNCTION menu: date and time, own fax number and name (TSI/CSI and header), the 35 speed
// dial numbers (01-05 also on rapid keys A-E), the options (rings to answer, print contrast, pseudo ring, the
// transmission report, Caller ID, Distinctive Ring, fax blocking, header, dial mode), the junk fax numbers and the
// lists. The operation manual names the functions [S: its contents list]; the menu's numbering, wording and key use
// are ours [A] until the manual is read. Settings persist through a storage interface (devices.md).

import { msg } from './messages.js';
import { isDigitKey, isRapidKey, RAPID_KEYS, KEY_LETTERS, SYMBOLS, lcdPair } from './panel.js';

export const STORAGE_KEY = 'faxfo70.settings';
export const JOURNAL_KEY = 'faxfo70.journal';
export const SPEED_COUNT = 35;           // [S]
export const JUNK_COUNT = 5;             // [A]
export const NAME_MAX = 16;              // [A]
export const NUMBER_MAX = 20;            // the TSI/CSI field holds 20 characters (T.30)

export const RX_MODES = ['FAX', 'TEL', 'TEL/FAX', 'A.M.'];   // FAX and TEL/FAX [S]; TEL and A.M. [A]

export const OPTIONS = Object.freeze([
  { key: 'rings',       title: 'O_RINGS',     values: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), n]), digitIsValue: true },
  { key: 'contrast',    title: 'O_CONTRAST',  values: [['NORMAL', 'NORMAL'], ['DARK', 'DARK']] },
  { key: 'pseudoRingS', title: 'O_PSEUDO',    values: [['15 SEC', 15], ['20 SEC', 20], ['30 SEC', 30]] },
  { key: 'report',      title: 'O_REPORT',    values: [['ALWAYS', 'ALWAYS'], ['ERROR', 'ERROR'], ['NEVER', 'NEVER']] },
  { key: 'callerId',    title: 'O_CALLER_ID', values: [['YES', true], ['NO', false]] },
  { key: 'distinctive', title: 'O_DISTINCT',  values: [['YES', true], ['NO', false]] },
  { key: 'blocking',    title: 'O_BLOCKING',  values: [['YES', true], ['NO', false]] },
  { key: 'header',      title: 'O_HEADER',    values: [['YES', true], ['NO', false]] },
  { key: 'dialMode',    title: 'O_DIAL',      values: [['TONE', 'TONE'], ['PULSE', 'PULSE']] },
]);

/** Factory settings [A]. A warm start then programs the desk's numbers (main.js). */
export function defaultSettings() {
  return {
    version: 1,
    clock: { set: true, offsetMs: 0 },
    ownNumber: '', ownName: '',
    rxMode: 'FAX',
    rings: 2,
    contrast: 'NORMAL',
    pseudoRingS: 15,
    report: 'ERROR',
    callerId: false,
    distinctive: false,
    blocking: false,
    header: true,
    dialMode: 'TONE',
    junk: Array(JUNK_COUNT).fill(''),
    speed: Array(SPEED_COUNT).fill(null),     // { number, name } or null
    volume: { speaker: 2, ringer: 2 },        // 1 low, 2 middle, 3 high; ringer 0 off
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
  const s = { ...base, ...saved, clock: { ...base.clock, ...(saved.clock ?? {}) }, volume: { ...base.volume, ...(saved.volume ?? {}) } };
  s.speed = Array.from({ length: SPEED_COUNT }, (_, i) => saved.speed?.[i] ?? null);
  s.junk = Array.from({ length: JUNK_COUNT }, (_, i) => saved.junk?.[i] ?? '');
  return { settings: s, loaded: true };
}

/** Digits only, for dialling and comparisons. */
export const digitsOf = (s) => String(s ?? '').replace(/[^0-9*#]/g, '');

/** The speed dial entry (1-based) a rapid key stands for: A-E are 01-05 [A]. */
export const rapidIndex = (key) => RAPID_KEYS.indexOf(key) + 1;

// ---- entry helpers (generators run by the firmware's task; `ui` is the firmware) -------------------------------------

/**
 * Digits for a number: 0-9, # and * as dialled; in `ident` form # is a space and * a plus, for the own number.
 * HOLD/SEARCH deletes. START returns the text; STOP throws (the firmware's Stop).
 */
export function* numberEntry(ui, { title = msg('ENTER_FAX_NO'), initial = '', ident = false, max = NUMBER_MAX, first = null } = {}) {
  let s = initial;
  const put = (k) => {
    if (s.length >= max) return;
    if (ident) s += k === '#' ? ' ' : k === '*' ? '+' : k;
    else s += k;
  };
  if (first) put(first);
  for (;;) {
    ui.show(s ? s : title, { align: s ? 'right' : 'left', cursor: s ? Math.min(s.length, 15) : null });
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return null;
    if (isDigitKey(k)) put(k);
    else if (k === 'HOLD_SEARCH') s = s.slice(0, -1);
    else if (k === 'START') return s;
  }
}

/** A name from the keypad's letters: repeated presses cycle a key's letters and its digit; # moves on (twice: a space); * cycles symbols; HOLD/SEARCH deletes. */
export function* nameEntry(ui, { initial = '', max = NAME_MAX } = {}) {
  let s = initial;
  let last = null, idx = 0;
  for (;;) {
    ui.show(s || msg('ENTER_NAME'), { cursor: Math.min(s.length, 15) });
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return null;
    if (k === 'START') return s.trimEnd();
    if (k === 'HOLD_SEARCH') { s = s.slice(0, -1); last = null; continue; }
    if (k === '#') { if (last == null && s.length < max) s += ' '; last = null; continue; }
    const cycle = k === '*' ? SYMBOLS : /^[0-9]$/.test(k) ? KEY_LETTERS[k] + k : null;
    if (!cycle) continue;
    if (k === last) { idx = (idx + 1) % cycle.length; s = s.slice(0, -1) + cycle[idx]; continue; }
    if (s.length >= max) continue;
    last = k; idx = 0; s += cycle[0];
  }
}

/** Date and time on the template MM-DD-YYYY HH:MM (North American order [A]); returns { y, mo, d, h, mi } or null. */
export function* dateEntry(ui, wall) {
  const p2 = (n) => String(n).padStart(2, '0');
  const d = new Date(wall);
  let s = `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}-${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`.split('');
  const slots = [0, 1, 3, 4, 6, 7, 8, 9, 11, 12, 14, 15];
  let i = 0;
  for (;;) {
    ui.show(s.join(''), { cursor: slots[i] });
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return null;
    if (/^[0-9]$/.test(k)) { s[slots[i]] = k; i = (i + 1) % slots.length; continue; }
    if (k === 'START') {
      const t = s.join('');
      const mo = +t.slice(0, 2), dd = +t.slice(3, 5), y = +t.slice(6, 10), h = +t.slice(11, 13), mi = +t.slice(14, 16);
      if (mo < 1 || mo > 12 || dd < 1 || dd > 31 || h > 23 || mi > 59 || y < 1990) { ui.beep('error'); i = 0; continue; }
      return { y, mo, d: dd, h, mi };
    }
  }
}

// ---- the menu ---------------------------------------------------------------------------------------------------------

const MAIN = ['M_DATE', 'M_ID', 'M_TEL', 'M_OPTION', 'M_JUNK', 'M_LIST'];
const LISTS = [['L_TEL', 'tel'], ['L_SETUP', 'setup'], ['L_ACTIVITY', 'activity'], ['L_TRANS', 'transmission'], ['L_HELP', 'help']];

/** The FUNCTION menu: FUNCTION steps through the items, a digit or START chooses, STOP leaves. */
export function* functionMenu(ui) {
  let i = 0;
  for (;;) {
    ui.show(msg(MAIN[i]));
    const k = yield* ui.key(ui.MENU_TIMEOUT);
    if (k == null) return;
    let pick = null;
    if (k === 'FUNCTION') { i = (i + 1) % MAIN.length; continue; }
    if (k === 'START') pick = i;
    else if (/^[1-6]$/.test(k)) pick = +k - 1;
    if (pick == null) continue;
    i = pick;
    const item = MAIN[pick];
    if (item === 'M_DATE') yield* setDate(ui);
    else if (item === 'M_ID') yield* setIdent(ui);
    else if (item === 'M_TEL') yield* setSpeed(ui);
    else if (item === 'M_OPTION') yield* setOptions(ui);
    else if (item === 'M_JUNK') yield* setJunk(ui);
    else if (item === 'M_LIST') { const done = yield* printLists(ui); if (done) return; }
  }
}

function* stored(ui) { ui.save(); ui.beep('key'); yield* ui.flash(msg('STORED'), 1); }

function* setDate(ui) {
  const r = yield* dateEntry(ui, ui.wallMs());
  if (!r) return;
  ui.setClock(r);
  yield* stored(ui);
}

function* setIdent(ui) {
  ui.show(msg('OWN_NUMBER'));
  yield* ui.pause(1);
  const n = yield* numberEntry(ui, { title: msg('OWN_NUMBER'), initial: ui.settings.ownNumber, ident: true });
  if (n == null) return;
  const name = yield* nameEntry(ui, { initial: ui.settings.ownName });
  if (name == null) return;
  ui.settings.ownNumber = n.trim();
  ui.settings.ownName = name;
  yield* stored(ui);
}

/** Choose a speed dial entry: two digits 01-35 or a rapid key. Returns the 1-based index or null. */
export function* chooseSpeed(ui) {
  let s = '';
  for (;;) {
    ui.show(s ? lcdPair(msg('SPEED_NO').slice(0, 7), s) : msg('SPEED_NO'));
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return null;
    if (isRapidKey(k)) return rapidIndex(k);
    if (/^[0-9]$/.test(k)) {
      s += k;
      if (s.length === 2) {
        const n = +s;
        if (n >= 1 && n <= SPEED_COUNT) return n;
        ui.beep('error'); s = '';
      }
    }
  }
}

function* setSpeed(ui) {
  for (;;) {
    const n = yield* chooseSpeed(ui);
    if (n == null) return;
    const cur = ui.settings.speed[n - 1];
    const num = yield* numberEntry(ui, { initial: cur?.number ?? '' });
    if (num == null) return;
    if (!digitsOf(num)) { ui.settings.speed[n - 1] = null; yield* stored(ui); continue; }
    const name = yield* nameEntry(ui, { initial: cur?.name ?? '' });
    if (name == null) return;
    ui.settings.speed[n - 1] = { number: num, name };
    yield* stored(ui);
  }
}

function* setOptions(ui) {
  for (let i = 0; i < OPTIONS.length;) {
    const o = OPTIONS[i];
    let vi = Math.max(0, o.values.findIndex(([, v]) => v === ui.settings[o.key]));
    for (;;) {
      ui.show(lcdPair(msg(o.title), o.values[vi][0]));
      const k = yield* ui.key(ui.MENU_TIMEOUT);
      if (k == null) return;
      if (k === 'FUNCTION') { i++; break; }
      if (k === 'START') { ui.settings[o.key] = o.values[vi][1]; ui.save(); ui.beep('key'); i++; break; }
      if (/^[1-9]$/.test(k) && +k <= o.values.length) vi = +k - 1;
    }
  }
}

function* setJunk(ui) {
  for (;;) {
    ui.show(msg('JUNK_NO'));
    const k = yield* ui.key(ui.ENTRY_TIMEOUT);
    if (k == null) return;
    if (!/^[1-5]$/.test(k)) continue;
    const j = +k - 1;
    const num = yield* numberEntry(ui, { initial: ui.settings.junk[j] ?? '' });
    if (num == null) return;
    ui.settings.junk[j] = num;
    yield* stored(ui);
  }
}

function* printLists(ui) {
  let i = 0;
  for (;;) {
    ui.show(msg(LISTS[i][0]));
    const k = yield* ui.key(ui.MENU_TIMEOUT);
    if (k == null) return false;
    let pick = null;
    if (k === 'FUNCTION') { i = (i + 1) % LISTS.length; continue; }
    if (k === 'START') pick = i;
    else if (/^[1-5]$/.test(k)) pick = +k - 1;
    if (pick == null) continue;
    yield* ui.printList(LISTS[pick][1]);
    return true;
  }
}

/** Is a calling number or a TSI on the junk list? Compared on the last seven digits [A]. */
export function isJunk(settings, number) {
  const d = digitsOf(number);
  if (!settings.blocking || d.length < 4) return false;
  const tail = (x) => x.slice(-7);
  return settings.junk.some((j) => digitsOf(j).length >= 4 && tail(digitsOf(j)) === tail(d));
}
