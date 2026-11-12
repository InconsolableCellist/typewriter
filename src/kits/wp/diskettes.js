// The diskette unit on the desk (architecture.md 8, milestone M7): the software's disk device over the drive
// mechanism, the levers and diskettes as things the pointer works, and the desk file for the diskettes not in a drive.
// Sector bytes stay with the software's library; the mechanism only knows which diskette is where. The meshes are the
// view's (src/render/wp/diskette-view.js); this module poses them from the snapshot's `lever` and `slide` fields.
import { PROGRAM_NAME } from '../../wp/disk/library.js';

const HOLD_S = 0.9;                  // s a hand keeps hold of a lever or a diskette

export function installDiskettes({ stage, machine, sim, parts, library, pickables }) {
  const L = sim.layout;
  const home = machine.diskettes.slide.length + machine.diskettes.slide.leverPlane + machine.diskettes.slide.homeClearance;
  const closed = machine.diskettes.lever.closed;

  // The software's view of each drive (7.6), kept from the adapter's ready and not-ready reports.
  const status = [0, 1].map((i) => sim.host?.sim?.diskStatus?.(i) ?? { ready: false });
  const listeners = [];
  sim.on('device', (e) => {
    if (e.dev !== 'disk') return;
    if (e.ev === 'ready') status[e.drive] = { ready: true, mediaId: e.mediaId, type: e.type ?? '2D' };
    if (e.ev === 'notReady') status[e.drive] = { ready: false };
    for (const fn of listeners) fn(e);
  });
  const device = {
    status: (d) => status[d],
    transfer: (req) => sim.command({ dev: 'disk', op: 'transfer', ...req }),
    recalibrate: (req) => sim.command({ dev: 'disk', op: 'recalibrate', ...req }),
  };

  // The desk file, and every diskette: where it is (a drive, or its envelope in the file) and its meshes. Each diskette
  // keeps its own place in the file; its envelope stays there while the diskette is in a drive.
  const spot = machine.deskLayout.disketteHolder;
  parts.holder.position.set(spot.x, 0, spot.z);
  stage.scene.add(parts.holder);
  const disks = new Map();
  const ids = [...library.images.keys()];
  const inDrive = [0, 1].map((i) => status[i].mediaId ?? null);
  ids.forEach((id, k) => {
    const v = parts.makeDiskette(id, library.get(id)?.type ?? '2D', { program: id === PROGRAM_NAME });
    const d = { id, view: v, drive: inDrive.indexOf(id) >= 0 ? inDrive.indexOf(id) : null, place: k };
    disks.set(id, d);
    const label = () => (d.drive === null ? `Diskette ${id}` : `Diskette ${id} (drive ${d.drive + 1})`);
    pickables.push({ object: v.disk, part: () => ({ kind: 'diskette', label: label(), onClick: () => clickDisk(d) }) });
    pickables.push({ object: v.envelope, part: () => (d.drive === null ? { kind: 'diskette', label: label(), onClick: () => clickDisk(d) } : { kind: 'envelope', label: `Envelope ${id} (empty)` }) });
    v.inPlace(k, d.drive === null);
  });
  const placeInHolder = (d) => d.view.inPlace(d.place, true);

  // Hands: a grab that pulls a lever or a diskette toward a target and lets go.
  const hold = (dof, i, target, opts) => {
    const g = sim.grab(dof, i, { target, ...opts });
    setTimeout(() => sim.release(g), HOLD_S * 1000);
  };
  const lever = (i) => sim.state[L.lever + i];
  const slide = (i) => sim.state[L.slide + i];
  const toggleLever = (i) => hold('lever', i, lever(i) > closed / 2 ? 0 : closed, { k: 2, c: 0.01, maxF: 0.4 });
  parts.levers.forEach((lv, i) => lv.traverse((o) => { if (o.isMesh) pickables.push({ object: o, part: () => ({ kind: 'lever', label: lever(i) > closed / 2 ? 'Open the lever' : 'Close the lever', onClick: () => toggleLever(i) }) }); }));

  // The covers stop the pointer, so the drives behind them answer only through the slots and pockets.
  for (const c of parts.covers) pickables.push({ object: c, part: () => null });
  // A diskette at home lies wholly inside its slot: the hand reaches it at the slot's mouth.
  const inSlot = (i) => [...disks.values()].find((d) => d.drive === i) ?? null;
  parts.drives.forEach((dr, i) => pickables.push({ object: dr, part: () => {
    const d = inSlot(i);
    if (!d) return null;
    return { kind: 'diskette', label: lever(i) < closed / 3 ? `Take out diskette ${d.id}` : `Diskette ${d.id} (open the lever to take it out)`, onClick: () => clickDisk(d) };
  } }));

  function clickDisk(d) {
    if (d.drive === null) {
      // Into the first drive whose lever is open and slot empty; then pushed home.
      const i = [0, 1].find((k) => slide(k) < 0 && lever(k) < closed / 3);
      if (i === undefined) return;
      d.drive = i;
      sim.command({ dev: 'disk', op: 'media', drive: i, mediaId: d.id, type: library.get(d.id)?.type ?? '2D' });
      setTimeout(() => hold('disketteSlide', i, home + 0.004, { k: 400, c: 6, maxF: 4 }), 50);
      return;
    }
    // In a drive: with the lever open, draw it out to the mouth and take it.
    const i = d.drive;
    if (lever(i) > closed / 3) return;
    hold('disketteSlide', i, -0.01, { k: 400, c: 6, maxF: 4 });
    setTimeout(() => {
      sim.command({ dev: 'disk', op: 'media', drive: i, mediaId: null });
      d.drive = null; placeInHolder(d);
    }, HOLD_S * 1000 + 50);
  }

  return {
    device,
    onEvent: (fn) => listeners.push(fn),
    update() {
      for (let i = 0; i < 2; i++) parts.levers[i].rotation.z = -lever(i);
      for (const d of disks.values()) {
        if (d.drive === null) continue;
        const s = slide(d.drive);
        if (s < 0) continue;
        // The slot runs into the cabinet: the diskette stands edge-on in its guide, `s` in from the mouth.
        d.view.inSlot(d.drive, s);
      }
    },
  };
}
