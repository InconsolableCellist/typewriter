// The word processor's room: the shared environment without a lamp, and the CRT glow's scaling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { installEnvironment } from '../src/render/environment.js';
import { screenOutput, glowSeen, loadAtmosphere } from '../src/kits/wp/atmosphere.js';

function fakeStage() {
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-0.75, 0.62, 0.42);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  scene.add(key, key.target, rim);
  let fits = 0;
  return { scene, key, rim, renderer: { toneMappingExposure: 1 }, look: { exposure: 1 }, fitShadow: () => { fits++; }, get fits() { return fits; } };
}
const lights = (scene) => { let n = 0; scene.traverse((o) => { if (o.isSpotLight) n++; }); return n; };

test('a desk with lamp: false gets the room but no lamp, no lamp light and no overhead', () => {
  assert.equal(wordproc1980.deskLayout.lamp, false);
  const stage = fakeStage();
  const env = installEnvironment({ stage, machine: wordproc1980 });
  assert.equal(env.hasLamp, false);
  assert.equal(env.lampObject, null);
  assert.equal(lights(stage.scene), 0);
  env.setTime('night');
  env.setLamp(true);
  env.deskKick(0.3);
  assert.equal(env.lampOn, false);
  for (let i = 0; i < 200; i++) env.update(1 / 30);
  assert.ok(env.ambient < 0.2 && env.dark > 0.9, `ambient ${env.ambient} dark ${env.dark}`);
  assert.ok(stage.renderer.toneMappingExposure > 1.1);
  assert.ok(stage.fits > 0, 'the key light\'s shadow follows the moving sun over the wide desk');
  env.flash(1); env.update(0.02);
  assert.ok(env.flashValue > 0.3 && stage.rim.intensity > 2);
});

test('a typewriter (no desk layout) still gets its lamp, which comes on in the dark', () => {
  const stage = fakeStage();
  const env = installEnvironment({ stage, machine: { id: 'tw' } });
  assert.equal(env.hasLamp, true);
  assert.equal(lights(stage.scene), 2);
  env.setTime('night');
  assert.equal(env.lampOn, true);
  env.update(1 / 30);
  assert.equal(stage.fits, 0);
});

test('the glow follows the screen: power, beam level, contrast and how much of it is lit', () => {
  const base = { bright: 1, hv: 1, gain: 1, lit: 0.07, raster: 0.022 };
  assert.equal(screenOutput({ ...base, bright: 0 }), 0);
  assert.equal(screenOutput({ ...base, hv: 0 }), 0);
  assert.ok(screenOutput({ ...base, lit: 0.2 }) > screenOutput(base));
  assert.ok(screenOutput({ ...base, gain: 1.7 }) > screenOutput(base));
  assert.ok(screenOutput({ ...base, bright: 1.45 }) > screenOutput(base));
  assert.ok(screenOutput({ ...base, lit: 0 }) > 0, 'the bare raster glows a little');
  assert.ok(glowSeen(0.1) > 3 * glowSeen(1), 'subtle by day, clear at night');
});

test('the remembered choices are read back, and nonsense falls back to a clear day with sound', () => {
  const store = (v) => ({ getItem: () => v });
  assert.deepEqual(loadAtmosphere(store(JSON.stringify({ time: 1, weather: 'storm', sound: false }))), { time: 1, weather: 'storm', sound: false });
  assert.deepEqual(loadAtmosphere(store('{bad')), { time: 'day', weather: 'clear', sound: true });
  assert.deepEqual(loadAtmosphere(null), { time: 'day', weather: 'clear', sound: true });
});
