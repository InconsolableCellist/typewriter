"""Builds public/assets/models/wp_keyboard.glb, the case of the word processor's keyboard (docs/displaywriter/models.md).

  node tools/gen/export_wp_keyboard.mjs                       # wp_keyboard.json, after a change to the keys or layout
  /root/bpyenv/bin/python tools/blender/build_wp_keyboard.py

The top cover is one moulding with real wall thickness: a long wedge whose top runs at the documented 12 degrees up to
the rear edge (101 mm, MD p.5), a rounded nose over a front face that leans back to the base, flat ends with rounded
corners in plan, and four openings for the key groups whose outline steps up a row at the left and right groups
(GIM p.22, PSM p.34, brochure p.18). The keycaps are not here: the view builds them from src/machine/wp-keys.js and
moves each one along its stem. Under the openings lies the dark key plate with a wall round each well, so the hollow
of the cover never shows. A pebble-grey base tray closes the bottom on rubber feet; the cable leaves the rear at the
left, where the logic card's connector is (KBD_3.JPG), through a strain-relief bush and runs back over the desk.

Nodes (unit frame: origin on the desk under the centre, x right, y up, z toward the typist):
  wp_keyboard_cover, wp_keyboard_plate, wp_keyboard_base, wp_keyboard_feet, wp_keyboard_bush, wp_keyboard_cable.
Materials: wp_pearl (cover), wp_dark (plate, bush), wp_gray (base), wp_rubber (feet, cable).
UVs are box projected, one unit = 0.2 m, as for the other models.
"""
import json
import math
import os

import bpy  # noqa: I001  (bpy first: it puts bmesh and mathutils on the path)
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "wp_keyboard.glb")
DATA = json.load(open(os.path.join(HERE, "wp_keyboard.json")))

UV_METRES = 0.2
UNIT_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

W, H, D = DATA["size"]
SLOPE = DATA["slope"]
CASE = DATA["case"]
DECK = Vector(DATA["deck"])
A, B = W / 2, D / 2           # half width, half depth
T = 0.0025                    # cover wall
FOOT = 0.0035                 # rubber feet: the base tray's underside above the desk
BASE_TOP = 0.0115             # the tray rises this far inside the cover
COVER_BOTTOM = 0.0080         # the cover's lower edge; the tray shows below it
UNDERCUT = 0.013              # the front face leans back by this much from the nose to the base
NOSE_R = 0.016                # radius of the nose, where the palm rest turns down into the front face
NOSE_OUT = 0.0046             # the sharp corner the nose rounds lies this far out, so the nose itself reaches the documented depth
PLAN_R = 0.012                # plan corners
OPEN_R = 0.0024               # corners of the key openings

# The deck: the plane of the cover's top surface; its frame is the view's `deck` group.
DECK_M = Matrix.Translation(DECK) @ Matrix.Rotation(SLOPE, 4, "X")


def top_y(z):
    """Height of the cover plane at z."""
    return DECK.y - (z - DECK.z) * math.tan(SLOPE)


# ---------- geometry helpers (as tools/blender/build_element_enclosure.py) ----------

def round_poly(pts, radii, seg=8):
    """Closed polygon; corners with radius r replaced by arcs (convex or concave)."""
    n = len(pts)
    out = []
    for i in range(n):
        p = Vector(pts[i])
        a = Vector(pts[i - 1]) - p
        b = Vector(pts[(i + 1) % n]) - p
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
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


def inset_poly(poly, t):
    """Moves each vertex of a closed polygon inward by t along its corner bisector."""
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
    """A polygon extruded along an axis. axis 'x': poly (z, y); 'y': poly (x, z)."""
    bm = bmesh.new()

    def v(u, w, a):
        if axis == "x":
            return Vector((a, w, u))
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


def ob_from(bm, name, matrix=None):
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
        if matrix.determinant() < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
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


def bevel_finish(ob, width=0.0011, segs=2, angle=32):
    """Rounds every real edge (arcs are finer than the limit angle), then weighted normals so flats stay flat."""
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


def smooth_by_angle(ob, angle=40):
    """Smooth shading across soft edges only, for the small parts left unbevelled."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle() < math.radians(angle)
    bm.to_mesh(ob.data)
    bm.free()


def box_uv(ob):
    """UVs from box projection in unit axes: one unit = UV_METRES."""
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


# ---------- the cover ----------

def section(inset=0.0):
    """Side section (z, y): rear face, the top at the slope, the nose, the front face leaning back to the base."""
    pts = [
        (-B, COVER_BOTTOM),
        (-B, top_y(-B)),
        (B + NOSE_OUT, top_y(B + NOSE_OUT)),
        (B - UNDERCUT, COVER_BOTTOM),
    ]
    radii = [0.0015, 0.004, NOSE_R, 0.0025]
    if inset:
        pts = inset_poly(pts, inset)
        pts[0] = (pts[0][0], COVER_BOTTOM - 0.01)
        pts[3] = (pts[3][0] - 0.004, COVER_BOTTOM - 0.01)
        radii = [0, max(0.0005, radii[1] - inset), radii[2] - inset, 0]
    return round_poly(pts, radii, seg=9)


def plan(inset=0.0):
    return rounded_rect(-A + inset, -B + inset, A - inset, B + inset * -1, PLAN_R - inset * 0.8, seg=7)


def solid(inset=0.0):
    ob = ob_from(prism(section(inset), "x", -A - 0.01, A + 0.01), "s")
    boolean(ob, ob_from(prism(plan(inset), "y", -0.05, 0.2), "p"), "INTERSECT")
    return ob


def opening_polys(grow=0.0):
    out = []
    for name, poly in DATA["openings"].items():
        pts = inset_poly(poly, -grow) if grow else poly
        n = len(pts)
        # Convex corners get the moulding's radius, the inside corners of the steps a smaller one.
        area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
        radii = []
        for i in range(n):
            p, a, b = Vector(pts[i]), Vector(pts[i - 1]), Vector(pts[(i + 1) % n])
            cross = (p - a).x * (b - p).y - (p - a).y * (b - p).x
            radii.append(OPEN_R + grow if cross * area > 0 else max(0.0008, 0.0016 - grow))
        out.append((name, round_poly(pts, radii, seg=4)))
    return out


def deck_prism(poly, y0, y1, name):
    """A prism standing on the deck plane, from y0 to y1 along its normal; poly in deck (x, z)."""
    return ob_from(prism(poly, "y", y0, y1), name, DECK_M)


def build_cover():
    cover = solid()
    boolean(cover, solid(T))
    for name, poly in opening_polys():
        boolean(cover, deck_prism(poly, -0.03, 0.03, "open_" + name))
    cover.name = "wp_keyboard_cover"
    cover.data.name = cover.name
    return cover


def build_plate():
    """The key plate under the openings and a wall round each well up to the cover's underside."""
    polys = opening_polys()
    xs = [p[0] for _, poly in polys for p in poly]
    zs = [p[1] for _, poly in polys for p in poly]
    plate = deck_prism(rounded_rect(min(xs) - 0.006, min(zs) - 0.006, max(xs) + 0.006, max(zs) + 0.006, 0.004), CASE["plate"] - 0.0015, CASE["plate"], "wp_keyboard_plate")
    for (name, outer), (_, inner) in zip(opening_polys(0.0016), opening_polys(0.0002)):
        wall = deck_prism(outer, CASE["plate"] - 0.0005, -T - 0.0002, "wall")
        boolean(wall, deck_prism(inner, -0.05, 0.05, "c"))
        boolean(plate, wall, "UNION")
    return plate


def build_base():
    """The tray under the cover, set in from its lower edge, showing as a band above the feet."""
    outline = [(x, z) for x, z in rounded_rect(-A + 0.0018, -B + 0.0018, A - 0.0018, B - UNDERCUT - 0.0006, PLAN_R - 0.0016, seg=10)]
    base = ob_from(prism(outline, "y", FOOT, BASE_TOP), "wp_keyboard_base")
    inner = rounded_rect(-A + 0.0045, -B + 0.0045, A - 0.0045, B - UNDERCUT - 0.0035, PLAN_R - 0.004, seg=10)
    boolean(base, ob_from(prism(inner, "y", FOOT + 0.0015, 0.05), "i"))
    return base


def build_feet():
    bm = bmesh.new()
    for x in (-A + 0.045, A - 0.045):
        for z in (-B + 0.028, B - UNDERCUT - 0.026):
            m = Matrix.Translation((x, FOOT / 2 + 0.0002, z)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.0095, radius2=0.0105, depth=FOOT + 0.0004, matrix=m)
    return ob_from(bm, "wp_keyboard_feet")


CABLE_X, CABLE_Y = -0.165, 0.026    # where the cable leaves the rear face (the logic card's connector is at the left)
CABLE_R = 0.0033


def build_bush():
    """Strain-relief bush: an oval boss on the rear face, the cable through its middle."""
    bm = bmesh.new()
    m = Matrix.Translation((CABLE_X, CABLE_Y, -B - 0.004)) @ Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Scale(1.0, 4)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.0072, radius2=0.0062, depth=0.009, matrix=m @ Matrix.Rotation(math.pi, 4, "X"))
    bm2 = bmesh.new()
    m2 = Matrix.Translation((CABLE_X, CABLE_Y, -B - 0.012)) @ Matrix.Rotation(math.pi / 2, 4, "X")
    bmesh.ops.create_cone(bm2, cap_ends=True, segments=20, radius1=0.0050, radius2=0.0042, depth=0.010, matrix=m2)
    ob = ob_from(bm, "wp_keyboard_bush")
    boolean(ob, ob_from(bm2, "b2"), "UNION")
    return ob


def build_cable():
    """The cable out of the bush, down to the desk and back toward the electronics module."""
    cu = bpy.data.curves.new("cable", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = CABLE_R
    cu.bevel_resolution = 2
    cu.resolution_u = 8
    sp = cu.splines.new("BEZIER")
    pts = [(CABLE_X, CABLE_Y, -B - 0.016), (CABLE_X - 0.004, 0.012, -B - 0.045), (CABLE_X - 0.012, CABLE_R, -B - 0.085), (CABLE_X - 0.020, CABLE_R, -B - 0.160)]
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    ob = bpy.data.objects.new("wp_keyboard_cable", cu)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = "wp_keyboard_cable"
    # Flatten the run on the desk a little, as a heavy cable lies.
    for v in ob.data.vertices:
        if v.co.y < CABLE_R * 1.02 and v.co.z < -B - 0.07:
            v.co.y = max(v.co.y, 0.0003)
    return ob


def make_materials():
    def m(name, base, r):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        b = mat.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = base
        b.inputs["Roughness"].default_value = r
        return mat
    return {
        "pearl": m("wp_pearl", (0.74, 0.70, 0.60, 1), 0.6),
        "gray": m("wp_gray", (0.27, 0.26, 0.23, 1), 0.65),
        "dark": m("wp_dark", (0.016, 0.016, 0.015, 1), 0.6),
        "rubber": m("wp_rubber", (0.01, 0.01, 0.01, 1), 0.85),
    }


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    cover = build_cover()
    plate = build_plate()
    base = build_base()
    feet = build_feet()
    bush = build_bush()
    cable = build_cable()
    bevel_finish(cover, width=0.0012)
    bevel_finish(base, width=0.0008)
    for ob in (plate, feet, bush):
        smooth_by_angle(ob)
    for ob, mat in ((cover, "pearl"), (plate, "dark"), (base, "gray"), (feet, "rubber"), (bush, "dark"), (cable, "rubber")):
        assign(ob, mats[mat])
        box_uv(ob)
    objs = [cover, plate, base, feet, bush, cable]
    lo = Vector((1, 1, 1))
    hi = Vector((-1, -1, -1))
    for ob in (cover, base, feet):
        for v in ob.data.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i])
                hi[i] = max(hi[i], v.co[i])
    print("case extent (x, y, z):", tuple(round(h - l, 4) for l, h in zip(lo, hi)), "top", round(hi.y, 4))
    total = 0
    for o in objs:
        o.data.transform(UNIT_TO_BLENDER)
        o.data.calc_loop_triangles()
        t = len(o.data.loop_triangles)
        total += t
        print(f"{o.name}: {t} tris")
    print("TOTAL:", total)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", use_selection=False)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
