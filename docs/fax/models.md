# Fax: the Sharp FO-70 model

The FO-70 must reach the standard of the IBM Selectric (`element1971`) and the Displaywriter's units
(`docs/displaywriter/models.md`): real proportions from the documented size and the photographs, moulded shapes with
bevels and gaps, the operator's parts as separate nodes on their pivots, textured plastics. This file is the
contract between the model and the kit (`src/kits/fax.js`), and the record of how it was matched.

## Pipeline

- **Data:** `tools/blender/fax_fo70.json`. Every dimension, the side profile, the panel layout (each key's place,
  measured on the owner's photograph), the paths, the handset, the cord. Change it, rebuild, compare.
- **Builder:** `/root/bpyenv/bin/python tools/blender/build_fax_fo70.py` writes `public/assets/models/fax_fo70.glb`,
  quantized (`quantize_glb.py`; the build adds meshopt and gzip, `vite/assets.js`). It uses the Displaywriter's
  moulding helpers (`wp_mould.py`). The build exits 1 if a boolean leaves the body inside out or outside the size.
- **Panel print layout:** `tools/blender/fax_fo70_layout.py` places every printed label. The builder stores it on the
  `fax_panel` node (extra `layout`); the review renders draw from the same function.
- **View:** `src/render/fax/fo70-view.js`. It exports:
  - `buildFo70View(machine, opts)` (also the default export), the kit's entry;
  - `buildFo70(opts)`;
  - `createFaxMaterials()`;
  - `drawPanelPrint()`.

  It loads the GLB through `src/render/gltf.js`, applies the materials by name, and draws on canvases: the overlay's
  print, the key legends (one atlas) and the LCD's 16 characters. It returns `{ group, parts, update, ... }` in the
  body's frame.
- **Review:** `python3 tools/blender/compare_fax_fo70.py [--views top,three,side,rear,open,front]`. Under python3 it
  draws the print and key faces with PIL. It then runs itself under Blender to render, and composes the comparison in
  `tools/blender/previews/fax/` (gitignored). The kept copies are in `docs/fax/review/`.
- **Test:** `tests/fax_model.test.js` checks:
  - node names, the size within 2 mm and the material set;
  - each key's place on the panel and its press axis;
  - the hinges, slides and paths;
  - the view's parts, including the kit's names, and `update()`.

  `tests/models.test.js` holds the GLB's summary in `tests/fixtures/models.json`.
- **Size shipped:**
  - 651 KB quantized in the repository;
  - 183 KB as served (meshopt and gzip);
  - about 29 k triangles. The coiled cord takes 7.5 k of them.

## Frame and size

- **Frame:** origin on the desk under the footprint's centre; x right, y up, z toward the operator (glTF Y-up). This
  is the body's frame in `src/machine/faxfo70.js`.
- **Overall size:** 304 x 236 x 122 mm (research.md 8.2), held to 0.1 mm.
- **Height:** the 122 mm is the handset's top at its earpiece end. The body's ridge is 112 mm.

## Materials (GLB names)

| Name | What | Colour (picked from the photograph) |
|---|---|---|
| `fax_body` | Case, handset, cord, guides, latch | Lilac grey `#a8a7ba`, `wp_pebble` grain at a 30 mm tile |
| `fax_panel` | Cream overlay (its print is the map) and the pad's hub | Cream `#dbd8c6` |
| `fax_key` | Every key cap (one atlas holds the colours and legends) | Grey `#8f9199`, side keys `#a3a4ab`, pad `#d8cba6` |
| `fax_key_start` | The pad's fixed lower quarter | Cream-yellow `#d8cba6` |
| `fax_lcd` | LCD glass (a runtime canvas) | Grey-green `#c3cabd` |
| `fax_rubber` | Feet, platen | Black |
| `fax_dark` | Slot linings, head, blades, jacks, hook plunger, speaker | Near black |
| `fax_paper` | Thermal roll | Off-white |

## The parts contract

**Pivots and extras.** Every node below has its pivot at its origin. Axes are in the parent's frame. The panel and the
keys carry no rotation, so their axes are also in the body's frame. Extras are glTF extras, which are `userData` in
three.js. The view parses them from JSON.

**Kit names** (docs/fax/architecture.md 6.2), returned by the view beside the GLB names:

- `cover` and `panel`: the `fax_panel` node.
- `display`: `fax_lcd`.
- `rollBay`: `fax_paper_roll`.
- `handset`: `fax_handset`.
- `keys`: the cap meshes, in `machine.mech.panel.keys` order.
  - The photograph shows one VOLUME key. It is `volumeUp`.
  - `volumeDown` has no cap: it gets an empty `Object3D` as a stand-in. The mechanism's 28th key needs either a
    second cap from a better photograph, or a single `volume` key in the mechanism.

The GLB nodes:

| Node | Pivot | Motion and extras |
|---|---|---|
| `fax_body` | origin | Static. The moulding: cradle trough, roll bay, document table, slots, jack pockets |
| `fax_panel` | Rear lower edge of the operation panel (the hinge) | `hinge [1,0,0]`, `open` −95° (−1.658 rad): `rotation.x = −angle` lifts it. It is the roll cover (architecture.md 3.3). `layout`: the print layout |
| `fax_key_<name>` (27), children of `fax_panel` | Top centre of the cap | `press` (unit vector into the panel: `[0, −cos 32°, −sin 32°]`), `travel` (m), `legend`, `label`, `kind` |
| `fax_lcd`, child of `fax_panel` | Centre of the glass | `size [w, h]` (62 x 15.6 mm), `normal`, `chars 16`. Its uv spans the glass |
| `fax_handset` | Its centre, turned 21° to the cradle | `rest`, `slope`. A free body: the view's `update` lifts it 0.17 m when off the cradle |
| `fax_cord_handset`, child of `fax_handset` | The cord's socket under the mouthpiece end | For a cord drawn at run time |
| `fax_hook` | Top of the plunger, pressed by the handset | `press` (along the cradle's down), `travel` 4 mm (rises when lifted) |
| `fax_cord` | origin | Static coiled cord as the photograph shows it, from the handset to `fax_cord_jack` (left side) |
| `fax_roll_latch` | Outer face of the tab, in the right side under the panel's front corner | `press [−1,0,0]`, `travel` 2 mm. The panel's release |
| `fax_guide_l`, `fax_guide_r` | The fence's inner face on the document table | `slide` (inward unit x), `travel` 41 mm (A4 210 mm down to 128 mm) |
| `fax_doc_slot` | Floor of the entry under the panel's rear edge | Static lining |
| `fax_doc_exit` | Floor of the exit under the panel's front lip | Static lining |
| `fax_doc_path` | The path's first point, above the table | `path`: points relative to the node: table, slot, under the panel, out at the front at 32 mm |
| `fax_print_path` | Top of the roll | `path`: roll, head nip, cutter, out of the print slot at 19 mm |
| `fax_print_slot` | origin | Static lining of the exit (y 16.8 to 21.2 mm, 224 mm wide) |
| `fax_cutter` | Top centre of the guillotine blade | `press [0,−1,0]`, `travel` 6.2 mm |
| `fax_platen` | The roller's axis | `axis [1,0,0]`, `radius` 6 mm |
| `fax_paper_roll` | The roll's axis | `axis`, `radius` 25.5 mm (30 m), `core`, `width` 216 mm. The view scales it to the snapshot's radius |
| `fax_speaker` | Centre of the speaker under its grille in the base | Static |
| `fax_mech` | origin | Static: thermal head, fixed blade |
| `fax_jacks` | origin | Static: LINE and TEL jacks at the rear, handset jack and plug at the left, mains grommet |
| `fax_feet` | origin | Static |

**Key names:**

- `1` to `9`, `0`, `star`, `hash`;
- `rapid_a` to `rapid_e` (A, B, C, D, E/POLL);
- `volume`, `function`, `resolution` (RESOLUTION/RECEPTION MODE);
- `speed_dial`, `redial`, `hold` (HOLD/SEARCH), `speaker`;
- `start`, `stop`, `copy` (COPY/HELP): the three quarters of the round pad.

The pad's lower quarter and hub are fixed. The photograph shows no legend on them.

**View setters.** `setKey(name, 0..1)`, `setHook(0..1)`, `setPanel(0..1)`, `setLatch`, `setCutter`, `setGuides(width)`.

**`update(state, layout)`** poses the following from the snapshot (`src/sim/fax/layout.js`):

- the keys (`keyX`);
- the hook (`hookX`);
- the handset (`onCradle`);
- the cutter (`blade`);
- the platen (`platenPsi`);
- the roll (`rollRadius`).

The kit sets the cover's angle itself.

## How it was matched

**Other photographs.** A search on 2026-11-16 found no other FO-50 or FO-70 photograph. Sources tried:

- a web search;
- the Wikimedia Commons API;
- the manual hosts (ManualsLib, manualmachine, manuals.online, elektrotanya, archive.org). These are refused by this
  environment's network.

The FO-235 photograph in `refs/owner/` was used only for the generic Sharp details (the handset's shape, the coiled
cord, the slotted exit).

**The photograph.** The main reference is `docs/fax/refs/owner/sharp_fo70_top.png`: a 474 px listing photograph,
357 px of content padded to a square.

- **The camera sees the panel square on.** The round keys and the pad's hole image as circles, within 4 %.
- **The scale is 0.925 px/mm in the panel's plane.** The 16-character LCD's band measures 57.5 px, which is about
  62 mm, and gives the documented 304 mm width.
- **Layout.** Every key centre, the LCD, the window, the pad and the logo were read in panel coordinates on a 4x grid.

**The profile follows from the photograph and the 236 mm depth.**

- **The constraint.** A box 236 mm deep cannot fit in the 180 mm of the photograph's vertical extent at any camera
  steep enough to see the panel square on, unless everything behind the ridge falls away from the camera.
- **The solution.** The only shape that satisfies both is:
  - a low front;
  - the panel at 32°;
  - the document table rising to a ridge 33 to 45 mm behind the panel's rear edge;
  - a back falling steeply (about 50°) to a 28 mm heel.
- **Check.** The comparison puts the ridge within 2 px of the photograph's and the panel within 1 to 2 px.
- **Left out.** Behind the ridge, the photograph shows nothing.
- **The rear right.** The document table and the back stop at x = 136 mm. The panel runs to the right edge, as the
  photograph shows.

**Camera and render.** The camera sits on the panel's normal at 0.45 m. The focal length gives 0.925 px/mm.

**Comparisons** (in `docs/fax/review/`):

- `compare_top.jpg`: the photograph, the render and a 50 % blend.
- `compare_top_close.jpg`: the machine, 3x.
- `fo70_three`, `fo70_front`, `fo70_side`, `fo70_rear`: other views, for the guessed parts.
- `fo70_open`: the panel lifted 95° over the roll bay, the handset lifted.

**Matched within 1 to 2 px of the photograph's camera:**

- the panel and its corners;
- every key;
- the LCD and its window;
- the pad;
- the SHARP mark;
- the handset's outline and its ends;
- the ridge;
- the rear right corner.

**Colours.** Picked from the photograph and corrected for its overcast cast. The overlay is the photograph's yellowed
cream. A new machine's would be paler.

## What is guessed, and which photographs would settle it

These are all [A]. The numbers are the photographs in plan.md section 10.

- **Profile, sides and back (2, 6).** The steep back and the 28 mm heel follow from the depth and the photograph.
  Nothing shows them. A side view settles them.
- **The rear right step (2, 5).** Inferred from the background showing there.
- **The cradle (10).** A solid sloped trough with ear and mouth pockets, and the hook plunger under the handset's
  rear half. The handset's 21° slope, its underside cups and the plunger's place are guessed.
- **The handset (1, 10).** Its top view matches. Its thickness (27 mm bar, 10 mm cups) is a guess.
- **The coiled cord (1, 5).**
  - The photograph shows it coiled on the stand left of the machine.
  - Its socket under the mouthpiece end and the jack in the left side are guesses.
- **The paper path (7, 8, 9).** It follows the mechanism's assumption (architecture.md 3.3). The roll lies loose in
  a bay under the panel, which is the roll cover on a rear hinge, and the panel's release is a tab in the right side.
  None of this is seen.
- **Slots and mechanism (1, 8, 9).**
  - The thermal head and platen just inside the front.
  - The guillotine cutter.
  - The print slot low in the front face, and the document exit under the panel's front lip.
  - The document entry under the panel's rear edge.
  - The scanner (CIS, rollers) is not modelled.
- **The speaker (6).** Placed in the base under a slotted grille. Nothing shows it.
- **Lamps.** None visible on the panel in the photograph, so none modelled.
- **Underside, feet, jacks and the rating plate (6).** Guessed.
- **The panel close up (4).**
  - Sizes and colours of the small keys.
  - The pad's moulded marks (diamond, ring, box).
  - The small print in the LCD window. The "FO-70" under the LCD is our placement.
  - The number keys' legend colour.
- **VOLUME (4).** One key, in the photograph and now in the mechanism too (the manuals' panel drawing and key matrix).

## Corrections from the service manual

From the owner's service manual (SM) and operation manual (OM), read in full (`hardware.md`). What the model has
right, what it must change, and what `tools/blender/fax_fo70.json` now carries. The GLB is rebuilt by the next model
pass; Blender was not run here.

**Confirmed.**

- Size 304 x 236 x 122 mm, about 2.6 kg (SM p.1-1, OM p.2): `size` is right.
- The panel's layout (SM p.1-2, OM p.8): five rapid keys A B C D E/POLL in an arc under the LCD; STOP printed over the
  round pad; START left, COPY/HELP right; VOLUME, FUNCTION, RESOLUTION/RECEPTION MODE left of the keypad; the keypad's
  letters ABC DEF GHI JKL MNO PQRS TUV WXYZ; SPEED DIAL, REDIAL, HOLD/SEARCH, SPEAKER at the right; one VOLUME key.
  The json's 27 keys and their labels match.
- The handset on its rest at the left; its cord into a jack with a handset symbol on the left side (OM p.11).
- The operation panel lifts at the front by a finger hold at the front right (OM p.9 item 14, "pull toward you", and
  p.16 "pull up"); the paper compartment under it; two panel lock levers (SM p.3-10).
- The speaker in the base, on the PWB case (SM p.3-12).

**Changed in the json.**

- `docPath.minWidth` 0.128 -> **0.148**: documents are 148 to 216 mm wide (SM p.1-1, OM p.31); the hopper guides
  close no further.
- `print.items`: the reception mode legends **TEL  FAX** above the LCD window's right end and **TEL/FAX  A.M.** below
  it (SM p.1-2, OM p.8 and p.28), where the arrow points. Their exact placement is ours.
- Notes on `bay` and `jacks`: the front paper guide and metal guide, the head that stays down, TEL. LINE and TEL. SET
  on the back, the fixed AC cord.

**Still to model (a model pass).**

- **The LCD's mode arrow.** The display draws ▲ at the 14th and 16th characters (TEL, FAX) and ▼ there (TEL/FAX,
  A.M.); the window's printed legends must sit over and under those columns.
- **The front paper guide** (green in the photographs of the class) that flips up inside the compartment, with the
  metal guide and its knob (OM p.16-18); the slot the paper is pushed through; the paper roll shims for 210 mm paper.
- **The white back roller and its two green CIS release levers** under the panel (OM p.83, p.92), seen when the panel is
  open.
- **The FO-70's exit:** the cutter unit with the PO roller and two pinch rollers after it (SM p.3-9, 3-10); the cut
  sheet leaves the front opening. The json's `cutter` is a guillotine stand-in; the real one is a cutter unit worked
  by a cutter arm from the drive (no motor, SM p.3-7).
- **The original document support**, an accessory that clips on at the rear (OM p.15 figure, SM parts p.7).
- **The rear:** two sockets, TEL. SET behind a peel-off seal, and TEL. LINE (OM p.14-15, p.62); no power socket or
  switch, a fixed AC cord (OM p.13).
- **The hopper's document guides** move together on a pinion with a spring (SM p.3-5, parts p.2).
- **No lamps** on the panel: the drawing shows none (the FC200 can drive 8 LEDs, none fitted).
- The panel's opening angle, the handset's thickness, the profile's sides and back: still not shown in either manual.
