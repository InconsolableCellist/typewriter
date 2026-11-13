// What changed since the last frame, for the passes that can keep last frame's result (docs/perf-review.md,
// recommendation 17): the shadow maps, the AO prepass and the Print Point view. Each is redrawn only when its inputs
// moved. Two kinds of evidence, either of which is enough:
//  - the scene itself: one walk over the drawn objects a frame compares every shadow caster and AO occluder (world
//    matrix, geometry, dynamic vertex and instance buffers, visibility) and every light (transform, shadow frustum)
//    against their state when the caches were last drawn; separately the lighting and materials, for the Print Point;
//  - explicit marks from the kits: the mechanism's degrees of freedom, the paper awake, a grab or a drag, the room's
//    easing (SceneMotion.observe).
// Errs toward redrawing: anything unknown counts as moved, slow drift is compared against the last drawn state (so it
// cannot creep by in steps under the tolerance), and every cache is redrawn at least every REFRESH_FRAMES regardless.

export const POS_TOL = 1e-6;        // m or rad per frame, on the mechanism's coordinates
export const VEL_TOL = 1e-3;        // m/s or rad/s: 16 um a frame at 60 Hz, far under a shadow texel (0.7 mm)
export const SCENE_EPS = 1e-6;      // on world matrices (m, and unitless rotation) and vertex positions (m)
export const LOOK_EPS = 1e-5;       // on light intensities, colours and the room's levels
export const REFRESH_FRAMES = 120;  // the shadow maps and the AO are redrawn at least this often whatever the evidence

// Snapshot fields that move nothing that is drawn: clocks, meters, electrical state, and the spinning motors, fans and
// diskettes inside closed cases. Everything else in a layout counts.
const QUIET = new Set([
  'time', 'dspLoad', 'rms', 'lastForce', 'fifo', 'leds', 'digits', 'mainspringN',
  'motorOmega', 'motorOn', 'clutchOn', 'interposerKey', 'selectedKey', 'returnLatched', 'tabLatched',
  'fanOmega', 'printerFan', 'diskOmega', 'diskAngle', 'diskReady', 'headTrack', 'headLoad', 'clamp', 'power', 'printerPower',
]);
const isRate = (name) => /(V|Omega)$/.test(name);

/** A layout (name -> offset, plus length) as spans [{ name, at, n }] in offset order. */
export function layoutFields(L) {
  const e = Object.entries(L).filter(([k, v]) => k !== 'length' && Number.isInteger(v)).sort((a, b) => a[1] - b[1]);
  return e.map(([name, at], i) => ({ name, at, n: (i + 1 < e.length ? e[i + 1][1] : L.length) - at }));
}

/** Whether the mechanism moves: any rate above VEL_TOL, or any drawn coordinate that changed by more than POS_TOL. */
export class MechanismWatch {
  constructor() { this.layout = null; this.fields = null; this.prev = null; }

  moving(state, layout) {
    if (!state || !layout) return false;
    if (layout !== this.layout) { this.layout = layout; this.fields = layoutFields(layout); this.prev = null; }
    const prev = this.prev && this.prev.length === state.length ? this.prev : null;
    let moving = !prev;
    for (const f of this.fields) {
      if (moving) break;
      if (QUIET.has(f.name)) continue;
      const end = Math.min(state.length, f.at + f.n);
      if (isRate(f.name)) { for (let i = f.at; i < end; i++) if (!(Math.abs(state[i]) <= VEL_TOL)) { moving = true; break; } }
      else for (let i = f.at; i < end; i++) if (!(Math.abs(state[i] - prev[i]) <= POS_TOL)) { moving = true; break; }
    }
    if (!prev) this.prev = new Float32Array(state.length);
    this.prev.set(state);
    return moving;
  }
}

/** Drawn and solid: what the AO G-buffer holds. Points, lines, sprites, transparent and noAO objects are not. */
export function isDrawnOpaque(o) {
  if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO) return false;
  const m = o.material;
  if (!m) return true;
  const one = (x) => x.visible && !x.transparent && x.depthWrite !== false;
  return Array.isArray(m) ? m.some(one) : one(m);
}

/** A growable list of numbers, compared against a snapshot. */
class Tape {
  constructor() { this.a = new Float64Array(1024); this.n = 0; }
  reset() { this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  pushArray(arr) { for (let i = 0; i < arr.length; i++) this.push(arr[i]); }
  /** True when this differs from `snap` (another Tape) beyond eps; on a difference the snapshot takes this one's values. */
  differsFrom(snap, eps) {
    let differs = this.n !== snap.n;
    if (!differs) {
      const a = this.a, b = snap.a;   // equal (Infinity, a draw range to the end) or within eps; NaN always differs
      for (let i = 0; i < this.n; i++) if (a[i] !== b[i] && !(Math.abs(a[i] - b[i]) <= eps)) { differs = true; break; }
    }
    if (differs) { if (snap.a.length < this.n) snap.a = new Float64Array(this.a.length); snap.a.set(this.a.subarray(0, this.n)); snap.n = this.n; }
    return differs;
  }
}

const sameList = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/**
 * Fingerprints the drawn scene once a frame. check() returns { geometry, appearance }: whether anything that the
 * shadow maps or the AO see moved, and whether the lighting or the materials changed, each against the state when it
 * last reported a change. `visit(mesh)` is called for every visible mesh on the way (the look's material patching).
 */
export class SceneWatch {
  constructor(scene, { extraLook = null } = {}) {
    this.scene = scene; this.extraLook = extraLook;
    this.geo = new Tape(); this.geoSnap = new Tape();
    this.look = new Tape(); this.lookSnap = new Tape();
    this.objs = []; this.objsSnap = [];
    this.buffers = new WeakMap();   // dynamic array -> { version, copy } at the last change
    this.lights = [];               // the visible shadow-casting lights, from the last walk
    this._bufChanged = false;
  }

  /** A buffer that may be rewritten in place: compared by content when its version moves. */
  _buffer(owner, array, version) {
    if (!array) return;
    let rec = this.buffers.get(owner);
    if (!rec || rec.copy.length !== array.length) {
      this.buffers.set(owner, { version, copy: Float32Array.from(array) });
      this._bufChanged = true;
      return;
    }
    if (rec.version === version) return;
    rec.version = version;
    const c = rec.copy;
    for (let i = 0; i < array.length; i++) {
      if (!(Math.abs(array[i] - c[i]) <= SCENE_EPS)) { c.set(array); this._bufChanged = true; return; }
    }
  }

  _mesh(o, geo) {
    this.objs.push(o);
    geo.pushArray(o.matrixWorld.elements);
    geo.push(o.castShadow ? 1 : 0);
    const g = o.geometry;
    if (g) {
      geo.push(g.id); geo.push(g.drawRange.start); geo.push(g.drawRange.count);
      const p = g.attributes.position;
      if (p) {
        const src = p.isInterleavedBufferAttribute ? p.data : p;
        this._buffer(src, src.array, src.version);
      }
      if (g.index) geo.push(g.index.version);
    }
    if (o.isInstancedMesh) { geo.push(o.count); this._buffer(o.instanceMatrix, o.instanceMatrix.array, o.instanceMatrix.version); }
    if (o.isBatchedMesh) {
      const t = o._matricesTexture;
      if (t) this._buffer(t, t.image.data, t.version); else geo.push(NaN);   // unknown internals: always changed
      geo.push(o._multiDrawCount ?? 0);
    }
  }

  _light(o, geo, look) {
    geo.pushArray(o.matrixWorld.elements);
    look.push(o.intensity); look.push(o.color.r); look.push(o.color.g); look.push(o.color.b);
    if (o.isSpotLight) { look.push(o.angle); look.push(o.penumbra); look.push(o.distance); look.push(o.decay); }
    if (o.castShadow && o.shadow) {
      this.lights.push(o);
      const s = o.shadow, c = s.camera;
      geo.push(s.mapSize.x); geo.push(s.mapSize.y);
      if (o.isSpotLight) { geo.push(o.angle); geo.push(o.distance); geo.push(s.focus); }
      if (c.isOrthographicCamera) { geo.push(c.left); geo.push(c.right); geo.push(c.top); geo.push(c.bottom); }
      geo.push(c.near); geo.push(c.far);
      if (o.target) geo.pushArray(o.target.matrixWorld.elements);
      look.push(s.intensity ?? 1);
    }
  }

  check(visit = null) {
    const { scene, geo, look } = this;
    geo.reset(); look.reset(); this.objs.length = 0; this.lights.length = 0; this._bufChanged = false;
    if (scene.matrixWorldAutoUpdate !== false) scene.updateMatrixWorld();
    const walk = (o) => {
      if (!o.visible) return;
      if (o.isLight) this._light(o, geo, look);
      else if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
        if (o.isMesh) visit?.(o);
        if (o.castShadow || (o.isMesh && isDrawnOpaque(o))) this._mesh(o, geo);
        const m = o.material;
        if (m) for (const x of Array.isArray(m) ? m : [m]) { look.push(x.id); look.push(x.version); }
      }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) walk(ch[i]);
    };
    walk(scene);
    // The room: the image-based light, the backdrop, and whatever else the caller watches (the look's uniforms).
    look.push(scene.environment?.id ?? -1); look.push(scene.environmentIntensity ?? 1); look.push(scene.environmentRotation?.y ?? 0);
    look.push(scene.background?.id ?? (scene.background?.isColor ? scene.background.getHex() : -1));
    look.push(scene.backgroundIntensity ?? 1); look.push(scene.backgroundBlurriness ?? 0);
    this.extraLook?.(look);
    const listChanged = !sameList(this.objs, this.objsSnap);
    if (listChanged) { this.objsSnap.length = 0; this.objsSnap.push(...this.objs); }
    const geometry = geo.differsFrom(this.geoSnap, SCENE_EPS) || listChanged || this._bufChanged;
    const appearance = look.differsFrom(this.lookSnap, LOOK_EPS);
    return { geometry, appearance };
  }
}

/** A camera's view and projection, against the last time it reported a change. */
export class CameraWatch {
  constructor() { this.tape = new Tape(); this.snap = new Tape(); }
  changed(camera) {
    const t = this.tape; t.reset();
    t.pushArray(camera.matrixWorld.elements); t.pushArray(camera.projectionMatrix.elements);
    return t.differsFrom(this.snap, SCENE_EPS);
  }
}

/**
 * The frame's verdict: `geomGen` counts frames in which something a shadow map or the AO sees moved, `lookGen` frames
 * in which anything drawn changed at all (both include the explicit marks). Passes remember the generation they drew.
 */
export class SceneMotion {
  constructor(scene, opts) {
    this.watch = new SceneWatch(scene, opts);
    this.mech = new MechanismWatch();
    this.geomGen = 0; this.lookGen = 0; this.frame = 0;
    this._mark = false; this._markLook = false;
    this.shadow = new WeakMap();   // light -> { managed, drawn, at, asked }
    this.lastReason = '';
  }

  /** Something moved this frame (the shadow maps, AO and Print Point are redrawn). */
  mark() { this._mark = true; }
  /** Something drawn changed its look but not its shape (the Print Point is redrawn, not the shadows or the AO). */
  markLook() { this._markLook = true; }

  /**
   * The kits' evidence, once a frame before rendering: the mechanism snapshot, the soft world (its paper awake),
   * whether anything is held or dragged, whether the room is easing, and the CRT spill's level (`glow`). Returns
   * whether it counted as moved.
   */
  observe({ state = null, layout = null, soft = null, grabbing = false, easing = false, glow = null } = {}) {
    // A light that changes without moving anything (the CRT's spill): only the Print Point cares.
    if (glow !== null) { if (!(Math.abs(glow - (this._glow ?? NaN)) <= 1e-4)) this._markLook = true; this._glow = glow; }
    const mech = this.mech.moving(state, layout);
    const paper = soft ? (soft.paperSim ? !soft.paperSim.asleep && !soft.sheetParked : true) : false;
    const moved = mech || paper || !!grabbing || !!easing;
    if (moved) { this._mark = true; this.lastReason = mech ? 'mechanism' : paper ? 'paper' : grabbing ? 'grab' : 'room'; }
    return moved;
  }

  /** Once a frame, before the first render that uses a cache. */
  update(visit) {
    const { geometry, appearance } = this.watch.check(visit);
    this.frame++;
    if (geometry || this._mark) this.geomGen++;
    if (geometry || appearance || this._mark || this._markLook) this.lookGen++;
    if (geometry && !this._mark) this.lastReason = 'scene';
    const out = { geometry: geometry || this._mark, appearance: appearance || this._markLook };
    this._mark = this._markLook = false;
    return out;
  }

  /**
   * Sets each shadow-casting light's needsUpdate for this frame, and returns whether any map is to be drawn (the
   * renderer's shadowMap.needsUpdate; its autoUpdate stays off). A light found with autoUpdate on is taken over: its
   * map is drawn whenever it is out of date. A light whose owner throttles it (autoUpdate off, needsUpdate set every
   * few frames) keeps its throttle, but a request is dropped while its map is still current.
   */
  scheduleShadows() {
    let any = false;
    for (const light of this.watch.lights) {
      const s = light.shadow;
      let st = this.shadow.get(light);
      if (!st) { st = { managed: s.autoUpdate !== false, drawn: -1, at: -Infinity, asked: false }; this.shadow.set(light, st); s.autoUpdate = false; }
      const stale = st.drawn !== this.geomGen || !s.map || (st.managed && this.frame - st.at >= REFRESH_FRAMES);
      if (st.managed) s.needsUpdate = stale;
      else if (s.needsUpdate && !stale) s.needsUpdate = false;
      st.asked = s.needsUpdate;
      any ||= s.needsUpdate;
    }
    return any;
  }

  /** After the render that drew the maps: three clears needsUpdate on each one it drew. */
  shadowsDrawn() {
    for (const light of this.watch.lights) {
      const st = this.shadow.get(light);
      if (st?.asked && !light.shadow.needsUpdate) { st.drawn = this.geomGen; st.at = this.frame; st.asked = false; }
    }
  }
}

/** One cached pass: stale when its generation moved, when asked, or when it has not been drawn for `refresh` frames. */
export class PassCache {
  constructor(refresh = REFRESH_FRAMES) { this.gen = -1; this.at = -Infinity; this.refresh = refresh; this.invalid = true; }
  invalidate() { this.invalid = true; }
  stale(gen, frame, extra = false) { return this.invalid || extra || gen !== this.gen || frame - this.at >= this.refresh; }
  drawn(gen, frame) { this.gen = gen; this.at = frame; this.invalid = false; }
}
