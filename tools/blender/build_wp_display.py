"""Builds public/assets/models/wp_display.glb, the 25-line display of the display station.

  /root/bpyenv/bin/python tools/blender/build_wp_display.py

381 x 348 x 292 mm with its foot (HW 1.2). Front elevation from PSM p.7 and the owner's photographs
(docs/displaywriter/refs/owner/display_front_close, desk_*): a pearl-white front frame and, in its opening, the grey
bezel moulding: a rim nearly flush with the frame, a deep recess, and on its floor a step round the tube's opening
with a sloped reveal down to it, and on the right the control strip, a raised panel with the square badge and the
contrast and brightness knobs (ST p.28 fig. 3, CSG p.40, BRO p.18). Behind the frame, the cabinet runs back with
large rounded rear edges (ST p.28 fig. 1, CSG p.23), a band of vent slots across its top (Z241 p.8). Its underside
is flat to just behind the foot and then rises toward the rear, so the display can tilt back 20 degrees (inferred:
the documented tilt needs the room). Under it, the foot (ST p.28 fig. 2, CSG p.23): a pearl turntable disc standing
in the module's dish over its boss, an oval swivel plate on it, and a curved cradle under the cabinet that rocks in
the plate's seat.

Nodes (unit coordinates, origin on the module's top at the turntable's centre):
  display_foot                      the disc, fixed in the module's recess
  display_swivel (empty, origin)    turns about y, 12 degrees either way (ST p.28)
    display_plate                   the oval swivel plate
    display_tilt (empty, at the cradle's axis)   turns about x; minus 20 degrees tilts the top back
      display_frame, display_cabinet, display_bezel, display_badge, display_knob_contrast,
      display_knob_brightness   (each knob's origin on its shaft, at the strip's face)
The tilt node carries the tube face for the CRT as a custom property (glTF extras, three.js userData.face): its
centre's x, y and the corners' z in the tilt node's frame, and w, h, radius for makeTubeFace (src/render/wp/crt.js).
Exits 1 if the cabinet touches the foot or the module anywhere in the tilt and swivel ranges.
"""
import json
import math
import os
import sys

import bpy  # noqa: F401  (first: it provides bmesh and mathutils)
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wp_mould as W  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "wp_display.glb")

X, ZF, ZB = 0.1905, 0.174, -0.174
TOP, BOT = 0.289, 0.021          # the cabinet (268 mm, PH desk_front_scott_peterson); the foot stands in the module's dish
ZP = 0.112                       # the frame's rear edge (parting with the cabinet)
GAP = 0.0008
T = 0.003
R_TOP, R_BOT = 0.016, 0.026      # front elevation corners (PSM p.7)
PANEL = (-0.157, 0.054, 0.160, 0.257)           # the bezel moulding in the frame's opening: x0, y0, x1, y1 (PSM p.7; the
                                                 # borders equal top and bottom, PH desk_front_scott_peterson)
LIP = 0.0025                                     # its rim, nearly flush with the frame's face
Z_HOOD = ZF - 0.026                              # the floor of its deep recess: a hood (PH display_front_close, BRO p.18)
Z_POCKET = ZF - 0.040                            # the frame's pocket floor, the bezel's back
OPEN = (-0.0248, 0.1555, 0.244, 0.170)          # the tube opening: centre x, y, w, h (ST p.28: 245 x 170 visible)
STEP, STEP_D = 0.013, 0.0025                     # the first step round the opening: its margin and depth
Z_OPEN = Z_HOOD - 0.011                          # the opening's edge, at the foot of the sloped reveal
DIVIDER_X = 0.113                                # the control strip's left edge
STRIP_X = 0.1345                                 # the strip's centre line: badge and knobs
Z_STRIP = Z_HOOD + 0.006                         # the strip's face: a separate raised panel (PH display_front_close)
KNOBS = (("contrast", 0.135), ("brightness", 0.1075))   # PH display_front_close, desk_station_keyboard_diskette
KNOB_R, KNOB_DEPTH = 0.010, 0.012                # 20 mm knurled knobs (PH display_front_close: about the badge's width)
BADGE = (STRIP_X, 0.229, 0.019, 0.019)          # a square silver badge (PH display_front_close, display_three_quarter)
GLASS = dict(w=0.252, h=0.178, radius=0.6)      # makeTubeFace: the glass is a little larger than the opening
VENT_Z = (ZP - 0.040, ZP - 0.012)                # the top vents' band, front to back
Z_K = -0.035                                     # where the underside starts to rise toward the rear
RISE = math.radians(20)
Z_FL, FRONT_RISE = 0.05, math.radians(9)         # ahead of this the underside rises toward the front edge
PIVOT = (0.0, 0.093, Z_K)                        # tilt axis, along x
PLATE = (0.085, 0.055, 0.012, 0.019)            # oval swivel plate: half width, half depth, bottom, top
DISC = (0.112, -0.0055, 0.012)                   # turntable disc on the dish's floor: radius, bottom, top (PH desk_*)
BOSS = (0.0725, 0.0062)                          # the recess under it for the module's boss: radius, height
RC = PIVOT[1] - PLATE[3]                         # cradle radius: it rests on the plate's top


def under(z):
    """The underside's height: a shallow V toward the foot (ST p.28 fig. 2, side and front views), rising gently to
    the front and steeply enough behind for the tilt."""
    if z > Z_FL:
        return BOT + (z - Z_FL) * math.tan(FRONT_RISE)
    if z < Z_K:
        return BOT + (Z_K - z) * math.tan(RISE)
    return BOT


def elevation(i=0.0):
    return W.rounded_rect(-X + i, BOT + i, X - i, TOP - i, max(0.001, R_TOP - i), seg=8, rb=max(0.001, R_BOT - i))


def frame_solid(i=0.0):
    ob = W.ob_from(W.prism(elevation(i), "z", ZP - 0.01, ZF - i), "f")
    side = W.round_poly([(ZP - 0.02, under(ZP - 0.02) + i), (ZF - i, under(ZF) + i), (ZF - i, TOP - i), (ZP - 0.02, TOP - i)],
                        [0.0, 0.012, 0.012, 0.0], seg=5)
    W.boolean(ob, W.ob_from(W.prism(side, "x", -X - 0.01, X + 0.01), "s"), "INTERSECT")
    plan = W.rounded_rect(-X + i, ZP - 0.02, X - i, ZF - i, 0.012, seg=5)
    W.boolean(ob, W.ob_from(W.prism(plan, "y", BOT - 0.02, TOP + 0.02), "p"), "INTERSECT")
    W.boolean(ob, W.ob_from(W.box_bm(-1, -1, ZP, 1, 1, 1), "c"), "INTERSECT")
    return ob


def cabinet_solid(i=0.0):
    rise = (Z_K - ZB) * math.tan(RISE)
    prof = W.round_poly([(ZP + 0.01, under(ZP + 0.01) + i), (Z_FL, BOT + i), (Z_K, BOT + i), (ZB + i, BOT + rise + i * 0.5), (ZB + i, TOP - i), (ZP + 0.01, TOP - i)],
                        [0.0, 0.040, 0.030, max(0.002, 0.022 - i), max(0.002, 0.040 - i), 0.0], seg=8)
    ob = W.ob_from(W.prism(prof, "x", -X + i, X - i), "c")
    W.boolean(ob, W.ob_from(W.prism(elevation(i), "z", ZB - 0.01, ZP + 0.02), "e"), "INTERSECT")
    plan = W.rounded_rect(-X + i, ZB + i, X - i, ZP + 0.03, max(0.002, 0.040 - i), seg=8)
    W.boolean(ob, W.ob_from(W.prism(plan, "y", BOT - 0.05, TOP + 0.05), "p"), "INTERSECT")
    W.boolean(ob, W.ob_from(W.box_bm(-1, -1, -1, 1, 1, ZP - GAP), "c"), "INTERSECT")
    return ob


def cradle():
    """The curved boss under the cabinet: a cylinder sector about the tilt axis, resting in the plate's seat."""
    c = W.ob_from(W.cylinder_bm(PIVOT, "x", RC, 0.11, 64), "cr")
    W.boolean(c, W.ob_from(W.box_bm(-0.1, PIVOT[1] - RC - 0.01, Z_K - 0.042, 0.1, BOT + 0.004, Z_K + 0.042), "b"), "INTERSECT")
    return c


def rect_at(cx, cy, w, h, r, seg=6):
    return W.rounded_rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, r, seg=seg)


def build_frame():
    frame = frame_solid()
    # The pocket the bezel panel sits in, and the hollow behind it.
    x0, y0, x1, y1 = PANEL
    W.boolean(frame, W.ob_from(W.prism(W.rounded_rect(x0, y0, x1, y1, 0.012, seg=6), "z", Z_POCKET, ZF + 0.01), "pk"))
    W.boolean(frame, W.ob_from(W.prism(elevation(T), "z", ZP - 0.02, Z_POCKET - T), "in"))
    cx, cy, w, h = OPEN
    W.boolean(frame, W.ob_from(W.prism(rect_at(cx, cy, w + 0.002, h + 0.002, 0.011), "z", Z_POCKET - 0.02, Z_POCKET + 0.01), "op"))
    return frame


def build_cabinet():
    cab = cabinet_solid()
    W.boolean(cab, cabinet_solid(T))
    W.boolean(cab, cradle(), "UNION")
    # Cable exit under the rear (ST p.28: the cable leaves the bottom), toward the right as CSG p.23 draws it.
    rise = (Z_K - ZB) * math.tan(RISE)
    zc = -0.105
    yc = BOT + (Z_K - zc) * math.tan(RISE)
    W.boolean(cab, W.ob_from(W.prism(W.ellipse(0.024, zc, 0.012, 0.008, 24), "y", yc - 0.02, yc + 0.004), "ex"))
    return cab


def top_vents(cab):
    """The band of slots across the top just behind the frame (Z241 p.8). Cut after the bevel; a dark baffle under them
    keeps the inside from showing lit."""
    bms = [W.box_bm(x - 0.0011, TOP - 0.02, VENT_Z[0], x + 0.0011, TOP + 0.01, VENT_Z[1]) for x in [-0.150 + 0.0075 * k for k in range(41)]]
    W.boolean(cab, W.join_bms(bms, "slots"))
    return W.finish(W.ob_from(W.box_bm(-0.16, TOP - T - 0.007, VENT_Z[0] - 0.006, 0.16, TOP - T - 0.005, VENT_Z[1] + 0.006), "baffle"), "wp_dark")


def build_bezel():
    """The bezel moulding (PH display_front_close, display_three_quarter): a rim nearly flush with the frame, a deep
    recess, and on its floor a step round the tube's opening, a sloped reveal down to the opening, and on the right
    the control strip, a separate raised panel."""
    x0, y0, x1, y1 = PANEL
    g = GAP
    panel = W.ob_from(W.prism(W.rounded_rect(x0 + g, y0 + g, x1 - g, y1 - g, 0.0115, seg=6), "z", Z_POCKET, ZF - 0.0008), "bz")
    W.boolean(panel, W.ob_from(W.prism(W.rounded_rect(x0 + LIP, y0 + LIP, x1 - LIP, y1 - LIP, 0.0095, seg=6), "z", Z_HOOD, ZF + 0.01), "hood"))
    cx, cy, w, h = OPEN
    W.boolean(panel, W.ob_from(W.prism(rect_at(cx, cy, w + 2 * STEP, h + 2 * STEP, 0.022), "z", Z_HOOD - STEP_D, Z_HOOD + 0.01), "s"))
    reveal = W.loft(rect_at(cx, cy, w, h, 0.015, seg=6), Z_OPEN, rect_at(cx, cy, w + 0.014, h + 0.014, 0.019, seg=6), Z_HOOD - STEP_D + 0.0001, "z")
    W.boolean(panel, W.ob_from(reveal, "rv"))
    W.boolean(panel, W.ob_from(W.prism(rect_at(cx, cy, w, h, 0.015), "z", Z_POCKET - 0.01, Z_OPEN + 0.0005), "o"))
    strip = W.ob_from(W.prism(W.rounded_rect(DIVIDER_X, y0 + LIP + 0.005, x1 - LIP - 0.003, y1 - LIP - 0.005, 0.005, seg=4), "z", Z_HOOD - 0.001, Z_STRIP), "st")
    W.boolean(panel, strip, "UNION")
    # Knob bushings: shallow round seats in the strip.
    for _, ky in KNOBS:
        W.boolean(panel, W.ob_from(W.cylinder_bm((STRIP_X, ky, Z_STRIP), "z", KNOB_R + 0.0012, 0.0016, 32), "ks"))
    # A dark mask round the glass's edge, behind the opening, so the tube's border reads as the tube's own black.
    mask = W.ob_from(W.prism(rect_at(cx, cy, w + 0.016, h + 0.016, 0.012), "z", Z_POCKET - 0.016, Z_POCKET - 0.001), "m")
    W.boolean(mask, W.ob_from(W.prism(rect_at(cx, cy, GLASS["w"] - 0.006, GLASS["h"] - 0.006, 0.006), "z", Z_POCKET - 0.03, Z_POCKET + 0.01), "h"))
    W.finish(panel, "wp_bezel", 0.0008)
    W.finish(mask, "wp_dark")
    return W.merge([panel, mask], "display_bezel")


def build_badge(rect=BADGE, name="display_badge", mat="wp_badge"):
    """The maker's badge above the knobs (PH display_front_close, BRO p.18): a plate whose face has uv 0..1 for the
    view's artwork."""
    bx, by, bw, bh = rect
    b = W.ob_from(W.prism(rect_at(bx, by, bw, bh, 0.0012, seg=3), "z", Z_STRIP - 0.0005, Z_STRIP + 0.0007), name)
    W.smooth(b)
    W.assign(b, mat)
    bm = bmesh.new()
    bm.from_mesh(b.data)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = ((c.x - (bx - bw / 2)) / bw, (c.y - (by - bh / 2)) / bh)
    bm.to_mesh(b.data)
    bm.free()
    return b


def build_knob(name, ky):
    """A round knob with a knurled skirt and its symbol on the face (CSG p.40): contrast a half-filled circle,
    brightness a sun. Built at the origin facing +z, then posed at its shaft."""
    r, depth = KNOB_R, KNOB_DEPTH
    n = 22
    pts = []
    for i in range(2 * n):
        a = math.pi * i / n
        rr = r if i % 2 == 0 else r - 0.0005
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    skirt = W.ob_from(W.prism(pts, "z", 0.0, depth - 0.0015), "sk")
    face = W.ob_from(W.cylinder_bm((0, 0, depth - 0.0016), "z", r - 0.0004, 0.0032, 48, r2=r - 0.0016), "fc")
    W.boolean(skirt, face, "UNION")
    W.finish_small(skirt, "wp_dark", 85)
    marks = []
    zf = depth + 0.0001
    if name == "contrast":
        # Contrast: the face's disc half light, half dark (PH display_front_close).
        half = W.ob_from(W.cylinder_bm((0, 0, zf), "z", r - 0.0026, 0.0004, 40), "hf")
        W.boolean(half, W.ob_from(W.box_bm(-0.02, -0.02, zf - 0.01, 0.0, 0.02, zf + 0.01), "c"))
        half.data.transform(Matrix.Rotation(math.radians(-30), 4, "Z"))
        marks += [half]
    else:
        # Brightness: a sun, a ring with eight rays.
        ring = W.ob_from(W.cylinder_bm((0, 0, zf), "z", 0.0031, 0.0004, 24), "r")
        W.boolean(ring, W.ob_from(W.cylinder_bm((0, 0, zf), "z", 0.0023, 0.002, 24), "h"))
        rays = [W.box_bm(-0.0004, 0.0041, zf - 0.0002, 0.0004, 0.0062, zf + 0.0002) for _ in range(8)]
        for k, b in enumerate(rays):
            bmesh.ops.rotate(b, verts=b.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(k * math.pi / 4, 3, "Z"))
        marks += [ring, W.join_bms(rays, "rays")]
    for m in marks:
        W.finish_small(m, "wp_label")
    knob = W.merge([skirt] + marks, f"display_knob_{name}")
    knob.data.transform(Matrix.Translation((STRIP_X, ky, Z_STRIP - 0.0016)))
    return knob


def build_plate():
    """The oval swivel plate: a seat for the cradle across its middle and an oval pocket either side (ST p.28 fig. 2)."""
    a, b, y0, y1 = PLATE
    plate = W.ob_from(W.prism(W.ellipse(0, 0, a, b, 48), "y", y0, y1), "pl")
    W.boolean(plate, W.ob_from(W.cylinder_bm(PIVOT, "x", RC + 0.0006, 0.114, 48), "seat"))
    for s in (-1, 1):
        W.boolean(plate, W.ob_from(W.prism(W.ellipse(s * 0.066, 0.0, 0.012, 0.03, 24), "y", y1 - 0.004, y1 + 0.01), "pk"))
    W.finish_small(plate, "wp_dark", 50)
    return plate


def build_foot():
    r, y0, y1 = DISC
    disc = W.ob_from(W.cylinder_bm((0, (y0 + y1) / 2, 0), "y", r, y1 - y0, 56), "display_foot")
    W.boolean(disc, W.ob_from(W.cylinder_bm((0, y1, 0), "y", 0.012, 0.004, 32), "hub"))
    W.boolean(disc, W.ob_from(W.cylinder_bm((0, y0, 0), "y", BOSS[0], 2 * BOSS[1], 48), "boss"))
    return W.finish_small(disc, "wp_pearl", 50)


def clearance_check(meshes):
    """The cabinet and frame against the plate's top and the module's top, over the tilt range (the swivel turns
    about y and so changes no height)."""
    bad = []
    py, pz = PIVOT[1], PIVOT[2]
    for ob in meshes:
        vs = [v.co.copy() for v in ob.data.vertices]
        for deg in (0, 5, 10, 15, 20):
            a = math.radians(deg)            # rotation.x = -a in three.js: the top goes back, the front rises
            lo = min(py + (v.z - pz) * math.sin(a) + (v.y - py) * math.cos(a) for v in vs
                     if math.hypot(v.y - py, v.z - pz) > RC + 0.0005)
            if lo < PLATE[3] + 0.0015:
                bad.append(f"{ob.name} at tilt {deg}: lowest point {lo * 1000:.1f} mm")
    if bad:
        print("CLEARANCE FAILED:\n  " + "\n  ".join(bad))
        sys.exit(1)
    print("clearance ok")


def main():
    W.reset()
    frame = W.finish(build_frame(), "wp_pearl", 0.0012)
    frame.name = "display_frame"
    cab = W.finish(build_cabinet(), "wp_pearl", 0.0014)
    clearance_check([frame, cab])
    baffle = top_vents(cab)
    W.smooth(cab)
    W.box_uv(cab)
    cab = W.merge([cab, baffle], "display_cabinet")
    bezel = build_bezel()
    badge = build_badge()
    knobs = [build_knob(n, y) for n, y in KNOBS]
    plate = build_plate()
    plate.name = "display_plate"
    foot = build_foot()
    meshes = [frame, cab, bezel, badge, plate, foot] + knobs
    for o in meshes:
        o.data.name = o.name
        W.to_blender(o)
    swivel = W.node("display_swivel", (0, 0, 0))
    tilt = W.node("display_tilt", PIVOT, swivel, (0, 0, 0))
    W.attach(plate, swivel, (0, 0, 0))
    for o in (frame, cab, bezel, badge):
        W.attach(o, tilt, PIVOT)
    for k, (_, ky) in zip(knobs, KNOBS):
        W.pivot_mesh(k, (STRIP_X, ky, Z_STRIP), tilt, PIVOT)
    # The tube face in the tilt node's frame: the glass's centre bulges 20 mm ahead of its corners; the corners sit
    # where the glass's edge stays behind the opening's edge all round.
    r, w, h = GLASS["radius"], GLASS["w"], GLASS["h"]
    corner = math.sqrt(r * r - (w * w + h * h) / 4)
    mid_top = math.sqrt(r * r - (OPEN[3] / 2) ** 2) - corner
    z_corners = Z_OPEN - 0.002 - mid_top            # 2 mm behind the opening's edge all round
    face = dict(x=OPEN[0] - PIVOT[0], y=OPEN[1] - PIVOT[1], z=round(z_corners - PIVOT[2], 5), **GLASS)
    tilt["face"] = json.dumps(face)
    print("face", face, "glass centre z", round(z_corners + r - corner, 4))
    W.report(meshes)
    W.export(OUT, extras=True)


if __name__ == "__main__":
    main()
