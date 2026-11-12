"""Builds public/assets/models/wp_keyboard.glb, the case of the word processor's keyboard (docs/displaywriter/models.md).

  node tools/gen/export_wp_keyboard.mjs                       # wp_keyboard.json, after a change to the keys or layout
  /root/bpyenv/bin/python tools/blender/build_wp_keyboard.py

The top cover is one moulding with real wall thickness, after the owner's photographs (models.md, Keyboard): a tall
wedge with a flat upright back 101 mm high (MD p.5) rounded into the top, the top falling 10 degrees (the caps add 2)
toward the typist, and a big rounded front (22 mm over a short upright face, 18 mm under it); flat ends with softened
edges and rounded corners in plan; four openings for the key groups whose outline steps up a row at the left and right
groups (GIM p.22, PSM p.34); and behind the main block the card recess, a shallow well with a stepped rim holding the
Displaywriter System Information Card under a clear window. The keycaps are not here: the view builds them from
src/machine/wp-keys.js and moves each one along its stem. Under the openings lies the dark key plate with a wall round
each well, so the hollow of the cover never shows. A pebble-grey base tray closes the bottom on low rubber feet; the
cable leaves a dark connector housing high on the back, left of centre (the owner's three-quarter photograph), and runs
down and back over the desk.

Nodes (unit frame: origin on the desk under the centre, x right, y up, z toward the typist):
  wp_keyboard_cover, wp_keyboard_plate, wp_keyboard_base, wp_keyboard_feet, wp_keyboard_bush (the connector housing),
  wp_keyboard_cable, wp_keyboard_card (the information card, uv 0..1 over its face, u along x, v from the back edge),
  wp_keyboard_window (the clear window over it).
Materials: wp_pearl (cover), wp_dark (plate, bush), wp_gray (base), wp_rubber (feet, cable), wp_kbd_card (the card,
drawn at run time) and wp_kbd_window (the window), both made by the view.
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
FOOT = 0.0018                 # rubber feet: the base tray's underside above the desk
BASE_TOP = 0.0060             # the tray rises this far inside the cover
COVER_BOTTOM = 0.0030         # the cover's lower edge: it reaches nearly to the desk (side photograph), the tray a dark line
BACK_R = DATA["case"]["backRound"]   # the back's top edge rounds into the top; its crown is the unit's height
NOSE_R = 0.022                # the front's upper round, from the top into the short upright face
CHIN_R = 0.018                # the front's lower round, under the face back to the desk
END_BEVEL = 0.0032            # the ends' edges, softened
PLAN_R = 0.012                # plan corners
OPEN_R = 0.0024               # corners of the key openings
RECESS = DATA["recess"]

# The deck: the plane of the cover's top surface; its frame is the view's `deck` group.
DECK_M = Matrix.Translation(DECK) @ Matrix.Rotation(SLOPE, 4, "X")


def top_y(z):
    """Height of the cover plane at z."""
    return DECK.y - (z - DECK.z) * math.tan(SLOPE)


# ---------- geometry helpers (as tools/blender/build_element_enclosure.py) ----------

def round_poly(pts, radii, seg=8, clamp=0.49):
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
        d = min(r / math.tan(half), clamp * la, clamp * lb)
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
    """Side section (z, y): the upright back, the top at the slope, the rounded front, closed along the bottom."""
    pts = [
        (-B, COVER_BOTTOM),
        (-B, top_y(-B)),
        (B, top_y(B)),
        (B, COVER_BOTTOM),
    ]
    radii = [0.002, BACK_R, NOSE_R, CHIN_R]
    if inset:
        pts = inset_poly(pts, inset)
        radii = [max(0.0003, r - inset) for r in radii]
    return round_poly(pts, radii, seg=10, clamp=0.6)


def plan(inset=0.0):
    return rounded_rect(-A + inset, -B - 0.01, A - inset, B + 0.01, PLAN_R - inset * 0.8, seg=7)


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


def bevel_only(ob, width, segs, angle=32):
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.width = width
    mod.segments = segs
    mod.profile = 0.5
    mod.miter_outer = "MITER_ARC"
    mod.use_clamp_overlap = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)


def recess_rect(grow=0.0):
    R = RECESS
    return rounded_rect(R["x0"] - grow, R["z0"] - grow, R["x1"] + grow, R["z1"] + grow, max(0.0006, R["r"] + grow), seg=5)


def build_cover():
    cover = solid()
    # The ends' edges are softened before the shell is hollowed and cut, in four steps so the later small bevel
    # leaves them alone.
    bevel_only(cover, END_BEVEL, 4)
    boolean(cover, solid(T))
    # The recess needs more than the wall's thickness: a tub under it.
    R = RECESS
    boolean(cover, deck_prism(recess_rect(0.003), -R["floor"] - 0.0025, -0.0008, "tub"), "UNION")
    for name, poly in opening_polys():
        boolean(cover, deck_prism(poly, -0.03, 0.03, "open_" + name))
    boolean(cover, deck_prism(recess_rect(), -R["ledge"], 0.03, "recess"))
    boolean(cover, deck_prism(recess_rect(-R["rim"]), -R["floor"], 0.01, "well"))
    cover.name = "wp_keyboard_cover"
    cover.data.name = cover.name
    return cover


def build_card():
    """The information card on the recess floor: uv 0..1 over its face (u along x, v from the back edge to the front)."""
    R = RECESS
    x0, x1 = R["x0"] + R["rim"] + 0.0005, R["x1"] - R["rim"] - 0.0005
    z0, z1 = R["z0"] + R["rim"] + 0.0005, R["z1"] - R["rim"] - 0.0005
    bm = bmesh.new()
    y0, y1 = -R["floor"], -R["floor"] + 0.0003
    v = [bm.verts.new(p) for p in ((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y0, z0), (x0, y0, z1), (x1, y0, z1), (x1, y0, z0))]
    top = bm.faces.new((v[0], v[1], v[2], v[3]))
    bm.faces.new((v[7], v[6], v[5], v[4]))
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        bm.faces.new((v[b], v[a], v[a + 4], v[b + 4]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = ((c.x - x0) / (x1 - x0), 1 - (c.z - z0) / (z1 - z0)) if f is top else (0.002, 0.998)
    return ob_from(bm, "wp_keyboard_card", DECK_M)


def build_window():
    """The clear window over the card, lying on the ledge."""
    R = RECESS
    return deck_prism(recess_rect(-0.0004), -R["ledge"], -R["ledge"] + 0.0009, "wp_keyboard_window")


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
    outline = [(x, z) for x, z in rounded_rect(-A + 0.0025, -B + 0.0025, A - 0.0025, B - CHIN_R, PLAN_R - 0.0016, seg=10)]
    base = ob_from(prism(outline, "y", FOOT, BASE_TOP), "wp_keyboard_base")
    inner = rounded_rect(-A + 0.0050, -B + 0.0050, A - 0.0050, B - CHIN_R - 0.0025, PLAN_R - 0.004, seg=10)
    boolean(base, ob_from(prism(inner, "y", FOOT + 0.0012, 0.05), "i"))
    return base


def build_feet():
    bm = bmesh.new()
    for x in (-A + 0.045, A - 0.045):
        for z in (-B + 0.028, B - CHIN_R - 0.022):
            m = Matrix.Translation((x, FOOT / 2 + 0.0002, z)) @ Matrix.Rotation(math.pi / 2, 4, "X")
            bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.0095, radius2=0.0105, depth=FOOT + 0.0004, matrix=m)
    return ob_from(bm, "wp_keyboard_feet")


CABLE_X, CABLE_Y = -0.090, 0.078   # the connector housing high on the back, left of centre (owner's three-quarter photograph)
CABLE_R = 0.0033
HOUSING = (0.032, 0.016, 0.011)     # width, height, how far it stands out from the back


def build_bush():
    """The cable's dark connector housing on the back: a block, stepped higher at its right as photographed."""
    w, h, d = HOUSING
    ob = ob_from(prism(rounded_rect(CABLE_X - w / 2, -B - d, CABLE_X + w / 2, -B + 0.002, 0.0015, seg=3), "y", CABLE_Y - h / 2, CABLE_Y + h / 2 - 0.003), "wp_keyboard_bush")
    boolean(ob, ob_from(prism(rounded_rect(CABLE_X - 0.002, -B - d + 0.001, CABLE_X + w / 2, -B + 0.002, 0.0012, seg=3), "y", CABLE_Y, CABLE_Y + h / 2), "b2"), "UNION")
    return ob


def build_cable():
    """The cable out of the housing's underside, down the back to the desk and back toward the electronics module."""
    cu = bpy.data.curves.new("cable", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = CABLE_R
    cu.bevel_resolution = 2
    cu.resolution_u = 8
    sp = cu.splines.new("BEZIER")
    zb = -B - HOUSING[2] * 0.55
    pts = [(CABLE_X, CABLE_Y - HOUSING[1] / 2 + 0.002, zb), (CABLE_X - 0.002, 0.040, zb - 0.010), (CABLE_X - 0.006, 0.012, zb - 0.030), (CABLE_X - 0.012, CABLE_R, zb - 0.075), (CABLE_X - 0.020, CABLE_R, zb - 0.150)]
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
        if v.co.y < CABLE_R * 1.02 and v.co.z < zb - 0.06:
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
        "card": m("wp_kbd_card", (0.80, 0.74, 0.62, 1), 0.7),
        "window": m("wp_kbd_window", (0.9, 0.9, 0.9, 1), 0.05),
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
    card = build_card()
    window = build_window()
    bevel_finish(cover, width=0.0012)
    bevel_finish(base, width=0.0008)
    for ob in (plate, feet, bush, card, window):
        smooth_by_angle(ob)
    for ob, mat in ((cover, "pearl"), (plate, "dark"), (base, "gray"), (feet, "rubber"), (bush, "dark"), (cable, "rubber"), (card, "card"), (window, "window")):
        assign(ob, mats[mat])
        if ob is not card:
            box_uv(ob)
    objs = [cover, plate, base, feet, bush, cable, card, window]
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
    import sys
    sys.path.insert(0, HERE)
    from quantize_glb import quantize   # 16-bit positions, 8-bit normals (models.md, Size)
    quantize(OUT)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
