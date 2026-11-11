// The diskettes that exist, by media id: the images the software copies sectors to and from (architecture 7.6),
// and the factory for blank, work and program diskettes.
import { createImage } from './image.js';
import { Volume, KIND, runSync } from './fs.js';

export class Library {
  constructor() { this.images = new Map(); }
  add(img) { this.images.set(img.id, img); return img; }
  get(id) { return this.images.get(id) ?? null; }
}

// Program segments, in 256-byte sectors: nucleus 180 KB, typing 60 KB, work diskette tasks 40 KB, spelling 50 KB
// (architecture 8.2). Their sizes are what make the documented waits come out of the drive; their bytes are zeros.
export const SEGMENTS = { nucleus: 720, typing: 240, workdisk: 160, spelling: 200 };
export const PROGRAM_NAME = 'CMBDSK';     // a combined program diskette (SS 0, ORG p.235)

export function blankDiskette(id, type = '2D') { return createImage(id, type); }

/** A formatted, empty work diskette. */
export function workDiskette(id, name, type = '2D') {
  const img = createImage(id, type);
  runSync(new Volume(img).format(name, KIND.WORK));
  return img;
}

/** The combined program diskette: its index lists the segments, each one contiguous; the settings are real. */
export function programDiskette(id = PROGRAM_NAME, settings = null) {
  const img = createImage(id, '2D');
  const v = new Volume(img);
  runSync(v.format(PROGRAM_NAME, KIND.PROGRAM));
  for (const [name, n] of Object.entries(SEGMENTS)) {
    const lsns = v.allocRun(n);
    runSync(v.addEntry({ name, comment: 'Textpack 4', type: 4, flags: 0, first: lsns[0], count: n, length: n * 256 }));
  }
  runSync(v.flushMap());
  if (settings) runSync(v.writeSettings(settings));
  return img;
}
