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

## Printer
`tools/blender/build_wp_printer.py` -> `public/assets/models/wp_printer.glb`, viewed by `src/render/wp/printer-view.js`.
Dimensions shared with the mechanism and the soft bodies (platen, print point, wheel, ribbon spools, carrier travel, the
slot, the hinge, the feeder's plate) come from `tools/blender/wp_printer.json`, written by
`node tools/wp/export_printer.mjs` from the definition. Review images: `render_wp_printer.py` (Cycles) and
`compare_wp_printer.py <photo dir>`, both writing to `tools/blender/previews/` (`compare_front`, `_open`, `_rear`,
`_feeder`, `_plain`, `_carrier`), with browser screenshots of the printer printing and opened beside them
(`browser_three`, `_top`, `_carrier`, `_feeder`, `_panel`).

Measurements and decisions:
- **Size 0.73 x 0.188 x 0.645 m** (was the 0.74 x 0.23 x 0.58 estimate). Scale: the acoustic filter across the slot spans
  0.55 of the cabinet's width in PH 5218_2 and 0.52 in 5218_1 (corrected for distance), and it must pass 392 mm paper,
  so the width is 0.72 to 0.77; 0.73. The front face is 0.245 of the width (5218_1, the brochure's p.18, both
  near-level views), the base band 0.22 of that. Depth from MIM p.20's plan: the bottom cover is 0.886 of its width.
  The access cover stands 18 mm proud of the cabinet's top with a 24 mm lip down the front face (5218_1), so the
  height is to the cover.
- **Platen centre (y 0.132, z +0.064), length 0.52 m** (was y 0.150, z -0.060, 0.415). The platen lies under the
  access cover's rear edge, 40 % of the depth from the front (MIM p.20: 0.355 including the panel; 5218_2), and its
  rubber is 0.71 of the width (MIM p.20), which is also what a slot for 392 mm paper needs. The axle is 18 mm lower than
  first drawn so the bail at its open stop clears the cabinet's top beyond the slot. Radius unchanged (belt ratio).
  Everything derived (print point, wheel, ribbon, paper table, camera) follows from the definition.
- **Cabinet**: base band inset 22 mm at the sides; top cover with the access opening (a trapezoid, 0.48 m wide at the
  lip, 0.44 at the hinge), the paper slot behind it, the hood whose sloped front is the perforated acoustic filter with
  the left paper guide and its triangle on the top edge (SET p.1-7), two paper-handler latch openings beside the hinge
  and two at the rear corners (5218_2), the operator panel in a tan bezel with a tan strip under it, the power rocker in
  its tan bezel at the front right, the finger scoop under the lip, the attachment panel recess at the left rear with
  the round handler socket, the DE-9 and the IEC inlet (5218_3), and the fan grille on the right side near the rear
  (SET p.3-2; the fan is at the right rear, MIM p.17).
- **Access cover** (`printer_cover`) hinges on its rear top edge: a pivot lower down swings the cover's rear corners into
  the slot's cheeks. Its rear is a recessed well holding the tinted window over the print line; the underside is lined
  with acoustic foam (5218_2 shows both on the raised cover). Its open stop is 100 degrees (was 75): past upright, so
  gravity holds it on the stop and the mechanism stays in view (the 5218 cover is lifted until it rests, SET p.1-3; with
  the feeder fitted it cannot lie back on the top). At the stop it still clears the feeder.
- **Panel** from 5218_1: 2 rows of 5 LEDs (bit order of the controller; Power On red, On Line and Ready green, the rest
  amber), the two-digit window, keys of 19.5 mm in two pairs of columns (Start green, Stop yellow, the rest blue), the
  divider and the blank right section. Legends, the key captions and the seven-segment digits are drawn at run time
  (`printer-view.js`), so the model carries no lettering.
- **Mechanism**: side frames, base plate, the two carrier shafts and the leadscrew (its three-start thread is a texture
  on u = x / lead, turned by the carrier's travel), the escapement motor and coupler at the right, the index motor and
  timing belt to the platen pulley at the left, the paper-handling cam outside the right frame, the paper pan, six feed
  roller modules (front and rear rollers at the definition's feed-roll angles), the bail with four rollers on the
  definition's bail angle (its pivot 15 mm back along the tangent so opening lifts the rollers straight off), and the
  carrier's flat cable folded at the front. No platen knob: the 5218 has none (PR 2).
- **Carrier** (`printer_carrier`): casting on the shafts and screw, the selection motor (axis front to back) in two
  saddles, the hammer coil above it with its nose cone, the ribbon plate with six belt rollers, the belt and the
  ribbon advance knob (MIM p.94-95), the ribbon cartridge (two lobes at the definition's spool positions, which are now
  in the printer block: x 0.066, 16 mm below the print line, 64 mm in front of the platen axis, so a full 70 mm supply
  spool fits), its guide posts at the definition's guide-post positions, the printwheel cartridge (a green shell round
  the wheel's lower half), and the clear cardholder round the print point (0.8 mm off the platen, MIM p.57).
- **Printwheel** (`printer_wheel`): 96 spokes and slugs, petal k k steps clockwise of the top (seen from the front), so
  the snapshot's wheel angle brings the right petal under the hammer. Each slug's platen face is mapped to cell k of a
  12 x 8 atlas that the view draws from the glyph faces that print (`glyphs_wp`), character up = outward.
- **Sheet feeder** (`printer_feeder`) after the brochure's p.18 and SET p.2-2 to 3-14: a tall front with the stacker
  opening, a flat top and a lower rear box with two trays whose handle ends stand 75 mm past the printer's back (the
  printer moved 4 cm forward, `ROW_BACK` -0.44, so they stay on the desk). Its stacker plate is the paper table of the
  soft body (`printer-soft.js`): the sheet the feeder delivers is laid on it from under the exit rollers and fingers and
  slides down into the slot, and a printed sheet leans back on it. The front leans back 0.30 so the opened cover clears
  it. Its middle stands on the hood at the cover's height, its sides on the cabinet's top with latches in the
  openings. The upper tray shows its paper.
- **Soft body** (`printer-soft.js`): the table runs to the top of the feeder's opening; the resting surfaces are the
  cover, the well round the platen, the stacker plate and the feeder's top, as a height field.
- **Budget**: 24 k triangles; the export is rewritten with `KHR_mesh_quantization` (`gltf_quantize.py`: positions as
  shorts under a uniform node scale that keeps each pivot, normals as bytes), which three.js reads with no decoder.
  The GLB is about 640 KB, more than half of the 1.1 MB budget for all five units: the printer carries the most
  mechanism, and the feeder. Open: the other four units must come in near 460 KB together, or the budget is revised.
- **Clearance**: the build exits 1 if the carrier, wheel or hammer at either stop touches the covers, filter, frame,
  feeder, platen or bail, if the cover touches the top, filter or feeder anywhere from closed to its stop, or if the
  bail touches the top, the cover or the platen.
