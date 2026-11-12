// The editing functions of the typing area (SR 4.8 to 4.14, 4.23). DEL, MOVE, COPY and OVERSTRIKE share one
// selection pattern (SR 4.8): the prompt, a highlight grown from the cursor by the cursor keys, by typing a
// character (to its next occurrence), RET (to the next required return), CODE+RET (the next line end), PAGE END or
// CODE+DOWN (the end of the page) or FIND; ENTER confirms; CANCL cancels. Moved and copied lines are not re-adjusted.
import { C, isObj, objIndex, info, isChar, HARD_ENDS, LINE_ENDS } from './codes.js';
import { formatAt } from './layout.js';
import { copyFormat, diffFormat } from './format.js';
import { drawTyping, relayout, cursorLine } from './view.js';
import {
  FUNCTIONS, moveKey, codeFor, adjust, touched, moveTo, gotoPage, buf, objects,
} from './commands.js';
import { MENUS } from '../menus.js';
import { runMenu, menuState } from '../menu-runner.js';
import { getKey, isEnter, isCancel, promptLine, Navigate } from '../input.js';
import { bypassPrompt } from '../bypass.js';
import { fmt } from '../messages.js';
import { formatSelection, formatSubmenu } from '../formats.js';
import { textUnits } from '../samples.js';
import { SYMBOL_TEXT, SYM } from '../../charset.js';
import { volumeNamed, TASKS } from '../tasks/common.js';

const WHAT = {
  delete: ['deleteWhat', 'deleteText'], move: ['moveWhat', 'moveText'], copy: ['copyWhat', 'copyText'],
  overstrike: ['overstrikeWhat', 'overstrikeText'],
};

// ---- the page as data ------------------------------------------------------------------------------------------

/** Units a..b (inclusive) with their own copy of the objects they refer to. */
function extract(ed, a, b) {
  const objs = [];
  const units = Array.from(buf(ed).slice(a, b + 1), (u) => {
    if (!isObj(u)) return u;
    objs.push(structuredClone(objects(ed)[objIndex(u)]));
    return 0x8000 | (objs.length - 1);
  });
  return { units, objects: objs };
}

function insertClip(ed, at, clip) {
  const base = objects(ed).length;
  objects(ed).push(...clip.objects.map((o) => structuredClone(o)));
  buf(ed).insert(at, clip.units.map((u) => (isObj(u) ? 0x8000 | (objIndex(u) + base) : u)));
  touched(ed);
}

function insertObject(ed, at, obj) {
  objects(ed).push(obj);
  buf(ed).insert(at, [0x8000 | (objects(ed).length - 1)]);
  touched(ed);
}

const unitsArr = (ed) => buf(ed).toArray();

// ---- selection -------------------------------------------------------------------------------------------------

function nextIndex(units, from, pred) {
  for (let j = from; j < units.length; j++) if (pred(units[j])) return j;
  return -1;
}

/**
 * Grow the highlight with one key. Typed characters build a target string: the highlight runs through the first
 * occurrence of the string after where the typing began (TB1 p.23, "necessary."); when the string does not occur,
 * the last character alone moves it to that character's next occurrence, so each SPACE takes one more word (ORG
 * p.352). `typed` carries the string between keys.
 */
function* extend(sys, ed, ev, typed) {
  const k = ed.doc.page.k, cur = ed.cur;
  if (yield* moveKey(ed, ev)) {
    if (ed.doc.page.k !== k) { yield* gotoPage(ed, k); ed.cur = cur; }     // a highlight stays on its page
    ed.nta = null;
    typed.units = [];
    return true;
  }
  const u = unitsArr(ed), last = u.length - 1;
  let j = -1;
  if (ev.ch != null && !ev.code && !ev.control) {
    const want = codeFor(sys, ev);
    if (!typed.units.length) typed.from = ed.cur + 1;
    typed.units.push(want);
    const at = matchFrom(u, objects(ed), typed.units, typed.from);
    if (at >= 0 && at + typed.units.length - 1 > ed.cur) j = at + typed.units.length - 1;
    else {
      typed.units = [want];
      typed.from = ed.cur + 1;
      j = nextIndex(u, ed.cur + 1, (x) => matchAt([x], [], 0, [want]));
    }
    if (j >= 0) moveTo(ed, j);
    return true;
  }
  typed.units = [];
  if (ev.name === 'FIND' && !ev.code) { yield* find(sys, ed, { within: true }); return true; }
  if (ev.name === 'PAGE END' && !ev.code) j = last;
  else if (ev.name === 'RETURN' && !ev.control) j = nextIndex(u, ed.cur + 1, ev.code ? (x) => LINE_ENDS.has(x) : (x) => HARD_ENDS.has(x));
  else return false;
  if (j >= 0) moveTo(ed, j);
  return true;
}

/** The selection pattern; returns [first, last] unit indices or null on CANCL. */
function* select(sys, ed, which) {
  const anchor = ed.cur;
  const typed = { units: [], from: 0 };
  ed.fn = fmt(WHAT[which][1]);
  ed.prompt = { text: fmt(WHAT[which][0]) };
  ed.sel = [anchor, anchor];
  try {
    for (;;) {
      drawTyping(sys, ed);
      const ev = yield* getKey(sys);
      if (isEnter(ev)) return [...ed.sel];
      if (isCancel(ev)) return null;
      yield* extend(sys, ed, ev, typed);
      ed.sel = [Math.min(anchor, ed.cur), Math.max(anchor, ed.cur)];
    }
  } finally {
    ed.prompt = null;
  }
}

function done(ed) { ed.sel = null; ed.prompt = null; ed.fn = ''; }

/** DEL (SR 4.8): the highlighted text goes and the line re-adjusts. The last Page End of a document stays. */
function* del(sys, ed) {
  const r = yield* select(sys, ed, 'delete');
  done(ed);
  if (!r) return;
  let [a, b] = r;
  const n = buf(ed).length;
  const join = b === n - 1 && ed.doc.page.k + 1 < ed.doc.pages.length;
  if (b === n - 1) b = n - 2;
  if (b >= a) buf(ed).delete(a, b - a + 1);
  moveTo(ed, a);
  touched(ed);
  if (join) yield* ed.doc.joinNext();
  adjust(ed, Math.min(ed.cur, buf(ed).length - 1));
}

/** MOVE and COPY (SR 4.8): "To where?", then the text goes in before the cursor, which ends on its first unit. */
function* moveCopy(sys, ed, copy) {
  const r = yield* select(sys, ed, copy ? 'copy' : 'move');
  if (!r) { done(ed); return; }
  let [a, b] = r;
  if (b === buf(ed).length - 1) b--;
  if (b < a) { done(ed); return; }
  const clip = extract(ed, a, b);
  const srcK = ed.doc.page.k;
  ed.prompt = { text: fmt('toWhere') };
  for (;;) {
    ed.sel = ed.doc.page.k === srcK ? [a, b] : null;
    drawTyping(sys, ed);
    const ev = yield* getKey(sys);
    if (isCancel(ev)) { if (ed.doc.page.k !== srcK) yield* gotoPage(ed, srcK); moveTo(ed, a); done(ed); return; }
    if (isEnter(ev)) break;
    if (ev.name === 'GO TO' && !ev.code) yield* goTo(sys, ed);
    else yield* moveKey(ed, ev);
  }
  const d = ed.cur, k = ed.doc.page.k, len = b - a + 1;
  done(ed);
  if (k === srcK) {
    if (!copy && d > a && d <= b + 1) { moveTo(ed, a); return; }   // into itself: nothing moves
    insertClip(ed, d, clip);
    if (!copy) buf(ed).delete(d <= a ? a + len : a, len);
    moveTo(ed, !copy && d > b ? d - len : d);
    return;
  }
  insertClip(ed, d, clip);
  if (!copy) {
    yield* ed.doc.storePage();
    yield* ed.doc.loadPage(srcK);
    buf(ed).delete(a, len);
    touched(ed);
    yield* ed.doc.storePage();
    yield* ed.doc.loadPage(k);
  }
  relayout(ed);
  moveTo(ed, d);
}

/** OVERSTRIKE (CODE+DEL, SR 4.8): the text is bracketed by overstrike codes carrying the character. */
function* overstrike(sys, ed) {
  const r = yield* select(sys, ed, 'overstrike');
  if (!r) { done(ed); return; }
  const [a, b] = r;
  let ch = null;
  for (;;) {
    ed.prompt = { text: fmt('overstrikeWith'), answer: ch ?? '' };
    drawTyping(sys, ed);
    const ev = yield* getKey(sys, (e) => isEnter(e) || isCancel(e) || e.ch != null || e.name === 'BKSP');
    if (isCancel(ev)) { done(ed); return; }
    if (ev.name === 'BKSP') { ch = null; continue; }
    if (isEnter(ev)) { if (ch) break; continue; }
    if (!ev.code) ch = ev.ch;
  }
  done(ed);
  const end = Math.min(b + 1, buf(ed).length - 1);
  insertObject(ed, end, { type: 'ovs', begin: false });
  insertObject(ed, a, { type: 'ovs', begin: true, ch });
  moveTo(ed, a);
}

// ---- FIND and GLOBAL -------------------------------------------------------------------------------------------

/** A FIND argument element: a unit, or { obj } for any code of an object type (CHG FMT, INSTR, OVERSTRIKE). */
function argFor(sys, ev) {
  if (ev.name === 'CHG FMT') return { obj: ev.code ? 'keep' : 'fmt' };
  if (ev.name === 'DEL' && ev.code) return { obj: 'ovs' };
  if (ev.name === 'PAGE END') return ev.code ? C.RPE : C.PE;
  if (ev.name === 'SPELL' && !ev.code) return { obj: 'smark', begin: true };     // a highlighted word (SR 4.26)
  return codeFor(sys, ev);
}

function argText(arg) {
  return arg.map((x) => (typeof x === 'object' ? SYMBOL_TEXT[x.obj === 'fmt' ? SYM.FMT_CHANGE : x.obj === 'ovs' ? SYM.OVS_BEGIN : x.obj === 'smark' ? SYM.SQUARE : SYM.KEEP]
    : isChar(x) ? String.fromCharCode(x) : SYMBOL_TEXT[info(x, []).sym])).join('');
}

function matchAt(units, objs, i, arg) {
  for (let k = 0; k < arg.length; k++) {
    const u = units[i + k], a = arg[k];
    if (u === undefined) return false;
    if (typeof a === 'object') {
      if (!isObj(u) || objs[objIndex(u)].type !== a.obj || (a.begin != null && objs[objIndex(u)].begin !== a.begin)) return false;
    }
    else if (u !== a && !(a === C.RHY && (u === 0x2d || u === C.SHY))) return false;
  }
  return true;
}

function matchFrom(units, objs, arg, from) {
  for (let i = from; i < units.length; i++) if (matchAt(units, objs, i, arg)) return i;
  return -1;
}

/** The FIND argument from the prompt line; ENTER alone repeats the last one (SR 4.9). Null on CANCL. */
function* findArgument(sys, ed) {
  let arg = [];
  for (;;) {
    ed.prompt = { text: fmt('findWhat'), answer: argText(arg) };
    drawTyping(sys, ed);
    const ev = yield* getKey(sys);
    if (isEnter(ev)) return arg.length ? arg : sys.findArg ?? null;
    if (isCancel(ev)) { if (arg.length) { arg = []; continue; } return null; }
    if (ev.name === 'BKSP' && !ev.code) { arg.pop(); continue; }
    const a = argFor(sys, ev);
    if (a != null && arg.length < 60) arg.push(a);
  }
}

/** Search forward from the cursor through the rest of the document; true if found (cursor on the match). */
export function* findNext(ed, arg) {
  const d = ed.doc;
  // FIND SPELL puts the cursor on the highlighted word's first character, after its mark.
  const on = arg.length === 1 && arg[0].obj === 'smark' ? 1 : 0;
  let j = matchFrom(unitsArr(ed), objects(ed), arg, ed.cur + 1 - on);
  if (j >= 0) { moveTo(ed, j + on); return true; }
  for (let k = d.page.k + 1; k < d.pages.length; k++) {
    const p = yield* d.vol.readPage(d.pages[k].lsn);
    j = matchFrom(Array.from(p.units), p.objects, arg, 0);
    if (j >= 0) { yield* gotoPage(ed, k); moveTo(ed, j + on); return true; }
  }
  return false;
}

/** FIND (SR 4.9): forward only; with no match the cursor stays, with a short beep and a message (13.3). */
function* find(sys, ed, { within = false } = {}) {
  const fn = ed.fn, prompt = ed.prompt;
  if (!within) ed.fn = fmt('findText');
  const arg = yield* findArgument(sys, ed);
  ed.prompt = prompt;
  if (!within) ed.fn = fn;
  if (!arg) return;
  sys.findArg = arg;
  if (!(yield* findNext(ed, arg))) { sys.tone('short'); sys.messages.show('findNone'); }
}

const isWordChar = (u) => u < 0x100 && /[A-Za-z0-9À-ÿ']/.test(String.fromCharCode(u));

/** GLOBAL REPLACE/DELETE (CODE+FIND, SR 4.10). */
function* global(sys, ed) {
  sys.globalState ??= menuState({ search: 2, match: 1, s1: '', r1: '', s2: '', r2: '', s3: '', r3: '' });
  const st = sys.globalState;
  const r = yield* runMenu(sys, MENUS.global, st, { status: fmt('globalText'), docName: ed.doc.name.slice(0, 20) });
  Object.assign(st.initial, st.values);
  if (!r.done) return;
  const v = st.values;
  const pairs = [[v.s1, v.r1], [v.s2, v.r2], [v.s3, v.r3]].filter(([s]) => s).map(([s, rep]) => ({ find: textUnits(s), rep: textUnits(rep) }));
  if (!pairs.length) return;
  const word = v.match === 1, prompted = v.search === 1;
  let found = 0, changed = 0;
  ed.fn = fmt('globalText');
  const hit = (units, objs, i) => {
    for (const p of pairs) {
      if (!matchAt(units, objs, i, p.find)) continue;
      if (word && (isWordChar(units[i - 1]) || isWordChar(units[i + p.find.length]))) continue;
      return p;
    }
    return null;
  };
  let from = ed.cur;
  for (;;) {
    const u = unitsArr(ed);
    let i = from, p = null;
    for (; i < u.length && !(p = hit(u, objects(ed), i)); i++);
    if (!p) {
      if (ed.doc.page.k + 1 >= ed.doc.pages.length) break;
      yield* gotoPage(ed, ed.doc.page.k + 1);
      from = 0;
      continue;
    }
    found++;
    moveTo(ed, i);
    let replace = true;
    if (prompted) {
      ed.sel = [i, i + p.find.length - 1];
      ed.prompt = { text: fmt('globalReplace') };
      drawTyping(sys, ed);
      const ev = yield* getKey(sys, (e) => isEnter(e) || isCancel(e));
      replace = isEnter(ev);
      ed.sel = null;
      if (!replace) {
        ed.prompt = { text: fmt('globalContinue') };
        drawTyping(sys, ed);
        const go = yield* getKey(sys, (e) => isEnter(e) || isCancel(e));
        if (!isEnter(go)) { found = -1; break; }
      }
    }
    if (replace) {
      buf(ed).delete(i, p.find.length);
      buf(ed).insert(i, p.rep);
      touched(ed);
      changed++;
      moveTo(ed, i);
      adjust(ed, Math.min(i, buf(ed).length - 1));
      from = ed.cur + p.rep.length;
      if (prompted) {
        ed.prompt = { text: fmt('globalContinue') };
        drawTyping(sys, ed);
        const go = yield* getKey(sys, (e) => isEnter(e) || isCancel(e));
        if (!isEnter(go)) break;
      }
    } else from = i + 1;
  }
  done(ed);
  if (found === 0) sys.messages.show('globalNone');
  else sys.messages.show(prompted ? 'globalChanged' : 'globalFound', { n: changed });
}

// ---- GO TO and GET ---------------------------------------------------------------------------------------------

/** GO TO (SR 4.11): a system page number, or ENTER alone for the next page; past the end, the last Page End. */
export function* goTo(sys, ed) {
  const fn = ed.fn;
  ed.fn = fmt('goToText');
  drawTyping(sys, ed);
  const n = yield* promptLine(sys, 'pageNumber', { max: 8, digits: true });
  ed.fn = fn;
  if (n === null) return;
  const pages = ed.doc.pages;
  let k = n === '' ? Math.min(ed.doc.page.k + 1, pages.length - 1) : pages.findIndex((p) => p.n === n);
  if (k < 0) { yield* gotoPage(ed, pages.length - 1); moveTo(ed, buf(ed).length - 1); return; }
  yield* gotoPage(ed, k);
}

/** GET (SR 4.12): pages of a stored document come in at the cursor, their Page Ends taken out. */
function* get(sys, ed) {
  sys.getState ??= menuState({ name: '', disk: ed.doc.vol.name, pages: '', include: 2 });
  const st = sys.getState;
  for (;;) {
    const r = yield* runMenu(sys, MENUS.get, st, { status: fmt('getText'), docName: ed.doc.name.slice(0, 20) });
    if (!r.done) return;
    const v = st.values;
    if (!v.name || !v.disk) { sys.messages.show('choiceInvalid'); continue; }
    const vol = yield* volumeNamed(sys, v.disk);
    if (!vol) return;
    const e = vol.find(v.name);
    if (!e) { sys.messages.show('notFound', { name: v.name, disk: vol.name }); continue; }
    if (vol === ed.doc.vol && e === ed.doc.entry) yield* ed.doc.storePage();
    const { head } = yield* vol.readHead(e);
    const want = String(v.pages).trim() ? String(v.pages).trim().split(/\s+/) : null;
    const clip = { units: [], objects: [] };
    for (const p of head.pages) {
      if (want && !want.includes(p.n)) continue;
      const pg = yield* vol.readPage(p.lsn);
      const base = clip.objects.length;
      clip.objects.push(...pg.objects);
      for (const u of Array.from(pg.units).slice(0, -1)) clip.units.push(isObj(u) ? 0x8000 | (objIndex(u) + base) : u);
    }
    Object.assign(st.initial, st.values);
    const at = ed.cur;
    insertClip(ed, at, clip);
    moveTo(ed, at);
    return;
  }
}

// ---- formats ---------------------------------------------------------------------------------------------------

/** CHG FMT (SR 4.13): the FORMAT SELECTION the cursor's place allows; the changes go in as one format change code. */
function* chgFmt(sys, ed, only = null) {
  relayout(ed);
  const line = ed.L.lines[cursorLine(ed)];
  const def = only ?? (ed.cur === 0 ? MENUS.formatSelectionPage : ed.cur === line.start ? MENUS.formatSelectionLine : MENUS.formatSelectionMid);
  const p = ed.doc.page;
  const base = formatAt(p.buf.toArray(), p.objects, ed.cur, ed.doc.layoutCtx(p.k));
  const work = copyFormat(base);
  const r = yield* formatSelection(sys, work, { status: fmt('formatChange'), docName: ed.doc.name.slice(0, 20), def });
  if (r === 'cancel') return;
  if (r.ret) insertObject(ed, ed.cur, { type: 'fmt', kind: r.ret });
  else {
    const values = diffFormat(work, base);
    if (!Object.keys(values).length) return;
    insertObject(ed, ed.cur, { type: 'fmt', kind: 'set', values });
  }
  ed.cur++;
  readjustFrom(ed, ed.cur);
}

/** After a format change, re-adjust every paragraph from `at` to the end of the page. */
function readjustFrom(ed, at) {
  const keep = ed.cur;
  for (let i = at; i < buf(ed).length;) {
    ed.cur = i;
    adjust(ed, i);
    const u = unitsArr(ed);
    let pe = ed.cur;
    while (pe < u.length - 1 && !HARD_ENDS.has(u[pe])) pe++;
    i = pe + 1;
    if (i <= at) break;
  }
  moveTo(ed, Math.min(keep, buf(ed).length - 1));
}

/** ENTER with the cursor on a format change: review and revise it in its menus (SR 4.13, ORG p.385). */
function* reviewFormat(sys, ed) {
  const p = ed.doc.page, o = p.objects[objIndex(p.buf.at(ed.cur))];
  if (o.kind !== 'set') return;
  const before = formatAt(p.buf.toArray(), p.objects, ed.cur, ed.doc.layoutCtx(p.k));
  const work = copyFormat({ ...before, ...o.values });
  const def = ed.cur === 0 ? MENUS.formatSelectionPage : MENUS.formatSelection;
  const r = yield* formatSelection(sys, work, { status: fmt('formatChange'), docName: ed.doc.name.slice(0, 20), def });
  if (r !== 'done') return;
  o.values = diffFormat(work, before);
  touched(ed);
  readjustFrom(ed, ed.cur);
}

/** INSTR (CODE+CHG FMT, SR 4.14): the instructions that are codes in the text. */
function* instr(sys, ed) {
  const r = yield* runMenu(sys, MENUS.instructions, null, { status: fmt('formatChange'), docName: ed.doc.name.slice(0, 20) });
  if (!INSTRUCTION[r.go]) return;
  insertObject(ed, ed.cur, { ...INSTRUCTION[r.go] });
  ed.cur++;
}

/** SCREEN FORMAT (CODE+END, SR 4.23): Display Codes. */
function* screenFormat(sys, ed) {
  const st = menuState({ displayCodes: ed.displayCodes ? 1 : 2 });
  const r = yield* runMenu(sys, MENUS.screenFormat, st, { docName: ed.doc.name.slice(0, 20) });
  if (r.done) ed.displayCodes = st.values.displayCodes === 1;
}

const INSTRUCTION = {
  beginKeep: { type: 'keep', begin: true }, endKeep: { type: 'keep', begin: false },
  beginSpell: { type: 'spell', begin: true }, endSpell: { type: 'spell', begin: false },
};

/**
 * Menu Bypass from the typing area (ORG p.445): instructions and format items act here, where the cursor allows
 * them; a target in another task ends the document and goes there.
 */
function* bypass(sys, ed) {
  const fn = ed.fn;
  ed.fn = fmt('menuBypass');
  drawTyping(sys, ed);
  const b = yield* bypassPrompt(sys);
  ed.fn = fn;
  if (!b) return;
  if (b.unknown) { sys.messages.show('abbrInvalid', { abbr: b.abbr }); return; }
  const t = b.target;
  if (t.na) { sys.messages.show('notAvailable', { what: t.na }); return; }
  if (t.request) { yield* TASKS[t.request](sys, {}); return; }
  if (t.task) {
    yield* ed.doc.close();
    sys.doc = null;
    throw new Navigate({ to: 'bypass', ...t, preset: b.preset });
  }
  relayout(ed);
  const lineStart = ed.cur === ed.L.lines[cursorLine(ed)].start;
  if ((t.at === 'page' && ed.cur !== 0) || (t.at === 'line' && !lineStart)) { sys.messages.show('notAllowed', { abbr: b.abbr }); return; }
  switch (t.text) {
    case 'global': return yield* global(sys, ed);
    case 'get': return yield* get(sys, ed);
    case 'codesYes': ed.displayCodes = true; return;
    case 'codesNo': ed.displayCodes = false; return;
    case 'return': return;
    case 'typestyle': return yield* chgFmt(sys, ed, MENUS.formatSelectionMid);
    case 'retAll': case 'retLine': case 'retType': case 'docFmt': case 'altFmt':
      insertObject(ed, ed.cur, { type: 'fmt', kind: t.text });
      ed.cur++;
      readjustFrom(ed, ed.cur);
      return;
    default:
  }
  if (INSTRUCTION[t.text]) { insertObject(ed, ed.cur, { ...INSTRUCTION[t.text] }); ed.cur++; return; }
  const p = ed.doc.page;
  const base = formatAt(p.buf.toArray(), p.objects, ed.cur, ed.doc.layoutCtx(p.k));
  const work = copyFormat(base);
  yield* formatSubmenu(sys, work, t.text, { status: fmt('formatChange'), docName: ed.doc.name.slice(0, 20) });
  const values = diffFormat(work, base);
  if (!Object.keys(values).length) return;
  insertObject(ed, ed.cur, { type: 'fmt', kind: 'set', values });
  ed.cur++;
  readjustFrom(ed, ed.cur);
}

const on = (name, code) => (ev) => ev.name === name && !!ev.code === code && !ev.control;
const atFormat = (ev, ed) => isEnter(ev) && isObj(buf(ed).at(ed.cur)) && objects(ed)[objIndex(buf(ed).at(ed.cur))].type === 'fmt';

FUNCTIONS.push(
  { match: on('DEL', false), run: (sys, ed) => del(sys, ed) },
  { match: on('DEL', true), run: (sys, ed) => overstrike(sys, ed) },
  { match: on('MOVE', false), run: (sys, ed) => moveCopy(sys, ed, false) },
  { match: on('MOVE', true), run: (sys, ed) => moveCopy(sys, ed, true) },
  { match: on('FIND', false), run: (sys, ed) => find(sys, ed) },
  { match: on('FIND', true), run: (sys, ed) => global(sys, ed) },
  { match: on('GO TO', false), run: (sys, ed) => goTo(sys, ed) },
  { match: on('GET', false), run: (sys, ed) => get(sys, ed) },
  { match: on('CHG FMT', false), run: (sys, ed) => chgFmt(sys, ed) },
  { match: on('CHG FMT', true), run: (sys, ed) => instr(sys, ed) },
  { match: on('END', true), run: (sys, ed) => screenFormat(sys, ed) },
  { match: atFormat, run: (sys, ed) => reviewFormat(sys, ed) },
  { match: on('GO TO', true), run: (sys, ed) => bypass(sys, ed) },
);
