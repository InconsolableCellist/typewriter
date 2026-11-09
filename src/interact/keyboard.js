// Physical keyboard to simulated fingers. Nothing here deposits text; a key press is a force on a DOF.
// A real keyboard says nothing about how hard a key was hit, so each keystroke is a complete timed press at the slider's
// force with a little human variation: slight darker and lighter letters, weaker and less even from the little fingers.
export const STROKE = { durationS: 0.075, jitter: 0.06, pinkyJitter: 0.10, pinkyBias: 0.97 };

export class KeyboardInput {
  constructor({ sim, geometry: g, machine: m, ui, hands }) {
    this.sim = sim; this.g = g; this.m = m; this.ui = ui; this.hands = hands;
    this.map = new Map();
    g.keys.forEach((k, i) => {
      if (k.kind === 'print') { this.map.set(k.lower, i); this.map.set(k.upper, i); }
    });
    this.idx = (id) => g.keys.findIndex((k) => k.id === id);
    this.shiftGrab = null;
    window.addEventListener('keydown', (e) => this.down(e));
    window.addEventListener('keyup', (e) => this.up(e));
    this.held = new Map();      // physical key -> the timer or grab keeping a repeating key down
    window.addEventListener('blur', () => { this.releaseShift(); for (const c of [...this.held.keys()]) this.letGo(c); });
  }

  down(e) {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) && e.target.type !== 'range') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { sim, g } = this;
    const force = this.ui.strikeForce();
    if (e.key === 'Shift') {
      if (!e.repeat && !this.shiftGrab) this.grabShift();
      return;
    }
    if (e.repeat) return;
    if (e.key === 'CapsLock') {
      const i = this.idx('shiftLock');
      if (i >= 0) sim.pressKey(i, 22, 0.12);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); this.hands.carriageReturn(); return; }   // on a powered machine that presses its Return key
    if (e.key === ' ') { e.preventDefault(); const i = this.idx('space'); if (i >= 0) { this.strike(i, force * 0.8); this.holdDown(e.code, i, this.m.keys.holdDelayS); } return; }
    if (e.key === 'Backspace') { e.preventDefault(); const i = this.idx('backspace'); if (i >= 0) { this.strike(i, force * 0.9); this.holdDown(e.code, i, this.m.keys.holdDelayS); } return; }
    if (e.key === 'Delete') { const i = this.idx('correct'); if (i >= 0) { e.preventDefault(); this.strike(i, force * 0.9); } return; }
    if (e.key === 'Tab') { e.preventDefault(); const i = this.idx('tab'); if (i >= 0) { this.strike(i, force * 0.8); this.holdDown(e.code, i, this.m.keys.holdDelayS !== undefined ? 0 : undefined); } return; }
    const i = this.map.get(e.key);
    if (i !== undefined) {
      e.preventDefault();
      this.strike(i, force * g.keys[i].finger);
    }
  }

  strike(i, force) {
    const k = this.g.keys[i];
    const pinky = (k.finger ?? 1) <= 0.9;
    const spread = pinky ? STROKE.pinkyJitter : STROKE.jitter;
    const jitter = (pinky ? STROKE.pinkyBias : 1) * (1 + (Math.random() * 2 - 1) * spread);
    this.sim.pressKey(i, force * jitter, this.m.keys.strokeS ?? STROKE.durationS);
  }

  /** A key that does something more while held keeps being pressed after its stroke, once the delay shows it was not a tap. */
  holdDown(code, i, delayS) {
    if (delayS === undefined) return;
    this.letGo(code);
    const entry = { grab: null, timer: 0 };
    entry.timer = setTimeout(() => {
      entry.timer = 0;
      entry.grab = this.sim.grab('key', i, { target: this.g.keys[i].travel * 1.5, k: 2200, c: 18, maxF: 30 });
    }, delayS * 1000);
    this.held.set(code, entry);
  }

  letGo(code) {
    const entry = this.held.get(code);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.grab) this.sim.release(entry.grab);
    this.held.delete(code);
  }

  up(e) {
    if (e.key === 'Shift') this.releaseShift();
    this.letGo(e.code);
  }

  grabShift() {
    const { sim, g } = this;
    const i = this.idx('shiftL');
    if (i < 0) return;
    const k = g.keys[i];
    this.shiftGrab = sim.grab('key', i, { target: k.travel * 1.5, k: 2200, c: 18, maxF: 30 });
  }

  releaseShift() { if (this.shiftGrab) { this.sim.release(this.shiftGrab); this.shiftGrab = null; } }
}
