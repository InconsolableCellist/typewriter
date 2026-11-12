// The software's printing through the real printer mechanism (architecture 7.7): the spooler's link commands go to
// the headless WordprocSim's controller, its credit, status and end of data come back as device events on one
// shared clock, and the petals land where the formatter put the characters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { geometryFor } from '../src/machine/index.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { WordprocSim } from '../src/sim/wp/index.js';
import { boot } from '../src/wp/testkit.js';
import { Spooler } from '../src/wp/textpack/print/spooler.js';
import { DEFAULT_FORMAT, copyFormat } from '../src/wp/textpack/editor/format.js';
import { PETALS } from '../src/wp/charset.js';

const glyphs = await loadGlyphs('glyphs_wp');
const P = wordproc1980.printer;
const STEP = 0.0254 / 240, LINE = 0.0254 / 96;

test('a short document printed by the spooler through the mechanism strikes every character at its column', () => {
  // An envelope-length form, so feeding on to the next one at the end is short.
  const format = copyFormat({ ...DEFAULT_FORMAT, paper: 7 });
  const { sys, devices } = boot({ docs: { TRAIN: [{ name: 'Doc', text: 'The ribbon is low,\nDear Sir.\n', format }] } });
  const machine = structuredClone(wordproc1980);
  const sim = new WordprocSim({ machine, geometry: geometryFor(machine), glyphs });
  // The attachment as the kit will wire it: words to the controller, its device events back to the software.
  devices.printer = { credit: 32, status: { on: true, ready: true }, send: (w) => sim.command({ dev: 'printer', words: Array.from(w) }) };
  sys.spooler = new Spooler(sys);
  sys.spooler.wheel = 86;
  const offset = sys.now, strikes = [], out = [];
  assert.ok(sys.spooler.add({ name: 'Doc', disk: 'TRAIN', opts: { paper: 3 } }));
  const substeps = Math.round(1e-3 / sim.h);
  while (sys.printQueue.length && sim.t < 8) {
    for (let i = 0; i < substeps; i++) sim.step();
    sim.drainEvents(out);
    for (const e of out.splice(0)) {
      if (e.type === 'strike') strikes.push(e);
      else if (e.type === 'device') sys.deviceEvent(e);
    }
    sys.advance(offset + sim.t);
  }
  assert.equal(sys.printQueue.length, 0, 'the job finished: end of data came back');
  assert.ok(sim.printerCtl.flights.length > 0);
  assert.equal(strikes.length, 'Theribbonislow,DearSir.'.length);
  const typed = ['The ribbon is low,', 'Dear Sir.'].map((l) => [...l].map((ch, k) => ({ ch, pos: 18 + k })).filter((c) => c.ch !== ' '));
  const lineOf = (s) => Math.round((s.platenPsi - strikes[0].platenPsi) * P.platen.radius / (16 * LINE));
  for (const [k, line] of typed.entries()) {
    const got = strikes.filter((s) => Math.abs(lineOf(s)) === k).sort((a, b) => -a.carriageX - -b.carriageX);
    assert.deepEqual(got.map((s) => PETALS[s.bar]).join(''), line.map((c) => c.ch).join(''), `line ${k + 1}`);
    got.forEach((s, i) => {
      const want = P.carrier.home + line[i].pos * 20 * STEP;
      assert.ok(Math.abs(-s.carriageX - want) < 0.05e-3, `${line[i].ch} at ${((-s.carriageX - want) * 1e3).toFixed(3)} mm from its column`);
    });
  }
  // The second line printed from the right, the end nearer where the first ended.
  const second = strikes.slice(15);
  assert.ok(-second[0].carriageX > -second[second.length - 1].carriageX, 'right to left');
});
