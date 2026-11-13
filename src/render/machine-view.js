// Parametric moving geometry. Everything visible is posed from the snapshot; nothing here advances time.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { barDirection, rotate } from '../machine/geometry.js';
import { carriageWorldX } from './rig.js';
import { buildPlaceholderFrame } from './frame.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

function setBasis(m, X, Y, Z, p, sx = 1, sy = 1, sz = 1) {
  m.set(
    X.x * sx, Y.x * sy, Z.x * sz, p.x,
    X.y * sx, Y.y * sy, Z.y * sz, p.y,
    X.z * sx, Y.z * sy, Z.z * sz, p.z,
    0, 0, 0, 1,
  );
  return m;
}
function setPose(mesh, i, m4) { mesh.setMatrixAt(i, m4); }

function lathe(points, segs = 32) {
  const g = new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(p[0], p[1])), segs);
  g.computeVertexNormals();
  return g;
}

const SPINDLE_PROUD = 0.0015;                 // m, ribbon spindle above the spool's upper flange
const LS_DRIVE_ARM = 0.024;                  // m, the line-space lever's lower arm, from the pivot to the pawl pin

export class MachineView {
  constructor({ machine: m, geometry: g, rig, mats, atlas }) {
    this.m = m; this.g = g; this.rig = rig; this.mats = mats; this.atlas = atlas;
    this.root = new THREE.Group(); this.root.name = 'machine';
    this.pickables = [];          // {object, part(instanceId)}
    this.partDefs = new Map();
    this.buildFrame();
    this.buildKeys();
    this.buildLevers();
    this.buildBars();
    this.buildSegmentAndGuide();
    this.buildUniversalAndEscapement();
    this.buildCarriage();
    this.buildSpools();
    this.buildVibrator();
    this.buildBell();
    this.highlight = this.makeHighlight();
    this._last = new Float32Array(1);
  }

  addMesh(geo, mat, parent) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  addInst(geo, mat, count, parent) {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.frustumCulled = false; inst.castShadow = inst.receiveShadow = true;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(inst);
    return inst;
  }

  // ---------- frame ----------
  buildFrame() {
    this.frame = new THREE.Group(); this.frame.name = 'frame';
    this.root.add(this.frame);
    const { rig, mats, m } = this;
    const { group, fittings } = buildPlaceholderFrame(m, this.g, rig, mats);
    this.frame.add(group, fittings);
    this.framePlaceholder = group;

    // Rails are precision parts and stay even if the casting comes from a GLB.
    const railGeo = (z) => new THREE.CylinderGeometry(rig.railRadius, rig.railRadius, rig.railHalf * 2, 20).rotateZ(Math.PI / 2).translate(0, rig.railY, z);
    const rails = mergeGeometries([railGeo(rig.railFrontZ), railGeo(rig.railRearZ)]);
    this.railMesh = this.addMesh(rails, mats.steel, this.frame);
    this.pickables.push({ object: this.railMesh, low: true, part: () => ({ kind: 'info', label: 'Carriage rail', visual: () => null }) });

    // Felt rest arc under the bars, through the rest position of each bar.
    const pts = this.g.bars.slice().sort((a, b) => a.slot - b.slot).map((b) => {
      const d = barDirection(b, 0);
      return V(b.pivot).addScaledVector(V(d), b.length * rig.restPadFrac).add(new THREE.Vector3(0, -0.0048, 0));
    });
    if (pts.length > 3) {
      const curve = new THREE.CatmullRomCurve3(pts);
      this.restPad = this.addMesh(new THREE.TubeGeometry(curve, 96, 0.0036, 12, false), mats.felt, this.frame);
    }
  }

  async tryLoadGLB(url) {
    try {
      const { loadGLTF } = await import('./gltf.js');
      const gltf = await loadGLTF(url);
      const matByName = { japanned: this.mats.japanGlb, rubber: this.mats.rubber, nickel: this.mats.nickelGlb };
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        o.material = matByName[o.material?.name] ?? this.mats.japan;
        if (o.name.includes('rails') || o.parent?.name?.includes('rails')) this.glbRails = true;
        if (o.name.includes('segment') || o.parent?.name?.includes('segment')) this.glbSegment = true;
      });
      this.frame.add(gltf.scene);
      this.framePlaceholder.visible = false;
      if (this.glbRails) this.railMesh.visible = false;
      if (this.glbSegment) this.segment.visible = false;
      return true;
    } catch (e) { return false; }
  }

  // ---------- keys ----------
  buildKeys() {
    const { m, g, mats, atlas } = this;
    this.keysGroup = new THREE.Group(); this.root.add(this.keysGroup);
    const r = m.keys.topRadius;
    const capGeo = lathe([[0, 0.0026], [r * 0.5, 0.0024], [r * 0.8, 0.0018], [r * 0.92, 0.0014], [r * 0.92, 0], [0, 0]], 40);
    // Planar UV so the atlas maps straight down onto the key top; v toward the typist is the bottom of the legend.
    const cp = capGeo.getAttribute('position'), cu = capGeo.getAttribute('uv');
    for (let i = 0; i < cp.count; i++) cu.setXY(i, cp.getX(i) / (2 * r) + 0.5, 0.5 - cp.getZ(i) / (2 * r));
    const ringGeo = lathe([[r * 0.88, 0.0016], [r * 1.0, 0.0018], [r * 1.09, 0.0008], [r * 1.09, -0.0026], [r * 0.9, -0.0026], [r * 0.88, 0.0016]]);
    const stemGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 10, 1).translate(0, -0.5, 0);

    // Atlas-driven key tops.
    const capMat = mats.keyCap.clone();
    capMat.map = atlas.keys;
    capMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aAtlas;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = uv * aAtlas.zw + aAtlas.xy;\n#endif');
    };
    this.capMat = capMat;

    const round = g.keys.map((k, i) => ({ k, i })).filter(({ k }) => k.kind === 'print' || (k.id !== 'space'));
    this.roundKeys = round;
    const n = round.length;
    this.caps = this.addInst(capGeo, capMat, n, this.keysGroup);
    this.rings = this.addInst(ringGeo, mats.nickel, n, this.keysGroup);
    this.stems = this.addInst(stemGeo, mats.steel, n, this.keysGroup);
    const atlasAttr = new Float32Array(n * 4);
    round.forEach(({ k }, i) => {
      const a = atlas.keyCell(k);
      atlasAttr.set([a.x, a.y, a.w, a.h], i * 4);
    });
    this.caps.geometry = capGeo.clone();
    this.caps.geometry.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlasAttr, 4));

    // Pick proxy: a coarse cylinder per round key.
    const proxy = this.addInst(new THREE.CylinderGeometry(r, r, 0.005, 10), new THREE.MeshBasicMaterial({ visible: false }), n, this.keysGroup);
    proxy.castShadow = proxy.receiveShadow = false;
    proxy.geometry.translate(0, 0.0015, 0);
    this.keyProxy = proxy;
    this.pickables.push({ object: proxy, part: (id) => ({ kind: 'key', index: round[id].i, visual: () => this.keyVisual(id) }) });

    // Space bar: its own part.
    const space = g.keys.findIndex((k) => k.id === 'space');
    this.spaceIndex = space;
    if (space >= 0) {
      const k = g.keys[space];
      const body = new THREE.Group(); body.position.set(k.pos[0], k.pos[1], k.pos[2]);
      this.keysGroup.add(body);
      this.spaceGroup = body;
      const barGeo = new THREE.BoxGeometry(k.width, 0.006, 0.0085, 1, 1, 1);
      const barMesh = this.addMesh(roundBox(barGeo, 0.0016), mats.nickel, body);
      this.spaceMesh = barMesh;
      const arm = new THREE.BoxGeometry(0.004, 0.003, 0.05).translate(0, -0.006, -0.027);
      this.addMesh(mergeGeometries([arm.clone().translate(k.width * 0.32, 0, 0), arm.clone().translate(-k.width * 0.32, 0, 0)]), mats.steel, body);
      const proxyBar = new THREE.Mesh(new THREE.BoxGeometry(k.width, 0.008, 0.012), new THREE.MeshBasicMaterial({ visible: false }));
      body.add(proxyBar);
      this.pickables.push({ object: proxyBar, part: () => ({ kind: 'key', index: space, visual: () => barMesh }) });
    }
    this.shiftKeys = g.keys.map((k, i) => ({ k, i })).filter(({ k }) => k.id.startsWith('shift'));
    this.keyDown = new Float32Array(g.nKeys).fill(-1);
    this.updateKeys(new Float32Array(g.nKeys), 0, true);
  }

  keyVisual(id) {
    this.caps.getMatrixAt(id, this._hlM ||= new THREE.Matrix4());
    return { geometry: this.caps.geometry, matrix: this._hlM, parent: this.keysGroup };
  }

  updateKeys(s, off, force) {
    const { g, keyDown, roundKeys, m } = this;
    let dirty = !!force;
    for (let j = 0; j < roundKeys.length; j++) {
      const { k, i } = roundKeys[j];
      const x = s[off + i];
      if (!force && x === keyDown[i]) continue;
      keyDown[i] = x; dirty = true;
      const scale = k.kind === 'print' ? 1 : (k.width / 2) / m.keys.topRadius;
      tmpM.identity().makeScale(scale, 1, scale).setPosition(k.pos[0], k.pos[1] - x, k.pos[2]);
      this.caps.setMatrixAt(j, tmpM); this.rings.setMatrixAt(j, tmpM); this.keyProxy.setMatrixAt(j, tmpM);
      tmpM.makeScale(1, m.keys.stemHeight, 1).setPosition(k.pos[0], k.pos[1] - x, k.pos[2]);
      this.stems.setMatrixAt(j, tmpM);
    }
    if (dirty) {
      this.caps.instanceMatrix.needsUpdate = this.rings.instanceMatrix.needsUpdate = this.stems.instanceMatrix.needsUpdate = this.keyProxy.instanceMatrix.needsUpdate = true;
      this.keyProxy.computeBoundingSphere?.();
    }
    if (this.spaceGroup) {
      const k = g.keys[this.spaceIndex];
      this.spaceGroup.position.y = k.pos[1] - s[off + this.spaceIndex];
    }
    return dirty;
  }

  // ---------- key levers ----------
  buildLevers() {
    const { m, g, mats } = this;
    this.leversGroup = new THREE.Group(); this.root.add(this.leversGroup);
    const n = g.nPrint;
    const leverGeo = new THREE.BoxGeometry(0.0022, 0.006, 1).translate(0, 0, 0.5);
    this.levers = this.addInst(leverGeo, mats.blued, n, this.leversGroup);
    this.links = this.addInst(new THREE.CylinderGeometry(0.0009, 0.0009, 1, 6).translate(0, 0.5, 0), mats.steel, n, this.leversGroup);
    const proxy = this.addInst(new THREE.BoxGeometry(0.004, 0.009, 1).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ visible: false }), n, this.leversGroup);
    proxy.castShadow = proxy.receiveShadow = false;
    this.leverProxy = proxy;
    this.leverData = g.keys.slice(0, n).map((k) => {
      const pivot = new THREE.Vector3(k.pos[0], m.keys.leverPivot[1], m.keys.leverPivot[2]);
      const tipRest = new THREE.Vector3(k.pos[0], k.pos[1] - m.keys.stemHeight, k.pos[2]);
      return { pivot, tipRest, len: tipRest.distanceTo(pivot) };
    });
    this.heels = new Array(n).fill(0).map(() => new THREE.Vector3());
    this.pickables.push({ object: proxy, part: (id) => ({ kind: 'lever', index: id, visual: () => this.instVisual(this.levers, id, this.leversGroup) }) });
  }

  instVisual(inst, id, parent) {
    const M = new THREE.Matrix4();
    inst.getMatrixAt(id, M);
    return { geometry: inst.geometry, matrix: M, parent };
  }

  updateLevers(s, L) {
    const { g, m, leverData, rig } = this;
    const armFrac = 0.38;
    for (let i = 0; i < g.nPrint; i++) {
      const d = leverData[i];
      const x = s[L.keyX + i];
      tmpV.copy(d.tipRest).setY(d.tipRest.y - x).sub(d.pivot);
      const len = tmpV.length();
      tmpV.divideScalar(len);
      tmpV2.set(1, 0, 0);
      tmpV3.crossVectors(tmpV, tmpV2).normalize();
      setPose(this.levers, i, setBasis(tmpM, tmpV2, tmpV3, tmpV, d.pivot, 1, 1, len));
      this.leverProxy.setMatrixAt(i, tmpM);
      // Link from the lever eye to the heel of the bar.
      const eye = tmpV3.copy(d.pivot).addScaledVector(tmpV, len * armFrac);
      const heel = this.heels[i];
      setLink(this.links, i, heel, eye);
      this._tmpEye = eye;
    }
    this.levers.instanceMatrix.needsUpdate = this.links.instanceMatrix.needsUpdate = this.leverProxy.instanceMatrix.needsUpdate = true;
    void rig; void m;
  }

  // ---------- typebars ----------
  buildBars() {
    const { m, g, mats, atlas } = this;
    this.barsGroup = new THREE.Group(); this.root.add(this.barsGroup);
    const n = g.nPrint;
    const L = m.typebars.length;
    const h = m.typebars.barWidth, th = m.typebars.barThickness;
    // Bar local frame: x along, y = axis x d (away from the platen at impact), z = axis. Slug face at y=0.
    const shape = new THREE.Shape();
    const tip = L + 0.0015;
    shape.moveTo(-0.018, -0.0025);
    shape.lineTo(-0.006, -0.0055);
    shape.quadraticCurveTo(0.0, -0.0062, 0.006, -0.0048);
    shape.bezierCurveTo(L * 0.45, -0.0005, L * 0.7, 0.0002, tip, 0.0010);
    shape.lineTo(tip, 0.0010 + h);
    shape.bezierCurveTo(L * 0.7, 0.0002 + h * 0.9, L * 0.45, 0.0004 + h, 0.008, 0.0036);
    shape.quadraticCurveTo(0.002, 0.0045, -0.004, 0.0034);
    shape.lineTo(-0.018, 0.0018);
    shape.closePath();
    const hub = new THREE.Path();
    hub.absarc(0, 0, 0.0009, 0, Math.PI * 2, true);
    shape.holes.push(hub);
    const barGeo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 14 }).translate(0, 0, -th / 2);
    this.barsMesh = this.addInst(barGeo, mats.steelDark, n, this.barsGroup);

    const sm = m.slug;
    const slugBody = new THREE.BoxGeometry(sm.faceHeight, 0.0032, sm.faceWidth).translate(L + sm.caseOffset / 2, 0.0016, 0);
    this.slugs = this.addInst(slugBody, mats.steel, n, this.barsGroup);
    // Face: a quad on y=0 with normal -y. uv x along the bar, y across.
    const face = new THREE.PlaneGeometry(sm.faceHeight, sm.faceWidth);
    face.rotateX(Math.PI / 2);
    face.rotateY(Math.PI);
    face.translate(L + sm.caseOffset / 2, -0.00002, 0);
    const uv = face.getAttribute('uv');
    const atlasAttr = new Float32Array(n * 4);
    g.bars.forEach((b) => atlasAttr.set(atlas.slugCell(b), b.index * 4));
    face.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlasAttr, 4));
    void uv;
    const faceMat = mats.slugFace.clone();
    faceMat.map = atlas.slugs;
    faceMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aAtlas;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = uv * aAtlas.zw + aAtlas.xy;\n#endif');
    };
    this.slugFaces = this.addInst(face, faceMat, n, this.barsGroup);
    this.barTheta = new Float32Array(n).fill(-1);
    const proxy = this.addInst(new THREE.BoxGeometry(L + 0.01, 0.006, 0.005).translate((L + 0.01) / 2 - 0.004, 0.001, 0), new THREE.MeshBasicMaterial({ visible: false }), n, this.barsGroup);
    proxy.castShadow = proxy.receiveShadow = false;
    this.barProxy = proxy;
    this.pickables.push({ object: proxy, raised: (id) => this.barTheta[id] > 0.12, part: (id) => ({ kind: 'bar', index: id, visual: () => this.instVisual(this.barsMesh, id, this.barsGroup) }) });
  }

  updateBars(s, L) {
    const { g, m } = this;
    let dirty = false;
    const rigFrac = -0.016;
    for (let i = 0; i < g.nPrint; i++) {
      const b = g.bars[i];
      const th = s[L.barTheta + i], lat = s[L.barLateral + i];
      const d = barDirection(b, th);
      tmpV.set(d[0], d[1], d[2]);
      tmpV2.set(b.axis[0], b.axis[1], b.axis[2]);
      tmpV3.crossVectors(tmpV2, tmpV); // y
      const pos = this._pos ||= new THREE.Vector3();
      pos.set(b.pivot[0] + b.axis[0] * lat, b.pivot[1] + b.axis[1] * lat, b.pivot[2] + b.axis[2] * lat);
      setBasis(tmpM, tmpV, tmpV3, tmpV2, pos);
      if (th !== this.barTheta[i]) {
        this.barTheta[i] = th; dirty = true;
        this.barsMesh.setMatrixAt(i, tmpM); this.slugs.setMatrixAt(i, tmpM); this.slugFaces.setMatrixAt(i, tmpM); this.barProxy.setMatrixAt(i, tmpM);
      }
      this.heels[i].copy(pos).addScaledVector(tmpV, rigFrac).addScaledVector(tmpV3, -0.002);
    }
    if (dirty) this.barProxy.boundingSphere = null;   // raycasts cull on it, and it was computed with the bars at rest
    if (dirty) this.barsMesh.instanceMatrix.needsUpdate = this.slugs.instanceMatrix.needsUpdate = this.slugFaces.instanceMatrix.needsUpdate = this.barProxy.instanceMatrix.needsUpdate = true;
    void m;
    return dirty;
  }

  // ---------- segment, guide ----------
  buildSegmentAndGuide() {
    const { m, g, rig, mats } = this;
    const tb = m.typebars, c = V(g.printPoint), n = V(g.printNormal), w = V(g.strikeDown), x = new THREE.Vector3(1, 0, 0);
    const R = tb.length;
    const a0 = -(tb.arcHalfAngle + 0.13), a1 = tb.arcHalfAngle + 0.13;
    const outer = R + 0.0075, inner = R - 0.0065, thick = 0.018;
    const mk = (u, v) => [c.x + x.x * u + w.x * v, c.y + x.y * u + w.y * v, c.z + x.z * u + w.z * v];
    const verts = [], idx = [];
    const seg = 96, ring = 5;
    const push = (p, up) => { verts.push(p[0] + n.x * up, p[1] + n.y * up, p[2] + n.z * up); };
    for (let i = 0; i <= seg; i++) {
      const t = a0 + (a1 - a0) * (i / seg);
      for (let j = 0; j <= ring; j++) {
        const q = j / ring;
        const radius = inner + (outer - inner) * (q);
        const u = Math.sin(t) * radius, v = Math.cos(t) * radius;
        const p = mk(u, v);
        push(p, -thick * 0.5);
      }
      for (let j = 0; j <= ring; j++) {
        const q = 1 - j / ring;
        const radius = inner + (outer - inner) * q;
        const u = Math.sin(t) * radius, v = Math.cos(t) * radius;
        push(mk(u, v), thick * 0.5);
      }
    }
    const per = (ring + 1) * 2;
    for (let i = 0; i < seg; i++) for (let j = 0; j < per; j++) {
      const a = i * per + j, b = i * per + (j + 1) % per, c2 = (i + 1) * per + j, d = (i + 1) * per + (j + 1) % per;
      idx.push(a, b, c2, b, d, c2);
    }
    const segGeo = new THREE.BufferGeometry();
    segGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    // Arc end caps.
    for (const i of [0, seg]) {
      const base = i * per;
      const flip = i === 0;
      for (let j = 1; j < per - 1; j++) {
        if (flip) idx.push(base, base + j, base + j + 1); else idx.push(base, base + j + 1, base + j);
      }
    }
    segGeo.setIndex(idx);
    segGeo.computeVertexNormals();
    this.segment = this.addMesh(segGeo, mats.castDark, this.frame);
    this.pickables.push({ object: this.segment, low: true, part: () => ({ kind: 'info', label: 'Typebar segment', visual: () => null }) });

    // Slotted pivot wire along the arc.
    const arcPts = [];
    for (let i = 0; i <= 80; i++) {
      const t = a0 * 0.95 + (a1 - a0) * 0.95 * (i / 80);
      const v = new THREE.Vector3(Math.sin(t) * R, 0, 0).addScaledVector(w, Math.cos(t) * R).add(c);
      arcPts.push(v);
    }
    this.addMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 120, 0.0011, 8), mats.steel, this.frame);

    // Type guide fork.
    const p = V(rig.guidePos);
    const yAxis = n.clone(), xAxis = x.clone(), zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    const body = new THREE.Group();
    tmpM.makeBasis(xAxis, yAxis, zAxis); body.applyMatrix4(tmpM); body.position.copy(p);
    const tw = tb.typeGuide.width / 2;
    // The fork stands on the typist's side of the ribbon: the ribbon and paper pass between it and the platen, so nothing
    // here reaches closer to the platen than the ribbon's standoff plus a working gap.
    const nHere = (p.x - g.printPoint[0]) * n.x + (p.y - g.printPoint[1]) * n.y + (p.z - g.printPoint[2]) * n.z;
    const yNear = (m.ribbon.standoff ?? 0.0009) + 0.0006 - nHere;
    const yFar = 0.00385, tall = yFar - yNear;
    const blockG = [
      new THREE.BoxGeometry(0.0014, tall, 0.0034).translate(tw + 0.0007, yNear + tall / 2, 0),
      new THREE.BoxGeometry(0.0014, tall, 0.0034).translate(-tw - 0.0007, yNear + tall / 2, 0),
      new THREE.BoxGeometry(tw * 2 + 0.003, 0.0026, 0.0034).translate(0, yFar - 0.0013, 0.0006),
    ];
    const armLen = 0.024;
    blockG.push(new THREE.BoxGeometry(0.0034, 0.0028, armLen).translate(0, yFar - 0.0013, 0.0006 + armLen / 2));
    this.guide = this.addMesh(mergeGeometries(blockG), mats.steel, body);
    this.pickables.push({ object: this.guide, low: true, part: () => ({ kind: 'info', label: 'Type guide', visual: () => null }) });
    this.frame.add(body);
  }

  // ---------- universal bar and escapement ----------
  buildUniversalAndEscapement() {
    const { m, rig, mats } = this;
    this.ubarGroup = new THREE.Group(); this.root.add(this.ubarGroup);
    const hw = rig.ubar.halfWidth;
    const ug = mergeGeometries([
      new THREE.BoxGeometry(hw * 2, 0.0035, 0.009).translate(0, 0, 0),
      new THREE.BoxGeometry(0.004, 0.003, 0.05).translate(-hw + 0.002, 0, -0.026),
      new THREE.BoxGeometry(0.004, 0.003, 0.05).translate(hw - 0.002, 0, -0.026),
      new THREE.BoxGeometry(0.0035, 0.0035, Math.max(0.01, Math.abs(rig.rocker.pivot[2] - rig.ubar.z))).translate(0, 0, -Math.max(0.01, Math.abs(rig.rocker.pivot[2] - rig.ubar.z)) / 2),
    ]);
    const ubMesh = this.addMesh(ug, mats.blued, this.ubarGroup);
    this.pickables.push({ object: ubMesh, low: true, part: () => ({ kind: 'info', label: 'Universal bar', visual: () => null }) });
    this.ubarGroup.position.set(0, rig.ubar.y, rig.ubar.z);

    // Rocker with fixed and loose dogs, on the frame, behind the carriage rack.
    const piv = new THREE.Group(); piv.position.set(rig.rocker.pivot[0], rig.rocker.pivot[1], rig.rocker.pivot[2]);
    this.root.add(piv);
    this.rockerGroup = piv;
    const rockerGeo = mergeGeometries([
      new THREE.BoxGeometry(0.003, 0.003, rig.rocker.arm + 0.006).translate(0, 0, -(rig.rocker.arm + 0.006) / 2 + 0.003),
      new THREE.CylinderGeometry(0.003, 0.003, 0.012, 16).rotateZ(Math.PI / 2),
      new THREE.BoxGeometry(0.003, 0.016, 0.003).translate(0, 0.01, 0),
    ]);
    const rockerMesh = this.addMesh(rockerGeo, mats.steel, piv);
    this.pickables.push({ object: rockerMesh, low: true, part: () => ({ kind: 'info', label: 'Escapement rocker', visual: () => null }) });
    const dogGeo = new THREE.BoxGeometry(0.0022, 0.0125, 0.0026).translate(0, 0.0062, 0);
    this.dogFixed = this.addMesh(dogGeo, mats.nickel, this.root);
    this.dogLoose = this.addMesh(dogGeo.clone(), mats.brass, this.root);
    this.pickables.push({ object: this.dogFixed, low: true, part: () => ({ kind: 'info', label: 'Fixed escapement dog', visual: () => null }) });
    this.pickables.push({ object: this.dogLoose, low: true, part: () => ({ kind: 'info', label: 'Loose escapement dog', visual: () => null }) });
    this.dogFixed.position.set(0.0014, 0, rig.rack.z);
    this.dogLoose.position.set(-0.0014, 0, rig.rack.z);
  }

  updateEscapement(s, L) {
    const { rig } = this;
    // ubar and the dog heights are metres straight from the snapshot; the rocker value is 0..1 (ubar over its stroke).
    this.ubarGroup.position.y = rig.ubar.y - s[L.ubar];
    this.rockerGroup.rotation.x = s[L.rocker] * 0.18;
    const rootY = rig.rack.y + 0.001;
    const tip = 0.0125;
    this.dogFixed.position.y = rootY - s[L.dogFixedR] - tip;
    this.dogLoose.position.y = rootY - s[L.dogLooseR] - tip;
    this.dogLoose.position.x = -0.0014 + s[L.dogLooseS];
  }

  // ---------- carriage ----------
  buildCarriage() {
    const { m, g, rig, mats } = this;
    const carriage = new THREE.Group(); carriage.name = 'carriage'; this.root.add(carriage);
    this.carriage = carriage;
    const c = rig.c, R = rig.R;

    // End plates.
    const plateShape = (sign) => {
      const s = new THREE.Shape();
      const zf = c[2] + 0.024, zr = c[2] - 0.076;
      s.moveTo(zr, rig.railY - 0.012);
      s.lineTo(zf, rig.railY + 0.012);
      s.lineTo(zf, c[1] + 0.012);
      s.quadraticCurveTo(c[2], c[1] + 0.05, zr, c[1] + 0.022);
      s.closePath();
      const hole = new THREE.Path(); hole.absarc(c[2], c[1], 0.0042, 0, Math.PI * 2, true); s.holes.push(hole);
      const g2 = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 2, curveSegments: 16 });
      g2.rotateY(-Math.PI / 2);
      g2.translate(sign * rig.endPlateX + 0.0025, 0, 0);
      return g2;
    };
    const plates = mergeGeometries([plateShape(-1), plateShape(1)].map((g2) => g2.toNonIndexed()));
    this.plateMesh = this.addMesh(plates, mats.japan, carriage);

    // Carriage rails: shoes on the two frame rails, cross beams and the rack.
    const beamF = new THREE.BoxGeometry(rig.endPlateX * 2, 0.006, 0.01).translate(0, rig.railY + 0.008, rig.railFrontZ);
    const beamR = new THREE.BoxGeometry(rig.endPlateX * 2, 0.006, 0.01).translate(0, rig.railY + 0.008, rig.railRearZ);
    const shoeF = new THREE.BoxGeometry(0.02, 0.0065, 0.009).translate(0, rig.railY + 0.0058, rig.railFrontZ);
    const shoes = [-1, 1].flatMap((si) => [shoeF.clone().translate(si * 0.1, 0, 0), shoeF.clone().translate(si * 0.1, 0, rig.railRearZ - rig.railFrontZ)]);
    this.addMesh(mergeGeometries([beamF, beamR]), mats.table, carriage);
    this.addMesh(mergeGeometries(shoes), mats.steel, carriage);

    // Sawtooth rack, teeth pointing down, pitch from the definition.
    const rackLen = rig.rack.halfLength * 2, depth = rig.rack.depth, pitch = rig.rack.pitch;
    const rackShape = new THREE.Shape();
    const nT = Math.round(rackLen / pitch);
    rackShape.moveTo(-rackLen / 2, 0);
    for (let i = 0; i < nT; i++) {
      const x0 = -rackLen / 2 + i * pitch;
      rackShape.lineTo(x0 + pitch * 0.7, -depth);
      rackShape.lineTo(x0 + pitch, 0);
    }
    rackShape.lineTo(rackLen / 2, 0.006);
    rackShape.lineTo(-rackLen / 2, 0.006);
    rackShape.closePath();
    const rack = new THREE.ExtrudeGeometry(rackShape, { depth: 0.0032, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -0.0016);
    rack.translate(0, rig.rack.y + 0.001, rig.rack.z);
    this.addMesh(rack, mats.brass, carriage);
    // Hangs from the rear beam behind the rear rail, clear of it (rail z stops at railRearZ - railRadius).
    const rackMount = new THREE.BoxGeometry(rackLen, 0.012, 0.008).translate(0, rig.rack.y + 0.012, rig.rack.z - 0.0012);
    this.addMesh(rackMount, mats.table, carriage);

    // Platen.
    const platenG = new THREE.Group(); platenG.position.set(0, c[1], c[2]);
    carriage.add(platenG); this.platen = platenG;
    const rubberG = new THREE.CylinderGeometry(R, R, m.platen.length, 128, 1).rotateZ(Math.PI / 2);
    this.platenRubber = this.addMesh(rubberG, mats.rubber, platenG);
    const shaft = new THREE.CylinderGeometry(0.0036, 0.0036, rig.knobX * 2 + 0.03, 20).rotateZ(Math.PI / 2);
    this.addMesh(shaft, mats.steel, platenG);
    // Ratchet on the left, teeth from the definition.
    const teeth = m.platen.ratchetTeeth;
    const ratchetShape = new THREE.Shape();
    const rO = R * 0.92, rI = R * 0.82;
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.72) / teeth) * Math.PI * 2, a2 = ((i + 1) / teeth) * Math.PI * 2;
      if (i === 0) ratchetShape.moveTo(Math.cos(a0) * rI, Math.sin(a0) * rI);
      ratchetShape.lineTo(Math.cos(a1) * rO, Math.sin(a1) * rO);
      ratchetShape.lineTo(Math.cos(a2) * rI, Math.sin(a2) * rI);
    }
    ratchetShape.closePath();
    const ratchet = new THREE.ExtrudeGeometry(ratchetShape, { depth: 0.0035, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-rig.halfL - 0.0035, 0, 0);
    this.addMesh(ratchet, mats.brass, platenG);
    // Knobs: stacked, knurled, on the ends of the shaft.
    const knobR = m.platen.knobRadius;
    const knurls = 28;
    const knob = (sign) => {
      const pts = [[0, 0], [knobR * 0.72, 0], [knobR * 0.98, 0.0028], [knobR, 0.0048], [knobR, 0.012], [knobR * 0.86, 0.0165], [knobR * 0.4, 0.0185], [0, 0.0185]];
      const p = lathe(pts, 64);
      p.rotateZ(sign > 0 ? -Math.PI / 2 : Math.PI / 2);
      p.translate(sign * rig.knobX, 0, 0);
      return p;
    };
    const pos = [];
    for (let i = 0; i < knurls; i++) pos.push(new THREE.CylinderGeometry(0.00075, 0.00075, 0.0072, 6).rotateZ(Math.PI / 2).translate(0, knobR + 0.0001, 0).rotateX((i / knurls) * Math.PI * 2));
    const knurl = mergeGeometries(pos);
    this.knobL = this.addMesh(knob(-1), mats.knob, platenG, 'knob');
    this.knobR = this.addMesh(knob(1), mats.knob, platenG, 'knob');
    this.addMesh(knurl.clone().translate(-rig.knobX - 0.0088, 0, 0), mats.nickel, this.knobL);
    this.addMesh(knurl.clone().translate(rig.knobX + 0.0088, 0, 0), mats.nickel, this.knobR);
    this.knobNum = { L: this.knobL, R: this.knobR };

    const knobProxy = new THREE.CylinderGeometry(knobR + 0.002, knobR + 0.002, 0.024, 16).rotateZ(Math.PI / 2);
    for (const sign of [-1, 1]) {
      const pr = new THREE.Mesh(knobProxy.clone().translate(sign * (rig.knobX + 0.009), 0, 0), new THREE.MeshBasicMaterial({ visible: false }));
      platenG.add(pr);
      this.pickables.push({ object: pr, part: () => ({ kind: 'knob', side: sign, visual: () => (sign < 0 ? this.knobL : this.knobR) }) });
    }
    const platenProxy = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0004, R + 0.0004, m.platen.length, 24, 1).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    platenG.add(platenProxy);
    this.pickables.push({ object: platenProxy, part: () => ({ kind: 'platen', visual: () => this.platenRubber }) });

    // Paper pan: a closed shell under the platen, on the same arc the sheet's collision uses (machine.paper.panArc).
    const pan = [], panIdx = [];
    const beta = m.printPoint.beta;
    const a0 = beta + m.paper.panArc[0], a1 = beta + m.paper.panArc[1];
    const rP = R + m.paper.panClearance;
    const halfPan = m.paper.width / 2 + 0.018;
    const thick = m.paper.panThickness;
    const nA = 26;
    for (let i = 0; i <= nA; i++) {
      const a = a0 + (a1 - a0) * (i / nA);
      const y = c[1] + Math.sin(a) * rP, z = c[2] + Math.cos(a) * rP;
      const y2 = c[1] + Math.sin(a) * (rP + thick), z2 = c[2] + Math.cos(a) * (rP + thick);
      pan.push(-halfPan, y, z, halfPan, y, z, -halfPan, y2, z2, halfPan, y2, z2);
    }
    const tri = (a, b, c2) => panIdx.push(a, b, c2);
    for (let i = 0; i < nA; i++) {
      const s0 = i * 4, s1 = (i + 1) * 4;
      tri(s0, s0 + 1, s1); tri(s0 + 1, s1 + 1, s1);
      tri(s0 + 2, s1 + 2, s0 + 3); tri(s0 + 3, s1 + 2, s1 + 3);
      tri(s0, s1, s0 + 2); tri(s0 + 2, s1, s1 + 2);
      tri(s0 + 1, s0 + 3, s1 + 1); tri(s0 + 3, s1 + 3, s1 + 1);
    }
    tri(0, 2, 1); tri(1, 2, 3); tri(nA * 4, nA * 4 + 1, nA * 4 + 2); tri(nA * 4 + 1, nA * 4 + 3, nA * 4 + 2);
    const panG = new THREE.BufferGeometry();
    panG.setAttribute('position', new THREE.Float32BufferAttribute(pan, 3));
    panG.setIndex(panIdx); panG.computeVertexNormals();
    this.addMesh(panG, mats.table, carriage);

    // Feed rolls: fingers driven by paper release; two along x for each angle.
    this.feedRollGroups = [];
    for (const r of rig.feedRolls) {
      const fg = new THREE.Group(); carriage.add(fg);
      const geoms = [];
      for (const fx of m.paper.feedRollX) {
        geoms.push(new THREE.CylinderGeometry(r.radius, r.radius, m.paper.feedRollWidth, 24).rotateZ(Math.PI / 2).translate(fx, r.center[1], r.center[2]));
      }
      this.addMesh(mergeGeometries(geoms), mats.rubber, fg);
      const back = new THREE.Vector3(0, Math.sin(r.angle), Math.cos(r.angle));
      this.feedRollGroups.push({ g: fg, dir: back });
    }

    // Bail: rod with arms, rotating about its pivot.
    const bailG = new THREE.Group(); bailG.position.set(0, rig.bail.pivot[1], rig.bail.pivot[2]);
    carriage.add(bailG); this.bailGroup = bailG;
    const bailBar = new THREE.Vector3(0, rig.bail.bar[1] - rig.bail.pivot[1], rig.bail.bar[2] - rig.bail.pivot[2]);
    const bailX = rig.halfL - 0.0;
    const armLen = bailBar.length();
    const armDir = bailBar.clone().normalize();
    const bailRod = new THREE.CylinderGeometry(rig.bail.radius, rig.bail.radius, bailX * 2, 24).rotateZ(Math.PI / 2).translate(0, bailBar.y, bailBar.z);
    const armG = new THREE.CylinderGeometry(0.002, 0.002, armLen, 10).translate(0, armLen / 2, 0);
    armG.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.atan2(armDir.z, armDir.y)));
    const armP = mergeGeometries([armG.clone().translate(-bailX + 0.002, 0, 0), armG.clone().translate(bailX - 0.002, 0, 0)]);
    this.bailMesh = this.addMesh(bailRod, mats.nickel, bailG);
    this.addMesh(armP, mats.nickel, bailG);
    const rollG = [];
    for (const fx of m.paper.feedRollX) rollG.push(new THREE.CylinderGeometry(m.paper.bailRollerRadius, m.paper.bailRollerRadius, 0.016, 20).rotateZ(Math.PI / 2).translate(fx, bailBar.y, bailBar.z));
    this.addMesh(mergeGeometries(rollG), mats.rubber, bailG);
    const bailProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, bailX * 2, 8).rotateZ(Math.PI / 2).translate(0, bailBar.y, bailBar.z), new THREE.MeshBasicMaterial({ visible: false }));
    bailG.add(bailProxy);
    this.pickables.push({ object: bailProxy, part: () => ({ kind: 'bail', visual: () => this.bailMesh }) });

    // Paper table: from the pan entry up the slope, matching the soft body's table.
    const tipBeta = beta + m.paper.panArc[0];
    const tipR = R + m.paper.panClearance / 2;
    const tip = new THREE.Vector3(0, c[1] + Math.sin(tipBeta) * tipR, c[2] + Math.cos(tipBeta) * tipR);
    const tN = new THREE.Vector3(0, -Math.sin(tipBeta), -Math.cos(tipBeta));    // toward the platen
    const tS = new THREE.Vector3(0, -Math.cos(tipBeta), Math.sin(tipBeta));     // up-slope
    const tableGeo = new THREE.BoxGeometry(m.paper.tableWidth, 0.0018, m.paper.tableLength);
    const tg = new THREE.Group();
    const xAx = new THREE.Vector3(1, 0, 0);
    tg.setRotationFromMatrix(new THREE.Matrix4().makeBasis(xAx, tN, tS.clone().negate()));
    tg.position.copy(tip).addScaledVector(tS, m.paper.tableLength / 2).addScaledVector(tN, -0.001);
    this.table = this.addMesh(tableGeo, mats.table, tg);
    carriage.add(tg);

    // Margin rail and stops.
    const mr = rig.marginRail;
    const rail = new THREE.CylinderGeometry(0.0028, 0.0028, mr.halfLength * 2, 14).rotateZ(Math.PI / 2).translate(0, mr.y, mr.z);
    this.addMesh(rail, mats.steel, carriage);
    const stopGeo = mergeGeometries([new THREE.BoxGeometry(0.012, 0.012, 0.012), new THREE.BoxGeometry(0.004, 0.018, 0.006).translate(0, 0.012, 0.002)]);
    this.marginL = this.addMesh(stopGeo, mats.nickel, carriage);
    this.marginR = this.addMesh(stopGeo.clone(), mats.nickel, carriage);
    this.marginL.position.set(0, mr.y, mr.z); this.marginR.position.set(0, mr.y, mr.z);
    const stopProxy = new THREE.BoxGeometry(0.016, 0.024, 0.016).translate(0, 0.004, 0);
    this.marginProxy = {};
    for (const sideName of ['L', 'R']) {
      const pr = new THREE.Mesh(stopProxy.clone(), new THREE.MeshBasicMaterial({ visible: false }));
      this['margin' + sideName].add(pr);
      // Small and easily hidden by a sheet of paper in front of them, so they win the pick from what is nearby.
      this.pickables.push({ object: pr, raised: () => true, part: () => ({ kind: 'margin', side: sideName, visual: () => this['margin' + sideName] }) });
    }

    // Line-space lever: rotates around its pivot axis.
    const lsG = new THREE.Group(); lsG.position.set(rig.ls.pivot[0], rig.ls.pivot[1], rig.ls.pivot[2]);
    const ax = V(rig.ls.axis);
    this.lsAxis = ax.clone();
    const zAxis = V(rig.ls.rest), yAxis = ax.clone(), xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    zAxis.crossVectors(xAxis, yAxis);
    const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    lsG.setRotationFromMatrix(basis);
    carriage.add(lsG);
    this.lsLever = lsG;
    const lsLen = rig.ls.length;
    const lsBar = new THREE.CapsuleGeometry(0.0021, lsLen, 4, 12).rotateX(Math.PI / 2).translate(0, 0, lsLen / 2);
    // The palm rests in a shallow dished plate at the end of the arm, its hollow facing the hand that throws it.
    const lsPad = lathe([[0, 0.0014], [0.006, 0.0018], [0.0115, 0.0034], [0.0138, 0.0048], [0.0145, 0.0042], [0.0125, 0.0014], [0.006, -0.0008], [0, -0.0014]], 32)
      .rotateZ(Math.PI / 2).scale(1, 0.85, 1.25).translate(0.0005, 0, lsLen + 0.005);
    this.lsMesh = this.addMesh(lsBar, mats.nickel, lsG);
    this.addMesh(lsPad, mats.nickel, lsG);
    this.addMesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.02, 20).translate(0, -0.0045, 0), mats.steel, lsG);
    // Below the hand arm, on the same pivot, a short drive arm works the line-space pawl at the ratchet.
    const lsDrive = new THREE.Vector3(0.55, 0, -0.83).normalize();
    this.addMesh(new THREE.CapsuleGeometry(0.0021, LS_DRIVE_ARM, 4, 10).rotateX(Math.PI / 2).translate(0, 0, LS_DRIVE_ARM / 2)
      .applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(lsDrive.x, lsDrive.z))).translate(0, -0.0125, 0), mats.nickel, lsG);
    this.addMesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.0045, 16).translate(lsDrive.x * LS_DRIVE_ARM, -0.0125, lsDrive.z * LS_DRIVE_ARM), mats.steel, lsG);
    this.mountBlock(rig.ls.pivot, -1);
    const lsProxy = new THREE.Mesh(new THREE.CapsuleGeometry(0.0062, lsLen, 4, 8).rotateX(Math.PI / 2).translate(0, 0, lsLen / 2), new THREE.MeshBasicMaterial({ visible: false }));
    lsG.add(lsProxy);
    this.pickables.push({ object: lsProxy, part: () => ({ kind: 'lsLever', visual: () => this.lsMesh }) });

    // Carriage release lever on the right, paper release on the rear right.
    const lever = (pos, axis, rest, length, mat, kind, travel) => {
      const gr = new THREE.Group(); gr.position.set(...pos);
      const a = V(axis), r = V(rest), xA = new THREE.Vector3().crossVectors(a, r).normalize();
      r.crossVectors(xA, a);
      gr.setRotationFromMatrix(new THREE.Matrix4().makeBasis(xA, a, r));
      carriage.add(gr);
      const bar = new THREE.CapsuleGeometry(0.0017, length, 3, 10).rotateX(Math.PI / 2).translate(0, 0, length / 2);
      const m2 = this.addMesh(bar, mat, gr);
      this.addMesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.012, 18), mats.steel, gr);
      this.mountBlock(pos, 1);
      const tip = this.addMesh(new THREE.SphereGeometry(0.0036, 16, 12).translate(0, 0, length), mats.knob, gr);
      void tip;
      const pr = new THREE.Mesh(new THREE.CapsuleGeometry(0.0052, length, 2, 6).rotateX(Math.PI / 2).translate(0, 0, length / 2), new THREE.MeshBasicMaterial({ visible: false }));
      gr.add(pr);
      this.pickables.push({ object: pr, part: () => ({ kind, visual: () => m2 }) });
      return gr;
    };
    this.crLever = lever(rig.carriageRelease.pos, [0, 1, 0], [0.5, 0.2, 0.84], 0.03, mats.nickel, 'carriageRelease');
    this.prLever = lever(rig.paperRelease.pos, [1, 0, 0], [0, 0.85, -0.5], 0.034, mats.nickel, 'paperRelease');
    void g;
  }

  /** The solid bracket a lever pivots in: from inside the end plate out past the pivot pin, reaching back toward the platen axis. */
  mountBlock(pivot, side) {
    const { rig, mats } = this;
    const inner = side * rig.endPlateX - side * 0.002, outer = pivot[0] + side * 0.0065;
    const w = Math.abs(outer - inner), H = 0.0135, D = 0.0135;
    const toAxisY = rig.c[1] - pivot[1], toAxisZ = rig.c[2] - pivot[2], reach = Math.hypot(toAxisY, toAxisZ) || 1;
    const block = new THREE.BoxGeometry(w, H, D).translate((inner + outer) / 2, pivot[1], pivot[2]);
    const webL = Math.max(0, reach - 0.012);                            // down onto the plate, wherever the pivot stands proud of it
    const web = new THREE.BoxGeometry(0.0055, webL, 0.011).translate(0, webL / 2, 0)
      .applyMatrix4(new THREE.Matrix4().makeRotationX(Math.atan2(toAxisZ, toAxisY)))
      .translate(side * rig.endPlateX + side * 0.0015, pivot[1], pivot[2]);
    this.addMesh(mergeGeometries([block.toNonIndexed(), web.toNonIndexed()]), mats.steel, this.carriage);
  }

  updateCarriage(s, L) {
    const { m, rig } = this;
    const worldX = carriageWorldX(s[L.carriageX]);
    const shift = s[L.shiftY];
    this.carriage.position.set(worldX, shift, 0);
    this.platen.rotation.x = -s[L.platenPsi];
    this.bailGroup.rotation.x = -s[L.bail] * 0.5;   // opening lifts the bar away from the platen
    for (const { g, dir } of this.feedRollGroups) g.position.copy(dir).multiplyScalar(s[L.paperRelease] * 0.0035);
    this.lsLever.quaternion.copy(this._lsRestQ ||= this.lsLever.quaternion.clone());
    this.lsLever.rotateY(s[L.lsLever] * this._lsSense());
    this.crLever.rotation.y = 0;
    if (this._crQ === undefined) { this._crQ = this.crLever.quaternion.clone(); this._prQ = this.prLever.quaternion.clone(); }
    this.crLever.quaternion.copy(this._crQ); this.crLever.rotateY(s[L.carriageRelease] * 0.5);
    this.prLever.quaternion.copy(this._prQ); this.prLever.rotateY(s[L.paperRelease] * 0.8);
    // Stop value equals the carriageX at which the stop reaches the frame's fixed finger at x=0.
    const place = (obj, value) => { obj.position.x = -carriageWorldX(value); };
    place(this.marginL, s[L.marginL]); place(this.marginR, s[L.marginR]);
    void m; void rig;
  }

  /** Sign turning positive lsLever travel into a swing toward the platen (+x tip motion). */
  _lsSense() { return 1; }

  // ---------- spools ----------
  buildSpools() {
    const { m, mats } = this;
    const r = m.ribbon;
    const flange = lathe([[0, 0], [0.0255, 0], [0.0262, 0.0007], [0.0255, 0.0014], [0, 0.0014]], 48);
    const hub = new THREE.CylinderGeometry(r.spoolRadiusEmpty, r.spoolRadiusEmpty, r.spoolWidth, 28);
    const windG = new THREE.CylinderGeometry(1, 1, r.spoolWidth - 0.0032, 40);
    this.spools = { L: this.mkSpool(-r.spoolX, flange, hub, windG), R: this.mkSpool(r.spoolX, flange, hub, windG) };
    void mats;
  }

  mkSpool(x, flange, hub, windG) {
    const { m, mats } = this;
    const r = m.ribbon;
    const group = new THREE.Group(); group.position.set(x, r.spoolY, r.spoolZ);
    this.root.add(group);
    const fTop = flange.clone().translate(0, r.spoolWidth / 2 - 0.0014, 0);
    const fBot = flange.clone().rotateX(Math.PI).translate(0, -r.spoolWidth / 2 + 0.0014, 0);
    const spool = mergeGeometries([fTop.toNonIndexed(), fBot.toNonIndexed(), hub.toNonIndexed()]);
    spool.computeVertexNormals();
    this.addMesh(spool, mats.ribbonSpool, group);
    const wind = this.addMesh(windG, this.windMat ||= new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.82, metalness: 0 }), group);
    wind.scale.set(0.015, 1, 0.015);
    // Static spindle and a strap out to the casting's spool bracket, under the lower flange.
    const sign = Math.sign(x);
    const flangeUnderY = r.spoolY - r.spoolWidth / 2;
    const strapY = flangeUnderY - 0.0008, strapT = 0.0012;
    const strapReach = 0.1105 - Math.abs(x);
    const strap = new THREE.BoxGeometry(strapReach, strapT, 0.014).translate(x + sign * strapReach / 2, strapY, r.spoolZ);
    const boss = new THREE.CylinderGeometry(0.006, 0.006, strapT, 18).translate(x, strapY, r.spoolZ);
    // Only just proud of the upper flange: the line-space lever sweeps over the left spool.
    const spindleLen = r.spoolWidth + SPINDLE_PROUD, spindleY = r.spoolY + SPINDLE_PROUD / 2;
    const spindle = new THREE.CylinderGeometry(0.0022, 0.0022, spindleLen, 12).translate(x, spindleY, r.spoolZ);
    const cap = new THREE.CylinderGeometry(0.004, 0.004, 0.0014, 14).translate(x, spindleY + spindleLen / 2 + 0.0007, r.spoolZ);
    this.addMesh(mergeGeometries([strap, boss.toNonIndexed(), spindle.toNonIndexed(), cap.toNonIndexed()].map((g2) => (g2.index ? g2.toNonIndexed() : g2))), mats.steel, this.frame);
    const pr = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, r.spoolWidth + 0.004, 12), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(pr);
    this.pickables.push({ object: pr, part: () => ({ kind: 'spool', side: x < 0 ? 'L' : 'R', visual: () => wind }) });
    return { group, wind };
  }

  updateSpools(ribbon) {
    if (!ribbon) return;
    const read = (sp) => (typeof sp === 'number' ? { angle: sp, radius: undefined } : sp || {});
    const set = (s, val) => {
      s.group.rotation.y = val.angle ?? 0;
      if (val.radius) s.wind.scale.set(val.radius, 1, val.radius);
    };
    set(this.spools.L, read(ribbon.spoolL)); set(this.spools.R, read(ribbon.spoolR));
  }

  // ---------- vibrator ----------
  buildVibrator() {
    const { g, m, rig, mats } = this;
    const n = V(g.printNormal), w = V(g.strikeDown), x = new THREE.Vector3(1, 0, 0);
    const group = new THREE.Group();
    tmpM.makeBasis(x, n, new THREE.Vector3().crossVectors(x, n)); group.applyMatrix4(tmpM);
    // A pair of C-shaped ears, one each side of the slug, that the ribbon runs through: back wall on the typist's side,
    // tabs past both ribbon edges and small lips round them. All dimensions are built around the ribbon the rope carries.
    const zv = new THREE.Vector3().crossVectors(x, n);
    const down = zv.dot(w) >= 0 ? 1 : -1;    // local z sign that points down the strike line
    const rib = m.ribbon, standoff = rib.standoff ?? 0.0009, ribT = rib.thickness, halfW = rib.width / 2;
    const clear = 0.00025, plate = 0.0003, earX = 0.0046, earWide = 0.0011;
    const box = (cx, cy, cu, sx, sy, su) => new THREE.BoxGeometry(sx, sy, su).translate(cx, cy, cu * down);
    const wallY = standoff + ribT / 2 + clear + plate / 2;
    const lipY = standoff - ribT / 2 - clear - plate / 2;
    const tabU = halfW + clear + plate / 2;
    const ear = (ex) => [
      box(ex, wallY, 0, earWide, plate, (halfW + clear + plate) * 2),                          // back wall
      box(ex, (wallY + lipY) / 2, tabU, earWide, wallY - lipY + plate, plate),                  // bottom tab
      box(ex, (wallY + lipY) / 2, -tabU, earWide, wallY - lipY + plate, plate),                 // top tab
      box(ex, lipY, tabU - 0.0005, earWide, plate, 0.0013),                                     // lips that retain the ribbon edges
      box(ex, lipY, -tabU + 0.0005, earWide, plate, 0.0013),
    ];
    const crossU = halfW + clear + plate + 0.0006;
    const tines = mergeGeometries([
      ...ear(earX), ...ear(-earX),
      box(0, wallY, crossU, (earX + earWide / 2) * 2, plate, 0.0012),                           // yoke joining the ears
      box(0, wallY, crossU + 0.0075, 0.0028, plate, 0.0156),                                    // stem, down the strike line
    ]);
    this.vibrator = this.addMesh(tines, mats.nickel, group);
    const forkProxy = new THREE.Mesh(new THREE.BoxGeometry((earX + earWide) * 2, 0.003, (halfW + 0.002) * 2 + 0.016).translate(0, 0.001, 0.008 * down), new THREE.MeshBasicMaterial({ visible: false }));
    group.add(forkProxy);
    this.pickables.push({ object: forkProxy, low: true, part: () => ({ kind: 'info', label: 'Vibrator (ribbon fork)', visual: () => null }) });
    group.position.copy(V(g.printPoint));
    this.vibratorBase = group.position.clone();
    this.root.add(group);
    this.vibratorGroup = group;
    // Ribbon guide posts, from the ribbon definition.
    if (m.ribbon.guidePostX) {
      const r = m.ribbon, off = r.standoff ?? 0.0009, d = r.vibrator.restDrop;
      const fy = g.printPoint[1] + g.printNormal[1] * off + g.strikeDown[1] * d;
      const fz = g.printPoint[2] + g.printNormal[2] * off + g.strikeDown[2] * d;
      const z = fz + r.guidePostRadius + 0.0005 + (r.guidePostForward ?? 0);
      const post = (x) => new THREE.CylinderGeometry(r.guidePostRadius, r.guidePostRadius, 0.03, 12).translate(x, fy - 0.004, z);
      this.addMesh(mergeGeometries([post(-r.guidePostX), post(r.guidePostX)]), mats.steel, this.frame);
    }
    void rig;
  }

  vibratorOffset(lift) {
    const v = this.m.ribbon.vibrator;
    return v.restDrop - lift;
  }

  updateVibrator(s, L) {
    const off = this.vibratorOffset(s[L.vibratorLift]);
    const w = this.g.strikeDown;
    this.vibratorGroup.position.set(this.vibratorBase.x + w[0] * off, this.vibratorBase.y + w[1] * off + s[L.shiftY], this.vibratorBase.z + w[2] * off);
  }

  // ---------- bell ----------
  buildBell() {
    const { rig, mats } = this;
    const dome = lathe([[0, 0.012], [0.006, 0.0119], [0.014, 0.0095], [0.0192, 0.004], [rig.bell.radius, -0.0065], [rig.bell.radius - 0.0012, -0.0065], [0.0177, 0.003], [0.0132, 0.0083], [0.006, 0.0104], [0, 0.0106]], 48);
    const domeM = this.addMesh(dome, mats.nickel, this.frame);
    this.pickables.push({ object: domeM, low: true, part: () => ({ kind: 'bell', label: 'Bell', cursor: 'pointer', visual: () => domeM, onClick: () => this.onBell?.() }) });
    domeM.position.set(rig.bell.center[0], rig.bell.center[1], rig.bell.center[2]);
    const hammer = new THREE.Group();
    hammer.position.set(...rig.bell.hammerPivot);
    this.frame.add(hammer);
    this.hammer = hammer;
    const arm = new THREE.BoxGeometry(0.03, 0.0018, 0.003).translate(0.015, 0.0, 0);
    const head = new THREE.SphereGeometry(0.0032, 14, 10).translate(0.03, 0.0, 0);
    this.addMesh(mergeGeometries([arm, head.toNonIndexed().index ? head : head]), mats.brass, hammer);
  }

  updateBell(s, L) { this.hammer.rotation.z = -s[L.bellHammer]; }

  // ---------- highlight ----------
  makeHighlight() {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mats.highlight);
    mesh.frustumCulled = false; mesh.renderOrder = 9; mesh.visible = false; mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return { mesh, part: null, visual: null };
  }

  setHighlight(part) {
    const h = this.highlight;
    if (part === h.part) return;
    h.part = part; h.visual = part ? part.visual() : null;
    this.refreshHighlight();
  }

  refreshHighlight() {
    const { mesh, visual } = this.highlight;
    if (!visual) { mesh.visible = false; return; }
    const obj = visual.isObject3D ? visual : null;
    const parent = obj ?? visual.parent;
    parent.updateWorldMatrix(true, false);
    const base = obj ? obj.matrixWorld : parent.matrixWorld.clone().multiply(visual.matrix);
    mesh.geometry = (obj ?? visual).geometry;
    mesh.matrix.copy(base); mesh.matrixWorld.copy(base);
    mesh.matrixWorldNeedsUpdate = false;
    mesh.visible = true;
  }

  // ---------- master update ----------
  update(s, L, soft) {
    this.updateKeys(s, L.keyX);
    this.updateBars(s, L);
    this.updateLevers(s, L);
    this.updateEscapement(s, L);
    this.updateCarriage(s, L);
    this.updateSpools(soft?.ribbon);
    this.updateVibrator(s, L);
    this.updateBell(s, L);
    if (this.highlight.part) this.refreshHighlight();
  }
}

function setLink(inst, i, a, b) {
  const v = tmpV3.copy(b).sub(a);
  const l = v.length() || 1e-6;
  v.divideScalar(l);
  const x = Math.abs(v.y) > 0.9 ? tmpV2.set(1, 0, 0) : tmpV2.set(0, 1, 0);
  const z = (setLink._z ||= new THREE.Vector3()).crossVectors(x, v).normalize();
  x.crossVectors(v, z).normalize();
  tmpM.set(x.x, v.x * l, z.x, a.x, x.y, v.y * l, z.y, a.y, x.z, v.z * l, z.z, a.z, 0, 0, 0, 1);
  inst.setMatrixAt(i, tmpM);
}

function roundBox(geo) { return geo; }
export { rotate };
