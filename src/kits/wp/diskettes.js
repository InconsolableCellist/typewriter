// The diskette unit on the desk (architecture.md 8, milestone M7): the software's disk device over the drive
// mechanism, the levers and diskettes as things the pointer works, and a holder for the diskettes not in a drive.
// Sector bytes stay with the software's library; the mechanism only knows which diskette is where.
import * as THREE from 'three';

const DISK = 0.2032;                 // m, an 8-inch diskette
const HOLD_S = 0.9;                  // s a hand keeps hold of a lever or a diskette

/** A diskette's face: a black jacket with a white label carrying its name. */
function diskTexture(name) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#141414'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(128, 128, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0a0a0a'; g.fillRect(118, 170, 20, 70);                       // the head window
  g.fillStyle = '#efeadc'; g.fillRect(20, 14, 216, 52);
  g.fillStyle = '#1d3b8c'; g.font = 'italic 30px "Comic Sans MS", cursive'; g.fillText(name, 32, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function installDiskettes({ stage, machine, geometry, sim, unit, parts, library, pickables }) {
  const L = sim.layout;
  const size = geometry.units.diskette.size;
  const slotX = [-0.05, 0.05], slotY = 0.016 + 0.035 + 0.1075, front = size[2] / 2;
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

  // Every diskette: where it is (a drive, or the holder) and its mesh.
  const holder = machine.deskLayout.disketteHolder;
  const holderGroup = new THREE.Group();
  holderGroup.position.set(holder.x, 0, holder.z);
  stage.scene.add(holderGroup);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.23), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7 }));
  tray.position.y = 0.015; tray.castShadow = tray.receiveShadow = true;
  holderGroup.add(tray);
  const disks = new Map();
  const make = (id) => {
    const tex = diskTexture(id);
    const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.0015, DISK, DISK), [side, side, edge, edge, edge, edge]);
    m.castShadow = true; m.name = `diskette ${id}`;
    const d = { id, mesh: m, drive: null };
    disks.set(id, d);
    pickables.push({ object: m, part: () => ({ kind: 'diskette', label: `Diskette ${id}`, onClick: () => clickDisk(d) }) });
    return d;
  };
  const ids = [...library.images.keys()];
  const inDrive = [0, 1].map((i) => status[i].mediaId ?? null);
  for (const id of ids) { const d = make(id); d.drive = inDrive.indexOf(id) >= 0 ? inDrive.indexOf(id) : null; }
  const placeInHolder = () => {
    let k = 0;
    for (const d of disks.values()) {
      if (d.drive !== null) continue;
      holderGroup.add(d.mesh);
      d.mesh.position.set(-0.01 + (k % 3) * 0.012, 0.03 + DISK / 2 - 0.02, 0);
      d.mesh.rotation.set(0, 0, 0.05 - (k % 3) * 0.05);
      k++;
    }
  };
  placeInHolder();

  // Hands: a grab that pulls a lever or a diskette toward a target and lets go.
  const hold = (dof, i, target, opts) => {
    const g = sim.grab(dof, i, { target, ...opts });
    setTimeout(() => sim.release(g), HOLD_S * 1000);
  };
  const lever = (i) => sim.state[L.lever + i];
  const slide = (i) => sim.state[L.slide + i];
  const toggleLever = (i) => hold('lever', i, lever(i) > closed / 2 ? 0 : closed, { k: 2, c: 0.01, maxF: 0.4 });
  parts.levers.forEach((lv, i) => lv.traverse((o) => { if (o.isMesh) pickables.push({ object: o, part: () => ({ kind: 'lever', label: lever(i) > closed / 2 ? 'Open the lever' : 'Close the lever', onClick: () => toggleLever(i) }) }); }));

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
      d.drive = null; placeInHolder();
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
        if (d.mesh.parent !== unit) { unit.add(d.mesh); d.mesh.rotation.set(0, 0, 0); }
        // The slot runs into the cabinet: the diskette stands edge-on in it and goes in by `s`.
        d.mesh.position.set(slotX[d.drive], slotY, front + DISK / 2 - s);
      }
    },
  };
}
