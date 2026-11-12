// Procedural models of the word processor's five units, built in code to the documented sizes (no download). Shapes
// follow the 1982 brochure's product photos (BRO p.18) and the setup guide's drawings: pearl-white covers, darker
// bezels and panels, rounded edges. Each builder returns a THREE.Group in the unit's local frame (origin on the
// surface it stands on, under its centre; x right, y up, z toward the typist) plus the parts other code drives.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { KEYS, KEY_UNIT, KEY_FIELD } from '../../machine/wp-keys.js';
import { applyTextureSet } from '../materials.js';

/**
 * The units' materials. The moulded plastics carry the pebble grain (wp_pebble), the key caps their satin plastic
 * (wp_keycap); the textures arrive after the first frame. UVs are box projected at 0.2 m per unit (docs/assets.md), so
 * the repeat is 0.2 m over the set's tile.
 */
export function createUnitMaterials({ aniso = 8 } = {}) {
  const plastic = (color, { clearcoat = 0.06, sheen = 0.2 } = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, metalness: 0, ior: 1.49, clearcoat, clearcoatRoughness: 0.45, sheen, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.85, 0.85, 0.82) });
  const mats = {
    pearl: plastic(0xe4dfd0),                         // Pearl White covers (HW 1.8)
    pebble: plastic(0x8e8b84),                        // Pebble Gray bases and trim
    dark: plastic(0x232220, { sheen: 0.1 }),          // bezels, panels, slots
    keycap: plastic(0xe9e5d8, { clearcoat: 0.12, sheen: 0.05 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    metal: new THREE.MeshPhysicalMaterial({ color: 0x9c9c98, roughness: 0.35, metalness: 1 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: 0xd6d7d8, roughness: 0.12, metalness: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x111312, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.52 }),
    label: new THREE.MeshStandardMaterial({ color: 0xc9c2ad, roughness: 0.8 }),
    led: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.4 }),
  };
  mats.ready = Promise.all([
    applyTextureSet('wp_pebble', [mats.pearl, mats.pebble, mats.dark].map((mat) => ({ mat, repeat: [0.2 / 0.05, 0.2 / 0.05] })), aniso),
    applyTextureSet('wp_keycap', [{ mat: mats.keycap, repeat: [0.2 / 0.03, 0.2 / 0.03] }], aniso),
  ]).catch((e) => console.info('unit textures', e));
  /** By the GLB's material name (docs/displaywriter/models.md). */
  mats.byName = { wp_pearl: mats.pearl, wp_gray: mats.pebble, wp_dark: mats.dark, wp_keycap: mats.keycap, wp_rubber: mats.rubber, wp_metal: mats.metal, wp_chrome: mats.chrome, wp_glass: mats.glass, wp_label: mats.label };
  return mats;
}

const box = (w, h, d, r, mat, segs = 3) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };
const cyl = (r, h, mat, segs = 32) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), mat); m.castShadow = m.receiveShadow = true; return m; };

/** Electronics module: a flat slab with a plinth, the display's turntable recess on top, the power rocker at front right. */
export function buildStation(size, mats) {
  const [w, h, d] = size, g = new THREE.Group();
  const plinth = 0.014;
  g.add(at(box(w - 0.016, plinth, d - 0.016, 0.004, mats.pebble), 0, plinth / 2, 0));
  g.add(at(box(w, h - plinth, d, 0.014, mats.pearl), 0, plinth + (h - plinth) / 2, 0));
  g.add(at(cyl(0.118, 0.004, mats.pebble, 48), 0, h + 0.001, -0.004));
  // Power switch in its recess at the front right (CSG p.23).
  const recess = at(box(0.034, 0.03, 0.006, 0.003, mats.dark), w / 2 - 0.05, h * 0.55, d / 2 - 0.001);
  const rocker = at(box(0.018, 0.022, 0.008, 0.002, mats.pebble), w / 2 - 0.05, h * 0.55, d / 2 + 0.002);
  rocker.name = 'powerRocker';
  g.add(recess, rocker);
  return { group: g, parts: { rocker } };
}

/**
 * Display: a deep moulded cabinet narrowing to the rear, a dark bezel round the tube, contrast and brightness knobs at
 * the front right (PSM p.7). `face` is where the CRT's tube face goes, in the group's frame.
 */
export function buildDisplay(size, mats) {
  const [w, h, d] = size, g = new THREE.Group();
  const foot = 0.018;
  g.add(at(cyl(0.1, foot, mats.pebble, 48), 0, foot / 2, 0));
  const front = 0.14;
  g.add(at(box(w, h - foot, front, 0.02, mats.pearl), 0, foot + (h - foot) / 2, d / 2 - front / 2));
  g.add(at(box(w * 0.86, (h - foot) * 0.86, d - front + 0.02, 0.03, mats.pearl), 0, foot + (h - foot) * 0.47, -front / 2 + 0.01));
  const faceY = foot + (h - foot) * 0.53, faceX = -0.022;
  g.add(at(box(0.29, 0.21, 0.012, 0.008, mats.dark), faceX, faceY, d / 2 - 0.004));
  const knobs = [];
  for (const [i, y] of [[0, faceY - 0.02], [1, faceY - 0.055]]) {
    const knob = cyl(0.009, 0.012, mats.dark, 24);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(w / 2 - 0.035, y, d / 2 + 0.004);
    knob.name = i === 0 ? 'contrast' : 'brightness';
    g.add(knob); knobs.push(knob);
  }
  g.add(at(box(0.026, 0.012, 0.004, 0.001, mats.dark), w / 2 - 0.035, faceY + 0.06, d / 2 + 0.001));   // badge
  return { group: g, parts: { knobs }, face: { x: faceX, y: faceY, z: d / 2 + 0.002 } };
}

/**
 * Keyboard: a low wedge at the documented 12 degree slope, the stepped key field on top. Each key is its own mesh in
 * `keys` (same order as KEYS), so the view can move it by the mechanism's stem travel along `pressDir`.
 */
export function buildKeyboard(size, slope, mats) {
  const [w, h, d] = size, g = new THREE.Group();
  const frontH = 0.028, backH = frontH + d * Math.tan(slope) * 0.7;
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(d / 2, frontH * 0.8); shape.quadraticCurveTo(d / 2, frontH, d / 2 - 0.012, frontH);
  shape.lineTo(-d / 2 + 0.01, backH); shape.quadraticCurveTo(-d / 2, backH, -d / 2, backH - 0.01); shape.lineTo(-d / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3 });
  geo.translate(0, 0, -w / 2); geo.rotateY(Math.PI / 2);
  const body = new THREE.Mesh(geo, mats.pearl); body.castShadow = body.receiveShadow = true;
  g.add(body);
  // The key field lies on the slope: rows run along x, row 0 at the back.
  const deck = new THREE.Group();
  const tilt = Math.atan2(backH - frontH, d - 0.024);
  deck.position.set(0, (frontH + backH) / 2 + 0.002, 0.004);
  deck.rotation.x = tilt;
  g.add(deck);
  const u = KEY_UNIT, cap = 0.0175, capH = 0.009;
  const field = { w: KEY_FIELD.w * u, d: KEY_FIELD.rows * u };
  const keys = [];
  const capGeo = new Map();
  for (const key of KEYS) {
    const kw = key.w * u - (u - cap), kd = key.tall ? 2 * u - (u - cap) : cap;
    const id = `${kw.toFixed(4)}:${kd.toFixed(4)}`;
    if (!capGeo.has(id)) capGeo.set(id, new RoundedBoxGeometry(kw, capH, kd, 2, 0.002));
    const m = new THREE.Mesh(capGeo.get(id), mats.keycap);
    m.castShadow = m.receiveShadow = true;
    const x = -field.w / 2 + (key.x + key.w / 2) * u;
    const z = -field.d / 2 + (key.row + (key.tall ? 1 : 0.5)) * u;
    m.position.set(x, capH / 2, z);
    m.userData.rest = m.position.clone();
    m.name = `key${key.pos}`;
    deck.add(m); keys.push(m);
  }
  const pressDir = new THREE.Vector3(0, -1, 0);   // in the deck's frame: keys travel normal to the slope
  return { group: g, parts: { keys, deck, pressDir } };
}

/** Diskette unit: an upright cabinet on a plinth, two vertical drive slots each with its lever (ORG p.54, BRO p.18). */
export function buildDiskette(size, mats) {
  const [w, h, d] = size, g = new THREE.Group();
  const plinth = 0.016;
  g.add(at(box(w - 0.012, plinth, d - 0.012, 0.004, mats.pebble), 0, plinth / 2, 0));
  g.add(at(box(w, h - plinth, d, 0.012, mats.pearl), 0, plinth + (h - plinth) / 2, 0));
  const levers = [], slots = [];
  for (const [i, x] of [[0, -0.05], [1, 0.05]]) {
    const slot = at(box(0.008, 0.215, 0.01, 0.002, mats.dark), x, plinth + 0.035 + 0.1075, d / 2 - 0.002);
    // The lever pivots at its top, beside the slot's lower half: hanging straight down is open, turned a quarter to
    // lie across the slot is closed (CSG p.42).
    const lever = new THREE.Group();
    lever.position.set(x, plinth + 0.13, d / 2 + 0.006);
    lever.add(at(box(0.011, 0.075, 0.008, 0.003, mats.dark), 0, -0.0375, 0));
    lever.add(at(box(0.03, 0.014, 0.012, 0.003, mats.dark), 0, -0.07, 0.004));
    lever.name = `lever${i}`;
    g.add(slot, lever); levers.push(lever); slots.push(slot);
  }
  return { group: g, parts: { levers, slots } };
}

/**
 * Printwheel printer: a wide low cabinet on a plinth, the paper slot and access cover on top toward the rear, the
 * operator panel in a dark strip at the front and the power switch at the front right (BRO p.18; PR 1).
 */
export function buildPrinter(size, mats) {
  const [w, h, d] = size, g = new THREE.Group();
  const plinth = 0.02;
  g.add(at(box(w - 0.03, plinth, d - 0.03, 0.006, mats.pebble), 0, plinth / 2, 0));
  g.add(at(box(w, h * 0.62, d, 0.016, mats.pearl), 0, plinth + h * 0.31 - 0.002, 0));
  const cover = new THREE.Group();
  cover.position.set(0, plinth + h * 0.62 - 0.004, -d / 2 + 0.02);   // hinged at the back
  cover.add(at(box(w * 0.9, h - plinth - h * 0.62 + 0.004, d * 0.78, 0.02, mats.pearl), 0, (h - plinth - h * 0.62) / 2, d * 0.39 - 0.01));
  cover.add(at(box(w * 0.6, 0.008, 0.045, 0.003, mats.dark), 0, h - plinth - h * 0.62 + 0.004, d * 0.18));    // paper slot window
  cover.name = 'printerCover';
  g.add(cover);
  const panel = at(box(w * 0.42, 0.05, 0.01, 0.004, mats.dark), 0, plinth + h * 0.3, d / 2 - 0.003);
  g.add(panel);
  const panelKeys = [];
  // Two clusters of four keys, as in the photographs.
  for (let i = 0; i < 8; i++) {
    const cx = i < 4 ? -0.032 : 0.032, col = i % 2, row = (i >> 1) % 2;
    const kk = at(box(0.011, 0.011, 0.005, 0.0015, mats.pearl), cx + (col - 0.5) * 0.014, plinth + h * 0.3 + (0.5 - row) * 0.014, d / 2 + 0.003);
    kk.name = `panelKey${i}`;
    g.add(kk); panelKeys.push(kk);
  }
  const power = at(box(0.02, 0.022, 0.006, 0.002, mats.dark), w / 2 - 0.05, plinth + h * 0.28, d / 2 + 0.001);
  power.name = 'printerPower';
  g.add(power);
  return { group: g, parts: { cover, panelKeys, power } };
}
