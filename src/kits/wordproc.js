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

  // Block-out bodies: one box per unit, in its own group at its world origin.
  const units = {};
  const footprints = [];
  for (const [name, u] of Object.entries(geometry.units)) {
    const def = machine.units[name];
    const group = new THREE.Group();
    group.name = `unit-${name}`;
    group.position.fromArray(u.origin);
    const mat = new THREE.MeshPhysicalMaterial({ color: def.color ?? 0xcccccc, roughness: 0.55, metalness: 0, clearcoat: 0.1 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(...u.size), mat);
    box.position.y = u.size[1] / 2;
    box.castShadow = box.receiveShadow = true;
    box.name = name;
    group.add(box);
    stage.scene.add(group);
    units[name] = group;
    if (!u.on) footprints.push(u.box);
  }
  desk.setFootprints(footprints);

  // The CRT on the display's front. Until the software lands (milestones M1-M3) it shows a still picture.
  const screen = params.has('screentest') ? testCardScreen() : placeholderScreen();
  const crt = new CRT({ renderer: stage.renderer, screen });
  const dsz = geometry.units.display.size;
  const face = new THREE.Mesh(makeTubeFace(0.245, 0.17), crt.material);
  face.position.set(0, 0.165, dsz[2] / 2 + 0.002);
  units.display.add(face);
  // The screen's own light on the keyboard and desk: shadowless, from a little in front of the glass.
  const spill = new THREE.SpotLight(0x66ff99, 0, 1.5, 1.1, 0.9, 2);
  spill.position.set(0, 0.165, dsz[2] / 2 + 0.03);
  spill.target.position.set(0, -0.25, dsz[2] / 2 + 0.6);
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
    crt.update(dt);
    spill.intensity = 0.02 + 0.25 * crt.litFraction;
    stage.composer.render();
    frameTimes[nFt++ % frameTimes.length] = performance.now() - t0;
    window.__frameTimes = frameTimes; window.__frameCount = nFt;
  }
  requestAnimationFrame(loop);

  window.__tw = { stage, machine, geometry, units, desk, orbit, panel, crt, screen };
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
  if (hint) hint.textContent = 'work in progress: the units are placeholders · drag to orbit · wheel to zoom · buttons move the camera';
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
function screenFrom(lines, cursor = { row: 0, col: 0, on: false }, attrsFor = () => 0) {
  const chars = new Uint8Array(COLS * ROWS), attrs = new Uint8Array(COLS * ROWS);
  lines.forEach((ln, r) => { for (let c = 0; c < Math.min(COLS, ln.length); c++) { chars[r * COLS + c] = ln.charCodeAt(c) & 0xff; attrs[r * COLS + c] = attrsFor(r, c); } });
  return { chars, attrs, cursor, version: 1 };
}

function placeholderScreen() {
  const L = Array(ROWS).fill('');
  L[3] = '                               TASK SELECTION';
  L[6] = '      ID   ITEM';
  L[8] = '      a    Typing Tasks';
  L[9] = '      b    Work Diskette Tasks';
  L[10] = '      c    Program Diskette Tasks';
  L[11] = '      d    Printer Tasks';
  L[12] = '      e    Spelling Tasks';
  L[23] = 'Type ID letter to choose ITEM; press ENTER:';
  return screenFrom(L, { row: 23, col: 44, on: true }, (r) => (r === 23 ? 4 : 0));
}

function testCardScreen() {
  const L = [];
  for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += String.fromCharCode(32 + ((r * COLS + c) % 95)); L.push(s); }
  return screenFrom(L, { row: 12, col: 40, on: true }, (r, c) => (r === 2 ? 1 : r === 4 ? 2 : r === 6 ? 4 : 0));
}
