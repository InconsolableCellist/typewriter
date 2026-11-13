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
import { WpKeySampler } from '../audio/wp-keys.js';
import { installPrinter } from './wp/printer.js';
import { installDiskettes } from './wp/diskettes.js';
import { createSimClient } from '../sim/client.js';
import { KEYS } from '../machine/wp-keys.js';
import { loadGlyphs } from '../machine/glyphs.js';
import { loadWordList } from './wp/wordlist.js';
import { installPages } from '../pages/index.js';
import { createUnitMaterials } from '../render/wp/units.js';
import { buildKeyboard } from '../render/wp/keyboard-view.js';
import { buildDiskette } from '../render/wp/diskette-view.js';
import { buildStation, buildDisplay } from '../render/wp/station-view.js';
import { buildPrinter } from '../render/wp/printer-view.js';
import { ViewNav, viewSpec, poseOf, fallbackBoxes, LEGACY_CAMERAS } from '../interact/wp-views.js';
import { makePicker, installWpPointer, makeHighlight } from '../interact/wp-pointer.js';
import { installNavUi } from '../ui/wp-nav.js';
import { ScreenCard } from '../ui/wp-screen-card.js';
import { ROW } from '../wp/screen.js';

/** ctx = { canvas, params, machine, machines, onPick(id) } */
export async function mount(ctx) {
  const { canvas, params, machine } = ctx;
  const geometry = geometryFor(machine);
  const stage = createScene(canvas);
  const { mats } = createMaterials();
  document.title = machine.name;

  const desk = new Desk({ scene: stage.scene, mats });
  desk.load('/assets/models/desk.glb').catch((e) => console.info('desk', e));
  loadRoom(stage.scene, '/assets/hdri/combination_room_2k.exr', parseFloat(params.get('room') ?? '3.0')).catch((e) => console.info('hdri', e));

  // The units, each in its own group at its world origin. The printwheel's faces are the glyphs that print.
  const umats = createUnitMaterials();
  const glyphs = await loadGlyphs('glyphs_wp');
  const builders = {
    station: (u) => buildStation(u.size, umats),
    display: (u) => buildDisplay(u.size, umats, { tilt: machine.units.display.tilt, swivel: machine.units.display.swivel }),
    keyboard: (u) => buildKeyboard(u.size, machine.units.keyboard.slope, umats, { maxAniso: stage.renderer.capabilities.getMaxAnisotropy() }),
    diskette: (u) => buildDiskette(u.size, umats),
    printer: (u) => buildPrinter(u.size, umats, { printer: machine.printer, glyphs, order: geometry.printer.wheel.order }),
  };
  const units = {}, parts = {}, views = {}, footprints = [];
  let displayFace = null;
  for (const [name, u] of Object.entries(geometry.units)) {
    const built = await builders[name](u);
    built.group.name = `unit-${name}`;
    built.group.position.fromArray(u.origin);
    stage.scene.add(built.group);
    units[name] = built.group; parts[name] = built.parts; views[name] = built;
    if (built.face) displayFace = built.face;
    if (!u.on) footprints.push(u.box);
  }
  desk.setFootprints(footprints);
  const unitBoxes = Object.fromEntries(Object.entries(units).map(([n, g]) => [n, boxOf([g])]));   // before paper and diskettes join them

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
  const cold = params.has('cold');
  const sim = await createSimClient({ machine, geometry, glyphs, options: { cold, drives: cold ? [null, null] : drives } });
  const pickables = [];
  const printer = await installPrinter({ stage, machine, geometry, mats, group: units.printer, sim, glyphs, onDevice: (e) => sys?.deviceEvent(e), controls: parts.printer, view: views.printer, pickables });
  devices.printer = printer.device;
  const diskettes = installDiskettes({ stage, machine, geometry, sim, unit: units.diskette, parts: parts.diskette, library, pickables });
  diskettes.onEvent((e) => sys?.deviceEvent(e));
  devices.disk = diskettes.device;
  // The electronics module's power switch. A cold start (?cold) finds everything off and both drives empty: switch on
  // the module and the printer, put the program diskette in the left drive and close its lever.
  devices.power = { on: !cold };
  if (cold) sim.command({ dev: 'station', op: 'power', on: false });   // its fan and the drive motors stand still
  const rocker = parts.station.rocker;
  const setRocker = () => parts.station.setRocker(devices.power.on);
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
  // The keys' own sound comes from the keyboard's mechanism, which runs here on the main thread: a sampler on the same
  // AudioContext plays the recorded beam spring cuts at each stem's felt and top-stop contacts (architecture 10.4).
  const keySounds = new WpKeySampler(machine.audio?.keys);
  const unlockAudio = () => { speaker.unlock(); if (speaker.ctx) keySounds.attach(speaker.ctx);
    if (speaker.ctx && !printer.sim.isMock && !unlockAudio.done && !params.has('localsim')) {   // ?localsim keeps the mechanism on the main thread (machines with no audio device, tests)
     unlockAudio.done = true; printer.sim.unlockAudio(speaker.ctx).catch((e) => console.warn(e)); } };
  const simNow = () => (performance.now() - t0) / 1000;
  const keyboard = new KeyboardHost((e) => sys.deviceEvent(e), simNow);
  keyboard.onSound = (e) => keySounds.play(e, simNow());
  new WpKeyboardInput({ press: (i, f) => keyboard.press(i, f), now: simNow, onFirstKey: () => unlockAudio(), enterIsEnter: () => sys?.screen.cursor.on && sys.screen.cursor.row === ROW.PROMPT });
  window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
  window.addEventListener('beforeunload', (e) => { if (sys.doc) { e.preventDefault(); e.returnValue = ''; } });

  // The CRT on the display's front.
  const screen = params.has('screentest') ? testCardScreen() : sys.screen;
  const crt = new CRT({ renderer: stage.renderer, screen });
  // The glass sits in the display's tilt node, so it tilts and turns with the cabinet.
  const faceParent = displayFace.parent ?? units.display;
  const face = new THREE.Mesh(makeTubeFace(displayFace.w, displayFace.h, displayFace.radius), crt.material);
  face.position.set(displayFace.x, displayFace.y, displayFace.z);
  faceParent.add(face);
  // The screen's own light on the keyboard and desk: shadowless, from a little in front of the glass.
  const spill = new THREE.SpotLight(0x66ff99, 0, 1.5, 1.1, 0.9, 2);
  spill.position.set(displayFace.x, displayFace.y, displayFace.z + 0.03);
  spill.target.position.set(displayFace.x, displayFace.y - 0.4, displayFace.z + 0.6);
  faceParent.add(spill.target);
  faceParent.add(spill);
  stage.fitShadow(machine.deskLayout.extent);

  // Where the camera stands: stations, focus items and the free view (architecture 3.5). It moves only when asked.
  const { camera } = stage;
  const boxes = { ...fallbackBoxes(geometry, machine), ...unitBoxes };
  const named = {
    screen: [face], keyboard: [units.keyboard], controls: [parts.station.rocker, ...parts.display.knobs],
    slots: [...parts.diskette.slots, ...parts.diskette.drives], levers: parts.diskette.levers, file: [parts.diskette.holder],
    panel: [...parts.printer.panelKeys, ...parts.printer.leds, parts.printer.display], mechanism: [parts.printer.platen, parts.printer.carrier],
    paperPath: [units.printer],
  };
  for (const [n, objs] of Object.entries(named)) boxes[n] = boxOf(objs) ?? boxes[n];
  const startId = viewSpec(params.get('view'))?.id ?? LEGACY_CAMERAS[params.get('cam') ?? machine.defaultCamera] ?? 'desk';
  const frame = (id) => poseOf(id, boxes, camera.aspect, camera.fov);
  stage.resize(window.innerWidth, window.innerHeight);
  const start = frame(startId);
  camera.position.fromArray(start.position);
  const orbit = new Orbit(camera, canvas, start.target, { keepInView: false });
  const nav = new ViewNav({
    start: startId, poseOf: frame,
    glide: (pose) => orbit.flyTo(pose, 0.55 + 0.45 * Math.min(1, camera.position.distanceTo(new THREE.Vector3().fromArray(pose.position)) / 1.5)),
    cameraPose: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    context: { coverOpen: () => sim.state[sim.layout.cover] > machine.printer.cover.open / 2 },
  });
  const highlight = makeHighlight(stage.scene);
  const navUi = installNavUi({ nav, highlight });
  const pickAt = makePicker({ camera, canvas, keys: parts.keyboard.keys, pickables, nav, boxes: () => boxes, solids: () => Object.values(units) });
  installWpPointer({
    canvas, orbit, nav, press: (i, f) => keyboard.press(i, f), hint: navUi.hint, show: navUi.show,
    pick: (e) => { const h = pickAt(e); if (h?.kind === 'key') h.label = keyLabel(h.key); return h; },
  });
  const screenCard = new ScreenCard({ renderer: stage.renderer, crt, insets: document.getElementById('insets'), panel: document.getElementById('panel') });

  const panel = buildPanel(ctx, printer.feeder, screenCard);

  // A new window shape frames the same view again, at once: the station's head-on view depends on it.
  const resize = () => { stage.resize(window.innerWidth, window.innerHeight); if (!nav.free) orbit.flyTo(frame(nav.id), 1e-3); };
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
    crt.setPower(devices.power.on);
    crt.update(dt);
    spill.intensity = 0.02 + 0.25 * crt.litFraction;
    stage.composer.render();
    screenCard.render();
    frameTimes[nFt++ % frameTimes.length] = performance.now() - t0;
    window.__frameTimes = frameTimes; window.__frameCount = nFt;
  }
  requestAnimationFrame(loop);

  window.__tw = { stage, machine, geometry, units, parts, desk, orbit, nav, boxes, screenCard, panel, crt, screen, sys, keyboard, devices, printer, pages, diskettes, sim, soft: printer.soft };
  return window.__tw;
}

/** The settings card for this kit: the machine picker, the sheet feeder, the key list and the Screen card's switch. */
function buildPanel(ctx, feeder, screenCard) {
  const el = document.getElementById('panel');
  el.innerHTML = `
    <div class="actions"><button id="a-feeder" aria-pressed="true" title="the printer's sheet feeder lays each sheet in; off, click the fresh paper to lay one">sheet feeder</button><button id="a-screen" title="the Screen card: the display's picture, whatever the camera shows">screen card</button><button id="a-keys" title="how the PC keyboard maps onto the machine's">keys</button></div>
    <div class="note" id="keysNote" hidden>Letters, digits and punctuation: as marked · Alt: CODE · Enter: ENTER at a prompt, RETURN in a document · AltGr or keypad Enter: ENTER · Esc: CANCL ·
      F1 REQST · F2 PRINT · F3 FIND · F4 GO TO · F5 MOVE · F6 LINE ADJ · F7 SPELL · F8 CHG FMT · F9 GET · F10 PAGE END ·
      Delete: DEL · End: END · Insert: MSG · PageDown / PageUp: screen down / up · keys with no PC match: click them ·
      Views (the machine never sees these): Ctrl+Shift+← / → next station · Ctrl+Shift+↓ back · Ctrl+Shift+↑ free view · or keypad 4 / 6, 2, 5</div>
    <div class="actions"><select id="a-machine" title="machine" aria-label="machine"></select></div>`;
  const fb = el.querySelector('#a-feeder');
  fb.addEventListener('click', () => { feeder.on = !feeder.on; fb.setAttribute('aria-pressed', String(feeder.on)); });
  const sb = el.querySelector('#a-screen');
  sb.setAttribute('aria-pressed', String(screenCard.visible));
  sb.addEventListener('click', () => { screenCard.setVisible(!screenCard.visible); sb.setAttribute('aria-pressed', String(screenCard.visible)); sb.blur(); });
  el.querySelector('#a-keys').addEventListener('click', () => { const n = el.querySelector('#keysNote'); n.hidden = !n.hidden; });
  const picker = el.querySelector('#a-machine');
  for (const m of ctx.machines) picker.add(new Option(m.name, m.id));
  picker.value = ctx.machine.id;
  picker.addEventListener('change', () => ctx.onPick(picker.value));
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'type on your keyboard · Enter answers prompts · Alt = CODE, Esc = CANCL · the edge arrows and the bar move the view · ◎ free view';
  return el;
}

/** The world box of some objects as { min, max }, or null. An object with no geometry (a marker) counts as a point. */
const _box = new THREE.Box3(), _one = new THREE.Box3(), _p = new THREE.Vector3(), MARK = new THREE.Vector3(0.04, 0.04, 0.04);
function boxOf(objs) {
  _box.makeEmpty();
  for (const o of objs) {
    if (!o) continue;
    o.updateWorldMatrix(true, true);
    _one.makeEmpty().expandByObject(o);
    if (_one.isEmpty()) _one.setFromCenterAndSize(o.getWorldPosition(_p), MARK);
    _box.union(_one);
  }
  return _box.isEmpty() ? null : { min: _box.min.toArray(), max: _box.max.toArray() };
}

/** A key's legend for the hover label. */
function keyLabel(i) {
  const k = KEYS[i];
  const top = k.top.includes('\n') && [...k.top].length === 3 ? k.top.replace('\n', ' / ') : k.top.replace(/\n/g, ' ') || 'blank';
  return k.front ? `${top}  (CODE: ${k.front.replace(/\n/g, ' ')})` : top;
}
