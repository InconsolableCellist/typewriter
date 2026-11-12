// Work Diskette Tasks (SS 2.10): delete, duplicate, rename a document, rename a diskette, and the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, run, row, expectRow } from '../src/wp/testkit.js';

const docs = { TRAIN: [{ name: 'Smith Letter', text: 'Dear Mr Smith,\n', comment: 'To the bank' }, { name: 'Memo', text: 'A memo.\n' }] };
const names = (sys, disk) => sys.volume(disk).docs().map((e) => e.name);

test('a: Delete Document frees its sectors', () => {
  const { sys } = boot({ docs });
  const free = sys.volume('TRAIN').free;
  run(sys, 'b ENTER a ENTER "a Memo" ENTER "b TRAIN" ENTER');
  expectRow(sys, 9, '  a   Document Name                  Memo');
  run(sys, 'ENTER');
  assert.deepEqual(names(sys, 'TRAIN'), ['Smith Letter']);
  assert.ok(sys.volume('TRAIN').free > free);
  expectRow(sys, 4, '                      WORK DISKETTE TASKS');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /\(Memo\) deleted\./);
});

test('a: deleting a document that is not there says so; END leaves the menu', () => {
  const { sys } = boot({ docs });
  run(sys, 'b ENTER a ENTER "a Nothing" ENTER "b TRAIN" ENTER ENTER');
  assert.match(row(sys, 25), /\(Nothing\) not found on diskette TRAIN\./);
  run(sys, 'a ENTER "a Memo" ENTER END');
  assert.deepEqual(names(sys, 'TRAIN'), ['Smith Letter', 'Memo']);
});

test('b: Duplicate Document on the same diskette needs a new name; onto an existing document it appends', () => {
  const { sys } = boot({ docs });
  run(sys, 'b ENTER b ENTER "a Memo" ENTER "b TRAIN" ENTER "c Memo" ENTER "d TRAIN" ENTER ENTER');
  assert.match(row(sys, 25), /\(Memo\) already exists\./);
  run(sys, 'b ENTER "a Memo" ENTER "b TRAIN" ENTER "c Memo 2" ENTER "d TRAIN" ENTER ENTER');
  assert.deepEqual(names(sys, 'TRAIN'), ['Smith Letter', 'Memo', 'Memo 2']);
  run(sys, 'b ENTER "a Smith Letter" ENTER "b TRAIN" ENTER "c Memo 2" ENTER "d TRAIN" ENTER ENTER');
  run(sys, 'l ENTER a ENTER b ENTER "Memo 2" ENTER "TRAIN" ENTER ENTER');
  assert.equal(row(sys, 4).trimEnd(), ' A memo.');
  run(sys, 'DOWN DOWN');
  assert.equal(row(sys, 2).slice(35, 48).trim(), 'Pg. 2', 'the appended document is the next page');
  assert.equal(row(sys, 4).trimEnd(), ' Dear Mr Smith,');
});

test('c: Change Document Name shows the current name and comment and changes them', () => {
  const { sys } = boot({ docs });
  run(sys, 'b ENTER c ENTER "Smith Letter" ENTER "TRAIN" ENTER');
  expectRow(sys, 9, '  a   Name of Document    Smith Letter');
  expectRow(sys, 10, '  b   Document Comment    To the bank');
  run(sys, '"a Jones Letter" ENTER "b To the other bank" ENTER ENTER');
  const e = sys.volume('TRAIN').find('Jones Letter');
  assert.equal(e.comment, 'To the other bank');
  assert.deepEqual(names(sys, 'TRAIN'), ['Jones Letter', 'Memo'], 'the index keeps its order');
});

test('d: Change Diskette Name renames a work diskette, never the program diskette', () => {
  const { sys } = boot({ docs });
  run(sys, 'b ENTER d ENTER');
  expectRow(sys, 9, '  a   Diskette Name (Left Slot)      CMBDSK');
  expectRow(sys, 10, '  b   Diskette Name (Right Slot)     TRAIN');
  run(sys, '"a PROG2" ENTER ENTER');
  assert.match(row(sys, 25), /Program diskette cannot be changed\./);
  run(sys, 'CANCL "b DISK02" ENTER ENTER');
  assert.ok(row(sys, 2).startsWith('CMBDSK|DISK02|'));
  assert.ok(sys.volume('DISK02').find('Memo'));
});
