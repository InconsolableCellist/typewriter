// Pointer -> physical input. Every drag projects the ray on the real axis or plane of the DOF and drives
// a virtual spring (sim.grab) toward the projected value. No part is ever moved directly.
import * as THREE from 'three';
import { rayPlane, lineParamNearest, angleAround, Picker } from './picking.js';

const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);

// Finger on a key. From the mechanism's table (holds of 90 ms or longer): 18 N or less does not strike, 22 N gives
// 1.23 m/s, 28 N 2.41, 40 N 3.66, 50 N 4.31. Pointer travel sets the force, so full travel reaches the top of that range;
// a press with no pointer travel ramps to the strike-force slider, so an ordinary click prints and a longer press hits harder.
export const KEY_FORCE = {
  perPx: 0.2,        // N per pixel of downward pointer travel: 110 px for 22 N, 300 px for 60 N
  rampS: 0.11,       // s for a stationary press to reach the slider times the finger strength
  rampFadePx: [4, 40], // the stationary ramp hands over to pointer travel across this many pixels
  speedGain: 0.008,  // N per px/s of downward speed: a flick hits harder than the same slow travel
  speedMax: 20,      // N
  slewPerS: 420,     // N/s: how fast a fingertip can build force; a step of force throws the bar far harder than the table
  max: 60,           // N
  minHoldS: 0.095,    // shorter holds never strike, so a released finger stays on until this has passed
  relaxN: 7,         // N: once the bar has been thrown a finger eases off; holding 30 N re-strikes on the rebound
  k: 260, c: 0.6,    // N/m, N s/m: a compliant virtual fingertip
};

// A pinch on a sheet slips at a few newtons; past this the fingers stop following the pointer, then let go.
export const PAPER_HAND_LIMIT_N = 10;
const PAPER_SLIP_S = 0.3;
const PAPER_ENGAGED_LATERAL_M = 0.004;   // what the feed-roll play allows when the sheet is gripped
const DRAG_THRESHOLD_PX = 3;

export class Interaction {
  constructor({ canvas, camera, view, sim, soft, machine, geometry, rig, orbit, ui, paperMesh, ribbonMesh }) {
    Object.assign(this, { canvas, camera, view, sim, soft, m: machine, g: geometry, rig, orbit, ui });
    this.picker = new Picker(camera, view.pickables.slice());
    if (paperMesh) this.picker.add({ object: paperMesh, enabled: () => !soft?.sheetParked, part: (id, hit) => ({ kind: 'paper', hit, visual: () => paperMesh }) });
    view.onBell = () => sim.flickBell();
    if (ribbonMesh) this.picker.add({ object: ribbonMesh, part: (id, hit) => ({ kind: 'ribbon', hit, visual: () => ribbonMesh }) });
    this.pointers = new Map();
    this.drag = null;
    this.mode = null;
    this.hoverDirty = false;
    this.last = { x: 0, y: 0, t: 0 };
    const el = canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());   // right-drag pans; the canvas only
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.clickWindow = { button: 0 };
  }

  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  }

  ray(e) { const [x, y] = this.ndc(e); return this.picker.rayAt(x, y); }

  onWheel(e) {
    e.preventDefault();
    const [x, y] = this.ndc(e);
    const f = Math.exp(Math.sign(e.deltaY) * Math.min(1, Math.abs(e.deltaY) / 120) * 0.12);
    this.orbit.zoom(f, x, y);
  }

  onDown(e) {
    if (e.button > 2) return;
    if (e.button === 1) e.preventDefault();    // no middle-click autoscroll
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) { this.startPinch(); return; }
    this.last = { x: e.clientX, y: e.clientY, t: e.timeStamp, ptr: e.pointerId };
    if (e.button !== 0) { this.beginPan(); return; }
    const [x, y] = this.ndc(e);
    const hit = this.picker.pick(x, y);
    if (hit && hit.part && hit.part.kind !== 'info') this.beginPartDrag(hit, e);
    else if (e.shiftKey) this.beginPan();
    else { this.mode = 'orbit'; this.orbit.dragging = true; this.orbit.vTheta = 0; this.orbit.vPhi = 0; }
  }

  beginPan() { this.mode = 'pan'; this.orbit.vTheta = 0; this.orbit.vPhi = 0; }

  /** Lets go of the sheet, if it is the thing held: for when the sheet stops existing under the pointer. */
  cancelPaperDrag() {
    if (!this.drag?.paper) return;
    const d = this.drag; this.drag = null;
    d.end({});
    this.view.setHighlight(null); this.hoverDirty = !!this.lastHoverEvent;   // a touch drag has never hovered
    this.canvas.style.cursor = 'default';
  }

  onDoubleClick(e) {
    const [x, y] = this.ndc(e);
    const hit = this.picker.pick(x, y);
    if (!hit || !hit.part || hit.part.kind === 'info') this.orbit.reset();
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) { this.updatePinch(e); return; }
    if (this.mode === 'orbit') {
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      this.orbit.rotate(dx, dy);
      this.orbit.apply();
      return;
    }
    if (this.mode === 'pan') {
      this.orbit.pan(e.clientX - this.last.x, e.clientY - this.last.y);
      this.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      return;
    }
    if (this.drag) { this.drag.move(this.ray(e), e); return; }
    this.lastHoverEvent = e; this.hoverDirty = true;
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) this.pinch = this.pointers.size === 2 ? this.pinch : null;
    if (this.mode === 'orbit') { this.orbit.dragging = false; this.mode = null; }
    if (this.mode === 'pan' || (this.mode === 'pinch' && !this.pinch)) this.mode = null;
    if (this.drag) {
      const wasDrag = this.drag; this.drag = null;
      wasDrag.end(e);
      this.view.setHighlight(null); this.hoverDirty = true;
    }
    this.canvas.releasePointerCapture?.(e.pointerId);
  }

  startPinch() {
    if (this.drag) { this.drag.end({}); this.drag = null; }
    this.mode = 'pinch'; this.orbit.dragging = false;
    const [a, b] = [...this.pointers.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  updatePinch(e) {
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinch.d > 1) {
      const [nx, ny] = this.ndc({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      this.orbit.zoom(this.pinch.d / d, nx, ny);
    }
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    this.orbit.pan(cx - this.pinch.cx, cy - this.pinch.cy);
    this.pinch.d = d; this.pinch.cx = cx; this.pinch.cy = cy;
    void e;
  }

  update() {
    this.tick?.(performance.now());
    if (this.hoverDirty && !this.drag && this.mode !== 'orbit' && this.mode !== 'pan') {
      this.hoverDirty = false;
      const e = this.lastHoverEvent;
      const [x, y] = this.ndc(e);
      const hit = this.picker.pick(x, y);
      const real = hit?.part && hit.part.kind !== 'info' ? hit.part : null;
      this.view.setHighlight(real);
      this.canvas.style.cursor = real ? (real.cursor ?? 'grab') : 'default';
      this.ui.showLabel?.(e.clientX, e.clientY, hit?.part ? this.partLabel(hit.part) : null);
    }
  }

  partLabel(part) {
    const { g } = this;
    const SIDE = { L: 'left', R: 'right' };
    const CONTROL = { space: 'Space bar', shiftL: 'Shift key', shiftR: 'Shift key', shiftLock: 'Shift lock', backspace: 'Backspace key', marginRelease: 'Margin release' };
    switch (part.kind) {
      case 'info': case 'pages': case 'bell': case 'freshPaper': case 'lamp': return part.label;
      case 'key': { const k = g.keys[part.index]; return part.label ?? CONTROL[k.id] ?? `Key '${k.lower}'`; }
      case 'lever': { const k = g.keys[part.index]; return CONTROL[k.id] ? `${CONTROL[k.id]} lever` : `Key lever '${k.lower}'`; }
      case 'bar': return `Typebar '${g.bars[part.index].lower}'`;
      case 'cover': return part.label;
      case 'knob': return 'Platen knob';
      case 'platen': return 'Platen';
      case 'bail': return 'Paper bail';
      case 'lsLever': return 'Line-space lever';
      case 'margin': return `Margin stop (${SIDE[part.side] ?? part.side})`;
      case 'carriage': return 'Carriage';
      case 'carriageRelease': return `Carriage release (${this.sim.state[this.sim.layout.carriageRelease] > 0.175 ? 'open, click to engage' : 'engaged, click to free'})`;
      case 'paperRelease': return 'Paper release';
      case 'spool': return `Ribbon spool (${SIDE[part.side] ?? part.side})`;
      case 'ribbon': return 'Ribbon';
      case 'paper': return 'Paper';
      default: return part.kind;
    }
  }

  // ---------- drags by DOF ----------
  beginPartDrag(hit, e) {
    this.view.setHighlight(hit.part);
    if (hit.part.onClick) { this.drag = this.clickOn(hit.part, e); return; }
    this.canvas.style.cursor = 'grabbing';
    const fn = {
      key: this.dragKey, lever: this.dragLever, knob: this.dragKnob, platen: this.dragKnob, bar: this.dragBar,
      lsLever: this.dragLs, margin: this.dragMargin, carriage: this.dragCarriage, bail: this.dragBail,
      paper: this.dragPaper, ribbon: this.dragRibbon, spool: this.dragSpool,
      carriageRelease: this.dragReleaseLever, paperRelease: this.dragReleaseLever,
    }[hit.part.kind];
    if (!fn) return;
    this.drag = fn.call(this, hit, e);
    if (hit.part.kind === 'key') this.view.setHighlight(null);   // the key moves away from a static highlight shell
  }

  /** A part that is pressed, not dragged: acts on release if the pointer stayed put. */
  clickOn(part, e) {
    const x0 = e.clientX, y0 = e.clientY;
    return {
      move: () => {},
      end: (ev) => {
        if (ev.type !== 'pointerup' || Math.hypot(ev.clientX - x0, ev.clientY - y0) > DRAG_THRESHOLD_PX * 2) return;
        this.ui.showLabel?.(0, 0, null);
        part.onClick();
      },
    };
  }

  dragKey(hit, e) {
    const i = hit.part.index;
    const { sim, g, m } = this;
    const key = g.keys[i];
    const L = sim.layout, K = KEY_FORCE;
    const y0 = e.clientY, t0 = performance.now();
    let px = 0, lastY = y0, lastEv = e.timeStamp, vPx = 0, tipX = e.clientX, tipY = e.clientY, lastTick = t0;
    const h = sim.grab('key', i, { target: sim.state[L.keyX + i], k: K.k, c: K.c, maxF: K.max });
    const ramp = this.ui.strikeForce() * (key.finger ?? 1);
    let struck = false, Fnow = 0;
    const onStrike = (ev) => { if (ev.bar === (key.bar ?? key.barIndex ?? i)) struck = true; };
    const unsub = sim.on('strike', onStrike);   // the mock hands back an unsubscribe; the real client keeps a listener set
    const tick = (now) => {
      const dt = Math.max(0, (now - lastTick) / 1000); lastTick = now;
      vPx *= Math.exp(-dt * 10);
      const fade = 1 - THREE.MathUtils.smoothstep(Math.abs(px), K.rampFadePx[0], K.rampFadePx[1]);
      const pressF = Math.min(ramp, ramp * ((now - t0) / 1000) / K.rampS) * fade;
      const F0 = Math.min(K.max, Math.max(pressF, Math.max(0, px) * K.perPx) + Math.min(K.speedMax, vPx * K.speedGain));
      // The same force-velocity fade as the mechanism's timed finger, or a sustained grab hits far harder than the table.
      const y = sim.state[L.keyV + i] / (m.finger?.vMax ?? 0.7);
      const hill = y >= 1 ? 0 : y >= 0 ? (1 - y) / (1 + (m.finger?.hillB ?? 0.8) * y) : 1;
      Fnow = Math.min(F0, Fnow + K.slewPerS * dt) * hill;
      const F = struck ? Math.min(Fnow, K.relaxN) : Fnow;
      sim.moveGrab(h, sim.state[L.keyX + i] + F / K.k);
      this.ui.showForce?.(tipX, tipY, F);
    };
    this.tick = tick;
    tick(t0);
    return {
      move: (ray, ev) => {
        px = ev.clientY - y0; tipX = ev.clientX; tipY = ev.clientY;
        const dt = Math.max(0.001, (ev.timeStamp - lastEv) / 1000);
        vPx += (Math.max(0, (ev.clientY - lastY) / dt) - vPx) * Math.min(1, dt * 30);
        lastEv = ev.timeStamp; lastY = ev.clientY;
      },
      end: () => {
        this.ui.hideForce?.();
        if (typeof unsub === 'function') unsub(); else sim.listeners?.get('strike')?.delete(onStrike);
        const finish = () => { if (this.tick === tick) this.tick = null; sim.release(h); };
        const left = K.minHoldS * 1000 - (performance.now() - t0);
        if (left > 0) setTimeout(finish, left); else finish();
      },
    };
  }

  dragLever(hit) {
    const i = hit.part.index;
    const { sim, g, m, view } = this;
    const k = g.keys[i];
    const d = view.leverData[i];
    const ray0 = this.picker.ray.ray;
    const plane = hit.point.clone();
    const n = AX_X;
    const p0 = rayPlane(ray0, plane, n, new THREE.Vector3()) ?? plane.clone();
    const armAtHit = Math.max(0.01, p0.z - d.pivot.z);
    const leverRatio = d.len / armAtHit;
    const h = sim.grab('key', i, { target: 0, k: 1200, c: 2.2, maxF: 45 });
    void k; void m;
    return {
      move(ray) {
        const p = rayPlane(ray, plane, n, new THREE.Vector3());
        if (!p) return;
        sim.moveGrab(h, Math.max(0, (p0.y - p.y) * leverRatio));
      },
      end() { sim.release(h); },
    };
  }

  // Knob/platen: rolled by moving the pointer up or down while held, so the turn is not limited by the small cylinder on
  // screen. The surface under the hand follows the pointer one to one, at any zoom.
  dragKnob(hit) {
    const { sim, rig, view, camera } = this;
    const c = new THREE.Vector3(view.carriage.position.x, rig.c[1] + view.carriage.position.y, rig.c[2]);
    const radius = hit.part.kind === 'platen' ? rig.R : Math.max(0.012, hit.point.clone().sub(c).setX(0).length());
    const facing = camera.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const on = new THREE.Vector3();
    const psi0 = sim.state[sim.layout.platenPsi];
    const h = sim.grab('platen', 0, { target: psi0, k: 3.0, c: 0.05, maxF: 2.5 });
    return {
      move(ray) {
        if (!rayPlane(ray, hit.point, facing, on)) return;
        sim.moveGrab(h, psi0 + on.sub(hit.point).dot(up) / radius);
      },
      end() { sim.release(h); },
    };
  }

  // Bar: rotation about its own hinge axis; the pointer ray meets the plane of the bar.
  dragBar(hit) {
    const { sim, g } = this;
    const i = hit.part.index;
    const b = g.bars[i];
    const pivot = new THREE.Vector3().fromArray(b.pivot);
    const axis = new THREE.Vector3().fromArray(b.axis);
    const ref = new THREE.Vector3().fromArray(b.strikeDir);
    const p0 = rayPlane(this.picker.ray.ray, pivot, axis, new THREE.Vector3()) ?? hit.point;
    const ang0 = angleAround(p0, pivot, axis, ref);
    const th0 = sim.state[sim.layout.barTheta + i];
    const h = sim.grab('bar', i, { target: th0, k: 0.8, c: 0.015, maxF: 0.9 });
    return {
      move(ray) {
        const p = rayPlane(ray, pivot, axis, new THREE.Vector3());
        if (!p) return;
        let a = angleAround(p, pivot, axis, ref) - ang0;
        if (a > Math.PI) a -= 2 * Math.PI;
        if (a < -Math.PI) a += 2 * Math.PI;
        sim.moveGrab(h, THREE.MathUtils.clamp(th0 - a, 0, b.thetaTravel + 0.05));
      },
      end() { sim.release(h); },
    };
  }

  // Line-space lever: swings on its own pivot, then pulling past its travel loads the sim's lever
  // stop whose reaction drives the carriage. One grab, one continuous pull.
  dragLs() {
    const { sim, rig, view } = this;
    const ax = view.lsAxis.clone();
    const ref = new THREE.Vector3().fromArray(rig.ls.rest);
    const pivotNow = () => new THREE.Vector3(rig.ls.pivot[0] + view.carriage.position.x, rig.ls.pivot[1] + view.carriage.position.y, rig.ls.pivot[2]);
    const p0 = rayPlane(this.picker.ray.ray, pivotNow(), ax, new THREE.Vector3()) ?? pivotNow();
    const ang0 = angleAround(p0, pivotNow(), ax, ref);
    const L = sim.layout;
    const lv0 = sim.state[L.lsLever];
    // Sense: positive lever travel swings the tip toward +x, which is -view rotation of the lever group.
    const h = sim.grab('lsLever', 0, { target: lv0, k: 5, c: 0.05, maxF: 2.4 });
    const sense = view._lsSense();
    return {
      move(ray) {
        const piv = pivotNow();
        const p = rayPlane(ray, piv, ax, new THREE.Vector3());
        if (!p) return;
        let a = angleAround(p, piv, ax, ref) - ang0;
        if (a > Math.PI) a -= 2 * Math.PI;
        if (a < -Math.PI) a += 2 * Math.PI;
        sim.moveGrab(h, Math.max(0, lv0 + a * sense));
      },
      end() { sim.release(h); },
    };
  }

  dragMargin(hit) {
    const { sim, view } = this;
    const dofName = hit.part.side === 'L' ? 'marginL' : 'marginR';
    const Lk = dofName === 'marginL' ? sim.layout.marginL : sim.layout.marginR;
    const o = hit.point.clone();
    const t0 = lineParamNearest(this.picker.ray.ray, o, AX_X);
    const val0 = sim.state[Lk];
    const h = sim.grab(dofName, 0, { target: val0, k: 600, c: 14, maxF: 14 });
    void view;
    return {
      // A stop sits at local x = -value on the carriage, so moving it toward +x lowers its value.
      move(ray) { sim.moveGrab(h, val0 - (lineParamNearest(ray, o, AX_X) - t0)); },
      end() { sim.release(h); },
    };
  }

  dragCarriage(hit) {
    const { sim } = this;
    const o = hit.point.clone();
    const t0 = lineParamNearest(this.picker.ray.ray, o, AX_X);
    const x0 = sim.state[sim.layout.carriageX];
    const h = sim.grab('carriage', 0, { target: x0, k: 800, c: 32, maxF: 30 });
    return {
      move(ray) { sim.moveGrab(h, x0 + (lineParamNearest(ray, o, AX_X) - t0)); },
      end() { sim.release(h); },
    };
  }

  dragBail() {
    const { sim, rig, view } = this;
    const p = () => new THREE.Vector3(this.platenFrameX(), rig.bail.pivot[1] + view.carriage.position.y, rig.bail.pivot[2]);
    const ref = new THREE.Vector3(0, 0, 1);
    const ax = AX_X;
    const p0 = rayPlane(this.picker.ray.ray, p(), ax, new THREE.Vector3()) ?? p();
    const a0 = angleAround(p0, p(), ax, ref);
    const v0 = sim.state[sim.layout.bail];
    const h = sim.grab('bail', 0, { target: v0, k: 3, c: 0.05, maxF: 1.5 });
    return {
      move(ray) { const pt = rayPlane(ray, p(), ax, new THREE.Vector3()); if (pt) sim.moveGrab(h, Math.max(0, v0 - (angleAround(pt, p(), ax, ref) - a0))); },
      end() { sim.release(h); },
    };
  }

  /** Both release levers latch. A click throws the lever to its other position; a drag moves it by hand. */
  dragReleaseLever(hit, e) {
    const { sim, rig, view } = this;
    const x0 = e.clientX, y0 = e.clientY;
    const kind = hit.part.kind;
    const ref = kind === 'carriageRelease' ? rig.carriageRelease : rig.paperRelease;
    const pivot = () => new THREE.Vector3(ref.pos[0] + this.platenFrameX(), ref.pos[1] + view.carriage.position.y, ref.pos[2]);
    const ax = kind === 'carriageRelease' ? AX_Y : AX_X;
    const p0 = rayPlane(this.picker.ray.ray, pivot(), ax, new THREE.Vector3()) ?? pivot();
    const r = new THREE.Vector3().subVectors(p0, pivot()).normalize();
    const v0 = sim.state[sim.layout[kind]];
    const h = sim.grab(kind, 0, { target: v0, k: 2.5, c: 0.06, maxF: 1.3 });
    const open = kind === 'carriageRelease' ? 0.35 : 1;
    return {
      move(ray, ev) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= DRAG_THRESHOLD_PX) return;
        const pt = rayPlane(ray, pivot(), ax, new THREE.Vector3());
        if (pt) sim.moveGrab(h, Math.max(0, v0 + angleAround(pt, pivot(), ax, r)));
      },
      end(ev) {
        if (ev?.type === 'pointerup' && Math.hypot(ev.clientX - x0, ev.clientY - y0) <= DRAG_THRESHOLD_PX) {
          sim.moveGrab(h, v0 > open / 2 ? 0 : open);
          setTimeout(() => sim.release(h), 200);
          return;
        }
        sim.release(h);
      },
    };
  }

  // Soft bodies are grabbed only once the pointer really moves: a click must not disturb them.
  dragPaper(hit, e) {
    const { soft, camera, sim } = this;
    const n = camera.getWorldDirection(new THREE.Vector3());
    const point = hit.point.clone();
    const L = sim.layout;
    let id = null, overT = 0, lastT = 0;
    const handForce = () => soft.paperSim?.grabs?.get(soft._grabKinds?.get(id)?.inner)?.fMag ?? 0;
    const engaged = () => (soft.paperSim?.nE ?? 0) > 0 && !(sim.state[L.paperRelease] > 0.1);
    return {
      paper: true,
      move: (ray, ev) => {
        if (id === -1) return;
        if (id === null) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_THRESHOLD_PX) return;
          id = soft.grabPaper(point.toArray());
          lastT = ev.timeStamp;
          if (id < 0) { id = -1; return; }
        }
        const dt = Math.max(0, (ev.timeStamp - lastT) / 1000); lastT = ev.timeStamp;
        const p = rayPlane(ray, point, n);
        if (!p) return;
        if (handForce() > PAPER_HAND_LIMIT_N) {
          // Past a plausible pinch: hold where the sheet is, then slip off if the pull continues.
          overT += dt;
          if (overT > PAPER_SLIP_S) { soft.release(id); id = -1; }
          return;
        }
        overT = 0;
        if (engaged()) p.x = THREE.MathUtils.clamp(p.x, point.x - PAPER_ENGAGED_LATERAL_M, point.x + PAPER_ENGAGED_LATERAL_M);
        soft.moveGrab(id, p.toArray());
      },
      end: () => { if (id !== null && id !== -1) soft.release(id); },
    };
  }

  dragRibbon(hit, e) {
    const { soft, camera } = this;
    const n = camera.getWorldDirection(new THREE.Vector3());
    const point = hit.point.clone();
    let id = null;
    return {
      move: (ray, ev) => {
        if (id === null) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_THRESHOLD_PX) return;
          id = soft.grabRibbon(point.toArray());
        }
        const p = rayPlane(ray, point, n);
        if (p) soft.moveGrab(id, p.toArray());
      },
      end: () => { if (id !== null) soft.release(id); },
    };
  }

  dragSpool(hit, e) {
    const { soft, m } = this;
    const side = hit.part.side;
    const c = new THREE.Vector3((side === 'L' ? -m.ribbon.spoolX : m.ribbon.spoolX) - (soft.carrierOffset ?? 0), m.ribbon.spoolY, m.ribbon.spoolZ);
    const ref = new THREE.Vector3(1, 0, 0);
    const a0 = (() => { const p = rayPlane(this.picker.ray.ray, c, AX_Y, new THREE.Vector3()); return p ? angleAround(p, c, AX_Y, ref) : 0; })();
    const ang0 = this.spoolAngle(side);
    let id = null;
    return {
      move: (ray, ev) => {
        if (id === null) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < DRAG_THRESHOLD_PX) return;
          id = soft.grabSpool(side);
        }
        const p = rayPlane(ray, c, AX_Y, new THREE.Vector3());
        if (p) soft.moveGrab(id, ang0 + angleAround(p, c, AX_Y, ref) - a0);
      },
      end: () => { if (id !== null) soft.release(id); },
    };
  }

  /** Where the parts carried with the platen sit along x: they ride a moving carriage, and stand still on a fixed platen. */
  platenFrameX() { return this.m.action?.fixedPlaten ? 0 : this.view.carriage.position.x; }

  spoolAngle(side) {
    const s = side === 'L' ? this.soft.ribbon.spoolL : this.soft.ribbon.spoolR;
    return typeof s === 'number' ? s : (s?.angle ?? 0);
  }
}
