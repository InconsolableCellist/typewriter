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
import { CreakVoice } from '../audio/wp-creak.js';
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
import { makePicker, installWpPointer } from '../interact/wp-pointer.js';
import { WayMarkers } from '../ui/wp-markers.js';
import { createPostits } from '../render/wp/postits.js';
import { installNavUi } from '../ui/wp-nav.js';
import { createManual, MANUAL_URL } from '../render/wp/manual.js';
import { createPacket } from '../render/wp/packet.js';
import { installManualReader } from '../ui/wp-manual.js';
import { installPdfViewer } from '../ui/wp-pdf-viewer.js';
import { ScreenCard } from '../ui/wp-screen-card.js';
import { installStationControls, addHitProxy } from './wp/station.js';
import { installAtmosphere } from './wp/atmosphere.js';

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
  const creak = new CreakVoice();   // the display's bearing, turned by a hand (station.js)
  devices.kbd = { click: () => speaker.click(), tone: (ms) => speaker.tone(ms) };
  // One mechanism host for the printer and the diskette unit, started warm: both diskettes home with their levers
  // closed. The software reaches them only through the device interface.
  let sys = null;
  const drives = [{ mediaId: PROGRAM_NAME, type: '2D' }, { mediaId: 'WORK01', type: '2D' }];
  const cold = params.has('cold');
  const sim = await createSimClient({ machine, geometry, glyphs, options: { cold, drives: cold ? [null, null] : drives } });
  const pickables = [];
  const t0 = performance.now();
  const simNow = () => (performance.now() - t0) / 1000;
  const printer = await installPrinter({ stage, machine, geometry, mats, group: units.printer, sim, glyphs, onDevice: (e) => sys?.deviceEvent(e), controls: parts.printer, view: views.printer, pickables });
  devices.printer = printer.device;
  const diskettes = installDiskettes({ stage, machine, geometry, sim, unit: units.diskette, parts: parts.diskette, library, pickables });
  diskettes.onEvent((e) => sys?.deviceEvent(e));
  devices.disk = diskettes.device;
  // The electronics module's power switch. A cold start (?cold) finds everything off and both drives empty: switch on
  // the module and the printer, put the program diskette in the left drive and close its lever. Switched off, the
  // station's fan and drive motors run down (the mechanism host, and the sound with it), the CRT collapses and the
  // software stops; switched on again, a new system runs the power-on test and loads the program, as ?cold does.
  devices.power = { on: !cold };
  let poweredAt = cold ? null : -60;   // warm: long past its self-test
  if (cold) sim.command({ dev: 'station', op: 'power', on: false });   // its fan and the drive motors stand still
  const rocker = parts.station.rocker;
  // Both power switches are small: each gets a pick target a little larger than its well (the owner could not hit it).
  addHitProxy(rocker, 0.009);
  addHitProxy(parts.printer.power, 0.009);
  const setRocker = () => parts.station.setRocker(devices.power.on);
  setRocker();
  // The spelling word list is fetched only when Spelling Tasks first loads (architecture 12.3).
  const wordList = () => loadWordList().then((b) => sys.provideWordList(b), (e) => { console.info('word list', e); sys.provideWordList(null); });
  const makeSystem = (coldStart) => createSystem({ devices, store, library, options: { cold: coldStart, wordList, t0: simNow() } });
  const switchPower = (on) => {
    if (on === devices.power.on) return;
    devices.power.on = on; setRocker();
    sim.command({ dev: 'station', op: 'power', on });
    if (on) { poweredAt = simNow(); sys = makeSystem(true); if (!params.has('screentest')) { crt.screen = sys.screen; crt.lastVersion = -1; } }
    else { poweredAt = null; sys.powerOff(); }
  };
  pickables.push({ object: rocker, part: () => ({ label: devices.power.on ? 'Power: switch off' : 'Power: switch on', onClick: () => switchPower(!devices.power.on) }) });
  sys = makeSystem(cold);
  loadStudioTextures(mats, printer.paper.material, stage.renderer.capabilities.getMaxAnisotropy(), { only: ['walnut_desk', 'paper_fibre'] }).catch((e) => console.info('textures', e));
  const pages = installPages({ stage, soft: printer.soft, paper: printer.paper, machine: { ...printer.softMachine, deskLayout: machine.deskLayout }, interaction: { picker: { add: (e) => pickables.push(e) } }, hands: { loadPaper: () => printer.loadSheet() } });
  // The keys' own sound comes from the keyboard's mechanism, which runs here on the main thread: a sampler on the same
  // AudioContext plays the recorded beam spring cuts at each stem's felt and top-stop contacts (architecture 10.4).
  const keySounds = new WpKeySampler(machine.audio?.keys);
  const unlockAudio = () => { speaker.unlock(); if (speaker.ctx) { keySounds.attach(speaker.ctx); creak.attach(speaker.ctx); atmosphere.attachAudio(); }
    if (speaker.ctx && !printer.sim.isMock && !unlockAudio.done && !params.has('localsim')) {   // ?localsim keeps the mechanism on the main thread (machines with no audio device, tests)
     unlockAudio.done = true; printer.sim.unlockAudio(speaker.ctx).catch((e) => console.warn(e)); } };
  const keyboard = new KeyboardHost((e) => sys.deviceEvent(e), simNow);
  keyboard.onSound = (e) => keySounds.play(e, simNow());
  new WpKeyboardInput({ press: (i, f) => keyboard.press(i, f), now: simNow, onFirstKey: () => unlockAudio() });
  window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
  window.addEventListener('beforeunload', (e) => { if (sys.doc) { e.preventDefault(); e.returnValue = ''; } });

  // The CRT on the display's front.
  const screen = params.has('screentest') ? testCardScreen() : sys.screen;   // a new system after a power cycle brings its own
  const crt = new CRT({ renderer: stage.renderer, screen });
  // The glass sits in the display's tilt node, so it tilts and turns with the cabinet.
  const faceParent = displayFace.parent ?? units.display;
  const face = new THREE.Mesh(makeTubeFace(displayFace.w, displayFace.h, displayFace.radius), crt.material);
  face.position.set(displayFace.x, displayFace.y, displayFace.z);
  faceParent.add(face);
  stage.fitShadow(machine.deskLayout.extent);

  // Where the camera stands: stations, focus items and the free view (architecture 3.5). It moves only when asked.
  const { camera } = stage;
  const boxes = { ...fallbackBoxes(geometry, machine), ...unitBoxes };
  const named = {
    screen: [face], keyboard: [units.keyboard], controls: [parts.station.rocker, ...parts.display.knobs],
    slots: [...parts.diskette.slots, ...parts.diskette.drives], levers: parts.diskette.levers, file: [parts.diskette.holder],
    panel: [...parts.printer.panelKeys, ...parts.printer.leds, parts.printer.display, parts.printer.power], mechanism: [parts.printer.platen, parts.printer.carrier],
    paperPath: [units.printer],
  };
  for (const [n, objs] of Object.entries(named)) boxes[n] = boxOf(objs) ?? boxes[n];
  // The operator's sticky notes, on the desk right of the keyboard, in front of the diskette unit.
  const kb = boxes.keyboard, dk = boxes.diskette, deskY = kb.min[1];
  const nx = Math.max(kb.max[0], dk.min[0]) + 0.055, nz = Math.max(dk.max[2], kb.min[2]) + 0.075;
  const notes = createPostits({ scene: stage.scene, renderer: stage.renderer, spots: [
    [nx, deskY, nz + 0.07, 0.10], [nx + 0.09, deskY, nz + 0.035, -0.06], [nx + 0.18, deskY, nz + 0.075, 0.07],
  ] });
  boxes.notes = notes.box;
  // IBM's manual on the diskette unit's top opens the scan on bitsavers; our quick-start packet on the desk opens the
  // reader, which is installed before the view shortcuts so that, open, it takes every key ahead of them and of the
  // machine (Esc is CANCL).
  const reader = installManualReader();
  // IBM's manual itself: the scan on bitsavers, shown in a frame over the desk (not copied to this site).
  const pdfViewer = installPdfViewer({ url: MANUAL_URL, title: 'IBM Displaywriter System Operator Reference Guide, Textpack 4/Reportpack (S544-2036-0)' });
  const ml = machine.deskLayout.manual, du = units.diskette.position;
  const manual = createManual({ scene: stage.scene, renderer: stage.renderer, at: [du.x + ml.at[0], du.y + ml.at[1], du.z + ml.at[2]], yaw: ml.yaw });
  boxes.manual = manual.box;
  pickables.push({ object: manual.hit, part: () => ({ label: 'IBM Operator Reference Guide · read the scanned manual', onClick: () => pdfViewer.open() }) });
  const qs = machine.deskLayout.quickStart;
  const packet = createPacket({ scene: stage.scene, renderer: stage.renderer, at: [qs.x, deskY, qs.z], yaw: qs.yaw });
  boxes.packet = packet.box;
  pickables.push({ object: packet.hit, part: () => ({ label: 'Quick start: read the packet', onClick: () => reader.open() }) });
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
  // The camera moves only by the way markers, the bar and the edge arrows: a click on an object works it or nothing.
  const markers = new WayMarkers({ nav, boxes: () => boxes, camera, canvas });
  const navUi = installNavUi({ nav, highlight: null, markers });
  const pickAt = makePicker({ camera, canvas, keys: parts.keyboard.keys, pickables, nav: { targets: () => [] }, boxes: () => boxes, solids: () => Object.values(units) });
  installWpPointer({
    canvas, orbit, nav, press: (i, f) => keyboard.press(i, f), hint: navUi.hint, show: navUi.show,
    pick: (e) => { const h = pickAt(e); if (h?.kind === 'key') h.label = keyLabel(h.key); return h; },
  });
  const station = installStationControls({
    parts, crt, limits: { tilt: machine.units.display.tilt, swivel: machine.units.display.swivel },
    storage: safeStorage(), tick: () => speaker.tick(), creak, poweredAt: () => poweredAt, now: simNow, pickables,
  });
  const screenCard = new ScreenCard({ renderer: stage.renderer, crt, insets: document.getElementById('insets'), panel: document.getElementById('panel') });

  const panel = buildPanel(ctx, printer.feeder, screenCard);
  // Time of day, weather and the screen's green glow on the keyboard and desk (the room's light at night).
  const atmosphere = installAtmosphere({ stage, machine, crt, face: { ...displayFace, parent: faceParent }, panel, audio: () => speaker.ctx, storage: safeStorage() });

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
    station.update(dt);
    pages.update(dt);
    crt.setPower(devices.power.on);
    crt.update(dt);
    atmosphere.update(dt);
    stage.composer.render();
    markers.update();
    screenCard.render();
    frameTimes[nFt++ % frameTimes.length] = performance.now() - t0;
    window.__frameTimes = frameTimes; window.__frameCount = nFt;
  }
  requestAnimationFrame(loop);

  window.__tw = { stage, machine, geometry, units, parts, desk, orbit, nav, boxes, screenCard, panel, crt, screen, get sys() { return sys; }, keyboard, devices, printer, pages, diskettes, sim, soft: printer.soft, station, switchPower, manual, packet, reader, atmosphere, environment: atmosphere.environment, ambience: atmosphere.ambience };
  return window.__tw;
}

/** The settings card for this kit: the machine picker, the sheet feeder, the key list and the Screen card's switch. */
function buildPanel(ctx, feeder, screenCard) {
  const el = document.getElementById('panel');
  el.innerHTML = `
    <div class="actions"><button id="a-feeder" aria-pressed="true" title="the printer's sheet feeder lays each sheet in; off, click the fresh paper to lay one">sheet feeder</button><button id="a-screen" title="the Screen card: the display's picture, whatever the camera shows">screen card</button><button id="a-keys" title="how the PC keyboard maps onto the machine's">keys</button></div>
    <div class="note" id="keysNote" hidden>Letters, digits and punctuation: as marked · Alt: CODE · AltGr (right Alt) or keypad Enter: ENTER · Enter: RET · Esc: CANCL ·
      F1 REQST · F2 PRINT · F3 FIND · F4 GO TO · F5 MOVE · F6 LINE ADJ · F7 SPELL · F8 CHG FMT · F9 GET · F10 PAGE END ·
      Delete: DEL · End: END · Insert: MSG · PageDown / PageUp: screen down / up · keys with no PC match: click them ·
      Views (the machine never sees these): Ctrl+Shift+← / → next station · Ctrl+Shift+↓ back · Ctrl+Shift+↑ free view · or keypad 4 / 6, 2, 5</div>
    <div class="actions"><select id="a-machine" title="machine" aria-label="machine"></select></div>`;
  const fb = el.querySelector('#a-feeder');
  // The same flag as the feeder's gate on the printer: either one sets it, both show it.
  const showFeeder = (on) => fb.setAttribute('aria-pressed', String(on));
  feeder.onChange(showFeeder); showFeeder(feeder.on);
  fb.addEventListener('click', () => { feeder.toggle(); fb.blur(); });
  const sb = el.querySelector('#a-screen');
  sb.setAttribute('aria-pressed', String(screenCard.visible));
  sb.addEventListener('click', () => { screenCard.setVisible(!screenCard.visible); sb.setAttribute('aria-pressed', String(screenCard.visible)); sb.blur(); });
  el.querySelector('#a-keys').addEventListener('click', () => { const n = el.querySelector('#keysNote'); n.hidden = !n.hidden; });
  const picker = el.querySelector('#a-machine');
  for (const m of ctx.machines) picker.add(new Option(m.name, m.id));
  picker.value = ctx.machine.id;
  picker.addEventListener('change', () => ctx.onPick(picker.value));
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'type on your keyboard · right Alt = ENTER, Enter = RET, left Alt = CODE, Esc = CANCL · the circles, the edge arrows and the bar move the view · ◉ hides the circles · ◎ free view';
  return el;
}

/** localStorage, or null where the browser refuses it (a private window, blocked site data). */
function safeStorage() { try { return window.localStorage; } catch { return null; } }

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
