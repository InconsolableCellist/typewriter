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
  /** screen: { chars: Uint8Array(2000), attrs: Uint8Array(2000), cursor: { row, col, on } (1-based, as src/wp/screen.js), version } */
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
    this.gain = 1;                  // the video gain the phosphor pass applies: the contrast knob
    this.contrast = 1;
    this.level = 1;                 // the brightness knob's share of the beam current: the whole picture's level
    this.powered = true; this.heat = 1; this.hv = 1; this.dot = 0;
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
    this._tube(dt);
    const s = this.screen;
    let changed = false;
    if (s.version !== this.lastVersion) { this._upload(); changed = true; }
    const c = s.cursor ?? { row: 1, col: 1, on: false };
    const cu = this.pass.uniforms.uCursor.value;
    if (cu.x !== c.col - 1 || cu.y !== c.row - 1 || (cu.z > 0.5) !== !!c.on) { cu.set(c.col - 1, c.row - 1, c.on ? 1 : 0); changed = true; }
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
    // The faceplate: the phosphor coat behind it is a grey-green, not black, and the glass reflects the room.
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x1a1e1c, roughness: 0.3, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.06, envMapIntensity: 0.6 });
    const uniforms = {
      uPhosphor: { value: this.texture },
      uGreen: { value: new THREE.Color(0.2, 1.0, 0.38) },
      uRaster: { value: 0.022 },        // the unlit raster's glow: the brightness knob (HW 1.4), set plainly visible
      uEmission: { value: 2.4 },
      uBright: { value: 1 },            // cathode emission from the heater's warmth
      uScale: { value: new THREE.Vector2(1, 1) },   // the raster's size as the deflection comes up or collapses
      uDot: { value: 0 },               // the spot left in the centre at switch-off
      uTime: { value: 0 },
      uFlicker: { value: 1 },
      uAspect: { value: RASTER_MM.w / RASTER_MM.h },
    };
    mat.userData.uniforms = uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCrtUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n vCrtUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vCrtUv;
uniform sampler2D uPhosphor; uniform vec3 uGreen; uniform vec2 uScale;
uniform float uRaster, uEmission, uBright, uDot, uTime, uFlicker, uAspect;
float crtHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 uv = vCrtUv;
          vec2 c = (uv - 0.5) / max(uScale, vec2(1e-3)) + 0.5;            // raster coordinates
          // The raster's outline: a rectangle with rounded corners and a soft edge, no light outside it.
          vec2 q = abs(c - 0.5) * vec2(uAspect, 1.0) - (vec2(uAspect, 1.0) * 0.5 - 0.035);
          float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.035;
          float inside = 1.0 - smoothstep(-0.004, 0.003, edge);
          vec2 d = (c - 0.5) * vec2(uAspect, 1.0);
          float r2 = dot(d, d);
          // The spot defocuses toward the corners: read the phosphor from a blurrier level there.
          vec2 ph = textureLod(uPhosphor, c, 1.6 * r2).rg;
          // 400 scan lines with dark gaps; where a line is under two pixels on screen they fade to their mean (no moire).
          float rows = c.y * 400.0;
          float w = fwidth(rows);
          float line = mix(0.5 + 0.5 * pow(0.5 + 0.5 * cos(6.2831853 * rows), 0.7), 0.82, smoothstep(0.3, 0.6, w));
          // Where the real lines are finer than the screen's pixels, a light line every other device row stands in, so the
          // raster still reads as scanned at any distance without moire.
          line *= mix(1.0, 0.88 + 0.12 * step(1.0, mod(gl_FragCoord.y, 2.0)), smoothstep(0.3, 0.6, w));
          float vign = 1.0 - 0.32 * r2 * 2.2;
          // Life: a slow mains beat rolling up the screen, the frame-to-frame shimmer, and the phosphor's grain.
          float hum = 1.0 + 0.045 * sin(6.2831853 * (c.y - uTime * 0.21));
          // The phosphor's grain, and the video noise, which changes every field (60 a second).
          float grain = 0.94 + 0.12 * crtHash(floor(uv * vec2(1100.0, 760.0)));
          float field = floor(uTime * 60.0);
          float snow = crtHash(floor(uv * vec2(700.0, 480.0)) + vec2(field * 17.0, field * 31.0));
          grain *= 0.9 + 0.2 * snow;
          float core = (0.78 * ph.r + 0.22 * ph.g) * line * grain;
          vec3 halo = textureLod(uPhosphor, c, 3.0).rgb * 0.16 + textureLod(uPhosphor, c, 5.0).rgb * 0.14 + textureLod(uPhosphor, c, 7.0).rgb * 0.1;
          float glow = (halo.r * 0.8 + halo.g * 0.2);
          float raster = uRaster * line * (0.6 + 0.8 * snow);
          float near = 1.0 - smoothstep(-0.01, 0.05, edge);                   // the halo spreads a little past the raster
          float e = inside * uBright * hum * uFlicker * vign * (uEmission * core + raster) + 1.8 * uBright * glow * near;
          // Switched off, the deflection collapses first and leaves a bright spot in the centre that fades.
          vec2 s = (uv - 0.5) * vec2(uAspect, 1.0);
          e += uDot * (exp(-dot(s, s) / 0.00012) * 6.0 + exp(-dot(s, s) / 0.004) * 0.4);
          totalEmissiveRadiance += uGreen * e;
        }`);
    };
    return mat;
  }

  /**
   * The display's knobs (src/kits/wp/controls.js crtDrive): contrast is the video gain on the characters; brightness
   * the grid bias, which sets the level of the whole picture and how much of the bare raster glows behind it.
   */
  setKnobs({ gain, raster, level }) {
    if (Number.isFinite(gain)) this.contrast = gain;
    if (Number.isFinite(level)) this.level = level;
    if (Number.isFinite(raster)) this.material.userData.uniforms.uRaster.value = raster;
  }

  /** The station's power: the heater warms over seconds, the deflection follows the high voltage in a fraction. */
  setPower(on) {
    if (on === this.powered) return;
    if (this.powered && !on) this.dot = 1;
    this.powered = on;
  }

  _tube(dt) {
    const on = this.powered ? 1 : 0;
    this.heat += (on - this.heat) * (1 - Math.exp(-dt / (on ? 2.2 : 12)));          // cathode: about 6 s to full
    this.hv += (on - this.hv) * (1 - Math.exp(-dt / (on ? 0.25 : 0.06)));
    this.dot *= Math.exp(-dt / 0.9);
    const u = this.material.userData.uniforms;
    const bright = Math.pow(this.heat, 2.2);
    u.uBright.value = bright * this.level;
    u.uScale.value.set(Math.max(0.002, Math.min(1, this.hv * 1.08)), Math.max(0.002, Math.min(1, this.hv * 1.15)));
    u.uDot.value = this.dot * this.heat;
    u.uTime.value += dt;
    u.uFlicker.value = 1 + (Math.random() - 0.5) * 0.02;
    this.gain = this.contrast;
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
