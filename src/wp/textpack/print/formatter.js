// From a stored page to what the printer strikes (architecture 7.7 item 1). Pure: a page's units and objects, laid
// out by the same layout.js as the screen and pagination, become sheets of lines, each line a list of strikes at
// device positions: x in 1/240 in from the paper's left edge, y in 1/96 in down from its top edge. Margins, tabs,
// centring, indents and required backspaces come from the layout's positions; this adds what only printing does:
// justification, underline and overstrike as a second strike at the same column, half index as a half-line offset,
// the syllable hyphen at a line end, and the vertical spacing of lines.
import { C, isObj, objIndex, isEnd } from '../editor/codes.js';
import { layoutPage } from '../editor/layout.js';
import { ADVANCE, applyChange, pitch } from '../editor/format.js';
import { ATTR } from '../../screen.js';
import { petalOf } from '../../charset.js';

/** Escapement per scale position, 1/240 in, by pitch. Proportional (11) prints at 12 pitch (decision in 7.7). */
export const ESCAPE = { 10: 24, 11: 20, 12: 20, 15: 16 };
/** 1/96 in per line for each Lines/cm or in. choice: 5.3, 6, 8, 24 and 5.08 lines an inch (SR 7.1). */
export const LINE = { 1: 18, 2: 16, 3: 12, 4: 4, 5: 19 };
/** Sheet length, 1/96 in, for each Paper or Envelope Size (SR 7.3); Other has no stored size and takes letter. */
const MM = 96 / 25.4;
export const PAPER_LENGTH = {
  1: Math.round(297 * MM), 2: Math.round(210 * MM), 3: 11 * 96, 4: Math.round(8.5 * 96), 5: 14 * 96,
  6: Math.round(8.5 * 96), 7: Math.round(4.13 * 96), 8: Math.round(162 * MM), 9: 11 * 96,
};

const UNDERSCORE = 0x5f, HYPHEN = 0x2d, BLANK = 0x20;

export const lineStep = (f) => LINE[f.lpi] ?? LINE[2];
/** How far a carrier return moves the paper: Line Spacing times the line height. */
export const advance = (f) => Math.round((ADVANCE[f.spacing] ?? 1) * lineStep(f));
/** Line n of a page lies n - 1 lines below the top edge, so the default First Typing Line 7 is 1 in down (ORG p.180). */
export const lineY = (n, f) => (n - 1) * lineStep(f);

/** What a unit prints, as a character code, or null. */
function printed(units, i, end) {
  const u = units[i];
  if (u < 0x100) return u === BLANK ? null : u;
  if (u === C.RHY) return HYPHEN;
  if (u === C.SUB) return UNDERSCORE;                   // a Substitute code prints as an underline (ORG p.561)
  if (u === C.SHY) {
    // A syllable hyphen prints only where the line was broken at it.
    for (let j = i + 1; j < end; j++) if (units[j] !== C.SHY && !isObj(units[j])) return units[j] === C.CR ? HYPHEN : null;
  }
  return null;
}

/**
 * Lay out one stored page for printing. ctx: { fmt (in effect at the page start), doc, alt, first (the document's
 * first page) }. state.phase alternates the side justification starts from and runs on across pages. Returns the
 * sheets the page makes (a Required Page End inside it starts a new one), each { fmt, lines: [{ y, style,
 * strikes: [{ x, dy, code, petal }] }] }; a line's strikes are in the order they were typed, and lines that print
 * on more than one printwheel are split into one line per typestyle.
 */
export function formatPage(units, objects, ctx, state = { phase: 0 }) {
  const L = layoutPage(units, objects, { ...ctx, displayCodes: false });
  const sheets = [];
  let sheet = { fmt: ctx.fmt, lines: [] };
  let y = lineY(ctx.first ? ctx.fmt.firstLine : ctx.fmt.firstLineNext, ctx.fmt);
  for (const line of L.lines) {
    for (const run of lineStrikes(L, line, ctx, state)) sheet.lines.push({ y, ...run });
    const fe = line.fmtEnd;
    if (line.term === C.RPE) {
      sheets.push(sheet);
      sheet = { fmt: fe, lines: [] };
      y = lineY(fe.firstLineNext, fe);
    } else if (line.term !== C.ZICR) y += advance(fe);
  }
  if (sheet.lines.length || !sheets.length) sheets.push(sheet);
  return sheets;
}

/** The strikes of one laid-out line, grouped by typestyle. */
function lineStrikes(L, line, ctx, state) {
  const { units, objects, pos, w, attrs, ovs } = L;
  const { start, end } = line;
  const codes = new Array(end - start).fill(null), fmts = new Array(end - start);
  let f = line.fmt, last = -1;
  for (let i = start; i < end; i++) {
    const u = units[i];
    if (isObj(u) && objects[objIndex(u)].type === 'fmt') f = applyChange(f, objects[objIndex(u)], ctx.doc, ctx.alt);
    fmts[i - start] = f;
    codes[i - start] = printed(units, i, end);
    if (codes[i - start] !== null) last = i;
  }
  const shift = justify(L, line, codes, last, state);
  const runs = [];
  let run = null;
  const strike = (i, x, code) => {
    const fi = fmts[i - start], half = Math.round(lineStep(fi) / 2);
    const dy = attrs[i] & ATTR.HALF_UP ? -half : attrs[i] & ATTR.HALF_DOWN ? half : 0;
    if (!run || run.style !== fi.typestyle) runs.push(run = { style: fi.typestyle, strikes: [] });
    run.strikes.push({ x, dy, code, petal: petalOf(code) });
  };
  for (let i = start; i < end; i++) {
    const u = units[i], code = codes[i - start];
    if (isEnd(u)) continue;
    const esc = ESCAPE[pitch(fmts[i - start])], p = pos[i] + shift[i - start], x = p * esc;
    if (code !== null) {
      strike(i, x, code);
      if (ovs[i]) strike(i, x, ovs[i].charCodeAt(0));
      if (attrs[i] & ATTR.UNDER) strike(i, x, UNDERSCORE);
    } else if (attrs[i] & ATTR.UNDER && i < last && (u === BLANK || u === C.RSP || u === C.TAB)) {
      // Continuous underline runs under the blanks and tabs between underlined words, stretched ones included.
      const cells = w[i] + shift[i + 1 - start] - shift[i - start];
      for (let k = 0; k < cells; k++) strike(i, (p + k) * esc, UNDERSCORE);
    }
  }
  return runs;
}

/**
 * Justify and Half-Justify (SR 4.20): on a line that wrapped (it ends in a regular carrier return), the space left
 * before the right margin (half of it for Half-Justify) goes into the blanks between words, a position at a time,
 * the odd ones from the left on one line and from the right on the next. Only the words after the line's last tab
 * or centre code are spread, so tabbed columns stay put. Returns each unit's shift in positions.
 */
function justify(L, line, codes, last, state) {
  const { units, pos } = L, { start, end } = line, n = end - start;
  const shift = new Int32Array(n + 1);
  const f = line.fmtEnd;
  if (line.term !== C.CR || (f.align !== 2 && f.align !== 3) || last < 0) return shift;
  let from = start;
  for (let i = start; i <= last; i++) if (units[i] === C.TAB || units[i] === C.RTAB || units[i] === C.CTR) from = i + 1;
  while (from <= last && codes[from - start] === null) from++;
  const gaps = [];
  for (let i = from; i <= last; i++) {
    if (units[i] === BLANK && (i === from || units[i - 1] !== BLANK)) gaps.push(i);
  }
  let spare = f.rm - pos[last];
  if (f.align === 3) spare = Math.floor(spare / 2);
  if (!gaps.length || spare <= 0) return shift;
  const base = Math.floor(spare / gaps.length), odd = spare % gaps.length;
  const leftFirst = state.phase === 0;
  state.phase ^= 1;
  let acc = 0, g = 0;
  for (let i = start; i < end; i++) {
    if (g < gaps.length && i === gaps[g]) {
      shift[i - start] = acc;
      acc += base + ((leftFirst ? g < odd : g >= gaps.length - odd) ? 1 : 0);
      g++;
      continue;
    }
    shift[i - start] = units[i] === BLANK && g > 0 && i > gaps[g - 1] ? shift[i - 1 - start] : acc;
  }
  shift[n] = acc;
  return shift;
}
