// A line of codes to columns (architecture 7.3): tabs by kind, indent levels, centring, zero-width codes. This is
// the one implementation used by the screen, by adjusting line endings and by pagination. Positions are scale
// positions (the left margin is 18 by default); the screen maps them to columns through its segment.
//
// Line endings are stored. A wrap inserts a regular carrier return after the blanks at the break and the blanks
// stay, so removing every regular carrier return from a paragraph gives back exactly what was typed.
import { C, info, isObj, objIndex, isEnd, HARD_ENDS, isBlank } from './codes.js';
import { ADVANCE, applyChange, cancelsIndent, MAX_INDENT } from './format.js';
import { ATTR } from '../../screen.js';

const ALIGN_CHAR = { decimal: '.', comma: ',', colon: ':' };
const BREAK_AFTER = new Set([0x20, C.SHY]);

/** The format in effect before unit `at`: the start format with every format change before it applied. */
export function formatAt(units, objects, at, ctx) {
  let f = ctx.fmt;
  for (let i = 0; i < at; i++) {
    const u = units[i];
    if (isObj(u) && objects[objIndex(u)].type === 'fmt') f = applyChange(f, objects[objIndex(u)], ctx.doc, ctx.alt);
  }
  return f;
}

/** Width of the text after a tab, up to the next tab or line end; `upTo` stops at that character. */
function segment(units, objects, from, upTo) {
  let w = 0, before = null;
  for (let j = from; j < units.length; j++) {
    const u = units[j];
    if (u === C.TAB || u === C.RTAB || isEnd(u)) break;
    if (upTo && before === null && u === upTo.charCodeAt(0)) before = w;
    if (info(u, objects).width === 'char') w++;
  }
  return { w, before: before ?? w };
}

/**
 * Lay out one line from `start`. `st` ({ fmt, indent, levels, doc, alt }) is the state at the line start and is
 * advanced to the state after it. Returns the units' positions and widths (indexed from `start`), the end (after
 * the line-ending code), the line-ending code, the first unit past the right margin and the last break before it.
 */
export function walkLine(units, objects, start, st, { displayCodes = false, limit = units.length } = {}) {
  const P = [], W = [];
  const base = () => st.indent ?? st.fmt.lm;
  let pos = base(), atStart = true, printed = false;
  let overflow = -1, brk = -1, term = null, i = start, ctr = -1;
  const fmtStart = st.fmt;
  for (; i < limit; i++) {
    const u = units[i];
    const inf = info(u, objects);
    let w = 0;
    switch (inf.width) {
      case 'char': w = 1; break;
      case 'tab': {
        const stop = st.fmt.tabs.find((t) => t.pos > pos);
        let to = pos + 1;
        if (stop) {
          const seg = segment(units, objects, i + 1, ALIGN_CHAR[stop.kind]);
          to = stop.kind === 'right' ? stop.pos - seg.w + 1
            : stop.kind === 'centre' ? stop.pos - Math.floor(seg.w / 2)
            : ALIGN_CHAR[stop.kind] ? stop.pos - seg.before : stop.pos;
          to = Math.max(to, pos);
        }
        w = to - pos;
        if (u === C.RTAB && (st.levels ?? 0) < MAX_INDENT) { st.indent = to; st.levels = (st.levels ?? 0) + 1; }
        break;
      }
      case 'zero':
        w = displayCodes ? 1 : 0;
        if (inf.obj?.type === 'fmt') {
          st.fmt = applyChange(st.fmt, inf.obj, st.doc, st.alt);
          if (cancelsIndent(inf.obj)) { st.indent = null; st.levels = 0; }
          if (atStart) pos = base();
        }
        if (u === C.CTR && ctr < 0) ctr = i;
        break;
      case 'back':
        if (displayCodes) w = 1; else pos = Math.max(st.fmt.lm, pos - 1);
        break;
      case 'end': w = 1; break;
      default:
    }
    P.push(pos); W.push(w);
    pos += w;
    if (inf.width === 'char' && !isBlank(u)) {
      if (overflow < 0 && pos - 1 > st.fmt.rm) overflow = i;
      printed = true;
    }
    if (inf.width !== 'zero') atStart = false;
    if (BREAK_AFTER.has(u) && printed && overflow < 0) brk = i + 1;
    if (inf.width === 'end') { term = u; i++; break; }
  }
  if (ctr >= 0) centre(units, objects, start, ctr, i, P, W, base());
  if (term !== null && term !== C.CR) { st.indent = null; st.levels = 0; }
  return { start, end: i, term, P, W, overflow, brk, fmt: fmtStart, fmtEnd: st.fmt };
}

/** Centre the text after a CTR code on the position the code stands at (SR 4.16, ORG p.260). */
function centre(units, objects, start, k, end, P, W, lm) {
  const c = P[k - start];
  let stopAt = end;
  for (let j = k + 1; j < end; j++) if (units[j] === C.RTAB || isEnd(units[j])) { stopAt = j; break; }
  let w = 0;
  for (let j = k + 1; j < stopAt; j++) w += W[j - start];
  const s = Math.max(lm, c - Math.floor(w / 2));
  for (let j = k + 1; j < stopAt; j++) P[j - start] += s - c;
  for (let j = k - 1; j >= start && (units[j] === 0x20 || units[j] === C.TAB); j--) {
    const r = j - start;
    if (P[r] >= s) { P[r] = s; W[r] = 0; } else if (P[r] + W[r] > s) W[r] = s - P[r];
  }
}

function newState(ctx) { return { fmt: ctx.fmt, indent: null, levels: 0, doc: ctx.doc, alt: ctx.alt }; }

/**
 * Lay out a page. ctx: { fmt (in effect at the page start), doc, alt, first (true on the document's first page),
 * displayCodes }. Returns the lines, per-unit position, width, line and display attributes, and overstrike
 * characters.
 */
export function layoutPage(units, objects, ctx) {
  const n = units.length;
  const pos = new Int32Array(n), w = new Int32Array(n), lineOf = new Int32Array(n), attrs = new Uint8Array(n);
  const ovs = new Array(n).fill(null);
  const lines = [];
  const st = newState(ctx);
  let ln = ctx.first ? ctx.fmt.firstLine : ctx.fmt.firstLineNext;
  for (let i = 0; i < n;) {
    const L = walkLine(units, objects, i, st, { displayCodes: ctx.displayCodes });
    L.ln = ln;
    for (let j = L.start; j < L.end; j++) { pos[j] = L.P[j - L.start]; w[j] = L.W[j - L.start]; lineOf[j] = lines.length; }
    lines.push(L);
    if (L.term === C.RPE) ln = L.fmtEnd.firstLineNext;
    else if (L.term !== C.ZICR) ln += ADVANCE[L.fmtEnd.spacing] ?? 1;
    i = L.end;
  }
  decorate(units, objects, attrs, ovs);
  return { lines, pos, w, lineOf, attrs, ovs, units, objects };
}

const PRINTING = (u) => u < 0x100 || u === C.RSP || u === C.RHY || u === C.SUB;
const WORD_STOPS = new Set([0x20, C.CR, C.RCR, C.RTAB, C.IDX, C.PE, C.RPE, C.RBS]);

/** Underlining (character, word, begin/end), half index and overstrike, as the screen shows them (SR 4.17, 4.18). */
function decorate(units, objects, attrs, ovs) {
  let und = false, half = 0, over = null;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === C.BUND) und = true;
    else if (u === C.EUND) und = false;
    else if (u === C.HUP) half = Math.min(1, half + 1);
    else if (u === C.HDN) half = Math.max(-1, half - 1);
    else if (isObj(u) && objects[objIndex(u)].type === 'ovs') over = objects[objIndex(u)].begin ? objects[objIndex(u)].ch : null;
    else if (u === C.WUND) {
      for (let j = i - 1; j >= 0 && !WORD_STOPS.has(units[j]); j--) if (PRINTING(units[j])) attrs[j] |= ATTR.UNDER;
    } else if (u === C.CUND) {
      let j = i - 1;
      while (j >= 0 && !PRINTING(units[j]) && !isEnd(units[j])) j--;
      if (j >= 0 && PRINTING(units[j])) attrs[j] |= ATTR.UNDER;
    }
    if (PRINTING(u) || u === C.TAB) {
      if (und) attrs[i] |= ATTR.UNDER;
      if (half > 0) attrs[i] |= ATTR.HALF_UP;
      if (half < 0) attrs[i] |= ATTR.HALF_DOWN;
      if (over && u < 0x100 && u !== 0x20) ovs[i] = over;
    }
  }
}

/** The paragraph around unit `at`: from after the previous hard line end to the next one, inclusive. */
export function paragraphAt(units, at) {
  let ps = at;
  while (ps > 0 && !HARD_ENDS.has(units[ps - 1])) ps--;
  let pe = at;
  while (pe < units.length - 1 && !HARD_ENDS.has(units[pe])) pe++;
  return { ps, pe };
}

/**
 * Adjust line endings in the paragraph around `at` (Auto Adjust, LINE ADJ): take out the regular carrier returns
 * and put them back where the margins break the lines. Returns the new units and a map from old unit indices to new
 * ones (a removed return maps to the unit that followed it).
 */
export function reflowParagraph(units, objects, at, ctx) {
  const { ps, pe } = paragraphAt(units, at);
  const seg = [];
  for (let j = ps; j <= pe; j++) if (units[j] !== C.CR) seg.push({ u: units[j], old: j });
  const arr = () => seg.map((s) => s.u);
  const st0 = newState({ ...ctx, fmt: formatAt(units, objects, ps, ctx) });
  let lineStart = 0;
  for (let guard = 0; guard < seg.length + 2; guard++) {
    const a = arr();
    const st = { ...st0 };
    const r = walkLine(a, objects, lineStart, st);
    if (r.overflow < 0 || r.end <= lineStart) break;
    const b = r.brk > lineStart ? r.brk : Math.max(lineStart + 1, r.overflow);
    seg.splice(b, 0, { u: C.CR, old: -1 });
    const after = { ...st0 };
    walkLine(arr(), objects, lineStart, after, { limit: b + 1 });
    Object.assign(st0, after);
    lineStart = b + 1;
  }
  const out = [...units.slice(0, ps), ...arr(), ...units.slice(pe + 1)];
  const delta = seg.length - (pe - ps + 1);
  const newOf = new Map();
  seg.forEach((s, k) => { if (s.old >= 0) newOf.set(s.old, ps + k); });
  const map = (i) => {
    if (i < ps) return i;
    if (i > pe) return i + delta;
    for (let j = i; j <= pe; j++) if (newOf.has(j)) return newOf.get(j);
    return pe + 1 + delta;
  };
  return { units: out, map, changed: out.length !== units.length || out.some((u, k) => u !== units[k]) };
}

