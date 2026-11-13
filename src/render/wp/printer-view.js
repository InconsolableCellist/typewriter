// The 5218 printwheel printer with its sheet-feed paper handler: the moulded cabinet, the operator panel and the whole
// mechanism under the access cover, from tools/blender/build_wp_printer.py (wp_printer.glb), posed from the mechanism's
// snapshot. Nothing here is animated: every moving node is set from the state each frame. The panel's legends, the
// two-digit display, the petal faces and the leadscrew's thread are drawn at run time (no images in the model).
import * as THREE from 'three';
import { texturedUnitMaterial } from './units.js';
import { batchMeshes, mergeStaticMeshes, partObjects } from './merge-static.js';

export const PRINTER_URL = '/assets/models/wp_printer.glb';

// LED bit order of the controller (src/sim/wp/printer-ctl.js LED) and the labels printed over them (MIM p.182, PH 5218_1).
const LED_LABELS = ['Power\nOn', 'On\nLine', 'Ribbon', 'Ready', 'Printer\nExcep', 'Release', 'Setup', 'Load\nPaper', 'Change\nFont', 'Diag\nMode'];
const LED_COLOURS = [0xff2a1a, 0x30ff50, 0xffa020, 0x30ff50, 0xffa020, 0xffa020, 0xffa020, 0xffa020, 0xffa020, 0xffa020];
// Panel keys in the definition's order (start, stop, printTest, cancel, load, release, paperUp, paperDown).
const KEY_LEGENDS = ['Start', 'Stop', 'Print\nTest', 'Cancel', 'Load', 'Release', '↑', '↓'];
const KEY_COLOURS = [0x1f8a3a, 0xe8a412, 0x4a9ad8, 0x4a9ad8, 0x4a9ad8, 0x4a9ad8, 0x4a9ad8, 0x4a9ad8];
// Panel face in metres (build_wp_printer.py PANEL, LED_POS), for drawing the legend at the LEDs.
const PANEL = { x0: -0.214, x1: 0.212, y0: 0.0653, y1: 0.1218 };
const LED_X = [-0.203, -0.182, -0.160, -0.139, -0.117], LED_Y = [0.0981, 0.0766];
const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';

// A moulded plastic. A clearcoat under about 0.1 cannot be seen and costs a second specular lobe and environment
// lookup, so the plain plastics are standard; a part that asks for a real coat (the panel keys) is physical.
const plastic = (color, roughness = 0.5, extra = {}) => ((extra.clearcoat ?? 0) >= 0.1
  ? new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, ...extra })
  : new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra }));
const metal = (color, roughness) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 1 });

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Canvas row 0 at v = 1, as a glTF texture: the exporter wrote v = 1 - v, so the canvas is not flipped. */
function canvasTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The black panel with its printed legends: LED names in two rows of five over their lights, the divider, and on the
 * right section the operator's white card with the model written on it (the owner's photograph; PH 5218_1 has none).
 */
function panelTexture() {
  const W = 2048, H = Math.round(W * (PANEL.y1 - PANEL.y0) / (PANEL.x1 - PANEL.x0));
  const c = canvas(W, H), g = c.getContext('2d');
  const px = (x) => ((x - PANEL.x0) / (PANEL.x1 - PANEL.x0)) * W, py = (y) => (1 - (y - PANEL.y0) / (PANEL.y1 - PANEL.y0)) * H;
  g.fillStyle = '#141416'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d9d6cc'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const size = 0.0021 * W / (PANEL.x1 - PANEL.x0);
  g.font = `${size.toFixed(1)}px ${FONT}`;
  LED_LABELS.forEach((label, i) => {
    const x = px(LED_X[i >> 1] - 0.0028), y = py(LED_Y[i & 1] + 0.0042);
    const lines = label.split('\n');
    lines.forEach((ln, k) => g.fillText(ln, x, y - (lines.length - 1 - k) * size * 1.05));
  });
  const cx0 = px(0.1185), cx1 = px(0.2085), cy0 = py(0.1190), cy1 = py(0.0815);
  g.fillStyle = '#f1efe8'; g.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  g.fillStyle = '#26262c'; g.textAlign = 'center';
  const hand = (cy1 - cy0) * 0.36;
  g.font = `${hand.toFixed(0)}px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive`;
  g.fillText('IBM', (cx0 + cx1) / 2 - hand * 0.9, cy0 + hand * 1.05);
  g.fillText('5218  A02', (cx0 + cx1) / 2, cy0 + hand * 2.15);
  return canvasTexture(c);
}

/** A key cap's top: its colour with the legend in the upper left, as the photographs show. */
function keyFace(colour, legend) {
  const S = 128, c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = `#${new THREE.Color(colour).getHexString()}`; g.fillRect(0, 0, S, S);
  g.fillStyle = legend.length === 1 ? '#f4f4f0' : '#f2f2ee';
  if (legend.length === 1) { g.font = `bold 46px ${FONT}`; g.textAlign = 'center'; g.fillText(legend, S * 0.32, S * 0.42); }
  else {
    g.font = `20px ${FONT}`; g.textAlign = 'left';
    legend.split('\n').forEach((ln, k) => g.fillText(ln, S * 0.12, S * 0.24 + k * 21));
  }
  return c;
}

/**
 * The eight key faces on one texture, so the keys share one material and draw as one batch. Each 128 px face sits in
 * a 256 px cell padded with its own colour, so the small mip levels the panel is seen at do not bleed a neighbour's
 * colour into it. remap(geometry, i) is a copy of a key's geometry with its uv (0 to 1 over the face) moved into cell i.
 */
function keyAtlas() {
  const F = 128, C = 256, cols = 4, rows = 2, W = C * cols, H = C * rows;
  const c = canvas(W, H), g = c.getContext('2d');
  KEY_COLOURS.forEach((col, i) => {
    const x = (i % cols) * C, y = Math.floor(i / cols) * C;
    g.fillStyle = `#${new THREE.Color(col).getHexString()}`; g.fillRect(x, y, C, C);
    g.drawImage(keyFace(col, KEY_LEGENDS[i]), x + (C - F) / 2, y + (C - F) / 2);
  });
  const tex = canvasTexture(c);
  const remap = (geometry, i) => {
    const geo = geometry.clone(), uv = geo.getAttribute('uv');
    if (!uv) return geo;
    const x0 = ((i % cols) * C + (C - F) / 2) / W, y0 = (Math.floor(i / cols) * C + (C - F) / 2) / H;
    const out = new Float32Array(uv.count * 2);
    for (let k = 0; k < uv.count; k++) { out[k * 2] = x0 + uv.getX(k) * F / W; out[k * 2 + 1] = y0 + uv.getY(k) * F / H; }
    geo.setAttribute('uv', new THREE.BufferAttribute(out, 2));
    return geo;
  };
  return { tex, remap };
}

/** Two seven-segment digits, red, on the dark window; blank when `text` is empty. */
function drawDigits(g, W, H, text) {
  g.fillStyle = '#1a0606'; g.fillRect(0, 0, W, H);
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', E: 'adefg', '-': 'g' };
  const dw = W * 0.34, dh = H * 0.66, t = dw * 0.17;
  [...text.padStart(2, ' ')].slice(-2).forEach((ch, k) => {
    const on = SEG[ch] ?? '';
    const x0 = W * (0.12 + 0.43 * k), y0 = H * 0.17, sk = dw * 0.12;
    const seg = (s, x, y, w, h) => {
      g.fillStyle = on.includes(s) ? '#ff3a28' : '#2a0b08';
      const yy = y0 + y, off = sk * (1 - (y + h / 2) / dh);
      g.fillRect(x0 + x + off, yy, w, h);
    };
    seg('a', t, 0, dw - 2 * t, t); seg('g', t, dh / 2 - t / 2, dw - 2 * t, t); seg('d', t, dh - t, dw - 2 * t, t);
    seg('f', 0, t, t, dh / 2 - 1.5 * t); seg('b', dw - t, t, t, dh / 2 - 1.5 * t);
    seg('e', 0, dh / 2 + t / 2, t, dh / 2 - 1.5 * t); seg('c', dw - t, dh / 2 + t / 2, t, dh / 2 - 1.5 * t);
  });
}

/**
 * The printwheel's character faces: cell k of a 12 x 8 atlas is petal k's slug face (build_wp_printer.py build_wheel),
 * 2.1 mm across the petal by 4.4 mm along it, character up = outward. Drawn from the glyph height fields that print.
 */
function petalAtlas(glyphs, order) {
  const C = 64, c = canvas(C * 12, C * 8), g = c.getContext('2d');
  g.fillStyle = '#b9b8b2'; g.fillRect(0, 0, c.width, c.height);
  if (!glyphs) return canvasTexture(c);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  const N = glyphs.N, mm = glyphs.texelMm;
  for (let k = 0; k < order.length; k++) {
    const gi = glyphs.indexOf(order[k]);
    if (gi < 0) continue;
    const face = glyphs.face(gi), cx = (k % 12) * C, cy = (7 - Math.floor(k / 12)) * C;
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        // u across the petal (2.1 mm), v from the outer end (top of the cell) inward (4.4 mm)
        const col = Math.round(N / 2 + ((i + 0.5) / C - 0.5) * (2.1 / mm));
        const row = Math.round(N / 2 + ((j + 0.5) / C - 0.5) * (4.4 / mm));
        if (col < 0 || col >= N || row < 0 || row >= N) continue;
        const h = face[row * N + col] / 255;
        const o = ((cy + j) * c.width + cx + i) * 4;
        // the raised face, inked from use; the relief round it in the petal's plastic
        const s = 1 - 0.85 * h;
        d[o] *= s; d[o + 1] *= s; d[o + 2] *= s;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c);
}

/** The badge on the top at the front left (PH 5218_2): IBM's striped letters over the model, dark on a satin plate. */
function badgeTexture() {
  const W = 256, H = 184, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#d8d3c4'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1b1b1d';
  g.font = 'bold 92px "Times New Roman", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('IBM', W / 2, 98);
  g.fillStyle = '#d8d3c4';
  for (let k = 0; k < 8; k++) g.fillRect(0, 28 + k * 9.4, W, 3.2);   // the stripes through the letters
  g.fillStyle = '#1b1b1d'; g.font = `30px ${FONT}`; g.textAlign = 'left';
  g.fillText('5218 A02', 34, 150);
  return canvasTexture(c);
}

/** The ribbon cartridge's moulded logo (PG p.41), a shade lighter than its plastic, on a clear ground. */
function cartridgeLogoTexture() {
  const W = 256, H = 110, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = 'rgba(120,120,122,0.85)';
  g.font = 'bold 78px "Times New Roman", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('IBM', W / 2, H / 2 + 4);
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 7; k++) g.fillRect(40, 22 + k * 10.5, W - 80, 3.2);
  return canvasTexture(c);
}

/** The leadscrew's thread: three starts (lead 21.16 mm), u = x / lead and v = angle / 2 pi on the cylinder. */
function threadTexture() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const f = (((i / S - (1 - j / S)) * 3) % 1 + 1) % 1;
      const ridge = Math.sin(f * Math.PI) ** 0.6;
      const v = 70 + 150 * ridge;
      const o = (j * S + i) * 4;
      d[o] = v; d[o + 1] = v; d[o + 2] = v * 1.02; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The acoustic filter's perforation: a staggered field of 1.2 mm holes at 2.5 mm pitch over dark foam. */
function perforationTexture() {
  const S = 128, c = canvas(S, S), g = c.getContext('2d');
  g.fillStyle = '#505155'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#0d0d0e';
  const n = 8, p = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    g.beginPath(); g.arc((i + 0.5 + (j % 2) * 0.5) * p % S, (j + 0.5) * p, p * 0.26, 0, Math.PI * 2); g.fill();
  }
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.2 / 0.02, 0.2 / 0.02);    // UV unit 0.2 m; tile 20 mm (8 holes)
  return t;
}

/**
 * Loads the printer. size: units.printer.size (the model is built to it); mats: createUnitMaterials();
 * opts: { printer (the definition's printer block), glyphs (the printwheel faces), order (petal order), url }.
 * Returns { group, parts, update(state, layout) }; parts: cover, panelKeys, power, and the moving mechanism.
 * The operator's controls, each a node whose origin is its pivot (models.md, Printer, Controls): cover (hinge, turns
 * about x), power (rocker, about x), panelKeys[0..7] (press along -z), leds[0..9], ribbonKnob (on the carrier, about y),
 * platen (about x; the 5218 has no platen knobs), bail and feedRolls (paper release, about x), feederGate (about the
 * stacker plate's normal), trays[0..1] (slide along z).
 */
export async function buildPrinter(size, mats, opts = {}) {
  const { loadGLTF } = await import('../gltf.js');
  const gltf = await loadGLTF(opts.url ?? PRINTER_URL);
  const P = opts.printer;
  const pearl = texturedUnitMaterial(mats.pearl), gray = texturedUnitMaterial(mats.pebble), dark = texturedUnitMaterial(mats.dark);
  // The panel's frame, the strip under it and the power switch's bezel: a pale pearl a shade greyer than the covers
  // (the owner's photograph and BRO p.18; PH 5218_1's are yellowed to tan).
  const trim = texturedUnitMaterial(plastic(0xd2cdc0, 0.55));
  const panelMat = new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.45, metalness: 0 });
  const digits = canvas(128, 104), dg = digits.getContext('2d');
  drawDigits(dg, digits.width, digits.height, '');
  const digitsTex = canvasTexture(digits);
  const displayMat = new THREE.MeshStandardMaterial({ map: digitsTex, emissiveMap: digitsTex, emissive: 0x000000, roughness: 0.15 });
  const wheelPlastic = plastic(0xb9b8b2, 0.45, { side: THREE.DoubleSide });
  const petal = plastic(0xffffff, 0.45, { map: petalAtlas(opts.glyphs, opts.order ?? P?.wheel?.order ?? '') });
  const screw = metal(0xffffff, 0.32); screw.map = threadTexture(); screw.bumpMap = screw.map; screw.bumpScale = 1.5;
  const filter = new THREE.MeshStandardMaterial({ map: perforationTexture(), roughness: 0.55, metalness: 0.6 });
  const byName = {
    wp_pearl: pearl, wp_gray: gray, wp_dark: dark, wp_trim: trim, wp_panel: panelMat, wp_display: displayMat,
    wp_rubber: mats.rubber, wp_metal: metal(0x9c9c9a, 0.42), wp_chrome: metal(0xc9cacc, 0.16), wp_screw: screw,
    // Smoked glass over the print line: tinted, reflective, the platen and paper seen through it.
    wp_glass: new THREE.MeshPhysicalMaterial({ color: 0x2b231d, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.62, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.4, depthWrite: false }),
    wp_red: plastic(0xc8261a, 0.42), wp_filter: filter, wp_wheel: wheelPlastic, wp_petal: petal,
    wp_cartridge: plastic(0x1d5a43, 0.45), wp_white: plastic(0xe6e2d6, 0.5), wp_motor: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.4 }),
    wp_paper: new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.9 }), wp_cable: plastic(0x8fa3a3, 0.6), wp_foam: new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.97 }),
    wp_ribcart: plastic(0x3b3b3e, 0.55),   // the ribbon cartridge, a dark grey a shade lighter than the black plate (PG p.41)
    wp_badge: new THREE.MeshStandardMaterial({ map: badgeTexture(), roughness: 0.35, metalness: 0.25 }),
    wp_cartlogo: new THREE.MeshStandardMaterial({ map: cartridgeLogoTexture(), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  };
  const nodes = {};
  const keys = keyAtlas();
  const keyMat = plastic(0xffffff, 0.38, { map: keys.tex, clearcoat: 0.25, clearcoatRoughness: 0.4 });   // the colour is in the map
  const ledMats = LED_COLOURS.map((c) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c).multiplyScalar(0.18), emissive: c, emissiveIntensity: 0, roughness: 0.15, clearcoat: 1, transmission: 0 }));
  gltf.scene.traverse((o) => {
    if (o.name.startsWith('printer_')) nodes[o.name] = o;
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const key = /printer_key(\d)/.exec(o.name)?.[1] ?? /printer_key(\d)/.exec(o.parent?.name ?? '')?.[1];
    const led = /printer_led(\d)/.exec(o.name)?.[1];
    if (key !== undefined) { o.material = keyMat; o.geometry = keys.remap(o.geometry, +key); }
    else if (led !== undefined) { o.material = ledMats[+led]; o.castShadow = false; }
    else o.material = byName[o.material?.name] ?? o.material;
    if (o.material === byName.wp_glass) { o.castShadow = false; o.renderOrder = 2; }
  });
  const group = new THREE.Group();
  group.add(gltf.scene);
  const carrier = nodes.printer_carrier, wheel = nodes.printer_wheel, hammer = nodes.printer_hammer;
  // They ride the carrier; their own motion is in its frame. The ribbon advance knob turns on its own axle (y).
  const ribbonKnob = nodes.printer_ribbon_knob, cartLogo = nodes.printer_cartlogo;
  for (const o of [wheel, hammer, ribbonKnob, cartLogo]) if (o) carrier.attach(o);
  // The sheet feeder's operator parts go with it: the paper insertion gate and the two trays.
  const feederGate = nodes.printer_feeder_gate, trays = [nodes.printer_tray0, nodes.printer_tray1].filter(Boolean);
  for (const o of [feederGate, ...trays]) if (o) nodes.printer_feeder.attach(o);
  const panelKeys = [...Array(8)].map((_, i) => nodes[`printer_key${i}`]);
  // The keys, one mesh each, are drawn as one batch; each mesh stays, hidden, to be picked and pressed.
  if (panelKeys.every((k) => k?.isMesh && !k.children.length && k.parent === panelKeys[0].parent)) {
    const batch = batchMeshes(panelKeys, keyMat);
    batch.name = 'printer_keys';
    panelKeys[0].parent.add(batch);
  }
  const leds = [...Array(10)].map((_, i) => nodes[`printer_led${i}`]);
  const rest = new Map();
  for (const o of [carrier, wheel, hammer, ...panelKeys]) rest.set(o, o.position.clone());
  const parts = {
    cover: nodes.printer_cover, panelKeys, power: nodes.printer_power, carrier, wheel, hammer, platen: nodes.printer_platen,
    bail: nodes.printer_bail, feedRolls: nodes.printer_feedrolls, leadscrew: nodes.printer_leadscrew, cam: nodes.printer_cam,
    leds, display: nodes.printer_display, feeder: nodes.printer_feeder, body: nodes.printer_body, ribbonKnob,
    feederGate, trays,
  };
  mergeStaticMeshes(group, partObjects(parts));
  const lead = P?.carrier?.lead ?? 0.02116, powerTravel = P?.power?.travel ?? 0.35;
  let lastLeds = -1, lastDigits = null;
  return {
    group, parts,
    /** Poses every moving part from the mechanism's snapshot (src/sim/wp/layout.js). */
    update(s, L) {
      const x = -s[L.carriageX];   // carriageX is minus the carrier's x (architecture.md 6.2)
      carrier.position.x = rest.get(carrier).x + x;
      wheel.rotation.z = s[L.wheelTheta];
      hammer.position.z = rest.get(hammer).z - s[L.hammerX];
      parts.platen.rotation.x = s[L.platenPsi];
      parts.leadscrew.rotation.x = (-2 * Math.PI * x) / lead;   // a right-hand thread drives the follower
      parts.bail.rotation.x = s[L.bail];
      parts.feedRolls.rotation.x = -0.15 * s[L.paperRelease];
      parts.cam.rotation.x = s[L.cam];
      parts.cover.rotation.x = -s[L.cover];
      parts.power.rotation.x = s[L.printerPower] - powerTravel / 2;
      panelKeys.forEach((m, i) => { m.position.z = rest.get(m).z - s[L.panelKeyX + i]; });
      const on = s[L.printerPower] > powerTravel / 2;
      const bits = on ? s[L.leds] | 0 : 0;
      if (bits !== lastLeds) {
        lastLeds = bits;
        ledMats.forEach((m, i) => { m.emissiveIntensity = bits & (1 << i) ? 2.2 : 0; });
      }
      const code = on ? Math.round(s[L.digits]) : 0;
      const text = code > 0 ? String(code % 100).padStart(2, '0') : '';
      if (text !== lastDigits) {
        lastDigits = text;
        drawDigits(dg, digits.width, digits.height, text);
        digitsTex.needsUpdate = true;
        displayMat.emissive.set(text ? 0xffffff : 0x000000);
      }
    },
  };
}
