// The FO-70's block-out (docs/fax/plan.md M0): simple boxes at the documented size and the definition's block-out
// positions, lilac grey with the cream panel, the handset on its cradle at the left as in the owner's photograph. It
// returns what the real model's view (src/render/fax/fo70-view.js, built in Blender) will return, { group, parts },
// in the body's frame, so the kit swaps one for the other (architecture.md 6.2). Also the desk's things as boxes.
import * as THREE from 'three';
import { DESK_THINGS } from '../../machine/fax-views.js';

function mat(color, roughness = 0.62) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

function block([min, max], material, name) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.castShadow = m.receiveShadow = true;
  m.name = name;
  return m;
}

/**
 * machine: the definition. Returns { group, parts }: parts.handset (its group, origin on the cradle under its centre),
 * parts.cover (the panel's group on its rear hinge, rotate x to lift), parts.panel, parts.display, parts.feeder,
 * parts.paperExit, parts.rollBay, parts.rear, and parts.keys (none in the block-out).
 */
export function buildBlockout(machine) {
  const B = machine.blockout, C = B.colors;
  const body = mat(C.body), cream = mat(C.panel, 0.55), slot = mat(C.slot, 0.8);
  const lcd = new THREE.MeshStandardMaterial({ color: C.display, roughness: 0.25, metalness: 0 });
  const group = new THREE.Group();
  group.name = 'fo70-blockout';
  group.add(block(B.cradle, body, 'cradle'), block(B.cabinet, body, 'cabinet'), block(B.documentTable, body, 'documentTable'));
  const docSlot = block(B.documentSlot, slot, 'documentSlot');
  const paperExit = block(B.paperExit, slot, 'paperExit');
  const docExit = block(B.documentExit, slot, 'documentExit');
  const rear = block(B.rear, slot, 'rear');
  group.add(docSlot, paperExit, docExit, rear);
  // The panel and its LCD lift together on a hinge at the panel's rear edge (the roll cover, [M]).
  const [pmin, pmax] = B.panel;
  const cover = new THREE.Group();
  cover.name = 'cover';
  cover.position.set(0, pmin[1], pmin[2]);
  const local = (b) => [[b[0][0], b[0][1] - pmin[1], b[0][2] - pmin[2]], [b[1][0], b[1][1] - pmin[1], b[1][2] - pmin[2]]];
  const panel = block(local(B.panel), cream, 'panel');
  const display = block(local(B.display), lcd, 'display');
  cover.add(panel, display);
  group.add(cover);
  // The roll's bay, seen only with the cover lifted: a dark box inside the cabinet's top.
  const rollBay = block(B.rollBay, slot, 'rollBay');
  rollBay.visible = false;
  group.add(rollBay);
  // The handset on its cradle.
  const hs = machine.units.handset;
  const handset = new THREE.Group();
  handset.name = 'handset';
  handset.position.fromArray(hs.at);
  const [w, h, d] = hs.size;
  handset.add(block([[-w / 2, 0, -d / 2], [w / 2, h, d / 2]], mat(hs.color ?? C.handset), 'handsetBody'));
  group.add(handset);
  return { group, parts: { handset, cover, panel, display, feeder: docSlot, paperExit, documentExit: docExit, rollBay, rear, keys: [] } };
}

/** The desk's things as boxes at their spots: { name: mesh }, added to `scene`. */
export function buildDeskThings(scene, layout) {
  const colors = { cardIndex: 0x5b4636, documents: 0xc9b98f, receivedPile: 0xf1efe6, spareRoll: 0x6d8fb8 };
  const out = {};
  for (const [name, s] of Object.entries(DESK_THINGS)) {
    const p = layout[name];
    if (!p) continue;
    const m = block([[-s.w / 2, 0, -s.d / 2], [s.w / 2, s.h, s.d / 2]], mat(colors[name] ?? 0x888888, 0.8), name);
    m.position.x += p.x; m.position.z += p.z;
    if (p.yaw) m.rotation.y = p.yaw;
    scene.add(m);
    out[name] = m;
  }
  return out;
}
