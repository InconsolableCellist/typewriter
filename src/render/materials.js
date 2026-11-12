// PBR material library. Procedural grain is the fallback; files appear from the assets pipeline under
// public/assets/textures/ and are picked up when present (see loadStudioTextures).
import * as THREE from 'three';

function noiseCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fn(x / size, y / size) * 255;
    const i = (x + y * size) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeGrainTextures() {
  // Stipple noise as the top-coat "orange peel" of japanned casting.
  const r = (n) => { let x = n; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; };
  const rnd = r(7);
  const data = new Float32Array(256 * 256);
  for (let i = 0; i < data.length; i++) data[i] = rnd();
  const smooth = (x, y) => {
    const ix = Math.floor(x) & 255, iy = Math.floor(y) & 255, fx = x % 1, fy = y % 1;
    const at = (a, b) => data[((a & 255) + (b & 255) * 256)];
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(at(ix, iy), at(ix + 1, iy), fx), l(at(ix, iy + 1), at(ix + 1, iy + 1), fx), fy);
  };
  const c = noiseCanvas(512, (u, v) => {
    const n = 0.55 * smooth(u * 90, v * 90) + 0.3 * smooth(u * 31, v * 31) + 0.15 * smooth(u * 9, v * 9);
    return 0.7 + 0.3 * n;
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.anisotropy = 8;
  return { rough: t };
}

/** Fine orange-peel of a powder coat: a tileable height field turned into a normal map plus a roughness map. */
function makePowderCoat() {
  const size = 512;
  let x = 91;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const noise = (cells) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (u, v) => {
      const fxx = u * cells, fyy = v * cells;
      const ix = Math.floor(fxx), iy = Math.floor(fyy), fx = fxx - ix, fy = fyy - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const at = (a, b) => g[((a % cells) + cells) % cells + (((b % cells) + cells) % cells) * cells];
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(at(ix, iy), at(ix + 1, iy), sx), l(at(ix, iy + 1), at(ix + 1, iy + 1), sx), sy);
    };
  };
  const n1 = noise(70), n2 = noise(150), n3 = noise(24);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x2 = 0; x2 < size; x2++) {
    const u = x2 / size, v = y / size;
    h[x2 + y * size] = 0.55 * n1(u, v) + 0.3 * n2(u, v) + 0.15 * n3(u, v);
  }
  const nData = new Uint8Array(size * size * 4), rData = new Uint8Array(size * size * 4);
  const strength = 3.2;
  for (let y = 0; y < size; y++) for (let x2 = 0; x2 < size; x2++) {
    const at = (a, b) => h[((a + size) % size) + ((b + size) % size) * size];
    const dx = (at(x2 + 1, y) - at(x2 - 1, y)) * strength, dy = (at(x2, y + 1) - at(x2, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (x2 + y * size) * 4;
    nData[i] = 127.5 * (1 - dx / l); nData[i + 1] = 127.5 * (1 - dy / l); nData[i + 2] = 127.5 * (1 + 1 / l); nData[i + 3] = 255;
    const r = 215 + 40 * (at(x2, y) - 0.5);
    rData[i] = rData[i + 1] = rData[i + 2] = r; rData[i + 3] = 255;
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
    return t;
  };
  return { normal: tex(nData), rough: tex(rData) };
}

export function createMaterials() {
  const grain = makeGrainTextures();

  const std = (o) => new THREE.MeshStandardMaterial({ ...o });
  const phy = (o) => new THREE.MeshPhysicalMaterial({ ...o });

  // Satin black powder coat over steel: a matte dielectric with a broad, weak top lobe and a fine orange peel.
  const POWDER_TILE = 0.035;
  const powder = makePowderCoat();
  const powderCoat = (repeat) => {
    const normalMap = powder.normal.clone(); normalMap.repeat.set(repeat, repeat); normalMap.needsUpdate = true;
    const roughnessMap = powder.rough.clone(); roughnessMap.repeat.set(repeat, repeat); roughnessMap.needsUpdate = true;
    return { normalMap, roughnessMap, normalScale: new THREE.Vector2(0.32, 0.32) };
  };
  const mats = {
    japan: phy({ color: 0x15161a, roughness: 0.66, metalness: 0.0, clearcoat: 0.28, clearcoatRoughness: 0.5, specularIntensity: 0.7, ...powderCoat(1 / POWDER_TILE) }),
    castDark: std({ color: 0x17181b, roughness: 0.62, metalness: 0.55, roughnessMap: grain.rough }),
    nickel: phy({ color: 0xb9b7b1, roughness: 0.3, metalness: 1.0, envMapIntensity: 1.0 }),
    steel: phy({ color: 0x83868b, roughness: 0.4, metalness: 1.0 }),
    steelDark: phy({ color: 0x3e4045, roughness: 0.5, metalness: 1.0 }),
    blued: phy({ color: 0x24262c, roughness: 0.46, metalness: 1.0 }),   // black-oxide bars
    brass: phy({ color: 0xa2834b, roughness: 0.36, metalness: 1.0 }),
    rubber: phy({ color: 0x0f0f10, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.7 }),
    felt: phy({ color: 0x31382e, roughness: 1, metalness: 0 }),
    knob: phy({ color: 0x0c0c0e, roughness: 0.48, metalness: 0.0, clearcoat: 0.45, clearcoatRoughness: 0.38 }),
    table: phy({ color: 0x15161a, roughness: 0.6, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.5, ...powderCoat(1 / POWDER_TILE) }),
    desk: phy({ color: 0xffffff, roughness: 1, metalness: 0 }),
    keyCap: phy({ color: 0xffffff, roughness: 0.28, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.09, envMapIntensity: 1.0 }),
    slugFace: std({ color: 0xffffff, roughness: 0.38, metalness: 0.92 }),
    ribbonSpool: phy({ color: 0x1c1d20, roughness: 0.55, metalness: 0.8 }),
    highlight: new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uAmt; void main(){ float f = pow(1. - abs(dot(normalize(vN), normalize(vV))), 1.6); gl_FragColor = vec4(uColor, (0.06 + 0.5*f)*uAmt); }',
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.86, 0.6) }, uAmt: { value: 1 } },
    }),
  };

  mats.japanGlb = mats.japan.clone();
  Object.assign(mats.japanGlb, powderCoat(0.2 / POWDER_TILE));   // GLB UVs are 0.2 m per unit
  mats.nickelGlb = mats.nickel.clone();
  return { mats };
}

// ---- Authored material sets (docs/assets.md, public/assets/textures/materials.json) ----
const BASE = '/assets/textures/';

async function fetchImage(url) {
  const res = await fetch(url);
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
  return res.blob();
}

function asTexture(img, { srgb, aniso, mipmaps }) {
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.flipY = false;
  if (mipmaps) { t.mipmaps = mipmaps; t.generateMipmaps = false; t.minFilter = THREE.LinearMipmapLinearFilter; }
  t.needsUpdate = true;
  return t;
}

async function mapTexture(name, kind, aniso, srgb = false, size = 0) {
  const blob = await fetchImage(`${BASE}${name}_${kind}.avif`);
  if (!blob) return null;
  const opts = size ? { imageOrientation: 'flipY', resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } : { imageOrientation: 'flipY' };
  return asTexture(await createImageBitmap(blob, opts), { srgb, aniso });
}

/** Roughness with its authored mip chain (variance folded in at every level): the specular-aliasing fix at source. */
async function roughnessChain(name, aniso) {
  const blob = await fetchImage(`${BASE}${name}_roughness_mips.avif`);
  if (!blob) return mapTexture(name, 'roughness', aniso);
  const atlas = await createImageBitmap(blob);
  const H = atlas.height;
  const mips = [await createImageBitmap(atlas, 0, 0, H, H, { imageOrientation: 'flipY' })];
  for (let s = H >> 1, y = 0; s >= 1; y += s, s >>= 1) mips.push(await createImageBitmap(atlas, H, y, s, s, { imageOrientation: 'flipY' }));
  atlas.close?.();
  return asTexture(mips[0], { aniso, mipmaps: mips });
}

/** Physical parameters from materials.json that this renderer applies. */
const PHYSICAL_KEYS = ['clearcoat', 'clearcoatRoughness', 'ior', 'envMapIntensity', 'sheen', 'sheenRoughness', 'specularIntensity', 'anisotropy', 'anisotropyRotation'];

/** `only` limits loading to the named sets (a machine that uses few of them downloads only those). */
export async function loadStudioTextures(mats, paperMaterial, aniso = 8, { lowTier = false, only = null } = {}) {
  let table = {};
  try { table = await (await fetch(`${BASE}materials.json`)).json(); } catch { /* defaults below */ }
  const tile = (n, d) => table[n]?.tile ?? d;
  const glb = (n, d) => (T => [0.2 / T, 0.2 / T])(tile(n, d));
  const metres = (n, d) => (T => [1 / T, 1 / T])(tile(n, d));

  // Sets used by more than one material share one upload; only the repeat differs.
  const cache = new Map();
  const loadSet = (name, { metal, sizes, noAlbedo }) => {
    if (!cache.has(name)) {
      cache.set(name, Promise.all([
        noAlbedo ? null : mapTexture(name, 'albedo', aniso, true, sizes?.albedo),
        mapTexture(name, 'normal', aniso, false, sizes?.detail),
        sizes ? mapTexture(name, 'roughness', aniso, false, sizes.detail) : roughnessChain(name, aniso),
        metal ? mapTexture(name, 'metalness', aniso) : null,
      ]));
    }
    return cache.get(name);
  };
  const withRepeat = (t, r) => { if (!t) return null; const c = t.clone(); c.repeat.set(r[0], r[1]); c.needsUpdate = true; return c; };

  // Only sets with real variation in metalness load that map; the others are a constant metalness.
  const jobs = [
    { name: 'powder_coat', mat: mats.japanGlb, repeat: glb('powder_coat', 0.08), metal: true },
    { name: 'powder_coat', mat: mats.japan, repeat: metres('powder_coat', 0.08), metal: true },
    { name: 'powder_coat', mat: mats.table, repeat: [3, 3], metal: true },
    { name: 'nickel_polished', mat: mats.nickelGlb, repeat: glb('nickel_polished', 0.06) },
    { name: 'nickel_polished', mat: mats.nickel, repeat: [3, 1] },
    { name: 'chrome_steel', mat: mats.steel, repeat: [2, 2] },
    { name: 'blued_spring_steel', mat: mats.blued, repeat: [2, 2], skip: ['anisotropy', 'anisotropyRotation'] },   // thin bars with stretched UVs: no rolling-line streaks
    { name: 'bead_blasted_aluminium', mat: mats.ribbonSpool, repeat: [1.5, 1.5], tint: 0.3 },
    { name: 'vulcanised_rubber', mat: mats.rubber, repeat: [1.04, 2.4] },
    { name: 'green_felt', mat: mats.felt, repeat: [4, 0.3] },
  ];
  // The desk is the one set without a mip-chain roughness (one tile covers it, so it never shrinks far); low tier halves its detail maps.
  jobs.push({ name: 'walnut_desk', mat: mats.desk, repeat: [0.2 / tile('walnut_desk', 2.2), 0.2 / tile('walnut_desk', 2.2)], sizes: lowTier ? { detail: 1024 } : {} });
  if (paperMaterial) jobs.push({ name: 'paper_fibre', mat: paperMaterial, repeat: [1, 1.29], keepColor: true, noAlbedo: true });
  for (const j of jobs) {
    if (only && !only.includes(j.name)) continue;
    try {
      const [a, n, r, mt] = await loadSet(j.name, j);
      const phys = table[j.name]?.physical ?? {};
      if (n) { j.mat.normalMap = withRepeat(n, j.repeat); j.mat.normalScale = new THREE.Vector2(1, 1); }
      if (r) { j.mat.roughnessMap = withRepeat(r, j.repeat); j.mat.roughness = 1; }
      if (a && !j.noAlbedo) { j.mat.map = withRepeat(a, j.repeat); if (!j.keepColor) j.mat.color.setRGB(j.tint ?? 1, j.tint ?? 1, j.tint ?? 1); }
      if (mt) { j.mat.metalnessMap = withRepeat(mt, j.repeat); j.mat.metalness = 1; }
      else if (phys.metalness !== undefined) j.mat.metalness = phys.metalness;
      for (const k of PHYSICAL_KEYS) if (phys[k] !== undefined && k in j.mat && !j.skip?.includes(k)) j.mat[k] = phys[k];
      if (phys.sheenColor && j.mat.sheenColor) j.mat.sheenColor.setRGB(...phys.sheenColor);
      j.mat.needsUpdate = true;
    } catch (e) { console.info('texture skipped', j.name, e); }
    await new Promise((r2) => setTimeout(r2, 16));   // spread the GPU uploads over several frames
  }
}

/** A DataTexture with partial uploads through texSubImage2D, driven by dirty rects (contract: RG). */
export class SubrectTexture {
  /** source: { data, width, height, dirty }, two bytes per texel, or one with { singleChannel: true }. */
  constructor(renderer, source, { singleChannel = false } = {}) {
    this.renderer = renderer;
    this.source = source;
    this.singleChannel = singleChannel;
    this.tex = new THREE.DataTexture(source.data, source.width, source.height, singleChannel ? THREE.RedFormat : THREE.RGFormat, THREE.UnsignedByteType);
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.flipY = false;
    this.tex.needsUpdate = true;
    this.uploaded = false;
    this._since = 0;
  }

  flush() {
    const { renderer, source: s, tex } = this;
    if (!s.dirty.length) return;
    const gl = renderer.getContext();
    const props = renderer.properties.get(tex);
    const handle = props.__webglTexture;
    if (!handle) { s.dirty.length = 0; tex.needsUpdate = true; return; }
    const st = renderer.state;
    st.bindTexture(gl.TEXTURE_2D, handle);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, s.width);
    for (const r of s.dirty) {
      const x = Math.max(0, r.x | 0), y = Math.max(0, r.y | 0);
      const w = Math.min(s.width - x, r.w | 0), h = Math.min(s.height - y, r.h | 0);
      if (w <= 0 || h <= 0) continue;
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, this.singleChannel ? gl.RED : gl.RG, gl.UNSIGNED_BYTE, s.data);
      this._since += w * h;
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    st.unbindTexture();
    s.dirty.length = 0;
  }
}
