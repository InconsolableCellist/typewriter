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
- The owner's photographs in `docs/displaywriter/refs/owner/` (PH with the file name: display, module, keyboard,
  printer and diskette unit; listed per unit below), and the Incident Reporting Guide for the 6580 (`Z241-6252-3`).
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
Review: `tools/blender/render_wp_diskette.py -- VIEW ... [--glb PATH --tag NAME]` renders the references' viewpoints
(front, sp, desk, deskfront, levers for the owner's photographs; bro18, gim25, rear, lever, file for the documents) and
`compare_wp_diskette.py REFDIR [--before NAME]` puts each beside its reference, with an earlier build between them
(`tools/blender/previews/wp_diskette_cmp_*.png`).

References for this unit, besides those above:
- The owner's photographs (PH below): `diskette_front.jpg` (the unit head-on, left handle closed, right one open),
  `desk_station_keyboard_diskette.jpg` (the unit close up at the left: the handle in depth, the slot's lip, the lock
  mark), `desk_front_scott_peterson.jpg` (beside the display station). diskette_front.jpg is stretched sideways: its
  face is 226 px wide and 238 px tall where 254 x 292 mm and the undistorted Scott Peterson photograph (H/W 1.14) want
  it 1.09 times narrower, so widths and horizontal ratios are read from it and heights from the other two; the
  comparison narrows it back.
- The Incident Reporting Guide for the 6360 (`Z241-6253-2`, Feb 1983, bitsavers `pdf/ibm/6580_Displaywriter/`), IRG
  p.1: the covers exploded (the front cover with its cross pockets, the slot liners, the top cover with a row of vents
  across the rear of its top); p.4-5, the drive with its handle (FRU 18). Its parts list has no switch.

- **Cabinet.** 254 x 292 x 398 mm (HW 3.1); the Scott Peterson photograph gives 1.14 for height over width, as the
  documented sizes do. Covers 3 mm thick with 21 mm radii on the vertical and top edges (IRG p.1, PH desk_station_
  keyboard_diskette). The front cover is the face and its rounded return, 34 mm deep (GIM p.25, IRG p.1); the top cover
  is top, sides and back. The front cover stands 2.5 mm lower than the top cover, whose front edge reaches 3 mm forward
  over it with a 0.8 mm gap: the slight overhang and the shadowed line across the top in PH diskette_front. The covers
  stop 10 mm above the desk. Under them is a Pebble Gray base plate on rubber feet, inset 20 mm at the sides and 8 mm
  front and back, in shadow (PH diskette_front shows a dark band, the Scott Peterson photograph a narrow light strip).
- **Slots.** Two, 90 mm apart about the centre (PH diskette_front: 80 px on the 226 px face; BRO p.18), 9.4 mm wide in
  the cover, from 27 to 236 mm above the desk (PH: 26-233 and 26-237 mm; the diskette needs 203.2). A dark liner stands
  in each slot from the drive front to 0.7 mm under the face, its lip leaving a 7.6 mm mouth, so the slot is black to
  its edge with a dark inner lip (IRG p.1's strip; PH desk_station_keyboard_diskette). Behind it are the guide (3.5 mm)
  and a channel closed 12 mm beyond home. The diskette's centre is 131.5 mm up. The old slot (36 to 250 mm) was 10 to
  14 mm too high.
- **Pocket.** Each slot passes through a cross pocket a third of the way up: 52 x 33 mm about the slot, 66.5 to 99.5
  mm up (PH diskette_front and Scott Peterson). Its pearl walls run 9 mm in to the dark drive front, which is its
  floor (IRG p.1 draws the walls double; PH diskette_front shows them at the lower and right edges). On the floor right
  of the slot, 9 to 21 mm out, is the lock mark (`wp_diskette_drive*_lock`, material `wp_drive_label`): an arrow up and
  a framed padlock, with the drive type small beside them, drawn at run time (`lockTexture`). The old pocket was a dark
  74 x 40 mm patch round the closed lever, and too high.
- **Handles.** ST p.90's operator handle, as PH diskette_front shows it open on the right drive and closed on the
  left. It is a dark plate 24 x 47 mm standing up beside the slot (35.5 to 11.5 mm left of it, 75 to 122 mm up), 1 mm in
  front of the face and 3 mm thick. A fin 3 mm thick runs along its middle, standing 12.5 mm out of it, and its foot
  reaches 8 mm below the plate (the thin light line in the front photograph; the block and the dangling foot in
  desk_station_keyboard_diskette). A boss runs through the pocket to the axle, which ends in a ring on the plate (the
  "O" on the closed handle). The axle is 19.5 mm left of the slot and 79 mm up: the point about which a quarter turn
  clockwise lays the plate over the pocket, across the slot (CSG p.42), as on the left drive. The drive mark "1/2D"
  (ST p.90) is printed on the plate beside the fin, reading across the slot when closed (`wp_diskette_lever*_label`,
  `leverTexture`). The old handle (a 30 x 28 hub and an arm, 66 mm, with a grip rib) is gone.
- **Badge.** 25 x 26 mm, 19 mm in from the left edge, 219 to 245 mm up, centred on the slots' tops (both photographs).
  It is a light grey satin plate with IBM's striped initials across its upper part and "6360" small at the lower left,
  drawn at run time (`badgeTexture`).
- **Top and rear.** A row of 25 vent slots, 3 x 16 mm at 7.5 mm pitch, runs across the top 23 mm in from the rear
  edge, with a dark tray under them (IRG p.1). It replaces the 1.2 mm recess over the rear top edge, which had been
  inferred as a grip from CSG p.42 and PSM p.61. The connector panel sits in a notch at the bottom of the back, right
  of centre seen from behind, with three sockets for the AC, DC and signal cables (HW 3.1, PSM p.61); two cover screws
  sit at the lower corners. The cables (three, 1 m, out of the back, PH diskette_front) are not modelled.
- **Power.** The 6360 has no power switch of its own. Service Theory (`S241-6247-2`): the diskette unit "is
  controlled by, and receives its power from, the electronics module" (introduction); its AC is switched AC from panel
  2 of the module's power supply, and "when the system power is on, the AC drive motor(s) and the fan run
  continuously" (diskette unit, power); the module's switch "controls all AC and DC voltage distribution" (power
  supply, printed p.72). No switch appears in the IRG's parts list, its covers' drawing or the photographs. The
  station's rocker (`station_rocker`) powers the unit.
- **Controls** (nodes for the kit; JSON in glTF extras, three.js `userData.control`, in the unit's frame):
  - `wp_diskette_lever0` and `1`: origin on the axle at the face (x = -64.5 and +25.5 mm, y = 79 mm, z = +199 mm). The
    rest pose is open; each turns about its own z from 0 (open) to -pi/2 (closed), which is the kit's
    `rotation.z = -lever` with `machine.diskettes.lever.closed` = 90 degrees.
  - `wp_diskette_slot0` and `1`: at each mouth's centre (x = -45 and +45 mm, y = 131.5 mm, z = +199 mm). The diskette
    runs along -z, its leading edge 211.2 mm in when home. Its centre is then at the child `wp_diskette_slot*_home`
    (z = -109.6 mm from the mouth).
  - The view returns them as `parts.levers`, `parts.leverRange` and `parts.slotPaths` ({ mouth, axis, home,
    homeDepth }).
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
  closed, touches a panel (covers, base, vent tray, drive fronts).
- **Budget.** 270 KB (was 264), unquantized, since the view sets materials on the named meshes themselves. The slots,
  pockets and vents are cut after the bevel, square-edged as the photographs show them, to keep it there. About 6.7 k
  vertices; the drives and handles are one mesh each, placed twice.

Comparison images (`tools/blender/previews/`, not committed): `wp_diskette_cmp_front.png`, `_sp`, `_desk`, `_levers`
and `_deskfront`. Each reads photograph, before (`wp_diskette_<view>_before.png`, the previous GLB from the same
camera), after. The renders alone are `wp_diskette_<view>.png` (also `rear`, `lever`, `file`).

Not yet:
- The closed handle's fin and foot lie across the pocket and stick out 8 mm left of it. The owner's left drive does
  not show this (its handle may differ or be missing), and the Scott Peterson photograph shows a small tab at the
  closed handle's right end instead.
- The handle's depth is judged from one oblique photograph.
- The cameras were placed by eye, so the pairs agree in proportion rather than pixel for pixel.
- No photograph shows the back or the top of the owner's unit, so the vents follow IRG p.1 alone.
- The cables are not modelled.

## Display station
The electronics module (`build_wp_station.py`, `wp_station.glb`) and the 25-line display (`build_wp_display.py`,
`wp_display.glb`), loaded by `src/render/wp/station-view.js` (`buildStation`, `buildDisplay`, async). Shared
helpers for the word processor's builders are in `tools/blender/wp_mould.py` (now with `loft`, a solid between two
outlines, for drafted walls). Review: `tools/blender/render_wp_review.py -- VIEW ... [--tilt DEG] [--swivel DEG]
[--off] [--nodisplay]` renders the references' viewpoints and `compare_wp_station.py REFDIR` puts each beside its
reference (`tools/blender/previews/wp_station_cmp_*.png`; REFDIR holds the owner's photographs and the rendered pages
`bro18-000.jpg` and `st-028.png`).

References for this unit, besides those above:
- The owner's photographs, `docs/displaywriter/refs/owner/` (PH below): `display_front_close.jpg` (the display
  head-on), `display_three_quarter.jpg`, `desk_station_keyboard_diskette.jpg` (the station on a desk, switched on;
  the best view of the switch and the pedestal), `desk_front_scott_peterson.jpg` (the whole desk from the front, for
  the display against the module), `module_three_quarter.jpg`, and seven of the module alone: `module_front_power_switch`,
  `module_side_vents_left_switch`, `module_side_vents_right`, `module_rear_panel`, `module_rear_led_column` and
  `_lit`, `module_bottom_or_display_base` (`.webp`).
- Bitsavers `pdf/ibm/6580_Displaywriter/`: the Incident Reporting Guide for the 6580 display station
  (`Z241-6252-3`, Feb 1983): p.8, a drawing of the 25-line display that shows the vent band across its top and the
  rear's slope, and p.12, the power supply with its rocker switch at the front corner; the brochure's photographs
  extracted at full resolution (`pdfimages`, `G552-0323-1` p.1 and p.18); PH `main_assy/inside.JPG` cropped to the
  switch; also read without new figures for this unit: `G320-0158-0`, `S241-6248-3`, `G544-0851-3`, the training
  books `S544-2229-0`, `S544-2263-0`, `S544-2275-0` and the platform accessory announcement.
- Tried and not reachable from the build machine: the Computer History Museum's catalogue entries (102685352,
  102665264: no images served), Wikimedia Commons (rate-limited), the Home Computer Museum, the Smithsonian, The
  Henry Ford, muzeuldecalculatoare.ro and the VCFed forum (blocked).

Module, 483 x 356 x 178 mm:
- Shells (PH module_front_power_switch, module_side_vents_*, module_rear_panel): a one-piece Pearl White top cover
  whose front edge rolls over with a 36 mm radius (the rear top edge 30 mm), sitting on a base tray of the same
  colour (the photographs show no darker base; `wp_gray` is no longer used here). The parting line is 68 mm up,
  about 0.38 of the height: the side photographs give 0.33 to 0.45, the rear 0.36, and the slot bands' heights agree.
  Four rubber feet 6 mm high; the keyboard cable's groove underneath (CSG p.27).
- Turntable: a rounded-square dish 274 mm across with 88 mm corners, 5.5 mm deep with a drafted wall, centred where the
  display stands (`units.display.at`); in it a round boss 140 mm across, its top just under the cover's with a
  narrow rim, the keyhole running front to back (8 mm wide, 60 mm long, a notch on its left), two small tabs at its
  ends and a pin hole at the rear right (PH module_front_power_switch, mfront; PSM p.46). The old 130 mm well is gone.
- Power switch (the owner's "chonky" note): a small red-orange rocker of the usual kind, 34 x 15 mm, in a slot in the
  floor of a shallow well 66 x 36 mm with 10 mm corners and drafted walls, 9 mm deep, cut into the front left of the
  top where it rolls over the front, so its front wall is lower than its back (PH module_front_power_switch,
  desk_station_keyboard_diskette; CSG p.40); centre x = -157 mm. The paddle's top is two flats meeting over the axle,
  each rising 0.16 rad toward its end, so the pressed half lies level and the other end stands about 6 mm proud of
  the floor, as both photographs show; most of the paddle is below the floor in the switch's dark body, and only a
  dark gap shows round it. O is a ring on the left half, I a bar on the right. `parts.setRocker(on)` sets
  `rocker.rotation.z` (on: -0.16, the I end down). The small "1" written beside the well on the owner's unit is not
  modelled.
- Vents (PH module_side_vents_left_switch, _right): vertical slots straight through both side walls, no recessed
  panel, in two bands split by the parting line: on the cover from 66 mm in from the rear to 49 mm short of the
  front, 84 to 148 mm up; on the base from 75 mm in from the rear to 73 mm short of the front, 16 to 60 mm up.
  2.4 mm wide at 6 mm pitch (the photographs show a little closer, about 5.5 mm: the pitch was opened to keep the
  budget). A dark box inside shows through them.
- Badge: a black plate 38 x 28 mm at the front right, just above the parting line (centre x = 196 mm), with IBM's
  striped initials in silver and "Displaywriter System" drawn by the view (`moduleBadgeTexture`).
- Rear (PH module_rear_panel, module_rear_led_column): panel 1 (x 24 to 214 mm, 18 to 136 mm up) and panel 2 (x -159
  to -3 mm, 13 to 108 mm up) are set into recesses that cross the parting line; their sockets keep the layout
  measured on PH Displaywriter_back.JPG, scaled to the panels' measured size. The LED column is 14 mm in from panel
  1's edge: eight LEDs at 6.6 mm pitch behind a smoked window, the letters A-H and the machine type printed beside
  it (`legendTexture`). The label plate (47 x 44 mm) stands beside panel 2. The display cable runs from socket 2 over
  the rear edge to the display's underside (CSG p.23, p.27).
- Nodes for the controls: `station_rocker` (origin on its axle, which runs front to back) and `station_led_a` to
  `station_led_h` (each at its LED's centre). The view returns `parts.leds` (A to H, each with its own material) and
  `parts.setLed(i, on)` (i is 0-7 or the letter): G lights while the station runs (module_rear_led_column_lit); no
  code drives them yet.

Display, 381 x 348 x 292 mm with the foot:
- Front (PSM p.7 for the layout; PH display_front_close, display_three_quarter and the two desk photographs for the
  form): the frame's outline as before (top corners 16 mm, bottom 26 mm), its opening (x -157..160 mm, y 54..257 mm:
  equal borders top and bottom, desk_front_scott_peterson) filled by the bezel moulding. The bezel is a warm mid
  grey, about two thirds as light as the frame (sampled from display_front_close; the old charcoal was wrong). It
  has a 2.5 mm rim nearly flush with the frame's face, a recess 26 mm deep, and on its floor a 2.5 mm step 13 mm
  round the tube's opening and a sloped reveal 11 mm down to the opening (244 x 170 mm, 15 mm corners, centre
  x = -25 mm, y = 156 mm). On the right the control strip is a separate panel standing 6 mm proud of the floor, from
  x = 113 mm to the rim.
- Badge: a 19 mm square silver plate high on the strip (y = 229 mm), the striped initials in its upper half
  (`badgeTexture`). The printed label that CSG p.40 draws under it is not on the photographed displays and is gone.
- Knobs: 20 mm, knurled, 12 mm deep, at y = 135 mm (contrast) and 107.5 mm (brightness), where both photographs put
  them (PSM p.7's drawing has them about 12 mm lower); contrast's face is a disc half light, half dark, brightness's a
  sun. Each is its own node turning about z on its shaft, its origin at the strip's face.
- Cabinet: as before, plus a band of 41 slots across the top just behind the frame (Z241 p.8), with a dark baffle
  under them. The cabinet is 268 mm tall (BOT = 21 mm), which desk_front_scott_peterson gives (272 mm).
- Foot (PH desk_*: a large light pedestal shows under the display): a Pearl White disc 224 mm across standing 12 mm
  above the cover, its underside on the dish's floor and hollowed over the boss; the dark oval swivel plate on it
  (12 to 19 mm); the cradle under the cabinet resting in the plate's seat (radius from the pivot to the plate's
  top). The tab that keyed the plate into the old well is gone. Nodes and contract unchanged: `display_swivel` (y,
  origin), under it `display_tilt` (x, at the cradle's axis, 93 mm up and 35 mm behind the turntable centre);
  `parts.setTilt(rad)` (0 to 20 degrees, positive leans back) and `parts.setSwivel(rad)` clamp to the definition. The
  builder exits 1 if the cabinet comes within 1.5 mm of the plate anywhere in the tilt range.
- `face` is in the tilt node's frame, carried in the GLB as the tilt node's extras (`userData.face`), with `parent`.
  The glass is `makeTubeFace(0.252, 0.178, 0.6)`; its corners sit 2 mm behind the opening's edge, so its centre stands
  4 mm ahead of it, in the reveal; the dark mask behind the panel hides the gap at the corners.

Comparison images (`tools/blender/previews/`, gitignored): `wp_station_cmp_mfront_m_off.png`, `_mleft_m_off`,
`_mright_m_off`, `_mrear_m_off`, `_mleds_m`, `_switch_m_off` (module alone, against the owner's module photographs),
`_dfront`, `_desk`, `_deskfront` (the station, against the display and desk photographs), `_st28side`; the renders
alone are `wp_station_<view>.png`, and `previews/before/` holds the previous model from the same viewpoints.

Size: `tools/blender/quantize_glb.py` (run by `wp_mould.export`) stores positions as 16-bit integers in 0.05 mm steps
and normals as 8 bits (KHR_mesh_quantization); UVs stay float. `wp_station.glb` is 396 KB and `wp_display.glb` 233 KB:
0.60 MB together (was 0.59). The side vents cost most (about 2400 vertices in the cover); the rear panels' sockets
come next.

Not yet: the rear panels' socket layout is the earlier measurement scaled, not re-measured on module_rear_panel
(connectors 4, 6(a) and 6(b) are card-edge openings there, and panel 2 carries a type switch the model lacks); the
small red part on the top's rear edge at the right (module_rear_panel) and the underside's vents and centre hole
(module_bottom_or_display_base) are not modelled; the white numbering on the rear panels; the sticker in the dish;
the cable clips under the display that ST p.28 draws; the display cable is in the module's GLB and does not follow
the display when it turns. The vent slots have square ends. The cameras of the comparison renders were placed by eye,
so the pairs agree in form and proportion rather than pixel for pixel.

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
