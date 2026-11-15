// The T.4 / T.6 codec (docs/fax/plan.md 7.3 items 1 to 4, milestone M1): code tables, golden vectors from libtiff
// both ways, round trips of random and adversarial pages, framing (EOL, tag bits, fill to the minimum scan line
// time, RTC), and the receiver's handling of damaged lines. Fixtures: tests/fixtures/fax/t4, made by
// tools/fax/make_vectors.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  WHITE_TERM, BLACK_TERM, WHITE_MAKEUP, BLACK_MAKEUP, EXT_MAKEUP, EOL, MODE, msltBits,
} from '../src/fax/t4/tables.js';
import { BitWriter, BitReader } from '../src/fax/t4/bits.js';
import { strideOf, rowToChanges, changesToRow } from '../src/fax/t4/lines.js';
import { T4Encoder } from '../src/fax/t4/encode.js';
import { T4Decoder } from '../src/fax/t4/decode.js';
import { wrapTiff } from '../src/fax/t4/tiff.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const FIX = join(HERE, 'fixtures', 'fax', 't4');
const MANIFEST = JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const eqBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// --- helpers ---------------------------------------------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function setPel(bm, stride, x, y) {
  bm[y * stride + (x >>> 3)] |= 0x80 >>> (x & 7);
}

/** A random page of geometric runs, with means varying by line, plus vertical structure so READ has work. */
function randomPage(width, height, seed) {
  const r = rng(seed);
  const stride = strideOf(width);
  const bm = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    if (y > 0 && r() < 0.4) {
      // the line above with a few pels changed
      bm.copyWithin(y * stride, (y - 1) * stride, y * stride);
      for (let i = 0, n = Math.floor(r() * 6); i < n; i++) {
        const x = Math.floor(r() * width);
        bm[y * stride + (x >>> 3)] ^= 0x80 >>> (x & 7);
      }
      continue;
    }
    const mean = [1.5, 6, 40, 400][Math.floor(r() * 4)];
    let x = 0;
    let c = r() < 0.3;
    while (x < width) {
      const n = 1 + Math.floor(-Math.log(1 - r()) * mean);
      if (c) for (let i = x; i < Math.min(width, x + n); i++) setPel(bm, stride, i, y);
      x += n;
      c = !c;
    }
  }
  return bm;
}

/** Lines that stress the coders: the plan's adversarial set (7.3 item 3). */
function adversarialPage(width) {
  const stride = strideOf(width);
  const rows = [];
  const row = () => new Uint8Array(stride);
  const runRow = (...runs) => {
    // alternating runs starting white
    const b = row();
    let x = 0;
    let c = 0;
    for (const n of runs) {
      if (c) for (let i = x; i < Math.min(width, x + n); i++) setPel(b, 0, i, 0);
      x += n;
      c ^= 1;
    }
    if (c) for (let i = x; i < width; i++) setPel(b, 0, i, 0);
    return b;
  };
  rows.push(row()); // all white
  rows.push(runRow(0)); // all black
  const alt = row();
  for (let x = 0; x < width; x += 2) setPel(alt, 0, x + 1, 0);
  rows.push(alt, alt.map((v) => ~v & 0xff)); // alternating single pels, both phases
  if (width % 8) rows[rows.length - 1][stride - 1] &= (0xff << (8 - (width % 8))) & 0xff;
  for (const n of [1, 2, 3, 4, 63, 64, 65, 127, 128, 1727, 1728, 1729, 2559, 2560, 2561]) {
    if (n >= width) continue;
    rows.push(runRow(n), runRow(0, n), runRow(n, n), runRow(width - n));
  }
  rows.push(runRow(0, 1), runRow(width - 1), runRow(width - 1, 1)); // single pels at the edges
  // a one-pel change between lines at every offset class, for every vertical mode
  const base = runRow(100, 50, 300, 7, 200);
  for (const d of [-3, -2, -1, 0, 1, 2, 3, 4, -4, 5]) {
    rows.push(base, runRow(100 + d, 50 - d, 300, 7, 200));
  }
  for (let x = 1; x < Math.min(width, 64); x++) rows.push(runRow(x, 1), runRow(x + 1, 1));
  const bm = new Uint8Array(stride * rows.length);
  rows.forEach((b, y) => bm.set(b, y * stride));
  return { bm, height: rows.length };
}

/** Positions (bit index just after) of every EOL in a coded stream, with their fill (zeros before the 1). */
function eolPositions(data, order) {
  const r = new BitReader(data, { order });
  const out = [];
  let z = 0;
  while (r.pos < r.bitEnd) {
    if (r.bit() === 0) z++;
    else {
      if (z >= 11) out.push({ end: r.pos, zeros: z });
      z = 0;
    }
  }
  return out;
}

function rowsDiffering(a, b, stride, height) {
  const out = [];
  for (let y = 0; y < height; y++) {
    if (!eqBytes(a.subarray(y * stride, (y + 1) * stride), b.subarray(y * stride, (y + 1) * stride))) out.push(y);
  }
  return out;
}

const libtiffOptions = (v) => ({
  width: v.width, coding: v.coding, k: v.k ?? 2, alignEol: v.alignEol, bitOrder: v.bitOrder,
  leadingEol: true, rtc: v.coding === 'mmr', minLineBits: 0,
});

const decodedBitmaps = new Map(); // page -> bitmap, from our decoder (checked against the fixture hashes)

// --- 1. code tables -------------------------------------------------------------------------------------------

test('tables: sizes, and each colour\'s codes (with EOL) are prefix-free and complete enough to decode', () => {
  assert.equal(WHITE_TERM.length, 64);
  assert.equal(BLACK_TERM.length, 64);
  assert.equal(WHITE_MAKEUP.length, 27);
  assert.equal(BLACK_MAKEUP.length, 27);
  assert.equal(EXT_MAKEUP.length, 13);
  for (const [name, set] of [['white', [...WHITE_TERM, ...WHITE_MAKEUP, ...EXT_MAKEUP, EOL]],
    ['black', [...BLACK_TERM, ...BLACK_MAKEUP, ...EXT_MAKEUP, EOL]],
    ['mode', [MODE.PASS, MODE.HORIZ, ...MODE.V, MODE.EXT]]]) {
    for (const a of set) {
      assert.match(a, /^[01]+$/);
      for (const b of set) if (a !== b) assert.ok(!b.startsWith(a), `${name}: ${a} is a prefix of ${b}`);
    }
    assert.equal(new Set(set).size, set.length, `${name}: duplicate code`);
  }
  // Kraft sums: the terminating + make-up sets are complete codes once EOL's zero prefix is accounted for
  const kraft = (set) => set.reduce((s, c) => s + 2 ** -c.length, 0);
  assert.ok(kraft([...WHITE_TERM, ...WHITE_MAKEUP, ...EXT_MAKEUP]) <= 1);
  assert.ok(kraft([...BLACK_TERM, ...BLACK_MAKEUP, ...EXT_MAKEUP]) <= 1);
  assert.equal(kraft([MODE.PASS, MODE.HORIZ, ...MODE.V, MODE.EXT]), 1 - 2 ** -7);
  assert.equal(EOL, '000000000001');
  assert.equal(msltBits(20, 9600), 192);
  assert.equal(msltBits(10, 4800), 48);
});

test('tables: hand-checked bit patterns of a few lines', () => {
  const bits = (u8, n) => [...u8].map((b) => b.toString(2).padStart(8, '0')).join('').slice(0, n);
  const white = new Uint8Array(216);
  // EOL, white 1728 = make-up 1728 + terminating 0
  let s = new T4Encoder({ bitOrder: 'msb', rtc: false }).encodePage(white, 1);
  assert.equal(bits(s, 12 + 9 + 8), '000000000001' + '010011011' + '00110101');
  // one black pel at 0: white 0, black 1, white 1727 (= 1664 + 63)
  const one = new Uint8Array(216);
  one[0] = 0x80;
  s = new T4Encoder({ bitOrder: 'msb', rtc: false }).encodePage(one, 1);
  assert.equal(bits(s, 12 + 8 + 3 + 6 + 8), EOL + '00110101' + '010' + '011000' + '00110100');
  // MR: EOL + tag 1, then the same line 2-D against itself is V0 V0 (1 1); RTC is six EOL+1
  s = new T4Encoder({ bitOrder: 'msb', coding: 'mr', k: 2 }).encodePage(new Uint8Array([...one, ...one]), 2);
  const sb = bits(s, s.length * 8);
  assert.ok(sb.startsWith(EOL + '1' + '00110101' + '010' + '011000' + '00110100' + EOL + '0' + '11'));
  assert.ok(sb.replace(/0+$/, '').endsWith((EOL + '1').repeat(6)));
  // LSB first on the line: the first bit of the stream is bit 0 of the first byte
  s = new T4Encoder({ bitOrder: 'lsb', rtc: false }).encodePage(white, 1);
  assert.deepEqual([...s.subarray(0, 2)], [0x00, 0x28]); // 00000000 0001|0100, each byte reversed
});

// --- bit writer / reader --------------------------------------------------------------------------------------

test('bits: writer and reader agree in both orders, and the orders are byte-reversed images', () => {
  const r = rng(7);
  const items = Array.from({ length: 5000 }, () => {
    const len = 1 + Math.floor(r() * 24);
    return [Math.floor(r() * 2 ** len), len];
  });
  const outs = {};
  for (const order of ['lsb', 'msb']) {
    const w = new BitWriter({ order, capacity: 16 });
    for (const [c, n] of items) w.put(c, n);
    w.zeros(37);
    const total = w.bitLength;
    const out = w.finish();
    outs[order] = out;
    assert.equal(out.length, Math.ceil(total / 8));
    const rd = new BitReader(out, { order });
    for (const [c, n] of items) {
      if (n > 16) assert.equal(rd.read(n - 16) * 65536 + rd.read(16), c);
      else assert.equal(rd.read(n), c);
    }
    assert.equal(rd.read(16), 0);
  }
  for (let i = 0; i < outs.lsb.length; i++) {
    let rev = 0;
    for (let b = 0; b < 8; b++) if (outs.msb[i] & (1 << b)) rev |= 0x80 >> b;
    assert.equal(outs.lsb[i], rev);
  }
  const w = new BitWriter({ order: 'lsb' });
  w.put(1, 1);
  assert.deepEqual([...w.finish()], [0x01]);
  const m = new BitWriter({ order: 'msb' });
  m.put(1, 1);
  assert.deepEqual([...m.finish()], [0x80]);
});

test('lines: packed rows and changing elements convert both ways at odd widths', () => {
  for (const width of [1, 7, 8, 9, 1728, 2049]) {
    const stride = strideOf(width);
    const r = rng(width);
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) row[i] = Math.floor(r() * 256);
    if (width % 8) row[stride - 1] &= (0xff << (8 - (width % 8))) & 0xff;
    const t = new Int32Array(width + 4);
    const n = rowToChanges(row, 0, width, t);
    assert.equal(t[n], width);
    const back = new Uint8Array(stride);
    changesToRow(t, n, width, back, 0);
    assert.deepEqual(back, row);
  }
});

// --- 2. golden vectors: libtiff's streams, our decoder ----------------------------------------------------------

test('fixtures: compact and complete', () => {
  const files = readdirSync(FIX);
  const total = files.reduce((s, f) => s + readFileSync(join(FIX, f)).length, 0);
  assert.ok(total < 200 * 1024, `fixtures ${total} B`);
  for (const v of MANIFEST.vectors) assert.ok(files.includes(v.file), v.file);
  const codings = new Set(MANIFEST.vectors.map((v) => `${v.coding}${v.k ?? ''}`));
  for (const c of ['mh', 'mr2', 'mr4', 'mmr']) assert.ok(codings.has(c), c);
  for (const w of [1728, 2048, 2432, 2600]) assert.ok(MANIFEST.vectors.some((v) => v.width === w), `width ${w}`);
});

for (const v of MANIFEST.vectors) {
  test(`(a) our decoder reads libtiff's ${v.id} to the identical bitmap`, () => {
    const data = new Uint8Array(readFileSync(join(FIX, v.file)));
    assert.equal(sha(data), v.sha256);
    const dec = new T4Decoder({ width: v.width, coding: v.coding, bitOrder: v.bitOrder });
    const res = dec.decodePage(data, v.coding === 'mmr' ? { height: v.height } : {});
    assert.equal(res.errorLines, 0);
    assert.equal(res.height, v.height);
    assert.equal(sha(res.bitmap), v.bitmapSha256);
    if (!decodedBitmaps.has(v.page)) decodedBitmaps.set(v.page, res.bitmap.slice());
    // and without being told the height: libtiff's G3 strips carry no RTC, the data simply ends
    if (v.coding !== 'mmr') assert.equal(res.rtc, false);
  });
}

// --- 2. golden vectors: our encoder, libtiff's decoder ----------------------------------------------------------

for (const v of MANIFEST.vectors) {
  test(`(b) our encoder on ${v.id}: libtiff read it back (at fixture time) and it is byte-identical to libtiff's`, () => {
    const bm = decodedBitmaps.get(v.page);
    assert.ok(bm, 'decoded by the (a) tests first');
    const ours = new T4Encoder(libtiffOptions(v)).encodePage(bm, v.height);
    assert.equal(v.ours.libtiffDecodesIdentical, true);
    assert.equal(sha(ours), v.ours.sha256, 'our encoder changed since libtiff checked it: rerun make_vectors.py');
    const lib = new Uint8Array(readFileSync(join(FIX, v.file)));
    assert.ok(eqBytes(ours, lib), 'byte-identical to libtiff');
    assert.equal(v.ours.identicalToLibtiff, true);
  });
}

const python = (() => {
  const p = spawnSync('python3', ['-I', '-c', 'import PIL.features as f; assert f.version("libtiff")'], { encoding: 'utf8' });
  return p.status === 0;
})();

test('(b, live) libtiff reads complete T.4 pages from our encoder: RTC, MSLT fill, both orders, MMR, TIFF wrapper',
  { skip: python ? false : 'python3 with Pillow and libtiff not available' }, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'fax-t4-'));
    try {
      const args = [];
      const chart = decodedBitmaps.get('chart');
      const cases = [
        { page: chart, width: 1728, height: 1145, coding: 'mh', minLineBits: msltBits(20, 9600), bitOrder: 'lsb' },
        { page: chart, width: 1728, height: 1145, coding: 'mr', k: 2, minLineBits: msltBits(10, 4800), bitOrder: 'msb' },
        { page: chart, width: 1728, height: 1145, coding: 'mr', k: 4, alignEol: true, bitOrder: 'lsb', ydpi: 196 },
        { page: chart, width: 1728, height: 1145, coding: 'mmr', bitOrder: 'lsb' },
        { page: randomPage(2048, 40, 11), width: 2048, height: 40, coding: 'mr', k: 4, bitOrder: 'lsb' },
        { page: randomPage(2432, 40, 12), width: 2432, height: 40, coding: 'mh', alignEol: true, bitOrder: 'msb' },
      ];
      cases.forEach((c, i) => {
        const strip = new T4Encoder({ ...c, rtc: true }).encodePage(c.page, c.height);
        writeFileSync(join(dir, `${i}.tif`), wrapTiff(strip, c));
        writeFileSync(join(dir, `${i}.raw`), c.page);
        args.push(join(dir, `${i}.tif`), join(dir, `${i}.raw`));
      });
      const p = spawnSync('python3', ['-I', join(ROOT, 'tools', 'fax', 'check_tiff.py'), ...args], { encoding: 'utf8' });
      t.diagnostic(p.stdout.trim().replace(/\n/g, '; '));
      assert.equal(p.status, 0, p.stdout + p.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

// --- 3. round trips -----------------------------------------------------------------------------------------------

const SCHEMES = [['mh', 1], ['mr', 2], ['mr', 4], ['mmr', 1]];

test('(c) round trips of random pages: MH, MR K=2 and 4, MMR; three widths; both bit orders; fill and alignment', () => {
  for (const width of [1728, 2048, 2432]) {
    const height = 120;
    const bm = randomPage(width, height, width);
    for (const [coding, k] of SCHEMES) {
      for (const bitOrder of ['lsb', 'msb']) {
        for (const extra of [{}, { alignEol: true }, { minLineBits: msltBits(20, 9600) }]) {
          if (coding === 'mmr' && Object.keys(extra).length) continue;
          const enc = new T4Encoder({ width, coding, k, bitOrder, ...extra });
          const s = enc.encodePage(bm, height);
          const res = new T4Decoder({ width, coding, bitOrder }).decodePage(s);
          const tag = `${width} ${coding} K${k} ${bitOrder} ${JSON.stringify(extra)}`;
          assert.equal(res.errorLines, 0, tag);
          assert.equal(res.height, height, tag);
          assert.equal(res.rtc, true, tag);
          assert.ok(eqBytes(res.bitmap, bm), tag);
        }
      }
    }
  }
});

test('(c) round trips of adversarial lines: white, black, alternating pels, runs of 63, 64, 1728, 2560, one-pel moves', () => {
  for (const width of [1728, 2048, 2432, 2600, 2700]) {
    const { bm, height } = adversarialPage(width);
    for (const [coding, k] of SCHEMES) {
      for (const k2 of coding === 'mr' ? [k, 1, 1000] : [k]) {
        const s = new T4Encoder({ width, coding, k: k2 }).encodePage(bm, height);
        const res = new T4Decoder({ width, coding }).decodePage(s);
        assert.equal(res.errorLines, 0, `${width} ${coding} K${k2}`);
        assert.equal(res.height, height);
        assert.deepEqual(rowsDiffering(res.bitmap, bm, strideOf(width), height), [], `${width} ${coding} K${k2}`);
      }
    }
  }
});

// --- framing --------------------------------------------------------------------------------------------------

test('framing: EOL before every line, fill to the minimum scan line time, RTC; MR tags follow K', () => {
  const width = 1728;
  const height = 50;
  const bm = new Uint8Array(strideOf(width) * height); // all white: the shortest lines, so fill is needed
  for (let y = 20; y < 30; y++) bm.fill(0xff, y * 216, y * 216 + 216);
  for (const [coding, k] of [['mh', 1], ['mr', 2], ['mr', 4]]) {
    for (const ms of [0, 5, 10, 20, 40]) {
      const minLineBits = msltBits(ms, 9600);
      const s = new T4Encoder({ width, coding, k, minLineBits, bitOrder: 'lsb' }).encodePage(bm, height);
      const eols = eolPositions(s, 'lsb');
      assert.equal(eols.length, height + 6, `${coding} ${ms} ms`); // one before each line, then RTC
      const tagBits = coding === 'mr' ? 1 : 0;
      for (let i = 0; i < height; i++) {
        // a total coded line: its data, fill and the EOL after it (with the tag bit in MR), so from the end of
        // one EOL(+tag) to the end of the next
        const lineBits = eols[i + 1].end - eols[i].end;
        assert.ok(lineBits >= minLineBits, `${coding} line ${i}: ${lineBits} < ${minLineBits}`);
        if (minLineBits > 0 && eols[i + 1].zeros > 11) assert.equal(lineBits, minLineBits, 'no excess fill');
      }
      // RTC: six EOLs back to back (with the tag 1 in MR), nothing but padding after
      for (let i = height; i < height + 5; i++) assert.equal(eols[i + 1].end - eols[i].end, 12 + tagBits);
      assert.ok(s.length * 8 - eols[height + 5].end - tagBits < 8);
      if (coding === 'mr') {
        const r = new BitReader(s, { order: 'lsb' });
        const tags = eols.slice(0, height).map((e) => { r.pos = e.end; return r.bit(); });
        tags.forEach((tg, i) => assert.equal(tg, i % k === 0 ? 1 : 0, `tag of line ${i}`));
      }
      const res = new T4Decoder({ width, coding }).decodePage(s);
      assert.equal(res.height, height);
      assert.equal(res.rtc, true);
      assert.ok(eqBytes(res.bitmap, bm));
    }
  }
  // byte-aligned EOLs: every EOL ends on a byte boundary
  for (const coding of ['mh', 'mr']) {
    const s = new T4Encoder({ width, coding, k: 4, alignEol: true, minLineBits: 100 }).encodePage(bm, height);
    const eols = eolPositions(s, 'lsb');
    for (const e of eols.slice(0, height + 1)) assert.equal(e.end % 8, 0);
  }
});

test('framing: the decoder accepts fill before the first EOL, a missing first EOL and a stream with no RTC', () => {
  const width = 1728;
  const bm = randomPage(width, 20, 5);
  for (const coding of ['mh', 'mr']) {
    const plain = new T4Encoder({ width, coding, rtc: false, leadingEol: false }).encodePage(bm, 20);
    let res = new T4Decoder({ width, coding }).decodePage(plain);
    assert.equal(res.height, 20);
    assert.equal(res.rtc, false);
    assert.ok(eqBytes(res.bitmap, bm));
    const s = new T4Encoder({ width, coding }).encodePage(bm, 20);
    const padded = new Uint8Array(s.length + 7);
    padded.set(s, 7); // 56 fill bits before the first EOL
    res = new T4Decoder({ width, coding }).decodePage(padded);
    assert.equal(res.height, 20);
    assert.ok(eqBytes(res.bitmap, bm));
    // the height option stops early
    res = new T4Decoder({ width, coding }).decodePage(s, { height: 7 });
    assert.equal(res.height, 7);
  }
});

// --- 4. damage ----------------------------------------------------------------------------------------------------

/** A page of distinct lines (a diagonal band) so a repeated line is visible. */
function bandPage(width, height) {
  const stride = strideOf(width);
  const bm = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) for (let x = 10 * y + 5; x < 10 * y + 40 + (y % 7) * 13; x++) setPel(bm, stride, x, y);
  return bm;
}

function flipBit(data, bit, order) {
  const out = data.slice();
  out[bit >>> 3] ^= order === 'lsb' ? 1 << (bit & 7) : 0x80 >>> (bit & 7);
  return out;
}

test('(d) a damaged MH line: resync on the next EOL, the line repeated (or blanked), one error counted', () => {
  const width = 1728;
  const height = 40;
  const stride = strideOf(width);
  const bm = bandPage(width, height);
  const s = new T4Encoder({ width, coding: 'mh' }).encodePage(bm, height);
  const eols = eolPositions(s, 'lsb');
  let detected = 0;
  for (let j = 1; j < height; j++) {
    // flip each bit of line j's data (not its EOLs) until the decoder notices
    for (let bit = eols[j].end; bit < eols[j + 1].end - 12; bit++) {
      const bad = flipBit(s, bit, 'lsb');
      if (eolPositions(bad, 'lsb').length !== eols.length) continue; // the flip made or broke an EOL
      const rep = new T4Decoder({ width, coding: 'mh', damage: 'repeat' }).decodePage(bad);
      if (rep.errorLines === 0) continue; // undetected (the runs still summed to 1728)
      detected++;
      assert.equal(rep.height, height);
      assert.equal(rep.errorLines, 1);
      assert.equal(rep.maxConsecutive, 1);
      assert.deepEqual([...rep.lineErrors].flatMap((f, y) => (f ? [y] : [])), [j]);
      assert.equal(rep.rtc, true);
      const want = bm.slice();
      want.copyWithin(j * stride, (j - 1) * stride, j * stride);
      assert.ok(eqBytes(rep.bitmap, want), `line ${j} repeated`);
      const blank = new T4Decoder({ width, coding: 'mh', damage: 'blank' }).decodePage(bad);
      want.fill(0, j * stride, (j + 1) * stride);
      assert.ok(eqBytes(blank.bitmap, want), `line ${j} blanked`);
      break;
    }
  }
  assert.equal(detected, height - 1, `detected damage in ${detected} of ${height - 1} lines`);
  // damage in the first line, repeated, gives white (there is no line before it)
  const bad0 = s.slice();
  for (let b = eols[0].end; b < eols[0].end + 6; b++) bad0[b >>> 3] |= 1 << (b & 7);
  const r0 = new T4Decoder({ width, coding: 'mh' }).decodePage(bad0);
  assert.equal(r0.lineErrors[0], 1);
  assert.ok(r0.bitmap.subarray(0, stride).every((b) => b === 0));
});

test('(d) MR: a damaged line makes the 2-D lines after it errors too, up to the next 1-D line', () => {
  const width = 1728;
  const height = 40;
  const stride = strideOf(width);
  const bm = bandPage(width, height);
  for (const k of [2, 4]) {
    const s = new T4Encoder({ width, coding: 'mr', k }).encodePage(bm, height);
    const eols = eolPositions(s, 'lsb');
    for (const j of [4, 5, 9, 13]) {
      // garbage in the middle of line j: ones where codes were (a run of ones is no valid code sequence ending
      // at the line's width)
      const bad = s.slice();
      const from = eols[j].end + 3;
      for (let b = from; b < from + 12; b++) bad[b >>> 3] |= 1 << (b & 7);
      assert.equal(eolPositions(bad, 'lsb').length, eols.length);
      const nextOneD = Math.ceil((j + 1) / k) * k;
      const res = new T4Decoder({ width, coding: 'mr' }).decodePage(bad);
      assert.equal(res.height, height);
      const flagged = [...res.lineErrors].flatMap((f, y) => (f ? [y] : []));
      assert.deepEqual(flagged, Array.from({ length: nextOneD - j }, (_, i) => j + i), `K${k} line ${j}`);
      assert.equal(res.errorLines, nextOneD - j);
      assert.equal(res.maxConsecutive, nextOneD - j);
      // every flagged line repeats the last good line; everything else is exact
      const want = bm.slice();
      for (const y of flagged) want.copyWithin(y * stride, (y - 1) * stride, y * stride);
      assert.ok(eqBytes(res.bitmap, want));
      // without propagation only the line that failed is replaced; the following 2-D lines decode against it
      const np = new T4Decoder({ width, coding: 'mr', propagate: false }).decodePage(bad);
      assert.equal(np.lineErrors[j], 1);
      assert.equal(np.height, height);
    }
  }
});

test('(d) MMR: no EOLs, so the first error ends the page; the rest are counted when the height is known', () => {
  const width = 1728;
  const height = 40;
  const bm = bandPage(width, height);
  const s = new T4Encoder({ width, coding: 'mmr' }).encodePage(bm, height);
  const bad = s.slice();
  const at = Math.floor(s.length / 2);
  bad.fill(0xff, at, at + 3);
  const res = new T4Decoder({ width, coding: 'mmr' }).decodePage(bad, { height });
  assert.equal(res.height, height);
  const first = res.lineErrors.indexOf(1);
  assert.ok(first > 0);
  assert.ok(res.lineErrors.subarray(first).every((f) => f === 1));
  assert.equal(res.errorLines, height - first);
  assert.equal(res.rtc, false);
});

test('(d) fuzz: random bit errors and truncation never throw or run past the page; flagged lines are repeats', () => {
  const width = 1728;
  const height = 60;
  const stride = strideOf(width);
  const bm = randomPage(width, height, 99);
  const r = rng(1234);
  for (const [coding, k] of SCHEMES) {
    const s = new T4Encoder({ width, coding, k }).encodePage(bm, height);
    for (let trial = 0; trial < 150; trial++) {
      let bad = s;
      const flips = 1 + Math.floor(r() * 8);
      for (let i = 0; i < flips; i++) bad = flipBit(bad, Math.floor(r() * s.length * 8), 'lsb');
      if (trial % 10 === 0) bad = bad.subarray(0, Math.floor(r() * bad.length));
      const dec = new T4Decoder({ width, coding, k });
      const res = dec.decodePage(bad, coding === 'mmr' ? { height } : {});
      assert.ok(res.height <= height + flips, `${coding}: ${res.height} lines`);
      assert.ok(res.errorLines <= res.height);
      for (let y = 1; y < res.height; y++) {
        if (res.lineErrors[y]) {
          assert.ok(eqBytes(res.bitmap.subarray(y * stride, (y + 1) * stride),
            res.bitmap.subarray((y - 1) * stride, y * stride)), `${coding} trial ${trial} line ${y}`);
        }
      }
    }
  }
});

// --- purity and timing ----------------------------------------------------------------------------------------

test('purity: the library has no DOM, timers or Node-only imports', () => {
  const dir = join(ROOT, 'src', 'fax', 't4');
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /from\s+['"]node:|require\(|\b(document|window|setTimeout|setInterval|performance|Buffer|process)\b/, f);
  }
});

test('timing: encode and decode of the test chart (A4, 1728 x 1145) in Node', (t) => {
  const bm = decodedBitmaps.get('chart');
  const height = 1145;
  const rows = [];
  for (const [coding, k] of SCHEMES) {
    const enc = new T4Encoder({ width: 1728, coding, k });
    const dec = new T4Decoder({ width: 1728, coding });
    let s = enc.encodePage(bm, height);
    dec.decodePage(s); // warm up
    const N = 10;
    let t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) s = enc.encodePage(bm, height);
    const te = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    t0 = process.hrtime.bigint();
    let res;
    for (let i = 0; i < N; i++) res = dec.decodePage(s);
    const td = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    assert.ok(eqBytes(res.bitmap, bm));
    rows.push(`${coding}${coding === 'mr' ? ` K=${k}` : ''}: ${s.length} B, encode ${te.toFixed(2)} ms, decode ${td.toFixed(2)} ms`);
    assert.ok(te < 500 && td < 500, 'a page in well under the time it takes to send');
  }
  t.diagnostic(rows.join('; '));
});
