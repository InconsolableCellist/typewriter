// Pagination (SR 7.5, ORG p.210, p.490): the document from a page on is taken as one stream of text, its line
// endings adjusted, and cut into pages that fit between the First and Last Typing Lines. A Required Page End always
// ends a page; text between Begin and End Keep is not split. With Exact Line Count = No a page may end one line
// early or late so that a paragraph's first line does not stand alone at the foot of a page, nor its last line at the
// head of the next.
import { C, isObj, objIndex, HARD_ENDS } from './codes.js';
import { walkLine } from './layout.js';
import { ADVANCE } from './format.js';
import { adjustAll } from '../samples.js';
import { compact } from './doc.js';

/** Lines of a stream of units, with what pagination needs to know about each. */
function lines(units, objects, ctx) {
  const out = [];
  const st = { fmt: ctx.fmt, indent: null, levels: 0, doc: ctx.doc, alt: ctx.alt };
  let keep = false;
  for (let i = 0; i < units.length;) {
    const L = walkLine(units, objects, i, st);
    let keepHere = keep;
    for (let j = L.start; j < L.end; j++) {
      const u = units[j];
      if (isObj(u) && objects[objIndex(u)].type === 'keep') { keep = objects[objIndex(u)].begin; keepHere ||= keep; }
    }
    out.push({ start: L.start, end: L.end, term: L.term, fmt: L.fmtEnd, keep: keepHere });
    i = L.end;
  }
  out.forEach((l, k) => {
    l.first = k === 0 || HARD_ENDS.has(out[k - 1].term);
    l.last = l.term === null || HARD_ENDS.has(l.term);
  });
  return out;
}

/**
 * Cut a stream of units (no Page Ends in it) into pages; returns the line indices where pages start, and the lines.
 * `first` says whether the stream starts on the document's first page.
 */
export function pageBreaks(units, objects, ctx, { exact = false } = {}) {
  const ls = lines(units, objects, ctx);
  const breaks = [0];
  let s = 0, ln = ctx.first ? ctx.fmt.firstLine : ctx.fmt.firstLineNext;
  for (let k = 0; k < ls.length; k++) {
    const L = ls[k];
    if (k > s && ln > L.fmt.lastLine) {
      let cut = k;
      if (!exact) {
        if (L.last && !L.first) cut = k + 1;                               // keep a paragraph's last line with it
        else if (k - 1 > s && ls[k - 1].first && !ls[k - 1].last) cut = k - 1;   // do not leave its first line alone
      }
      if (ls[cut]?.keep) { let b = cut; while (b > s && ls[b - 1].keep) b--; if (b > s) cut = b; }
      if (cut <= s) cut = k;
      if (cut >= ls.length) break;
      breaks.push(cut);
      s = cut;
      ln = L.fmt.firstLineNext;
      k = cut - 1;
      continue;
    }
    if (L.term === C.RPE && k + 1 < ls.length) { breaks.push(k + 1); s = k + 1; ln = L.fmt.firstLineNext; continue; }
    if (L.term !== C.ZICR) ln += ADVANCE[L.fmt.spacing] ?? 1;
  }
  return { breaks, lines: ls };
}

/**
 * Paginate a document from page index `from`. options: { exact, adjust, pageEnds } as the PAGINATE DOCUMENT menu
 * gives them (true for Yes). The new pages replace the old ones and are numbered with whole numbers.
 */
export function* paginateDocument(doc, from, { exact = false, adjust = true, pageEnds = true } = {}) {
  yield* doc.storePage();
  const vol = doc.vol;
  const old = doc.pages.slice(from);
  const read = [];
  for (const p of old) read.push(yield* vol.readPage(p.lsn));
  const ctx = { ...doc.layoutCtx(from), first: from === 0 };
  const groups = [];                 // each a { units, objects } stream to cut
  const join = (pages) => {
    const units = [], objects = [];
    for (const pg of pages) {
      const base = objects.length;
      objects.push(...pg.objects);
      for (const u of Array.from(pg.units).slice(0, -1)) units.push(isObj(u) ? 0x8000 | (objIndex(u) + base) : u);
    }
    return { units, objects };
  };
  if (pageEnds) groups.push(join(read));
  else for (const pg of read) groups.push(join([pg]));
  const out = [];
  for (const g of groups) {
    let units = g.units;
    if (adjust) units = adjustAll(units, g.objects, ctx);
    if (!pageEnds) { out.push({ units: [...units, C.PE], objects: g.objects }); continue; }
    const { breaks, lines: ls } = pageBreaks(units, g.objects, ctx, { exact });
    breaks.forEach((b, j) => {
      const a = ls[b].start, e = j + 1 < breaks.length ? ls[breaks[j + 1]].start : units.length;
      out.push({ units: [...units.slice(a, e), C.PE], objects: g.objects });
    });
    if (!units.length) out.push({ units: [C.PE], objects: [] });
  }
  const pages = [];
  for (const pg of out) {
    const c = compact(pg.units, pg.objects);
    const lsns = yield* vol.writePage(c.units, c.objects);
    pages.push({ n: '', lsn: lsns[0], secs: lsns.length, len: c.units.length, fmts: c.objects.filter((o) => o.type === 'fmt') });
  }
  const freed = read.flatMap((pg) => pg.lsns);
  doc.pages.splice(from, old.length, ...pages);
  doc.pages.forEach((p, k) => { p.n = String(k + 1); });
  yield* doc.commit(freed);
  yield* doc.loadPage(0);
}
