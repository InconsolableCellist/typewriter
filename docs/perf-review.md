# Performance and download review

Reviewed 2026-11-13 at `a46de41` (origin/master), all three machines: `frontstrike1926`, `element1971` (both
`src/kits/typewriter.js`) and `wordproc1980` (`src/kits/wordproc.js`). Nothing in the product was changed.

## Summary

The findings worth acting on first. The first column is the recommendation's number below.

| Rec. | Finding | Gain | Effort |
|---|---|---|---|
| 1 | `element1971`: subnormal floats in the element's tilt/rotate states triple the idle audio-thread cost after the first keystroke | 24.7 % to 8.0 % of real time (measured) | hours |
| 2 | `wordproc1980`: the parked, invisible sheet is simulated every frame and never sleeps | about 4 ms of main thread a frame (measured in Node) | minutes |
| 3 | `glyphs.bin` is served uncompressed and blocks the typewriters' first frame | 866 KB to 52 KB | minutes |
| 4 | `element1971` downloads five texture sets it never draws | 7.4 MB of its 16.2 MB | minutes |
| 5 | The render size ignores `devicePixelRatio`: a 1600 x 1000 window at DPR 1 renders 2 times its pixels, 1280 x 720 renders 3.5 times | 1.2 to 3.5 times fewer fragments | an hour |
| 6 | The word processor has no quality governor; the typewriters' one never engages below 8 fps | slow devices get relief | an hour |
| 7 | The composer's second buffer is 4x MSAA half float with depth, used only for full-screen quads | about 150 MB of GPU memory at 3.2 MP, one resolve a frame | an hour |
| 10 | Every deploy re-downloads every asset (`?v=<commit>`); hashed chunks are not `immutable` | 8 to 18 MB per returning visitor per deploy | half a day |
| 12 to 14 | 2048 px textures on small parts (`green_felt` alone is 4.2 MB), a 2k HDRI used only blurred, uncompressed GLBs | about 9 MB of 17.7 MB on `frontstrike1926` | a day |
| 17 | Shadow map, AO prepass and Print Point view are redrawn every frame although nothing moved | at rest: 4 geometry passes to 1 | 1 to 2 days |

## How this was measured

- **Bytes** (KB is 1000 bytes, MB a million): `npm run build`, file sizes in `dist/`, and the kits' fetch lists
  read from the code and checked against Playwright's network log on `vite preview`. "Wire" bytes assume what the
  live site does, checked with `curl` against https://typewriter.foxipso.com: HTML, JS, CSS and JSON are compressed
  (zstd or brotli; gzip -6 is the estimate used here), and `model/gltf-binary`, `application/octet-stream`, AVIF,
  Ogg and EXR are sent as they are (no `content-encoding` on `frame.glb` or `glyphs.bin`). The software renderer was
  too slow to see every typewriter texture set arrive, so those lists come from `loadStudioTextures`; the sets that
  did arrive matched it file for file.
- **Draw calls, triangles, programs**: Chromium under Xvfb with SwiftShader (about 0.2 fps), 1600 x 1000 window,
  DPR 1, default camera, machine at rest, by wrapping `renderer.render` and reading `renderer.info` per call. The
  shadow pass is not in the per-call figures (three resets `info` after it), so it was counted separately with
  `info.autoReset = false`, with and without `shadowMap.autoUpdate`.
- **Audio thread and soft bodies**: Node 22 on this container (Xeon 2.3 GHz, 4 cores), with no browser running. The
  mechanism runs at 384 kHz, 8 substeps a sample; one block is 128 samples, 2.667 ms at 48 kHz.
- **Not measured**: any GPU time. This container has no GPU. Every GPU gain below is counted in fragments, draw
  calls, passes or bytes of memory, and the milliseconds would have to be measured on real hardware (`?timing` already
  gives `window.__gpu` on the typewriters).

The scripts were throwaway and are not committed.

## Current numbers

### Download per machine (first visit)

| | `frontstrike1926` | `element1971` | `wordproc1980` |
|---|---|---|---|
| Before the first frame: wire / raw | 1.29 MB / 2.16 MB | 1.92 MB / 2.79 MB | 2.23 MB / 3.21 MB |
| of which JS, CSS, HTML (wire) | 420 KB | 420 KB | 474 KB |
| of which glyphs | 866 KB | 866 KB | 44 KB |
| of which models | 0 | 0 | 1.72 MB (5 GLBs) |
| Streamed in after mounting (wire) | 15.93 MB | 13.55 MB | 5.28 MB |
| of which textures | 10.50 MB (27 files) | 10.50 MB, and 0.63 MB of crinkle paint before the first frame | 2.59 MB (11 files) |
| of which models | 2.80 MB | 0.43 MB | 16 KB (desk) |
| of which HDRI | 2.62 MB | 2.62 MB | 2.62 MB |
| On the first gesture (worklet, sound sprites) | 502 KB | 749 KB | 268 KB |
| **Total to the first keystroke: wire / raw** | **17.7 MB / 18.7 MB** | **16.2 MB / 17.2 MB** | **7.8 MB / 8.9 MB** |
| Only on demand | rain 3.38 MB, thunder 269 KB | the same | the same, word list 114 KB |

Shared by all three: `index`, the three.js chunk, `client`, `soft`, `glyphs`, `EXRLoader`, the worklet, `desk.glb`,
the HDRI, `walnut_desk` and `paper_fibre`. The typewriter sets are named in `loadStudioTextures`
(`src/render/materials.js`); the word processor asks for two of them with `only`.

What is deployed: `dist/` is 42.5 MB in 136 files; `public/assets/` is 39.7 MB.

### JS bundle

| Chunk | Raw | gzip | brotli | Loaded by |
|---|---|---|---|---|
| `index` | 31 KB | 13 KB | 11 KB | all |
| `ambience` (three.js and shared render code) | 789 KB | 236 KB | 199 KB | all |
| `client` (mechanisms, main-thread host) | 208 KB | 75 KB | 64 KB | all |
| `soft` | 56 KB | 23 KB | 20 KB | all |
| `typewriter` | 158 KB | 58 KB | 50 KB | typewriters |
| `wordproc` | 314 KB | 112 KB | 95 KB | word processor |
| `EXRLoader`, `glyphs` | 33 KB | 12 KB | 11 KB | all |
| `worklet` (first gesture) | 204 KB | 73 KB | | all |

The kit split works: a visit downloads one family. Vite's large-chunk warning is the `ambience` chunk, which is
three.js (about 690 KB of the 789 KB); see recommendation 11.

### Rendering, one frame at rest (1600 x 1000 window, internal size 2263 x 1414 = 3.2 MP)

| | `frontstrike1926` | `element1971` | `wordproc1980` |
|---|---|---|---|
| Key-light shadow map, 2048 x 2048, every frame | 94 calls, 218 k tris | 117 calls, 361 k tris | 239 calls, 130 k tris |
| AO G-buffer, 1131 x 707 (half size), whole scene with a normal material | 105 calls, 220 k tris | 132 calls, 364 k tris | 256 calls, 132 k tris |
| GTAO (16 samples) and Poisson denoise, half size | 2 full-screen | 2 | 2 |
| Scene, 4x MSAA half float | 107 calls, 222 k tris | 136 calls, 367 k tris | 266 calls, 133 k tris |
| OutputPass (into a 4x MSAA half-float target), SMAA edges, weights, blend | 4 full-screen | 4 | 4 |
| Print Point view: scene again, 1236 x 880, 4x MSAA half float, then OutputPass | 58 calls, 120 k tris, +1 | 43 calls, 273 k tris, +1 | none |
| CRT phosphor pass, 1280 x 800 half float with a full mip chain | | | 1, while the picture changes |
| Screen card | | | 1 quad in a scissor rectangle |
| **Whole frame** | **371 calls, 780 k tris** | **435 calls, 1.37 M tris** | **769 calls, 395 k tris** |
| `renderer.render` calls | 10 | 10 | 10 |
| Programs | 56 | 69 | 46 |
| `linkProgram` calls during load | 58 | 71 | 48 |
| Meshes (instanced) / unique materials / geometries | 149 (11) / 57 / 162 | 207 (3) / 128 / 187 | 293 (0) / 106 / 273 |
| Lit materials: physical with clearcoat / other physical / standard | 9 / 11 / 11 | 51 / 23 / 16 | 54 (11 also sheen) / 4 / 41 |
| Lights | 2 directional, 2 spot | the same | 2 directional, 2 spot |
| Shadow maps | key 2048 (every frame), lamp 1024 (every 4th frame while lit) | the same | key 2048 (every frame), CRT spill 512 (every 3rd frame when dim) |
| Textures on scene materials | 27 authored maps at 2048 px once all sets are in, about 600 MB as RGBA8 with mips | 14 authored maps once its sets are in (see 4) | 58, about 243 MB as RGBA8 with mips |

Shadow filtering is PCSS, 12 blocker and 16 filter taps for each shadowed light in every lit fragment
(`patchPCSS`, `src/render/scene.js`). Anisotropy is the device maximum (16) on the typewriters' authored sets.

### Main thread, per frame (Node, 60 Hz frames)

| | Cost |
|---|---|
| Typewriter soft bodies, sheet asleep | 0.17 ms |
| Typewriter soft bodies, sheet settling | 1.1 to 1.8 ms |
| Word processor soft bodies, **printer empty** (the default) | **3.8 to 4.5 ms**, never asleep |
| Mechanism on the main thread before the first gesture: front strike / element / word processor | 0.18 / 0.92 / 0.41 ms |

### Audio worklet (mechanism and voices, share of real time on one 2.3 GHz core)

| | Idle | Busy | Worst block |
|---|---|---|---|
| `frontstrike1926` | 3.5 % | 17 to 26 % typing at 10 characters a second | 4 to 7 ms |
| `element1971` | 7.5 % fresh, **24 % after any typing** | 26 to 35 % typing | 6 ms |
| `wordproc1980` | 3 to 5 % (fans and motors) | 11 to 22 % printing with a diskette transfer | 3.4 ms at the 99th percentile |

The budget tests pass on a quiet machine: word processor voices 740 ns a sample against 1000 (`tests/wp_audio.test.js`),
front strike mean block 16.6 % against 50 % (`tests/mech_acoustics.test.js`). The first failed at 1166 ns while a
browser was using the other cores, so it is sensitive to load.

## Recommendations

Ranked within each group by gain for the effort. "Measured" means measured here; everything else is an estimate.

### Quick wins

**1. Flush subnormals in the element mechanism (`element1971`).**
- Problem: after the first keystrokes the type element's selection states decay towards zero and stay subnormal for
  good. Subnormal arithmetic is many times slower on x86, and the idle cost of the audio thread triples.
- Evidence: fresh idle 7.3 to 8.4 % of real time; typing 8 characters; then 15.7 %, 22.5 %, 23.3 % over the next 13 s
  and no recovery. After that `sim.action.tilt = -1.5e-322`, `tiltV = 7.7e-319`, `rot`, `rotV`, `tiltSt`, `rotSt`,
  and `eng.rad.y1`, `eng.rad.lp`, `eng.room.fbState` are all subnormal. The profile is 34.5 % `driveSelection` and
  24.6 % `stepDof` (`src/sim/element-action.js:565`, `:543`). Zeroing those states by hand in the bench brings the
  same idle from 24.7 % to 10.1 %, and to 8.0 % with the radiation filter and room feedback zeroed too.
- Change: snap each of these states to zero below about 1e-20 (or add and subtract a tiny constant), in `stepDof`,
  the radiation filter and `room.js`. Add the idle-after-typing check that `tests/mech_acoustics.test.js` already has
  for the front strike machine.
- Gain: 16 points of one core on the audio thread, permanently, on x86. Effort: hours. Risk: low; the threshold is far
  below anything audible or visible.

**2. Do not simulate the parked sheet (`wordproc1980`).**
- Problem: the printer starts empty (`soft.parkSheet()` in `src/kits/wp/printer.js`), but `SoftWorld.step` still runs
  8 paper substeps a frame on the hidden sheet, and it never falls asleep. `PaperView.update` then refines the mesh,
  recomputes normals and re-uploads the vertex buffer for a mesh with `visible = false`.
- Evidence: driven by the real mechanism state in Node for 20 s: `soft.step` 4.5, 4.2, 3.8 ms a frame, `asleep`
  false, `restFrames` 0, `sheetParked` true. One paper substep is 572 us, the ribbon 25 us. In the browser the same
  call is most of `printer.update`.
- Change: skip `paperSim.substep` in `SoftWorld.step` and return early from `PaperView.update` while
  `soft.sheetParked`.
- Gain: about 4 ms of main thread a frame on this CPU, a quarter of a 60 Hz frame, more on a phone. Effort: minutes.
  Risk: low; `spawnSheet` resets the sheet when one is fed.

**3. Compress `glyphs.bin`.**
- Problem: 866 KB sent as `application/octet-stream`, which Cloudflare does not compress, and the typewriters'
  `mount` awaits it before anything is drawn.
- Evidence: live response has `content-length: 866304` and no `content-encoding`. gzip -9 gives 51.9 KB, brotli
  36.4 KB.
- Change: bake it as `glyphs.gz.bin` with `"gzip": true` in `glyphs.json`. `loadGlyphs` already handles that for
  the word processor's set; the fallback reader in `src/kits/typewriter.js` and `src/sim/harness.js` need the same.
- Gain: 814 KB off both typewriters, before the first frame. Effort: minutes. Risk: none beyond what `glyphs_wp`
  already relies on (`DecompressionStream`).

**4. Load only the texture sets a machine draws.**
- Problem: `loadStudioTextures` loads all nine sets for both typewriters. `element1971` uses its own paint and
  never draws `mats.japan`, `japanGlb`, `table`, `nickel`, `nickelGlb`, `blued`, `ribbonSpool` or `felt`.
- Evidence: `src/render/element-view.js` references only `steel`, `steelDark`, `rubber` and the desk and paper
  materials from the shared set. In the browser, after `powder_coat` and `nickel_polished` had loaded, no material
  in the scene carried a 2048 px map.
- Change: pass `only: ['chrome_steel', 'vulcanised_rubber', 'walnut_desk', 'paper_fibre']` for the element, as the
  word processor already does.
- Gain: 7.4 MB of download (`powder_coat` 0.75, `nickel_polished` 1.43, `blued_spring_steel` 0.23,
  `bead_blasted_aluminium` 0.75, `green_felt` 4.19), 11 decoded 2048 px bitmaps and five roughness mip chains that
  are never used. Effort: minutes. Risk: check the list against the view once.

**5. Cap the render size at the display's pixels.**
- Problem: `resize` in `src/render/scene.js` sets `pixelRatio = clamp(sqrt(3.2e6 / (w h)) * quality, 1, 2)` and
  never reads `devicePixelRatio`. Every window is rendered at about 3.2 MP, on top of 4x MSAA and SMAA.
- Evidence: the 1600 x 1000 DPR 1 test window rendered 2263 x 1414, 2.0 times its pixels. By the same formula
  1280 x 720 renders 3.5 times its pixels and 1920 x 1080 1.5 times. A phone at 390 x 844 renders 780 x 1688.
- Change: `min(devicePixelRatio, budget)` as the default, with supersampling above native as an option or only
  after the frame time shows room for it.
- Gain: 1.2 to 3.5 times fewer shaded fragments and MSAA memory on DPR 1 displays, which is where integrated
  graphics are. Effort: an hour. Risk: slightly softer edges on DPR 1 screens; MSAA and SMAA remain.

**6. Give the word processor the quality governor, and fix its blind spot.**
- Problem: `govern` exists only in `src/kits/typewriter.js`; the word processor's loop never lowers anything. In
  the typewriters, a frame gap over 120 ms resets the averaging window, so a device under about 8 fps never
  accumulates the 120 frames a decision needs. A device at 10 fps needs 36 s for each step after the first 15 s, and
  the first two steps only lower the AO.
- Evidence: `govern` in `typewriter.js` (`if (d > 120 || d <= 0) { govN = 0; ... }`); no `setQuality` call in
  `wordproc.js`.
- Change: move the governor into `createScene`, use it in both kits, treat long frames as slow frames (ignore only
  gaps over a second or so), and start a step lower on a coarse-pointer device.
- Gain: slow devices recover in seconds instead of never. Effort: an hour. Risk: low.

**7. Make the composer's second buffer plain.**
- Problem: `EffectComposer` clones the 4x MSAA half-float target with its depth buffer for `renderTarget2`. The
  OutputPass draws one full-screen quad into it, which is then resolved.
- Evidence: the per-pass log shows OutputPass writing a `msaa4` half-float target. At 3.2 MP one such target is
  about 102 MB of colour samples, 51 MB of depth samples and 26 MB of resolve texture.
- Change: render the scene into its own MSAA target and give the composer non-MSAA, depthless buffers (8 bit after
  the OutputPass).
- Gain: about 150 MB of GPU memory at 3.2 MP (60 MB on a phone) and one full-screen MSAA resolve a frame. Effort: an
  hour. Risk: low; check SMAA still reads the tone-mapped image.

**8. Stop shipping what nothing reads.**
- Evidence and gain. The first two are deployed with the site but never downloaded by a visitor:
  - 10.4 MB of texture sets with no reference in `src/`: `nickel_plating` and `nickel_worn` (2.95 MB each and
    byte-identical), `wrinkle_paint` 1.57 MB, `pinstripe_border.png` 1.15 MB, `ribbon_cloth` 0.96 MB,
    `japanned_enamel` 0.67 MB, `key_glass` 0.12 MB.
  - 1.02 MB of duplicates in `dist/assets/`: Vite emits hashed copies of `glyphs.bin`, `glyphs_wp.gz.bin` and
    `wordlist_en.gz.bin` because of the `new URL(\`../../public/assets/${name}\`, import.meta.url)` in
    `src/machine/glyphs.js`. Nothing fetches them.
  - `frame.glb` carries a second UV set (`TEXCOORD_1`, about 250 KB) that no material uses. This one is downloaded.
- Change: move the unused sets out of `public/`, build the Node path without the `new URL` template, drop the
  second UV set in `build_frame.py`.
- Effort: minutes each. Risk: none.

**9. Small duplicate work in the word processor's textures.**
- Evidence: `wp_pebble` is loaded twice by two loaders (`applyTextureSet` and `loadSet` in
  `src/render/wp/units.js`): `wp_pebble_roughness.avif` (127 KB) is fetched in addition to the mip atlas, albedo and
  normal are decoded and uploaded twice, and `materials.json` is requested three times.
- Change: one loader. Gain: 127 KB and about 11 MB of GPU memory. Effort: minutes.

### Caching

**10. Version assets by their content, and mark them immutable.**
- Problem: `src/asset-version.js` appends `?v=<build id>` to every `/assets/` fetch, and the build id is the commit
  (`a46de41b8627` in the live bundle). Every deploy therefore changes every asset URL, and a returning visitor
  downloads all 7.8 to 17.7 MB again although the models, textures, HDRI and sounds have not changed. The
  repository has had 21 merged pull requests in four days.
- Also: `public/_headers` gives everything under `/assets/` `max-age=86400`. Vite's hashed chunks live there too
  (`/assets/index-CjqTuRTz.js` is served with that header), so they are revalidated daily instead of being
  `immutable`. Requests that do not go through `fetch` are not versioned at all: `rain.ogg` (an `Audio` element) and
  the Caveat font (`FontFace`).
- Change, in two steps:
  1. Put Vite's output in its own directory (`build.assetsDir`) and give that directory
     `Cache-Control: public, max-age=31536000, immutable`.
  2. In a small Vite plugin, hash each file under `public/assets/` at build time and inject the map; make
     `versioned()` append the file's own hash instead of the build id, use it for the `Audio` and font URLs too, and
     give `/assets/*` the same immutable header. An unchanged file keeps its URL across deploys.
- Gain: after a deploy a returning visitor downloads the changed chunks only (0.1 to 0.5 MB) instead of everything,
  and no revalidation requests in between. The mixed-version problem the query was added for stays solved.
  Effort: half a day. Risk: low; the map adds about 2 KB to `index`.

**11. Keep three.js in its own chunk.** Once chunks are immutable, the 236 KB `ambience` chunk still changes name
whenever any shared render code changes. A `manualChunks` entry for `three` keeps about 200 KB cached across
deploys and removes the build warning. Effort: minutes.

### Download size, bigger changes

**12. Textures sized for where they are used.**
- Problem: every set is 2048 px whatever it covers. `green_felt` is 4.19 MB (its normal map alone 3.40 MB) for the
  felt pads. From the default camera a screen pixel covers about 0.37 mm of the machine while these sets hold 0.03
  to 0.05 mm a texel, so mip 3 or 4 is what is sampled; level 0 is reached only near the closest zoom (0.09 m).
- Evidence: re-encoding at 1024 px with the same AVIF settings: `green_felt` normal 3401 to 808 KB and mip atlas
  774 to 289 KB; `nickel_polished` mip atlas 1407 to 385 KB; `vulcanised_rubber` 658 to 194 KB;
  `bead_blasted_aluminium` 672 to 190 KB; `chrome_steel` mip atlas 428 to 161 KB; `blued_spring_steel` mip atlas
  188 to 76 KB.
- Change: 1024 px for the six small-part sets, or load 1024 first and fetch 2048 when the camera comes close.
- Gain: 5.4 MB of `frontstrike1926`'s 10.5 MB of textures, and 18 textures at a quarter of the GPU memory (about
  300 MB less, see 19). Effort: a few hours in `tools/gen/materials.py`. Risk: softer at the closest zoom; needs
  a look.

**13. A 1k HDRI.**
- Problem: the 2k EXR is 2.62 MB for every machine. It is used as image-based light and as a backdrop with
  `backgroundBlurriness = 0.06`, so both are sampled from the prefiltered cube map and never from the 2k image.
  Decoding DWAB runs on the main thread.
- Evidence: the same file box-filtered to 1024 x 512 and written as DWAB 45 is 720 KB.
- Gain: 1.9 MB on every machine, a quarter of the decode and prefilter work. Effort: an hour. Risk: reflections on
  polished nickel and chrome come from a 256 px cube face instead of 512; compare before and after.

**14. Compress the models.**
- Problem: the three typewriter GLBs are float32 with no compression (`frame` 1.52 MB, `enclosure` 1.26 MB,
  `element_enclosure` 0.42 MB); the five word-processor GLBs are quantized but nothing more. None is compressed in
  transit.
- Evidence (`gltf-transform meshopt`, lossless apart from quantization):

  | File | Now | Meshopt | Meshopt then gzip | Draco |
  |---|---|---|---|---|
  | `frame.glb` | 1524 KB | 598 KB | 312 KB | 155 KB |
  | `enclosure.glb` | 1263 KB | 445 KB | 224 KB | 112 KB |
  | `element_enclosure.glb` | 415 KB | 170 KB | 117 KB | 63 KB |
  | five `wp_*.glb` | 1715 KB | 671 KB | 348 KB | 381 KB |

- Change: meshopt in the export step and `MeshoptDecoder` on the loaders (25 KB raw, 6.5 KB gzip). Draco is smaller
  but needs a 345 KB decoder. Serving the result as `.gz.bin` through `DecompressionStream`, as the glyphs do, gets
  the third column.
- Gain: 1.74 MB on `frontstrike1926`, 1.04 MB on `wordproc1980`, 0.25 MB on `element1971`; about 0.5 MB more each
  with the gzip wrapper. Effort: half a day. Risk: low; KHR_mesh_quantization is already in use.

With 3, 4, 9, 12, 13 and 14 together the totals to the first keystroke come to about 7.8 MB for `frontstrike1926`
(from 17.7), 5.2 MB for `element1971` (from 16.2) and 4.7 MB for `wordproc1980` (from 7.8).

### Load path

**15. Shorten the request chain before the first frame.**
- Problem (typewriters): HTML, `index`, the kit and three.js, the `glyphs` chunk, `glyphs.json`, `glyphs.bin`,
  `client`, then `soft`, each found only after the one before has run: eight round trips in a row. `client`, `soft`
  and `glyphs` are loaded through `import.meta.glob` although they are always needed.
- Problem (word processor): the five unit GLBs are loaded one after another (`for ... await builders[name](u)`).
- Problem (both typewriters): the nine texture sets are fetched one set at a time (`for (const j of jobs) await
  loadSet(...)`), so the downloads never overlap.
- Change: import the three chunks statically from the kit; start the glyph fetches when the kit module is evaluated
  (or preload them from the inline script in `index.html`, which already knows the machine); `Promise.all` over the
  units; start every texture fetch at once and keep only the uploads sequential.
- Gain: four to five round trips before the first frame on the typewriters, four on the word processor, and the
  texture phase bounded by the largest set instead of the sum. Effort: a few hours. Risk: low.

**16. Compile shaders before the first frame, and only once.**
- Problem: nothing calls `renderer.compileAsync`. The first `composer.render()` links about 35 to 40 programs
  synchronously. Then every lit program is linked a second time when the HDRI replaces the studio environment:
  `PMREMGenerator.fromScene` makes a 256 px cube, the 2k EXR a 512 px one, and three keys its programs on the
  environment's cube size (`envMapCubeUVHeight`). Each texture set that arrives can do the same to its materials,
  because `material.needsUpdate` comes with new defines (map, normal map, clearcoat and so on). All of the later
  links happen while the visitor is already using the machine.
- Evidence: `linkProgram` calls by time. `element1971`: 40 in the first 5 s, then 26 within about 10 s of the HDRI
  arriving (its paint textures were already in, and the other sets that had arrived are on no drawn material).
  `frontstrike1926`: 36 at the start, 19 after the HDRI and `powder_coat` arrived. `wordproc1980`: 45 in the
  first 10 s, where the HDRI arrives early.
- Change: make the two environments the same cube size (a 1k HDRI, recommendation 13, gives 256 px, or build the
  studio environment at 512), or wait for the HDRI behind the loading screen. Create each material with 1 x 1
  placeholder maps and its final physical parameters, so its program does not change when the real texture arrives.
  Then `await renderer.compileAsync(scene, camera)` before the first frame.
- Gain: 19 to 26 fewer program links after the loading screen has gone, and the first-frame stall moves off the
  main thread where the browser supports parallel compile. Effort: half a day. Risk: low. The stalls themselves
  could not be timed here.

### Runtime GPU, bigger changes

**17. Redraw the shadow map, the AO and the Print Point view only when something changed.**
- Problem: every frame redraws all of them, at rest as well. On `frontstrike1926` that is four geometry passes for
  one image.
- Evidence: the pass table above. Shadow, AO G-buffer and Print Point account for 257 of 371 draw calls and 558 k of
  780 k triangles on `frontstrike1926`, 495 of 769 calls on `wordproc1980`.
- Change: a "scene moved" flag from the mechanism state, the paper's `asleep`, the camera matrix and the
  environment's easing. Set `shadowMap.needsUpdate` only when a caster moved; keep the last AO map when neither
  camera nor geometry moved; keep the Print Point target when its contents did not change. The cigarette smoke is
  transparent and casts nothing, so it does not block any of the three.
- Gain: at rest, one geometry pass instead of four on the typewriters and one instead of three on the word
  processor, and no GTAO or denoise pass. Effort: one to two days. Risk: medium; a missed dirty flag shows as a
  stale shadow.

**18. Fewer draw calls in the word processor.**
- Problem: 293 meshes, none instanced, 275 geometries, 190 triangles a draw call on average, drawn three times a
  frame. The 86 key caps share one material but are 86 meshes.
- Change: a `BatchedMesh` (or one merged mesh with a per-key offset) for the caps; merge the static meshes of each
  unit by material at load.
- Gain: roughly 769 to 300 calls a frame. `composer.render` took 10.8 ms of main thread here against 5.0 ms for the
  element's 268 calls, under heavy contention, so the absolute saving is perhaps 1 to 2 ms on a laptop. Effort: a
  day. Risk: low for the caps, medium for merging parts that are picked or animated.
- The same applies to the element's key caps: each has its own cloned material (`capMat.clone()`,
  `src/render/element-view.js:628`), 51 materials for 62 meshes, where the front strike machine uses one instanced
  mesh with an atlas attribute.

**19. Texture memory.**
- Problem: every authored map is uploaded as RGBA8 with mips, 22 MB each at 2048 px, including the single-channel
  roughness and metalness maps. `frontstrike1926` holds 27 of them, about 600 MB. `lowTier` only halves the desk's
  maps and only when `maxTextureSize < 4096`, which no current phone reports.
- Change, in order of effort: 1024 px for small-part sets (12); pack roughness and metalness into one texture
  (three reads G and B) or upload them as R8; a real low tier chosen by device; KTX2 for GPU memory if it is still
  needed (docs/assets.md records that it loses on download size).
- Gain: 600 MB to about 250 MB with the first two. Effort: a day. Risk: low.

**20. Print Point view resolution.** `HeadView.render` uses `scale = min(2, sqrt(1.2e6 / area))`: a 618 x 440 card
is rendered at 1236 x 880 with 4x MSAA, 16 samples for each screen pixel at DPR 1, and about 61 MB of targets.
Capping the scale at `devicePixelRatio` (or 1.5) gives 2 to 4 times fewer fragments in the second scene render.
Effort: minutes. Risk: the ink is the point of this view, so compare.

**21. Skip shadow filtering for lights that give no light.** The word processor's green spill light has a small
intensity in daylight (0.086 cd in the measured frame) and its shadow map is not refreshed then, but every fragment
in its cone still pays the 12 to 28 PCSS taps. An early return on `shadowIntensity <= 0` in the patched `getShadow`,
with `light.shadow.intensity = 0` while the glow is negligible, removes it without changing the light count (so no
recompile). Effort: an hour.

**22. Material cost.** The word processor's plastics are all `MeshPhysicalMaterial` with `clearcoat 0.05` or `0.06`
and `sheen` (54 clearcoat materials, 11 with sheen, covering most of the screen), and felt, rubber and the desk on
the typewriters are physical too. A clearcoat of 0.05 costs a second specular lobe for four lights and a second
environment lookup in every fragment for an effect that is hard to see. Dropping it where it is under about 0.1,
and using `MeshStandardMaterial` where no physical feature is set, is a few hours and needs an eye on the result.

**23. CRT targets.** The two phosphor targets are RGBA half float at 1280 x 800 with full mip chains, 22 MB, and only
R and G are used. `RGFormat` halves the memory and the mip generation. The pass itself is well behaved (see below).
Effort: minutes.

**24. Anisotropy and a phone tier.** 16x anisotropic filtering on four 2048 px maps a material is expensive on
mobile GPUs; 4 to 8 is usually indistinguishable. A coarse-pointer tier (pixel ratio 1.5, AO tier 1, PCSS 8 and 8
taps, key shadow 1024) would be the first thing to try on a real phone. Effort: an hour. Not measurable here.

### Audio thread

**25. Worst-case blocks.** Typing on `frontstrike1926` averages 17 to 26 % of a block on this core but the 99th
percentile is 3.6 ms and the worst 4 to 7 ms, more than one 2.67 ms quantum. A phone core at half this speed would
sit near 50 % with regular overruns. The profile while typing: `actions.js step` 16 %, modal `tick` 13.5 %,
`barBarContacts` 10 %, `mechanics.js step` 10 %, `stepEsc` 9 %, `barTick` 6.5 %, and the garbage collector 4.6 %,
which means something allocates in the audio path. Finding and removing those allocations is the first step
(effort: half a day); the mechanism's cost is by design.

**26. One worklet bundle for both families.** `src/sim/host-factory.js` imports the typewriter and the
word-processor mechanisms and both audio engines, so the 204 KB worklet (73 KB gzip) carries the other family's
code. Two entry points would save roughly a third of it. Low priority.

### Small things

- `LookRenderPass.render` walks the whole scene every frame to patch materials, and `GTAOPass` walks it twice more
  to hide and restore objects. A few hundred objects, so tens of microseconds; patch on `onBeforeRender` or when
  objects are added if it ever shows.
- `markers.update()` writes `style.transform` on every marker every frame, then `screenCard.render()` calls
  `getBoundingClientRect()`, which forces a style recalculation. Cache the rectangles on resize and skip unchanged
  transforms. Measured cost here is under 0.1 ms.
- `Enclosure.load` sends a `HEAD` before the `GET` for `enclosure.glb`: one wasted round trip.
- The first sound waits for the worklet chunk, `addModule`, a 180-block warm-up on the audio thread and the sprite
  fetch, all started by the first gesture. Fetching the worklet and sprite bytes at idle after the first frame would
  shorten that.

## Checked and found in order

- **localStorage**: written only on events (a setting changed, a drag ended), never in a frame loop.
- **Raycasts**: the typewriters pick at most once a frame, on a dirty flag, against proxy shapes; the word processor
  throttles hover picks to one every 60 ms.
- **CRT phosphor pass**: by its code it stops 1.5 s after the last change. At 0.2 fps the browser run never reached
  that much frame time, so the stop itself was not observed; `screen.version` did not move at rest (52 throughout a
  two-minute idle), no cell had the blink attribute and the cursor does not blink, so nothing should keep it awake.
- **Screen card**: one quad in a scissor rectangle, skipped when hidden or folded.
- **Lamp and spill shadow maps**: `autoUpdate = false`, refreshed every fourth or third frame only while they light
  something.
- **Front strike geometry**: keys, levers, bars and slugs are instanced (11 instanced meshes) and static parts merged.
- **Typewriter paper**: sleeps; 0.17 ms a frame at rest.
- **Mechanism before the first gesture**: under 1 ms a frame on the main thread for all three.
- **Lazy loading**: kits by family, sound after the first gesture, rain and thunder when the weather needs them,
  the word list when Spelling Tasks loads.
- **AVIF encoding**: already tight; the remaining texture bytes are resolution, not codec settings. The sound
  sprites are small (74 to 426 KB) and were not looked at further.
