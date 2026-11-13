// The display station's controls that the mechanism host has no DOF for (architecture.md 3.6): the display's contrast
// and brightness knobs driving the CRT, the display's tilt and swivel, the rear panel's LEDs through the self-test,
// and the keyboard's information card window. Each is a pickable for the word processor's pointer (wp-pointer.js);
// the positions are view-side state, remembered in localStorage. The logic is in controls.js.
import * as THREE from 'three';
import { crtDrive, knobAngle, knobDetent, loadDisplaySettings, saveDisplaySettings, stationLeds } from './controls.js';

const KNOB_PER_PX = 1 / 260;                 // a knob's whole travel over 260 px of drag
const KNOB_PER_WHEEL = 1 / 24 / 100;         // one detent per wheel notch (deltaY 100)
const TILT_PER_PX = 0.0028, SWIVEL_PER_PX = 0.0035;   // rad per px of drag on the cabinet
const WINDOW_LIFT = 32 * Math.PI / 180;      // the card window lifted on its back edge

/**
 * parts: { station, display, keyboard } as the views return them; crt: the CRT; limits: { tilt, swivel } (rad, from
 * the definition); storage: localStorage (or null); tick(): a faint detent click; poweredAt(): the sim time the
 * station was switched on, or null when off; now(): the sim time. Pushes its pickables to `pickables`. Returns
 * { settings, update(dt) }.
 */
export function installStationControls({ parts, crt, limits, storage = null, tick = () => {}, poweredAt, now, pickables }) {
  const settings = loadDisplaySettings(storage, limits);
  const save = () => saveDisplaySettings(storage, settings);
  const D = parts.display;

  // The knobs: a drag turns one (up or right is clockwise), the wheel turns it a detent a notch while the pointer is
  // over it. Contrast is the left-hand knob's name in the model, brightness the other's.
  const knobs = D.knobs.map((node, i) => ({ node, key: i === 0 ? 'contrast' : 'brightness', rest: node.rotation.z }));
  const applyKnobs = () => {
    crt.setKnobs(crtDrive(settings));
    for (const k of knobs) k.node.rotation.z = k.rest - knobAngle(settings[k.key]);
  };
  const turn = (k, dv) => {
    const before = settings[k.key];
    settings[k.key] = Math.min(1, Math.max(0, before + dv));
    if (knobDetent(settings[k.key]) !== knobDetent(before)) tick();
    applyKnobs();
  };
  let saveTimer = 0;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); };
  for (const k of knobs) {
    const name = k.key === 'contrast' ? 'Contrast' : 'Brightness';
    pickables.push({ object: k.node, part: () => ({
      label: `${name} ${Math.round(settings[k.key] * 100)}% · drag to turn`,
      onDrag: (dx, dy) => turn(k, (dx - dy) * KNOB_PER_PX),
      onClick: () => {},   // a knob is turned, not clicked: a click stays here rather than moving the view
      onDragEnd: save,
      onWheel: (dy) => { turn(k, -dy * KNOB_PER_WHEEL); saveSoon(); },
    }) });
  }
  applyKnobs();

  // Tilt and swivel: a drag on the cabinet (the swivel node holds it, the knobs and the glass). Up leans the top back,
  // sideways turns it. A click passes on to the view behind (the screen).
  const applyPose = () => { D.setTilt(settings.tilt); D.setSwivel(settings.swivel); };
  const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));
  pickables.push({ object: D.swivel, part: () => ({
    label: 'Display · drag to tilt and swivel',
    onDrag: (dx, dy) => {
      settings.tilt = clamp(settings.tilt - dy * TILT_PER_PX, limits.tilt);
      settings.swivel = clamp(settings.swivel + dx * SWIVEL_PER_PX, limits.swivel);
      applyPose();
    },
    onDragEnd: save,
  }) });
  applyPose();

  // The rear LEDs, set only when one changes.
  const S = parts.station;
  let lastLeds = -1;
  const updateLeds = () => {
    const at = poweredAt();
    const bits = stationLeds(at === null ? null : now() - at);
    if (bits === lastLeds) return;
    for (let i = 0; i < 8; i++) if (((bits ^ lastLeds) >> i) & 1 || lastLeds < 0) S.setLed(i, !!(bits & (1 << i)));
    lastLeds = bits;
  };
  for (const led of S.leds) pickables.push({ object: led, part: () => ({ label: `LED ${led.name.slice(3)} (${(lastLeds >> S.leds.indexOf(led)) & 1 ? 'lit' : 'dark'})` }) });

  // The keyboard's card window, hinged on its back edge: a click lifts it off the card or lays it back.
  const win = parts.keyboard.window ? hingeOnBackEdge(parts.keyboard.window) : null;
  let winOpen = false, winA = 0;
  if (win) pickables.push({ object: parts.keyboard.window, part: () => ({ label: winOpen ? 'Card window: lay it back' : 'Card window: lift it', onClick: () => { winOpen = !winOpen; } }) });

  return {
    settings,
    update(dt) {
      updateLeds();
      if (win) {
        const target = winOpen ? WINDOW_LIFT : 0;
        winA += (target - winA) * (1 - Math.exp(-dt / 0.08));
        if (Math.abs(target - winA) < 1e-4) winA = target;
        win.set(winA);
      }
    },
  };
}

/**
 * Puts `obj` on a hinge along its back edge (its least z, at its top), in its parent's frame. Returns
 * { set(angle) }: the front edge rises with a positive angle.
 */
function hingeOnBackEdge(obj) {
  const parent = obj.parent;
  parent.updateWorldMatrix(true, true);
  const box = new THREE.Box3(), inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), m = new THREE.Matrix4();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  const hingeLocal = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, box.min.z);
  const pivot = new THREE.Group();
  pivot.name = `${obj.name}_hinge`;
  pivot.position.copy(hingeLocal.applyMatrix4(obj.matrix));
  pivot.quaternion.copy(obj.quaternion);
  parent.add(pivot);
  pivot.updateWorldMatrix(true, false);
  pivot.attach(obj);
  const base = pivot.quaternion.clone(), q = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
  return { set: (a) => { pivot.quaternion.copy(base).multiply(q.setFromAxisAngle(X, -a)); } };
}
