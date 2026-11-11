// The word processor's software: start-up, Textpack, the diskette file system. Plain modules on a simulated clock
// (architecture 7). The system talks to devices only through commands and completions; `advance` moves its clock
// and `deviceEvent` delivers what the devices report.
import { Scheduler, io } from './sched.js';
import { Screen } from './screen.js';
import { KeyDecoder } from './keys.js';
import { Library } from './disk/library.js';
import { MemoryStore } from './disk/store.js';
import { Volume, DiskError, runSync } from './disk/fs.js';
import { Messages } from './textpack/messages.js';
import { coldStart } from './rom.js';
import { shell, DEFAULT_SETTINGS } from './textpack/index.js';
import { Spooler } from './textpack/print/spooler.js';

const TONE_MS = { short: 60, long: 400 };          // assumed (architecture 5.4)
const SAVE_COALESCE_S = 1;

export function createSystem({ devices, store = new MemoryStore(), library = new Library(), options = {} }) {
  return new WpSystem({ devices, store, library, options });
}

export class WpSystem {
  constructor({ devices, store, library, options }) {
    this.devices = devices;
    this.store = store;
    this.library = library;
    this.options = options;
    this.sched = new Scheduler();
    this.screen = new Screen();
    this.decoder = new KeyDecoder();
    this.messages = new Messages(this);
    this.drives = [null, null];              // mounted volumes by drive
    this.program = { loaded: false, segment: null, loadedAt: null };
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this.lastDocument = '';
    this.lastDiskette = '';
    this.doc = null;
    this.printQueue = [];
    this.spooler = new Spooler(this);
    this.pendingIo = new Map();
    this.saves = new Map();
    this.statusFields = null;                // the status fields last drawn, so a mount can refresh G and H
    this.sched.onIo = (req, id) => this.dispatch(req, id);
    this.sched.onKeyTaken = () => this.devices.kbd.click();
    devices.attach?.(this);
    this.screen.clear();
    if (options.cold) { if (devices.power?.on !== false) this.powerOn(); }
    else this.warmStart();
  }

  get now() { return this.sched.t; }
  get idle() { return this.sched.idle; }
  advance(t) { this.sched.advance(t); }
  runUntilIdle(limit) { this.sched.runUntilIdle(limit); }

  powerOn() { this.sched.spawn(coldStart(this), 'rom'); this.sched.run(); }

  /** Powered, program loaded, TASK SELECTION on screen (architecture decision 9). */
  warmStart() {
    for (const d of [0, 1]) {
      const s = this.devices.disk.status(d);
      if (!s.ready) continue;
      const vol = this.peekVolume(s.mediaId);
      if (!vol) continue;
      if (vol.isProgram) this.settings = { ...this.settings, ...(runSync(vol.readSettings()) ?? {}) };
      vol.drive = d;
      this.drives[d] = vol;
    }
    this.program.loaded = true;
    this.program.loadedAt = this.now;
    this.startTextpack();
  }

  /** Mount an image without the drive (no time passes): the warm start, and a look at a diskette before loading. */
  peekVolume(mediaId) {
    const img = this.library.get(mediaId);
    return img ? runSync(new Volume(img).mount()) : null;
  }

  startTextpack() { this.sched.spawn(shell(this), 'textpack'); this.sched.run(); }

  // ---- devices ---------------------------------------------------------------------------------------------------

  deviceEvent(evt) {
    switch (evt.dev) {
      case 'kbd': {
        if (evt.ev !== 'scan') return;
        const ev = this.decoder.decode(evt.byte);
        if (ev) this.sched.pushKey(ev);
        return;
      }
      case 'disk':
        if (evt.id != null) {
          const req = this.pendingIo.get(evt.id);
          this.pendingIo.delete(evt.id);
          if (req?.write && evt.ok) this.scheduleSave(this.drives[req.drive]?.image);
          this.sched.complete(evt.id, evt);
        } else if (evt.ev === 'ready') {
          if (this.program.loaded) this.sched.spawn(this.mountDrive(evt.drive), 'mount');
          this.sched.signal('diskReady', evt.drive);
        } else if (evt.ev === 'notReady') {
          if (this.drives[evt.drive]) this.drives[evt.drive].detached = true;
          this.drives[evt.drive] = null;
          this.refreshDiskNames();
          this.sched.signal('diskGone', evt.drive);
        }
        return;
      case 'printer':
        this.spooler.event(evt);
        return;
      case 'power':
        if (evt.ev === 'on') this.powerOn();
        return;
      default:
    }
  }

  dispatch(req, id) {
    if (req.dev !== 'disk') throw new Error(`no device ${req.dev}`);
    this.pendingIo.set(id, req);
    if (req.op === 'recalibrate') this.devices.disk.recalibrate({ id, drive: req.drive });
    else this.devices.disk.transfer({ ...req, id });
  }

  /** Read a diskette that has just come ready: recalibrate (the buzz on closing the lever), label, map and index. */
  *mountDrive(drive) {
    const st = this.devices.disk.status(drive);
    if (!st.ready) return null;
    const img = this.library.get(st.mediaId);
    if (!img) return null;
    yield* io({ dev: 'disk', op: 'recalibrate', drive });
    const vol = new Volume(img, drive);
    try { yield* vol.mount(); } catch (e) { if (e instanceof DiskError) return null; throw e; }
    this.drives[drive] = vol;
    this.refreshDiskNames();
    this.sched.signal('mounted', drive);
    return vol;
  }

  scheduleSave(img) {
    if (!img || this.saves.has(img.id)) return;
    this.saves.set(img.id, this.sched.at(this.now + SAVE_COALESCE_S, () => {
      this.saves.delete(img.id);
      this.store.save(img.id, img.bytes);
    }));
  }

  tone(kind) { this.devices.kbd.tone(TONE_MS[kind] ?? kind); }

  // ---- volumes ---------------------------------------------------------------------------------------------------

  /** The mounted volume with this name, or null. */
  volume(name) { return this.drives.find((v) => v && v.formatted && v.name === name) ?? null; }
  workVolumes() { return this.drives.filter((v) => v && v.formatted && !v.isProgram); }
  programVolume() { return this.drives.find((v) => v && v.isProgram) ?? null; }

  // ---- status lines ----------------------------------------------------------------------------------------------

  diskName(d) { const v = this.drives[d]; return v ? v.name : ''; }

  /** Status lines 1 and 2 with the diskette names and the keyboard number; other fields as given. */
  drawStatus(fields = {}) {
    this.statusFields = { G: this.diskName(0), H: this.diskName(1), K: `Kyb ${this.settings.keyboard ?? 1}`, ...fields };
    this.screen.status(this.statusFields);
  }

  refreshDiskNames() {
    if (!this.statusFields) return;
    this.screen.field('G', this.diskName(0));
    this.screen.field('H', this.diskName(1));
  }
}
