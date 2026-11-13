// The printwheel printer on the desk (architecture.md 3.4 and 6, milestone M6): its mechanism host, the paper and
// film ribbon as soft bodies in the printer's own frame, ink from the existing strike path, the sheet feeder, and
// finished pages to the pile. The software reaches the printer only through `device` (the 7.6 interface). The model and
// everything it moves are src/render/wp/printer-view.js.
import * as THREE from 'three';
import { SoftWorld } from '../../soft/index.js';
import { PaperView, RibbonView } from '../../render/paper-view.js';
import { printerSoftMachine } from './printer-soft.js';
import { makeFeeder } from './controls.js';

const LOAD = 0x5001;
const FEEDER_DROP = 0.010;   // m up the plate the sheet starts, its top just under the feeder's exit rollers
export const CAPSTAN_R = 0.006;             // m: the ribbon advance knob is the drive capstan (MIM p.95); its radius assumed
const GATE_MANUAL = 55 * Math.PI / 180;    // the insertion gate turned from automatic to manual feed (SET p.26); assumed
const TRAY_OUT = 0.11;                     // m a tray slides out to the rear to be filled (PG p.93); assumed
const KNOB_PER_PX = 0.012;                 // rad of the knob per px of drag

/** Rest poses of the feeder's parts and the ribbon knob, and how each moves: the gate about the stacker plate's normal
 * (models.md: (0, 0.174, 0.985) in the printer's frame), the trays along -z (out to the rear). */
function poseFeeder(c) {
  const gate = c.feederGate, n = new THREE.Vector3(0, 0.174, 0.985).normalize();
  let gateBase = null, axis = null;
  if (gate) {
    // The normal in the gate's own frame: undo its rotation relative to the printer's root.
    const root = c.body?.parent ?? gate.parent;
    root.updateWorldMatrix(true, true);
    const rel = new THREE.Quaternion().copy(root.getWorldQuaternion(new THREE.Quaternion())).invert().multiply(gate.getWorldQuaternion(new THREE.Quaternion()));
    axis = n.clone().applyQuaternion(rel.invert());
    gateBase = gate.quaternion.clone();
  }
  const q = new THREE.Quaternion();
  const trayZ = c.trays.map((t) => t.position.z);
  return {
    knob0: c.ribbonKnob?.rotation.y ?? 0,
    gate: (a) => { if (gate) gate.quaternion.copy(gateBase).multiply(q.setFromAxisAngle(axis, a)); },
    tray: (i, x) => { c.trays[i].position.z = trayZ[i] - x; },
  };
}

/** sim: the word processor's mechanism client (it hosts every unit); glyphs: the printwheel's faces. */
export async function installPrinter({ stage, machine, geometry, mats, group, sim, glyphs, onDevice, controls, view, pickables }) {
  const softMachine = printerSoftMachine(machine);
  const soft = new SoftWorld({ machine: softMachine, geometry: geometry.printer, glyphs, origin: geometry.units.printer.origin });
  soft.parkSheet();   // the printer starts empty: sheets come from the feeder when the software loads one
  const paper = new PaperView({ renderer: stage.renderer, soft, mats, keyDir: new THREE.Vector3() });
  const ribbon = new RibbonView({ soft, machine: softMachine, mats, renderer: stage.renderer });
  ribbon.printPointWorld = geometry.printer.printPoint;
  group.add(paper.mesh, ribbon.mesh);

  sim.on('strike', (e) => soft.applyStrike(e));
  // The sheet feeder (owner's answer 5) stands over the paper slot; its stacker plate is the paper table. A LOAD from the
  // software first has it drop the next sheet down the plate from under its exit rollers, then the printer's own load
  // takes it in. Switched off (the gate at manual), LOAD finds no paper unless the operator laid a sheet (the fresh stack).
  const feeder = makeFeeder(true);
  // The software counts columns from the paper's left edge at the carrier's home (7.7), so the sheet goes in with its
  // left edge there, against the paper guide. `lateral` is the sheet centre's x on the platen.
  const homeX = -sim.state[sim.layout.carriageX];
  const laySheet = () => {
    for (let i = 0; i < 3; i++) soft.step(1 / 240, sim.state, sim.layout);
    soft.spawnSheet({ onTable: { offset: FEEDER_DROP, lateral: homeX + softMachine.paper.width / 2 } });
  };
  // A sheet run off the rollers is finished: parking it retires it to the page pile (installPages).
  soft.paperSim.onEjected = () => setTimeout(() => soft.parkSheet(), 300);

  // The device the software talks to (7.6), with the status fields the spooler reads.
  const st = { on: true, ready: true, online: true, coverOpen: false, error: 0, paper: false, feeder: Infinity, queued: 0 };
  sim.on('device', (e) => {
    if (e.dev !== 'printer') return;
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
  // The operator's controls: panel keys pressed for a moment, the cover and the power switch toggled by a hand. The hand
  // lifts the cover to its stop, past upright, and lets go there, so it rests open.
  const P = machine.printer, L = sim.layout;
  const NAMES = { start: 'START', stop: 'STOP', printTest: 'PRINT TEST', cancel: 'CANCEL', load: 'LOAD', release: 'RELEASE', paperUp: 'PAPER UP', paperDown: 'PAPER DOWN' };
  // A hand lets go after `ms` of the mechanism's own time, so a slow frame cannot cut a press or a lift short.
  const releases = [];
  const releaseAfter = (g, ms) => releases.push({ g, at: sim.state[L.time] + ms / 1000 });
  const hold = (dof, i, target, ms, opts = {}) => releaseAfter(sim.grab(dof, i, { target, ...opts }), ms);
  controls.panelKeys.forEach((mesh, i) => {
    const name = P.panel.keys[i];
    pickables.push({ object: mesh, part: () => ({ label: `Printer: ${NAMES[name]}`, onClick: () => hold('panelKey', i, P.panel.travel * 1.3, 160) }) });
  });
  const coverOpen = () => sim.state[L.cover] > P.cover.open / 2;
  controls.cover.traverse((o) => { if (o.isMesh) pickables.push({ object: o, part: () => ({ label: coverOpen() ? 'Close the printer cover' : 'Open the printer cover', onClick: () => hold('printerCover', 0, coverOpen() ? -0.05 : P.cover.open, 1200) }) }); });
  const powerOn = () => sim.state[L.printerPower] > P.power.travel / 2;
  pickables.push({ object: controls.power, part: () => ({ label: powerOn() ? 'Printer power: switch off' : 'Printer power: switch on', onClick: () => hold('printerPower', 0, powerOn() ? -0.1 : P.power.travel * 1.3, 400) }) });

  // Panel power switch and keys appear in the panel's box; the knob, gate and trays are worked here.
  // The ribbon advance knob is the capstan: a drag turns it forward only (the take-up spool winds one way), through a
  // hand on the ribbon motor's DOF. With the printer on, the motor's holding current holds it as it would a finger.
  const R = P.ribbonFeed, feedPerRad = R.feedPerStep / ((2 * Math.PI) / R.stepsPerRev);
  const motorAngle = () => sim.state[L.ribbonPawlTravel] / feedPerRad;
  let ribGrab = null, ribTarget = 0;
  if (controls.ribbonKnob) pickables.push({ object: controls.ribbonKnob, part: () => ({
    label: powerOn() ? 'Ribbon advance knob · drag to turn (held by its motor while the printer is on)' : 'Ribbon advance knob · drag to turn',
    onDrag: (dx, dy) => {
      const d = Math.max(0, (dx - dy) * KNOB_PER_PX) * CAPSTAN_R / feedPerRad;
      if (ribGrab === null) { ribTarget = motorAngle(); ribGrab = sim.grab('ribbonKnob', 0, { target: ribTarget, maxF: 0.1 }); }
      ribTarget = Math.max(ribTarget, motorAngle()) + d;
      sim.moveGrab(ribGrab, ribTarget);
    },
    onDragEnd: () => { if (ribGrab !== null) { const g = ribGrab; ribGrab = null; releaseAfter(g, 120); } },
  }) });
  // The sheet feeder's gate: automatic or manual feed, the same flag as the panel's button.
  let gateA = feeder.on ? 0 : GATE_MANUAL;
  if (controls.feederGate) pickables.push({ object: controls.feederGate, part: () => ({
    label: feeder.on ? 'Feeder gate (automatic): set to manual' : 'Feeder gate (manual): set to automatic', onClick: () => feeder.toggle() }) });
  // The trays slide out to the rear and back on a click.
  const trayOut = controls.trays.map(() => false), trayX = controls.trays.map(() => 0);
  controls.trays.forEach((t, i) => pickables.push({ object: t, part: () => ({
    label: `${i ? 'Lower' : 'Upper'} paper tray: ${trayOut[i] ? 'push it in' : 'pull it out'}`, onClick: () => { trayOut[i] = !trayOut[i]; } }) }));
  const pose = poseFeeder(controls);
  let lastEnv = '', lastT = null, lastWall = performance.now();
  return {
    sim, soft, softMachine, paper, ribbon, feeder, device,
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
      for (let i = releases.length - 1; i >= 0; i--) if (t >= releases[i].at) { sim.release(releases[i].g); releases.splice(i, 1); }
      if (dt > 0) soft.step(dt, sim.state, sim.layout);
      const env = soft.env(), key = JSON.stringify(env);
      if (key !== lastEnv) { lastEnv = key; sim.setEnv(env); }
      paper.update(); ribbon.update();
      view.update(sim.state, sim.layout);
      // The knob turns with the capstan; the gate and trays ease to where the hand put them.
      const now = performance.now(), ease = 1 - Math.exp(-Math.min(0.1, (now - lastWall) / 1000) / 0.09);
      lastWall = now;
      if (controls.ribbonKnob) controls.ribbonKnob.rotation.y = pose.knob0 - (sim.state[L.ribbonPawlTravel] / CAPSTAN_R);
      gateA += ((feeder.on ? 0 : GATE_MANUAL) - gateA) * ease;
      pose.gate(gateA);
      controls.trays.forEach((t, i) => { trayX[i] += ((trayOut[i] ? TRAY_OUT : 0) - trayX[i]) * ease; pose.tray(i, trayX[i]); });
    },
  };
}
