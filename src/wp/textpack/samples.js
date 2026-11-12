// Documents written straight onto a diskette image, with no drive and no time: the first-run work diskette's
// sample documents (architecture 8.5, our own text) and the documents tests revise. Text is typed as the keyboard
// would with the default WORK STATION DESCRIPTION: a newline is RET (a required carrier return), a tab TAB, a
// hyphen a required hyphen and a form feed PAGE END. Line endings are then adjusted as Auto Adjust would.
import { C } from './editor/codes.js';
import { adjustAllWith, runPlain } from './editor/layout.js';
import { copyFormat, DEFAULT_FORMAT } from './editor/format.js';
import { Volume, runSync } from '../disk/fs.js';
import { Library, programDiskette, workDiskette, blankDiskette } from '../disk/library.js';

const KEY_UNIT = { '\n': C.RCR, '\t': C.TAB, '-': C.RHY, '\f': C.PE };

export function textUnits(text) { return Array.from(text, (ch) => KEY_UNIT[ch] ?? ch.charCodeAt(0)); }

/** Adjust every paragraph of a page's units. */
export function adjustAll(units, objects, ctx) { return runPlain(adjustAllWith(units, objects, ctx)); }

/** Write a document onto an image. `text` may hold form feeds for page ends. */
export function writeDocument(img, name, text, { comment = '', format = DEFAULT_FORMAT, adjust = true } = {}) {
  const vol = runSync(new Volume(img).mount());
  const fmt = copyFormat(format);
  const head = { v: 1, format: fmt, alt: copyFormat(fmt), preserve: 2, pages: [] };
  text.split('\f').forEach((part, k) => {
    const ctx = { fmt, doc: fmt, alt: fmt, first: k === 0 };
    let units = [...textUnits(part), C.PE];
    if (adjust) units = adjustAll(units, [], ctx);
    const lsns = runSync(vol.writePage(units, []));
    head.pages.push({ n: String(k + 1), lsn: lsns[0], secs: lsns.length, len: units.length, fmts: [] });
  });
  const hl = runSync(vol.writeJson(head));
  runSync(vol.flushMap());
  const count = hl.length + head.pages.reduce((a, p) => a + p.secs, 0);
  runSync(vol.addEntry({ name, comment, type: 1, flags: 0, first: hl[0], count, length: head.pages.reduce((a, p) => a + p.len, 0) }));
  runSync(vol.flushMap());
}

const SAMPLES = [
  ['Welcome', 'How to use this machine', 'This work diskette came with the system. Choose Typing Tasks on TASK SELECTION, then Revise Document, to open one of its documents, or Create Document to start a new one.\n\tText wraps by itself at the right margin. Press RET only at the end of a paragraph. When you are finished, press END: the document is stored on the diskette and TYPING TASKS comes back.\n'],
  ['Shopping', 'A short list', 'Things to fetch on Saturday:\n\n\tBread and butter\n\tTwo pounds of coffee\n\tA new ribbon for the printer\n\tEnvelopes, the long kind\n'],
  ['Note to Self', 'Reminder', 'Remember that a diskette must be named before it can hold documents. Use Erase or Initialize (Name) Diskette from WORK DISKETTE TASKS, and keep the label up to date with a soft pen.\n'],
];

/** The first visit's diskettes: the program diskette, WORK01 with three sample documents, and two blanks. */
export function firstRunLibrary() {
  const lib = new Library();
  lib.add(programDiskette());
  const work = lib.add(workDiskette('WORK01', 'WORK01'));
  for (const [name, comment, text] of SAMPLES) writeDocument(work, name, text, { comment });
  lib.add(blankDiskette('BLANK1'));
  lib.add(blankDiskette('BLANK2'));
  return lib;
}
