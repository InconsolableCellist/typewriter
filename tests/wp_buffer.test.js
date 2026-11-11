// The page buffer and the line layout (architecture 7.3): a gap buffer of code units; one layout for screen, adjust
// and pagination: tabs by kind, indent, centring, zero-width codes, underlining, half index, line counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GapBuffer } from '../src/wp/textpack/editor/buffer.js';
import { C, OBJ } from '../src/wp/textpack/editor/codes.js';
import { layoutPage, reflowParagraph, walkLine } from '../src/wp/textpack/editor/layout.js';
import { DEFAULT_FORMAT, copyFormat, applyChange } from '../src/wp/textpack/editor/format.js';
import { textUnits, adjustAll } from '../src/wp/textpack/samples.js';
import { compact, pageNumberAfter } from '../src/wp/textpack/editor/doc.js';
import { ATTR } from '../src/wp/screen.js';

const u = (s) => textUnits(s);
const ctx = (f = DEFAULT_FORMAT, displayCodes = false) => ({ fmt: f, doc: f, alt: f, first: true, displayCodes });
const posOf = (L, units, ch) => L.pos[units.indexOf(ch.charCodeAt(0))];

test('gap buffer: insert, delete, set and slice anywhere, growing as needed', () => {
  const b = new GapBuffer(u('hello'), 4);
  b.insert(5, u(' world'));
  b.insert(0, u('>'));
  assert.equal(String.fromCharCode(...b.toArray()), '>hello world');
  assert.deepEqual(Array.from(b.delete(1, 6)), u('hello '));
  b.set(0, 'W'.charCodeAt(0));
  assert.equal(String.fromCharCode(...b.toArray()), 'Wworld');
  for (let i = 0; i < 500; i++) b.insert(b.length >> 1, [0x41 + (i % 26)]);
  assert.equal(b.length, 506);
  assert.equal(b.at(0), 'W'.charCodeAt(0));
  assert.equal(b.at(505), 'd'.charCodeAt(0));
  assert.equal(String.fromCharCode(...b.slice(1, 3)).length, 2);
});

test('layout: tab stops by kind (left, right, centre, decimal)', () => {
  const f = copyFormat(DEFAULT_FORMAT);
  f.tabs = [{ pos: 30, kind: 'left' }, { pos: 50, kind: 'right' }, { pos: 60, kind: 'centre' }, { pos: 75, kind: 'decimal' }];
  const units = [...u('\tab\tcd\tefg\t12.5'), C.PE];
  const L = layoutPage(units, [], ctx(f));
  assert.equal(posOf(L, units, 'a'), 30);
  assert.equal(posOf(L, units, 'd'), 50, 'right tab: the text ends at the stop');
  assert.equal(posOf(L, units, 'f'), 60, 'centre tab: centred on the stop');
  assert.equal(L.pos[units.indexOf(0x2e)], 75, 'decimal tab: the point at the stop');
});

test('layout: required tab indents the following lines; RET ends it', () => {
  const units = [...u('\u0000'), C.PE];
  units.splice(0, 1, C.RTAB, ...u('indented'), C.CR, ...u('wrapped'), C.RCR, ...u('back'));
  const L = layoutPage(units, [], ctx());
  assert.equal(L.lines[0].P[1], 23);
  assert.equal(L.lines[1].P[0], 23, 'a wrapped line starts at the indent');
  assert.equal(L.lines[2].P[0], 18, 'after a required return, the left margin');
});

test('layout: centring on the point a CTR code stands at', () => {
  const units = [...u('\t\t\t\t\t\t\t'), C.CTR, ...u('TITLE'), C.RCR, C.PE];
  const L = layoutPage(units, [], ctx());
  const t = units.indexOf('T'.charCodeAt(0));
  assert.equal(L.pos[t], 53 - 2, 'TITLE centred on position 53');
});

test('layout: zero-width codes take a column only with Display Codes; required backspace overstrikes', () => {
  const units = [...u('ab'), C.WUND, ...u('c'), C.RBS, ...u('_'), C.PE];
  const off = layoutPage(units, [], ctx());
  assert.equal(off.pos[3], 20);
  assert.equal(off.pos[5], 20, 'the character after a required backspace stands on the one before');
  const on = layoutPage(units, [], ctx(DEFAULT_FORMAT, true));
  assert.equal(on.pos[3], 21);
  assert.equal(on.attrs[0] & ATTR.UNDER, ATTR.UNDER, 'word underline marks back to the space');
});

test('layout: begin/end underline, character underline, half index', () => {
  const units = [...u('a '), C.BUND, ...u('b c'), C.EUND, ...u(' d'), C.CUND, ...u(' '), C.HUP, ...u('2'), C.HDN, ...u('e'), C.PE];
  const L = layoutPage(units, [], ctx());
  const at = (ch) => L.attrs[units.indexOf(ch.charCodeAt(0))];
  assert.equal(at('a') & ATTR.UNDER, 0);
  assert.ok(at('b') & ATTR.UNDER && at('c') & ATTR.UNDER);
  assert.ok(at('d') & ATTR.UNDER, 'character underline');
  assert.ok(at('2') & ATTR.HALF_UP);
  assert.equal(at('e') & (ATTR.HALF_UP | ATTR.HALF_DOWN), 0);
});

test('layout: the line count follows the spacing; a format change applies from its line', () => {
  const objects = [{ type: 'fmt', kind: 'set', values: { spacing: 2 } }];
  const units = [...u('one\ntwo\n'), OBJ | 0, ...u('three\nfour\n'), C.PE];
  const L = layoutPage(units, objects, ctx());
  assert.deepEqual(L.lines.map((l) => l.ln), [7, 8, 9, 11, 13]);
});

test('adjust: wrap at the margin after the blanks; taking the returns out gives back what was typed', () => {
  const typed = 'The quick brown fox jumps over the lazy dog and keeps running across the field until it reaches the far side of the hill.';
  const units = adjustAll([...u(typed), C.PE], [], ctx());
  const L = layoutPage(units, [], ctx());
  assert.ok(L.lines.length >= 2);
  for (const line of L.lines) {
    for (let j = line.start; j < line.end; j++) if (units[j] !== 0x20 && units[j] < 0x100) assert.ok(L.pos[j] <= 90);
  }
  const cr = units.indexOf(C.CR);
  assert.equal(units[cr - 1], 0x20, 'the blank stays on the line before the return');
  assert.equal(String.fromCharCode(...units.filter((x) => x < 0x100)), typed);
  const again = reflowParagraph(units, [], 0, ctx());
  assert.equal(again.changed, false, 'adjusting an adjusted paragraph changes nothing');
});

test('adjust: a required space holds two words together; a word longer than the line is broken', () => {
  const filler = 'x'.repeat(70);
  const units = adjustAll([...u(`${filler} ab`), C.RSP, ...u('cd'), C.PE], [], ctx());
  const L = layoutPage(units, [], ctx());
  assert.equal(L.lines[1].start, units.indexOf('a'.charCodeAt(0)), '"ab cd" moved down together');
  const long = adjustAll([...u('y'.repeat(100)), C.PE], [], ctx());
  assert.equal(long.indexOf(C.CR), 73, 'broken at the margin');
});

test('adjust maps unit indices across the returns it moves', () => {
  const units = [...u('aaa bbb'), C.CR, ...u('ccc'), C.PE];
  const r = reflowParagraph(units, [], 0, ctx());
  assert.equal(String.fromCharCode(...r.units.filter((x) => x < 0x100)), 'aaa bbbccc');
  assert.equal(r.map(8), 7, 'a unit after the removed return moves back by one');
  assert.equal(r.map(7), 7, 'the removed return maps to what followed it');
});

test('format changes: return codes and the two stored formats', () => {
  const doc = copyFormat(DEFAULT_FORMAT), alt = { ...copyFormat(DEFAULT_FORMAT), lm: 10 };
  let f = applyChange(doc, { type: 'fmt', kind: 'set', values: { lm: 25, rm: 70 } }, doc, alt);
  assert.equal(f.lm, 25);
  f = applyChange(f, { type: 'fmt', kind: 'retLine' }, doc, alt);
  assert.equal(f.lm, 18);
  f = applyChange(f, { type: 'fmt', kind: 'altFmt' }, doc, alt);
  assert.equal(f.lm, 10);
  const st = { fmt: doc, indent: null, doc, alt };
  walkLine([OBJ | 0, 0x41, C.RCR], [{ type: 'fmt', kind: 'set', values: { lm: 30 } }], 0, st);
  assert.equal(st.fmt.lm, 30);
});

test('pages: objects compacted on store; system page numbers for inserted pages', () => {
  const r = compact([0x41, OBJ | 2, 0x42, OBJ | 2, OBJ | 0], [{ a: 0 }, { a: 1 }, { a: 2 }]);
  assert.deepEqual(Array.from(r.units), [0x41, OBJ | 0, 0x42, OBJ | 0, OBJ | 1]);
  assert.deepEqual(r.objects, [{ a: 2 }, { a: 0 }]);
  assert.equal(pageNumberAfter([{ n: '1' }], 0), '2');
  assert.equal(pageNumberAfter([{ n: '1' }, { n: '2' }], 0), '1.1');
  assert.equal(pageNumberAfter([{ n: '1.1' }, { n: '2' }], 0), '1.1.1');
});
