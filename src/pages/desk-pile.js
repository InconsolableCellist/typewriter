// The stack of finished pages on the desk to the right of the machine. Only the top sheets are real meshes, and only the
// top few carry a printed texture; anything below them shows no more than an edge.
import * as THREE from 'three';

const AT = { x: 0.315, z: -0.1 };           // m, desk coordinates; the desk top is y = 0. In view from the default camera, clear of the machine
const MAX_SHEETS = 12, TEXTURED = 3;
const GAP = 0.00018;                        // m per sheet, a little over caliper so the edges of the pile read
const CALIPER = 0.0001;                     // m, for pages below the top dozen, carried by a solid block
const YAW = 0.03, SLIDE = 0.0035;           // rad and m, the largest random misalignment of a sheet
const SETTLE_S = 0.55, LIFT = 0.055, TILT = 0.12;

/** Stable per-page randomness, so a sheet's lie does not change once it has landed. */
function rand(seed, k) {
  const h = Math.imul(seed * 73856093 ^ k * 19349663, 2654435761);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296 * 2 - 1;
}

function pixel(...rgba) {
  const t = new THREE.DataTexture(Uint8Array.of(...rgba), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

export class DeskPile {
  constructor({ scene, renderer, camera, paperMaterial, machine, maxAniso }) {
    this.paper = paperMaterial; this.maxAniso = maxAniso;
    this.W = machine.paper.width; this.H = machine.paper.height;
    this.group = new THREE.Group();
    this.group.position.set(AT.x, 0, AT.z);
    scene.add(this.group);
    this.sheets = [];             // bottom first
    this.count = 0;

    this.geometry = sheetGeometry(this.W, this.H);
    this.white = pixel(255, 255, 255, 255);
    this.white.colorSpace = THREE.SRGBColorSpace;
    this.flatNormal = pixel(128, 128, 255, 255);
    this.roughWhite = pixel(255, 255, 255, 255);
    this.plain = this.makeMaterial();

    this.block = new THREE.Mesh(new THREE.BoxGeometry(this.W, 1, this.H), this.plain);
    this.block.visible = false;
    this.block.castShadow = this.block.receiveShadow = true;
    this.group.add(this.block);

    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(this.W + 0.008, 1, this.H + 0.008), new THREE.MeshBasicMaterial({ visible: false }));
    this.group.add(this.proxy);

    // Every sheet uses one shader whose maps only ever change value. Warming it now keeps the first page from stalling a
    // frame: compile builds the program, and a draw of an invisibly small probe builds the GPU pipeline state.
    this.probe = this.makeMesh();
    this.probe.scale.setScalar(1e-5);
    this.group.add(this.probe);
    renderer.compile(this.group, camera, scene);
    this.probeFrames = 4;
    this.setHeights();
  }

  makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      color: this.paper.color.clone(), roughness: this.paper.roughness, metalness: 0,
      map: this.white, normalMap: this.flatNormal, roughnessMap: this.roughWhite,
    });
    mat.onBeforeCompile = uncoatedStock;
    return mat;
  }

  makeMesh() {
    const mesh = new THREE.Mesh(this.geometry, this.plain);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  /** Paper fibre maps arrive some time after startup. */
  matchFibre(mat) {
    const p = this.paper;
    if (p.normalMap) { mat.normalMap = p.normalMap; mat.normalScale.copy(p.normalScale); }
    if (p.roughnessMap) { mat.roughnessMap = p.roughnessMap; mat.roughness = p.roughness; }
  }

  /** Lays a page on top of the pile. Its thumbnail pixels come straight from the encoder, and the texture takes them over. */
  add(page) {
    const texture = new THREE.DataTexture(page.thumbPixels, page.thumbWidth, page.thumbHeight, THREE.RGBAFormat, THREE.UnsignedByteType);
    page.thumbPixels = null;      // the archive keeps only the JPEG; these bytes now belong to the texture
    texture.flipY = false;        // row 0 of the bitmap is v = 0, which sheetGeometry puts at the top of the page
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.maxAniso;
    texture.needsUpdate = true;

    const seq = this.count++;
    const sheet = this.sheets.length >= MAX_SHEETS ? this.sheets.shift() : { mesh: this.makeMesh(), material: null };
    if (sheet.material) this.release(sheet);
    sheet.material = this.makeMaterial();
    sheet.material.map = texture;
    this.matchFibre(sheet.material);
    this.matchFibre(this.plain);
    sheet.mesh.material = sheet.material;
    sheet.mesh.rotation.set(0, rand(seq, 1) * YAW, 0);
    sheet.mesh.position.set(rand(seq, 2) * SLIDE, 0, rand(seq, 3) * SLIDE);
    sheet.age = 0;
    this.group.add(sheet.mesh);
    this.sheets.push(sheet);
    // Sheets deep in the pile keep their mesh and give back their texture.
    for (let i = 0; i < this.sheets.length - TEXTURED; i++) {
      const s = this.sheets[i];
      if (s.material) { this.release(s); s.material = null; s.mesh.material = this.plain; }
    }
    this.setHeights();
    this.animate(sheet);
  }

  release(sheet) {
    sheet.material.map.dispose();
    sheet.material.dispose();
  }

  get top() { return this.sheets[this.sheets.length - 1]?.mesh ?? null; }

  setHeights() {
    const base = Math.max(0, this.count - MAX_SHEETS) * CALIPER;
    this.block.visible = base > 0;
    if (base > 0) { this.block.scale.y = base; this.block.position.y = base / 2; }
    this.sheets.forEach((s, i) => { s.y = base + (i + 1) * GAP; s.mesh.position.y = s.y; });
    const h = base + this.sheets.length * GAP + 0.002;
    this.proxy.scale.y = h;
    this.proxy.position.y = h / 2;
    this.proxy.updateMatrixWorld();
  }

  animate(sheet) {
    const t = Math.min(1, sheet.age / SETTLE_S);
    if (t >= 1) { sheet.mesh.position.y = sheet.y; sheet.mesh.rotation.x = 0; return; }
    const fall = 1 - t, ease = fall * fall * fall;       // quick at first, then eased onto the pile
    sheet.mesh.position.y = sheet.y + LIFT * ease;
    sheet.mesh.rotation.x = -TILT * ease;
  }

  update(dt) {
    if (this.probe && --this.probeFrames <= 0) { this.group.remove(this.probe); this.probe = null; }
    for (const s of this.sheets) {
      if (s.age >= SETTLE_S) continue;
      s.age += dt;
      this.animate(s);
    }
  }
}

/** One sheet, lying flat, facing up. The page's top edge is to the rear (-z), so it reads the right way round from the typist's chair. */
function sheetGeometry(W, H) {
  const g = new THREE.BufferGeometry();
  const x = W / 2, z = H / 2;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-x, 0, -z, -x, 0, z, x, 0, -z, x, 0, z]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

/** The sheet's own stock (paper-view.js): uncoated, so almost no specular lobe even at grazing angles. */
function uncoatedStock(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
    material.specularColor *= 0.45; material.specularF90 = 0.2;`);
}
