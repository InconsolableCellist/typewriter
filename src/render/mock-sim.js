// A small stand-in for SimClient and SoftWorld (see docs/ARCHITECTURE.md), used with ?mock or until
// the real modules are present. It integrates crude DOFs so the renderer sees plausible motion. It is
// not the physics; nothing outside src/render should depend on it.
import { makeLayout } from '../sim/layout.js';
import { deriveRig } from './rig.js';
import { barDirection } from '../machine/geometry.js';

export function createMockSim({ machine: m, geometry: g }) {
  const L = makeLayout(g);
  const s = new Float32Array(L.length);
  const fingers = [];
  const grabs = new Map();
  const listeners = { strike: [], event: [] };
  let timeScale = 1, tSim = 0, next = 1;
  s[L.carriageX] = m.carriage.startX; s[L.marginL] = m.carriage.startX + 0.01; s[L.marginR] = m.carriage.startX - 0.2;
  const keyV = new Float32Array(g.nKeys);
  const omega = new Float32Array(g.nPrint);
  const inContact = new Uint8Array(g.nPrint);
  let carriageTarget = m.carriage.startX;
  const params = { force: 18, hard: 1 };

  function fire(kind, e) { for (const f of listeners[kind] ?? []) f(e); }

  function strike(i, vImpact) {
    // A short Hunt-Crossley trace, enough for the scope and inset to have shape.
    const n = 400, dt = 2e-6, trace = { dt, force: new Float32Array(n), indent: new Float32Array(n) };
    const k = 1.6e8 * params.hard, cc = m.platen.huntCrossleyAlpha;
    let x = 0, xd = vImpact, Fpeak = 0, xPeak = 0, end = n;
    for (let t = 0; t < n; t++) {
      const F = x > 0 ? Math.max(0, k * x ** 1.5 * (1 + cc * xd)) : 0;
      xd += -F / m.typebars.slugMass * dt; x += xd * dt;
      trace.force[t] = F; trace.indent[t] = Math.max(0, x);
      Fpeak = Math.max(Fpeak, F); xPeak = Math.max(xPeak, x);
      if (x <= 0 && t > 3) { end = t; break; }
    }
    trace.force = trace.force.subarray(0, end); trace.indent = trace.indent.subarray(0, end);
    const key = g.keys[i];
    const shifted = s[L.shiftY] > m.carriage.shiftTravel / 2;
    const evt = {
      type: 'strike', bar: i, caseIndex: shifted ? 1 : 0, tBegin: tSim, duration: end * dt,
      carriageX: s[L.carriageX], platenPsi: s[L.platenPsi], shiftY: s[L.shiftY], lateral: s[L.barLateral + i],
      vImpact, peakForce: Fpeak, maxIndent: xPeak, restitution: Math.abs(xd) / vImpact, skewRad: g.bars[i].skew,
      vibratorLift: s[L.vibratorLift], ribbonInGap: 1, trace,
      char: shifted ? key.upper : key.lower,
    };
    fire('strike', evt);
    for (const f of listeners.mock ?? []) f(evt);
  }

  function step(dt) {
    tSim += dt;
    s[L.time] = tSim; s[L.dspLoad] = 0.08;
    let ubar = 0;
    for (let i = 0; i < g.nKeys; i++) {
      let F = 0;
      for (const f of fingers) {
        if (f.i === i && tSim >= f.t0) {
          const u = Math.min(1, (tSim - f.t0) / f.dur);
          F = f.peak * Math.sin(Math.PI * Math.min(1, u));
        }
      }
      const key = g.keys[i];
      const grab = grabs.get(`key:${i}`);
      if (grab) F = Math.max(0, grab.k * (grab.target - s[L.keyX + i])) - grab.c * keyV[i];
      const ret = key.returnForce + 95 * s[L.keyX + i];
      keyV[i] += (F - ret) / m.keys.mass * dt;
      s[L.keyX + i] += keyV[i] * dt;
      if (s[L.keyX + i] <= 0) { s[L.keyX + i] = 0; keyV[i] = 0; }
      if (s[L.keyX + i] >= key.travel) { s[L.keyX + i] = key.travel; keyV[i] = 0; }
      s[L.keyV + i] = keyV[i];
      if (i < g.nPrint) ubar = Math.max(ubar, s[L.keyX + i] / m.linkage.keyTravel);
      if (key.id === 'shiftL' || key.id === 'shiftR') {
        const on = s[L.keyX + i] / key.travel;
        s[L.shiftY] += (on * m.carriage.shiftTravel - s[L.shiftY]) * Math.min(1, dt * 40);
      }
    }
    for (let i = 0; i < g.nPrint; i++) {
      const bar = g.bars[i];
      const grab = grabs.get(`bar:${i}`);
      const x = s[L.keyX + i] / m.linkage.keyTravel;
      const driven = bar.thetaTravel * m.linkage.coupledFraction * Math.pow(x, 1 / m.linkage.accelShape);
      const th = s[L.barTheta + i];
      if (grab) { s[L.barTheta + i] += (grab.target - th) * Math.min(1, dt * 60); omega[i] = 0; continue; }
      if (driven > th) { omega[i] = Math.max(omega[i], (driven - th) / dt * 0.05); }
      omega[i] += -((m.typebars.returnSpringTorque + m.typebars.returnSpringRate * th) / bar.inertia) * dt;
      s[L.barTheta + i] += omega[i] * dt;
      if (s[L.barTheta + i] >= bar.thetaTravel) {
        s[L.barTheta + i] = bar.thetaTravel;
        const vImp = omega[i] * bar.length;
        if (vImp > 0.1 && !inContact[i]) { inContact[i] = 1; strike(i, vImp); carriageTarget += m.escapement.pitch; }
        omega[i] = -0.35 * omega[i];
      } else if (s[L.barTheta + i] < bar.thetaTravel * 0.95) inContact[i] = 0;
      if (s[L.barTheta + i] <= 0) { s[L.barTheta + i] = 0; omega[i] = 0; }
      s[L.barOmega + i] = omega[i];
    }
    s[L.ubar] = ubar; s[L.rocker] = ubar;
    s[L.dogFixedR] = ubar; s[L.dogLooseR] = ubar * 0.9; s[L.dogLooseS] = 0;
    s[L.vibratorLift] = Math.min(1, ubar * 1.2) * m.ribbon.vibrator.fullLift;

    const grabC = grabs.get('carriage:0');
    if (grabC) { carriageTarget = grabC.target; }
    const cx = s[L.carriageX];
    const v = (carriageTarget - cx) * Math.min(1, dt * 90) / dt;
    s[L.carriageV] = v; s[L.carriageX] = cx + v * dt;
    s[L.mainspringN] = m.carriage.drawbandPreload + m.carriage.drawbandRate * (m.carriage.travel / 2 - s[L.carriageX]);
    for (const [name, dof, f] of [['platen', 'platenPsi'], ['lsLever', 'lsLever'], ['paperRelease', 'paperRelease'], ['carriageRelease', 'carriageRelease'], ['bail', 'bail'], ['marginL', 'marginL'], ['marginR', 'marginR'], ['ribbonSelector', 'ribbonSelector']].map(([a, b]) => [a, b, 1])) {
      const g2 = grabs.get(`${name}:0`);
      if (g2) s[L[dof]] += (g2.target - s[L[dof]]) * Math.min(1, dt * 40 * f);
      else if (['lsLever', 'paperRelease', 'carriageRelease', 'bail', 'ribbonSelector'].includes(dof)) s[L[dof]] *= 1 - Math.min(1, dt * 25);
    }
  }

  let wall = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    let dt = Math.min(0.05, (now - wall) / 1000) * timeScale;
    wall = now;
    const n = Math.max(1, Math.ceil(dt / 0.0005)), h = dt / n;
    for (let i = 0; i < n; i++) step(h);
  }, 4);

  return {
    layout: L, state: s,
    machine: m, geometry: g, isMock: true, grabs,
    on(kind, fn) { (listeners[kind] ||= []).push(fn); return () => { listeners[kind] = listeners[kind].filter((f) => f !== fn); }; },
    pressKey(i, peakN, durationS) { fingers.push({ i, peak: peakN, dur: durationS, t0: tSim }); if (fingers.length > 64) fingers.shift(); },
    grab(dof, index, o) { const id = next++; grabs.set(`${dof}:${index ?? 0}`, { id, ...o }); return { id, key: `${dof}:${index ?? 0}` }; },
    moveGrab(g2, target) { const it = grabs.get(g2.key); if (it) it.target = target; },
    release(g2) { grabs.delete(g2.key); },
    setEnv() {},
    setParam(name, val) { if (name === 'strike.force') params.force = val; if (name === 'platen.hardness') params.hard = val; },
    setTimeScale(t) { timeScale = t; },
    setAudioEnabled() {},
    unlockAudio() {},
    dispose() { clearInterval(timer); },
  };
}

export class MockSoft {
  constructor({ machine: m, geometry: g, glyphs }) {
    this.m = m; this.g = g; this.glyphs = glyphs; this.rig = deriveRig(m, g);
    const nx = 22, ny = 56;
    const positions = new Float32Array(nx * ny * 3), uvs = new Float32Array(nx * ny * 2), indices = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = i + j * nx, b = a + 1, c = a + nx, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { uvs[(i + j * nx) * 2] = i / (nx - 1); uvs[(i + j * nx) * 2 + 1] = 1 - j / (ny - 1); }
    this.paper = { positions, nx, ny, indices: new Uint32Array(indices), uvs, normalsDirty: true };
    const W = 1024, H = Math.round(W * m.paper.height / m.paper.width);
    this.inkTexture = { data: new Uint8Array(W * H * 2), width: W, height: H, dirty: [] };
    const rn = 64;
    this.ribbon = { positions: new Float32Array(rn * 3), up: new Float32Array(rn * 3), count: rn, spoolL: { angle: 0, radius: 0.016 }, spoolR: { angle: 0, radius: 0.016 } };
    const RW = 256;
    this.ribbonTexture = { data: new Uint8Array(RW * 32 * 2), width: RW, height: 32, dirty: [] };
    this.feed = 0.05; this.sheetPresent = true; this.lastSkew = 0;
    this.ribbonOff = 0; this.grabs = new Map(); this.next = 1;
  }

  /** s is arclength along the paper from its bottom edge, in metres; returns a point on the path. */
  pathPoint(s, out) {
    const { m, g } = this;
    const c = m.platen.center, R = m.platen.radius + 0.0003;
    const tilt = this.rig.tableTilt;
    const contactAng = -Math.PI / 2 - 0.6;
    const beta = m.printPoint.beta;
    // Path through the print point: from behind, under the platen and up the front. u=0 at print point.
    const u = s;
    const aPP = beta;
    const aOff = Math.PI * 0.72;
    let y, z;
    if (u <= 0 && u >= -aOff * R) {
      const a = aPP + u / R;
      y = c[1] + Math.sin(a) * R; z = c[2] + Math.cos(a) * R;
    } else if (u < -aOff * R) {
      const a = aPP - aOff;
      const px = c[1] + Math.sin(a) * R, pz = c[2] + Math.cos(a) * R;
      const d = -aOff * R - u;
      y = px + d * Math.sin(tilt + Math.PI / 2 - 0.1) ; z = pz - d * Math.cos(tilt - 0.1);
      z = pz - d * 0.86; y = px + d * 0.5 + 0.0002;
    } else {
      // Above the print point the sheet follows the platen under the bail then lifts away.
      const reach = 0.02;
      const cu = Math.min(u, reach);
      const a = aPP + cu / R;
      y = c[1] + Math.sin(a) * R; z = c[2] + Math.cos(a) * R;
      const rest = u - cu;
      if (rest > 0) { const tu = Math.cos(aPP + reach / R), tv = -Math.sin(aPP + reach / R); y += tu * rest * 0.75 + 0.15 * rest; z += tv * rest * 0.75 + 0.15 * rest; }
    }
    void contactAng;
    void g;
    out[0] = 0; out[1] = y; out[2] = z;
  }

  step(dt, state, L) {
    this.state = state; this.L = L;
    const { m, g, paper } = this;
    const cx = state[L.carriageX];
    const worldX = cx;
    const psi = state[L.platenPsi];
    const lineFeedS = psi * m.platen.radius;
    const out = [0, 0, 0];
    const halfW = m.paper.width / 2;
    const H = m.paper.height;
    const shift = state[L.shiftY];
    for (let j = 0; j < paper.ny; j++) {
      const t = j / (paper.ny - 1);
      const s = (0.3 - t) * H + this.feed + lineFeedS;
      this.pathPoint(s, out);
      for (let i = 0; i < paper.nx; i++) {
        const u = i / (paper.nx - 1);
        const k = (i + j * paper.nx) * 3;
        paper.positions[k] = worldX + (u - 0.5) * 2 * halfW;
        paper.positions[k + 1] = out[1] + shift;
        paper.positions[k + 2] = out[2];
      }
    }
    paper.normalsDirty = true;

    // Ribbon: spool -> up over a guide -> through vibrator at the print point -> spool.
    const R = this.ribbon;
    const lift = state[L.vibratorLift];
    const pp = [...g.printPoint];
    const down = g.strikeDown;
    const v = m.ribbon.vibrator;
    const offset = v.restDrop - lift;
    pp[0] += 0; pp[1] += g.printNormal[1] * 0.0009 + down[1] * offset; pp[2] += g.printNormal[2] * 0.0009 + down[2] * offset;
    const spoolR = [m.ribbon.spoolX, m.ribbon.spoolY, m.ribbon.spoolZ];
    const spoolL = [-m.ribbon.spoolX, m.ribbon.spoolY, m.ribbon.spoolZ];
    const n = R.count;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = t < 0.5 ? spoolL : pp, b = t < 0.5 ? pp : spoolR;
      const f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const sf = f * f * (3 - 2 * f);
      const sag = 0;
      R.positions[i * 3] = a[0] + (b[0] - a[0]) * sf;
      R.positions[i * 3 + 1] = a[1] + (b[1] - a[1]) * sf + sag;
      R.positions[i * 3 + 2] = a[2] + (b[2] - a[2]) * sf;
      const mid = Math.exp(-((t - 0.5) * (t - 0.5)) * 48);
      R.up[i * 3] = 0;
      R.up[i * 3 + 1] = (1 - mid) + mid * 0.866;
      R.up[i * 3 + 2] = mid * -0.5;
    }
    R.spoolL.angle = -psi * 0.2 + this.ribbonOff; R.spoolR.angle = psi * 0.2;
    this.lastCx = cx;
  }

  applyStrike(e) {
    if (!this.glyphs) return;
    const { m, inkTexture: tex } = this;
    const char = e.char;
    const gi = this.glyphs.chars.indexOf(char);
    if (gi < 0) return;
    const hf = this.glyphs.data.subarray(gi * 96 * 96, (gi + 1) * 96 * 96);
    const mmPerTexelPaper = (m.paper.width * 1000) / tex.width;
    const cell = 96 * 0.05 / mmPerTexelPaper;
    const px = Math.round(tex.width * (0.14 + ((m.carriage.startX - e.carriageX) / m.paper.width)));
    const py = Math.round(tex.height * (0.1 + (e.platenPsi * m.platen.radius / m.paper.height)));
    const w = Math.max(1, Math.round(cell)), h = w;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = Math.floor((i / w) * 96), v2 = Math.floor((j / h) * 96);
      const val = hf[u + v2 * 96];
      if (val > 90) {
        const x = px + i, y = py + j;
        if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) continue;
        const k = (x + y * tex.width) * 2;
        tex.data[k] = Math.min(255, tex.data[k] + 200);
        tex.data[k + 1] = Math.min(255, tex.data[k + 1] + 180);
      }
    }
    tex.dirty.push({ x: Math.max(0, px), y: Math.max(0, py), w, h });
    const ribW = this.ribbonTexture;
    void ribW;
  }

  env() { return { paperCaliperM: this.m.paper.thickness, ribbonCaliperM: this.m.ribbon.thickness, ribbonInGap: 1, paperPresent: 1, paperStrength: 1 }; }
  readouts() { return { skewDeg: 0.04, lateralMm: 0.1, ribbonTensionN: 0.42, ribbonSlackMm: 2.1, inkAtPoint: 0.71 }; }
  grabPaper() { return this.next++; }
  grabRibbon() { return this.next++; }
  grabSpool(side) { const id = this.next++; this.grabs.set(id, { side }); return id; }
  moveGrab(id, v) {
    const g = this.grabs.get(id);
    if (g?.side === 'L') this.ribbon.spoolL.angle = v; else if (g?.side === 'R') this.ribbon.spoolR.angle = v;
  }
  release(id) { this.grabs.delete(id); }
  spawnSheet() {}
}
