// The typing screen (SS 3, SR 1): status lines with the page, line, keyboard and pitch fields, the scale line, 20
// lines of text, the prompt line. Codes are hidden unless the cursor is on one, they are selected, or Display Codes
// is Yes (SS 3.3); the Page End symbol always shows, marking the end of the page's text. The window scrolls a line
// at a time and segments sideways 60 positions at a time, keeping 20 in view (HW 1.7).
import { ROW, ATTR, TEXT_ROWS } from '../../screen.js';
import { SYM } from '../../charset.js';
import { C, info, isChar } from './codes.js';
import { layoutPage } from './layout.js';
import { pitch } from './format.js';
import { drawPrompt } from '../input.js';

export const SEGMENT_STEP = 60;

export function relayout(ed) {
  const p = ed.doc.page;
  ed.L = layoutPage(p.buf.toArray(), p.objects, ed.doc.layoutCtx(p.k, ed.displayCodes));
  return ed.L;
}

const showLn = (ln) => (Number.isInteger(ln) ? String(ln) : ln.toFixed(1));

/** The cursor's scale position (in the Non-Typing Area, the column it stands on). */
export function cursorPos(ed) { return ed.nta ?? ed.L.pos[ed.cur]; }

export function cursorLine(ed) { return ed.L.lineOf[ed.cur]; }

/** Keep the cursor's line and column in the window. */
export function follow(ed) {
  const cl = cursorLine(ed);
  if (cl < ed.top) ed.top = cl;
  if (cl >= ed.top + TEXT_ROWS) ed.top = cl - TEXT_ROWS + 1;
  const p = cursorPos(ed);
  if (ed.segLeft == null) ed.segLeft = Math.max(1, ed.L.lines[cl].fmtEnd.lm - 1);
  while (p - ed.segLeft >= 80) ed.segLeft += SEGMENT_STEP;
  while (p < ed.segLeft) ed.segLeft = Math.max(1, ed.segLeft - SEGMENT_STEP);
}

export function drawTyping(sys, ed) {
  const L = relayout(ed);
  follow(ed);
  const s = sys.screen;
  const { units, objects } = L;
  const doc = ed.doc;
  const cl = cursorLine(ed);
  const line = L.lines[cl];
  const fmt = line.fmtEnd;
  const cu = units[ed.cur];
  // The Page End that closes the page marks the end of the text and travels with it (TB1 p.10); it is not named.
  const last = ed.cur === units.length - 1 && cu === C.PE;
  const codeName = ed.nta != null ? 'Non-Typing Area' : isChar(cu) || last ? '' : info(cu, objects).name;
  sys.drawStatus({
    A: ed.fn ?? '', B: doc.name.slice(0, 20), C: ed.insert ? 'Ins' : 'Repl', D: '', E: codeName,
    I: `Pg. ${doc.pages[doc.page.k].n}`, J: `Ln. ${showLn(line.ln)}`, L: `Pitch ${pitch(fmt)}`,
  });
  drawScale(s, fmt, ed.segLeft, cursorPos(ed));
  s.clearRows(ROW.TOP, ROW.BOTTOM);
  const sel = ed.sel;
  let cursorCell = null;
  for (let r = 0; r < TEXT_ROWS; r++) {
    const ln = L.lines[ed.top + r];
    if (!ln) break;
    const row = ROW.TOP + r;
    for (let j = ln.start; j < ln.end; j++) {
      const u = units[j];
      const inf = info(u, objects);
      const col = L.pos[j] - ed.segLeft + 1;
      const selected = sel && j >= sel[0] && j <= sel[1];
      const cursored = j === ed.cur && ed.nta == null;
      const symbol = ed.displayCodes || cursored || selected;
      const attr = L.attrs[j] | (selected ? ATTR.REVERSE : 0);
      if (cursored && L.w[j] === 0) { cursorCell = { row, col, u, inf, attr }; continue; }
      if (L.w[j] === 0 && !(ed.displayCodes && inf.width === 'zero')) continue;
      if (col < 1 || col > 80) continue;
      if (isChar(u)) s.cell(row, col, L.ovs[j] ? L.ovs[j].charCodeAt(0) : u, attr);
      else if (inf.width === 'char' && inf.shows && !(symbol && u === C.RSP)) {
        if (typeof inf.shows === 'number') s.sym(row, col, inf.shows, attr); else s.cell(row, col, inf.shows.charCodeAt(0), attr);
      } else if (u === C.PE || symbol) s.sym(row, col, inf.sym, attr);
      else if (selected || L.attrs[j]) s.cell(row, col, 0x20, attr);
    }
    if (ed.nta != null && ed.top + r === cl) cursorCell = { row, col: ed.nta - ed.segLeft + 1 };
  }
  // The cursor: a brightened underline on its cell, the character above it highlighted (ORG p.32).
  const crow = ROW.TOP + cl - ed.top, ccol = cursorPos(ed) - ed.segLeft + 1;
  if (cursorCell?.inf) s.sym(cursorCell.row, cursorCell.col, cursorCell.inf.sym, cursorCell.attr);
  if (ccol >= 1 && ccol <= 80) s.attr(crow, ccol, 1, ATTR.BRIGHT);
  if (ed.prompt) {
    drawPrompt(sys, ed.prompt.text, ed.prompt.answer ?? null);
    if (ed.prompt.answer == null) s.setCursor(crow, ccol, true);
  } else {
    s.clearRows(ROW.PROMPT);
    s.setCursor(crow, ccol, true);
  }
}

/**
 * The scale line (SS 3.1, ORG p.31): `.` for ordinary positions, `:` at every 5, the tens digit at every 10, the
 * margins, the centre point, tab marks (an underline under a left tab, a mark for the other kinds), and the
 * cursor's position highlighted.
 */
export function drawScale(s, fmt, segLeft, cursorAt) {
  s.clearRows(ROW.SCALE);
  const centre = Math.floor((fmt.lm + fmt.rm) / 2);
  const tabs = new Map(fmt.tabs.map((t) => [t.pos, t.kind]));
  for (let col = 1; col <= 80; col++) {
    const p = segLeft + col - 1;
    let attr = p === cursorAt ? ATTR.REVERSE : 0;
    const kind = tabs.get(p);
    if (kind === 'left' || kind === 'right') attr |= ATTR.UNDER;
    if (p === fmt.lm) s.cell(ROW.SCALE, col, 0xab, attr);
    else if (p === fmt.rm) s.cell(ROW.SCALE, col, 0xbb, attr);
    else if (kind === 'centre') s.sym(ROW.SCALE, col, SYM.TAB_CENTRE, attr);
    else if (kind === 'decimal') s.sym(ROW.SCALE, col, SYM.TAB_DECIMAL, attr);
    else if (kind === 'comma') s.cell(ROW.SCALE, col, 0x2c, attr);
    else if (kind === 'colon') s.cell(ROW.SCALE, col, 0x3a, attr);
    else if (kind === 'right') s.sym(ROW.SCALE, col, SYM.TAB_RIGHT, attr);
    else if (p === centre) s.sym(ROW.SCALE, col, SYM.CENTRE, attr);
    else if (p % 10 === 0) s.cell(ROW.SCALE, col, 0x30 + ((p / 10) % 10), attr);
    else s.cell(ROW.SCALE, col, p % 5 === 0 ? 0x3a : 0x2e, attr);
  }
}
