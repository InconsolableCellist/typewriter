// Menu Bypass (CODE+GO TO, SR 3.4, ORG p.445 to 448): an abbreviation, with arguments, goes straight to a task or
// inserts an instruction. A target in another task ends the current document first and loads the program segment it
// needs. Not allowed from TASK SELECTION or the program diskette menus; a target that does not fit where the cursor
// is gives "(abbreviation) not allowed at this time." The keyword and short-form table is ORG p.85, 86.
import { promptLine, splitName, Navigate } from './input.js';

// keyword: [short form, where it goes]. `task` targets run a task of a family; `text` targets act in the typing area;
// `na` ones are printing, spelling, merge and file tasks this machine does not offer yet.
export const ABBREVIATIONS = {
  create: ['c', { family: 'typingTasks', task: 'create' }],
  revise: ['r', { family: 'typingTasks', task: 'revise' }],
  paginate: ['pg', { family: 'typingTasks', task: 'paginate' }],
  index: ['i', { family: 'typingTasks', task: 'index' }],
  print: ['p', { na: 'Print Document' }],
  deldoc: ['xdc', { family: 'workDiskTasks', task: 'deleteDocument' }],
  dupdoc: ['ddc', { family: 'workDiskTasks', task: 'duplicateDocument' }],
  docname: ['dcn', { family: 'workDiskTasks', task: 'changeDocName' }],
  diskname: ['dkn', { family: 'workDiskTasks', task: 'changeDiskName' }],
  dupdisk: ['ddk', { family: 'workDiskTasks', task: 'duplicateDiskette' }],
  condisk: ['cdk', { family: 'workDiskTasks', task: 'condenseDiskette' }],
  erasedisk: ['e', { family: 'workDiskTasks', task: 'eraseInit' }],
  recover: ['rec', { family: 'workDiskTasks', task: 'recover' }],
  printindex: ['pi', { na: 'Print Index of Diskette Contents' }],
  global: ['gl', { text: 'global' }],
  get: ['g', { text: 'get' }],
  martab: ['mt', { text: 'marginsTabs', at: 'line' }],
  linefmt: ['lf', { text: 'lineFormat', at: 'line' }],
  pgfmt: ['pf', { text: 'pageFormat', at: 'page' }],
  hf: ['hf', { text: 'headerFooter', at: 'page' }],
  type: ['ty', { text: 'typestyle' }],
  codeyes: ['cdy', { text: 'codesYes' }],
  codeno: ['cdn', { text: 'codesNo' }],
  retfmt: ['rf', { text: 'retAll', at: 'page' }],
  retlinefmt: ['rlf', { text: 'retLine', at: 'line' }],
  rettype: ['rty', { text: 'retType' }],
  docfmt: ['dcf', { text: 'docFmt', at: 'page' }],
  altfmt: ['af', { text: 'altFmt', at: 'page' }],
  begkeep: ['bk', { text: 'beginKeep' }],
  endkeep: ['ek', { text: 'endKeep' }],
  begspell: ['bsp', { text: 'beginSpell' }],
  endspell: ['esp', { text: 'endSpell' }],
  return: ['rt', { text: 'return' }],
  althf: ['ahf', { na: 'Alternating Header/Footer' }],
  include: ['inc', { na: 'Include' }],
  pgnum: ['pn', { na: 'Page Number' }],
  sysnum: ['sn', { na: 'System Page Number' }],
  printorder: ['po', { na: 'Change Printing Order' }],
  contprint: ['ctp', { na: 'Continue Printing' }],
  canprint: ['cp', { na: 'Display Print Queue or Cancel Print Job' }],
  relptr: ['rlp', { na: 'Release Printer' }],
  reqptr: ['rqp', { na: 'Request Printer' }],
  startptr: ['stp', { na: 'Start Printer' }],
  chkdoc: ['cd', { na: 'Check Document' }],
  langdic: ['lgd', { na: 'Choose Spelling Language Dictionary' }],
  clearsup: ['clr', { na: 'Clear Supplement' }],
  loadsup: ['ld', { na: 'Load Supplement' }],
  storesup: ['sto', { na: 'Store Supplement' }],
  lang: ['lg', { na: 'Language for Spelling Check' }],
  mergevar: ['mv', { na: 'Merge' }],
  mergesw: ['msw', { na: 'Merge' }],
};

const BY_WORD = new Map();
for (const [word, [short, target]] of Object.entries(ABBREVIATIONS)) {
  BY_WORD.set(word, { word, ...target });
  BY_WORD.set(short, { word, ...target });
}

/** The abbreviation typed, its target and its arguments, or { abbr, unknown } . */
export function parseBypass(text) {
  const t = text.trim();
  const sp = t.search(/\s/);
  const abbr = sp < 0 ? t : t.slice(0, sp);
  const rest = sp < 0 ? '' : t.slice(sp + 1).trim();
  const target = BY_WORD.get(abbr.toLowerCase());
  if (!target) return { abbr, unknown: true };
  const { name, disk } = splitName(rest);
  return { abbr, target, preset: name ? { name, disk } : null };
}

/** The prompt; null if cancelled. */
export function* bypassPrompt(sys) {
  const s = yield* promptLine(sys, 'bypass', { max: 60, sep: true });
  return s ? parseBypass(s) : null;
}

/**
 * From a task menu: a task target goes there; anything else is not allowed here. Returns nothing when the operator
 * stays on the menu.
 */
export function* bypassFromMenu(sys) {
  const b = yield* bypassPrompt(sys);
  if (!b) return;
  if (b.unknown) { sys.messages.show('abbrInvalid', { abbr: b.abbr }); return; }
  if (b.target.na) { sys.messages.show('notAvailable', { what: b.target.na }); return; }
  if (!b.target.task) { sys.messages.show('notAllowed', { abbr: b.abbr }); return; }
  throw new Navigate({ to: 'bypass', ...b.target, preset: b.preset });
}
