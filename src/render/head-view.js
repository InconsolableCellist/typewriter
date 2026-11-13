// Live close-up from in front of the print point: the current line with its real ink, and the ribbon and slug
// as they arrive. It is the main scene seen by a second camera, drawn into a reserved rectangle of the canvas.
// The camera stays on the print point, so the carriage carries the typed line past it.
import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CameraWatch, PassCache } from './motion.js';

const DISTANCE = 0.205, TILT = 0.029, NEAR = 0.16;
const REF_HEIGHT_PX = 440, REF_FOV = 20, LINE_ABOVE_BOTTOM_PX = 124, BAIL_BELOW_TOP_PX = 24;
const REFRESH_FRAMES = 30;   // redrawn at least this often even when nothing seems to have changed

export class HeadView {
  /**
   * stage (optional): createScene()'s, for its motion tracking and device tier; without it the view is drawn every
   * frame. invalidate() asks for a redraw (ink that arrived with nothing moving).
   */
  constructor({ renderer, scene, geometry: g, rig, element, lamp, stage = null }) {
    this.renderer = renderer; this.scene = scene; this.el = element; this.lamp = lamp;
    this.motion = stage?.motion ?? null;
    this.maxScale = stage?.tierSettings?.headScale ?? 2;
    this.cache = new PassCache(REFRESH_FRAMES);
    this.cameraWatch = new CameraWatch();
    this.draws = 0;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType, depthBuffer: true });
    this.camera = new THREE.PerspectiveCamera(20, 1.45, 0.02, 0.9);
    this.camera.layers.set(0);    // looks past the enclosure
    const n = new THREE.Vector3().fromArray(g.printNormal);
    this.P = new THREE.Vector3().fromArray(g.printPoint);
    this.n = n;
    this.up = new THREE.Vector3(0, n.z, -n.y).normalize();
    this.camera.up.copy(this.up);
    this.camera.near = NEAR;      // the bars and keys between here and the platen are cut away
    this.bailAbovePx = 0;
    this.frameView(REF_HEIGHT_PX);
    this.bailAbovePx = this.projectedRisePx(new THREE.Vector3().fromArray(rig.bail.bar));
    this.frameView(REF_HEIGHT_PX);
    const up = this.up;
    // The inset gets a small lamp of its own: the rim light, re-aimed along this view for this one render.
    this.lampDir = n.clone().multiplyScalar(0.8).addScaledVector(up, 0.42).add(new THREE.Vector3(-0.28, 0, 0)).normalize();
    this.output = new OutputPass();
    this.output.renderToScreen = true;
    this._size = new THREE.Vector2();
  }

  /**
   * Fixed scale on the sheet, so a bigger window shows more of the sheet and not bigger letters. The line in progress
   * comes first. As the window gets taller the bail comes in along the top edge, then the line settles a set distance
   * above the bottom and the rest of the height shows the sheet above the bail.
   */
  frameView(heightPx) {
    const { camera, P, n, up } = this;
    const halfTan = Math.tan(THREE.MathUtils.degToRad(REF_FOV / 2)) * heightPx / REF_HEIGHT_PX;
    camera.fov = THREE.MathUtils.radToDeg(Math.atan(halfTan)) * 2;
    const mPerPx = 2 * Math.hypot(DISTANCE, TILT) * Math.tan(THREE.MathUtils.degToRad(REF_FOV / 2)) / REF_HEIGHT_PX;
    const lineAboveBottom = Math.min(LINE_ABOVE_BOTTOM_PX, Math.max(heightPx / 3, heightPx - BAIL_BELOW_TOP_PX - this.bailAbovePx));
    const lift = (heightPx / 2 - lineAboveBottom) * mPerPx;
    camera.position.copy(P).addScaledVector(n, DISTANCE).addScaledVector(up, TILT + lift);
    camera.lookAt(P.clone().addScaledVector(up, lift));
    camera.updateProjectionMatrix();
  }

  /** How far above the print point a point appears, in window pixels at the reference height. */
  projectedRisePx(point) {
    const c = this.camera;
    c.updateMatrixWorld();
    const y = (v) => v.clone().project(c).y;
    return (y(point) - y(this.P)) * REF_HEIGHT_PX / 2;
  }

  render() {
    const { renderer, el, camera, rt } = this;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    // A pixel budget, so a very wide window stays sharp, and no more than the display's own pixels or 1.5 (2 at most,
    // 1.5 on a phone): 4x MSAA on top of that is enough for the ink.
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const scale = Math.min(this.maxScale, Math.max(dpr, 1.5), Math.sqrt(1.2e6 / (r.width * r.height)));
    const w = Math.round(r.width * scale), h = Math.round(r.height * scale);
    let resized = false;
    if (rt.width !== w || rt.height !== h) {
      rt.setSize(w, h);
      camera.aspect = w / h;
      this.frameView(r.height);
      resized = true;
    }
    camera.position.x = this.P.x + (this.followX?.() ?? 0);
    camera.updateMatrixWorld();
    const m = this.motion;
    const moved = this.cameraWatch.changed(camera);
    if (!m || this.cache.stale(m.lookGen, m.frame, moved || resized)) {
      this.drawScene();
      this.draws++;
      if (m) this.cache.drawn(m.lookGen, m.frame);
    }
    this.composite(r);
  }

  /** Something it shows changed without moving (ink on the sheet): draw it again next frame. */
  invalidate() { this.cache.invalidate(); }

  drawScene() {
    const { renderer, camera, rt } = this;
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.beforeRender?.(camera);   // view-space uniforms are set for the main camera
    const lamp = this.lamp;
    const lampPos = lamp.position.clone(), lampI = lamp.intensity;
    lamp.position.copy(this.lampDir).multiplyScalar(2).add(lamp.target.position);
    lamp.intensity = 1.6;
    lamp.updateMatrixWorld();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(this.scene, camera);
    lamp.position.copy(lampPos); lamp.intensity = lampI; lamp.updateMatrixWorld();
    renderer.shadowMap.autoUpdate = auto;
  }

  /** The kept image, tone mapped into its rectangle of the canvas: every frame, as the canvas is drawn afresh. */
  composite(r) {
    const { renderer, rt } = this;
    renderer.getSize(this._size);
    const y = this._size.y - r.bottom;
    renderer.setRenderTarget(null);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setScissorTest(true);
    const exposure = renderer.toneMappingExposure;
    this.output.render(renderer, null, rt);
    renderer.toneMappingExposure = exposure;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this._size.x, this._size.y);
  }
}
