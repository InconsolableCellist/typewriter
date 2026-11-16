// The Sharp FO-70 thermal fax (c. 1999), loaded from the Blender build (tools/blender/build_fax_fo70.py, fax_fo70.glb).
// The view applies the materials by name, draws the panel's print, the key legends and the LCD on canvases (no images
// in the model), and returns the group in the machine's own frame (origin on the desk under its footprint's centre;
// x right, y up, z toward the operator) with the parts the kit and the controls drive. The contract (node names, pivots,
// axes) is docs/fax/models.md; the panel's print layout travels in the GLB on the panel node (extra `layout`), each
// key's press axis, travel and legend on its own node.
import * as THREE from 'three';
import { loadGLTF } from '../gltf.js';

export const FO70_URL = '/assets/models/fax_fo70.glb';

const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
const PX_PER_M = 8000;                 // the panel print: 8 px a millimetre

/** The mechanism's key names (src/machine/faxfo70.js mech.panel.keys) to the GLB's. One VOLUME key, as the service
 * manual's panel drawing and key matrix show (p.1-2, p.6-15). */
export const MECH_KEY_TO_NODE = {
  '*': 'star', '#': 'hash', rapid1: 'rapid_a', rapid2: 'rapid_b', rapid3: 'rapid_c', rapid4: 'rapid_d', rapid5: 'rapid_e',
  speedDial: 'speed_dial', redial: 'redial', holdSearch: 'hold', speaker: 'speaker', resolution: 'resolution',
  function: 'function', volume: 'volume', copyHelp: 'copy', start: 'start', stop: 'stop',
};

/** Every key node's name in the GLB, without the `fax_key_` prefix: the contract the kit binds controls to. */
export const FO70_KEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', 'star', '0', 'hash',
  'rapid_a', 'rapid_b', 'rapid_c', 'rapid_d', 'rapid_e',
  'volume', 'function', 'resolution', 'speed_dial', 'redial', 'hold', 'speaker',
  'start', 'stop', 'copy',
];

// Colours picked from the owner's photograph (docs/fax/refs/owner/sharp_fo70_top.png), less the overcast light's cast.
export const FO70_COLOURS = {
  body: 0xa8a7ba,        // lilac grey: the case, the handset, the cord
  panel: 0xdbd8c6,       // the cream overlay (yellowed)
  key: 0x8f9199,         // number and function keys
  keyStart: 0xd8cba6,    // the round pad's quarters
  legendOnKey: '#c6c7cc',
  lcd: 0xc3cabd,
  lcdInk: '#2c3330',
};

function makeCanvas(w, h, opts) {
  const c = opts.makeCanvas ? opts.makeCanvas(w, h) : document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Canvas row 0 at v = 1 in Blender, which the glTF exporter writes as v = 0: so no flip. */
function canvasTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

const hex = (c) => `#${new THREE.Color(c).getHexString()}`;
const json = (v, d = null) => { try { return typeof v === 'string' ? JSON.parse(v) : v ?? d; } catch { return d; } };

/**
 * The overlay's print from the layout the builder stored (fax_fo70_layout.py): the light grey window round the LCD and
 * the rapid keys with its curved key band, the pad's bezel disc, every key name, the SHARP mark and the model.
 */
export function drawPanelPrint(g, lay, S = PX_PER_M) {
  const [u0, u1] = lay.overlay.u, [w0, w1] = lay.overlay.w;
  const X = (u) => (u - u0) * S, Y = (w) => (w - w0) * S;
  const W = (u1 - u0) * S, H = (w1 - w0) * S;
  g.fillStyle = hex(FO70_COLOURS.panel); g.fillRect(0, 0, W, H);
  const win = lay.window;
  g.fillStyle = '#dadcda';
  g.fillRect(X(win.u[0]), Y(win.w[0]), X(win.u[1]) - X(win.u[0]), Y(win.w[1]) - Y(win.w[0]));
  g.fillStyle = '#cfd2d1'; g.strokeStyle = '#b9bcbc'; g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, u = win.u[0] + (win.u[1] - win.u[0]) * t, w = win.curveTop + win.curveSag * (1 - (2 * t - 1) ** 2);
    if (i) g.lineTo(X(u), Y(w)); else g.moveTo(X(u), Y(w));
  }
  g.lineTo(X(win.u[1]), Y(win.w[1]) - 0.002 * S); g.lineTo(X(win.u[0]), Y(win.w[1]) - 0.002 * S); g.closePath();
  g.fill();
  const [cu, cw] = lay.pad.center, r = lay.pad.bezel;
  g.fillStyle = '#e3dbc1'; g.strokeStyle = '#cbc2a6';
  g.beginPath(); g.arc(X(cu), Y(cw), r * S, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = lay.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const lb of lay.labels) {
    const px = lb.size * S * 1.35, lines = lb.text.split('\n');
    g.font = `bold ${px.toFixed(1)}px ${FONT}`;
    lines.forEach((ln, k) => g.fillText(ln, X(lb.at[0]), Y(lb.at[1]) + (k - (lines.length - 1) / 2) * lb.size * S * 1.25));
  }
  // SHARP: heavy capitals stretched to the mark's width (our own lettering, not the logo artwork; plan decision 3).
  const lg = lay.logo;
  g.save();
  g.font = `900 ${(lg.height * S * 1.38).toFixed(1)}px ${FONT}`;
  const tw = g.measureText('SHARP').width || 1;
  g.translate(X(lg.center[0]), Y(lg.center[1]));
  g.scale((lg.width * S) / tw, 1);
  g.fillStyle = '#2c2c34';
  g.fillText('SHARP', 0, 0);
  g.restore();
}

/** One key's face: its plastic with the legend, `size` px square; canvas top = the panel's rear. */
function drawKeyFace(g, x0, y0, size, kind, name, legend) {
  const col = { num: FO70_COLOURS.key, small: 0xa3a4ab, rapid: 0xa3a4ab, pad: FO70_COLOURS.keyStart }[kind] ?? FO70_COLOURS.key;
  g.fillStyle = hex(col); g.fillRect(x0, y0, size, size);
  const cx = x0 + size / 2, cy = y0 + size / 2;
  if (kind === 'num' && legend) {
    g.fillStyle = FO70_COLOURS.legendOnKey; g.font = `bold ${Math.round(size * 0.48)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(legend, cx, cy + size * 0.02);
  } else if (kind === 'pad') {
    // The quarter's mark, moulded a shade darker: a diamond on START, a ring on STOP, a box on COPY.
    const dir = { start: [-1, 0], stop: [0, -1], copy: [1, 0] }[name] ?? [0, 0];
    const mx = cx + dir[0] * size * 0.17, my = cy + dir[1] * size * 0.17, s = size * 0.1;
    g.strokeStyle = '#a99b74'; g.lineWidth = size * 0.03;
    g.beginPath();
    if (name === 'start') { g.moveTo(mx - s, my); g.lineTo(mx, my - s); g.lineTo(mx + s, my); g.lineTo(mx, my + s); g.closePath(); }
    else if (name === 'stop') g.arc(mx, my, s, 0, Math.PI * 2);
    else g.rect(mx - s * 0.8, my - s, s * 1.6, s * 2);
    g.stroke();
  }
}

/** All key faces on one atlas; remap(geometry, i) moves a key's uv (0..1 over its square) into cell i. */
function keyAtlas(keys, opts) {
  const F = 96, C = 128, cols = 6, rows = Math.ceil(keys.length / cols);
  const c = makeCanvas(C * cols, C * rows, opts), g = c.getContext('2d');
  keys.forEach((k, i) => {
    const x = (i % cols) * C, y = Math.floor(i / cols) * C;
    drawKeyFace(g, x, y, C, k.kind, k.name, '');                 // the padding: the key's own colour
    drawKeyFace(g, x + (C - F) / 2, y + (C - F) / 2, F, k.kind, k.name, k.legend);
  });
  const tex = canvasTexture(c);
  const remap = (geometry, i) => {
    const geo = geometry.clone(), uv = geo.getAttribute('uv');
    if (!uv) return geo;
    const x0 = ((i % cols) * C + (C - F) / 2) / c.width, y0 = (Math.floor(i / cols) * C + (C - F) / 2) / c.height;
    const out = new Float32Array(uv.count * 2);
    for (let k = 0; k < uv.count; k++) { out[k * 2] = x0 + uv.getX(k) * F / c.width; out[k * 2 + 1] = y0 + uv.getY(k) * F / c.height; }
    geo.setAttribute('uv', new THREE.BufferAttribute(out, 2));
    return geo;
  };
  return { tex, remap, canvas: c };
}

/**
 * The machine's materials, by the GLB's names. The case plastics take the Displaywriter's pebble grain at a finer
 * tile (the FO-70's moulding is a fine matte texture), the keys the satin key set; maps arrive after the first frame.
 */
export function createFaxMaterials({ textured = typeof document !== 'undefined' } = {}) {
  const plastic = (color, roughness = 0.6, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, ior: 1.49, sheen: 0.15, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.85, 0.85, 0.85), ...extra });
  const m = {
    fax_body: plastic(FO70_COLOURS.body, 0.62),
    fax_panel: plastic(0xffffff, 0.5),                    // colour in the print
    fax_key: plastic(0xffffff, 0.42, { clearcoat: 0.15, clearcoatRoughness: 0.4 }),   // colour in the atlas
    fax_key_start: plastic(FO70_COLOURS.keyStart, 0.45),
    fax_lcd: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
    fax_rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.92 }),
    fax_dark: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.65 }),
    fax_paper: new THREE.MeshStandardMaterial({ color: 0xf1f0ea, roughness: 0.85 }),
  };
  m.ready = textured ? import('../materials.js').then(async ({ applyTextureSet }) => {
    // The grain on the case; the overlay and the keys keep their printed maps and take only the relief.
    const grainOnly = [m.fax_panel, m.fax_key].map((mat) => ({ mat, probe: mat.clone() }));
    await Promise.all([
      applyTextureSet('wp_pebble', [m.fax_body, m.fax_key_start].map((mat) => ({ mat, repeat: [0.2 / 0.03, 0.2 / 0.03] }))),
      applyTextureSet('wp_pebble', grainOnly.map(({ probe }) => ({ mat: probe, repeat: [0.2 / 0.03, 0.2 / 0.03] }))),
    ]);
    for (const { mat, probe } of grainOnly) { mat.normalMap = probe.normalMap; mat.normalScale = probe.normalScale; mat.needsUpdate = true; }
  }).catch((e) => console.info('fax textures', e)) : Promise.resolve();
  return m;
}

/**
 * The LCD: 16 characters on one line (research.md 8.2) on a canvas the size of the glass, dark segments on the grey-green
 * ground. draw(text) sets the line; the mesh's uv spans the glass.
 */
function lcdCanvas(size, opts) {
  const W = 512, H = Math.max(32, Math.round(W * size[1] / size[0]));
  const c = makeCanvas(W, H, opts), g = c.getContext('2d');
  const tex = canvasTexture(c);
  let last = null;
  const draw = (text = '') => {
    const t = String(text).slice(0, 16).padEnd(16, ' ');
    if (t === last) return;
    last = t;
    g.fillStyle = hex(FO70_COLOURS.lcd); g.fillRect(0, 0, W, H);
    const cw = W * 0.9 / 16, ch = H * 0.46, x0 = W * 0.05, y0 = (H - ch) / 2;
    // The unlit 5 x 7 cells show faintly, as on a reflective LCD.
    g.fillStyle = 'rgba(40,52,46,0.07)';
    for (let i = 0; i < 16; i++) g.fillRect(x0 + i * cw + cw * 0.08, y0, cw * 0.84, ch);
    g.fillStyle = FO70_COLOURS.lcdInk; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${Math.round(ch * 1.05)}px "DejaVu Sans Mono", "Courier New", monospace`;
    for (let i = 0; i < 16; i++) if (t[i] !== ' ') g.fillText(t[i], x0 + (i + 0.5) * cw, H / 2 + ch * 0.04);
    tex.needsUpdate = true;
  };
  draw('');
  return { canvas: c, texture: tex, draw };
}

/**
 * Loads the FO-70. opts: { url, gltf (already parsed), mats (createFaxMaterials()), makeCanvas(w, h) (for tests) }.
 * Returns { group, parts, update(state, layout), setKey(name, depth01), setHook, setPanel(open01), setLatch, setCutter,
 * setGuides(width), lcd }. parts: body, panel, cover (= panel: the operation panel is the roll cover, its node's origin
 * on the rear hinge; rotation.x = -angle lifts it), display (= lcd, the LCD's mesh node), rollBay (= paperRoll),
 * keys (an array in mech.panel.keys order, each the key's mesh, for picking), keyNodes { GLB name: node }, handset,
 * hook, rollLatch (the panel's release), guides { l, r }, docSlot, docExit, printSlot, docPath { node, points },
 * printPath { node, points }, cutter, platen, paperRoll, lcd, speaker, cord, cordEnds { handset, jack }, jacks, mech,
 * feet. Each moving node's origin is its pivot; its axis and travel are
 * in node.userData (press, travel, slide, hinge, open, axis), as parsed JSON.
 */
export async function buildFo70(opts = {}) {
  const gltf = opts.gltf ?? await loadGLTF(opts.url ?? FO70_URL);
  const mats = opts.mats ?? createFaxMaterials();
  const nodes = {};
  gltf.scene.traverse((o) => {
    if (o.name?.startsWith('fax_') && !o.name.endsWith('_mesh')) nodes[o.name] = o;
    for (const [k, v] of Object.entries(o.userData ?? {})) o.userData[k] = json(v, v);
  });
  const panel = nodes.fax_panel;
  const lay = panel.userData.layout;
  // The overlay's print.
  const pw = Math.round((lay.overlay.u[1] - lay.overlay.u[0]) * PX_PER_M), ph = Math.round((lay.overlay.w[1] - lay.overlay.w[0]) * PX_PER_M);
  const printCanvas = makeCanvas(pw, ph, opts);
  drawPanelPrint(printCanvas.getContext('2d'), lay);
  const panelMat = mats.fax_panel.clone();
  panelMat.map = canvasTexture(printCanvas);
  mats.ready?.then(() => { panelMat.normalMap = mats.fax_panel.normalMap; panelMat.needsUpdate = true; });
  // The keys: one atlas, one material.
  const keyInfo = FO70_KEYS.map((name) => {
    const n = nodes[`fax_key_${name}`];
    return { name, node: n, kind: n?.userData.kind ?? 'num', legend: n?.userData.legend ?? '' };
  });
  const atlas = keyAtlas(keyInfo, opts);
  const keyMat = mats.fax_key.clone();
  keyMat.map = atlas.tex;
  mats.ready?.then(() => { keyMat.normalMap = mats.fax_key.normalMap; keyMat.needsUpdate = true; });
  const lcdNode = nodes.fax_lcd;
  const lcd = lcdCanvas(lcdNode?.userData.size ?? [0.062, 0.0156], opts);
  const lcdMat = mats.fax_lcd.clone();
  lcdMat.map = lcd.texture;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const owner = o.name.endsWith('_mesh') ? o.name.slice(0, -5) : o.name;
    const ki = keyInfo.findIndex((k) => `fax_key_${k.name}` === owner);
    const name = o.material?.name ?? '';
    if (ki >= 0) { o.material = keyMat; o.geometry = atlas.remap(o.geometry, ki); }
    else if (owner === 'fax_lcd') { o.material = lcdMat; o.castShadow = false; }
    else if (name === 'fax_panel') o.material = panelMat;
    else o.material = mats[name] ?? o.material;
  });
  const group = new THREE.Group();
  group.name = 'faxfo70';
  group.add(gltf.scene);
  const keys = Object.fromEntries(keyInfo.filter((k) => k.node).map((k) => [k.name, k.node]));
  const path = (n) => (n ? { node: n, points: (n.userData.path ?? []).map((p) => new THREE.Vector3(...p).add(n.position)) } : null);
  const meshOf = (n) => { let m = null; n?.traverse((o) => { if (!m && o.isMesh) m = o; }); return m; };
  const mechKeys = opts.mechKeys ?? [];
  const keyMeshes = mechKeys.map((k) => {
    const name = k in MECH_KEY_TO_NODE ? MECH_KEY_TO_NODE[k] : k;
    const m = meshOf(name ? keys[name] : null);
    if (m) { m.userData.key = k; return m; }
    const stand = new THREE.Object3D();
    stand.name = `fax_key_${k}_none`;
    return stand;
  });
  const parts = {
    body: nodes.fax_body, panel, cover: panel, display: lcdNode, rollBay: nodes.fax_paper_roll,
    keys: keyMeshes, keyNodes: keys, handset: nodes.fax_handset, hook: nodes.fax_hook,
    rollLatch: nodes.fax_roll_latch,
    guides: { l: nodes.fax_guide_l, r: nodes.fax_guide_r },
    docSlot: nodes.fax_doc_slot, docExit: nodes.fax_doc_exit, printSlot: nodes.fax_print_slot,
    docPath: path(nodes.fax_doc_path), printPath: path(nodes.fax_print_path),
    cutter: nodes.fax_cutter, platen: nodes.fax_platen, paperRoll: nodes.fax_paper_roll, lcd: lcdNode,
    speaker: nodes.fax_speaker, cord: nodes.fax_cord, cordEnds: { handset: nodes.fax_cord_handset, jack: nodes.fax_cord_jack },
    jacks: nodes.fax_jacks, mech: nodes.fax_mech, feet: nodes.fax_feet,
  };
  // Rest poses, for the setters.
  const rest = new Map();
  for (const n of [...Object.values(keys), parts.handset, parts.hook, parts.rollLatch, parts.guides.l, parts.guides.r, parts.cutter, panel]) {
    if (n) rest.set(n, { p: n.position.clone(), q: n.quaternion.clone() });
  }
  const along = (n, t) => {
    const r = rest.get(n), d = n.userData.press ?? n.userData.slide;
    if (!r || !d) return;
    n.position.copy(r.p).addScaledVector(new THREE.Vector3(...d), t);
  };
  const hinge = (n, t) => {
    const r = rest.get(n);
    if (!r) return;
    n.quaternion.copy(r.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...(n.userData.hinge ?? [1, 0, 0])), (n.userData.open ?? 0) * t));
  };
  const handsetRest = rest.get(parts.handset);
  const rollR = nodes.fax_paper_roll?.userData.radius ?? 0.0255, coreR = nodes.fax_paper_roll?.userData.core ?? 0.0127;
  const keyNodeList = mechKeys.map((k) => keys[k in MECH_KEY_TO_NODE ? MECH_KEY_TO_NODE[k] : k] ?? null);
  return {
    group, parts, lcd, keyAtlas: atlas.canvas, printCanvas,
    /**
     * Poses the model from the mechanism's snapshot (src/sim/fax/layout.js): the keys' stems (the mechanism's 2.5 mm
     * of travel scaled to the cap's), the hook plunger, the handset (lifted off the cradle to the hand's place above
     * it), the cutter's blade, the platen and the roll's radius. The cover's angle the kit sets (parts.cover).
     */
    update(s, L) {
      keyNodeList.forEach((n, i) => {
        if (!n) return;
        const t = n.userData.travel ?? 0.0018;
        along(n, Math.min(t, Math.max(0, s[L.keyX + i]) * t / 0.0025));
      });
      const hook = parts.hook;
      if (hook) along(hook, -(hook.userData.travel ?? 0.004) * Math.min(1, Math.max(0, s[L.hookX]) / 0.006));
      if (parts.handset && handsetRest) {
        parts.handset.position.copy(handsetRest.p);
        if (s[L.onCradle] < 0.5) parts.handset.position.add(new THREE.Vector3(-0.02, 0.17, 0.08));
      }
      if (parts.cutter) along(parts.cutter, (parts.cutter.userData.travel ?? 0.006) * Math.min(1, Math.max(0, s[L.blade])));
      if (parts.platen) parts.platen.rotation.x = s[L.platenPsi];
      const roll = parts.paperRoll;
      if (roll) {
        const r = s[L.rollRadius];
        roll.visible = r > coreR * 0.5;
        if (r > 0) { const k = Math.max(coreR, r) / rollR; roll.scale.set(1, k, k); }
      }
    },
    /** Presses key `name` by depth01 of its travel (0 up, 1 bottomed). */
    setKey(name, depth01) { const n = keys[name]; if (n) along(n, (n.userData.travel ?? 0.0015) * Math.min(1, Math.max(0, depth01))); },
    /** The hook plunger rises as the handset leaves (0 on the cradle, 1 lifted clear). */
    setHook(up01) { const n = parts.hook; if (n) along(n, -(n.userData.travel ?? 0.004) * Math.min(1, Math.max(0, up01))); },
    setPanel(open01) { hinge(panel, open01); },
    setLatch(depth01) { const n = parts.rollLatch; if (n) along(n, (n.userData.travel ?? 0.002) * depth01); },
    setCutter(depth01) { const n = parts.cutter; if (n) along(n, (n.userData.travel ?? 0.006) * depth01); },
    /** The guides slide in symmetrically to a document `width` (m) between their fences. */
    setGuides(width) {
      for (const n of [parts.guides.l, parts.guides.r]) {
        if (!n) continue;
        const full = 0.210, t = Math.min(n.userData.travel ?? 0.041, Math.max(0, (full - width) / 2));
        along(n, t);
      }
    },
  };
}

/**
 * The kit's entry (docs/fax/architecture.md 6.2): buildFo70View(machine, { renderer, geometry }) -> { group, parts,
 * update } in the body's frame, parts.keys in machine.mech.panel.keys order.
 */
export async function buildFo70View(machine, opts = {}) {
  return buildFo70({ ...opts, mechKeys: machine?.mech?.panel?.keys ?? [] });
}

export default buildFo70View;
