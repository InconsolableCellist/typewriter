// A Web Worker of the fax kit: reads a sheet's raw contact-image-sensor lines ahead, when the sheet reaches the read
// line, so the host (on the audio thread) runs only the cheap video stage when the firmware asks for the page
// (sheet-scan.js says why). Message in: { id, page, pose, res: [...] }; out, one per resolution: { id, res, y0, raw }.
import { CisSensor } from './optics.js';
import { readRaw, linesLeft } from './sheet-scan.js';

const cis = new CisSensor({ seed: 1 });     // the station's sensor: the same fixed pattern (sheet-scan.js SheetScanner)

self.onmessage = (e) => {
  const { id, page, pose, res } = e.data;
  for (const r of res) {
    const raw = readRaw(cis, page, pose, r, linesLeft(pose, r));
    self.postMessage({ id, res: r, y0: pose.y, raw }, [raw.buffer]);
  }
};
