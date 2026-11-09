// A scripted hand for the Enter key: it grasps the line-space lever and pulls with a limited force, the
// same grab a pointer would make. The platen indexing and carriage return are the mechanism's own response.
export class Hands {
  constructor({ sim, soft, machine, rig }) { this.sim = sim; this.soft = soft; this.m = machine; this.rig = rig; this.busy = false;
    // A sheet that has run out of the rollers is finished: it goes to the pile, and the fresh stack is where the next one comes from.
    if (soft?.paperSim) soft.paperSim.onEjected = () => setTimeout(() => { this.cancelLoad?.(); soft.parkSheet(); }, 300);
  }

  /**
   * One stroke of the line-space lever: an unhurried swing to the end of travel, which indexes the ratchet by the
   * set line space. A fast swing throws the platen past the next detent. Past the end of travel the hand keeps
   * pulling and the lever stop carries the carriage to the margin.
   */
  carriageReturn() {
    if (this.busy) { this.queuedReturns = 1; return; }   // a press made during the stroke is honoured when it ends, not lost
    const { sim, m } = this;
    this.busy = true;
    if (m.action?.powerReturn) { this.pressPowerReturn(); return; }
    const L = sim.layout;
    // Sim time, so the stroke is the same stroke at any time scale and under any frame timing.
    const nowMs = () => sim.state[L.time] * 1000;
    const travel = m.lineSpace.travel;
    const SWING_MS = 120, SETTLE_MS = 10, BACK_MS = 90;
    const RETURN_V = 0.4, RETURN_GAIN = 3;   // m/s, and rad of lever lean per (m/s of error x s)
    let pull = 0, lastT = 0;
    const atMarginNow = () => Math.abs(sim.state[L.marginL] - sim.state[L.carriageX]) < 0.0012;
    const parked = atMarginNow();
    const g = sim.grab('lsLever', 0, { target: sim.state[L.lsLever], k: 6, c: 0.09, maxF: 2.2 });
    const t0 = nowMs();
    const step = () => {
      const t = nowMs() - t0;
      const f = Math.min(1, t / SWING_MS);
      const swing = travel * f * f * (3 - 2 * f);   // zero speed at both ends
      const pulling = !parked && t > SWING_MS + SETTLE_MS;
      const done = parked ? t > SWING_MS + SETTLE_MS : (pulling && atMarginNow()) || t > 4000;
      if (done) {
        // Let the lever back down under the hand rather than dropping it.
        const t1 = nowMs();
        const back = () => {
          const b = Math.min(1, (nowMs() - t1) / BACK_MS);
          sim.moveGrab(g, travel * (1 - b));
          if (b < 1) setTimeout(back, 8);
          else {
            sim.release(g); this.busy = false;
            if (this.queuedReturns) { this.queuedReturns = 0; this.carriageReturn(); }
          }
        };
        back();
        return;
      }
      if (pulling) {
        // A deliberate throw: the hand keeps the carriage near a set speed by how much it leans on the lever, not as hard as it can.
        const dtS = Math.max(0, (t - lastT) / 1000);
        pull = Math.min(0.9, Math.max(0, pull + (RETURN_V - sim.state[L.carriageV]) * RETURN_GAIN * dtS));
        sim.moveGrab(g, travel + pull);
      } else {
        sim.moveGrab(g, swing);
      }
      lastT = t;
      setTimeout(step, 8);
    };
    step();
  }

  /** Powered machine: a finger on the Return key, and the motor does the rest. Busy until the mechanism has unlatched. */
  pressPowerReturn() {
    const { sim } = this;
    const L = sim.layout, key = sim.geometry.keys.findIndex((k) => k.id === 'return');
    sim.pressKey(key, 14, 0.08);
    const t0 = sim.state[L.time];
    let latched = false;
    const watch = () => {
      const on = sim.state[L.returnLatched] > 0.5, waited = sim.state[L.time] - t0;
      latched ||= on;
      if ((latched && !on) || waited > 3 || (!latched && waited > 0.4)) {
        this.busy = false;
        if (this.queuedReturns) { this.queuedReturns = 0; this.carriageReturn(); }
        return;
      }
      setTimeout(watch, 8);
    };
    watch();
  }

  /** A hand that takes hold of every raised bar and eases it back to rest, the way a jam is cleared by hand. */
  freeBars() {
    const { sim } = this;
    const L = sim.layout, nPrint = sim.geometry.nPrint;
    const raised = () => { const r = []; for (let i = 0; i < nPrint; i++) if (sim.state[L.barTheta + i] > 0.04) r.push(i); return r; };
    let tries = 0;
    const pull = () => {
      const bars = raised();
      if (!bars.length || tries++ >= 4) return;
      const t0 = sim.state[L.time];
      const held = bars.map((i) => { const th = sim.state[L.barTheta + i]; return { h: sim.grab('bar', i, { target: th, k: 0.8, c: 0.015, maxF: 0.9 }), th }; });
      const step = () => {
        const f = Math.min(1, (sim.state[L.time] - t0) / 0.4);
        for (const b of held) sim.moveGrab(b.h, b.th * (1 - f));
        if (f < 1) { setTimeout(step, 8); return; }
        setTimeout(() => { for (const b of held) sim.release(b.h); setTimeout(pull, 120); }, 60);
      };
      step();
    };
    pull();
  }

  /**
   * Winds a sheet into the machine the way a typist does: turns the platen knob until the sheet is past the first line,
   * then backs off to it. Both stopping points are the sheet's real position at the print point, measured with the ray
   * the printer uses, so a slipping feed still ends at the top margin. { fresh: true } first lays a clean sheet on the table.
   * Reset paper, Reset all and start-up all come through here.
   */
  loadPaper({ fresh = true, marginM = 0.025, overM = 0.012, rateRadPerS = 3.5, backRadPerS = 1.5 } = {}) {
    const { sim, soft } = this;
    if (!soft?.spawnSheet || !soft.printer) return;
    this.cancelLoad?.();
    if (fresh) soft.resetPaper();
    const L = sim.layout, geo = sim.geometry;
    let cancelled = false, g = null, bail = null;
    const finish = () => {
      if (g !== null) sim.release(g);
      if (bail !== null) sim.release(bail);
      g = bail = null;
      this.cancelLoad = null;
    };
    this.cancelLoad = () => { cancelled = true; finish(); };
    const sheetAtPrint = () => soft.printer.locateOnSheet(geo.printPoint, geo.printNormal, [1, 0, 0], soft.printer.Tup)?.v0 ?? null;
    setTimeout(() => {
      if (cancelled) return;
      const start = sim.state[L.platenPsi];
      g = sim.grab('platen', 0, { target: start, k: 4, c: 0.08, maxF: 2.5 });
      // A typist flips the bail clear while feeding, or the leading edge buckles against it.
      bail = sim.grab('bail', 0, { target: this.m.paper.bailTravel * 1.2, k: 1.5, c: 0.03, maxF: 0.8 });
      const t0 = sim.state[L.time];
      let target = start, last = t0, phase = 'forward', until = 0;
      const step = () => {
        if (cancelled) return;
        const now = sim.state[L.time], dt = now - last; last = now;
        const v = sheetAtPrint();
        if (now - t0 > 8) { finish(); return; }
        if (phase === 'forward') {
          target += rateRadPerS * dt;
          if (v !== null && v >= marginM + overM) { phase = 'pause'; until = now + 0.12; }
        } else if (phase === 'pause') {
          if (now >= until) phase = 'back';
        } else if (phase === 'back') {
          target -= backRadPerS * dt;
          if (v !== null && v <= marginM) { target = sim.state[L.platenPsi]; phase = 'settle'; until = now + 0.12; }
        } else if (now >= until) { finish(); return; }
        sim.moveGrab(g, target);
        setTimeout(step, 8);
      };
      step();
    }, 400);
  }
}
