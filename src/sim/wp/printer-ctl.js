// The printwheel printer's firmware (architecture.md 6.1, 6.5): attachment and command FIFO, escapement planner,
// selection, hammer with its flight-time servo, index, ribbon, paper cam, panel, cover interlock and self-test.
// Event driven: each process holds a deadline on the host's clock, and sensor interrupts (encoder edges, wheel
// pickups' count, the impact sensor, the hammer sense coil) arrive from the mechanism. Its only outputs are phase states,
// coil currents, the cam motor's voltage, panel lights and device events. It never writes a mechanical state: it
// holds nothing of the mechanism but `io`, whose members command drives and read sensors.

const OP_PRINT = 1, OP_ESCAPE = 2, OP_INDEX = 3, OP_PAPER = 5, OP_CONTROL = 6;
const FIFO_DEPTH = 32;
const LOOKAHEAD = 24;          // characters the planner times ahead of the carrier
const INF = Infinity;
// Panel lights (MIM p.182), a bit each, and the panel keys in their order on the panel.
export const LED = { powerOn: 1, onLine: 2, ribbon: 4, ready: 8, exception: 16, release: 32, setup: 64, loadPaper: 128, changeFont: 256, diag: 512 };
export const PANEL = { start: 0, stop: 1, printTest: 2, cancel: 3, load: 4, release: 5, paperUp: 6, paperDown: 7 };
const CAM_HOME = 0, CAM_RELEASE = 3, CAM_BAIL = 4;
const mod = (a, n) => ((a % n) + n) % n;
const signed = (w) => (w & 0x800 ? -1 : 1) * (w & 0x7ff);

/** Time to cover distance D into a constant-acceleration interval that starts at speed v0. */
function timeInto(v0, a, D) {
  if (Math.abs(a) < 1e-9) return D / v0;
  const disc = v0 * v0 + 2 * a * D;
  return (-v0 + Math.sqrt(disc > 0 ? disc : 0)) / a;
}

/**
 * Trapezoid (or triangle) over D steps at up to rate vMax with ramp a, starting at v0 (a motor's start rate, which
 * it can step at from rest) and ramping down to rest: knots of the constant-acceleration profile.
 */
function trapezoid(t, x, D, dir, vMax, a, v0 = 0) {
  const vp = Math.max(v0, Math.min(vMax, Math.sqrt(a * D + 0.5 * v0 * v0)));
  const up = (vp * vp - v0 * v0) / (2 * a), down = (vp * vp) / (2 * a), cruise = Math.max(0, D - up - down);
  const knots = [{ t, x, v: v0, c: -1 }, { t: t + (vp - v0) / a, x: x + dir * up, v: vp, c: -1 }];
  if (cruise > 1e-9) knots.push({ t: knots[1].t + cruise / vp, x: x + dir * (up + cruise), v: vp, c: -1 });
  knots.push({ t: knots[knots.length - 1].t + vp / a, x: x + dir * D, v: 0, c: -1 });
  return knots;
}

export class PrinterCtl {
  /** def: machine.printer; io: drives and sensors (printer-mech.js); emit(event) sends a device event. */
  constructor(def, io, emit, { warm = true } = {}) {
    this.def = def; this.io = io; this.emit = emit;
    this.reset(warm);
  }

  get cal() { return this.def.calibration; }

  reset(warm) {
    const H = this.def.hammer;
    this.on = warm; this.ready = warm; this.online = warm; this.selfTest = null;
    this.err = 0; this.leds = warm ? LED.powerOn | LED.onLine | LED.ready : 0; this.posLost = false;
    this.fifo = []; this.credit = 0;
    // Escapement: logical position L and commanded motor state S, both in 1/240 in; origin is S at logical 0.
    this.L = 0; this.S = 0; this.origin = 0; this.dx = 0; this.dy = 0; this.carrierAmp = 1;
    this.prof = null;          // { dir, knots: [{t, x, v, c}], k }, c = index into chars of a print knot, else -1
    this.tStep = INF; this.tEnd = INF;
    this.chars = [];           // { x, petal, g, impact, planned, state: 0 waiting, 1 fired, 2 struck, stopAt }
    this.ci = 0;               // first character not yet struck
    this.tFire = INF; this.tWatch = INF; this.waitSeat = false;
    // Selection.
    this.home = 0; this.selTarget = 0; this.selMode = 0; this.selSeated = true; this.selDir = 0;
    this.tSel = INF; this.tSeat = INF; this.tSelStart = INF; this.selNext = -1;
    // Hammer: on-times per force group; after power-on they start off by powerOnError and the servo pulls them in.
    this.tOn = this.cal.groups.map((g) => g.tOn * (warm ? 1 : 1 + H.powerOnError));
    this.ham = 0; this.hamChar = -1; this.hamGroup = 0; this.tHamOn = 0; this.tHamOff = INF; this.tHamWatch = INF; this.flights = [];
    // Index, ribbon, cam, panel.
    this.idx = null; this.idxS = 0; this.tIdx = INF; this.tIdxDone = INF;
    this.ribSteps = 0; this.ribS = 0; this.tRib = INF;
    this.camPos = CAM_HOME; this.camGoal = CAM_HOME; this.camCount = 0; this.camReed = false; this.tCam = INF; this.tCamLimit = INF;
    this.op = null;            // a running paper operation, plain data
    this.keys = 0; this.paperKey = null; this.tPanel = 0;
    if (this.on) this.drivesOn();
    this.updateNext();
  }

  // ---- host interface -------------------------------------------------------------------------------------------
  updateNext() {
    this.nextT = Math.min(this.tStep, this.tFire, this.tWatch, this.tHamWatch, this.tSel, this.tSelStart, this.tHamOff,
      this.tIdx, this.tIdxDone, this.tRib, this.tCam, this.tPanel, this.tEnd, this.selfTest ? this.selfTest.t : INF);
  }

  /** Words from the attachment (the software's commands, 6.5). Returns how many were taken. */
  command(words, t) {
    let n = 0;
    for (const w of words) {
      if (this.fifo.length >= FIFO_DEPTH) { this.emit({ ev: 'error', code: 'overrun' }); break; }
      this.fifo.push({ w, internal: false });
      n++;
    }
    if (this.on) this.kick(t);
    return n;
  }

  /** Called by the host whenever its clock passes nextT. */
  service(t) {
    if (!this.io.powered()) {
      if (this.on) this.powerOff();
      this.tPanel = t + this.def.panel.scanPeriod; this.updateNext(); return;
    }
    if (!this.on) this.powerOn(t);
    if (this.selfTest && t >= this.selfTest.t) this.selfTestStep(t);
    if (t >= this.tPanel) this.panel(t);
    if (t >= this.tSelStart) { this.tSelStart = INF; this.selectFor(t, this.selNext); }
    if (t >= this.tSel) this.selLoop(t);
    if (t >= this.tHamOff) { this.tHamOff = INF; this.io.setHammer(0); }
    if (t >= this.tFire) this.fire(t);
    if (t >= this.tHamWatch) { this.tHamWatch = INF; this.ham = 0; this.io.setHammer(0); this.fail(60); }
    if (t >= this.tWatch) { this.tWatch = INF; this.cancel(t, 45); }
    if (t >= this.tStep) this.escStep(t);
    if (t >= this.tIdx) this.idxStep(t);
    if (t >= this.tIdxDone) this.idxDone(t);
    if (t >= this.tRib) this.ribStep(t);
    if (t >= this.tCam) this.camPoll(t);
    if (t >= this.tEnd) { this.tEnd = INF; this.kick(t); }
    this.updateNext();
  }

  /** Coalesced credit for the words consumed since the last call (sent with each snapshot). */
  flush() { if (this.credit) { this.emit({ ev: 'credit', n: this.credit }); this.credit = 0; } }

  // ---- interrupts from the sensors --------------------------------------------------------------------------------
  encoder(t, e) {
    if (!this.prof) return;
    // An edge marks the rotor crossing a half-step line, the lower one when running down.
    this.predictFire(t, this.prof.dir > 0 ? e / 2 : (e + 1) / 2);
    this.updateNext();
  }

  impact(t) {
    if (this.ham !== 1) return;
    this.ham = 2;
    const flight = t - this.tHamOn, g = this.hamGroup, G = this.cal.groups[g];
    // Flight-time servo (6.5): correct this group's on-time toward its flight target.
    this.tOn[g] += this.def.hammer.servoGain * (G.flightTarget - flight) * G.dTonDFlight;
    this.tOn[g] = Math.min(Math.max(this.tOn[g], 0.3 * G.tOn), 2 * G.tOn);
    this.flights.push(g, flight);
    if (this.flights.length > 64) this.flights.splice(0, 2);
    this.tHamWatch = INF;
    this.chars[this.hamChar].state = 2;
    // The next selection starts once the hammer's nose is back behind the petals.
    const next = this.chars[this.hamChar + 1];
    if (next) { this.selNext = next.petal; this.tSelStart = t + this.cal.hammerClear + this.def.selection.clearDelay; }
    this.updateNext();
  }

  rebound(t) {
    if (this.ham !== 2) return;
    this.ham = 0;
    // The petal has left the paper: feed the ribbon.
    this.ribSteps += this.def.ribbonFeed.stepsPerChar;
    if (this.tRib === INF) this.tRib = t;
    this.ci = this.hamChar + 1;
    if (this.chars[this.ci]) this.watch(); else this.lineEnd(t);
    this.updateNext();
  }

  // ---- power, self-test, drives ------------------------------------------------------------------------------------
  drivesOn() {
    const io = this.io;
    io.setCarrier(this.S, 1); io.setWheel(mod(this.selTarget, 3), this.def.selection.holdCurrent);
    io.setIndex(this.idxS, this.def.index.holdCurrent); io.setRibbon(this.ribS, this.def.ribbonFeed.holdCurrent);
  }

  powerOff() {
    const io = this.io;
    io.setCarrier(this.S, 0); io.setWheel(0, 0); io.setIndex(this.idxS, 0); io.setRibbon(this.ribS, 0); io.setHammer(0); io.setCam(0);
    this.reset(false);
  }

  /** Power on: internal checks, then home the wheel, the carrier and the cam (MIM p.123, SET p.15). */
  powerOn(t) {
    this.reset(false);
    this.on = true;
    this.S = Math.floor(this.io.encoder() / 2); this.idxS = 0; this.ribS = 0;
    this.selfTest = { stage: 0, t: t + this.def.power.checksTime, steps: 0 };
  }

  selfTestStep(t) {
    const st = this.selfTest, io = this.io, sel = this.def.selection, C = this.def.carrier;
    switch (st.stage) {
      case 0:   // checks done: drives on, then step the wheel until the home pickup answers
        this.selTarget = Math.round(io.pickup() / this.def.wheel.pickupDivisions);
        this.drivesOn();
        st.stage = 1; st.t = t + 1 / sel.homeRate; break;
      case 1:
        if (io.wheelHome()) { this.home = this.selTarget; st.stage = 2; st.t = t; break; }
        if (++st.steps > 3 * sel.homeMoves) { this.selfTest = null; this.fail(56); return; }
        this.selTarget++; io.setWheel(mod(this.selTarget, 3), 1);
        st.t = t + 1 / sel.homeRate; break;
      case 2:   // carrier: drive it slowly further left than it can go, until the encoder stops following
        // At reduced current, so that against the stop it slips rather than compressing the follower.
        this.carrierAmp = C.homeCurrent;
        st.stage = 3; st.t = t + C.homePoll; this.moveTo(t, this.S - C.homeSteps, C.homeRate); break;
      case 3:   // where the encoder says it stopped is the left stop; logical 0 is a fixed distance out from it
        if (this.prof && Math.abs(io.encoder() / 2 - this.S) < C.homeSlip) { st.t = t + C.homePoll; break; }
        this.prof = null; this.tStep = INF;
        this.S = Math.round(io.encoder() / 2); this.carrierAmp = 1; io.setCarrier(this.S, 1);
        this.origin = this.S + C.homeOffsetSteps;
        st.stage = 4; st.t = t + C.settle; break;
      case 4: st.stage = 5; st.t = INF; this.moveTo(t, this.origin); break;
      case 5: st.stage = 6; st.t = INF; this.camGo(t, CAM_HOME); break;
      case 6: this.selfTest = null; this.L = 0; this.leds = LED.powerOn; break;
    }
  }

  fail(code) {
    this.err = code; this.ready = false;
    this.emit({ ev: 'error', code });
  }

  // ---- sequencing ----------------------------------------------------------------------------------------------------
  busy() {
    return !!(this.prof || this.idx || this.op || this.ham || this.selfTest || this.tCam !== INF || this.tIdxDone !== INF || this.chars[this.ci]?.stopAt);
  }

  /** Take the next commands when the mechanism is free for them. */
  kick(t) {
    if (!this.ready || !this.online || this.busy()) return;
    if (this.ci < this.chars.length) { this.beginSegment(t); return; }    // a line that was stopped part way
    while (this.fifo.length) {
      const { w } = this.fifo[0], op = w >> 12;
      if (op === OP_ESCAPE) { this.pop(); this.dx += signed(w); continue; }
      if (op === OP_INDEX) { this.pop(); this.dy += signed(w); continue; }
      if (this.dy) { this.indexPending(t); return; }
      if (op === OP_PRINT) { this.beginSegment(t); return; }
      this.pop();
      if (op === OP_PAPER) { this.paperOp(t, w & 0xf); return; }
      if (op === OP_CONTROL) {
        const k = w & 0xf;
        if (k === 1) { this.dx = 0; this.L = 0; this.moveTo(t, this.origin); return; }
        if (k === 2) { this.L += this.dx; this.dx = 0; this.emit({ ev: 'done' }); continue; }
        if (k === 3) { this.emit({ ev: 'status', ...this.status() }); continue; }
      }
    }
    if (this.dy) this.indexPending(t);
  }

  pop() { if (!this.fifo.shift().internal) this.credit++; }

  status() {
    return { ready: this.ready, online: this.online, error: this.err, coverOpen: !this.io.coverClosed(), ribbonLow: this.ribbonLow(), queued: this.fifo.length, positionLost: this.posLost };
  }

  ribbonLow() { const R = this.def.ribbonFeed; return this.io.ribbonLeft() < R.lowWarningChars * R.stepsPerChar * R.feedPerStep; }

  // ---- the planner (6.5) -------------------------------------------------------------------------------------------
  /** Move up to `max` characters from the FIFO into the plan while they continue the line in one direction. */
  pullChars(dir, max = LOOKAHEAD) {
    let last = this.chars[this.chars.length - 1];
    while (this.fifo.length && this.chars.length - this.ci < max) {
      const { w } = this.fifo[0], op = w >> 12;
      if (op === OP_ESCAPE) { this.pop(); this.dx += signed(w); continue; }
      if (op !== OP_PRINT) break;
      const x = this.origin + this.L + this.dx;
      if (last) {
        const s = Math.sign(x - last.x);
        if (s === 0 || (dir && s !== dir)) break;      // an overstrike or a turn: the carrier stops first
        dir = s;
      }
      this.pop();
      this.L += this.dx; this.dx = 0;
      const petal = w & 0x7f, imp = (w >> 8) & 0xf;
      last = { x, petal, g: imp ? Math.min(imp, 3) - 1 : this.cal.petalGroups[petal], impact: 0, planned: false, state: 0, stopAt: false };
      this.chars.push(last);
    }
    return dir;
  }

  /** Start a line segment from rest. */
  beginSegment(t) {
    this.chars = this.chars.slice(this.ci); this.ci = 0;
    for (const c of this.chars) { c.planned = false; c.stopAt = false; }
    const x0 = this.chars.length ? this.chars[0].x : this.origin + this.L + this.dx;
    const run = Math.abs(x0 - this.S);
    if (run < this.def.carrier.minRunUp) {
      // No room for a run-up: go there, stop, and print this one at rest.
      if (!this.chars.length) this.pullChars(0, 1);
      const c = this.chars[0];
      c.stopAt = true; c.planned = true;
      this.selectFor(t, c.petal);
      c.impact = this.moveTo(t, c.x, this.def.carrier.printRate) + this.def.carrier.settle;
      this.tFire = c.impact;
      return;
    }
    const dir = Math.sign(x0 - this.S);
    this.pullChars(dir);
    this.selectFor(t, this.chars[0].petal);
    this.plan(t, { t, x: this.S, v: 0, c: -1 }, 0, dir, this.selReadyAt(t, this.chars[0].petal));
  }

  /**
   * Time the characters from index `from` on, starting at knot k0 (time, position, speed along dir), and lay out
   * the carrier's profile: constant acceleration between knots, each character's knot at its impact (6.5):
   * impact_i = max(impact_i-1 + 14 ms, arrive(x_i) at <= 1440 steps/s, wheelReady_i + flight_g).
   * readyAt is when the wheel will be seated for the first of them. Returns false if the carrier cannot slow
   * down enough in time.
   */
  plan(t, k0, from, dir, readyAt) {
    const C = this.def.carrier, sel = this.def.selection, cal = this.cal;
    const a = C.ramp, list = this.chars.slice(from), n = list.length;
    const d = new Float64Array(n), u = new Float64Array(n).fill(C.printRate), v = new Float64Array(n), Tmin = new Float64Array(n);
    let x = k0.x, prev = this.chars[from - 1];
    for (let i = 0; i < n; i++) {
      const c = list[i], G = cal.groups[c.g], lead = G.flightTarget + G.tPeak;
      d[i] = Math.abs(c.x - x); x = c.x;
      Tmin[i] = i === 0 && readyAt !== undefined ? Math.max(C.minCycle * 0.25, readyAt + lead - k0.t)
        : Math.max(C.minCycle, cal.impactLag + cal.hammerClear + sel.clearDelay + this.moveTime(prev.petal, c.petal) + sel.seatMargin + lead);
      prev = c;
    }
    // Both knots of an interval at or under its average speed keep it at or over its minimum time. The first
    // interval starts from a fixed knot, so its far end gets whatever the sum allows.
    for (let i = 1; i < n; i++) { const c = d[i] / Tmin[i]; u[i - 1] = Math.min(u[i - 1], c); u[i] = Math.min(u[i], c); }
    u[0] = Math.min(u[0], (2 * d[0]) / Tmin[0] - k0.v, Math.sqrt(k0.v * k0.v + 2 * a * d[0]));
    if (u[0] < Math.sqrt(Math.max(0, k0.v * k0.v - 2 * a * d[0])) + 1) return false;
    v[n - 1] = u[n - 1];
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(u[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * a * d[i + 1]));
    for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * a * d[i]));
    const knots = [k0];
    let tk = k0.t, vk = k0.v;
    for (let i = 0; i < n; i++) {
      tk += (2 * d[i]) / (vk + v[i]); vk = v[i];
      list[i].impact = tk; list[i].planned = true;
      knots.push({ t: tk, x: list[i].x, v: v[i], c: from + i });
    }
    // Run on past the last character and stop on a whole step.
    const last = list[n - 1].x, run = Math.max(1, Math.ceil((vk * vk) / (2 * a)));
    knots.push({ t: tk + (2 * run) / vk, x: last + dir * run, v: 0, c: -1 });
    this.prof = { dir, knots, k: 1 };
    this.watch();
    if (this.tStep === INF) this.tStep = this.nextStepTime(t);
    return true;
  }

  /** A plain move of the carrier to step position x, at up to `rate`; returns its end time. */
  moveTo(t, x, rate = this.def.carrier.slewRate) {
    const D = Math.abs(x - this.S);
    if (D === 0) { this.tEnd = t; return t; }
    const knots = trapezoid(t, this.S, D, Math.sign(x - this.S), rate, this.def.carrier.ramp);
    this.prof = { dir: Math.sign(x - this.S), knots, k: 1 };
    this.tStep = this.nextStepTime(t);
    return knots[knots.length - 1].t;
  }

  /** When the profile reaches the next step boundary. Passing a print knot may extend the plan from it. */
  nextStepTime(t) {
    for (;;) {
      const P = this.prof, K = P.knots, dir = P.dir;
      if (P.k >= K.length) return INF;
      const k0 = K[P.k - 1], k1 = K[P.k];
      const D = (this.S + dir * 0.5 - k0.x) * dir, d = (k1.x - k0.x) * dir;
      if (D <= d + 1e-9) {
        const acc = d > 0 ? (k1.v * k1.v - k0.v * k0.v) / (2 * d) : 0;
        return Math.max(t, k0.t + timeInto(k0.v, acc, Math.max(0, D)));
      }
      P.k++;
      if (k1.c >= 0 && k1.c === this.chars.length - 1) this.extend(k1);
    }
  }

  /** Passing the last planned character's knot: look further ahead and re-time what follows from that knot. */
  extend(k) {
    const n0 = this.chars.length;
    this.pullChars(this.prof.dir);
    if (this.chars.length === n0) return;
    const P = this.prof;
    if (!this.plan(k.t, { t: k.t, x: k.x, v: k.v, c: k.c }, k.c + 1, P.dir)) this.prof = P;   // they start the next segment
  }

  escStep(t) {
    const P = this.prof;
    this.S += P.dir;
    this.io.setCarrier(this.S, this.carrierAmp);
    this.tStep = this.nextStepTime(t);
    if (this.tStep === INF) this.endProfile(t);
  }

  endProfile(t) {
    this.prof = null;
    this.tEnd = t + this.def.carrier.settle;
    if (this.selfTest) this.selfTest.t = t + this.def.carrier.settle;
    const c = this.chars[this.ci];
    if (c?.stopAt) return;
    if (c && c.state === 0) this.tWatch = INF;          // left unprinted: the next segment takes it from rest
    if (this.ci >= this.chars.length) this.lineEnd(t);
  }

  /** After the last character of a segment: take any index that follows it while the carrier runs out. */
  lineEnd(t) {
    while (this.fifo.length) {
      const { w } = this.fifo[0], op = w >> 12;
      if (op === OP_ESCAPE) { this.pop(); this.dx += signed(w); }
      else if (op === OP_INDEX) { this.pop(); this.dy += signed(w); }
      else break;
    }
    if (this.dy && !this.idx && this.tIdxDone === INF) this.indexPending(t);
  }

  // ---- firing ---------------------------------------------------------------------------------------------------
  /** The fire watchdog: the next character must have fired a little after its planned impact. */
  watch() {
    const c = this.chars[this.ci];
    this.tWatch = c && c.planned && !c.stopAt ? c.impact + this.def.carrier.fireWatch : INF;
  }

  /**
   * When to fire so that the next character's peak force falls on its column: the plan says when the motor reaches
   * the column, and the latest encoder edge says how far behind the plan the motor is running.
   */
  predictFire(t, pos) {
    const c = this.chars[this.ci], P = this.prof;
    if (!c || !c.planned || c.state !== 0 || c.stopAt || !P || this.ham) return;
    const G = this.cal.groups[c.g], behind = (this.planAt(t).x - pos) * P.dir;
    const aim = c.x + P.dir * (this.cal.carrierLag + behind);
    this.tFire = Math.max(t, this.planTime(aim) - (G.flightTarget + G.tPeak));
  }

  /** Where the profile has the motor at time t (steps), and how fast. */
  planAt(t) {
    const P = this.prof, K = P.knots;
    let i = 1;
    while (i < K.length - 1 && K[i].t < t) i++;
    const k0 = K[i - 1], k1 = K[i], d = Math.abs(k1.x - k0.x);
    const acc = d > 0 ? (k1.v * k1.v - k0.v * k0.v) / (2 * d) : 0, tau = Math.min(t - k0.t, k1.t - k0.t);
    return { x: k0.x + P.dir * (k0.v * tau + 0.5 * acc * tau * tau), v: k0.v + acc * tau };
  }

  /** When the profile reaches position x. */
  planTime(x) {
    const P = this.prof, K = P.knots, dir = P.dir;
    for (let i = 1; i < K.length; i++) {
      const k0 = K[i - 1], k1 = K[i];
      if ((x - k1.x) * dir > 0) continue;
      const D = (x - k0.x) * dir, d = (k1.x - k0.x) * dir;
      if (D < 0) return k0.t + D / Math.max(k0.v, 1);
      return k0.t + timeInto(k0.v, d > 0 ? (k1.v * k1.v - k0.v * k0.v) / (2 * d) : 0, D);
    }
    return INF;
  }

  fire(t) {
    this.tFire = INF;
    const c = this.chars[this.ci];
    if (!c || c.state !== 0) return;
    const seated = this.selSeated && mod(this.selTarget - this.home, 96) === c.petal;
    if (c.stopAt) {
      if (!seated || this.prof) { this.waitSeat = true; return; }
      if (Math.abs(this.io.encoder() / 2 - c.x) > 0.75) { this.cancel(t, 45); return; }
    } else if (!seated) { this.cancel(t, 55); return; }
    this.waitSeat = false;
    c.state = 1;
    this.ham = 1; this.hamChar = this.ci; this.hamGroup = c.g; this.tHamOn = t;
    this.io.setHammer(this.cal.groups[c.g].current);
    this.tHamOff = t + this.tOn[c.g];
    this.tHamWatch = t + 2 * this.cal.groups[c.g].flightTarget + this.def.hammer.impactWatch;
    this.tWatch = INF;
  }

  /** Cancel a fire (55 selection late, 45 escapement out of step): report it, stop, and take it again from rest. */
  cancel(t, code) {
    this.emit({ ev: 'error', code, recoverable: true });
    const c = this.chars[this.ci];
    if (c) c.stopAt = false;
    this.tWatch = INF; this.tFire = INF; this.waitSeat = false;
    const P = this.prof;
    if (!P) { this.tEnd = t; return; }
    const at = this.planAt(t), x = at.x, v = Math.max(1, at.v);
    const xs = Math.round(x + P.dir * ((v * v) / (2 * this.def.carrier.ramp) + 0.5));
    P.knots = [{ t, x, v, c: -1 }, { t: t + (2 * Math.abs(xs - x)) / v, x: xs, v: 0, c: -1 }];
    P.k = 1;
    for (const ch of this.chars) ch.planned = false;
    this.tStep = this.nextStepTime(t);
    if (this.tStep === INF) this.endProfile(t);
  }

  // ---- selection ------------------------------------------------------------------------------------------------
  /** Seconds a move between two petals takes to seat, from the calibrated move table. */
  moveTime(p0, p1) { return this.cal.moveTime[Math.abs(this.shortest(p0, p1))]; }
  shortest(p0, p1) { let n = mod(p1 - p0, 96); if (n > 48) n -= 96; return n; }
  petalNow() { return mod(this.selTarget - this.home, 96); }
  selReadyAt(t, petal) {
    return this.selSeated && this.petalNow() === petal ? t : t + this.moveTime(this.petalNow(), petal) + this.def.selection.seatMargin;
  }

  /** Start the wheel the shortest way to a petal (MIM p.187). */
  selectFor(t, petal) {
    const n = this.shortest(this.petalNow(), petal);
    if (n === 0) return;
    this.selTarget += n; this.selDir = Math.sign(n); this.selMode = 1; this.selSeated = false; this.tSeat = INF;
    this.selLoop(t);
  }

  /** Braking speed for a distance still to go, from the calibrated table indexed by remaining steps. */
  brakeSpeed(rem) {
    const B = this.cal.brakeCurve, i = Math.min(Math.floor(rem), B.length - 2), f = Math.min(rem - i, 1);
    return B[i] + (B[i + 1] - B[i]) * f;
  }

  /**
   * The selection loop, on the pickups' position and speed. While moving: pull while the rotor is slower than the
   * table's braking speed for the distance left, brake while it is faster. Inside the capture distance: a servo on
   * position and speed, by choosing the phase that pushes the right way and its current. Seated: hold the target.
   */
  selLoop(t) {
    const S = this.def.selection, div = this.def.wheel.pickupDivisions;
    const q = this.io.pickup(), pos = q / div, dir = this.selDir, v = this.io.wheelSpeed();
    const rem = (this.selTarget - pos) * dir;
    // The coil current lags its switch, so phases are chosen for where the rotor will be a current rise time ahead.
    const pa = pos + v * S.advance;
    let phase, amp = 1;
    if (this.selMode === 1 && rem <= S.capture) this.selMode = 3;
    if (this.selMode === 1) {
      // Three quarters of a step ahead pulls hardest, and three quarters behind brakes hardest.
      phase = v * dir < this.brakeSpeed(rem) ? Math.round(pa + 0.75 * dir) : Math.round(pa - 0.75 * dir);
    } else {
      const err = pos - this.selTarget;
      if (q === this.selTarget * div && Math.abs(v) < S.seatSpeed) {
        if (this.tSeat === INF) this.tSeat = t + S.seatTime;
        if (t >= this.tSeat) {
          this.io.setWheel(mod(this.selTarget, 3), S.holdCurrent);
          this.selMode = 0; this.tSel = INF; this.tSeat = INF; this.selSeated = true;
          if (this.waitSeat) this.tFire = t;
          return;
        }
      } else this.tSeat = INF;
      // Wanted torque as a fraction of peak; a single phase gives Tpk a^2 |sin| in the direction it is chosen for.
      const T = Math.max(-1, Math.min(1, -(S.servoKp * err + S.servoKd * v)));
      const s = Math.sign(T) || 1;
      phase = Math.round(pa + 0.75 * s);
      const reach = Math.abs(Math.sin(((pa - phase) * 2 * Math.PI) / 3));
      amp = Math.min(1, Math.sqrt(Math.abs(T) / Math.max(reach, 0.5)));
    }
    this.io.setWheel(mod(phase, 3), amp);
    this.tSel = t + S.loopPeriod;
  }

  // ---- index ----------------------------------------------------------------------------------------------------
  /** Execute the summed index moves. */
  indexPending(t) { const n = this.dy; this.dy = 0; this.startIndex(t, n); }

  startIndex(t, steps) {
    const I = this.def.index;
    this.idx = { dir: Math.sign(steps), knots: trapezoid(t, this.idxS, Math.abs(steps), Math.sign(steps), I.rate, I.ramp, I.startRate), k: 1, after: false };
    this.tIdx = this.idxStepTime(t);
    this.updateNext();
  }

  idxStepTime(t) {
    const X = this.idx, dir = X.dir;
    for (;;) {
      const K = X.knots;
      if (X.k >= K.length) return INF;
      const k0 = K[X.k - 1], k1 = K[X.k];
      const D = (this.idxS + dir * 0.5 - k0.x) * dir, d = (k1.x - k0.x) * dir;
      if (D <= d + 1e-9) return Math.max(t, k0.t + timeInto(k0.v, d > 0 ? (k1.v * k1.v - k0.v * k0.v) / (2 * d) : 0, Math.max(0, D)));
      X.k++;
    }
  }

  idxStep(t) {
    this.idxS += this.idx.dir;
    this.io.setIndex(this.idxS, this.def.index.runCurrent);
    this.tIdx = this.idxStepTime(t);
    if (this.tIdx === INF) this.tIdxDone = t + this.def.index.settle;
  }

  idxDone(t) {
    this.tIdxDone = INF;
    this.io.setIndex(this.idxS, this.def.index.holdCurrent);
    const after = this.idx.after;
    this.idx = null;
    if (after) this.opContinue(t); else this.kick(t);
  }

  // ---- ribbon ---------------------------------------------------------------------------------------------------
  ribStep(t) {
    if (this.ribSteps <= 0) { this.tRib = INF; this.io.setRibbon(this.ribS, this.def.ribbonFeed.holdCurrent); return; }
    this.ribSteps--; this.ribS++;
    this.io.setRibbon(this.ribS, 1);
    this.tRib = t + 1 / this.def.ribbonFeed.rate;
  }

  // ---- paper-handling cam ---------------------------------------------------------------------------------------
  camGo(t, pos) {
    const n = mod(pos - this.camPos, this.def.cam.positions);
    if (n === 0) { this.camDone(t); return; }
    this.camGoal = pos; this.camCount = n; this.camReed = true;
    this.io.setCam(this.def.cam.volts);
    this.tCam = t + this.def.cam.pollPeriod; this.tCamLimit = t + this.def.cam.timeout;
  }

  /** Count the reed closures to the wanted position; error 76 if none comes within the timeout (MIM p.124). */
  camPoll(t) {
    const r = this.io.camReeds(), closed = r.home || r.pos;
    if (closed && !this.camReed) {
      this.tCamLimit = t + this.def.cam.timeout;
      if (--this.camCount <= 0) {
        this.io.setCam(0);
        this.tCam = INF; this.camPos = this.camGoal;
        if (r.home !== (this.camGoal === CAM_HOME)) this.fail(76);
        this.camDone(t);
        return;
      }
    }
    this.camReed = closed;
    if (t >= this.tCamLimit) { this.io.setCam(0); this.tCam = INF; this.fail(76); return; }
    this.tCam = t + this.def.cam.pollPeriod;
  }

  camDone(t) {
    if (this.selfTest) { this.selfTest.t = t; return; }
    if (this.op) this.opContinue(t); else this.tEnd = t;
  }

  // ---- paper operations (PAPER commands and the Load and Release keys) -------------------------------------------
  paperOp(t, k) {
    const kinds = { 1: { kind: 'load' }, 2: { kind: 'eject' }, 3: { kind: 'cam', pos: CAM_BAIL }, 4: { kind: 'cam', pos: CAM_HOME } };
    if (!kinds[k]) return;
    this.op = { ...kinds[k], stage: 0, fed: 0 };
    this.opContinue(t);
  }

  /** Advance the running operation after its last step finished. */
  opContinue(t) {
    const op = this.op, P = this.def.paperFeed;
    const feed = () => { op.fed += P.chunk; this.startIndex(t, P.chunk); this.idx.after = true; };
    if (op.kind === 'cam' && op.stage++ === 0) { this.camGo(t, op.pos); return; }
    if (op.kind === 'load') {        // bail open, feed until the first-writing-line sensor sees the edge, bail closed
      if (op.stage === 0) { op.stage = 1; this.camGo(t, CAM_BAIL); return; }
      if (op.stage === 1) {
        if (!this.io.paperAtSensor() && op.fed < P.loadMaxSteps) { feed(); return; }
        if (!this.io.paperAtSensor()) { this.leds |= LED.loadPaper; this.emit({ ev: 'error', code: 'loadPaper' }); }
        op.stage = 2; this.camGo(t, CAM_HOME); return;
      }
    }
    if (op.kind === 'eject') {       // release the rollers and feed the sheet out
      if (op.stage === 0) { op.stage = 1; this.camGo(t, CAM_RELEASE); return; }
      if (op.stage === 1) {
        if (this.io.paperPresent() && op.fed < P.ejectMaxSteps) { feed(); return; }
        op.stage = 2; this.camGo(t, CAM_HOME); return;
      }
    }
    this.op = null;
    this.emit({ ev: 'paper', kind: op.kind });
    this.tEnd = t;
  }

  // ---- panel and cover --------------------------------------------------------------------------------------------
  panel(t) {
    const K = this.def.panel, io = this.io;
    this.tPanel = t + K.scanPeriod;
    // Cover interlock: opening it while ready stops the escapement at once and loses position (MIM p.183).
    if (!io.coverClosed() && this.ready) {
      if (this.prof) { this.prof = null; this.tStep = INF; this.posLost = true; }
      this.tFire = INF; this.tWatch = INF;
      this.fail(6);
    }
    let keys = 0;
    for (let i = 0; i < K.keys.length; i++) if (io.panelKey(i)) keys |= 1 << i;
    const down = keys & ~this.keys;
    this.keys = keys;
    if (down & (1 << PANEL.start) && !this.selfTest && io.coverClosed()) {
      this.err = 0; this.ready = true; this.online = true;
      if (this.posLost) { this.posLost = false; this.chars = []; this.ci = 0; }
      this.kick(t);
    }
    if (down & (1 << PANEL.stop)) this.online = false;
    if (down & (1 << PANEL.cancel)) { this.fifo.length = 0; this.emit({ ev: 'cancel' }); }
    if (down & (1 << PANEL.printTest) && !this.online && this.ready && !this.busy()) this.printTest(t);
    if (!this.busy() && this.ready) {
      if (down & (1 << PANEL.load)) this.paperOp(t, 1);
      if (down & (1 << PANEL.release)) this.paperOp(t, 2);
    }
    this.paperKeys(t, keys, down);
    let L = this.on ? LED.powerOn : 0;
    if (this.online) L |= LED.onLine;
    if (this.ready) L |= LED.ready;
    if (this.err) L |= LED.exception;
    if (this.ribbonLow()) L |= LED.ribbon;
    if (this.selfTest) L |= LED.diag;
    this.leds = (this.leds & LED.loadPaper) | L;
  }

  /** Paper Up and Down: 1/48 in, then 7/48 after 250 ms held, then 8/48 every 66 ms after a further 350 ms. */
  paperKeys(t, keys, down) {
    const P = this.def.panel.paperKey;
    for (const [key, sign] of [[PANEL.paperUp, 1], [PANEL.paperDown, -1]]) {
      const bit = 1 << key;
      if (down & bit) this.paperKey = { sign, t0: t, stage: 0, next: t };
      const pk = this.paperKey;
      if (!pk || pk.sign !== sign) continue;
      if (!(keys & bit)) { this.paperKey = null; continue; }
      if (t < pk.next || this.idx || this.prof) continue;
      if (pk.stage === 0) { this.startIndex(t, sign * P.first); pk.stage = 1; pk.next = pk.t0 + P.holdAfter; }
      else if (pk.stage === 1) { this.startIndex(t, sign * P.more); pk.stage = 2; pk.next = pk.t0 + P.holdAfter + P.repeatAfter; }
      else { this.startIndex(t, sign * P.repeatSteps); pk.next = t + P.repeatPeriod; }
    }
  }

  /** Print Test: every petal, two lines from the left margin (MIM p.131), queued as the printer's own commands. */
  printTest(t) {
    const order = this.def.panel.printTestOrder, pitch = this.def.panel.printTestPitch, half = Math.ceil(order.length / 2);
    const words = [0x6001];
    [...order].forEach((ch, i) => {
      if (i === half) words.push(0x6001, 0x3000 | 16);
      words.push(0x2000 | (i % half ? pitch : 0), 0x1000 | this.def.wheel.order.indexOf(ch));
    });
    words.push(0x6001, 0x3000 | 16, 0x6002);
    for (const w of words) this.fifo.push({ w, internal: true });
    this.online = true;
    this.kick(t);
  }

  // ---- state transfer -------------------------------------------------------------------------------------------
  exportState() {
    const s = {};
    for (const [k, v] of Object.entries(this)) if (k !== 'def' && k !== 'io' && k !== 'emit') s[k] = v;
    return structuredClone(s);
  }

  importState(s) { Object.assign(this, structuredClone(s)); }
}
