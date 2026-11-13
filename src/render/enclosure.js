// Body shell from public/assets/models/enclosure.glb (one named node per panel). It lives on layer 1 so
// the head camera sees through it, and it occludes picking so a click on a panel is not a click on what is behind it.
import * as THREE from 'three';

export class Enclosure {
  constructor({ scene, mats }) {
    this.scene = scene; this.mats = mats;
    this.group = new THREE.Group(); this.group.name = 'enclosure';
    this.scene.add(this.group);
    this.loaded = false;
    this.meshes = [];
  }

  async load(url) {
    try {
      // One request: a missing file (or a dev server's HTML fallback for it) is told from the GET itself.
      const [res, { GLTFLoader }] = await Promise.all([fetch(url), import('three/examples/jsm/loaders/GLTFLoader.js')]);
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return false;
      const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), url.slice(0, url.lastIndexOf('/') + 1));
      const byName = { enclosure_paint: this.mats.japanGlb, enclosure_trim: this.mats.nickelGlb };
      gltf.scene.traverse((o) => {
        o.layers.set(1);
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        const named = byName[(o.material?.name ?? '').toLowerCase()];
        if (named) o.material = named;
        this.meshes.push(o);
      });
      this.group.add(gltf.scene);
      this.loaded = true;
      this.sync();
      return true;
    } catch (e) { console.info('enclosure not loaded', e); return false; }
  }

  sync() { this.group.visible = this.loaded; }
  get showing() { return this.group.visible; }
}
