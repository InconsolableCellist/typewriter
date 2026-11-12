// Every prompt and message, keyed, with its source. The complete catalogue (the Prompts and Messages Guide,
// S544-2122) is not available, so wording quoted in SR 6 and SS is used where it exists and plain wording of our own,
// marked `source: 'ours'`, everywhere else (architecture 13.3).
import { ROW, ATTR } from '../screen.js';

export const TEXT = {
  // Prompts (prompt line)
  idPrompt: ['Type ID letter to choose ITEM; press ENTER:', 'ORG p.65'],
  choicePrompt: ['Type YOUR CHOICE; press ENTER', 'ORG p.66'],
  finished: ['When finished with this menu, press ENTER.', 'ORG p.65'],
  docName: ['Type document name; press ENTER.', 'TB1 p.8'],
  diskName: ['Type diskette name; press ENTER.', 'TB1 p.8'],
  bypass: ['Type Abbreviation; Press ENTER.', 'ORG p.445'],
  deleteWhat: ['Delete what?', 'ORG p.352'],
  moveWhat: ['Move what?', 'ORG p.477'],
  copyWhat: ['Copy what?', 'ORG p.339'],
  toWhere: ['To where?', 'ORG p.339'],
  overstrikeWhat: ['Overstrike what?', 'ORG p.484'],
  overstrikeWith: ['Overstrike with what character?', 'ORG p.484'],
  findWhat: ['Find what?', 'ORG p.488'],
  pageNumber: ['Type page number; press ENTER', 'TB2 p.112'],
  globalReplace: ['Press ENTER to replace or delete, or press CANCL.', 'ORG p.390'],
  globalContinue: ['Press ENTER to continue search.', 'ORG p.391'],
  confirm: ['Press ENTER to continue or press CANCL.', 'ORG p.345'],
  whenFinished: ['When finished, press ENTER.', 'ORG p.132, p.183'],
  indexMore: ['Press ↓ key or ↑ key to see more.', 'ORG p.132'],
  insertProgram: ['Insert desired program or feature diskette; press ENTER', 'TB2 p.610'],
  insertDiskette: ['Insert diskette ({disk}); press ENTER.', 'ours'],
  newDiskName: ['Type new diskette name; press ENTER.', 'ours'],
  eraseConfirm: ['Contents of diskette will be erased. Press ENTER to continue or press CANCL.', 'ours, after TB2 p.523'],
  recoverDoc: ['({name}) will be recovered. Press ENTER.', 'ours'],
  cancelJob: ['Type ID letter to cancel print job; press ENTER:', 'ORG p.134'],
  printNext: ['Type ID letter of document to be printed next; press ENTER:', 'TB2 p.159'],
  printingNow: ['# This document is printing now.', 'ORG p.134'],
  retypeWord: ['Retype word; Press ENTER.', 'ORG p.110'],
  hyphenateWhere: ['Hyphenate where?', 'TB2 p.579'],

  // The CHECK SPELLING OF WORD panel (ORG p.110)
  checkBanner: ['<===================== CHECK SPELLING OF WORD =====================>', 'ORG p.110'],
  checkLeave: ['To leave highlighting and continue:', 'ORG p.110'],
  checkRemove: ['To remove highlighting and continue:', 'ORG p.110'],
  checkRetype: ['To retype and revise word:', 'ORG p.110'],
  pressSpell: ['Press SPELL', 'ORG p.110'],
  pressEnter: ['Press ENTER', 'ORG p.110'],
  retypeThe: ['Retype the word.', 'ORG p.110'],
  pressEnterDot: ['Press ENTER.', 'ORG p.110'],
  checkWord: ['Check spelling of word:', 'ORG p.110'],

  // Status line 1, field A
  loadingProgram: ['Loading Program', 'ORG p.59'],
  paginating: ['Paginating Document', 'TB2 p.62'],
  displayingIndex: ['Displaying Index', 'ORG p.132'],
  formatChange: ['Format Change', 'ORG p.179'],
  chgDocFmt: ['Chg Document Fmt', 'ORG p.156'],
  chgAltFmt: ['Chg Alternate Fmt', 'ours, after ORG p.156'],
  deleteText: ['Delete Text', 'ours, after ORG p.558'],
  moveText: ['Move Text', 'ours, after ORG p.558'],
  copyText: ['Copy Text', 'ORG p.558'],
  overstrikeText: ['Overstrike Text', 'ours, after ORG p.558'],
  findText: ['Find', 'ours'],
  globalText: ['Global Replace', 'ours'],
  goToText: ['Go To', 'ours'],
  getText: ['Get', 'ours'],
  menuBypass: ['Menu Bypass', 'ours'],
  spellCheck: ['Spell Check', 'ORG p.110'],

  // Messages (message line)
  exists: ['({name}) already exists.', 'TB2 p.648'],
  inUse: ['({name}) already in use', 'TB2 p.650'],
  notAllowed: ['({abbr}) not allowed at this time.', 'ORG p.446'],
  paginated: ['({name}) paginated', 'TB2 p.62'],
  globalChanged: ['Global Replace/Delete completed. {n} phrases changed.', 'ORG p.391'],
  globalFound: ['Global Replace/Delete completed. {n} phrases found.', 'ORG p.392'],
  globalNone: ['No phrases found. Global Replace/Delete completed.', 'ORG p.393'],
  recoverComplete: ['Recover documents complete.', 'ORG p.498'],
  diskError: ['Error on Diskette {disk}', 'ORG p.497'],
  notWorkDiskette: ['{disk} is not work diskette.', 'TB2 p.664'],
  notFound: ['({name}) not found on diskette {disk}.', 'ours'],
  diskNotFound: ['Diskette {disk} not found.', 'ours'],
  idInvalid: ['ID letter not valid.', 'ours'],
  choiceInvalid: ['Choice not valid. Type a POSSIBLE CHOICE.', 'ours'],
  nameInvalid: ['Diskette name is 1 to 6 letters or digits.', 'ours, after ORG p.376'],
  notAvailable: ['{what} not available.', 'ours'],
  deleted: ['({name}) deleted.', 'ours'],
  duplicated: ['({name}) duplicated.', 'ours'],
  combined: ['({name}) added to ({to}).', 'ours'],
  renamed: ['({name}) renamed ({to}).', 'ours'],
  commentChanged: ['({name}) comment changed.', 'ours'],
  diskRenamed: ['Diskette {disk} renamed {to}.', 'ours'],
  diskDuplicated: ['Diskette {disk} duplicated on {to}.', 'ours'],
  condensed: ['Diskette {disk} condensed on {to}.', 'ours'],
  erased: ['Diskette {disk} erased.', 'ours'],
  initialized: ['Diskette {disk} initialized.', 'ours'],
  recovered: ['({name}) recovered.', 'ours'],
  diskFull: ['Diskette {disk} full.', 'ours'],
  sameDiskette: ['Diskettes must be different.', 'ours'],
  mediaMismatch: ['Diskettes must be the same type.', 'ours'],
  programDiskette: ['Program diskette cannot be changed.', 'ours, after ORG p.376'],
  findNone: ['Not found.', 'ours'],
  firstLast: ['First typing line must not be after last typing line.', 'ours'],
  preserved: ['Preserve Page Numbers is Yes. Document not paginated.', 'ours, after ORG p.211'],
  abbrInvalid: ['({abbr}) not a valid abbreviation.', 'ours'],

  // Spelling
  spellComplete: ['Spelling Check complete. Words marked: {n}', 'TB2 p.72'],
  supLoaded: ['Supplement loaded. {n} words now in supplement.', 'ORG p.425'],
  supCleared: ['Supplement Cleared.', 'ORG p.305'],
  supStored: ['Supplement stored.', 'ORG p.527'],
  supWritten: ['Supplement words written to ({name})', 'ORG p.345'],
  supFull: ['Supplement full. {n} words now in supplement.', 'ours, after ORG p.425, p.521'],
  supEmpty: ['Supplement is empty.', 'ours'],
  noDictionary: ['Spelling dictionary not available.', 'ours'],

  // Printing (the printer's needs and errors go to the message line, SS 0)
  printerOn: ['Turn printer on.', 'ours, after SS E3 step 5'],
  printerNotReady: ['Printer not ready. Press START on the printer.', 'ours'],
  loadPaper: ['Load paper in printer; press LOAD.', 'ours, after TB1 p.14'],
  putOnWheel: ['Put on printer element ({style} {kbd})', 'TB2 p.553'],
  printed: ['({name}) printed.', 'ours, after TB1 p.15'],
  printCancelled: ['({name}) printing cancelled.', 'ours'],
  coverOpen: ['Printer cover open. Close it; press START.', 'ours, after MIM p.183'],
  printerError: ['Printer error {code}. Correct it; press START.', 'ours, after MIM p.123'],
  queueFull: ['Print queue full: 6 jobs are queued.', 'ours, after ORG p.213'],
  printKeyFull: ['25 pages already queued with PRINT.', 'ours, after ORG p.494'],
  insertToPrint: ['Insert diskette {disk} to print ({name}).', 'ours, after SR 7.6'],
  pagesNotFound: ['Pages to print not in document.', 'ours'],
  printerBusy: ['Printer busy. Index not printed.', 'ours, after ORG p.494'],
};

export function fmt(key, args = {}) {
  const t = TEXT[key];
  const s = t ? t[0] : key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(args[k] ?? ''));
}

/**
 * The message line (SS 5, ORG p.480). Posted messages queue; a blinking indicator at the bottom left shows that
 * one or more wait, a long beep announces each, and MSG shows the next or clears the line. Shown messages (errors
 * and status) go up at once and stay until cleared or replaced.
 */
export class Messages {
  constructor(sys) { this.sys = sys; this.queue = []; this.current = ''; }

  post(key, args) {
    this.queue.push(fmt(key, args));
    this.sys.tone('long');
    this.draw();
  }

  show(key, args) { this.current = fmt(key, args); this.draw(); }

  clear() { if (this.current) { this.current = ''; this.draw(); } }

  /** The MSG key. */
  next() {
    this.current = this.queue.length ? this.queue.shift() : '';
    this.draw();
  }

  get waiting() { return this.queue.length > 0; }

  draw() {
    const s = this.sys.screen;
    s.clearRows(ROW.MESSAGE);
    if (this.queue.length) s.put(ROW.MESSAGE, 1, '==>', ATTR.BLINK | ATTR.BRIGHT);
    if (this.current) s.put(ROW.MESSAGE, 5, this.current);
  }
}
