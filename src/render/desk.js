// The desk the machine stands on: top surface at y = 0. An analytic contact-occlusion term under the machine's footprint
// keeps the room's reflections out of the gap, which is what stops the machine looking afloat.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class Desk {
  constructor({ scene, mats }) {
    this.scene = scene;
    this.footprint = { uFootC: { value: new THREE.Vector2(0, 0.03) }, uFootH: { value: new THREE.Vector2(0.17, 0.14) } };
    const mat = mats.desk, foot = this.footprint;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, foot);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDeskPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vDeskPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uFootC; uniform vec2 uFootH; varying vec3 vDeskPos;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          vec2 q = abs(vDeskPos.xz - uFootC) - uFootH;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          float ao = mix(0.12, 1.0, smoothstep(-0.015, 0.11, d));
          if (vDeskPos.y > -0.002) {
            reflectedLight.indirectDiffuse *= ao;
            reflectedLight.indirectSpecular *= ao * ao;
          #ifdef USE_CLEARCOAT
            clearcoatSpecularIndirect *= ao * ao;
          #endif
          }
        }`);
    };
    this.mat = mat;
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = this.mat;
      o.receiveShadow = true;
      o.castShadow = false;
    });
    this.scene.add(gltf.scene);
    return true;
  }

  /** Fits the occlusion to the real machine outline, from a world box. */
  setFootprint(box) {
    this.footprint.uFootC.value.set((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
    this.footprint.uFootH.value.set((box.max.x - box.min.x) / 2, (box.max.z - box.min.z) / 2);
  }
}
