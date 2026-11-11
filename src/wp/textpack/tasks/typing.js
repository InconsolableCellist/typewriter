// Typing Tasks (SS 2.2, SR 8): Create and Revise lead through the name prompts to CREATE OR REVISE DOCUMENT and
// on ENTER to the typing area; END stores the document and comes back to TYPING TASKS (ORG p.67).
import { MENUS } from '../menus.js';
import { runMenu, menuState } from '../menu-runner.js';
import { Document } from '../editor/doc.js';
import { typingArea } from '../editor/commands.js';
import { TASKS, menuKeys, chooseDocument, guarded } from './common.js';

function* create(sys) {
  for (;;) {
    const ch = yield* chooseDocument(sys);
    if (!ch) return null;
    if (ch.vol.find(ch.name)) { sys.messages.show('exists', { name: ch.name }); continue; }
    sys.messages.clear();
    const doc = yield* guarded(sys, ch.vol, () => Document.create(sys, ch.vol, ch.name));
    return doc ? yield* createRevise(sys, doc) : null;
  }
}

/** A document to work on: it must be on the diskette, and not in use by the print queue. */
export function* chooseExisting(sys) {
  for (;;) {
    const ch = yield* chooseDocument(sys);
    if (!ch) return null;
    const e = ch.vol.find(ch.name);
    if (!e) { sys.messages.show('notFound', { name: ch.name, disk: ch.vol.name }); continue; }
    if (sys.printQueue.some((j) => j.name === ch.name && j.disk === ch.vol.name)) { sys.messages.show('inUse', { name: ch.name }); continue; }
    sys.messages.clear();
    return { vol: ch.vol, entry: e };
  }
}

function* revise(sys) {
  const ch = yield* chooseExisting(sys);
  if (!ch) return null;
  const doc = yield* guarded(sys, ch.vol, () => Document.open(ch.vol, ch.entry));
  return doc ? yield* createRevise(sys, doc) : null;
}

/** CREATE OR REVISE DOCUMENT (ORG p.128): comment, formats, Preserve Page Numbers; ENTER goes to the typing area. */
export function* createRevise(sys, doc) {
  const st = menuState({ comment: doc.entry.comment, preserve: doc.head.preserve });
  return yield* guarded(sys, doc.vol, function* () {
    for (;;) {
      const r = yield* runMenu(sys, MENUS.createRevise, st, { docName: doc.name.slice(0, 20), allowEnd: true, ...menuKeys(sys) });
      if (r.go) {
        const task = TASKS[r.go];
        if (task) yield* task(sys, { doc });
        else sys.messages.show('notAvailable', { what: MENUS.createRevise.items.find((i) => i.go === r.go).item });
        continue;
      }
      if (st.values.comment !== doc.entry.comment || st.values.preserve !== doc.head.preserve) {
        doc.entry.comment = st.values.comment;
        doc.head.preserve = st.values.preserve;
        yield* doc.commit();
        Object.assign(st.initial, st.values);
      }
      if (r.done) yield* typingArea(sys, doc);
      else yield* doc.close();
      sys.doc = null;
      return null;
    }
  });
}

Object.assign(TASKS, { create, revise });
