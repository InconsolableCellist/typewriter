// The typing area (milestone M2): insert and replace, BKSP, the carrier returns, tabs and required codes, wrap and
// adjust, cursor movement into the Non-Typing Area, scrolling, segmenting, page ends, END and revise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, run, row, expectRow } from '../src/wp/testkit.js';
import { copyFormat, DEFAULT_FORMAT, tabGrid } from '../src/wp/textpack/editor/format.js';

const E = (sys) => row(sys, 1).slice(52, 71).trim();
const C = (sys) => row(sys, 1).slice(42, 46).trim();
const Ln = (sys) => row(sys, 2).slice(49, 58).trim();
const Pg = (sys) => row(sys, 2).slice(35, 48).trim();
const text = (sys, r) => row(sys, r).slice(1).trimEnd();

/** A new document open in the typing area. */
function newDoc(opts) {
  const b = boot(opts);
  run(b.sys, 'a ENTER a ENTER "Test" ENTER "TRAIN" ENTER ENTER');
  return b;
}

/** Revise a document written by the testkit. */
function revise(text, opts = {}) {
  const b = boot({ docs: { TRAIN: [{ name: 'Doc', text, ...opts }] } });
  run(b.sys, 'a ENTER b ENTER "Doc" ENTER "TRAIN" ENTER ENTER');
  return b;
}

test('insert and replace (CODE+8), status field C', () => {
  const { sys } = newDoc();
  assert.equal(C(sys), 'Ins');
  run(sys, '"abcd" LEFT LEFT LEFT "X"');
  assert.equal(text(sys, 4), 'aXbcd▲');
  run(sys, 'CODE+8');
  assert.equal(C(sys), 'Repl');
  run(sys, '"YZ"');
  assert.equal(text(sys, 4), 'aXYZd▲');
  run(sys, '"!?"');
  assert.equal(text(sys, 4), 'aXYZ!?▲', 'at the end of the text Replace inserts');
  run(sys, 'INSERT/REPLACE');
  assert.equal(C(sys), 'Ins');
});

test('BKSP deletes to the left, not past the left margin, and not a required carrier return', () => {
  const { sys } = newDoc();
  run(sys, '"one" RET "two" BKSP');
  assert.equal(text(sys, 5), 'tw▲');
  run(sys, 'BKSP BKSP BKSP BKSP');
  assert.equal(text(sys, 4), 'one');
  assert.equal(text(sys, 5), '▲', 'stopped at the left margin');
  run(sys, 'UP CODE+RIGHT RIGHT');
  assert.equal(E(sys), "Req'd Carrier Ret");
  run(sys, 'RIGHT BKSP');
  assert.equal(text(sys, 5), '▲');
});

test('the carrier returns and the codes under the cursor (SR 4.2, 5)', () => {
  const format = copyFormat(DEFAULT_FORMAT);
  format.adjust = 2;                      // with Adjust Line Endings on, a regular return would be adjusted away
  const { sys } = revise('', { format });
  run(sys, '"a" RET "b" CODE+RET "c" CONTROL+RET "d" INDEX "e" CODE+INDEX "f"');
  for (const [r, ch] of [[4, 'a'], [5, 'b'], [6, 'c'], [7, 'd'], [8, 'e'], [9, 'f▲']]) assert.equal(text(sys, r), ch);
  const names = [];
  run(sys, 'CODE+UP');
  for (let k = 0; k < 5; k++) { run(sys, 'RIGHT'); names.push(E(sys)); run(sys, 'RIGHT'); }
  assert.deepEqual(names, ["Req'd Carrier Ret", 'Carrier Return', 'Zero Index RET', 'Index', 'Index Return']);
  assert.equal(Ln(sys), 'Ln. 11', 'a zero index return does not advance the line count');
  run(sys, 'CODE+UP RIGHT');
  assert.equal(text(sys, 4), 'a↲', 'a cursored code shows its symbol');
});

test('tabs, required space, required hyphen, required tab indent', () => {
  const { sys } = newDoc();
  run(sys, 'TAB "x" TAB TAB "y"');
  assert.equal(row(sys, 4).slice(0, 20), '      x         y▲  ', 'tab stops every 5 positions from the left margin');
  run(sys, 'CODE+LEFT');
  assert.equal(E(sys), 'Tab');
  run(sys, 'CODE+DOWN RET CODE+TAB "Indented paragraph text that runs on long enough to wrap onto a second line of the page, and further."');
  assert.equal(text(sys, 5).slice(0, 11), '     Indent');
  assert.match(row(sys, 6), /^ {6}\S/, 'the wrapped line starts at the indent');
  run(sys, 'RET "z"');
  assert.equal(text(sys, 7), 'z▲', 'RET ends the indent');
  run(sys, 'CODE+SPACE');
  assert.equal(E(sys), '');
  run(sys, 'LEFT');
  assert.equal(E(sys), 'Required Space');
  run(sys, 'RIGHT "-"');
  run(sys, 'LEFT');
  assert.equal(E(sys), 'Required Hyphen');
});

test('wrap and adjust: words move down and back up; regular returns only', () => {
  const { sys } = newDoc();
  const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma';
  run(sys, JSON.stringify(words));
  assert.equal(text(sys, 4), 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi');
  assert.equal(text(sys, 5), 'omicron pi rho sigma▲');
  run(sys, 'CODE+UP "verylongwordindeed "');
  assert.equal(text(sys, 4), 'verylongwordindeed alpha beta gamma delta epsilon zeta eta theta iota');
  assert.equal(text(sys, 5), 'kappa lambda mu nu xi omicron pi rho sigma▲');
  run(sys, 'BKSP*19');
  assert.equal(text(sys, 4), 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi');
  assert.equal(text(sys, 5), 'omicron pi rho sigma▲');
});

test('cursor: up and down keep the column; the Non-Typing Area; boundaries', () => {
  const { sys } = revise('A long first line of text that runs over most of the width of the line\nShort\nThird line here\n');
  run(sys, 'CODE+RIGHT');
  assert.equal(sys.screen.cursor.col, 71);
  run(sys, 'DOWN');
  assert.equal(E(sys), 'Non-Typing Area');
  assert.equal(sys.screen.cursor.col, 71, 'the cursor keeps its column past the end of the short line');
  run(sys, '"x"');
  assert.equal(text(sys, 5), 'Short', 'nothing types in the Non-Typing Area');
  run(sys, 'DOWN');
  assert.equal(E(sys), 'Non-Typing Area');
  run(sys, 'UP UP');
  assert.equal(sys.screen.cursor.col, 71);
  assert.equal(E(sys), '');
  run(sys, 'CODE+LEFT');
  assert.equal(sys.screen.cursor.col, 2);
  run(sys, 'CODE+DOWN');
  assert.equal(sys.screen.cursor.row, 7);
  run(sys, 'CODE+UP');
  assert.deepEqual([sys.screen.cursor.row, sys.screen.cursor.col], [4, 2]);
});

test('scrolling: the window follows the cursor a line at a time; SCREEN DOWN and UP', () => {
  const lines = Array.from({ length: 30 }, (_, k) => `Line ${k + 1}`).join('\n');
  const { sys } = revise(lines);
  run(sys, 'DOWN*19');
  assert.equal(text(sys, 23), 'Line 20');
  assert.equal(Ln(sys), 'Ln. 26');
  run(sys, 'DOWN');
  assert.equal(text(sys, 4), 'Line 2', 'scrolled by one line');
  assert.equal(text(sys, 23), 'Line 21');
  run(sys, 'CODE+UP');
  assert.equal(text(sys, 4), 'Line 1');
  run(sys, 'DOWN*3 SCREEN DOWN');
  assert.equal(text(sys, 4), 'Line 4', 'the cursored line becomes the first screen line');
  run(sys, 'CODE+UP DOWN*28 UP*3 SCREEN UP');
  assert.equal(text(sys, 23), 'Line 26', 'the cursored line becomes the last screen line');
  run(sys, 'SCREEN UP');
  assert.equal(text(sys, 23), 'Line 20', 'already last: the window moves up a screen');
  assert.equal(sys.screen.cursor.row, 10);
});

test('segmenting: a line past column 80 shifts the window 60 positions', () => {
  const format = copyFormat(DEFAULT_FORMAT);
  format.rm = 150;
  format.tabs = tabGrid(18, 150, 5);
  const words = Array.from({ length: 22 }, (_, k) => `word${k}`).join(' ');
  const { sys } = revise(words, { format });
  assert.ok(row(sys, 3).startsWith('.«.2'));
  run(sys, 'CODE+RIGHT');
  assert.ok(row(sys, 3).startsWith('...8'), `scale from 77: ${row(sys, 3).slice(0, 12)}`);
  assert.ok(sys.screen.cursor.col <= 80 && /word1\d$/.test(text(sys, 4)), 'the end of the line is in view');
  run(sys, 'CODE+LEFT');
  assert.ok(row(sys, 3).startsWith('.«.2'));
  run(sys, 'SCREEN RIGHT');
  assert.ok(row(sys, 3).startsWith('«.2'), 'the left edge moves to the cursor');
  run(sys, 'SCREEN RIGHT');
  assert.equal(sys.screen.cursor.col, 1);
  assert.ok(row(sys, 3).startsWith('..8'), 'at the left edge, 60 positions on');
});

test('PAGE END starts a new page; the cursor moves between pages; END stores both', () => {
  const { sys } = newDoc();
  run(sys, '"page one" PAGE END "page two"');
  assert.equal(Pg(sys), 'Pg. 2');
  assert.equal(text(sys, 4), 'page two▲');
  run(sys, 'UP');
  assert.equal(Pg(sys), 'Pg. 1');
  assert.equal(text(sys, 4), 'page one▲');
  run(sys, 'DOWN');
  assert.equal(Pg(sys), 'Pg. 2');
  run(sys, 'END b ENTER ENTER ENTER ENTER');
  assert.equal(text(sys, 4), 'page one▲');
  run(sys, 'DOWN');
  assert.equal(text(sys, 4), 'page two▲');
});

test('PAGE END in the middle of a page in revision gives a decimal page number', () => {
  const { sys } = revise('first\nsecond\fthird\n');
  run(sys, 'DOWN PAGE END');
  assert.equal(Pg(sys), 'Pg. 1.1');
  assert.equal(text(sys, 4), 'second▲');
  run(sys, 'DOWN DOWN');
  assert.equal(Pg(sys), 'Pg. 2');
});

test('the short beep at the Last Typing Line; typing goes on past it', () => {
  const { sys, devices } = newDoc();
  run(sys, 'RET*52');
  assert.equal(Ln(sys), 'Ln. 59');
  const before = devices.log.tones.length;
  run(sys, 'RET');
  assert.equal(devices.log.tones.length, before, 'no beep on the last typing line itself');
  run(sys, 'RET');
  assert.equal(Ln(sys), 'Ln. 61');
  assert.deepEqual(devices.log.tones.slice(before).map((t) => t.ms), [60]);
  run(sys, '"more"');
  assert.equal(text(sys, 23), 'more▲');
});

test('a diskette taken out before END leaves the document needing recovery', () => {
  const { sys, devices } = newDoc();
  run(sys, '"unsaved" PAGE END "x"');
  devices.remove(1);
  sys.runUntilIdle();
  devices.insert(1, 'TRAIN');
  sys.runUntilIdle();
  run(sys, 'END');
  assert.match(row(sys, 25), /Error on Diskette TRAIN/);
  expectRow(sys, 4, '                       TYPING TASKS');
  run(sys, 'd ENTER ENTER');
  expectRow(sys, 7, ' *Test               Document');
});
