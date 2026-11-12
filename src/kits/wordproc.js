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
import { installPrinter } from './wp/printer.js';
import { installDiskettes } from './wp/diskettes.js';
import { createSimClient } from '../sim/client.js';
import { KEYS } from '../machine/wp-keys.js';
import { loadGlyphs } from '../machine/glyphs.js';
import { loadWordList } from './wp/wordlist.js';
import { installPages } from '../pages/index.js';
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

  // The software, on a clock that follows the wall clock; the work diskettes persist in IndexedDB.
  const store = await IdbStore.create();
  const library = restoreLibrary(firstRunLibrary(), store);
  const devices = new VirtualDevices();   // its keyboard, printer and disk are replaced by the real ones below
  const speaker = new WpSpeaker();
  devices.kbd = { click: () => speaker.click(), tone: (ms) => speaker.tone(ms) };
  // One mechanism host for the printer and the diskette unit, started warm: both diskettes home with their levers
  // closed. The software reaches them only through the device interface.
  let sys = null;
  const drives = [{ mediaId: PROGRAM_NAME, type: '2D' }, { mediaId: 'WORK01', type: '2D' }];
  const glyphs = await loadGlyphs('glyphs_wp');
  const cold = params.has('cold');
  const sim = await createSimClient({ machine, geometry, glyphs, options: { cold, drives: cold ? [null, null] : drives } });
  const pickables = [];
  const printer = await installPrinter({ stage, machine, geometry, mats, group: units.printer, sim, glyphs, onDevice: (e) => sys?.deviceEvent(e), controls: parts.printer, pickables });
  devices.printer = printer.device;
  const diskettes = installDiskettes({ stage, machine, geometry, sim, unit: units.diskette, parts: parts.diskette, library, pickables });
  diskettes.onEvent((e) => sys?.deviceEvent(e));
  devices.disk = diskettes.device;
  // The electronics module's power switch. A cold start (?cold) finds everything off and both drives empty: switch on
  // the module and the printer, put the program diskette in the left drive and close its lever.
  devices.power = { on: !cold };
  if (cold) sim.command({ dev: 'station', op: 'power', on: false });   // its fan and the drive motors stand still
  const rocker = parts.station.rocker;
  const setRocker = () => { rocker.rotation.x = devices.power.on ? -0.25 : 0.25; };
  setRocker();
  pickables.push({ object: rocker, part: () => ({ label: devices.power.on ? 'Power (on)' : 'Power: switch on', onClick: () => {
    if (devices.power.on) return;
    devices.power.on = true; setRocker();
    sim.command({ dev: 'station', op: 'power', on: true });
    sys.deviceEvent({ dev: 'power', ev: 'on' });
  } }) });
  // The spelling word list is fetched only when Spelling Tasks first loads (architecture 12.3).
  const wordList = () => loadWordList().then((b) => sys.provideWordList(b), (e) => { console.info('word list', e); sys.provideWordList(null); });
  sys = createSystem({ devices, store, library, options: { cold, wordList } });
  loadStudioTextures(mats, printer.paper.material, stage.renderer.capabilities.getMaxAnisotropy(), { only: ['walnut_desk', 'paper_fibre'] }).catch((e) => console.info('textures', e));
  const pages = installPages({ stage, soft: printer.soft, paper: printer.paper, machine: { ...printer.softMachine, deskLayout: machine.deskLayout }, interaction: { picker: { add: (e) => pickables.push(e) } }, hands: { loadPaper: () => printer.loadSheet() } });
  const t0 = performance.now();
  const unlockAudio = () => { speaker.unlock(); if (speaker.ctx && !printer.sim.isMock && !unlockAudio.done && !params.has('localsim')) {   // ?localsim keeps the mechanism on the main thread (machines with no audio device, tests)
     unlockAudio.done = true; printer.sim.unlockAudio(speaker.ctx).catch((e) => console.warn(e)); } };
  const simNow = () => (performance.now() - t0) / 1000;
  const keyboard = new KeyboardHost((e) => sys.deviceEvent(e), simNow);
  new WpKeyboardInput({ press: (i, f) => keyboard.press(i, f), now: simNow, onFirstKey: () => unlockAudio() });
  window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
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
  installOrbitInput(canvas, orbit, stage.camera, pickables, parts.keyboard, (i, f) => keyboard.press(i, f));

  const panel = buildPanel(ctx, machine, orbit, printer.feeder);

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
    printer.update();
    diskettes.update();
    pages.update(dt);
    crt.gain = devices.power.on ? 1 : 0;
    crt.update(dt);
    spill.intensity = 0.02 + 0.25 * crt.litFraction;
    stage.composer.render();
    frameTimes[nFt++ % frameTimes.length] = performance.now() - t0;
    window.__frameTimes = frameTimes; window.__frameCount = nFt;
  }
  requestAnimationFrame(loop);

  window.__tw = { stage, machine, geometry, units, parts, desk, orbit, panel, crt, screen, sys, keyboard, devices, printer, pages, diskettes, sim, soft: printer.soft };
  return window.__tw;
}

/** The settings card for this kit: the machine picker and one button per camera preset. */
function buildPanel(ctx, machine, orbit, feeder) {
  const el = document.getElementById('panel');
  el.innerHTML = `
    <div class="actions">${Object.keys(machine.cameras).map((n) => `<button data-cam="${n}">${n}</button>`).join('')}</div>
    <div class="actions"><button id="a-feeder" aria-pressed="true" title="the printer's sheet feeder lays each sheet in; off, click the fresh paper to lay one">sheet feeder</button><button id="a-keys" title="how the PC keyboard maps onto the machine's">keys</button></div>
    <div class="note" id="keysNote" hidden>Letters, digits and punctuation: as marked · Alt: CODE · AltGr: ENTER · Enter: RETURN · Esc: CANCL ·
      F1 REQST · F2 PRINT · F3 FIND · F4 GO TO · F5 MOVE · F6 LINE ADJ · F7 SPELL · F8 CHG FMT · F9 GET · F10 PAGE END ·
      Delete: DEL · End: END · Insert: MSG · PageDown / PageUp: screen down / up · keys with no PC match: click them</div>
    <div class="actions"><select id="a-machine" title="machine" aria-label="machine"></select></div>`;
  const fb = el.querySelector('#a-feeder');
  fb.addEventListener('click', () => { feeder.on = !feeder.on; fb.setAttribute('aria-pressed', String(feeder.on)); });
  el.querySelector('#a-keys').addEventListener('click', () => { const n = el.querySelector('#keysNote'); n.hidden = !n.hidden; });
  for (const b of el.querySelectorAll('[data-cam]')) b.addEventListener('click', () => orbit.flyTo(machine.cameras[b.dataset.cam]));
  const picker = el.querySelector('#a-machine');
  for (const m of ctx.machines) picker.add(new Option(m.name, m.id));
  picker.value = machine.id;
  picker.addEventListener('change', () => ctx.onPick(picker.value));
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'type on your keyboard · Alt = CODE, AltGr = ENTER, F1-F10 = function keys, Esc = CANCL · drag to orbit · wheel to zoom · buttons move the camera';
  return el;
}

/**
 * Pointer input: a click on something pickable (the page pile, the fresh paper) acts on it; a press on a key holds
 * that key down with a finger until release; anything else orbits (left), pans (right or shift) and zooms (wheel).
 */
function keyLabel(i) {
  const k = KEYS[i];
  const top = k.top.replace('\n', ' / ') || 'blank';
  return k.front ? `${top}  (CODE: ${k.front})` : top;
}

function installOrbitInput(canvas, orbit, camera, pickables, keyboardParts, press) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hitAt = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const live = pickables.filter((p) => p.enabled?.() ?? true);
    const hit = ray.intersectObjects([...keyboardParts.keys, ...live.map((p) => p.object)], true)[0];
    if (!hit) return null;
    const key = keyboardParts.keys.indexOf(hit.object);
    if (key >= 0) return { key };
    let o = hit.object, entry = null;
    while (o && !entry) { entry = live.find((p) => p.object === o); o = o.parent; }
    return entry ? { entry } : null;
  };
  let mode = null, lx = 0, ly = 0, moved = 0, held = null, click = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    lx = e.clientX; ly = e.clientY; moved = 0;
    canvas.setPointerCapture(e.pointerId);
    const hit = e.button === 0 ? hitAt(e) : null;
    if (hit?.key !== undefined) { held = hit.key; press(held, 1.2); mode = 'key'; return; }
    click = hit?.entry ?? null;
    mode = e.button === 2 || e.shiftKey ? 'pan' : 'rotate';
    orbit.dragging = true;
  });
  // Hovering names what is under the pointer: a key's legend, or what a click will do.
  const tip = document.getElementById('labelTip');
  let tipAt = 0;
  const hover = (e) => {
    if (!tip || performance.now() - tipAt < 60) return;
    tipAt = performance.now();
    const hit = hitAt(e);
    const label = hit?.key !== undefined ? keyLabel(hit.key) : hit?.entry?.part()?.label;
    tip.style.display = label ? 'block' : 'none';
    if (label) { tip.textContent = label; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 12}px`; }
    canvas.style.cursor = label ? 'pointer' : '';
  };
  canvas.addEventListener('pointerleave', () => { if (tip) tip.style.display = 'none'; });
  canvas.addEventListener('pointermove', (e) => {
    if (!mode) { hover(e); return; }
    if (mode === 'key') return;
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'pan') orbit.pan(dx, dy); else orbit.rotate(dx, dy);
  });
  const end = () => {
    if (mode === 'key' && held !== null) { const k = held; setTimeout(() => press(k, 0), 40); held = null; }
    if (click && moved < 4) click.part()?.onClick?.();
    click = null; mode = null; orbit.dragging = false;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    orbit.zoom(Math.exp(e.deltaY * 0.0012), ((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => orbit.reset());
}
