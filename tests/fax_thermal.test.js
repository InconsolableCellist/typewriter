// The FO-70's thermal head and paper (src/fax/thermal/head.js, paper.js). docs/fax/plan.md 2, M5 and 7.3 item 10.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ThermalHead, HEAD_CAL, defaultStrobeMs } from '../src/fax/thermal/head.js';
import { ThermalPaper, fadeDose, fadeDensity, groundYellow, PAPER_CAL } from '../src/fax/thermal/paper.js';

const row = (f) => { const r = new Uint8Array(216); for (let i = 0; i < 1728; i++) if (f(i)) r[i >> 3] |= 0x80 >> (i & 7); return r; };
const BLACK = row(() => true), WHITE = row(() => false);
const FINE = { pitchMm: 1 / 7.7, periodMs: 10 };

test('black is solid at the default strobe: a cold head, a full line, slow and fast lines', (t) => {
  for (const periodMs of [10, 20, 40]) {
    const h = new ThermalHead();
    let min = 1;
    for (let k = 0; k < 30; k++) {
      const out = h.printLine(BLACK, { ...FINE, periodMs });
      for (const d of out.density) min = Math.min(min, d);
    }
    t.diagnostic(`${periodMs} ms lines: the lightest dot of 30 black lines ${min.toFixed(3)}`);
    assert.ok(min > 0.95, `${periodMs} ms: ${min}`);
  }
  // a single dot on a cold head
  const h = new ThermalHead();
  assert.ok(h.printLine(row((i) => i === 500), FINE).density[500] > 0.95);
  // and nothing where no dot fired
  const h2 = new ThermalHead();
  const out = h2.printLine(row((i) => i === 500), FINE);
  assert.equal(out.density[499] + out.density[700], 0);
});

test('heat history: the line after a black area keeps a faint trace (the smear of real thermal faxes)', (t) => {
  const h = new ThermalHead();
  for (let k = 0; k < 40; k++) h.printLine(BLACK, FINE);
  const w1 = h.printLine(WHITE, FINE).density[800];
  const p1 = h.peak[800];
  const w2 = h.printLine(WHITE, FINE).density[800];
  t.diagnostic(`first white line after black: density ${w1.toFixed(3)} (paper peak ${p1.toFixed(1)} C); second ${w2.toFixed(3)}`);
  assert.ok(w1 > 0.005 && w1 < 0.3, `trail ${w1}`);
  assert.equal(w2, 0);
  // a dot after a black line runs hotter than the same dot on a cold head
  const cold = new ThermalHead(); cold.printLine(row((i) => i === 800), FINE);
  const warm = new ThermalHead(); warm.printLine(BLACK, FINE); warm.printLine(row((i) => i === 800), FINE);
  assert.ok(warm.peak[800] > cold.peak[800] + 5, `${warm.peak[800]} vs ${cold.peak[800]}`);
  // slower lines leave the head time to cool: less trace
  const slow = new ThermalHead();
  for (let k = 0; k < 40; k++) slow.printLine(BLACK, { ...FINE, periodMs: 20 });
  slow.printLine(WHITE, { ...FINE, periodMs: 20 });
  assert.ok(slow.peak[800] < p1 - 10);
  // super fine: half the step, so part of the paper stays under the heater: more trace at the same period
  const sf = new ThermalHead();
  for (let k = 0; k < 40; k++) sf.printLine(BLACK, { pitchMm: 1 / 15.4, periodMs: 10 });
  sf.printLine(WHITE, { pitchMm: 1 / 15.4, periodMs: 10 });
  assert.ok(sf.peak[800] > p1);
});

test('voltage sag: many dots on in a block lower its voltage, each dot\'s energy and, at a short strobe, its density', () => {
  const one = new ThermalHead().printLine(row((i) => i === 100), { ...FINE, strobeMs: 0.75 });
  const e1 = one.energy[100], v1 = one.volts[0], d1 = one.density[100];
  const full = new ThermalHead().printLine(row((i) => i < 432), { ...FINE, strobeMs: 0.75 });
  const eN = full.energy[100], vN = full.volts[0], dN = full.density[100];
  assert.ok(vN < v1 - 0.5, `${vN} vs ${v1}`);
  assert.ok(eN < 0.9 * e1, `${eN} vs ${e1}`);
  assert.ok(dN < d1, `${dN} vs ${d1}`);
  // the other blocks are not loaded
  assert.ok(Math.abs(full.volts[1] - HEAD_CAL.Vs) < 1e-9);
  assert.ok(Math.abs(e1 / ((v1 * v1 / HEAD_CAL.R) * 0.75e-3) - 1) < 1e-6);
});

test('the thermistor follows the substrate up over a dense page, and the default strobe shortens', () => {
  const h = new ThermalHead();
  const c0 = h.thermistorC;
  for (let k = 0; k < 2000; k++) h.printLine(BLACK, FINE);
  assert.ok(h.thermistorC > c0 + 5, `${h.thermistorC}`);
  assert.ok(defaultStrobeMs(h.thermistorC) < defaultStrobeMs(c0));
  assert.ok(defaultStrobeMs(25, 'superfine') < defaultStrobeMs(25, 'fine'));
  const hot = h.thermistorC;
  h.idle(300);
  assert.ok(h.thermistorC < hot - 3, 'cools when idle');
});

test('the paper: threshold and saturation, and a roll loaded the wrong way prints nothing', () => {
  const p = new ThermalPaper();
  assert.equal(p.mark(PAPER_CAL.T0 - 1), 0);
  assert.equal(p.mark(PAPER_CAL.T1 + 1), 1);
  let last = 0;
  for (let T = 60; T <= 115; T += 0.5) { const d = p.mark(T); assert.ok(d >= last); last = d; }
  const back = new ThermalHead({ paper: new ThermalPaper({ reversed: true }) });
  let sum = 0;
  for (let k = 0; k < 10; k++) for (const d of back.printLine(BLACK, FINE).density) sum += d;
  assert.equal(sum, 0);
});

test('fading: one rate law, monotonic in time and faster in light; the ground yellows', () => {
  const day = 86400;
  let last = 1;
  for (const days of [0, 1, 7, 30, 365, 3650]) {
    const d = fadeDensity(1, fadeDose({ seconds: days * day }));
    assert.ok(d <= last); last = d;
  }
  const drawer = fadeDensity(1, fadeDose({ seconds: 365 * day }));
  assert.ok(drawer > 0.85 && drawer < 0.95, `a year in a drawer ${drawer}`);
  const sill = fadeDensity(1, fadeDose({ seconds: 21 * 8 * 3600, lux: 10000 }));
  assert.ok(sill < 0.6, `three weeks on a sunny sill ${sill}`);
  assert.ok(fadeDensity(1, fadeDose({ seconds: day, lux: 500 })) < fadeDensity(1, fadeDose({ seconds: day })));
  assert.ok(groundYellow(2) > groundYellow(1) && groundYellow(0) === 0);
});
