// Finished pages: snapshot, composition, archive and the PDF writer.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { SoftWorld } from '../src/soft/index.js';
import { captureSheet, composePage, INK_RGB, RED_RGB } from '../src/pages/capture.js';
import { PageArchive } from '../src/pages/archive.js';
import { buildPdf } from '../src/pages/pdf.js';

function sheet(width = 8, height = 12, ds = 4) {
  const mw = Math.ceil(width / ds), mh = Math.ceil(height / ds);
  return {
    ink: { data: new Uint8Array(width * height * 2), width, height, dirty: [] },
    mask: { data: new Uint8Array(mw * mh), width: mw, height: mh, downsample: ds, dirty: [] },
  };
}

const px = (page, x, y) => [...page.rgba.subarray((x + y * page.width) * 4, (x + y * page.width) * 4 + 4)];
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

test('a blank or emboss-only sheet gives no snapshot', () => {
  const { ink, mask } = sheet();
  assert.equal(captureSheet(ink, mask), null);
  for (let i = 1; i < ink.data.length; i += 2) ink.data[i] = 200;   // G: a blind impression, no ink
  assert.equal(captureSheet(ink, mask), null);
  ink.data[10] = 6;                                                 // below the visible threshold
  assert.equal(captureSheet(ink, mask), null);
});

test('the snapshot is an owned crop of the inked rows', () => {
  const { ink, mask } = sheet(8, 12);
  ink.data[(2 + 3 * 8) * 2] = 255;
  ink.data[(5 + 7 * 8) * 2] = 255;
  mask.data[1 + 1 * mask.width] = 255;
  const s = captureSheet(ink, mask);
  assert.ok(s.rowStart <= 3 && s.rowStart >= 2, `first row ${s.rowStart}`);
  assert.ok(s.rowStart + s.rowCount - 1 >= 7);
  assert.equal(s.ink.length, s.rowCount * 16);
  assert.notEqual(s.ink.buffer, ink.data.buffer);
  assert.equal(s.ink[(3 - s.rowStart) * 16 + 4], 255);
  ink.data.fill(0);
  assert.equal(s.ink[(3 - s.rowStart) * 16 + 4], 255, 'the copy survives the sheet being cleared');
});

test('composition keeps the page the right way up and colours the red band', () => {
  const { ink, mask } = sheet(8, 12);
  ink.data[(1 + 2 * 8) * 2] = 255;      // top left, black
  ink.data[(6 + 9 * 8) * 2] = 255;      // lower right, red
  mask.data[1 + 2 * mask.width] = 255;  // the 4 x 4 cell holding (6, 9)
  const page = composePage(captureSheet(ink, mask));
  assert.equal(page.rgba.length, 8 * 12 * 4);
  assert.deepEqual(px(page, 1, 2), [...INK_RGB, 255]);
  assert.deepEqual(px(page, 6, 9), [...RED_RGB, 255]);
  assert.deepEqual(px(page, 0, 0), [255, 255, 255, 255]);
  assert.deepEqual(px(page, 7, 11), [255, 255, 255, 255]);
  assert.deepEqual(px(page, 6, 2), [255, 255, 255, 255], 'not mirrored');
});

test('SoftWorld hands over the ink before clearing, and never for a blank sheet', async () => {
  const geometry = deriveGeometry(machine);
  const world = new SoftWorld({ machine, geometry, glyphs: await loadGlyphs() });
  const got = [];
  world.onSheetRetired = (s) => got.push({ s, inkAfter: world.inkTexture.data[(100 + 200 * world.inkTexture.width) * 2] });
  world.spawnSheet({ onTable: { offset: 0.005 } });
  assert.equal(got.length, 0, 'blank sheet');
  world.inkTexture.data[(100 + 200 * world.inkTexture.width) * 2] = 240;
  world.resetPaper();
  assert.equal(got.length, 1);
  assert.equal(got[0].inkAfter, 240, 'the hook runs before the clear');
  assert.equal(world.inkTexture.data[(100 + 200 * world.inkTexture.width) * 2], 0, 'cleared afterward');
  assert.equal(got[0].s.ink[(200 - got[0].s.rowStart) * got[0].s.width * 2 + 200], 240);
  world.resetPaper();
  assert.equal(got.length, 1, 'the cleared sheet is blank');
});

test('the archive keeps pages in retirement order whatever order they finish', async () => {
  const resolvers = [];
  const archive = new PageArchive({ encode: () => new Promise((res) => resolvers.push(res)) });
  const added = [];
  archive.onPage = (p, i) => added.push([p.name, i]);
  const a = archive.retire({}), b = archive.retire({}), c = archive.retire({});
  assert.equal(archive.pending, 3);
  resolvers[2]({ name: 'third' });
  resolvers[0]({ name: 'first' });
  resolvers[1]({ name: 'second' });
  await Promise.all([a, b, c]);
  assert.deepEqual(archive.pages.map((p) => p.name), ['first', 'second', 'third']);
  assert.equal(archive.pending, 0);
  assert.equal(added.length, 3);
});

test('a page that fails to encode is dropped and the next still archives', async () => {
  let n = 0;
  const archive = new PageArchive({ encode: async () => { if (n++ === 0) throw new Error('nope'); return { name: 'ok' }; } });
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(await archive.retire({}), null);
    assert.equal((await archive.retire({})).name, 'ok');
  } finally { console.warn = warn; }
  assert.equal(archive.pages.length, 1);
});

// JPEG-looking bytes, including every value that could upset a text-based writer: newlines, %, CR, high bytes.
function fakeJpeg(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = i & 255;
  b[0] = 0xff; b[1] = 0xd8; b[n - 2] = 0xff; b[n - 1] = 0xd9;
  return b;
}

function checkPdf(bytes, expectPages) {
  const s = latin1(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.endsWith('%%EOF\n'));
  const start = Number(s.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  assert.equal(s.slice(start, start + 5), 'xref\n', 'startxref points at the table');
  const head = s.slice(start).match(/^xref\n0 (\d+)\n/);
  const size = Number(head[1]);
  assert.equal(size, 2 + expectPages * 3 + 1);
  const entries = s.slice(start + head[0].length);
  assert.equal(entries.slice(0, 20), '0000000000 65535 f \n');
  for (let n = 1; n < size; n++) {
    const e = entries.slice(n * 20, (n + 1) * 20);
    assert.match(e, /^\d{10} 00000 n \n$/, `entry ${n} is exactly 20 bytes`);
    const off = Number(e.slice(0, 10));
    assert.ok(s.startsWith(`${n} 0 obj\n`, off), `object ${n} is at its offset`);
  }
  assert.match(s, new RegExp(`/Size ${size} /Root 1 0 R`));
  return s;
}

test('PDF: one page, valid xref, binary image data intact', () => {
  const jpeg = fakeJpeg(1000);
  const bytes = buildPdf([{ jpeg, width: 3023, height: 3912 }]);
  const s = checkPdf(bytes, 1);
  assert.match(s, /\/Count 1 /);
  assert.match(s, /\/MediaBox \[0 0 612 792\]/);
  assert.match(s, /\/Width 3023 \/Height 3912/);
  assert.match(s, /\/Filter \/DCTDecode \/Length 1000 >>\nstream\n/);
  const at = s.indexOf('/Length 1000 >>\nstream\n') + '/Length 1000 >>\nstream\n'.length;
  assert.deepEqual(bytes.subarray(at, at + 1000), jpeg);
  assert.equal(s.slice(at + 1000, at + 1000 + 10), '\nendstream');
});

test('PDF: several pages keep their order and each has its own image', () => {
  const pages = [10, 20, 30].map((n) => ({ jpeg: fakeJpeg(200 + n), width: 100, height: 130 }));
  const s = checkPdf(buildPdf(pages), 3);
  assert.match(s, /\/Count 3 /);
  assert.equal(s.match(/\/Type \/Page /g).length, 3);
  assert.equal(s.match(/\/Subtype \/Image/g).length, 3);
  assert.match(s, /\/Kids \[3 0 R 6 0 R 9 0 R\]/);
  const lengths = [...s.matchAll(/\/DCTDecode \/Length (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(lengths, [210, 220, 230]);
});

test('PDF: rejects nothing to write and bytes that are not a JPEG', () => {
  assert.throws(() => buildPdf([]));
  assert.throws(() => buildPdf([{ jpeg: new Uint8Array(8), width: 1, height: 1 }]));
});
