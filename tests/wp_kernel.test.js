// The word processor's software kernel (milestone M1): start-up (E1), scan bytes to keys, typematic, the menu runner
// (long and short form, the four CANCL levels, type-ahead) and the purity rule of src/wp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, run, hold, expectRow, expectScreen, press, strokes } from '../src/wp/testkit.js';
import { KeyDecoder, strokeBytes, POS } from '../src/wp/keys.js';
import { MENUS } from '../src/wp/textpack/menus.js';
import { runMenu, menuState } from '../src/wp/textpack/menu-runner.js';
import { ATTR } from '../src/wp/screen.js';
import { LOGO_AT } from '../src/wp/rom.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/wp-screens/${name}.txt`, import.meta.url), 'utf8');

test('E1: power on, the test codes, the initials, load the program, TASK SELECTION', () => {
  const { sys, devices } = boot({ cold: true });
  const at = (t) => { sys.advance(t); return sys.screen.text(20).slice(9, 13).trim(); };
  assert.equal(at(2.9), '');
  assert.equal(at(3.1), '05');
  assert.equal(at(4.1), '06');
  assert.equal(at(7.1), '09');
  assert.equal(at(10.1), '*11*');
  assert.ok(sys.screen.attrAt(LOGO_AT[0], LOGO_AT[1]) & ATTR.SYMBOL, 'large initials on the screen');
  sys.advance(12);
  devices.insert(0, 'CMBDSK');
  sys.advance(12.6);
  expectScreen(sys, fixture('loading'));
  sys.runUntilIdle();
  const loaded = sys.program.loadedAt - 12;
  assert.ok(loaded > 8 && loaded < 12, `program load took ${loaded.toFixed(2)} s, documented about 10 s`);
  expectScreen(sys, fixture('task-selection'));
  assert.ok(devices.log.disk.length > 20, 'the load reads the diskette track by track');
});

test('E1: a program diskette already in the drive skips the initials', () => {
  const { sys } = boot({ cold: true });
  sys.devices.drives[0].media = { mediaId: 'CMBDSK', type: '2D' };
  sys.advance(10.1);
  assert.notEqual(sys.screen.text(20).slice(9, 13), '*11*');
  sys.runUntilIdle();
  expectRow(sys, 3, '                       TASK SELECTION');
});

test('re-IPL: CONTROL+RET then ENTER on TASK SELECTION starts again', () => {
  const { sys } = boot();
  run(sys, 'CONTROL+RETURN ENTER');
  expectScreen(sys, fixture('task-selection'));
  assert.ok(sys.program.loadedAt > 3, 'the program was loaded again');
});

test('key decoding: positions, both shifts, the lock, CODE and CONTROL', () => {
  const d = new KeyDecoder();
  const seq = (bytes) => bytes.map((b) => d.decode(b)).filter(Boolean);
  assert.deepEqual(seq([POS.a]).map((e) => e.ch), ['a']);
  assert.deepEqual(seq(strokeBytes(POS.a, { shift: true })).map((e) => e.ch), ['A']);
  assert.deepEqual(seq([62, POS['1'], 62 | 0x80]).map((e) => e.ch), ['!'], 'right shift');
  seq([37]);                                                // LOCK goes down and stays
  assert.deepEqual(seq([POS.q, POS['2']]).map((e) => e.ch), ['Q', '@'], 'a shift lock, not a caps lock');
  seq([37 | 0x80]);                                         // released through either SHIFT
  assert.equal(seq([POS.q])[0].ch, 'q');
  const [c] = seq(strokeBytes(POS.REQST, { code: true }));
  assert.equal(c.name, 'REQST'); assert.ok(c.code);
  const [z] = seq(strokeBytes(POS.RETURN, { control: true }));
  assert.ok(z.control && !z.code);
  assert.equal(d.decode(0x7f), null, 'the overrun byte is no key');
  assert.equal(seq([POS['½'] , POS['½'] | 0x80])[0].ch, '½');
});

test('typematic: repeats act only for the keys marked typematic, and each one clicks', () => {
  const d = new KeyDecoder();
  assert.equal(d.decode(POS.a | 0x80), null, 'a letter does not repeat');
  assert.ok(d.decode(POS.BKSP | 0x80).repeat);
  for (const k of ['-', 'BKSP', 'INDEX', 'RETURN', 'SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'LINE ADJ', 'COLUMN ADD']) {
    assert.ok(d.decode(POS[k] | 0x80), k);
  }
  for (const k of ['ENTER', 'DEL', 'a', 'END', 'FIND']) assert.equal(d.decode(POS[k] | 0x80), null, k);

  const { sys, devices } = boot();
  run(sys, '"abcdefghijklmn"');
  const clicks = devices.log.clicks;
  hold(sys, 'BKSP', 1.0);                 // one press, then a repeat every 1/14 s from 350 ms: ten repeats
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER: abc');
  assert.equal(devices.log.clicks - clicks, 11);
  hold(sys, 'a', 1.0);
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER: abca');
  hold(sys, 'DOWN', 1.0);                 // the cursor keys do nothing in a menu (ORG p.32): no click
  assert.equal(devices.log.clicks - clicks, 12);
});

test('menus: TASK SELECTION to TYPING TASKS, CANCL back, upper-case IDs, invalid IDs', () => {
  const { sys } = boot();
  expectScreen(sys, fixture('task-selection'));
  run(sys, 'a ENTER');
  expectScreen(sys, fixture('typing-tasks'));
  run(sys, 'CANCL');
  expectScreen(sys, fixture('task-selection'));
  run(sys, 'A ENTER');
  expectRow(sys, 4, '                       TYPING TASKS');
  run(sys, 'z ENTER');
  assert.match(sys.screen.text(25), /ID letter not valid/);
  run(sys, 'f ENTER');
  expectRow(sys, 3, '                       TASK SELECTION');
  run(sys, 'e ENTER');
  assert.match(sys.screen.text(25), /Feature Tasks not available/);
  run(sys, 'b ENTER');
  expectScreen(sys, fixture('work-diskette-tasks'));
});

test('menus: type-ahead is kept across screen changes and program loads (SR 3.3)', () => {
  const { sys } = boot();
  run(sys, 'a ENTER f ENTER b ENTER', { typeAhead: true });
  expectScreen(sys, fixture('work-diskette-tasks'));
  assert.equal(sys.program.segment, 'workdisk');
});

/** Run one menu in its own task and return what it answered. */
function menuTask(sys, def, st, opts = {}) {
  const box = {};
  sys.sched.spawn((function* () { box.r = yield* runMenu(sys, def, st, opts); })(), 'menu');
  sys.sched.run();
  return box;
}

function bareSystem() {
  const { sys } = boot();
  sys.sched.tasks.forEach((t) => sys.sched.kill(t));       // a test menu takes the keys instead of the shell
  return sys;
}

test('menu runner: long form, short form, highlighting, the four CANCL levels', () => {
  const sys = bareSystem();
  const st = menuState({ from: '0', through: '0', quantity: 1, paper: 2, cancelOnError: 2 });
  const box = menuTask(sys, MENUS.printDocument, st);
  expectScreen(sys, fixture('print-document'));
  // long form
  run(sys, 'c ENTER');
  expectRow(sys, 24, 'Type YOUR CHOICE; press ENTER');
  run(sys, '3 ENTER');
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER:');
  expectRow(sys, 13, '  c   Print Quantity      3        1 - 99');
  assert.ok(sys.screen.attrAt(13, 27) & ATTR.REVERSE, 'a changed choice is highlighted');
  // short form, and a choice that is not possible
  run(sys, '"d 3" ENTER');
  expectRow(sys, 15, '  d   Paper Handling      3        1 = Cut Paper, Manual Feed');
  run(sys, '"d 7" ENTER');
  assert.match(sys.screen.text(25), /Choice not valid/);
  run(sys, '"e 1" ENTER');
  assert.equal(sys.screen.text(25).trim(), '', 'a corrected choice clears the message');
  // CANCL 1: the typed answer
  run(sys, '"c 9"');
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER: c 9');
  run(sys, 'CANCL');
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER:');
  // CANCL 2: the YOUR CHOICE prompt
  run(sys, 'c ENTER CANCL');
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER:');
  // CANCL 3: every changed choice
  run(sys, 'CANCL');
  expectRow(sys, 13, '  c   Print Quantity      1        1 - 99');
  assert.equal(sys.screen.attrAt(13, 27) & ATTR.REVERSE, 0);
  assert.equal(st.values.paper, 2);
  assert.equal(box.r, undefined);
  // CANCL 4: the menu itself
  run(sys, 'CANCL');
  assert.deepEqual(box.r, { cancel: true });
});

test('menu runner: ENTER on an empty prompt accepts the menu', () => {
  const sys = bareSystem();
  const st = menuState({ from: '0', through: '0', quantity: 1, paper: 2, cancelOnError: 2 });
  const box = menuTask(sys, MENUS.printDocument, st);
  run(sys, '"c 2" ENTER ENTER');
  assert.deepEqual(box.r, { done: true });
  assert.equal(st.values.quantity, 2);
});

test('menu runner: a text choice keeps its spaces; a menu with no choices goes on an ID', () => {
  const sys = bareSystem();
  const st = menuState({ comment: '', preserve: 2 });
  const box = menuTask(sys, MENUS.createRevise, st);
  run(sys, '"a Letter to the bank" ENTER');
  expectRow(sys, 9, '  a   Document Comment             Letter to the bank');
  run(sys, 'b ENTER');
  assert.deepEqual(box.r, { go: 'docFormat', item: 'b' });
});

test('scripts: the tokenizer knows two-word keys, chords and repeats', () => {
  const s = strokes('GO TO CODE+GO TO PAGE END CANCL RIGHT*3 "aB"');
  assert.deepEqual(s.map((k) => [k.pos, !!k.code, !!k.shift]), [
    [80, false, false], [80, true, false], [72, false, false], [5, true, false],
    [79, false, false], [79, false, false], [79, false, false], [38, false, false], [56, false, true],
  ]);
  const { sys } = boot();
  press(sys, s[s.length - 1]);
  sys.runUntilIdle();
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER: B');
});

test('purity: src/wp imports nothing outside itself and uses no wall clock, DOM or randomness', () => {
  const root = new URL('../src/wp/', import.meta.url).pathname;
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(root);
  assert.ok(files.length > 10);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
      const target = path.resolve(path.dirname(f), m[1]);
      assert.ok(m[1].startsWith('.') && target.startsWith(root), `${path.relative(root, f)} imports ${m[1]}`);
    }
    const code = src.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const banned = [/\bwindow\s*[.[]/, /\bdocument\s*\./, /\bperformance\s*\./, /\bDate\s*[.(]/, /\bnew\s+Date\b/, /\bsetTimeout\b/, /\bMath\.random\b/];
    for (const re of banned) assert.ok(!re.test(code), `${path.relative(root, f)} uses ${re}`);
  }
});
