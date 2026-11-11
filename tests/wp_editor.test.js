// The worked examples of software-screens.md section 4 as keystroke scripts (architecture 12.1). The training
// documents the scripts name are not available, so the fixture documents are our own text holding the words the
// scripts act on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, run, expectRow, expectScreen, row } from '../src/wp/testkit.js';
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
