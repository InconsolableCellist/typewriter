"""Builds public/assets/models/wp_diskette.glb: the IBM 6360 dual diskette unit, its 8-inch diskette and paper
envelope, and the desk file that holds the diskettes not in a drive.

  /root/bpyenv/bin/python tools/blender/build_wp_diskette.py            # writes the GLB
  /root/bpyenv/bin/python tools/blender/render_wp_diskette.py           # previews from the photographs' viewpoints

Shapes and positions are read from the photographs and drawings (docs/displaywriter/models.md, "Diskette unit"): BRO p.18
and p.1, GIM p.25, ORG p.54, CSG p.42, ST p.90 and p.103, PSM p.61. Sizes are HW 3.1 (254 x 292 x 398 mm) and the
8-inch diskette's 203.2 mm. The covers are closed solids with a 3 mm wall, cut by booleans and bevelled after; the seam
between the front cover (slides forward) and the top cover (slides back, PSM p.61) is a real gap.

Nodes, in the unit's frame (origin on the desk under the centre; x right, y up, z toward the operator):
  wp_diskette_top_cover, wp_diskette_front_cover, wp_diskette_base, wp_diskette_feet, wp_diskette_drive0/1 (dark
  bezel and diskette guide), wp_diskette_rear (connector panel, sockets, screws), wp_diskette_badge (UV 0..1, the IBM
  badge is drawn at run time), wp_diskette_lever0/1 (pivot at the axle; rest = open, pointing up; the kit turns them
  by -lever about z) with wp_diskette_lever*_label (UV 0..1), wp_diskette_slot0/1 (empties at each slot mouth's centre).
Templates the view clones, in their own frames:
  wp_diskette_jacket (card frame: x along the label, y up toward the label edge, z out of the label face; centre at
  the origin) with wp_diskette_media and wp_diskette_label (UV 0..1); wp_diskette_envelope (same axes, origin at its
  bottom edge); wp_diskette_file (the desk file, origin on the desk under its centre) with wp_diskette_place0..5.
Materials: wp_pearl, wp_gray, wp_dark, wp_rubber, wp_metal, wp_label, wp_jacket, wp_media, wp_disk_label,
wp_envelope. UVs box projected, one unit = 0.2 m, except the label quads.
The script exits 1 when a diskette's path through a slot, or a lever's sweep, touches a panel.
"""
import math
import os
import sys

import bpy  # first: the bpy module provides bmesh and mathutils
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "wp_diskette.glb")
PREVIEWS = os.path.join(HERE, "previews")

UV_METRES = 0.2
MACHINE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# ---- the unit (HW 3.1) ----
W, H, D = 0.254, 0.292, 0.398
HX, ZF, ZR = W / 2, D / 2, -D / 2
FOOT = 0.0035                 # rubber feet
COVER_Y = 0.016               # lower edge of the covers; the grey base shows below it (BRO p.18 dark band)
T = 0.003                     # cover wall
R_EDGE = 0.019                # the covers' rounded edges, vertical and along the top (GIM p.25, PSM p.61)
GAP = 0.0008                  # panel gap
Z_SEAM = ZF - 0.034           # front cover's rear edge: its return is the corner radius and a short flat (GIM p.25)

# ---- the slots and levers (BRO p.18, ORG p.54, CSG p.42) ----
SLOT_X = (-0.045, 0.045)      # slot centres, 90 mm apart (BRO p.18: 119 px at 1.32 px/mm)
SLOT_Y = (0.036, 0.250)       # the cover's slot opening; an 8-inch diskette needs 203.2 mm (ORG p.54: 22 mm above the cover's lower edge to 37 mm under its top)
SLOT_HALF = 0.0045            # half width of the cover's slot
GUIDE_HALF = 0.00175          # half width of the guide the diskette runs in
GUIDE_Y = (0.038, 0.248)
DISK = 0.2032
DISK_Y = (SLOT_Y[0] + SLOT_Y[1]) / 2       # the diskette's centre height in the guide
DISK_T = 0.0016
HOME = DISK + 0.005 + 0.003                # leading edge at home, from the mouth (wordproc1980.js diskettes.slide)
PIVOT_DX, PIVOT_Y = -0.020, 0.082          # lever axle, left of each slot (ST p.90: the shaft comes from the drive's left frame)
POCKET = (-0.036, 0.038, -0.018, 0.022)    # dark pocket round the closed lever, from (slot x, pivot y): x0, x1, y0, y1 (GIM p.25)
POCKET_FLOOR = ZF - 0.006
BADGE = (-HX + 0.022, -HX + 0.046, 0.240, 0.268)   # top left, level with the slot tops (ORG p.54, BRO p.1 and p.18)


# ---------- mesh helpers (as build_element_enclosure.py) ----------

def rounded_rect(x0, y0, x1, y1, r, seg=6):
    pts = []
    for cx, cy, a0 in ((x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)):
        for j in range(seg + 1):
            a = math.radians(a0 + 90 * j / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def prism(poly, axis, a0, a1):
    """A polygon extruded along an axis. axis 'z': poly (x, y); 'y': poly (x, z); 'x': poly (z, y)."""
    bm = bmesh.new()

    def v(u, w, a):
        if axis == "z":
            return Vector((u, w, a))
        if axis == "y":
            return Vector((u, a, w))
        return Vector((a, w, u))
    lo = [bm.verts.new(v(p[0], p[1], a0)) for p in poly]
    hi = [bm.verts.new(v(p[0], p[1], a1)) for p in poly]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def cylinder(r, a0, a1, axis="z", at=(0, 0), seg=24):
    pts = [(at[0] + r * math.cos(2 * math.pi * i / seg), at[1] + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    return prism(pts, axis, a0, a1)


def box(x0, x1, y0, y1, z0, z1):
    return prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], "z", z0, z1)


def rounded_box(x0, x1, y0, y1, z0, z1, r, seg=5):
    """A box with its vertical edges and top edges rounded (radius r); the bottom edges stay square."""
    bm = box(x0, x1, y0, y1, z0, z1)
    edges = [e for e in bm.edges if not all(v.co.y < y0 + 1e-6 for v in e.verts)]
    bmesh.ops.bevel(bm, geom=edges, offset=r, offset_type="OFFSET", segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def ob_from(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def boolean(a, b, op="DIFFERENCE", consume=True):
    mod = a.modifiers.new("b", "BOOLEAN")
    mod.operation = op
    mod.object = b
    mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = a
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if consume:
        bpy.data.objects.remove(b)


def copy_ob(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    bpy.context.collection.objects.link(c)
    return c


def join(obs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    obs[0].name = name
    obs[0].data.name = name
    return obs[0]


def bevel_finish(ob, width=0.0008, segs=2, angle=35):
    """Rounds every real edge (the big radii are finer than the limit angle), then weighted normals keep flats flat."""
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
    smooth(ob)


def smooth(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle() < math.radians(40)
    bm.to_mesh(ob.data)
    bm.free()
    wn = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    wn.weight = 100
    wn.keep_sharp = True
    wn.mode = "FACE_AREA"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=wn.name)


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


def plane_uv(ob, origin, du, dv, front=None, elsewhere=None):
    """UV = ((p - origin) . du, (p - origin) . dv), du and dv scaled to span 0..1. With `front` (a normal), faces not
    facing it get the single UV `elsewhere`, a blank corner of the run-time canvas."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    o, du, dv = Vector(origin), Vector(du), Vector(dv)
    for f in bm.faces:
        for lp in f.loops:
            if front is not None and f.normal.dot(Vector(front)) < 0.9:
                lp[uv].uv = elsewhere
            else:
                p = lp.vert.co - o
                lp[uv].uv = (p.dot(du), p.dot(dv))
    bm.to_mesh(ob.data)
    bm.free()


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ---------- the cabinet ----------

def build_covers():
    outer = ob_from(rounded_box(-HX, HX, COVER_Y, H, ZR, ZF, R_EDGE), "outer")
    inner = ob_from(rounded_box(-HX + T, HX - T, COVER_Y - 0.01, H - T, ZR + T, ZF - T, R_EDGE - T), "inner")
    boolean(outer, inner)
    front = copy_ob(outer, "wp_diskette_front_cover")
    boolean(front, ob_from(box(-1, 1, -1, 1, -1, Z_SEAM + GAP / 2), "cut"))
    top = outer
    top.name = "wp_diskette_top_cover"
    boolean(top, ob_from(box(-1, 1, -1, 1, Z_SEAM - GAP / 2, 1), "cut"))
    # The front: a slot for each drive, widening into the dark pocket round its lever (GIM p.25, CSG p.42).
    for sx in SLOT_X:
        boolean(front, ob_from(prism(rounded_rect(sx - SLOT_HALF, SLOT_Y[0], sx + SLOT_HALF, SLOT_Y[1], 0.0025, 3), "z", ZF - 0.02, ZF + 0.01), "slot"))
        x0, x1, y0, y1 = POCKET
        boolean(front, ob_from(prism(rounded_rect(sx + x0, PIVOT_Y + y0, sx + x1, PIVOT_Y + y1, 0.004, 3), "z", ZF - 0.02, ZF + 0.01), "pocket"))
    # The top: a shallow recess that runs over the rear edge and down the back, to push the cover back by (CSG p.42 and
    # PSM p.61 drawings; the use is inferred). The outer 1.2 mm of the shell, inside a rounded rectangle seen from above.
    skin = ob_from(rounded_box(-HX - 0.01, HX + 0.01, COVER_Y, H + 0.01, ZR - 0.01, ZF, R_EDGE), "skin")
    boolean(skin, ob_from(rounded_box(-HX + 0.0012, HX - 0.0012, COVER_Y - 0.01, H - 0.0012, ZR + 0.0012, ZF - 0.0012, R_EDGE - 0.0012), "core"))
    boolean(skin, ob_from(prism(rounded_rect(-0.055, ZR - 0.02, 0.055, ZR + 0.070, 0.008, 4), "y", H - 0.040, H + 0.02), "region"), "INTERSECT")
    boolean(top, skin)
    # The rear: a notch right of centre, seen from behind, for the connector panel (PSM p.61; three cables, HW 3.1).
    boolean(top, ob_from(prism(rounded_rect(-0.086, 0.0, -0.004, 0.052, 0.003, 2), "z", ZR - 0.01, ZR + 0.01), "notch"))
    return front, top


def build_base():
    base = ob_from(prism(rounded_rect(-HX + 0.008, ZR + 0.008, HX - 0.008, ZF - 0.008, 0.012, 5), "y", FOOT - 0.0005, COVER_Y + 0.003), "wp_diskette_base")
    feet = bmesh.new()
    for x in (-0.098, 0.098):
        for z in (-0.165, 0.165):
            bm = cylinder(0.011, 0.0, FOOT, "y", (x, z), 14)
            me = bpy.data.meshes.new("f")
            bm.to_mesh(me)
            bm.free()
            feet.from_mesh(me)
            bpy.data.meshes.remove(me)
    return base, ob_from(feet, "wp_diskette_feet")


def build_drive():
    """Built once at x = 0 and placed at each slot (the two drives share one mesh). The dark drive front behind the cover: a bezel with the lever's pocket floor and the guide's mouth, and the guide
    channel the diskette runs in, closed beyond home so the slot never shows the inside."""
    sx = 0.0
    bez = ob_from(box(sx - 0.040, sx + 0.042, 0.030, 0.256, ZF - 0.008, ZF - T - 0.0002), "bez")
    x0, x1, y0, y1 = POCKET
    boolean(bez, ob_from(prism(rounded_rect(sx + x0 + 0.0002, PIVOT_Y + y0 + 0.0002, sx + x1 - 0.0002, PIVOT_Y + y1 - 0.0002, 0.0038, 3), "z", POCKET_FLOOR, ZF), "p"))
    boolean(bez, ob_from(prism(rounded_rect(sx - SLOT_HALF + 0.0002, SLOT_Y[0] + 0.0002, sx + SLOT_HALF - 0.0002, SLOT_Y[1] - 0.0002, 0.0023, 3), "z", ZF - 0.0045, ZF), "s"))
    boolean(bez, ob_from(box(sx - GUIDE_HALF, sx + GUIDE_HALF, GUIDE_Y[0], GUIDE_Y[1], ZF - 0.02, ZF), "g"))
    ch = ob_from(box(sx - 0.006, sx + 0.006, 0.034, 0.252, ZF - HOME - 0.012, ZF - 0.008), "ch")
    boolean(ch, ob_from(box(sx - GUIDE_HALF, sx + GUIDE_HALF, GUIDE_Y[0], GUIDE_Y[1], ZF - HOME - 0.008, ZF), "g"))
    # The axle's bush in the pocket floor.
    bush = ob_from(cylinder(0.0045, POCKET_FLOOR - 0.001, POCKET_FLOOR + 0.0004, "z", (sx + PIVOT_DX, PIVOT_Y), 16), "bush")
    return join([bez, ch, bush], "wp_diskette_drive0")


def build_rear():
    """Connector panel in the rear notch: AC, DC and signal sockets (HW 3.1, PSM p.61), and the cover's two screws."""
    panel = ob_from(box(-0.083, -0.007, FOOT + 0.002, 0.049, ZR + 0.004, ZR + 0.012), "wp_diskette_rear")
    metal = []
    for x, r in ((-0.020, 0.0062), (-0.043, 0.0075), (-0.068, 0.0085)):
        shell = ob_from(cylinder(r, ZR + 0.0005, ZR + 0.0045, "z", (x, 0.031), 16), "sock")
        boolean(shell, ob_from(cylinder(r - 0.0016, ZR - 0.001, ZR + 0.003, "z", (x, 0.031), 16), "in"))
        metal.append(shell)
    for x in (-0.105, 0.105):
        head = ob_from(cylinder(0.0042, ZR - 0.0016, ZR + 0.0003, "z", (x, 0.032), 12), "screw")
        boolean(head, ob_from(box(x - 0.0032, x + 0.0032, 0.0315, 0.0325, ZR - 0.003, ZR - 0.0009), "slot"))
        metal.append(head)
    return panel, join(metal, "wp_diskette_fittings")


def build_badge():
    x0, x1, y0, y1 = BADGE
    b = ob_from(prism(rounded_rect(x0, y0, x1, y1, 0.0015, 3), "z", ZF - 0.0002, ZF + 0.0007), "wp_diskette_badge")
    return b


def build_lever():
    """The operator handle (ST p.90 'operator handle', CSG p.42 'load lever') in its rest pose, open: a hub on the axle
    and an arm pointing up, a grip rib standing out along it. Closed, the kit turns it 90 degrees clockwise to lie
    across the slot, hub at the left (ORG p.54: the L seen from the front), with the 1/2D mark low on the hub (BRO p.18)."""
    parts = []
    parts.append(ob_from(cylinder(0.0075, POCKET_FLOOR + 0.0006 - ZF, 0.0012, "z", (0, 0), 24), "boss"))
    parts.append(ob_from(prism(rounded_rect(-0.018, -0.014, 0.012, 0.014, 0.004, 3), "z", 0.0010, 0.0046), "hub"))
    arm = [(-0.012, 0.008), (0.012, 0.008), (0.012, 0.0475), (0.007, 0.0525), (-0.007, 0.0525), (-0.012, 0.0475)]
    parts.append(ob_from(prism(arm, "z", 0.0010, 0.0042), "arm"))
    r = ob_from(prism([(-0.0062, 0.0046), (0.050, 0.0046), (0.050, 0.0085), (0.042, 0.0128), (-0.0005, 0.0128), (-0.0062, 0.0090)], "x", -0.0017, 0.0017), "rib")
    # prism 'x' takes (z, y): swap so the rib runs along y with its height along z.
    me = r.data
    for v in me.vertices:
        v.co = Vector((v.co.x, v.co.z, v.co.y))
    me.flip_normals()
    parts.append(r)
    lever = parts[0]
    for o in parts[1:]:
        boolean(lever, o, "UNION")
    lever.name = lever.data.name = "wp_diskette_lever0"
    bevel_finish(lever, width=0.0006, segs=2)
    assign(lever, MATS["wp_dark"])
    box_uv(lever)
    # The drive-type mark, a printed plate low on the hub, reading along the arm when closed.
    lab = ob_from(prism(rounded_rect(0.0030, -0.0120, 0.0105, 0.0060, 0.0008, 2), "z", 0.0046, 0.00475), "wp_diskette_lever0_label")
    # u runs along rest +y (closed: left to right), v along rest -x (closed: upward).
    plane_uv(lab, (0.0105, -0.0120, 0), (0, 1 / 0.018, 0), (-1 / 0.0075, 0, 0))
    assign(lab, MATS["wp_label"])
    lab.parent = lever
    return lever, lab


# ---------- the diskette, its envelope and the desk file ----------

def build_jacket():
    """An 8-inch diskette in its card frame (x along the label, y up toward the label edge, z out of the label face):
    203.2 mm square black jacket, hub hole, index hole, head window and write-protect notch; the media inside."""
    s = DISK / 2
    j = ob_from(prism(rounded_rect(-s, -s, s, s, 0.002, 3), "z", -DISK_T / 2, DISK_T / 2), "wp_diskette_jacket")
    boolean(j, ob_from(cylinder(0.01905, -0.01, 0.01, "z", (0, 0), 32), "hub"))
    boolean(j, ob_from(cylinder(0.0032, -0.01, 0.01, "z", (0.027, -0.025), 16), "index"))
    boolean(j, ob_from(prism(rounded_rect(-0.00635, -0.0915, 0.00635, -0.0325, 0.00634, 6), "z", -0.01, 0.01), "head"))
    boolean(j, ob_from(box(0.0475, 0.0538, -s - 0.01, -s + 0.0095, -0.01, 0.01), "notch"))
    smooth(j)                     # a 1.6 mm sheet: its edges are sharp enough unbevelled
    box_uv(j)
    media = ob_from(cylinder(0.0995, -0.00006, 0.00006, "z", (0, 0), 48), "wp_diskette_media")
    boolean(media, ob_from(cylinder(0.0185, -0.01, 0.01, "z", (0, 0), 32), "hub"))
    smooth(media)
    box_uv(media)
    label = ob_from(box(-0.096, 0.096, 0.058, 0.098, DISK_T / 2 + 0.00002, DISK_T / 2 + 0.00006), "wp_diskette_label")
    plane_uv(label, (-0.096, 0.058, 0), (1 / 0.192, 0, 0), (0, 1 / 0.040, 0))
    assign(j, MATS["wp_jacket"])
    assign(media, MATS["wp_media"])
    assign(label, MATS["wp_disk_label"])
    media.parent = j
    label.parent = j
    return j, media, label


ENV_W, ENV_H, ENV_T = 0.213, 0.196, 0.0028

def build_envelope():
    """The paper storage envelope (ST p.90 'shipping/storage envelope', MD p.1), open along the top with a thumb cut in
    the front sheet. Origin at the middle of its bottom edge, the printed front facing +z (UV 0..1 over it)."""
    hw = ENV_W / 2
    e = ob_from(box(-hw, hw, 0, ENV_H, -ENV_T / 2, ENV_T / 2), "wp_diskette_envelope")
    boolean(e, ob_from(box(-hw + 0.0008, hw - 0.0008, 0.0008, ENV_H + 0.01, -ENV_T / 2 + 0.0003, ENV_T / 2 - 0.0003), "in"))
    boolean(e, ob_from(cylinder(0.019, 0.0, 0.01, "z", (0, ENV_H), 24), "thumb"))
    smooth(e)
    plane_uv(e, (-hw, 0, 0), (1 / ENV_W, 0, 0), (0, 1 / ENV_H, 0), front=(0, 0, 1), elsewhere=(0.995, 0.005))
    assign(e, MATS["wp_envelope"])
    return e


FILE_X, FILE_Z = 0.118, 0.062
PLACES = 6

def place_z(k):
    return -0.042 + 0.0165 * k

def place_y(k):
    """The floor steps up 7 mm a place toward the back, so every diskette's label edge shows over the one in front."""
    return 0.003 + 0.007 * (PLACES - 1 - k)

def build_file():
    """A desk file for 8-inch diskettes, as offices kept them beside the drives: a moulded tray with a tall back and a
    low front, a floor stepped up toward the back with a rib at each step to keep the envelopes upright, and a thumb
    scoop in the front wall."""
    prof = [(-FILE_Z, 0.0), (FILE_Z, 0.0), (FILE_Z, 0.052), (FILE_Z - 0.012, 0.058), (-FILE_Z + 0.004, 0.150), (-FILE_Z, 0.150)]
    outer = ob_from(prism(prof, "x", -FILE_X, FILE_X), "wp_diskette_file")
    inner_prof = [(-FILE_Z + 0.003, 0.003), (FILE_Z - 0.003, 0.003), (FILE_Z - 0.003, 0.3), (-FILE_Z + 0.003, 0.3)]
    boolean(outer, ob_from(prism(inner_prof, "x", -FILE_X + 0.003, FILE_X - 0.003), "in"))
    boolean(outer, ob_from(cylinder(0.024, 0.0, 0.1, "z", (0, 0.060), 24), "scoop"))
    steps = [(-FILE_Z + 0.002, 0.002), (-FILE_Z + 0.002, place_y(0))]
    for k in range(PLACES - 1):
        zf = place_z(k) + 0.0085
        steps += [(zf, place_y(k)), (zf, place_y(k + 1))]
    steps += [(FILE_Z - 0.002, place_y(PLACES - 1)), (FILE_Z - 0.002, 0.002)]
    boolean(outer, ob_from(prism(steps, "x", -FILE_X + 0.002, FILE_X - 0.002), "steps"), "UNION")
    for k in range(PLACES):
        z = place_z(k) + 0.0035
        boolean(outer, ob_from(box(-FILE_X + 0.002, FILE_X - 0.002, place_y(k) - 0.001, place_y(k) + 0.0045, z, z + 0.002), "rib"), "UNION")
    bevel_finish(outer, width=0.0009, segs=1)
    box_uv(outer)
    assign(outer, MATS["wp_dark"])
    pads = bmesh.new()
    for x in (-0.095, 0.095):
        for z in (-0.045, 0.045):
            bm = cylinder(0.006, -0.0012, 0.0002, "y", (x, z), 10)
            me = bpy.data.meshes.new("p")
            bm.to_mesh(me)
            bm.free()
            pads.from_mesh(me)
            bpy.data.meshes.remove(me)
    pads = ob_from(pads, "wp_diskette_file_pads")
    box_uv(pads)
    assign(pads, MATS["wp_rubber"])
    places = []
    for k in range(PLACES):
        e = bpy.data.objects.new(f"wp_diskette_place{k}", None)
        bpy.context.collection.objects.link(e)
        e["machine_location"] = (0.0, place_y(k) + 0.0002, place_z(k))
        places.append(e)
    return outer, pads, places


# ---------- materials ----------

MATS = {}

def make_materials():
    def m(name, base, r, met=0.0):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        b = mat.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = base
        b.inputs["Roughness"].default_value = r
        b.inputs["Metallic"].default_value = met
        MATS[name] = mat
    m("wp_pearl", (0.72, 0.69, 0.61, 1), 0.6)
    m("wp_gray", (0.27, 0.26, 0.24, 1), 0.65)
    m("wp_dark", (0.018, 0.018, 0.017, 1), 0.5)
    m("wp_rubber", (0.015, 0.015, 0.015, 1), 0.9)
    m("wp_metal", (0.6, 0.6, 0.58, 1), 0.35, 1.0)
    m("wp_label", (0.75, 0.75, 0.72, 1), 0.5)
    m("wp_jacket", (0.012, 0.012, 0.012, 1), 0.45)
    m("wp_media", (0.08, 0.045, 0.025, 1), 0.3)
    m("wp_disk_label", (0.8, 0.78, 0.7, 1), 0.7)
    m("wp_envelope", (0.85, 0.84, 0.8, 1), 0.85)


# ---------- clearance ----------

def tree_of(ob, matrix=None):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(matrix if matrix is not None else Matrix.Translation(ob.location))
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def box_tree(x0, x1, y0, y1, z0, z1):
    bm = box(x0, x1, y0, y1, z0, z1)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def clearance_check(statics, levers):
    """A diskette's whole path, from the mouth to home, through each slot; each lever's sweep from open to closed."""
    bad = [f"{o.name} is empty" for o in statics + levers if len(o.data.polygons) < 4]
    trees = {o.name: tree_of(o) for o in statics}
    for i, sx in enumerate(SLOT_X):
        path = box_tree(sx - DISK_T / 2 - 0.0001, sx + DISK_T / 2 + 0.0001, DISK_Y - DISK / 2, DISK_Y + DISK / 2, ZF - HOME - 0.001, ZF + 0.25)
        for name, t in trees.items():
            if t.overlap(path):
                bad.append(f"diskette path {i} touches {name}")
    for lv in levers:
        p = Vector(lv.location)
        for deg in range(0, 91, 10):
            m = Matrix.Translation(p) @ Matrix.Rotation(math.radians(-deg), 4, "Z")
            t = tree_of(lv, m)
            for name, st in trees.items():
                if t.overlap(st):
                    bad.append(f"{lv.name} at {deg} deg touches {name}")
                    break
    if bad:
        print("CLEARANCE FAILED:\n  " + "\n  ".join(sorted(set(bad))))
        sys.exit(1)
    print("clearance ok")


# ---------- main ----------

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    front, top = build_covers()
    base, feet = build_base()
    drive = build_drive()
    rear, fittings = build_rear()
    badge = build_badge()
    for ob, w in ((front, 0.0009), (top, 0.0009), (base, 0.0008)):
        bevel_finish(ob, width=w)
    for ob in (rear, badge):
        bevel_finish(ob, width=0.0004, segs=1)
    smooth(fittings)
    smooth(drive)                 # dark, and seen only round the pocket and down the slot
    smooth(feet)
    for ob, mat in ((front, "wp_pearl"), (top, "wp_pearl"), (base, "wp_gray"), (feet, "wp_rubber"), (rear, "wp_dark"), (fittings, "wp_metal")):
        assign(ob, MATS[mat])
        box_uv(ob)
    assign(drive, MATS["wp_dark"])
    box_uv(drive)
    drives = [drive, bpy.data.objects.new("wp_diskette_drive1", drive.data)]
    bpy.context.collection.objects.link(drives[1])
    for d, sx in zip(drives, SLOT_X):
        d.location = (sx, 0, 0)
    assign(badge, MATS["wp_label"])
    plane_uv(badge, (BADGE[0], BADGE[2], 0), (1 / (BADGE[1] - BADGE[0]), 0, 0), (0, 1 / (BADGE[3] - BADGE[2]), 0))
    lever, lab = build_lever()
    lever1 = bpy.data.objects.new("wp_diskette_lever1", lever.data)
    lab1 = bpy.data.objects.new("wp_diskette_lever1_label", lab.data)
    for o in (lever1, lab1):
        bpy.context.collection.objects.link(o)
    lab1.parent = lever1
    levers = [(lever, lab), (lever1, lab1)]
    for (lv, _), sx in zip(levers, SLOT_X):
        lv.location = (sx + PIVOT_DX, PIVOT_Y, ZF)
    clearance_check([front, top, base] + drives, [lv for lv, _ in levers])
    slots = []
    for i, sx in enumerate(SLOT_X):
        e = bpy.data.objects.new(f"wp_diskette_slot{i}", None)
        bpy.context.collection.objects.link(e)
        e.location = (sx, DISK_Y, ZF)
        slots.append(e)
    jacket, media, label = build_jacket()
    envelope = build_envelope()
    holder, pads, places = build_file()
    pads.parent = holder
    for e in places:
        e.parent = holder
        e.location = Vector(e["machine_location"])
        del e["machine_location"]
        e.rotation_euler = (math.radians(-5), 0, 0)      # leaning back against the one behind (machine x axis)

    objs = [front, top, base, feet, rear, fittings, badge, drive, lever, lab, jacket, media, label, envelope, holder, pads]
    for o in objs:
        o.data.transform(MACHINE_TO_BLENDER)
        o.data.name = o.name
    for o in drives + [lv for lv, _ in levers] + slots:
        loc = Vector(o.location)
        o.location = (loc.x, -loc.z, loc.y)
    for e in places:
        loc = Vector(e.location)
        e.location = (loc.x, -loc.z, loc.y)
    total = 0
    for o in objs:
        o.data.calc_loop_triangles()
        t = len(o.data.loop_triangles)
        total += t
        print(f"{o.name}: {t} tris, {len(o.data.vertices)} verts")
    print("TOTAL:", total)
    if "--no-export" not in sys.argv:
        bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False, export_texcoords=True,
                                  export_normals=True, export_materials="EXPORT", use_selection=False, export_extras=False)
        print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
