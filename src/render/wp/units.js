// The word processor's unit materials: the textured plastics the Blender-built units (src/render/wp/*-view.js) take by
// name, with the pebble grain on the covers and the satin grain on the keycaps (docs/displaywriter/models.md).
import * as THREE from 'three';
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

// The authored plastic sets (tools/gen/materials.py): neutral albedo, normal and roughness, loaded once and shared.
const TEX = '/assets/textures/';
const sets = new Map();
function loadSet(name) {
  if (!sets.has(name)) {
    const one = async (kind, srgb) => {
      const r = await fetch(`${TEX}${name}_${kind}.avif`);
      if (!r.ok) return null;
      const t = new THREE.Texture(await createImageBitmap(await r.blob(), { imageOrientation: 'flipY' }));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.anisotropy = 8;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
      return t;
    };
    sets.set(name, Promise.all([
      fetch(`${TEX}materials.json`).then((r) => r.json()).then((j) => j[name]?.tile ?? 0.05).catch(() => 0.05),
      one('albedo', true), one('normal', false), one('roughness', false),
    ]));
  }
  return sets.get(name);
}

/**
 * A copy of a unit material with a textured plastic set on it, for models whose UVs are box projected at one UV unit
 * = 0.2 m (the Blender-built units). The colour stays the material's; the maps arrive asynchronously.
 */
export function texturedUnitMaterial(base, set = 'wp_pebble') {
  const m = base.clone();
  if (typeof document === 'undefined') return m;
  loadSet(set).then(([tile, a, n, r]) => {
    const rep = 0.2 / tile;
    const use = (t) => { if (!t) return null; const c = t.clone(); c.repeat.set(rep, rep); c.needsUpdate = true; return c; };
    if (a) m.map = use(a);
    if (n) { m.normalMap = use(n); m.normalScale = new THREE.Vector2(1, 1); }
    if (r) { m.roughnessMap = use(r); m.roughness = 1; }
    m.needsUpdate = true;
  }).catch((e) => console.info('texture', set, e));
  return m;
}
