// The "Screen" card (docs/displaywriter/architecture.md 9.4): the display's phosphor picture drawn flat and legible in
// a card where the typewriters show Print Point, whatever the camera is looking at. It reads the CRT's own phosphor
// target and tube state (crt.js), so it shows the same scan lines, after-glow, halation, warm-up and switch-off spot as
// the glass, without the room's reflections. Drawn on the main canvas into the card's rectangle after the frame,
// like HeadView. Foldable, resizable from its corner (the height follows the tube's shape), and hidden by a setting;
// all three are remembered.
import * as THREE from 'three';
import { RASTER_MM } from '../render/wp/crt.js';

const KEY = 'typewriter.wp.screenCard';
const ASPECT = 1.56;                  // the card's tube face, the raster and a narrow dark border
const MIN_W = 220, EDGE = 28, GAP = 12, HEADER = 22;

const FS = /* glsl */ `
precision highp float;
uniform sampler2D uPhosphor;
uniform vec3 uGreen;
uniform vec2 uScale;
uniform float uRaster, uBright, uDot, uTime, uFlicker, uAspect;
in vec2 vUv;
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // The face bulges a little: a slight barrel, as a curved tube seen square on.
  vec2 f = vUv * 2.0 - 1.0;
  f *= 1.0 + 0.022 * dot(f, f);
  vec2 uv = f * 0.5 + 0.5;
  vec2 r = (uv - 0.5) / vec2(0.94, 0.92) + 0.5;                       // the raster inside the border
  vec2 c = (r - 0.5) / max(uScale, vec2(1e-3)) + 0.5;
  vec2 q = abs(c - 0.5) * vec2(uAspect, 1.0) - (vec2(uAspect, 1.0) * 0.5 - 0.035);
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.035;
  float inside = 1.0 - smoothstep(-0.004, 0.003, edge);
  vec2 d = (c - 0.5) * vec2(uAspect, 1.0);
  float r2 = dot(d, d);
  vec2 ph = texture(uPhosphor, c).rg;
  float rows = c.y * 400.0;
  float w = fwidth(rows);
  // The 400 scan lines, drawn as dark gaps. Where they are finer than about 3.5 screen pixels they would only shimmer,
  // so every 2nd, 4th, ... gap is drawn instead: still locked to the raster, always visible, never a moire.
  float k = exp2(ceil(log2(max(1.0, w * 3.5))));
  float band = 0.5 + 0.5 * cos(6.2831853 * rows / k);
  float line = 1.0 - 0.32 * pow(band, 6.0);
  float vign = 1.0 - 0.3 * r2 * 2.2;
  float hum = 1.0 + 0.04 * sin(6.2831853 * (c.y - uTime * 0.21));
  float grain = 0.95 + 0.1 * hash(floor(vUv * vec2(1100.0, 760.0)));
  float field = floor(uTime * 60.0);
  float snow = hash(floor(vUv * vec2(700.0, 480.0)) + vec2(field * 17.0, field * 31.0));
  grain *= 0.9 + 0.2 * snow;
  float core = (0.8 * ph.r + 0.2 * ph.g) * line * grain;
  vec3 halo = textureLod(uPhosphor, c, 3.0).rgb * 0.16 + textureLod(uPhosphor, c, 5.0).rgb * 0.12 + textureLod(uPhosphor, c, 7.0).rgb * 0.08;
  float glow = halo.r * 0.8 + halo.g * 0.2;
  float raster = uRaster * line * (0.6 + 0.8 * snow);
  float near = 1.0 - smoothstep(-0.01, 0.05, edge);
  float e = inside * uBright * hum * uFlicker * vign * (1.75 * core + raster) + 1.4 * uBright * glow * near;
  vec2 s = (uv - 0.5) * vec2(uAspect, 1.0);
  e += uDot * (exp(-dot(s, s) / 0.00012) * 6.0 + exp(-dot(s, s) / 0.004) * 0.4);
  // The faceplate: grey-green glass over the phosphor coat, darker toward the rim, with a soft sheen at the top.
  float rim = smoothstep(0.75, 1.15, max(abs(f.x), abs(f.y)));
  vec3 plate = vec3(0.016, 0.021, 0.019) * (1.0 - 0.6 * rim) + vec3(0.03) * smoothstep(0.55, 1.0, f.y) * (1.0 - abs(f.x));
  vec3 col = plate + uGreen * e;
  col = 1.0 - exp(-col * 1.15);                                     // a gentle shoulder, then to display gamma
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

const VS = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); return s && typeof s === 'object' ? s : {}; } catch { return {}; }
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not remembered */ }
}

export class ScreenCard {
  /** renderer: the stage's; crt: the CRT; insets: #insets; panel: #panel (the card never grows down into it). */
  constructor({ renderer, crt, insets, panel }) {
    this.renderer = renderer; this.crt = crt; this.insets = insets; this.panel = panel;
    this.state = { visible: true, folded: false, w: null, ...load() };
    const g = crt.material.userData.uniforms;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
      uniforms: {
        uPhosphor: { value: crt.texture }, uGreen: g.uGreen, uScale: g.uScale, uRaster: g.uRaster, uBright: g.uBright,
        uDot: g.uDot, uTime: g.uTime, uFlicker: g.uFlicker, uAspect: { value: RASTER_MM.w / RASTER_MM.h },
      },
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(tri, this.material);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(quad);
    this.camera = new THREE.Camera();
    this._size = new THREE.Vector2();

    for (const s of insets.querySelectorAll('section')) s.hidden = true;   // Print Point belongs to the typewriters
    const card = this.card = document.createElement('section');
    card.className = 'card see-through';
    card.id = 'screenCard';
    card.innerHTML = '<header><span>SCREEN</span><button class="fold" title="collapse" type="button" tabindex="-1">▾</button></header><div class="screen-body"></div><div class="screen-resize" title="drag to resize"></div>';
    insets.appendChild(card);
    this.body = card.querySelector('.screen-body');
    card.querySelector('.fold').addEventListener('click', (e) => { this.state.folded = !this.state.folded; save(this.state); this.apply(); e.currentTarget.blur(); });
    this.resizable(card.querySelector('.screen-resize'));
    new ResizeObserver(() => this.apply()).observe(panel);
    window.addEventListener('resize', () => this.apply());
    // The picture's rectangle, read again only when the card's layout may have changed (apply(), a resize of the card
    // or of its body), not every frame: the read can force a style recalculation.
    this.rect = null;
    new ResizeObserver(() => { this.rect = null; }).observe(card);
    new ResizeObserver(() => { this.rect = null; }).observe(this.body);
    this.apply();
  }

  get visible() { return this.state.visible; }
  setVisible(on) { this.state.visible = !!on; save(this.state); this.apply(); }

  /** Width from the remembered size, or a default; the height follows the tube's shape and the room above the panel. */
  apply() {
    const { card, body, insets, state } = this;
    this.rect = null;
    insets.style.display = state.visible ? '' : 'none';
    card.classList.toggle('folded', state.folded);
    if (!state.visible) return;
    const room = this.panel.getBoundingClientRect().top - insets.getBoundingClientRect().top - HEADER - GAP;
    let w = Math.max(MIN_W, Math.min(window.innerWidth - EDGE, state.w ?? Math.min(440, window.innerWidth * 0.36)));
    if (w / ASPECT > room) w = Math.max(MIN_W * 0.6, room * ASPECT);
    insets.style.width = `${Math.round(w)}px`;
    body.style.height = `${Math.round(w / ASPECT)}px`;
  }

  resizable(handle) {
    let drag = null;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      drag = { x: e.clientX, y: e.clientY, w: this.insets.getBoundingClientRect().width };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag) return;
      // Either way of dragging the corner makes the tube bigger: across, or down (by the tube's shape).
      const dx = e.clientX - drag.x, dy = (e.clientY - drag.y) * ASPECT;
      this.state.w = drag.w + (Math.abs(dy) > Math.abs(dx) ? dy : dx);
      this.apply();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      this.state.w = Math.round(this.insets.getBoundingClientRect().width);
      save(this.state);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Draws the picture into the card's rectangle of the canvas; call after the frame. */
  render() {
    if (!this.state.visible || this.state.folded) return;
    const r = this.rect ??= this.body.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const renderer = this.renderer;
    this.material.uniforms.uPhosphor.value = this.crt.texture;
    renderer.getSize(this._size);
    const y = this._size.y - r.bottom;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this._size.x, this._size.y);
    renderer.autoClear = auto;
  }
}
