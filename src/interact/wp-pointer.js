// Pointer input for the word processor (docs/displaywriter/architecture.md 3.5). A press on a key holds it down; a
// click on a control works it; neither ever moves the camera. A click on a highlighted object (a focus item, another
// station) asks the view system to go there. Only in the free view do drags orbit and pan and the wheel or a pinch
// zoom; at a station they leave the camera alone and say how to look around. A control may also be dragged (a knob
// turned, the display tilted) and, while the pointer is over it, worked by the wheel; its part() says how:
// { label, onClick(), onDrag(dx, dy), onDragEnd(), onWheel(deltaY) }. A control with no onClick passes a click on to
// the navigation target behind it, so a cabinet that tilts can still be clicked to look closer.
import * as THREE from 'three';
import { targetAt } from './wp-views.js';

const CLICK_PX = 5;            // a press that moves less than this is a click

/**
 * What is under a pointer event: { kind: 'key', key }, { kind: 'control', entry, label }, { kind: 'nav', target } or
 * null. Keys and controls come first, as on the typewriters; a pickable whose part() is null only stops the pointer.
 * A navigation target is chosen by where the ray meets the units.
 */
export function makePicker({ camera, canvas, keys, pickables, solids, nav, boxes }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  return (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const live = pickables.filter((p) => p.enabled?.() ?? true);
    const hit = ray.intersectObjects([...keys, ...live.map((p) => p.object)], true)[0];
    if (hit) {
      const key = keys.indexOf(hit.object);
      if (key >= 0) return { kind: 'key', key };
      let o = hit.object, entry = null;
      while (o && !entry) { entry = live.find((p) => p.object === o); o = o.parent; }
      const part = entry?.part();
      if (part) {
        const fallback = part.onClick ? null : navAt();
        return { kind: 'control', entry, part, label: part.label, fallback: fallback?.target ?? null };
      }
    }
    return navAt();
  };
  function navAt() {
    const targets = nav.targets();
    if (!targets.length) return null;
    const solid = ray.intersectObjects(solids(), true)[0];
    if (!solid) return null;
    const target = targetAt(solid.point.toArray(), targets, boxes());
    return target ? { kind: 'nav', target } : null;
  }
}

/**
 * Wires pointer input on `canvas`. pick(e) as makePicker; press(i, forceN) drives a key; orbit is the free view's
 * camera; nav the view system; show(hit, e) draws the hover (label and highlight; null hides);
 * hint(text) says something briefly. Returns { dispose }.
 */
export function installWpPointer({ canvas, pick, press, orbit, nav, show = () => {}, hint = () => {} }) {
  const pointers = new Map();     // pointerId -> { x, y }
  let mode = null, held = null, click = null, moved = 0, lx = 0, ly = 0, pinch = null, hoverAt = 0;

  const on = (type, fn, opts) => { canvas.addEventListener(type, fn, opts); return () => canvas.removeEventListener(type, fn, opts); };
  const offs = [];
  offs.push(on('contextmenu', (e) => e.preventDefault()));

  offs.push(on('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture?.(e.pointerId);
    show(null, e);
    if (pointers.size === 2) {
      // A second finger: a pinch in the free view, nothing at a station. Whatever the first finger was doing ends.
      if (mode === 'key' && held !== null) { const k = held; held = null; setTimeout(() => press(k, 0), 40); }
      click = null;
      mode = nav.free ? 'pinch' : 'idle';
      pinch = pinchOf(pointers);
      if (mode === 'pinch') orbit.dragging = false;
      return;
    }
    if (pointers.size > 2) return;
    lx = e.clientX; ly = e.clientY; moved = 0;
    const hit = e.button === 0 ? pick(e) : null;
    if (hit?.kind === 'key') { held = hit.key; press(held, 1.2); mode = 'key'; return; }
    if (hit?.kind === 'control') { click = hit; click.part ??= hit.entry.part(); mode = 'control'; return; }
    if (hit?.kind === 'nav') { click = hit; mode = 'nav'; return; }
    click = null;
    if (nav.free) { mode = e.button === 2 || e.shiftKey ? 'pan' : 'rotate'; orbit.dragging = true; orbit.vTheta = 0; orbit.vPhi = 0; } else mode = 'idle';
  }));

  offs.push(on('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      if (performance.now() - hoverAt < 60) return;
      hoverAt = performance.now();
      show(pick(e), e);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch') {
      const p = pinchOf(pointers), r = canvas.getBoundingClientRect();
      if (p.d > 0 && pinch.d > 0) orbit.zoom(pinch.d / p.d, ((p.cx - r.left) / r.width) * 2 - 1, -((p.cy - r.top) / r.height) * 2 + 1);
      orbit.pan(p.cx - pinch.cx, p.cy - pinch.cy);
      pinch = p;
      return;
    }
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'control') { if (moved >= CLICK_PX) click?.part?.onDrag?.(dx, dy, e); return; }
    if (mode === 'pan') orbit.pan(dx, dy);
    else if (mode === 'rotate') orbit.rotate(dx, dy);
    else if (mode === 'idle' && moved > 24) { hint('Free view (the ◎ button, or Ctrl+Shift+↑) to look around'); mode = 'hinted'; }
  }));

  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size > 0) { if (mode === 'pinch') mode = 'idle'; return; }
    if (mode === 'key' && held !== null) { const k = held; setTimeout(() => press(k, 0), 40); held = null; }
    if (mode === 'control') click?.part?.onDragEnd?.();
    if (click && moved < CLICK_PX && e.type === 'pointerup') {
      if (click.kind === 'control') {
        const part = click.entry.part();
        if (part?.onClick) part.onClick();
        else if (click.fallback) { show(null, e); nav.go(click.fallback.id); }
      } else if (click.kind === 'nav') { show(null, e); nav.go(click.target.id); }
    }
    click = null; mode = null; pinch = null; orbit.dragging = false;
  };
  offs.push(on('pointerup', end));
  offs.push(on('pointercancel', end));
  offs.push(on('pointerleave', (e) => { if (!pointers.has(e.pointerId)) show(null, e); }));
  offs.push(on('wheel', (e) => {
    e.preventDefault();
    const hit = pick(e);
    const wheel = hit?.kind === 'control' ? (hit.part ?? hit.entry.part())?.onWheel : null;
    if (wheel) { wheel(e.deltaY); return; }
    if (!nav.free) { hint('Free view (the ◎ button, or Ctrl+Shift+↑) to zoom and look around'); return; }
    const r = canvas.getBoundingClientRect();
    orbit.zoom(Math.exp(e.deltaY * 0.0012), ((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }, { passive: false }));
  return { dispose: () => { for (const off of offs) off(); } };
}

function pinchOf(pointers) {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

/**
 * The hover highlight on whatever a click would move the camera to: an outline and a faint fill over its box, drawn
 * over everything. Returns show(box | null).
 */
export function makeHighlight(scene, color = 0xf2b56b) {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const group = new THREE.Group();
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(cube), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }));
  const fill = new THREE.Mesh(cube, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthTest: false, depthWrite: false, toneMapped: false }));
  lines.renderOrder = fill.renderOrder = 999;
  group.add(fill, lines);
  group.visible = false;
  scene.add(group);
  const PAD = 0.008;
  return (b) => {
    group.visible = !!b;
    if (!b) return;
    group.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    group.scale.set(b.max[0] - b.min[0] + 2 * PAD, b.max[1] - b.min[1] + 2 * PAD, b.max[2] - b.min[2] + 2 * PAD);
  };
}
