import * as THREE from 'three';
import { MACHINES, DEFAULT_MACHINE } from './machine/index.js';
import { deriveGeometry } from './machine/geometry.js';
import { deriveRig } from './render/rig.js';
import { createScene, loadRoom } from './render/scene.js';
import { createMaterials, loadStudioTextures } from './render/materials.js';
import { createAtlases } from './render/atlas.js';
import { MachineView } from './render/machine-view.js';
import { PaperView, RibbonView } from './render/paper-view.js';
import { HeadView } from './render/head-view.js';
import { Enclosure } from './render/enclosure.js';
import { ElementView, ElementEnclosure, ELEMENT_ENCLOSURE_URL, ELEMENT_CAVITY } from './render/element-view.js';
import { applyCavity } from './render/look.js';
import { Desk } from './render/desk.js';
import { createMockSim, MockSoft } from './render/mock-sim.js';
import { Orbit } from './interact/orbit.js';
import { Interaction } from './interact/drag.js';
import { KeyboardInput } from './interact/keyboard.js';
import { installTerminal } from './terminal/index.js';
import { Hands } from './interact/hands.js';
import { Panel } from './ui/panel.js';
import { setupPrintPointWindow } from './ui/print-point-window.js';
import { PaperSoundTracker } from './audio/paper_tracker.js';
import { installPages } from './pages/index.js';
import { installDeskProps } from './render/desk-props.js';
import { installEnvironment } from './render/environment.js';
import { DeskSway } from './render/desk-sway.js';
import { BallBlur } from './render/ball-blur.js';
import { Ambience } from './audio/ambience.js';

const sources = import.meta.glob(['./sim/client.js', './soft/index.js']);
const params = new URLSearchParams(location.search);
const useMock = params.has('mock');
function chooseMachine() {
  let saved = null;
  try { saved = localStorage.getItem('machine'); } catch { /* storage can be blocked; the default machine is fine */ }
  return MACHINES[new URLSearchParams(location.search).get('machine')] ?? MACHINES[saved] ?? MACHINES[DEFAULT_MACHINE];
}
const machine = chooseMachine();

async function loadGlyphs() {
  try {
    const m = await (import.meta.glob('./machine/glyphs.js')['./machine/glyphs.js']?.());
    const g = await m.loadGlyphs();
    if (g && g.data) return { chars: g.chars, data: g.data, N: g.N ?? 96, texelMm: g.texelMm ?? 0.05, raw: g };
  } catch { /* fall through to the local reader */ }
  const [meta, bin] = await Promise.all([
    fetch('/assets/glyphs.json').then((r) => r.json()),
    fetch('/assets/glyphs.bin').then((r) => r.arrayBuffer()),
  ]);
  return { ...meta, data: new Uint8Array(bin) };
}

async function createBackends(m, g, glyphs) {
  if (useMock) return { sim: createMockSim({ machine: m, geometry: g }), soft: new MockSoft({ machine: m, geometry: g, glyphs }), real: false };
  let sim, soft;
  try {
    const { createSimClient } = await sources['./sim/client.js']();
    sim = await createSimClient({ machine: m, geometry: g, glyphs: glyphs.raw ?? glyphs });
  } catch (e) { console.warn('sim client not available, using mock', e); }
  try {
    const { SoftWorld } = await sources['./soft/index.js']();
    soft = new SoftWorld({ machine: m, geometry: g, glyphs: glyphs.raw ?? glyphs });
  } catch (e) { console.warn('soft world not available, using mock', e); }
  return {
    sim: sim ?? createMockSim({ machine: m, geometry: g }),
    soft: soft ?? new MockSoft({ machine: m, geometry: g, glyphs }),
    real: !!sim && !!soft,
  };
}

async function main() {
  const canvas = document.getElementById('c');
  canvas.addEventListener('webglcontextlost', () => console.warn('webgl context lost'));
  const stage = createScene(canvas);
  const geometry = deriveGeometry(machine);
  const rig = deriveRig(machine, geometry);
  const glyphs = await loadGlyphs();
  const { mats } = createMaterials();
  const atlas = createAtlases(glyphs, geometry);
  const { sim, soft, real } = await createBackends(machine, geometry, glyphs);
  const maxAniso = stage.renderer.capabilities.getMaxAnisotropy();
  atlas.keys.anisotropy = maxAniso; atlas.slugs.anisotropy = maxAniso;
  document.title = real ? 'Typewriter' : 'Typewriter (mock physics)';

  const isElement = !!geometry.element;
  const view = isElement ? new ElementView({ machine, geometry, rig, mats, atlas, glyphs }) : new MachineView({ machine, geometry, rig, mats, atlas });
  if (isElement) await view.emats.ready;
  stage.scene.add(view.root);
  if (!isElement) view.tryLoadGLB('/assets/models/frame.glb').then((ok) => { if (ok) console.info('frame.glb loaded'); });

  const paper = new PaperView({ renderer: stage.renderer, soft, mats, keyDir: new THREE.Vector3() });
  const keyWorld = stage.key.position.clone().sub(stage.key.target.position).normalize();
  const ribbon = new RibbonView({ soft, machine, mats, renderer: stage.renderer });
  ribbon.printPointWorld = geometry.printPoint;
  loadStudioTextures(mats, paper.material, maxAniso, { lowTier: params.has('lowtex') || stage.renderer.capabilities.maxTextureSize < 4096 }).catch((e) => console.info('textures', e));
  stage.scene.add(paper.mesh, ribbon.mesh);

  stage.camera.layers.enable(1);   // the enclosure, which the print-point view looks past
  if (machine.defaultCamera) stage.camera.position.fromArray(machine.defaultCamera.position);
  const orbit = new Orbit(stage.camera, canvas, machine.defaultCamera?.target);

  const head = new HeadView({ renderer: stage.renderer, scene: stage.scene, geometry, rig, element: document.getElementById('insetFront'), lamp: stage.rim });
  for (const b of document.querySelectorAll('#insets .fold')) b.addEventListener('click', () => b.closest('.card').classList.toggle('folded'));

  const enclosure = isElement ? new ElementEnclosure({ scene: stage.scene, mats: view.emats }) : new Enclosure({ scene: stage.scene, mats });
  if (isElement) { applyCavity(ELEMENT_CAVITY); head.followX = () => -soft.carrierOffset; }
  const desk = new Desk({ scene: stage.scene, mats });
  desk.load('/assets/models/desk.glb').catch((e) => console.info('desk', e));
  loadRoom(stage.scene, '/assets/hdri/combination_room_2k.exr', parseFloat(params.get('room') ?? '3.0')).catch((e) => console.info('hdri', e));

  const panel = new Panel({
    machine,
    sim, soft,
    onFreeBars: () => hands.freeBars(),
    onResetPaper: () => hands.loadPaper(),
    onResetAll: () => { hands.freeBars(); soft.resetRibbon?.(); hands.loadPaper(); },
    onAshtray: (on) => deskProps.setVisible(on),
  });

  setupPrintPointWindow({
    panel: document.getElementById('panel'), insets: document.getElementById('insets'),
    front: document.getElementById('insetFront'), handle: document.getElementById('insetResize'),
  });

  sim.on('strike', (evt) => {
    if (soft.applyStrike) {
      soft.applyStrike(evt);
    }
    panel.setStrike(evt);
  });

  const interaction = new Interaction({
    canvas, camera: stage.camera, view, sim, soft, machine, geometry, rig, orbit, ui: panel,
    paperMesh: paper.mesh, ribbonMesh: ribbon.mesh,
  });
  // Carriage body handles: the end plates and the proxy over the rails.
  if (!isElement) for (const e of makeCarriageHandles(view, rig)) { view.pickables.push(e); interaction.picker.add(e); }


  enclosure.load(isElement ? ELEMENT_ENCLOSURE_URL : '/assets/models/enclosure.glb').then((ok) => {
    if (!ok) return;
    console.info('enclosure loaded');
    if (isElement) for (const entry of enclosure.pickEntries()) interaction.picker.add(entry);
    else for (const object of enclosure.meshes) interaction.picker.add({ object, part: () => null, enabled: () => enclosure.showing });
    desk.setFootprint(new THREE.Box3().setFromObject(enclosure.group));
  });

  const hands = new Hands({ sim, soft, machine, rig });
  // Load a sheet: laid on the table, then wound in through the feed rolls by turning the platen.
  if (soft.spawnSheet && !params.has('emptymachine') && !sim.isMock) {
    // Let a soft step see the current carriage position first, so the sheet is laid square to it.
    for (let i = 0; i < 3; i++) soft.step(1 / 240, sim.state, sim.layout);
    soft.spawnSheet({ onTable: { offset: 0.002 } });
    hands.loadPaper({ fresh: false });
  }
  const pages = installPages({ stage, soft, paper, machine, interaction, hands });   // before the keyboard and terminal listeners: its overlay must see keys first
  const deskProps = installDeskProps({ stage, interaction, soft, paper, hands, machine });
  const machinePicker = document.getElementById('a-machine');
  for (const m of Object.values(MACHINES)) machinePicker.add(new Option(m.name, m.id));
  machinePicker.value = machine.id;
  machinePicker.addEventListener('change', () => {
    try { localStorage.setItem('machine', machinePicker.value); } catch { /* the URL below still selects it */ }
    const url = new URL(location.href);
    url.searchParams.set('machine', machinePicker.value);
    location.href = url;
  });
  machinePicker.addEventListener('keydown', () => machinePicker.blur());   // typing goes to the typewriter
  const environment = installEnvironment({ stage, interaction, panel, machine });
  const deskSway = machine.desk ? new DeskSway(machine.desk, machine.carriage.mass) : null;
  const ballBlur = isElement ? new BallBlur(stage.scene, view.ballGroup) : null;
  const ambience = new Ambience({ environment });
  environment.onChange((s) => ambience.setWeather(s.weather));
  panel.onWeatherSound = (on) => ambience.setEnabled(on);
  new KeyboardInput({ sim, geometry, machine, ui: panel, hands });
  const terminal = installTerminal({ sim, soft, machine, geometry, hands, unlockAudio: unlock });

  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (sim.unlockAudio && !sim.isMock) {
      try { const ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); sim.unlockAudio(ac).then(() => panel.resendParams()); } catch (e) { console.warn(e); }
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const resize = () => stage.resize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize); resize();

  const timer = params.has('timing') ? makeGpuTimer(stage.renderer.getContext()) : null;
  const frameTimes = new Float32Array(240);
  let ft = 0, nFt = 0, last = performance.now();
  let lastEnv = '';
  // Lower the supersampling if frames persistently miss 60 Hz; never raises it again, to avoid hunting.
  let govLast = 0, govN = 0, govSum = 0, govSlow = 0;
  const govStart = performance.now();
  function govern(now) {
    const d = now - govLast; govLast = now;
    if (d > 120 || d <= 0) { govN = 0; govSum = 0; return; }
    govSum += d; govN++;
    if (govN < 120) return;
    const mean = govSum / govN; govN = 0; govSum = 0;
    if (now < govStart + 15000) return;         // loading and first compiles do not count
    govSlow = mean > 24 ? govSlow + 1 : 0;
    if (govSlow >= 3 && stage.getQuality() > 0.62) { govSlow = 0; stage.setQuality(stage.getQuality() * 0.85); console.info('render quality', stage.getQuality().toFixed(2)); }
  }

  let hintJam = false;
  const jamTheta = new Float32Array(geometry.nPrint);
  const hintEl = document.getElementById('hint'), hintDefault = hintEl.textContent;
  const paperSound = new PaperSoundTracker(sim);
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (deskSway) {
      deskSway.update(dt, -sim.state[sim.layout.carriageV]);
      environment.deskKick(deskSway.dv);
    }
    const t0 = performance.now();
    soft.step(dt, sim.state, sim.layout);
    paperSound.update(dt, soft);
    const env = soft.env();
    const envKey = JSON.stringify(env);
    if (envKey !== lastEnv) { lastEnv = envKey; sim.setEnv(env); }
    view.update(sim.state, sim.layout, soft);
    ballBlur?.update();
    // A bar left standing with no motion is jammed; say where the fix is, and picking lets raised bars be taken first.
    let stuck = false;
    for (let i = 0; i < geometry.nPrint; i++) {
      jamTheta[i] = sim.state[sim.layout.barTheta + i] > 0.12 ? jamTheta[i] + dt * (sim.timeScale ?? 1) : 0;
      if (jamTheta[i] > 0.9 && sim.grabs.size === 0) stuck = true;
    }
    const jammed = stuck;
    if (jammed !== hintJam) { hintJam = jammed; hintEl.textContent = jammed ? 'typebars jammed \u00b7 drag a raised bar back down to clear it' : hintDefault; hintEl.classList.toggle('alert', jammed); }
    paper.keyDir.copy(keyWorld).transformDirection(stage.camera.matrixWorldInverse);
    paper.update(); ribbon.update();
    pages.update(dt);
    deskProps.update(dt);
    environment.update(dt, keyWorld);
    interaction.update();
    orbit.update(dt);
    if (timer) timer.begin();
    const shake = deskSway?.x ?? 0;
    stage.camera.position.x -= shake;   // everything on the table moves with it; shifting the viewer instead leaves the distant room still
    stage.composer.render();
    stage.camera.position.x += shake;
    head.beforeRender = (cam) => paper.keyDir.copy(keyWorld).transformDirection(cam.matrixWorldInverse);
    head.render();
    if (timer) timer.end();
    govern(now);
    const elapsed = performance.now() - t0;
    frameTimes[ft++ % frameTimes.length] = elapsed; nFt++;
    if (nFt % 6 === 0) {
      const n = Math.min(nFt, frameTimes.length);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += frameTimes[i];
      panel.update(sim.state, sim.layout, sum / n);
    }
    window.__frameTimes = frameTimes; window.__frameCount = nFt;
  }
  requestAnimationFrame(loop);

  window.__tw = { deskSway, ballBlur, ambience, environment, sim, soft, view, paper, panel, orbit, stage, geometry, machine, rig, interaction, hands, enclosure, head, terminal, pages, deskProps };
}

function makeGpuTimer(gl) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pool = [];
  let active = null;
  const stats = { n: 0, sum: 0, recent: new Float32Array(240), i: 0 };
  window.__gpu = stats;
  return {
    begin() {
      if (active) return;
      const q = pool.length < 8 ? gl.createQuery() : pool.shift();
      active = q;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      const q = active; active = null;
      const poll = () => {
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) { requestAnimationFrame(poll); return; }
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        const ms = ns / 1e6;
        stats.recent[stats.i++ % stats.recent.length] = ms; stats.n++; stats.sum += ms;
        pool.push(q);
      };
      poll();
    },
  };
}

function makeCarriageHandles(view, rig) {
  // The carriage is grabbed on its body: the plate above the rails and the paper table.
  const hit = new THREE.MeshBasicMaterial({ visible: false });
  const out = [];
  const mkBox = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hit);
    m.position.set(x, y, z); view.carriage.add(m);
    out.push({ object: m, low: true, part: () => ({ kind: 'carriage', visual: () => view.plateMesh }) });
  };
  mkBox(rig.endPlateX * 2 + 0.01, 0.012, 0.09, 0, rig.railY + 0.012, rig.railRearZ + 0.02);
  for (const sign of [-1, 1]) mkBox(0.007, 0.06, 0.1, sign * rig.endPlateX, rig.c[1] - 0.004, rig.c[2] - 0.02);
  const table = view.table;
  out.push({ object: table, low: true, part: () => ({ kind: 'carriage', visual: () => table }) });
  return out;
}

main().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="color:#f88;padding:20px">${e?.stack ?? e}</pre>`;
});
