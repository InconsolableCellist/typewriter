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
