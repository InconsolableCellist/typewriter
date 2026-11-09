// SoftWorld: paper and ribbon soft bodies, main thread. See docs/ARCHITECTURE.md for the contract.
import { makeLayout } from '../sim/layout.js';
import { PaperSim } from './paper.js';
import { RibbonSim } from './ribbon.js';
import { Printer } from './print.js';
import { withGlyphApi } from '../machine/glyphs.js';
import { captureSheet } from '../pages/capture.js';

const SUBSTEP = 1 / 480;
const MAX_SUBSTEPS_PER_STEP = 14;

export class SoftWorld {
  /** Update a machine parameter by dotted path; the sim's worklet holds its own copy of the machine. */
  setParam(path, value) {
    const keys = path.split('.');
    let o = this.m;
    for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]]; if (o === undefined) return false; }
    o[keys[keys.length - 1]] = value;
    return true;
  }

  constructor({ machine, geometry, glyphs: rawGlyphs, paperGrid, pose } = {}) {
    this.fixedPlaten = !!machine.action?.fixedPlaten;
    const glyphs = withGlyphApi(rawGlyphs);
    this.m = machine; this.geo = geometry; this.glyphs = glyphs;
    this.paperSim = new PaperSim(machine, { ...paperGrid, pose });
    this.ribbonSim = new RibbonSim(machine, geometry);
    this.printer = new Printer(machine, geometry, glyphs, this.paperSim, this.ribbonSim);

    this.paper = {
      positions: this.paperSim.positions, uvs: this.paperSim.uvs, indices: this.paperSim.indices,
      nx: this.paperSim.nx, ny: this.paperSim.ny, normalsDirty: true,
    };
    this.ribbon = {
      positions: this.ribbonSim.positions, up: this.ribbonSim.up, count: this.ribbonSim.N,
      spoolL: this.ribbonSim.spoolL, spoolR: this.ribbonSim.spoolR,
    };
    this.inkTexture = this.printer.inkTexture;
    this.colorMask = this.printer.colorMask;
    this.platenInkTexture = this.printer.platenInk;
    this.layout = null;
    this.time = 0;
    this.acc = 0;
    this.prevState = null;
    this.frame = null;
    this.stats = { lastMs: 0, avgMs: 0, frames: 0, substeps: 0 };

    this.ribbonTexture = this._makeRibbonWindow();
    this._grabKinds = new Map();
    this._nextGrabId = 1;
    this.inkDirty = true;
  }

  // ---- step
  step(dt, state, layout) {
    const L = layout ?? this.layout ?? makeLayout(this.geo);
    this.layout = L;
    const t0 = performance.now();
    const cur = this._readState(state, L);
    const prev = this.prevState ?? cur;
    if (dt <= 0) { this.prevState = cur; this.frame = this._frame(prev, cur, 1, 0, 0); this._syncAll(); return; }
    this.acc += dt;
    let nsub = Math.floor(this.acc / SUBSTEP + 1e-9);
    this.acc -= nsub * SUBSTEP;
    if (nsub > MAX_SUBSTEPS_PER_STEP) { nsub = MAX_SUBSTEPS_PER_STEP; this.acc = 0; }
    if (nsub > 0) {
      let f0 = this._frame(prev, cur, 0, 0, 0);
      for (let k = 1; k <= nsub; k++) {
        const f = this._frame(prev, cur, k / nsub, nsub, dt);
        f.dcx = f.cx - f0.cx; f.dcy = f.cy - f0.cy;
        if (this.fixedPlaten) { this.paperSim.shiftFrame(f.dcx); f.dcx = 0; this.paperSim.bodyShift = f.cx - this.m.platen.center[0]; }
        f.omega = (f.psi - f0.psi) / SUBSTEP;
        this.paperSim.substep(SUBSTEP, f);
        this.ribbonSim.substep(SUBSTEP, f);
        f0 = f;
      }
      this.frame = f0;
      this.prevState = cur;
    } else {
      this.frame = this.frame ?? this._frame(prev, cur, 1, 0, 0);
    }
    this._syncAll();
    this.time += dt;
    const ms = performance.now() - t0;
    this.stats.lastMs = ms;
    this.stats.frames++;
    this.stats.substeps += nsub;
    this.stats.avgMs += (ms - this.stats.avgMs) * 0.05;
  }

  _readState(s, L) {
    return {
      time: s[L.time], carriageX: s[L.carriageX], shiftY: s[L.shiftY], psi: s[L.platenPsi],
      vibratorLift: s[L.vibratorLift], pawlTravel: s[L.ribbonPawlTravel], selector: s[L.ribbonSelector],
      paperRelease: s[L.paperRelease], bail: s[L.bail],
    };
  }

  _frame(a, b, t, nsub, dt) {
    const m = this.m;
    const c = m.platen.center;
    const lerp = (x, y) => x + (y - x) * t;
    const carriageX = lerp(a.carriageX, b.carriageX);
    const shiftY = lerp(a.shiftY, b.shiftY);
    const psi = lerp(a.psi, b.psi);
    const lift = lerp(a.vibratorLift, b.vibratorLift);
    const release = lerp(a.paperRelease, b.paperRelease);
    const bailDof = lerp(a.bail, b.bail);
    const selector = lerp(a.selector, b.selector);
    const p = m.paper;
    const f = {
      cx: c[0] + carriageX, cy: c[1] + shiftY, cz: c[2], psi, omega: 0, dcx: 0, dcy: 0,
      nipFactor: Math.max(0, 1 - release / p.nipOpenAt),
      bailFactor: Math.max(0, 1 - bailDof / p.bailLiftAt),
      lift, pawlTravel: lerp(a.pawlTravel, b.pawlTravel), selector,
      carriageX, shiftY,
    };
    this.platenAxis = { x: f.cx, y: f.cy, z: f.cz };
    f.fork = this._forkAt(lift, selector, shiftY);
    return f;
  }

  /** Fork centre for a vibrator lift (m) and selector, world coordinates. */
  _forkAt(lift, selector, shiftY = 0) {
    const g = this.geo, r = this.m.ribbon;
    const n = g.printNormal, w = g.strikeDown;
    const off = r.vibrator.restDrop - lift;
    // The mechanism picks a band by how far it lifts (0.72 of full lift for upper, full for lower, none
    // for stencil). That travel alone is half a band short, so the selector also seats the ribbon higher in
    // the fork for the lower band, so each detent brings one band's centre to the strike line.
    const sel = selector ?? 0;
    const bandShift = (sel <= 0.35 ? sel / 0.35 : Math.max(0, (0.7 - sel) / 0.35)) * (r.width / 4);
    const tUp = this.ribbonSim.T_up;
    // The vibrator rides the shifting carriage section, so the ribbon stays at the active glyph when shifted.
    return [
      g.printPoint[0] + n[0] * r.standoff + w[0] * off + tUp[0] * bandShift,
      g.printPoint[1] + n[1] * r.standoff + w[1] * off + tUp[1] * bandShift + shiftY,
      g.printPoint[2] + n[2] * r.standoff + w[2] * off + tUp[2] * bandShift,
    ];
  }

  _syncAll() {
    this.paperSim.syncPositions();
    this.paper.normalsDirty = true;
    this.ribbonSim.sync();
    this._refreshRibbonWindow();
  }

  // ---- env and readouts
  /** Derived from the sheet and ribbon's actual geometry at the print point. */
  env() {
    const m = this.m, geo = this.geo;
    const f = this.frame ?? this._frame(this.prevState ?? { carriageX: 0, shiftY: 0, psi: 0, vibratorLift: 0, pawlTravel: 0, selector: 0, paperRelease: 0, bail: 0 }, this.prevState ?? { carriageX: 0, shiftY: 0, psi: 0, vibratorLift: 0, pawlTravel: 0, selector: 0, paperRelease: 0, bail: 0 }, 1, 0, 0);
    const o = geo.printPoint;
    const n = geo.printNormal;
    const up = 0.006;
    const hit = this.printer.raycast(o[0] + n[0] * up, o[1] + n[1] * up, o[2] + n[2] * up, -n[0], -n[1], -n[2]);
    const paperPresent = hit && hit.u >= 0 && hit.u <= m.paper.width && hit.v >= 0 && hit.v <= m.paper.height ? 1 : 0;

    // Ribbon coverage: how much of the glyph window the ribbon would cover at full lift.
    const R = this.ribbonSim;
    const q = R.queryAt(o[0], o);
    let cover = 0;
    if (q && Math.abs(q.nOff) < 0.012) {
      const forkNow = this._forkOffsetUp(f, f.fork);
      const caught = Math.abs(q.up - forkNow) < 0.0025;
      const sel = f.selector ?? 0, L = m.ribbon.vibrator.fullLift;
      const fullFork = this._forkAt(sel <= 0.175 ? (m.ribbon.vibrator.upperBandFraction ?? 0.72) * L : sel <= 0.525 ? L : 0, sel, f.shiftY ?? 0);
      const atFull = this._forkOffsetUp(f, fullFork);
      const rc = caught ? atFull : q.up;
      const halfW = R.W / 2;
      const lo = rc - halfW, hi = rc + halfW;
      const winLo = -0.0034 + (f.shiftY ?? 0), winHi = 0.0034 + (f.shiftY ?? 0);   // the part of the slug that can print
      cover = Math.max(0, Math.min(hi, winHi) - Math.max(lo, winLo)) / (winHi - winLo);
    }
    return {
      paperCaliperM: paperPresent ? m.paper.thickness : 0,
      ribbonCaliperM: cover > 0 ? m.ribbon.thickness : 0,
      ribbonInGap: cover,
      paperPresent,
      paperStrength: 1,
    };
  }

  _forkOffsetUp(f, fork) {
    const o = this.geo.printPoint, T = this.ribbonSim.T_up;
    return (fork[1] - o[1]) * T[1] + (fork[2] - o[2]) * T[2];
  }

  readouts() {
    const P = this.paperSim, R = this.ribbonSim, geo = this.geo, m = this.m;
    const f = this.frame ?? { cx: m.platen.center[0], cy: m.platen.center[1], cz: m.platen.center[2], psi: 0 };
    const sk = P.skewAngle(f);
    const mid = Math.floor(P.nx / 2) + Math.floor(P.ny / 2) * P.nx;
    const lateralMm = (P.x[mid] - f.cx) * 1000;
    const slack = R.Lf - (R.pathLen ?? R.Lf);
    const o = geo.printPoint;
    const q = R.queryAt(o[0], o);
    let inkAtPoint = 0;
    if (q) inkAtPoint = R.meanInk(q.s, 0, 0.003, 0.002);
    const uv = this._sheetPointAtPrint(f);
    return {
      skewDeg: sk ? (sk.angle * 180) / Math.PI : (this._worldSkew() * 180) / Math.PI,
      lateralMm,
      ribbonTensionN: R.tension,
      ribbonSlackMm: slack * 1000,
      inkAtPoint,
      paperAwake: !P.asleep,
      engagedParticles: P.nE,
      patches: P.gripSummary(),
      printU: uv ? uv.u : null,
      printV: uv ? uv.v : null,
      ribbonS: q ? q.s : null,
      lastStrike: this.printer.lastStrike,
      perforations: this.printer.perforations,
      handSlips: P.handSlips,
      stats: { ...this.stats },
    };
  }

  /** Sheet (u,v) currently at the home print point, or null when the sheet is not there. */
  _sheetPointAtPrint() {
    const o = this.geo.printPoint, n = this.geo.printNormal, up = 0.006;
    return this.printer.raycast(o[0] + n[0] * up, o[1] + n[1] * up, o[2] + n[2] * up, -n[0], -n[1], -n[2]);
  }

  _worldSkew() {
    const P = this.paperSim;
    const j = Math.floor(P.ny / 2);
    const a = j * P.nx, b = a + P.nx - 1;
    return Math.atan2(P.z[b] - P.z[a], P.x[b] - P.x[a]);
  }

  // ---- strike
  applyStrike(evt) {
    const f = this.frame;
    const F = f && {
      psi: f.psi, cx: f.cx,
      forkOffsetNow: this._forkOffsetUp(f, f.fork),
      forkOffsetAt: (lift) => this._forkOffsetUp(f, this._forkAt(lift, f.selector, f.shiftY ?? 0)),
    };
    const out = this.printer.apply(evt, F);
    if (evt.unlimited) this.ribbonSim.feedForStrike();
    this.ribbonSim.windowDirty = true;
    return out;
  }

  /**
   * On a fixed-platen machine the soft bodies are solved in the moving carrier's frame, which keeps the print point and
   * ribbon where the printer expects them. Frame x = world x + carrierOffset. Zero on a moving-carriage machine.
   */
  get carrierOffset() { return this.fixedPlaten && this.frame ? this.frame.cx - this.m.platen.center[0] : 0; }

  _toFrame(point) { return [point[0] + this.carrierOffset, point[1], point[2]]; }

  // ---- interaction
  grabPaper(point) {
    const g = this.paperSim.grab(this._toFrame(point));
    if (g < 0) return -1;
    return this._registerGrab('paper', g);
  }

  grabRibbon(point) {
    const g = this.ribbonSim.grab(this._toFrame(point));
    if (g < 0) return -1;
    return this._registerGrab('ribbon', g);
  }

  grabSpool(side) { return this._registerGrab('spool', this.ribbonSim.grabSpool(side)); }

  _registerGrab(kind, inner) {
    const id = this._nextGrabId++;
    this._grabKinds.set(id, { kind, inner });
    return id;
  }

  moveGrab(id, target) {
    const g = this._grabKinds.get(id);
    if (!g) return;
    const inFrame = Array.isArray(target) ? this._toFrame(target) : target;
    if (g.kind === 'paper') this.paperSim.move(g.inner, inFrame);
    else this.ribbonSim.move(g.inner, inFrame);
  }

  release(id) {
    const g = this._grabKinds.get(id);
    if (!g) return;
    if (g.kind === 'paper') this.paperSim.release(g.inner);
    else this.ribbonSim.release(g.inner);
    this._grabKinds.delete(id);
  }

  /** A clean sheet on the paper table, ink cleared, ready to feed. Works from any state of the old sheet. */
  resetPaper() {
    for (const [id, g] of this._grabKinds) if (g.kind === 'paper') this._grabKinds.delete(id);
    this.spawnSheet({ onTable: { offset: 0.002 } });
  }

  /** The ribbon back to taut and threaded. Ink wear stays unless { fresh: true }. */
  resetRibbon(opts) {
    for (const [id, g] of this._grabKinds) if (g.kind === 'ribbon' || g.kind === 'spool') this._grabKinds.delete(id);
    this.ribbonSim.reset(opts);
    this.ribbonSim.sync();
  }

  /** The sheet leaves the machine: its page goes to the finished pile and nothing is left in its place until one is loaded. */
  parkSheet() {
    for (const [id, g] of this._grabKinds) if (g.kind === 'paper') this._grabKinds.delete(id);
    this.spawnSheet();
    this.sheetParked = true;
  }

  /** The sheet is destroyed where it stands: no page goes to the pile, and the machine is left empty. */
  destroySheet() {
    const retired = this.onSheetRetired;
    this.onSheetRetired = null;
    try { this.parkSheet(); } finally { this.onSheetRetired = retired; }
  }

  spawnSheet(pose) {
    this.sheetSerial = (this.sheetSerial ?? 0) + 1;   // anything keyed to one particular sheet can tell a new one has arrived
    this.sheetParked = false;
    if (this.frame) this.paperSim.lastFrame = this.frame;
    this.paperSim.spawn(pose);
    if (this.onSheetRetired) {   // the ink dies with the clear below
      const snapshot = captureSheet(this.inkTexture, this.colorMask);
      if (snapshot) this.onSheetRetired(snapshot);
    }
    this.printer.clear();
    this.paper.normalsDirty = true;
  }

  // ---- ribbon texture window around the print point
  _makeRibbonWindow() {
    const R = this.ribbonSim;
    const w = 384, h = R.mapW;
    return { data: new Uint8Array(w * h * 2), width: w, height: h, dirty: [], pxPerM: R.pxPerM, originM: 0 };
  }

  _refreshRibbonWindow() {
    const R = this.ribbonSim, t = this.ribbonTexture;
    const o = this.geo.printPoint;
    const q = R.queryAt(o[0], o);
    if (!q) return;
    const origin = q.s - t.width / (2 * R.pxPerM);
    if (!R.windowDirty && Math.abs(origin - t.originM) < 1 / R.pxPerM) return;
    t.originM = origin;
    const sPx0 = Math.round(origin * R.pxPerM);
    const { width: W, height: H, data } = t;
    const mapW = R.mapW, mapL = R.mapL;
    for (let x = 0; x < W; x++) {
      const si = Math.max(0, Math.min(mapL - 1, sPx0 + x));
      for (let y = 0; y < H; y++) {
        const k = (x + y * W) * 2;
        const v = R.ink[si * mapW + y];
        const sM = (sPx0 + x) / R.pxPerM, wM = y / R.pxPerM - R.W / 2;
        data[k] = Math.min(255, v * R.weave(sM, wM));
        data[k + 1] = 255 - v;
      }
    }
    t.dirty.length = 0;
    t.dirty.push({ x: 0, y: 0, w: W, h: H });
    R.windowDirty = false;
  }
}
