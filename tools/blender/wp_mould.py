"""Shared moulding helpers for the word processor's Blender builders (build_wp_*.py), after build_element_enclosure.py.

Geometry is made in unit coordinates (x right, y up, z toward the operator, metres; origin on the surface the unit
stands on, under its centre) and turned into Blender's axes only at export. Panels are closed solids cut by EXACT
booleans, bevelled after the cuts, with weighted normals and box-projected UVs (one unit = 0.2 m).
"""
import math

import bpy  # noqa: F401  (first: it provides bmesh and mathutils)
import bmesh
import bpy
from mathutils import Matrix, Vector

UV_METRES = 0.2
UNIT_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# GLB material names (docs/displaywriter/models.md): base colour and roughness for the Blender previews only; the view
# replaces them by name with the textured materials.
MATERIALS = {
    "wp_pearl": ((0.74, 0.70, 0.60, 1), 0.6, 0.0),
    "wp_gray": ((0.45, 0.44, 0.40, 1), 0.65, 0.0),
    "wp_dark": ((0.018, 0.017, 0.016, 1), 0.55, 0.0),
    "wp_rubber": ((0.012, 0.012, 0.012, 1), 0.9, 0.0),
    "wp_metal": ((0.55, 0.55, 0.52, 1), 0.35, 1.0),
    "wp_chrome": ((0.8, 0.8, 0.8, 1), 0.12, 1.0),
    "wp_label": ((0.8, 0.8, 0.78, 1), 0.5, 0.0),
    "wp_red": ((0.55, 0.03, 0.02, 1), 0.4, 0.0),
    "wp_led": ((0.12, 0.01, 0.005, 1), 0.3, 0.0),
    "wp_badge": ((0.55, 0.55, 0.55, 1), 0.3, 0.6),
    "wp_tag": ((0.6, 0.6, 0.58, 1), 0.5, 0.0),
    "wp_bezel": ((0.07, 0.068, 0.062, 1), 0.6, 0.0),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    base, rough, metal = MATERIALS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = base
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return mat


# ---------- 2D outlines ----------

def round_poly(pts, radii, seg=7):
    """Closed polygon; corners with radius r replaced by arcs."""
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


def rounded_rect(x0, y0, x1, y1, r, seg=8, rb=None):
    """Rounded rectangle; rb gives the two lower corners their own radius."""
    rb = r if rb is None else rb
    pts = []
    for cx, cy, a0, rr in ((x1 - r, y1 - r, 0, r), (x0 + r, y1 - r, 90, r), (x0 + rb, y0 + rb, 180, rb), (x1 - rb, y0 + rb, 270, rb)):
        if rr <= 0:
            pts.append((cx + (rr if a0 in (0, 270) else -rr), cy))
            continue
        for j in range(seg + 1):
            a = math.radians(a0 + 90 * j / seg)
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return pts


def ellipse(cx, cy, rx, ry, seg=40):
    return [(cx + rx * math.cos(2 * math.pi * i / seg), cy + ry * math.sin(2 * math.pi * i / seg)) for i in range(seg)]


# ---------- solids ----------

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


def box_bm(x0, y0, z0, x1, y1, z1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)) @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))
    return bm


def cylinder_bm(center, axis, r, length, segs=32, r2=None):
    """A cylinder (or cone, with r2) centred at `center`, along 'x', 'y' or 'z'."""
    bm = bmesh.new()
    rot = {"x": Matrix.Rotation(math.pi / 2, 4, "Y"), "y": Matrix.Rotation(-math.pi / 2, 4, "X"), "z": Matrix.Identity(4)}[axis]
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=length,
                          matrix=Matrix.Translation(center) @ rot)
    return bm


def ob_from(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def join_bms(bms, name):
    bm = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new("tmp")
        b.to_mesh(me)
        b.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    return ob_from(bm, name)


def boolean(a, b, op="DIFFERENCE", consume=True):
    mod = a.modifiers.new("b", "BOOLEAN")
    mod.operation = op
    mod.object = b
    mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = a
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if consume:
        bpy.data.objects.remove(b)
    return a


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
    smooth(ob)


def smooth(ob, sharp=40):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle() < math.radians(sharp)
        else:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()
    wn = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    wn.weight = 100
    wn.keep_sharp = True
    wn.mode = "FACE_AREA"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=wn.name)


def box_uv(ob):
    """UVs from box projection in unit axes: one UV unit = UV_METRES."""
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


def assign(ob, name):
    ob.data.materials.clear()
    ob.data.materials.append(material(name))


def finish(ob, mat, bevel=None, segs=2):
    """Bevel (width in m, or None for smoothing only), material, UVs."""
    if bevel:
        bevel_finish(ob, width=bevel, segs=segs)
    else:
        smooth(ob)
    assign(ob, mat)
    box_uv(ob)
    return ob


def finish_small(ob, mat, sharp=60):
    """Small parts: smooth shading but for real corners, and one UV for the whole part (texture detail is finer than
    the part), so the export splits no vertices for UV seams."""
    smooth(ob, sharp)
    assign(ob, mat)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            lp[uv].uv = (0.0, 0.0)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def merge(obs, name):
    """Joins finished objects (each keeps its material) into one mesh object."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    obs[0].name = name
    obs[0].data.name = name
    return obs[0]


# ---------- nodes and export ----------

def to_blender(ob):
    ob.data.transform(UNIT_TO_BLENDER)


def node(name, pivot, parent=None, parent_pivot=(0, 0, 0)):
    """An empty at `pivot` (unit coordinates), parented, so three.js can rotate it about its own origin."""
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    rel = Vector(pivot) - Vector(parent_pivot)
    e.location = UNIT_TO_BLENDER @ rel
    if parent:
        e.parent = parent
    return e


def attach(ob, parent, parent_pivot):
    """A mesh made in unit coordinates (already in Blender axes) moved under a node whose origin is parent_pivot."""
    ob.data.transform(Matrix.Translation(-(UNIT_TO_BLENDER @ Vector(parent_pivot))))
    ob.parent = parent
    return ob


def pivot_mesh(ob, pivot, parent=None, parent_pivot=(0, 0, 0)):
    """Makes a mesh its own node with its origin at `pivot` (unit coordinates)."""
    p = UNIT_TO_BLENDER @ Vector(pivot)
    ob.data.transform(Matrix.Translation(-p))
    ob.location = p - UNIT_TO_BLENDER @ Vector(parent_pivot)
    if parent:
        ob.parent = parent
    return ob


def report(objs):
    total = 0
    for o in objs:
        if o.type != "MESH":
            continue
        o.data.calc_loop_triangles()
        t = len(o.data.loop_triangles)
        total += t
        print(f"  {o.name}: {t} tris")
    print("TOTAL:", total)


def export(path, extras=False):
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=False, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", use_selection=False, export_extras=extras)
    from quantize_glb import quantize
    quantize(path)
