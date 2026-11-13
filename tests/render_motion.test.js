// The render caches' evidence (src/render/motion.js) and the governor (src/render/governor.js): what counts as the
// scene having moved, when a shadow map, the AO or the Print Point view is drawn again, and the render size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { layoutFields, MechanismWatch, SceneWatch, SceneMotion, CameraWatch, PassCache, REFRESH_FRAMES, POS_TOL, VEL_TOL } from '../src/render/motion.js';
import { Governor, renderPixelRatio, deviceTier, TIERS, MAX_PIXELS } from '../src/render/governor.js';
import { makeLayout } from '../src/sim/layout.js';
import { makeWpLayout } from '../src/sim/wp/layout.js';
import frontstrike from '../src/machine/frontstrike1926.js';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { geometryFor } from '../src/machine/index.js';
import { MechanicalSim, SUBSTEP_HZ } from '../src/sim/mechanics.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { SoftWorld } from '../src/soft/index.js';

// ---- The mechanism ----------------------------------------------------------------------------------------------------

test('layout spans cover every slot once, in order', () => {
  for (const L of [makeLayout(deriveGeometry(frontstrike)), makeWpLayout(geometryFor(wordproc1980))]) {
    const f = layoutFields(L);
    let at = 0;
    for (const s of f) { assert.equal(s.at, at, s.name); assert.ok(s.n >= 1, s.name); at += s.n; }
    assert.equal(at, L.length);
  }
});

test('mechanism: still is still; a moved coordinate or a rate over the threshold is motion; clocks and meters are not', () => {
  const L = makeLayout(deriveGeometry(frontstrike));
  const s = new Float32Array(L.length);
  const w = new MechanismWatch();
  assert.equal(w.moving(s, L), true, 'the first frame has nothing to compare with');
  assert.equal(w.moving(s, L), false);
  s[L.time] += 0.016; s[L.rms] = 0.3; s[L.dspLoad] = 0.5; s[L.lastForce] = 12;
  assert.equal(w.moving(s, L), false, 'clock and meters');
  s[L.barTheta + 7] += POS_TOL * 3;
  assert.equal(w.moving(s, L), true, 'a bar moved');
  assert.equal(w.moving(s, L), false);
  s[L.carriageV] = VEL_TOL * 2;
  assert.equal(w.moving(s, L), true, 'the carriage has a speed');
  s[L.carriageV] = VEL_TOL / 4;
  assert.equal(w.moving(s, L), false, 'a creep under the threshold');
  s[L.keyV + 3] = -0.5;
  assert.equal(w.moving(s, L), true, 'a negative rate counts');
  s[L.keyV + 3] = NaN;
  assert.equal(w.moving(s, L), true, 'a broken snapshot counts as motion');
});

test('word processor mechanism: spinning diskettes and fans are not motion, the printwheel is', () => {
  const L = makeWpLayout(geometryFor(wordproc1980));
  const s = new Float32Array(L.length);
  const w = new MechanismWatch();
  w.moving(s, L);
  for (let k = 0; k < 10; k++) {
    s[L.diskAngle] += 0.6; s[L.diskOmega] = 37; s[L.fanOmega] = 300; s[L.motorOmega] = 37; s[L.time] += 1 / 60;
    assert.equal(w.moving(s, L), false);
  }
  s[L.wheelOmega] = 2;
  assert.equal(w.moving(s, L), true);
});

// ---- The scene --------------------------------------------------------------------------------------------------------

function smallScene() {
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.castShadow = true; key.position.set(-1, 1, 1);
  scene.add(key, key.target);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
  box.castShadow = true;
  const smoke = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  const sheetGeo = new THREE.PlaneGeometry(0.2, 0.3, 4, 4);
  const sheet = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial());
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.01, 0.1, 0.01), new THREE.MeshStandardMaterial(), 4);
  for (let i = 0; i < 4; i++) bars.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 0.02, 0, 0));
  scene.add(box, smoke, sheet, bars);
  return { scene, key, box, smoke, sheet, bars };
}

test('scene: nothing changed reports nothing; a moved caster, light, sheet vertex or instance does', () => {
  const { scene, key, box, sheet, bars } = smallScene();
  const w = new SceneWatch(scene);
  assert.equal(w.check().geometry, true, 'the first look');
  assert.deepEqual(w.check(), { geometry: false, appearance: false });
  box.position.x += 0.001;
  assert.equal(w.check().geometry, true, 'a box moved a millimetre');
  assert.equal(w.check().geometry, false);
  key.position.y += 0.01;
  assert.equal(w.check().geometry, true, 'the key light moved');
  key.shadow.camera.left -= 0.1;
  assert.equal(w.check().geometry, true, 'the key shadow was refitted');
  const p = sheet.geometry.attributes.position;
  p.needsUpdate = true;
  assert.equal(w.check().geometry, false, 'a re-upload of the same vertices is not motion');
  p.setZ(3, p.getZ(3) + 0.002); p.needsUpdate = true;
  assert.equal(w.check().geometry, true, 'the sheet bent');
  bars.setMatrixAt(2, new THREE.Matrix4().makeRotationX(0.3)); bars.instanceMatrix.needsUpdate = true;
  assert.equal(w.check().geometry, true, 'a typebar rose');
  bars.instanceMatrix.needsUpdate = true;
  assert.equal(w.check().geometry, false);
  box.visible = false;
  assert.equal(w.check().geometry, true, 'a caster hidden');
  box.visible = true;
  assert.equal(w.check().geometry, true, 'and shown again');
  const extra = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  scene.add(extra);
  assert.equal(w.check().geometry, true, 'a model arrived');
});

test('scene: slow drift under the tolerance is caught once it adds up', () => {
  const { scene, box } = smallScene();
  const w = new SceneWatch(scene);
  w.check();
  let caught = -1;
  for (let i = 0; i < 20; i++) { box.position.x += 3e-7; if (w.check().geometry) { caught = i; break; } }
  assert.ok(caught >= 1 && caught <= 4, `caught after ${caught + 1} steps of 0.3 um`);
});

test('scene: transparent smoke moving, a light dimming and a texture arriving are not geometry', () => {
  const { scene, key, smoke, box } = smallScene();
  const w = new SceneWatch(scene);
  w.check();
  smoke.position.y += 0.05;
  assert.deepEqual(w.check(), { geometry: false, appearance: false }, 'smoke casts nothing and is not in the AO');
  key.intensity = 2;
  assert.deepEqual(w.check(), { geometry: false, appearance: true }, 'dimmer');
  box.material.needsUpdate = true;
  assert.deepEqual(w.check(), { geometry: false, appearance: true }, 'material rebuilt');
  scene.environmentIntensity = 0.5;
  assert.deepEqual(w.check(), { geometry: false, appearance: true }, 'room light');
  assert.deepEqual(w.check(), { geometry: false, appearance: false });
});

test('scene: the walk visits each visible mesh, for patching materials before first use', () => {
  const { scene, box } = smallScene();
  const hidden = new THREE.Group(); hidden.visible = false;
  const inside = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  hidden.add(inside); scene.add(hidden);
  const seen = new Set();
  new SceneWatch(scene).check((m) => seen.add(m));
  assert.ok(seen.has(box));
  assert.ok(!seen.has(inside), 'not drawn, not visited (it is, the frame it is shown)');
});

test('camera watch: a still camera is still, an orbit step or a zoom is not', () => {
  const cam = new THREE.PerspectiveCamera(30, 1.5, 0.02, 12);
  cam.position.set(0, 0.5, 1); cam.updateMatrixWorld();
  const w = new CameraWatch();
  assert.equal(w.changed(cam), true);
  assert.equal(w.changed(cam), false);
  cam.position.x += 1e-4; cam.updateMatrixWorld();
  assert.equal(w.changed(cam), true);
  cam.fov = 29; cam.updateProjectionMatrix();
  assert.equal(w.changed(cam), true);
});

// ---- Scheduling -------------------------------------------------------------------------------------------------------

/** What LookRenderPass does around the main render, with three's shadow renderer reduced to its flags. */
function frame(m, renderer) {
  m.update();
  renderer.needsUpdate = m.scheduleShadows();
  const drawn = [];
  if (renderer.needsUpdate) for (const l of m.watch.lights) if (l.shadow.needsUpdate) { l.shadow.needsUpdate = false; l.shadow.map ??= {}; drawn.push(l); }
  m.shadowsDrawn();
  return drawn;
}

test('shadows: the key map is drawn once, then only when something moved or a mark says so', () => {
  const { scene, key, box } = smallScene();
  const m = new SceneMotion(scene), r = {};
  assert.deepEqual(frame(m, r), [key], 'first frame');
  assert.equal(key.shadow.autoUpdate, false, 'taken over');
  for (let i = 0; i < 30; i++) assert.deepEqual(frame(m, r), [], 'at rest');
  box.rotation.y += 0.1;
  assert.deepEqual(frame(m, r), [key], 'a caster moved');
  assert.deepEqual(frame(m, r), []);
  m.observe({ grabbing: true });
  assert.deepEqual(frame(m, r), [key], 'a grab');
  key.intensity = 0.5;
  assert.deepEqual(frame(m, r), [], 'a dimmer light needs no new map');
});

test('shadows: at rest the map is still redrawn every REFRESH_FRAMES', () => {
  const { scene, key } = smallScene();
  const m = new SceneMotion(scene), r = {};
  let n = 0;
  for (let i = 0; i < REFRESH_FRAMES * 3; i++) n += frame(m, r).length;
  assert.equal(n, 3);
  assert.ok(key.shadow.map);
});

test('shadows: a throttled light keeps its own schedule, but its requests are dropped while its map is current', () => {
  const { scene, box } = smallScene();
  const spill = new THREE.SpotLight(0x00ff00, 1);
  spill.castShadow = true; spill.shadow.autoUpdate = false; spill.shadow.needsUpdate = true;
  scene.add(spill, spill.target);
  const m = new SceneMotion(scene), r = {};
  assert.ok(frame(m, r).includes(spill), 'the first request is honoured');
  spill.shadow.needsUpdate = true;
  assert.ok(!frame(m, r).includes(spill), 'nothing moved');
  assert.equal(spill.shadow.autoUpdate, false);
  box.position.z += 0.01;
  assert.ok(!frame(m, r).includes(spill), 'stale, but its owner did not ask this frame');
  spill.shadow.needsUpdate = true;
  assert.ok(frame(m, r).includes(spill), 'stale and asked');
});

test('marks: mechanism, paper awake, grab and easing count as motion; a spill change only as a look change', () => {
  const { scene } = smallScene();
  const m = new SceneMotion(scene);
  m.update();
  const L = makeLayout(deriveGeometry(frontstrike));
  const s = new Float32Array(L.length);
  const asleep = { paperSim: { asleep: true }, sheetParked: false };
  m.observe({ state: s, layout: L, soft: asleep });   // first sight of the snapshot
  m.update();
  const step = (ev) => { const g = m.geomGen, l = m.lookGen; m.observe(ev); m.update(); return { geom: m.geomGen !== g, look: m.lookGen !== l }; };
  assert.deepEqual(step({ state: s, layout: L, soft: asleep }), { geom: false, look: false });
  s[L.platenOmega] = 1;
  assert.deepEqual(step({ state: s, layout: L, soft: asleep }), { geom: true, look: true });
  s[L.platenOmega] = 0;
  assert.deepEqual(step({ state: s, layout: L, soft: { paperSim: { asleep: false } } }), { geom: true, look: true });
  assert.deepEqual(step({ state: s, layout: L, soft: { paperSim: { asleep: false }, sheetParked: true } }), { geom: false, look: false }, 'a parked sheet is not drawn');
  assert.deepEqual(step({ soft: {} }), { geom: true, look: true }, 'a soft world that cannot say counts as awake');
  assert.deepEqual(step({ easing: true }), { geom: true, look: true });
  assert.deepEqual(step({ glow: 0.1 }), { geom: false, look: true });
  assert.deepEqual(step({ glow: 0.1 }), { geom: false, look: false });
  assert.deepEqual(step({ glow: 0.12 }), { geom: false, look: true });
});

test('pass cache: stale on a new generation, an invalidation, an extra reason or after its refresh', () => {
  const c = new PassCache(30);
  assert.equal(c.stale(0, 0), true);
  c.drawn(0, 0);
  assert.equal(c.stale(0, 1), false);
  assert.equal(c.stale(1, 1), true);
  assert.equal(c.stale(0, 1, true), true);
  assert.equal(c.stale(0, 30), true);
  c.invalidate();
  assert.equal(c.stale(0, 2), true);
});

// ---- The real mechanism and paper come to rest -----------------------------------------------------------------------

test('front strike: typing is motion, and a few seconds after the last key the scene counts as still', async () => {
  const geometry = deriveGeometry(frontstrike);
  const glyphs = await loadGlyphs();
  const sim = new MechanicalSim({ machine: frontstrike, geometry, glyphs });
  const layout = makeLayout(geometry);
  const world = new SoftWorld({ machine: frontstrike, geometry, glyphs });
  const state = new Float32Array(layout.length);
  sim.writeSnapshot(state);
  world.step(0, state, layout);
  const m = new SceneMotion(new THREE.Scene());
  const steps = Math.round(SUBSTEP_HZ / 60);
  const frameOf = () => {
    for (let i = 0; i < steps; i++) sim.step();
    sim.writeSnapshot(state);
    world.step(1 / 60, state, layout);
    sim.setEnv(world.env());
    const ev = []; sim.drainEvents(ev);
    for (const e of ev) if (e.type === 'strike') world.applyStrike(e);
    return m.observe({ state, layout, soft: world });
  };
  world.spawnSheet({ onTable: { offset: 0.005 } });
  for (let i = 0; i < 60; i++) frameOf();
  const key = geometry.keys.findIndex((k) => k.kind === 'print' && k.lower === 'n');
  sim.pressKey(key, 22, 0.11);
  let busy = 0;
  for (let i = 0; i < 20; i++) busy += frameOf() ? 1 : 0;
  assert.ok(busy >= 15, `a keystroke moves things for most of its frames (${busy} of 20)`);
  let still = -1;
  for (let i = 0; i < 60 * 30; i++) if (!frameOf()) { still = i; break; }
  assert.ok(still >= 0, 'comes to rest within 30 s');
  let quiet = 0;
  for (let i = 0; i < 120; i++) quiet += frameOf() ? 0 : 1;
  assert.ok(quiet >= 110, `and stays still (${quiet} of 120 frames), reason when not: ${m.lastReason}`);
});

// ---- Render size and governor -----------------------------------------------------------------------------------------

test('render size: the display\'s pixels by default, the budget only when supersampling', () => {
  const px = (w, h, o = {}) => { const r = renderPixelRatio({ w, h, ...o }); return [Math.floor(w * r), Math.floor(h * r)]; };
  assert.deepEqual(px(1600, 1000, { dpr: 1 }), [1600, 1000]);
  assert.deepEqual(px(1280, 720, { dpr: 1 }), [1280, 720]);
  assert.deepEqual(px(1920, 1080, { dpr: 1 }), [1920, 1080]);
  assert.deepEqual(px(1600, 1000, { dpr: 1, supersample: true }), [2262, 1414], 'as before: 3.2 MP');
  assert.deepEqual(px(1280, 720, { dpr: 1, supersample: true }), [2385, 1341]);
  assert.deepEqual(px(1440, 900, { dpr: 2 }), [2262, 1414], 'a retina laptop: the budget, as before');
  assert.deepEqual(px(3840, 2160, { dpr: 1 }), [3840, 2160], 'never below one pixel per CSS pixel');
  assert.deepEqual(px(390, 844, { dpr: 3, maxRatio: TIERS.phone.maxRatio }), [585, 1266], 'phone at 1.5');
  assert.ok(renderPixelRatio({ w: 1600, h: 1000, dpr: 2, quality: 0.85 }) < renderPixelRatio({ w: 1600, h: 1000, dpr: 2 }));
  for (const [w, h] of [[800, 600], [1600, 1000], [2560, 1440]]) {
    const r = renderPixelRatio({ w, h, dpr: 2, supersample: true });
    assert.ok(w * h * r * r <= MAX_PIXELS * 1.0001 || r === 1);
  }
});

test('device tier: coarse pointer is a phone, ?tier= overrides', () => {
  assert.equal(deviceTier({ coarse: true }), 'phone');
  assert.equal(deviceTier({ coarse: false }), 'desktop');
  assert.equal(deviceTier({ coarse: true, search: '?tier=desktop' }), 'desktop');
  assert.equal(deviceTier({ coarse: false, search: '?tier=phone' }), 'phone');
  const p = TIERS.phone;
  assert.deepEqual([p.maxRatio, p.aoTier, p.pcssSamples, p.pcssBlocker, p.keyShadow], [1.5, 1, 8, 8, 1024]);
  assert.ok(p.maxAniso >= 4 && p.maxAniso <= 8);
});

/** Runs a governor over `seconds` of frames `ms` apart; returns [time of each action, action]. */
function drive(g, ms, seconds, t0 = 0) {
  const out = [];
  for (let t = t0; t < t0 + seconds * 1000; t += ms) { const a = g.sample(t); if (a) out.push([t, a]); }
  return out;
}

test('governor: a 5 fps device steps down within seconds of the warm-up (long frames are slow frames)', () => {
  const g = new Governor();
  const acts = drive(g, 200, 40);
  assert.ok(acts.length >= 3, JSON.stringify(acts));
  assert.equal(acts[0][1], 'down');
  assert.ok(acts[0][0] < 22000, `first step at ${acts[0][0]} ms`);
  assert.ok(acts[1][0] - acts[0][0] <= 6500, 'then every few seconds');
});

test('governor: a tab switch is not a slow frame, and a fast device never steps down', () => {
  const g = new Governor();
  let t = 0;
  const out = [];
  for (let i = 0; i < 4000; i++) { t += i % 300 === 299 ? 5000 : 16.7; const a = g.sample(t); if (a) out.push(a); }
  assert.deepEqual(out, []);
});

test('governor: room to spare asks once to supersample; a slowdown then gives it up for good', () => {
  const g = new Governor({ canSupersample: true });
  const a1 = drive(g, 16.7, 30);
  assert.deepEqual(a1.map((a) => a[1]), ['up']);
  const a2 = drive(g, 25, 4, 30000);
  assert.equal(a2[0][1], 'revert');
  const a3 = drive(g, 16.7, 60, 34000);
  assert.deepEqual(a3, [], 'no second try');
  const h = new Governor({ canSupersample: false });
  assert.deepEqual(drive(h, 16.7, 60), []);
});
