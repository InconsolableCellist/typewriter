// The word processor's physical controls (architecture.md 3.6): the display's knobs on the CRT, tilt and swivel as
// remembered, the rear LEDs through the self-test, the sheet feeder's flag shared by the gate and the panel, the
// printer's panel keys and LEDs, the ribbon knob, the station's power cycle in the software, and the pointer's drag,
// wheel and click-through for controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crtDrive, knobAngle, knobDetent, KNOB_TURN, loadDisplaySettings, saveDisplaySettings, stationLeds, LED_SEQUENCE, makeFeeder, DISPLAY_DEFAULTS } from '../src/kits/wp/controls.js';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { geometryFor } from '../src/machine/index.js';
import { WordprocSim } from '../src/sim/wp/index.js';
import { LED } from '../src/sim/wp/printer-ctl.js';
import { createSystem } from '../src/wp/index.js';
import { VirtualDevices } from '../src/wp/devices/virtual.js';
import { Library, programDiskette, PROGRAM_NAME } from '../src/wp/disk/library.js';
import { MemoryStore } from '../src/wp/disk/store.js';
import { installWpPointer } from '../src/interact/wp-pointer.js';

const deg = Math.PI / 180;

test('knobs: contrast drives the character gain, brightness the level and the bare raster, within their stops', () => {
  const mid = crtDrive(DISPLAY_DEFAULTS);
  assert.ok(Math.abs(mid.gain - 1) < 1e-9 && Math.abs(mid.level - 1) < 1e-9, 'nominal at mid travel');
  assert.ok(Math.abs(mid.raster - 0.022) < 1e-9, 'the raster as the CRT sets it, at mid travel');
  const lo = crtDrive({ contrast: 0, brightness: 0 }), hi = crtDrive({ contrast: 1, brightness: 1 });
  assert.ok(lo.gain > 0.2 && hi.gain < 2, 'contrast never blanks the text nor blows it out');
  assert.ok(lo.level > 0.5 && hi.level < 1.5 && lo.raster > 0 && hi.raster < 0.1);
  let prev = null;
  for (let v = 0; v <= 1.0001; v += 0.05) {
    const d = crtDrive({ contrast: v, brightness: v });
    if (prev) assert.ok(d.gain > prev.gain && d.level > prev.level && d.raster > prev.raster, 'clockwise is more');
    prev = d;
  }
  // Past the stops is at the stops; garbage is the default.
  assert.deepEqual(crtDrive({ contrast: 5, brightness: -3 }), crtDrive({ contrast: 1, brightness: 0 }));
  assert.deepEqual(crtDrive({ contrast: NaN }), mid);
  // Contrast leaves brightness's outputs alone and the other way round.
  assert.equal(crtDrive({ contrast: 0.9, brightness: 0.5 }).level, mid.level);
  assert.equal(crtDrive({ contrast: 0.5, brightness: 0.9 }).gain, mid.gain);
  assert.ok(Math.abs(knobAngle(1) - knobAngle(0) - KNOB_TURN) < 1e-12 && knobAngle(0.5) === 0);
  assert.notEqual(knobDetent(0.5), knobDetent(0.56));
});

test('display settings: remembered, clamped to the knobs and the cradle, defaults when missing or broken', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const limits = { tilt: [0, 20 * deg], swivel: [-12 * deg, 12 * deg] };
  assert.deepEqual(loadDisplaySettings(storage, limits), { ...DISPLAY_DEFAULTS });
  saveDisplaySettings(storage, { contrast: 0.8, brightness: 0.2, tilt: 10 * deg, swivel: -5 * deg });
  assert.deepEqual(loadDisplaySettings(storage, limits), { contrast: 0.8, brightness: 0.2, tilt: 10 * deg, swivel: -5 * deg });
  saveDisplaySettings(storage, { contrast: 3, brightness: -1, tilt: 40 * deg, swivel: -30 * deg });
  assert.deepEqual(loadDisplaySettings(storage, limits), { contrast: 1, brightness: 0, tilt: 20 * deg, swivel: -12 * deg });
  store.set('typewriter.wp.display', '{not json');
  assert.deepEqual(loadDisplaySettings(storage, limits), { ...DISPLAY_DEFAULTS });
  assert.deepEqual(loadDisplaySettings(null, limits), { ...DISPLAY_DEFAULTS });
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadDisplaySettings(throwing, limits), { ...DISPLAY_DEFAULTS });
  saveDisplaySettings(throwing, DISPLAY_DEFAULTS);   // does not throw
});

test('rear LEDs: off when off, all on at power-on, one stepping A to H, then G alone while running', () => {
  assert.equal(stationLeds(null), 0);
  assert.equal(stationLeds(0), 0xff);
  assert.equal(stationLeds(LED_SEQUENCE.allOn - 0.01), 0xff);
  const seen = [];
  for (let t = LED_SEQUENCE.allOn; t < LED_SEQUENCE.allOn + 8 * LED_SEQUENCE.step; t += LED_SEQUENCE.step / 4) {
    const b = stationLeds(t);
    assert.equal(b & (b - 1), 0, 'one LED at a time');
    if (seen.at(-1) !== b) seen.push(b);
  }
  assert.deepEqual(seen, [1, 2, 4, 8, 16, 32, 64, 128]);
  const G = 1 << 'ABCDEFGH'.indexOf('G');
  for (const t of [LED_SEQUENCE.allOn + 8 * LED_SEQUENCE.step, 30, 3600]) assert.equal(stationLeds(t), G);
});

test('sheet feeder: the gate and the panel button share one flag and each hears the other', () => {
  const feeder = makeFeeder(true);
  const panel = [], gate = [];
  feeder.onChange((on) => panel.push(on));
  feeder.onChange((on) => gate.push(on));
  feeder.toggle();                 // the gate clicked
  assert.equal(feeder.on, false);
  feeder.on = true;                // the panel's button
  feeder.on = true;                // no change, no news
  assert.deepEqual(panel, [false, true]);
  assert.deepEqual(gate, [false, true]);
});

function freshSim(opts = {}) {
  const machine = structuredClone(wordproc1980);
  return { sim: new WordprocSim({ machine, geometry: geometryFor(machine), glyphs: null, ...opts }), P: machine.printer };
}
const runFor = (sim, s) => { for (let i = 0, n = Math.round(s / sim.h); i < n; i++) sim.step(); };
function pressKey(sim, P, i) {
  const g = sim.grab('panelKey', i, { target: P.panel.travel * 1.3 });
  runFor(sim, 0.16); sim.release(g); runFor(sim, 0.05);
}

test('printer panel: Stop and Start take it off line and on again; the LED bits follow; Cancel empties the queue', () => {
  const { sim, P } = freshSim();
  const ctl = sim.printerCtl, L = sim.layout, s = new Float32Array(L.length);
  runFor(sim, 0.02);
  sim.writeSnapshot(s);
  assert.equal(s[L.leds] & (LED.powerOn | LED.onLine | LED.ready), LED.powerOn | LED.onLine | LED.ready);
  pressKey(sim, P, P.panel.keys.indexOf('stop'));
  sim.writeSnapshot(s);
  assert.equal(ctl.online, false);
  assert.equal(s[L.leds] & LED.onLine, 0, 'On Line goes dark');
  pressKey(sim, P, P.panel.keys.indexOf('start'));
  sim.writeSnapshot(s);
  assert.ok(ctl.online && s[L.leds] & LED.onLine, 'On Line lights again');
  sim.command({ dev: 'printer', words: [0x2000 | 200] });
  ctl.fifo.push({ w: 0x2000 | 4 });
  const events = [];
  pressKey(sim, P, P.panel.keys.indexOf('cancel'));
  sim.drainEvents(events);
  assert.equal(ctl.fifo.length, 0);
  assert.ok(events.some((e) => e.ev === 'cancel'));
  // Paper Down indexes the platen backwards.
  const idx = ctl.idxS;
  pressKey(sim, P, P.panel.keys.indexOf('paperDown'));
  runFor(sim, 0.1);
  assert.ok(ctl.idxS < idx, `paper down: ${idx} -> ${ctl.idxS}`);
});

test('printer: opening the cover takes it out of ready and lights Printer Exception', () => {
  const { sim, P } = freshSim();
  const g = sim.grab('printerCover', 0, { target: P.cover.open });
  runFor(sim, 1.2); sim.release(g); runFor(sim, 0.05);
  const L = sim.layout, s = new Float32Array(L.length);
  sim.writeSnapshot(s);
  assert.ok(!sim.printer.coverClosed());
  assert.ok(s[L.leds] & LED.exception);
  assert.equal(sim.printerCtl.ready, false);
});

test('ribbon advance knob: a hand on it advances the ribbon with the printer off; the motor holds it while on', () => {
  for (const on of [false, true]) {
    const { sim, P } = freshSim();
    if (!on) { const g = sim.grab('printerPower', 0, { target: -0.1 }); runFor(sim, 0.3); sim.release(g); runFor(sim, 0.05); }
    assert.equal(sim.printer.powered(), on);
    const f0 = sim.printer.ribbonFed(), th0 = sim.printer.rib.th;
    const g = sim.grab('ribbonKnob', 0, { target: th0, maxF: 0.1 });
    for (let k = 1; k <= 40; k++) { sim.moveGrab(g, th0 + k * 0.1); runFor(sim, 0.002); }
    runFor(sim, 0.02); sim.release(g); runFor(sim, 0.05);
    const fed = sim.printer.ribbonFed() - f0;
    if (on) assert.ok(Math.abs(fed) < 1e-5, `held: ${fed}`);
    else assert.ok(fed > 0.3e-3, `advanced ${fed * 1000} mm`);
  }
});

test('station power: off stops the software and keeps the saves; on again runs the power-on test and loads', () => {
  const library = new Library();
  library.add(programDiskette());
  const devices = new VirtualDevices({ drives: [{ mediaId: PROGRAM_NAME, type: '2D' }, null] });
  const store = new MemoryStore();
  const sys = createSystem({ devices, store, library, options: { cold: false } });
  sys.runUntilIdle();
  assert.match(sys.screen.text(3), /TASK SELECTION/);
  devices.power.on = false;
  sys.powerOff();
  assert.equal(sys.screen.text(3).trim(), '');
  sys.deviceEvent({ dev: 'kbd', ev: 'scan', byte: 0x1e });   // ignored
  sys.advance(1e6);
  assert.equal(sys.sched.tasks.length, 0);
  devices.power.on = true;
  const t0 = 500;
  const again = createSystem({ devices, store, library, options: { cold: true, t0 } });
  assert.equal(again.now, t0);
  again.advance(t0 + 2);
  assert.equal(again.screen.text(20).trim(), '', 'no test code before 3 s');
  again.advance(t0 + 3.5);
  assert.match(again.screen.text(20), /05/, 'the power-on test runs on the kit clock');
  again.runUntilIdle();
  assert.match(again.screen.text(3), /TASK SELECTION/, 'the program loaded');
});

// ---- the pointer: drag, wheel and a click passed through ------------------------------------------------------------

function rig(under) {
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
  canvas.style = {};
  const orbit = { dragging: false, rotate: () => { throw new Error('orbit'); }, pan: () => { throw new Error('orbit'); }, zoom: () => { throw new Error('zoom'); } };
  const gone = [];
  const nav = { free: true, go: (id) => gone.push(id), targets: () => [] };
  installWpPointer({ canvas, orbit, nav, pick: () => under, press: () => {} });
  const send = (type, x, y, extra = {}) => canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y, ...extra }));
  return { send, gone };
}

test('pointer: a drag on a control turns it and never orbits, the wheel turns it, a click passes through to the view', () => {
  const log = [];
  const part = { label: 'Contrast · drag to turn', onDrag: (dx, dy) => log.push(['drag', dx, dy]), onDragEnd: () => log.push(['end']), onWheel: (d) => log.push(['wheel', d]) };
  const hit = { kind: 'control', entry: { part: () => part }, part, label: part.label, fallback: { id: 'computer/screen', label: 'Screen' } };
  const r = rig(hit);
  r.send('pointerdown', 100, 100);
  for (let i = 1; i <= 5; i++) r.send('pointermove', 100 + 4 * i, 100 - 2 * i);
  r.send('pointerup', 120, 90);
  const drags = log.filter((x) => x[0] === 'drag');
  assert.ok(drags.length >= 3, 'drags reach the control');
  assert.equal(drags.reduce((a, x) => a + x[1], 0) > 0, true);
  assert.deepEqual(log.at(-1), ['end']);
  assert.deepEqual(r.gone, [], 'a drag is not a click');
  r.send('pointerdown', 100, 100);
  r.send('pointerup', 101, 100);
  assert.deepEqual(r.gone, ['computer/screen'], 'a click on a control with no onClick goes to the view behind it');
  r.send('wheel', 100, 100, { deltaY: -100, preventDefault() {} });
  assert.deepEqual(log.at(-1), ['wheel', -100]);
});

test('power switches: a pick just off the small rocker still finds it, through its invisible hit proxy, before any view box', async () => {
  const THREE = await import('three');
  const { addHitProxy } = await import('../src/kits/wp/station.js');
  const { makePicker } = await import('../src/interact/wp-pointer.js');
  const scene = new THREE.Scene();
  const rocker = new THREE.Group(); rocker.name = 'powerRocker';
  rocker.add(new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.008, 0.015), new THREE.MeshBasicMaterial()));
  rocker.position.set(0.2, 0.17, 0.1);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.17, 0.4), new THREE.MeshBasicMaterial());
  body.position.set(0, 0.08, -0.1);
  scene.add(rocker, body);
  scene.updateMatrixWorld(true);
  const proxy = addHitProxy(rocker, 0.009);
  assert.equal(proxy.visible, false);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  camera.position.set(0.2, 0.6, 0.5); camera.lookAt(0.2, 0.17, 0.1); camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) };
  const pickables = [{ object: rocker, part: () => ({ label: 'Power: switch off', onClick: () => {} }) }];
  const nav = { targets: () => [{ id: 'computer/controls', kind: 'focus', label: 'Controls', boxes: ['controls'] }] };
  const pick = makePicker({ camera, canvas, keys: [], pickables, nav, boxes: () => ({ controls: { min: [-1, -1, -1], max: [1, 1, 1] } }), solids: () => [body] });
  // 6 mm past the paddle's end: off the paddle itself, inside the proxy.
  const p = new THREE.Vector3(0.2 + 0.017 + 0.006, 0.17, 0.1).project(camera);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
  assert.equal(ray.intersectObject(rocker.children[0]).length, 0, 'the paddle alone is missed');
  const hit = pick({ clientX: (p.x + 1) / 2 * 800, clientY: (1 - p.y) / 2 * 800 });
  assert.equal(hit?.kind, 'control', 'the proxy catches it, not the Controls box behind');
  assert.equal(hit.label, 'Power: switch off');
});
