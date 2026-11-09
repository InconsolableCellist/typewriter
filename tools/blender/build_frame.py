"""Builds public/assets/models/frame.glb, headless and reproducible:

  ~/bin/blender --background --python tools/blender/build_frame.py
      -> frame.glb, then runs check_clearance (exit code 1 if anything intersects)

Every dimension comes from machine.json (node tools/gen/export_machine.mjs). Modelling happens in
machine coordinates (x right, y up, z toward the typist, metres); the export converts to Blender's
Z-up by the fixed rotation MACHINE_TO_BLENDER so that the GLB's nodes all have an identity transform.

Nodes: frame_base, frame_sides, frame_rails, segment. Materials: japanned, nickel, rubber.
UVs are box-projected in metres divided by UV_METRES (see docs/assets.md).
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "frame.glb")
M = json.load(open(os.path.join(HERE, "machine.json")))
MACHINE, GEO, RIG = M["machine"], M["geometry"], M["rig"]

UV_METRES = 0.2  # one UV unit spans this many metres of surface
MACHINE_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def materials():
    def make(name, base, metallic, rough):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*base, 1)
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = rough
        return m
    return {
        "japanned": make("japanned", (0.008, 0.008, 0.009), 0.0, 0.22),
        "nickel": make("nickel", (0.72, 0.70, 0.66), 1.0, 0.32),
        "rubber": make("rubber", (0.02, 0.02, 0.022), 0.0, 0.85),
    }


MAT = materials()
MAT_INDEX = {"japanned": 0, "nickel": 1, "rubber": 2}
SEGS = 48  # lathe resolution


# --- 2D helpers -----------------------------------------------------------------------------------

def rounded(points, seg=6):
    """points: [(u, v, radius)], closed. Corners filleted; returns a dense loop."""
    out = []
    n = len(points)
    for i in range(n):
        p0 = Vector(points[i - 1][:2])
        p1 = Vector(points[i][:2])
        p2 = Vector(points[(i + 1) % n][:2])
        r = points[i][2]
        a = (p0 - p1).normalized()
        b = (p2 - p1).normalized()
        cosang = max(-1, min(1, a.dot(b)))
        half = math.acos(cosang) / 2
        if r <= 0 or half < 1e-3 or half > math.pi / 2 - 1e-3:
            out.append(tuple(p1))
            continue
        dist = min(r / math.tan(half), (p1 - p0).length * 0.49, (p2 - p1).length * 0.49)
        r_eff = dist * math.tan(half)
        t0 = p1 + a * dist
        t1 = p1 + b * dist
        c = p1 + (a + b).normalized() * (r_eff / math.sin(half))
        a0 = math.atan2(*(t0 - c).yx)
        a1 = math.atan2(*(t1 - c).yx)
        d = a1 - a0
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
        for k in range(seg + 1):
            ang = a0 + d * k / seg
            out.append((c.x + r_eff * math.cos(ang), c.y + r_eff * math.sin(ang)))
    return out


def area(loop):
    return 0.5 * sum(loop[i][0] * loop[(i + 1) % len(loop)][1] - loop[(i + 1) % len(loop)][0] * loop[i][1]
                     for i in range(len(loop)))


def offset_loop(loop, d):
    """Moves a dense loop along its normals by d (positive: outward)."""
    sign = 1 if area(loop) > 0 else -1
    res = []
    n = len(loop)
    for i in range(n):
        p0, p1, p2 = Vector(loop[i - 1]), Vector(loop[i]), Vector(loop[(i + 1) % n])
        t = (p2 - p0).normalized()
        res.append(tuple(p1 + Vector((t.y, -t.x)) * d * sign))
    return res


def inset_clean(loop, d):
    """Inward offset that drops the points a tight concave step would fold back through the outline."""
    inset = offset_loop(loop, -d)
    out = []
    for p in inset:
        v = Vector(p)
        if d * 0.95 <= min((v - Vector(q)).length for q in loop) <= d * 1.2:  # both folded and thrown-out points go
            out.append(p)
    return out


def rrect(w, h, r, seg=5):
    return rounded([(-w / 2, -h / 2, r), (w / 2, -h / 2, r), (w / 2, h / 2, r), (-w / 2, h / 2, r)], seg)


# --- 3D building blocks ----------------------------------------------------------------------------

def frame_matrix(origin, x, y, z):
    return Matrix(((x[0], y[0], z[0], origin[0]),
                   (x[1], y[1], z[1], origin[1]),
                   (x[2], y[2], z[2], origin[2]),
                   (0, 0, 0, 1)))


def sanitize(loop, eps=0.00025):
    """Drops near-duplicate points and hairpin turns, which make Blender's bevel throw spikes."""
    pts = [Vector(p) for p in loop]
    changed = True
    while changed:
        changed = False
        out = []
        n = len(pts)
        for i in range(n):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
            if (b - a).length < eps:
                changed = True
                continue
            u, v = b - a, c - b
            if u.length > 1e-9 and v.length > 1e-9 and u.normalized().dot(v.normalized()) < -0.5:
                changed = True
                continue
            out.append(b)
        pts = out
    return [(p.x, p.y) for p in pts]


def outward(bm):
    """A shell's normals are outward when its signed volume is positive."""
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)


def extrude(loops, thickness, bevel, mat4, material, bevel_res=2):
    """Extrudes closed 2D loops (first the outline, others holes) with rounded edges. Local XY is the
    profile plane, thickness is centred on Z. Returns a bmesh in machine coordinates."""
    cu = bpy.data.curves.new("c", "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.resolution_u = 1
    cu.bevel_mode = "ROUND"
    cu.bevel_depth = bevel
    cu.bevel_resolution = bevel_res
    cu.extrude = max(0.0, thickness / 2 - bevel)
    cu.offset = -bevel
    for loop in map(sanitize, loops):
        sp = cu.splines.new("POLY")
        sp.points.add(len(loop) - 1)
        for i, (u, v) in enumerate(loop):
            sp.points[i].co = (u, v, 0, 1)
        sp.use_cyclic_u = True
    ob = bpy.data.objects.new("c", cu)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)  # caps and bevels come out unwelded
    bmesh.ops.transform(bm, matrix=mat4, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    outward(bm)
    for f in bm.faces:
        f.material_index = MAT_INDEX[material]
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return bm


def prism(loop, thickness, mat4, material):
    """A straight extrusion with hard edges: closed by construction, for parts too small to bevel."""
    bm = bmesh.new()
    a = [bm.verts.new((u, v, -thickness / 2)) for u, v in loop]
    b = [bm.verts.new((u, v, thickness / 2)) for u, v in loop]
    n = len(loop)
    bm.faces.new(a)
    bm.faces.new(reversed(b))
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.transform(bm, matrix=mat4, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    outward(bm)
    for f in bm.faces:
        f.material_index = MAT_INDEX[material]
    return bm


def lathe(profile, origin, axis, material, segs=SEGS):
    """Revolves [(radius, along_axis)] around the axis through origin. Ends closed if radius 0."""
    bm = bmesh.new()
    axis = Vector(axis).normalized()
    ref = Vector((1, 0, 0)) if abs(axis.x) < 0.9 else Vector((0, 1, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u)
    o = Vector(origin)
    rings = []
    for r, s in profile:
        if r < 1e-6:
            rings.append([bm.verts.new(o + axis * s)])
            continue
        rings.append([bm.verts.new(o + axis * s + (u * math.cos(2 * math.pi * k / segs)
                                                   + v * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) > 1:
            for k in range(segs):
                bm.faces.new((a[0], b[k], b[(k + 1) % segs]))
        elif len(b) == 1 and len(a) > 1:
            for k in range(segs):
                bm.faces.new((a[(k + 1) % segs], a[k], b[0]))
        elif len(a) > 1:
            for k in range(segs):
                bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    outward(bm)
    for f in bm.faces:
        f.material_index = MAT_INDEX[material]
    return bm


def bar(p0, p1, w, h, r, bevel, material, up=(0, 1, 0)):
    """A cast bar of rounded rectangular section between two points."""
    p0, p1 = Vector(p0), Vector(p1)
    z = (p1 - p0).normalized()
    x = Vector(up).cross(z).normalized()
    y = z.cross(x)
    return extrude([rrect(w, h, r)], (p1 - p0).length, bevel, frame_matrix((p0 + p1) / 2, x, y, z), material)


def side_matrix(x_centre):
    """Profile plane (u = machine z, v = machine y), extruded along x."""
    return frame_matrix((x_centre, 0, 0), (0, 0, 1), (0, 1, 0), (-1, 0, 0))


def plan_matrix(y_centre):
    """Profile plane (u = machine x, v = -machine z), extruded along y."""
    return frame_matrix((0, y_centre, 0), (1, 0, 0), (0, 0, -1), (0, 1, 0))


# --- Dimensions derived from the machine definition ------------------------------------------------

keys = GEO["keys"]
ctrl_max_x = max(abs(k["pos"][0]) + k["width"] / 2 for k in keys if k["kind"] == "control")
key_max_x = max(abs(k["pos"][0]) for k in keys if k["kind"] == "print") + MACHINE["keys"]["topRadius"]
INNER_X = max(ctrl_max_x, key_max_x) + 0.007    # the keyboard fits between the side plates
SIDE_T = 0.015                                  # side plate thickness
SIDE_X = INNER_X + SIDE_T / 2
OUTER_X = INNER_X + SIDE_T
BASE_OVERHANG = 0.007
space_z = next(k for k in keys if k.get("id") == "space")["pos"][2]
FRONT_Z = space_z + 0.0285                      # front face of the apron, in front of the space bar
REAR_Z = MACHINE["platen"]["center"][2] - 0.08  # behind the platen, room for the rear rail
BASE_Y0, BASE_Y1 = 0.012, 0.026
FOOT_R = 0.016
PLATEN = MACHINE["platen"]
PLATEN_Z = PLATEN["center"][2]
PLATEN_Y = PLATEN["center"][1]
# Rails where the renderer's carriage (src/render/rig.js) rides on them.
RAIL_R = 0.0038
RAIL_Y = RIG["railY"]
RAIL_FRONT_Z = RIG["railFrontZ"]
RAIL_REAR_Z = RIG["railRearZ"]
RAIL_HALF = RIG["railHalf"]
PLATE_TOP = RAIL_Y - RAIL_R + 0.0012             # side plates stop under the rails
# Behind the rear rail the plates drop under the rack, which sweeps with the carriage.
RACK_Z_CLEAR = RIG["rack"]["z"] + 0.0035
RACK_DROP_Y = RIG["rack"]["y"] - 0.0075
print_point = Vector(GEO["printPoint"])
n_fan = Vector(GEO["printNormal"])
w_fan = Vector(GEO["strikeDown"])
BAR_R = MACHINE["typebars"]["length"]
ARC = MACHINE["typebars"]["arcHalfAngle"]
BAR_HALF_LATERAL = max(MACHINE["typebars"]["barWidth"], MACHINE["typebars"]["barThickness"]) / 2


def build_base():
    parts = []
    outer = rounded([(-OUTER_X - BASE_OVERHANG, -FRONT_Z - 0.001, 0.02), (OUTER_X + BASE_OVERHANG, -FRONT_Z - 0.001, 0.02),
                     (OUTER_X + BASE_OVERHANG, -REAR_Z + 0.004, 0.02), (-OUTER_X - BASE_OVERHANG, -REAR_Z + 0.004, 0.02)], 8)
    hole = rounded([(-INNER_X + 0.008, -FRONT_Z + 0.022, 0.016), (INNER_X - 0.008, -FRONT_Z + 0.022, 0.016),
                    (INNER_X - 0.008, -REAR_Z - 0.018, 0.016), (-INNER_X + 0.008, -REAR_Z - 0.018, 0.016)], 8)
    parts.append(extrude([outer, hole], BASE_Y1 - BASE_Y0, 0.0028, plan_matrix((BASE_Y0 + BASE_Y1) / 2), "japanned", 3))
    # moulded top rib around the base
    rib = offset_loop(outer, -0.005)
    rib_in = offset_loop(outer, -0.012)
    parts.append(extrude([rib, rib_in], 0.006, 0.0018, plan_matrix(BASE_Y1 + 0.0015), "japanned", 2))
    # Cross rib carrying the key lever fulcrum (below the levers), and a rear tie.
    fulc_z = MACHINE["keys"]["leverPivot"][2]
    fulc_top = MACHINE["keys"]["leverPivot"][1] - 0.011
    parts.append(bar((-INNER_X, BASE_Y1 + (fulc_top - BASE_Y1) / 2, fulc_z), (INNER_X, BASE_Y1 + (fulc_top - BASE_Y1) / 2, fulc_z),
                     0.016, fulc_top - BASE_Y1, 0.005, 0.0022, "japanned", up=(0, 0, 1)))
    # Front apron: an arched keyboard frame in front of the space bar.
    apron_t = 0.016
    apron_z = FRONT_Z - apron_t / 2
    top_c = 0.066
    arch = [(-INNER_X - 0.003, BASE_Y1 - 0.004, 0.0), (INNER_X + 0.003, BASE_Y1 - 0.004, 0.0), (INNER_X + 0.003, 0.058, 0.012),
            (INNER_X * 0.45, top_c - 0.001, 0.08), (0, top_c + 0.003, 0.2), (-INNER_X * 0.45, top_c - 0.001, 0.08), (-INNER_X - 0.003, 0.058, 0.012)]
    apron_mat = frame_matrix((0, 0, apron_z), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    parts.append(extrude([rounded(arch, 8)], apron_t, 0.0032, apron_mat, "japanned", 3))
    # Rubber feet under the corners.
    foot_x = OUTER_X - 0.006
    for z in (FRONT_Z - 0.022, REAR_Z + 0.022):
        for sx in (-1, 1):
            p = [(0, 0), (FOOT_R - 0.0025, 0), (FOOT_R - 0.0006, 0.0006), (FOOT_R, 0.003), (FOOT_R - 0.0015, BASE_Y0 + 0.0015),
                 (FOOT_R * 0.7, BASE_Y0 + 0.003), (0, BASE_Y0 + 0.003)]
            parts.append(lathe(p, (sx * foot_x, 0, z), (0, 1, 0), "rubber", 32))
    return parts


def side_outline():
    top_rear = PLATE_TOP
    z0, z1 = REAR_Z, FRONT_Z - 0.0005
    return [
        (z0, BASE_Y0 + 0.002, 0.008), (z1, BASE_Y0 + 0.002, 0.008),
        (z1, 0.048, 0.012), (z1 - 0.018, 0.060, 0.016), (z1 - 0.06, 0.090, 0.04),
        (z1 - 0.12, 0.114, 0.06), (PLATEN_Z + 0.075, top_rear, 0.05),
        (RACK_Z_CLEAR + 0.0075, top_rear, 0.0075), (RACK_Z_CLEAR - 0.001, RACK_DROP_Y, 0.003),
        (z0 + 0.012, RACK_DROP_Y, 0.012), (z0, RACK_DROP_Y - 0.012, 0.009),
    ]


def side_windows():
    z0, z1 = REAR_Z, FRONT_Z
    y0 = BASE_Y1 + 0.016
    y1 = RAIL_Y - 0.020
    yr = RACK_DROP_Y - 0.014     # the rear window stays below the rack clearance step
    rear = rounded([(z0 + 0.026, y0, 0.012), (PLATEN_Z + 0.030, y0, 0.012), (PLATEN_Z + 0.030, y1, 0.014),
                    (z0 + 0.034, y1, 0.012), (z0 + 0.026, yr, 0.010)], 8)
    front = rounded([(PLATEN_Z + 0.052, y0, 0.014), (z1 - 0.048, y0, 0.014), (z1 - 0.048, 0.053, 0.012),
                     (z1 - 0.10, 0.074, 0.03), (z1 - 0.16, 0.091, 0.03), (PLATEN_Z + 0.075, y1 - 0.008, 0.02),
                     (PLATEN_Z + 0.052, y1 - 0.012, 0.014)], 8)
    return [rear, front]


def build_sides():
    parts = []
    outline = rounded(side_outline(), 8)
    windows = side_windows()
    for sx in (-1, 1):
        xc = sx * SIDE_X
        m = side_matrix(xc)
        parts.append(extrude([outline] + windows, SIDE_T - 0.003, 0.0022, m, "japanned", 3))
        # The raised casting border around the outline and windows.
        rim_out = outline
        rim_in = inset_clean(outline, 0.0065)
        parts.append(extrude([rim_out, rim_in], SIDE_T, 0.003, m, "japanned", 3))
        for w in windows:
            parts.append(extrude([offset_loop(w, 0.005), w], SIDE_T, 0.0024, m, "japanned", 3))
        # A ribbon spool deck on each side, standing on the side plate.
        rb = MACHINE["ribbon"]
        wing_x0 = rb["spoolX"] + 0.020      # the inner edge stays outside the end typebars' sweep
        wing = rounded([(sx * wing_x0, rb["spoolZ"] - 0.012, 0.006), (sx * (OUTER_X - 0.004), rb["spoolZ"] - 0.016, 0.006),
                        (sx * (OUTER_X - 0.004), rb["spoolZ"] + 0.018, 0.006), (sx * wing_x0, rb["spoolZ"] + 0.014, 0.006)], 6)
        loop = [(u, -v) for u, v in wing]
        parts.append(extrude([loop], 0.005, 0.0018, plan_matrix(rb["spoolY"] - rb["spoolWidth"] / 2 - 0.0035), "japanned", 2))
        for z in (rb["spoolZ"],):
            parts.append(bar((xc, PLATE_TOP - 0.004, z), (xc, rb["spoolY"] - rb["spoolWidth"] / 2 - 0.0045, z), 0.014, 0.012, 0.004, 0.0022, "japanned", up=(0, 0, 1)))
        # Bolt bosses where the side plates meet the base.
        for z in (REAR_Z + 0.03, PLATEN_Z + 0.085, FRONT_Z - 0.06):
            boss = [(0, 0), (0.0055, 0), (0.0066, 0.0008), (0.006, 0.0022), (0.0038, 0.0034), (0, 0.0036)]
            parts.append(lathe(boss, (sx * OUTER_X, 0.021, z), (sx, 0, 0), "nickel", 20))
    return parts


def build_rails():
    parts = []
    half = RAIL_HALF
    rail = [(0, -half - 0.003), (RAIL_R * 0.75, -half - 0.003), (RAIL_R, -half), (RAIL_R, half), (RAIL_R * 0.75, half + 0.003), (0, half + 0.003)]
    for z, front in ((RAIL_FRONT_Z, True), (RAIL_REAR_Z, False)):
        parts.append(lathe(rail, (0, RAIL_Y, z), (1, 0, 0), "nickel", 32))
        for sx in (-1, 1):
            # Rail saddles bolted to the top of the side plates. The rear ones stay under the rack mount
            # and in front of the rack; the front ones rise to cradle the rail.
            hw = 0.012 if front else 0.0048
            h = (RAIL_Y - 0.001 if front else PLATE_TOP + 0.0002) - (PLATE_TOP - 0.003)
            sl = [(-hw, -0.004, 0.0015), (hw, -0.004, 0.0015), (hw, h, 0.003), (-hw, h, 0.003)]
            m = frame_matrix((sx * (OUTER_X - 0.007), PLATE_TOP - 0.003, z), (0, 0, 1), (0, 1, 0), (-1, 0, 0))
            parts.append(extrude([rounded(sl, 3)], 0.024, 0.0012, m, "japanned", 2))
    # Rear uprights: turned posts rising from the base toward the rear rail, in front of the rack.
    for sx in (-1, 1):
        y0, y1 = BASE_Y1 - 0.002, RAIL_Y - RAIL_R - 0.0002
        h = y1 - y0
        pr = [(0, 0), (0.0125, 0), (0.0125, 0.003), (0.0085, 0.008), (0.0065, 0.018), (0.0055, h * 0.45), (0.006, h * 0.72), (0.0078, h - 0.012),
              (0.0088, h - 0.006), (0.0076, h), (0, h)]
        parts.append(lathe(pr, (sx * (INNER_X - 0.012), y0, RAIL_REAR_Z + 0.013), (0, 1, 0), "japanned", 28))
    # A rear tie low between the uprights, under the bell and the rocker.
    tie_z = RAIL_REAR_Z + 0.013
    parts.append(bar((-INNER_X + 0.012, 0.056, tie_z), (INNER_X - 0.012, 0.056, tie_z), 0.012, 0.009, 0.0035, 0.0018, "japanned", up=(0, 0, 1)))
    return parts


def segment_matrix(depth_centre):
    """Local X = machine x, local Y = strikeDown (radial, away from the print point), local Z = -printNormal."""
    z = -n_fan
    origin = print_point + z * depth_centre
    return frame_matrix(origin, (1, 0, 0), w_fan, z)


def build_segment():
    """The arc casting: body behind the pivot plane, comb teeth between bars, side arms to the plates."""
    parts = []
    r_in = BAR_R + 0.0015
    a_end = ARC + math.radians(4.5)

    def r_out(a):
        # thin at the centre, where the key levers pass underneath; heavier at the shoulders
        t = abs(a) / ARC
        return BAR_R + 0.0045 + 0.021 * t ** 2

    n = 64
    outer = [((r_out(a) * math.sin(a), r_out(a) * math.cos(a))) for a in (-a_end + 2 * a_end * k / n for k in range(n + 1))]
    inner = [((r_in * math.sin(a), r_in * math.cos(a))) for a in (a_end - 2 * a_end * k / n for k in range(n + 1))]
    body = outer + inner
    body = [(u, v) for u, v in body]
    depth_front, depth = 0.0045, 0.013
    parts.append(extrude([body], depth, 0.0028, segment_matrix(depth_front + depth / 2), "japanned", 3))
    # Rear stiffening rib.
    rib_o = [((r_out(a) - 0.002) * math.sin(a), (r_out(a) - 0.002) * math.cos(a)) for a in (-ARC * 1.02 + 2.04 * ARC * k / n for k in range(n + 1))]
    rib_i = [((max(r_in + 0.0005, r_out(a) - 0.0065)) * math.sin(a), (max(r_in + 0.0005, r_out(a) - 0.0065)) * math.cos(a)) for a in (ARC * 1.02 - 2.04 * ARC * k / n for k in range(n + 1))]
    parts.append(extrude([rib_o + rib_i], 0.0075, 0.002, segment_matrix(depth_front + depth + 0.002), "japanned", 2))
    # Comb teeth between the bars: thin wedges standing on the casting, halfway between pivot planes.
    bars = sorted(GEO["bars"], key=lambda b: b["slot"])
    slot_step = bars[1]["arcAngle"] - bars[0]["arcAngle"]
    angles = [bars[0]["arcAngle"] - slot_step / 2] + [b["arcAngle"] + slot_step / 2 for b in bars]
    for a in angles:
        # Shorter toward the ends: the arc rises there, under the ribbon spools.
        tooth_h = 0.0105 - 0.0065 * (abs(a) / ARC) ** 3
        lateral = (math.cos(a), -math.sin(a), 0)
        sl = Vector((math.sin(a) * r_in, math.cos(a) * r_in, 0))
        radial_dir = Vector((math.sin(a), math.cos(a), 0))
        # Profile in the plane (radial, -normal): stands out toward the bar side of the casting.
        prof = rounded([(0.0, -0.0025, 0.0007), (0.0125, -0.0025, 0.0), (0.0125, 0.0055, 0.0), (0.0, tooth_h - 0.002, 0.002), (-0.0005, tooth_h - 0.002, 0.0)], 3)
        z_axis = Vector(lateral)
        m = segment_matrix(0) @ frame_matrix(sl, radial_dir, Vector((0, 0, -1)), z_axis)
        parts.append(prism(prof, tooth_thickness(), m, "japanned"))
    # An arched girder behind the fan, carrying the segment between the side plates.
    girder_z = PLATEN_Z + 0.026
    def top(x):
        return 0.083 + 0.031 * (x / INNER_X) ** 2
    xs = [-INNER_X - 0.003 + (2 * INNER_X + 0.006) * k / 40 for k in range(41)]
    loop = [(x, top(x)) for x in xs] + [(x, top(x) - 0.0165 - 0.006 * abs(x / INNER_X)) for x in reversed(xs)]
    gm = frame_matrix((0, 0, girder_z), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    parts.append(extrude([loop], 0.012, 0.003, gm, "japanned", 3))
    # Struts joining the back of the segment to the girder.
    for a in (-0.6, 0.0, 0.6):
        r = (r_in + r_out(a)) / 2
        p0 = print_point + Vector((r * math.sin(a), 0, 0)) + w_fan * r * math.cos(a) - n_fan * (depth_front + depth - 0.002)
        p1 = Vector((p0.x, top(p0.x) - 0.009, girder_z + 0.002))
        parts.append(bar(p0, p1, 0.012, 0.008, 0.003, 0.0018, "japanned", up=(1, 0, 0)))
    # Shoulders: cast arms from the segment ends out to the side plates.
    for sx in (-1, 1):
        a = sx * ARC
        r = r_out(ARC) - 0.008
        local = print_point + Vector((sx * r * math.sin(ARC), 0, 0)) + w_fan * r * math.cos(ARC) - n_fan * (depth_front + depth / 2)
        p0 = local
        p1 = Vector((sx * (INNER_X + 0.002), local.y - 0.006, local.z - 0.006))
        parts.append(bar(p0, p1, 0.017, 0.011, 0.004, 0.0024, "japanned", up=(0, 1, 0)))
    return parts


def tooth_thickness():
    arc_spacing = 2 * ARC / (GEO["nPrint"] - 1) * BAR_R
    # clearance per side around a bar's maximum lateral half-width
    # (uses the bar's half-diagonal, so 0.2 mm is pessimistic against the real bar section)
    r_bar = math.hypot(MACHINE["typebars"]["barWidth"], MACHINE["typebars"]["barThickness"]) / 2
    return arc_spacing - 2 * r_bar - 2 * 0.0002


# --- Assembly -------------------------------------------------------------------------------------

def join(parts, name):
    bm = bmesh.new()
    for p in parts:
        me = bpy.data.meshes.new("tmp")
        p.to_mesh(me)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        p.free()
    return finish(bm, name)


def finish(bm, name):
    uv = bm.loops.layers.uv.new("UVMap")
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            if ax == 0:
                l[uv].uv = (co.z / UV_METRES, co.y / UV_METRES)
            elif ax == 1:
                l[uv].uv = (co.x / UV_METRES, co.z / UV_METRES)
            else:
                l[uv].uv = (co.x / UV_METRES, co.y / UV_METRES)
    bm.edges.ensure_lookup_table()
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle() < math.radians(40)
    bm.transform(MACHINE_TO_BLENDER)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mat in MAT.values():
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global MAT
    MAT = materials()
    objs = [join(build_base(), "frame_base"), join(build_sides(), "frame_sides"),
            join(build_rails(), "frame_rails"), join(build_segment(), "segment")]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    total = 0
    for o in objs:
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        total += tris
        print(f"{o.name}: {tris} tris")
    print(f"TOTAL: {total} tris")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=False,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT",
                              use_selection=False)
    print("wrote", OUT)
    return objs


if __name__ == "__main__":
    build()
    sys.path.insert(0, HERE)
    import check_clearance
    ok = check_clearance.run()
    sys.exit(0 if ok else 1)
