// Our quick-start packet: three US letter sheets stapled at the top left corner, lying on the desk right of the
// sticky notes. The top sheet's bottom right corner curls up off the ones under it. Its title page is drawn on a
// canvas; clicking it opens the reading overlay (src/ui/wp-manual.js) with our pages (src/ui/wp-manual-pages.js).
import * as THREE from 'three';
import { PAGES } from '../../ui/wp-manual-pages.js';

export const PACKET_SIZE = { w: 0.2159, d: 0.2794 };
export const PACKET_TITLE = 'Quick Start: Displaywriter / Textpack 4';
const SHEET_T = 0.0001;

function drawTitlePage(canvas) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  g.fillStyle = '#f5f2e9'; g.fillRect(0, 0, W, H);
  const sans = '"Helvetica Neue", Helvetica, Arial, sans-serif', mono = '"Courier New", Courier, monospace';
  const left = W * 0.12;
  g.fillStyle = '#1c1c1c'; g.textBaseline = 'alphabetic';
  g.font = `700 ${Math.round(W * 0.064)}px ${sans}`;
  g.fillText('Quick Start', left, H * 0.13, W * 0.76);
  g.font = `400 ${Math.round(W * 0.042)}px ${sans}`;
  g.fillText('Displaywriter / Textpack 4', left, H * 0.17, W * 0.76);
  g.fillStyle = '#1b2233'; g.fillRect(left, H * 0.19, W * 0.18, Math.max(3, H * 0.004));
  // The contents, typed.
  g.fillStyle = '#2a2a2a'; g.font = `400 ${Math.round(W * 0.03)}px ${mono}`;
  PAGES.slice(1).forEach((p, i) => g.fillText(`${String(i + 2).padStart(2)}  ${p.title}`, left, H * (0.27 + i * 0.045), W * 0.76));
  g.font = `400 ${Math.round(W * 0.026)}px ${mono}`;
  g.fillStyle = '#555';
  g.fillText('The full IBM manual is the grey binder', left, H * 0.72, W * 0.8);
  g.fillText('on the diskette unit.', left, H * 0.75, W * 0.8);
  // A pencil tick or two from the operator.
  g.strokeStyle = 'rgba(60,60,70,0.55)'; g.lineWidth = W * 0.004;
  for (const y of [0.265, 0.31]) { g.beginPath(); g.moveTo(left - W * 0.05, H * y - W * 0.01); g.lineTo(left - W * 0.04, H * y); g.lineTo(left - W * 0.02, H * y - W * 0.03); g.stroke(); }
}

/** Lays the packet on the desk at `at` [x, y, z], turned `yaw`. Returns { group, hit, box }. */
export function createPacket({ scene, renderer, at, yaw = 0 }) {
  const { w, d } = PACKET_SIZE;
  const group = new THREE.Group();
  group.name = 'quickstart';
  const canvas = document.createElement('canvas'); canvas.width = 816; canvas.height = 1056;
  drawTitlePage(canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  document.fonts?.ready?.then(() => { drawTitlePage(canvas); tex.needsUpdate = true; });
  const paper = new THREE.MeshStandardMaterial({ color: 0xf1eee4, roughness: 0.9, side: THREE.DoubleSide });
  const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, side: THREE.DoubleSide });

  // The sheets under the top one, each a little askew of the next, as a stapled packet sits.
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paper);
    m.rotation.set(-Math.PI / 2, 0, (i ? -1 : 1) * 0.006);
    m.position.set(0.0006 * (i ? 1 : -1), (i + 1) * SHEET_T, 0.0005 * i);
    m.receiveShadow = true; m.castShadow = true;
    group.add(m);
  }
  // The top sheet, its bottom right corner lifting in a gentle curl.
  const geo = new THREE.PlaneGeometry(w, d, 16, 20);
  const p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const u = p.getX(k) / w + 0.5, v = 0.5 - p.getY(k) / d;     // u across, v from the top edge down
    const c = Math.max(0, (u + v - 1.25) / 0.75);                 // 0 inside, 1 at the far corner
    p.setZ(k, 0.012 * c * c);
  }
  geo.computeVertexNormals();
  const sheet = new THREE.Mesh(geo, top);
  sheet.rotation.x = -Math.PI / 2;
  sheet.position.y = 3 * SHEET_T + 0.0002;
  sheet.castShadow = sheet.receiveShadow = true;
  group.add(sheet);
  // The staple, across the top left corner.
  const staple = new THREE.Mesh(new THREE.BoxGeometry(0.0125, 0.0005, 0.0009), new THREE.MeshStandardMaterial({ color: 0xbfc3c8, metalness: 1, roughness: 0.35 }));
  staple.position.set(-w / 2 + 0.014, 4 * SHEET_T + 0.0005, -d / 2 + 0.014);
  staple.rotation.y = Math.PI / 4;
  staple.castShadow = true;
  group.add(staple);

  const hit = new THREE.Mesh(new THREE.BoxGeometry(w + 0.004, 0.014, d + 0.004), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.007;
  group.add(hit);
  group.position.set(at[0], at[1], at[2]);
  group.rotation.y = yaw;
  scene.add(group);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  return { group, hit, box: { min: box.min.toArray(), max: box.max.toArray() } };
}
