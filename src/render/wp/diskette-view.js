// The IBM 6360 dual diskette unit (HW 3), its 8-inch diskettes and envelopes, and the desk file that holds the
// diskettes not in a drive, from wp_diskette.glb (tools/blender/build_wp_diskette.py; decisions in
// docs/displaywriter/models.md, "Diskette unit"). Nothing here moves by itself: the kit poses the levers and the
// diskettes from the mechanism's snapshot (src/kits/wp/diskettes.js). The badge and every label are drawn at run time.
import * as THREE from 'three';

export const DISKETTE_URL = '/assets/models/wp_diskette.glb';
export const DISK = 0.2032;                 // m, an 8-inch diskette
const ABOVE_ENVELOPE = 0.122;               // the diskette's centre above its envelope's bottom edge: the name on its label shows
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// The templates are built in the card frame: x along the label, y toward the label edge, z out of the label face. In a
// slot the diskette stands with its head window leading into the drive and its label facing the lever (HW 3.3).
const CARD_TO_SLOT = new THREE.Matrix4().makeBasis(V(0, -1, 0), V(0, 0, 1), V(-1, 0, 0));
const SLOT_Q = new THREE.Quaternion().setFromRotationMatrix(CARD_TO_SLOT);

const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const SANS = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif';
const TYPE = '"Courier New", Courier, monospace';
const LABEL_COLOUR = { '1': '#9a9a96', '2D': '#c0623a' };   // grey "1", terra cotta "2D" (HW 3.6)

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4;   // GLB UVs: v = 0 at the top
  return t;
}

/** The label strip along the diskette's top edge (192 x 40 mm): IBM's permanent label with the media mark at the right, the
 *  operator's label at the left. Transparent elsewhere, so the jacket shows between them. */
function diskLabel(name, type, printed) {
  const px = 4;                              // px per mm
  return canvasTexture(192 * px, 40 * px, (g) => {
    const mm = (v) => v * px;
    // IBM's label: coloured, the bold media mark, the maker's lines.
    g.fillStyle = LABEL_COLOUR[type] ?? LABEL_COLOUR['2D'];
    g.fillRect(mm(140), mm(2), mm(50), mm(36));
    g.fillStyle = '#f4f1e8';
    g.font = `bold ${mm(17)}px ${SANS}`; g.textBaseline = 'alphabetic';
    g.fillText(type, mm(145), mm(22));
    g.font = `bold ${mm(4.2)}px ${SANS}`;
    g.fillText('IBM', mm(145), mm(29));
    g.font = `${mm(3)}px ${SANS}`;
    g.fillText(`Diskette ${type}`, mm(145), mm(34));
    // The operator's label: paper, printed rules, the name in ink (or typed, on IBM's program diskette), high enough to
    // show over the envelope in the file.
    g.fillStyle = '#f2eee2';
    g.fillRect(mm(4), mm(2), mm(130), mm(30));
    g.strokeStyle = 'rgba(70, 90, 140, 0.45)'; g.lineWidth = mm(0.25);
    for (const y of [18, 27]) { g.beginPath(); g.moveTo(mm(7), mm(y)); g.lineTo(mm(131), mm(y)); g.stroke(); }
    if (printed) {
      g.fillStyle = '#161616';
      g.font = `bold ${mm(4.6)}px ${TYPE}`; g.fillText('IBM Displaywriter Textpack 4', mm(8), mm(8.5));
      g.font = `${mm(4.2)}px ${TYPE}`; g.fillText(`Program Diskette  ${name}`, mm(8), mm(15.5));
      g.font = `${mm(2.8)}px ${TYPE}`; g.fillText('(C) IBM Corp. 1982   Licensed material', mm(8), mm(22));
    } else {
      g.fillStyle = '#1d3b8c';
      g.font = `italic ${mm(8.5)}px ${HAND}`; g.fillText(name, mm(10), mm(16));
    }
  });
}

/** The envelope's printed front (213 x 196 mm): IBM's handling notes and an index box with the name. */
function envelopeFace(name, printed) {
  const px = 2.4;
  return canvasTexture(Math.round(213 * px), Math.round(196 * px), (g, w, h) => {
    const mm = (v) => v * px;
    g.fillStyle = '#ece8dc'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2b2b2b';
    g.font = `bold ${mm(7)}px ${SANS}`; g.fillText('IBM', mm(12), mm(36));
    g.font = `${mm(4.2)}px ${SANS}`; g.fillText('Diskette', mm(31), mm(36));
    g.font = `bold ${mm(3.6)}px ${SANS}`; g.fillText('Handling and storage', mm(12), mm(50));
    g.font = `${mm(3.1)}px ${SANS}`;
    const notes = [
      'Return the diskette to this envelope whenever it is not in a drive.',
      'Do not touch the exposed recording surface or the hub.',
      'Keep the diskette away from magnets and magnetic fields.',
      'Do not bend, fold or write on the jacket with a pencil or ballpoint pen.',
      'Store upright, between 10 and 52 degrees C, away from direct sunlight.',
    ];
    notes.forEach((t, i) => g.fillText(t, mm(12), mm(58 + i * 6.2)));
    // The index box.
    g.strokeStyle = '#2b2b2b'; g.lineWidth = mm(0.35);
    g.strokeRect(mm(12), mm(108), mm(120), mm(30));
    g.font = `${mm(2.8)}px ${SANS}`; g.fillText('Volume / contents', mm(14), mm(113));
    if (printed) { g.font = `bold ${mm(5)}px ${TYPE}`; g.fillText(`Textpack 4  ${name}`, mm(16), mm(128)); }
    else { g.fillStyle = '#1d3b8c'; g.font = `italic ${mm(10)}px ${HAND}`; g.fillText(name, mm(18), mm(131)); }
    g.fillStyle = '#5a5a5a'; g.font = `${mm(2.6)}px ${SANS}`;
    g.fillText('IBM Corporation   Printed in U.S.A.', mm(12), mm(186));
  });
}

/** The front badge (25 x 26 mm): a light grey satin plate, IBM's striped logo across its upper part and the machine type
 *  small at its lower left (PH diskette_front; BRO p.1, p.18). */
function badgeTexture() {
  return canvasTexture(250, 260, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#cfcfcb'); grad.addColorStop(1, '#b9b9b5');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = '#25272c';
    g.font = `bold 96px "Rockwell", "Courier New", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('IBM', w / 2, 82);
    g.fillStyle = grad;                           // the logo's eight stripes, cut across the letters
    for (let i = 0; i < 8; i++) g.fillRect(0, 44 + i * 10 + 6, w, 3.4);
    g.fillStyle = '#25272c'; g.font = `bold 22px ${SANS}`; g.textAlign = 'left';
    g.fillText('6360', 18, 222);
  });
}

/** The mark on each pocket's floor right of the slot (12 x 16 mm), seen with the handle open: an arrow up (the way to turn
 *  the handle to unlock) and a padlock in a frame, light on the dark drive front, the drive type small beside them
 *  (PH diskette_front, desk_station_keyboard_diskette). */
function lockTexture(mark) {
  return canvasTexture(120, 160, (g, w, h) => {
    g.fillStyle = '#232220'; g.fillRect(0, 0, w, h);
    g.strokeStyle = g.fillStyle = '#d8d6cf'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(22, 30); g.lineTo(12, 48); g.lineTo(32, 48); g.closePath(); g.fill();   // the arrow
    g.strokeRect(38, 52, 56, 56);                                                                    // the frame
    g.beginPath(); g.arc(66, 74, 10, Math.PI, 0); g.stroke();                                       // the shackle
    g.fillRect(52, 74, 28, 22);                                                                      // the body
    g.save(); g.translate(108, 80); g.rotate(-Math.PI / 2);
    g.font = `bold 15px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(mark, 0, 0);
    g.restore();
  });
}

/** The drive-type mark on the lever's hub (HW 3.3: "1/2D" on 2D drives). */
function leverTexture(mark) {
  return canvasTexture(240, 100, (g, w, h) => {
    g.fillStyle = '#d2cfc6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#121212'; g.font = `bold 66px ${SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(mark, w / 2, h / 2 + 3);
  });
}

/**
 * Loads the unit. Returns `{ group, parts }`: `levers` (each node's origin on its axle; rest pose open; the kit sets
 * rotation.z = -lever), `leverRange` ({ axis, open, closed } in radians about the node's z), `slots` (each slot mouth's
 * centre), `slotPaths` ({ mouth, axis, home, homeDepth } per slot, in the group's frame), `drives` (the dark fronts seen
 * through the slots), `covers`,
 * `badge`, the desk file `holder` with its `places`, and `makeDiskette(id, type, opts)`,
 * whose result poses itself with `inSlot(i, depth)` and `inPlace(k)`.
 */
export async function buildDiskette(size, mats, { url = DISKETTE_URL, driveMark = '1/2D' } = {}) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  const node = (name, within = root) => {
    const o = within.getObjectByName(name);
    if (!o) throw new Error(`wp_diskette.glb: no ${name}`);
    return o;
  };

  const badgeMat = new THREE.MeshStandardMaterial({ map: badgeTexture(), roughness: 0.35, metalness: 0.6 });
  const leverMat = new THREE.MeshStandardMaterial({ map: leverTexture(driveMark), roughness: 0.6 });
  const lockMat = new THREE.MeshStandardMaterial({ map: lockTexture(driveMark), roughness: 0.6 });
  const byName = {
    wp_pearl: mats.pearlGlb, wp_gray: mats.pebbleGlb, wp_dark: mats.darkGlb, wp_rubber: mats.rubber, wp_metal: mats.metal,
    wp_label: leverMat, wp_drive_label: lockMat,
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const m = byName[o.material?.name];
    if (m) o.material = m;
  });
  node('wp_diskette_badge').material = badgeMat;

  // The templates come out of the unit; the file goes on the desk, the diskette and envelope are cloned per diskette.
  const holder = node('wp_diskette_file');
  const jacket = node('wp_diskette_jacket');
  const envelope = node('wp_diskette_envelope');
  for (const o of [holder, jacket, envelope]) o.removeFromParent();
  holder.name = 'diskette-file';
  const places = [0, 1, 2, 3, 4, 5].map((k) => node(`wp_diskette_place${k}`, holder));

  const group = new THREE.Group();
  group.add(root);
  const levers = [0, 1].map((i) => node(`wp_diskette_lever${i}`));
  const slots = [0, 1].map((i) => node(`wp_diskette_slot${i}`));
  const drives = [0, 1].map((i) => node(`wp_diskette_drive${i}`));     // the dark fronts behind the slots
  const covers = ['wp_diskette_front_cover', 'wp_diskette_top_cover'].map((n) => node(n));
  levers.forEach((lv, i) => { lv.name = `lever${i}`; });
  // The controls as the builder describes them (glTF extras): each lever turns about its own z from `open` (0) to
  // `closed` (-pi/2); each slot's diskette runs from the mouth along `axis`, its centre at `home` once pushed in.
  const control = (o) => { try { return JSON.parse(o.userData?.control ?? 'null'); } catch { return null; } };
  const leverRange = control(levers[0]) ?? { axis: [0, 0, 1], open: 0, closed: -Math.PI / 2 };
  const slotPaths = slots.map((s, i) => {
    const c = control(s) ?? {};
    return {
      mouth: s.position.clone(),
      axis: new THREE.Vector3(...(c.axis ?? [0, 0, -1])),
      home: s.position.clone().add(node(`wp_diskette_slot${i}_home`).position),   // the diskette's centre when home
      homeDepth: c.home ?? DISK + 0.008,                                         // its leading edge's depth then
    };
  });

  const jacketMat = new THREE.MeshPhysicalMaterial({ color: 0x0d0d0d, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const mediaMat = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.28, metalness: 0.1 });
  const paper = { color: 0xffffff, roughness: 0.88 };
  const tv = new THREE.Vector3();

  /** One diskette and its envelope, labelled. `program` prints the label (IBM's program diskette) instead of handwriting it. */
  function makeDiskette(id, type = '2D', { program = false } = {}) {
    const disk = jacket.clone(true);
    disk.name = `diskette ${id}`;
    disk.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name.startsWith('wp_diskette_label')) o.material = new THREE.MeshStandardMaterial({ map: diskLabel(id, type, program), transparent: true, alphaTest: 0.5, roughness: 0.75 });
      else if (o.name.startsWith('wp_diskette_media')) o.material = mediaMat;
      else o.material = jacketMat;
      o.castShadow = o.receiveShadow = true;
    });
    const env = envelope.clone(true);
    env.name = `envelope ${id}`;
    env.material = new THREE.MeshStandardMaterial({ ...paper, map: envelopeFace(id, program) });
    env.castShadow = env.receiveShadow = true;
    let place = 0;
    return {
      disk, envelope: env,
      /** Stands the envelope in the file's place k, and the diskette in it when `withDisk`. */
      inPlace(k, withDisk = true) {
        place = k;
        const p = places[k % places.length];
        holder.add(env); env.position.copy(p.position); env.quaternion.copy(p.quaternion);
        if (!withDisk) return;
        holder.add(disk);
        disk.position.copy(p.position).add(tv.set(0, ABOVE_ENVELOPE, 0).applyQuaternion(p.quaternion));
        disk.quaternion.copy(p.quaternion);
      },
      /** Drawn up out of its envelope in the file's place k, as a hand holds it ready for a drive. */
      outOfEnvelope(k) {
        place = k;
        const p = places[k % places.length];
        holder.add(env); env.position.copy(p.position); env.quaternion.copy(p.quaternion);
        holder.add(disk);
        disk.position.copy(p.position).add(tv.set(0, ABOVE_ENVELOPE + DISK * 0.92, 0.03).applyQuaternion(p.quaternion));
        disk.quaternion.copy(p.quaternion);
      },
      /** In slot i's guide, its leading edge `depth` m in from the mouth. */
      inSlot(i, depth) {
        if (disk.parent !== group) group.add(disk);
        disk.quaternion.copy(SLOT_Q);
        disk.position.copy(slots[i].position).add(tv.set(0, 0, DISK / 2 - depth));
      },
      get place() { return place; },
    };
  }

  return { group, parts: { levers, leverRange, slots, slotPaths, drives, covers, badge: node('wp_diskette_badge'), holder, places, makeDiskette } };
}
