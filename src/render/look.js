// The photographic finish: ambient occlusion folded into the materials, plus a cavity term that keeps the machine's
// interior in shadow. Switchable: edit LOOK below, or add ?look=... to the URL (noao, nocavity, vignette, aces, agx,
// neutral, reinhard, ev=-0.2), or change window.__tw.stage.look at runtime and call window.__tw.stage.applyLook().
import * as THREE from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { isDrawnOpaque, CameraWatch, PassCache, SceneMotion } from './motion.js';

export const LOOK = {
  ao: {
    enabled: true,
    intensity: 1.0,        // how much of the occlusion reaches the ambient and reflected light
    direct: 0.6,           // share applied to the key light as well: a contact shadow the soft shadow map cannot give
    radius: 0.04,          // m; from a typebar's width to a key's width
    thickness: 0.022,      // m; a thin bar in front does not darken what is far behind it (no halos)
    distanceExponent: 1.5, // >1 biases samples toward the point, for tight contact darkening
    power: 1.7,
    debug: false,          // show only the occlusion term
  },
  // The machine's interior: an analytic term, because screen-space AO cannot see how deep the well under the keys is.
  cavity: {
    enabled: true,
    centerX: 0, centerZ: 0.038, halfX: 0.155, halfZ: 0.18,   // m, the opening in plan
    margin: 0.015,         // m, soft edge of the plan
    top: 0.118,            // m, height where the shade begins at z0, just under the key tops
    z0: 0.112,             // m, where the top starts to fall with the keyboard's rake
    slope: 0.636,          // m per m toward the front, along the rows of keys
    depth: 0.06,           // m below that to full shade
    shade: 0.26,           // room light that remains at full depth (reflections get the square)
    direct: 0.55,          // share applied to the direct light too
  },
  toneMapping: 'aces',     // 'aces' | 'agx' | 'neutral' | 'reinhard' | 'none'
  exposure: 1.0,
  vignette: false,         // the old pre-tone-map vignette
};

const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, reinhard: THREE.ReinhardToneMapping, none: THREE.NoToneMapping };

/** Reads ?look= switches into a config. */
export function lookFromQuery(look, search) {
  const raw = new URLSearchParams(search).get('look');
  if (!raw) return look;
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    if (k === 'noao') look.ao.enabled = false;
    else if (k === 'nocavity') look.cavity.enabled = false;
    else if (k === 'vignette') look.vignette = true;
    else if (k in TONE) look.toneMapping = k;
    else if (k === 'ev' && v !== undefined) look.exposure = Number(v);
  }
  return look;
}

/** Sets the operator and exposure on the renderer; OutputPass rebuilds itself when they change. */
export function applyTone(renderer, look) {
  renderer.toneMapping = TONE[look.toneMapping] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = look.exposure;
}

// ---- Ambient occlusion in the materials ------------------------------------------------------------------------------
// GTAO over a half-resolution depth and normal prepass, read back in the lit fragment shaders and applied to the indirect
// terms. Compared with blending the AO over the finished frame, this keeps the MSAA on silhouettes, it never touches
// transparent things drawn over the occluded surface (the smoke), and it leaves the direct light alone except for an
// optional share. Disarmed for every render except the main view's: the AO map is for that camera only.

const uniforms = {
  uLookAO: { value: 0 },
  uLookAODirect: { value: 0 },
  uLookAODebug: { value: 0 },
  uLookAOScale: { value: new THREE.Vector2(1, 1) },   // AO texels per framebuffer pixel
  uLookZ: { value: new THREE.Vector2(0.02, 12) },     // camera near, far
  tLookAO: { value: null },
  tLookDepth: { value: null },
  uLookEnvTint: { value: new THREE.Vector3(1, 1, 1) },
  uLookCav: { value: new THREE.Vector4(0, 0, 0, 0) },  // centre x, z, half x, z
  uLookCavP: { value: new THREE.Vector4(1, 1, 1, 1) }, // top, depth, shade, margin
  uLookCavS: { value: new THREE.Vector3(0, 0, 0) },    // z0, slope, direct share
  uLookDisc: { value: new THREE.Vector3(0, 0, -1) },   // x, z, radius of a round base on the desk (radius < 0: none)
};

/** Contact darkening on the desk around a round base of radius r metres, centred at (x, z). */
export function setContactDisc(x, z, r) { uniforms.uLookDisc.value.set(x, z, r); }

/** Tints all image-based light (the HDRI, in the lit materials). */
export function setEnvTint(r, g, b) { uniforms.uLookEnvTint.value.set(r, g, b); }

/** The uniforms that change how the scene is lit, onto a tape (SceneWatch's appearance check). */
export function pushLookState(t) {
  for (const k of ['uLookEnvTint', 'uLookCav', 'uLookCavP', 'uLookCavS', 'uLookDisc']) {
    const v = uniforms[k].value;
    t.push(v.x); t.push(v.y); t.push(v.z); if (v.w !== undefined) t.push(v.w);
  }
}

/** Sets the cavity box from LOOK; a disabled cavity collapses its plan to nothing. */
export function applyCavity(c) {
  const on = c.enabled;
  uniforms.uLookCav.value.set(c.centerX, c.centerZ, on ? c.halfX : -1, on ? c.halfZ : -1);
  uniforms.uLookCavP.value.set(c.top, c.depth, c.shade, c.margin);
  uniforms.uLookCavS.value.set(c.z0, c.slope, c.direct);
}

const AO_PARS = /* glsl */`
uniform float uLookAO, uLookAODirect, uLookAODebug;
uniform vec2 uLookAOScale, uLookZ;
uniform highp sampler2D tLookAO, tLookDepth;
uniform vec3 uLookEnvTint;
uniform vec4 uLookCav, uLookCavP;
uniform vec3 uLookCavS, uLookDisc;
// How much of the room's light reaches this point inside the machine: 1 outside the opening or above the key tops.
vec3 lookWorld() { return transpose(mat3(viewMatrix)) * (-vViewPosition - viewMatrix[3].xyz); }
float lookCavity(vec3 w) {
  vec2 q = abs(w.xz - uLookCav.xy) - uLookCav.zw;
  float plan = 1.0 - smoothstep(-uLookCavP.w, 0.0, max(q.x, q.y));
  float top = uLookCavP.x - uLookCavS.y * max(w.z - uLookCavS.x, 0.0);
  float down = smoothstep(0.0, uLookCavP.y, top - w.y);
  return mix(1.0, uLookCavP.z, plan * down);
}
// Bilateral read of the half-resolution AO at this pixel: taps on the far side of a depth edge do not count, so an edge
// stays crisp and a bar thinner than an AO texel simply keeps its own light.
float lookOcclusion(vec2 fragCoord, float viewDist) {
  vec2 st = fragCoord * uLookAOScale - 0.5;
  vec2 fl = floor(st), f = st - fl;
  ivec2 b = ivec2(fl), last = textureSize(tLookAO, 0) - 1;
  float tolerance = 0.0015 + 0.012 * viewDist;
  float sum = 0.0, total = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    ivec2 p = clamp(b + ivec2(i, j), ivec2(0), last);
    float d = texelFetch(tLookDepth, p, 0).r;
    float z = uLookZ.x * uLookZ.y / (uLookZ.y - d * (uLookZ.y - uLookZ.x));
    float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) * exp(-abs(z - viewDist) / tolerance);
    sum += w * texelFetch(tLookAO, p, 0).r;
    total += w;
  }
  return total > 1e-4 ? sum / total : 1.0;
}
`;

const AO_APPLY = /* glsl */`
{
  vec3 lookW = lookWorld();
  float lookCav = lookCavity(lookW);
  // The desk top around a round base: dark at the edge of the contact, gone a few centimetres out.
  if (uLookDisc.z > 0.0 && lookW.y < 0.003) {
    float lookEdge = length(lookW.xz - uLookDisc.xy) - uLookDisc.z;
    float lookDisc = mix(0.14, 1.0, smoothstep(-0.006, 0.05, lookEdge));
    lookDisc *= mix(0.72, 1.0, smoothstep(0.0, 0.012, lookEdge));
    reflectedLight.indirectDiffuse *= lookDisc;
    reflectedLight.indirectSpecular *= lookDisc * lookDisc;
    reflectedLight.directDiffuse *= mix(1.0, lookDisc, 0.55);
    #ifdef USE_CLEARCOAT
      clearcoatSpecularIndirect *= lookDisc * lookDisc;
    #endif
  }
  reflectedLight.indirectDiffuse *= uLookEnvTint * lookCav;
  vec3 lookCavDirect = vec3(mix(1.0, lookCav, uLookCavS.z));
  reflectedLight.directDiffuse *= lookCavDirect;
  reflectedLight.directSpecular *= lookCavDirect;
  reflectedLight.indirectSpecular *= uLookEnvTint * lookCav * lookCav;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= uLookEnvTint * lookCav * lookCav;
  #endif
  #ifdef USE_SHEEN
    sheenSpecularIndirect *= uLookEnvTint * lookCav;
  #endif
}
#ifdef OPAQUE
if (uLookAO > 0.0) {
  float lookAo = lookOcclusion(gl_FragCoord.xy, vViewPosition.z);
  // Multi-bounce fit (Jimenez 2016): light paper is greyed less than dark enamel by the same occlusion.
  vec3 lookAlb = material.diffuseColor;
  vec3 lookMb = max(vec3(lookAo), ((lookAo * (2.0404 * lookAlb - 0.3324) + (-4.7951 * lookAlb + 0.6417)) * lookAo + (2.7552 * lookAlb + 0.6903)) * lookAo);
  reflectedLight.indirectDiffuse *= mix(vec3(1.0), lookMb, uLookAO);
  reflectedLight.directDiffuse *= mix(vec3(1.0), lookMb, uLookAODirect);
  float lookDotNV = saturate(dot(geometryNormal, geometryViewDir));
  float lookSpec = computeSpecularOcclusion(lookDotNV, lookAo, material.roughness);
  reflectedLight.indirectSpecular *= mix(1.0, lookSpec, uLookAO);
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= mix(1.0, lookSpec, uLookAO);
  #endif
  #ifdef USE_SHEEN
    sheenSpecularIndirect *= mix(1.0, lookSpec, uLookAO);
  #endif
  if (uLookAODebug > 0.5) {
    reflectedLight.directDiffuse = reflectedLight.directSpecular = reflectedLight.indirectSpecular = vec3(0.0);
    reflectedLight.indirectDiffuse = vec3(lookAo);
    totalEmissiveRadiance = vec3(0.0);
  }
}
#endif
`;

const patched = new WeakSet();

function patchMaterial(mat) {
  if (patched.has(mat)) return;
  patched.add(mat);
  if (!mat.isMeshStandardMaterial || mat.transparent) return;
  const before = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey();
  mat.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${AO_PARS}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${AO_APPLY}`);
  };
  mat.customProgramCacheKey = () => `${key}|look-ao`;
  mat.needsUpdate = true;
}

function patchMaterialsOf(o) {
  const m = o.material;
  if (!m) return;
  if (Array.isArray(m)) for (const x of m) patchMaterial(x); else patchMaterial(m);
}

/** Patches every material in a scene, drawn or hidden (before compiling its programs ahead of the first frame). */
export function patchSceneMaterials(scene) { scene.traverse(patchMaterialsOf); }

// Resolution scale and sample count per tier; the render-quality governor walks down these before it touches resolution.
const AO_TIERS = [{ scale: 0.5, samples: 16 }, { scale: 0.34, samples: 12 }, null];

class AOPrepass extends GTAOPass {
  constructor(scene, camera, look) {
    super(scene, camera, 64, 64, undefined, undefined, undefined);
    this.look = look;
    this.output = GTAOPass.OUTPUT.Off;
    this.tier = 0;
    this.stale = true;          // the AO map no longer matches the settings or the size: redraw it whatever moved
    this._hidden = [];
    this.fullW = 4; this.fullH = 4;
    this.normalMaterial.side = THREE.DoubleSide;   // the sheet and the ribbon are drawn from both sides
    this.applyLook();
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 3, normalPhi: 2.5, radius: 5, rings: 2, radiusExponent: 1.5, samples: 16 });
  }

  applyLook() {
    const a = this.look.ao, t = AO_TIERS[this.tier];
    this.updateGtaoMaterial({ radius: a.radius, distanceExponent: a.distanceExponent, thickness: a.thickness, distanceFallOff: 1, scale: a.power, samples: t ? t.samples : 16, screenSpaceRadius: false });
    this.resize();
  }

  get active() { return this.look.ao.enabled && AO_TIERS[this.tier] !== null; }

  /** Starts at a cheaper tier (a phone). */
  setTier(t) { this.tier = Math.max(0, Math.min(AO_TIERS.length - 1, t)); this.applyLook(); }

  /** One step down in cost; false once there is nothing left to give. */
  dropTier() {
    if (!this.look.ao.enabled || this.tier >= AO_TIERS.length - 1) return false;
    this.tier++;
    this.applyLook();
    return true;
  }

  resize() {
    this.stale = true;
    const t = AO_TIERS[this.tier];
    if (!t) return;
    const w = Math.max(2, Math.round(this.fullW * t.scale)), h = Math.max(2, Math.round(this.fullH * t.scale));
    super.setSize(w, h);
    uniforms.uLookAOScale.value.set(w / this.fullW, h / this.fullH);
  }

  setSize(w, h) { this.fullW = w; this.fullH = h; this.resize(); }

  // The G-buffer holds opaque surfaces only (no points or lines either, as GTAOPass's own hides). One walk over the
  // visible objects, hiding what is not drawn opaque; restored from the list of what was hidden.
  overrideVisibility() {
    const hidden = this._hidden;
    hidden.length = 0;
    const walk = (o) => {
      if (!o.visible) return;
      if ((o.isMesh || o.isSprite || o.isPoints || o.isLine) && !isDrawnOpaque(o)) { o.visible = false; hidden.push(o); return; }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) walk(ch[i]);
    };
    walk(this.scene);
  }

  restoreVisibility() {
    for (const o of this._hidden) o.visible = true;
    this._hidden.length = 0;
  }

  // The prepass neither re-renders the shadow maps nor draws the backdrop.
  renderOverride(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha) {
    const scene = this.scene, bg = scene.background, sm = renderer.shadowMap, auto = sm.autoUpdate, need = sm.needsUpdate;
    scene.background = null;
    sm.autoUpdate = false; sm.needsUpdate = false;
    super.renderOverride(renderer, overrideMaterial, renderTarget, clearColor, clearAlpha);
    scene.background = bg;
    sm.autoUpdate = auto; sm.needsUpdate = need;
  }

  publish() {
    uniforms.tLookAO.value = this.gtaoMap;
    uniforms.tLookDepth.value = this.depthTexture;
    uniforms.uLookZ.value.set(this.camera.near, this.camera.far);
    uniforms.uLookAO.value = this.look.ao.intensity;
    uniforms.uLookAODirect.value = this.look.ao.direct;
    uniforms.uLookAODebug.value = this.look.ao.debug ? 1 : 0;
  }
}

/**
 * The scene render, preceded by the AO prepass and with the AO armed only for its duration. The frame's one walk over
 * the scene (SceneMotion.update) patches each material before its first use and says what moved; the AO is redrawn
 * only when the camera or the geometry moved, and the shadow maps only when a caster or a light did.
 * `counts` keeps how many times each was drawn (window.__tw.stage.ao.counts, for checking at rest).
 */
export class LookRenderPass extends RenderPass {
  constructor(scene, camera, look, motion = new SceneMotion(scene)) {
    super(scene, camera);
    this.look = look;
    this.motion = motion;
    this.ao = new AOPrepass(scene, camera, look);
    this.aoCache = new PassCache();
    this.cameraWatch = new CameraWatch();
    this.held = null;   // () => true while a pointer is down on the canvas
    this.counts = { frames: 0, ao: 0, shadow: 0 };
    this.ao.counts = this.counts;
  }

  setSize(w, h) { this.ao.setSize(w, h); }

  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const { ao, motion, scene, camera, counts } = this;
    if (this.held?.()) motion.mark();
    motion.update(patchMaterialsOf);
    counts.frames++;
    // The walk has just brought every world matrix up to date; the two renders below need not do it again.
    const autoMatrices = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;
    try {
      if (ao.active) {
        camera.updateMatrixWorld();
        const cameraMoved = this.cameraWatch.changed(camera);
        if (this.aoCache.stale(motion.geomGen, motion.frame, cameraMoved || ao.stale)) {
          ao.render(renderer, null, null);
          ao.stale = false;
          this.aoCache.drawn(motion.geomGen, motion.frame);
          counts.ao++;
        }
        ao.publish();
      }
      const sm = renderer.shadowMap;
      sm.autoUpdate = false;
      sm.needsUpdate = motion.scheduleShadows();
      if (sm.needsUpdate) counts.shadow++;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      motion.shadowsDrawn();
    } finally {
      scene.matrixWorldAutoUpdate = autoMatrices;
    }
    uniforms.uLookAO.value = 0;
  }
}
