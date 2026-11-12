"""Builds public/assets/models/wp_station.glb, the word processor's electronics module (the base of the display station).

  /root/bpyenv/bin/python tools/blender/build_wp_station.py

483 x 356 x 178 mm (HW 1.2). Two mouldings meet at a parting line: a pearl-white top cover with a large bullnose along
its front edge, the display's turntable recess on top (a shallow dish and a central well with the interlock keyhole,
PSM p.46, ST p.28) and the power switch's scoop at the front left, cut into the bullnose (CSG p.37, p.40, ST p.28);
below it the base moulding on four rubber feet, with a groove underneath for the keyboard cable (CSG p.27). Both
mouldings carry a recessed vent panel on each side (PSM p.46, CSG p.23, p.37). The square badge is at the front right
(BRO p.18). At the back, the two black panels: panel 1 (status LEDs A-H, sockets 0-7) and panel 2, the power supply's
back (8 AC out, 9 AC in, fuse, 10, 11) (PH Displaywriter_back.JPG, inside.JPG, ps.JPG; CSG p.27), and the display
cable on socket 2.

The power switch is the real part: a red rocker paddle in a black housing on the power supply (PH inside.JPG), seen
through the scoop, rocking left and right about an axle running front to back; I (on) on the right (CSG p.40).

Nodes (unit coordinates, origin on the desk under the module's centre; all identity except station_rocker, whose
origin is the rocker's axle): station_cover, station_base, station_panels, station_switch, station_feet,
station_interior, station_cable, station_rocker.
"""
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
OUT = os.path.join(ROOT, "public", "assets", "models", "wp_station.glb")

X, H, ZF, ZR = 0.2415, 0.178, 0.178, -0.178
FEET = 0.006                  # underside of the base above the desk
PART = 0.095                  # parting line between the base and the top cover (BRO p.1, p.18)
GAP = 0.0008
T = 0.003                     # wall
R_PLAN = 0.030                # plan corners
R_NOSE = 0.026                # the front bullnose
TT = (0.0, -0.004)            # turntable centre (x, z): the display's place, wordproc1980.js units.display.at
DISH_R, DISH_D = 0.1285, 0.003
WELL_R, WELL_D = 0.065, 0.009
SW_X, SW_W, SW_D, SW_FLOOR = -0.157, 0.066, 0.048, H - 0.021      # switch scoop: centre x, width, depth, floor
AXLE = (SW_X, H - 0.0135, ZF - 0.025)                                 # the rocker's axle, running front to back
ROCK = 0.16                   # rad either way of centre
P1 = dict(cx=0.110, w=0.215, y0=0.056, y1=0.160)                    # rear panel 1 (left as seen from the back)
P2 = dict(cx=-0.0915, w=0.165, y0=0.044, y1=0.142)                  # rear panel 2, the power supply's back
CABLE_X = -0.012              # keyboard cable groove under the base
COVER_VENT = (PART + 0.012, H - 0.022)
BASE_VENT = (FEET + 0.016, PART - 0.012)


def solid(i=0.0, y0=None, y1=None, seg=6):
    """The module's outer form inset by i: side profile (bullnose front, rounded rear top), plan corners, top side edges.
    seg=1 gives chords for the arcs: the cheap inside of a shell, never seen."""
    lo = FEET + i if y0 is None else y0
    hi = H - i if y1 is None else y1
    prof = W.round_poly([(ZF - i, lo), (ZF - i, H - i), (ZR + i, H - i), (ZR + i, lo)],
                        [0.005, max(0.001, R_NOSE - i), max(0.001, 0.012 - i), 0.005], seg=seg)
    ob = W.ob_from(W.prism(prof, "x", -X + i, X - i), "s")
    W.boolean(ob, W.ob_from(W.prism(W.rounded_rect(-X + i, ZR + i, X - i, ZF - i, R_PLAN - 0.7 * i, seg=seg), "y", lo - 0.01, hi + 0.01), "p"), "INTERSECT")
    W.boolean(ob, W.ob_from(W.prism(W.rounded_rect(-X + i, lo - 0.02, X - i, H - i, max(0.001, 0.012 - i), seg=min(seg, 4), rb=0), "z", ZR - 0.01, ZF + 0.01), "e"), "INTERSECT")
    if y1 is not None or y0 is not None:
        W.boolean(ob, W.ob_from(W.box_bm(-1, lo, -1, 1, hi, 1), "c"), "INTERSECT")
    return ob


VENT_Z = (-0.150, 0.140)
VENT_SLOTS_TO = 0.020          # the slots fill the rear two thirds of each panel (PSM p.46)


def vent_recess(ob, y0, y1):
    """A recessed panel on each side of a moulding, for the vents."""
    for side in (-1, 1):
        rec = W.rounded_rect(VENT_Z[0], y0, VENT_Z[1], y1, 0.006, seg=4)
        xs = side * X
        W.boolean(ob, W.ob_from(W.prism(rec, "x", xs - side * 0.0015, xs + side * 0.02), "rec"))


def vent_slots(ob, y0, y1, pitch=0.009, w=0.0024):
    """Vertical slots through the recessed panels, cut after the bevel so their small edges stay crisp and cheap."""
    bms = []
    for side in (-1, 1):
        xs = side * X
        z = VENT_Z[0] + 0.012
        while z <= VENT_SLOTS_TO + 1e-6:
            bms.append(W.box_bm(xs - 0.02, y0 + 0.007, z - w / 2, xs + 0.02, y1 - 0.007, z + w / 2))
            z += pitch
    W.boolean(ob, W.join_bms(bms, "slots"))


def rear_cutouts(ob):
    for p in (P1, P2):
        r = W.rounded_rect(p["cx"] - p["w"] / 2 - 0.002, p["y0"] - 0.002, p["cx"] + p["w"] / 2 + 0.002, p["y1"] + 0.002, 0.006)
        W.boolean(ob, W.ob_from(W.prism(r, "z", ZR - 0.01, ZR + 0.02), "rc"))


def keyboard_groove(ob):
    g = W.rounded_rect(CABLE_X - 0.012, FEET - 0.01, CABLE_X + 0.012, FEET + 0.012, 0.004, rb=0)
    W.boolean(ob, W.ob_from(W.prism(g, "z", ZR - 0.01, ZF + 0.01), "kg"))


def build_cover():
    cover = solid(0.0, y0=PART + GAP / 2)
    W.boolean(cover, solid(T, seg=1), "DIFFERENCE")
    # Thickening under the turntable and round the switch scoop, so the recesses keep a wall.
    cx, cz = TT
    W.boolean(cover, W.ob_from(W.cylinder_bm((cx, H - (DISH_D + T) / 2 - 0.0005, cz), "y", DISH_R + T, DISH_D + T, 48), "t"), "UNION")
    W.boolean(cover, W.ob_from(W.cylinder_bm((cx, H - (DISH_D + WELL_D + T) / 2, cz), "y", WELL_R + T, DISH_D + WELL_D + T, 36), "t"), "UNION")
    liner = W.ob_from(W.box_bm(SW_X - SW_W / 2 - T, SW_FLOOR - T, ZF - SW_D - T, SW_X + SW_W / 2 + T, H, ZF), "l")
    W.boolean(liner, solid(0.0), "INTERSECT")
    W.boolean(cover, liner, "UNION")
    # The turntable: a shallow dish with a sloped wall, and the well the display's foot keys into.
    W.boolean(cover, W.ob_from(W.cylinder_bm((cx, H - DISH_D / 2 + 0.002, cz), "y", DISH_R - 0.003, DISH_D + 0.004, 72, r2=DISH_R + 0.001), "d"))
    W.boolean(cover, W.ob_from(W.cylinder_bm((cx, H - DISH_D - WELL_D / 2 + 0.001, cz), "y", WELL_R - 0.002, WELL_D + 0.002, 48, r2=WELL_R), "w"))
    # Interlock keyhole in the well floor: a bow-tie slot and a round centre (ST p.28, PSM p.46).
    key = W.rounded_rect(cx - 0.018, cz - 0.004, cx + 0.018, cz + 0.004, 0.003)
    floor = H - DISH_D - WELL_D
    W.boolean(cover, W.ob_from(W.prism(key, "y", floor - 0.01, floor + 0.001), "k"))
    W.boolean(cover, W.ob_from(W.cylinder_bm((cx, floor, cz), "y", 0.0065, 0.02, 32), "k"))
    # The switch scoop, through the bullnose: rounded in plan at the back, rounded at its lower corners in front.
    scoop = W.ob_from(W.prism(W.rounded_rect(SW_X - SW_W / 2, ZF - SW_D, SW_X + SW_W / 2, ZF + 0.03, 0.011), "y", SW_FLOOR, H + 0.01), "sc")
    W.boolean(scoop, W.ob_from(W.prism(W.rounded_rect(SW_X - SW_W / 2, SW_FLOOR - 0.01, SW_X + SW_W / 2, H + 0.02, 0.0, rb=0.010), "z", ZF - 0.1, ZF + 0.1), "f"), "INTERSECT")
    W.boolean(cover, scoop)
    # Badge recess at the front right (BRO p.18, CSG p.37).
    W.boolean(cover, W.ob_from(W.prism(W.rounded_rect(0.212 - 0.0145, 0.1165 - 0.0145, 0.212 + 0.0145, 0.1165 + 0.0145, 0.002), "z", ZF - 0.0012, ZF + 0.01), "b"))
    vent_recess(cover, *COVER_VENT)
    rear_cutouts(cover)
    return cover


def build_base():
    base = solid(0.0012, y1=PART - GAP / 2)
    W.boolean(base, solid(T, seg=1), "DIFFERENCE")
    vent_recess(base, *BASE_VENT)
    rear_cutouts(base)
    keyboard_groove(base)
    return base


# ---------- rear panels and sockets ----------

def dsub(cx, cy, z, shell_w, flange_w, metal, dark, plug_depth=0.0):
    """A D-sub socket on a panel whose face is at z, facing -z: flange, D shell with its insert, hex standoffs."""
    fl = W.ob_from(W.prism(W.rounded_rect(cx - flange_w / 2, cy - 0.0063, cx + flange_w / 2, cy + 0.0063, 0.0012, seg=2), "z", z - 0.0008, z + 0.0002), "fl")
    tw, bw, hh = shell_w / 2, shell_w / 2 - 0.0018, 0.0042
    shell = W.round_poly([(cx - tw, cy + hh), (cx + tw, cy + hh), (cx + bw, cy - hh), (cx - bw, cy - hh)], [0.0012, 0.0012, 0.0016, 0.0016], seg=2)
    sh = W.ob_from(W.prism(shell, "z", z - 0.006, z - 0.0005), "sh")
    inner = W.round_poly([(cx - tw + 0.0008, cy + hh - 0.0008), (cx + tw - 0.0008, cy + hh - 0.0008), (cx + bw - 0.0008, cy - hh + 0.0008), (cx - bw + 0.0008, cy - hh + 0.0008)], [0.0008] * 4, seg=2)
    W.boolean(sh, W.ob_from(W.prism(inner, "z", z - 0.01, z - 0.0035), "in"))
    ins = W.ob_from(W.prism(inner, "z", z - 0.0036, z - 0.0005), "ins")
    posts = W.join_bms([W.cylinder_bm((cx + s * (flange_w / 2 - 0.0035), cy, z - 0.0035), "z", 0.0026, 0.0055, 6) for s in (-1, 1)], "posts")
    W.boolean(fl, posts, "UNION")
    W.boolean(fl, sh, "UNION")
    for o in (fl,):
        W.finish_small(o, metal)
    W.finish_small(ins, dark)
    return [fl, ins]


def rounded_box(x0, y0, z0, x1, y1, z1, r, name="rb", seg=3):
    return W.ob_from(W.prism(W.rounded_rect(x0, y0, x1, y1, r, seg=seg), "z", z0, z1), name)


def build_panels(debug=False):
    """Both rear panels with everything on them. Rear-view positions u (from the panel's left edge as seen from the back,
    which is its +x edge) and v (down from its top) are measured on PH Displaywriter_back.JPG and CSG p.27."""
    objs = []
    zf = ZR + 0.003                     # the panel face, set into the opening
    for p in (P1, P2):
        plate = rounded_box(p["cx"] - p["w"] / 2, p["y0"], zf, p["cx"] + p["w"] / 2, p["y1"], zf + 0.004, 0.005, "plate")
        objs.append(W.finish(plate, "wp_dark", 0.0006))
    # Panel 1: the raised inner panel, LEDs A-H, sockets 0, 1, 2 (display), 3 (Memory Record button), 4 (covered),
    # 5 (diskette signal), 6A/6B (covered), 7 (keyboard).
    def at1(u, v):
        return P1["cx"] + P1["w"] / 2 - u, P1["y1"] - v
    x0, y0 = at1(0.208, 0.100)
    x1, y1 = at1(0.007, 0.004)
    raised = rounded_box(x0, y0, zf - 0.0015, x1, y1, zf + 0.001, 0.008, "raised")
    objs.append(W.finish(raised, "wp_dark", 0.0008))
    zr = zf - 0.0015
    lx, ly = at1(0.025, 0.060)
    strip = rounded_box(lx - 0.0035, ly - 0.034, zr - 0.0012, lx + 0.0035, ly + 0.034, zr + 0.0005, 0.0012, "strip")
    objs.append(W.finish_small(strip, "wp_label"))
    leds = W.join_bms([W.cylinder_bm((lx, ly + 0.0285 - i * 0.0082, zr - 0.0015), "z", 0.0016, 0.0018, 10) for i in range(8)], "leds")
    objs.append(W.finish_small(leds, "wp_led"))
    for u, v, shell, flange in ((0.078, 0.024, 0.0170, 0.031), (0.130, 0.024, 0.0170, 0.031), (0.184, 0.024, 0.0254, 0.039),
                                (0.168, 0.055, 0.0554, 0.069), (0.181, 0.086, 0.0254, 0.039)):
        cx, cy = at1(u, v)
        objs += dsub(cx, cy, zr, shell, flange, "wp_metal", "wp_dark")
    for u, v, w in ((0.094, 0.057, 0.041), (0.085, 0.086, 0.031), (0.130, 0.086, 0.031)):
        cx, cy = at1(u, v)
        cov = rounded_box(cx - w / 2, cy - 0.0075, zr - 0.0018, cx + w / 2, cy + 0.0075, zr + 0.0005, 0.0015, "cov")
        objs.append(W.finish_small(cov, "wp_dark"))
    bx, by = at1(0.057, 0.050)
    ring = W.ob_from(W.cylinder_bm((bx, by, zr - 0.002), "z", 0.0062, 0.004, 20), "ring")
    W.boolean(ring, W.ob_from(W.cylinder_bm((bx, by, zr - 0.004), "z", 0.0042, 0.006, 20), "h"))
    objs.append(W.finish_small(ring, "wp_dark"))
    objs.append(W.finish_small(W.ob_from(W.cylinder_bm((bx, by, zr - 0.0022), "z", 0.0038, 0.0044, 16), "btn"), "wp_gray"))
    screws = []
    for u, v in ((0.012, 0.010), (0.012, 0.094)):
        cx, cy = at1(u, v)
        screws.append(W.cylinder_bm((cx, cy, zr - 0.0008), "z", 0.0028, 0.0016, 8))
    # Panel 2: 8 (switched AC out to the diskette unit), 9 (AC in), the fuse holder, 10 (DC out), 11 (communications).
    def at2(u, v):
        return P2["cx"] + P2["w"] / 2 - u, P2["y1"] - v
    for u, v, h in ((0.037, 0.040, 0.040), (0.080, 0.040, 0.030)):
        cx, cy = at2(u, v)
        body = W.ob_from(W.prism(W.round_poly([(cx - 0.016, cy + h / 2 - 0.004), (cx, cy + h / 2), (cx + 0.016, cy + h / 2 - 0.004),
                                                (cx + 0.016, cy - h / 2 + 0.004), (cx, cy - h / 2), (cx - 0.016, cy - h / 2 + 0.004)], [0.003] * 6, seg=3), "z", zf - 0.004, zf), "iec")
        W.boolean(body, W.ob_from(W.prism(W.round_poly([(cx - 0.0122, cy + 0.0095), (cx + 0.0122, cy + 0.0095), (cx + 0.0122, cy - 0.0045),
                                                         (cx + 0.0072, cy - 0.0095), (cx - 0.0072, cy - 0.0095), (cx - 0.0122, cy - 0.0045)], [0.0012] * 6, seg=2), "z", zf - 0.01, zf - 0.001), "rec"))
        objs.append(W.finish_small(body, "wp_dark"))
        pins = [W.cylinder_bm((cx + dx, cy + dy, zf - 0.002), "z", 0.0011, 0.004, 8) for dx, dy in ((-0.007, -0.001), (0.007, -0.001), (0.0, 0.004))]
        objs.append(W.finish_small(W.join_bms(pins, "pins"), "wp_metal"))
        for s in (-1, 1):
            screws.append(W.cylinder_bm((cx, cy + s * (h / 2 + 0.006), zf - 0.0008), "z", 0.0025, 0.0016, 8))
    fx, fy = at2(0.127, 0.046)
    objs.append(W.finish_small(W.ob_from(W.cylinder_bm((fx, fy, zf - 0.005), "z", 0.0062, 0.01, 6), "fuse"), "wp_dark", 40))
    objs.append(W.finish_small(W.ob_from(W.cylinder_bm((fx, fy, zf - 0.0105), "z", 0.0052, 0.002, 16), "fcap"), "wp_dark"))
    for u, v, shell, flange in ((0.031, 0.086, 0.0389, 0.053), (0.116, 0.086, 0.0554, 0.069)):
        cx, cy = at2(u, v)
        objs += dsub(cx, cy, zf, shell, flange, "wp_metal", "wp_dark")
    for p in (P1, P2):
        for sx in (-1, 1):
            for yy in (p["y0"] + 0.005, p["y1"] - 0.005):
                screws.append(W.cylinder_bm((p["cx"] + sx * (p["w"] / 2 - 0.005), yy, zf - 0.0008), "z", 0.0026, 0.0016, 8))
    objs.append(W.finish_small(W.join_bms(screws, "screws"), "wp_metal"))
    if debug:
        for o in objs:
            print("PART", o.name, len(o.data.vertices), len(o.data.polygons))
    return W.merge(objs, "station_panels")


# ---------- the switch ----------

def build_switch():
    """The switch body in the floor of the scoop: a black housing round the paddle (PH inside.JPG)."""
    ax, ay, az = AXLE
    housing = W.ob_from(W.prism(W.rounded_rect(ax - 0.024, az - 0.015, ax + 0.024, az + 0.015, 0.003), "y", SW_FLOOR - 0.001, ay - 0.002), "hs")
    W.boolean(housing, W.ob_from(W.prism(W.rounded_rect(ax - 0.0205, az - 0.0115, ax + 0.0205, az + 0.0115, 0.0015), "y", ay - 0.012, ay + 0.01), "o"))
    return W.finish(housing, "wp_dark", 0.0006)


def build_rocker():
    """The red rocker paddle, built round its axle at the origin, then posed as a node at AXLE: a thick block with a
    flat top and chamfered ends (PH inside.JPG), the whole paddle tilting, so the pressed end is down and the other
    stands up; I is on the right (+x), O on the left."""
    hl, hw, top, under, ch = 0.0195, 0.0105, 0.0095, -0.007, 0.003
    valley = end = top
    prof = W.round_poly([(-hl, under), (hl, under), (hl, top - ch), (hl - ch, top), (-hl + ch, top), (-hl, top - ch)],
                        [0.001, 0.001, 0.0008, 0.0012, 0.0012, 0.0008], seg=3)
    paddle = W.ob_from(W.prism(prof, "z", -hw, hw), "paddle")
    boss = W.ob_from(W.cylinder_bm((0, 0, 0), "z", 0.0042, 2 * hw + 0.004, 24), "boss")
    W.boolean(paddle, boss, "UNION")
    W.finish(paddle, "wp_red", 0.0007)
    slope = math.atan2(end - valley, hl)
    marks = []
    # I: a raised bar across the right half of the top; O: a ring on the left half.
    bar = W.box_bm(-0.0006, 0.0, -0.0042, 0.0006, 0.00035, 0.0042)
    bmesh.ops.transform(bar, matrix=Matrix.Translation((hl * 0.5, valley + (end - valley) * 0.5, 0)) @ Matrix.Rotation(slope, 4, "Z"), verts=bar.verts)
    marks.append(bar)
    ring = W.cylinder_bm((0, 0.00018, 0), "y", 0.0034, 0.00035, 24)
    hole = W.ob_from(W.cylinder_bm((0, 0.00018, 0), "y", 0.0025, 0.002, 24), "h")
    ro = W.ob_from(ring, "ring")
    W.boolean(ro, hole)
    ro.data.transform(Matrix.Translation((-hl * 0.5, valley + (end - valley) * 0.5, 0)) @ Matrix.Rotation(-slope, 4, "Z"))
    mo = W.join_bms(marks, "marks")
    W.finish_small(mo, "wp_label")
    W.finish_small(ro, "wp_label")
    rocker = W.merge([paddle, mo, ro], "station_rocker")
    rocker.data.transform(Matrix.Translation(AXLE))
    return rocker


# ---------- the rest ----------

def build_feet():
    bms = [W.cylinder_bm((x, FEET / 2, z), "y", 0.012, FEET, 12, r2=0.0135) for x in (-0.205, 0.205) for z in (-0.145, 0.145)]
    return W.finish_small(W.join_bms(bms, "station_feet"), "wp_rubber")


def build_interior():
    """A dark box inside the shell, so the vents and the keyhole show the dark inside rather than the far wall lit through."""
    return W.finish(W.ob_from(W.box_bm(-X + 0.012, FEET + 0.008, ZR + 0.012, X - 0.012, H - 0.032, ZF - 0.012), "station_interior"), "wp_dark")


def build_badge():
    b = rounded_box(0.212 - 0.0135, 0.1165 - 0.0135, ZF - 0.0011, 0.212 + 0.0135, 0.1165 + 0.0135, ZF - 0.0002, 0.0018, "badge")
    return W.finish(b, "wp_dark", 0.0004, 1)


def build_cable():
    """The display cable: from the display's underside, over the module's rear edge, down to socket 2 (CSG p.27)."""
    import bpy
    sx = P1["cx"] + P1["w"] / 2 - 0.184
    sy = P1["y1"] - 0.024
    zf = ZR + 0.003 - 0.0015 - 0.006            # the socket's shell front
    plug = rounded_box(sx - 0.019, sy - 0.0085, zf - 0.028, sx + 0.019, sy + 0.0085, zf, 0.004, "plug")
    W.finish(plug, "wp_dark", 0.0012)
    pts = [(sx, sy, zf - 0.026), (sx - 0.002, sy + 0.002, zf - 0.046), (sx - 0.010, H - 0.004, ZR - 0.042),
           (0.024, H + 0.012, ZR - 0.012), (0.016, H + 0.009, ZR + 0.035), (0.012, H + 0.012, -0.095)]
    cu = bpy.data.curves.new("cable", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("NURBS")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1)
    sp.use_endpoint_u = True
    sp.order_u = 4
    sp.resolution_u = 6
    cu.bevel_depth = 0.0034
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    ob = bpy.data.objects.new("cable", cu)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    W.finish_small(ob, "wp_dark")
    return W.merge([plug, ob], "station_cable")


def main():
    W.reset()
    cover = build_cover()
    base = build_base()
    W.finish(cover, "wp_pearl", 0.0012, 1)
    W.finish(base, "wp_gray", 0.0012, 1)
    vent_slots(cover, *COVER_VENT)
    vent_slots(base, *BASE_VENT)
    for o in (cover, base):
        W.smooth(o)
        W.box_uv(o)
    cover.name, base.name = "station_cover", "station_base"
    badge = build_badge()
    cover = W.merge([cover, badge], "station_cover")
    panels = build_panels()
    switch = build_switch()
    feet = build_feet()
    interior = build_interior()
    cable = build_cable()
    rocker = build_rocker()
    objs = [cover, base, panels, switch, feet, interior, cable, rocker]
    switch.name = "station_switch"
    for o in objs:
        o.data.name = o.name
        W.to_blender(o)
    W.pivot_mesh(rocker, AXLE)
    W.report(objs)
    W.export(OUT)


if __name__ == "__main__":
    main()
