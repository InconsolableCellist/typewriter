// Spelling Tasks (SS 2.9, SR 4.26, 7.9; TB2 p.68 to 73): Check Document with its CHECK DOCUMENT and HYPHENATE AND
// PAGINATE DOCUMENT menus, the supplement tasks, and the dictionary hyphenation that pagination asks about.
//
// Check Document goes through the chosen pages a word at a time. A word the dictionary does not know is, with a
// Prompted check, shown on the CHECK SPELLING OF WORD screen: SPELL leaves it highlighted (bracketed by spelling
// marks, reverse video on screen), ENTER takes it as right for the rest of this document, a retyped word replaces it
// and is checked again. An Automatic check marks every such word. Text after an End Spelling Check instruction, up to
// a Begin Spelling Check, is neither checked nor hyphenated. With Hyphenation/Pagination Yes the document is then
// paginated from the page chosen, and each word that crosses the right margin with no break inside the zone is a
// hyphenation decision (prompted, automatic at the dictionary's point, or none). The check ends with TASK SELECTION
// flashing back to TYPING TASKS, Revise Document highlighted and the document's name on the prompt line.
//
// The dictionary is on the program diskette: the sectors that hold a page's words are read when the page is checked,
// and the sector of each word asked about when hyphenating, so a check takes the drive's time.
import { MENUS } from '../menus.js';
import { runMenu, menuState, drawMenu } from '../menu-runner.js';
import { getKey, isEnter, isCancel, isChar, drawPrompt } from '../input.js';
import { fmt } from '../messages.js';
import { ROW } from '../../screen.js';
import { C, isObj, objIndex, info } from '../editor/codes.js';
import { GapBuffer } from '../editor/buffer.js';
import { Document } from '../editor/doc.js';
import { paginateDocument } from '../editor/paginate.js';
import { newEditor, gotoPage, moveTo, touched, adjust, buf, objects } from '../editor/commands.js';
import { drawTyping, relayout, cursorLine } from '../editor/view.js';
import { textUnits } from '../samples.js';
import { LANGUAGE } from '../spell/dictionary.js';
import { TASKS, menuKeys, chooseDocument, guarded } from './common.js';
import { chooseExisting } from './typing.js';
import { waitSignal } from '../../sched.js';

const SUPPLEMENT = 'supplement';         // its entry on the program diskette
const DICTIONARY = 'dictionary';

// ---- words -------------------------------------------------------------------------------------------------------

const ch = (u) => (u < 0x100 ? String.fromCharCode(u) : '');
export const isLetter = (u) => u < 0x100 && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(ch(u));
const isDigit = (u) => u >= 0x30 && u <= 0x39;
/** Units a word runs on through: a syllable hyphen, character underline and other codes that take no column. */
function transparent(u, objs) {
  if (isObj(u)) { const t = objs[objIndex(u)]?.type; return t !== 'smark' && t !== 'spell'; }
  return u >= 0x100 && info(u, objs).width === 'zero' && u !== C.WUND;
}
const markAt = (units, objs, i, begin) => isObj(units[i]) && objs[objIndex(units[i])]?.type === 'smark' && objs[objIndex(units[i])].begin === begin;

/** Whether checking is on before unit `at`: the last Begin or End Spelling Check instruction before it decides. */
export function checkingAt(units, objs, at, initial = true) {
  let on = initial;
  for (let i = 0; i < at && i < units.length; i++) if (isObj(units[i]) && objs[objIndex(units[i])]?.type === 'spell') on = objs[objIndex(units[i])].begin;
  return on;
}

/**
 * The next word at or after unit `from`: { start, end (after its last letter), text, idx (the unit of each
 * character of text), digits, marked, check }. An apostrophe belongs to a word only between letters (company's).
 * Words with digits are not checked. Null at the end.
 */
export function nextWord(units, objs, from, check = true) {
  let on = check;
  for (let i = from; i < units.length; i++) {
    const u = units[i];
    if (isObj(u) && objs[objIndex(u)]?.type === 'spell') { on = objs[objIndex(u)].begin; continue; }
    if (!isLetter(u) && !isDigit(u)) continue;
    let text = '', last = i, digits = false;
    const idx = [];
    for (let j = i; j < units.length; j++) {
      const v = units[j];
      if (isLetter(v) || isDigit(v)) { text += ch(v); idx.push(j); last = j; digits ||= isDigit(v); continue; }
      if (transparent(v, objs)) continue;
      if (v === 0x27) {
        let k = j + 1;
        while (k < units.length && transparent(units[k], objs)) k++;
        if (isLetter(units[k])) { text += "'"; idx.push(j); continue; }
      }
      break;
    }
    const end = last + 1;
    return { start: i, end, text, idx, digits, check: on, marked: markAt(units, objs, i - 1, true) && markAt(units, objs, end, false) };
  }
  return null;
}

/** Every word of a stream of units, for loading a supplement and reading the dictionary. */
export function wordsOf(units, objs) {
  const out = [];
  for (let w = nextWord(units, objs, 0); w; w = nextWord(units, objs, w.end, w.check)) if (!w.digits) out.push(w);
  return out;
}

// ---- the dictionary on the program diskette ----------------------------------------------------------------------

/** Spelling Tasks' segment is in: wait for the word list if it is still on its way, then load the stored supplement. */
export function* spellingLoaded(sys, vol) {
  while (sys.wordListState === 'asked') yield* waitSignal('wordList');
  const d = sys.dictionary;
  if (!d || d.loadedFrom === vol.image.id) return;
  d.loadedFrom = vol.image.id;
  const e = vol.find(SUPPLEMENT);
  if (!e) return;
  try { d.clearSupplement(); d.addSupplement((yield* vol.readHead(e)).head.words ?? []); } catch { /* an unreadable supplement is left out */ }
}

/** Read the dictionary sectors that hold these words. */
function* lookUp(sys, texts) {
  const vol = sys.programVolume(), e = vol?.find(DICTIONARY);
  if (!e || !sys.dictionary) return;
  const blocks = [...new Set(texts.map((t) => sys.dictionary.blockOf(t)))].sort((a, b) => a - b);
  for (let k = 0; k < blocks.length;) {
    let n = 1;
    while (blocks[k + n] === blocks[k] + n) n++;
    yield* vol.readRun({ first: e.first + blocks[k], count: n });
    k += n;
  }
}

// ---- marks -------------------------------------------------------------------------------------------------------

function mark(ed, w) {
  objects(ed).push({ type: 'smark', begin: false }, { type: 'smark', begin: true });
  const n = objects(ed).length;
  buf(ed).insert(w.end, [0x8000 | (n - 2)]);
  buf(ed).insert(w.start, [0x8000 | (n - 1)]);
  touched(ed);
}

function unmark(ed, w) {
  buf(ed).delete(w.end, 1);
  buf(ed).delete(w.start - 1, 1);
  touched(ed);
}

/** CANCL in the typing area takes the highlighting off the cursored word (SR 3.2, 4.26). */
export function unmarkAt(ed) {
  const units = buf(ed).toArray(), objs = objects(ed);
  let a = ed.cur;
  if (markAt(units, objs, a, true)) a++;
  let s = a;
  while (s > 0 && !markAt(units, objs, s - 1, true) && !markAt(units, objs, s - 1, false) && !isEndUnit(units[s - 1])) s--;
  if (!markAt(units, objs, s - 1, true)) return false;
  let e = s;
  while (e < units.length && !markAt(units, objs, e, false) && !isEndUnit(units[e])) e++;
  if (!markAt(units, objs, e, false)) return false;
  buf(ed).delete(e, 1);
  buf(ed).delete(s - 1, 1);
  moveTo(ed, s - 1);
  touched(ed);
  return true;
}
const isEndUnit = (u) => u === C.CR || u === C.RCR || u === C.PE || u === C.RPE || u === C.IDX || u === C.IDXR;

// ---- CHECK SPELLING OF WORD ----------------------------------------------------------------------------------------

/** The document in the top half with the word highlighted on the third text line, the panel below (ORG p.110). */
function drawCheck(sys, ed, w, answer) {
  ed.cur = w.start;
  ed.sel = [w.start, w.end - 1];
  ed.fn = fmt('spellCheck');
  ed.prompt = { text: fmt('retypeWord'), answer };
  relayout(ed);
  ed.top = Math.max(0, cursorLine(ed) - 2);
  drawTyping(sys, ed);
  const s = sys.screen;
  for (const [f, v] of [['C', ''], ['E', LANGUAGE], ['L', '']]) s.field(f, v);
  s.clearRows(ROW.SCALE);
  s.clearRows(13, 23);
  s.put(13, 3, fmt('checkBanner'));
  s.put(15, 4, fmt('checkLeave')); s.put(15, 51, fmt('pressSpell'));
  s.put(16, 4, fmt('checkRemove')); s.put(16, 51, fmt('pressEnter'));
  s.put(17, 4, fmt('checkRetype')); s.put(17, 51, fmt('retypeThe'));
  s.put(18, 51, fmt('pressEnterDot'));
  s.put(20, 4, fmt('checkWord'));
  s.put(21, 4, w.text);
  ed.sel = null;
}

/** One stop: 'leave', 'remove', { retype } or 'end'. */
function* askWord(sys, ed, w) {
  let answer = '';
  for (;;) {
    drawCheck(sys, ed, w, answer);
    const ev = yield* getKey(sys, (e) => isChar(e) || isEnter(e) || isCancel(e) || e.name === 'BKSP' || e.name === 'END' || (e.name === 'SPELL' && !e.code));
    if (ev.name === 'SPELL') return 'leave';
    if (ev.name === 'END') return 'end';
    if (isCancel(ev)) { answer = ''; continue; }
    if (ev.name === 'BKSP') { answer = answer.slice(0, -1); continue; }
    if (isEnter(ev)) return answer ? { retype: answer } : 'remove';
    if (answer.length < 60) answer += ev.ch;
  }
}

/**
 * Check pages of an open document. `pages`: the page indices; `kind` 1 Prompted, 2 Automatic; `backdrop` redraws the
 * menu that stays on screen between stops. Returns the number of words left marked.
 */
function* checkPages(sys, doc, pages, kind, backdrop) {
  const d = sys.dictionary;
  const ed = newEditor(sys, doc);
  const accepted = new Set(), left = new Set();
  let marked = 0, prompting = kind === 1, check = true;
  for (const k of pages) {
    yield* gotoPage(ed, k);
    yield* lookUp(sys, wordsOf(buf(ed).toArray(), objects(ed)).map((w) => w.text));
    for (let w = nextWord(buf(ed).toArray(), objects(ed), 0, check); w;) {
      let at = w.end + (w.marked ? 1 : 0);
      check = w.check;
      if (w.check && !w.digits) {
        const right = d.has(w.text) || accepted.has(w.text);
        if (right) { if (w.marked) { unmark(ed, w); at -= 2; } }
        else if (left.has(w.text) || !prompting) {
          if (!w.marked) { mark(ed, w); at += 2; }
          marked++;
        } else {
          const r = yield* askWord(sys, ed, w);
          ed.prompt = null; ed.fn = '';
          if (r === 'end') prompting = false;
          if (r === 'leave' || r === 'end') { left.add(w.text); if (!w.marked) { mark(ed, w); at += 2; } marked++; }
          else if (r === 'remove') { accepted.add(w.text); if (w.marked) { unmark(ed, w); at -= 2; } }
          else {
            // The retyped word replaces the old one, marks and all, and is checked in its turn.
            const a = w.marked ? w.start - 1 : w.start, b = w.marked ? w.end + 1 : w.end;
            const rep = textUnits(r.retype);
            buf(ed).delete(a, b - a);
            buf(ed).insert(a, rep);
            touched(ed);
            moveTo(ed, a);
            adjust(ed, a);
            yield* lookUp(sys, [r.retype]);
            at = ed.cur;
          }
          backdrop();
        }
      }
      w = nextWord(buf(ed).toArray(), objects(ed), at, check);
    }
  }
  yield* doc.storePage();
  return marked;
}

// ---- hyphenation decisions -----------------------------------------------------------------------------------------

/** The dictionary's hyphen points of the word in units a..b, as unit indices (before which a hyphen may go). */
function hyphenUnits(sys, units, objs, a, b) {
  const out = [];
  for (let w = nextWord(units, objs, a); w && w.start < b; w = nextWord(units, objs, w.end)) {
    if (!w.digits) for (const p of sys.dictionary?.hyphenate(w.text) ?? []) out.push(w.idx[p]);
    const after = w.end;
    if (after < b && (units[after] === C.RHY || units[after] === 0x2d)) out.push(after + 1);
  }
  return out.filter((j) => j > a && j < b).sort((x, y) => x - y);
}

/**
 * The `decide` that pagination asks (layout.reflowWith): with `prompted`, the text is shown with the cursor at the
 * dictionary's point (or on the word's first character when there is none) and `Hyphenate where?`; the operator moves
 * it and presses ENTER. On the first character the word goes down; past its last character (punctuation counts) it
 * stays; elsewhere a hyphen goes in before the cursor. END abandons the decisions left (TB2 p.585). Automatic takes
 * the dictionary's point, or moves the word down.
 */
export function hyphenation(sys, doc, prompted) {
  let abandoned = false;
  return function* decide(q) {
    if (abandoned || !checkingAt(q.units, q.objects, q.wordStart)) return 'down';
    const word = nextWord(q.units, q.objects, q.wordStart);
    if (word) yield* lookUp(sys, [word.text]);
    const points = hyphenUnits(sys, q.units, q.objects, q.wordStart, q.wordEnd).filter(q.fits);
    const suggestion = points.length ? points[points.length - 1] : null;
    if (!prompted) return suggestion != null ? { at: suggestion } : 'down';
    const page = { k: 0, buf: new GapBuffer(q.units), objects: q.objects, lsns: [], dirty: false };
    const view = {
      name: doc.name, vol: doc.vol, pages: [{ n: q.page }], page,
      layoutCtx: (k, displayCodes = false) => ({ ...q.ctx, displayCodes }),
    };
    const r = yield* hyphenateWhere(sys, newEditor(sys, view), q, suggestion ?? q.wordStart, fmt('paginating'));
    if (r === 'end') { abandoned = true; return 'down'; }
    return r;
  };
}

/**
 * `Hyphenate where?` over an editor showing the text (SR 4.19): the cursor moves within the word; ENTER decides.
 * Returns 'down', 'keep', { at } or 'end'. A point where the hyphen would stand past the margin is refused with a
 * short beep.
 */
export function* hyphenateWhere(sys, ed, q, start, status) {
  ed.cur = start;
  for (;;) {
    ed.fn = status;
    ed.prompt = { text: fmt('hyphenateWhere') };
    drawTyping(sys, ed);
    const ev = yield* getKey(sys, (e) => isEnter(e) || e.name === 'LEFT' || e.name === 'RIGHT' || e.name === 'END');
    const zero = (j) => j > q.wordStart && j < q.wordEnd && ed.L.w[j] === 0;
    if (ev.name === 'LEFT') { let j = Math.max(q.wordStart, ed.cur - 1); while (zero(j)) j--; ed.cur = j; continue; }
    if (ev.name === 'RIGHT') { let j = Math.min(q.wordEnd, ed.cur + 1); while (zero(j)) j++; ed.cur = j; continue; }
    ed.prompt = null;
    if (ev.name === 'END') return 'end';
    if (ed.cur <= q.wordStart) return 'down';
    if (ed.cur >= q.wordEnd) return 'keep';
    if (q.fits(ed.cur)) return { at: ed.cur };
    sys.tone('short');
  }
}

// ---- the tasks -----------------------------------------------------------------------------------------------------

function pageList(doc, text, from) {
  const want = String(text ?? '').trim();
  if (!want) return doc.pages.map((_, k) => k).filter((k) => k >= from);
  const names = want.split(/\s+/);
  return doc.pages.map((p, k) => (names.includes(p.n) ? k : -1)).filter((k) => k >= 0);
}

/** Check Document (ORG p.108, p.167; TB2 p.68 to 73). */
function* checkDocument(sys, { preset } = {}) {
  if (!sys.dictionary) { sys.messages.show('noDictionary'); return null; }
  const ch0 = yield* chooseExisting(sys, preset);
  if (!ch0) return null;
  return yield* guarded(sys, ch0.vol, function* () {
    const doc = yield* Document.open(ch0.vol, ch0.entry);
    const docName = doc.name.slice(0, 20);
    const st = menuState({ kind: 1, pages: '', hyphenate: 1 });
    const r = yield* runMenu(sys, MENUS.checkDocument, st, { docName, allowEnd: true, ...menuKeys(sys) });
    if (!r.done) { yield* doc.close(); return null; }
    const v = st.values;
    let hp = null;
    if (v.hyphenate === 1 && doc.head.preserve !== 1) {
      const hs = menuState({ hyphenation: 1, from: 1, exact: 2, print: 1, paper: 1 });
      const r2 = yield* runMenu(sys, MENUS.hyphenatePaginate, hs, { vars: { pages: doc.pages.length }, docName, allowEnd: true, ...menuKeys(sys) });
      if (!r2.done) { yield* doc.close(); return null; }
      hp = hs.values;
    }
    const def = hp ? MENUS.hyphenatePaginate : MENUS.checkDocument;
    const shown = hp ? menuState(hp) : st;
    const backdrop = () => {
      sys.drawStatus({ A: fmt('spellCheck'), B: docName });
      drawMenu(sys, def, { values: shown.values, initial: shown.values }, { vars: { pages: doc.pages.length } });
      drawPrompt(sys, '', null);
    };
    backdrop();
    let marked = 0;
    if (v.kind !== 3) marked = yield* checkPages(sys, doc, pageList(doc, v.pages, hp ? hp.from - 1 : 0), v.kind, backdrop);
    if (hp) {
      sys.drawStatus({ A: fmt('paginating'), B: docName });
      const decide = hp.hyphenation === 3 ? null : hyphenation(sys, doc, hp.hyphenation === 1);
      yield* paginateDocument(doc, Math.min(hp.from, doc.pages.length) - 1, { exact: hp.exact === 1, decide });
      backdrop();
      sys.messages.post('paginated', { name: doc.name });
    }
    yield* doc.close();
    if (hp?.print === 1) sys.spooler.add({ name: doc.name, disk: doc.vol.name, opts: { paper: hp.paper } });
    if (v.kind !== 3) sys.messages.post('spellComplete', { n: marked });
    sys.lastDocument = doc.name;
    sys.lastDiskette = doc.vol.name;
    return { to: 'typingTasks', highlight: 'b', auto: true };
  });
}

/** Load Supplement (ORG p.425): the words of a document go into the supplement in memory. */
function* loadSupplement(sys, { preset } = {}) {
  if (!sys.dictionary) { sys.messages.show('noDictionary'); return null; }
  const ch0 = yield* chooseExisting(sys, preset);
  if (!ch0) return null;
  return yield* guarded(sys, ch0.vol, function* () {
    const { head } = yield* ch0.vol.readHead(ch0.entry);
    const words = [];
    for (const p of head.pages) {
      const pg = yield* ch0.vol.readPage(p.lsn);
      for (const w of wordsOf(Array.from(pg.units), pg.objects)) if (!sys.dictionary.has(w.text)) words.push(w.text);
    }
    const d = sys.dictionary;
    d.addSupplement(words);
    sys.messages.post(words.every((w) => d.has(w)) ? 'supLoaded' : 'supFull', { n: d.supplement.length });
    return null;
  });
}

/** Clear Supplement (ORG p.305). */
function* clearSupplement(sys) {
  sys.dictionary?.clearSupplement();
  sys.messages.post('supCleared');
  return null;
}

/** Store Supplement On Program Diskette (ORG p.527): the supplement is written beside the dictionary. */
function* storeSupplement(sys) {
  const vol = sys.programVolume(), d = sys.dictionary;
  if (!d) { sys.messages.show('noDictionary'); return null; }
  if (!vol) { sys.messages.show('diskNotFound', { disk: '' }); return null; }
  return yield* guarded(sys, vol, function* () {
    const lsns = yield* vol.writeJson({ words: d.supplement });
    yield* vol.flushMap();
    const old = vol.find(SUPPLEMENT);
    if (old) {
      const freed = yield* vol.chainLsns(old.first);
      Object.assign(old, { first: lsns[0], count: lsns.length, length: lsns.length * 256 });
      yield* vol.writeEntry(old);
      vol.release(freed);
      yield* vol.flushMap();
    } else {
      yield* vol.addEntry({ name: SUPPLEMENT, comment: 'Textpack 4', type: 4, flags: 0, first: lsns[0], count: lsns.length, length: lsns.length * 256 });
      yield* vol.flushMap();
    }
    sys.messages.post('supStored');
    return null;
  });
}

/** Create Document Of Supplemental Words (ORG p.345): a new document holding the supplement, a word to a line. */
function* supplementDocument(sys, { preset } = {}) {
  const d = sys.dictionary;
  if (!d) { sys.messages.show('noDictionary'); return null; }
  if (!d.supplement.length) { sys.messages.show('supEmpty'); return null; }
  for (;;) {
    const ch0 = yield* chooseDocument(sys, preset);
    preset = null;
    if (!ch0) return null;
    if (ch0.vol.find(ch0.name)) { sys.messages.show('exists', { name: ch0.name }); continue; }
    sys.messages.clear();
    drawPrompt(sys, fmt('confirm'), null);
    const ev = yield* getKey(sys, (e) => isEnter(e) || isCancel(e));
    if (!isEnter(ev)) return null;
    return yield* guarded(sys, ch0.vol, function* () {
      const doc = yield* Document.create(sys, ch0.vol, ch0.name);
      doc.page.buf = new GapBuffer([...d.supplement.flatMap((w) => [...textUnits(w), C.RCR]), C.PE]);
      doc.page.dirty = true;
      yield* doc.close();
      sys.messages.post('supWritten', { name: ch0.name });
      return null;
    });
  }
}

Object.assign(TASKS, { checkDocument, loadSupplement, clearSupplement, storeSupplement, supplementDocument });
