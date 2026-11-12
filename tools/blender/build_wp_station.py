"""Builds public/assets/models/wp_station.glb, the word processor's electronics module (the base of the display station).

  /root/bpyenv/bin/python tools/blender/build_wp_station.py

483 x 356 x 178 mm (HW 1.2), after the owner's photographs of the module (docs/displaywriter/refs/owner/module_*;
models.md, Display station). A one-piece top cover whose front edge rolls over with a large radius sits on a base tray;
they part about 0.38 of the way up. On top, the display's turntable: a large rounded-square dish with a drafted wall,
and in it a round boss with the interlock keyhole, two tabs and a pin hole (PSM p.46, ST p.28). At the front left, the
power switch's shallow rounded well, cut where the top rolls over (CSG p.40); at the front right, just above the
parting line, the black badge. Vent slots run straight through both mouldings' sides in two bands. The base stands on
four rubber feet, with a groove underneath for the keyboard cable (CSG p.27). At the back, two black panels set into
recesses across the parting line: panel 1 (status LEDs A-H behind a smoked window, sockets 0-7) and panel 2, the
power supply's back (8 AC out, 9 AC in, fuse, 10, 11) (PH module_rear_panel, Displaywriter_back.JPG; CSG p.27); the
label plate beside it; the display cable on socket 2.

The power switch is a small red rocker of the usual kind, its paddle sitting nearly flush in the well's floor and
rocking left and right about an axle running front to back; I (on) on the right (PH module_front_power_switch).

Nodes (unit coordinates, origin on the desk under the module's centre; all identity except station_rocker, whose
origin is the rocker's axle, and station_led_a ... station_led_h, each at its LED's centre): station_cover,
station_base, station_badge, station_panels, station_switch, station_feet, station_interior, station_cable,
station_rocker, station_led_a ... station_led_h.
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
PART = 0.068                  # parting line between the base tray and the top cover, about 0.38 of the height (PH module_side_*, _rear_panel)
GAP = 0.0008
T = 0.003                     # wall
R_PLAN = 0.030                # plan corners
R_NOSE = 0.036                # the front edge rolls over with a large radius (PH module_front, module_side_vents_left)
R_REAR = 0.030                # the rear top edge (PH module_rear_panel, module_rear_led_column)
TT = (0.0, -0.004)            # turntable centre (x, z): the display's place, wordproc1980.js units.display.at
DISH_HALF, DISH_R, DISH_D, DISH_WALL = 0.137, 0.088, 0.0055, 0.007   # rounded-square dish: half size, corners, depth, wall run
BOSS_R, BOSS_TOP = 0.070, H - 0.0006                                # the round turntable boss in the dish
SW_X, SW_W, SW_D, SW_DEPTH = -0.157, 0.066, 0.036, 0.009             # switch well: centre x, width, depth front to back, floor depth
SW_Z = ZF - 0.016 - SW_D / 2                                         # its front wall stands on the roll of the front edge
SW_FLOOR = H - SW_DEPTH
AXLE = (SW_X, SW_FLOOR - 0.004, SW_Z)                                # the rocker's axle, running front to back
ROCK = 0.16                   # rad either way of centre; also the slope of each half of the paddle's top
PADDLE = (0.017, 0.0075)      # the rocker paddle's half length (x) and half depth (z)
# Rear panels, measured on PH module_rear_panel (the module's width as the scale): panel 1 (left as seen from the back)
# and panel 2, the power supply's back, both reaching across the parting line nearly to the foot. The sockets on them
# keep the layout measured on PH Displaywriter_back.JPG for panels of the earlier size (LAYOUT), scaled to these.
P1 = dict(cx=0.119, w=0.191, y0=0.018, y1=0.136)
P2 = dict(cx=-0.081, w=0.155, y0=0.013, y1=0.108)
LAYOUT = {1: (0.215, 0.104), 2: (0.165, 0.098)}
CABLE_X = -0.012              # keyboard cable groove under the base
BADGE = (0.196, PART + 0.0185, 0.038, 0.028)                         # module badge: centre x, y, w, h (PH module_front)
VENTS = (  # slot bands through each side (PH module_side_vents_left and _right): z from, z to, y from, y to
    (-0.112, 0.129, PART + 0.016, H - 0.030),
    (-0.103, 0.105, FEET + 0.010, PART - 0.008),
)


def solid(i=0.0, y0=None, y1=None, seg=6):
    """The module's outer form inset by i: side profile (rolled front, rounded rear top), plan corners, top side edges.
    seg=1 gives chords for the arcs: the cheap inside of a shell, never seen."""
    lo = FEET + i if y0 is None else y0
    hi = H - i if y1 is None else y1
    prof = W.round_poly([(ZF - i, lo), (ZF - i, H - i), (ZR + i, H - i), (ZR + i, lo)],
                        [0.005, max(0.001, R_NOSE - i), max(0.001, R_REAR - i), 0.005], seg=seg + 2)
    ob = W.ob_from(W.prism(prof, "x", -X + i, X - i), "s")
    W.boolean(ob, W.ob_from(W.prism(W.rounded_rect(-X + i, ZR + i, X - i, ZF - i, R_PLAN - 0.7 * i, seg=seg), "y", lo - 0.01, hi + 0.01), "p"), "INTERSECT")
    W.boolean(ob, W.ob_from(W.prism(W.rounded_rect(-X + i, lo - 0.02, X - i, H - i, max(0.001, 0.010 - i), seg=min(seg, 4), rb=0), "z", ZR - 0.01, ZF + 0.01), "e"), "INTERSECT")
    if y1 is not None or y0 is not None:
        W.boolean(ob, W.ob_from(W.box_bm(-1, lo, -1, 1, hi, 1), "c"), "INTERSECT")
    return ob


def vent_slots(ob, z0, z1, y0, y1, pitch=0.006, w=0.0024):
    """Vertical slots straight through both side walls, cut after the bevel so their small edges stay crisp and cheap."""
    bms = []
    n = int((z1 - z0) / pitch)
    zs = z0 + ((z1 - z0) - n * pitch) / 2
    for side in (-1, 1):
        xs = side * X
        for k in range(n + 1):
            z = zs + k * pitch
            bms.append(W.box_bm(xs - 0.02, y0, z - w / 2, xs + 0.02, y1, z + w / 2))
    W.boolean(ob, W.join_bms(bms, "slots"))


def rear_cutouts(ob):
    for p in (P1, P2):
        r = W.rounded_rect(p["cx"] - p["w"] / 2 - 0.002, p["y0"] - 0.002, p["cx"] + p["w"] / 2 + 0.002, p["y1"] + 0.002, 0.006)
        W.boolean(ob, W.ob_from(W.prism(r, "z", ZR - 0.01, ZR + 0.02), "rc"))


def keyboard_groove(ob):
    g = W.rounded_rect(CABLE_X - 0.012, FEET - 0.01, CABLE_X + 0.012, FEET + 0.012, 0.004, rb=0)
    W.boolean(ob, W.ob_from(W.prism(g, "z", ZR - 0.01, ZF + 0.01), "kg"))


def square(cx, cz, half, r, seg=7):
    return W.rounded_rect(cx - half, cz - half, cx + half, cz + half, r, seg=seg)


def build_cover():
    cover = solid(0.0, y0=PART + GAP / 2)
    W.boolean(cover, solid(T, seg=1), "DIFFERENCE")
    cx, cz = TT
    # Thickening under the dish and round the switch well, so the recesses keep a wall.
    W.boolean(cover, W.ob_from(W.prism(square(cx, cz, DISH_HALF + T, DISH_R + T, 4), "y", H - DISH_D - T, H - 0.001), "t"), "UNION")
    liner = W.ob_from(W.box_bm(SW_X - SW_W / 2 - T, SW_FLOOR - T, SW_Z - SW_D / 2 - T, SW_X + SW_W / 2 + T, H, ZF), "l")
    W.boolean(liner, solid(0.0), "INTERSECT")
    W.boolean(cover, liner, "UNION")
    # The turntable dish: a large rounded square with a drafted wall (PH module_front, module_rear_panel), and the round
    # boss standing in it with the interlock keyhole, its two tabs and a pin hole (PSM p.46, ST p.28 fig. 2).
    dish = W.loft(square(cx, cz, DISH_HALF - DISH_WALL, DISH_R - DISH_WALL), H - DISH_D, square(cx, cz, DISH_HALF + 0.001, DISH_R + 0.001), H + 0.0005)
    dish = W.ob_from(dish, "d")
    W.boolean(cover, dish)
    boss = W.ob_from(W.loft(W.ellipse(cx, cz, BOSS_R + 0.003, BOSS_R + 0.003, 48), H - DISH_D - 0.001, W.ellipse(cx, cz, BOSS_R, BOSS_R, 48), BOSS_TOP), "b")
    W.boolean(boss, W.ob_from(W.cylinder_bm((cx, BOSS_TOP, cz), "y", BOSS_R - 0.004, 0.0016, 48), "r"))
    W.boolean(cover, boss, "UNION")
    floor = BOSS_TOP - 0.0008
    key = W.round_poly([(cx - 0.004, cz - 0.030), (cx + 0.004, cz - 0.030), (cx + 0.004, cz + 0.030), (cx - 0.004, cz + 0.030),
                        (cx - 0.004, cz + 0.008), (cx - 0.010, cz + 0.006), (cx - 0.010, cz - 0.006), (cx - 0.004, cz - 0.008)],
                       [0.001] * 8, seg=2)
    W.boolean(cover, W.ob_from(W.prism(key, "y", floor - 0.02, floor + 0.001), "k"))
    W.boolean(cover, W.ob_from(W.cylinder_bm((cx + 0.017, floor, cz - 0.026), "y", 0.003, 0.02, 16), "pin"))
    # The switch well: a shallow rounded rectangle cut into the top where it rolls over the front edge, so its front
    # runs out on the curve (PH module_front_power_switch, desk_station_keyboard_diskette; CSG p.40).
    well_top = W.rounded_rect(SW_X - SW_W / 2, SW_Z - SW_D / 2, SW_X + SW_W / 2, SW_Z + SW_D / 2, 0.010, seg=6)
    well_floor = W.rounded_rect(SW_X - SW_W / 2 + 0.003, SW_Z - SW_D / 2 + 0.003, SW_X + SW_W / 2 - 0.003, SW_Z + SW_D / 2 - 0.003, 0.007, seg=6)
    scoop = W.ob_from(W.loft(well_floor, SW_FLOOR, well_top, SW_FLOOR + 0.0045), "sc")
    W.boolean(scoop, W.ob_from(W.prism(well_top, "y", SW_FLOOR + 0.004, H + 0.01), "sc2"), "UNION")
    W.boolean(cover, scoop)
    # The slot in its floor the paddle rocks in; the switch's dark body shows below it.
    hl, hw = PADDLE
    W.boolean(cover, W.ob_from(W.prism(W.rounded_rect(SW_X - hl - 0.0009, SW_Z - hw - 0.0008, SW_X + hl + 0.0009, SW_Z + hw + 0.0008, 0.0006, seg=2), "y", SW_FLOOR - 0.02, SW_FLOOR + 0.002), "slot"))
    # Badge recess at the front right, just above the parting line (PH module_front, BRO p.18).
    bx, by, bw, bh = BADGE
    W.boolean(cover, W.ob_from(W.prism(W.rounded_rect(bx - bw / 2 - 0.0005, by - bh / 2 - 0.0005, bx + bw / 2 + 0.0005, by + bh / 2 + 0.0005, 0.0015), "z", ZF - 0.0012, ZF + 0.01), "b"))
    rear_cutouts(cover)
    return cover


def build_base():
    base = solid(0.0, y1=PART - GAP / 2)
    W.boolean(base, solid(T, seg=1), "DIFFERENCE")
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


def at1(u, v):
    """Panel 1's point u from its left edge as seen from the back (its +x edge) and v down from its top, in the layout
    measured for the earlier panel size."""
    w, h = LAYOUT[1]
    return P1["cx"] + P1["w"] / 2 - u * P1["w"] / w, P1["y1"] - v * (P1["y1"] - P1["y0"]) / h


def at2(u, v):
    w, h = LAYOUT[2]
    return P2["cx"] + P2["w"] / 2 - u * P2["w"] / w, P2["y1"] - v * (P2["y1"] - P2["y0"]) / h


def uv_face(ob, x0, y0, w, h, mat, flip=False):
    """A plate whose face gets uv 0..1 over (x0, y0, w, h), for artwork the view draws; flip mirrors u for a face seen
    from behind."""
    W.smooth(ob)
    W.assign(ob, mat)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            c = lp.vert.co
            u = (c.x - x0) / w
            lp[uv].uv = (1 - u if flip else u, (c.y - y0) / h)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def build_panels(leds, debug=False):
    """Both rear panels with everything on them. Rear-view positions u (from the panel's left edge as seen from the back,
    which is its +x edge) and v (down from its top) are measured on PH Displaywriter_back.JPG and CSG p.27."""
    objs = []
    zf = ZR + 0.003                     # the panel face, set into the opening
    for p in (P1, P2):
        plate = rounded_box(p["cx"] - p["w"] / 2, p["y0"], zf, p["cx"] + p["w"] / 2, p["y1"], zf + 0.004, 0.005, "plate")
        objs.append(W.finish(plate, "wp_dark", 0.0006))
    # Panel 1: the raised inner panel, LEDs A-H, sockets 0, 1, 2 (display), 3 (Memory Record button), 4 (covered),
    # 5 (diskette signal), 6A/6B (covered), 7 (keyboard).
    x0, y0 = at1(0.208, 0.100)
    x1, y1 = at1(0.007, 0.004)
    raised = rounded_box(x0, y0, zf - 0.0015, x1, y1, zf + 0.001, 0.008, "raised")
    objs.append(W.finish(raised, "wp_dark", 0.0008))
    zr = zf - 0.0015
    lx, ly = at1(0.014, 0.056)
    # The LED column: eight LEDs A-H behind a smoked window, the letters and the machine's type on a printed strip
    # beside it (PH module_rear_led_column; CSG p.27). Each LED is its own node, so the view can light it.
    strip = rounded_box(lx - 0.0035, ly - 0.029, zr - 0.0016, lx + 0.0035, ly + 0.029, zr + 0.0005, 0.0012, "strip")
    objs.append(W.finish_small(strip, "wp_window"))
    for i in range(8):
        led = W.ob_from(W.cylinder_bm((lx, ly + 0.0231 - i * 0.0066, zr - 0.0008), "z", 0.0015, 0.0012, 10), f"station_led_{'abcdefgh'[i]}")
        leds.append(W.finish_small(led, "wp_led"))
    lg = W.ob_from(W.prism(W.rounded_rect(lx - 0.0175, ly - 0.029, lx - 0.0045, ly + 0.029, 0.0, seg=1), "z", zr - 0.0004, zr + 0.0002), "station_legend")
    objs.append(uv_face(lg, lx - 0.0175, ly - 0.029, 0.013, 0.058, "wp_legend", flip=True))
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
        screws.append(W.cylinder_bm((cx, cy, zr - 0.0008), "z", 0.0017, 0.0016, 8, r2=0.0028))
    # Panel 2: 8 (switched AC out to the diskette unit), 9 (AC in), the fuse holder, 10 (DC out), 11 (communications).
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
            screws.append(W.cylinder_bm((cx, cy + s * (h / 2 + 0.006), zf - 0.0008), "z", 0.0015, 0.0016, 8, r2=0.0025))
    fx, fy = at2(0.127, 0.046)
    objs.append(W.finish_small(W.ob_from(W.cylinder_bm((fx, fy, zf - 0.005), "z", 0.0062, 0.01, 6), "fuse"), "wp_dark", 40))
    objs.append(W.finish_small(W.ob_from(W.cylinder_bm((fx, fy, zf - 0.0105), "z", 0.0052, 0.002, 16), "fcap"), "wp_dark"))
    for u, v, shell, flange in ((0.031, 0.086, 0.0389, 0.053), (0.116, 0.086, 0.0554, 0.069)):
        cx, cy = at2(u, v)
        objs += dsub(cx, cy, zf, shell, flange, "wp_metal", "wp_dark")
    for p in (P1, P2):
        for sx in (-1, 1):
            for yy in (p["y0"] + 0.005, p["y1"] - 0.005):
                screws.append(W.cylinder_bm((p["cx"] + sx * (p["w"] / 2 - 0.005), yy, zf - 0.0008), "z", 0.0016, 0.0016, 8, r2=0.0026))
    objs.append(W.finish_small(W.join_bms(screws, "screws"), "wp_metal"))
    # The machine's label plate beside panel 2 (PH module_rear_panel).
    tag = W.ob_from(W.prism(W.rounded_rect(-0.213, 0.012, -0.166, 0.056, 0.0015, seg=2), "z", ZR - 0.0006, ZR + 0.002), "tag")
    objs.append(uv_face(tag, -0.213, 0.012, 0.047, 0.044, "wp_tag", flip=True))
    if debug:
        for o in objs:
            print("PART", o.name, len(o.data.vertices), len(o.data.polygons))
    return W.merge(objs, "station_panels")


# ---------- the switch ----------

def build_switch():
    """The switch's black bezel, flush with the well's floor, round the slot the paddle rocks in, and the dark body
    below (PH module_front_power_switch: only a dark gap shows round the paddle)."""
    ax, ay, az = AXLE
    hl, hw = PADDLE
    rim = W.ob_from(W.prism(W.rounded_rect(ax - hl - 0.0028, az - hw - 0.0026, ax + hl + 0.0028, az + hw + 0.0026, 0.0015, seg=2), "y", SW_FLOOR - 0.0035, SW_FLOOR - 0.0008), "rim")
    W.boolean(rim, W.ob_from(W.prism(W.rounded_rect(ax - hl - 0.0009, az - hw - 0.0008, ax + hl + 0.0009, az + hw + 0.0008, 0.0006, seg=2), "y", SW_FLOOR - 0.01, SW_FLOOR + 0.01), "o"))
    body = W.ob_from(W.box_bm(ax - hl - 0.002, SW_FLOOR - 0.016, az - hw - 0.002, ax + hl + 0.002, SW_FLOOR - 0.0035, az + hw + 0.002), "body")
    W.finish_small(rim, "wp_dark")
    W.finish_small(body, "wp_dark")
    return W.merge([rim, body], "station_switch")


def build_rocker():
    """The red rocker paddle, built round its axle at the origin, then posed as a node at AXLE. A small paddle of the
    usual kind (PH module_front_power_switch, desk_station_keyboard_diskette): its top is two flats meeting in a
    shallow valley over the axle, each rising ROCK toward its end, so whichever end is pressed lies level and the other
    stands about 6 mm proud of the well's floor; most of it sits below the floor in the switch body. O is moulded on the
    left half, I on the right."""
    hl, hw = PADDLE
    valley, under, ch = 0.0055, -0.0075, 0.0009
    end = valley + hl * math.tan(ROCK)
    prof = W.round_poly([(-hl, under), (hl, under), (hl, end - ch), (hl - ch, end), (0.0, valley), (-hl + ch, end), (-hl, end - ch)],
                        [0.0004, 0.0004, 0.0005, 0.0005, 0.0, 0.0005, 0.0005], seg=2)
    paddle = W.ob_from(W.prism(prof, "z", -hw, hw), "paddle")
    W.bevel_finish(paddle, width=0.0004, segs=1, angle=20)
    W.assign(paddle, "wp_red")
    W.box_uv(paddle)
    # I: a raised bar across the right half (front to back, PH); O: a ring on the left half. Each lies on its flat.
    bar = W.box_bm(-0.00045, 0.0, -0.0032, 0.00045, 0.00025, 0.0032)
    bmesh.ops.transform(bar, matrix=Matrix.Translation((hl * 0.5, valley + (end - valley) * 0.5, 0)) @ Matrix.Rotation(ROCK, 4, "Z"), verts=bar.verts)
    mo = W.ob_from(bar, "marks")
    ro = W.ob_from(W.cylinder_bm((0, 0.00012, 0), "y", 0.0027, 0.00025, 20), "ring")
    W.boolean(ro, W.ob_from(W.cylinder_bm((0, 0.00012, 0), "y", 0.0019, 0.002, 20), "h"))
    ro.data.transform(Matrix.Translation((-hl * 0.5, valley + (end - valley) * 0.5, 0)) @ Matrix.Rotation(-ROCK, 4, "Z"))
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
    """The black badge with IBM and "Displaywriter System" (PH module_front_power_switch), its face uv 0..1 for the
    view's artwork."""
    bx, by, bw, bh = BADGE
    b = rounded_box(bx - bw / 2, by - bh / 2, ZF - 0.0011, bx + bw / 2, by + bh / 2, ZF - 0.0002, 0.0012, "station_badge")
    return uv_face(b, bx - bw / 2, by - bh / 2, bw, bh, "wp_mbadge")


def build_cable():
    """The display cable: from the display's underside, over the module's rear edge, down to socket 2 (CSG p.27)."""
    import bpy
    sx, sy = at1(0.184, 0.024)
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
    W.finish(base, "wp_pearl", 0.0012, 1)
    for ob, band in ((cover, VENTS[0]), (base, VENTS[1])):
        vent_slots(ob, *band)
        W.smooth(ob)
        W.box_uv(ob)
    cover.name, base.name = "station_cover", "station_base"
    badge = build_badge()
    leds = []
    panels = build_panels(leds)
    switch = build_switch()
    feet = build_feet()
    interior = build_interior()
    cable = build_cable()
    rocker = build_rocker()
    objs = [cover, base, badge, panels, switch, feet, interior, cable, rocker] + leds
    for o in objs:
        o.data.name = o.name
        W.to_blender(o)
    W.pivot_mesh(rocker, AXLE)
    for o in leds:                          # each LED its own node, origin at its centre
        c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
        o.data.transform(Matrix.Translation(-c))
        o.location = c
    W.report(objs)
    W.export(OUT)


if __name__ == "__main__":
    main()
