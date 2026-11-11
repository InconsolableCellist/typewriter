// Analytic devices for Node (architecture 7.6): the device interface the software sees, answered on the software's
// own clock with completion times from timing.js. Sector bytes stay with the software, as with the real devices;
// these only time the operations and report media. One adapter serves both drives, one operation at a time (ST p.103).
// The printer is virtual-printer.js.
import { MEDIA, sectorsPerTrack } from '../disk/geometry.js';
import { DRIVE, seek, latency, transfer, RECALIBRATE_S } from './timing.js';
import { VirtualPrinter } from './virtual-printer.js';

export class VirtualDevices {
  /**
   * drives: two entries, each null or { mediaId, type }, in place (lever closed) when the system starts.
   * printer: the virtual printer's options (power, feeder).
   */
  constructor({ drives = [null, null], printer = {} } = {}) {
    this.sys = null;
    this.drives = drives.map((d) => ({ media: d ? { ...d } : null, track: 0, known: false, headUntil: -1 }));
    this.busyUntil = 0;
    this.log = { clicks: 0, tones: [], disk: [] };
    this.power = { on: true };
    this.kbd = {
      click: () => { this.log.clicks++; },
      tone: (ms) => { this.log.tones.push({ t: this.now, ms }); },
    };
    this.disk = {
      transfer: (req) => this.transfer(req),
      recalibrate: (req) => this.recalibrate(req),
      status: (drive) => {
        const d = this.drives[drive];
        return d.media ? { ready: true, mediaId: d.media.mediaId, type: d.media.type } : { ready: false };
      },
    };
    this.printer = new VirtualPrinter(this, printer);
  }

  attach(sys) { this.sys = sys; }

  get now() { return this.sys ? this.sys.sched.t : 0; }

  post(t, evt) { this.sys.sched.at(t, () => this.sys.deviceEvent(evt)); }

  /** Put a diskette in a drive and close the lever: ready once it is up to speed. */
  insert(drive, mediaId, type = '2D') {
    const d = this.drives[drive];
    d.media = { mediaId, type };
    d.known = false;
    this.post(this.now + DRIVE.spinUpS, { dev: 'disk', ev: 'ready', drive, mediaId, type });
  }

  /** Open the lever and take the diskette out. */
  remove(drive) {
    this.drives[drive].media = null;
    this.post(this.now, { dev: 'disk', ev: 'notReady', drive });
  }

  start() { return Math.max(this.now, this.busyUntil); }

  transfer({ id, drive, side, track, sector, count, write }) {
    const d = this.drives[drive];
    let t = this.start();
    if (!d.media) { this.busyUntil = t; this.post(t + DRIVE.rotationS * 2, { dev: 'disk', id, ok: false, error: 'notReady' }); return; }
    const m = MEDIA[d.media.type];
    if (!d.known) { t += RECALIBRATE_S; d.track = 0; d.known = true; }
    t += seek(Math.abs(track - d.track));
    d.track = track;
    if (t > d.headUntil) t += DRIVE.headLoadS;
    const spt = sectorsPerTrack(m, track);
    t += latency(t, sector, spt) + transfer(count, spt);
    d.headUntil = t + DRIVE.headUnloadS;
    this.busyUntil = t;
    this.log.disk.push({ drive, track, side, sector, count, write, t });
    this.post(t, { dev: 'disk', id, ok: true });
  }

  recalibrate({ id, drive }) {
    const d = this.drives[drive];
    const t = this.start() + RECALIBRATE_S;
    d.track = 0; d.known = true;
    this.busyUntil = t;
    this.post(t, d.media ? { dev: 'disk', id, ok: true } : { dev: 'disk', id, ok: false, error: 'notReady' });
  }
}
