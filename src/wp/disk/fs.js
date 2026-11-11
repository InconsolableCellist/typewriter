// Our file layout inside the documented geometry (architecture 8.2). The machine's own format is not documented.
//
//   Volume label   track 00, side 0, sector 1: signature, version, name (6), kind, media type
//   Settings       track 00, sectors 2 to 9 of a program diskette (1 KB of JSON)
//   Free map       LSN 0 onward, one bit per data sector, raw (no chain header)
//   Index          a chain from the sector after the free map; two 124-byte entries per sector
//   Document head  a chain: formats, flags and the page table, as JSON
//   Page           a chain: the page's 16-bit code units, then its object table as JSON
//
// Every chain sector starts with a 4-byte header (next LSN, bytes used), so a sector carries 252 bytes and two index
// entries of 124 bytes. Allocation is first fit, sector by sector, so a diskette fragments with use and Condense
// Diskette has real work to do. Every operation is a generator that yields one transfer per run of sectors on one
// track side; the bytes are copied between the image and memory when the transfer completes (architecture 7.6).
// A volume opened with drive = null touches the image directly and never yields: that builds fixture diskettes.
import { MEDIA, SECTOR, dataSectors, lsnAddress } from './geometry.js';
import { sectorView } from './image.js';
import { io } from '../sched.js';

const SIGNATURE = 'WP80';
const END = 0xffff;
const PAYLOAD = SECTOR - 4;
const ENTRY = 124;
export const KIND = { WORK: 1, PROGRAM: 2 };
export const DOC_TYPE = { 1: 'Document', 2: 'File', 3: 'File Setup', 4: 'Sys. Doc.', 5: 'Unknown' };
export const FLAG = { USED: 1, OPEN: 2 };

export class DiskError extends Error {
  constructor(code, drive) { super(`diskette ${code} on drive ${drive}`); this.code = code; this.drive = drive; }
}

function latin1(bytes) { let s = ''; for (const b of bytes) { if (!b) break; s += String.fromCharCode(b); } return s; }
function putLatin1(dst, off, s, n) { for (let i = 0; i < n; i++) dst[off + i] = i < s.length ? s.charCodeAt(i) & 0xff : 0; }
export function encodeJson(v) {
  const s = JSON.stringify(v).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
export function decodeJson(b) { let s = ''; for (const c of b) s += String.fromCharCode(c); return JSON.parse(s); }

export class Volume {
  constructor(image, drive = null) {
    this.image = image;
    this.drive = drive;
    this.m = MEDIA[image.type];
    this.total = dataSectors(this.m);
    this.mapSectors = Math.ceil(this.total / 8 / SECTOR);
    this.formatted = false;
    this.detached = false;       // the diskette was taken out after this volume was mounted
    this.label = null;
    this.map = new Uint8Array(this.mapSectors * SECTOR);
    this.entries = [];          // by slot; null for a free slot
    this.indexLsns = [];
  }

  get name() { return this.formatted ? this.label.name : '******'; }
  get isProgram() { return this.formatted && this.label.kind === KIND.PROGRAM; }

  // ---- transfers -------------------------------------------------------------------------------------------------

  *xfer(track, side, sector, count, write) {
    if (this.detached) throw new DiskError('notReady', this.drive);
    if (this.drive === null) return;
    const r = yield* io({ dev: 'disk', op: 'transfer', drive: this.drive, track, side, sector, count, write });
    if (!r.ok) throw new DiskError(r.error, this.drive);
    if (write) this.image.version++;
  }

  /** Runs of consecutive sectors on one track side, in the order given. */
  runs(lsns) {
    const out = [];
    for (const lsn of lsns) {
      const a = lsnAddress(this.m, lsn), r = out[out.length - 1];
      if (r && r.track === a.track && r.side === a.side && r.sector + r.lsns.length === a.sector) r.lsns.push(lsn);
      else out.push({ ...a, lsns: [lsn] });
    }
    return out;
  }

  *read(lsns) {
    const out = [];
    for (const r of this.runs(lsns)) {
      yield* this.xfer(r.track, r.side, r.sector, r.lsns.length, false);
      for (let k = 0; k < r.lsns.length; k++) out.push(sectorView(this.image, r.track, r.side, r.sector + k).slice());
    }
    return out;
  }

  *write(lsns, datas) {
    let i = 0;
    for (const r of this.runs(lsns)) {
      for (let k = 0; k < r.lsns.length; k++) {
        const v = sectorView(this.image, r.track, r.side, r.sector + k);
        v.fill(0); v.set(datas[i++].subarray(0, SECTOR));
      }
      yield* this.xfer(r.track, r.side, r.sector, r.lsns.length, true);
    }
  }

  *readTrack0(sector, count = 1) {
    yield* this.xfer(0, 0, sector, count, false);
    const out = [];
    for (let k = 0; k < count; k++) out.push(sectorView(this.image, 0, 0, sector + k).slice());
    return out;
  }

  *writeTrack0(sector, datas) {
    datas.forEach((d, k) => { const v = sectorView(this.image, 0, 0, sector + k); v.fill(0); v.set(d.subarray(0, v.length)); });
    yield* this.xfer(0, 0, sector, datas.length, true);
  }

  // ---- mount and format ------------------------------------------------------------------------------------------

  *mount() {
    const [b] = yield* this.readTrack0(1);
    this.formatted = latin1(b.subarray(0, 4)) === SIGNATURE;
    if (!this.formatted) return this;
    this.label = { name: latin1(b.subarray(5, 11)).trimEnd(), kind: b[11], media: b[12] === 2 ? '2D' : '1' };
    const mapLsns = Array.from({ length: this.mapSectors }, (_, i) => i);
    const maps = yield* this.read(mapLsns);
    maps.forEach((s, i) => this.map.set(s, i * SECTOR));
    yield* this.readIndex();
    return this;
  }

  *readIndex() {
    this.entries = []; this.indexLsns = [];
    for (let lsn = this.mapSectors; lsn !== END;) {
      const [s] = yield* this.read([lsn]);
      this.indexLsns.push(lsn);
      for (let k = 0; k < 2; k++) {
        const e = decodeEntry(s.subarray(4 + k * ENTRY, 4 + (k + 1) * ENTRY));
        if (e) e.slot = this.entries.length;
        this.entries.push(e);
      }
      lsn = s[0] | (s[1] << 8);
    }
  }

  labelBytes(name, kind) {
    const b = new Uint8Array(128);
    putLatin1(b, 0, SIGNATURE, 4);
    b[4] = 1;
    putLatin1(b, 5, name.padEnd(6), 6);
    b[11] = kind; b[12] = this.image.type === '2D' ? 2 : 1;
    return b;
  }

  /** Erase or initialize: a fresh label, free map and empty index. `writeAll` writes every data track first. */
  *format(name, kind = KIND.WORK, { writeAll = false } = {}) {
    if (writeAll) {
      const zero = new Uint8Array(SECTOR);
      const perTrack = this.m.spt * this.m.sides;
      for (let t = 0; t < this.total; t += perTrack) {
        const lsns = Array.from({ length: perTrack }, (_, i) => t + i);
        yield* this.write(lsns, lsns.map(() => zero));
      }
    }
    yield* this.writeTrack0(1, [this.labelBytes(name, kind)]);
    this.label = { name, kind, media: this.image.type };
    this.formatted = true;
    this.map.fill(0);
    for (let i = 0; i <= this.mapSectors; i++) this.mark(i, true);
    this.entries = [null, null];
    this.indexLsns = [this.mapSectors];
    yield* this.flushMap();
    yield* this.writeIndexSector(0);
  }

  *rename(name) {
    yield* this.writeTrack0(1, [this.labelBytes(name, this.label.kind)]);
    this.label.name = name;
  }

  // ---- free map --------------------------------------------------------------------------------------------------

  used(lsn) { return (this.map[lsn >> 3] >> (lsn & 7)) & 1; }
  mark(lsn, on) { if (on) this.map[lsn >> 3] |= 1 << (lsn & 7); else this.map[lsn >> 3] &= ~(1 << (lsn & 7)); }
  get free() { let n = 0; for (let i = 0; i < this.total; i++) if (!this.used(i)) n++; return n; }

  /** n free sectors, lowest first. Throws 'full' without allocating if there are not enough. */
  alloc(n) {
    const out = [];
    for (let i = 0; i < this.total && out.length < n; i++) if (!this.used(i)) out.push(i);
    if (out.length < n) throw new DiskError('full', this.drive);
    for (const lsn of out) this.mark(lsn, true);
    return out;
  }

  /** n free sectors in one run (program segments). */
  allocRun(n) {
    for (let i = 0; i + n <= this.total; i++) {
      let k = 0;
      while (k < n && !this.used(i + k)) k++;
      if (k === n) { for (let j = 0; j < n; j++) this.mark(i + j, true); return Array.from({ length: n }, (_, j) => i + j); }
      i += k;
    }
    throw new DiskError('full', this.drive);
  }

  release(lsns) { for (const lsn of lsns) this.mark(lsn, false); }

  *flushMap() {
    const lsns = Array.from({ length: this.mapSectors }, (_, i) => i);
    yield* this.write(lsns, lsns.map((i) => this.map.subarray(i * SECTOR, (i + 1) * SECTOR)));
  }

  stats() {
    return { available: Math.floor(100 * this.free / this.total), unusable: 0 };
  }

  // ---- chains ----------------------------------------------------------------------------------------------------

  *readChain(first) {
    const lsns = [], parts = [];
    for (let lsn = first; lsn !== END;) {
      if (lsn >= this.total || lsns.length > this.total) throw new DiskError('chain', this.drive);
      const [s] = yield* this.read([lsn]);
      lsns.push(lsn);
      parts.push(s.subarray(4, 4 + (s[2] | (s[3] << 8))));
      lsn = s[0] | (s[1] << 8);
    }
    const n = parts.reduce((a, p) => a + p.length, 0);
    const bytes = new Uint8Array(n);
    let off = 0;
    for (const p of parts) { bytes.set(p, off); off += p.length; }
    return { bytes, lsns };
  }

  /** Lay bytes out as a new chain; returns its sectors (first is the chain's address). */
  *writeChain(bytes) {
    const n = Math.max(1, Math.ceil(bytes.length / PAYLOAD));
    const lsns = this.alloc(n);
    const datas = lsns.map((lsn, i) => {
      const part = bytes.subarray(i * PAYLOAD, (i + 1) * PAYLOAD);
      const s = new Uint8Array(SECTOR);
      const next = i + 1 < n ? lsns[i + 1] : END;
      s[0] = next & 0xff; s[1] = next >> 8; s[2] = part.length & 0xff; s[3] = part.length >> 8;
      s.set(part, 4);
      return s;
    });
    yield* this.write(lsns, datas);
    return lsns;
  }

  /** The sectors of a chain, read only for their headers. */
  *chainLsns(first) { return (yield* this.readChain(first)).lsns; }

  // ---- index -----------------------------------------------------------------------------------------------------

  *writeIndexSector(k) {
    const s = new Uint8Array(SECTOR);
    const next = k + 1 < this.indexLsns.length ? this.indexLsns[k + 1] : END;
    s[0] = next & 0xff; s[1] = next >> 8; s[2] = 2 * ENTRY; s[3] = 0;
    for (let j = 0; j < 2; j++) encodeEntry(this.entries[2 * k + j], s.subarray(4 + j * ENTRY, 4 + (j + 1) * ENTRY));
    yield* this.write([this.indexLsns[k]], [s]);
  }

  /** Put an entry in a free slot (growing the index chain if needed) and write it. */
  *addEntry(e) {
    let slot = this.entries.indexOf(null);
    if (slot < 0) {
      const [lsn] = this.alloc(1);
      this.indexLsns.push(lsn);
      this.entries.push(null, null);
      slot = this.entries.length - 2;
      yield* this.writeIndexSector(this.indexLsns.length - 2);   // relink the previous last sector
    }
    e.slot = slot;
    e.order = 1 + Math.max(0, ...this.docs().map((d) => d.order));
    this.entries[slot] = e;
    yield* this.writeIndexSector(slot >> 1);
    return e;
  }

  *writeEntry(e) { this.entries[e.slot] = e; yield* this.writeIndexSector(e.slot >> 1); }

  *removeEntry(e) { this.entries[e.slot] = null; yield* this.writeIndexSector(e.slot >> 1); }

  /** Index entries in creation order (SR 9: the sample is not alphabetical). */
  docs() { return this.entries.filter(Boolean).sort((a, b) => a.order - b.order); }

  find(name) { return this.entries.find((e) => e && e.name === name) ?? null; }

  // ---- documents -------------------------------------------------------------------------------------------------

  *readHead(e) {
    const { bytes, lsns } = yield* this.readChain(e.first);
    return { head: decodeJson(bytes), lsns };
  }

  *readPage(lsn) {
    const { bytes, lsns } = yield* this.readChain(lsn);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint32(0, true);
    const units = new Uint16Array(n);
    for (let i = 0; i < n; i++) units[i] = dv.getUint16(4 + 2 * i, true);
    const objects = decodeJson(bytes.subarray(4 + 2 * n));
    return { units, objects, lsns };
  }

  /** A page as a new chain; returns its sectors. */
  *writePage(units, objects) {
    const json = encodeJson(objects);
    const b = new Uint8Array(4 + 2 * units.length + json.length);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, units.length, true);
    for (let i = 0; i < units.length; i++) dv.setUint16(4 + 2 * i, units[i], true);
    b.set(json, 4 + 2 * units.length);
    return yield* this.writeChain(b);
  }

  *writeJson(v) { return yield* this.writeChain(encodeJson(v)); }

  /** Every sector a document occupies: its head and its pages. */
  *docLsns(e) {
    const { head, lsns } = yield* this.readHead(e);
    const out = [...lsns];
    for (const p of head.pages) out.push(...(yield* this.chainLsns(p.lsn)));
    return out;
  }

  *deleteDoc(e) {
    this.release(yield* this.docLsns(e));
    yield* this.removeEntry(e);
    yield* this.flushMap();
  }

  /**
   * Rebuild the free map from the label, the index and every chain they reach (Recover Documents). Returns the
   * entries whose chains could not be read.
   */
  *rebuildMap() {
    this.map.fill(0);
    for (let i = 0; i < this.mapSectors; i++) this.mark(i, true);
    for (const lsn of this.indexLsns) this.mark(lsn, true);
    const bad = [];
    for (const e of this.docs()) {
      try { for (const lsn of yield* this.docLsns(e)) this.mark(lsn, true); }
      catch (err) { if (err instanceof DiskError) bad.push(e); else throw err; }
    }
    return bad;
  }

  // ---- program diskette ------------------------------------------------------------------------------------------

  *readSettings() {
    const ss = yield* this.readTrack0(2, 8);
    const b = new Uint8Array(8 * 128);
    ss.forEach((s, i) => b.set(s, i * 128));
    const end = b.indexOf(0);
    return end > 0 ? decodeJson(b.subarray(0, end)) : null;
  }

  *writeSettings(v) {
    const json = encodeJson(v);
    if (json.length >= 8 * 128) throw new Error('settings too large');
    const datas = Array.from({ length: 8 }, (_, i) => { const s = new Uint8Array(128); s.set(json.subarray(i * 128, (i + 1) * 128)); return s; });
    yield* this.writeTrack0(2, datas);
  }

  /** Read a run of sectors recorded in an index entry (a program segment) for its timing; the data is not used. */
  *readRun(e) {
    const lsns = Array.from({ length: e.count }, (_, i) => e.first + i);
    for (const r of this.runs(lsns)) yield* this.xfer(r.track, r.side, r.sector, r.lsns.length, false);
  }
}

function decodeEntry(b) {
  if (!(b[89] & FLAG.USED)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    name: latin1(b.subarray(0, 44)), comment: latin1(b.subarray(44, 88)), type: b[88], flags: b[89],
    first: dv.getUint16(90, true), count: dv.getUint16(92, true), length: dv.getUint32(94, true), order: dv.getUint16(98, true),
  };
}

function encodeEntry(e, b) {
  b.fill(0);
  if (!e) return;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  putLatin1(b, 0, e.name, 44); putLatin1(b, 44, e.comment ?? '', 44);
  b[88] = e.type; b[89] = e.flags | FLAG.USED;
  dv.setUint16(90, e.first ?? END, true); dv.setUint16(92, e.count ?? 0, true);
  dv.setUint32(94, e.length ?? 0, true); dv.setUint16(98, e.order ?? 0, true);
}

/** Drive a generator that never yields (a volume with drive = null) to its result. */
export function runSync(gen) {
  const r = gen.next();
  if (!r.done) throw new Error('runSync: the operation tried to wait for a device');
  return r.value;
}
