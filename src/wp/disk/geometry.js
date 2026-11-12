// The two documented diskette formats (HW 3.6, architecture 8.1). Track 00 is the label track, 26 sectors of 128
// bytes; tracks 01 to 74 hold data; 75 and 76 are spares. Logical sector numbers (LSN) run over the data tracks in
// track order, both sides of a track before the next (one seek serves 52 sectors on a 2D diskette).

export const MEDIA = {
  '1': { type: '1', sides: 1, tracks: 77, spt: 15, size: 256, track0: { spt: 26, size: 128 } },
  '2D': { type: '2D', sides: 2, tracks: 77, spt: 26, size: 256, track0: { spt: 26, size: 128 } },
};
export const FIRST_DATA_TRACK = 1, LAST_DATA_TRACK = 74;
export const SECTOR = 256;

export function dataSectors(m) { return (LAST_DATA_TRACK - FIRST_DATA_TRACK + 1) * m.spt * m.sides; }

/** Physical address of a logical sector: { track, side, sector } with sectors numbered from 1. */
export function lsnAddress(m, lsn) {
  const perTrack = m.spt * m.sides;
  return { track: FIRST_DATA_TRACK + Math.floor(lsn / perTrack), side: Math.floor(lsn / m.spt) % m.sides, sector: (lsn % m.spt) + 1 };
}

function trackBytes(m, track) { return track === 0 ? m.track0.spt * m.track0.size : m.spt * m.size; }

/** Byte offset of a sector in an image laid out track by track, side by side. */
export function sectorOffset(m, track, side, sector) {
  let off = 0;
  if (track > 0) off = m.sides * trackBytes(m, 0) + (track - 1) * m.sides * trackBytes(m, 1);
  off += side * trackBytes(m, track);
  return off + (sector - 1) * (track === 0 ? m.track0.size : m.size);
}

export function imageSize(m) { return sectorOffset(m, m.tracks, 0, 1); }

export function sectorsPerTrack(m, track) { return track === 0 ? m.track0.spt : m.spt; }
export function sectorSize(m, track) { return track === 0 ? m.track0.size : m.size; }
