// The display station's CRT: a GPU character generator. The software's 80 x 25 buffer (a character and an attribute
// byte per cell, the real 4 KB) is uploaded as a texture only when it changes; a phosphor pass draws the dots of the
// 640 x 400 raster at 2 x 2 samples per dot into a half-float target, keeping a fast and a slow decay component; the
// glass material samples that target, adds halation from its mips, and reflects the room. See
// docs/displaywriter/architecture.md section 9 and hardware.md 1.4-1.6.
import * as THREE from 'three';
import { FONT8X16 } from '../../wp/font/font8x16.js';

export const COLS = 80, ROWS = 25;
export const ATTR = { underline: 1, reverse: 2, bright: 4, blink: 8, halfUp: 16, halfDown: 32, symbol: 64 };
const RASTER = { w: 640, h: 400 };
const SAMPLES = 2;                                      // phosphor samples per dot along each axis
const DECAY = { fast: 0.030, slow: 0.250 };            // s, the two components of the phosphor's after-glow (assumed, 9.1)
const BLINK_HZ = 2.5;
const STATIC_AFTER = 1.5;                              // s with nothing changing and nothing blinking before the pass stops
export const RASTER_MM = { w: 0.205, h: 0.136 };       // m, the lit raster on the glass

/** The 8 x 16 glyphs of both fonts in one 256 x 256 R8 atlas: 32 glyphs a row, font 1 in rows 0-7, font 2 in 8-15. */
function makeFontTexture() {
  const data = new Uint8Array(256 * 256);
  for (let g = 0; g < 512; g++) {
    const gx = (g % 32) * 8, gy = Math.floor(g / 32) * 16;
    for (let r = 0; r < 16; r++) {
      const bits = FONT8X16[g * 16 + r];
      for (let c = 0; c < 8; c++) data[(gy + r) * 256 + gx + c] = bits & (0x80 >> c) ? 255 : 0;
    }
  }
  const t = new THREE.DataTexture(data, 256, 256, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true;
  return t;
}

const PHOSPHOR_FS = /* glsl */ `
precision highp float;
uniform sampler2D uGrid, uFont, uPrev;
uniform float uDecayFast, uDecaySlow, uBlinkOn, uGain;
uniform vec3 uCursor;            // col, row, on
in vec2 vUv;
out vec4 outColor;

float dotAt(vec2 dotPos) {
  if (dotPos.x < 0.0 || dotPos.y < 0.0 || dotPos.x >= 640.0 || dotPos.y >= 400.0) return 0.0;
  vec2 cell = floor(dotPos / vec2(8.0, 16.0));
  vec2 inCell = dotPos - cell * vec2(8.0, 16.0);
  vec2 ga = texelFetch(uGrid, ivec2(cell), 0).rg * 255.0;
  float ch = floor(ga.x + 0.5); int attr = int(ga.y + 0.5);
  float row = floor(inCell.y);
  if ((attr & 16) != 0) row += 3.0;                     // half index up: the glyph moves up 3 dots
  if ((attr & 32) != 0) row -= 3.0;
  float glyph = ch + (((attr & 64) != 0) ? 256.0 : 0.0);
  float lit = 0.0;
  if (row >= 0.0 && row < 16.0) lit = texelFetch(uFont, ivec2(mod(glyph, 32.0) * 8.0 + floor(inCell.x), floor(glyph / 32.0) * 16.0 + row), 0).r;
  if ((attr & 1) != 0 && floor(inCell.y) == 13.0) lit = 1.0;              // underline: row D
  bool cursorHere = uCursor.z > 0.5 && cell.x == uCursor.x && cell.y == uCursor.y;
  if (cursorHere && floor(inCell.y) == 14.0) lit = 1.0;                    // cursor: row E
  if ((attr & 2) != 0) lit = 1.0 - lit;                                     // reverse video
  if ((attr & 8) != 0) lit *= uBlinkOn;
  float gain = ((attr & 4) != 0 || cursorHere) ? 1.0 : 0.72;                // brightened cells and the cursor's cell
  return lit * gain;
}

void main() {
  vec2 p = vec2(vUv.x * 640.0, (1.0 - vUv.y) * 400.0);
  vec2 d = floor(p);
  float sub = fract(p.x) - 0.5;
  // The beam spreads a little along the scan line: the dot, plus a share of the neighbour on the near side.
  float lit = dotAt(d) * 0.8 + dotAt(d + vec2(sign(sub), 0.0)) * 0.2 * abs(sub) * 2.0;
  lit *= uGain;
  vec2 prev = texture(uPrev, vUv).rg;
  outColor = vec4(max(prev.r * uDecayFast, lit), max(prev.g * uDecaySlow, lit), 0.0, 1.0);
}`;

const FULLSCREEN_VS = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class CRT {
  /** screen: { chars: Uint8Array(2000), attrs: Uint8Array(2000), cursor: { row, col, on }, version } */
  constructor({ renderer, screen }) {
    this.renderer = renderer;
    this.screen = screen;
    this.grid = new Uint8Array(COLS * ROWS * 2);
    this.gridTex = new THREE.DataTexture(this.grid, COLS, ROWS, THREE.RGFormat, THREE.UnsignedByteType);
    this.gridTex.magFilter = this.gridTex.minFilter = THREE.NearestFilter;
    this.gridTex.generateMipmaps = false; this.gridTex.flipY = false;
    this.fontTex = makeFontTexture();
    const halfFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const mk = () => new THREE.WebGLRenderTarget(RASTER.w * SAMPLES, RASTER.h * SAMPLES, {
      type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false,
    });
    this.targets = [mk(), mk()];
    this.current = 0;
    this.pass = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: 'in vec3 position;\n' + FULLSCREEN_VS, fragmentShader: PHOSPHOR_FS,
      uniforms: {
        uGrid: { value: this.gridTex }, uFont: { value: this.fontTex }, uPrev: { value: this.targets[1].texture },
        uDecayFast: { value: 0 }, uDecaySlow: { value: 0 }, uBlinkOn: { value: 1 }, uGain: { value: 1 },
        uCursor: { value: new THREE.Vector3(0, 0, 0) },
      },
      depthTest: false, depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri, this.pass);
    this.quad.frustumCulled = false;
    this.passScene = new THREE.Scene(); this.passScene.add(this.quad);
    this.passCamera = new THREE.Camera();
    this.lastVersion = -1; this.quiet = 0; this.blinkT = 0;
    this.gain = 1;                  // contrast knob and the tube's warm-up multiply this
    this.litFraction = 0;           // for the green spill light
    this.material = this.makeGlass();
  }

  /** The phosphor picture, for the glass and for the flat "Screen" view. */
  get texture() { return this.targets[this.current].texture; }

  _upload() {
    const s = this.screen;
    let lit = 0;
    for (let i = 0; i < COLS * ROWS; i++) {
      const ch = s.chars[i], at = s.attrs[i];
      this.grid[i * 2] = ch; this.grid[i * 2 + 1] = at;
      if (at & ATTR.reverse) lit += 0.8; else if (ch > 32 && !(at & ATTR.symbol)) lit += 0.18;
    }
    this.gridTex.needsUpdate = true;
    this.litFraction = lit / (COLS * ROWS);
    this.lastVersion = s.version;
  }

  /** Runs the phosphor pass if the picture is changing, blinking or still fading. */
  update(dt) {
    const s = this.screen;
    let changed = false;
    if (s.version !== this.lastVersion) { this._upload(); changed = true; }
    const c = s.cursor ?? { row: 0, col: 0, on: false };
    const cu = this.pass.uniforms.uCursor.value;
    if (cu.x !== c.col || cu.y !== c.row || (cu.z > 0.5) !== !!c.on) { cu.set(c.col, c.row, c.on ? 1 : 0); changed = true; }
    this.blinkT += dt;
    const blinkOn = (this.blinkT * BLINK_HZ) % 1 < 0.5 ? 1 : 0;
    const blinking = this._hasBlink();
    if (blinking && blinkOn !== this.pass.uniforms.uBlinkOn.value) changed = true;
    if (this.gain !== this.pass.uniforms.uGain.value) changed = true;
    this.quiet = changed ? 0 : this.quiet + dt;
    if (this.quiet > STATIC_AFTER) return;
    const u = this.pass.uniforms;
    u.uDecayFast.value = Math.exp(-dt / DECAY.fast);
    u.uDecaySlow.value = Math.exp(-dt / DECAY.slow);
    u.uBlinkOn.value = blinkOn;
    u.uGain.value = this.gain;
    const prev = this.targets[this.current], next = this.targets[1 - this.current];
    u.uPrev.value = prev.texture;
    const r = this.renderer, old = r.getRenderTarget();
    r.setRenderTarget(next);
    r.render(this.passScene, this.passCamera);
    r.setRenderTarget(old);
    this.current = 1 - this.current;
    this.material.userData.uniforms.uPhosphor.value = this.texture;
  }

  _hasBlink() {
    if (this.lastVersion !== this._blinkVersion) {
      this._blinkVersion = this.lastVersion;
      this._blink = this.screen.attrs.some((a) => a & ATTR.blink);
    }
    return this._blink;
  }

  /**
   * Glass over the raster: a dark faceplate that reflects the room, with the phosphor's light as emission. `uv`
   * spans the lit raster; the mesh's uv outside 0..1 is the unlit border of the tube face.
   */
  makeGlass() {
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x0b0d0c, roughness: 0.32, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 0.55 });
    const uniforms = {
      uPhosphor: { value: this.texture },
      uGreen: { value: new THREE.Color(0.18, 1.0, 0.36) },
      uRaster: { value: 0.0 },          // brightness knob: the raster's own glow when turned fully up
      uEmission: { value: 2.2 },
    };
    mat.userData.uniforms = uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCrtUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n vCrtUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCrtUv; uniform sampler2D uPhosphor; uniform vec3 uGreen; uniform float uRaster, uEmission;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 uv = vCrtUv;
          if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
            vec2 ph = texture(uPhosphor, uv).rg;
            // Scan lines: 400 rows; fade to their mean where they would alias (under two pixels a row on screen).
            float rows = uv.y * 400.0;
            float w = fwidth(rows);
            float line = mix(0.72 + 0.28 * cos(6.2831853 * rows), 1.0, smoothstep(0.35, 0.6, w));
            float core = (0.8 * ph.r + 0.2 * ph.g) * line;
            vec3 halo = textureLod(uPhosphor, uv, 4.0).rgb * 0.18 + textureLod(uPhosphor, uv, 6.0).rgb * 0.12;
            totalEmissiveRadiance += uGreen * (uEmission * core + 1.6 * (halo.r * 0.8 + halo.g * 0.2) + uRaster * 0.04);
          }
        }`);
    };
    return mat;
  }
}

/**
 * The tube face: a gently curved rectangle (a patch of a sphere of `radius`), `w` x `h` m, with uv 0..1 over the lit
 * raster centred in it. Built facing +z, its centre at the origin, bulging toward +z.
 */
export function makeTubeFace(w, h, radius = 0.6, segs = [24, 16]) {
  const geo = new THREE.PlaneGeometry(w, h, segs[0], segs[1]);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const corner = Math.sqrt(radius * radius - (w * w + h * h) / 4);   // the corners sit at z = 0, the centre bulges forward
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, Math.sqrt(Math.max(0, radius * radius - x * x - y * y)) - corner);
    uv.setXY(i, (x / RASTER_MM.w) + 0.5, (y / RASTER_MM.h) + 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}
