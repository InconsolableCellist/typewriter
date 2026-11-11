// Printing as the operator sees it (SR 7.6, 4.25, 4.29; SS 2.6, 2.7): Print Document queues a stored document with
// the PRINT DOCUMENT menu's choices and returns at once; the PRINT key queues the page on the screen and moves to
// the next; the request menu shows the queue, cancels or reorders jobs, and answers a printwheel request. Print Index
// of Diskette Contents queues the index in its fixed form. The printing itself is the spooler's (print/spooler.js).
import { MENUS } from '../menus.js';
import { runMenu, menuState } from '../menu-runner.js';
import { promptLine } from '../input.js';
import { fmt } from '../messages.js';
import { ROW } from '../../screen.js';
import { FUNCTIONS, gotoPage } from '../editor/commands.js';
import { DOC_TYPE } from '../../disk/fs.js';
import { textUnits } from '../samples.js';
import { C } from '../editor/codes.js';
import { QUEUE_MAX, KEY_PAGES, DEFAULT_OPTIONS, pageRange } from '../print/spooler.js';
import { TASKS, menuKeys, chooseDocument, chooseDiskette, guarded } from './common.js';

/** Print Document (ORG p.212): name and diskette, then the menu; ENTER queues the job and TYPING TASKS returns. */
function* print(sys, { preset } = {}) {
  const ch = yield* chooseDocument(sys, preset);
  if (!ch) return null;
  const e = ch.vol.find(ch.name);
  if (!e) { sys.messages.show('notFound', { name: ch.name, disk: ch.vol.name }); return null; }
  // The document open in the typing area changes under the queue: print its pages with PRINT instead.
  if (sys.doc && sys.doc.vol === ch.vol && sys.doc.name === e.name) { sys.messages.show('inUse', { name: e.name }); return null; }
  if (sys.printQueue.length >= QUEUE_MAX) { sys.messages.show('queueFull'); return null; }
  sys.messages.clear();
  const read = yield* guarded(sys, ch.vol, () => ch.vol.readHead(e));
  if (!read) return null;
  const st = menuState({ ...DEFAULT_OPTIONS });
  for (;;) {
    const r = yield* runMenu(sys, MENUS.printDocument, st, { docName: e.name.slice(0, 20), allowEnd: true, ...menuKeys(sys) });
    if (!r.done) return null;
    if (pageRange(read.head.pages, st.values.from, st.values.through)) break;
    sys.messages.show('pagesNotFound');
  }
  sys.spooler.add({ name: e.name, disk: ch.vol.name, opts: { ...st.values } });
  return null;
}

/**
 * The PRINT key in the typing area (ORG p.494, 495): store the page, queue one copy of it, and go on to the next
 * page, making one after the last. The pages of a document gather in one job, up to 25.
 */
function* printKey(sys, ed) {
  const doc = ed.doc, q = sys.printQueue;
  const job = q.find((j) => j.key && j.disk === doc.vol.name && j.name === doc.name);
  if (!job && q.length >= QUEUE_MAX) { sys.messages.show('queueFull'); return; }
  if (job && job.pages.length >= KEY_PAGES) { sys.messages.show('printKeyFull'); return; }
  yield* doc.storePage();
  const p = doc.page, k = p.k;
  const page = { units: p.buf.toArray(), objects: structuredClone(p.objects), ctx: structuredClone(doc.layoutCtx(k)) };
  if (job) job.pages.push(page);
  else sys.spooler.add({ key: true, name: doc.name, disk: doc.vol.name, pages: [page] });
  if (k === doc.pages.length - 1) yield* doc.splitPage(p.buf.length - 1);
  else yield* gotoPage(ed, k + 1);
  ed.cur = 0; ed.top = 0; ed.nta = null;
}

FUNCTIONS.push({ match: (ev) => ev.name === 'PRINT' && !ev.code, run: (sys, ed) => printKey(sys, ed) });

// ---- the queue ------------------------------------------------------------------------------------------------------

const ID = 'abcdef';

/** DISPLAY PRINT QUEUE OR CANCEL PRINT JOB and CHANGE PRINTING ORDER share a layout (ORG p.134, TB2 p.158, 159). */
function drawQueue(sys, title) {
  const s = sys.screen;
  sys.drawStatus({});
  s.clearRows(ROW.SCALE, ROW.PROMPT);
  s.put(4, 41 - Math.floor(title.length / 2), title);
  s.put(6, 5, 'ID');
  s.put(6, 10, 'DISKETTE NAME');
  s.put(6, 26, 'DOCUMENT NAME');
  sys.printQueue.forEach((j, k) => {
    if (j === sys.spooler.job) s.put(8 + k, 3, '#');
    s.put(8 + k, 5, ID[k]);
    s.put(8 + k, 10, j.disk);
    s.put(8 + k, 26, j.name.slice(0, 44));
  });
  if (sys.spooler.job) s.put(21, 3, fmt('printingNow'));
}

function* chooseJob(sys, title, prompt) {
  for (;;) {
    drawQueue(sys, title);
    const s = yield* promptLine(sys, prompt, { max: 1 });
    if (!s) return null;
    const job = sys.printQueue[ID.indexOf(s.toLowerCase())];
    if (job) return job;
    sys.messages.show('idInvalid');
  }
}

function* printQueue(sys) {
  for (;;) {
    const job = yield* chooseJob(sys, 'DISPLAY PRINT QUEUE OR CANCEL PRINT JOB', 'cancelJob');
    if (!job) return null;
    const printing = job === sys.spooler.job;
    sys.spooler.cancel(job);
    if (!printing) sys.messages.post('printCancelled', { name: job.name });
  }
}

/** The chosen job goes next, after the one printing. */
function* printOrder(sys) {
  for (;;) {
    const job = yield* chooseJob(sys, 'CHANGE PRINTING ORDER', 'printNext');
    if (!job) return null;
    if (job === sys.spooler.job) continue;
    const q = sys.printQueue;
    q.splice(q.indexOf(job), 1);
    q.splice(sys.spooler.job ? 1 : 0, 0, job);
  }
}

function* continuePrint(sys) { sys.spooler.continuePrinting(); return null; }

// ---- Print Index of Diskette Contents (ORG p.494) -------------------------------------------------------------------

const PER_PAGE = 12;

/** The index in its fixed form, a page per twelve documents; not printed while the printer is busy. */
function* printIndex(sys) {
  const vol = yield* chooseDiskette(sys);
  if (!vol) return null;
  if (sys.printQueue.length) { sys.messages.show('printerBusy'); return null; }
  const { available, unusable } = vol.stats();
  const docs = vol.docs();
  const fmt0 = sys.settings.docFormat;
  const pages = [];
  for (let k = 0; k === 0 || k < docs.length; k += PER_PAGE) {
    let text = k === 0 ? `INDEX OF DISKETTE CONTENTS\nDISKETTE: ${vol.name}  Available: ${available}%  Unusable: ${unusable} %\n\n` : '';
    for (const e of docs.slice(k, k + PER_PAGE)) text += `DOCUMENT NAME: ${e.name}\nTYPE: ${DOC_TYPE[e.type] ?? 'Unknown'}\nCOMMENT: ${e.comment}\n\n`;
    const units = Array.from(textUnits(text), (u) => (u === C.RHY ? 0x2d : u));
    pages.push({ units: [...units, C.PE], objects: [], ctx: { fmt: fmt0, doc: fmt0, alt: fmt0, first: k === 0 } });
  }
  sys.spooler.add({ name: 'INDEX OF DISKETTE CONTENTS', disk: vol.name, pages });
  return null;
}

Object.assign(TASKS, { print, printQueue, printOrder, continuePrint, printIndex });
