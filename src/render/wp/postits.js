// Sticky notes on the desk: how to drive the machine, in an operator's hand (Caveat, SIL OFL, public/assets/fonts).
// Each is a 3 x 3 in note drawn on a canvas, lying on the desk a little askew with its top edge curling up off it.
// The steps are the real Textpack 4 keystrokes, checked against the software (tests/wp_notes.test.js).
import * as THREE from 'three';
import { versioned } from '../../asset-version.js';

const INCH = 0.0254;
export const NOTE_SIZE = 3 * INCH;

/** The notes' text. A line starting with '#' is the heading. */
export const NOTES = [
  {
    id: 'keys',
    lines: ['# Keys', 'ENTER = right Alt', 'RET = Enter', 'CODE = left Alt', 'CANCL = Esc', 'REQST = F1', 'MSG = Insert', 'END = End'],
  },
  {
    id: 'type',
    lines: ['# New document', 'a ENTER  Typing Tasks', 'a ENTER  Create', 'name ENTER', 'WORK01 ENTER (CAPS!)', 'ENTER  (menu ok)', 'type! RET = new line', 'END = save + finish', 'Revise: b, same way'],
  },
  {
    id: 'print',
    lines: ['# Print it', 'Typing Tasks, then', 'e ENTER  Print', 'name ENTER', 'WORK01 ENTER', 'ENTER  (menu ok)', '==> ?  MSG reads it', 'element on? REQST e ENTER', 'f ENTER = main menu'],
  },
];

const FONT_URL = '/assets/fonts/caveat-600.woff2';
let fontReady = null;
function loadFont() {
  if (typeof FontFace === 'undefined') return Promise.resolve(false);
  fontReady ??= new FontFace('WpHand', `url(${versioned(FONT_URL)})`).load().then((f) => { document.fonts.add(f); return true; }).catch(() => false);
  return fontReady;
}

function drawNote(canvas, note, seed) {
  const g = canvas.getContext('2d'), S = canvas.width;
  // Canary paper, a touch darker at the glued top band and toward the edges.
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#ecd96a'); grad.addColorStop(0.16, '#f6e57c'); grad.addColorStop(1, '#f3e078');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(120,90,0,0.10)');
  g.fillStyle = v; g.fillRect(0, 0, S, S);
  const pad = S * 0.07, n = note.lines.length;
  const lh = (S - 2 * pad) / (n + 0.6);
  g.textBaseline = 'alphabetic';
  let y = pad + lh * 0.95;
  note.lines.forEach((line, i) => {
    const head = line.startsWith('#');
    const text = head ? line.slice(1).trim() : line;
    g.fillStyle = head ? '#1d2a6b' : '#22264f';
    g.font = `${head ? 600 : 600} ${Math.round(lh * (head ? 1.12 : 0.92))}px WpHand, "Segoe Print", "Comic Sans MS", cursive`;
    // A hand does not write level: each line leans a little its own way.
    const tilt = (Math.sin(seed * 7.1 + i * 2.3) * 0.012);
    g.save(); g.translate(pad + (head ? 0 : S * 0.01), y); g.rotate(tilt);
    g.fillText(text, 0, 0, S - 2 * pad);
    if (head) { g.fillRect(0, lh * 0.14, Math.min(g.measureText(text).width, S - 2 * pad), Math.max(2, S * 0.006)); }
    g.restore();
    y += lh * (head ? 1.25 : 1);
  });
}

/**
 * Lays the notes on the desk. `spots`: for each note [x, y, z, yaw] in world space (y = the desk's top). Returns
 * { group, box } with the box around them all for the view system.
 */
export function createPostits({ scene, renderer, spots }) {
  const group = new THREE.Group();
  group.name = 'postits';
  const S = 512;
  const box = new THREE.Box3();
  NOTES.forEach((note, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer?.capabilities.getMaxAnisotropy?.() ?? 4;
    const paint = () => { drawNote(canvas, note, i + 1); tex.needsUpdate = true; };
    paint();
    loadFont().then((ok) => { if (ok) paint(); });
    // The sheet: flat on the desk but for the top edge, which lifts off it in a gentle curl.
    const geo = new THREE.PlaneGeometry(NOTE_SIZE, NOTE_SIZE, 1, 12);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const t = (p.getY(k) / NOTE_SIZE) + 0.5;               // 0 at the bottom edge, 1 at the top
      p.setZ(k, Math.pow(Math.max(0, t - 0.55) / 0.45, 2) * 0.004);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.castShadow = true;
    const [x, y, z, yaw] = spots[i];
    mesh.rotation.set(-Math.PI / 2, 0, yaw, 'XYZ');
    mesh.position.set(x, y + 0.0004, z);
    mesh.name = `postit_${note.id}`;
    group.add(mesh);
  });
  scene.add(group);
  group.updateMatrixWorld(true);
  box.setFromObject(group);
  box.max.y += 0.01;
  return { group, box: { min: box.min.toArray(), max: box.max.toArray() } };
}
