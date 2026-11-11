// A stack of blank sheets on the desk to the left of the machine. Clicking it takes the top sheet and winds it in.
import * as THREE from 'three';
import { deskSpot } from '../render/desk-layout.js';

const AT = { x: -0.31, z: -0.06 };           // m, desk coordinates; the desk top is y = 0
const BLOCK_H = 0.012;                      // m, the body of the stack
const LOOSE = [{ yaw: 0.012, x: 0.001, z: -0.001 }, { yaw: -0.02, x: -0.0015, z: 0.001 }, { yaw: 0.028, x: 0.002, z: 0.0015 }];   // the top few sheets lie a little out of true
const LOOSE_H = 0.00016;                    // m

export class FreshStack {
  constructor({ scene, paperMaterial, machine }) {
    this.paper = paperMaterial;
    const W = machine.paper.width, H = machine.paper.height;
    this.group = new THREE.Group();
    const at = deskSpot(machine, 'freshStack', AT, -1);
    this.group.position.set(at.x, 0, at.z);
    scene.add(this.group);
    this.material = new THREE.MeshStandardMaterial({ color: paperMaterial.color.clone(), roughness: paperMaterial.roughness, metalness: 0 });
    const block = new THREE.Mesh(new THREE.BoxGeometry(W, BLOCK_H, H), this.material);
    block.position.y = BLOCK_H / 2;
    block.castShadow = block.receiveShadow = true;
    this.group.add(block);
    const sheet = new THREE.BoxGeometry(W, LOOSE_H, H);
    LOOSE.forEach((p, i) => {
      const m = new THREE.Mesh(sheet, this.material);
      m.position.set(p.x, BLOCK_H + (i + 0.5) * LOOSE_H, p.z);
      m.rotation.y = p.yaw;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    });
    this.top = BLOCK_H + LOOSE.length * LOOSE_H;
    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(W + 0.01, this.top + 0.002, H + 0.01), new THREE.MeshBasicMaterial({ visible: false }));
    this.proxy.position.y = (this.top + 0.002) / 2;
    this.group.add(this.proxy);
    this.highlight = block;
  }

  /** Paper fibre maps arrive some time after startup. */
  update() {
    const p = this.paper;
    if (this.material.normalMap || !p.normalMap) return;
    this.material.normalMap = p.normalMap; this.material.normalScale.copy(p.normalScale);
    if (p.roughnessMap) this.material.roughnessMap = p.roughnessMap;
    this.material.needsUpdate = true;
  }
}
