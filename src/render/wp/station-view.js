// The display station: the electronics module and the 25-line display on it, loaded from the Blender builds
// (tools/blender/build_wp_station.py, build_wp_display.py). Each builder returns its unit's group in the unit's own
// frame (origin on the surface it stands on, under its centre; x right, y up, z toward the typist) and the parts other
// code drives, as the primitive builders in units.js did. See docs/displaywriter/models.md, "Display station".
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { glbUnitMaterials } from './units.js';

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

/** Materials only these two units use: the rocker's red, the bezel's grey, and the display's badge and label, whose
 * artwork is drawn here. */
function unitOwnMaterials(mats, g) {
  if (mats.station) return mats.station;
  // The bezel round the tube: a charcoal grey, darker than the Pebble Gray base (BRO p.18), with the cover grain.
  const bezel = g.wp_dark.clone();
  bezel.color.set(0x4b4945);
  g.ready?.then(() => { bezel.normalMap = g.wp_dark.normalMap; bezel.roughnessMap = g.wp_dark.roughnessMap; bezel.roughness = g.wp_dark.roughness; bezel.needsUpdate = true; });
  mats.station = {
    wp_bezel: bezel,
    wp_red: new THREE.MeshPhysicalMaterial({ color: 0xb3150e, roughness: 0.42, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35 }),
    wp_badge: new THREE.MeshPhysicalMaterial({ map: badgeTexture(), roughness: 0.35, metalness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    wp_tag: new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.6, metalness: 0 }),
  };
  return mats.station;
}

/**
 * The maker's badge above the display's knobs (BRO p.18, CSG p.40, ST p.28): the initials in the striped letters on a
 * brushed light plate, drawn in a canvas at run time (architecture.md 13.2: names and marks, our own artwork).
 * The badge mesh's uv spans its face, 26 x 11 mm.
 */
function badgeTexture() {
  const W = 260, H = 110, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const plate = x.createLinearGradient(0, 0, W, H);
  plate.addColorStop(0, '#d9d9d4'); plate.addColorStop(0.5, '#c4c5c1'); plate.addColorStop(1, '#d2d2cd');
  x.fillStyle = plate; x.fillRect(0, 0, W, H);
  x.fillStyle = '#1b2433';
  x.font = '900 82px "Rockwell", "Roboto Slab", "Georgia", serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.save(); x.translate(W / 2, H / 2 + 4); x.scale(1.18, 1); x.fillText('IBM', 0, 0); x.restore();
  // Eight bars: the letters are cut by seven light stripes across their height.
  const top = H / 2 + 4 - 30, bar = 60 / 15;
  x.fillStyle = plate;
  for (let i = 1; i < 15; i += 2) x.fillRect(0, top + i * bar, W, bar);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.flipY = false;
  return t;
}

/**
 * The small printed label under the badge (CSG p.40): a ruled box of fine print, too small to read at the desk, so it
 * is drawn as lines of print rather than words.
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
 * to back); parts.setRocker(on) rocks it: on presses the I side (right) down, off the O side.
 */
export async function buildStation(size, mats) {
  const { scene, nodes } = await load(STATION_URL, mats);
  const group = new THREE.Group();
  group.add(scene);
  const rocker = nodes.station_rocker;
  rocker.name = 'powerRocker';
  const setRocker = (on) => { rocker.rotation.z = on ? -ROCK : ROCK; };
  setRocker(false);
  return { group, parts: { rocker, setRocker } };
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
  return { group, parts, face: { ...f, parent: tiltNode } };
}
