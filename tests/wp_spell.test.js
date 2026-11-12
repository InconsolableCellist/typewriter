// Spelling (milestone M8, architecture 7.9): the word list and its lookup, hyphen points, the spelling marks, Check
// Document with the CHECK SPELLING OF WORD screen, dictionary hyphenation in pagination, LINE ADJ's "Hyphenate
// where?", the supplement tasks, and worked example E10 (SS 4, TB2 p.68 to 73).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { boot, run, row, expectRow, expectScreen, press, strokes } from '../src/wp/testkit.js';
import { ATTR } from '../src/wp/screen.js';
import { Volume, runSync } from '../src/wp/disk/fs.js';
import { C } from '../src/wp/textpack/editor/codes.js';
import { layoutPage } from '../src/wp/textpack/editor/layout.js';
import { DEFAULT_FORMAT } from '../src/wp/textpack/editor/format.js';
import { textUnits } from '../src/wp/textpack/samples.js';
import { Dictionary, decodeWordList, SUPPLEMENT_WORDS } from '../src/wp/textpack/spell/dictionary.js';
import { hyphenPoints, hyphenated } from '../src/wp/textpack/spell/hyphen.js';
import { nextWord, wordsOf } from '../src/wp/textpack/tasks/spell.js';
import { loadWordList } from '../src/kits/wp/wordlist.js';
import { gunzip } from '../src/machine/glyphs.js';

const ASSET = new URL('../public/assets/wordlist_en.gz.bin', import.meta.url);
const WORDS = new Uint8Array(zlib.gunzipSync(fs.readFileSync(ASSET)));
const dict = Dictionary.fromBytes(WORDS);
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/wp-screens/${name}.txt`, import.meta.url), 'utf8');
const E = (sys) => row(sys, 1).slice(52, 71).trim();
const status2 = (sys, a, b) => row(sys, 2).slice(a, b).trim();
const cursorChar = (sys) => row(sys, sys.screen.cursor.row)[sys.screen.cursor.col - 1];
const reversed = (sys, r, c, n) => Array.from({ length: n }, (_, k) => sys.screen.attrs[(r - 1) * 80 + c - 1 + k] & ATTR.REVERSE).every(Boolean);

/** A stored page as text, codes by name. */
function stored(sys, disk, name, k = 0) {
  const vol = runSync(new Volume(sys.volume(disk).image).mount());
  const { head } = runSync(vol.readHead(vol.find(name)));
  const { units, objects } = runSync(vol.readPage(head.pages[k].lsn));
  return Array.from(units, (u) => {
    if (u < 0x100) return String.fromCharCode(u);
    if (u & 0x8000) { const o = objects[u & 0x7fff]; return o.type === 'smark' ? (o.begin ? '[' : ']') : `<${o.type}>`; }
    return `<${Object.keys(C).find((k2) => C[k2] === u)}>`;
  }).join('');
}

// The training document Assets (TB2 p.68) is not available. Ours holds the words E10 acts on: two misspellings, a
// word and two abbreviations the dictionary does not know, and two words that cross the right margin with no break
// inside the zone when the document is paginated.
export const ASSETS = [
  'Inventory Costing\n\nA business may cost its inventory in more than one way. This exampel\nshows each of the three usual methods for a small firm.\n\n',
  '1.\tSpecific identification keeps the cost of each item, and a\n\tcontra account is not needed. The method is most practical\n\tfor items with a high unit price.\n',
  '\f2.\tFirst in, first out, or FIFO, is another method of costing\n\tinventory. It assumes that the first units purchased are the\n\tfirst units sold, that those still in inventory are the last\n\tones purchased.\n\n',
  '3.\tLast in, first out assumes the opposite -- that the last goods\n\tpurchased are the first ones sold. Our ABC shop uses it, as the\n\tABC books show.\n\n',
  "The auditors have looked at the books of this small firm and the company's way of costing its stock, which is the same for each of the bulk materials and of the finished goods, and approve it.\n",
].join('');

const spellBoot = (docs = { TRAIN: [{ name: 'Assets', text: ASSETS }] }, opts = {}) => boot({ docs, wordList: WORDS, ...opts });

// ---- the word list -----------------------------------------------------------------------------------------------

test('word list: the asset is public domain 12dicts, about 115 KB packed, unpacked once into a set', async () => {
  const packed = fs.statSync(ASSET).size;
  assert.ok(packed > 80_000 && packed < 150_000, `${packed} bytes`);
  assert.equal(String.fromCharCode(...WORDS.subarray(0, 8)), 'wordlist');
  const words = decodeWordList(WORDS);
  assert.ok(words.length > 70_000, `${words.length} words`);
  for (let k = 1; k < words.length; k++) assert.ok(words[k - 1] < words[k], 'sorted, no duplicates');
  // The kit's loader gunzips, and takes bytes that arrive already unpacked as they are.
  assert.deepEqual(await loadWordList(), WORDS);
  assert.equal(await gunzip(WORDS), WORDS);
});

test('lookup: case, possessives, abbreviations, the supplement', () => {
  for (const w of ['the', 'The', 'THE', 'materials', 'Monday', 'MONDAY', "company's", "companies'", "isn't", 'I', 'a', 'colour', 'color'])
    assert.ok(dict.has(w), w);
  for (const w of ['exampel', 'contra', 'FIFO', 'ABC', 'monday', 'i', 'tHe', 'materialz']) assert.ok(!dict.has(w), w);
  const d = Dictionary.fromBytes(WORDS);
  assert.equal(d.addSupplement(['FIFO', 'the', 'FIFO', 'Zyx']), 2);
  assert.ok(d.has('FIFO') && d.has('Zyx') && !d.has('LIFO'));
  assert.equal(d.addSupplement(Array.from({ length: 600 }, (_, k) => `q${k}`)), SUPPLEMENT_WORDS - 2, 'a supplement holds 500 words');
  d.clearSupplement();
  assert.ok(!d.has('FIFO'));
  // Dictionary sectors follow the alphabet.
  assert.equal(dict.blockOf('aardvark'), 0);
  assert.equal(dict.blockOf('zymurgy'), dict.blocks - 1);
  assert.ok(dict.blockOf('cost') < dict.blockOf('inventory') && dict.blockOf('inventory') < dict.blockOf('materials'));
});

test('hyphen points: syllables, two letters before a break and three after', () => {
  const want = {
    materials: 'ma-te-ri-als', "company's": "com-pa-ny's", inventory: 'in-ven-tory', purchased: 'pur-chased',
    example: 'ex-am-ple', practical: 'prac-ti-cal', costing: 'cost-ing', running: 'run-ning', statement: 'state-ment',
    children: 'chil-dren', number: 'num-ber', special: 'spe-cial', information: 'in-for-ma-tion', first: 'first', goods: 'goods',
  };
  for (const [w, h] of Object.entries(want)) assert.equal(hyphenated(w), h, w);
  for (const w of dict.words.slice(0, 20_000).filter((_, k) => k % 37 === 0)) {
    for (const p of hyphenPoints(w)) {
      assert.ok(p >= 2 && w.slice(p).replace(/[^a-z]/gi, '').length >= 3, `${w} at ${p}`);
      assert.ok(!w.slice(0, p).includes("'"), `${w}: not after the apostrophe`);
    }
  }
  assert.deepEqual(dict.hyphenate('exampel'), [], 'a word the dictionary does not know has no points');
});

// ---- words and marks -------------------------------------------------------------------------------------------------

test('words: syllable hyphens and underlines inside a word, digits, apostrophes, End and Begin Spelling Check', () => {
  const objs = [{ type: 'spell', begin: false }, { type: 'spell', begin: true }];
  const units = [...textUnits("ma"), C.SHY, ...textUnits("te"), C.CUND, ...textUnits("rials 3rd 'tis it's "), 0x8000, ...textUnits('qqq '), 0x8001, ...textUnits('zzz')];
  const ws = wordsOf(units, objs);
  assert.deepEqual(ws.map((w) => [w.text, w.check]), [['materials', true], ['tis', true], ["it's", true], ['qqq', false], ['zzz', true]]);
  assert.equal(nextWord(units, objs, 0).end, 11, 'the word ends after its last letter');
});

test('spelling marks: the word between them shows in reverse video and the marks are named', () => {
  const objs = [{ type: 'smark', begin: true }, { type: 'smark', begin: false }];
  const units = [...textUnits('one '), 0x8000, ...textUnits('twoo'), 0x8001, ...textUnits(' three'), C.PE];
  const fmt = DEFAULT_FORMAT;
  const L = layoutPage(units, objs, { fmt, doc: fmt, alt: fmt, first: true });
  const rev = Array.from(units, (_, i) => (L.attrs[i] & ATTR.REVERSE ? 1 : 0)).join('');
  assert.equal(rev, '00000111100000000');
  assert.equal(L.w[4], 0, 'a mark takes no column');
});

// ---- E10 ---------------------------------------------------------------------------------------------------------

test('E10: spelling check, hyphenate, paginate', () => {
  const { sys, devices } = spellBoot();
  run(sys, 'a ENTER b ENTER "Assets" ENTER "TRAIN" ENTER ENTER');
  assert.match(row(sys, 1), /Assets/);

  // 1. SPELL ends the document; TASK SELECTION with Spelling Tasks highlighted while the spelling program loads.
  const t0 = sys.now;
  const reads0 = devices.log.disk.length;
  press(sys, strokes('SPELL')[0]);
  sys.advance(sys.now + 0.5);
  expectRow(sys, 3, '                       TASK SELECTION');
  assert.ok(reversed(sys, 20, 19, 'Spelling Tasks'.length), 'Spelling Tasks highlighted while loading');
  sys.runUntilIdle();
  const load = sys.now - t0;
  assert.ok(load > 1.5 && load < 6, `the spelling segment's 200 sectors take ${load.toFixed(2)} s`);
  assert.ok(devices.log.disk.slice(reads0).some((d) => d.drive === 0), 'read from the program diskette');
  const tasks = fixture('spelling-tasks').split('\n');
  for (let r = 3; r <= 23; r++) expectRow(sys, r, tasks[r - 1]);
  assert.ok(reversed(sys, 8, 19, 'Check Document'.length), 'Check Document highlighted');
  // 2. The document's name is on the prompt line already.
  expectRow(sys, 24, 'Type document name; press ENTER. Assets');
  run(sys, 'ENTER');
  expectRow(sys, 24, 'Type diskette name; press ENTER. TRAIN');
  run(sys, 'ENTER');
  expectScreen(sys, fixture('check-document').replace(/^.*\n/, `${'~'.repeat(80)}\n`));
  // 3.
  run(sys, 'ENTER');
  expectScreen(sys, fixture('hyphenate-paginate').replace(/^.*\n/, `${'~'.repeat(80)}\n`));
  // 4. No printing; checking stops on "exampel", the word on the third text line.
  const t1 = sys.now;
  run(sys, 'd ENTER 2 ENTER ENTER');
  assert.ok(sys.now - t1 > 0.5, 'the page\'s dictionary sectors are read');
  expectScreen(sys, fixture('check-spelling-of-word'));
  expectRow(sys, 21, '   exampel');
  assert.equal(status2(sys, 35, 48), 'Pg. 1');
  assert.ok(reversed(sys, 6, row(sys, 6).indexOf('exampel') + 1, 7), 'the word is highlighted');
  assert.equal(E(sys), 'U.S. English');
  // 5. Retype: the word is replaced and checking goes on, to "contra".
  run(sys, '"example" ENTER');
  expectRow(sys, 21, '   contra');
  // 6. SPELL leaves "contra" highlighted; ENTER on FIFO and on ABC; the second ABC is not stopped on.
  run(sys, 'SPELL');
  expectRow(sys, 21, '   FIFO');
  assert.equal(status2(sys, 35, 48), 'Pg. 2');
  expectScreen(sys, fixture('check-spelling-of-word'));
  run(sys, 'ENTER');
  expectRow(sys, 21, '   ABC');
  // 7. Hyphenation: "company's" with the cursor at the suggested point; past the last letter keeps it whole.
  run(sys, 'ENTER');
  expectRow(sys, 24, 'Hyphenate where?');
  assert.equal(row(sys, 1).slice(0, 20).trim(), 'Paginating Document');
  let at = row(sys, sys.screen.cursor.row);
  assert.equal(at.slice(sys.screen.cursor.col - 6, sys.screen.cursor.col + 3), "company's", 'the cursor is in "company\'s"');
  assert.equal(cursorChar(sys), 'n', 'at com-pa-ny\'s');
  run(sys, '→ → → → ENTER');
  // "materials": ENTER hyphenates at the suggested point.
  expectRow(sys, 24, 'Hyphenate where?');
  at = row(sys, sys.screen.cursor.row);
  assert.match(at, /bulk materials/);
  assert.equal(cursorChar(sys), 'a');
  run(sys, 'ENTER');
  // 8. TASK SELECTION flashes and TYPING TASKS returns, Revise Document highlighted, the name on the prompt line.
  expectRow(sys, 4, '                       TYPING TASKS');
  assert.ok(reversed(sys, 9, 25, 'Revise Document'.length));
  expectRow(sys, 24, 'Type document name; press ENTER. Assets');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /\(Assets\) paginated/);
  run(sys, 'MSG');
  assert.match(row(sys, 25), /Spelling Check complete\. Words marked: 1/);
  const page = stored(sys, 'TRAIN', 'Assets');
  assert.match(page, /This example<CR>|This example<RCR>/, 'retyped');
  assert.match(page, /a<RCR><TAB>\[contra\] account/, 'contra between spelling marks');
  assert.match(page, /FIFO,/);
  assert.match(page, /and the company's <CR>way/, 'kept whole past the margin');
  assert.match(page, /bulk materi<SHY><CR>als/, 'hyphenated at the dictionary\'s point');
  // 9. Revise; FIND SPELL ENTER goes to the highlighted word; CANCL takes the highlighting off.
  run(sys, 'ENTER ENTER ENTER');
  run(sys, 'FIND SPELL ENTER');
  const r = sys.screen.cursor.row, c = sys.screen.cursor.col;
  assert.equal(row(sys, r).slice(c - 1, c + 5), 'contra');
  assert.ok(reversed(sys, r, c, 6));
  run(sys, 'CANCL');
  assert.ok(!reversed(sys, r, c, 1), 'highlighting removed');
  expectRow(sys, r, row(sys, r));
  assert.match(row(sys, 22), /bulk materi-/, 'the syllable hyphen shows where it ends a line');
  run(sys, 'END');
  assert.doesNotMatch(stored(sys, 'TRAIN', 'Assets'), /\[/);
});

// ---- other paths -------------------------------------------------------------------------------------------------

test('Automatic check marks every unknown word; None only paginates; pages chosen by number', () => {
  const { sys } = spellBoot();
  run(sys, 'd ENTER a ENTER "Assets" ENTER "TRAIN" ENTER a ENTER 2 ENTER c ENTER 2 ENTER ENTER');
  expectRow(sys, 4, '                       TYPING TASKS');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /Words marked: 5/);
  assert.match(stored(sys, 'TRAIN', 'Assets'), /This \[exampel\]/);
  assert.match(stored(sys, 'TRAIN', 'Assets', 1), /or \[FIFO\], is.*Our \[ABC\] shop.*\[ABC\] books/s);
  // Again, page 2 only: the marks on page 2 stay, page 1 is not looked at.
  run(sys, 'CANCL CANCL f ENTER d ENTER a ENTER ENTER ENTER a ENTER 2 ENTER b ENTER 2 ENTER c ENTER 2 ENTER ENTER');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /Words marked: 3/);
});

test('Prompted check: retyping a word into another unknown word stops on it again', () => {
  const { sys } = spellBoot({ TRAIN: [{ name: 'Short', text: 'A wrod or two.\n' }] });
  run(sys, 'd ENTER a ENTER "Short" ENTER "TRAIN" ENTER c ENTER 2 ENTER ENTER');
  expectRow(sys, 21, '   wrod');
  run(sys, '"wurd" ENTER');
  expectRow(sys, 21, '   wurd');
  run(sys, '"word" ENTER');
  expectRow(sys, 4, '                       TYPING TASKS');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /Words marked: 0/);
  assert.match(stored(sys, 'TRAIN', 'Short'), /^A word or two\./);
});

test('LINE ADJ: "Hyphenate where?" on the word\'s first character; hyphen, keep or move down', () => {
  const para = 'The quick brown fox jumps over the lazy dog and keeps on running extraordinarily far.\n';
  const setup = () => {
    const b = boot({ docs: { TRAIN: [{ name: 'Fox', text: para }] } });
    run(b.sys, 'a ENTER b ENTER "Fox" ENTER "TRAIN" ENTER ENTER');
    return b.sys;
  };
  // The document was adjusted when written: "extraordinarily" went down whole. Join the line and adjust it.
  let sys = setup();
  assert.match(row(sys, 5), /^ extraordinarily far\./);
  run(sys, 'LINE ADJ');
  expectRow(sys, 24, 'Hyphenate where?');
  assert.equal(cursorChar(sys), 'e', 'on the first character: the typing program has no dictionary');
  const r0 = sys.screen.cursor.row;
  run(sys, '→ → → → → → ENTER');
  assert.match(row(sys, r0).trimEnd(), /running extrao-$/);
  assert.match(row(sys, r0 + 1), /^ rdinarily far\./);
  expectRow(sys, 24, '');
  run(sys, 'END');
  assert.match(stored(sys, 'TRAIN', 'Fox'), /running extrao<SHY><CR>rdinarily far\./);

  sys = setup();
  run(sys, 'LINE ADJ ENTER');
  assert.match(row(sys, 5), /^ extraordinarily far\./, 'ENTER on the first character moves the word down');
  expectRow(sys, 24, '');

  sys = setup();
  run(sys, `LINE ADJ ${'→ '.repeat(15)}ENTER`);
  assert.match(row(sys, 5), /^ far\./);
  run(sys, 'END');
  assert.match(stored(sys, 'TRAIN', 'Fox'), /running extraordinarily <CR>far\./, 'past the last character keeps it on the line');

  sys = setup();
  run(sys, `LINE ADJ ${'→ '.repeat(14)}ENTER`);
  expectRow(sys, 24, 'Hyphenate where?', 'a hyphen past the margin is refused');
});

test('dictionary hyphenation, automatic: at the last point that fits; none for a word it does not know', () => {
  const text = 'The quick brown fox jumps over the lazy dog and keeps on running information on the way.\n\n'
    + 'The quick brown fox jumps over the lazy dog and keeps on running zyxqwvzyxqwv on the way.\n';
  const { sys } = spellBoot({ TRAIN: [{ name: 'Fox', text }] });
  run(sys, 'd ENTER a ENTER "Fox" ENTER "TRAIN" ENTER a ENTER 3 ENTER ENTER a ENTER 2 ENTER d ENTER 2 ENTER ENTER');
  expectRow(sys, 4, '                       TYPING TASKS');
  assert.match(stored(sys, 'TRAIN', 'Fox'), /running informa<SHY><CR>tion on.*running <CR>zyxqwvzyxqwv on/s);
});

test('supplement: load from a document, check with it, store on the program diskette, clear, write it out', () => {
  const words = 'FIFO LIFO\nABC\n';
  const { sys } = spellBoot({ TRAIN: [{ name: 'Assets', text: ASSETS }, { name: 'Words', text: words }] });
  run(sys, 'd ENTER b ENTER "Words" ENTER "TRAIN" ENTER');
  run(sys, 'MSG');
  assert.match(row(sys, 25), /Supplement loaded\. 3 words now in supplement\./);
  run(sys, 'a ENTER "Assets" ENTER "TRAIN" ENTER a ENTER 2 ENTER c ENTER 2 ENTER ENTER MSG');
  assert.match(row(sys, 25), /Words marked: 2/, 'only exampel and contra');
  run(sys, 'CANCL CANCL f ENTER d ENTER d ENTER MSG');
  assert.match(row(sys, 25), /Supplement stored\./);
  const prog = sys.programVolume();
  assert.ok(prog.find('supplement'));
  run(sys, 'c ENTER MSG');
  assert.match(row(sys, 25), /Supplement Cleared\./);
  assert.equal(sys.dictionary.supplement.length, 0);
  // A new session finds the stored supplement when Spelling Tasks loads.
  sys.dictionary = null; sys.wordListState = null; sys.program.segment = null;
  run(sys, 'g ENTER d ENTER');
  assert.deepEqual(sys.dictionary.supplement, ['FIFO', 'LIFO', 'ABC']);
  run(sys, 'f ENTER "Supp" ENTER "TRAIN" ENTER');
  expectRow(sys, 24, 'Press ENTER to continue or press CANCL.');
  run(sys, 'ENTER MSG');
  assert.match(row(sys, 25), /Supplement words written to \(Supp\)/);
  assert.equal(stored(sys, 'TRAIN', 'Supp'), 'FIFO<RCR>LIFO<RCR>ABC<RCR><PE>');
});

test('the word list is fetched when Spelling Tasks first loads, behind the program-load wait', () => {
  let asked = 0;
  const { sys } = boot({ wordList: () => { asked++; } });
  assert.equal(asked, 0);
  run(sys, 'd ENTER');
  assert.equal(asked, 1);
  expectRow(sys, 3, '                       TASK SELECTION', 'still loading: the list has not come');
  sys.provideWordList(WORDS);
  sys.runUntilIdle();
  expectRow(sys, 4, '                         SPELLING TASKS');
  run(sys, 'g ENTER d ENTER');
  assert.equal(asked, 1, 'once');
  // A list that cannot be had: Spelling Tasks comes up, and Check Document says so.
  const b = boot({ wordList: () => {} });
  run(b.sys, 'd ENTER');
  b.sys.provideWordList(null);
  b.sys.runUntilIdle();
  run(b.sys, 'a ENTER');
  assert.match(row(b.sys, 25), /Spelling dictionary not available\./);
});

test('Menu Bypass: chkdoc goes to Check Document from the typing area', () => {
  const { sys } = spellBoot();
  run(sys, 'a ENTER b ENTER "Assets" ENTER "TRAIN" ENTER ENTER');
  run(sys, 'MENU BYPASS "chkdoc Assets" ENTER');
  expectRow(sys, 4, '                          CHECK DOCUMENT');
});
