// Procedural models of the word processor's units, built in code to the documented sizes (no download), until each is
// replaced by its moulded model and view (the keyboard: keyboard-view.js; docs/displaywriter/models.md). Shapes
// follow the 1982 brochure's product photos (BRO p.18) and the setup guide's drawings: pearl-white covers, darker
// bezels and panels, rounded edges. Each builder returns a THREE.Group in the unit's local frame (origin on the
// surface it stands on, under its centre; x right, y up, z toward the typist) plus the parts other code drives.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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
    pebble: plastic(0xb3b0a7),                        // Pebble Gray bases and trim: a light grey (PH inside.JPG, BRO p.18)
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
  // The GLB views ask for these names; every plastic is textured, so they are the same materials.
  mats.pearlGlb = mats.pearl; mats.pebbleGlb = mats.pebble; mats.darkGlb = mats.dark;
  mats.byName = { wp_pearl: mats.pearl, wp_gray: mats.pebble, wp_dark: mats.dark, wp_keycap: mats.keycap, wp_rubber: mats.rubber, wp_metal: mats.metal, wp_chrome: mats.chrome, wp_glass: mats.glass, wp_label: mats.label };
  return mats;
}

/** The materials the units' GLBs name (docs/displaywriter/models.md): the same textured materials, by name. */
export function glbUnitMaterials(mats) {
  if (!mats.glb) mats.glb = { ...mats.byName, wp_led: new THREE.MeshPhysicalMaterial({ color: 0x3a0604, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 }), ready: mats.ready };
  return mats.glb;
}

const box = (w, h, d, r, mat, segs = 3) => {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, segs, Math.min(r, w / 2, h / 2, d / 2) * 0.999), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

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
