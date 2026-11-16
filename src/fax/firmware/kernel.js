// The firmware's clock and tasks, after src/wp/sched.js: a task is a generator that yields a request and is resumed
// with the answer. All waiting is on the simulated clock or on an event, so the firmware runs headless and a test can
// jump the clock. Nothing happens between calls: `post` and `advance` run every runnable task until each one blocks.
//
// Requests (use the helpers at the bottom inside tasks):
//   { op: 'wait', s }                        resume after s seconds
//   { op: 'event', accept, timeout }         resume with the first posted event `accept(ev)` takes, or with
//                                            { dev: 'fw', ev: 'timeout' } after `timeout` seconds (if given)
//   { op: 'join', task }                     resume when another task finishes, with its return value
//
// Events: every event is shown first to `onEvent` (the firmware's background handler: sensor state, the clock line on
// the LCD), then to the tasks waiting for events, in the order they began waiting; the first that accepts it takes
// it. An event no task accepts is dropped (a key pressed where it means nothing does nothing, as on the machine).
// Events posted while a task runs wait in the queue until the running stops, then go round the same way.

export class Kernel {
  constructor(t0 = 0) {
    this.t = t0;
    this.timers = [];        // { t, seq, fn }, sorted
    this.seq = 0;
    this.tasks = [];
    this.queue = [];
    this.running = false;
    this.onEvent = null;     // (ev) => void
    this.dropped = 0;
  }

  // ---- the clock interface handed to drivers (call.js, the virtual devices) --------------------------------------

  now() { return this.t; }

  at(t, fn) {
    const timer = { t: Math.max(t, this.t), seq: this.seq++, fn, dead: false };
    let i = this.timers.length;
    while (i > 0 && this.timers[i - 1].t > timer.t) i--;
    this.timers.splice(i, 0, timer);
    return timer;
  }

  cancel(timer) {
    if (!timer || timer.dead) return;
    timer.dead = true;
    const i = this.timers.indexOf(timer);
    if (i >= 0) this.timers.splice(i, 1);
  }

  get clock() {
    return { now: () => this.t, at: (t, fn) => this.at(t, fn), cancel: (h) => this.cancel(h) };
  }

  // ---- tasks -----------------------------------------------------------------------------------------------------

  spawn(gen, name = 'task') {
    const task = { gen, name, state: 'ready', value: undefined, accept: null, timer: null, waiters: [], result: undefined, error: null, since: 0 };
    this.tasks.push(task);
    this.run();
    return task;
  }

  kill(task) {
    if (!task || task.state === 'done') return;
    this.cancel(task.timer);
    task.state = 'done';
    try { task.gen.return(undefined); } catch { /* a finally that throws: the task is gone anyway */ }
    for (const w of task.waiters) this._resume(w, undefined);
    this.run();
  }

  /** Throw `err` into a task at its current wait (STOP pressed while it waits); it may catch it. */
  throwInto(task, err) {
    if (!task || task.state === 'done' || task.state === 'ready') return;
    this.cancel(task.timer);
    task.state = 'ready';
    task.value = undefined;
    task.throwing = err;
    this.run();
  }

  post(ev) {
    this.queue.push(ev);
    this.run();
  }

  _resume(task, value) {
    this.cancel(task.timer);
    task.timer = null;
    task.state = 'ready';
    task.value = value;
    task.accept = null;
  }

  run() {
    if (this.running) return;
    this.running = true;
    try {
      for (let guard = 0; guard < 100000; guard++) {
        let did = false;
        while (this.queue.length) {
          const ev = this.queue.shift();
          this.onEvent?.(ev);
          const taker = this.tasks.find((k) => k.state === 'event' && (!k.accept || k.accept(ev)));
          if (taker) this._resume(taker, ev); else this.dropped++;
          did = true;
        }
        for (const task of this.tasks) if (task.state === 'ready') { this._step(task); did = true; }
        this.tasks = this.tasks.filter((k) => k.state !== 'done');
        if (!did) break;
      }
    } finally {
      this.running = false;
    }
  }

  _step(task) {
    let r;
    try {
      if (task.throwing) { const e = task.throwing; task.throwing = null; r = task.gen.throw(e); }
      else { const v = task.value; task.value = undefined; r = task.gen.next(v); }
    } catch (e) {
      task.state = 'done';
      task.error = e;
      for (const w of task.waiters) this._resume(w, undefined);
      if (this.onTaskError) this.onTaskError(task, e); else throw e;
      return;
    }
    if (r.done) {
      task.state = 'done';
      task.result = r.value;
      for (const w of task.waiters) this._resume(w, r.value);
      return;
    }
    const q = r.value;
    task.since = this.t;
    switch (q.op) {
      case 'wait':
        task.state = 'timer';
        task.timer = this.at(this.t + q.s, () => this._resume(task, undefined));
        break;
      case 'event':
        task.state = 'event';
        task.accept = q.accept ?? null;
        if (q.timeout != null && Number.isFinite(q.timeout)) {
          task.timer = this.at(this.t + q.timeout, () => { if (task.state === 'event') this._resume(task, { dev: 'fw', ev: 'timeout' }); });
        }
        break;
      case 'join':
        if (q.task.state === 'done') this._resume(task, q.task.result);
        else { task.state = 'join'; q.task.waiters.push(task); }
        break;
      default: throw new Error(`unknown request ${q.op}`);
    }
  }

  /** Move the clock to t, running each timer due on the way at its own time. */
  advance(t) {
    this.run();
    while (this.timers.length && this.timers[0].t <= t) {
      const timer = this.timers.shift();
      timer.dead = true;
      if (timer.t > this.t) this.t = timer.t;
      timer.fn();
      this.run();
    }
    if (t > this.t) this.t = t;
  }

  runFor(s) { this.advance(this.t + s); }

  /** Advance until pred() holds (checked after every timer), or `limit` seconds pass. Returns pred(). */
  runUntil(pred, limit = 600) {
    const end = this.t + limit;
    this.run();
    while (!pred()) {
      if (!this.timers.length || this.timers[0].t > end) { this.advance(end); return pred(); }
      this.advance(this.timers[0].t);
    }
    return true;
  }
}

export function* wait(s) { return yield { op: 'wait', s }; }
export function* event(accept, timeout) { return yield { op: 'event', accept, timeout }; }
export function* join(task) { return yield { op: 'join', task }; }
