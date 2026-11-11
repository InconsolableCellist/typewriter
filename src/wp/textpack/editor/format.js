// Document formats (SR 7.1 to 7.4) and the format-change codes that alter them part way through a document
// (SR 4.13). A format is a plain object; a change is an object in a page's object table, and the format in effect at
// any point is the document format with every change before that point applied in order.

export const TAB_KINDS = ['left', 'centre', 'decimal', 'right', 'comma', 'colon'];
export const MAX_TABS = 48;               // ORG p.531
export const MAX_INDENT = 15;             // ORG p.536

/** Tabs every n positions from the left margin (SS 3.1: every 5 by default; the grid is set from the left margin). */
export function tabGrid(lm, rm, n) {
  const tabs = [];
  for (let p = lm + n; p < rm && tabs.length < MAX_TABS; p += n) tabs.push({ pos: p, kind: 'left' });
  return tabs;
}

export const DEFAULT_FORMAT = Object.freeze({
  // LINE FORMAT (ORG p.179)
  spacing: 1, align: 1, typestyle: 86, lpi: 2, adjust: 1, zone: 6,
  // MARGINS AND TABS: 18 and 90 (WSPG p.20), a tab every 5 positions
  lm: 18, rm: 90, tabs: tabGrid(18, 90, 5),
  // PAGE FORMAT (ORG p.208)
  firstLine: 7, firstLineNext: 7, lastLine: 60, paper: 3, source: 1,
  // HEADER AND FOOTER (ORG p.165)
  headerLine: 3, headerOn: 1, footerLine: 63, footerOn: 1, header: null, footer: null,
});

export const GROUP = {
  line: ['spacing', 'align', 'typestyle', 'lpi', 'adjust', 'zone'],
  margins: ['lm', 'rm', 'tabs'],
  page: ['firstLine', 'firstLineNext', 'lastLine', 'paper', 'source'],
  hf: ['headerLine', 'headerOn', 'footerLine', 'footerOn', 'header', 'footer'],
};

/** Lines advanced per carrier return for each Line Spacing choice: single, double, triple, half, one and a half. */
export const ADVANCE = { 1: 1, 2: 2, 3: 3, 4: 0.5, 5: 1.5 };

export function pitch(f) {
  const n = f.typestyle;
  if (n >= 1 && n <= 31) return 10;
  if (n >= 154 && n <= 175) return 11;     // proportional (PSM) shows as 11 on the status line (ORG p.31)
  if (n >= 215 && n <= 230) return 15;
  return 12;
}

export function copyFormat(f) { return { ...f, tabs: f.tabs.map((t) => ({ ...t })) }; }

function take(dst, src, keys) {
  for (const k of keys) dst[k] = k === 'tabs' ? src.tabs.map((t) => ({ ...t })) : src[k];
}

/**
 * The format after a change object. `doc` and `alt` are the document's two stored formats, which the return codes
 * and Begin Using Document/Alternate Format go back to.
 */
export function applyChange(f, obj, doc, alt) {
  const out = copyFormat(f);
  switch (obj.kind) {
    case 'line': case 'margins': case 'page': case 'type': Object.assign(out, copyFormat({ ...out, ...obj.values })); break;
    case 'retAll': return copyFormat(doc);
    case 'retLine': take(out, doc, [...GROUP.line, ...GROUP.margins]); break;
    case 'retType': out.typestyle = doc.typestyle; break;
    case 'docFmt': return copyFormat(doc);
    case 'altFmt': return copyFormat(alt ?? doc);
    default: break;
  }
  return out;
}

/** Whether a change ends an indent level (SR 4.5): any page or line format change and every return code. */
export function cancelsIndent(obj) { return obj.type === 'fmt' && obj.kind !== 'type'; }
