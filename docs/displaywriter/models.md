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

## Keyboard
`tools/blender/build_wp_keyboard.py` (case) and `src/render/wp/keyboard-view.js` (caps, legends), sharing the layout
in `src/render/wp/keyboard-layout.js` through `tools/gen/export_wp_keyboard.mjs` -> `tools/blender/wp_keyboard.json`.
Review renders: `tools/blender/render_wp_keyboard.py` (views kbd2, brochure, plan, csg, side), from a GLB of the live
unit exported in the browser, since the caps and their atlas exist only at run time.

- **Case.** The top runs at the documented 12 degrees and reaches the documented 101 mm at the rear edge, so the back
  is the high side and the cap tops lean up toward the typist. The brochure (p.18) puts the key field in the middle of
  the top with borders of about the same depth front and back; its front band reads as a rounded nose over a face
  that leans back, which the setup guide's drawings (CSG p.18, p.22) also show, so the front is a 16 mm nose over a
  face set back 13 mm at the base. Ends are flat, plan corners 12 mm. One opening per group (left, main with INDEX,
  right upper, right lower): the brochure shows cover between them, and the left and right-upper openings rise a row
  above the number row. The well round each opening is a dark wall down to the dark key plate (the contamination
  shield of KBD_2.JPG), so the cover's hollow never shows. A pebble-grey base tray shows as a band above four rubber
  feet. The cable leaves the rear at the left, where the logic card's connector is (KBD_3.JPG), through a strain-relief
  bush, and runs back over the desk toward the electronics module (it passes under the module in its groove, HW 2.1).
  The covers carry the `wp_pebble` grain (normal and roughness from `createUnitMaterials`; colour stays the
  material's). 182 KB, about 5.5 k triangles; no images.
- **Layout.** KBD_2.JPG is the authority where the drawings are schematic: BKSP 1.75 u; RETURN 1.25 u over a 1 u leg
  (legend RET); right SHIFT 2.5 u; CODE 2 u starting under Z-X; space bar 5.5 u; ENTER 1.25 u; INDEX a narrow 0.8 u
  cap standing a little apart; the right groups 0.4 u past it. The main block is then 14.75 u wide and the field 22.65
  u, which matches the brochure's proportions. KeyboardMech treats RETURN as a wide key by its `tall` mark.
- **Caps.** Built per key from the table: a straight tapered skirt (2.5 mm each side), a rolled shoulder, a crown with
  a 1 mm cylindrical dish across the width, corner radii 0.9 mm at the base and 2.1 mm at the crown. Row profile (top
  height, extra lean toward the typist): rows 0-1 12.8 mm, 9 degrees; tab 12.1, 5; home 11.6, 0; shift 11.8, -4;
  space row 10.6, -7; ENTER 3 mm lower than the space bar (ST p.62). The caps stand 8.5 mm into their wells, tops a
  few millimetres proud of the cover, as in the brochure. Each cap is one mesh in the tilted `deck` group, its rest at
  the base centre, and moves along the deck's own down (`pressDir`), so keys travel along their stems.
- **Legends.** One canvas atlas drawn at run time from `wp-keys.js` at 12 px/mm: each cap gets a top region (u, v over
  the crown's box) and, if it has one, a front region on the front skirt just under the top edge, mapped in true
  millimetres; sides and backs map to a blank texel. Letters alone 5 mm caps in a Helvetica-like face; shifted over
  unshifted characters 3.3 over 3.7 mm; words in 1.9 mm bold capitals, shrunk to fit narrow caps (INDEX); front
  legends 1.6 mm bold. Arrows, the boundary arrows of the cursor keys and the hollow arrows of ½⇧ / ½⇩ are drawn as
  paths, as the photograph shows them. Cap colour #dcd8c8 and near-black ink from KBD_2.JPG; the caps' matte finish
  (GIM p.104) with the `wp_keycap` grain on a second uv set.
- **Not yet matched.** The case's side profile has no photograph: it is inferred from the brochure's front view and
  the setup guide's line drawings. The face of the legends is a Helvetica stand-in for IBM's; the 92-character and
  Dvorak variants are not modelled; the space bar's stabiliser and the key modules under the caps are not modelled
  (hidden by the cover).
