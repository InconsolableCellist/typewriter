// The format menus (SR 7.1 to 7.4, SS 2.4): FORMAT SELECTION and its LINE FORMAT, MARGINS AND TABS, PAGE FORMAT and
// HEADER AND FOOTER. They edit a working copy of a format; the caller decides what the result becomes: the document
// or alternate format (from CREATE OR REVISE DOCUMENT), or a format change code in the text (CHG FMT).
import { MENUS } from './menus.js';
import { runMenu, menuState, pitchOf } from './menu-runner.js';
import { fmt } from './messages.js';
import { getKey, isEnter, isCancel } from './input.js';
import { GROUP, copyFormat, tabGrid, MAX_TABS } from './editor/format.js';
import { drawScale } from './editor/view.js';
import { ROW } from '../screen.js';
import { TASKS, menuKeys } from './tasks/common.js';

const pick = (f, keys) => Object.fromEntries(keys.map((k) => [k, f[k]]));
const HF_VALUES = ['headerLine', 'headerOn', 'footerLine', 'footerOn'];

/**
 * FORMAT SELECTION over a working format. Returns 'done' (ENTER: keep the changes), 'cancel', or { ret } when one of
 * the return or begin-using items was chosen (those insert a code at once, ORG p.157).
 */
export function* formatSelection(sys, work, { status, docName, def = MENUS.formatSelection } = {}) {
  const mid = def === MENUS.formatSelectionMid;
  const st = mid ? menuState({ typestyle: work.typestyle }) : null;
  const opts = { status, docName };
  for (;;) {
    const r = yield* runMenu(sys, def, st, { ...opts, samePitch: mid ? pitchOf(work.typestyle) : null, ...menuKeys(sys) });
    if (r.done) { if (mid) work.typestyle = st.values.typestyle; return 'done'; }
    if (!r.go) return 'cancel';
    if (['lineFormat', 'pageFormat', 'headerFooter', 'marginsTabs'].includes(r.go)) yield* formatSubmenu(sys, work, r.go, opts);
    else return { ret: r.go };
  }
}

/** One of the menus with choices; on ENTER its values go into the working format. */
/** One of FORMAT SELECTION's sub-menus on its own (Menu Bypass: martab, linefmt, pgfmt, hf). */
export function* formatSubmenu(sys, work, go, opts) {
  if (go === 'lineFormat') yield* groupMenu(sys, MENUS.lineFormat, work, GROUP.line, opts);
  else if (go === 'pageFormat') yield* groupMenu(sys, MENUS.pageFormat, work, GROUP.page, opts, (v) => v.firstLine <= v.lastLine && v.firstLineNext <= v.lastLine);
  else if (go === 'headerFooter') yield* groupMenu(sys, MENUS.headerFooter, work, HF_VALUES, opts);
  else if (go === 'marginsTabs') yield* marginsTabs(sys, work, opts);
}

function* groupMenu(sys, def, work, keys, opts, check = () => true) {
  const st = menuState(pick(work, keys));
  for (;;) {
    const r = yield* runMenu(sys, def, st, { ...opts, ...menuKeys(sys) });
    if (r.go) { sys.messages.show('notAvailable', { what: def.items.find((i) => i.go === r.go).item }); continue; }
    if (!r.done) return;
    if (!check(st.values)) { sys.messages.show('firstLast'); continue; }
    Object.assign(work, st.values);
    return;
  }
}

// The instructions of the MARGINS AND TABS screen, as the SS 2.4 grid shows them.
const MT_TEXT = [
  [6, 4, 'SET MARGIN: Use <- or -> key to move cursor to margin (<< or >>).'],
  [7, 17, 'Use SPACE bar or BKSP key to move margin.'],
  [9, 7, 'SET TAB: Use <- or -> key to move cursor to where you want tab.'],
  [10, 16, 'For Flush Left Tab, Press TAB  For Center Tab, press CTR'],
  [11, 16, 'For Decimal Tab, press .  For Flush Right Tab, press RET'],
  [12, 16, 'For Comma Tab, press ,'],
  [14, 5, 'CLEAR TAB: Use <- or -> key to move cursor to tab; press DEL.'],
  [16, 5, 'MOVE TABS: Use <- or -> key to move cursor to tab.'],
  [17, 16, 'Use SPACE bar or BKSP key to move tabs.'],
  [19, 2, 'SET ALL TABS: Use <- or -> key to move cursor to left margin (<<).'],
  [20, 16, 'Type number for spacing between tabs; press ENTER.'],
  [21, 1, 'CLEAR ALL TABS: Use <- or -> key to move cursor to left margin (<<);'],
  [22, 17, 'press DEL.'],
];
const MAX_POS = 255;

/**
 * MARGINS AND TABS (ORG p.183, SR 7.2): no ID letters; the operator works on the scale line. The cursor starts on
 * the left margin; the scale segments as it moves. SPACE and BKSP move a margin, or a tab and every tab right of it.
 */
export function* marginsTabs(sys, work, { status, docName } = {}) {
  const f = copyFormat(work);
  let p = f.lm, seg = Math.max(1, f.lm - 1), digits = '';
  const s = sys.screen;
  for (;;) {
    while (p - seg >= 80) seg += 60;
    while (p < seg) seg = Math.max(1, seg - 60);
    sys.drawStatus({ A: status ?? '', B: docName });
    s.clearRows(ROW.SCALE, ROW.PROMPT);
    drawScale(s, f, seg, p);
    s.put(4, 30, 'MARGINS AND TABS');
    for (const [r, c, t] of MT_TEXT) s.put(r, c, t);
    s.put(ROW.PROMPT, 1, fmt('whenFinished'));
    s.setCursor(ROW.SCALE, p - seg + 1, true);
    const ev = yield* getKey(sys);
    const tab = f.tabs.findIndex((t) => t.pos === p);
    if (isEnter(ev)) {
      if (digits && p === f.lm) { const n = +digits; if (n > 0) f.tabs = tabGrid(f.lm, f.rm, n); digits = ''; continue; }
      Object.assign(work, pick(f, GROUP.margins));
      return;
    }
    if (isCancel(ev)) { if (digits) { digits = ''; continue; } return; }
    if (ev.name === 'LEFT' && !ev.code) { p = Math.max(1, p - 1); digits = ''; continue; }
    if (ev.name === 'RIGHT' && !ev.code) { p = Math.min(MAX_POS, p + 1); digits = ''; continue; }
    if (p === f.lm && ev.ch && /\d/.test(ev.ch) && !ev.code) { if (digits.length < 2) digits += ev.ch; continue; }
    const step = ev.name === 'SPACE' && !ev.code ? 1 : ev.name === 'BKSP' && !ev.code ? -1 : 0;
    if (step) {
      if (p === f.lm) { const lm = f.lm + step; if (lm >= 1 && lm < f.rm - 1 && !f.tabs.some((t) => t.pos <= lm)) { f.lm = lm; p = lm; } }
      else if (p === f.rm) { const rm = f.rm + step; if (rm > f.lm + 1 && rm <= MAX_POS) { f.rm = rm; p = rm; } }
      else if (tab >= 0) {
        const moved = f.tabs.slice(tab).map((t) => t.pos + step);
        const prev = tab > 0 ? f.tabs[tab - 1].pos : f.lm;
        if (moved[0] > prev && moved[moved.length - 1] <= MAX_POS) { f.tabs.slice(tab).forEach((t, k) => { t.pos = moved[k]; }); p += step; }
      }
      continue;
    }
    if (ev.name === 'DEL' && !ev.code) {
      if (p === f.lm) f.tabs = [];
      else if (tab >= 0) f.tabs.splice(tab, 1);
      continue;
    }
    const kind = ev.code ? (ev.name === 'c' ? 'centre' : null)
      : { TAB: 'left', RETURN: 'right', '.': 'decimal', ',': 'comma', ';': ev.ch === ':' ? 'colon' : null }[ev.name] ?? null;
    if (kind && p > f.lm && p !== f.rm) {
      if (tab >= 0) f.tabs[tab].kind = kind;
      else if (f.tabs.length < MAX_TABS) { f.tabs.push({ pos: p, kind }); f.tabs.sort((a, b) => a.pos - b.pos); }
    }
  }
}

/** CREATE OR REVISE DOCUMENT b and c: the document's own format and its alternate format. */
function* storedFormat(sys, doc, key, status) {
  const work = copyFormat(doc.head[key]);
  const r = yield* formatSelection(sys, work, { status: fmt(status), docName: doc.name.slice(0, 20), def: MENUS.formatSelection });
  if (r !== 'done') return;
  doc.head[key] = work;
  yield* doc.commit();
}

Object.assign(TASKS, {
  docFormat: (sys, { doc }) => storedFormat(sys, doc, 'format', 'chgDocFmt'),
  altFormat: (sys, { doc }) => storedFormat(sys, doc, 'alt', 'chgAltFmt'),
});
