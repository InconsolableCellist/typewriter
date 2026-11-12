// The printwheel printer on the desk (architecture.md 3.4 and 6, milestone M6): its mechanism host, the paper and
// film ribbon as soft bodies in the printer's own frame, ink from the existing strike path, the sheet feeder, and
// finished pages to the pile. The software reaches the printer only through `device` (the 7.6 interface). The model and
// everything it moves are src/render/wp/printer-view.js.
import * as THREE from 'three';
import { SoftWorld } from '../../soft/index.js';
import { PaperView, RibbonView } from '../../render/paper-view.js';
import { printerSoftMachine } from './printer-soft.js';

const LOAD = 0x5001;
const FEEDER_DROP = 0.010;   // m up the plate the sheet starts, its top just under the feeder's exit rollers

/** sim: the word processor's mechanism client (it hosts every unit); glyphs: the printwheel's faces. */
export async function installPrinter({ stage, machine, geometry, mats, group, sim, glyphs, onDevice, controls, view, pickables }) {
  const softMachine = printerSoftMachine(machine);
  const soft = new SoftWorld({ machine: softMachine, geometry: geometry.printer, glyphs, origin: geometry.units.printer.origin });
  const paper = new PaperView({ renderer: stage.renderer, soft, mats, keyDir: new THREE.Vector3() });
  const ribbon = new RibbonView({ soft, machine: softMachine, mats, renderer: stage.renderer });
  ribbon.printPointWorld = geometry.printer.printPoint;
  group.add(paper.mesh, ribbon.mesh);

  sim.on('strike', (e) => soft.applyStrike(e));
  // The sheet feeder (owner's answer 5) stands over the paper slot; its stacker plate is the paper table. A LOAD from the
  // software first has it drop the next sheet down the plate from under its exit rollers, then the printer's own load
  // takes it in. Switched off (the gate at manual), LOAD finds no paper unless the operator laid a sheet (the fresh stack).
  const feeder = { on: true };
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
  const hold = (dof, i, target, ms, opts = {}) => { const g = sim.grab(dof, i, { target, ...opts }); setTimeout(() => sim.release(g), ms); };
  controls.panelKeys.forEach((mesh, i) => {
    const name = P.panel.keys[i];
    pickables.push({ object: mesh, part: () => ({ label: `Printer: ${NAMES[name]}`, onClick: () => hold('panelKey', i, P.panel.travel * 1.3, 160) }) });
  });
  const coverOpen = () => sim.state[L.cover] > P.cover.open / 2;
  controls.cover.traverse((o) => { if (o.isMesh) pickables.push({ object: o, part: () => ({ label: coverOpen() ? 'Close the printer cover' : 'Open the printer cover', onClick: () => hold('printerCover', 0, coverOpen() ? -0.05 : P.cover.open, 1200) }) }); });
  const powerOn = () => sim.state[L.printerPower] > P.power.travel / 2;
  pickables.push({ object: controls.power, part: () => ({ label: powerOn() ? 'Printer power: switch off' : 'Printer power: switch on', onClick: () => hold('printerPower', 0, powerOn() ? -0.1 : P.power.travel * 1.3, 400) }) });

  let lastEnv = '', lastT = null;
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
      if (dt > 0) soft.step(dt, sim.state, sim.layout);
      const env = soft.env(), key = JSON.stringify(env);
      if (key !== lastEnv) { lastEnv = key; sim.setEnv(env); }
      paper.update(); ribbon.update();
      view.update(sim.state, sim.layout);
    },
  };
}
