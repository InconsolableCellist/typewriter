"""Builds public/assets/models/enclosure.glb, a formed sheet-steel body shell around the frame.

  ~/bin/blender --background --python tools/blender/build_enclosure.py
      -> enclosure.glb, then the moving-part clearance check (exit 1 on any violation) and the
         static gap between the shell and frame.glb

Every panel is a sheet of real thickness swept along a rounded plan path: a skirt that rolls in at
the shoulder, with a pressed bead and rolled edges. Dimensions come from machine.json and from the
frame's outer limits; the section (height, shoulder radius, deck width) is a smooth function of position.

Nodes: enclosure_side_left, enclosure_side_right, enclosure_deck_left, enclosure_deck_right,
enclosure_front, enclosure_rear. Materials: enclosure_paint, enclosure_trim.
Same UV convention as frame.glb: box projected, one UV unit = UV_METRES.
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
OUT = os.path.join(ROOT, "public", "assets", "models", "enclosure.glb")
FRAME = os.path.join(ROOT, "public", "assets", "models", "frame.glb")
sys.path.insert(0, HERE)
import check_clearance  # noqa: E402

M = json.load(open(os.path.join(HERE, "machine.json")))
MACHINE, GEO, RIG = M["machine"], M["geometry"], M["rig"]

UV_METRES = 0.2
MACHINE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
T = 0.0012                      # sheet thickness
A = 0.190                       # half width of the plan path
Z_F = 0.240                     # front of the plan path
Z_R = -0.156                    # rear of the plan path
RC = 0.035                      # plan corner radius
Y0 = 0.0045                     # lower edge of the skirts, just off the desk
BAR_CLEAR_X = 0.140             # inner edge of the deck beside the type basket
KEY_CLEAR_X = 0.1585            # inner edge of the deck beside the keyboard
PLATEN_Z = MACHINE["platen"]["center"][2]
PLATEN_Y = MACHINE["platen"]["center"][1]
KNOB_FLOOR = PLATEN_Y - MACHINE["platen"]["knobRadius"] - MACHINE["carriage"]["shiftTravel"]
RACK = RIG["rack"]
RACK_REAR = RACK["z"] - 0.0052       # behind the rack and its mount
CARRIAGE_TOP = min(KNOB_FLOOR - 0.0055, RIG["railY"] + RIG.get("railRadius", 0.0038) - 0.0043)
REAR_TOP = RACK["y"] - 0.0075


def pchip(xs, ys):
    """Monotone cubic interpolation (Fritsch-Carlson) through increasing xs."""
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [d[0]] + [0.0] * (n - 2) + [d[-1]]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        t = (x - xs[i]) / h[i]
        return ((1 + 2 * t) * (1 - t) ** 2) * ys[i] + (t * (1 - t) ** 2) * h[i] * m[i] \
            + (t ** 2 * (3 - 2 * t)) * ys[i + 1] + (t ** 2 * (t - 1)) * h[i] * m[i + 1]
    return f


# Section parameters along a side, by machine z (front to rear increasing index reversed for pchip).
_h = pchip(
    [Z_R, RACK_REAR + 0.003, -0.118, -0.038, -0.010, 0.014, 0.060, 0.120, 0.200, Z_F],
    [REAR_TOP - 0.004, REAR_TOP, CARRIAGE_TOP, CARRIAGE_TOP, 0.1535, 0.157, 0.148, 0.122, 0.083, 0.0755])
_R = pchip([Z_R, -0.036, 0.008, 0.19, Z_F], [0.0048, 0.0048, 0.018, 0.018, 0.012])
_xi = pchip([Z_R, -0.036, 0.016, 0.088, 0.106, 0.20, Z_F],
            [A - 0.0055, A - 0.0055, BAR_CLEAR_X, BAR_CLEAR_X, KEY_CLEAR_X, KEY_CLEAR_X, A - 0.018])


_trim_y = pchip([Z_R, -0.03, 0.06, 0.12, 0.2, Z_F], [0.066, 0.072, 0.088, 0.076, 0.056, 0.050])    # the belt line, without the step


def arch(x):
    """Shallow arch of the front panel: zero at the corners."""
    u = max(-1.0, min(1.0, x / (A - RC)))
    return 0.0035 * (1 - u * u)


def rear_scoop(x):
    """The rear panel falls away in the middle, opening up the escapement and carriage rear."""
    u = abs(x) / (A - RC)
    t = max(0.0, min(1.0, (u - 0.62) / 0.28))
    s = t * t * (3 - 2 * t)
    return (1 - s) * (REAR_TOP - 0.052)


def skirt_section(h, R, yb, belly=0.0028, bead=0.0011):
    """Centreline of a skirt in (outward o, height y): hem, belly, pressed bead, rolling into the shoulder."""
    pts = [(-0.0045, Y0 + 0.0002), (-0.0035, Y0 - 0.0006), (-0.0015, Y0 - 0.0005), (0.0, Y0 + 0.0015)]
    top = h - R
    n = 20
    for i in range(1, n + 1):
        t = i / n
        y = Y0 + 0.0015 + (top - Y0 - 0.0015) * t
        o = belly * math.sin(math.pi * t) + bead * math.exp(-((y - yb) / 0.0032) ** 2)
        pts.append((o, y))
    for i in range(1, 9):
        a = (math.pi / 2) * i / 8
        pts.append((-R + R * math.cos(a), top + R * math.sin(a)))
    return pts, (bead + belly, yb)


def deck_section(h, R, W):
    """From the top of the shoulder inward to a rolled-down lip. The first point meets the skirt's end."""
    pts = []
    lip = 0.0018 + 0.0012 * min(1.0, max(0.0, (W - 0.006) / 0.02))    # a smaller roll where the deck is narrow
    nf = 10
    for i in range(nf):
        t = i / (nf - 1)
        o = -R + (-W + R) * t
        pts.append((o, h + 0.0006 * math.sin(math.pi * t)))
    for i in range(1, 6):
        a = (2.1) * i / 5
        pts.append((-W - lip * math.sin(a), h - lip + lip * math.cos(a)))
    return pts


def thicken(sec, t):
    """Returns the closed loop (outer then reversed inner) of a section centreline."""
    n = len(sec)
    out, inn = [], []
    for i in range(n):
        ax, ay = sec[max(0, i - 1)]
        bx, by = sec[min(n - 1, i + 1)]
        tx, ty = bx - ax, by - ay
        L = math.hypot(tx, ty) or 1.0
        nx, ny = ty / L, -tx / L
        out.append((sec[i][0] + nx * t / 2, sec[i][1] + ny * t / 2))
        inn.append((sec[i][0] - nx * t / 2, sec[i][1] - ny * t / 2))
    return out + inn[::-1]


def loft(stations, material, closed_section=True):
    """stations: [(path point, outward normal, loop of (o, y))] with equal loop lengths."""
    bm = bmesh.new()
    rings = []
    for p, n, loop in stations:
        rings.append([bm.verts.new(Vector((p[0] + n[0] * o, y, p[1] + n[1] * o))) for o, y in loop])
    m = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(m if closed_section else m - 1):
            j = (i + 1) % m
            bm.faces.new((a[i], a[j], b[j], b[i]))
    for ring in (rings[0], rings[-1]):      # caps, as quad strips across the sheet
        for i in range(m // 2 - 1):
            bm.faces.new((ring[i], ring[i + 1], ring[m - 2 - i], ring[m - 1 - i]))
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    for f in bm.faces:
        f.material_index = material
    return bm


def side_path(sign, n_straight=64, n_corner=8):
    """Plan path of the +x or -x side: front corner, side, rear corner, as [(point (x,z), outward (nx,nz))]."""
    pts = []
    cz_f, cz_r = Z_F - RC, Z_R + RC
    cx = A - RC
    for i in range(n_corner + 1):
        a = (math.pi / 2) * i / n_corner
        n = (math.sin(a), math.cos(a))
        pts.append(((cx + RC * n[0], cz_f + RC * n[1]), n))
    # dense through the regions where the height changes fast
    zs = [cz_f + (cz_r - cz_f) * i / n_straight for i in range(1, n_straight)]
    for z in zs:
        pts.append(((A, z), (1.0, 0.0)))
    for i in range(n_corner + 1):
        a = (math.pi / 2) * (1 - i / n_corner)
        n = (math.sin(a), -math.cos(a))
        pts.append(((cx + RC * n[0], cz_r + RC * n[1]), n))
    if sign < 0:
        pts = [((-p[0], p[1]), (-n[0], n[1])) for p, n in reversed(pts)]
    return pts


def height_at(p, n):
    """Section parameters at a plan-path point. Corners take the side functions at their z."""
    return _h(p[1]), _R(p[1]), max(A - _xi(p[1]), _R(p[1]) + 0.001)


def side_parts(sign):
    skirt_st, deck_st, trim_st = [], [], []
    pts = side_path(sign)
    for p, n in pts:
        h, R, W = height_at(p, n)
        sec, (bo, yb) = skirt_section(h, R, _trim_y(p[1]))
        skirt_st.append((p, n, thicken(sec, T)))
        deck_st.append((p, n, thicken(deck_section(h, R, W), T)))
        trim_st.append((p, n, [(bo + 0.0002 + 0.0016 * math.cos(2 * math.pi * k / 10), yb + 0.0016 * math.sin(2 * math.pi * k / 10)) for k in range(10)]))
    return skirt_st, deck_st, trim_st


def x_span_path(z, n_out, n=24):
    x0 = A - RC
    return [((-x0 + 2 * x0 * i / n, z), n_out) for i in range(n + 1)]


def front_stations():
    h0, R0, W0 = height_at((0, Z_F), None)
    W = W0 + 0.002
    st, trim = [], []
    for p, n in x_span_path(Z_F, (0.0, 1.0)):
        h = h0 + arch(p[0])
        sec, (bo, yb) = skirt_section(h, R0, _trim_y(Z_F))
        sec = sec + deck_section(h, R0, W)[1:]
        st.append((p, n, thicken(sec, T)))
        trim.append((p, n, [(bo + 0.0002 + 0.0016 * math.cos(2 * math.pi * k / 10), yb + 0.0016 * math.sin(2 * math.pi * k / 10)) for k in range(10)]))
    return st, trim


def rear_stations():
    h0 = REAR_TOP - 0.004
    R0, W0 = 0.0048, 0.0055
    st = []
    for p, n in x_span_path(Z_R, (0.0, -1.0), 48):
        h = h0 - rear_scoop(p[0])
        sec, _ = skirt_section(h, min(R0, max(0.003, h * 0.1)), min(_trim_y(Z_R), h * 0.72))
        sec = sec + deck_section(h, min(R0, max(0.003, h * 0.1)), W0)[1:]
        st.append((p, n, thicken(sec, T)))
    return st


def materials():
    paint = bpy.data.materials.new("enclosure_paint")
    paint.use_nodes = True
    b = paint.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.02, 0.021, 0.024, 1)
    b.inputs["Roughness"].default_value = 0.46
    b.inputs["Metallic"].default_value = 0.0
    trim = bpy.data.materials.new("enclosure_trim")
    trim.use_nodes = True
    b = trim.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.66, 0.61, 0.53, 1)
    b.inputs["Roughness"].default_value = 0.18
    b.inputs["Metallic"].default_value = 1.0
    return [paint, trim]


def finish(bm, name, mats):
    uv = bm.loops.layers.uv.new("UVMap")
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        ax = max(range(3), key=lambda i: abs(f.normal[i]))
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = ((co.z, co.y) if ax == 0 else (co.x, co.z) if ax == 1 else (co.x, co.y))
            l[uv].uv = (l[uv].uv[0] / UV_METRES, l[uv].uv[1] / UV_METRES)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle() < math.radians(50)
    bm.transform(MACHINE_TO_BLENDER)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def merge(bms):
    out = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new("t")
        b.to_mesh(me)
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
        b.free()
    return out


def static_gap(names):
    """Minimum distance between shell vertices and the frame surface, and frame vertices and the shell."""
    bpy.ops.import_scene.gltf(filepath=FRAME)
    def mesh_tree(obs):
        V, F = [], []
        for ob in obs:
            off = len(V)
            V += [ob.matrix_world @ v.co for v in ob.data.vertices]
            ob.data.calc_loop_triangles()
            F += [tuple(off + i for i in t.vertices) for t in ob.data.loop_triangles]
        return BVHTree.FromPolygons(V, F, epsilon=1e-7), V
    frame = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(("frame_", "segment"))]
    shell = [bpy.data.objects[n] for n in names]
    ft, fv = mesh_tree(frame)
    st, sv = mesh_tree(shell)
    best = (1e9, None)
    for tree, verts, label in ((ft, sv[::3], "shell vertex to frame"), (st, fv[::3], "frame vertex to shell")):
        for v in verts:
            r = tree.find_nearest(v)
            if r[0] is not None and r[3] < best[0]:
                best = (r[3], (label, [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]))
    return best


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = materials()
    objs = []
    for sign, sfx in ((1, "right"), (-1, "left")):
        skirt, deck, trim = side_parts(sign)
        objs.append(finish(merge([loft(skirt, 0), loft(trim, 1)]), f"enclosure_side_{sfx}", mats))
        objs.append(finish(loft(deck, 0), f"enclosure_deck_{sfx}", mats))
    front, trim = front_stations()
    objs.append(finish(merge([loft(front, 0), loft(trim, 1)]), "enclosure_front", mats))
    objs.append(finish(loft(rear_stations(), 0), "enclosure_rear", mats))
    total = 0
    for o in objs:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        total += tris
        print(f"{o.name}: {tris} tris")
    print("TOTAL:", total)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", use_selection=False)
    print("wrote", OUT)
    return [o.name for o in objs]


if __name__ == "__main__":
    names = build()
    ok = check_clearance.run(names, "clearance_enclosure.json")
    gap = static_gap(names)
    print(f"static gap to frame: {gap[0] * 1000:.2f} mm at {gap[1]}")
    with open(os.path.join(HERE, "clearance_enclosure.json")) as f:
        rep = json.load(f)
    rep["static_gap_to_frame_m"] = round(gap[0], 5)
    rep["static_gap_at"] = gap[1]
    with open(os.path.join(HERE, "clearance_enclosure.json"), "w") as f:
        json.dump(rep, f, indent=1)
    sys.exit(0 if ok and gap[0] > 0.0003 else 1)
