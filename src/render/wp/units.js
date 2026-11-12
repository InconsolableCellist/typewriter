// Procedural models of the word processor's units not yet built in Blender (the display station is, in
// station-view.js), built in code to the documented sizes (no download). Shapes follow the 1982 brochure's product
// photos (BRO p.18) and the setup guide's drawings: pearl-white covers, darker bezels and panels, rounded edges.
// Each builder returns a THREE.Group in the unit's local frame (origin on the surface it stands on, under its centre;
// x right, y up, z toward the typist) plus the parts other code drives.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { KEYS, KEY_UNIT, KEY_FIELD } from '../../machine/wp-keys.js';

export function createUnitMaterials() {
  const plastic = (color, roughness = 0.62) => new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.5, sheen: 0.15, sheenRoughness: 0.8, sheenColor: new THREE.Color(0.9, 0.9, 0.85) });
  return {
    pearl: plastic(0xe2dccb),                         // "Pearl White" covers
    pebble: plastic(0xb3b0a7, 0.7),                   // "Pebble Gray" bases and trim: light grey (PH inside.JPG, BRO p.18)
    dark: plastic(0x1f1e1c, 0.55),                    // bezels, panels, slots
    keycap: plastic(0xe8e3d4, 0.45),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    led: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.4 }),
  };
}

/**
 * The materials the units' GLBs name (docs/displaywriter/models.md), made once per material set: the cover plastics
 * carry the pebble grain (`wp_pebble`) and the keycaps theirs (`wp_keycap`), at GLB UVs (one unit = 0.2 m). They are
 * clones, so the primitive units built in code keep their own untextured materials. Textures arrive asynchronously;
 * the materials work before they do.
 */
export function glbUnitMaterials(mats) {
  if (mats.glb) return mats.glb;
  const phys = (color, roughness, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, ...extra });
  const g = {
    wp_pearl: mats.pearl.clone(),
    wp_gray: mats.pebble.clone(),
    wp_dark: mats.dark.clone(),
    wp_keycap: mats.keycap.clone(),
    wp_rubber: mats.rubber,
    wp_metal: new THREE.MeshStandardMaterial({ color: 0xb8b8b2, roughness: 0.38, metalness: 1 }),
    wp_chrome: new THREE.MeshPhysicalMaterial({ color: 0xd0d0d0, roughness: 0.12, metalness: 1 }),
    wp_label: phys(0xe6e4dc, 0.55),
    wp_led: phys(0x3a0604, 0.3, { clearcoat: 0.8, clearcoatRoughness: 0.1 }),
  };
  mats.glb = g;
  const tiles = { wp_pebble: 0.05, wp_keycap: 0.03 };
  const load = async (name, kind, srgb) => {
    const res = await fetch(`/assets/textures/${name}_${kind}.avif`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const t = new THREE.Texture(await createImageBitmap(await res.blob(), { imageOrientation: 'flipY' }));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.repeat.setScalar(0.2 / tiles[name]); t.needsUpdate = true;
    return t;
  };
  g.ready = (async () => {
    for (const [set, list] of [['wp_pebble', [g.wp_pearl, g.wp_gray, g.wp_dark]], ['wp_keycap', [g.wp_keycap]]]) {
      try {
        const [n, r] = await Promise.all([load(set, 'normal', false), load(set, 'roughness', false)]);
        for (const m of list) {
          if (n) { m.normalMap = n; m.normalScale.set(1, 1); }
          if (r) { m.roughnessMap = r; m.roughness = 1; }
          m.needsUpdate = true;
        }
      } catch (e) { console.info('texture skipped', set, e); }
    }
  })();
  return g;
}

const box = (w, h, d, r, mat, segs = 3) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

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
