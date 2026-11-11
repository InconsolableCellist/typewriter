// The diskette layout (architecture 8.1, 8.2): the documented geometry and capacities, labels, chains, the index,
// capacity, fragmentation, the recovery flag and persistence through the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA, dataSectors, lsnAddress, imageSize } from '../src/wp/disk/geometry.js';
import { createImage } from '../src/wp/disk/image.js';
import { Volume, KIND, FLAG, DiskError, runSync } from '../src/wp/disk/fs.js';
import { workDiskette, programDiskette, SEGMENTS } from '../src/wp/disk/library.js';
import { firstRunLibrary, writeDocument } from '../src/wp/textpack/samples.js';
import { boot, run, row } from '../src/wp/testkit.js';
import { latency, seek, RECALIBRATE_S, DRIVE } from '../src/wp/devices/timing.js';

const mount = (img) => runSync(new Volume(img).mount());

test('geometry: the documented capacities and the layout of logical sectors', () => {
  assert.equal(dataSectors(MEDIA['1']) * 256, 284160);
  assert.equal(dataSectors(MEDIA['2D']) * 256, 985088);
  assert.deepEqual(lsnAddress(MEDIA['2D'], 0), { track: 1, side: 0, sector: 1 });
  assert.deepEqual(lsnAddress(MEDIA['2D'], 26), { track: 1, side: 1, sector: 1 });
  assert.deepEqual(lsnAddress(MEDIA['2D'], 52), { track: 2, side: 0, sector: 1 });
  assert.deepEqual(lsnAddress(MEDIA['1'], 15), { track: 2, side: 0, sector: 1 });
  assert.equal(imageSize(MEDIA['1']), 26 * 128 + 76 * 15 * 256);
});

test('timing: the drive figures', () => {
  assert.equal(seek(0), 0);
  assert.ok(Math.abs(seek(10) - 0.085) < 1e-12);
  assert.ok(Math.abs(RECALIBRATE_S - 0.42) < 1e-12);
  assert.ok(Math.abs(latency(0, 1, 26)) < 1e-12);
  assert.ok(Math.abs(latency(0, 14, 26) - DRIVE.rotationS / 2) < 1e-9);
  assert.ok(Math.abs(latency(DRIVE.rotationS / 2, 1, 26) - DRIVE.rotationS / 2) < 1e-9);
});

test('a blank diskette reads as unformatted; format and mount give its name back', () => {
  const img = createImage('X', '1');
  const v = mount(img);
  assert.equal(v.formatted, false);
  assert.equal(v.name, '******');
  runSync(v.format('DISK01'));
  const w = mount(img);
  assert.equal(w.name, 'DISK01');
  assert.equal(w.label.kind, KIND.WORK);
  assert.equal(w.docs().length, 0);
  assert.equal(w.stats().available, 99, 'the map and the first index sector are used');
});

test('chains carry data across sectors; the index keeps creation order across sectors', () => {
  const img = workDiskette('W', 'W');
  const v = mount(img);
  const data = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
  const lsns = runSync(v.writeChain(data));
  assert.equal(lsns.length, 4);
  assert.deepEqual(runSync(v.readChain(lsns[0])).bytes, data);
  for (const name of ['one', 'two', 'three', 'four', 'five']) writeDocument(img, name, `This is ${name}.\n`);
  const w = mount(img);
  assert.deepEqual(w.docs().map((e) => e.name), ['one', 'two', 'three', 'four', 'five']);
  assert.equal(w.indexLsns.length, 3);
});

test('capacity: a diskette fills up, and a write that does not fit allocates nothing', () => {
  const img = workDiskette('S', 'S', '1');
  const v = mount(img);
  const total = v.free;
  assert.equal(total, 1110 - 2);
  const big = new Uint8Array(252 * 100);
  let n = 0;
  for (;;) {
    try { runSync(v.writeChain(big)); n++; } catch (e) { assert.ok(e instanceof DiskError && e.code === 'full'); break; }
  }
  assert.equal(n, Math.floor(total / 100));
  const left = v.free;
  assert.equal(left, total - n * 100);
  assert.throws(() => runSync(v.writeChain(new Uint8Array(252 * (left + 1)))), DiskError);
  assert.equal(v.free, left, 'nothing allocated by the failed write');
  assert.equal(v.stats().available, Math.floor(100 * left / 1110));
});

test('fragmentation: a freed gap is used first, so a later document is split across the diskette', () => {
  const img = workDiskette('F', 'F');
  ['a', 'b', 'c'].forEach((name) => writeDocument(img, name, 'x'.repeat(1500)));
  const v = mount(img);
  runSync(v.deleteDoc(v.find('b')));
  writeDocument(img, 'd', 'y'.repeat(4000));
  const w = mount(img);
  const lsns = runSync(w.docLsns(w.find('d'))).sort((p, q) => p - q);
  const runs = lsns.filter((l, i) => i === 0 || l !== lsns[i - 1] + 1).length;
  assert.ok(runs >= 2, `the new document is in ${runs} pieces`);
  assert.ok(lsns[0] < Math.min(...runSync(w.docLsns(w.find('c')))), 'it starts in the gap b left');
});

test('the program diskette lists its segments and keeps its settings', () => {
  const img = programDiskette('P', { keyboard: 3 });
  const v = mount(img);
  assert.ok(v.isProgram);
  assert.equal(v.find('nucleus').count, SEGMENTS.nucleus);
  assert.deepEqual(runSync(v.readSettings()), { keyboard: 3 });
});

test('the first visit: a program diskette, WORK01 with three sample documents, two blanks', () => {
  const lib = firstRunLibrary();
  assert.ok(mount(lib.get('CMBDSK')).isProgram);
  assert.deepEqual(mount(lib.get('WORK01')).docs().map((e) => e.name), ['Welcome', 'Shopping', 'Note to Self']);
  assert.equal(mount(lib.get('BLANK1')).formatted, false);
});

test('the recovery flag: set by create and revise, cleared by END, seen by a fresh system', () => {
  const { sys, library } = boot();
  run(sys, 'a ENTER a ENTER "Draft" ENTER "TRAIN" ENTER ENTER "some words"');
  assert.ok(mount(library.get('TRAIN')).find('Draft').flags & FLAG.OPEN);
  run(sys, 'END');
  assert.equal(mount(library.get('TRAIN')).find('Draft').flags & FLAG.OPEN, 0);
  run(sys, 'b ENTER ENTER ENTER ENTER "more "');
  assert.ok(mount(library.get('TRAIN')).find('Draft').flags & FLAG.OPEN, 'open again while revised');
  // The power goes: a new system finds the document open.
  const fresh = boot({ work: [], setup: (lib) => lib.add(library.get('TRAIN')) });
  fresh.devices.insert(1, 'TRAIN');
  fresh.sys.runUntilIdle();
  run(fresh.sys, 'a ENTER d ENTER ENTER');
  assert.equal(row(fresh.sys, 7).slice(1, 8), '*Draft ');
});

test('persistence: each written image is saved to the store within a second', () => {
  const { sys } = boot();
  run(sys, 'a ENTER a ENTER "Kept" ENTER "TRAIN" ENTER ENTER "hello" END');
  const saved = sys.store.load('TRAIN');
  assert.ok(saved, 'saved');
  const v = mount({ id: 'TRAIN', type: '2D', bytes: saved, version: 0 });
  assert.ok(v.find('Kept'));
});
