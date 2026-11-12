// Work Diskette Tasks (SS 2.10, ORG p.244, SR 9): delete, duplicate, rename documents and diskettes, erase or
// initialize. The completion messages are not quoted in the sources, so their wording is ours (messages.js). END
// before the final ENTER of a menu stops the task (ORG p.364).
import { MENUS } from '../menus.js';
import { runMenu, menuState } from '../menu-runner.js';
import { drawPrompt, getKey, isEnter, isCancel, promptLine } from '../input.js';
import { fmt } from '../messages.js';
import { pageNumberAfter } from '../editor/doc.js';
import { KIND, FLAG, DiskError } from '../../disk/fs.js';
import { C } from '../editor/codes.js';
import { TASKS, menuKeys, volumeNamed, chooseDocument, guarded } from './common.js';

const menu = (sys, def, st, docName) => runMenu(sys, def, st, { allowEnd: true, docName, ...menuKeys(sys) });

/** A menu whose choices must all be filled in; returns false if the operator left it. */
function* fill(sys, def, st, required) {
  for (;;) {
    const r = yield* menu(sys, def, st);
    if (!r.done) return false;
    if (required.every((k) => st.values[k] !== '' && st.values[k] != null)) return true;
    sys.messages.show('choiceInvalid');
  }
}

/** ENTER to go on, CANCL to stop. */
export function* confirm(sys, key = 'confirm', args) {
  drawPrompt(sys, fmt(key, args), null);
  const ev = yield* getKey(sys, (e) => isEnter(e) || isCancel(e) || e.name === 'END');
  return isEnter(ev);
}

/**
 * Copy a document onto a volume as `name`, or append its pages to the document of that name if one exists there
 * (Combining Documents, ORG p.137). Pages are copied as stored; their numbers continue the target's.
 */
export function* copyDocument(src, e, dst, name) {
  const { head } = yield* src.readHead(e);
  const target = dst.find(name);
  let theirs = null, theirLsns = [];
  if (target) ({ head: theirs, lsns: theirLsns } = yield* dst.readHead(target));
  const out = theirs ?? { ...head, pages: [] };
  const allocated = [];
  try {
    for (const p of head.pages) {
      const { units, objects } = yield* src.readPage(p.lsn);
      const lsns = yield* dst.writePage(units, objects);
      allocated.push(...lsns);
      const n = theirs && out.pages.length ? pageNumberAfter(out.pages, out.pages.length - 1) : p.n;
      out.pages.push({ ...p, n, lsn: lsns[0], secs: lsns.length });
    }
    const hl = yield* dst.writeJson(out);
    allocated.push(...hl);
    yield* dst.flushMap();
    const count = hl.length + out.pages.reduce((a, p) => a + p.secs, 0);
    const length = out.pages.reduce((a, p) => a + p.len, 0);
    if (target) {
      Object.assign(target, { first: hl[0], count, length });
      yield* dst.writeEntry(target);
      dst.release(theirLsns);
    } else {
      yield* dst.addEntry({ name, comment: e.comment, type: e.type, flags: e.flags & ~FLAG.OPEN, first: hl[0], count, length });
    }
    yield* dst.flushMap();
  } catch (err) {
    dst.release(allocated);
    throw err;
  }
  return !!target;
}

function* deleteDocument(sys) {
  const st = menuState({ name: '', disk: sys.lastDiskette });
  if (!(yield* fill(sys, MENUS.deleteDocument, st, ['name', 'disk']))) return null;
  const vol = yield* volumeNamed(sys, st.values.disk);
  if (!vol) return null;
  const e = vol.find(st.values.name);
  if (!e) { sys.messages.show('notFound', { name: st.values.name, disk: vol.name }); return null; }
  if (sys.printQueue.some((j) => j.name === e.name && j.disk === vol.name)) { sys.messages.show('inUse', { name: e.name }); return null; }
  yield* guarded(sys, vol, () => vol.deleteDoc(e));
  sys.messages.post('deleted', { name: e.name });
  return null;
}

function* duplicateDocument(sys) {
  const st = menuState({ name: '', disk: sys.lastDiskette, to: '', toDisk: '' });
  if (!(yield* fill(sys, MENUS.duplicateDocument, st, ['name', 'disk', 'to', 'toDisk']))) return null;
  const v = st.values;
  const src = yield* volumeNamed(sys, v.disk);
  if (!src) return null;
  const e = src.find(v.name);
  if (!e) { sys.messages.show('notFound', { name: v.name, disk: src.name }); return null; }
  const dst = yield* volumeNamed(sys, v.toDisk);
  if (!dst) return null;
  if (dst === src && v.to === v.name) { sys.messages.show('exists', { name: v.to }); return null; }
  const appended = yield* guarded(sys, dst, () => copyDocument(src, e, dst, v.to));
  if (appended === null) return null;
  sys.messages.post(appended ? 'combined' : 'duplicated', { name: v.name, to: v.to });
  return null;
}

function* changeDocName(sys) {
  const ch = yield* chooseDocument(sys);
  if (!ch) return null;
  const e = ch.vol.find(ch.name);
  if (!e) { sys.messages.show('notFound', { name: ch.name, disk: ch.vol.name }); return null; }
  const st = menuState({ name: e.name, comment: e.comment });
  for (;;) {
    const r = yield* menu(sys, MENUS.changeDocName, st, e.name.slice(0, 20));
    if (!r.done) return null;
    const { name, comment } = st.values;
    if (!name) { sys.messages.show('choiceInvalid'); continue; }
    if (name !== e.name && ch.vol.find(name)) { sys.messages.show('exists', { name }); continue; }
    const old = e.name;
    e.name = name; e.comment = comment;
    yield* guarded(sys, ch.vol, () => ch.vol.writeEntry(e));
    if (name !== old) { sys.messages.post('renamed', { name: old, to: name }); sys.lastDocument = name; }
    else sys.messages.post('commentChanged', { name });
    return null;
  }
}

function* changeDiskName(sys) {
  const names = [0, 1].map((d) => (sys.drives[d]?.formatted ? sys.drives[d].name : ''));
  const st = menuState({ left: names[0], right: names[1] });
  for (;;) {
    const r = yield* menu(sys, MENUS.changeDiskName, st);
    if (!r.done) return null;
    const want = [st.values.left, st.values.right];
    let ok = true;
    for (const d of [0, 1]) {
      if (want[d] === names[d]) continue;
      const vol = sys.drives[d];
      if (!vol?.formatted) { sys.messages.show('diskNotFound', { disk: want[d] }); ok = false; break; }
      if (vol.isProgram) { sys.messages.show('programDiskette'); ok = false; break; }
      if (want[d] === want[1 - d]) { sys.messages.show('exists', { name: want[d] }); ok = false; break; }
    }
    if (!ok) continue;
    for (const d of [0, 1]) {
      if (want[d] === names[d]) continue;
      yield* guarded(sys, sys.drives[d], () => sys.drives[d].rename(want[d]));
      sys.messages.post('diskRenamed', { disk: names[d], to: want[d] });
      if (sys.lastDiskette === names[d]) sys.lastDiskette = want[d];
    }
    sys.refreshDiskNames();
    return null;
  }
}

/**
 * Erase or Initialize (Name) Diskette (ORG p.143, 144; TP4 p.2, 3). A blank diskette is initialized: every track
 * written, then a name asked for. A named one is erased and keeps its name. No progress shows; only the drive works.
 */
function* eraseInit(sys) {
  const st = menuState({ slot: '' });
  if (!(yield* fill(sys, MENUS.eraseInit, st, ['slot']))) return null;
  const d = st.values.slot - 1;
  const vol = sys.drives[d];
  if (!vol) { sys.messages.show('diskNotFound', { disk: d ? 'Right' : 'Left' }); return null; }
  if (vol.isProgram) { sys.messages.show('programDiskette'); return null; }
  if (!(yield* confirm(sys, 'eraseConfirm'))) return null;
  let name = vol.formatted ? vol.name : null;
  while (!name) {
    const s = yield* promptLine(sys, 'newDiskName', { max: 6 });
    if (s === null) return null;
    if (/^[A-Za-z0-9]{1,6}$/.test(s)) name = s; else sys.messages.show('nameInvalid');
  }
  sys.messages.clear();
  drawPrompt(sys, '', null);
  const initialize = !vol.formatted;
  yield* guarded(sys, vol, () => vol.format(name, KIND.WORK, { writeAll: initialize }));
  sys.refreshDiskNames();
  sys.messages.post(initialize ? 'initialized' : 'erased', { disk: name });
  return null;
}

/** The two diskettes of Duplicate and Condense Diskette, suggested from the drives (ORG p.135, p.118). */
function* twoDiskettes(sys, def) {
  const work = sys.workVolumes().map((v) => v.name);
  const st = menuState({ from: work[0] ?? '', to: work[1] ?? '' });
  if (!(yield* fill(sys, def, st, ['from', 'to']))) return null;
  const { from, to } = st.values;
  if (from === to) { sys.messages.show('sameDiskette'); return null; }
  const src = yield* volumeNamed(sys, from);
  if (!src) return null;
  const dst = yield* volumeNamed(sys, to);
  if (!dst) return null;
  if (src.image.type !== dst.image.type) { sys.messages.show('mediaMismatch'); return null; }
  if (!(yield* confirm(sys, 'eraseConfirm'))) return null;
  drawPrompt(sys, '', null);
  return { src, dst };
}

/** Duplicate Diskette (ORG p.135): every data track copied; the receiving diskette keeps its own label. */
function* duplicateDiskette(sys) {
  const d = yield* twoDiskettes(sys, MENUS.duplicateDiskette);
  if (!d) return null;
  const { src, dst } = d;
  const perTrack = src.m.spt * src.m.sides;
  yield* guarded(sys, dst, function* () {
    for (let t = 0; t < src.total; t += perTrack) {
      const lsns = Array.from({ length: perTrack }, (_, i) => t + i);
      yield* dst.write(lsns, yield* src.read(lsns));
    }
    yield* dst.mount();
  });
  sys.messages.post('diskDuplicated', { disk: src.name, to: dst.name });
  return null;
}

/** Condense Diskette (ORG p.118): the documents copied one after another onto an erased diskette, unfragmented. */
function* condenseDiskette(sys) {
  const d = yield* twoDiskettes(sys, MENUS.condenseDiskette);
  if (!d) return null;
  const { src, dst } = d;
  const ok = yield* guarded(sys, dst, function* () {
    yield* dst.format(dst.name, KIND.WORK);
    for (const e of src.docs()) yield* copyDocument(src, e, dst, e.name);
    return true;
  });
  if (ok) sys.messages.post('condensed', { disk: src.name, to: dst.name });
  return null;
}

/**
 * Recover Documents (ORG p.218, 219; p.497): each document left open is named, ENTER, and closed again; a page
 * that cannot be read becomes a Substitute code. The free map is rebuilt from what the index reaches.
 */
function* recover(sys) {
  const st = menuState({ slot: '' });
  if (!(yield* fill(sys, MENUS.recover, st, ['slot']))) return null;
  const vol = sys.drives[st.values.slot - 1];
  if (!vol?.formatted) { sys.messages.show('diskNotFound', { disk: st.values.slot === 1 ? 'Left' : 'Right' }); return null; }
  if (vol.isProgram) { sys.messages.show('programDiskette'); return null; }
  const done = yield* guarded(sys, vol, function* () {
    for (const e of vol.docs().filter((x) => x.flags & FLAG.OPEN)) {
      if (!(yield* confirm(sys, 'recoverDoc', { name: e.name }))) return false;
      const { head } = yield* vol.readHead(e);
      for (const p of head.pages) {
        try { yield* vol.readPage(p.lsn); } catch (err) {
          if (!(err instanceof DiskError)) throw err;
          const lsns = yield* vol.writePage(Uint16Array.of(C.SUB, C.PE), []);
          Object.assign(p, { lsn: lsns[0], secs: lsns.length, len: 2, fmts: [] });
        }
      }
      const hl = yield* vol.writeJson(head);
      e.first = hl[0];
      e.flags &= ~FLAG.OPEN;
      yield* vol.writeEntry(e);
      sys.messages.post('recovered', { name: e.name });
    }
    yield* vol.rebuildMap();
    yield* vol.flushMap();
    return true;
  });
  if (done) sys.messages.show('recoverComplete');
  return null;
}

Object.assign(TASKS, {
  deleteDocument, duplicateDocument, changeDocName, changeDiskName, eraseInit, duplicateDiskette, condenseDiskette, recover,
});
