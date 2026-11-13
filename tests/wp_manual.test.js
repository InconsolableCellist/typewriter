// Our quick-start packet says what the software does: each keystroke sequence its pages quote,
// typed into the software, does what the page says (src/ui/wp-manual-pages.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { boot, run, row, findOnScreen } from '../src/wp/testkit.js';
import { PROGRAM_NAME } from '../src/wp/disk/library.js';
import { TEXT } from '../src/wp/textpack/messages.js';
import { PAGES, SEQUENCES } from '../src/ui/wp-manual-pages.js';
import { STATIONS, FOCUS, fallbackBoxes } from '../src/interact/wp-views.js';
import { geometryFor } from '../src/machine/index.js';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { MANUAL_SIZE, MANUAL_URL } from '../src/render/wp/manual.js';
import { PACKET_SIZE, PACKET_TITLE } from '../src/render/wp/packet.js';

const WORDS = new Uint8Array(zlib.gunzipSync(fs.readFileSync(new URL('../public/assets/wordlist_en.gz.bin', import.meta.url))));
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const page = (title) => plain(PAGES.find((p) => p.title === title).html);
const screen = (sys) => Array.from({ length: 25 }, (_, r) => row(sys, r + 1)).join('\n');

test('the packet points to IBM\'s manual, which links to the scan on bitsavers rather than a copy of ours', () => {
  assert.ok(page('Contents').includes('The full IBM manual is on the binder on the diskette unit'));
  assert.equal(PACKET_TITLE, 'Quick Start: Displaywriter / Textpack 4');
  assert.match(MANUAL_URL, /^https:\/\/bitsavers\.org\/pdf\/ibm\/6580_Displaywriter\/S544-2036-0_IBM_Displaywriter_Operator_Reference_Guide_Textpack_4_Reportpack_Feb82\.pdf$/);
});

test('the packet: 6 to 10 pages, a contents page that lists the rest, our own short text', () => {
  assert.ok(PAGES.length >= 6 && PAGES.length <= 10);
  assert.equal(PAGES[0].title, 'Contents');
  for (const p of PAGES.slice(1)) assert.ok(page('Contents').includes(p.title), `contents lists ${p.title}`);
  for (const p of PAGES) assert.ok(plain(p.html).length < 2200, `${p.title} is short`);
});

test('keyboard page: the PC keys it names are the ones the keymap uses', async () => {
  const { KEYMAP, CHORDS, CODE_KEY } = await import('../src/interact/wp-keymap.js');
  const { POS } = await import('../src/wp/keys.js');
  const t = page('The keyboard');
  for (const s of ['ENTER right Alt (AltGr), or keypad Enter', 'RET carrier return Enter', 'CODE left Alt', 'CANCL Esc', 'REQST · PRINT F1 · F2', 'DEL · END · MSG Delete · End · Insert']) assert.ok(t.includes(s), s);
  assert.equal(KEYMAP.AltRight, POS.ENTER); assert.equal(KEYMAP.NumpadEnter, POS.ENTER);
  assert.equal(KEYMAP.Enter, POS.RETURN); assert.equal(KEYMAP.AltLeft, CODE_KEY); assert.equal(CODE_KEY, POS.CODE);
  assert.deepEqual(CHORDS.Escape, [POS.CODE, POS.REQST]);
  const fkeys = ['REQST', 'PRINT', 'FIND', 'GO TO', 'MOVE', 'LINE ADJ', 'SPELL', 'CHG FMT', 'GET', 'PAGE END'];
  fkeys.forEach((name, i) => assert.equal(KEYMAP[`F${i + 1}`], POS[name], `F${i + 1} = ${name}`));
  assert.equal(KEYMAP.Delete, POS.DEL); assert.equal(KEYMAP.End, POS.END); assert.equal(KEYMAP.Insert, POS.MSG);
  assert.equal(KEYMAP.PageDown, POS['SCREEN DOWN']); assert.deepEqual(CHORDS.PageUp, [POS.CODE, POS['SCREEN DOWN']]);
  assert.deepEqual(CHORDS.Home, [POS.CODE, POS.LEFT]);
  assert.equal(KEYMAP.Backspace, POS.BKSP); assert.equal(KEYMAP.Tab, POS.TAB); assert.equal(KEYMAP.CapsLock, POS.LOCK); assert.equal(KEYMAP.ControlLeft, POS.CONTROL);
});

test('starting up: 05, 06, 09, then *11* with no program diskette; the program in drive 1 brings TASK SELECTION', () => {
  const t = page('Starting up');
  for (const s of ['05', '06', '09', '*11*', 'drive 1', 'TASK SELECTION']) assert.ok(t.includes(s), s);
  const { sys, devices } = boot({ cold: true, work: ['WORK01'] });
  const code = (at) => { sys.advance(at); return row(sys, 20).slice(9, 13).trim(); };
  assert.deepEqual([3.1, 4.1, 7.1, 10.1].map(code), ['05', '06', '09', '*11*']);
  devices.insert(0, PROGRAM_NAME);
  sys.runUntilIdle();
  assert.match(row(sys, 3), /TASK SELECTION/);
  run(sys, SEQUENCES.typingTasks);
  assert.match(row(sys, 4), /TYPING TASKS/);
});

test('creating: a ENTER a ENTER, name, WORK01 in capitals; lower case asks for the diskette and REPLY backs out', () => {
  assert.ok(page('Creating a document').includes('WORK01 ENTER'));
  const { sys } = boot({ work: ['WORK01'] });
  run(sys, `${SEQUENCES.typingTasks} ${SEQUENCES.create} "Letter" ENTER "work01" ENTER`);
  assert.equal(row(sys, 24).trim(), 'Insert diskette (work01); press ENTER.');
  run(sys, 'REPLY');
  assert.match(row(sys, 4), /TYPING TASKS/, 'REPLY refuses and Typing Tasks returns');
  run(sys, `${SEQUENCES.create} "Letter" ENTER ${SEQUENCES.diskette}`);
  assert.match(row(sys, 4), /CREATE OR REVISE DOCUMENT/);
  run(sys, 'ENTER "Dear Sir," RET RET "Thank you for the order." END');
  assert.match(row(sys, 4), /TYPING TASKS/, 'END stores and returns to Typing Tasks');
  // Creating it again: already exists.
  run(sys, `${SEQUENCES.create} "Letter" ENTER ${SEQUENCES.diskette}`);
  assert.match(screen(sys), /\(Letter\) already exists\./);
});

function withLetter() {
  const { sys } = boot({ work: ['WORK01'] });
  run(sys, `a ENTER a ENTER "Letter" ENTER "WORK01" ENTER ENTER "Dear Sir," RET RET "Thank you for the order." RET "Yours," END`);
  return sys;
}

test('revising: b ENTER; arrows, CODE+arrows, Ins and Repl, DEL with a space or RET, END saves', () => {
  const t = page('Revising a document');
  for (const s of ['Delete what?', 'Ins', 'Repl', 'CODE 8']) assert.ok(t.includes(s), s);
  const sys = withLetter();
  run(sys, `${SEQUENCES.revise} "Letter" ENTER ${SEQUENCES.diskette} ENTER`);
  assert.ok(findOnScreen(sys, 'Thank you for the order.'));
  assert.deepEqual([sys.screen.cursor.row, sys.screen.cursor.col], [4, 2], 'the cursor at the start');
  assert.equal(row(sys, 1).slice(42, 46), 'Ins ');
  run(sys, 'CODE+DOWN');
  assert.ok(sys.screen.cursor.row > 6, 'CODE+DOWN: to the end of the page');
  run(sys, 'CODE+UP');
  assert.equal(sys.screen.cursor.row, 4, 'CODE+UP: to the top of the page');
  run(sys, 'DOWN DOWN RIGHT*10 DEL');
  assert.equal(row(sys, 24).trim(), 'Delete what?');
  run(sys, '" " ENTER');
  assert.ok(findOnScreen(sys, 'Thank you the order.'), 'a space takes a word');
  run(sys, '"for "');
  assert.ok(findOnScreen(sys, 'Thank you for the order.'), 'typing inserts');
  run(sys, 'CODE+LEFT');
  assert.equal(sys.screen.cursor.col, 2, 'CODE+LEFT (Home): the start of the line');
  run(sys, 'CODE+8');
  assert.equal(row(sys, 1).slice(42, 46), 'Repl');
  run(sys, '"P" CODE+8');
  assert.ok(findOnScreen(sys, 'Phank you'), 'Repl replaces');
  run(sys, 'DEL RET ENTER');
  assert.equal(findOnScreen(sys, 'Phank'), null, 'RET takes the rest of the paragraph');
  run(sys, 'DEL RIGHT*2 CANCL');
  assert.ok(findOnScreen(sys, 'Yours,'), 'CANCL leaves the text alone');
  run(sys, 'END');
  assert.match(row(sys, 4), /TYPING TASKS/);
  run(sys, 'b ENTER "Nothing" ENTER "WORK01" ENTER');
  assert.match(screen(sys), /\(Nothing\) not found on diskette WORK01\./);
});

test('printing: e ENTER, the menu, ==> and MSG, REQST e ENTER, printed; c ENTER 2 ENTER sets two copies', () => {
  const t = page('Printing');
  for (const s of ['REQST e ENTER', 'Put on printer element (086 001)', 'c ENTER 2 ENTER', 'Continue Printing With Element Now On Printer']) assert.ok(t.includes(s), s);
  const sys = withLetter();
  run(sys, `${SEQUENCES.print} "Letter" ENTER ${SEQUENCES.diskette}`);
  assert.match(row(sys, 4), /PRINT DOCUMENT/);
  run(sys, SEQUENCES.copies);
  assert.match(row(sys, 13), /Print Quantity\s+2/);
  run(sys, 'ENTER');
  assert.match(row(sys, 4), /TYPING TASKS/);
  assert.equal(row(sys, 25).slice(0, 3), '==>');
  run(sys, 'MSG');
  assert.equal(row(sys, 25).trim(), 'Put on printer element (086 001)');
  // Until it has printed, it cannot be revised.
  run(sys, 'b ENTER "Letter" ENTER "WORK01" ENTER');
  assert.match(row(sys, 25), /\(Letter\) already in use/);
  run(sys, 'CANCL CANCL');
  assert.match(row(sys, 24), /Type ID letter to choose ITEM/, 'CANCL clears the name, then leaves the prompt');
  run(sys, 'REQST');
  assert.match(screen(sys), /TEXTPACK REQUEST TASKS/);
  assert.match(screen(sys), /e {5}Continue Printing With Element Now On Printer/);
  run(sys, 'e ENTER');
  sys.runUntilIdle();
  for (let n = 0; n < 6 && !/printed/.test(row(sys, 25)); n++) run(sys, 'MSG');
  assert.equal(row(sys, 25).trim(), '(Letter) printed.');
  run(sys, `MSG*3 CANCL*3 ${SEQUENCES.mainMenu}`);
  assert.match(row(sys, 3), /TASK SELECTION/);
});

test('messages page: ==> and MSG, and every message it lists is one the software has', () => {
  const t = page('Messages');
  assert.ok(t.includes('==>') && t.includes('MSG'));
  const known = Object.values(TEXT).map(([s]) => s);
  const rows = [...PAGES.find((p) => p.title === 'Messages').html.matchAll(/<tr><td>(.*?)<\/td>/gs)].map((m) => plain(m[1]).trim());
  assert.ok(rows.length >= 6);
  for (const r of rows) {
    const ok = known.some((k) => new RegExp(`^${k.replace(/[.*+?^$()[\]\\|]/g, '\\$&').replace(/\{\w+\}/g, '.+')}$`).test(r));
    assert.ok(ok, `"${r}" is a message of the software`);
  }
});

test('spelling: SPELL, ENTER ENTER, ENTER, d ENTER 2 ENTER ENTER, retype, back at Typing Tasks with the count', () => {
  const { sys } = boot({ work: ['WORK01'], wordList: WORDS });
  run(sys, 'a ENTER a ENTER "Note" ENTER "WORK01" ENTER ENTER "The cat sat on teh mat." SPELL');
  assert.match(row(sys, 4), /SPELLING TASKS/);
  assert.match(row(sys, 24), /Type document name; press ENTER\. Note/);
  run(sys, 'ENTER ENTER');
  assert.match(row(sys, 4), /CHECK DOCUMENT/);
  run(sys, 'ENTER');
  assert.match(row(sys, 4), /HYPHENATE AND PAGINATE DOCUMENT/);
  run(sys, `${SEQUENCES.noPrint} ENTER`);
  assert.equal(row(sys, 21).trim(), 'teh');
  run(sys, '"the" ENTER');
  assert.match(row(sys, 4), /TYPING TASKS/);
  assert.match(row(sys, 24), /Note/, 'Revise Document ready for the same document');
  for (let n = 0; n < 6 && !/Spelling Check complete/.test(row(sys, 25)); n++) run(sys, 'MSG');
  assert.match(row(sys, 25), /Spelling Check complete\. Words marked: \d+/);
  run(sys, 'MSG ENTER ENTER');
  assert.match(row(sys, 4), /CREATE OR REVISE DOCUMENT/, 'ENTER revises it');
  run(sys, 'ENTER');
  assert.ok(findOnScreen(sys, 'The cat sat on the mat.'), 'the retyped word is in the document');
});

test('the binder lies on the diskette unit, clear of the ashtray, with a Manual view at the diskettes', () => {
  const g = geometryFor(wordproc1980);
  const L = wordproc1980.deskLayout, u = g.units.diskette;
  assert.equal(L.manual.on, 'diskette');
  assert.ok(Math.abs(L.manual.at[1] - (u.box.max[1] - u.box.min[1])) < 1e-9, 'on the unit\'s top');
  const half = (yaw) => [MANUAL_SIZE.w / 2 * Math.cos(yaw) + MANUAL_SIZE.d / 2 * Math.sin(Math.abs(yaw)), MANUAL_SIZE.w / 2 * Math.sin(Math.abs(yaw)) + MANUAL_SIZE.d / 2 * Math.cos(yaw)];
  const [hx, hz] = half(L.manual.yaw);
  const a = L.ashtray.at, m = L.manual.at, R = 0.056;
  assert.ok(m[2] - hz > a[2] + R || m[2] + hz < a[2] - R, 'manual and ashtray do not overlap');
  const unitHalf = (u.box.max[0] - u.box.min[0]) / 2;
  assert.ok(Math.abs(m[0]) + hx <= unitHalf + 0.002, 'within the unit\'s width');
  assert.ok(STATIONS.diskettes.items.includes('manual'));
  assert.equal(FOCUS.manual.label, 'Manual');
  const b = fallbackBoxes(g, wordproc1980).manual;
  assert.ok(b.min[1] >= u.box.max[1] - 1e-9 && b.max[1] > b.min[1], 'its fallback box sits on the unit');
});

test('the packet lies on the desk, clear of the units, the sticky notes and the desk file, framed with the manual', () => {
  const g = geometryFor(wordproc1980), L = wordproc1980.deskLayout, q = L.quickStart;
  const c = Math.cos(q.yaw), s = Math.abs(Math.sin(q.yaw));
  const hx = PACKET_SIZE.w / 2 * c + PACKET_SIZE.d / 2 * s, hz = PACKET_SIZE.w / 2 * s + PACKET_SIZE.d / 2 * c;
  const box = { min: [q.x - hx, 0, q.z - hz], max: [q.x + hx, 0.01, q.z + hz] };
  const overlap = (a, b) => a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2];
  assert.ok(box.min[0] >= -0.948 && box.max[0] <= 0.948 && box.min[2] >= -0.508 && box.max[2] <= 0.588, 'on the desk');
  for (const [n, u] of Object.entries(g.units)) if (!u.on) assert.ok(!overlap(box, u.box), `clear of ${n}`);
  // The notes as the kit lays them: three 3 in notes from right of the keyboard, in front of the diskette unit.
  const kb = g.units.keyboard.box, dk = g.units.diskette.box;
  const nx = Math.max(kb.max[0], dk.min[0]) + 0.055;
  assert.ok(box.min[0] > nx + 0.18 + 0.0381 * 1.5, 'right of the sticky notes');
  const f = L.disketteHolder;
  assert.ok(box.min[2] > f.z + 0.08 || box.max[0] < f.x - 0.08, 'in front of the desk file');
  assert.deepEqual(FOCUS.manual.boxes, ['manual', 'packet']);
  assert.ok(STATIONS.diskettes.items.includes('quickstart'));
  assert.ok(fallbackBoxes(g, wordproc1980).packet);
});
