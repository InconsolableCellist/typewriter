// Renderer, dark-studio lighting, environment, backdrop and post stack.
import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { LOOK, lookFromQuery, applyTone, applyCavity, LookRenderPass, pushLookState, patchSceneMaterials } from './look.js';
import { SceneMotion } from './motion.js';
import { Governor, TIERS, deviceTier, renderPixelRatio } from './governor.js';

/**
 * Contact-hardening shadows: blocker search then penumbra-sized PCF, replacing three's PCF in the shadow chunk. The tap
 * counts are per device tier (fewer on a phone). A light whose shadow intensity is 0 skips the search altogether: the
 * word processor's CRT spill in daylight and the lamp switched off keep their place in the light count (no recompile)
 * and cost nothing per fragment.
 */
function patchPCSS({ pcssSamples = 16, pcssBlocker = 12 } = {}) {
  let sh = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (sh.includes('PCSS_ENABLED')) return;
  const code = /* glsl */`
#define PCSS_ENABLED 1
#define PCSS_SAMPLES ${pcssSamples | 0}
#define PCSS_BLOCKER ${pcssBlocker | 0}
uniform float uPcssLight;
const vec2 POISSON[32] = vec2[](
  vec2(-.942,-.399), vec2(.945,-.769), vec2(-.094,-.929), vec2(.344,.293),
  vec2(-.916,.457), vec2(-.815,-.879), vec2(-.382,.276), vec2(.974,.756),
  vec2(.443,-.975), vec2(.537,-.473), vec2(-.264,-.419), vec2(.791,.191),
  vec2(-.241,.997), vec2(-.814,.914), vec2(.199,.786), vec2(.143,-.141),
  vec2(.35,-.72), vec2(-.62,.11), vec2(.07,.45), vec2(-.53,-.68), vec2(-.33,.66), vec2(.68,.59),
  vec2(.9,-.2), vec2(-.18,-.75), vec2(.5,.82), vec2(-.87,.05), vec2(.25,-.48), vec2(-.47,.85),
  vec2(.62,-.15), vec2(-.05,.1), vec2(-.72,-.3), vec2(.2,.2)
);
float pcssRandom(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
float pcssShadow(sampler2D sm, vec2 size, vec4 c, float bias){
  c.xyz /= c.w; c.z += bias;
  bool inF = c.x>=0. && c.x<=1. && c.y>=0. && c.y<=1. && c.z<=1.;
  if(!inF) return 1.;
  float rnd = pcssRandom(gl_FragCoord.xy)*6.2831; float cs=cos(rnd), sn=sin(rnd);
  mat2 rot = mat2(cs,-sn,sn,cs);
  float avg=0.; float blockers=0.;
  float search = 0.012;
  for(int i=0;i<PCSS_BLOCKER;i++){
    float d = unpackRGBAToDepth(texture2D(sm, c.xy + rot*POISSON[i]*search));
    if(d < c.z){ avg += d; blockers += 1.; }
  }
  if(blockers < 0.5) return 1.;
  avg /= blockers;
  float pen = clamp((c.z-avg)*32., 0.0006, 0.018);
  float lit = 0.;
  for(int i=0;i<PCSS_SAMPLES;i++){
    vec2 o = rot*POISSON[i]*pen;
    lit += step(c.z, unpackRGBAToDepth(texture2D(sm, c.xy+o)));
  }
  return lit/float(PCSS_SAMPLES);
}
`;
  sh = sh.replace('#ifdef USE_SHADOWMAP', '#ifdef USE_SHADOWMAP\n' + code);
  sh = sh.replace(
    'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
    'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n#ifdef PCSS_ENABLED\n  if (shadowIntensity <= 0.0) return 1.0;\n  return mix(1.0, pcssShadow(shadowMap, shadowMapSize, shadowCoord, shadowBias), shadowIntensity);\n#endif\n',
  );
  THREE.ShaderChunk.shadowmap_pars_fragment = sh;
}

/**
 * Lobe adjustments for every physical material. Specular AA folds the screen-space variance of the shaded
 * normal into roughness (three only uses the unperturbed normal). Direct specular is cut because the key's
 * specular comes from the softbox in the environment: a directional light is an infinitely small source.
 */
const DIRECT_SPECULAR = 0.2;
function patchLobes() {
  let f = THREE.ShaderChunk.lights_physical_fragment;
  if (!f.includes('SPECULAR_AA')) {
    const aa = `// SPECULAR_AA
vec3 nDeriv = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
float nVar = max( max( nDeriv.x, nDeriv.y ), nDeriv.z );
material.roughness = sqrt( clamp( material.roughness * material.roughness + min( 2.0 * nVar * nVar, 0.2 ), 0.0, 1.0 ) );
`;
    f = f.replace('material.roughness += geometryRoughness;', `material.roughness += geometryRoughness;\n${aa}`);
    f = f.replace('material.clearcoatRoughness += geometryRoughness;', 'material.clearcoatRoughness += geometryRoughness + nVar * 0.5;');
    THREE.ShaderChunk.lights_physical_fragment = f;
  }
  let p = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!p.includes('DIRECT_SPECULAR')) {
    p = p.replace('reflectedLight.directSpecular += irradiance * BRDF_GGX(', `reflectedLight.directSpecular += /*DIRECT_SPECULAR*/ ${DIRECT_SPECULAR.toFixed(3)} * irradiance * BRDF_GGX(`);
    p = p.replace('clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat(', `clearcoatSpecularDirect += ${DIRECT_SPECULAR.toFixed(3)} * ccIrradiance * BRDF_GGX_Clearcoat(`);
    THREE.ShaderChunk.lights_physical_pars_fragment = p;
  }
}

function makeStudioEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  // Softboxes: broad panels with feathered edges, no hot cores, so reflections have a shape and never clip.
  const mkBox = (w, h, intensity, pos, color = 0xffffff) => {
    const c = new THREE.Color(color).multiplyScalar(intensity);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uC: { value: c } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform vec3 uC; varying vec2 vUv;
        void main(){ vec2 d = abs(vUv-0.5)*2.0; float e = (1.0-smoothstep(0.55,1.0,d.x))*(1.0-smoothstep(0.55,1.0,d.y));
        gl_FragColor = vec4(uC*e,1.0); }`,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(...pos); mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  mkBox(7, 5, 3.8, [-3.2, 4.4, 3.4], 0xfff3e6);     // key, over the left shoulder
  mkBox(2.6, 6, 2.2, [4.6, 2.0, -2.2], 0xe4ecff);   // tall rim, right rear
  mkBox(5, 2.2, 1.0, [2.0, -1.0, 4.4], 0xfff6ea);  // low fill
  mkBox(8, 3.5, 1.8, [0, 5.6, -2.4], 0xe9eefb);     // overhead, for the top surfaces
  // A broad, graded studio: dark floor, a low-intensity wall to the horizon, a brighter ceiling. Polished metal needs
  // something to reflect everywhere; this stays well under the clipping range.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(12), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vD;
      void main(){ vec3 d = normalize(vD);
      float wall = smoothstep(-0.35, 0.25, d.y), ceil = smoothstep(0.2, 1.0, d.y);
      float side = 0.75 + 0.25*sin(atan(d.x, d.z)*2.0 + 0.7);
      vec3 c = mix(vec3(0.05,0.05,0.055), vec3(0.34,0.34,0.36)*side, wall) + vec3(0.42,0.43,0.46)*ceil;
      gl_FragColor = vec4(c,1.); }`,
  }));
  sky.renderOrder = -1;
  scene.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.04);
  pm.dispose();
  return rt.texture;
}


export function createScene(canvas) {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const tierName = deviceTier({ search: location.search, coarse });
  const tier = TIERS[tierName];
  patchPCSS(tier);
  patchLobes();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Every texture's anisotropy is clamped to this by three, whatever a loader asked for: 4x on a phone.
  const deviceAniso = renderer.capabilities.getMaxAnisotropy();
  const maxAnisotropy = Math.min(deviceAniso, tier.maxAniso);
  if (maxAnisotropy < deviceAniso) renderer.capabilities.getMaxAnisotropy = () => maxAnisotropy;
  const look = lookFromQuery(LOOK, location.search);
  applyTone(renderer, look);   // the operator is applied by OutputPass; the materials render scene-referred linear
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;   // the maps are drawn when something moved (SceneMotion.scheduleShadows)

  const scene = new THREE.Scene();
  const env = makeStudioEnvironment(renderer);
  scene.environment = env;
  scene.environmentIntensity = 1.0;

  const camera = new THREE.PerspectiveCamera(29, 1, 0.02, 12);
  camera.position.set(-0.0564, 0.5423, 0.9846);   // square on and wide enough for the paper stacks either side of the machine

  // Studio softboxes above serve until the room photograph arrives (and stay if it cannot be loaded).
  scene.background = new THREE.Color(0x141416);

  // Key light: low, for long raking shadows; PCSS penumbra gives the soft-box falloff.
  const key = new THREE.DirectionalLight(0xfff0dd, 3.2);
  key.position.set(-0.75, 0.62, 0.42);
  key.target.position.set(0, 0.1, -0.02);
  key.castShadow = true;
  key.shadow.mapSize.set(tier.keyShadow, tier.keyShadow);
  key.shadow.camera.left = -0.72; key.shadow.camera.right = 0.72;
  key.shadow.camera.top = 0.5; key.shadow.camera.bottom = -0.5;
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 2.4;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.0016;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight(0xcfdcff, 0.5);
  rim.position.set(0.6, 0.5, -0.9);
  scene.add(rim);

  // What moved this frame, for the passes that keep their last result (shadow maps, AO, the Print Point view). A
  // pointer held down on the canvas (a grab, a drag of anything) always counts as movement.
  const motion = new SceneMotion(scene, {
    extraLook: (t) => {
      pushLookState(t);
      const bg = THREE.ShaderLib.backgroundCube.uniforms.uBgTint?.value;
      if (bg) { t.push(bg.x); t.push(bg.y); t.push(bg.z); }
    },
  });
  let held = false;
  canvas.addEventListener('pointerdown', () => { held = true; });
  for (const ev of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(ev, () => { held = false; });

  // Scene in linear HDR with 4x MSAA into its own target, then tone map into a plain 8-bit buffer, then SMAA on that
  // display-referred image to the canvas: MSAA alone resolves before tone mapping, which leaves stairs on
  // bright-to-dark edges. Only the scene target has samples and depth; the vignette, when on, gets a half-float buffer.
  const hdr = new THREE.WebGLRenderTarget(4, 4, { samples: 4, type: THREE.HalfFloatType, depthBuffer: true });
  const ldr = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
  let vigRT = null;
  const scenePass = new LookRenderPass(scene, camera, look, motion);
  scenePass.held = () => held;
  if (tier.aoTier) scenePass.ao.setTier(tier.aoTier);
  // Optional vignette, before tone mapping (LOOK.vignette, off by default).
  const vig = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tDiffuse,vUv).rgb; vec2 q = vUv-0.5; float v = 1.0 - smoothstep(0.32,0.92,length(q*vec2(1.2,1.0)));
      c *= mix(0.62,1.0,v); gl_FragColor=vec4(c,1.); }`,
  });
  const output = new OutputPass();
  const smaa = new SMAAPass(4, 4);
  smaa.renderToScreen = true;
  let postRatio = 1, postW = 4, postH = 4;
  /** The frame, as EffectComposer did it, with a buffer made for each step. */
  const composer = {
    passes: [scenePass, vig, output, smaa],
    render() {
      scenePass.render(renderer, null, hdr);
      let src = hdr;
      if (vig.enabled) {
        vigRT ??= new THREE.WebGLRenderTarget(postW, postH, { type: THREE.HalfFloatType, depthBuffer: false });
        vig.render(renderer, vigRT, src);
        src = vigRT;
      }
      output.render(renderer, ldr, src);   // tone mapped and encoded: SMAA reads the display-referred image
      smaa.render(renderer, null, ldr);
    },
    setPixelRatio(r) { postRatio = r; },
    setSize(w, h) {
      postW = Math.max(1, Math.floor(w * postRatio)); postH = Math.max(1, Math.floor(h * postRatio));
      hdr.setSize(postW, postH); ldr.setSize(postW, postH); vigRT?.setSize(postW, postH);
      scenePass.setSize(postW, postH); smaa.setSize(postW, postH);
    },
  };

  /** Applies the LOOK config now; changing tone mapping or AO on or off at runtime goes through here. */
  function applyLook() {
    applyTone(renderer, look);
    applyCavity(look.cavity);
    scenePass.ao.applyLook();
    vig.enabled = look.vignette;
  }
  applyLook();

  // The display's own pixels by default (never above the budget); above them only when the governor has seen room.
  // ?ss=1 asks for supersampling from the start, ?ss=0 never.
  const ssParam = new URLSearchParams(location.search).get('ss');
  let cssW = 1, cssH = 1, quality = 1, pixelRatio = 1, supersample = ssParam === '1';
  const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
  const ratioFor = (ss) => renderPixelRatio({ w: cssW, h: cssH, dpr: dpr(), quality, supersample: ss, maxRatio: tier.maxRatio });
  function resize(w, h) {
    cssW = w; cssH = h;
    pixelRatio = ratioFor(supersample);
    renderer.setPixelRatio(pixelRatio);
    composer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  // Lowering quality gives up the AO first (smaller, then gone), then resolution.
  function setQuality(q) {
    if (q < quality && scenePass.ao.dropTier()) { console.info('render quality: AO tier', scenePass.ao.tier); return; }
    quality = q; resize(cssW, cssH);
  }

  // One governor for every kit: stage.govern(now) once a frame, with the rAF timestamp.
  const governor = new Governor({ start: performance.now(), canSupersample: tierName !== 'phone' && ssParam !== '0' && !supersample });
  const dropSupersample = () => { supersample = false; governor.dropSupersample(); resize(cssW, cssH); console.info('render: supersampling given up'); };
  function govern(now) {
    const a = governor.sample(now);
    if (!a) return;
    if (a === 'up') {
      if (ratioFor(true) > pixelRatio + 0.01) { supersample = true; resize(cssW, cssH); console.info('render: frames have room, supersampling at', pixelRatio.toFixed(2)); }
      else governor.dropSupersample();
    } else if (a === 'revert') dropSupersample();
    else if (supersample) dropSupersample();
    else if (quality > 0.62 || scenePass.ao.active) { setQuality(quality * 0.85); console.info('render quality', quality.toFixed(2)); }
  }

  /**
   * Fits the key light's shadow camera to a desk area of half size { halfX, halfZ } about the origin, up to `height`
   * above the desk, so every unit of a system machine casts a shadow. The map size stays the tier's.
   */
  function fitShadow({ halfX, halfZ, height = 0.5 }) {
    const cam = key.shadow.camera;
    key.updateMatrixWorld(); key.target.updateMatrixWorld();
    const view = new THREE.Matrix4().lookAt(key.position, key.target.position, new THREE.Vector3(0, 1, 0));
    view.setPosition(key.position); view.invert();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const p = new THREE.Vector3();
    for (const x of [-halfX, halfX]) for (const y of [0, height]) for (const z of [-halfZ, halfZ]) {
      p.set(x, y, z).applyMatrix4(view);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, -p.z); z1 = Math.max(z1, -p.z);
    }
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = Math.max(0.01, z0 - 0.1); cam.far = z1 + 0.1;
    cam.updateProjectionMatrix();
  }

  return {
    renderer, scene, camera, composer, look, applyLook, ao: scenePass.ao, key, rim, resize, setQuality, fitShadow,
    getQuality: () => quality, getPixelRatio: () => pixelRatio,
    /** 'desktop' or 'phone', what that tier sets (TIERS in governor.js), and the anisotropy every texture is held to. */
    tier: tierName, tierSettings: tier, maxAnisotropy,
    /** Scene-change tracking: the kits call motion.observe({ state, layout, soft, grabbing, easing }) each frame. */
    motion,
    govern, governor,
    /** Patches every material in the scene for the look now (call before renderer.compileAsync, so programs compile once). */
    patchMaterials: () => patchSceneMaterials(scene),
  };
}

/** The room: one photographic HDRI lights the machine and, blurred, is the backdrop. */
export async function loadRoom(scene, url, rotationY) {
  const { EXRLoader } = await import('three/examples/jsm/loaders/EXRLoader.js');
  const tex = await new EXRLoader().loadAsync(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = tex; scene.environmentIntensity = 0.6; scene.environmentRotation.set(0, rotationY, 0);
  scene.background = tex; scene.backgroundIntensity = 0.45; scene.backgroundBlurriness = 0.06; scene.backgroundRotation.set(0, rotationY, 0);
  return tex;
}
