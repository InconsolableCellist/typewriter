# Word processor: models and views

The units on the desk must reach the standard of the electric typewriter (`element1971`): real proportions from the
documented sizes and the photographs, moulded shapes with real thickness, gaps and bevels, textured plastics, and every
part the operator touches modelled and moving with the mechanism. This file is the contract for building them.

## Pipeline
- One Blender builder per unit: `tools/blender/build_wp_<unit>.py`, writing `public/assets/models/wp_<unit>.glb`.
  Blender is available as a Python module: `/root/bpyenv/bin/python tools/blender/build_wp_<unit>.py` (Blender 5.3;
  `import bpy`). Follow `tools/blender/build_element_enclosure.py`: closed solids with wall thickness, panel gaps as
  real gaps, bevels after booleans, weighted normals, box-projected UVs at one UV unit = 0.2 m.
- One view per unit: `src/render/wp/<unit>-view.js`, exporting `async build<Unit>(size, mats, opts)` that loads the GLB
  and returns `{ group, parts, ... }` in the unit's local frame. It replaces the primitive builder of the same name in
  `src/render/wp/units.js`; keep the returned `parts` names the kit uses (below), add new ones freely.
- Materials are assigned by name in the view from `createUnitMaterials()` (`src/render/wp/units.js`), which owns the
  textured materials. GLB material names: `wp_pearl` (Pearl White covers), `wp_gray` (Pebble Gray bases and trim),
  `wp_dark` (dark mouldings: bezels, panels, slots), `wp_keycap`, `wp_rubber`, `wp_metal`, `wp_chrome`, `wp_glass`,
  `wp_label`, plus unit-specific ones the view creates (LEDs, displays, the printwheel). The textured sets are
  `wp_pebble` (covers; neutral albedo, colour from the material) and `wp_keycap`, both tile sizes in
  `public/assets/textures/materials.json`.
- Frame: each unit's origin is on the surface it stands on, under its centre; x right, y up, z toward the operator
  (glTF Y-up). Overall size is `units.<unit>.size` in `src/machine/wordproc1980.js` (documented), within 2 mm.
- Moving parts are separate nodes with their pivot at the node origin (as `element_hood`).
- Budget for all five GLBs together: about 1.1 MB (architecture.md 12.3). No baked images inside them.

## References
- Photographs: Bitsavers `pdf/ibm/6580_Displaywriter/photos/` (keyboard/, main_assy/), `pdf/ibm/5218/pictures/`,
  the 1982 brochure (`G552-0323-1`, p.1 and p.18), the Customer Setup Guide (`G544-0858-5`: p.23 display on the module,
  p.27-29 rear panels, p.37-42 the assembled station, controls, diskette unit and levers), the Product Support Manual
  (`S241-6248-2`: p.7 display front, p.30 keyboard exploded, p.34 key positions, p.46 module top cover, p.50 drive,
  p.61 diskette covers), Service Theory (`S241-6247-2`: p.28 display front, side and top), the 5218 Maintenance
  Information Manual (`SY20-8520-0`) and Setup Procedures (`GA23-1007-1`).
- Local copies made during research (render more pages with `pdftoppm -f N -l N -r 150 -png`):
  `/tmp/claude-0/-home-user-typewriter/f8518805-a6b0-5ba3-88f6-f2782e19df73/scratchpad/` subfolders `dw-docs/` (PDFs),
  `dw-photos/`, `dw-render/`, `dl5218/pics/`, `ref/hi-18.png` (brochure product page at 220 dpi).
- Facts: `docs/displaywriter/hardware.md` and `printer.md` (sizes, controls and their positions, colours).

## Review
Every unit is compared with its reference photographs before it is called done: render it from the photograph's
viewpoint (Cycles on the CPU in the bpy module, small samples) and place the two side by side, then fix proportions
and details until they match. Keep the comparison images; the final reply names them.

## Display station
The electronics module (`build_wp_station.py`, `wp_station.glb`) and the 25-line display (`build_wp_display.py`,
`wp_display.glb`), loaded by `src/render/wp/station-view.js` (`buildStation`, `buildDisplay`, async). Shared
helpers for the word processor's builders are in `tools/blender/wp_mould.py`; `tools/blender/render_wp_review.py`
makes the review renders (`-- VIEW ... [--tilt DEG] [--swivel DEG] [--off]`).

Module, 483 x 356 x 178 mm:
- Two mouldings meeting at a parting line 95 mm above the desk (BRO p.1 and p.18, where the base shows as a band
  below the cover): a Pearl White top cover with a 26 mm bullnose along its front edge and a Pebble Gray base set in
  1.2 mm, on four rubber feet 6 mm high. Pebble Gray is a light grey (PH inside.JPG shows the bare base), so
  `createUnitMaterials().pebble` is now 0xb3b0a7.
- On top, the turntable (PSM p.46, ST p.28): a 257 mm dish 3 mm deep with a sloped wall and a 130 mm well 9 mm
  deeper with the interlock keyhole, centred where the display stands (`units.display.at`).
- The power switch is the part photographed on the power supply (PH inside.JPG): a red rocker paddle in a black
  housing, seen through a scoop cut into the bullnose at the front left (centre x = -157 mm, 66 mm wide, CSG p.37 and
  p.40, ST p.28, BRO p.1). It rocks left and right about an axle running front to back: the CSG p.40 close-up and
  front view draw the paddle as a wedge across the scoop with the I side on the right. It is a thick block with a
  flat top and chamfered ends, as photographed, and the whole paddle rocks 0.16 rad either way; the I bar and O ring
  are moulded on. `parts.setRocker(on)` sets `rocker.rotation.z` (on: -0.16, the right side down).
  The old primitive put a grey slab at the front right.
- A recessed vent panel on each side of both mouldings (CSG p.23 and p.37 draw the four panels), with vertical
  slots in their rear two thirds (PSM p.46). A dark box inside shows through the slots and the keyhole.
- The square badge at the front right (BRO p.18; CSG p.37 and p.40) is a plain dark plate: nothing on it is legible
  in any source (hardware.md open question 12).
- At the back, panel 1 (+x, left as seen from behind) and panel 2, positions from CSG p.27 and the sockets measured
  on PH Displaywriter_back.JPG (a DE-9 flange as the scale): LEDs A-H, D-subs 0, 1, 2, 5, 7, the Memory Record
  button 3, covers 4, 6A, 6B; on panel 2 the AC outlet 8, inlet 9, fuse, 10 and 11. The display cable runs from its
  plug on socket 2 over the rear edge to the display's underside (CSG p.23, p.27). A groove under the base carries
  the keyboard cable to the back (CSG p.27).

Display, 381 x 348 x 292 mm with the foot:
- Front elevation measured on PSM p.7 (0.90 mm a pixel at 200 dpi), which agrees with the documented width and
  with ST p.28's 245 x 170 mm visible screen: the frame's outline (top corners 16 mm, bottom 26 mm), the bezel panel
  (x -157..160 mm), the tube opening (244 x 170 mm, centre 25 mm left of the cabinet's centre), the groove at
  x = 111 mm, the strip with the badge (y = 224 mm) and the contrast (124 mm) and brightness (96 mm) knobs.
- The bezel panel sits 32 mm back in the frame, a hood: BRO p.18 shows the frame's inner walls and its lower lip
  from above. The panel (`wp_bezel`, a view material) is a charcoal grey: BRO p.18 shows it clearly darker than the
  module's Pebble Gray base, though lighter than the tube.
- The cabinet behind the frame keeps the outline and rounds its rear edges with 40 mm radii (ST p.28 fig. 1,
  CSG p.23). The badge's artwork (the initials in striped letters) and the small label under it (CSG p.40) are
  drawn on canvases in the view (architecture.md 13.2 lifted the no-marks rule); the GLB gives their faces uv 0..1.
- Knobs: 17.6 mm, knurled, the contrast and brightness symbols moulded on their faces as CSG p.40 draws them; each
  is its own node turning about z on its shaft.
- Foot (ST p.28 fig. 2, CSG p.23): a 196 mm turntable disc in the module's dish, an oval swivel plate on it with a
  pocket either side and the interlock tab at the front, and a cradle under the cabinet resting in the plate's seat.
  Nodes: `display_swivel` (y, origin), under it `display_tilt` (x, at the cradle's axis, 93 mm up and 35 mm behind
  the turntable centre). The documented 20 degree tilt needs room under the rear, so the underside rises at 20
  degrees behind the cradle and lies level when tilted fully back (inferred; no source shows the underside's
  profile). The builder exits 1 if the cabinet comes within 1.5 mm of the plate anywhere in the tilt range.
  `parts.setTilt(rad)` (0 to 20 degrees, positive leans back) and `parts.setSwivel(rad)` clamp to the definition.
- `face` is in the tilt node's frame, carried in the GLB as the tilt node's extras (`userData.face`), with
  `parent`: the kit puts the glass and the screen's spill light in that node, so they tilt and turn with it. The
  glass is `makeTubeFace(0.252, 0.178, 0.6)`, a little larger than the opening, its corners 3.5 mm plus its sag
  behind the bezel so the edge stays hidden behind the opening's stepped surround; a dark mask behind the panel
  hides the gap at the corners.

Size: `tools/blender/quantize_glb.py` (run by `wp_mould.export`) stores positions as 16-bit integers in 0.05 mm steps
and normals as 8 bits (KHR_mesh_quantization, read natively by GLTFLoader and Blender); the dequantizing scale is on
a child node, so named nodes keep their transforms. UVs stay float. Small parts get one UV and smooth shading
(`finish_small`) so the export splits fewer vertices; the shells' unseen inner surfaces use chords for arcs.
`wp_station.glb` is 375 KB and `wp_display.glb` 211 KB: 0.59 MB of the 1.1 MB for five units, more than a fair
share. The rear panels' sockets (about 4000 vertices) are the first place to cut if the budget needs it.

Not yet: the white numbering and the part number printed on the rear panels, and the LED letters; the cable
clips under the display that ST p.28 draws at its lower front corners; the display cable is in the module's GLB and
does not follow the display when it turns.
