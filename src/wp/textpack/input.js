// Keys as tasks take them, and the prompt line. MSG is the operator's at any moment (ORG p.480), so it is handled
// here and never reaches a task. The prompt line implements the first two CANCL levels (SR 3.2): the first CANCL
// clears the typed answer, the second removes the prompt.
import { key } from '../sched.js';
import { ROW, ATTR } from '../screen.js';
import { SYMBOL_TEXT, SYM } from '../charset.js';
import { fmt } from './messages.js';

/** Thrown to unwind nested menus and tasks to the shell, which then shows `target` (Menu Bypass, Go to Task Selection). */
export class Navigate {
  constructor(target) { this.target = target; }
}

export const SEP = SYMBOL_TEXT[SYM.SEPARATOR];      // CODE+M between a document name and a diskette name (ORG p.447)

export const isCancel = (ev) => ev.name === 'REQST' && ev.code;
export const isEnter = (ev) => ev.name === 'ENTER' && !ev.code;
export const isChar = (ev) => ev.ch != null && !ev.code && !ev.control;

export function* getKey(sys, accept) {
  for (;;) {
    const ev = yield* key((e) => (e.name === 'MSG' && !e.code) || !accept || accept(e));
    if (ev.name === 'MSG' && !ev.code) { sys.messages.next(); continue; }
    return ev;
  }
}

/** Draw the prompt line: highlighted prompt text, then the answer with the cursor after it. */
export function drawPrompt(sys, text, answer = '', { cursor = true } = {}) {
  const s = sys.screen;
  s.clearRows(ROW.PROMPT);
  s.put(ROW.PROMPT, 1, text, ATTR.BRIGHT);
  if (answer === null) { s.setCursor(ROW.PROMPT, 1, false); return; }
  const start = text.length + 2;
  const room = 80 - start;
  const shown = answer.length > room ? answer.slice(answer.length - room) : answer;
  s.put(ROW.PROMPT, start, shown);
  s.setCursor(ROW.PROMPT, Math.min(80, start + shown.length), cursor);
}

/**
 * A prompt with a typed answer. Returns the answer, or null when the operator cancels it (CANCL twice, END, or REPLY).
 * `suggest` pre-fills the answer (TB1 p.12): ENTER takes it, BKSP edits it, typing replaces it (the scripts of SS 4
 * type names over suggestions); `sep` lets CODE+M insert the document/diskette separator.
 */
export function* promptLine(sys, textKey, { suggest = '', max = 60, args, sep = false, digits = false } = {}) {
  const text = fmt(textKey, args);
  let answer = suggest;
  let suggested = !!suggest;         // a suggestion is replaced by the first character typed, edited by BKSP
  for (;;) {
    drawPrompt(sys, text, answer);
    const ev = yield* getKey(sys, (e) => isChar(e) || isEnter(e) || isCancel(e) || e.name === 'BKSP' || e.name === 'END'
      || (sep && e.code && e.name === 'm') || (e.code && e.name === 'MSG'));
    if (isEnter(ev)) return answer;
    if (ev.name === 'END' || (ev.code && ev.name === 'MSG')) return null;
    if (isCancel(ev)) { sys.messages.clear(); if (answer) answer = ''; else return null; continue; }
    suggested &&= ev.name !== 'BKSP';
    if (ev.name === 'BKSP') { answer = answer.slice(0, -1); continue; }
    if (ev.code && ev.name === 'm') { suggested = false; if (!answer.includes(SEP)) answer += SEP; continue; }
    if (digits && !/[0-9.]/.test(ev.ch)) continue;
    if (suggested) { answer = ''; suggested = false; }
    if (answer.length < max + (answer.includes(SEP) ? 7 : 0)) answer += ev.ch;
  }
}

/** Split "document<SEP>diskette". */
export function splitName(s) {
  const i = s.indexOf(SEP);
  return i < 0 ? { name: s, disk: null } : { name: s.slice(0, i), disk: s.slice(i + 1) };
}
