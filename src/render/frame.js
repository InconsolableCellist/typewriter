// Procedural open-frame casting, used until public/assets/models/frame.glb exists.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function sidePlateShape(rig) {
  const zRear = rig.railRearZ - 0.03;
  const s = new THREE.Shape();
  s.moveTo(0.232, 0.008);
  s.lineTo(0.232, 0.05);
  s.quadraticCurveTo(0.222, 0.06, 0.205, 0.066);
  s.lineTo(0.094, 0.133);
  s.quadraticCurveTo(0.03, 0.156, -0.01, 0.158);
  s.lineTo(zRear + 0.018, 0.152);
  s.quadraticCurveTo(zRear - 0.004, 0.15, zRear - 0.006, 0.126);
  s.lineTo(zRear - 0.006, 0.008);
  s.closePath();
  const w = new THREE.Path();
  w.moveTo(0.176, 0.03);
  w.lineTo(0.18, 0.0505);
  w.lineTo(0.098, 0.1085);
  w.quadraticCurveTo(0.03, 0.135, -0.01, 0.136);
  w.lineTo(zRear + 0.024, 0.129);
  w.quadraticCurveTo(zRear + 0.012, 0.126, zRear + 0.012, 0.11);
  w.lineTo(zRear + 0.012, 0.03);
  w.closePath();
  s.holes.push(w);
  return s;
}

export function buildPlaceholderFrame(m, g, rig, mats) {
  const group = new THREE.Group(); group.name = 'frame-placeholder';
  const zRear = rig.railRearZ - 0.03;

  const plate = sidePlateShape(rig);
  const ext = { depth: 0.012, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0018, bevelSegments: 3, curveSegments: 18 };
  const mk = (x) => {
    const g2 = new THREE.ExtrudeGeometry(plate, ext).rotateY(-Math.PI / 2).translate(x + 0.006, 0, 0);
    return g2;
  };
  const plates = mergeGeometries([mk(-0.165), mk(0.165)]);
  const add = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(plates, mats.japan);

  // Base pan and front apron.
  add(new THREE.BoxGeometry(0.34, 0.007, 0.24 + (0.225 + 0.15) * 0.0 + (zRear * -1) + 0.12).translate(0, 0.0115, (0.232 + zRear) / 2 - 0.0), mats.japan);
  add(new THREE.BoxGeometry(0.343, 0.038, 0.012).translate(0, 0.033, 0.226), mats.japan);
  add(new THREE.BoxGeometry(0.3, 0.012, 0.012).translate(0, 0.11, zRear - 0.002), mats.japan);
  add(new THREE.BoxGeometry(0.33, 0.012, 0.018).translate(0, rig.railY - 0.018, rig.railRearZ - 0.012), mats.japan);

  // Top deck wings carrying the spools.
  const wing = (sign) => new THREE.BoxGeometry(0.08, 0.006, 0.086).translate(sign * 0.124, 0.145, 0.018);
  add(mergeGeometries([wing(-1), wing(1)]), mats.japan);

  // Rail uprights.
  const up = (x) => new THREE.BoxGeometry(0.012, 0.03, 0.08).translate(x, rig.railY - 0.012, rig.railRearZ + 0.02);
  add(mergeGeometries([up(-rig.railHalf + 0.006), up(rig.railHalf - 0.006)]), mats.japan);
  add(new THREE.BoxGeometry(0.012, 0.09, 0.016).translate(-0.178, 0.085, zRear + 0.01), mats.japan);
  add(new THREE.BoxGeometry(0.012, 0.09, 0.016).translate(0.178, 0.085, zRear + 0.01), mats.japan);

  // Rubber feet.
  const foot = (x, z) => new THREE.CylinderGeometry(0.014, 0.012, 0.008, 24).translate(x, 0.004, z);
  add(mergeGeometries([foot(-0.15, 0.205), foot(0.15, 0.205), foot(-0.15, zRear + 0.018), foot(0.15, zRear + 0.018)]), mats.rubber);

  add(new THREE.BoxGeometry(0.33, 0.01, 0.008).translate(0, m.keys.leverPivot[1] - 0.012, m.keys.leverPivot[2]), mats.castDark);

  // Fittings the casting does not include (docs/assets.md): they stay when frame.glb replaces the group above.
  const fittings = new THREE.Group(); fittings.name = 'frame-fittings';
  const fit = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    fittings.add(mesh);
    return mesh;
  };
  // Key lever comb under the rows, below the lowest lever, and a felt rest for the key stems.
  const comb = new THREE.BoxGeometry(0.31, 0.01, 0.01);
  fit(mergeGeometries([comb.clone().translate(0, 0.054, 0.09), comb.clone().translate(0, 0.055, 0.145)]), mats.castDark);
  fit(new THREE.BoxGeometry(0.31, 0.006, 0.018).translate(0, 0.05, 0.195), mats.felt);
  // Key lever fulcrum wire, resting on the casting's fulcrum rib.
  fit(new THREE.CylinderGeometry(0.002, 0.002, 0.34, 12).rotateZ(Math.PI / 2).translate(0, m.keys.leverPivot[1], m.keys.leverPivot[2]), mats.steel);

  return { group, fittings };
}
