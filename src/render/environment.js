// The room around the machine: time of day, weather, lightning, and a banker's lamp on the desk that comes on when it is dark.
// window.__tw.environment: setTime(name or 0..1), setWeather(name), setLamp(on), flash(strength), onChange(fn).
// Everything lighting-related is set here each frame from a smoothed state, so a change eases in and "day, clear" is exactly the base look.
import * as THREE from 'three';
import { setEnvTint, setContactDisc } from './look.js';

export const TIMES = ['dawn', 'day', 'afternoon', 'dusk', 'night'];
export const WEATHERS = ['clear', 'rain', 'storm'];

const TIME = {
  dawn:      { env: 0.34, envTint: [1.05, 0.8, 0.68], bg: 0.28, bgTint: [1.25, 0.82, 0.62], key: 2.1, keyColor: 0xffb074, keyPos: [-0.95, 0.27, 0.3], rim: 0.35, rimColor: 0xffc9a8, exposure: 1.08 },
  day:       { env: 0.6, envTint: [1, 1, 1], bg: 0.45, bgTint: [1, 1, 1], key: 3.2, keyColor: 0xfff0dd, keyPos: [-0.75, 0.62, 0.42], rim: 0.5, rimColor: 0xcfdcff, exposure: 1 },
  afternoon: { env: 0.56, envTint: [1.06, 0.97, 0.86], bg: 0.42, bgTint: [1.12, 0.97, 0.82], key: 3.3, keyColor: 0xffd9a8, keyPos: [-0.9, 0.42, 0.34], rim: 0.45, rimColor: 0xe6e0ff, exposure: 1 },
  dusk:      { env: 0.17, envTint: [0.92, 0.72, 0.8], bg: 0.14, bgTint: [1.0, 0.6, 0.72], key: 1.1, keyColor: 0xff8a4a, keyPos: [-0.97, 0.2, 0.12], rim: 0.28, rimColor: 0xe6d0dc, exposure: 1.1 },
  night:     { env: 0.07, envTint: [0.62, 0.72, 1], bg: 0.05, bgTint: [0.5, 0.62, 1], key: 0.16, keyColor: 0x8fa8e8, keyPos: [-0.55, 0.8, 0.3], rim: 0.14, rimColor: 0xc2cced, exposure: 1.15 },
};

// The time line runs midnight to midnight; presets sit on it and the state between them is interpolated.
const KEYS = [[0, 'night'], [0.2, 'dawn'], [0.45, 'day'], [0.65, 'afternoon'], [0.82, 'dusk'], [1, 'night']];
const PRESET_T = { dawn: 0.2, day: 0.45, afternoon: 0.65, dusk: 0.82, night: 1 };
const isDark = (t) => t < 0.12 || t >= 0.76;

const WEATHER = {
  clear: { env: 1, bg: 1, key: 1, tint: [1, 1, 1] },
  rain:  { env: 0.72, bg: 0.62, key: 0.32, tint: [0.86, 0.92, 1] },
  storm: { env: 0.5, bg: 0.4, key: 0.12, tint: [0.74, 0.82, 1] },
};

// Lamp placement: left of the fresh-paper stack, turned to face the machine.
const LAMP_AT = { x: -0.5, z: -0.33 };
const LAMP_YAW = Math.atan2(0.5, 0.37);
const SHADE_TILT = 0.24;          // rad; the front lip comes down toward the typist, so nobody seated sees under the shade
const SPOT_INTENSITY = 3.2;       // cd, with a decay of 1: a broad source, so the stack by the lamp does not burn out while the machine is well lit
const SPOT_SHADOW_EVERY = 4;      // frames between shadow-map updates while lit
const CHAIN_LENGTH = 0.075;
const LAMP_SCALE = 1.45;          // the model is authored a little small; this makes it about 37 cm tall with a 26 cm shade
const OVERHEAD_INTENSITY = 0.8;   // cd; a soft light over the keyboard and the print point in the dark

function brassMat() { return new THREE.MeshStandardMaterial({ color: 0xb08f52, metalness: 1, roughness: 0.3 }); }

function buildLamp() {
  const lamp = new THREE.Group();
  const brass = brassMat();
  const solid = (geo, mat = brass) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return m; };

  // Base: a stepped dome, with a stem up to the shade and a short forward arm.
  const profile = [[0, 0], [0.066, 0], [0.069, 0.003], [0.068, 0.008], [0.05, 0.013], [0.03, 0.02], [0.016, 0.03], [0.009, 0.042], [0, 0.044]].map(([r, y]) => new THREE.Vector2(r, y));
  lamp.add(solid(new THREE.LatheGeometry(new THREE.SplineCurve(profile).getPoints(40), 64)));
  const SHADE_C = new THREE.Vector3(0, 0.205, 0.046);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, 0.16, 0), new THREE.Vector3(0, 0.198, 0.012), new THREE.Vector3(0, 0.21, SHADE_C.z - 0.012)]);
  lamp.add(solid(new THREE.TubeGeometry(curve, 48, 0.0052, 14)));
  const collar = solid(new THREE.CylinderGeometry(0.0095, 0.011, 0.012, 24));
  collar.position.y = 0.05;
  lamp.add(collar);

  // Shade: a long half cylinder, cased glass: emerald outside, opal white inside.
  const L = 0.178, R = 0.047;
  const halfTube = (r, side) => {
    const g = new THREE.CylinderGeometry(r, r, L, 56, 1, true, 0, Math.PI).rotateZ(Math.PI / 2);
    g.computeVertexNormals();
    return { g, side };
  };
  const shadeGroup = new THREE.Group();
  shadeGroup.position.copy(SHADE_C);
  shadeGroup.rotation.x = SHADE_TILT;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b4a2a, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.25, emissive: 0x136d3a, emissiveIntensity: 0 });
  const opal = new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.55, metalness: 0, side: THREE.BackSide, emissive: 0xffd9a6, emissiveIntensity: 0 });
  const outer = new THREE.Mesh(halfTube(R, THREE.FrontSide).g, glass);
  outer.castShadow = false;
  const inner = new THREE.Mesh(halfTube(R * 0.955, THREE.BackSide).g, opal);
  inner.castShadow = false;
  // The ends, half discs of the same glass.
  const endGeo = new THREE.CircleGeometry(R, 40, 0, Math.PI);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(endGeo, new THREE.MeshPhysicalMaterial({ color: 0x0b4a2a, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide, emissive: 0x136d3a, emissiveIntensity: 0, envMapIntensity: 1.25 }));
    e.rotation.y = s * Math.PI / 2;
    e.position.x = s * L / 2;
    shadeGroup.add(e);
  }
  // Brass spine along the top and end rims.
  const spine = solid(new THREE.CylinderGeometry(0.004, 0.004, L + 0.012, 12).rotateZ(Math.PI / 2));
  spine.position.y = R + 0.0015;
  spine.castShadow = false;
  shadeGroup.add(spine, outer, inner);
  lamp.add(shadeGroup);

  // Bulb and socket, recessed inside the shade.
  const socket = solid(new THREE.CylinderGeometry(0.011, 0.012, 0.012, 20), new THREE.MeshStandardMaterial({ color: 0x4a3b22, metalness: 0.9, roughness: 0.35 }));
  socket.position.set(0, 0.04, 0); socket.castShadow = false;
  shadeGroup.add(socket);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.015, 24, 16), bulbMat);
  bulb.position.set(0, 0.024, 0); bulb.castShadow = false; bulb.name = 'lamp-bulb';
  shadeGroup.add(bulb);

  // Pull chain: from the socket, straight down under gravity whatever the shade's tilt, swinging about its top.
  const c = Math.cos(SHADE_TILT), sn = Math.sin(SHADE_TILT), sy = 0.012;
  const chainPivot = new THREE.Group();
  chainPivot.position.set(SHADE_C.x + 0.028, SHADE_C.y + sy * c, SHADE_C.z + sy * sn);
  const chain = solid(new THREE.CylinderGeometry(0.0006, 0.0006, CHAIN_LENGTH, 6).translate(0, -CHAIN_LENGTH / 2, 0));
  chain.castShadow = false;
  const bob = solid(new THREE.SphereGeometry(0.0034, 14, 10));
  bob.position.y = -CHAIN_LENGTH; bob.castShadow = false;
  chainPivot.add(chain, bob);
  lamp.add(chainPivot);

  const hit = new THREE.MeshBasicMaterial({ visible: false });
  const baseProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 18).translate(0, 0.025, 0), hit);
  const stemProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8).translate(0, 0.12, 0), hit);
  const shadeProxy = new THREE.Mesh(new THREE.BoxGeometry(L + 0.01, R * 1.7, R * 1.7), hit);
  shadeProxy.position.copy(SHADE_C);
  shadeProxy.rotation.x = SHADE_TILT;
  lamp.add(baseProxy, stemProxy, shadeProxy);

  return { lamp, glass, opal, bulbMat, bulb, chainPivot, shadeGroup, ends: [...shadeGroup.children].filter((c) => c.material?.side === THREE.DoubleSide && c.isMesh), proxies: [baseProxy, stemProxy, shadeProxy] };
}

/** Makes the backdrop tintable: three clones Vector3 uniforms but keeps a plain object by reference, and the upload only reads x, y, z. */
function installBackgroundTint() {
  const tint = { x: 1, y: 1, z: 1 };
  const lib = THREE.ShaderLib.backgroundCube;
  if (!lib.uniforms.uBgTint) {
    lib.uniforms.uBgTint = { value: tint };
    lib.fragmentShader = lib.fragmentShader
      .replace('uniform float backgroundIntensity;', 'uniform float backgroundIntensity;\nuniform vec3 uBgTint;')
      .replace('texColor.rgb *= backgroundIntensity;', 'texColor.rgb *= backgroundIntensity * uBgTint;');
  } else { return lib.uniforms.uBgTint.value; }
  return tint;
}

const lerp = (a, b, k) => a + (b - a) * k;

export function installEnvironment({ stage, interaction, panel }) {
  const { scene, renderer, key, rim, look } = stage;
  const bgTint = installBackgroundTint();

  // State the sliders drive: `target` jumps, `cur` eases toward it.
  const mkState = (t) => ({
    env: t.env, bg: t.bg, key: t.key, rim: t.rim, exposure: t.exposure,
    envTint: new THREE.Vector3(...t.envTint), bgTint: new THREE.Vector3(...t.bgTint),
    keyPos: new THREE.Vector3(...t.keyPos), keyColor: new THREE.Color(t.keyColor), rimColor: new THREE.Color(t.rimColor),
    lamp: 0, dark: 0,
  });
  const cur = mkState(TIME.day);
  const target = mkState(TIME.day);
  let timeValue = PRESET_T.day, weather = 'clear', wasDark = isDark(timeValue);
  let lampOn = false, frame = 0;
  const listeners = new Set();
  const nearestTime = () => KEYS.reduce((best, k) => (Math.abs(k[0] - timeValue) < Math.abs(best[0] - timeValue) ? k : best))[1];
  const emit = () => { const s = { time: nearestTime(), weather, lamp: lampOn }; for (const f of listeners) { try { f(s); } catch (e) { console.warn(e); } } };

  // The lamp.
  const { lamp, glass, opal, bulbMat, bulb, chainPivot, ends, proxies } = buildLamp();
  lamp.position.set(LAMP_AT.x, 0, LAMP_AT.z);
  lamp.rotation.y = LAMP_YAW;
  lamp.scale.setScalar(LAMP_SCALE);
  setContactDisc(LAMP_AT.x, LAMP_AT.z, 0.069 * LAMP_SCALE);   // the base's outer radius
  scene.add(lamp);
  // Aimed from the bulb to the middle of the machine, wide enough for the pool to take in the keyboard and the sheet.
  const spot = new THREE.SpotLight(0xffd2a0, 0, 2.2, 0.82, 0.8, 1);
  lamp.updateMatrixWorld(true);
  bulb.getWorldPosition(spot.position);
  spot.target.position.set(0.02, 0.07, 0.06);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.camera.near = 0.04; spot.shadow.camera.far = 1.3;
  spot.shadow.bias = -0.0006; spot.shadow.normalBias = 0.0018;
  spot.shadow.autoUpdate = false;
  spot.shadow.needsUpdate = true;
  scene.add(spot, spot.target);
  // The overhead: unshadowed and soft, on the typing area only, so the lamp keeps its warm pool on the desk.
  const overhead = new THREE.SpotLight(0xffe6c8, 0, 1.6, 0.55, 1, 2);
  overhead.position.set(0, 0.72, 0.07);
  overhead.target.position.set(0, 0.12, 0.03);
  scene.add(overhead, overhead.target);

  if (interaction) {
    const part = () => ({ kind: 'lamp', label: `Banker's lamp (${lampOn ? 'on' : 'off'}): click to switch`, cursor: 'pointer', visual: () => null, onClick: () => { api.setLamp(!lampOn); swing.vz += 4.5; } });
    for (const object of proxies) interaction.picker.add({ object, part });
  }

  // The chain as a damped pendulum (small, and asleep when still).
  const swing = { x: 0, z: 0, vx: 0, vz: 0 };

  // Lightning: a sum of short decaying pulses.
  const pulses = [];
  let flashNow = 0, flashV = 0;
  const flashRim = new THREE.Color(0xdfe9ff);
  const tmpCol = new THREE.Color(), rimColor = new THREE.Color(), tmpC = new THREE.Vector3(), tmpB = new THREE.Vector3();

  function retarget() {
    let i = 0;
    while (i < KEYS.length - 2 && timeValue > KEYS[i + 1][0]) i++;
    const [t0, n0] = KEYS[i], [t1, n1] = KEYS[i + 1], A = TIME[n0], B = TIME[n1], f = (timeValue - t0) / (t1 - t0), w = WEATHER[weather];
    const tg = target;
    tg.env = lerp(A.env, B.env, f) * w.env; tg.bg = lerp(A.bg, B.bg, f) * w.bg; tg.key = lerp(A.key, B.key, f) * w.key;
    tg.rim = lerp(A.rim, B.rim, f); tg.exposure = lerp(A.exposure, B.exposure, f);
    tg.envTint.fromArray(A.envTint).lerp(tmpC.fromArray(B.envTint), f).multiply(tmpC.fromArray(w.tint));
    tg.bgTint.fromArray(A.bgTint).lerp(tmpB.fromArray(B.bgTint), f).multiply(tmpB.fromArray(w.tint));
    tg.keyPos.fromArray(A.keyPos).lerp(tmpB.fromArray(B.keyPos), f);
    tg.keyColor.set(A.keyColor).lerp(tmpCol.set(B.keyColor), f);
    tg.rimColor.set(A.rimColor).lerp(tmpCol.set(B.rimColor), f);
  }

  const api = {
    /** A preset name, or a position on the day from 0 (midnight) to 1 (midnight). Crossing into the dark switches the lamp on, and out of it off. */
    setTime(value) {
      const t = typeof value === 'number' ? Math.min(1, Math.max(0, value)) : PRESET_T[value];
      if (t === undefined || t === timeValue) return;
      timeValue = t;
      const dark = isDark(t);
      if (dark !== wasDark) { wasDark = dark; api.setLamp(dark, true); }
      retarget(); emit();
    },
    setWeather(name) { if (!WEATHER[name] || name === weather) return; weather = name; retarget(); emit(); },
    setLamp(on, silent) { lampOn = !!on; if (on) spot.shadow.needsUpdate = true; if (!silent) emit(); },
    /** Lightning through the window side: a two or three stroke flicker over a few hundred ms. strength 0..1. */
    flash(strength = 1) {
      const s = Math.min(1.2, Math.max(0, strength));
      const n = 2 + (Math.random() < 0.55 ? 1 : 0);
      let at = flashNow;
      for (let i = 0; i < n; i++) {
        pulses.push({ at, a: s * (i === 0 ? 1 : 0.35 + Math.random() * 0.75), tau: 0.045 + Math.random() * 0.075 });
        at += 0.05 + Math.random() * 0.13;
      }
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get time() { return nearestTime(); },
    get timeValue() { return timeValue; },
    presets: PRESET_T,
    lampObject: lamp,
    get weather() { return weather; },
    get lampOn() { return lampOn; },
    get flashValue() { return flashV; },
    times: TIMES,
    weathers: WEATHERS,
    /** One frame: eases the state, sets every light, and keeps the paper shader's key direction current (keyWorld). */
    update(dt, keyWorld) {
      frame++;
      flashNow += dt;
      const k = 1 - Math.exp(-dt / 0.45);
      const c = cur, t = target;
      c.env = lerp(c.env, t.env, k); c.bg = lerp(c.bg, t.bg, k); c.key = lerp(c.key, t.key, k); c.rim = lerp(c.rim, t.rim, k);
      c.exposure = lerp(c.exposure, t.exposure, k);
      c.envTint.lerp(t.envTint, k); c.bgTint.lerp(t.bgTint, k); c.keyPos.lerp(t.keyPos, k);
      c.keyColor.lerp(t.keyColor, k); c.rimColor.lerp(t.rimColor, k);
      if (swing.x || swing.z || swing.vx || swing.vz) {
        const g = 9.8 / CHAIN_LENGTH, h = Math.min(dt, 0.033);
        swing.vx += (-g * Math.sin(swing.x) - 2.2 * swing.vx) * h; swing.vz += (-g * Math.sin(swing.z) - 2.2 * swing.vz) * h;
        swing.x += swing.vx * h; swing.z += swing.vz * h;
        if (Math.abs(swing.x) + Math.abs(swing.z) + Math.abs(swing.vx) + Math.abs(swing.vz) < 2e-3) swing.x = swing.z = swing.vx = swing.vz = 0;
        chainPivot.rotation.set(swing.x, 0, swing.z);
      }
      const sstep = (a, b, v) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };
      c.dark = lerp(c.dark, Math.max(sstep(0.72, 0.88, timeValue), 1 - sstep(0.08, 0.2, timeValue)), k);
      c.lamp = lerp(c.lamp, lampOn ? 1 : 0, 1 - Math.exp(-dt / (lampOn ? 0.09 : 0.18)));
      if (Math.abs(c.lamp) < 1e-3) c.lamp = 0;

      // The flash value: sum of decayed strokes; expired ones drop off.
      let v = 0;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i], a = flashNow - p.at;
        if (a < 0) continue;
        const e = p.a * Math.exp(-a / p.tau);
        if (e < 0.004) { pulses.splice(i, 1); continue; }
        v += e;
      }
      flashV = Math.min(1.5, v);

      // Apply. The room's image-based light and backdrop, then the sun, then the window-side rim, then the lamp.
      scene.environmentIntensity = c.env * (1 + flashV * 2.2);
      scene.backgroundIntensity = c.bg * (1 + flashV * 5);
      const coolFlash = flashV * 0.5;
      setEnvTint(lerp(c.envTint.x, 0.95, Math.min(1, coolFlash)), lerp(c.envTint.y, 1.0, Math.min(1, coolFlash)), lerp(c.envTint.z, 1.15, Math.min(1, coolFlash)));
      bgTint.x = lerp(c.bgTint.x, 1, Math.min(1, coolFlash)); bgTint.y = lerp(c.bgTint.y, 1.05, Math.min(1, coolFlash)); bgTint.z = lerp(c.bgTint.z, 1.2, Math.min(1, coolFlash));
      key.intensity = c.key;
      key.color.copy(c.keyColor);
      key.position.copy(c.keyPos);
      key.updateMatrixWorld();
      if (keyWorld) keyWorld.copy(key.position).sub(key.target.position).normalize();
      rimColor.copy(c.rimColor).lerp(flashRim, Math.min(1, flashV * 2));
      rim.color.copy(rimColor);
      rim.intensity = c.rim + flashV * 9;
      renderer.toneMappingExposure = look.exposure * c.exposure;

      // Lamp output: the spot, the glowing shade, the bulb.
      const l = c.lamp;
      spot.intensity = l * SPOT_INTENSITY;
      overhead.intensity = c.dark * OVERHEAD_INTENSITY;
      if (l > 0.004 && frame % SPOT_SHADOW_EVERY === 0) spot.shadow.needsUpdate = true;
      glass.emissiveIntensity = l * 0.24;
      for (const e of ends) e.material.emissiveIntensity = l * 0.24;
      opal.emissiveIntensity = l * 2.4;
      bulbMat.color.setRGB(1, 0.82, 0.55).multiplyScalar(l * 32);
    },
  };

  retarget();
  if (panel?.bindEnvironment) panel.bindEnvironment(api);
  return api;
}
