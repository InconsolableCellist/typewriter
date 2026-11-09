// Motion blur of the type element, by rendering it at several poses across the frame's interval. Each pixel takes its
// colour from exactly one pose, so the result is opaque, depth-correct against the paper and cover, and the same in every
// camera; a pixel whose pose misses the ball simply shows what is behind it. Nothing runs while the ball is still.
import * as THREE from 'three';

const POSES = 12;
const MIN_MOVE = 1.2e-4;     // m per frame
const MIN_TURN = 0.01;       // rad per frame

function stipple(material, bin, shared) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBlurBin = bin;
    shader.uniforms.uBlurN = shared.count;
    shader.uniforms.uBlurSeed = shared.seed;
    shader.fragmentShader = 'uniform float uBlurBin, uBlurN, uBlurSeed;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (uBlurN > 1.5) {
        float blurH = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uBlurSeed * vec2(5.588, 3.183), vec2(0.06711056, 0.00583715))));
        if (floor(blurH * uBlurN) != uBlurBin) discard;
      }`);
  };
  material.customProgramCacheKey = () => 'ball-blur';
  material.needsUpdate = true;
}

export class BallBlur {
  /** @param ball the group whose world transform is the element's pose; the group's origin is the ball's centre */
  constructor(scene, ball) {
    this.ball = ball;
    this.shared = { count: { value: 1 }, seed: { value: 0 } };
    this.p0 = new THREE.Vector3(); this.q0 = new THREE.Quaternion(); this.has = false;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.tmp = { p, q, s, m: new THREE.Matrix4() };
    ball.updateWorldMatrix(true, true);
    const inv = ball.matrixWorld.clone().invert();
    const parts = [];
    ball.traverse((o) => { if (o.isMesh && o.material.visible !== false) parts.push(o); });
    // The ball's own materials are private copies: some of them are shared with fixed parts of the machine.
    for (const o of parts) { o.material = o.material.clone(); stipple(o.material, { value: 0 }, this.shared); }
    // The glyph relief is left out of the in-between poses: it is far too fine to survive the smear and is most of the triangles.
    const smeared = parts.filter((o) => o.name !== 'ball_faces');
    this.ghosts = [];
    for (let i = 1; i < POSES; i++) {
      const g = new THREE.Group(); g.matrixAutoUpdate = false; g.visible = false; g.name = 'ball_blur_pose';
      for (const o of smeared) {
        const mat = o.material.clone(); stipple(mat, { value: i }, this.shared);
        const mesh = new THREE.Mesh(o.geometry, mat);
        mesh.matrixAutoUpdate = false; mesh.matrix.multiplyMatrices(inv, o.matrixWorld);
        mesh.castShadow = false; mesh.receiveShadow = o.receiveShadow; mesh.userData.noAO = true;
        g.add(mesh);
      }
      scene.add(g); this.ghosts.push(g);
    }
    this.frame = 0;
  }

  /** Call once a frame after the machine's pose is set. */
  update() {
    const { p, q, s, m } = this.tmp, { p0, q0, ghosts, shared, ball } = this;
    ball.updateWorldMatrix(true, false);
    ball.matrixWorld.decompose(p, q, s);
    const moved = this.has && (p.distanceTo(p0) > MIN_MOVE || 2 * Math.acos(Math.min(1, Math.abs(q.dot(q0)))) > MIN_TURN);
    shared.count.value = moved ? POSES : 1;
    if (moved) {
      shared.seed.value = this.frame++ & 63;
      const pi = new THREE.Vector3(), qi = new THREE.Quaternion();
      ghosts.forEach((g, n) => {
        const t = 1 - (n + 1) / POSES;   // bin 0 is the ball at the frame's end, in its real place
        pi.lerpVectors(p0, p, t); qi.slerpQuaternions(q0, q, t);
        g.matrix.compose(pi, qi, s); g.matrixWorldNeedsUpdate = true; g.visible = true;
      });
    } else for (const g of ghosts) g.visible = false;
    p0.copy(p); q0.copy(q); this.has = true;
  }
}
