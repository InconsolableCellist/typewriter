"""Builds public/assets/models/wp_printer.glb, the 5218 printwheel printer with its sheet-feed paper handler.

  node tools/wp/export_printer.mjs                                  # wp_printer.json, if the definition changed
  /root/bpyenv/bin/python tools/blender/build_wp_printer.py [--preview]

Shapes follow the photographs (Bitsavers 5218/pictures, brochure G552-0323-1 p.18) and the manuals' figures (MIM p.20,
p.52, p.57, p.95, p.186; Setup Procedures p.1-1 to 3-14); measurements and choices are in docs/displaywriter/models.md,
Printer. Dimensions the mechanism and the soft bodies share (platen, print point, wheel, ribbon spools, carrier
travel, the slot, the cover's hinge and the feeder's plate) come from wp_printer.json. Covers are closed solids with
real wall thickness, cut by booleans and bevelled afterwards with weighted normals; UVs are box projected at one UV
unit = 0.2 m on the textured plastics, and laid out per face where the view draws on them (panel, keys, display,
acoustic filter, leadscrew thread, petal faces). The script exits 1 if a moving part touches what it must clear.

Nodes, in the printer's frame (origin on the desk under its centre, x right, y up, z to the operator); a moving node's
pivot is its origin:
  printer_body (cabinet, panel bezel, slot, rear panel, feet, badge), printer_panel (the black panel, UV 0..1 on its
  face), printer_display, printer_key0..7, printer_led0..9, printer_power (rocker), printer_cover (access cover, on its
  hinge), printer_frame (side frames, rails, motors, belt, paper pan), printer_platen, printer_bail, printer_feedrolls,
  printer_leadscrew, printer_cam, printer_carrier (selection motor, hammer coil, ribbon plate and cartridge,
  printwheel cartridge, cardholder), printer_ribbon_knob (on the ribbon plate, turns about y), printer_cartlogo (the
  ribbon cartridge's logo decal), printer_wheel (96 petals), printer_hammer (armature), printer_feeder (sheet feeder),
  printer_feeder_gate (paper insertion gate, turns about the stacker plate's normal), printer_tray0/1 (slide along z).
The mechanism is centred on x = 0; the cabinet's centre is cabinet.offsetX to the right of it (the photographs).
"""
import json
import math
import os
import sys

import bpy  # noqa: I001 (bpy first: it provides bmesh)
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "wp_printer.glb")
J = json.load(open(os.path.join(HERE, "wp_printer.json")))

UV_METRES = 0.2
M2B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # machine (x, y up, z front) to Blender

W, H, D = J["size"]
HW, HD = W / 2, D / 2
PC, PR, PL = J["platen"]["center"], J["platen"]["radius"], J["platen"]["length"]
CAB = J["cabinet"]
CAB_DX = CAB.get("offsetX", 0.0)          # the cabinet's centre is right of the mechanism's (PH 5218_1, BRO p.18)
TOP = CAB["top"]                         # the cabinet's top
CTOP = CAB["coverTop"]                   # the access cover and the slot's surround stand proud of it
HY, HZ = CAB["hinge"]                    # access cover hinge (y, z)
SLOT0, SLOT1 = CAB["slot"]               # slot from the filter's top edge back to the hinge
SLOT_HW = CAB["slotHalfWidth"]
FF = CAB["filterFoot"]                   # (y, z) of the filter's lower edge
FEED = CAB["feeder"]
WH = J["wheel"]
WC, WR = WH["center"], WH["radius"]
TBL = J["table"]                         # the stacker plate = the paper table

SEAM = 0.046                             # base to top cover
FOOT = 0.006                             # feet
T = 0.003                                # wall
GAP = 0.0012                             # panel gap
LIP = 0.164                              # the access cover's lip comes down the front face to here
CWF, CWR = 0.2205, 0.2135                # access cover half widths at the front and at the hinge (0.62 of the width, BRO p.18)
FACE = HD                                # front face plane


def plate_z(y):
    return TBL["tipZ"] + (y - TBL["tipY"]) * TBL["slope"]


# ---------- primitives (machine coordinates) ----------

def round_poly(pts, radii, seg=6):
    """Closed polygon of 2D points; corners with radius r replaced by arcs."""
    n = len(pts)
    out = []
    for i in range(n):
        p = Vector(pts[i])
        a = Vector(pts[i - 1]) - p
        b = Vector(pts[(i + 1) % n]) - p
        r = radii[i]
        if r <= 0:
            out.append((p.x, p.y))
            continue
        la, lb = a.length, b.length
        a /= la
        b /= lb
        half = math.acos(max(-1.0, min(1.0, a.dot(b)))) / 2
        d = min(r / math.tan(half), 0.49 * la, 0.49 * lb)
        rr = d * math.tan(half)
        c = p + (a + b).normalized() * (d / math.cos(half))
        p0, p1 = p + a * d - c, p + b * d - c
        a0, a1 = math.atan2(p0.y, p0.x), math.atan2(p1.y, p1.x)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for j in range(seg + 1):
            ang = a0 + da * j / seg
            out.append((c.x + rr * math.cos(ang), c.y + rr * math.sin(ang)))
    return out


def rrect(u0, v0, u1, v1, r, seg=4):
    pts = []
    for cx, cy, a0 in ((u1 - r, v1 - r, 0), (u0 + r, v1 - r, 90), (u0 + r, v0 + r, 180), (u1 - r, v0 + r, 270)):
        for j in range(seg + 1):
            a = math.radians(a0 + 90 * j / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def add_prism(bm, poly, axis, a0, a1):
    """A polygon extruded along an axis. axis 'x': poly (z, y); 'z': poly (x, y); 'y': poly (x, z)."""
    def v(u, w, a):
        if axis == "x":
            return Vector((a, w, u))
        if axis == "z":
            return Vector((u, w, a))
        return Vector((u, a, w))
    lo = [bm.verts.new(v(p[0], p[1], a0)) for p in poly]
    hi = [bm.verts.new(v(p[0], p[1], a1)) for p in poly]
    fl, fh = bm.faces.new(lo[::-1]), bm.faces.new(hi)
    side = []
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        side.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    bmesh.ops.recalc_face_normals(bm, faces=[fl, fh] + side)
    return [fl, fh] + side


def add_box(bm, x0, x1, y0, y1, z0, z1):
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))


def add_cyl(bm, axis, c, r, length, seg=24, r2=None):
    m = Matrix.Translation(c)
    if axis == "x":
        m = m @ Matrix.Rotation(math.pi / 2, 4, "Y")
    elif axis == "y":
        m = m @ Matrix.Rotation(-math.pi / 2, 4, "X")
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=length, matrix=m)


def add_rbox(bm, x0, x1, y0, y1, z0, z1, r, seg=2):
    t = bmesh.new()
    add_box(t, x0, x1, y0, y1, z0, z1)
    bmesh.ops.bevel(t, geom=list(t.edges) + list(t.verts), offset=min(r, (x1 - x0) / 2.2, (y1 - y0) / 2.2, (z1 - z0) / 2.2), segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    me = bpy.data.meshes.new("t")
    t.to_mesh(me)
    t.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def add_quad_prism(bm, quad, thick_dir, t):
    """A thin plate: 4 corner points and a thickness along a direction."""
    a = [bm.verts.new(Vector(p)) for p in quad]
    b = [bm.verts.new(Vector(p) + Vector(thick_dir) * t) for p in quad]
    fs = [bm.faces.new(a[::-1]), bm.faces.new(b)]
    for i in range(4):
        j = (i + 1) % 4
        fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def ob_from(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def solid(fn, name="s"):
    bm = bmesh.new()
    fn(bm)
    return ob_from(bm, name)


def prism_ob(poly, axis, a0, a1, name="p"):
    return solid(lambda bm: add_prism(bm, poly, axis, a0, a1), name)


def box_ob(x0, x1, y0, y1, z0, z1, name="b"):
    return solid(lambda bm: add_box(bm, x0, x1, y0, y1, z0, z1), name)


def boolean(a, b, op="DIFFERENCE", consume=True):
    mod = a.modifiers.new("b", "BOOLEAN")
    mod.operation = op
    mod.object = b
    mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = a
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if consume:
        bpy.data.objects.remove(b)


def join(obs, name):
    obs = [o for o in obs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def triangulate(ob):
    """Booleans leave concave n-gons (a rim round a cut); the bevel would fold them. Triangles bevel cleanly."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], quad_method="BEAUTY", ngon_method="EAR_CLIP")
    bm.to_mesh(ob.data)
    bm.free()


def bevel_finish(ob, width=0.001, segs=2, angle=32):
    triangulate(ob)
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.width = width
    mod.segments = segs
    mod.profile = 0.6
    mod.miter_outer = "MITER_ARC"
    mod.use_clamp_overlap = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    shade(ob, 40)
    wn = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    wn.weight = 100
    wn.keep_sharp = True
    wn.mode = "FACE_AREA"
    bpy.ops.object.modifier_apply(modifier=wn.name)


def shade(ob, angle=35):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle() < math.radians(angle)
        else:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


def box_uv(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        ax = max(range(3), key=lambda i: abs(f.normal[i]))
        for lp in f.loops:
            c = lp.vert.co
            pt = (c.z, c.y) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y)
            lp[uv].uv = (pt[0] / UV_METRES, pt[1] / UV_METRES)
    bm.to_mesh(ob.data)
    bm.free()


def face_uv(ob, u0, u1, v0, v1, normal_axis=2):
    """UV 0..1 over a rectangle of the faces looking along +z (x right, y up); other faces get 0."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        front = f.normal[normal_axis] > 0.7
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = ((c.x - u0) / (u1 - u0), (c.y - v0) / (v1 - v0)) if front else (0.0, 0.0)
    bm.to_mesh(ob.data)
    bm.free()


def strip_uv(ob):
    while ob.data.uv_layers:
        ob.data.uv_layers.remove(ob.data.uv_layers[0])


MATS = {}


def make_materials():
    spec = {
        "wp_pearl": ((0.74, 0.71, 0.64), 0.6, 0), "wp_gray": ((0.52, 0.51, 0.48), 0.6, 0), "wp_dark": ((0.035, 0.034, 0.033), 0.55, 0),
        "wp_trim": ((0.62, 0.50, 0.33), 0.55, 0), "wp_panel": ((0.02, 0.02, 0.022), 0.45, 0), "wp_rubber": ((0.02, 0.02, 0.02), 0.85, 0),
        "wp_metal": ((0.55, 0.55, 0.56), 0.35, 1), "wp_chrome": ((0.8, 0.8, 0.82), 0.15, 1), "wp_glass": ((0.06, 0.045, 0.04), 0.05, 0), "wp_foam": ((0.09, 0.08, 0.07), 0.95, 0),
        "wp_key_green": ((0.05, 0.42, 0.12), 0.4, 0), "wp_key_yellow": ((0.85, 0.55, 0.03), 0.4, 0), "wp_key_blue": ((0.22, 0.52, 0.80), 0.4, 0),
        "wp_led_red": ((0.25, 0.02, 0.02), 0.2, 0), "wp_led_green": ((0.03, 0.2, 0.05), 0.2, 0), "wp_led_amber": ((0.3, 0.17, 0.02), 0.2, 0),
        "wp_display": ((0.12, 0.02, 0.02), 0.2, 0), "wp_red": ((0.75, 0.08, 0.04), 0.45, 0), "wp_filter": ((0.12, 0.12, 0.13), 0.5, 0.5),
        "wp_wheel": ((0.75, 0.75, 0.72), 0.45, 0), "wp_petal": ((0.75, 0.75, 0.72), 0.45, 0), "wp_cartridge": ((0.05, 0.25, 0.18), 0.45, 0),
        "wp_white": ((0.8, 0.79, 0.75), 0.5, 0), "wp_screw": ((0.6, 0.6, 0.62), 0.3, 1), "wp_motor": ((0.08, 0.08, 0.085), 0.45, 0.5),
        "wp_paper": ((0.85, 0.85, 0.82), 0.8, 0), "wp_cable": ((0.55, 0.62, 0.62), 0.6, 0),
        "wp_badge": ((0.78, 0.74, 0.62), 0.4, 0.3), "wp_ribcart": ((0.07, 0.07, 0.075), 0.55, 0), "wp_cartlogo": ((0.10, 0.10, 0.10), 0.5, 0),
    }
    for name, (col, rough, met) in spec.items():
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        b = mat.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*col, 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = met
        if name == "wp_glass":
            b.inputs["Transmission Weight"].default_value = 0.25
        MATS[name] = mat


def assign(ob, name):
    ob.data.materials.clear()
    ob.data.materials.append(MATS[name])


# ---------- cabinet ----------

def cabinet_master(inset=0.0, y0=SEAM, y1=TOP):
    r = 0.020 - inset * 0.8
    side = round_poly([(-HD + inset, y0 - 0.02), (HD - inset, y0 - 0.02), (HD - inset, y1 - inset), (-HD + inset, y1 - inset)], [0, 0, r, r])
    front = round_poly([(-HW + inset, y0 - 0.02), (HW - inset, y0 - 0.02), (HW - inset, y1 - inset), (-HW + inset, y1 - inset)], [0, 0, r, r])
    plan = rrect(-HW + inset, -HD + inset, HW - inset, HD - inset, 0.03 - inset)
    ob = prism_ob(side, "x", -HW - 0.01, HW + 0.01, "m")
    boolean(ob, prism_ob(front, "z", -HD - 0.01, HD + 0.01), "INTERSECT")
    boolean(ob, prism_ob(plan, "y", y0 - 0.001 if not inset else y0 - 0.03, y1 + 0.01), "INTERSECT")
    ob.data.transform(Matrix.Translation((CAB_DX, 0, 0)))
    return ob


def cover_plan(extra=0.0):
    return [(-CWF - extra, HD + 0.02), (CWF + extra, HD + 0.02), (CWR + extra, HZ), (-CWR - extra, HZ)]


PANEL = dict(x0=-0.222, x1=0.219, y0=0.0569, y1=0.1303, ix0=-0.214, ix1=0.212, iy0=0.0653, iy1=0.1218, div=0.1147)
KEY = 0.0195
KEY_COLS = [(-0.0336, ), (-0.0125, ), (0.0269, ), (0.0469, )]
KEY_ROWS = [0.1029, 0.0823]
# Panel key order of the definition: start, stop, printTest, cancel, load, release, paperUp, paperDown (MIM p.180, PH 5218_1).
KEY_POS = [(KEY_COLS[0][0], KEY_ROWS[0]), (KEY_COLS[0][0], KEY_ROWS[1]), (KEY_COLS[1][0], KEY_ROWS[0]), (KEY_COLS[1][0], KEY_ROWS[1]),
           (KEY_COLS[2][0], KEY_ROWS[0]), (KEY_COLS[2][0], KEY_ROWS[1]), (KEY_COLS[3][0], KEY_ROWS[0]), (KEY_COLS[3][0], KEY_ROWS[1])]
KEY_MAT = ["wp_key_green", "wp_key_yellow", "wp_key_blue", "wp_key_blue", "wp_key_blue", "wp_key_blue", "wp_key_blue", "wp_key_blue"]
LED_X = [-0.203, -0.182, -0.160, -0.139, -0.117]
LED_Y = [0.0981, 0.0766]
# LED bit order of the controller: powerOn, onLine, ribbon, ready, exception, release, setup, loadPaper, changeFont, diag.
LED_POS = [(LED_X[0], LED_Y[0]), (LED_X[0], LED_Y[1]), (LED_X[1], LED_Y[0]), (LED_X[1], LED_Y[1]), (LED_X[2], LED_Y[0]),
           (LED_X[2], LED_Y[1]), (LED_X[3], LED_Y[0]), (LED_X[3], LED_Y[1]), (LED_X[4], LED_Y[0]), (LED_X[4], LED_Y[1])]
LED_MAT = ["wp_led_red", "wp_led_green"] + ["wp_led_amber", "wp_led_green"] + ["wp_led_amber"] * 6
DISPLAY = (-0.085, -0.061, 0.0924, 0.1117)
# The power switch 94 to 102 mm from the cabinet's right end (BRO p.18, PH 5218_1).
POWER = dict(x0=0.249, x1=0.295, y0=0.0465, y1=0.0899, rx=0.2720, ry=0.0653, rw=0.0186, rh=0.0226)
# Attachment panel recess down through the base band, 43 mm in from the cabinet's left end seen from the front (PH 5218_3).
REAR_PANEL = (-HW + CAB_DX + 0.043, -HW + CAB_DX + 0.152, 0.016, 0.163)
BADGE = (-0.262, -0.226, HD - 0.062, HD - 0.036)   # x0, x1, z0, z1: the IBM 5218 badge on the top at the front left (PH 5218_1, 5218_2)
MAGNET_X = 0.066                                   # the cover's magnetic latch, right of the scoop (PH 5218_2)
LATCH = [(-0.270, -0.240), (0.240, 0.270)]          # paper-handler latch openings beside the hinge (PH 5218_2)
LATCH_Z = (0.058, 0.108)
REAR_SQ = [(-0.241, -0.219), (0.219, 0.241)]
REAR_SQ_Z = (-0.290, -0.268)


def build_top_cover():
    top = cabinet_master()
    inner = cabinet_master(inset=T, y1=TOP)
    boolean(top, inner)
    # The access opening and the slot behind it, one cut.
    poly = [(-CWF - GAP, HD + 0.02), (CWF + GAP, HD + 0.02), (CWR + GAP, HZ - GAP), (SLOT_HW, HZ - GAP), (SLOT_HW, SLOT0), (-SLOT_HW, SLOT0), (-SLOT_HW, HZ - GAP), (-CWR - GAP, HZ - GAP)]
    boolean(top, prism_ob(poly, "y", LIP - GAP, TOP + 0.02))
    for x0, x1 in LATCH:
        boolean(top, prism_ob(rrect(x0, LATCH_Z[0], x1, LATCH_Z[1], 0.003), "y", TOP - 0.02, TOP + 0.02))
    for x0, x1 in REAR_SQ:
        boolean(top, prism_ob(rrect(x0, REAR_SQ_Z[0], x1, REAR_SQ_Z[1], 0.002), "y", TOP - 0.02, TOP + 0.02))
    # Finger scoop under the cover's lip, the recess for the tan strip under the panel, the rear panel recess, the fan grille.
    boolean(top, prism_ob(rrect(-0.034, 0.150, 0.034, LIP - GAP, 0.004), "z", FACE - 0.012, FACE + 0.01))
    boolean(top, prism_ob(rrect(PANEL["ix0"], SEAM + 0.001, PANEL["ix1"], PANEL["y0"] + 0.002, 0.001), "z", FACE - 0.006, FACE + 0.01))
    x0, x1, y0, y1 = REAR_PANEL
    boolean(top, prism_ob(rrect(x0, y0, x1, y1, 0.004), "z", -HD - 0.01, -HD + 0.016))
    for i in range(11):
        z = -0.272 + i * 0.0125
        boolean(top, box_ob(HW + CAB_DX - 0.012, HW + CAB_DX + 0.01, 0.078, 0.150, z - 0.003, z + 0.003))
    # The slot's surround at the cover's height: cheeks either side, and behind it the hood whose front is the
    # acoustic filter (PH 5218_1: the cover's window, the slot and the perforated filter in one raised recess).
    for sx in (-1, 1):
        boolean(top, box_ob(min(sx * SLOT_HW, sx * CWR), max(sx * SLOT_HW, sx * CWR), TOP - 0.001, CTOP, SLOT0 - 0.004, HZ - 0.004), "UNION")
    boolean(top, prism_ob(HOOD, "x", -CWR, CWR), "UNION")
    # The scoop is a closed pocket in the face (PH 5218_1 shows its light floor), not a hole into the cabinet.
    cup = box_ob(-0.0375, 0.0375, 0.1465, LIP - GAP - 0.0005, FACE - 0.0155, FACE - T + 0.0005, "cup")
    boolean(cup, prism_ob(rrect(-0.034, 0.150, 0.034, LIP - GAP + 0.003, 0.004), "z", FACE - 0.012, FACE + 0.01))
    boolean(top, cup, "UNION")
    bevel_finish(top, 0.0012, 1)
    return top


# The hood behind the slot (z, y): its front face, from the filter's foot up to the cover's height, is the acoustic filter.
HOOD = [(FF[1], FF[0]), (SLOT0, CTOP), (SLOT0 - 0.018, CTOP), (SLOT0 - 0.038, TOP - 0.0015), (SLOT0 - 0.004, TOP - 0.0015), (FF[1] - 0.008, FF[0] - 0.002)]


def build_base():
    x, z = HW - 0.022, HD - 0.010
    ob = solid(lambda bm: add_prism(bm, rrect(-x, -z, x, z, 0.022), "y", FOOT, SEAM + 0.006), "base")
    inner = solid(lambda bm: add_prism(bm, rrect(-x + T, -z + T, x - T, z - T, 0.019), "y", FOOT + T, SEAM + 0.02), "bi")
    boolean(ob, inner)
    ob.data.transform(Matrix.Translation((CAB_DX, 0, 0)))
    x0, x1, y0, y1 = REAR_PANEL
    boolean(ob, box_ob(x0, x1, y0, SEAM + 0.02, -HD - 0.01, -HD + 0.016))
    bevel_finish(ob, 0.0016, 2)
    return ob


def build_feet():
    bm = bmesh.new()
    for x in (-HW + 0.07, HW - 0.07):
        for z in (-HD + 0.06, HD - 0.06):
            add_cyl(bm, "y", (x + CAB_DX, FOOT / 2, z), 0.016, FOOT, 16, 0.014)
    return ob_from(bm, "feet")


def build_bezel():
    P = PANEL
    fr = prism_ob(rrect(P["x0"], P["y0"], P["x1"], P["y1"], 0.004), "z", FACE - 0.002, FACE + 0.005, "bezel")
    boolean(fr, prism_ob(rrect(P["ix0"], P["iy0"], P["ix1"], P["iy1"], 0.002), "z", FACE - 0.01, FACE + 0.02))
    div = box_ob(P["div"] - 0.001, P["div"] + 0.001, P["iy0"], P["iy1"], FACE, FACE + 0.0038)
    strip = box_ob(P["ix0"] + 0.0005, P["ix1"] - 0.0005, SEAM + 0.0015, P["y0"] + 0.0015, FACE - 0.0055, FACE - 0.001)
    # The power switch's bezel at the front right (PH 5218_1).
    Q = POWER
    pb = prism_ob(rrect(Q["x0"], Q["y0"], Q["x1"], Q["y1"], 0.003), "z", FACE - 0.002, FACE + 0.004, "pb")
    boolean(pb, prism_ob(rrect(Q["rx"] - Q["rw"] / 2 - 0.0012, Q["ry"] - Q["rh"] / 2 - 0.0012, Q["rx"] + Q["rw"] / 2 + 0.0012, Q["ry"] + Q["rh"] / 2 + 0.0012, 0.0015), "z", FACE - 0.001, FACE + 0.01))
    ob = join([fr, div, strip, pb], "bezel")
    bevel_finish(ob, 0.0007, 2)
    return ob


def build_panel():
    P = PANEL
    ob = prism_ob([(P["ix0"], P["iy0"]), (P["ix1"], P["iy0"]), (P["ix1"], P["iy1"]), (P["ix0"], P["iy1"])], "z", FACE - 0.008, FACE + 0.0025, "printer_panel")
    for x, y in KEY_POS:
        h = KEY / 2 + 0.0007
        boolean(ob, box_ob(x - h, x + h, y - h, y + h, FACE - 0.006, FACE + 0.01))
    d = DISPLAY
    boolean(ob, box_ob(d[0], d[1], d[2], d[3], FACE + 0.0005, FACE + 0.01))
    face_uv(ob, P["ix0"], P["ix1"], P["iy0"], P["iy1"])
    return ob


def build_display():
    d = DISPLAY
    bm = bmesh.new()
    vs = [bm.verts.new((d[0], d[2], FACE + 0.0006)), bm.verts.new((d[1], d[2], FACE + 0.0006)), bm.verts.new((d[1], d[3], FACE + 0.0006)), bm.verts.new((d[0], d[3], FACE + 0.0006))]
    bm.faces.new(vs)
    ob = ob_from(bm, "printer_display")
    face_uv(ob, d[0], d[1], d[2], d[3])
    return ob


def build_keys():
    keys = []
    for i, (x, y) in enumerate(KEY_POS):
        bm = bmesh.new()
        add_rbox(bm, -KEY / 2, KEY / 2, -KEY / 2, KEY / 2, -0.0055, 0.0055, 0.0016, 2)
        ob = ob_from(bm, f"printer_key{i}")
        face_uv(ob, -KEY / 2, KEY / 2, -KEY / 2, KEY / 2)
        shade(ob, 40)
        assign(ob, KEY_MAT[i])
        keys.append((ob, (x, y, FACE)))
    return keys


def build_leds():
    leds = []
    for i, (x, y) in enumerate(LED_POS):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=0.0026, matrix=Matrix.Diagonal((1, 1, 0.7, 1)))
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.0001], context="VERTS")
        ob = ob_from(bm, f"printer_led{i}")
        shade(ob, 80)
        assign(ob, LED_MAT[i])
        leds.append((ob, (x, y, FACE + 0.0025)))
    return leds


def build_power():
    Q = POWER
    bm = bmesh.new()
    w, h = Q["rw"] / 2, Q["rh"] / 2
    # A rocker: its face a shallow V, the upper half standing proud.
    poly = [(-0.004, -h), (0.0035, -h), (0.0062, h * 0.05), (0.0035, h), (-0.004, h)]
    add_prism(bm, poly, "x", -w, w)                 # (z, y) pairs
    ob = ob_from(bm, "printer_power")
    bevel_finish(ob, 0.0006, 2)
    assign(ob, "wp_red")
    return ob, (Q["rx"], Q["ry"], FACE + 0.0005)


def build_rear_panel():
    x0, x1, y0, y1 = REAR_PANEL
    bm = bmesh.new()
    add_box(bm, x0 + 0.001, x1 - 0.001, y0 + 0.001, y1 - 0.001, -HD + 0.0130, -HD + 0.0160)
    rp = ob_from(bm, "rp")
    assign(rp, "wp_dark")
    # Round paper-handler socket, the DE-9 of the controller cable, the IEC inlet (PH 5218_3); seen from behind, x mirrors.
    bm = bmesh.new()
    cx = x0 + 0.020
    add_cyl(bm, "z", (cx, 0.140, -HD + 0.0100), 0.0135, 0.006, 20)
    add_box(bm, cx - 0.004, cx + 0.004, 0.152, 0.156, -HD + 0.0085, -HD + 0.0130)
    add_rbox(bm, cx - 0.0155, cx + 0.0155, 0.096, 0.108, -HD + 0.0100, -HD + 0.0135, 0.001, 1)
    add_rbox(bm, cx - 0.0110, cx + 0.0110, 0.052, 0.076, -HD + 0.0090, -HD + 0.0135, 0.002, 1)
    con = ob_from(bm, "con")
    assign(con, "wp_dark")
    bm = bmesh.new()
    add_rbox(bm, cx - 0.0085, cx + 0.0085, 0.0985, 0.1055, -HD + 0.0085, -HD + 0.0105, 0.002, 1)
    for i in range(3):
        add_box(bm, cx - 0.004 + i * 0.004 - 0.0008, cx - 0.004 + i * 0.004 + 0.0008, 0.060 + (i % 2) * 0.006, 0.066 + (i % 2) * 0.006, -HD + 0.0100, -HD + 0.0120)
    shell = ob_from(bm, "shell")
    assign(shell, "wp_metal")
    return [rp, con, shell]


def build_vent_backing():
    ob = box_ob(HW + CAB_DX - 0.016, HW + CAB_DX - 0.012, 0.072, 0.156, -0.282, -0.135, "vent")
    assign(ob, "wp_dark")
    return ob


def build_badge():
    """The IBM 5218 badge on the top at the front left (PH 5218_1, 5218_2): a plate 36 x 26 mm, uv 0..1 on its face for
    the view's artwork (v = 1 at its far edge)."""
    x0, x1, z0, z1 = BADGE
    bm = bmesh.new()
    add_box(bm, x0, x1, TOP - 0.001, TOP + 0.0006, z0, z1)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = ((c.x - x0) / (x1 - x0), (z1 - c.z) / (z1 - z0)) if f.normal.y > 0.7 else (0.0, 0.0)
    ob = ob_from(bm, "badge")
    assign(ob, "wp_badge")
    return ob


def build_ledge():
    """What the open cover shows on the cabinet's front edge (PH 5218_2): the magnetic latch the cover's keeper meets,
    right of the scoop, and a plate held by two screws at the left; and the acoustic foam over the base plate under the
    carrier (MIM p.63)."""
    bm = bmesh.new()
    add_box(bm, MAGNET_X - 0.016, MAGNET_X + 0.016, 0.148, LIP - GAP - 0.004, FACE - 0.018, FACE - T)
    mag = ob_from(bm, "magnet")
    assign(mag, "wp_gray")
    bm = bmesh.new()
    add_box(bm, MAGNET_X - 0.012, MAGNET_X + 0.012, LIP - GAP - 0.0046, LIP - GAP - 0.004, FACE - 0.014, FACE - 0.007)
    add_box(bm, -0.205, -0.150, 0.150, LIP - GAP - 0.0004, FACE - 0.022, FACE - T)
    pl = ob_from(bm, "ledge")
    assign(pl, "wp_metal")
    bm = bmesh.new()
    for x in (-0.196, -0.159):
        add_cyl(bm, "y", (x, LIP - GAP, FACE - 0.0145), 0.0028, 0.0012, 12)
    sc = ob_from(bm, "screws")
    shade(sc, 40)
    assign(sc, "wp_chrome")
    bm = bmesh.new()
    add_box(bm, -0.282, 0.282, 0.012, 0.0165, 0.100, 0.296)
    foam = ob_from(bm, "bfoam")
    assign(foam, "wp_foam")
    return [mag, pl, sc, foam]


def build_latch_floors():
    bm = bmesh.new()
    for x0, x1 in LATCH:
        add_box(bm, x0 - 0.002, x1 + 0.002, TOP - 0.024, TOP - 0.021, LATCH_Z[0] - 0.002, LATCH_Z[1] + 0.002)
    for x0, x1 in REAR_SQ:
        add_box(bm, x0 - 0.002, x1 + 0.002, TOP - 0.025, TOP - 0.022, REAR_SQ_Z[0] - 0.002, REAR_SQ_Z[1] + 0.002)
    ob = ob_from(bm, "lf")
    assign(ob, "wp_dark")
    return ob


def build_filter():
    """The acoustic filter, the slot's rear wall: a perforated plate from the slot floor up to the top (SET p.1-7)."""
    bm = bmesh.new()
    y0, z0 = FF
    y1, z1 = CTOP - 0.0012, SLOT0 + (z0 - SLOT0) * 0.0012 / (CTOP - y0)
    n = Vector((0, -(SLOT0 - z0), CTOP - y0)).normalized()   # out of the hood's face, toward the slot
    off = n * 0.0004
    quad = [(-SLOT_HW + 0.003, y0 + 0.002 + off.y, z0 + off.z), (SLOT_HW - 0.003, y0 + 0.002 + off.y, z0 + off.z), (SLOT_HW - 0.003, y1 + off.y, z1 + off.z), (-SLOT_HW + 0.003, y1 + off.y, z1 + off.z)]
    add_quad_prism(bm, quad, (0, -n.y, -n.z), 0.0006)
    ob = ob_from(bm, "filter")
    # UVs in metres along x and along the slope, so the view's perforation keeps its pitch.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = (c.x / UV_METRES, math.hypot(c.y - y0, c.z - z0) / UV_METRES)
    bm.to_mesh(ob.data)
    bm.free()
    assign(ob, "wp_filter")
    return ob


def build_paper_guide():
    """The left paper guide on the filter's top edge, and the alignment triangle (SET p.1-7): the sheet's left edge
    goes to the carrier's home column."""
    bm = bmesh.new()
    x = J["carrier"]["home"]
    add_rbox(bm, x - 0.012, x - 0.0005, CTOP - 0.002, CTOP + 0.008, SLOT0 - 0.012, SLOT0 + 0.002, 0.0015, 1)
    tri = [(x - 0.004, CTOP + 0.0001, SLOT0 - 0.014), (x + 0.004, CTOP + 0.0001, SLOT0 - 0.014), (x, CTOP + 0.0001, SLOT0 - 0.007)]
    a = [bm.verts.new(p) for p in tri]
    b = [bm.verts.new((p[0], p[1] + 0.0008, p[2])) for p in tri]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from(bm, "guide")
    assign(ob, "wp_dark")
    return ob


# ---------- access cover ----------

def cover_solid(inset=0.0, down=0.0):
    pts = [(HZ + inset, 0.168 - down), (HZ + inset, CTOP - inset), (HD - inset, CTOP - inset), (HD - inset, LIP - down)]
    side = round_poly(pts, [0, 0.002, max(0.002, 0.012 - inset), 0])
    ob = prism_ob(side, "x", -0.3, 0.3, "cv")
    boolean(ob, prism_ob(cover_plan(-inset), "y", 0.10, 0.25), "INTERSECT")
    front = round_poly([(-CWF - 0.01 + inset, 0.1), (CWF + 0.01 - inset, 0.1), (CWF + 0.01 - inset, CTOP - inset), (-CWF - 0.01 + inset, CTOP - inset)], [0, 0, 0.008, 0.008])
    boolean(ob, prism_ob(front, "z", HZ - 0.01, HD + 0.01), "INTERSECT")
    return ob


# The window well in the cover's rear: its floor slopes up from the hinge, the tinted window set in it (PH 5218_1).
WELL_HW, WELL_Z = 0.198, 0.222
WINDOW = (-0.190, 0.190, 0.100, 0.217)   # x0, x1, z0, z1: over half the cover's depth (PH 5218_2 raised, the owner's photo, BRO p.18)


def floor_y(z):
    return 0.172 + 0.004 * (z - HZ) / (WELL_Z - HZ)


def well_poly(drop=0.0, grow=0.0):
    return [(HZ - 0.01, floor_y(HZ - 0.01) - drop), (WELL_Z + grow, floor_y(WELL_Z) - drop), (WELL_Z + 0.004 + grow, CTOP + 0.01), (HZ - 0.01, CTOP + 0.01)]


def build_cover():
    ob = cover_solid()
    inner = cover_solid(inset=T, down=0.02)
    boolean(inner, prism_ob(well_poly(T, T), "x", -WELL_HW - T, WELL_HW + T))
    boolean(ob, inner)
    boolean(ob, prism_ob(well_poly(), "x", -WELL_HW, WELL_HW))
    boolean(ob, prism_ob(rrect(WINDOW[0], WINDOW[2], WINDOW[1], WINDOW[3], 0.004), "y", 0.16, 0.18))
    # Hinge knuckles in the cheeks at the rear top edge, and the magnet's keeper behind the lip.
    bm = bmesh.new()
    for x in (-0.204, 0.204):
        add_cyl(bm, "x", (x, HY, HZ), 0.003, 0.010, 12)
    add_box(bm, MAGNET_X - 0.012, MAGNET_X + 0.012, LIP + 0.004, LIP + 0.011, HD - 0.010, HD - T)
    k = ob_from(bm, "kn")
    bevel_finish(ob, 0.0012)
    box_uv(ob)
    assign(ob, "wp_pearl")
    shade(k, 35)
    assign(k, "wp_dark")
    bm = bmesh.new()
    x0, x1, z0, z1 = WINDOW
    q = [(x0 + 0.001, floor_y(z0) - 0.0012, z0 + 0.001), (x1 - 0.001, floor_y(z0) - 0.0012, z0 + 0.001), (x1 - 0.001, floor_y(z1) - 0.0012, z1 - 0.001), (x0 + 0.001, floor_y(z1) - 0.0012, z1 - 0.001)]
    add_quad_prism(bm, q, (0, -1, 0), 0.0018)
    g = ob_from(bm, "glass")
    assign(g, "wp_glass")
    # The acoustic foam lining the cover's underside (MIM p.63; PH 5218_2 shows it on the raised cover).
    bm = bmesh.new()
    add_box(bm, -CWR + 0.006, CWR - 0.006, CTOP - T - 0.008, CTOP - T - 0.0002, WELL_Z + 0.008, HD - 0.012)
    foam = ob_from(bm, "foam")
    assign(foam, "wp_foam")
    cover = join([ob, k, g, foam], "printer_cover")
    return cover, (0.0, HY, HZ)


# ---------- mechanism ----------

def bail_rod():
    a = J["paper"]["bailAngle"]
    rr = PR + J["paper"]["bailRollerRadius"] + 0.0002
    return (PC[1] + rr * math.sin(a), PC[2] + rr * math.cos(a))


def bail_pivot():
    """15 mm back along the tangent from the rod, so opening swings the rod straight off the platen."""
    y, z = bail_rod()
    a = J["paper"]["bailAngle"]
    return (y - 0.015 * math.cos(a), z + 0.015 * math.sin(a))


BAIL_PIVOT = bail_pivot()
DY = PC[1] - 0.150                  # the carrier and frame were laid out for an axle at 0.150 m
FEED_ROD = (0.108 + DY, PC[2])
RAIL_REAR = (0.050 + DY, 0.100)
SCREW = (0.050 + DY, 0.150)
RAIL_FRONT = (0.058 + DY, 0.238)
FRAME_X = 0.284
PULLEY_X = -0.294


def gear_poly(r, teeth, depth):
    pts = []
    for i in range(teeth * 4):
        a = 2 * math.pi * i / (teeth * 4)
        rr = r if (i % 4) in (0, 1) else r - depth
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    return pts


def belt_loop(c1, r1, c2, r2, seg=24):
    """Outline (z, y) of a belt around two pulleys: the convex hull of two circles."""
    pts = []
    for c, r in ((c1, r1), (c2, r2)):
        for i in range(seg):
            a = 2 * math.pi * i / seg
            pts.append((c[1] + r * math.cos(a), c[0] + r * math.sin(a)))
    # convex hull (monotone chain)
    pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


INDEX_MOTOR = (0.102 + DY, 0.012)   # (y, z) of the index motor's shaft, below and behind the platen (MIM p.20, p.38), over the base's wall
CAM_C = (0.082 + DY, 0.020)


def build_frame():
    parts = []
    bm = bmesh.new()
    # Side frames, the mechanism's base plate.
    # The frames stand tall round the platen and stay low in front, under the ribbon plate, which passes over them at
    # the carrier's stops (MIM p.18; PH 5218_4).
    for s in (-1, 1):
        prof = round_poly([(-0.035, 0.012), (0.262, 0.012), (0.262, 0.078), (0.148, 0.090), (0.112, 0.168 + DY), (0.010, 0.168 + DY), (-0.035, 0.120 + DY)], [0, 0, 0.01, 0.01, 0.015, 0.02, 0.01])
        add_prism(bm, prof, "x", s * FRAME_X - 0.0015, s * FRAME_X + 0.0015)
    add_box(bm, -0.30, 0.30, 0.009, 0.012, -0.045, 0.300)
    met = ob_from(bm, "frame_met")
    shade(met, 35)
    assign(met, "wp_gray")
    bm = bmesh.new()
    for c in (RAIL_REAR, RAIL_FRONT):
        add_cyl(bm, "x", (0, c[0], c[1]), 0.006, 2 * FRAME_X + 0.01, 12)
    add_cyl(bm, "x", (0, FEED_ROD[0], FEED_ROD[1]), 0.004, 2 * FRAME_X, 16)
    rails = ob_from(bm, "rails")
    shade(rails, 35)
    assign(rails, "wp_chrome")
    # Escapement motor and coupler on the leadscrew's right end; the index motor and its belt at the left; the cam
    # motor at the right (MIM p.18, p.20, p.22).
    bm = bmesh.new()
    add_cyl(bm, "x", (FRAME_X + 0.034, SCREW[0], SCREW[1]), 0.027, 0.056, 24)
    add_cyl(bm, "x", (FRAME_X + 0.004, SCREW[0], SCREW[1]), 0.012, 0.012, 20)
    add_cyl(bm, "x", (-FRAME_X - 0.031, INDEX_MOTOR[0], INDEX_MOTOR[1]), 0.026, 0.036, 24)
    add_cyl(bm, "x", (FRAME_X + 0.024, 0.035 + DY, 0.060), 0.016, 0.040, 24)
    motors = ob_from(bm, "motors")
    shade(motors, 35)
    assign(motors, "wp_motor")
    bm = bmesh.new()
    add_cyl(bm, "x", (PULLEY_X, INDEX_MOTOR[0], INDEX_MOTOR[1]), 0.008, 0.010, 20)
    add_cyl(bm, "x", (FRAME_X + 0.010, 0.054 + DY, 0.050), 0.004, 0.020, 12)   # worm
    pul = ob_from(bm, "pul")
    shade(pul, 35)
    assign(pul, "wp_metal")
    outer = belt_loop((PC[1], PC[2]), 0.0315, INDEX_MOTOR, 0.0095)
    inner = belt_loop((PC[1], PC[2]), 0.0300, INDEX_MOTOR, 0.0080)
    belt = prism_ob(outer, "x", PULLEY_X - 0.004, PULLEY_X + 0.004, "belt")
    boolean(belt, prism_ob(inner, "x", PULLEY_X - 0.01, PULLEY_X + 0.01))
    shade(belt, 35)
    assign(belt, "wp_rubber")
    # The paper pan round the platen's underside, between the feed-roll modules.
    bm = bmesh.new()
    a0, a1 = J["paper"]["panArc"]
    xs = feed_module_x()
    edges = [-PL / 2] + [v for x in xs for v in (x - 0.014, x + 0.014)] + [PL / 2]
    for i in range(0, len(edges), 2):
        xa, xb = edges[i], edges[i + 1]
        poly = []
        for k in range(17):
            a = a0 + (a1 - a0) * k / 16
            poly.append((PC[2] + (PR + 0.0016) * math.cos(a), PC[1] + (PR + 0.0016) * math.sin(a)))
        for k in range(16, -1, -1):
            a = a0 + (a1 - a0) * k / 16
            poly.append((PC[2] + (PR + 0.0022) * math.cos(a), PC[1] + (PR + 0.0022) * math.sin(a)))
        add_prism(bm, poly, "x", xa, xb)
    pan = ob_from(bm, "pan")
    shade(pan, 35)
    assign(pan, "wp_metal")
    # Bail pivots, the cards' plate behind the paper path (a dark baffle so the well is not open to the room).
    bm = bmesh.new()
    add_box(bm, -0.30, 0.30, 0.030, 0.150 + DY, -0.012, -0.009)
    baffle = ob_from(bm, "baffle")
    assign(baffle, "wp_dark")
    # The carriers' flat signal cable folded on the base plate at the front (PH 5218_2, 5218_4; MIM p.62).
    bm = bmesh.new()
    add_box(bm, -0.255, 0.215, 0.012, 0.0135, 0.262, 0.292)
    add_box(bm, 0.180, 0.215, 0.012, 0.050, 0.290, 0.2915)
    cable = ob_from(bm, "cable")
    assign(cable, "wp_cable")
    parts = [met, rails, motors, pul, belt, pan, baffle, cable]
    return join(parts, "printer_frame")


def build_platen():
    bm = bmesh.new()
    add_cyl(bm, "x", (0, 0, 0), PR, PL, 36)
    rub = ob_from(bm, "rub")
    shade(rub, 30)
    assign(rub, "wp_rubber")
    bm = bmesh.new()
    add_cyl(bm, "x", (0, 0, 0), 0.006, 2 * FRAME_X + 0.03, 16)
    for s in (-1, 1):
        add_cyl(bm, "x", (s * (PL / 2 + 0.004), 0, 0), 0.013, 0.008, 16)
    add_cyl(bm, "x", (PULLEY_X - 0.0055, 0, 0), 0.032, 0.0015, 20)
    add_cyl(bm, "x", (PULLEY_X + 0.0055, 0, 0), 0.032, 0.0015, 20)
    met = ob_from(bm, "pm")
    shade(met, 35)
    assign(met, "wp_metal")
    bm = bmesh.new()
    add_prism(bm, gear_poly(0.030, 20, 0.0018), "x", PULLEY_X - 0.0045, PULLEY_X + 0.0045)
    add_prism(bm, gear_poly(0.026, 24, 0.0016), "x", FRAME_X + 0.003, FRAME_X + 0.009)
    gears = ob_from(bm, "gears")
    shade(gears, 35)
    assign(gears, "wp_white")
    ob = join([rub, met, gears], "printer_platen")
    return ob, (0.0, PC[1], PC[2])


def build_bail():
    y, z = bail_rod()
    bm = bmesh.new()
    add_cyl(bm, "x", (0, y, z), 0.0032, 2 * (FRAME_X - 0.006), 16)
    for s in (-1, 1):
        x = s * (FRAME_X - 0.008)
        poly = round_poly([(BAIL_PIVOT[1] + 0.005, BAIL_PIVOT[0] - 0.005), (BAIL_PIVOT[1] + 0.005, BAIL_PIVOT[0] + 0.003), (z + 0.002, y + 0.0035), (z - 0.004, y - 0.002)], [0.003, 0.002, 0.002, 0.002])
        add_prism(bm, poly, "x", x - 0.0015, x + 0.0015)
        add_cyl(bm, "x", (x, BAIL_PIVOT[0], BAIL_PIVOT[1]), 0.0045, 0.006, 16)
    rod = ob_from(bm, "rod")
    shade(rod, 35)
    assign(rod, "wp_chrome")
    bm = bmesh.new()
    for x in (-0.16, -0.068, 0.068, 0.16):
        add_cyl(bm, "x", (x, y, z), J["paper"]["bailRollerRadius"], 0.014, 14)
    rol = ob_from(bm, "brol")
    shade(rol, 35)
    assign(rol, "wp_rubber")
    ob = join([rod, rol], "printer_bail")
    return ob, (0.0, BAIL_PIVOT[0], BAIL_PIVOT[1])


def feed_module_x():
    return [-0.21, -0.126, -0.042, 0.042, 0.126, 0.21]


def build_feedrolls():
    """Six roller modules on their rod under the platen, each a front and a rear roller (MIM p.186)."""
    bm = bmesh.new()
    rbm = bmesh.new()
    rr = 0.0062
    for x in feed_module_x():
        rolls = []
        for a in J["paper"]["feedRollAngle"]:
            c = (PC[1] + (PR + rr) * math.sin(a), PC[2] + (PR + rr) * math.cos(a))
            rolls.append(c)
            add_cyl(rbm, "x", (x, c[0], c[1]), rr, 0.018, 10)
        ys = [FEED_ROD[0] - 0.006, rolls[0][0], rolls[1][0]]
        poly = round_poly([(FEED_ROD[1] - 0.008, FEED_ROD[0] - 0.007), (FEED_ROD[1] + 0.008, FEED_ROD[0] - 0.007), (rolls[0][1] + 0.004, rolls[0][0] - 0.002), (rolls[1][1] - 0.004, rolls[1][0] - 0.002)], [0.003] * 4, seg=3)
        add_prism(bm, poly, "x", x - 0.0115, x + 0.0115)
    br = ob_from(bm, "fbr")
    shade(br, 35)
    assign(br, "wp_dark")
    ro = ob_from(rbm, "fro")
    shade(ro, 35)
    assign(ro, "wp_rubber")
    ob = join([br, ro], "printer_feedrolls")
    return ob, (0.0, FEED_ROD[0], FEED_ROD[1])


def build_leadscrew():
    bm = bmesh.new()
    seg, n = 24, 2
    r, x0, x1 = 0.008, -FRAME_X + 0.004, FRAME_X - 0.002
    uv = bm.loops.layers.uv.new("UVMap")
    lead = J["carrier"]["lead"]
    rings = []
    for xi in (x0, x1):
        rings.append([bm.verts.new((xi, r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg))) for k in range(seg)])
    for k in range(seg):
        k2 = (k + 1) % seg
        f = bm.faces.new((rings[0][k], rings[0][k2], rings[1][k2], rings[1][k]))
        for lp in f.loops:
            c = lp.vert.co
            ang = math.atan2(c.z, c.y) % (2 * math.pi)
            if lp.vert in (rings[0][k2], rings[1][k2]) and k2 == 0:
                ang = 2 * math.pi
            lp[uv].uv = (c.x / lead, ang / (2 * math.pi))
    for ring in rings:
        f = bm.faces.new(ring)
        for lp in f.loops:
            lp[uv].uv = (0, 0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from(bm, "printer_leadscrew")
    shade(ob, 35)
    assign(ob, "wp_screw")
    return ob, (0.0, SCREW[0], SCREW[1])


def build_cam():
    """The paper-handling cam outside the right frame, five positions a turn (MIM p.186)."""
    bm = bmesh.new()
    pts = []
    for i in range(60):
        a = 2 * math.pi * i / 60
        r = 0.020 + 0.006 * max(0.0, math.cos(5 * a)) ** 3
        pts.append((r * math.cos(a), r * math.sin(a)))
    add_prism(bm, pts, "x", FRAME_X + 0.004, FRAME_X + 0.010)
    add_cyl(bm, "x", (FRAME_X + 0.012, 0, 0), 0.030, 0.004, 40)
    ob = ob_from(bm, "printer_cam")
    shade(ob, 35)
    assign(ob, "wp_white")
    return ob, (0.0, CAM_C[0], CAM_C[1])


# ---------- carrier ----------

MOTOR_Z = (0.0935, 0.168)
MOTOR_R = 0.025
PETAL_Z = (WC[2], WC[2] + 0.0012)       # the slug faces lie in the plane petalTravel in front of the paper
HAMMER_REST = PETAL_Z[1] + J["hammer"]["freeTravel"]
HAMMER_Y = PC[1] - 0.002               # the armature on the middle of the top petal's face
RIB = J["ribbon"]
PLATE_Y = (0.1185 + DY, 0.1215 + DY)  # the ribbon plate's underside and top
# On the ribbon plate (MIM p.57 to scale, 0.234 mm a pixel at 300 dpi): the belt rollers and the advance knob (x, z).
RIB_ROLLERS = [(0.0204, 0.2219), (0.0920, 0.2305), (0.1197, 0.2067), (-0.105, 0.236)]
RIB_KNOB = (0.1267, 0.2324)


def hull(pts):
    """Convex hull (monotone chain) of 2D points, counter-clockwise."""
    pts = sorted(set((round(p[0], 6), round(p[1], 6)) for p in pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


CARRIER_DECALS = []                    # separate nodes that ride the carrier (the view attaches them)
CART_FRONT = 0.196                     # the ribbon cartridge's top edge in front (z), the spools under it


def cart_top(z):
    """The ribbon cartridge's top rises toward the platen, to the ribbon's height at its rear tips (PG p.44 photo)."""
    return 0.1265 + (CART_FRONT - z) * 0.15


def build_ribbon_cartridge():
    """The ribbon cartridge (Printer Guide S544-0861-4 p.41 and p.44 photographs, MIM p.57): a flat-topped moulding
    265 mm across whose two lobes, one over each spool, run back to pointed tips where the film leaves for the guides on
    the printwheel cartridge; a deep notch between them for the selection motor and hammer. Under its straight front
    edge the spool housings stand forward and show each spool's toothed flange. A slot window on the left lobe, the
    raised IBM logo on the right (a decal the view draws)."""
    sx, sz = RIB["spoolX"], RIB["spoolZ"]
    yb = PLATE_Y[1] + 0.0005
    body = prism_ob([(-0.132, CART_FRONT), (0.132, CART_FRONT), (0.132, 0.157), (0.098, 0.139), (-0.098, 0.139), (-0.132, 0.157)], "y", yb, 0.16, "rcart")
    # Each lobe a round hump (MIM p.57: radius 38 mm about a point 59 mm out and 67 mm in front of the print line)
    # running back to a blunt tip (PG p.41, p.44); the motor's notch between them, round at its foot.
    for s in (-1, 1):
        circ = [(s * 0.060 + 0.039 * math.cos(2 * math.pi * k / 28), 0.152 + 0.039 * math.sin(2 * math.pi * k / 28)) for k in range(28)]
        boolean(body, prism_ob(hull(circ + [(s * 0.050, 0.102), (s * 0.058, 0.101)]), "y", yb, 0.16), "UNION")
        bay = [(s * sx - 0.036, CART_FRONT + 0.01), (s * sx + 0.036, CART_FRONT + 0.01), (s * sx + 0.024, 0.183), (s * sx - 0.024, 0.183)]
        boolean(body, prism_ob(bay, "y", yb + 0.0085, 0.2))
    boolean(body, prism_ob(rrect(-0.034, 0.0, 0.034, 0.178, 0.011), "y", yb - 0.01, 0.2))
    boolean(body, prism_ob([(0.05, yb), (CART_FRONT, yb), (CART_FRONT, cart_top(CART_FRONT)), (0.05, cart_top(0.05))], "x", -0.2, 0.2), "INTERSECT")
    boolean(body, prism_ob(rrect(-0.069, 0.149, -0.063, 0.173, 0.0029), "y", cart_top(0.16) - 0.003, 0.2))
    # The spool housings under the front edge, open in front over each spool's toothed flange.
    for s in (-1, 1):
        hs = solid(lambda bm, s=s: add_cyl(bm, "y", (s * sx, yb + 0.0045, sz), 0.041, 0.009, 28))
        boolean(hs, box_ob(s * sx - 0.022, s * sx + 0.022, yb - 0.01, yb + 0.02, sz + 0.024, sz + 0.06))
        boolean(body, hs, "UNION")
    triangulate(body)
    shade(body, 35)
    assign(body, "wp_ribcart")
    bm = bmesh.new()
    for s in (-1, 1):
        add_prism(bm, [(s * sx + x, sz + z) for x, z in gear_poly(0.036, 24, 0.0016)], "y", yb + 0.0015, yb + 0.0045)
    fl = ob_from(bm, "flange")
    shade(fl, 35)
    assign(fl, "wp_dark")
    # The logo on the right lobe: a quad just over the top, uv 0..1 (v = 1 at its far edge).
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    x0, x1, z0, z1 = 0.046, 0.088, 0.158, 0.176
    vs = [bm.verts.new((x, cart_top(z) + 0.0003, z)) for x, z in ((x0, z1), (x1, z1), (x1, z0), (x0, z0))]
    f = bm.faces.new(vs)
    for lp, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv].uv = (u, v)
    logo = ob_from(bm, "printer_cartlogo")
    assign(logo, "wp_cartlogo")
    CARRIER_DECALS.append(logo)
    return join([body, fl], "ribcart")


def build_wheel_cartridge():
    """The printwheel cartridge (Printer Guide p.47 photograph, p.50 drawings; MIM p.57): two plates either side of the
    wheel, round below a band with ears at each side, the top open over the upper petals inside a trapezoid handle; the
    hub shows through a rounded triangle in the motor-side plate; the ribbon guides on brackets at the band."""
    cx, cy = WC[0], WC[1]
    R, b0, b1 = 0.0415, 0.010, 0.017
    xa = math.sqrt(R * R - b0 * b0)
    a0 = math.atan2(b0, xa)        # from the band's right end clockwise round the bottom to its left end
    arc = [(cx + R * math.cos(a0 - (math.pi + 2 * a0) * k / 32), cy + R * math.sin(a0 - (math.pi + 2 * a0) * k / 32)) for k in range(33)]
    plate = [(cx - 0.045, cy + b1), (cx + 0.045, cy + b1), (cx + 0.045, cy + b0)] + arc + [(cx - 0.045, cy + b0)]
    zb = (WC[2] - 0.0024, WC[2] - 0.0014)
    zf = (PETAL_Z[1] + 0.0009, PETAL_Z[1] + 0.0019)
    back = prism_ob(plate, "z", *zb, "wcb")
    front = prism_ob(plate, "z", *zf, "wcf")
    win = [(cx, cy + 0.022), (cx + 0.015, cy - 0.012), (cx - 0.015, cy - 0.012)]
    win = round_poly(win, [0.004, 0.004, 0.004])
    boolean(front, prism_ob(win, "z", zf[0] - 0.01, zf[1] + 0.01))
    boolean(front, solid(lambda bm: add_cyl(bm, "z", (cx, cy, zf[0]), 0.0095, 0.02, 24)))
    obs = [back, front]
    rim = [(cx + 0.0415 * math.cos(a), cy + 0.0415 * math.sin(a)) for a in [p for p in (math.atan2(y - cy, x - cx) for x, y in arc)]]
    rim_in = [(cx + 0.0405 * (x - cx) / 0.0415, cy + 0.0405 * (y - cy) / 0.0415) for x, y in rim]
    obs.append(prism_ob(rim + rim_in[::-1], "z", zb[0], zf[1], "rim"))
    bm = bmesh.new()
    for s in (-1, 1):
        add_box(bm, min(s * 0.0405, s * 0.045), max(s * 0.0405, s * 0.045), cy + b0, cy + b1, zb[0], zf[1])
        # the handle's slanted sides and top bar, on the motor side of the wheel
        p0, p1 = Vector((s * 0.043, cy + b1)), Vector((s * 0.0105, cy + 0.0435))
        d = (p1 - p0).normalized()
        n = Vector((-d.y, d.x)) * 0.0025 * (1 if s > 0 else -1)
        quad = [p0, p1, p1 + n, p0 + n] if s > 0 else [p0, p0 + n, p1 + n, p1]
        add_prism(bm, [(q.x, q.y) for q in quad], "z", zf[0], zf[1] + 0.001)
    add_box(bm, -0.0115, 0.0115, cy + 0.0425, cy + 0.045, zf[0], zf[1] + 0.002)
    gx, gz = RIB["guidePostX"], WC[2] - J["hammer"]["petalTravel"] + 0.0012 + 0.0022 + 0.0005 + 0.0065
    for s in (-1, 1):
        add_box(bm, min(s * 0.024, s * 0.045), max(s * 0.024, s * 0.045), cy + b1 - 0.003, cy + b1, zf[0], gz + 0.002)
        add_box(bm, s * gx - 0.002, s * gx + 0.002, cy + b1 - 0.003, 0.121, gz - 0.002, gz + 0.002)
    obs.append(ob_from(bm, "handle"))
    sh = join(obs, "wcart")
    shade(sh, 35)
    assign(sh, "wp_cartridge")
    bm = bmesh.new()
    for s in (-1, 1):
        add_cyl(bm, "y", (s * gx, 0.147 + DY, gz), 0.0022, 0.020, 16)
    posts = ob_from(bm, "posts")
    shade(posts, 35)
    assign(posts, "wp_chrome")
    return [sh, posts]


def build_ribbon_knob():
    """The ribbon advance knob on the ribbon plate (MIM p.95, PG p.42): knurled, the capstan of the feed belt; turned by
    hand to take up slack. Its own node, pivot on its axle (y)."""
    bm = bmesh.new()
    add_prism(bm, gear_poly(0.0140, 16, 0.0007), "y", 0.0, 0.019)
    add_cyl(bm, "y", (0, 0.0195, 0), 0.0115, 0.001, 30)
    add_box(bm, -0.007, 0.007, 0.019, 0.0212, -0.0012, 0.0012)
    ob = ob_from(bm, "printer_ribbon_knob")
    shade(ob, 35)
    assign(ob, "wp_dark")
    return ob, (RIB_KNOB[0], PLATE_Y[1], RIB_KNOB[1])


def build_carrier():
    obs = []
    # Base casting on the rails and the leadscrew follower.
    cast = prism_ob(round_poly([(0.090, 0.036 + DY), (0.250, 0.036 + DY), (0.250, 0.070 + DY), (0.225, 0.086 + DY), (0.095, 0.086 + DY), (0.090, 0.080 + DY)], [0.004, 0.006, 0.006, 0.004, 0.004, 0.002]), "x", -0.070, 0.070, "cast")
    for c, r in ((RAIL_REAR, 0.0068), (SCREW, 0.0092), (RAIL_FRONT, 0.0068)):
        boolean(cast, solid(lambda bm, c=c, r=r: add_cyl(bm, "x", (0, c[0], c[1]), r, 0.2, 16)))
    # Motor clamps: two saddles on the casting (MIM p.52).
    for z0 in (0.100, 0.150):
        cl = prism_ob(round_poly([(-0.032, 0.084 + DY), (0.032, 0.084 + DY), (0.032, 0.120 + DY), (0.0, 0.142 + DY), (-0.032, 0.120 + DY)], [0.002, 0.002, 0.012, 0.01, 0.012]), "z", z0, z0 + 0.006, "cl")
        boolean(cl, solid(lambda bm: add_cyl(bm, "z", (0, WC[1], z0 + 0.003), MOTOR_R + 0.0003, 0.02, 28)))
        cast = join([cast, cl], "cast")
    triangulate(cast)       # under the ribbon plate: no bevel, to spare the budget
    shade(cast, 35)
    assign(cast, "wp_dark")
    obs.append(cast)
    # Selection motor, its shaft and the hammer coil clamped above it (MIM p.52, p.87).
    bm = bmesh.new()
    add_cyl(bm, "z", (0, WC[1], (MOTOR_Z[0] + MOTOR_Z[1]) / 2), MOTOR_R, MOTOR_Z[1] - MOTOR_Z[0], 28)
    add_cyl(bm, "z", (0, WC[1], MOTOR_Z[1] + 0.003), 0.012, 0.006, 24)
    add_cyl(bm, "z", (0, HAMMER_Y, 0.113), 0.0105, 0.036, 24)
    add_box(bm, -0.012, 0.012, 0.136 + DY, 0.143 + DY, 0.097, 0.130)
    mot = ob_from(bm, "mot")
    shade(mot, 35)
    assign(mot, "wp_motor")
    obs.append(mot)
    bm = bmesh.new()
    add_cyl(bm, "z", (0, WC[1], (PETAL_Z[1] + MOTOR_Z[0]) / 2 + 0.001), 0.003, MOTOR_Z[0] - PETAL_Z[1], 12)
    add_cyl(bm, "z", (0, HAMMER_Y, (HAMMER_REST + 0.0005 + 0.095) / 2), 0.003, 0.095 - HAMMER_REST - 0.0005, 20, 0.006)  # nose cone
    add_cyl(bm, "z", (0, HAMMER_Y, 0.0965), 0.0068, 0.004, 24)
    noses = ob_from(bm, "nose")
    shade(noses, 35)
    assign(noses, "wp_metal")
    obs.append(noses)
    # The ribbon plate (MIM p.57's top view to scale, PH 5218.jpg): 300 mm across at the front, where the cartridge's
    # spring latches stand at its ends, narrow behind round the selection motor. It passes over the frames at the stops.
    py0, py1 = PLATE_Y
    plate = round_poly([(-0.150, 0.262), (0.150, 0.262), (0.150, 0.160), (0.060, 0.160), (0.060, 0.092), (-0.060, 0.092), (-0.060, 0.160), (-0.150, 0.160)],
                       [0.008, 0.008, 0.004, 0.006, 0.006, 0.006, 0.006, 0.004])
    rp = prism_ob([(x, z) for x, z in plate], "y", py0, py1, "rp")
    boolean(rp, prism_ob(rrect(-0.029, 0.08, 0.029, 0.172, 0.004), "y", py0 - 0.01, py1 + 0.01))
    for sx in (-1, 1):
        tab = [(0.168, py1 - 0.0005), (0.206, py1 - 0.0005), (0.199, 0.131), (0.177, 0.131)]
        boolean(rp, prism_ob(tab, "x", min(sx * 0.141, sx * 0.150), max(sx * 0.141, sx * 0.150)), "UNION")
    bevel_finish(rp, 0.0005, 1)
    assign(rp, "wp_dark")
    obs.append(rp)
    bm = bmesh.new()
    for x, z in RIB_ROLLERS:
        add_cyl(bm, "y", (x, py1 + 0.005, z), 0.0058, 0.010, 14)
    rol = ob_from(bm, "rol")
    shade(rol, 35)
    assign(rol, "wp_white")
    obs.append(rol)
    # The ribbon feed belt from the first roller round the advance knob (MIM p.95), and the gear between them.
    kx, kz = RIB_KNOB
    r0 = RIB_ROLLERS[0]
    belt = prism_ob(belt_loop((r0[1], r0[0]), 0.0068, (kz, kx), 0.0150, 14), "y", py1 + 0.002, py1 + 0.008, "rbelt")
    boolean(belt, prism_ob(belt_loop((r0[1], r0[0]), 0.0056, (kz, kx), 0.0138, 14), "y", py1 - 0.01, py1 + 0.02))
    shade(belt, 35)
    assign(belt, "wp_rubber")
    obs.append(belt)
    bm = bmesh.new()
    add_prism(bm, [(0.1057 + x, 0.2277 + z) for x, z in gear_poly(0.0045, 10, 0.0008)], "y", py1, py1 + 0.008)
    add_cyl(bm, "x", (-0.087, py1 + 0.003, 0.252), 0.0022, 0.104, 10)      # the cartridge release spring along the front
    gear = ob_from(bm, "gear")
    shade(gear, 35)
    assign(gear, "wp_metal")
    obs.append(gear)
    obs.append(build_ribbon_cartridge())
    obs.extend(build_wheel_cartridge())
    gz = WC[2] - J["hammer"]["petalTravel"] + 0.0012 + 0.0022 + 0.0005 + 0.0065
    # The cardholder: a clear sector hugging the platen round the print point, with its window (MIM p.57, adjustment 137).
    bm = bmesh.new()
    for (xa, xb, b0, b1) in ((-0.030, 0.030, -0.49, -0.17), (-0.030, 0.030, 0.16, 0.45), (-0.030, -0.011, -0.17, 0.16), (0.011, 0.030, -0.17, 0.16)):
        poly = []
        n = 8
        for k in range(n + 1):
            a = b0 + (b1 - b0) * k / n
            poly.append((PC[2] + (PR + 0.0008) * math.cos(a), PC[1] + (PR + 0.0008) * math.sin(a)))
        for k in range(n, -1, -1):
            a = b0 + (b1 - b0) * k / n
            poly.append((PC[2] + (PR + 0.0011) * math.cos(a), PC[1] + (PR + 0.0011) * math.sin(a)))
        add_prism(bm, poly, "x", xa, xb)
    ch = ob_from(bm, "card")
    shade(ch, 40)
    assign(ch, "wp_glass")
    obs.append(ch)
    bm = bmesh.new()
    for s in (-1, 1):
        a = -0.49
        add_box(bm, s * 0.030 - 0.0015, s * 0.030 + 0.0015, 0.1370 + DY, 0.1395 + DY, PC[2] + (PR + 0.0008) * math.cos(a) + 0.0004, gz - 0.002)
    tabs = ob_from(bm, "tabs")
    assign(tabs, "wp_dark")
    obs.append(tabs)
    return join(obs, "printer_carrier"), (0.0, 0.0, 0.0)


def build_wheel():
    """The printwheel: hub, 96 spokes and a slug at each tip whose face carries the character. Petal k sits k steps
    clockwise (seen from the front) of the top, so turning the wheel by k steps brings it to the hammer. Each slug face
    is mapped to cell k of a 12 x 8 atlas the view draws from the glyph faces, character up = outward."""
    step = 2 * math.pi / WH["petals"]
    cx, cy = WC[0], WC[1]
    z0, z1 = PETAL_Z
    bm = bmesh.new()
    add_cyl(bm, "z", (cx, cy, z0 + 0.0004 + 0.0007), 0.0148, 0.0014, 32)
    add_cyl(bm, "z", (cx, cy, z1 + 0.0024), 0.0085, 0.0045, 20)
    for k in range(WH["petals"]):
        a = k * step
        dx, dy = math.sin(a), math.cos(a)       # radial direction of petal k
        tx, ty = dy, -dx                        # tangent, +x at the top
        quad = []
        for r, hw in ((0.0140, 0.00055), (0.0340, 0.00072), (0.0340, -0.00072), (0.0140, -0.00055)):
            quad.append((cx + dx * r + tx * hw, cy + dy * r + ty * hw, z0 + 0.0003))
        vs = [bm.verts.new(q) for q in quad]
        bm.faces.new(vs)
    hubspokes = ob_from(bm, "spokes")
    shade(hubspokes, 35)
    assign(hubspokes, "wp_wheel")
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    fw, fh = 0.0021, 0.0042
    for k in range(WH["petals"]):
        a = k * step
        dx, dy = math.sin(a), math.cos(a)
        tx, ty = dy, -dx
        r0, r1 = WR - fh - 0.0002, WR
        quad = [(r0, -fw / 2), (r0, fw / 2), (r1, fw / 2), (r1, -fw / 2)]
        pts = [(cx + dx * r + tx * t, cy + dy * r + ty * t, z0) for r, t in quad]
        faces = add_quad_prism(bm, pts, (0, 0, 1), z1 - z0)
        col, row = k % 12, k // 12
        for f in faces:
            for lp in f.loops:
                c = lp.vert.co
                r = (c.x - cx) * dx + (c.y - cy) * dy
                t = (c.x - cx) * tx + (c.y - cy) * ty
                if f.normal.z < -0.7:
                    lp[uv].uv = ((col + 0.5 + t / fw) / 12, (row + (r - r0) / (r1 - r0)) / 8)
                else:
                    lp[uv].uv = ((col + 0.02) / 12, (row + 0.02) / 8)
    slugs = ob_from(bm, "slugs")
    shade(slugs, 35)
    assign(slugs, "wp_petal")
    ob = join([hubspokes, slugs], "printer_wheel")
    return ob, (cx, cy, z0)


def build_hammer():
    bm = bmesh.new()
    add_cyl(bm, "z", (0, HAMMER_Y, HAMMER_REST + 0.018), 0.0016, 0.036, 16)
    add_cyl(bm, "z", (0, HAMMER_Y, HAMMER_REST + 0.040), 0.0055, 0.010, 20)
    ob = ob_from(bm, "printer_hammer")
    shade(ob, 35)
    assign(ob, "wp_chrome")
    return ob, (0.0, 0.0, 0.0)


# ---------- sheet feeder ----------

def feeder_profile(inset=0.0):
    F = FEED
    lift = 0.0008
    pts = [(F["front"], TOP + lift), (F["front"] - F["lean"] * (F["top"] - TOP), F["top"]), (F["topBack"], F["top"]),
           (F["rearTopFront"], F["rearTop"]), (F["back"], F["rearTop"]), (F["back"], TOP + lift)]
    return round_poly(pts, [0.003, 0.022, 0.03, 0.012, 0.016, 0.003])


TRAYS = [(0.196, 0.254), (0.265, 0.323)]
TRAY_HW = 0.152


def build_feeder():
    F = FEED
    hw, ohw = F["halfWidth"], F["openingHalfWidth"]
    body = prism_ob(feeder_profile(), "x", -hw, hw, "printer_feeder")
    front = round_poly([(-hw, TOP), (hw, TOP), (hw, F["top"] + 0.001), (-hw, F["top"] + 0.001)], [0, 0, 0.03, 0.03])
    boolean(body, prism_ob(front, "z", -0.5, 0.2), "INTERSECT")
    boolean(body, prism_ob([(0.3, TOP - 0.01), (0.3, CTOP + 0.0008), (SLOT0 - 0.045, CTOP + 0.0008), (SLOT0 - 0.045, TOP - 0.01)], "x", -CWR - 0.0008, CWR + 0.0008))
    # The front opening down to the plate (the paper table), open at the bottom over the slot.
    o0, o1 = F["opening"]
    back = 0.003
    cut = prism_ob([(0.25, o0 - 0.02), (0.25, o1), (plate_z(o1) - back, o1), (plate_z(o0 - 0.02) - back, o0 - 0.02)], "x", -ohw, ohw, "cut")
    boolean(cut, prism_ob(rrect(-ohw, o0 - 0.05, ohw, o1, 0.016), "z", -0.5, 0.5), "INTERSECT")
    boolean(body, cut)
    # Tray slots in the rear face; a hand scoop in each side under the top's rear edge (PG p.90, p.103: "hand scoops").
    for y0, y1 in TRAYS:
        boolean(body, box_ob(-TRAY_HW - 0.002, TRAY_HW + 0.002, y0 - 0.002, y1 + 0.002, F["back"] - 0.01, F["back"] + 0.03))
    for sx in (-1, 1):
        sc = prism_ob(rrect(F["topBack"] + 0.008, F["top"] - 0.070, F["topBack"] + 0.088, F["top"] - 0.030, 0.012), "x", sx * hw - 0.014, sx * hw + 0.014)
        boolean(body, sc)
    bevel_finish(body, 0.0014, 2)
    box_uv(body)
    assign(body, "wp_pearl")
    obs = [body]
    # The stacker plate (light grey), behind the paper's face by the clearance the soft body keeps.
    bm = bmesh.new()
    q = [(-ohw, o0 - 0.012, plate_z(o0 - 0.012) - 0.0006), (ohw, o0 - 0.012, plate_z(o0 - 0.012) - 0.0006), (ohw, o1, plate_z(o1) - 0.0006), (-ohw, o1, plate_z(o1) - 0.0006)]
    add_quad_prism(bm, q, (0, -0.1736, -0.9848), 0.0026)
    plate = ob_from(bm, "plate")
    box_uv(plate)
    assign(plate, "wp_gray")
    obs.append(plate)
    # Exit rollers and the stacker fingers at the top of the opening (BRO p.18; SET p.3-3).
    yr = o1 - 0.008
    bm = bmesh.new()
    add_cyl(bm, "x", (0, yr, plate_z(yr) + 0.0068), 0.0032, 2 * ohw, 16)
    for i in range(21):
        x = -0.200 + 0.02 * i
        ya, yb = o1 - 0.004, o1 - 0.080
        quad = [(x - 0.0007, ya, plate_z(ya) + 0.0040), (x + 0.0007, ya, plate_z(ya) + 0.0040), (x + 0.0007, yb, plate_z(yb) + 0.0030), (x - 0.0007, yb, plate_z(yb) + 0.0030)]
        add_quad_prism(bm, quad, (0, -0.1736, -0.9848), -0.002)
    fing = ob_from(bm, "fing")
    shade(fing, 35)
    assign(fing, "wp_metal")
    obs.append(fing)
    bm = bmesh.new()
    for x in (-0.15, -0.05, 0.05, 0.15):
        add_cyl(bm, "x", (x, yr, plate_z(yr) + 0.0068), 0.0062, 0.018, 20)
    er = ob_from(bm, "er")
    shade(er, 35)
    assign(er, "wp_rubber")
    obs.append(er)
    # The left side guide standing in front of the plate the height of the opening (BRO p.18, PG p.90), and the lip
    # along the opening's foot, over the sheet's way into the printer.
    bm = bmesh.new()
    ya, yb = o0 + 0.004, o1 - 0.090
    q = [(-ohw + 0.002, ya, plate_z(ya) + 0.0005), (-ohw + 0.058, ya, plate_z(ya) + 0.0005), (-ohw + 0.058, yb, plate_z(yb) + 0.0005), (-ohw + 0.002, yb, plate_z(yb) + 0.0005)]
    add_quad_prism(bm, q, (0, 0.1736, 0.9848), 0.010)
    lg = ob_from(bm, "lguide")
    shade(lg, 35)
    box_uv(lg)
    assign(lg, "wp_pearl")
    obs.append(lg)
    # The round control at the lower right (BRO p.18). The paper insertion gate is its own node (below).
    bm = bmesh.new()
    add_cyl(bm, "z", (ohw - 0.032, o0 + 0.024, plate_z(o0 + 0.024) + 0.003), 0.008, 0.008, 24)
    knob = ob_from(bm, "fknob")
    shade(knob, 35)
    assign(knob, "wp_dark")
    obs.append(knob)
    moving = []
    # The paper insertion gate (SET p.26, step 7): a lever on the left guide that turns between manual and automatic
    # feed. Built round its pivot, its axis the plate's normal (0, 0.174, 0.985); rest = automatic.
    yg = o0 + 0.030
    bm = bmesh.new()
    add_rbox(bm, -0.006, 0.006, -0.008, 0.026, 0.0, 0.006, 0.002, 1)
    add_cyl(bm, "z", (0, 0, 0.003), 0.008, 0.006, 20)
    gate = ob_from(bm, "printer_feeder_gate")
    gate.data.transform(Matrix.Rotation(-math.radians(10), 4, "X"))     # lie on the leaning plate
    pivot = (-ohw + 0.030, yg, plate_z(yg) + 0.0105)
    gate.data.transform(Matrix.Translation(pivot))
    shade(gate, 35)
    assign(gate, "wp_dark")
    moving.append((gate, pivot))
    # Trays: drawers stacked at the rear, their handle ends out of the body; the upper one shows its paper. Each is its
    # own node (printer_tray0 upper, printer_tray1 lower), its pivot at the middle of its handle end; it slides along z.
    for i, (y0, y1) in enumerate(TRAYS):
        tobs = []
        tr = box_ob(-TRAY_HW, TRAY_HW, y0, y1, F["trayBack"], F["back"] + 0.025, "tray")
        boolean(tr, box_ob(-TRAY_HW + 0.004, TRAY_HW - 0.004, y0 + 0.004, y1 + 0.01, F["trayBack"] + 0.012, F["back"] + 0.03))
        # The tray's end is its handle: a frame round a wide window, the arrow at its left (PG p.93).
        boolean(tr, prism_ob(rrect(-0.100, y0 + 0.011, 0.128, y1 - 0.011, 0.005), "z", F["trayBack"] - 0.01, F["trayBack"] + 0.008))
        bevel_finish(tr, 0.0012, 1)
        box_uv(tr)
        assign(tr, "wp_pearl")
        tobs.append(tr)
        bm = bmesh.new()
        add_box(bm, -0.108, 0.108, y0 + 0.004, y0 + 0.004 + 0.02, F["trayBack"] + 0.013, F["back"] + 0.02)
        pst = ob_from(bm, "stack")
        assign(pst, "wp_paper")
        tobs.append(pst)
        moving.append((join(tobs, f"printer_tray{i}"), (0.0, (y0 + y1) / 2, F["trayBack"])))
    # Latches into the cover openings beside the hinge and at the rear corners; rubber pads under the body.
    bm = bmesh.new()
    for x0, x1 in LATCH:
        add_box(bm, x0 + 0.003, x1 - 0.003, TOP - 0.019, TOP + 0.002, LATCH_Z[0] + 0.004, 0.086)
    for x0, x1 in REAR_SQ:
        add_box(bm, x0 + 0.002, x1 - 0.002, TOP - 0.015, TOP + 0.002, REAR_SQ_Z[0] + 0.002, REAR_SQ_Z[1] - 0.002)
    la = ob_from(bm, "latch")
    assign(la, "wp_dark")
    obs.append(la)
    bm = bmesh.new()
    for x in (-hw + 0.03, hw - 0.03):
        for z in (0.04, -0.24):
            add_cyl(bm, "y", (x, TOP + 0.0004, z), 0.01, 0.0008, 16)
    pads = ob_from(bm, "pads")
    assign(pads, "wp_rubber")
    obs.append(pads)
    return join(obs, "printer_feeder"), moving


# ---------- clearance ----------

def bvh(ob, mat=Matrix.Identity(4)):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(mat)
    verts = [v.co.copy() for v in bm.verts]
    tris = [[lp.vert.index for lp in tr] for tr in bm.calc_loop_triangles()]
    bm.free()
    return BVHTree.FromPolygons(verts, tris, all_triangles=True)


def where(ob, tri_ids, mat):
    """Machine-coordinate centre of the first listed triangle of ob, for the report."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(mat)
    tris = bm.calc_loop_triangles()
    c = sum((lp.vert.co for lp in tris[tri_ids[0]]), Vector()) / 3
    bm.free()
    return f"({c.x:.3f}, {c.y:.3f}, {c.z:.3f})"


def rot_x(pivot, ang):
    p = Vector(pivot)
    return Matrix.Translation(p) @ Matrix.Rotation(ang, 4, "X") @ Matrix.Translation(-p)


def clearance_check(o):
    """False if a moving part touches what it must clear, in machine coordinates before the pivots are applied.
    Each entry is (object, matrix); the platen is built round its own axis."""
    bad = []
    I = Matrix.Identity(4)
    platen = (o["platen"], Matrix.Translation((0, PC[1], PC[2])))
    fixed = {"top cover": (o["top"], I), "filter": (o["filter"], I), "frame": (o["frame"], I), "feeder": (o["feeder"], I)}

    def test(label, a, others):
        ta = bvh(*a)
        for name, b in others:
            hits = ta.overlap(bvh(*b))
            if hits:
                bad.append(f"{label} touches {name} near {where(a[0], [h[0] for h in hits], a[1])} / {where(b[0], [h[1] for h in hits], b[1])}, {len(hits)} pairs")

    stops = J["carrier"]["stops"]
    for x in (stops[0] - 0.003, 0.0, stops[1] + 0.003):
        m = Matrix.Translation((x, 0, 0))
        for part in ("carrier", "wheel", "hammer"):
            others = [(k, v) for k, v in fixed.items() if not (k == "frame" and part == "carrier")]   # the casting runs on the rails through its bores
            test(f"{part} at x={x:+.3f}", (o[part], m), others + [("cover", (o["cover"], I)), ("platen", platen), ("bail", (o["bail"], I))])
    for k in range(6):
        ang = -J["cover"]["open"] * k / 5
        test(f"cover at {-math.degrees(ang):.0f} deg", (o["cover"], rot_x((0, HY, HZ), ang)), [(n, fixed[n]) for n in ("top cover", "feeder", "filter")])
    for k in range(3):
        ang = J["bail"]["travel"] * k / 2
        test(f"bail at {math.degrees(ang):.0f} deg", (o["bail"], rot_x((0, BAIL_PIVOT[0], BAIL_PIVOT[1]), ang)), [("top cover", fixed["top cover"]), ("cover", (o["cover"], I)), ("platen", platen)])
    if bad:
        print("CLEARANCE FAILED:\n  " + "\n  ".join(bad))
        return False
    print("clearance ok")
    return True


# ---------- assembly ----------

def place(ob, pivot, local=False):
    """Converts to Blender axes and puts the node at its pivot. A mesh built in the printer's frame is first moved so
    the pivot is its origin; a local one (built round its own origin) is not."""
    if not local:
        ob.data.transform(Matrix.Translation((-pivot[0], -pivot[1], -pivot[2])))
    ob.data.transform(M2B)
    ob.location = M2B @ Vector(pivot)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    top = build_top_cover()
    box_uv(top)
    assign(top, "wp_pearl")
    base = build_base()
    box_uv(base)
    assign(base, "wp_pearl")
    feet = build_feet()
    assign(feet, "wp_rubber")
    bez = build_bezel()
    box_uv(bez)
    assign(bez, "wp_trim")
    filt = build_filter()
    guide = build_paper_guide()
    body = join([top, base, feet, bez, build_vent_backing(), build_latch_floors(), guide, build_badge()] + build_ledge() + build_rear_panel(), "printer_body")
    panel = build_panel()
    assign(panel, "wp_panel")
    disp = build_display()
    assign(disp, "wp_display")
    cover, cover_pivot = build_cover()
    frame = build_frame()
    platen, platen_pivot = build_platen()
    bail, bail_pivot = build_bail()
    rolls, rolls_pivot = build_feedrolls()
    screw, screw_pivot = build_leadscrew()
    cam, cam_pivot = build_cam()
    carrier, carrier_pivot = build_carrier()
    knob, knob_pivot = build_ribbon_knob()
    decals = list(CARRIER_DECALS)
    wheel, wheel_pivot = build_wheel()
    hammer, hammer_pivot = build_hammer()
    feeder, feeder_moving = build_feeder()
    keys = build_keys()
    leds = build_leds()
    power, power_pivot = build_power()
    ok = clearance_check({"top": body, "filter": filt, "frame": frame, "feeder": feeder, "carrier": carrier, "wheel": wheel,
                          "hammer": hammer, "cover": cover, "platen": platen, "bail": bail})
    for ob in (body, panel, disp, frame, feeder, filt, *decals):
        place(ob, (0, 0, 0))
    filt.name = "printer_filter"
    for ob, pv in ((cover, cover_pivot), (bail, bail_pivot), (rolls, rolls_pivot), (carrier, carrier_pivot), (wheel, wheel_pivot), (hammer, hammer_pivot), *feeder_moving):
        place(ob, pv)
    for ob, pv in [(platen, platen_pivot), (screw, screw_pivot), (cam, cam_pivot), (power, power_pivot), (knob, knob_pivot)] + keys + leds:
        place(ob, pv, local=True)
    for ob in (frame, platen, bail, rolls, cam, hammer, power, knob, carrier) + tuple(o for o, _ in leds):
        strip_uv(ob)
    total = 0
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        o.data.calc_loop_triangles()
        t = len(o.data.loop_triangles)
        total += t
        print(f"{o.name}: {t} tris")
    print("TOTAL:", total)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", use_selection=False)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")
    sys.path.insert(0, HERE)
    import gltf_quantize
    gltf_quantize.main([OUT])
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
