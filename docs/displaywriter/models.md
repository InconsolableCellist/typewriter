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
  desk_station_keyboard_diskette; CSG p.40); centre x = -157 mm. The paddle is one solid rectangular block with a
  single flat top, 2.8 mm above the floor at the axle (the owner: "quite clearly a solid rectangle"; an earlier
  two-flat top with a crease is gone). The whole block tilts 0.16 rad about the axle, so the pressed end lies level
  with the floor and the other stands about 5.5 mm proud; most of it is below the floor in the switch's dark body,
  and only a dark gap shows round it (the slot clears it by 1.4 mm; the builder exits 1 if either end would touch the
  slot or the bezel under it, or sink below the floor, at either stop). O is a ring on the left half of the top, I a
  bar on the right. `parts.setRocker(on)` sets
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
and normals as 8 bits (KHR_mesh_quantization); UVs stay float. `wp_station.glb` is 393 KB and `wp_display.glb` 233 KB:
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
slot, the hinge, the feeder's plate, the cabinet's offset) come from `tools/blender/wp_printer.json`, written by
`node tools/wp/export_printer.mjs` from the definition. Review images: `render_wp_printer.py` (Cycles; views `front`,
`open`, `feeder`, `rear`, `carrier`, `three`, `owner`, `cartridge` orthographic from above, `pgcart`) and
`compare_wp_printer.py <photo dir>`, both writing to `tools/blender/previews/` (`compare_front`, `_open`, `_rear`,
`_feeder`, `_plain`, `_carrier`, `_owner`, `_cartridge`, `_pgcart`), with browser screenshots beside them
(`browser_three`, `_front`, `_panel`, and with the cover open `_carrier`, `_top`). The browser shots need the Vulkan
ANGLE flags of architecture.md (Testing): with SwiftShader the context is lost and the frame stays black.

References for the printer, besides the general list above:
- **PG**: Displaywriter System Printer Guide `S544-0861-4` (May 1983; Bitsavers `pdf/ibm/5215/`, 170 pages, scanned):
  p.38 the front drawing with every control numbered (the key and LED order below), p.41 a photograph straight down on
  the carrier with both cartridges fitted, p.43-46 the ribbon cartridge (alone, p.44) and its latches, p.47 and p.50 the
  printwheel cartridge (photograph and drawings), p.53-57 the cardholder and the paper path at the slot, p.89-103 the
  sheet feeder: installed and lifted off from the side (p.90, p.103), its trays and their handles (p.93), its gate.
  Page numbers are the PDF's (printed page + 9).
- **MIM p.57** rendered at 300 dpi is a top view of the carrier drawn to scale (0.234 mm a pixel, from the 132 mm
  between the spools): the ribbon plate 307 mm across, the cartridge 265 mm, the spools 105 mm in front of the print
  line. MIM p.20 (plan of the mechanism in its bottom cover) and p.18 as before.
- **Henry Ford Museum**, object 99.98.1 (IBM Displaywriter word processor and printer, 1983, its printer marked
  5218 A02): printer width 28.00 in, length 26.00 in, height 18.75 in. Read from the search engine's copy of the record:
  thehenryford.org does not resolve from this machine. The height is not the bare printer's (0.19 m in every
  photograph), so something stood on it; only the width is used. The Science Museum Group's 5218 A04 (1992-755) was
  quoted as 200 x 670 x 540 mm by the same search but could not be opened (collection.sciencemuseumgroup.org.uk does not
  resolve): not used.
- **Owner's photograph** `docs/displaywriter/refs/owner/printer_5218_front.jpg`: a 5218 A02 on a stand from the front
  left with continuous forms, a white label stuck on the panel's right section; camera-matched as the `owner` view.
  The dark slot at its top right is the right paper-handler latch opening (5218_1, 5218_2 and PG p.38 show one at each
  side of the cover; the left one is under the rod in this photograph), so the model keeps both. The chrome rod lying
  along the top's left side, from the front corner back to the left latch opening, is not a 5218 part: PG p.38 numbers
  every part of the printer and has none, and no other photograph or drawing (5218_1, 5218_2, BRO p.18, PG p.89-103
  for the sheet feeder, p.75-82 for the tractor feed) shows one; it is taken to be an accessory of the forms stand, and
  is not modelled.
- Searched without result: dimensions in the Technical Manual for the Technical Coordinator `G320-0158-0` and the
  Display Station Platform announcement (Bitsavers `6580_Displaywriter/productAnnoucements/`); stills of the dc4.nl
  video "006 - IBM 6580 Displaywriter with HUGE daisy wheel printer 1980" (no page found; dc4.nl, computerhistory.org's
  photographs, sharktastica.co.uk and the museum sites gave nothing for the printer).
- Local copies: the scratchpad's `ref2/` (`dl/` the downloaded PDFs, `pg/` rendered Printer Guide pages, `mim/`, `bro/`
  the brochure's p.18 at its native 300 dpi, `cmp/` the reference set for `compare_wp_printer.py`).

Measurements and decisions:
- **Size 0.711 x 0.188 x 0.645 m.** The width is the museum's 28 in. It agrees with the photographs: the access cover
  is 0.62 of the cabinet's width in BRO p.18 and PH 5218_1, the front face 0.238 of the width high in BRO p.18 (0.169 m,
  the model's 0.170), the base band a quarter of the face. Depth as before (MIM p.20's bottom cover is 0.886 to 0.90 of
  its width; the museum's 26 in is the same within its rounding). Height to the access cover, 18 mm proud of the top.
- **The mechanism is left of the cabinet's centre.** The access cover, the panel, the scoop and the sheet feeder are
  centred together 12 to 18 mm left of the cabinet's centre in BRO p.18 (both printers), PH 5218_1 and the owner's
  photograph, while the power switch sits 94 to 102 mm from the right end. The model keeps the mechanism on x = 0 (the
  definition's platen, carrier and paper path) and moves the cabinet shell 14 mm right (`printer.cabinet.offsetX`);
  `units.printer.place` subtracts it, so the cabinet keeps its 40 mm gap to the module. The origin is therefore under
  the mechanism, 14 mm left of the footprint's centre.
- **Platen centre (y 0.132, z +0.064), length 0.52 m**, unchanged. MIM p.57 confirms the scale it implies: the
  carrier is as wide as MIM p.20 draws it.
- **Cabinet**: the cover half widths are 0.2205 m at the lip and 0.2135 at the hinge (were 0.239 and 0.219). The scoop
  under the lip is a closed pocket with a light floor (PH 5218_1), not a dark hole. The IBM badge (36 x 26 mm, "IBM"
  striped over "5218 A02", drawn by the view) is on the top at the front left (PH 5218_1, 5218_2). The open cover shows,
  on the cabinet's front edge, the magnetic latch right of the scoop (the cover's keeper moved over it) and a plate with
  two screws at the left (PH 5218_2); under the carrier, the dark acoustic foam over the base plate (MIM p.63). The
  base band, feet, fan grille and attachment panel follow the cabinet's offset. The index motor rides higher, over the
  base's wall, which now comes closer on the left.
- **Access cover** as before, but its tinted window is 117 mm deep (was 40), over half the cover: PH 5218_2 shows the
  clear part over half the raised cover's length, the owner's photograph and BRO p.18 a dark band over the cover's rear
  half. The foam lines the front part. The glass is smoked: dark, glossy and 62 % opaque (the view's `wp_glass`).
- **Panel frame, strip and power switch bezel** are a pale pearl a shade greyer than the covers (`wp_trim`; the owner's
  photograph and BRO p.18), not PH 5218_1's yellowed tan; the frame's edges are rounded 1.2 mm. The panel's right
  section carries a white card with the model written on it, as on the owner's printer.
- **Panel** unchanged in place and order; PG p.38 confirms it: LEDs top row Power On, Ribbon, Printer Excep, Setup,
  Change Font, bottom row On Line, Ready, Release, Load Paper, Diag Mode; keys Start (green) over Stop (yellow), Print
  Test over Cancel, Load over Release, Paper Up over Paper Down. Node order `printer_key0..7` is the definition's
  `panel.keys`, `printer_led0..9` the controller's bit order (the view's `LED_LABELS`).
- **Frames**: the side frames now stay low in front (top 78 to 90 mm up, in front of z 0.15) and rise round the platen,
  so the wide ribbon plate passes over them at the carrier's stops.
- **Carrier** (`printer_carrier`), from MIM p.57 to scale and PG p.41: the ribbon plate is 300 mm across at the front
  (was 210), narrow behind round the motor, with the cartridge's tapered spring latches at its ends, the belt rollers
  and gear where MIM p.57 draws them, the feed belt round the first roller and the advance knob, and the release spring
  along its front edge. The casting, motor, hammer coil and nose cone are unchanged.
- **Ribbon cartridge**: a dark grey moulding 265 mm across with a straight front edge; over each spool a round lobe
  (radius 39 mm) running back to a blunt tip where the film leaves for the guides; the motor's notch between the lobes,
  round at its foot; a slot window in the left lobe and the IBM logo on the right one (`printer_cartlogo`, a decal the
  view draws, carried by the carrier); the top rising 8.5 degrees toward the platen to the ribbon's height (PG p.44);
  under the front edge the spool housings, open in a bay over each spool's toothed flange (PG p.41, p.44). Its spools
  moved with it: the definition's `ribbon.spoolZ` is now 126 mm in front of the platen axis (was 64), 105 mm in front
  of the print line as MIM p.57 measures; the soft ribbon runs from there to the guide posts.
- **Printwheel cartridge** (PG p.47, p.50; MIM p.57): two plates either side of the wheel, round below a band with an
  ear at each side, open above it over the upper petals inside a trapezoid handle whose top bar runs just above the
  print point; the hub shows through a rounded triangle in the motor-side plate; the ribbon guide posts stand on
  brackets from the band (the manual puts the ribbon guides on this cartridge). Green, as in PH 5218_2 and 5218_4.
- **Printwheel** (`printer_wheel`) unchanged.
- **Sheet feeder** (`printer_feeder`): 0.544 m wide (0.76 of the cabinet in BRO p.18; was 0.556). Hand scoops in its
  sides under the top's rear edge (PG p.90, p.103), the left side guide standing the height of the opening in front of
  the plate (BRO p.18, PG p.90), and the tray ends as handles: a frame round a wide window (PG p.93). The paper
  insertion gate (`printer_feeder_gate`, SET p.26) and the two trays (`printer_tray0` upper, `printer_tray1` lower) are
  nodes; the view parents them to the feeder.
- **Soft body** (`printer-soft.js`) unchanged in form; it reads the moved spools from the definition.
- **Controls** (each a node with its pivot at its axle; `parts` in the view): `printer_cover` (hinge on its rear top
  edge, turns about x; open is negative rotation.x), `printer_power` (rocker, about x), `printer_key0..7` (press along
  -z), `printer_led0..9`, `printer_ribbon_knob` (on the ribbon plate at x 0.127, z 0.232, turns about y; rides the
  carrier), `printer_platen` (about x), `printer_bail` and `printer_feedrolls` (the cam's paper release, about x),
  `printer_feeder_gate` (about the stacker plate's normal, (0, 0.174, 0.985)), `printer_tray0/1` (slide along z,
  pivot at the middle of the handle end). The 5218 has no platen knobs and no paper release or bail lever: PG p.38 lists
  every control (power switch, eight keys, the display and ten lights, the A03/A04 ribbon saver switch); the platen
  knobs and bail lever of its p.11-29 are the 5215's. Paper moves with Paper Up and Paper Down, and the cam motor opens
  the bail and releases the feed rolls (MIM p.181, p.186). The platen node is there for a hand that turns the platen
  itself.
- **Budget**: 25 k triangles; 663 KB (0.632 MiB) after `KHR_mesh_quantization`, about 20 KB more than before for the new
  cartridges, nodes and details; the carrier casting and the ribbon cartridge go without bevels, and a few small
  cylinders have fewer segments, to stay there. Still more than half of the 1.1 MB for all five units.
- **Clearance**: the build exits 1 if the carrier, wheel or hammer at either stop touches the covers, filter, frame,
  feeder, platen or bail, if the cover touches the top, filter or feeder anywhere from closed to its stop, or if the
  bail touches the top, the cover or the platen. The wide ribbon plate and the cartridge's tips are in that check.

Not yet matched:
- The depth rests on MIM p.20's proportions and a rounded museum figure (0.63 to 0.66 m); no source gives it exactly.
- The paper's way from a tray to the platen: inside the feeder it is enclosed and no photograph or drawing shows it, so
  it is not modelled; the soft body still lays the delivered sheet on the stacker plate from under the exit rollers.
  The trays are only their protruding ends.
- The ribbon cartridge's lobes are lower and blunter at the tips than PG p.41 (where they rise to points behind the
  break lines of MIM p.57), and its lower housings are plain cylinders. The cardholder and the hammer's nose are as
  before. The printwheel cartridge's label printing ("IBM Cartridge Printwheel", the style number) is not drawn.
- The cabinet's front-top radius, the base band's inset and the front face are as before (they matched within a few
  millimetres). The card's writing uses the system's handwriting face where there is one.
