// The logic behind the word processor's physical controls that has no mechanism of its own in the host: the display's
// knobs and how they drive the CRT, the display's tilt and swivel as remembered, the station's rear LEDs through the
// power-on self-test, and the sheet feeder's on/off flag shared by the feeder's gate and the panel's button. Plain
// functions and objects, no three.js and no DOM, so the tests run them in Node (architecture.md 3.6).

export const KNOB_TURN = 270 * Math.PI / 180;      // rad from one end stop of a knob to the other (assumed: a usual pot)
export const KNOB_DETENTS = 24;                    // ticks over the whole turn, for the faint detent sound
export const DISPLAY_DEFAULTS = Object.freeze({ contrast: 0.5, brightness: 0.5, tilt: 0, swivel: 0 });
const STORE_KEY = 'typewriter.wp.display';

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
const clampTo = (v, [a, b]) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : null);

/**
 * The knobs' positions (0 at the left stop, 1 at the right) as the CRT's drive. Contrast is the video amplifier's gain
 * on the characters: 0.3 to 1.7 of nominal, nominal at mid travel. Brightness is the grid bias: the whole picture's
 * level from 0.55 to 1.45 of nominal, and the bare raster's glow from black to a plainly grey field (0.002 to 0.082,
 * 0.022 at mid travel, where the unlit raster is plainly visible, HW 1.4). Out-of-range inputs sit at the stops.
 */
export function crtDrive({ contrast = DISPLAY_DEFAULTS.contrast, brightness = DISPLAY_DEFAULTS.brightness } = {}) {
  const c = clamp01(contrast) ?? DISPLAY_DEFAULTS.contrast, b = clamp01(brightness) ?? DISPLAY_DEFAULTS.brightness;
  return { gain: 0.3 + 1.4 * c, level: 0.55 + 0.9 * b, raster: 0.002 + 0.08 * b * b };
}

/** A knob's turn from its mid position (rad, clockwise seen from the front positive) for a position 0..1. */
export const knobAngle = (v) => (clamp01(v) - 0.5) * KNOB_TURN;

/** The detent a knob position falls in: a tick sounds when this changes. */
export const knobDetent = (v) => Math.round(clamp01(v) * KNOB_DETENTS);

/**
 * The display's remembered settings, clamped to the knobs' travel and the cradle's limits (tilt and swivel in rad, as
 * the definition gives them). storage is localStorage or anything with getItem; a missing or broken entry gives the
 * defaults.
 */
export function loadDisplaySettings(storage, { tilt = [0, 20 * Math.PI / 180], swivel = [-12 * Math.PI / 180, 12 * Math.PI / 180] } = {}) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null'); } catch { raw = null; }
  const d = DISPLAY_DEFAULTS;
  return {
    contrast: clamp01(raw?.contrast) ?? d.contrast,
    brightness: clamp01(raw?.brightness) ?? d.brightness,
    tilt: clampTo(raw?.tilt, tilt) ?? clampTo(d.tilt, tilt),
    swivel: clampTo(raw?.swivel, swivel) ?? clampTo(d.swivel, swivel),
  };
}

export function saveDisplaySettings(storage, s) {
  try { storage?.setItem(STORE_KEY, JSON.stringify({ contrast: s.contrast, brightness: s.brightness, tilt: s.tilt, swivel: s.swivel })); } catch { /* private window */ }
}

/**
 * The rear panel's LEDs A to H (bit 0 = A) at `t` s after the station was switched on, or null when it is off: every
 * LED lights as the supply comes up, the self-test then steps one light down the column, A to H, and once the test
 * has passed only G stays lit while the station runs (the owner's photograph, module_rear_led_column_lit).
 */
export const LED_SEQUENCE = Object.freeze({ allOn: 1.2, step: 0.3, running: 6 });   // s: all on, each step, G's bit index
export function stationLeds(t) {
  if (t === null || t === undefined || !(t >= 0)) return 0;
  if (t < LED_SEQUENCE.allOn) return 0xff;
  const k = Math.floor((t - LED_SEQUENCE.allOn) / LED_SEQUENCE.step + 1e-9);
  if (k < 8) return 1 << k;
  return 1 << LED_SEQUENCE.running;
}

/**
 * The sheet feeder's on/off flag (the gate at automatic or manual feed), one object for every place that shows or
 * sets it: the printer's device reads `on`, the gate and the panel's button set it and listen for changes.
 */
export function makeFeeder(on = true) {
  let v = !!on;
  const fns = [];
  return {
    get on() { return v; },
    set on(x) { x = !!x; if (x === v) return; v = x; for (const fn of fns) fn(v); },
    toggle() { this.on = !v; return v; },
    onChange(fn) { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
  };
}
