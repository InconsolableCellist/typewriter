// The worked examples of software-screens.md section 4 as keystroke scripts (architecture 12.1). The training
// documents the scripts name are not available, so the fixture documents are our own text holding the words the
// scripts act on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, run, expectRow, expectScreen, row, findOnScreen } from '../src/wp/testkit.js';
import { ATTR } from '../src/wp/screen.js';
import { C } from '../src/wp/textpack/editor/codes.js';
import { FLAG, Volume, runSync } from '../src/wp/disk/fs.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/wp-screens/${name}.txt`, import.meta.url), 'utf8');

export const LETTER = "Bobby -- I just want to drop you a short note to tell you that I landed safely and that everything is going just great. Hawaii is every bit as exciting as they say. The people are friendly and relaxed, and the scenery is breathtaking. If the weather is good tomorrow, I'm going to try scuba diving. See you all soon.";

/** The text of a document's page as stored on its diskette, codes shown by name. */
export function storedText(sys, disk, name, k = 0) {
  const vol = runSync(new Volume(sys.volume(disk).image).mount());
  const { head } = runSync(vol.readHead(vol.find(name)));
  const { units } = runSync(vol.readPage(head.pages[k].lsn));
  return Array.from(units, (u) => (u < 0x100 ? String.fromCharCode(u) : `<${Object.keys(C).find((k2) => C[k2] === u) ?? u.toString(16)}>`)).join('');
}

test('E2: create a short letter', () => {
  const { sys } = boot();
  run(sys, 'a ENTER');
  expectScreen(sys, fixture('typing-tasks'));
  run(sys, 'a ENTER');
  expectRow(sys, 24, 'Type document name; press ENTER.');
  run(sys, '"First Letter" ENTER');
  expectRow(sys, 24, 'Type diskette name; press ENTER.');
  run(sys, '"TRAIN" ENTER');
  expectScreen(sys, fixture('create-revise'));
  run(sys, 'ENTER');
  expectScreen(sys, fixture('typing-create'));
  run(sys, JSON.stringify(LETTER), { gap: 0.12 });
  // The SS grid of this step has a third line of 74 characters, one past the right margin at 90; with the margin
  // kept, "scenery" moves down and the fixture differs from the grid in rows 6 to 8 (architecture 7.9).
  expectScreen(sys, fixture('e2-letter'));
  run(sys, 'END');
  expectScreen(sys, fixture('typing-tasks'));
  const stored = storedText(sys, 'TRAIN', 'First Letter');
  assert.equal(stored.replace(/<CR>/g, '').replace(/<RHY>/g, '-').replace('<PE>', ''), LETTER);
  assert.equal((stored.match(/<CR>/g) ?? []).length, 4, 'four wrap returns stored');
  assert.equal(sys.volume('TRAIN').find('First Letter').flags & FLAG.OPEN, 0, 'END closes the document');

  // The same name again: the suggested names come back, and the document exists.
  run(sys, 'a ENTER');
  expectRow(sys, 24, 'Type document name; press ENTER. First Letter');
  run(sys, 'ENTER');
  expectRow(sys, 24, 'Type diskette name; press ENTER. TRAIN');
  run(sys, 'ENTER');
  assert.match(row(sys, 25), /\(First Letter\) already exists\./);
  expectRow(sys, 24, 'Type document name; press ENTER. First Letter');
  run(sys, 'CANCL CANCL');
  expectScreen(sys, fixture('typing-tasks'));

  // Revise shows what was stored.
  run(sys, 'b ENTER ENTER ENTER ENTER');
  for (let r = 4; r <= 8; r++) expectRow(sys, r, fixture('e2-letter').split('\n')[r - 1]);
  expectRow(sys, 2, '~~~~~~~~~~~~~|                    |Pg. 1        |Ln. 7    |Kyb 1     |Pitch 12');
});

test('E12: initialise and name a new work diskette', () => {
  const { sys } = boot({ work: [], blank: ['NEW'] });
  assert.ok(row(sys, 2).startsWith('CMBDSK|******|'));
  run(sys, 'b ENTER g ENTER');
  expectScreen(sys, fixture('erase-initialize'));
  run(sys, 'a ENTER 2 ENTER ENTER');
  assert.match(row(sys, 24), /Press ENTER to continue or press CANCL\./);
  run(sys, 'ENTER');
  expectRow(sys, 24, 'Type new diskette name; press ENTER.');
  const t0 = sys.now;
  run(sys, '"WORK01" ENTER');
  assert.ok(sys.now - t0 > 20, `initializing writes every track (${(sys.now - t0).toFixed(1)} s)`);
  assert.ok(row(sys, 2).startsWith('CMBDSK|WORK01|'));
  expectRow(sys, 4, '                      WORK DISKETTE TASKS');
  const vol = sys.volume('WORK01');
  assert.ok(vol.formatted && vol.docs().length === 0);
  assert.equal(vol.stats().available, 99);
  run(sys, 'l ENTER');
  expectRow(sys, 3, '                       TASK SELECTION');

  // Erasing a named diskette keeps its name and empties it.
  run(sys, 'a ENTER a ENTER "Memo" ENTER "WORK01" ENTER ENTER "Hello" END');
  assert.equal(sys.volume('WORK01').docs().length, 1);
  run(sys, 'f ENTER b ENTER g ENTER "a 2" ENTER ENTER ENTER');
  assert.ok(row(sys, 2).startsWith('CMBDSK|WORK01|'));
  assert.equal(sys.volume('WORK01').docs().length, 0);
});

// ---- M3: the editing scripts -------------------------------------------------------------------------------------

const SMITH = 'Dear Mr. Smith:\n\n\tThank you for your regular order of office supplies. Your account has been credited with the payment you sent last week.\n\n\tOur new catalog will reach you shortly. It lists several items that your staff asked about during our last visit.\n\nIf you have any questions about the catalog or your account, please call me. I will be glad to help in any way that is necessary.\n\nSincerely,\n\nTom Baker\n';
const PROMOTIONS = 'Promotions\n\n\tFirst, the spring sale starts on Monday and runs for two weeks, with every shoe in the store at a third off.\n\n\tSecond, members of the club get a free pair of socks with every pair of shoes they buy during the sale.\n\n\tThird, the store stays open until nine on Thursdays and Fridays while the sale lasts.\n';
const TRAINING = { TRAIN: [
  { name: 'Smith Letter', text: SMITH, comment: 'Thanks for the order' },
  { name: 'Promotions', text: PROMOTIONS },
  { name: 'Family', text: 'My mother told the story again at dinner, and then the others told theirs.\n' },
  { name: 'First Letter', text: `${LETTER}\n` },
] };

const E = (sys) => row(sys, 1).slice(52, 71).trim();
const reverseAt = (sys, r, c) => (sys.screen.attrAt(r, c) & ATTR.REVERSE) !== 0;

/** Revise a training document (SS E5 step 1). */
function revise(name, opts = {}) {
  const b = boot({ docs: TRAINING, ...opts });
  run(b.sys, `a ENTER b ENTER "${name}" ENTER "TRAIN" ENTER ENTER`);
  return b;
}

/** Put the cursor under the k-th character of the first occurrence of `text` on the screen, with cursor keys only. */
function cursorTo(sys, text, k = 0) {
  run(sys, 'CODE+UP');
  const at = findOnScreen(sys, text);
  assert.ok(at, `"${text}" on the screen`);
  if (at.row > 4) run(sys, `DOWN*${at.row - 4}`);
  run(sys, 'CODE+LEFT');
  for (let n = 0; sys.screen.cursor.col < at.col + k && n < 80; n++) run(sys, 'RIGHT');
  assert.deepEqual([sys.screen.cursor.row, sys.screen.cursor.col], [at.row, at.col + k]);
}

test('E5: revise: delete a word, insert a word, replace a letter', () => {
  const { sys } = revise('Smith Letter');
  expectRow(sys, 6, '      Thank you for your regular order of office supplies. Your account');
  cursorTo(sys, 'regular');
  assert.ok(sys.screen.attrAt(6, 26) & ATTR.BRIGHT, 'the character over the cursor is highlighted');
  assert.ok(reverseAt(sys, 3, 26), 'the scale line shows the cursor position');
  run(sys, 'DEL');
  expectRow(sys, 24, 'Delete what?');
  run(sys, 'RIGHT*7');
  for (let c = 26; c <= 33; c++) assert.ok(reverseAt(sys, 6, c), `column ${c} highlighted`);
  assert.ok(!reverseAt(sys, 6, 34));
  run(sys, 'ENTER');
  expectRow(sys, 24, '');
  expectRow(sys, 6, '      Thank you for your order of office supplies. Your account has been');
  run(sys, '"large "');
  expectRow(sys, 6, '      Thank you for your large order of office supplies. Your account has');
  cursorTo(sys, 'Tom');
  run(sys, 'CODE+INSERT/REPLACE');
  assert.equal(row(sys, 1).slice(42, 46), 'Repl');
  run(sys, '"R"');
  assert.ok(findOnScreen(sys, 'Rom Baker'));
  run(sys, 'CODE+INSERT/REPLACE');
  assert.equal(row(sys, 1).slice(42, 46), 'Ins ');
  run(sys, 'END');
  expectRow(sys, 4, '                       TYPING TASKS');
  assert.match(storedText(sys, 'TRAIN', 'Smith Letter'), /your large order of office/);
  assert.match(storedText(sys, 'TRAIN', 'Smith Letter'), /Rom Baker/);
});

test('E5: CANCL at "Delete what?" clears the highlighting and the prompt', () => {
  const { sys } = revise('Smith Letter');
  cursorTo(sys, 'regular');
  run(sys, 'DEL RIGHT*7 CANCL');
  expectRow(sys, 24, '');
  assert.ok(!reverseAt(sys, 6, 27));
  expectRow(sys, 6, '      Thank you for your regular order of office supplies. Your account');
});

test('E6: delete a whole paragraph by a target string; delete a blank line', () => {
  const { sys } = revise('Smith Letter');
  cursorTo(sys, 'If');
  const r = sys.screen.cursor.row;
  run(sys, 'DEL "necessary."');
  assert.ok(reverseAt(sys, r, 2) && reverseAt(sys, r + 1, 2), 'the paragraph is highlighted');
  const end = findOnScreen(sys, 'necessary.');
  assert.ok(reverseAt(sys, end.row, end.col + 9) && !reverseAt(sys, end.row, end.col + 10), 'through the first "necessary."');
  run(sys, 'ENTER');
  assert.equal(findOnScreen(sys, 'If you have'), null);
  assert.equal(row(sys, r).trim(), '↲', 'the cursor is on the blank line the paragraph left');
  // The blank line left behind: its return shows highlighted, and DEL ENTER removes it.
  cursorTo(sys, 'Sincerely');
  run(sys, 'UP');
  assert.equal(E(sys), "Req'd Carrier Ret");
  assert.equal(row(sys, sys.screen.cursor.row)[1], '↲');
  const before = findOnScreen(sys, 'Sincerely').row;
  run(sys, 'DEL ENTER');
  assert.equal(findOnScreen(sys, 'Sincerely').row, before - 1);
});

test('E7: move a paragraph', () => {
  const { sys } = revise('Promotions');
  cursorTo(sys, 'First');
  run(sys, 'CODE+LEFT');
  assert.equal(E(sys), 'Tab');
  assert.equal(row(sys, 6)[1], '⇥', 'the tab glyph under the cursor');
  run(sys, 'MOVE');
  expectRow(sys, 24, 'Move what?');
  run(sys, 'RETURN RETURN');
  assert.ok(reverseAt(sys, 6, 10) && reverseAt(sys, 7, 2) && reverseAt(sys, 8, 2), 'the paragraph and its blank line');
  run(sys, 'ENTER');
  expectRow(sys, 24, 'To where?');
  cursorTo(sys, 'Third');
  run(sys, 'CODE+LEFT ENTER');
  expectRow(sys, 24, '');
  const at = (w) => findOnScreen(sys, w).row;
  assert.ok(at('Second,') < at('First,') && at('First,') < at('Third,'), 'second, first, third');
  assert.equal(E(sys), 'Tab', 'the cursor is on the first unit of the moved text');
  assert.equal(sys.screen.cursor.row, at('First,'));
});

test('E7: copy within the page; move to another page with GO TO at "To where?"', () => {
  const { sys } = boot({ docs: { TRAIN: [{ name: 'Two', text: 'Alpha paragraph.\n\nBeta paragraph.\n\fGamma paragraph.\n' }] } });
  run(sys, 'a ENTER b ENTER "Two" ENTER "TRAIN" ENTER ENTER');
  cursorTo(sys, 'Beta');
  run(sys, 'COPY RETURN ENTER CODE+DOWN ENTER');
  expectRow(sys, 6, ' Beta paragraph.');
  expectRow(sys, 7, ' Beta paragraph.');
  cursorTo(sys, 'Alpha');
  run(sys, 'MOVE RETURN ENTER');
  expectRow(sys, 24, 'To where?');
  run(sys, 'GO TO ENTER');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 2');
  run(sys, 'ENTER');
  expectRow(sys, 4, ' Alpha paragraph.');
  expectRow(sys, 5, ' Gamma paragraph.');
  run(sys, 'GO TO "1" ENTER');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 1');
  assert.equal(findOnScreen(sys, 'Alpha'), null, 'gone from page 1');
  run(sys, 'GO TO "7" ENTER');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 2', 'past the end: the last page');
  assert.equal(E(sys), '');
  assert.equal(row(sys, sys.screen.cursor.row)[sys.screen.cursor.col - 1], '▲', 'on its last Page End');
});

test('E8: FIND goes forward, inside words too; FIND ENTER repeats', () => {
  const { sys } = revise('Family');
  run(sys, 'FIND');
  expectRow(sys, 24, 'Find what?');
  run(sys, '"the" ENTER');
  const mother = findOnScreen(sys, 'mother');
  assert.deepEqual([sys.screen.cursor.row, sys.screen.cursor.col], [4, mother.col + 2]);
  run(sys, 'FIND ENTER');
  assert.equal(sys.screen.cursor.col, findOnScreen(sys, 'the story').col);
  run(sys, 'FIND ENTER');
  assert.equal(sys.screen.cursor.col, findOnScreen(sys, 'then').col);
  run(sys, 'FIND ENTER FIND ENTER FIND ENTER');           // the others, others, theirs
  assert.deepEqual([sys.screen.cursor.row, sys.screen.cursor.col], [5, findOnScreen(sys, 'theirs').col]);
  const col = sys.screen.cursor.col;
  run(sys, 'FIND ENTER');
  assert.equal(sys.screen.cursor.col, col, 'not found: the cursor stays');
  assert.match(row(sys, 25), /Not found/);
  run(sys, 'FIND "x" CANCL');
  expectRow(sys, 24, 'Find what?');
  run(sys, 'CANCL');
  expectRow(sys, 24, '');
});

test('E9: paginate a long document', () => {
  const { sys, devices } = boot();
  run(sys, 'a ENTER a ENTER "Change" ENTER "TRAIN" ENTER b ENTER a ENTER "a 2" ENTER ENTER ENTER ENTER');
  assert.equal(row(sys, 2).slice(49, 58).trim(), 'Ln. 7');
  const tones = devices.log.tones.length;
  for (let k = 1; k <= 56; k++) {
    run(sys, `"Line ${k} of the notice." RET`, { gap: 0.05 });
    if (k === 26) assert.equal(devices.log.tones.length, tones, 'no beep up to the last typing line');
    if (k === 27) assert.equal(row(sys, 2).slice(49, 58).trim(), 'Ln. 61');
  }
  assert.ok(devices.log.tones.slice(tones).some((t) => t.ms === 200), 'a beep after typing Ln. 60');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 1', 'typing goes on, all on one page');
  run(sys, 'END');
  run(sys, 'c ENTER "Change" ENTER "TRAIN" ENTER');
  const grid = fixture('paginate').split('\n');
  for (let r = 3; r <= 24; r++) expectRow(sys, r, r === 9 ? '  a   Paginate From Page               1        1 - 1' : grid[r - 1]);
  run(sys, 'ENTER');
  expectRow(sys, 4, '                       TYPING TASKS');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /\(Change\) paginated/);
  run(sys, 'b ENTER ENTER ENTER ENTER');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 1');
  run(sys, 'CODE+DOWN');
  assert.equal(row(sys, 2).slice(49, 58).trim(), 'Ln. 61', 'page 1 ends after the last typing line: 27 double-spaced lines');
  run(sys, 'DOWN');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 2');
  expectRow(sys, 4, ' Line 28 of the notice.');
  run(sys, 'GO TO "3" ENTER');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 3');
  expectRow(sys, 4, ' Line 55 of the notice.');
});

test('E11: duplicate a document onto another diskette', () => {
  const { sys, devices } = boot({ work: ['TRAIN', 'DISK02'], docs: TRAINING });
  run(sys, 'b ENTER');
  devices.remove(0);
  devices.insert(0, 'DISK02');
  sys.runUntilIdle();
  run(sys, 'b ENTER');
  expectScreen(sys, fixture('duplicate-document'));
  run(sys, '"a First Letter" ENTER "b TRAIN" ENTER "c First Letter" ENTER "d DISK02" ENTER');
  for (const r of [9, 10, 12, 13]) assert.ok(reverseAt(sys, r, 38), `choice on row ${r} highlighted`);
  expectRow(sys, 13, '  d   Diskette Name                  DISK02');
  run(sys, 'ENTER');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /\(First Letter\) duplicated\./);
  assert.equal(storedText(sys, 'DISK02', 'First Letter'), storedText(sys, 'TRAIN', 'First Letter'));
  // END before the final ENTER stops it.
  run(sys, 'b ENTER "a Promotions" ENTER "b TRAIN" ENTER "c Promotions" ENTER "d DISK02" ENTER END');
  assert.equal(sys.volume('DISK02').find('Promotions'), null);
});

test('E13: show codes; find the format change and open it', () => {
  const { sys } = revise('Promotions');
  cursorTo(sys, 'Second');
  run(sys, 'CODE+LEFT CHG FMT');
  expectRow(sys, 4, '                          FORMAT SELECTION');
  assert.equal(row(sys, 1).slice(0, 13), 'Format Change');
  run(sys, 'a ENTER "a 2" ENTER ENTER ENTER');
  assert.equal(row(sys, 2).slice(49, 58).trim(), 'Ln. 12', 'the cursor is back where it was');
  run(sys, 'DOWN');
  assert.equal(row(sys, 2).slice(49, 58).trim(), 'Ln. 14', 'double spacing from the change on');
  run(sys, 'CODE+SCREEN FORMAT');
  expectRow(sys, 4, '                             SCREEN FORMAT');
  run(sys, '"a 1" ENTER ENTER');
  assert.equal(row(sys, 4).slice(0, 12), ' Promotions↲', 'every code shows');
  assert.equal(row(sys, 6)[1], '⇥');
  run(sys, 'CODE+UP FIND CHG FMT');
  expectRow(sys, 24, 'Find what? ⒡');
  run(sys, 'ENTER');
  assert.equal(E(sys), 'Line Format Change');
  assert.equal(row(sys, sys.screen.cursor.row)[sys.screen.cursor.col - 1], '⒡');
  run(sys, 'ENTER');
  expectRow(sys, 4, '                          FORMAT SELECTION');
  run(sys, 'ENTER');
  assert.equal(E(sys), 'Line Format Change', 'back in the text, on the code');
});
