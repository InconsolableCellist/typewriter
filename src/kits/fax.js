// The fax kit: puts the Sharp FO-70 on the desk (machine.kind === 'fax'; docs/fax/architecture.md 6). Milestone M0:
// the stage and the desk, the machine as a block-out at its documented size (or the Blender model once
// src/render/fax/fo70-view.js exists), the desk's things as boxes, the stations, focus items and way markers of the
// shared view code with the fax's graph, the room's time of day and weather, and the mechanism host behind the
// SimClient, which moves to the audio thread at the first gesture. Reached with ?machine=faxfo70.
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

// The real model's view, when the Blender work has delivered it (architecture.md 6.2). import.meta.glob finds it if
// the file exists and is an empty map if not, so the kit builds either way.
const MODEL_VIEWS = import.meta.glob('../render/fax/fo70-view.js');
const STORE_KEY = 'fax.atmosphere';
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
  const sim = await createSimClient({ machine, geometry, glyphs: null, options: { cold } });
  const parts = view.parts ?? {};

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
  const pickAt = makePicker({ camera, canvas, keys: parts.keys ?? [], pickables, nav: { targets: () => [] }, boxes: () => boxes, solids: () => [view.group] });
  installWpPointer({ canvas, orbit, nav, press: () => {}, hint: navUi.hint, show: navUi.show, pick: pickAt });

  // The room: the typewriters' time of day, weather and lamp, and their rain and thunder on the kit's AudioContext.
  const panel = buildPanel(ctx);
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

  window.__tw = { stage, machine, geometry, view, parts, things, desk, orbit, nav, boxes, sim, panel, environment, ambience, markers };
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
  if (hint) hint.textContent = 'the circles, the edge arrows and the bar move the view · click the handset to lift it, the panel to open it · ◎ free view';
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
