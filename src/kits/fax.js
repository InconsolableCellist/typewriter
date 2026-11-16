// The fax kit: puts the Sharp FO-70 on the desk (machine.kind === 'fax'; docs/fax/architecture.md 6). The stage and
// the desk, the machine (the Blender model, src/render/fax/fo70-view.js, or the block-out with ?blockout), the desk's
// things, the stations, focus items and way markers of the shared view code with the fax's graph, the room's time of
// day and weather, and the working machine behind the SimClient (src/sim/fax/station.js: mechanism, firmware, scanner,
// head and the exchange), which moves to the audio thread at the first gesture. M7 (plan.md): every panel key clicked
// or typed (decision 14), the handset lifted to hear the line, the LCD on the panel and in an inset, the printed strip
// growing out of the slot line by line and cut, the cut pages falling onto the received pile (click to read), the
// document tray's sample documents and an uploaded image (decision 21), and the card index. Reached with
// ?machine=faxfo70.
import * as THREE from 'three';
import { geometryFor } from '../machine/index.js';
import { createScene, loadRoom } from '../render/scene.js';
import { createMaterials, loadStudioTextures } from '../render/materials.js';
import { Desk } from '../render/desk.js';
import { Orbit } from '../interact/orbit.js';
import { ViewNav, viewSpec, poseOf } from '../interact/wp-views.js';
import { makePicker, installWpPointer } from '../interact/wp-pointer.js';
import { WayMarkers } from '../ui/wp-markers.js';
import { installNavUi } from '../ui/wp-nav.js';
import { FAX_GRAPH, FAX_CAMERAS, faxBoxes } from '../machine/fax-views.js';
import { installEnvironment, TIMES, WEATHERS } from '../render/environment.js';
import { Ambience } from '../audio/ambience.js';
import { envRowHtml, bindEnvRow } from '../ui/panel.js';
import { createSimClient } from '../sim/client.js';
import { compileBeforeFirstFrame, trackProgramLinks } from '../render/warmup.js';
import { buildBlockout, buildDeskThings } from './fax/blockout.js';
import { PrintedStrip, ReceivedPile, FeederSheet } from './fax/paper.js';
import { installFaxUi } from '../ui/fax-ui.js';
import { PAGES as SAMPLE_PAGES } from '../fax/image/pages.js';
import { CARDS } from '../fax/remote/directory.js';

// The real model's view, when the Blender work has delivered it (architecture.md 6.2). import.meta.glob finds it if
// the file exists and is an empty map if not, so the kit builds either way.
const MODEL_VIEWS = import.meta.glob('../render/fax/fo70-view.js');
const STORE_KEY = 'fax.atmosphere';
const MACHINE_STORE = 'faxfo70.store';        // the firmware's settings and journal (decisions 11 and 13)
const SAMPLES = [['memo', 'Memo'], ['chart', 'Test chart'], ['cover', 'Cover sheet'], ['menu', 'Menu'], ['drawing', 'Drawing']];
/** The real keyboard (decision 14): key -> the panel's key, or 'hook'. Everything else is clicked. */
const KEYMAP = { Enter: 'start', Escape: 'stop', c: 'copyHelp', r: 'redial', h: 'hook', f: 'function', s: 'speaker' };
const KEYS_HELP = [
  ['0-9 * #', 'the keypad'], ['Enter', 'START'], ['Esc', 'STOP'], ['C', 'COPY/HELP'], ['R', 'REDIAL'],
  ['H', 'the handset: lift / put back'], ['F', 'FUNCTION'], ['S', 'SPEAKER'],
  ['click', 'every other key on the panel: A-E/POLL, SPEED DIAL, HOLD/SEARCH, VOLUME, RESOLUTION'],
];
const deg = Math.PI / 180;

/**
 * The machine's view: the model's, { group, parts } in the body's frame, from fo70-view.js's buildFo70View(machine,
 * opts) (or its default export), else the block-out. ?blockout keeps the block-out.
 */
async function buildMachine(machine, params, opts) {
  const load = MODEL_VIEWS['../render/fax/fo70-view.js'];
  if (load && !params.has('blockout')) {
    try {
      const mod = await load();
      const build = mod.buildFo70View ?? mod.buildFo70 ?? mod.default;
      if (typeof build === 'function') {
        const v = await build(machine, opts);
        if (v?.group) return { ...v, model: true };
      }
    } catch (e) { console.warn('fax model not loaded, the block-out stands in', e); }
  }
  return { ...buildBlockout(machine), model: false };
}

/** ctx = { canvas, params, machine, machines, onPick(id) } */
export async function mount(ctx) {
  const { canvas, params, machine } = ctx;
  const geometry = geometryFor(machine);
  const stage = createScene(canvas);
  trackProgramLinks(stage.renderer);
  const { mats } = createMaterials();
  document.title = machine.name;

  const desk = new Desk({ scene: stage.scene, mats });
  desk.load('/assets/models/desk.glb').catch((e) => console.info('desk', e));
  loadRoom(stage.scene, '/assets/hdri/combination_room_1k.exr', parseFloat(params.get('room') ?? '3.0')).catch((e) => console.info('hdri', e));
  loadStudioTextures(mats, null, stage.renderer.capabilities.getMaxAnisotropy(), { only: ['walnut_desk'] }).catch((e) => console.info('textures', e));

  // The machine, at the body's world origin; the desk's things at their spots.
  const view = await buildMachine(machine, params, { renderer: stage.renderer, geometry });
  view.group.name = 'unit-body';
  view.group.position.fromArray(geometry.units.body.origin);
  stage.scene.add(view.group);
  const things = buildDeskThings(stage.scene, machine.deskLayout);
  desk.setFootprints([geometry.units.body.box]);
  stage.fitShadow(machine.deskLayout.extent);

  // The mechanism host, warm: the starter roll in, the handset on its cradle (?cold: no roll).
  const cold = params.has('cold');
  let stored = null;
  try { stored = JSON.parse(window.localStorage?.getItem(MACHINE_STORE) ?? 'null'); } catch { stored = null; }
  const sim = await createSimClient({ machine, geometry, glyphs: null, options: { cold, storage: stored } });
  const parts = view.parts ?? {};
  const ui = installFaxUi();
  const fax = installFaxMachine({ sim, machine, geometry, view, parts, ui, params });

  // Clicks: the handset lifts and goes back; the panel lifts on its hinge and drops shut.
  const pickables = [];
  let coverGrab = null;
  if (parts.handset) {
    pickables.push({ object: parts.handset, part: () => {
      const on = sim.state[sim.layout.onCradle] > 0.5;
      return { label: on ? 'Handset: lift it' : 'Handset: put it back', onClick: () => sim.command({ dev: 'handset', op: on ? 'lift' : 'replace' }) };
    } });
  }
  if (parts.cover) {
    pickables.push({ object: parts.cover, part: () => {
      const open = sim.state[sim.layout.coverClosed] < 0.5;
      return { label: open ? 'Panel: let it down' : 'Panel: lift it to reach the paper', onClick: () => {
        if (coverGrab !== null) { sim.release(coverGrab); coverGrab = null; }
        if (!open) coverGrab = sim.grab('cover', 0, { target: 100 * deg });
        else coverGrab = sim.grab('cover', 0, { target: 0, maxF: 0.3 });
        setTimeout(() => { if (coverGrab !== null) { sim.release(coverGrab); coverGrab = null; } }, 1500);
      } };
    } });
  }

  // Where the camera stands: the fax's graph in the shared view code. It moves only when asked.
  const { camera } = stage;
  const boxes = faxBoxes(geometry, machine);
  for (const [n, o] of Object.entries({ handset: parts.handset, panel: parts.panel, display: parts.display })) boxes[n] = boxOf([o]) ?? boxes[n];
  for (const [n, m] of Object.entries(things)) boxes[n] = boxOf([m]) ?? boxes[n];
  const startId = viewSpec(params.get('view'), FAX_GRAPH)?.id ?? FAX_CAMERAS[params.get('cam') ?? machine.defaultCamera] ?? 'desk';
  const frame = (id) => poseOf(id, boxes, camera.aspect, camera.fov, FAX_GRAPH);
  stage.resize(window.innerWidth, window.innerHeight);
  const start = frame(startId);
  camera.position.fromArray(start.position);
  const orbit = new Orbit(camera, canvas, start.target, { keepInView: false });
  const nav = new ViewNav({
    start: startId, graph: FAX_GRAPH, poseOf: frame,
    glide: (pose) => orbit.flyTo(pose, 0.55 + 0.45 * Math.min(1, camera.position.distanceTo(new THREE.Vector3().fromArray(pose.position)) / 1.5)),
    cameraPose: () => ({ position: camera.position.toArray(), target: orbit.target.toArray() }),
    context: { coverOpen: () => sim.state[sim.layout.coverClosed] < 0.5 },
  });
  const markers = new WayMarkers({ nav, boxes: () => boxes, camera, canvas });
  const navUi = installNavUi({ nav, highlight: null, markers });
  // The desk's things and the paper are controls too: the card index, the document folder, the received pile.
  if (things.cardIndex) pickables.push({ object: things.cardIndex, part: () => ({ label: 'Card index: the numbers', onClick: () => ui.cards(CARDS) }) });
  if (things.documents) pickables.push({ object: things.documents, part: () => ({ label: 'Documents: lay one in the feeder', onClick: () => fax.chooseDocument() }) });
  if (things.receivedPile) things.receivedPile.visible = false;
  pickables.push({ object: fax.pile.group, enabled: () => fax.pile.pages.length > 0, part: () => ({ label: 'Received: read the pages', onClick: () => ui.page(fax.pile.pages) }) });
  const pickAt = makePicker({ camera, canvas, keys: parts.keys ?? [], pickables, nav: { targets: () => [] }, boxes: () => boxes, solids: () => [view.group] });
  const mechKeys = machine.mech.panel.keys;
  const press = (i, f) => sim.command({ dev: 'panel', op: 'finger', key: mechKeys[i], force: f > 0 ? 2.5 : 0 });
  installWpPointer({ canvas, orbit, nav, press, hint: navUi.hint, show: navUi.show, pick: pickAt });
  installKeyboard({ ui, fax });

  // The room: the typewriters' time of day, weather and lamp, and their rain and thunder on the kit's AudioContext.
  const panel = buildPanel(ctx);
  installFaxRow(panel, ui, fax);
  const environment = installEnvironment({ stage, machine, interaction: { picker: { add: (e) => pickables.push(e) } } });
  let audioCtx = null;
  const ambience = new Ambience({ environment, context: () => audioCtx });
  installAtmosphereRow(panel, environment, ambience);

  // The first gesture makes the AudioContext and hands the mechanism to the audio thread (?localsim keeps it here).
  const unlock = () => {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    ambience.attach();
    if (!params.has('localsim')) sim.unlockAudio(audioCtx).catch((e) => console.warn(e));
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  const resize = () => { stage.resize(window.innerWidth, window.innerHeight); if (!nav.free) orbit.flyTo(frame(nav.id), 1e-3); };
  window.addEventListener('resize', resize); resize();

  let last = performance.now(), nFt = 0;
  const frameTimes = new Float32Array(240);
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t0 = performance.now();
    orbit.update(dt);
    pose(sim, view, parts);
    fax.update(dt);
    environment.update(dt);
    stage.motion.observe({ state: sim.state, layout: sim.layout, easing: environment.easing });
    stage.composer.render();
    markers.update();
    frameTimes[nFt++ % frameTimes.length] = performance.now() - t0;
    window.__frameTimes = frameTimes; window.__frameCount = nFt;
    stage.govern(now);
  }
  await compileBeforeFirstFrame(stage, [desk.mat]);
  requestAnimationFrame(loop);
  import('./audio-prefetch.js').then((m) => m.prefetchAudioWhenIdle(machine, { worklet: !params.has('localsim') })).catch(() => {});

  window.__tw = { stage, machine, geometry, view, parts, things, desk, orbit, nav, boxes, sim, panel, environment, ambience, markers, ui, fax };
  return window.__tw;
}

/** The snapshot onto the model: the handset off its cradle, the panel lifted. The block-out has nothing else to move. */
function pose(sim, view, parts) {
  const s = sim.state, L = sim.layout;
  if (parts.handset) {
    const lifted = s[L.onCradle] < 0.5;
    parts.handset.visible = !lifted || view.model;          // M0: a lifted handset is in the hand, off the desk
  }
  if (parts.cover) parts.cover.rotation.x = -s[L.cover];
  if (parts.rollBay) parts.rollBay.visible = s[L.cover] > 0.05;
  view.update?.(s, L);
}

/** The settings card: the machine picker, and the time-of-day and weather row below it. */
function buildPanel(ctx) {
  const el = document.getElementById('panel');
  el.innerHTML = `<div class="actions"><select id="a-machine" title="machine" aria-label="machine"></select></div>`;
  const picker = el.querySelector('#a-machine');
  for (const m of ctx.machines) picker.add(new Option(m.name, m.id));
  picker.value = ctx.machine.id;
  picker.addEventListener('change', () => ctx.onPick(picker.value));
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'click the keys (Enter START, Esc STOP, digits) · the handset to lift it · the folder for a document · the cards for numbers · ◎ free view';
  return el;
}

/** The time-of-day strip, the weather buttons and the weather-sound switch, remembered in localStorage. */
function installAtmosphereRow(panel, environment, ambience) {
  panel.insertAdjacentHTML('beforeend', `${envRowHtml()}
    <div class="actions"><label class="toggle" title="rain and thunder"><input type="checkbox" id="wxs" checked><span>WEATHER SOUND</span></label></div>`);
  let storage = null;
  try { storage = window.localStorage; } catch { storage = null; }
  let saved = null;
  try { saved = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null'); } catch { saved = null; }
  const wxs = panel.querySelector('#wxs');
  const save = () => { try { storage?.setItem(STORE_KEY, JSON.stringify({ time: environment.timeValue, weather: environment.weather, sound: wxs.checked })); } catch { /* lasts the visit */ } };
  wxs.checked = saved?.sound !== false;
  ambience.setEnabled(wxs.checked);
  wxs.addEventListener('change', () => { ambience.setEnabled(wxs.checked); save(); wxs.blur(); });
  environment.onChange((st) => { ambience.setWeather(st.weather); save(); });
  const t = saved?.time;
  if ((typeof t === 'number' && t >= 0 && t <= 1) || TIMES.includes(t)) environment.setTime(t);
  if (WEATHERS.includes(saved?.weather)) environment.setWeather(saved.weather);
  bindEnvRow(panel, environment);
}

/** The world box of some objects as { min, max }, or null. */
const _box = new THREE.Box3(), _one = new THREE.Box3();
function boxOf(objs) {
  _box.makeEmpty();
  for (const o of objs) {
    if (!o) continue;
    o.updateWorldMatrix(true, true);
    _one.makeEmpty().expandByObject(o);
    _box.union(_one);
  }
  return _box.isEmpty() ? null : { min: _box.min.toArray(), max: _box.max.toArray() };
}

/**
 * The working machine's side of the kit: the host's device events onto the LCD, the strip, the pile and the
 * documents; the document tray; the worker that reads a sheet's CIS lines ahead (src/fax/image/sheet-scan.js); the
 * firmware's store.
 */
function installFaxMachine({ sim, machine, geometry, view, parts, ui, params }) {
  const L = sim.layout;
  const strip = new PrintedStrip({ exitAt: machine.mech.printer.exitAt });
  const origin = geometry.units.body.origin;
  const pileAt = machine.deskLayout.receivedPile;
  const pile = new ReceivedPile({ pile: { x: pileAt.x - origin[0], z: pileAt.z - origin[2] } });
  const feeder = new FeederSheet();
  view.group.add(strip.mesh, pile.group, feeder.group);
  const pages = new Map();          // sheet id -> page image, until it has gone through
  const queue = [];                 // sheets in the feeder, in feeding order
  let nextId = 1;
  // The LCD: the model's canvas on its glass, or one made here on the block-out's display box.
  let drawLcd = view.lcd?.draw ?? null;
  if (!drawLcd && parts.display) drawLcd = blockoutLcd(parts.display);
  ui.showLcd(!params.has('nolcd'));
  let worker = null;
  try { worker = new Worker(new URL('../fax/image/scan-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }
  if (worker) worker.onmessage = (e) => { const m = e.data; sim.command({ dev: 'doc', op: 'raw', id: m.id, res: m.res, y0: m.y0, raw: m.raw }); };
  sim.on('device', (e) => {
    switch (e.dev) {
      case 'lcd': drawLcd?.(e.text); ui.setLcd(e.text); break;
      case 'print':
        if (e.darkness) strip.line(e.coord, e.darkness, sim.state[L.paperLead]);
        else if (e.ev === 'cut' && e.length != null) pile.add(strip.cut(e));
        break;
      case 'scan':
        // The sheet is at the read line: its raw lines are read ahead in the worker (standard and fine first).
        if (e.ev === 'ready' && e.at && worker && pages.has(e.at.id)) worker.postMessage({ id: e.at.id, page: pages.get(e.at.id), pose: e.at, res: ['standard', 'fine', 'superfine'] });
        break;
      case 'feeder':
        if (e.ev === 'out') { const i = queue.indexOf(e.id); if (i >= 0) queue.splice(i, 1); feeder.out(e.id); pages.delete(e.id); }
        break;
      case 'store':
        try {
          const all = JSON.parse(window.localStorage?.getItem(MACHINE_STORE) ?? '{}') ?? {};
          all[e.key] = e.value;
          window.localStorage?.setItem(MACHINE_STORE, JSON.stringify(all));
        } catch { /* kept for the visit */ }
        break;
      default:
    }
  });

  /** Lay a page image (pages.js form) face down in the feeder, a little askew as a hand lays it. */
  function place(page, title = page.title ?? page.name) {
    if (queue.length >= 5) return null;
    const id = `doc${nextId++}`;
    pages.set(id, page);
    queue.push(id);
    feeder.add(id, { thumb: backThumb(page), widthMm: page.widthMm, heightMm: page.heightMm, index: queue.length - 1 });
    sim.command({ dev: 'doc', op: 'place', sheets: [{ id, page, skew: (Math.random() - 0.5) * 0.004, offset: (Math.random() - 0.5) * 0.001 }] });
    return { id, title };
  }
  const sample = (name) => SAMPLE_PAGES[name]({ dpmm: 8 });
  let thumbCache = null;

  return {
    strip, pile, feeder, queue,
    place, placeSample: (name) => place(sample(name), name),
    chooseDocument() {
      thumbCache ??= SAMPLES.map(([name, title]) => ({ name, title, thumb: frontThumb(sample(name)) }));
      ui.documents(thumbCache, {
        pick: (name) => place(sample(name), name),
        upload: async (file) => { const p = await imagePage(file); if (p) place(p, file.name); },
      });
    },
    /** A click on a panel key (the mechanism's name). */
    tap(key) { sim.command({ dev: 'panel', op: 'tap', key }); },
    toggleHandset() { const on = sim.state[L.onCradle] > 0.5; sim.command({ dev: 'handset', op: on ? 'lift' : 'replace' }); },
    update(dt) {
      const s = sim.state;
      strip.update(s[L.paperU], s[L.paperLead]);
      pile.update(dt);
      feeder.update(dt, queue[0], s[L.sheetS]);
    },
  };
}

/** The real keyboard (decision 14). */
function installKeyboard({ ui, fax }) {
  window.addEventListener('keydown', (e) => {
    if (ui.isOpen || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const tgt = e.target;
    if (tgt instanceof HTMLInputElement || tgt instanceof HTMLSelectElement || tgt instanceof HTMLTextAreaElement) return;
    const k = /^[0-9*#]$/.test(e.key) ? e.key : KEYMAP[e.key] ?? KEYMAP[e.key.toLowerCase()];
    if (!k) return;
    e.preventDefault();
    if (k === 'hook') fax.toggleHandset(); else fax.tap(k);
  });
}

/** The fax row of the settings card: the document tray, the card index, the keys, the LCD inset. */
function installFaxRow(panel, ui, fax) {
  panel.insertAdjacentHTML('beforeend', `<div class="actions">
    <button type="button" id="fx-docs" title="lay a document in the feeder">documents</button>
    <button type="button" id="fx-cards" title="the card index of numbers">numbers</button>
    <button type="button" id="fx-keys" title="the keyboard's keys">keys</button>
    <label class="toggle" title="the LCD, larger"><input type="checkbox" id="fx-lcd" checked><span>LCD</span></label></div>`);
  panel.querySelector('#fx-docs').addEventListener('click', (e) => { e.currentTarget.blur(); fax.chooseDocument(); });
  panel.querySelector('#fx-cards').addEventListener('click', (e) => { e.currentTarget.blur(); ui.cards(CARDS); });
  panel.querySelector('#fx-keys').addEventListener('click', (e) => { e.currentTarget.blur(); ui.keys(KEYS_HELP); });
  panel.querySelector('#fx-lcd').addEventListener('change', (e) => { ui.showLcd(e.target.checked); e.target.blur(); });
}

/** A page image as a small canvas of its face (the tray's picker). */
function frontThumb(page, w = 120) {
  const h = Math.round((w * page.heightMm) / page.widthMm);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(page.h - 1, Math.floor((y * page.h) / h));
    for (let x = 0; x < w; x++) {
      const v = page.data[sy * page.w + Math.min(page.w - 1, Math.floor((x * page.w) / w))] / 0.86;
      const o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.min(255, v); img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** The sheet's back as it lies face down in the feeder: white, the print showing through faintly, mirrored. */
function backThumb(page) {
  const f = frontThumb(page, 160);
  const c = document.createElement('canvas');
  c.width = f.width; c.height = f.height;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f2ea'; g.fillRect(0, 0, c.width, c.height);
  g.globalAlpha = 0.12; g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(f, 0, 0);
  return c;
}

/** An uploaded image on a letter sheet at 8 dots a mm, as reflectance (decision 21: it stays in the browser). */
async function imagePage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const widthMm = 215.9, heightMm = 279.4, dpmm = 8;
    const w = Math.round(widthMm * dpmm), h = Math.round(heightMm * dpmm);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const m = 12 * dpmm, k = Math.min((w - 2 * m) / bmp.width, (h - 2 * m) / bmp.height);
    g.drawImage(bmp, (w - bmp.width * k) / 2, m, bmp.width * k, bmp.height * k);
    const px = g.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const lum = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
      data[i] = Math.round((0.06 + (0.86 - 0.06) * lum) * 255);
    }
    return { name: 'upload', title: file.name, widthMm, heightMm, dpmmX: dpmm, dpmmY: dpmm, w, h, data };
  } catch (e) { console.warn('the image could not be read', e); return null; }
}

/** The block-out's display box: a canvas of 16 characters. */
function blockoutLcd(mesh) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  mesh.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 });
  return (text) => {
    g.fillStyle = '#9ea88f'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#222a24'; g.font = '56px "DejaVu Sans Mono", monospace'; g.textBaseline = 'middle';
    const t = String(text).slice(0, 16).padEnd(16, ' ');
    for (let i = 0; i < 16; i++) g.fillText(t[i], 10 + i * 31, 64);
    tex.needsUpdate = true;
  };
}
