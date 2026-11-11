// The CRT font against the documented cell metrics (docs/displaywriter/hardware.md 1.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONT8X16, SYMBOLS } from '../src/wp/font/font8x16.js';

const rows = (ch, font = 1) => { const g = (font - 1) * 256 + (typeof ch === 'number' ? ch : ch.charCodeAt(0)); return [...FONT8X16.subarray(g * 16, g * 16 + 16)]; };
const litRows = (ch, font) => rows(ch, font).map((b, r) => (b ? r : -1)).filter((r) => r >= 0);
const width = (ch) => { const or = rows(ch).reduce((a, b) => a | b, 0); let n = 0; for (let c = 0; c < 8; c++) if (or & (0x80 >> c)) n++; return n; };

test('capitals and digits stand on rows 3 to B, nine rows high', () => {
  for (const ch of 'ABCDEFHIKLMNOPRSTUVWXYZ0123456789') assert.deepEqual([Math.min(...litRows(ch)), Math.max(...litRows(ch))], [3, 11], ch);
});

test('lower case has a six-row x-height on the capitals\' baseline; ascenders reach the capital height', () => {
  for (const ch of 'acemnorsuvwxz') assert.deepEqual([Math.min(...litRows(ch)), Math.max(...litRows(ch))], [6, 11], ch);
  for (const ch of 'bdhkl') assert.deepEqual([Math.min(...litRows(ch)), Math.max(...litRows(ch))], [3, 11], ch);
});

test('descenders drop below the baseline, no lower than row D', () => {
  for (const ch of 'gjpqy') { const r = litRows(ch); assert.ok(Math.max(...r) > 11 && Math.max(...r) <= 13, ch); }
});

test('underscore is row D; row E (the cursor) and row F stay dark in every text glyph', () => {
  assert.deepEqual(litRows('_'), [13]);
  for (let c = 32; c < 256; c++) { const r = rows(c); assert.equal(r[14], 0, `0x${c.toString(16)} row E`); assert.equal(r[15], 0, `0x${c.toString(16)} row F`); }
});

test('glyph widths are within the documented 3 to 7 dots, and every printable ASCII character is drawn', () => {
  for (let c = 33; c < 127; c++) { const ch = String.fromCharCode(c); assert.ok(litRows(ch).length > 0, ch); assert.ok(width(ch) <= 7, `${ch} is ${width(ch)} wide`); }
  assert.ok(width('i') <= 3 && width('l') <= 3);
});

test('font 2 holds the code symbols, scale marks and start-up blocks by name', () => {
  for (const name of ['carrierReturn', 'tab', 'reqSpace', 'pageEnd', 'reqPageEnd', 'formatChange', 'leftMargin', 'rightMargin', 'statusBar', 'fullBlock', 'stripes']) {
    assert.ok(SYMBOLS[name] > 0, name);
    assert.ok(litRows(SYMBOLS[name], 2).length > 0, name);
  }
});
