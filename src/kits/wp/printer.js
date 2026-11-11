// The printwheel printer on the desk (architecture.md 3.4 and 6, milestone M6): its mechanism host, the paper and
// film ribbon as soft bodies in the printer's own frame, ink from the existing strike path, the sheet feeder, and
// finished pages to the pile. The software reaches the printer only through `device` (the 7.6 interface).
import * as THREE from 'three';
import { loadGlyphs } from '../../machine/glyphs.js';
import { createSimClient } from '../../sim/client.js';
import { SoftWorld } from '../../soft/index.js';
import { PaperView, RibbonView } from '../../render/paper-view.js';
import { printerSoftMachine } from './printer-soft.js';

const LOAD = 0x5001;

export async function installPrinter({ stage, machine, geometry, mats, group, onDevice }) {
  const glyphs = await loadGlyphs('glyphs_wp');
  const sim = await createSimClient({ machine, geometry, glyphs });
  const softMachine = printerSoftMachine(machine);
  const soft = new SoftWorld({ machine: softMachine, geometry: geometry.printer, glyphs, origin: geometry.units.printer.origin });
  const paper = new PaperView({ renderer: stage.renderer, soft, mats, keyDir: new THREE.Vector3() });
  const ribbon = new RibbonView({ soft, machine: softMachine, mats, renderer: stage.renderer });
  ribbon.printPointWorld = geometry.printer.printPoint;
  group.add(paper.mesh, ribbon.mesh);
  const internals = buildInternals(machine.printer, geometry.printer, mats);
  group.add(internals.group);

  sim.on('strike', (e) => soft.applyStrike(e));
  // The sheet feeder (owner's answer 5): a LOAD from the software first lays the next sheet on the table, then the
  // printer's own load takes it in. Switched off, LOAD finds no paper unless the operator laid a sheet (the fresh stack).
  const feeder = { on: true };
  // The software counts columns from the paper's left edge at the carrier's home (7.7), so the sheet goes in with its
  // left edge there, against the paper guide. `lateral` is the sheet centre's x on the platen.
  const homeX = -sim.state[sim.layout.carriageX];
  const laySheet = () => {
    for (let i = 0; i < 3; i++) soft.step(1 / 240, sim.state, sim.layout);
    soft.spawnSheet({ onTable: { offset: 0.002, lateral: homeX + softMachine.paper.width / 2 } });
  };
  // A sheet run off the rollers is finished: parking it retires it to the page pile (installPages).
  soft.paperSim.onEjected = () => setTimeout(() => soft.parkSheet(), 300);

  // The device the software talks to (7.6), with the status fields the spooler reads.
  const st = { on: true, ready: true, online: true, coverOpen: false, error: 0, paper: false, feeder: Infinity, queued: 0 };
  sim.on('device', (e) => {
    if (e.ev === 'status') Object.assign(st, e, { on: sim.state[sim.layout.printerPower] > 0.5 });
    if (e.ev === 'paper') st.paper = e.kind === 'load';
    onDevice?.({ ...e, ...(e.ev === 'status' ? st : null) });
  });
  const device = {
    credit: 32,
    get status() { return { ...st, feeder: feeder.on ? Infinity : 0 }; },
    send(words) {
      const w = Array.from(words);
      const load = w.indexOf(LOAD);
      if (load < 0 || !feeder.on) { sim.command({ dev: 'printer', words: w }); return; }
      // Everything before the LOAD goes now; the LOAD and what follows once the feeder has laid a sheet.
      if (load > 0) sim.command({ dev: 'printer', words: w.slice(0, load) });
      laySheet();
      setTimeout(() => sim.command({ dev: 'printer', words: w.slice(load) }), 400);
    },
  };
  let lastEnv = '', lastT = null;
  return {
    sim, soft, softMachine, paper, ribbon, feeder, device, internals,
    /** The operator lays a sheet and presses LOAD (manual feed, or a click on the fresh stack). */
    loadSheet() { laySheet(); setTimeout(() => sim.command({ dev: 'printer', words: [LOAD] }), 400); },
    /**
     * The paper steps by the mechanism's own elapsed time, not the frame's: on a slow frame the mechanism has run on,
     * and a paper that fell behind would see the platen turn a whole line between two of its steps and slip.
     */
    update() {
      const t = sim.state[sim.layout.time];
      const dt = lastT === null ? 0 : Math.min(0.25, Math.max(0, t - lastT));
      lastT = t;
      if (dt > 0) soft.step(dt, sim.state, sim.layout);
      const env = soft.env(), key = JSON.stringify(env);
      if (key !== lastEnv) { lastEnv = key; sim.setEnv(env); }
      paper.update(); ribbon.update();
      internals.update(sim.state, sim.layout);
    },
  };
}

/**
 * What shows under the raised cover: the platen, the carrier with its printwheel and ribbon cartridge, all driven by
 * the mechanism's snapshot. Plain shapes; the paper and ribbon are the soft bodies.
 */
function buildInternals(P, geo, mats) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.35, metalness: 1 });
  const { center, radius, length } = P.platen;
  const platen = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 40), rubber);
  platen.rotation.z = Math.PI / 2; platen.position.fromArray(center);
  g.add(platen);
  const carrier = new THREE.Group();
  g.add(carrier);
  const w = geo.wheel;
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, 0.0015, 96, 1), mats?.paper ?? metal);
  wheel.material = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.5 });
  wheel.rotation.x = Math.PI / 2;
  const wheelPivot = new THREE.Group(); wheelPivot.position.fromArray(w.center); wheelPivot.add(wheel);
  carrier.add(wheelPivot);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 24), dark); hub.rotation.x = Math.PI / 2; wheelPivot.add(hub);
  const cart = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.05), dark);
  cart.position.set(0, center[1] + 0.002, center[2] + radius + 0.035);
  carrier.add(cart);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.09), dark);
  body.position.set(0, w.center[1] - w.radius - 0.03, w.center[2] + 0.02);
  carrier.add(body);
  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.03), metal);
  const hammerRest = new THREE.Vector3(0, geo.printPoint[1], w.center[2] + 0.02);
  carrier.add(hammer);
  for (const m of [platen, wheel, hub, cart, body, hammer]) { m.castShadow = m.receiveShadow = true; }
  return {
    group: g,
    update(state, L) {
      carrier.position.x = -state[L.carriageX];
      wheelPivot.rotation.z = state[L.wheelTheta];
      platen.rotation.x = state[L.platenPsi];
      hammer.position.copy(hammerRest).z -= state[L.hammerX] ?? 0;
    },
  };
}
