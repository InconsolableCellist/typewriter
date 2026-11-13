// The word processor's views (architecture.md 3.5): the station graph, the focus items and their framing, the free
// view, the shortcuts the machine never sees, and the rule that a click on a key or a control never moves the camera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { geometryFor } from '../src/machine/index.js';
import { STATIONS, FOCUS, ViewNav, viewSpec, poseOf, framePose, fallbackBoxes, unionBox, targetAt, LEGACY_CAMERAS } from '../src/interact/wp-views.js';
import { installWpPointer } from '../src/interact/wp-pointer.js';
import { shortcutFor } from '../src/ui/wp-nav.js';
import { KEYMAP, CHORDS } from '../src/interact/wp-keymap.js';
import { Orbit } from '../src/interact/orbit.js';

const g = geometryFor(wordproc1980);
const boxes = fallbackBoxes(g, wordproc1980);
const FOV = 29;

function makeNav(start = 'desk', aspect = 1.6) {
  const glides = [];
  let cam = poseOf(start, boxes, aspect, FOV);
  const nav = new ViewNav({
    start, poseOf: (id) => poseOf(id, boxes, aspect, FOV),
    glide: (pose, id) => { glides.push(id); cam = pose; },
    cameraPose: () => cam,
  });
  return { nav, glides, setCamera: (p) => { cam = p; } };
}

test('stations: a row of three units under the desk, the arrows walk it and undo each other', () => {
  assert.deepEqual(Object.keys(STATIONS).sort(), ['computer', 'desk', 'diskettes', 'printer']);
  const row = ['printer', 'computer', 'diskettes'];
  // The row is in the units' order along the desk, left to right.
  const x = (s) => { const b = unionBox(STATIONS[s].boxes.map((n) => boxes[n])); return (b.min[0] + b.max[0]) / 2; };
  for (let i = 1; i < row.length; i++) assert.ok(x(row[i]) > x(row[i - 1]), row[i]);
  for (const s of row) {
    const { left, right } = STATIONS[s];
    if (left) assert.equal(STATIONS[left].right, s, `${s} left then right`);
    if (right) assert.equal(STATIONS[right].left, s, `${s} right then left`);
  }
  assert.equal(STATIONS.desk.left, 'printer');
  assert.equal(STATIONS.desk.right, 'diskettes');
  // Every station can be reached from the desk with the arrows, and Back from each goes up to the desk.
  for (const s of row) {
    const { nav } = makeNav('desk');
    assert.ok(nav.left());
    assert.equal(nav.station, 'printer');
    assert.equal(nav.left(), false, 'the row ends at the printer');
    while (nav.station !== s) assert.ok(nav.right());
    assert.equal(nav.where().left?.id ?? null, STATIONS[s].left);
    nav.back();
    assert.equal(nav.station, 'desk');
    assert.equal(nav.back(), false, 'nothing above the desk');
  }
});

test('focus items: each station has its own, Back returns to the station, and the old presets map to views', () => {
  assert.deepEqual(STATIONS.computer.items, ['screen', 'keyboard', 'notes', 'controls', 'rear']);
  assert.deepEqual(STATIONS.diskettes.items, ['slots', 'levers', 'file', 'manual', 'quickstart']);
  assert.deepEqual(STATIONS.printer.items, ['panel', 'mechanism', 'paperPath']);
  for (const [s, st] of Object.entries(STATIONS)) {
    for (const f of st.items) {
      assert.ok(FOCUS[f], f);
      const { nav, glides } = makeNav(s);
      assert.ok(nav.focus(f));
      assert.equal(nav.id, `${s}/${f}`);
      assert.ok(nav.where().label.includes(FOCUS[f].label));
      assert.ok(nav.where().canBack);
      nav.back();
      assert.equal(nav.id, s);
      assert.deepEqual(glides, [`${s}/${f}`, s]);
    }
  }
  assert.equal(viewSpec('printer/keyboard'), null, 'a focus item belongs to its station');
  assert.equal(viewSpec('nowhere'), null);
  for (const v of Object.values(LEGACY_CAMERAS)) assert.ok(viewSpec(v), v);
  assert.equal(LEGACY_CAMERAS[wordproc1980.defaultCamera], 'desk');
});

test('framing: every view sees its whole box from its own direction, on a wide and on a tall window', () => {
  const ids = Object.entries(STATIONS).flatMap(([s, st]) => [s, ...st.items.map((f) => `${s}/${f}`)]);
  for (const aspect of [1.8, 1.0, 0.55]) {
    const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.02, 12);
    for (const id of ids) {
      const v = viewSpec(id);
      const pose = poseOf(id, boxes, aspect, FOV);
      camera.position.fromArray(pose.position);
      camera.lookAt(new THREE.Vector3().fromArray(pose.target));
      camera.updateMatrixWorld();
      const b = unionBox(v.boxes.map((n) => boxes[n]));
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]).project(camera);
        assert.ok(Math.abs(p.x) <= 1.0001 && Math.abs(p.y) <= 1.0001 && p.z < 1, `${id} at ${aspect}: corner ${i} at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
      }
      // Head-on: a view with no azimuth stands square in front of its target, above it by its elevation.
      const off = new THREE.Vector3().fromArray(pose.position).sub(new THREE.Vector3().fromArray(pose.target));
      if (!v.view.azim) assert.ok(Math.abs(off.x) < 1e-9, id);
      assert.ok(Math.abs(Math.asin(off.y / off.length()) - v.view.elev) < 1e-9, id);
      // A natural distance: no nearer than the box needs, and no farther than a person would stand.
      assert.ok(off.length() < (aspect < 1.5 ? 7 : 3), `${id} at ${aspect}: ${off.length().toFixed(2)} m`);
    }
  }
  // The rear view is from behind, the paper path from the left.
  assert.ok(poseOf('computer/rear', boxes, 1.6, FOV).position[2] < boxes.station.min[2]);
  assert.ok(poseOf('printer/paperPath', boxes, 1.6, FOV).position[0] < boxes.printer.min[0]);
  // The tighter of the two fields sets the distance: a tall window stands back for the width.
  const wide = framePose(boxes.keyboard, FOCUS.keyboard.view, 1.8, FOV), tall = framePose(boxes.keyboard, FOCUS.keyboard.view, 0.55, FOV);
  const dist = (p) => Math.hypot(...p.position.map((v, i) => v - p.target[i]));
  assert.ok(dist(tall) > 2 * dist(wide));
});

test('free view: switching on leaves the camera where it is; switching off glides to the nearest station', () => {
  const { nav, glides, setCamera } = makeNav('computer/keyboard');
  assert.ok(nav.setFree(true));
  assert.deepEqual(glides, [], 'no move into the free view');
  assert.deepEqual(nav.targets(), [], 'no click targets in the free view');
  assert.equal(nav.where().left, null);
  assert.equal(nav.left(), false);
  // The user orbits over to the diskette unit.
  const d = poseOf('diskettes', boxes, 1.6, FOV);
  setCamera({ position: d.position.map((v, i) => v + [0.1, 0.05, -0.08][i]), target: d.target.map((v, i) => v + [0.03, 0, 0.02][i]) });
  nav.toggleFree();
  assert.equal(nav.free, false);
  assert.equal(nav.id, 'diskettes');
  assert.deepEqual(glides, ['diskettes']);
  // Back from the free view is the same as leaving it.
  nav.setFree(true); setCamera(poseOf('printer', boxes, 1.6, FOV));
  nav.back();
  assert.equal(nav.id, 'printer');
});

test('click targets: the smallest box under the click, focus items before stations', () => {
  const { nav } = makeNav('computer');
  const targets = nav.targets();
  assert.deepEqual(targets.filter((t) => t.kind === 'focus').map((t) => t.id), ['computer/screen', 'computer/keyboard', 'computer/notes', 'computer/controls', 'computer/rear']);
  assert.deepEqual(targets.filter((t) => t.kind === 'station').map((t) => t.id), ['printer', 'diskettes']);
  const centre = (b) => b.min.map((v, i) => (v + b.max[i]) / 2);
  assert.equal(targetAt(centre(boxes.screen), targets, boxes).id, 'computer/screen');
  assert.equal(targetAt(centre(boxes.keyboard), targets, boxes).id, 'computer/keyboard');
  assert.equal(targetAt(centre(boxes.diskette), targets, boxes).id, 'diskettes');
  assert.equal(targetAt([0, 2, 3], targets, boxes), null);
  nav.focus('keyboard');
  assert.ok(nav.targets().some((t) => t.id === 'computer' && t.kind === 'station'), 'from a focus item, the station itself');
  assert.ok(!nav.targets().some((t) => t.id === 'computer/keyboard'));
});

test('shortcuts: Ctrl+Shift chords and the keypad, never a key the machine uses', () => {
  const ev = (code, mods = {}) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  assert.equal(shortcutFor(ev('ArrowLeft', { ctrlKey: true, shiftKey: true })), 'left');
  assert.equal(shortcutFor(ev('ArrowRight', { ctrlKey: true, shiftKey: true })), 'right');
  assert.equal(shortcutFor(ev('ArrowDown', { ctrlKey: true, shiftKey: true })), 'back');
  assert.equal(shortcutFor(ev('ArrowUp', { ctrlKey: true, shiftKey: true })), 'free');
  assert.equal(shortcutFor(ev('Numpad5')), 'free');
  // The machine's own keys stay the machine's: arrows, Escape (CANCL), Shift+arrows, Ctrl+letters.
  for (const code of [...Object.keys(KEYMAP), ...Object.keys(CHORDS)]) {
    assert.equal(shortcutFor(ev(code)), null, code);
    assert.equal(shortcutFor(ev(code, { shiftKey: true })), null, code);
    assert.equal(shortcutFor(ev(code, { ctrlKey: true })), null, code);
  }
  for (const code of ['Numpad4', 'Numpad6', 'Numpad2', 'Numpad5', 'Numpad0', 'NumpadDecimal']) assert.ok(!(code in KEYMAP) && !(code in CHORDS), code);
});

// ---- pointer --------------------------------------------------------------------------------------------------------

function rig(start = 'computer') {
  const canvas = new EventTarget();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
  canvas.clientHeight = 500;
  canvas.style = {};
  const camera = new THREE.PerspectiveCamera(FOV, 1.6, 0.02, 12);
  const pose = poseOf(start, boxes, 1.6, FOV);
  camera.position.fromArray(pose.position);
  const orbit = new Orbit(camera, canvas, pose.target, { keepInView: false });
  const flights = [];
  const fly = orbit.flyTo.bind(orbit);
  orbit.flyTo = (p, s) => { flights.push(p); fly(p, s); };
  const nav = new ViewNav({
    start, poseOf: (id) => poseOf(id, boxes, 1.6, FOV), glide: (p) => orbit.flyTo(p, 0.6),
    cameraPose: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
  });
  let under = null;
  const presses = [], clicks = [];
  installWpPointer({ canvas, orbit, nav, pick: () => under, press: (i, f) => presses.push([i, f]) });
  const send = (type, x, y, extra = {}) => canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y, shiftKey: false, ...extra }));
  const drag = (x0, y0, x1, y1, steps = 6, extra) => {
    send('pointerdown', x0, y0, extra);
    for (let i = 1; i <= steps; i++) send('pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, extra);
    send('pointerup', x1, y1, extra);
  };
  const settle = () => { for (let i = 0; i < 120; i++) orbit.update(1 / 60); };
  const snapshot = () => [...camera.position.toArray(), ...orbit.target.toArray()];
  const control = { kind: 'control', entry: { part: () => ({ label: 'Open the lever', onClick: () => clicks.push('lever') }) } };
  return { canvas, camera, orbit, nav, flights, presses, clicks, send, drag, settle, snapshot, control, setUnder: (h) => { under = h; } };
}

test('a click on a control or a key never moves the camera, at a station or in the free view', () => {
  for (const free of [false, true]) {
    const r = rig('computer/keyboard');
    if (free) r.nav.setFree(true);
    r.settle();
    const before = r.snapshot();
    r.setUnder(r.control);
    r.drag(400, 250, 402, 251, 2);                 // a click with a little wobble
    r.drag(400, 250, 520, 330, 8);                 // a press on a control that slides away
    r.setUnder({ kind: 'key', key: 30 });
    r.drag(300, 300, 360, 340, 8);                 // a key held while the pointer wanders
    r.settle();
    assert.deepEqual(r.clicks, ['lever'], 'the click works the control; the slide does not');
    assert.deepEqual(r.presses.map(([i, f]) => [i, f > 0]), [[30, true]]);
    assert.deepEqual(r.snapshot(), before, `camera still (${free ? 'free view' : 'station'})`);
    assert.equal(r.flights.length, 0);
    assert.equal(r.nav.id, 'computer/keyboard');
  }
});

test('at a station, dragging empty space and the wheel leave the camera alone', () => {
  const r = rig('printer');
  r.settle();
  const before = r.snapshot();
  r.setUnder(null);
  r.drag(100, 100, 400, 300, 10);
  r.drag(100, 100, 400, 300, 10, { button: 2 });
  r.canvas.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -300, clientX: 400, clientY: 250 }));
  r.settle();
  assert.deepEqual(r.snapshot(), before);
});

test('a click on a highlighted object glides there; the camera follows a free-view drag as it happens', () => {
  const r = rig('computer');
  r.setUnder({ kind: 'nav', target: { id: 'computer/screen', kind: 'focus', label: 'Screen' } });
  r.drag(400, 200, 401, 200, 1);
  assert.equal(r.nav.id, 'computer/screen');
  assert.equal(r.flights.length, 1);
  r.settle();
  const aim = poseOf('computer/screen', boxes, 1.6, FOV);
  assert.ok(r.camera.position.distanceTo(new THREE.Vector3().fromArray(aim.position)) < 1e-6, 'arrives exactly, nothing pulls it back');

  // The free view: the camera turns with each move of the drag, not at the release (the old orbit's snap).
  r.nav.setFree(true);
  r.setUnder(null);
  const p0 = r.camera.position.clone();
  r.send('pointerdown', 400, 250);
  r.send('pointermove', 460, 250);
  r.orbit.update(1 / 60);
  const p1 = r.camera.position.clone();
  assert.ok(p1.distanceTo(p0) > 0.01, 'moved during the drag');
  for (let i = 0; i < 30; i++) r.orbit.update(1 / 60);   // held still
  assert.ok(r.camera.position.distanceTo(p1) < 1e-9, 'held still, the camera stays');
  r.send('pointerup', 460, 250);
  r.settle();
  assert.ok(r.camera.position.distanceTo(p1) < 1e-9, 'and nothing jumps at the release');

  // Pan far from the desk's centre: no pull back toward a home target.
  r.drag(400, 250, 100, 250, 10, { button: 2 });
  const t = r.orbit.target.clone();
  r.drag(400, 250, 500, 250, 10);
  r.settle();
  assert.ok(r.orbit.target.distanceTo(t) < 1e-9, 'orbiting keeps the panned target');
});
