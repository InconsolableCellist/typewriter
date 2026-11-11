// Editing functions and tasks of milestone M3 beyond the worked examples: GLOBAL, GET, OVERSTRIKE, the format menus
// and MARGINS AND TABS, the underline, centre and half-index keys, Menu Bypass, pagination rules, and the work
// diskette tasks that copy and repair diskettes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, run, row, expectRow, expectScreen, findOnScreen } from '../src/wp/testkit.js';
import { ATTR } from '../src/wp/screen.js';
import { FLAG, Volume, runSync } from '../src/wp/disk/fs.js';
import { C } from '../src/wp/textpack/editor/codes.js';
import { pageBreaks } from '../src/wp/textpack/editor/paginate.js';
import { DEFAULT_FORMAT } from '../src/wp/textpack/editor/format.js';
import { textUnits, adjustAll } from '../src/wp/textpack/samples.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/wp-screens/${name}.txt`, import.meta.url), 'utf8');
const E = (sys) => row(sys, 1).slice(52, 71).trim();
const text = (sys, r) => row(sys, r).slice(1).trimEnd();

function revise(docText, extra = {}) {
  const b = boot({ docs: { TRAIN: [{ name: 'Doc', text: docText }, ...(extra.more ?? [])] } });
  run(b.sys, 'a ENTER b ENTER "Doc" ENTER "TRAIN" ENTER ENTER');
  return b;
}

test('GLOBAL, automatic, whole words: replaces through the document and reports', () => {
  const { sys } = revise('his book, (his) history and this chisel. His\fhis pen\n');
  run(sys, 'GLOBAL');
  expectRow(sys, 4, '                          GLOBAL REPLACE/DELETE');
  run(sys, '"c his" ENTER "d hers" ENTER ENTER');
  assert.match(row(sys, 25), /Global Replace\/Delete completed\. 3 phrases found\./);
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 2', 'the search went on through the following pages');
  assert.equal(text(sys, 4), 'hers pen');
  run(sys, 'GO TO "1" ENTER');
  assert.equal(text(sys, 4), 'hers book, (hers) history and this chisel. His▲', 'whole words, case as typed');
});

test('GLOBAL, prompted, exact characters, delete; none found', () => {
  const { sys } = revise('boat boats boating\n');
  run(sys, 'GLOBAL "a 1" ENTER "b 2" ENTER "c boat" ENTER ENTER');
  expectRow(sys, 24, 'Press ENTER to replace or delete, or press CANCL.');
  assert.ok(sys.screen.attrAt(4, 3) & ATTR.REVERSE, 'the match is highlighted');
  run(sys, 'ENTER');
  expectRow(sys, 24, 'Press ENTER to continue search.');
  run(sys, 'ENTER CANCL ENTER ENTER ENTER');
  assert.equal(text(sys, 4), ' boats ing', 'the first deleted, the second skipped, the third deleted');
  assert.match(row(sys, 25), /2 phrases changed/);
  run(sys, 'GLOBAL "c zebra" ENTER ENTER');
  assert.match(row(sys, 25), /No phrases found\. Global Replace\/Delete completed\./);
});

test('GET: pages of another document come in at the cursor, without their Page Ends', () => {
  const { sys } = revise('Before.\n', { more: [{ name: 'Source', text: 'One.\fTwo.\fThree.\n' }] });
  run(sys, 'GET "a Source" ENTER "c 1 3" ENTER ENTER');
  assert.equal(text(sys, 4), 'One.Three.');
  assert.equal(text(sys, 5), 'Before.');
  assert.equal(sys.screen.cursor.row, 4);
});

test('OVERSTRIKE: the text shows the overstrike character between Begin and End Overstrike codes', () => {
  const { sys } = revise('abc def\n');
  run(sys, 'OVERSTRIKE RIGHT*2 ENTER');
  expectRow(sys, 24, 'Overstrike with what character?');
  run(sys, '"/" ENTER');
  assert.equal(E(sys), 'Begin Overstrike');
  run(sys, 'DOWN');
  assert.equal(text(sys, 4), '/// def');
});

test('underline, centre and half index from their CODE keys', () => {
  const { sys } = revise('');
  run(sys, '"word" WORD UND " " BEGIN UND "two words" END UND " x" CODE+y "2" CODE+h RET');
  const at = (c) => sys.screen.attrAt(4, c);
  assert.ok(at(2) & ATTR.UNDER && at(5) & ATTR.UNDER, 'word underline');
  assert.ok(at(7) & ATTR.UNDER && at(15) & ATTR.UNDER && !(at(16) & ATTR.UNDER), 'begin and end underline');
  assert.ok(at(18) & ATTR.HALF_UP, "half index up");
  run(sys, 'TAB*7 CTR "TITLE"');
  assert.equal(findOnScreen(sys, 'TITLE').col, 35, 'centred on position 53, where the code stands (column 37)');
});

test('MARGINS AND TABS: the scale line editor', () => {
  const { sys } = boot();
  run(sys, 'a ENTER a ENTER "M" ENTER "TRAIN" ENTER b ENTER b ENTER');
  const grid = fixture('margins-tabs').split('\n');
  grid[0] = 'Chg Document Fmt    |                    |    |    |                   |';
  for (let r = 3; r <= 24; r++) expectRow(sys, r, grid[r - 1]);
  assert.ok(sys.screen.attrAt(3, 2) & ATTR.REVERSE, 'the left margin is highlighted');
  run(sys, 'SPACE SPACE RIGHT*2 TAB RIGHT*10 RETURN');
  assert.ok(row(sys, 3).startsWith('...«'));
  run(sys, 'LEFT*12 "4" ENTER ENTER ENTER ENTER');
  const f = runSync(new Volume(sys.volume('TRAIN').image).mount());
  const head = runSync(f.readHead(f.find('M'))).head;
  assert.equal(head.format.lm, 20);
  assert.deepEqual(head.format.tabs.slice(0, 3), [{ pos: 24, kind: 'left' }, { pos: 28, kind: 'left' }, { pos: 32, kind: 'left' }]);
  run(sys, '"abc"');
  assert.ok(row(sys, 3).startsWith('.«') && row(sys, 4).indexOf('abc') === 1, 'the window follows the new left margin');
});

test('PAGE FORMAT: the first typing line must not follow the last', () => {
  const { sys } = boot();
  run(sys, 'a ENTER a ENTER "P" ENTER "TRAIN" ENTER b ENTER c ENTER "a 70" ENTER ENTER');
  assert.match(row(sys, 25), /First typing line must not be after last typing line\./);
  run(sys, '"a 10" ENTER ENTER ENTER ENTER');
  assert.equal(row(sys, 2).slice(49, 58).trim(), 'Ln. 10');
});

test('CHG FMT within a line offers a typestyle of the same pitch only', () => {
  const { sys } = revise('some text\n');
  run(sys, 'RIGHT*2 CHG FMT');
  expectRow(sys, 9, '  a   Typestyle Number (same pitch only)     86');
  run(sys, '"a 12" ENTER');
  assert.match(row(sys, 25), /Choice not valid/);
  run(sys, '"a 90" ENTER ENTER');
  assert.equal(E(sys), '');
  run(sys, 'LEFT');
  assert.equal(E(sys), 'Typestyle Chg');
});

test('Menu Bypass from a menu and from the typing area', () => {
  const { sys } = boot({ docs: { TRAIN: [{ name: 'Letter', text: 'Hello.\n' }, { name: 'Other', text: 'Other.\n' }] } });
  run(sys, 'a ENTER MENU BYPASS');
  expectRow(sys, 24, 'Type Abbreviation; Press ENTER.');
  run(sys, '"r Letter" ENTER');
  expectRow(sys, 4, '                     CREATE OR REVISE DOCUMENT');
  assert.equal(row(sys, 1).slice(21, 27), 'Letter');
  run(sys, 'ENTER MENU BYPASS "cdy" ENTER');
  assert.equal(text(sys, 4), 'Hello.↲', 'codeyes: Display Codes = Yes');
  run(sys, 'RIGHT MENU BYPASS "mt" ENTER');
  assert.match(row(sys, 25), /\(mt\) not allowed at this time\./, 'margins only at the start of a line');
  run(sys, 'CODE+UP MENU BYPASS "bk" ENTER');
  assert.equal(E(sys), '');
  run(sys, 'LEFT');
  assert.equal(E(sys), 'Begin Keep');
  run(sys, 'MENU BYPASS "xyz" ENTER');
  assert.match(row(sys, 25), /\(xyz\) not a valid abbreviation\./);
  run(sys, 'MENU BYPASS "xdc" ENTER');
  expectRow(sys, 4, '                        DELETE DOCUMENT');
  assert.equal(sys.volume('TRAIN').find('Letter').flags & FLAG.OPEN, 0, 'the document was ended first');
  run(sys, '"a Other" ENTER "b TRAIN" ENTER ENTER');
  expectRow(sys, 4, '                      WORK DISKETTE TASKS');
  assert.equal(sys.volume('TRAIN').find('Other'), null);
});

test('pagination: required page ends, keeps, and the widow rule', () => {
  const f = { ...DEFAULT_FORMAT, firstLine: 1, firstLineNext: 1, lastLine: 5 };
  const ctx = { fmt: f, doc: f, alt: f, first: true };
  const lines = (n, tag) => Array.from({ length: n }, (_, k) => `${tag}${k}`).join('\n');
  // Ten one-line paragraphs: pages of five.
  let u = textUnits(`${lines(10, 'a')}\n`);
  assert.deepEqual(pageBreaks(u, [], ctx).breaks, [0, 5]);
  // A required page end ends the page early.
  u = [...textUnits('x\ny\n'), C.RPE, ...textUnits(`${lines(3, 'z')}\n`)];
  assert.deepEqual(pageBreaks(u, [], ctx).breaks, [0, 3]);
  // A paragraph of three lines starting on line 5: not split with its first line alone.
  const para = `${'word '.repeat(40)}end`;
  u = adjustAll(textUnits(`${lines(4, 'b')}\n${para}\nafter\n`), [], ctx);
  assert.deepEqual(pageBreaks(u, [], ctx).breaks, [0, 4]);
  assert.deepEqual(pageBreaks(u, [], ctx, { exact: true }).breaks, [0, 5], 'exact line count: no adjustment');
  // Its last line alone at the top of a page is kept back on the page before.
  u = adjustAll(textUnits(`${lines(3, 'c')}\n${para}\nafter\n`), [], ctx);
  assert.deepEqual(pageBreaks(u, [], ctx).breaks, [0, 6]);
});

test('Recover Documents closes a document left open and rebuilds the free map', () => {
  const { sys, library } = boot({ docs: { TRAIN: [{ name: 'Kept', text: 'Safe.\n' }] } });
  run(sys, 'a ENTER a ENTER "Lost" ENTER "TRAIN" ENTER ENTER "unsaved" PAGE END "more"');
  // The power goes. A new system with the same diskettes.
  const again = boot({ work: [], setup: (lib) => lib.add(library.get('TRAIN')) });
  again.devices.insert(1, 'TRAIN');
  again.sys.runUntilIdle();
  const s2 = again.sys;
  assert.ok(s2.volume('TRAIN').find('Lost').flags & FLAG.OPEN);
  run(s2, 'b ENTER h ENTER "a 2" ENTER ENTER');
  expectRow(s2, 24, '(Lost) will be recovered. Press ENTER.');
  run(s2, 'ENTER');
  assert.match(row(s2, 25), /Recover documents complete\./);
  assert.equal(s2.volume('TRAIN').find('Lost').flags & FLAG.OPEN, 0);
  run(s2, 'l ENTER a ENTER d ENTER ENTER');
  expectRow(s2, 8, '  Lost               Document');
});

test('Duplicate Diskette and Condense Diskette', () => {
  const { sys, devices } = boot({ work: ['TRAIN', 'COPY'], docs: { TRAIN: [{ name: 'A', text: 'x'.repeat(900) }, { name: 'B', text: 'y'.repeat(900) }, { name: 'C', text: 'z\n' }] } });
  run(sys, 'b ENTER');
  devices.remove(0);
  devices.insert(0, 'COPY');
  sys.runUntilIdle();
  run(sys, 'e ENTER');
  expectRow(sys, 9, '  a   From Diskette Name             COPY');
  run(sys, '"a TRAIN" ENTER "b COPY" ENTER ENTER ENTER');
  assert.deepEqual(sys.volume('COPY').docs().map((e) => e.name), ['A', 'B', 'C']);
  assert.ok(row(sys, 2).startsWith('COPY  |TRAIN |'), 'the copy keeps its own name');
  // Make a hole on TRAIN, then condense it onto COPY.
  run(sys, 'a ENTER "a A" ENTER "b TRAIN" ENTER ENTER');
  run(sys, 'f ENTER "a TRAIN" ENTER "b COPY" ENTER ENTER ENTER');
  const v = sys.volume('COPY');
  assert.deepEqual(v.docs().map((e) => e.name), ['B', 'C']);
  const used = [];
  for (let i = 0; i < v.total; i++) if (v.used(i)) used.push(i);
  assert.equal(used[used.length - 1], used.length - 1, 'every used sector at the front: no gaps');
  run(sys, 'MSG MSG MSG');
  assert.match(row(sys, 25), /Diskette TRAIN condensed on COPY\./);
});

test('the request menu over the typing area; print and spelling are not available yet', () => {
  const { sys } = revise('text\n');
  run(sys, 'REQST');
  expectScreen(sys, fixture('request-tasks').split('\n').map((r, i) => (i === 0 ? '~'.repeat(80) : r)).join('\n'));
  run(sys, 'b ENTER');
  assert.match(row(sys, 25), /not available/);
  run(sys, 'CANCL');
  assert.equal(text(sys, 4), 'text');
  run(sys, 'PRINT');
  assert.match(row(sys, 25), /Printing not available/);
});
