// The display station: the electronics module and the 25-line display on it, loaded from the Blender builds
// (tools/blender/build_wp_station.py, build_wp_display.py). Each builder returns its unit's group in the unit's own
// frame (origin on the surface it stands on, under its centre; x right, y up, z toward the typist) and the parts other
// code drives, as the primitive builders in units.js did. See docs/displaywriter/models.md, "Display station".
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { glbUnitMaterials } from './units.js';
import { mergeStaticMeshes, partObjects } from './merge-static.js';

export const STATION_URL = '/assets/models/wp_station.glb';
export const DISPLAY_URL = '/assets/models/wp_display.glb';
const ROCK = 0.16;            // rad: the rocker's throw either side of centre (build_wp_station.py ROCK)

async function load(url, mats) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const g = glbUnitMaterials(mats);
  const own = unitOwnMaterials(mats, g);
  const nodes = {};
  gltf.scene.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const name = o.material?.name ?? '';
    o.material = g[name] ?? own[name] ?? o.material;
  });
  return { scene: gltf.scene, nodes };
}

/** Materials only these two units use: the rocker's red, the bezel's grey, the badges, the rear panel's LED window
 * and legend and the label plate, whose artwork is drawn here. */
function unitOwnMaterials(mats, g) {
  if (mats.station) return mats.station;
  // The bezel round the tube: a warm mid grey, about two thirds as light as the Pearl White frame (PH
  // display_front_close, display_three_quarter), with the cover grain.
  const bezel = g.wp_dark.clone();
  bezel.color.set(0x948e82);
  g.ready?.then(() => { bezel.normalMap = g.wp_dark.normalMap; bezel.roughnessMap = g.wp_dark.roughnessMap; bezel.roughness = g.wp_dark.roughness; bezel.needsUpdate = true; });
  mats.station = {
    wp_bezel: bezel,
    wp_red: new THREE.MeshPhysicalMaterial({ color: 0xd2391c, roughness: 0.45, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    wp_badge: new THREE.MeshPhysicalMaterial({ map: badgeTexture(), roughness: 0.35, metalness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    wp_mbadge: new THREE.MeshPhysicalMaterial({ map: moduleBadgeTexture(), roughness: 0.4, metalness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.25 }),
    wp_tag: new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.6, metalness: 0 }),
    wp_legend: new THREE.MeshStandardMaterial({ map: legendTexture(), roughness: 0.55, metalness: 0 }),
    wp_window: new THREE.MeshStandardMaterial({ color: 0x2a1a16, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false }),
  };
  return mats.station;
}

/** IBM's striped initials, centred on (cx, cy), `h` tall: the letters cut by seven stripes of the ground. */
function stripedIBM(x, cx, cy, h, ink, ground) {
  x.fillStyle = ink;
  x.font = `900 ${Math.round(h * 1.37)}px "Rockwell", "Roboto Slab", "Georgia", serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.save(); x.translate(cx, cy + h * 0.07); x.scale(1.18, 1); x.fillText('IBM', 0, 0); x.restore();
  const bar = h / 15;
  x.fillStyle = ground;
  for (let i = 1; i < 15; i += 2) x.fillRect(cx - h * 2, cy - h / 2 + i * bar, h * 4, bar);
}

/**
 * The maker's badge above the display's knobs (PH display_front_close, BRO p.18, ST p.28): a square brushed light plate
 * with the striped initials in its upper half, drawn in a canvas at run time (architecture.md 13.2: names and marks,
 * our own artwork). The badge mesh's uv spans its face, 19 x 19 mm.
 */
function badgeTexture() {
  const W = 200, H = 200, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const plate = x.createLinearGradient(0, 0, W, H);
  plate.addColorStop(0, '#d9d9d4'); plate.addColorStop(0.5, '#c4c5c1'); plate.addColorStop(1, '#d2d2cd');
  x.fillStyle = plate; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#a9aaa6'; x.lineWidth = 4; x.strokeRect(2, 2, W - 4, H - 4);
  stripedIBM(x, W / 2, H * 0.33, 46, '#2a2f38', plate);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = false;
  return t;
}

/**
 * The module's badge at the front right (PH module_front_power_switch): a black plate with the striped initials in
 * silver and "Displaywriter System" in two lines of light italic under them; 38 x 28 mm.
 */
function moduleBadgeTexture() {
  const W = 380, H = 280, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#1d1d1f'; x.fillRect(0, 0, W, H);
  stripedIBM(x, W * 0.55, H * 0.3, 74, '#c8c9c6', '#1d1d1f');
  x.fillStyle = '#b9bab6';
  x.font = 'italic 300 40px "Helvetica Neue", "Arial", sans-serif';
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.fillText('Displaywriter', W * 0.2, H * 0.7);
  x.fillText('System', W * 0.2, H * 0.86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = false;
  return t;
}

/**
 * The printing beside the LED column on rear panel 1 (PH module_rear_led_column): the letters A to H, each level with
 * its LED, and the machine type running down the strip. The legend's uv spans 13 x 58 mm at 10 px a millimetre.
 */
function legendTexture() {
  const W = 130, H = 580, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#0f0f10'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e8e6e0';
  x.font = 'bold 34px "Helvetica Neue", "Arial", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) x.fillText('ABCDEFGH'[i], 22, 59 + 66 * i);
  x.save(); x.translate(88, 290); x.rotate(Math.PI / 2);
  x.font = '30px "Helvetica Neue", "Arial", sans-serif';
  x.fillText('6580-026', 0, 0);
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = false;
  return t;
}

/**
 * The machine's label plate at the rear right of the module (PH module_rear_panel): a ruled box of fine print, too
 * small to read at the desk, so it is drawn as lines of print rather than words.
 */
function labelTexture() {
  const W = 192, H = 120, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#c9c7bf'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#3a3a38'; x.lineWidth = 4; x.strokeRect(6, 6, W - 12, H - 12);
  x.fillStyle = '#4a4a46';
  const rows = [[0.12, 0.62], [0.12, 0.8], [0.12, 0.55], [0.12, 0.7]];
  rows.forEach(([a, b], i) => {
    for (let u = a; u < b; u += 0.07 + 0.03 * ((i * 7 + u * 31) % 1)) x.fillRect(u * W, 24 + i * 22, 0.05 * W, 8);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
  return t;
}

/**
 * Electronics module. parts.rocker is the power switch's red paddle (its node's origin on the axle, which runs front
 * to back); parts.setRocker(on) rocks it: on presses the I side (right) down, off the O side. parts.leds are the
 * status LEDs A to H on rear panel 1 (PH module_rear_led_column: G lights while the station runs), each with its own
 * material; parts.setLed(i, on) lights LED i (0 = A, or the letter).
 */
export async function buildStation(size, mats) {
  const { scene, nodes } = await load(STATION_URL, mats);
  const group = new THREE.Group();
  group.add(scene);
  const rocker = nodes.station_rocker;
  rocker.name = 'powerRocker';
  const setRocker = (on) => { rocker.rotation.z = on ? -ROCK : ROCK; };
  setRocker(false);
  const leds = [...'abcdefgh'].map((k) => {
    const n = nodes[`station_led_${k}`];
    let mesh = null;
    n.traverse((o) => { if (o.isMesh) mesh = o; });
    mesh.material = new THREE.MeshPhysicalMaterial({ color: 0x3a0604, emissive: 0xff2a12, emissiveIntensity: 0, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 });
    mesh.castShadow = false;
    n.name = `led${k.toUpperCase()}`;
    return n;
  });
  const setLed = (i, on) => {
    const k = typeof i === 'string' ? 'ABCDEFGH'.indexOf(i.toUpperCase()) : i;
    leds[k]?.traverse((o) => { if (o.isMesh) { o.material.emissiveIntensity = on ? 2.4 : 0; o.material.color.set(on ? 0xff3a20 : 0x3a0604); } });
  };
  const parts = { rocker, setRocker, leds, setLed };
  mergeStaticMeshes(group, partObjects(parts));
  return { group, parts };
}

/**
 * Display. parts.knobs are the contrast and brightness knobs (their nodes turn about z on their shafts); parts.tilt
 * and parts.swivel are the pivots: setTilt(rad) from 0 to the documented 20 degrees back, setSwivel(rad) within 12
 * degrees either way (HW 1.3). `face` is the tube face for makeTubeFace(w, h, radius), in `face.parent`'s frame
 * (the tilt node), so the glass tilts and turns with the cabinet.
 */
export async function buildDisplay(size, mats, { tilt = [0, 20 * Math.PI / 180], swivel = [-12 * Math.PI / 180, 12 * Math.PI / 180] } = {}) {
  const { scene, nodes } = await load(DISPLAY_URL, mats);
  const group = new THREE.Group();
  group.add(scene);
  const tiltNode = nodes.display_tilt, swivelNode = nodes.display_swivel;
  const knobs = [nodes.display_knob_contrast, nodes.display_knob_brightness];
  knobs[0].name = 'contrast'; knobs[1].name = 'brightness';
  const f = JSON.parse(tiltNode.userData.face);
  const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));
  const parts = {
    knobs, tilt: tiltNode, swivel: swivelNode,
    setTilt: (a) => { tiltNode.rotation.x = -clamp(a, tilt); },       // positive leans the top back
    setSwivel: (a) => { swivelNode.rotation.y = clamp(a, swivel); },
  };
  mergeStaticMeshes(group, partObjects(parts));
  return { group, parts, face: { ...f, parent: tiltNode } };
}
