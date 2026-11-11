// An open document: its index entry, its head (formats, flags, the page table) and the one page in memory
// (architecture 7.3, 8.2). A page is stored when the operator leaves it, on PRINT and on END. Each store writes the
// new page and head chains, marks them in the free map, and only then rewrites the index entry, which is the commit:
// a power cut before it leaves the old document intact, after it leaves sectors that Recover Documents reclaims.
// A document is marked open from create or revise until END; a mount that finds it open shows it needing recovery.
import { GapBuffer } from './buffer.js';
import { C, isObj, objIndex } from './codes.js';
import { applyChange, copyFormat } from './format.js';
import { FLAG } from '../../disk/fs.js';

/** Keep only the objects a page's units refer to, renumbered in the order they appear. */
export function compact(units, objects) {
  const out = [], map = new Map();
  const u2 = Uint16Array.from(units, (u) => {
    if (!isObj(u)) return u;
    const k = objIndex(u);
    if (!map.has(k)) { map.set(k, out.length); out.push(objects[k]); }
    return 0x8000 | map.get(k);
  });
  return { units: u2, objects: out };
}

/** System page numbers (ORG p.489): a page made by revision between n and the next page is numbered n.1, n.1.1 ... */
export function pageNumberAfter(pages, k) {
  const base = pages[k].n, next = pages[k + 1]?.n;
  if (!next) { const p = base.split('.'); p[p.length - 1] = String(+p[p.length - 1] + 1); return p.join('.'); }
  return `${base}.1`;
}

export class Document {
  constructor(vol, entry, head, headLsns) {
    this.vol = vol;
    this.entry = entry;
    this.head = head;
    this.headLsns = headLsns;
    this.page = null;            // { k, buf, objects, lsns, dirty }
  }

  get name() { return this.entry.name; }
  get pages() { return this.head.pages; }

  static *create(sys, vol, name) {
    const head = { v: 1, format: copyFormat(sys.settings.docFormat), alt: copyFormat(sys.settings.altFormat), preserve: 2, pages: [] };
    const units = Uint16Array.of(C.PE);
    const plsns = yield* vol.writePage(units, []);
    head.pages.push({ n: '1', lsn: plsns[0], secs: plsns.length, len: 1, fmts: [] });
    const hlsns = yield* vol.writeJson(head);
    yield* vol.flushMap();
    const entry = { name, comment: '', type: 1, flags: FLAG.OPEN, first: hlsns[0], count: hlsns.length + plsns.length, length: 1 };
    yield* vol.addEntry(entry);
    yield* vol.flushMap();
    const doc = new Document(vol, entry, head, hlsns);
    doc.page = { k: 0, buf: new GapBuffer(units), objects: [], lsns: plsns, dirty: false };
    return doc;
  }

  /** Open for revision: the document is marked open on the diskette, then its first page is read. */
  static *open(vol, entry, { mark = true } = {}) {
    const { head, lsns } = yield* vol.readHead(entry);
    if (mark) { entry.flags |= FLAG.OPEN; yield* vol.writeEntry(entry); }
    const doc = new Document(vol, entry, head, lsns);
    yield* doc.loadPage(0);
    return doc;
  }

  /** The format in effect at the start of page k. */
  startFormat(k) {
    let f = this.head.format;
    for (let j = 0; j < k; j++) for (const o of this.pages[j].fmts) f = applyChange(f, o, this.head.format, this.head.alt);
    return f;
  }

  layoutCtx(k = this.page.k, displayCodes = false) {
    return { fmt: this.startFormat(k), doc: this.head.format, alt: this.head.alt, first: k === 0, displayCodes };
  }

  *loadPage(k) {
    const { units, objects, lsns } = yield* this.vol.readPage(this.pages[k].lsn);
    this.page = { k, buf: new GapBuffer(units), objects, lsns, dirty: false };
  }

  /** Store the page in memory if it changed. */
  *storePage() {
    const p = this.page;
    if (!p?.dirty) return;
    const { units, objects } = compact(p.buf.toArray(), p.objects);
    const lsns = yield* this.vol.writePage(units, objects);
    const old = p.lsns;
    Object.assign(this.pages[p.k], { lsn: lsns[0], secs: lsns.length, len: units.length, fmts: objects.filter((o) => o.type === 'fmt') });
    p.buf = new GapBuffer(units); p.objects = objects; p.lsns = lsns; p.dirty = false;
    yield* this.commit(old);
  }

  /** Write the head, then the index entry that points at it; free what the old ones used. */
  *commit(freed = []) {
    const lsns = yield* this.vol.writeJson(this.head);
    yield* this.vol.flushMap();
    const old = this.headLsns;
    this.headLsns = lsns;
    const e = this.entry;
    e.first = lsns[0];
    e.count = lsns.length + this.pages.reduce((a, p) => a + p.secs, 0);
    e.length = this.pages.reduce((a, p) => a + p.len, 0);
    yield* this.vol.writeEntry(e);
    this.vol.release([...old, ...freed]);
    yield* this.vol.flushMap();
  }

  /** END: store the page and mark the document closed. */
  *close() {
    yield* this.storePage();
    this.entry.flags &= ~FLAG.OPEN;
    yield* this.vol.writeEntry(this.entry);
  }

  /** PAGE END at unit `at`: the page ends there and the rest becomes a new page after it (SR 4.15). */
  *splitPage(at) {
    const p = this.page;
    const all = p.buf.toArray();
    const tail = compact(all.slice(at), p.objects);
    p.buf = new GapBuffer([...all.slice(0, at), C.PE]);
    p.dirty = true;
    yield* this.storePage();
    const lsns = yield* this.vol.writePage(tail.units, tail.objects);
    this.pages.splice(p.k + 1, 0, {
      n: pageNumberAfter(this.pages, p.k), lsn: lsns[0], secs: lsns.length, len: tail.units.length,
      fmts: tail.objects.filter((o) => o.type === 'fmt'),
    });
    yield* this.commit();
    this.page = { k: p.k + 1, buf: new GapBuffer(tail.units), objects: tail.objects, lsns, dirty: false };
  }

  /** Join page k + 1 onto page k (the Page End between them deleted); page k must be the page in memory. */
  *joinNext() {
    const p = this.page, k = p.k;
    const next = yield* this.vol.readPage(this.pages[k + 1].lsn);
    const units = p.buf.toArray();
    const base = p.objects.length;
    const moved = Array.from(next.units, (u) => (isObj(u) ? 0x8000 | (objIndex(u) + base) : u));
    p.buf = new GapBuffer([...units.slice(0, units.length - 1), ...moved]);
    p.objects = [...p.objects, ...next.objects];
    p.dirty = true;
    this.pages.splice(k + 1, 1);
    const { units: cu, objects: co } = compact(p.buf.toArray(), p.objects);
    const lsns = yield* this.vol.writePage(cu, co);
    const old = [...p.lsns, ...next.lsns];
    Object.assign(this.pages[k], { lsn: lsns[0], secs: lsns.length, len: cu.length, fmts: co.filter((o) => o.type === 'fmt') });
    p.buf = new GapBuffer(cu); p.objects = co; p.lsns = lsns; p.dirty = false;
    yield* this.commit(old);
  }
}
