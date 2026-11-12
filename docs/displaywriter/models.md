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

## Diskette unit
`tools/blender/build_wp_diskette.py` -> `public/assets/models/wp_diskette.glb` (the unit, one diskette, one
envelope and the desk file); view `src/render/wp/diskette-view.js`; posed and clicked by `src/kits/wp/diskettes.js`.
Previews: `tools/blender/render_wp_diskette.py` renders the photographs' viewpoints, `compare_wp_diskette.py REFDIR`
puts each beside its reference (`tools/blender/previews/wp_diskette_cmp_*.png`).

- **Cabinet.** 254 x 292 x 398 mm (HW 3.1). Covers 3 mm thick with 19 mm radii on the vertical and top edges (GIM
  p.25, PSM p.61). The front cover is the front face and its rounded return, 34 mm deep, with a 0.8 mm gap to the top
  cover, which is top, sides and back (front slides forward, top slides back, PSM p.61). The covers stop 16 mm above
  the desk; below them a Pebble Gray base inset 8 mm on rubber feet, the dark band of BRO p.18.
- **Slots.** Two, 90 mm apart about the centre (BRO p.18: 119 px at 1.32 px/mm), 9 mm wide, from 36 to 250 mm above the
  desk. The photographs give 180 to 217 mm of slot; an 8-inch diskette needs 203.2, so the slot is 214 mm, as ORG p.54
  (22 mm above the covers' lower edge, 37 mm under their top). Behind each, a dark drive front with a 3.5 mm guide and a
  channel closed 12 mm beyond home, so the slot never shows the inside. The diskette's centre is 143 mm up.
- **Levers.** Rest pose open, pointing up; the kit sets `rotation.z = -lever`, so 90 degrees closed lies across the
  slot. The axle is 20 mm left of the slot at 82 mm (ST p.90: the shaft comes from the drive's left frame, the handle at
  its foot when open, ST p.103). Hub 30 x 28 mm and arm 24 mm wide, 66 mm overall, with a grip rib standing 9 mm out:
  closed, the L of ORG p.54 and the dark block of BRO p.18 (57 x 28 mm); open, it stands beside the slot and clears
  it by 3.5 mm. It turns in front of the face; a dark pocket 74 x 40 mm round the closed position takes its hub (GIM
  p.25). The "1/2D" mark (HW 3.3) is a plate low on the hub, the light window of BRO p.18, drawn at run time.
- **Badge.** 24 x 28 mm, top left, its top level with the slots' (ORG p.54); a satin plate with IBM's striped logo
  and "6360" drawn at run time (BRO p.1 shows a light badge with dark letters; GIM p.25's earlier unit has a dark one).
- **Top and rear.** A 1.2 mm recess runs over the rear top edge and down the back (CSG p.42, PSM p.61; that it is a
  grip is inferred). The connector panel sits in a notch at the bottom of the back, right of centre seen from behind,
  with three sockets for the AC, DC and signal cables (HW 3.1, PSM p.61); two cover screws at the lower corners. The
  cables themselves are not modelled yet.
- **Diskette.** Built in a card frame (x along the label, y toward the label edge, z out of the label face): 203.2 mm
  square, 1.6 mm jacket, 38.1 mm hub hole, index hole, 12.7 mm head window from 32.5 to 91.5 mm below the centre,
  write-protect notch on the head-window edge, the brown media showing through. In a slot the head window leads and
  the label faces the lever (HW 3.3), so card x -> -y, y -> +z, z -> -x. The label strip along the top edge is a
  transparent canvas per diskette: IBM's grey "1" or terra cotta "2D" label (HW 3.6) and the operator's label with the
  name in ink, typed on the program diskette.
- **Envelope and file.** Each diskette has a paper envelope (ST p.90, MD p.1), open at the top with a thumb cut, its
  printed front (handling notes, an index box with the name) drawn at run time; the diskette stands 27 mm proud of it,
  so the name on its label shows. The envelopes stand in a desk file (six places, 16.5 mm apart, leaning back 5
  degrees against a rib, on a floor that steps up 7 mm a place toward the back so each label edge shows over the one
  in front): a dark moulded tray 236 x 124 mm, 150 mm at the back and 58 at the front, with a thumb scoop, at
  `deskLayout.disketteHolder`. Each diskette keeps its place; its envelope stays there while it is in a drive. The file
  and its envelopes and diskettes are our own design in the period manner: no photograph shows how Displaywriter
  offices kept them.
- **Picking.** The covers stop the pointer. A diskette at home lies wholly inside the slot (its trailing edge 8 mm in),
  so the hand reaches it through the slot and pocket: clicking there takes it out when the lever is open.
- **Clearance.** The builder exits 1 if a diskette's whole path from the mouth to home, or a lever's sweep from open to
  closed, touches a panel.
- **Budget.** 264 KB, over a fifth of the 1.1 MB for five units, because it also carries the diskette, envelope and
  file; the drives and levers are one mesh each, placed twice.

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
