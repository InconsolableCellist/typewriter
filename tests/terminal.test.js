// Terminal mode: output parser, key map, keyboard translation, pacing queue, and printing through the real mechanism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TeletypeParser } from '../src/terminal/parser.js';
import { buildCharMap, missingChars, DONORS } from '../src/terminal/charmap.js';
import { keyEventToBytes, pasteToBytes } from '../src/terminal/keys.js';
import { PrintDriver, PACE, FORCE_N } from '../src/terminal/driver.js';
import { STROKE } from '../src/interact/keyboard.js';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { createSimClient } from '../src/sim/client.js';
import { loadGlyphs } from '../src/machine/glyphs.js';

const enc = (s) => new TextEncoder().encode(s);
const bytes = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const text = (ops) => ops.filter((o) => o.t === 'char').map((o) => o.ch).join('');
const parse = (s, opts) => { const p = new TeletypeParser(opts); return p.feed(bytes(s)); };
const geometry = deriveGeometry(machine);

// ---- parser -----------------------------------------------------------------------------
test('plain text and control characters become ops', () => {
  const ops = parse('hi\x07\x08!');
  assert.equal(text(ops), 'hi!');
  assert.deepEqual(ops.map((o) => o.t), ['char', 'char', 'bel', 'bs', 'char']);
});

test('CR LF is one newline, and a lone LF is a newline too', () => {
  assert.deepEqual(parse('a\r\nb\nc').map((o) => o.t), ['char', 'nl', 'char', 'nl', 'char']);
});

test('a bare CR returns the carriage; a CR at the end of a chunk waits for what follows', () => {
  assert.deepEqual(parse('ab\rC').map((o) => o.t), ['char', 'char', 'cr', 'char']);
  const p = new TeletypeParser();
  const ops1 = p.feed(bytes('a\r'));
  assert.deepEqual(ops1.map((o) => o.t), ['char']);
  assert.deepEqual(p.feed(bytes('\n')).map((o) => o.t), ['nl']);
  const q = new TeletypeParser();
  q.feed(bytes('b\r'));
  assert.deepEqual(q.flush().map((o) => o.t), ['cr']);
  assert.deepEqual(q.flush(), []);
});

test('CSI and OSC sequences are stripped, whole and split across chunks', () => {
  assert.equal(text(parse('\x1b[1;31mred\x1b[0m plain')), 'red plain');
  assert.equal(text(parse('\x1b]0;window title\x07after')), 'after');
  assert.equal(text(parse('\x1b]0;title\x1b\\after')), 'after');
  assert.equal(text(parse('\x1b(Bhello')), 'hello');
  const p = new TeletypeParser();
  let out = [];
  for (const piece of ['\x1b', '[', '1', ';', '3', '1', 'mok', '\x1b]', '0;ti', 'tle', '\x07', 'x']) out.push(...p.feed(bytes(piece)));
  assert.equal(text(out), 'okx');
});

test('a string sequence with embedded controls does not leak, and CAN aborts a sequence', () => {
  assert.equal(text(parse('\x1bP$p\x0dq\x1b\\z')), 'z');
  assert.equal(text(parse('\x1b[123\x18y')), 'y');
});

test('an unbounded parameter string gives up instead of eating everything', () => {
  const long = 'x'.repeat(300);
  assert.equal(text(parse(`\x1b[${long.replace(/x/g, '1')}zok`)).endsWith('ok'), true);
});

test('wrap is deferred: a full line then a newline is one line, a longer one wraps', () => {
  const eighty = 'x'.repeat(75);
  const ops = parse(eighty + '\r\n', { cols: 75 });
  assert.equal(ops.filter((o) => o.t === 'nl').length, 1);
  const wrapped = parse('x'.repeat(76), { cols: 75 });
  assert.equal(wrapped.filter((o) => o.t === 'nl').length, 1);
  assert.deepEqual(wrapped.slice(-2).map((o) => o.t), ['nl', 'char']);
});

test('tab advances to the next stop, never past the margin', () => {
  assert.equal(text(parse('ab\tc')), 'ab      c');
  const atEnd = parse('x'.repeat(73) + '\ty', { cols: 75 });
  assert.equal(text(atEnd), 'x'.repeat(73) + '  y');
  assert.equal(atEnd.filter((o) => o.t === 'nl').length, 1);
});

test('backspace steps the carriage only when there is somewhere to go', () => {
  assert.deepEqual(parse('\x08a\x08').map((o) => o.t), ['char', 'bs']);
});

test('non-ASCII becomes a single placeholder per character', () => {
  const ops = new TeletypeParser().feed(enc('café ☃ x'));
  assert.equal(text(ops), 'caf? ? x');
});

test('sequences that need a screen are flagged once each and print nothing', () => {
  const ops = parse('\x1b[?1049h\x1b[10;5Hhi\x1b[2Jz');
  assert.deepEqual(ops.map((o) => o.t), ['screen', 'screen', 'char', 'char', 'screen', 'char']);
  assert.equal(parse('\x1b[Kok').some((o) => o.t === 'screen'), false);
});

// ---- full ASCII ---------------------------------------------------------------------------
test('every printable character has a glyph and a way to strike it', async () => {
  const g = await loadGlyphs();
  const map = buildCharMap(geometry);
  assert.deepEqual(missingChars(map), []);
  for (let c = 0x21; c <= 0x7e; c++) {
    const ch = String.fromCharCode(c), e = map.get(ch);
    assert.ok(g.indexOf(ch) >= 0, `glyph for ${ch}`);
    const k = geometry.keys[e.key];
    assert.equal(k.kind, 'print');
    if (e.glyph) { assert.equal(e.glyph, ch); assert.equal(e.shift, false, `${ch} donor must be unshifted`); assert.ok(ch in DONORS); }
    else assert.equal(e.shift ? k.upper : k.lower, ch);
  }
  // Native slugs keep their position in the glyph order.
  assert.equal(g.chars.slice(0, 80), '234567890-=qwertyuiop/asdfghjkl;zxcvbnm,."#$%_&\'()*+QWERTYUIOP?ASDFGHJKL:ZXCVBNM');
});

// ---- keyboard ----------------------------------------------------------------------------
test('keystrokes turn into the bytes a terminal sends', () => {
  const k = (key, mods = {}) => keyEventToBytes({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });
  assert.equal(k('a'), 'a');
  assert.equal(k('A', { shiftKey: true }), 'A');
  assert.equal(k('~'), '~');
  assert.equal(k('Enter'), '\r');
  assert.equal(k('Backspace'), '\x7f');
  assert.equal(k('Tab'), '\t');
  assert.equal(k('ArrowUp'), '\x1b[A');
  assert.equal(k('c', { ctrlKey: true }), '\x03');
  assert.equal(k('D', { ctrlKey: true }), '\x04');
  assert.equal(k('\\', { ctrlKey: true }), '\x1c');
  assert.equal(k('[', { ctrlKey: true }), '\x1b');
  assert.equal(k('v', { ctrlKey: true, shiftKey: true }), null);
  assert.equal(k('a', { metaKey: true }), null);
  assert.equal(k('x', { altKey: true }), '\x1bx');
  assert.equal(k('F5'), null);
  assert.equal(pasteToBytes('a\r\nb\ncé\td'), 'a\rb\rc\td');
});

// ---- pacing queue -------------------------------------------------------------------------
function fakeRig() {
  const L = { time: 0, carriageX: 1, carriageV: 2, rocker: 3, shiftY: 4, platenPsi: 5, lineSpaceSetting: 6, marginL: 7, marginR: 8, keyX: 9, barTheta: 9 + geometry.nKeys, length: 9 + geometry.nKeys + geometry.nPrint };
  const state = new Float32Array(L.length);
  state[L.lineSpaceSetting] = 1;
  const presses = [], grabs = [];
  const handlers = {};
  const sim = {
    layout: L, get state() { return state; },
    on(name, fn) { handlers[name] = fn; return this; },
    pressKey(k, f, d, g) { presses.push({ k, f, d, g }); },
    grab: (dof, i, o) => { grabs.push({ dof, i, o }); return grabs.length; },
    moveGrab() {}, release() {},
  };
  const hands = { busy: false, calls: 0, carriageReturn() { this.calls++; this.busy = true; }, freeBars() {} };
  const emit = (e) => handlers.strike?.(e);
  return { sim, L, state, presses, grabs, hands, emit };
}

function makeDriver(rig, extra) {
  return new PrintDriver({ sim: rig.sim, geometry, machine, hands: rig.hands, charMap: buildCharMap(geometry), rng: () => 0.5, ...extra });
}

const strikeFor = (bar, caseIndex, char) => ({ type: 'strike', bar, caseIndex, ...(char ? { char } : null) });

function advance(rig, dt) { rig.state[rig.L.time] += dt; }

test('the queue does not fire over a key still down or a strike not yet confirmed', () => {
  const rig = fakeRig();
  const d = makeDriver(rig);
  d.enqueue([{ t: 'char', ch: 'a' }, { t: 'char', ch: 'b' }]);
  d.tick();
  assert.equal(rig.presses.length, 1, 'first strike goes out at once');
  const a = rig.presses[0];
  assert.equal(a.d, STROKE.durationS);
  advance(rig, 0.03);
  d.tick();
  assert.equal(rig.presses.length, 1, 'too soon after the first');
  advance(rig, 0.2);
  // The key is reported down: wait.
  rig.state[rig.L.keyX + a.k] = 0.01;
  d.tick();
  assert.equal(rig.presses.length, 1, 'key still down');
  rig.state[rig.L.keyX + a.k] = 0;
  // Key up, but the mechanism has not said it struck.
  d.tick();
  assert.equal(rig.presses.length, 1, 'no confirmation yet');
  rig.emit(strikeFor(a.k, 0));
  rig.state[rig.L.carriageX] = d.targetCx;
  d.tick();
  assert.equal(rig.presses.length, 2);
  assert.equal(d.stats.struck, 1);
  assert.equal(d.stats.mismatches, 0);
});

test('a jammed bar is cleared by hand, and the queue waits', () => {
  const rig = fakeRig();
  let freed = 0;
  rig.hands.freeBars = () => { freed++; };
  const d = makeDriver(rig);
  d.enqueue([{ t: 'char', ch: 'q' }]);
  rig.state[rig.L.barTheta + 5] = 0.5;
  for (let i = 0; i < 40; i++) { advance(rig, 0.03); d.tick(); }
  assert.equal(freed, 1);
  assert.equal(d.stats.jams, 1);
  assert.equal(rig.presses.length, 0);
  rig.state[rig.L.barTheta + 5] = 0;
  for (let i = 0; i < 2; i++) { advance(rig, 0.03); d.tick(); }
  assert.equal(rig.presses.length, 1, 'printing resumes once the bar is back');
});

test('capitals go through shift, spaces do not change case, and clear drops the queue', () => {
  const rig = fakeRig();
  const d = makeDriver(rig);
  d.enqueue([{ t: 'char', ch: 'A' }]);
  d.tick();
  assert.equal(rig.presses.length, 0, 'waits for the shift to come up');
  assert.equal(rig.grabs[0].dof, 'key');
  rig.state[rig.L.shiftY] = machine.carriage.shiftTravel;
  d.tick();
  assert.equal(rig.presses.length, 1);
  const before = d.queued;
  d.enqueue([{ t: 'char', ch: 'b' }, { t: 'char', ch: 'c' }]);
  assert.equal(d.queued, before + 2);
  d.clear();
  assert.equal(d.queued, 0);
});

test('newlines go to the carriage-return hand one at a time, each indexing exactly one line', () => {
  const rig = fakeRig();
  const d = makeDriver(rig);
  d.enqueue([{ t: 'nl' }, { t: 'nl' }]);
  d.tick();
  assert.equal(rig.hands.calls, 1);
  d.tick();
  assert.equal(rig.hands.calls, 1, 'second waits for the first');
  rig.hands.busy = false;
  rig.state[rig.L.platenPsi] = (2 * Math.PI) / machine.platen.ratchetTeeth;
  d.tick();
  assert.equal(d.stats.lineErrors, 0);
  assert.equal(d.stats.newlines, 1);
  d.tick();
  assert.equal(rig.hands.calls, 2);
  assert.equal(FORCE_N > 20, true);
  void PACE;
});

test('a shell erase (BS, space, BS) is one step back, even in a run or split across chunks', async () => {
  const sim = await createSimClient({ machine, geometry, glyphs: await loadGlyphs(), autoRun: false });
  const d = new PrintDriver({ sim, geometry, machine, hands: { busy: false, freeBars() {}, carriageReturn() {} }, charMap: buildCharMap(geometry) });
  const shape = () => d.queue.slice(d.head).map((o) => (o.t === 'char' ? o.ch : o.t)).join('|');
  const bs = { t: 'bs' }, sp = { t: 'char', ch: ' ' };
  d.enqueue([{ t: 'char', ch: 'a' }, bs, sp, bs, bs, sp, bs]);
  assert.equal(shape(), 'a|bs|bs');
  d.clear();
  d.enqueue([bs, sp]); d.enqueue([bs]);
  assert.equal(shape(), 'bs');
  d.clear();
  d.enqueue([bs, { t: 'char', ch: '_' }, bs]);    // underlining and the like are left alone
  assert.equal(shape(), 'bs|_|bs');
});

test('backspace moves exactly one pitch however hard it is struck', async () => {
  for (const force of [20, 34, 45, 70]) {
    const sim = await createSimClient({ machine, geometry, glyphs: await loadGlyphs(), autoRun: false });
    sim.setEnv({ paperCaliperM: 1e-4, ribbonCaliperM: 1.1e-4, ribbonInGap: 1, paperPresent: 1, paperStrength: 1 });
    const map = buildCharMap(geometry), L = sim.layout;
    for (let i = 0; i < 4; i++) { sim.pressKey(map.space, 30, STROKE.durationS); sim.advance(0.3); }
    const x0 = sim.state[L.carriageX];
    sim.pressKey(map.backspace, force, STROKE.durationS);
    sim.advance(0.6);
    const moved = Math.abs(sim.state[L.carriageX] - x0) / machine.escapement.pitch;
    assert.ok(Math.abs(moved - 1) < 0.02, `${force} N moved ${moved.toFixed(3)} pitches`);
  }
});

test('keys pressed during the audio handover replay at their own spacing, in order', async () => {
  const sim = await createSimClient({ machine, geometry, glyphs: await loadGlyphs(), autoRun: false });
  const seen = [];
  sim.host.pressKey = (k) => seen.push({ k, at: performance.now() });
  sim.handover = []; sim.handoverT0 = performance.now();
  sim.pressKey(1); sim.pressKey(2);
  sim.replayHandover();
  sim.pressKey(3);                                // typed while the replay is still running
  await new Promise((r) => setTimeout(r, 420));
  assert.deepEqual(seen.map((e) => e.k), [1, 2, 3]);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].at - seen[i - 1].at >= 80, `gap ${seen[i].at - seen[i - 1].at} ms`);
});

test('the carriage release latches, and the freed carriage stays where it is slid', async () => {
  const sim = await createSimClient({ machine, geometry, glyphs: await loadGlyphs(), autoRun: false });
  const map = buildCharMap(geometry), L = sim.layout;
  for (let i = 0; i < 4; i++) { sim.pressKey(map.space, 30, STROKE.durationS); sim.advance(0.3); }
  const lever = sim.grab('carriageRelease', 0, { target: 0.35, k: 2, c: 0.03, maxF: 0.8 });
  sim.advance(0.3); sim.release(lever); sim.advance(0.6);
  assert.ok(sim.state[L.carriageRelease] > 0.3, `lever stayed open: ${sim.state[L.carriageRelease]}`);
  const x0 = sim.state[L.carriageX];
  sim.advance(0.5);
  assert.ok(Math.abs(sim.state[L.carriageX] - x0) < 2e-4, 'the mainspring does not run a released carriage away');
  const hand = sim.grab('carriage', 0, { target: x0, k: 800, c: 32, maxF: 30 });
  for (let i = 1; i <= 40; i++) { sim.moveGrab(hand, x0 - 0.03 * i / 40); sim.advance(0.01); }
  sim.advance(0.1);
  const put = sim.state[L.carriageX];
  assert.ok(put < x0 - 0.02, `the hand moved it: ${put - x0}`);
  sim.release(hand); sim.advance(0.4);
  assert.ok(Math.abs(sim.state[L.carriageX] - put) < 3e-4, `stays where it was let go: ${sim.state[L.carriageX] - put}`);
  const close = sim.grab('carriageRelease', 0, { target: 0, k: 2, c: 0.03, maxF: 0.8 });
  sim.advance(0.3); sim.release(close); sim.advance(0.4);
  assert.ok(sim.state[L.carriageRelease] < 0.03, 'lever closes and stays closed');
});

// ---- the real mechanism -------------------------------------------------------------------
test('a full-range line prints through the mechanism: every strike correct, no jams, exact spacing', async () => {
  const glyphs = await loadGlyphs();
  const sim = await createSimClient({ machine, geometry, glyphs, autoRun: false });
  sim.setEnv({ paperCaliperM: 1e-4, ribbonCaliperM: 1.1e-4, ribbonInGap: 1, paperPresent: 1, paperStrength: 1 });
  const hands = { busy: false, freeBars() {}, carriageReturn() {} };
  const d = new PrintDriver({ sim, geometry, machine, hands, charMap: buildCharMap(geometry) });
  const printable = [];
  for (let c = 0x21; c <= 0x7e; c++) printable.push(String.fromCharCode(c));
  const line = printable.slice(0, 73).join('');
  const strikes = [];
  sim.on('strike', (e) => strikes.push(e));
  d.enqueue([...line].map((ch) => ({ t: 'char', ch })));
  const L = sim.layout, t0 = sim.state[L.time];
  let n = 0;
  while (!d.idle && sim.state[L.time] - t0 < 20) { sim.advance(0.002); d.tick(); if (++n % 3000 === 0) await new Promise((r) => setImmediate(r)); }
  assert.equal(d.stats.fired, line.length);
  assert.equal(d.stats.struck, line.length, `struck ${d.stats.struck}: ${d.stats.lastMismatch ?? ''}`);
  assert.equal(d.stats.lost, 0);
  assert.equal(d.stats.jams, 0);
  const got = strikes.map((e) => e.char ?? (e.caseIndex ? geometry.keys[e.bar].upper : geometry.keys[e.bar].lower)).join('');
  assert.equal(got, line);
  const pitch = machine.escapement.pitch;
  strikes.forEach((e, i) => assert.ok(Math.abs(e.carriageX - (strikes[0].carriageX - i * pitch)) < 0.0004, `spacing at ${i}`));
});
