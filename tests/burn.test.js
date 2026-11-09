// The sheet that catches on the ember: the trigger, the front's bookkeeping, and a burned page bypassing the pile.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { SoftWorld } from '../src/soft/index.js';
import { SheetBurn, particleNear, farthestCorner, BURN_CATCH_M, BURN_SECONDS } from '../src/pages/burn.js';

const EMBER = [0.3, 0.03, 0.1];

function fakeSheet({ at = 0.1, held = true } = {}) {
  const n = 4, x = new Float32Array(n).fill(EMBER[0] + at), y = new Float32Array(n).fill(EMBER[1]), z = new Float32Array(n).fill(EMBER[2]);
  const paperSim = { x, y, z, n, uvs: new Float32Array([0, 0, 1, 0, 0, 1, 0.25, 0.75]), grabs: new Map(held ? [[1, {}]] : []) };
  const calls = [];
  const soft = { paperSim, sheetParked: false, sheetSerial: 1 };
  const view = { setBurn: (u, v, r) => calls.push([u, v, r]) };
  return { soft, view, calls };
}

const run = (b, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) b.update(dt); };

test('a particle catches only within the radius', () => {
  const s = { x: [0.3 + BURN_CATCH_M * 0.9], y: [0.03], z: [0.1], n: 1 };
  assert.equal(particleNear(s, EMBER), 0);
  s.x[0] = 0.3 + BURN_CATCH_M * 1.1;
  assert.equal(particleNear(s, EMBER), -1);
});

test('farthest corner of the sheet', () => {
  assert.ok(Math.abs(farthestCorner(0, 0, 0.216, 0.279) - Math.hypot(0.216, 0.279)) < 1e-12);
  assert.ok(Math.abs(farthestCorner(0.5, 0.5, 0.216, 0.279) - Math.hypot(0.108, 0.1395)) < 1e-12);
});

test('a sheet only catches while it is held, at the particle that touched', () => {
  const { soft, view, calls } = fakeSheet({ at: 0.004, held: false });
  soft.paperSim.x[3] = EMBER[0] + 0.004;
  soft.paperSim.x[0] = soft.paperSim.x[1] = soft.paperSim.x[2] = EMBER[0] + 0.1;
  const b = new SheetBurn({ soft, view, ember: EMBER });
  run(b, 0.5);
  assert.equal(b.active, false, 'a sheet lying near the ember but not being moved does not catch');
  soft.paperSim.grabs.set(1, {});
  run(b, 0.2);
  assert.equal(b.active, true);
  assert.equal(calls[0][0], 0.25);
  assert.equal(calls[0][1], 0.75);
});

test('the front grows, reaches every corner by the end, and the sheet is then gone exactly once', () => {
  const { soft, view, calls } = fakeSheet({ at: 0.004 });
  let done = 0;
  const b = new SheetBurn({ soft, view, ember: EMBER, onDone: () => { done++; soft.sheetSerial++; soft.sheetParked = true; } });
  run(b, 0.2);
  assert.equal(b.active, true);
  run(b, BURN_SECONDS * 0.5);
  const mid = b.radius;
  assert.ok(b.active && mid > 0, 'burning at half time');
  assert.equal(done, 0);
  run(b, BURN_SECONDS * 0.6);
  assert.equal(done, 1, 'destroyed once');
  assert.equal(b.active, false);
  const peak = Math.max(...calls.map((c) => c[2]));
  assert.ok(peak >= farthestCorner(0, 0, 0.216, 0.279), 'the front passed the farthest corner');
  run(b, 1);
  assert.equal(done, 1, 'a parked sheet does not catch again');
});

test('a new sheet during a burn cancels it and leaves the fresh sheet whole', () => {
  const { soft, view, calls } = fakeSheet({ at: 0.004 });
  const b = new SheetBurn({ soft, view, ember: EMBER });
  run(b, 0.3);
  assert.equal(b.active, true);
  soft.sheetSerial++;
  soft.paperSim.grabs.clear();
  b.update(1 / 60);
  assert.equal(b.active, false);
  assert.equal(calls[calls.length - 1][2], -1, 'the shader is told to stop');
});

test('destroySheet parks the sheet without sending it to the finished pile', async () => {
  const world = new SoftWorld({ machine, geometry: deriveGeometry(machine), glyphs: await loadGlyphs() });
  const retired = [];
  world.onSheetRetired = (s) => retired.push(s);
  world.spawnSheet({ onTable: { offset: 0.005 } });
  world.inkTexture.data[(100 + 200 * world.inkTexture.width) * 2] = 240;
  const serial = world.sheetSerial;
  world.destroySheet();
  assert.equal(retired.length, 0, 'nothing reaches the pile');
  assert.equal(world.sheetParked, true);
  assert.ok(world.sheetSerial > serial, 'listeners can see a new sheet is in place');
  assert.equal(world.inkTexture.data[(100 + 200 * world.inkTexture.width) * 2], 0, 'the ink is gone with it');
  assert.equal(typeof world.onSheetRetired, 'function', 'the pile still hears about ordinary sheets');
});
