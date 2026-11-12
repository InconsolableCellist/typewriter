// Printing (milestone M5, architecture 7.7): the formatter's columns and lines for every format the documents hold,
// the encoding into link commands, the spooler's queue, credit and errors against the virtual printer, the operator's
// side (PRINT DOCUMENT, the PRINT key, the request menu), and the worked examples E3 and E4 of software-screens.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, run, row, expectRow, expectScreen, press, strokes } from '../src/wp/testkit.js';
import { C } from '../src/wp/textpack/editor/codes.js';
import { DEFAULT_FORMAT, copyFormat, tabGrid } from '../src/wp/textpack/editor/format.js';
import { textUnits, adjustAll } from '../src/wp/textpack/samples.js';
import { formatPage, lineY, ESCAPE } from '../src/wp/textpack/print/formatter.js';
import { encodeLine, orderLine, moves, pageRange, QUEUE_MAX } from '../src/wp/textpack/print/spooler.js';
import { PETALS, petalOf } from '../src/wp/charset.js';
import { PRINTER, indexTime } from '../src/wp/devices/timing.js';
import wordproc1980 from '../src/machine/wordproc1980.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/wp-screens/${name}.txt`, import.meta.url), 'utf8');

const LETTER = "Bobby -- I just want to drop you a short note to tell you that I landed safely and that everything is going just great. Hawaii is every bit as exciting as they say. The people are friendly and relaxed, and the scenery is breathtaking. If the weather is good tomorrow, I'm going to try scuba diving. See you all soon.";

// ---- helpers ---------------------------------------------------------------------------------------------------------

const fmtWith = (v = {}) => copyFormat({ ...DEFAULT_FORMAT, ...v });

/** Format units (text as samples.js types it, or units) on a document's first page. */
function format(content, v = {}, { objects = [], first = true, adjust = true, state } = {}) {
  const f = fmtWith(v);
  const ctx = { fmt: f, doc: f, alt: f, first };
  let units = typeof content === 'string' ? [...textUnits(content), C.PE] : [...content, C.PE];
  if (adjust) units = adjustAll(units, objects, ctx);
  return formatPage(units, objects, ctx, state);
}

const u = (s) => Array.from(s, (ch) => ch.charCodeAt(0));
const strikesOf = (sheet) => sheet.lines.flatMap((l) => l.strikes.map((s) => ({ ...s, y: l.y + s.dy, ch: String.fromCharCode(s.code) })));
/** Printed text of a line at the line's pitch: the character at each scale position. */
function textAt(line, esc = 20) {
  let t = '';
  for (const s of [...line.strikes].sort((a, b) => a.x - b.x)) {
    const p = s.x / esc;
    assert.ok(Number.isInteger(p), `x ${s.x} on a position`);
    if (s.code === 0x5f && t[p]) continue;          // an underscore struck over a character
    t = t.padEnd(p, ' ') + String.fromCharCode(s.code) + t.slice(p + 1);
  }
  return t;
}

/** A system whose printer starts as given; the queue printing in the background. */
function printing({ printer = {}, docs = { TRAIN: [{ name: 'Doc', text: 'abc\n' }] } } = {}) {
  const b = boot({ docs });
  const p = b.devices.printer;
  if (printer.power === false) p.power(false);
  if (printer.feeder !== undefined) p.feeder = printer.feeder;
  b.sys.spooler.wheel = printer.wheel === undefined ? 86 : printer.wheel;    // the wheel known to be on, unless a test asks
  b.sys.runUntilIdle();
  return { ...b, p };
}

const queue = (sys, name = 'Doc', opts = {}, disk = 'TRAIN') => assert.ok(sys.spooler.add({ name, disk, opts }));
const messages = (sys) => { const out = []; while (sys.messages.waiting) { sys.messages.next(); out.push(sys.messages.current); } return out; };
const sheetText = (sheet, esc = 20) => {
  const ys = [...new Set(sheet.strikes.map((s) => s.y))].sort((a, b) => a - b);
  return ys.map((y) => textAt({ strikes: sheet.strikes.filter((s) => s.y === y).map((s) => ({ ...s, code: s.ch.charCodeAt(0) })) }, esc).trimStart());
};

// ---- the formatter -------------------------------------------------------------------------------------------------

test('the petal map in the software is the printwheel of the definition', () => {
  assert.equal(PETALS, wordproc1980.printer.wheel.order);
  assert.equal(PETALS[petalOf(0x41)], 'A');
  assert.equal(PETALS[petalOf(0xa7)], '§');
  assert.equal(PETALS[petalOf(0xe9)], '_', 'a character the wheel does not carry prints as an underscore');
});

test('formatter: margins, the first typing line, and the columns at pitch 10, 12 and 15', () => {
  for (const [typestyle, esc] of [[1, 24], [86, 20], [215, 16]]) {
    const [sheet] = format('abc\nd\n', { typestyle });
    assert.equal(ESCAPE[{ 24: 10, 20: 12, 16: 15 }[esc]], esc);
    assert.deepEqual(sheet.lines.map((l) => l.y), [96, 112], 'line 7 is 1 in down; 6 lines an inch');
    assert.deepEqual(sheet.lines[0].strikes.map((s) => s.x), [18 * esc, 19 * esc, 20 * esc], `pitch for typestyle ${typestyle}`);
    assert.deepEqual(sheet.lines[0].strikes.map((s) => PETALS[s.petal]).join(''), 'abc');
  }
  const [sheet] = format('x\n', { lm: 10, rm: 70, tabs: tabGrid(10, 70, 5) });
  assert.equal(sheet.lines[0].strikes[0].x, 10 * 20, 'the left margin');
  assert.equal(format('x\n', { firstLine: 12 })[0].lines[0].y, lineY(12, DEFAULT_FORMAT));
  assert.equal(format('x\n', { firstLineNext: 10 }, { first: false })[0].lines[0].y, 9 * 16, 'following pages start on their own line');
});

test('formatter: line spacing and lines per inch', () => {
  const ys = (v) => format('a\nb\nc\n', v)[0].lines.map((l) => l.y);
  assert.deepEqual(ys({}), [96, 112, 128]);
  assert.deepEqual(ys({ spacing: 2 }), [96, 128, 160], 'double');
  assert.deepEqual(ys({ spacing: 3 }), [96, 144, 192], 'triple');
  assert.deepEqual(ys({ spacing: 4 }), [96, 104, 112], 'half');
  assert.deepEqual(ys({ spacing: 5 }), [96, 120, 144], 'one and a half');
  assert.deepEqual(ys({ lpi: 3 }), [72, 84, 96], '8 lines an inch');
  assert.deepEqual(ys({ lpi: 1 }), [108, 126, 144], '5.3 lines an inch');
  // A zero index carrier return prints the next line over the same one.
  const [s] = format([...u('ab'), C.ZICR, ...u('__')], {}, { adjust: false });
  assert.deepEqual(s.lines.map((l) => l.y), [96, 96]);
});

test('formatter: tabs by kind', () => {
  const tabs = [{ pos: 30, kind: 'left' }, { pos: 50, kind: 'right' }, { pos: 60, kind: 'decimal' }, { pos: 70, kind: 'centre' }];
  const [sheet] = format('a\tb\t123\t4.56\tmid\n', { tabs });
  const t = textAt(sheet.lines[0]);
  assert.equal(t.indexOf('b'), 30, 'left tab');
  assert.equal(t.indexOf('123') + 2, 50, 'right tab: the last character on the stop');
  assert.equal(t.indexOf('.'), 60, 'decimal tab: the point on the stop');
  assert.equal(t.indexOf('mid') + 1, 70, 'centre tab');
});

test('formatter: centring on the centre code', () => {
  const units = [...u(' '.repeat(36)), C.CTR, ...u('Title')];
  const [sheet] = format(units, {}, { adjust: false });
  const t = textAt(sheet.lines[0]);
  assert.equal(t.indexOf('Title'), 54 - 2, 'five characters centred on position 54');
  assert.equal(sheet.lines[0].strikes.length, 5, 'the blanks before it print nothing');
});

test('formatter: underline, word underline, character underline and overstrike strike the same column twice', () => {
  const cont = format([C.BUND, ...u('ab cd'), C.EUND, ...u(' ef')], {}, { adjust: false })[0].lines[0].strikes;
  const unders = cont.filter((s) => s.code === 0x5f).map((s) => s.x / 20);
  assert.deepEqual(unders, [18, 19, 20, 21, 22], 'continuous underline runs under the blank between words');
  cont.forEach((s, k) => { if (s.code === 0x5f && s.x !== 20 * 20) assert.equal(cont[k - 1].x, s.x, 'an underscore follows its character with no escape'); });
  const word = format([...u('ab cd'), C.WUND, ...u(' ef')], {}, { adjust: false })[0].lines[0].strikes;
  assert.deepEqual(word.filter((s) => s.code === 0x5f).map((s) => s.x / 20), [21, 22], 'word underline: the last word only');
  const ch = format([...u('ab'), C.CUND, ...u('c')], {}, { adjust: false })[0].lines[0].strikes;
  assert.deepEqual(ch.map((s) => String.fromCharCode(s.code) + s.x / 20), ['a18', 'b19', '_19', 'c20']);
  const objects = [{ type: 'ovs', begin: true, ch: '/' }, { type: 'ovs', begin: false }];
  const ovs = format([0x8000, ...u('ab'), 0x8001, ...u('c')], {}, { objects, adjust: false })[0].lines[0].strikes;
  assert.deepEqual(ovs.map((s) => String.fromCharCode(s.code) + s.x / 20), ['a18', '/18', 'b19', '/19', 'c20']);
  const bs = format([...u('a'), C.RBS, ...u('-')], {}, { adjust: false })[0].lines[0].strikes;
  assert.deepEqual(bs.map((s) => s.x), [360, 360], 'a required backspace strikes over the character before');
  const sub = format([...u('a'), C.SUB, C.RHY, C.RSP, ...u('b')], {}, { adjust: false })[0].lines[0].strikes;
  assert.deepEqual(sub.map((s) => String.fromCharCode(s.code) + s.x / 20), ['a18', '_19', '-20', 'b22'], 'substitute, required hyphen, required space');
});

test('formatter: half index up and down by half a line', () => {
  const s = format([...u('a'), C.HUP, ...u('2'), C.HDN, ...u('b'), C.HDN, ...u('3'), C.HUP], {}, { adjust: false })[0].lines[0].strikes;
  assert.deepEqual(s.map((x) => [String.fromCharCode(x.code), x.dy]), [['a', 0], ['2', -8], ['b', 0], ['3', 8]]);
  const eight = format([...u('a'), C.HUP, ...u('2')], { lpi: 3 }, { adjust: false })[0].lines[0].strikes;
  assert.equal(eight[1].dy, -6, 'half of an 8-lines-an-inch line');
});

test('formatter: a Required Page End starts a new sheet at the First Typing Line of following pages', () => {
  const sheets = format([...u('one'), C.RCR, ...u('two'), C.RPE, ...u('three')], { firstLineNext: 10 }, { adjust: false });
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets[0].lines.map((l) => [textAt(l).trim(), l.y]), [['one', 96], ['two', 112]]);
  assert.deepEqual(sheets[1].lines.map((l) => [textAt(l).trim(), l.y]), [['three', 144]]);
  // A page made by pagination ends Required Page End, Page End: no blank sheet after it.
  assert.equal(format([...u('one'), C.RPE], {}, { adjust: false }).length, 1);
  assert.equal(format([], {}, { adjust: false }).length, 1, 'an empty page is one blank sheet');
});

test('formatter: wrapped lines print as laid out, with the syllable hyphen where a line broke at it', () => {
  const [sheet] = format(LETTER);
  const rows = fixture('e2-letter').split('\n').slice(3, 8).map((r) => r.replace('▲', '').trimEnd());
  assert.deepEqual(sheet.lines.map((l) => textAt(l).slice(17).trimEnd()), rows, 'the printed lines are the screen lines');
  const units = [...u('aaaa bbbb cc'), C.SHY, ...u('dd')];
  const [s] = format(units, { lm: 10, rm: 21 });
  assert.deepEqual(s.lines.map((l) => textAt(l).trim()), ['aaaa bbbb cc-', 'dd']);
  const [t] = format([...u('cc'), C.SHY, ...u('dd')], {}, { adjust: false });
  assert.equal(textAt(t.lines[0]).trim(), 'ccdd', 'a syllable hyphen inside a line prints nothing');
});

test('formatter: justify spreads the spare space over the blanks, alternately from the left and the right', () => {
  const text = `${'aa bb cc dd ee ff gg hh ii jj kk ll mm nn oo pp qq rr ss tt uu vv ww xx yy zz '.repeat(3)}end\n`;
  const plain = format(text);
  const just = format(text, { align: 2 })[0].lines;
  const half = format(text, { align: 3 })[0].lines;
  const last = (l) => Math.max(...l.strikes.map((s) => s.x)) / 20;
  assert.ok(last(plain[0].lines[0]) < 90);
  assert.equal(last(just[0]), 90, 'a justified line ends on the right margin');
  assert.equal(last(half[0]), last(plain[0].lines[0]) + Math.floor((90 - last(plain[0].lines[0])) / 2), 'half-justify takes half');
  assert.equal(textAt(just[just.length - 1]).trim(), textAt(plain[0].lines[plain[0].lines.length - 1]).trim(), 'the last line of a paragraph is not justified');
  // The odd blanks go from the left on the first line and from the right on the next.
  const widths = (l) => {
    const t = textAt(l).trim();
    return t.split(/(?<= )(?=\S)/).slice(0, -1).map((w) => w.length - w.trimEnd().length);
  };
  const w0 = widths(just[0]), w1 = widths(just[1]);
  assert.ok(w0[0] >= w0[w0.length - 1] && w0.some((x) => x !== w0[0]), `left first: ${w0}`);
  assert.ok(w1[w1.length - 1] >= w1[0] && w1.some((x) => x !== w1[0]), `right first: ${w1}`);
  // Tabbed columns before the words are not spread.
  const tabbed = format(`\t${text}`, { align: 2 })[0].lines[0];
  assert.equal(textAt(tabbed).indexOf('a'), 23);
});

test('formatter: a typestyle change splits a line by printwheel; pitch follows the format in effect', () => {
  const objects = [{ type: 'fmt', kind: 'set', values: { typestyle: 87 } }, { type: 'fmt', kind: 'set', values: { typestyle: 1 } }];
  const [sheet] = format([...u('ab'), 0x8000, ...u('cd'), C.RCR, 0x8001, ...u('ef')], {}, { objects, adjust: false });
  assert.deepEqual(sheet.lines.map((l) => [l.style, l.y, l.strikes.map((s) => s.x)]), [
    [86, 96, [360, 380]], [87, 96, [400, 420]], [1, 112, [18 * 24, 19 * 24]],
  ]);
});

// ---- encoding --------------------------------------------------------------------------------------------------------

test('encoding: relative moves, long ones in several words, each line from the end nearer the carrier', () => {
  assert.deepEqual(moves(2, 30), [0x201e]);
  assert.deepEqual(moves(3, -5), [0x3805]);
  assert.deepEqual(moves(2, 5000), [0x27ff, 0x27ff, 0x2000 | 906]);
  assert.deepEqual(moves(2, 0), []);
  const line = { y: 96, strikes: [{ x: 360, dy: 0, petal: 1 }, { x: 380, dy: 0, petal: 2 }, { x: 380, dy: 0, petal: 3 }] };
  assert.deepEqual(orderLine(line.strikes, 0).map((s) => s.petal), [1, 2, 3]);
  assert.deepEqual(orderLine(line.strikes, 1000).map((s) => s.petal), [2, 3, 1], 'right to left, an overstrike in its order');
  const head = { x: 0, y: 0 };
  assert.deepEqual(encodeLine(line, head), [0x3060, 0x2168, 0x1001, 0x2014, 0x1002, 0x1003]);
  assert.deepEqual(head, { x: 380, y: 96 });
  const back = encodeLine({ y: 112, strikes: [{ x: 360, dy: 0, petal: 4 }, { x: 400, dy: -8, petal: 5 }] }, head);
  assert.deepEqual(back, [0x3010, 0x2814, 0x1004, 0x3808, 0x2028, 0x1005], 'from the nearer end, half a line up for one');
  assert.deepEqual(pageRange([{ n: '1' }, { n: '1.1' }, { n: '2' }], '0', '0'), [0, 2]);
  assert.deepEqual(pageRange([{ n: '1' }, { n: '1.1' }, { n: '2' }], '1.1', '2'), [1, 2]);
  assert.equal(pageRange([{ n: '1' }], '3', '0'), null);
});

// ---- the spooler against the virtual printer --------------------------------------------------------------------------

test('virtual printer: about 60 characters a second at 10 pitch, a 6 lpi line feed under 66 ms', () => {
  const { sys, p } = printing({ printer: { wheel: 1 }, docs: { TRAIN: [{ name: 'Doc', text: `${'x'.repeat(60)}\n`, format: fmtWith({ typestyle: 1 }) }] } });
  queue(sys);
  sys.runUntilIdle();
  const s = p.sheets[0].strikes;
  assert.equal(s.length, 60);
  const cps = (s.length - 1) / (s[s.length - 1].t - s[0].t);
  assert.ok(Math.abs(cps - 60) < 1, `${cps} cps`);
  assert.ok(indexTime(16) < 0.066, `${indexTime(16)} s for 16 steps`);
});

test('spooler: a job prints in the background while the operator types, page by page with credit', () => {
  const text = Array.from({ length: 30 }, (_, k) => `Line ${k} of the long document to print.`).join('\n') + '\n';
  const { sys, p } = printing({ docs: { TRAIN: [{ name: 'Long', text }, { name: 'Doc', text: 'x\n' }] } });
  let most = 0;
  const send = p.send.bind(p);
  p.send = (w) => { send(w); most = Math.max(most, p.fifo.length); };
  run(sys, 'a ENTER b ENTER "Doc" ENTER "TRAIN" ENTER ENTER');
  queue(sys, 'Long');
  const t0 = sys.now, typed = [];
  for (const s of strokes('"typing while it prints"')) {
    press(sys, s);
    sys.advance(sys.now + 0.2);
    typed.push({ t: sys.now, struck: p.sheet?.strikes.length ?? 0 });
  }
  assert.match(row(sys, 4), /typing while it prints/, 'every key was taken while printing');
  assert.ok(typed[typed.length - 1].struck > typed[0].struck + 50, 'printing went on between the keys');
  assert.equal(p.sheets.length, 0, 'not finished yet');
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 1);
  assert.equal(p.sheets[0].strikes.length, text.replace(/\s/g, '').length);
  assert.ok(sys.now - t0 > 15, 'it took printer time');
  assert.ok(most <= PRINTER.fifo, `at most ${PRINTER.fifo} words outstanding (${most})`);
  assert.equal(sys.spooler.credit, PRINTER.fifo, 'all credit back at the end');
  assert.equal(p.words.filter((w) => w === 0x6002).length, 1);
  assert.match(messages(sys).join('|'), /\(Long\) printed\./);
});

test('spooler: the queue holds six jobs; the seventh is refused with a message', () => {
  const docs = { TRAIN: Array.from({ length: 7 }, (_, k) => ({ name: `D${k}`, text: 'x\n' })) };
  const { sys } = printing({ printer: { power: false }, docs });
  for (let k = 0; k < QUEUE_MAX; k++) queue(sys, `D${k}`);
  assert.equal(sys.spooler.add({ name: 'D6', disk: 'TRAIN' }), false);
  run(sys, 'a ENTER e ENTER "D6" ENTER "TRAIN" ENTER');
  assert.match(row(sys, 25), /Print queue full/);
  assert.equal(sys.printQueue.length, 6);
  // A queued document is in use: it cannot be revised or deleted.
  run(sys, 'b ENTER "D2" ENTER "TRAIN" ENTER');
  assert.match(row(sys, 25), /\(D2\) already in use/);
});

test('spooler: a printer error part way stops printing; START goes on where it stopped', () => {
  const text = Array.from({ length: 10 }, (_, k) => `line ${k} abcdefghij`).join('\n') + '\n';
  const { sys, p } = printing({ docs: { TRAIN: [{ name: 'Doc', text }] } });
  queue(sys);
  sys.advance(sys.now + 4);
  const before = p.sheet.strikes.length;
  assert.ok(before > 10 && before < 150);
  p.fault(60);
  sys.advance(sys.now + 5);
  assert.ok(p.sheet.strikes.length <= before + 1, 'nothing prints while it waits');
  assert.match(messages(sys).join('|'), /Printer error 60\. Correct it; press START\./);
  p.start();
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 1);
  assert.deepEqual(sheetText(p.sheets[0]), text.trim().split('\n'), 'every character once, in place');
  assert.match(messages(sys).join('|'), /\(Doc\) printed\./);
});

test('spooler: with Cancel on Error Yes an error ends the job, the sheet comes out and the next job prints', () => {
  const text = Array.from({ length: 10 }, (_, k) => `line ${k} abcdefghij`).join('\n') + '\n';
  const { sys, p } = printing({ docs: { TRAIN: [{ name: 'Doc', text }, { name: 'Next', text: 'next\n' }] } });
  queue(sys, 'Doc', { cancelOnError: 1 });
  queue(sys, 'Next');
  sys.advance(sys.now + 4);
  p.openCover();
  sys.advance(sys.now + 1);
  assert.match(messages(sys).join('|'), /Printer cover open\. Close it; press START\..*\(Doc\) printing cancelled\./);
  p.closeCover();
  p.start();
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 2, 'the cancelled sheet ejected, then the next job');
  assert.ok(p.sheets[0].strikes.length < text.replace(/\s/g, '').length, 'the first stopped part way');
  assert.deepEqual(sheetText(p.sheets[1]), ['next']);
  assert.equal(sys.printQueue.length, 0);
});

test('spooler: Manual Feed asks for each sheet; the sheet feeder running out asks too', () => {
  const { sys, p } = printing({ docs: { TRAIN: [{ name: 'Doc', text: 'one\fpage two\n' }] } });
  queue(sys, 'Doc', { paper: 1 });
  sys.runUntilIdle();
  assert.deepEqual(messages(sys), ['Load paper in printer; press LOAD.']);
  p.loadPaper(); sys.runUntilIdle();
  assert.deepEqual(messages(sys), ['Load paper in printer; press LOAD.'], 'the second sheet');
  assert.equal(p.sheets.length, 1);
  p.loadPaper(); sys.runUntilIdle();
  assert.deepEqual(p.sheets.map((s) => sheetText(s)), [['one'], ['page two']]);
  // Automatic feed with one sheet left in the feeder.
  p.feeder = 1;
  queue(sys, 'Doc', { paper: 2 });
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 3);
  assert.match(messages(sys).join('|'), /\(Doc\) printed\.\|Load paper in printer; press LOAD\./);
  p.loadPaper(); sys.runUntilIdle();
  assert.equal(p.sheets.length, 4);
});

test('spooler: continuous paper feeds on to the next form instead of ejecting', () => {
  const { sys, p } = printing({ docs: { TRAIN: [{ name: 'Doc', text: 'one\fpage two\n' }] } });
  p.loadPaper(); sys.runUntilIdle();          // the forms are in
  queue(sys, 'Doc', { paper: 3 });
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 0, 'nothing ejected');
  const ys = p.sheet.strikes.map((s) => s.y);
  assert.deepEqual([...new Set(ys)], [96, 11 * 96 + 96], 'the second page one form further on');
});

test('spooler: a printwheel request waits for START or for Continue Printing With Element Now On Printer', () => {
  const docs = { TRAIN: [{ name: 'Doc', text: 'abc\n' }, { name: 'Ten', text: 'ten\n', format: fmtWith({ typestyle: 12 }) }] };
  const { sys, p } = printing({ printer: { wheel: null }, docs });
  queue(sys);
  sys.runUntilIdle();
  assert.deepEqual(messages(sys), ['Put on printer element (086 001)']);
  assert.equal(p.sheet.strikes.length, 0, 'it waits with the sheet in');
  run(sys, 'a ENTER REQST e ENTER');
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 1);
  // The same typestyle again needs no change.
  queue(sys);
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 2);
  assert.deepEqual(messages(sys), ['(Doc) printed.', '(Doc) printed.']);
  // Another typestyle does; START on the printer answers it, the cover opened for the change being part of it.
  queue(sys, 'Ten');
  sys.runUntilIdle();
  assert.deepEqual(messages(sys), ['Put on printer element (012 001)']);
  p.openCover(); p.closeCover(); p.start();
  sys.runUntilIdle();
  assert.deepEqual(messages(sys), ['(Ten) printed.']);
  assert.deepEqual(p.sheets[2].strikes.map((s) => s.x), [18 * 24, 19 * 24, 20 * 24], 'at 10 pitch');
});

test('the PRINT key queues the page on the screen and goes on to a new page after the last', () => {
  const { sys, p } = printing({ docs: { TRAIN: [{ name: 'Doc', text: 'first page\fsecond page\n' }] } });
  run(sys, 'a ENTER b ENTER "Doc" ENTER "TRAIN" ENTER ENTER');
  run(sys, 'PRINT');
  assert.match(row(sys, 4), /second page/, 'on to the next page');
  run(sys, '"!" PRINT');
  assert.match(row(sys, 2).slice(35, 48), /Pg\. 3/, 'a new page after the last');
  sys.runUntilIdle();
  assert.deepEqual(p.sheets.map((s) => sheetText(s)), [['first page'], ['!second page']], 'one job, the pages as they were');
  assert.equal(sys.printQueue.length, 0);
  run(sys, 'END');
  expectRow(sys, 4, '                       TYPING TASKS');
});

test('the request menu: the print queue, cancelling a job, changing the order', () => {
  const docs = { TRAIN: ['A', 'B', 'C'].map((name) => ({ name, text: `${name}\n` })) };
  const { sys, p } = printing({ printer: { power: false }, docs });
  run(sys, 'a ENTER');
  run(sys, 'e ENTER "A" ENTER "TRAIN" ENTER ENTER');
  queue(sys, 'B');
  queue(sys, 'C');
  run(sys, 'REQST b ENTER');
  expectRow(sys, 4, '                     DISPLAY PRINT QUEUE OR CANCEL PRINT JOB');
  expectRow(sys, 8, '  # a    TRAIN           A');
  expectRow(sys, 10, '    c    TRAIN           C');
  expectRow(sys, 21, '  # This document is printing now.');
  expectRow(sys, 24, 'Type ID letter to cancel print job; press ENTER:');
  run(sys, 'b ENTER');
  expectRow(sys, 9, '    b    TRAIN           C');
  run(sys, 'ENTER');
  expectRow(sys, 4, '                       TYPING TASKS');
  queue(sys, 'B');
  run(sys, 'REQST c ENTER c ENTER ENTER');
  assert.deepEqual(sys.printQueue.map((j) => j.name), ['A', 'B', 'C']);
  p.power(true);
  sys.runUntilIdle();
  assert.deepEqual(p.sheets.map((s) => sheetText(s)[0]), ['A', 'B', 'C']);
  // Menu Bypass reaches the queue from the typing area.
  queue(sys, 'A');
  p.stop();
  run(sys, 'b ENTER "C" ENTER "TRAIN" ENTER ENTER MENU BYPASS "cp" ENTER');
  expectRow(sys, 8, '  # a    TRAIN           A');
  run(sys, 'a ENTER ENTER');
  assert.match(row(sys, 25), /==>/);
  assert.equal(sys.printQueue.length, 0);
});

test('Print Index of Diskette Contents prints the index in its fixed form', () => {
  const { sys, p } = printing({ docs: { TRAIN: [{ name: 'Letter', text: 'x\n', comment: 'To Bobby' }] } });
  run(sys, 'b ENTER i ENTER "TRAIN" ENTER');
  sys.runUntilIdle();
  const t = sheetText(p.sheets[0]);
  assert.equal(t[0], 'INDEX OF DISKETTE CONTENTS');
  assert.match(t[1], /^DISKETTE: TRAIN {2}Available: \d+% {2}Unusable: \d+ %$/);
  assert.deepEqual(t.slice(2), ['DOCUMENT NAME: Letter', 'TYPE: Document', 'COMMENT: To Bobby']);
});

// ---- the worked examples ----------------------------------------------------------------------------------------------

/** E2's letter typed and stored, TYPING TASKS on the screen; the printer switched off with an empty sheet feeder. */
function e3() {
  const b = printing({ printer: { power: false, feeder: 0, wheel: null }, docs: {} });
  const { sys, p } = b;
  run(sys, 'a ENTER a ENTER "First Letter" ENTER "TRAIN" ENTER ENTER');
  run(sys, JSON.stringify(LETTER), { gap: 0.12 });
  run(sys, 'END');
  // 1 and 2: the names last used are suggested.
  run(sys, 'e ENTER');
  expectRow(sys, 24, 'Type document name; press ENTER. First Letter');
  run(sys, 'ENTER');
  expectRow(sys, 24, 'Type diskette name; press ENTER. TRAIN');
  // 3: PRINT DOCUMENT.
  run(sys, 'ENTER');
  expectScreen(sys, fixture('print-document').split('\n').map((r, i) => (i < 2 ? '~'.repeat(80) : r)).join('\n'));
  // 4: queued; TYPING TASKS returns, with a tone and the blinking arrow.
  const tones = b.devices.log.tones.length;
  run(sys, 'ENTER');
  expectScreen(sys, fixture('typing-tasks').split('\n').map((r, i) => (i < 2 ? '~'.repeat(80) : i === 24 ? '==>' : r)).join('\n'));
  assert.equal(b.devices.log.tones.length, tones + 1);
  // 5: MSG: turn the printer on.
  run(sys, 'MSG');
  expectRow(sys, 25, '    Turn printer on.');
  // 6: printer on; a tone, the arrow, MSG: load paper.
  p.power(true);
  sys.runUntilIdle();
  expectRow(sys, 25, '==> Turn printer on.');
  run(sys, 'MSG');
  expectRow(sys, 25, '    Load paper in printer; press LOAD.');
  p.loadPaper();
  sys.runUntilIdle();
  // 7: the printwheel; START, the page prints and comes out.
  run(sys, 'MSG');
  expectRow(sys, 25, '    Put on printer element (086 001)');
  assert.equal(p.sheet.strikes.length, 0, 'nothing printed before the wheel is confirmed');
  p.start();
  sys.runUntilIdle();
  // 8: printed; MSG again clears the line.
  run(sys, 'MSG');
  expectRow(sys, 25, '    (First Letter) printed.');
  run(sys, 'MSG');
  expectRow(sys, 25, '');
  return b;
}

test('E3: print the document', () => {
  const { p } = e3();
  assert.equal(p.sheets.length, 1, 'one page printed and out');
  const rows = fixture('e2-letter').split('\n').slice(3, 8).map((r) => r.replace('▲', '').trimEnd());
  const strikes = p.sheets[0].strikes;
  const ys = [...new Set(strikes.map((s) => s.y))];
  assert.deepEqual(ys, [96, 112, 128, 144, 160], 'lines 7 to 11, one sixth of an inch apart');
  ys.forEach((y, k) => {
    const line = { strikes: strikes.filter((s) => s.y === y).map((s) => ({ ...s, code: s.ch.charCodeAt(0) })) };
    assert.equal(textAt(line).slice(17).trimEnd(), rows[k], `line ${k + 7}: each character at its column`);
  });
  assert.equal(strikes.length, LETTER.replace(/ /g, '').length);
});

test('E4: print 2 copies using the menu shortcut', () => {
  const { sys, p } = e3();
  p.fillFeeder(10);
  run(sys, 'e ENTER ENTER ENTER');
  expectRow(sys, 4, '                         PRINT DOCUMENT');
  run(sys, '"c 2" ENTER');
  expectRow(sys, 13, '  c   Print Quantity      2        1 - 99');
  assert.ok(sys.screen.attrAt(13, 27) & 2, 'the changed choice is highlighted');
  expectRow(sys, 24, 'Type ID letter to choose ITEM; press ENTER:');
  run(sys, 'ENTER');
  expectRow(sys, 4, '                       TYPING TASKS');
  sys.runUntilIdle();
  assert.equal(p.sheets.length, 3);
  assert.deepEqual(sheetText(p.sheets[2]), sheetText(p.sheets[1]));
  assert.deepEqual(sheetText(p.sheets[1]), sheetText(p.sheets[0]));
  run(sys, 'MSG');
  expectRow(sys, 25, '    (First Letter) printed.');
});
