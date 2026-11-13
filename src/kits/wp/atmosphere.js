// The word processor's room: the typewriters' time of day, weather and lightning (src/render/environment.js, with no
// lamp on this desk), their rain and thunder (src/audio/ambience.js) on the kit's one AudioContext, and the CRT's green
// glow, which is the room's main light once it is dark. The choices are remembered in localStorage.
import * as THREE from 'three';
import { installEnvironment, TIMES, WEATHERS } from '../../render/environment.js';
import { Ambience } from '../../audio/ambience.js';
import { envRowHtml, bindEnvRow } from '../../ui/panel.js';

const STORE_KEY = 'wp.atmosphere';
// P39's green (peak near 525 nm), a little desaturated as it comes off the beige plastics.
const PHOSPHOR = 0x5cff8a;
// The light the glass gives, in cd, for a screen output of 1 (see screenOutput): the near spill on the keyboard and the
// desk in front, and a wide, faint wash for the module's front, the printer's and diskette unit's near edges.
const SPILL_CD = 3.2, WASH_CD = 1.1;
// How much the eye makes of it: a clear day drowns the glow, a dark room adapts to it.
const SEEN_DAY = 0.45, SEEN_DARK = 1.9;
const SHADOW_EVERY = 3;              // frames between the spill's shadow-map updates, while the room is dim enough to see it

/** How much light the screen gives, about 0.05 to 0.15 for a page of text: beam level x (video on the lit cells + bare raster). */
export function screenOutput({ bright, hv, gain, lit, raster, emission = 2.4 }) {
  return Math.max(0, bright) * Math.max(0, Math.min(1, hv)) * (gain * lit + raster / emission);
}

/** The eye's weighting of the glow for a room light `ambient` (1 a clear day, about 0.1 at night). */
export function glowSeen(ambient) {
  const a = Math.min(1, Math.max(0, ambient));
  return SEEN_DARK + (SEEN_DAY - SEEN_DARK) * Math.sqrt(a);
}

export function loadAtmosphere(storage) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null'); } catch { raw = null; }
  const time = typeof raw?.time === 'number' && raw.time >= 0 && raw.time <= 1 ? raw.time : TIMES.includes(raw?.time) ? raw.time : 'day';
  return { time, weather: WEATHERS.includes(raw?.weather) ? raw.weather : 'clear', sound: raw?.sound !== false };
}

/**
 * stage, machine; crt: the CRT; face: { parent, x, y, z } where the glass sits (the display's tilt node);
 * panel: the settings card's element; audio(): the kit's AudioContext or null before the first gesture;
 * storage: localStorage or null. Returns { environment, ambience, attachAudio(), update(dt) }.
 */
export function installAtmosphere({ stage, machine, crt, face, panel, audio, storage = null }) {
  const environment = installEnvironment({ stage, machine });   // no lamp, no lamp picker; the panel row is bound below
  const ambience = new Ambience({ environment, context: audio });

  // The glow: a near spot from just in front of the glass, down over the keyboard, soft-edged, with a shadow of the
  // keys and the operator's things; and a wide unshadowed wash from the same place, very soft, for the near edges.
  const at = new THREE.Vector3(face.x, face.y, face.z + 0.03);
  const spill = new THREE.SpotLight(PHOSPHOR, 0, 1.6, 0.95, 1, 2);
  spill.position.copy(at);
  spill.target.position.set(face.x, face.y - 0.42, face.z + 0.55);
  spill.castShadow = true;
  spill.shadow.mapSize.set(512, 512);
  spill.shadow.camera.near = 0.02; spill.shadow.camera.far = 1.4;
  spill.shadow.bias = -0.0008; spill.shadow.normalBias = 0.002;
  spill.shadow.radius = 4;
  spill.shadow.autoUpdate = false;
  spill.shadow.needsUpdate = true;
  const wash = new THREE.SpotLight(PHOSPHOR, 0, 1.4, 1.45, 1, 2);
  wash.position.copy(at);
  wash.target.position.set(face.x, face.y - 0.2, face.z + 0.6);
  face.parent.add(spill, spill.target, wash, wash.target);

  // The panel: the same strip and weather buttons as the typewriters', and their weather-sound switch.
  panel.insertAdjacentHTML('beforeend', `${envRowHtml()}
    <div class="actions"><label class="toggle" title="rain and thunder"><input type="checkbox" id="wxs" checked><span>WEATHER SOUND</span></label></div>`);
  const saved = loadAtmosphere(storage);
  const wxs = panel.querySelector('#wxs');
  const save = () => { try { storage?.setItem(STORE_KEY, JSON.stringify({ time: environment.timeValue, weather: environment.weather, sound: wxs.checked })); } catch { /* lasts the visit */ } };
  wxs.checked = saved.sound;
  ambience.setEnabled(saved.sound);
  wxs.addEventListener('change', () => { ambience.setEnabled(wxs.checked); save(); wxs.blur(); });
  environment.onChange((s) => { ambience.setWeather(s.weather); save(); });
  environment.setTime(saved.time);
  environment.setWeather(saved.weather);
  bindEnvRow(panel, environment);

  const u = crt.material.userData.uniforms;
  let frame = 0, glow = 0;
  return {
    environment, ambience, spill, wash,
    /** The kit's AudioContext has just been made, in the first gesture. */
    attachAudio() { ambience.attach(); },
    get glow() { return glow; },
    update(dt) {
      frame++;
      environment.update(dt);
      const out = screenOutput({ bright: u.uBright.value, hv: crt.hv, gain: crt.gain, lit: crt.litFraction, raster: u.uRaster.value, emission: u.uEmission.value });
      // The tube's light flickers with the screen, so it is not smoothed; the room's part is (environment.ambient).
      glow = out * glowSeen(environment.ambient);
      spill.intensity = SPILL_CD * glow;
      wash.intensity = WASH_CD * glow;
      if (spill.intensity > 0.02 && environment.ambient < 0.7 && frame % SHADOW_EVERY === 0) spill.shadow.needsUpdate = true;
    },
  };
}
