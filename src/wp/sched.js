// The software's clock and its tasks. A task is a generator: it yields a request and is resumed with the answer.
// All waiting is waiting on the simulated clock, a device completion, a key or a signal, so the system runs headless
// and a test can jump the clock (architecture 7.2). There are no microtasks: `run()` steps every runnable task until
// each one blocks, and nothing happens between calls.

export class Scheduler {
  constructor() {
    this.t = 0;
    this.timers = [];              // { t, seq, fn } kept sorted
    this.seq = 0;
    this.tasks = [];
    this.keys = [];                // the type-ahead queue (SR 3.3): never discarded across screen changes
    this.io = new Map();           // completion id -> task
    this.nextIo = 1;
    this.onIo = null;              // (req, id) => void, set by the system
    this.onKeyTaken = null;        // (ev) => void: the click of an accepted key
  }

  spawn(gen, name = 'task') {
    const task = { gen, name, state: 'ready', value: undefined, result: undefined, accept: null, waiters: [], error: null };
    this.tasks.push(task);
    return task;
  }

  kill(task) {
    if (task.state === 'done') return;
    task.state = 'done';
    this.tasks = this.tasks.filter((t) => t !== task);
  }

  at(t, fn) {
    const timer = { t: Math.max(t, this.t), seq: this.seq++, fn };
    const i = this.timers.findIndex((x) => x.t > timer.t);
    if (i < 0) this.timers.push(timer); else this.timers.splice(i, 0, timer);
    return timer;
  }

  cancel(timer) { this.timers = this.timers.filter((x) => x !== timer); }

  pushKey(ev) { this.keys.push(ev); this.run(); }

  /** Wake every task blocked on the signal `name`, with `value`. */
  signal(name, value) {
    for (const task of this.tasks) if (task.state === 'signal' && task.signal === name) this.resume(task, value);
    this.run();
  }

  complete(id, result) {
    const task = this.io.get(id);
    if (!task) return;
    this.io.delete(id);
    this.resume(task, result);
    this.run();
  }

  resume(task, value) { task.state = 'ready'; task.value = value; }

  /** Step runnable tasks until all are blocked. */
  run() {
    if (this.running) return;
    this.running = true;
    try {
      for (let again = true; again;) {
        again = false;
        for (const task of this.tasks) {
          if (task.state === 'key') {
            while (this.keys.length && task.state === 'key') {
              const ev = this.keys.shift();
              if (task.accept && !task.accept(ev)) continue;   // an inert key: no click, keep waiting
              this.onKeyTaken?.(ev);
              this.resume(task, ev);
            }
          }
          if (task.state === 'ready') { this.step(task); again = true; }
        }
        this.tasks = this.tasks.filter((t) => t.state !== 'done');
      }
    } finally {
      this.running = false;
    }
  }

  step(task) {
    const r = task.gen.next(task.value);
    task.value = undefined;
    if (r.done) {
      task.state = 'done';
      task.result = r.value;
      for (const w of task.waiters) this.resume(w, r.value);
      return;
    }
    const q = r.value;
    switch (q.op) {
      case 'key': task.state = 'key'; task.accept = q.accept ?? null; break;
      case 'wait': task.state = 'timer'; this.at(this.t + q.s, () => this.resume(task, undefined)); break;
      case 'signal': task.state = 'signal'; task.signal = q.name; break;
      case 'io': {
        const id = this.nextIo++;
        task.state = 'io';
        this.io.set(id, task);
        this.onIo(q.req, id);
        break;
      }
      case 'join':
        if (q.task.state === 'done') this.resume(task, q.task.result);
        else { task.state = 'join'; q.task.waiters.push(task); }
        break;
      default: throw new Error(`unknown request ${q.op}`);
    }
  }

  /** Move the clock to t, running every timer that falls due on the way, each at its own time. */
  advance(t) {
    this.run();
    while (this.timers.length && this.timers[0].t <= t) {
      const timer = this.timers.shift();
      this.t = timer.t;
      timer.fn();
      this.run();
    }
    if (t > this.t) this.t = t;
  }

  get idle() {
    return this.timers.length === 0 && !this.tasks.some((t) => t.state === 'ready');
  }

  /** Jump from deadline to deadline until nothing is pending (Node). `limit` guards a runaway timer chain. */
  runUntilIdle(limit = 3600) {
    this.run();
    const end = this.t + limit;
    while (this.timers.length && this.timers[0].t <= end) this.advance(this.timers[0].t);
  }
}

// Requests, for `yield*` inside tasks.
export function* key(accept) { return yield { op: 'key', accept }; }
export function* wait(s) { return yield { op: 'wait', s }; }
export function* io(req) { return yield { op: 'io', req }; }
export function* join(task) { return yield { op: 'join', task }; }
export function* waitSignal(name) { return yield { op: 'signal', name }; }
