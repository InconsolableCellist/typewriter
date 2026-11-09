// Paper and ribbon meshes from SoftWorld buffers. Ink is uploaded through dirty rects only.
import * as THREE from 'three';
import { SubrectTexture } from './materials.js';

// The burn front in the sheet's own (u, v). burnDepth is in metres: positive inside the burned area, zero at the glowing edge.
const BURN_CHAR_M = 0.0065;        // behind the edge: the char band, past which the paper is gone
const BURN_GLSL = /* glsl */`
uniform vec3 uBurn; uniform vec2 uBurnSheet;
float burnHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float burnNoise(vec2 p){ vec2 i = floor(p), f = fract(p), w = f*f*(3.-2.*f);
  return mix(mix(burnHash(i), burnHash(i+vec2(1,0)), w.x), mix(burnHash(i+vec2(0,1)), burnHash(i+vec2(1,1)), w.x), w.y); }
float burnDepth(vec2 uv){
  vec2 m = uv*uBurnSheet;
  float ragged = burnNoise(m*22.)*0.024 + burnNoise(m*70.)*0.009 + burnNoise(m*210.)*0.0025 - 0.018;
  return uBurn.z - length((uv-uBurn.xy)*uBurnSheet) + ragged*smoothstep(0., 0.04, uBurn.z);
}`;

export class PaperView {
  constructor({ renderer, soft, mats, keyDir }) {
    this.renderer = renderer; this.soft = soft;
    this.burn = { uBurn: { value: new THREE.Vector3(0, 0, -1) }, uBurnSheet: { value: new THREE.Vector2(soft.m?.paper?.width ?? 0.216, soft.m?.paper?.height ?? 0.279) } };
    const keyDirView = keyDir;
    this.keyDir = keyDir;
    this.ink = new SubrectTexture(renderer, soft.inkTexture);
    const p = soft.paper;
    // The cloth is coarse along the feed; drawn as chords it cuts into the platen. Refine each cell along v with
    // a Catmull-Rom through the simulated nodes (display only).
    this.nx = p.nx; this.ny = p.ny; this.sub = 3;
    const rows = (p.ny - 1) * this.sub + 1, nV = p.nx * rows;
    this.rows = rows;
    this.refined = new Float32Array(nV * 3);
    const uvs = new Float32Array(nV * 2), idx = new Uint32Array((p.nx - 1) * (rows - 1) * 6);
    for (let j = 0, k = 0; j < rows; j++) for (let i = 0; i < p.nx; i++, k++) {
      uvs[k * 2] = i / (p.nx - 1); uvs[k * 2 + 1] = j / (rows - 1);
    }
    for (let j = 0, m = 0; j < rows - 1; j++) for (let i = 0; i < p.nx - 1; i++) {
      const a = i + j * p.nx, b = a + 1, c = a + p.nx, d = c + 1;
      idx[m++] = a; idx[m++] = c; idx[m++] = b; idx[m++] = b; idx[m++] = c; idx[m++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.refined, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.refine();
    geo.computeVertexNormals();
    this.geo = geo;

    const texel = new THREE.Vector2(1 / soft.inkTexture.width, 1 / soft.inkTexture.height);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe9e2cf, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uInk = { value: this.ink.tex };
      sh.uniforms.uTexel = { value: texel };
      sh.uniforms.uKeyDir = { value: keyDirView };
      Object.assign(sh.uniforms, this.burn);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vInkUv; uniform vec3 uKeyDir;')
        // A sheet has no outside: push the shadow normal bias toward the key whichever way the mesh normal faces,
        // or the sheet shadows itself wherever its normals point away from the light.
        .replace('#include <shadowmap_vertex>', THREE.ShaderChunk.shadowmap_vertex.replace('inverseTransformDirection( transformedNormal, viewMatrix )', 'inverseTransformDirection( transformedNormal * ( dot( transformedNormal, uKeyDir ) < 0.0 ? -1.0 : 1.0 ), viewMatrix )'))
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvInkUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
        uniform sampler2D uInk; uniform vec2 uTexel; uniform vec3 uKeyDir; varying vec2 vInkUv;
        float fibre(vec2 p){ return fract(sin(dot(floor(p), vec2(127.1,311.7)))*43758.5453); }
        ${BURN_GLSL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 inkUv = vInkUv;   // SoftWorld writes ink in the sheet's own (u, v); the texture is uploaded unflipped.
        // The ink map has no mips (it is partially re-uploaded per strike), so integrate the pixel footprint here:
        // at grazing angles thin serifs are otherwise missed by a single bilinear tap.
        vec2 fx = dFdx(inkUv), fy = dFdy(inkUv);
        float inkR = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = (float(i) + 0.5) / 8.0 - 0.5, b = fract(float(i) * 0.618) - 0.5;
          inkR += texture2D(uInk, inkUv + fx * b + fy * a).r;
        }
        inkR /= 8.0;
        float inkA = smoothstep(0.02, 0.6, inkR);
        float grain = fibre(gl_FragCoord.xy*0.5)*0.03;
        diffuseColor.rgb *= 1.0 - grain;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.013,0.012,0.016), inkA);
        vec3 burnGlow = vec3(0.);
        if (uBurn.z > 0.) {
          float bd = burnDepth(vInkUv);
          if (bd > ${BURN_CHAR_M}) discard;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.42,0.27,0.13), smoothstep(-0.017, -0.0006, bd));   // scorching ahead of the edge
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.011,0.0095,0.009), smoothstep(-0.0008, 0.0011, bd));                // char behind it
          float edge = smoothstep(-0.0016, 0.0001, bd)*(1. - smoothstep(0.0005, 0.0026, bd));
          burnGlow = vec3(2.0,0.42,0.045)*edge*(0.72 + 0.28*burnNoise(vInkUv*420. + uBurn.z*260.));
        }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.6, inkA);`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        // Uncoated stock has almost no specular lobe, even at grazing angles.
        material.specularColor *= 0.45; material.specularF90 = 0.2;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Thin sheet: light arriving at the far side shows through, slightly warmed by the stock.
        {
          vec3 Lk = normalize(uKeyDir);
          vec3 Nv = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          float through = clamp(-dot(Nv, Lk), 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * (through * 0.16 + 0.03);
          totalEmissiveRadiance += burnGlow;
        }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float h0 = texture2D(uInk, inkUv).g;
          float hx = texture2D(uInk, inkUv + vec2(uTexel.x, 0.)).g;
          float hy = texture2D(uInk, inkUv + vec2(0., uTexel.y)).g;
          vec3 pdx = dFdx(-vViewPosition), pdy = dFdy(-vViewPosition);
          vec2 uvdx = dFdx(vInkUv), uvdy = dFdy(vInkUv);
          vec3 T = normalize(pdx * uvdy.t - pdy * uvdx.t);
          vec3 B = normalize(-pdx * uvdy.s + pdy * uvdx.s);
          // G is dent depth over ~60 um, sampled at one texel (about 70 um), so the slope is about the raw difference.
          normal = normalize(normal + (T*(h0-hx) + B*(h0-hy))*1.1);
          // A thin sheet is lit through: a side facing away from the key shows the transmitted light, dimmer but not dark.
          if (dot(normal, normalize(uKeyDir)) < 0.0) { normal = -normal; diffuseColor.rgb *= 0.62; }
        }`);
    };
    this.material = mat;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    // What has burned away casts no shadow.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.burn);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vBurnUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBurnUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vBurnUv;\n${BURN_GLSL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\nif (uBurn.z > 0. && burnDepth(vBurnUv) > ${BURN_CHAR_M}) discard;`);
    };
    this.mesh.customDepthMaterial = depth;
  }

  /** Burn front: its centre in the sheet's (u, v) and its reach in metres; a negative radius clears it. */
  setBurn(u, v, radiusM) { this.burn.uBurn.value.set(u, v, radiusM); }

  refine() {
    const { nx, ny, sub, refined: out } = this, src = this.soft.paper.positions;
    const P = (i, j, c) => src[(i + Math.max(0, Math.min(ny - 1, j)) * nx) * 3 + c];
    let o = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let s = 0; s < sub; s++) {
        const t = s / sub, t2 = t * t, t3 = t2 * t;
        const a = -0.5 * t3 + t2 - 0.5 * t, b = 1.5 * t3 - 2.5 * t2 + 1, c = -1.5 * t3 + 2 * t2 + 0.5 * t, d = 0.5 * t3 - 0.5 * t2;
        for (let i = 0; i < nx; i++) for (let q = 0; q < 3; q++) {
          out[o++] = a * P(i, j - 1, q) + b * P(i, j, q) + c * P(i, j + 1, q) + d * P(i, j + 2, q);
        }
      }
    }
    for (let i = 0; i < nx; i++) for (let q = 0; q < 3; q++) out[o++] = P(i, ny - 1, q);
    this.liftOffPlaten();
  }

  /**
   * Cosmetic, display mesh only: anything the sheet's mesh would draw inside the platen is pushed just outside it, so the
   * rubber never shows through. The simulated sheet, print locations and collision are untouched.
   */
  liftOffPlaten() {
    const axis = this.soft.platenAxis;
    if (!axis) return;
    const { refined: out } = this, R = this.soft.m.platen.radius + 0.00012, halfL = this.soft.m.platen.length / 2;
    for (let k = 0; k < out.length; k += 3) {
      if (Math.abs(out[k] - axis.x) > halfL) continue;
      const dy = out[k + 1] - axis.y, dz = out[k + 2] - axis.z, d2 = dy * dy + dz * dz;
      if (d2 >= R * R || d2 < 1e-10) continue;
      const f = R / Math.sqrt(d2);
      out[k + 1] = axis.y + dy * f; out[k + 2] = axis.z + dz * f;
    }
  }

  update() {
    const p = this.soft.paper;
    this.mesh.visible = !this.soft.sheetParked;
    this.refine();
    this.geo.getAttribute('position').needsUpdate = true;
    if (p.normalsDirty) { this.geo.computeVertexNormals(); p.normalsDirty = false; }
    this.ink.flush();
    this.geo.boundingSphere = null;
  }
}

export class RibbonView {
  constructor({ soft, machine: m, mats, renderer }) {
    this.soft = soft; this.m = m;
    const r = soft.ribbon, n = r.count;
    this.texture = soft.ribbonTexture ? new SubrectTexture(renderer, soft.ribbonTexture) : null;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    this.cum = new Float32Array(n);
    const idx = [];
    for (let i = 0; i < n; i++) {
      uv[i * 4] = i / (n - 1); uv[i * 4 + 1] = 0; uv[i * 4 + 2] = i / (n - 1); uv[i * 4 + 3] = 1;
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geo = geo;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x101012, roughness: 0.62, metalness: 0, side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uRibbon = { value: this.texture?.tex ?? null };
      sh.uniforms.uHasTex = { value: this.texture ? 1 : 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvR = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vR; uniform sampler2D uRibbon; uniform float uHasTex;')
        .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 band = vR.y < 0.5 ? vec3(0.010,0.010,0.013) : vec3(0.19,0.012,0.014);
        float inWindow = step(0.0, vR.x)*step(vR.x, 1.0);
        vec2 ribbonTex = uHasTex > 0.5 ? texture2D(uRibbon, clamp(vR, vec2(0.0), vec2(1.0))).rg : vec2(1.0, 0.0);
        // R = remaining ink and weave, G = depleted ink; depleted cloth reads paler and greyer.
        float ink = mix(1.0, ribbonTex.r, inWindow);
        float used = mix(0.0, ribbonTex.g, inWindow);
        float weave = sin(vR.x*1200.)*sin(vR.y*62.8318)*0.06+0.94;
        diffuseColor.rgb = mix(band, vec3(0.12,0.11,0.10), used*0.8)*(0.75+0.25*ink)*weave;`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.printPoint = m.platen.center; this.geometryPrint = null;
    this.update();
  }

  update() {
    const { soft, m } = this;
    const r = soft.ribbon;
    const a = this.geo.getAttribute('position');
    const hw = m.ribbon.width / 2;
    for (let i = 0; i < r.count; i++) {
      const px = r.positions[i * 3], py = r.positions[i * 3 + 1], pz = r.positions[i * 3 + 2];
      const ux = r.up[i * 3], uy = r.up[i * 3 + 1], uz = r.up[i * 3 + 2];
      a.array[i * 6] = px - ux * hw; a.array[i * 6 + 1] = py - uy * hw; a.array[i * 6 + 2] = pz - uz * hw;
      a.array[i * 6 + 3] = px + ux * hw; a.array[i * 6 + 4] = py + uy * hw; a.array[i * 6 + 5] = pz + uz * hw;
    }
    a.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.boundingSphere = null;
    this.texture?.flush();
    this.updateWindowUv();
  }

  /** Maps the ribbon-texture window (centred on the print point, see SoftWorld._refreshRibbonWindow) along the strip. */
  updateWindowUv() {
    const t = this.soft.ribbonTexture;
    if (!t || !t.pxPerM) return;
    const r = this.soft.ribbon, uvA = this.geo.getAttribute('uv'), cum = this.cum;
    const P = this.printPointWorld ?? (this.printPointWorld = [0, 0, 0]);
    // Node nearest the print point anchors the window.
    let best = 0, bd = 1e9;
    cum[0] = 0;
    for (let i = 0; i < r.count; i++) {
      if (i > 0) {
        const dx = r.positions[i * 3] - r.positions[i * 3 - 3], dy = r.positions[i * 3 + 1] - r.positions[i * 3 - 2], dz = r.positions[i * 3 + 2] - r.positions[i * 3 - 1];
        cum[i] = cum[i - 1] + Math.hypot(dx, dy, dz);
      }
      const d = (r.positions[i * 3] - P[0]) ** 2 + (r.positions[i * 3 + 1] - P[1]) ** 2 + (r.positions[i * 3 + 2] - P[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const k = t.pxPerM / t.width;
    for (let i = 0; i < r.count; i++) {
      const u = 0.5 + (cum[i] - cum[best]) * k;
      uvA.setX(i * 2, u); uvA.setX(i * 2 + 1, u);
    }
    uvA.needsUpdate = true;
  }
}
