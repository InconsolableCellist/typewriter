"""Builds public/assets/models/desk.glb, the walnut desk the machine stands on.

  ~/bin/blender --background --python tools/blender/build_desk.py
      -> desk.glb, then a check against frame.glb and enclosure.glb (exit 1 on any violation)

Machine coordinates (x right, y up, z toward the typist, metres), so the node needs no transform.
The working surface is exactly y = 0: the machine's feet stand on it and the paper's soft body already has a
contact plane there. Nothing of the desk rises above y = 0.

Construction, as a joiner of the period would make it: a solid field of boards running along x, framed by a
band and a moulded edge mitred at the corners, each with its grain following its own length. Under it a
recessed apron and four tapered legs, so that the silhouette holds when the camera sees past the edge.

UV: one unit = UV_METRES, as in frame.glb, but authored rather than box projected. The wood's grain runs along
U everywhere, so `repeat = UV_METRES / tile` on the walnut_desk set gives the right scale and direction.
Node: desk. Material: desk_wood.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "desk.glb")

UV_METRES = 0.2
MACHINE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))

# Outer edge of the top, in plan. The machine is at the origin and the typist at +z.
X_HALF = 1.00
Z_BACK = -0.56
Z_FRONT = 0.64
BAND = 0.052           # field edge to the widest point of the moulding
HEIGHT = 0.74          # desk top to floor

# Field rectangle (the boards); profiles are offsets outward from it.
FX = X_HALF - BAND
FZ0 = Z_BACK + BAND
FZ1 = Z_FRONT - BAND


def arc(cx, cy, rx, ry, a0, a1, seg):
    """Points on an elliptical arc, end points included; angles in degrees."""
    out = []
    for i in range(seg + 1):
        a = math.radians(a0 + (a1 - a0) * i / seg)
        out.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return out


def edge_profile():
    """(outward offset, y) from the field edge, over the moulding and back under the top."""
    pts = [(0.0, 0.0), (0.050, 0.0)]
    pts += arc(0.050, -0.002, 0.002, 0.002, 90, 0, 4)[1:]         # eased arris
    pts += [(0.052, -0.008)]                                      # fillet
    pts += arc(0.040, -0.008, 0.012, 0.016, 0, -90, 10)[1:]       # thumbnail
    pts += [(0.037, -0.024)]                                      # quirk
    pts += arc(0.037, -0.036, 0.011, 0.012, 90, 180, 8)[1:]       # cove
    pts += [(0.026, -0.040), (-0.020, -0.040)]                    # underside
    return pts


def sweep(bm, uv, profile, closed, u_shift):
    """Sweeps a (offset, y) profile around the field rectangle with mitred corners.

    Each of the four sides is UV-mapped on its own: U along the side, V along the profile arc, so the grain
    follows every length of moulding and changes direction at the mitres.
    """
    n = len(profile)
    corners = [(-FX, FZ1, -1, 1), (FX, FZ1, 1, 1), (FX, FZ0, 1, -1), (-FX, FZ0, -1, -1)]  # clockwise from above, +y up
    rings = []
    for cx, cz, sx, sz in corners:
        rings.append([bm.verts.new((cx + p * sx, y, cz + p * sz)) for p, y in profile])
    arclen = [0.0]
    for i in range(1, n):
        arclen.append(arclen[-1] + math.dist(profile[i - 1], profile[i]))
    if closed:
        arclen.append(arclen[-1] + math.dist(profile[-1], profile[0]))
    segs = n if closed else n - 1
    for k in range(4):
        a, b = rings[k], rings[(k + 1) % 4]
        along_z = k in (1, 3)
        for i in range(segs):
            i2 = (i + 1) % n
            f = bm.faces.new((a[i], a[i2], b[i2], b[i]))
            for l in f.loops:
                c = l.vert.co
                u = c.z if along_z else c.x
                # the two rings at this vertex index differ in arc position only through i; recover it
                idx = i if l.vert in (a[i], b[i]) else i + 1
                l[uv].uv = ((u + u_shift[k]) / UV_METRES, (arclen[idx] + 0.37 * k + 0.11) / UV_METRES)
    return rings


def field(bm, uv, rings):
    """The boards: one flat quad closing the first ring of the moulding. Grain along x."""
    f = bm.faces.new([rings[k][0] for k in range(4)])
    for l in f.loops:
        l[uv].uv = (l.vert.co.x / UV_METRES, l.vert.co.z / UV_METRES)


def underside(bm, uv, rings):
    f = bm.faces.new([rings[k][-1] for k in range(4)])
    for l in f.loops:
        l[uv].uv = ((l.vert.co.x + 0.73) / UV_METRES, (l.vert.co.z + 0.21) / UV_METRES)


def leg(bm, uv, x, z, sx, sz, shift):
    """Tapered square leg; its outer faces stay vertical and flush, the taper comes off the inner faces."""
    y0, y1 = -0.040, -HEIGHT
    w0, w1 = 0.078, 0.044
    ring = []
    for y, w in ((y0, w0), (y1, w1)):
        pts = [(0, 0), (-sx * w, 0), (-sx * w, -sz * w), (0, -sz * w)]
        ring.append([bm.verts.new((x + a, y, z + b)) for a, b in pts])
    top, bot = ring
    for i in range(4):
        j = (i + 1) % 4
        f = bm.faces.new((top[i], top[j], bot[j], bot[i]))
        for l in f.loops:
            c = l.vert.co
            t = c.x if i % 2 == 0 else c.z
            l[uv].uv = ((c.y + shift) / UV_METRES, (t + 0.17 * i + shift) / UV_METRES)  # grain runs down the leg
    for r in (top, bot):
        f = bm.faces.new(list(r))
        for l in f.loops:
            l[uv].uv = ((l.vert.co.x + shift) / UV_METRES, (l.vert.co.z + shift) / UV_METRES)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat = bpy.data.materials.new("desk_wood")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.13, 0.07, 0.04, 1)
    bsdf.inputs["Roughness"].default_value = 0.42

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    top = sweep(bm, uv, edge_profile(), False, (0.0, 0.53, 0.29, 0.81))
    field(bm, uv, top)
    underside(bm, uv, top)

    # The apron: a closed rail section, recessed from the moulding, running between the legs.
    apron = [(-0.014, -0.040), (-0.014, -0.150), (-0.020, -0.156), (-0.036, -0.156), (-0.036, -0.040)]
    sweep(bm, uv, apron, True, (1.31, 1.77, 0.67, 1.13))

    inset = 0.014
    legs = ((-FX + inset, FZ1 - inset, 1, 1), (FX - inset, FZ1 - inset, -1, 1),
            (-FX + inset, FZ0 + inset, 1, -1), (FX - inset, FZ0 + inset, -1, -1))
    for i, (x, z, sx, sz) in enumerate(legs):
        leg(bm, uv, x, z, -sx, sz, 0.91 + 0.63 * i)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle() < math.radians(35)
    bm.transform(MACHINE_TO_BLENDER)

    me = bpy.data.meshes.new("desk")
    bm.to_mesh(me)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new("desk", me)
    bpy.context.scene.collection.objects.link(ob)
    print(f"desk: {tris} tris")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", use_selection=False)
    print("wrote", OUT)


def bounds(path):
    """(min, max) of a GLB's world-space vertices, in machine coordinates."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    inv = MACHINE_TO_BLENDER.inverted()
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        for v in ob.data.vertices:
            p = inv @ (ob.matrix_world @ v.co)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def check():
    fails = []
    lo, hi = bounds(OUT)
    print(f"desk bounds x {lo.x:.3f}..{hi.x:.3f}  y {lo.y:.3f}..{hi.y:.4f}  z {lo.z:.3f}..{hi.z:.3f}")
    if abs(hi.y) > 1e-5:
        fails.append(f"desk rises to y = {hi.y}")
    for name in ("frame", "enclosure"):
        path = os.path.join(ROOT, "public", "assets", "models", name + ".glb")
        a, b = bounds(path)
        print(f"{name}: lowest y {a.y:.4f}; plan x {a.x:.3f}..{b.x:.3f}, z {a.z:.3f}..{b.z:.3f}")
        if a.y < -1e-4:
            fails.append(f"{name} goes through the desk: y = {a.y}")
        if a.x < -FX or b.x > FX or a.z < FZ0 or b.z > FZ1:
            fails.append(f"{name} overhangs the field")
    for f in fails:
        print("FAIL:", f)
    return not fails


if __name__ == "__main__":
    build()
    sys.exit(0 if check() else 1)
