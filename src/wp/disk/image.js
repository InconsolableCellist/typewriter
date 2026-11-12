// A diskette image: every sector at its physical address (architecture 8.1). A blank diskette is all zeros and reads
// as unformatted. `version` counts completed writes, so the store can tell when to save.
import { MEDIA, imageSize, sectorOffset, sectorSize } from './geometry.js';

export function createImage(id, type = '2D') {
  return { id, type, bytes: new Uint8Array(imageSize(MEDIA[type])), version: 0 };
}

export function sectorView(img, track, side, sector) {
  const m = MEDIA[img.type];
  const off = sectorOffset(m, track, side, sector);
  return img.bytes.subarray(off, off + sectorSize(m, track));
}

export function readSector(img, track, side, sector) { return sectorView(img, track, side, sector).slice(); }

export function writeSector(img, track, side, sector, data) {
  const v = sectorView(img, track, side, sector);
  v.fill(0);
  v.set(data.subarray(0, v.length));
}
