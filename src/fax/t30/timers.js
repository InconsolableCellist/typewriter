// T.30 timers and the fixed timings of the procedure, all in seconds, all parameters. [M] = from memory of the
// Recommendation (not checked against the text; milestone M0 checks it).
//
// No clock is read here: a TimerSet holds absolute expiry times on the caller's time base (seconds, or a sample
// count divided by the sample rate) and reports which have passed when asked.

/** The four timers of T.30 section 5, with their tolerances in comments [M]. */
export const T30_TIMERS = Object.freeze({
  T1: 35,   // 35 +- 5 s: to identify the far end as a fax machine (phase A/B), and the called end's DIS repeat window
  T2: 6,    // 6 +- 1 s: a receiver waiting for a command (or the page carrier)
  T3: 10,   // 10 +- 5 s: to alert the operator after a procedure interrupt (PIP/PIN; unused in the base procedure)
  T4: 3,    // 3 s +- 15 %: a commander waiting for a response before repeating the command
});

/** Fixed timings of the procedure [M unless noted]. */
export const T30_TIMING = Object.freeze({
  cngOn: 0.5,          // CNG: 1100 Hz, 0.5 s on
  cngOff: 3.0,         //      3 s off
  cngHz: 1100,
  cedDelay: 2.0,       // CED starts 1.8 to 2.5 s after the called station connects
  cedDuration: 3.0,    // CED: 2100 Hz for 2.6 to 4.0 s
  cedHz: 2100,
  gap: 0.075,          // 75 +- 20 ms of silence between signals that turn the line around, and after CED
  preamble: 1.0,       // V.21 preamble of flags, 1 s +- 15 %
  tcf: 1.5,            // training check: zeros at the message rate for 1.5 s +- 10 %
});

/** Timer values with overrides, e.g. makeTimers({ T4: 1 }) for a test. */
export function makeTimers(overrides = {}) {
  return Object.freeze({ ...T30_TIMERS, ...overrides });
}

/** Named one-shot timers on an absolute time base. */
export class TimerSet {
  constructor() { this.at = new Map(); }
  start(name, now, seconds) { this.at.set(name, now + seconds); }
  stop(name) { this.at.delete(name); }
  stopAll() { this.at.clear(); }
  running(name) { return this.at.has(name); }
  /** The earliest expiry, Infinity when none runs. */
  get deadline() { let d = Infinity; for (const v of this.at.values()) if (v < d) d = v; return d; }
  /** Names that have expired by `now`, earliest first; they are removed. */
  expire(now) {
    const out = [];
    for (const [k, v] of this.at) if (v <= now + 1e-12) out.push([v, k]);
    out.sort((a, b) => a[0] - b[0]);
    for (const [, k] of out) this.at.delete(k);
    return out.map((e) => e[1]);
  }
}
