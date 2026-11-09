// Inertial orbit camera with clamped polar angle and radius, wheel and pinch zoom toward the pointer, and a pan clamped
// so the machine stays in view.
import * as THREE from 'three';

// Machine's extent about the default target (m), carriage travel included.
const MACHINE_HALF = { across: 0.25, up: 0.15, depth: 0.2 };
const KEEP_IN_VIEW = 0.7;    // zoomed out, the machine's centre stays within this fraction of a half-screen

const GLIDE_LEFT_AFTER_1S = 1e-9;          // how much of a released drag's speed survives a second: stops within a few frames

export class Orbit {
  constructor(camera, element, target = [-0.0557, 0.1262, -0.0124]) {
    this.camera = camera; this.el = element;
    this.target = new THREE.Vector3().fromArray(target);
    const off = camera.position.clone().sub(this.target);
    this.radius = off.length();
    this.theta = Math.atan2(off.x, off.z);
    this.phi = Math.acos(off.y / this.radius);
    this.vTheta = 0; this.vPhi = 0;
    this._right = new THREE.Vector3(); this._forward = new THREE.Vector3(); this._up = new THREE.Vector3(); this._off = new THREE.Vector3();
    this.limits = { phiMin: 0.18, phiMax: 1.45, rMin: 0.09, rMax: Math.max(1.2, this.radius * 1.15) };
    this.home = { target: this.target.clone(), radius: this.radius, theta: this.theta, phi: this.phi };
    this.apply();
  }

  /** The default framing. */
  reset() {
    const h = this.home;
    this.target.copy(h.target);
    this.radius = h.radius; this.theta = h.theta; this.phi = h.phi;
    this.vTheta = 0; this.vPhi = 0;
    this.apply();
  }

  /** Moves the view by a pointer drag in pixels, so the scene follows the pointer at the depth of the target. */
  pan(dxPx, dyPx) {
    const c = this.camera;
    const halfH = this.radius * Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
    const mPerPx = 2 * halfH / this.el.clientHeight;
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    const forward = this.target.clone().sub(c.position).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    this.target.addScaledVector(right, -dxPx * mPerPx).addScaledVector(up, dyPx * mPerPx);
    this.apply();
  }

  /**
   * The farther out the view, the farther the target may go, measured along the screen's own axes so some of the
   * machine is on screen from every direction.
   */
  clampTarget() {
    const c = this.camera;
    const halfH = this.radius * Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
    const halfW = halfH * c.aspect;
    const s = Math.sin(this.phi);
    const right = this._right.set(Math.cos(this.theta), 0, -Math.sin(this.theta));
    const forward = this._forward.set(-s * Math.sin(this.theta), -Math.cos(this.phi), -s * Math.cos(this.theta));
    const up = this._up.crossVectors(right, forward);
    const off = this._off.copy(this.target).sub(this.home.target);
    const lim = (v, reach) => THREE.MathUtils.clamp(v, -reach, reach);
    const a = lim(off.dot(right), Math.max(MACHINE_HALF.across, KEEP_IN_VIEW * halfW));
    const b = lim(off.dot(up), Math.max(MACHINE_HALF.up, KEEP_IN_VIEW * halfH));
    const d = lim(off.dot(forward), MACHINE_HALF.depth);
    this.target.copy(this.home.target).addScaledVector(right, a).addScaledVector(up, b).addScaledVector(forward, d);
  }

  rotate(dx, dy) {
    const f = 0.0058;
    this.vTheta = -dx * f; this.vPhi = -dy * f;
    this.theta += this.vTheta; this.phi += this.vPhi; this.clamp();
  }

  zoom(factor, ndcX, ndcY) {
    const c = this.camera;
    const before = this.radius;
    this.radius = THREE.MathUtils.clamp(this.radius * factor, this.limits.rMin, this.limits.rMax);
    if (ndcX !== undefined) {
      // Slide the orbit target toward the point under the cursor on the target's plane.
      const dir = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(c).sub(c.position).normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(c.getWorldDirection(new THREE.Vector3()), this.target);
      const hit = new THREE.Ray(c.position, dir).intersectPlane(plane, new THREE.Vector3());
      if (hit) this.target.lerp(hit, 1 - this.radius / before);
    }
    this.apply();
  }

  clamp() {
    this.phi = THREE.MathUtils.clamp(this.phi, this.limits.phiMin, this.limits.phiMax);
  }

  update(dt) {
    const k = Math.pow(GLIDE_LEFT_AFTER_1S, dt);
    if (this.dragging) { this.vTheta *= k; this.vPhi *= k; return this; }   // holding still before letting go leaves nothing to glide on
    if (Math.abs(this.vTheta) > 1e-4 || Math.abs(this.vPhi) > 1e-4) {
      this.vTheta *= k; this.vPhi *= k;
      this.theta += this.vTheta; this.phi += this.vPhi; this.clamp();
      this.apply();
    }
    return this;
  }

  apply() {
    this.clampTarget();
    const s = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * s * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * s * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }
}
