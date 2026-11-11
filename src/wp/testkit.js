// Keystroke scripts and screen matchers for Node tests (architecture 12.1). A script is written as in the worked
// examples of software-screens.md section 4:
//   run(sys, 'a ENTER a ENTER "First Letter" ENTER "WORK01" ENTER ENTER')
// Quoted text is typed character by character (with SHIFT where needed); bare words are key names, CODE+X and
// CONTROL+X are chords, a single character is that key, and NAME*n repeats. Each keystroke goes in as the scan bytes
// the keyboard would send, through sys.deviceEvent, so key decoding is part of every script.
import { createSystem } from './index.js';
import { VirtualDevices } from './devices/virtual.js';
import { Library, programDiskette, workDiskette, blankDiskette, PROGRAM_NAME } from './disk/library.js';
import { MemoryStore } from './disk/store.js';
import { POS, strokeBytes, keyForChar, TYPEMATIC } from './keys.js';

const ALIAS = {
  RET: 'RETURN', '↓': 'DOWN', '↑': 'UP', '←': 'LEFT', '→': 'RIGHT', SPACE: 'SPACE',
  CANCL: 'CODE+REQST', 'INSERT/REPLACE': 'CODE+8', OVERSTRIKE: 'CODE+DEL', COPY: 'CODE+MOVE', GLOBAL: 'CODE+FIND',
  'MENU BYPASS': 'CODE+GO TO', 'SCREEN FORMAT': 'CODE+END', REPLY: 'CODE+MSG', INSTR: 'CODE+CHG FMT',
  'SCREEN UP': 'CODE+SCREEN DOWN', 'SCREEN LEFT': 'CODE+SCREEN RIGHT', 'KYB CHG': 'CODE+PRINT', REQD: 'CODE+PAGE END',
  'KEY SAVE': 'CODE+KEY PLAYBCK', CTR: 'CODE+c', 'WORD UND': 'CODE+i', 'BEGIN UND': 'CODE+u', 'END UND': 'CODE+j',
};
const TWO_WORD = ['GO TO', 'PAGE END', 'CHG FMT', 'LINE ADJ', 'SCREEN DOWN', 'SCREEN RIGHT', 'KEY PLAYBCK', 'MATH REQUEST',
  'COLUMN ADD', 'MENU BYPASS', 'SCREEN FORMAT', 'SCREEN UP', 'SCREEN LEFT', 'KYB CHG', 'KEY SAVE', 'WORD UND', 'BEGIN UND',
  'END UND'];

/** A system with virtual devices: program diskette left, work diskettes as given (first one right). */
export function boot({ work = ['TRAIN'], blank = [], cold = false, type = '2D', setup, settle = !cold } = {}) {
  const library = new Library();
  library.add(programDiskette());
  for (const name of work) library.add(workDiskette(name, name, type));
  for (const id of blank) library.add(blankDiskette(id, type));
  setup?.(library);
  const right = work[0] ?? blank[0];
  const devices = new VirtualDevices({
    drives: [{ mediaId: PROGRAM_NAME, type: '2D' }, right ? { mediaId: right, type: library.get(right).type } : null],
  });
  if (cold) devices.drives.forEach((d) => { d.media = null; });
  const sys = createSystem({ devices, store: new MemoryStore(), library, options: { cold } });
  if (settle) sys.runUntilIdle();
  return { sys, devices, library };
}

/** Script tokens to keystrokes: { pos, shift, code, control }. */
export function strokes(script) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  const words = [];
  let m;
  while ((m = re.exec(script))) words.push(m[1] !== undefined ? { text: m[1].replace(/\\(.)/g, '$1') } : { word: m[2] });
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.text !== undefined) {
      for (const ch of w.text) out.push(charStroke(ch));
      continue;
    }
    let word = w.word;
    const next = words[i + 1]?.word;
    if (next && TWO_WORD.includes(`${word.replace(/^(CODE|CONTROL)\+/, '')} ${next.replace(/\*\d+$/, '')}`)) { word = `${word} ${next}`; i++; }
    let n = 1;
    const rep = /^(.*?)[*×](\d+)$/.exec(word);
    if (rep) { word = rep[1]; n = +rep[2]; }
    for (let k = 0; k < n; k++) out.push(namedStroke(word));
  }
  return out;
}

function charStroke(ch) {
  const k = keyForChar(ch);
  if (!k) throw new Error(`no key types ${JSON.stringify(ch)}`);
  return { pos: k.pos, shift: k.shift };
}

function namedStroke(word) {
  let code = false, control = false;
  for (;;) {
    word = ALIAS[word] ?? word;
    if (word.startsWith('CODE+')) { code = true; word = word.slice(5); }
    else if (word.startsWith('CONTROL+')) { control = true; word = word.slice(8); }
    else break;
  }
  if (word.length === 1) return { ...charStroke(word), code, control };
  const pos = POS[word];
  if (!pos) throw new Error(`unknown key ${word}`);
  return { pos, shift: false, code, control };
}

/** Deliver one keystroke's scan bytes. */
export function press(sys, s, { repeat = false } = {}) {
  for (const byte of strokeBytes(s.pos, { ...s, repeat })) sys.deviceEvent({ dev: 'kbd', ev: 'scan', byte });
}

/**
 * Run a script. Each keystroke is delivered after the previous one has been dealt with and `gap` seconds have
 * passed; with typeAhead every keystroke goes in at once and the system catches up afterwards.
 */
export function run(sys, script, { gap = 0.15, typeAhead = false } = {}) {
  for (const s of strokes(script)) {
    press(sys, s);
    if (!typeAhead) { sys.runUntilIdle(); sys.advance(sys.now + gap); }
  }
  sys.runUntilIdle();
}

/** Hold a key down for `seconds`: the keyboard's typematic repeats after 350 ms, then 14 a second (HW 2.2). */
export function hold(sys, script, seconds) {
  const [s] = strokes(script);
  const t0 = sys.now;
  press(sys, s);
  sys.runUntilIdle();
  if (!TYPEMATIC.has(s.pos)) { sys.advance(t0 + seconds); return; }
  for (let t = 0.35; t <= seconds + 1e-9; t += 1 / 14) {
    sys.advance(t0 + t);
    press(sys, s, { repeat: true });
    sys.runUntilIdle();
  }
  sys.advance(t0 + seconds);
}

export function row(sys, r) { return sys.screen.text(r); }

/** Compare a row with an expected text: `~` matches any cell; trailing blanks are ignored. */
export function rowMatches(actual, expected) {
  const e = expected.padEnd(80).slice(0, 80);
  for (let i = 0; i < 80; i++) if (e[i] !== '~' && e[i] !== actual[i]) return false;
  return true;
}

export function expectRow(sys, r, expected) {
  const actual = row(sys, r);
  if (!rowMatches(actual, expected)) throw new Error(`row ${r}\n  expected: ${JSON.stringify(expected.trimEnd())}\n  actual:   ${JSON.stringify(actual.trimEnd())}`);
}

/** Compare the whole screen with a 25-line fixture; reports every row that differs. */
export function expectScreen(sys, fixture) {
  const lines = fixture.replace(/\n$/, '').split('\n');
  const bad = [];
  for (let r = 1; r <= 25; r++) {
    const exp = lines[r - 1] ?? '';
    const act = row(sys, r);
    if (!rowMatches(act, exp)) bad.push(`row ${r}\n  expected: ${JSON.stringify(exp.trimEnd())}\n  actual:   ${JSON.stringify(act.trimEnd())}`);
  }
  if (bad.length) throw new Error(`screen differs:\n${bad.join('\n')}`);
}

/** Row and column (1-based) of the first occurrence of text in the typing area, or null. */
export function findOnScreen(sys, text, from = 4, to = 23) {
  for (let r = from; r <= to; r++) {
    const c = row(sys, r).indexOf(text);
    if (c >= 0) return { row: r, col: c + 1 };
  }
  return null;
}
