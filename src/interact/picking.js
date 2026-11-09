// Pointer picking over proxy geometry, and the geometric projections used for joint-constrained drags.
import * as THREE from 'three';

export const _ray = new THREE.Raycaster();

export class Picker {
  constructor(camera, pickables) { this.camera = camera; this.list = pickables; this.objects = pickables.map((p) => p.object); this.byObj = new Map(pickables.map((p) => [p.object, p])); this.ndc = new THREE.Vector2(); this.ray = new THREE.Raycaster(); this.ray.layers.enableAll(); }

  add(entry) { this.list.push(entry); this.objects.push(entry.object); this.byObj.set(entry.object, entry); }

  rayAt(ndcX, ndcY) {
    this.ndc.set(ndcX, ndcY);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray;
  }

  pick(ndcX, ndcY) {
    this.rayAt(ndcX, ndcY);
    this.ray.params.Mesh = { threshold: 0 };
    const hits = this.ray.intersectObjects(this.objects, false);
    // Layer 1 holds the enclosure, which blocks picks while it is showing.
    let h = hits.find((x) => this.byObj.get(x.object)?.enabled?.() !== false);
    if (!h) return null;
    // The carriage's broad body handles must not shadow small parts mounted on it.
    if (this.byObj.get(h.object)?.low) {
      const fine = hits.find((x) => !this.byObj.get(x.object)?.low && this.byObj.get(x.object)?.enabled?.() !== false && x.distance - h.distance < 0.05);
      if (fine) h = fine;
    }
    // A raised typebar (a jam, usually) sits among the ribbon and carriage; let it win over them so it can be pulled free.
    if (this.byObj.get(h.object)?.part(h.instanceId, h)) {
      const raised = hits.find((x) => this.byObj.get(x.object)?.raised?.(x.instanceId) && x.distance - h.distance < 0.12);
      if (raised) h = raised;
    }
    const entry = this.byObj.get(h.object);
    if (!entry) return null;
    const part = entry.part(h.instanceId, h);
    if (!part) return null;
    return { part, point: h.point.clone(), hit: h };
  }
}

/** Parameter along infinite line (o + u t) nearest to the ray. */
export function lineParamNearest(ray, o, u) {
  const w0 = new THREE.Vector3().subVectors(o, ray.origin);
  const a = u.dot(u), b = u.dot(ray.direction), c = ray.direction.dot(ray.direction);
  const d = u.dot(w0), e = ray.direction.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-8) return 0;
  return (b * e - c * d) / den;
}

/** Point where ray meets plane through p with normal n, or null. */
export function rayPlane(ray, p, n, out = new THREE.Vector3()) {
  const den = ray.direction.dot(n);
  if (Math.abs(den) < 1e-5) return null;
  const t = new THREE.Vector3().subVectors(p, ray.origin).dot(n) / den;
  if (t < 0) return null;
  return out.copy(ray.direction).multiplyScalar(t).add(ray.origin);
}

/** Signed angle of point around axis through centre, measured from ref. */
export function angleAround(point, centre, axis, ref) {
  const v = new THREE.Vector3().subVectors(point, centre);
  v.addScaledVector(axis, -v.dot(axis));
  const y = new THREE.Vector3().crossVectors(axis, ref);
  return Math.atan2(v.dot(y), v.dot(ref));
}

/**
 * Where the ray meets a cylinder (axis through c along a, radius r), picking the entry point; used so
 * that a knob turns under the cursor even when seen end-on. Falls back to null when the ray misses.
 */
export function rayCylinder(ray, c, a, r) {
  const d = ray.direction.clone().addScaledVector(a, -ray.direction.dot(a));
  const m = new THREE.Vector3().subVectors(ray.origin, c);
  const mp = m.clone().addScaledVector(a, -m.dot(a));
  const A = d.dot(d), B = 2 * d.dot(mp), C = mp.dot(mp) - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A < 1e-10) return null;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t < 0) return null;
  return ray.direction.clone().multiplyScalar(t).add(ray.origin);
}
