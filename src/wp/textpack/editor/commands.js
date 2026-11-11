// The typing area: keys to edits and cursor moves on the page in memory (SR 4). Typed text goes in at the cursor
// (Insert, the default) or over it (Replace, CODE+8). With Auto Adjust on, each edit re-adjusts the line endings of
// its paragraph. Codes come from their keys as the WORK STATION DESCRIPTION sets them (SR 4.2, 4.3). The cursor
// moves a unit at a time sideways, a line at a time up and down keeping its column, and into the Non-Typing Area
// to the right of a line's end, where nothing can be typed (ORG p.560). Down from the last line shows the next page.
import { C, info, isChar, isEnd } from './codes.js';
import { reflowParagraph, formatAt } from './layout.js';
import { drawTyping, relayout, cursorPos, cursorLine, SEGMENT_STEP } from './view.js';
import { getKey, isCancel } from '../input.js';
import { DiskError } from '../../disk/fs.js';
import { requestTasks } from '../tasks/common.js';
import { TEXT_ROWS } from '../../screen.js';

/** Extensions: the editing functions (DEL, MOVE, FIND ...) register their keys here. */
export const FUNCTIONS = [];

export function newEditor(sys, doc) {
  return {
    sys, doc, cur: 0, nta: null, want: null, insert: true, top: 0, segLeft: null, displayCodes: false,
    fn: '', prompt: null, sel: null, L: null,
  };
}

const INERT = new Set(['KEY PLAYBCK', 'MATH REQUEST', 'COLUMN ADD', 'PLUS', 'MINUS', 'COLUMN']);

/** Run the typing area until END. */
export function* typingArea(sys, doc, ed = newEditor(sys, doc)) {
  sys.doc = doc;
  for (;;) {
    drawTyping(sys, ed);
    const ev = yield* getKey(sys, (e) => accepts(ed, e));
    try {
      if ((yield* handle(sys, ed, ev)) === 'end') return ed;
    } catch (err) {
      if (!(err instanceof DiskError)) throw err;
      sys.messages.show('diskError', { disk: doc.vol.name });
      if (ev.name === 'END') return ed;      // abandoned: the document stays open on the diskette, to be recovered
    }
  }
}

function accepts(ed, e) {
  if (INERT.has(e.name) && !e.code) return false;
  if (e.ch != null && !e.code && !e.control && ed.nta != null) return false;    // nothing types in the Non-Typing Area
  return true;
}

// ---- edits ---------------------------------------------------------------------------------------------------------

export const buf = (ed) => ed.doc.page.buf;
export const objects = (ed) => ed.doc.page.objects;
export function touched(ed) { ed.doc.page.dirty = true; ed.want = null; }

export function autoAdjust(ed, at) {
  const p = ed.doc.page;
  return ed.sys.settings.autoCR === 1 && formatAt(p.buf.toArray(), p.objects, at, ed.doc.layoutCtx(p.k)).adjust === 1;
}

/** Re-adjust the paragraph around unit `at`, keeping the cursor on the same unit. */
export function adjust(ed, at, force = false) {
  if (!force && !autoAdjust(ed, at)) return;
  const p = ed.doc.page;
  const r = reflowParagraph(p.buf.toArray(), p.objects, at, ed.doc.layoutCtx(p.k));
  if (!r.changed) return;
  p.buf.reset(r.units);
  ed.cur = r.map(ed.cur);
  if (ed.sel) ed.sel = ed.sel.map(r.map);
}

/** Insert units at the cursor (or over it in Replace mode) and move past them. */
export function typeUnits(ed, units) {
  const b = buf(ed);
  const over = !ed.insert && units.length === 1 && isEnd(units[0]) === false && replaceable(b.at(ed.cur));
  const before = lnOf(ed);
  if (over) b.set(ed.cur, units[0]); else b.insert(ed.cur, units);
  ed.cur += units.length;
  touched(ed);
  adjust(ed, ed.cur - 1);
  bells(ed, before);
}

const replaceable = (u) => isChar(u) || u === C.RSP || u === C.RHY;

function lnOf(ed) { relayout(ed); return { ln: ed.L.lines[cursorLine(ed)].ln, pos: cursorPos(ed) }; }

/**
 * The short beeps (ORG p.53): passing the Last Typing Line, and with Auto Adjust off, typing into the zone before
 * the right margin, like a typewriter's bell.
 */
function bells(ed, before) {
  const L = relayout(ed);
  const line = L.lines[cursorLine(ed)];
  const f = line.fmtEnd;
  if (before.ln <= f.lastLine && line.ln > f.lastLine) ed.sys.tone('short');
  else if (!autoAdjust(ed, ed.cur) && line.ln === before.ln) {
    const zone = f.rm - f.zone + 1;
    if (before.pos < zone && cursorPos(ed) >= zone) ed.sys.tone('short');
  }
}

function backspace(ed) {
  const L = ed.L;
  if (ed.nta != null || ed.cur === L.lines[cursorLine(ed)].start) return;      // ignored at the left margin (ORG p.258)
  const u = buf(ed).at(ed.cur - 1);
  if (info(u, objects(ed)).bksp === false) return;
  buf(ed).delete(ed.cur - 1, 1);
  ed.cur--;
  touched(ed);
  adjust(ed, ed.cur);
}

// ---- cursor --------------------------------------------------------------------------------------------------------

export function moveTo(ed, i) {
  ed.cur = Math.max(0, Math.min(i, buf(ed).length - 1));
  ed.nta = null;
}

/** Put the cursor on line li at scale position want, or in the Non-Typing Area past the line's end. */
export function placeOnLine(ed, li, want) {
  const L = ed.L, line = L.lines[li];
  let j = line.start;
  for (let k = line.start; k < line.end; k++) {
    if (L.pos[k] <= want && (L.w[k] > 0 || isEnd(L.units[k]))) j = k;
  }
  ed.cur = j;
  ed.nta = isEnd(L.units[j]) && want > L.pos[j] ? want : null;
  ed.want = want;
}

export function* gotoPage(ed, k, { line = 'top', want = null } = {}) {
  const d = ed.doc;
  if (k !== d.page.k) {
    yield* d.storePage();
    yield* d.loadPage(k);
  }
  ed.top = 0; ed.nta = null;
  relayout(ed);
  if (line === 'bottom') {
    const li = ed.L.lines.length - 1;
    placeOnLine(ed, li, want ?? ed.L.lines[li].fmtEnd.lm);
  } else { ed.cur = 0; if (want != null) placeOnLine(ed, 0, want); }
}

function* vertical(ed, d) {
  const L = ed.L, want = ed.want ?? cursorPos(ed);
  const li = cursorLine(ed) + d;
  const k = ed.doc.page.k;
  if (li < 0) { if (k > 0) yield* gotoPage(ed, k - 1, { line: 'bottom', want }); return; }
  if (li >= L.lines.length) { if (k + 1 < ed.doc.pages.length) yield* gotoPage(ed, k + 1, { want }); return; }
  placeOnLine(ed, li, want);
}

function horizontal(ed, d) {
  const L = ed.L;
  if (d > 0) {
    if (ed.nta != null) { const ln = L.lines[cursorLine(ed)]; if (ln.end < L.units.length) moveTo(ed, ln.end); }
    else moveTo(ed, ed.cur + 1);
  } else if (ed.nta != null) ed.nta = null;
  else moveTo(ed, ed.cur - 1);
  ed.want = null;
}

function boundary(ed, name) {
  const line = ed.L.lines[cursorLine(ed)];
  if (name === 'UP') moveTo(ed, 0);
  else if (name === 'DOWN') moveTo(ed, buf(ed).length - 1);
  else if (name === 'LEFT') moveTo(ed, line.start);
  else moveTo(ed, Math.max(line.start, line.end - 2));
  ed.want = null;
}

/** SCREEN DOWN and SCREEN UP (ORG p.510, 511). */
function* screenVertical(ed, down) {
  const L = ed.L, cl = cursorLine(ed), want = ed.want ?? cursorPos(ed);
  const k = ed.doc.page.k;
  if (down) {
    const target = cl === ed.top ? ed.top + TEXT_ROWS - 1 : cl;
    if (target >= L.lines.length - 1 && cl === ed.top && k + 1 < ed.doc.pages.length) { yield* gotoPage(ed, k + 1, { want }); return; }
    const li = Math.min(target, L.lines.length - 1);
    ed.top = li;
    placeOnLine(ed, li, want);
  } else {
    if (cl === 0 && k > 0) { yield* gotoPage(ed, k - 1, { line: 'bottom', want }); return; }
    const li = cl - ed.top === TEXT_ROWS - 1 ? Math.max(0, cl - TEXT_ROWS + 1) : cl;
    ed.top = Math.max(0, li - TEXT_ROWS + 1);
    placeOnLine(ed, li, want);
  }
}

/** SCREEN RIGHT and SCREEN LEFT (ORG p.509, 510). */
function screenHorizontal(ed, right) {
  const p = cursorPos(ed);
  if (right) ed.segLeft = p === ed.segLeft ? ed.segLeft + SEGMENT_STEP : p;
  else ed.segLeft = p === ed.segLeft + 79 ? Math.max(1, ed.segLeft - SEGMENT_STEP) : Math.max(1, p - 79);
  placeOnLine(ed, cursorLine(ed), right ? ed.segLeft : Math.min(p, ed.segLeft + 79));
}

// ---- keys ----------------------------------------------------------------------------------------------------------

const ARROW = { UP: -1, DOWN: 1 };

/** The code a key gives, by the WORK STATION DESCRIPTION (SR 4.2, 4.3). */
function codeFor(sys, ev) {
  const s = sys.settings;
  if (ev.control) return { RETURN: C.ZICR, z: C.SUB }[ev.name] ?? null;
  if (ev.code) {
    return {
      SPACE: C.RSP, '-': s.reqHyphen === 2 ? C.SHY : C.RHY, RETURN: s.reqCR === 2 ? C.CR : C.RCR, TAB: C.RTAB,
      INDEX: C.IDXR, BKSP: C.RBS, y: C.HUP, h: C.HDN, u: C.BUND, j: C.EUND, i: C.WUND, c: C.CTR, 9: C.STOP,
      k: C.SWITCH, 'PAGE END': C.RPE,
    }[ev.name] ?? null;
  }
  if (ev.name === '-') return ev.ch === '_' ? C.CUND : s.reqHyphen === 2 ? C.RHY : C.SHY;
  if (ev.ch != null) return ev.ch.charCodeAt(0);
  return { RETURN: s.reqCR === 2 ? C.RCR : C.CR, TAB: C.TAB, INDEX: C.IDX }[ev.name] ?? null;
}

export function* handle(sys, ed, ev) {
  for (const f of FUNCTIONS) {
    if (f.match(ev, ed)) { const r = yield* f.run(sys, ed, ev); return r; }
  }
  if (ev.code && ev.name === '8') { ed.insert = !ed.insert; return; }
  if (ARROW[ev.name] && ev.code) { boundary(ed, ev.name); return; }
  if ((ev.name === 'LEFT' || ev.name === 'RIGHT') && ev.code) { boundary(ed, ev.name); return; }
  if (ARROW[ev.name]) { yield* vertical(ed, ARROW[ev.name]); return; }
  if (ev.name === 'LEFT' || ev.name === 'RIGHT') { horizontal(ed, ev.name === 'RIGHT' ? 1 : -1); return; }
  if (ev.name === 'SCREEN DOWN') { yield* screenVertical(ed, !ev.code); return; }
  if (ev.name === 'SCREEN RIGHT') { screenHorizontal(ed, !ev.code); return; }
  if (isCancel(ev)) { ed.sel = null; ed.prompt = null; ed.fn = ''; sys.messages.clear(); return; }
  if (ev.name === 'BKSP' && !ev.code) { backspace(ed); return; }
  if (ev.name === 'END' && !ev.code) { yield* ed.doc.close(); return 'end'; }
  if (ev.name === 'PAGE END' && !ev.code) {
    yield* ed.doc.splitPage(ed.cur);
    ed.cur = 0; ed.top = 0; ed.nta = null;
    return;
  }
  if (ev.name === 'LINE ADJ') { lineAdjust(ed); return; }
  if (ev.name === 'REQST' && !ev.code) { yield* requestTasks(sys); return; }
  if ((ev.name === 'PRINT' || ev.name === 'SPELL') && !ev.code) { sys.messages.show('notAvailable', { what: ev.name === 'PRINT' ? 'Printing' : 'Spelling' }); return; }
  const u = codeFor(sys, ev);
  if (u != null && ed.nta == null) typeUnits(ed, [u]);
}

/** LINE ADJ (SR 4.19): adjust the cursored line's paragraph and go on to the next line, as a held key does. */
function lineAdjust(ed) {
  const p = ed.doc.page;
  if (formatAt(p.buf.toArray(), p.objects, ed.cur, ed.doc.layoutCtx(p.k)).adjust !== 1) return;
  adjust(ed, ed.cur, true);
  touched(ed);
  relayout(ed);
  const line = ed.L.lines[cursorLine(ed)];
  if (line.end < buf(ed).length) moveTo(ed, line.end);
}
