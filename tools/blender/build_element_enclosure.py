"""Builds public/assets/models/element_enclosure.glb, the housing of the element1971 office typewriter.

  node tools/gen/export_element.mjs                                          # element1971.json, if the definition changed
  ~/bin/blender --background --python tools/blender/build_element_enclosure.py

Every panel is a closed solid cut from one master shape with real wall thickness; panel gaps are real gaps, and all
edges are bevelled after the CSG with weighted normals so large flat faces stay flat right up to the edge. Keyboard
wells follow the definition's key positions. The script exits 1 when a moving part's sampled envelope touches a panel.

Nodes (machine coordinates, all identity except element_hood, whose pivot is the hinge):
  element_base, element_body, element_rear_cover, element_hood, element_feet, element_strain_relief, element_keybed.
Materials: element_paint (crinkle), element_black (trim, strain relief, keybed), element_rubber (feet).
UVs are box projected, one unit = 0.2 m, as for the other models.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "element_enclosure.glb")
JSON = os.path.join(HERE, "element1971.json")
CAPS = os.path.join(ROOT, "src", "render", "element-keycaps.json")   # cap sizes, shared with the renderer

UV_METRES = 0.2
MACHINE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

M, GEO = {}, {}
if os.path.exists(JSON):
    d = json.load(open(JSON))
    M, GEO = d["machine"], d["geometry"]

A = 0.290                    # half width at the base
Z_F, Z_R = 0.204, -0.256     # front and rear of the plan (0.46 m deep, carried rearward so the space bar sits as near the front edge as the photos have it)
FOOT = 0.0085                # underside of the shell above the desk
LEAN = 0.018                 # the sides lean in by this much over the height
T = 0.0024                   # wall
GAP = 0.0007                 # panel gap
SEAM_F, SEAM_R = 0.0215, 0.0335    # height of the thin base seam at the front and rear
WH = 0.2415                  # half width of the hood
SLOT = 0.2065                # half width of the slot, just outside the platen
STRIP = 0.2425               # the scale strip runs the hood's whole width at its foot
Z_RIM = 0.0655               # front rim of the hood opening, at the strip
Z_REARWALL = -0.1305         # rear wall of the slot
HINGE = [0.0, 0.1872, -0.0300]  # hood hinge, at the rear lip of the hood (machine x, y, z), axis x

platen = M["platen"]
PZ, PY = platen["center"][2], platen["center"][1]
KNOB_X = platen["length"] / 2 + platen["knobOffset"]


def round_poly(pts, radii, seg=7):
    """Closed polygon of (z, y); corners with radius r replaced by arcs."""
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
        cosang = max(-1.0, min(1.0, a.dot(b)))
        half = math.acos(cosang) / 2
        d = min(r / math.tan(half), 0.49 * la, 0.49 * lb)
        rr = d * math.tan(half)
        c = p + (a + b).normalized() * (d / math.cos(half))
        p0 = p + a * d - c
        p1 = p + b * d - c
        a0 = math.atan2(p0.y, p0.x)
        a1 = math.atan2(p1.y, p1.x)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for j in range(seg + 1):
            ang = a0 + da * j / seg
            out.append((c.x + rr * math.cos(ang), c.y + rr * math.sin(ang)))
    return out


def inset_poly(poly, t):
    """Moves each vertex of a closed polygon inward by t along its corner bisector (fine for the gentle outlines here)."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sgn = 1 if area > 0 else -1
    out = []
    for i in range(n):
        p = Vector(poly[i])
        a = (p - Vector(poly[i - 1])).normalized()
        b = (Vector(poly[(i + 1) % n]) - p).normalized()
        na = Vector((-a.y, a.x)) * sgn
        nb = Vector((-b.y, b.x)) * sgn
        nv = (na + nb).normalized()
        d = t / max(0.35, nv.dot(na))
        out.append((p.x + nv.x * d, p.y + nv.y * d))
    return out


def prism(poly, axis, a0, a1):
    """A polygon extruded along an axis. axis 'x': poly (z, y); 'z': poly (x, y); 'y': poly (x, z)."""
    bm = bmesh.new()
    def v(u, w, a):
        if axis == "x":
            return Vector((a, w, u))
        if axis == "z":
            return Vector((u, w, a))
        return Vector((u, a, w))
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


def rounded_rect(x0, z0, x1, z1, r, seg=8):
    pts = []
    for cx, cz, a0 in ((x1 - r, z1 - r, 0), (x0 + r, z1 - r, 90), (x0 + r, z0 + r, 180), (x1 - r, z0 + r, 270)):
        for j in range(seg + 1):
            a = math.radians(a0 + 90 * j / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def ob_from(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def boolean(a, b, op="DIFFERENCE", consume=True):
    """Applies b onto a. Booleans leave edges of tool objects' UV/material alone: the panel's own material stays."""
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


def bevel_finish(ob, width=0.0011, segs=2, angle=32):
    """Rounds every real edge (arcs are finer than the limit angle) then fixes the normals so flats stay flat."""
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.width = width
    mod.segments = segs
    mod.profile = 0.6
    mod.harden_normals = False
    mod.miter_outer = "MITER_ARC"
    mod.use_clamp_overlap = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
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
    bpy.ops.object.modifier_apply(modifier=wn.name)


def box_uv(ob):
    """UVs from box projection in machine axes: one unit = UV_METRES."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        ax = max(range(3), key=lambda i: abs(f.normal[i]))
        for l in f.loops:
            c = l.vert.co
            pt = (c.z, c.y) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y)
            l[uv].uv = (pt[0] / UV_METRES, pt[1] / UV_METRES)
    bm.to_mesh(ob.data)
    bm.free()


# ---------- master profile (machine z, y): the silhouette of the shoulders and the rear cover ----------

def master_profile(inset=0.0):
    pts = [
        (Z_F, FOOT - 0.001),
        (Z_F - 0.003, 0.0470),          # front apron, leaning back a little
        (Z_F - 0.010, 0.0555),          # deck front edge
        (0.0830, 0.1095),               # deck rises to the foot of the shoulder step, parallel to the key rows
        (0.0640, 0.1580),               # shoulder step, in the plane of the hood face
        (-0.0300, 0.1970),              # shoulder top, just above the hood lip so the hood sits between the wings
        (-0.1400, 0.1990),              # the top runs back almost level, a long low wedge
        (Z_R + 0.012, 0.1860),          # rear top edge
        (Z_R, 0.0150),                  # rear face
        (Z_R + 0.0015, FOOT - 0.001),
    ]
    radii = [0.003, 0.004, 0.012, 0.014, 0.005, 0.004, 0.012, 0.010, 0.004, 0.003]
    p = round_poly(pts, radii)
    return inset_poly(p, inset) if inset else p


def lean_section(inset=0.0):
    """Front elevation: the sides lean in with height."""
    a = A - inset
    return [(-a, -0.02), (a, -0.02), (a - LEAN * 0.24 / 0.21, 0.24), (-(a - LEAN * 0.24 / 0.21), 0.24)]


def plan_outline(inset=0.0):
    return rounded_rect(-A + inset, Z_R + inset, A - inset, Z_F + inset * -1, 0.020 - inset * 0.7)


def master_solid(inset=0.0):
    ob = ob_from(prism(master_profile(inset), "x", -A - 0.02, A + 0.02), "m")
    boolean(ob, ob_from(prism(lean_section(inset), "z", -1, 1), "t"), "INTERSECT")
    boolean(ob, ob_from(prism(plan_outline(inset), "y", -1, 1), "t"), "INTERSECT")
    return ob


def region(poly, name="r"):
    """A very wide prism, for splitting."""
    return ob_from(prism(poly, "x", -2, 2), name)


def seam_y(z):
    return SEAM_F + (SEAM_R - SEAM_F) * (Z_F - z) / (Z_F - Z_R)


def below_seam_poly(extra=0.0):
    return [(1, seam_y(1) + extra), (1, -1), (-1, -1), (-1, seam_y(-1) + extra)]


# Rear cover: the top of the machine behind a seam that runs from the shoulder down to the knob axis, then back along
# the rear top edge. The body below keeps the whole rear face, as the photographs show no seam across it.
Z_SS, KNOB_Y = HINGE[2] - 0.0045, PY   # the seam starts at the hood's rear corner
REAR_LINE = 0.1540
CREST_Y = 0.2000                     # the seam's legs reach the top edge here, at the V's full width, so they show past the knob

def rear_region_poly(gap=0.0):
    """The top cover is a V in the side view, its point at the knob axis: one leg to the hood's corner, the other mirrored rearward."""
    z_rear = 2 * PZ - Z_SS
    return [(Z_SS + gap, 2), (Z_SS + gap, CREST_Y), (PZ, KNOB_Y - gap), (z_rear - gap, CREST_Y), (z_rear - gap, 2)]


def deck_y(z):
    """The deck plane, from the master profile's deck front edge to the shoulder foot."""
    z0, y0, z1, y1 = Z_F - 0.010, 0.0555, 0.0830, 0.1095
    return y0 + (y1 - y0) * (z - z0) / (z1 - z0)


def opening_prisms(extra=0.0, x_extra=0.0, slot_floor=-1.0):
    """The hood opening and the slot behind it, as prisms along x; extra grows them for the wall around the cut.
    The first also clears the deck plane forward of the rim, so the centre has a flat deck up to the strip, not the cheek's step."""
    hood = [(0.0900, deck_y(0.0900) + 0.0002 + extra), (0.0900, 2), (HINGE[2] - 0.0025, 2), (HINGE[2] - 0.0025, -1), (Z_RIM + extra, -1), (Z_RIM + extra, deck_y(Z_RIM + extra) + 0.0002 + extra)]
    slot = [(HINGE[2] - 0.0005, 2), (HINGE[2] - 0.0005, slot_floor), (Z_REARWALL - extra, slot_floor), (Z_REARWALL - extra, 2)]
    return [ob_from(prism(hood, "x", -(WH + GAP + x_extra), WH + GAP + x_extra), "open_h"), ob_from(prism(slot, "x", -(SLOT + x_extra), SLOT + x_extra), "open_s")]


SLOT_SKIRT = 0.1780                   # how far the slot side walls hang, just above the cartridge's top
CHIN = (0.0600, 0.1372)              # top of the strip recess in the hood's foot, across the middle only

def hood_profile(inset=0.0):
    # Foot at the deck rim, a steep rise to the chin line, then one long face up to the rear lip, curling down at the slot.
    h = HINGE
    pts = [
        (0.0620, 0.1140),
        (0.0668, 0.1178),                # foot, at the deck rim, either side of the strip
        CHIN,                            # the face proper starts here
        (h[2] + 0.0030, h[1] + 0.0048),  # top of the face at the lip
        (h[2] - 0.0032, h[1] + 0.0022),
        (h[2] - 0.0032, h[1] - 0.0100),
        (h[2] + 0.0015, 0.1140),
    ]
    radii = [0.0008, 0.0016, 0.0050, 0.0050, 0.0030, 0.0012, 0.0008]
    # Inset before rounding: offsetting the rounded outline folds its tight corners into a self-crossing polygon, which the boolean solver answers with an empty mesh.
    if inset:
        return round_poly(inset_poly(pts, inset), [max(0.0, r - inset) + 0.0002 for r in radii], seg=5)
    return round_poly(pts, radii, seg=5)


# ---------- keyboard ----------

def key_cells():
    """Wells as rectangles (x0, z0, x1, z1): the main block row by row, the space bar, and one each for the outer keys."""
    caps = json.load(open(CAPS))
    margin = caps["wellMargin"]
    hw, hd = caps["letterW"] / 2, caps["letterD"] / 2
    keys = GEO["keys"]
    rows = {}
    for k in keys:
        if k.get("kind") == "print":
            rows.setdefault(k["row"], []).append(k)
    row_list = []
    for r, ks in sorted(rows.items()):
        ks.sort(key=lambda k: k["pos"][0])
        z = ks[0]["pos"][2]
        row_list.append([ks[0]["pos"][0] - hw, ks[-1]["pos"][0] + hw, z])
    # Controls that sit inside the main block stretch their row; the rest get their own wells.
    apart = {"marginRelease", "index", "tabClear", "tabSet", "onOff", "correct"}
    wells, extra = [], []
    for k in keys:
        if k.get("kind") == "print":
            continue
        c = caps["controls"][k["id"]]
        if k["id"] == "space":
            wells.append((k["pos"][0] - c["w"] / 2 - margin, k["pos"][2] - c["d"] / 2 - margin, k["pos"][0] + c["w"] / 2 + margin, k["pos"][2] + c["d"] / 2 + margin))
        elif k["id"] in apart:
            extra.append(k)
        else:
            z = k["pos"][2]
            for row in row_list:
                if abs(row[2] - z) < 0.0125 or (k["id"] == "return" and abs(row[2] - z) < 0.02):
                    row[0] = min(row[0], k["pos"][0] - c["w"] / 2)
                    row[1] = max(row[1], k["pos"][0] + c["w"] / 2)
    pitch = 0.018
    for i, row in enumerate(row_list):
        z0 = row[2] - (pitch * 0.6)      # rows overlap their neighbours, so the block is one clean stepped opening
        z1 = row[2] + (pitch * 0.6)
        wells.append((row[0] - margin, z0, row[1] + margin, z1))
    for k in extra:
        c = caps["controls"][k["id"]]
        if k["id"] == "tabClear":
            k2 = next(q for q in keys if q["id"] == "tabSet")
            cz = (k["pos"][2] + k2["pos"][2]) / 2
            hz = abs(k["pos"][2] - k2["pos"][2]) / 2 + c["d"] / 2
            wells.append((k["pos"][0] - c["w"] / 2 - margin, cz - hz - margin, k["pos"][0] + c["w"] / 2 + margin, cz + hz + margin))
        elif k["id"] == "tabSet":
            continue
        else:
            wells.append((k["pos"][0] - c["w"] / 2 - margin, k["pos"][2] - c["d"] / 2 - margin, k["pos"][0] + c["w"] / 2 + margin, k["pos"][2] + c["d"] / 2 + margin))
    return wells


def build_body(master, inner):
    upper = copy_ob(master, "element_body")
    boolean(upper, region(below_seam_poly(GAP)), "DIFFERENCE")
    rear = copy_ob(upper, "element_rear_cover")
    boolean(rear, region(rear_region_poly()), "INTERSECT")
    boolean(upper, region(rear_region_poly(GAP)), "DIFFERENCE")
    # The cavity leaves wall material around both openings: the rim, the slot's rear wall and the cheeks' inner face.
    # The slot's side walls hang only as deep as SLOT_SKIRT, so the ribbon cartridge can run in under the wings at the travel extremes.
    inner2 = copy_ob(inner, "inner2")
    for tool in opening_prisms(T, T, slot_floor=SLOT_SKIRT):
        boolean(inner2, tool)
    for ob in (upper, rear):
        for tool in opening_prisms():
            boolean(ob, tool)
        boolean(ob, copy_ob(inner2, "i"), "DIFFERENCE")
    bpy.data.objects.remove(inner2)
    # Wells for the keys, straight through the deck.
    for x0, z0, x1, z1 in key_cells():
        boolean(upper, ob_from(prism(rounded_rect(x0, z0, x1, z1, 0.0018), "y", 0.02, 0.16), "well"))
    # Knob shaft holes, in the side panels at the seam.
    for s in (-1, 1):
        cyl = bmesh.new()
        bmesh.ops.create_cone(cyl, cap_ends=True, segments=32, radius1=0.0125, radius2=0.0125, depth=0.06, matrix=Matrix.Translation((s * 0.29, KNOB_Y, PZ)) @ Matrix.Rotation(math.pi / 2, 4, "Y"))
        cyl2 = cyl.copy()
        boolean(upper, ob_from(cyl, "c"))
        boolean(rear, ob_from(cyl2, "c"))
    # Slots for the corner paddle levers in the rear cover's wings, clear of the knobs. Positions are shared with the renderer.
    paddle_slots = json.load(open(CAPS))["paddles"]
    for s in (-1, 1):
        for sl in paddle_slots:
            x = s * sl["x"]
            r = ob_from(prism(rounded_rect(x - sl["w"] / 2, sl["z"] - sl["d"] / 2, x + sl["w"] / 2, sl["z"] + sl["d"] / 2, 0.0014), "y", sl["y"] - 0.018, sl["y"] + 0.05), "s")
            boolean(rear, r)
            s2 = ob_from(prism(rounded_rect(x - sl["w"] / 2, sl["z"] - sl["d"] / 2, x + sl["w"] / 2, sl["z"] + sl["d"] / 2, 0.0014), "y", sl["y"] - 0.018, sl["y"] + 0.05), "s")
            boolean(upper, s2)
    # Strain relief: a recess straddling the base seam at the rear centre.
    boolean(upper, strain_cutter())
    return upper, rear


def strain_cutter():
    return ob_from(prism([(-0.067, 0.0085), (0.067, 0.0085), (0.067, 0.056), (-0.067, 0.056)], "z", Z_R - 0.02, Z_R + 0.019), "sr")


def build_panels():
    master = master_solid()
    inner = master_solid(inset=T)
    base = copy_ob(master, "element_base")
    boolean(base, region(below_seam_poly()), "INTERSECT")
    boolean(base, copy_ob(inner, "i"), "DIFFERENCE")
    boolean(base, strain_cutter())
    body, rear = build_body(master, inner)
    # The hood, its own solid: real wall thickness; the underside open, skirt and lip remaining; a recess notched for the strip.
    hood = ob_from(prism(hood_profile(), "x", -WH, WH), "element_hood")
    # Open underneath: the forward skirt follows the deck; rearward of z = -0.004 only the lip is left, so the ribbon cartridge passes under at both travel extremes.
    for under in ([(0.2, 0.05), (-0.004, 0.05), (-0.004, CHIN[1] + 0.0086), (0.2, CHIN[1] - 0.0240)], [(-0.003, 0.05), (-0.2, 0.05), (-0.2, 0.1720), (-0.003, 0.1720)]):
        boolean(hood, ob_from(prism(under, "x", -WH - 0.01, WH + 0.01), "under"))
    boolean(hood, ob_from(prism(hood_profile(0.0028), "x", -WH + 0.003, WH - 0.003), "ih"))
    notch = [(0.15, CHIN[1] + 0.0006), (0.15, 0.09), (CHIN[0] - 0.0010, 0.09), (CHIN[0] - 0.0010, CHIN[1] + 0.0006)]
    boolean(hood, ob_from(prism(notch, "x", -STRIP, STRIP), "notch"))
    bpy.data.objects.remove(master)
    bpy.data.objects.remove(inner)
    return base, body, rear, hood


def build_feet():
    bm = bmesh.new()
    for x, z in ((-0.235, 0.190), (0.235, 0.190), (-0.235, -0.190), (0.235, -0.190)):
        mat = Matrix.Translation((x, FOOT / 2, z))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=0.016, radius2=0.018, depth=FOOT, matrix=mat)
    return ob_from(bm, "element_feet")


def build_strain_relief():
    bm = bmesh.new()
    for x0, x1, y0, y1, z0, z1 in [(-0.065, 0.065, 0.0100, 0.0560, Z_R + 0.0022, Z_R + 0.016)]:
        a, b = (x0, y0), (x1, y1)
        bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal(((x1 - x0), (y1 - y0), (z1 - z0), 1)))
    # Horizontal slats across the upper part, as a moulded grille; the cord leaves the lower middle.
    for i in range(5):
        y = 0.038 + i * 0.0048
        bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((0, y, Z_R + 0.0014)) @ Matrix.Diagonal((0.118, 0.0024, 0.0028, 1)))
    return ob_from(bm, "element_strain_relief")


def build_keybed():
    # A dark floor just under the key bodies, following the rake of the key rows, so the wells never show the room through them.
    bm = bmesh.new()
    def v(x, z):
        return Vector((x, 0.1215 - 0.5 * (z - 0.082) - 0.019, z))
    a = [v(-0.228, 0.1885), v(0.228, 0.1885), v(0.228, 0.066), v(-0.228, 0.066)]
    verts = [bm.verts.new(p) for p in a]
    f = bm.faces.new(verts)
    bmesh.ops.solidify(bm, geom=[f], thickness=0.002)
    return ob_from(bm, "element_keybed")


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def make_materials():
    def m(name, base, r, met=0.0):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        b = mat.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = base
        b.inputs["Roughness"].default_value = r
        b.inputs["Metallic"].default_value = met
        return mat
    return m("element_paint", (0.25, 0.2, 0.14, 1), 0.55), m("element_black", (0.012, 0.012, 0.012, 1), 0.5), m("element_rubber", (0.02, 0.02, 0.02, 1), 0.9)


def finish_mesh(ob):
    ob.data.transform(MACHINE_TO_BLENDER)


# ---------- clearance ----------

def corners_bvh(corners):
    """A BVH of a machine-space box given as its 8 corners, in the mesh's Blender coordinates."""
    bm = bmesh.new()
    verts = [bm.verts.new(MACHINE_TO_BLENDER @ Vector(c)) for c in corners]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([verts[i] for i in f])
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def moving_envelopes():
    """Boxes swept by the parts that move inside the housing, as corner lists in machine coordinates. The bail is left out: its pivot lives in the rig.
    The cartridge's place follows CARTRIDGE in src/render/element-view.js; its box is tilted with the moulding, and runs across both travel extremes."""
    r, p = M["ribbon"], M["platen"]
    travel = M["carriage"]["travel"] / 2
    c, half, tilt = GEO["element"]["center"], 0.0738, 0.30
    hub_y, hub_z = c[1] - 0.0259, c[2] + 0.031 * math.cos(tilt)
    def cart(u, n, v):
        return (u, hub_y + n * math.cos(tilt) - v * math.sin(tilt), hub_z + n * math.sin(tilt) + v * math.cos(tilt))
    cartridge = [cart(u, n, v) for u in (-travel - half, travel + half) for n in (-0.0085, 0.0090) for v in (-0.0375, 0.0345)]
    cx, cy, cz, pr, ph = p["center"][0], p["center"][1], p["center"][2], p["radius"], p["length"] / 2
    platen = [(x, y, z) for x in (cx - ph, cx + ph) for y in (cy - pr, cy + pr) for z in (cz - pr, cz + pr)]
    return {"cartridge at both travel extremes": cartridge, "platen": platen}


def ball_touches(ob):
    """True if a panel vertex comes within the ball's reach anywhere along its stroke, at any carrier position (the cap and yoke included in the radius)."""
    E = GEO["element"]
    travel = M["carriage"]["travel"] / 2
    c, d, gap, R = E["center"], E["strikeDir"], E["strikeGap"], E["ballRadius"] * 1.15
    for v in ob.data.vertices:
        x, y, z = v.co.x, v.co.z, -v.co.y          # back from Blender to machine axes
        if abs(x) > travel + R:
            continue
        t = max(0.0, min(gap, (y - c[1]) * d[1] + (z - c[2]) * d[2]))
        if math.hypot(y - c[1] - d[1] * t, z - c[2] - d[2] * t) < R:
            return True
    return False


def clearance_check(panels):
    """Exits 1 if a moving part touches a panel; run before the hood is moved to its pivot."""
    bad = [f"{pname} is empty" for pname, ob in panels.items() if len(ob.data.polygons) < 50]
    for pname, ob in panels.items():
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        tree = BVHTree.FromBMesh(bm)
        bm.free()
        for name, corners in moving_envelopes().items():
            if tree.overlap(corners_bvh(corners)):
                bad.append(f"{name} touches {pname}")
        if ball_touches(ob):
            bad.append(f"type element touches {pname}")
    if bad:
        print("CLEARANCE FAILED:\n  " + "\n  ".join(bad))
        sys.exit(1)
    print("clearance ok")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    paint, black, rubber = make_materials()
    base, body, rear, hood = build_panels()
    feet = build_feet()
    sr = build_strain_relief()
    keybed = build_keybed()
    panels = [base, body, rear, hood]
    for ob, w in ((base, 0.0009), (body, 0.0012), (rear, 0.0012), (hood, 0.0014)):
        bevel_finish(ob, width=w)
    for ob in panels:
        assign(ob, paint)
        box_uv(ob)
    assign(feet, rubber)
    assign(sr, black)
    assign(keybed, black)
    for ob in (feet, sr, keybed):
        bevel_finish(ob, width=0.0006, segs=1)
        box_uv(ob)
    objs = panels + [feet, sr, keybed]
    for ob in objs:
        finish_mesh(ob)
    clearance_check({"element_base": base, "element_body": body, "element_rear_cover": rear, "element_hood": hood})
    # Hood pivot at the hinge, so the node can rotate about its own origin in three.js (machine +x maps to Blender +x).
    hx, hy, hz = HINGE
    hood.data.transform(Matrix.Translation((-hx, hz, -hy)))
    hood.location = (hx, -hz, hy)
    total = 0
    for o in objs:
        o.data.calc_loop_triangles()
        t = len(o.data.loop_triangles)
        total += t
        print(f"{o.name}: {t} tris")
    print("TOTAL:", total)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", use_selection=False)
    print("wrote", OUT)
    return objs


if __name__ == "__main__":
    main()
