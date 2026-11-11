// The word-processor kit: puts a system machine (machine.kind === 'system') on the desk. Milestone M0: each unit is
// a plain block at its documented size and placement, so the layout, shadows, contact shade and camera presets can
// be checked before any mechanism exists. See docs/displaywriter/architecture.md, sections 3 and 11.
import * as THREE from 'three';
import { geometryFor } from '../machine/index.js';
import { createScene, loadRoom } from '../render/scene.js';
import { createMaterials, loadStudioTextures } from '../render/materials.js';
import { Desk } from '../render/desk.js';
import { Orbit } from '../interact/orbit.js';
import { CRT, COLS, ROWS, makeTubeFace } from '../render/wp/crt.js';
import { createSystem } from '../wp/index.js';
import { VirtualDevices } from '../wp/devices/virtual.js';
import { firstRunLibrary } from '../wp/textpack/samples.js';
import { PROGRAM_NAME } from '../wp/disk/library.js';
import { IdbStore, restoreLibrary } from './wp/store.js';
import { KeyboardHost } from './wp/keyboard-host.js';
import { WpKeyboardInput } from '../interact/wp-keyboard.js';
import { WpSpeaker } from '../audio/wp-speaker.js';
import { createUnitMaterials, buildStation, buildDisplay, buildKeyboard, buildDiskette, buildPrinter } from '../render/wp/units.js';

/** ctx = { canvas, params, machine, machines, onPick(id) } */
export async function mount(ctx) {
  const { canvas, params, machine } = ctx;
  const geometry = geometryFor(machine);
  const stage = createScene(canvas);
  const { mats } = createMaterials();
  document.title = machine.name;
  const insets = document.getElementById('insets'); if (insets) insets.style.display = 'none';   // the Print Point window arrives with the printer

  const desk = new Desk({ scene: stage.scene, mats });
  desk.load('/assets/models/desk.glb').catch((e) => console.info('desk', e));
  loadRoom(stage.scene, '/assets/hdri/combination_room_2k.exr', parseFloat(params.get('room') ?? '3.0')).catch((e) => console.info('hdri', e));
  loadStudioTextures(mats, null, stage.renderer.capabilities.getMaxAnisotropy(), { only: ['walnut_desk'] }).catch((e) => console.info('textures', e));

  // The units, each in its own group at its world origin.
  const umats = createUnitMaterials();
  const builders = {
    station: (u) => buildStation(u.size, umats),
    display: (u) => buildDisplay(u.size, umats),
    keyboard: (u) => buildKeyboard(u.size, machine.units.keyboard.slope, umats),
    diskette: (u) => buildDiskette(u.size, umats),
    printer: (u) => buildPrinter(u.size, umats),
  };
  const units = {}, parts = {}, footprints = [];
  let displayFace = null;
  for (const [name, u] of Object.entries(geometry.units)) {
    const built = builders[name](u);
    built.group.name = `unit-${name}`;
    built.group.position.fromArray(u.origin);
    stage.scene.add(built.group);
    units[name] = built.group; parts[name] = built.parts;
    if (built.face) displayFace = built.face;
    if (!u.on) footprints.push(u.box);
  }
  desk.setFootprints(footprints);

  // The software, on a clock that follows the wall clock. The diskettes are timed analytically until the diskette unit's
  // mechanism exists (M7); the work diskettes persist in IndexedDB.
  const store = await IdbStore.create();
  const library = restoreLibrary(firstRunLibrary(), store);
  const devices = new VirtualDevices({ drives: [{ mediaId: PROGRAM_NAME, type: '2D' }, { mediaId: 'WORK01', type: '2D' }] });
  const speaker = new WpSpeaker();
  devices.kbd = { click: () => speaker.click(), tone: (ms) => speaker.tone(ms) };
  const sys = createSystem({ devices, store, library, options: { cold: params.has('cold') } });
  const t0 = performance.now();
  const simNow = () => (performance.now() - t0) / 1000;
  const keyboard = new KeyboardHost((e) => sys.deviceEvent(e), simNow);
  new WpKeyboardInput({ press: (i, f) => keyboard.press(i, f), now: simNow, onFirstKey: () => speaker.unlock() });
  window.addEventListener('pointerdown', () => speaker.unlock(), { once: true });
  window.addEventListener('beforeunload', (e) => { if (sys.doc) { e.preventDefault(); e.returnValue = ''; } });

  // The CRT on the display's front.
  const screen = params.has('screentest') ? testCardScreen() : sys.screen;
  const crt = new CRT({ renderer: stage.renderer, screen });
  const face = new THREE.Mesh(makeTubeFace(0.245, 0.17), crt.material);
  face.position.set(displayFace.x, displayFace.y, displayFace.z);
  units.display.add(face);
  // The screen's own light on the keyboard and desk: shadowless, from a little in front of the glass.
  const spill = new THREE.SpotLight(0x66ff99, 0, 1.5, 1.1, 0.9, 2);
  spill.position.set(displayFace.x, displayFace.y, displayFace.z + 0.03);
  spill.target.position.set(displayFace.x, -0.25, displayFace.z + 0.6);
  units.display.add(spill.target);
  units.display.add(spill);
  stage.fitShadow(machine.deskLayout.extent);

  const preset = machine.cameras[params.get('cam') ?? machine.defaultCamera] ?? machine.cameras[machine.defaultCamera];
  stage.camera.position.fromArray(preset.position);
  const ext = machine.deskLayout.extent;
  const orbit = new Orbit(stage.camera, canvas, preset.target, { extent: { across: ext.halfX, up: 0.4, depth: ext.halfZ } });
  installOrbitInput(canvas, orbit);

  const panel = buildPanel(ctx, machine, orbit);

  const resize = () => stage.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize); resize();

  let last = performance.now(), nFt = 0;
  const frameTimes = new Float32Array(240);
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t0 = performance.now();
    orbit.update(dt);
    const t = simNow();
    keyboard.advance(t);
    sys.advance(t);
    const keys = parts.keyboard.keys, x = keyboard.mech.x, dir = parts.keyboard.pressDir;
    for (let i = 0; i < keys.length; i++) keys[i].position.copy(keys[i].userData.rest).addScaledVector(dir, x[i]);
    crt.update(dt);
    spill.intensity = 0.02 + 0.25 * crt.litFraction;
    stage.composer.render();
    frameTimes[nFt++ % frameTimes.length] = performance.now() - t0;
    window.__frameTimes = frameTimes; window.__frameCount = nFt;
  }
  requestAnimationFrame(loop);

  window.__tw = { stage, machine, geometry, units, parts, desk, orbit, panel, crt, screen, sys, keyboard, devices };
  return window.__tw;
}

/** The settings card for this kit: the machine picker and one button per camera preset. */
function buildPanel(ctx, machine, orbit) {
  const el = document.getElementById('panel');
  el.innerHTML = `
    <div class="actions">${Object.keys(machine.cameras).map((n) => `<button data-cam="${n}">${n}</button>`).join('')}</div>
    <div class="actions"><select id="a-machine" title="machine" aria-label="machine"></select></div>`;
  for (const b of el.querySelectorAll('[data-cam]')) b.addEventListener('click', () => orbit.flyTo(machine.cameras[b.dataset.cam]));
  const picker = el.querySelector('#a-machine');
  for (const m of ctx.machines) picker.add(new Option(m.name, m.id));
  picker.value = machine.id;
  picker.addEventListener('change', () => ctx.onPick(picker.value));
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'type on your keyboard · Alt = CODE, AltGr = ENTER, F1-F10 = function keys, Esc = CANCL · drag to orbit · wheel to zoom · buttons move the camera';
  return el;
}

/** Orbit, pan and zoom with the pointer. The typewriter kit does this inside Interaction, which picks parts first. */
function installOrbitInput(canvas, orbit) {
  let mode = null, lx = 0, ly = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    mode = e.button === 2 || e.shiftKey ? 'pan' : 'rotate';
    lx = e.clientX; ly = e.clientY;
    orbit.dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!mode) return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    if (mode === 'pan') orbit.pan(dx, dy); else orbit.rotate(dx, dy);
  });
  const end = () => { mode = null; orbit.dragging = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    orbit.zoom(Math.exp(e.deltaY * 0.0012), ((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => orbit.reset());
}

/** A screen object in the software's format, filled from 25 strings. */
function screenFrom(lines, cursor = { row: 1, col: 1, on: false }, attrsFor = () => 0) {
  const chars = new Uint8Array(COLS * ROWS), attrs = new Uint8Array(COLS * ROWS);
  lines.forEach((ln, r) => { for (let c = 0; c < Math.min(COLS, ln.length); c++) { chars[r * COLS + c] = ln.charCodeAt(c) & 0xff; attrs[r * COLS + c] = attrsFor(r, c); } });
  return { chars, attrs, cursor, version: 1 };
}

function testCardScreen() {
  const L = [];
  for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += String.fromCharCode(32 + ((r * COLS + c) % 95)); L.push(s); }
  return screenFrom(L, { row: 13, col: 41, on: true }, (r, c) => (r === 2 ? 1 : r === 4 ? 2 : r === 6 ? 4 : 0));
}
