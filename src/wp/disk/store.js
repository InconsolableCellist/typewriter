// Where diskette images persist between visits (architecture 8.5): { load(id), save(id, bytes), list(), remove(id) }.
// The browser kit supplies an IndexedDB store; Node and the fallback use this one.

export class MemoryStore {
  constructor() { this.records = new Map(); }
  load(id) { const b = this.records.get(id); return b ? b.slice() : null; }
  save(id, bytes) { this.records.set(id, bytes.slice()); }
  list() { return [...this.records.keys()]; }
  remove(id) { this.records.delete(id); }
}
