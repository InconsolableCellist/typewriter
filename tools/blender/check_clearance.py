"""Verifies, numerically, that the frame does not intersect the moving parts of the machine definition.

  ~/bin/blender --background --python tools/blender/check_clearance.py -- [frame.glb]

Runs inside the scene built by build_frame.py, or imports the GLB first. Every moving part is sampled as
capsules (points along an axis, with a radius) over its whole motion and tested against each frame node
with a BVH: a sample is a violation if it is inside the solid or nearer than its radius to a surface.
Writes tools/blender/clearance_report.json.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
M = json.load(open(os.path.join(HERE, "machine.json")))
MACHINE, GEO, RIG = M["machine"], M["geometry"], M["rig"]
NODES = ["frame_base", "frame_sides", "frame_rails", "segment"]
BLENDER_TO_MACHINE = lambda v: Vector((v.x, v.z, -v.y))
ARC_STEP = math.radians(1.5)
MARGIN = 0.0  # extra clearance demanded on top of the capsule radii


def rot(p, k, a):
    c, s = math.cos(a), math.sin(a)
    return p * c + k.cross(p) * s + k * k.dot(p) * (1 - c)


def segments():
    """(category, p0, p1, radius) tuples over the whole motion of every moving part."""
    out = []
    keys = MACHINE["keys"]
    lever_pivot = Vector(keys["leverPivot"])
    travel = MACHINE["linkage"]["keyTravel"]
    cap_r = keys["topRadius"]
    stem = keys["stemHeight"]
    for k in GEO["keys"]:
        p = Vector(k["pos"])
        t = k.get("travel", travel)
        for dy in [t * i / 5 for i in range(6)]:
            top = Vector((p.x, p.y - dy, p.z))
            if k["kind"] == "print":
                out.append(("key_caps", top + Vector((0, 0.002, 0)), top - Vector((0, 0.004, 0)), cap_r))
                out.append(("key_stems", top, top - Vector((0, stem, 0)), 0.0028))
            else:
                w = k["width"]
                half = max(0.0, w / 2 - 0.009)   # keep the capsule ends within the control's width
                for s in [-1 + i / 4 for i in range(9)]:
                    c = top + Vector((half * s, 0, 0))
                    out.append(("controls", c + Vector((0, 0.003, 0)), c - Vector((0, 0.006, 0)), 0.009))
                out.append(("control_stems", top, top - Vector((0, stem, 0)), 0.003))
            # lever: straight back, on its own fulcrum (x of the key), or fanning to the centre fulcrum
            stem_end = top - Vector((0, stem, 0))
            out.append(("key_levers", Vector((p.x, lever_pivot.y, lever_pivot.z)), stem_end, 0.004))
            out.append(("key_levers", lever_pivot, stem_end, 0.004))
    half_w = max(MACHINE["typebars"]["barWidth"], MACHINE["typebars"]["barThickness"]) / 2
    r_bar = math.hypot(MACHINE["typebars"]["barWidth"], MACHINE["typebars"]["barThickness"]) / 2
    L = MACHINE["typebars"]["length"]
    r_slug = max(MACHINE["slug"]["faceHeight"], MACHINE["slug"]["faceWidth"]) / 2 + 0.001
    for b in GEO["bars"]:
        piv = Vector(b["pivot"])
        ax = Vector(b["axis"])
        sd = Vector(b["strikeDir"])
        n = int(b["thetaTravel"] / ARC_STEP) + 1
        for i in range(n + 1):
            th = b["thetaTravel"] * i / n
            d = rot(sd, ax, b["thetaTravel"] - th)
            out.append(("typebars", piv, piv + d * L, r_bar))
            out.append(("typebar_slugs", piv + d * (L - 0.006), piv + d * (L + 0.002), r_slug))
    # Carriage: platen with knobs over the full travel (taken symmetric about centre), shift in both directions.
    pl = MACHINE["platen"]
    c = Vector(pl["center"])
    trav = max(abs(MACHINE["carriage"]["startX"]), abs(MACHINE["carriage"]["startX"] - MACHINE["carriage"]["travel"]))
    half = pl["length"] / 2 + pl["knobOffset"] + 0.02 + trav
    for dy in (-MACHINE["carriage"]["shiftTravel"], MACHINE["carriage"]["shiftTravel"]):
        cc = c + Vector((0, dy, 0))
        out.append(("carriage_platen_knobs", cc - Vector((half, 0, 0)), cc + Vector((half, 0, 0)), pl["knobRadius"]))
    # Renderer-owned carriage parts (src/render/rig.js) that sweep with it: rack, beams, shoes.
    rk = RIG["rack"]
    sweep = trav + rk["halfLength"]
    out.append(("rig_rack", Vector((-sweep, rk["y"], rk["z"])), Vector((sweep, rk["y"], rk["z"])), 0.0016))
    out.append(("rig_rack", Vector((-sweep, rk["y"] + 0.006, rk["z"])), Vector((sweep, rk["y"] + 0.006, rk["z"])), 0.0016))
    y_beam = RIG["railY"] + 0.008
    for z in (RIG["railFrontZ"], RIG["railRearZ"]):
        span = RIG["endPlateX"] + trav
        for dz in (-0.004, 0.004):
            out.append(("rig_carriage_beams", Vector((-span, y_beam, z + dz)), Vector((span, y_beam, z + dz)), 0.003))
    # Rack mount (a bar above the rack, renderer rig), table, levers, bail, paper and ribbon paths.
    my = rk["y"] + 0.012
    for dy in (-0.006, 0.006):
        for dz in (-0.0012 - 0.004, -0.0012 + 0.004):
            out.append(("rig_rack", Vector((-sweep, my + dy, rk["z"] + dz)), Vector((sweep, my + dy, rk["z"] + dz)), 0.0005))
    c0 = Vector(pl["center"])
    beta = MACHINE["printPoint"]["beta"]
    tip_beta = beta + MACHINE["paper"]["panArc"][0]
    tip_r = pl["radius"] + MACHINE["paper"]["panClearance"] / 2
    tip = c0 + Vector((0, math.sin(tip_beta) * tip_r, math.cos(tip_beta) * tip_r))
    up_slope = Vector((0, -math.cos(tip_beta), math.sin(tip_beta)))
    thw = MACHINE["paper"]["tableWidth"] / 2 + trav
    for i in range(9):
        p = tip + up_slope * (MACHINE["paper"]["tableLength"] * i / 8)
        out.append(("paper_table", p - Vector((thw, 0, 0)), p + Vector((thw, 0, 0)), 0.0015))
    # Paper: wrapped around the platen (the feed gap), then leaving tangent, upward from the print line.
    pw = MACHINE["paper"]["width"] / 2 + trav
    for i in range(25):
        a = beta + math.radians(-175 + i * 8)
        p = c0 + Vector((0, math.sin(a), math.cos(a))) * (pl["radius"] + 0.0016)
        out.append(("paper_path", p - Vector((pw, 0, 0)), p + Vector((pw, 0, 0)), 0.0005))
    pp = Vector(GEO["printPoint"])
    t_up = Vector((0, math.cos(beta), -math.sin(beta)))
    for i in range(12):
        p = pp + t_up * (MACHINE["paper"]["height"] * i / 11)
        out.append(("paper_path", p - Vector((pw, 0, 0)), p + Vector((pw, 0, 0)), 0.0005))
    # Ribbon: rim, guide posts, fork, at rest and at full lift; capsule of half the ribbon width.
    rb0 = MACHINE["ribbon"]
    f = pp + Vector(GEO["printNormal"]) * rb0["standoff"] + Vector(GEO["strikeDown"]) * rb0["vibrator"]["restDrop"]
    post_z = f.z + rb0["guidePostRadius"] + 0.0005
    full0 = math.sqrt(rb0["spoolRadiusEmpty"] ** 2 + rb0["length"] * rb0["thickness"] / math.pi)
    for lift in (0, rb0["vibrator"]["fullLift"]):
        l = Vector(GEO["strikeDown"]) * (-lift)
        for sx in (-1, 1):
            post = Vector((sx * rb0["guidePostX"], f.y, post_z - rb0["guidePostRadius"])) + l
            rim = Vector((sx * (rb0["spoolX"] - full0 * 0.5), rb0["spoolY"], rb0["spoolZ"] - full0 * 0.8))
            out.append(("ribbon", rim, post, rb0["width"] / 2))
            out.append(("ribbon", post, f + l, rb0["width"] / 2))
    # Levers on the carriage at both travel ends and centre, through their swing.
    for cx in (-trav, 0.0, trav):
        lsp = Vector(RIG["ls"]["pivot"]) + Vector((cx, 0, 0))
        ax = Vector(RIG["ls"]["axis"])
        rest = Vector(RIG["ls"]["rest"])
        tr = MACHINE["lineSpace"]["travel"]
        for k in range(-3, 4):
            d = rot(rest, ax, tr * k / 3)
            out.append(("carriage_levers", lsp, lsp + d * RIG["ls"]["length"], 0.0024))
            tip_c = lsp + d * (RIG["ls"]["length"] + 0.0065)
            out.append(("carriage_levers", tip_c, tip_c, 0.0072))
        for name, length in (("carriageRelease", 0.03), ("paperRelease", 0.034)):
            p0 = Vector(RIG[name]["pos"]) + Vector((cx, 0, 0))
            for ry in (0.2, 0.85):
                out.append(("carriage_levers", p0, p0 + Vector((0, ry, 0.6)).normalized() * length, 0.0036))
        bb = Vector(RIG["bail"]["bar"]) + Vector((cx, 0, 0))
        hb = pl["length"] / 2
        out.append(("carriage_levers", bb - Vector((hb, 0, 0)), bb + Vector((hb, 0, 0)), RIG["bail"]["radius"] + 0.002))
    # Static or near-static renderer parts near the frame: universal bar, rocker, bell.
    ub = RIG["ubar"]
    for dy in (0, -ub["travel"]):
        out.append(("rig_universal_bar", Vector((-ub["halfWidth"], ub["y"] + dy, ub["z"])), Vector((ub["halfWidth"], ub["y"] + dy, ub["z"])), 0.004))
    rp = Vector(RIG["rocker"]["pivot"])
    out.append(("rig_rocker", rp, rp + Vector((0, 0, 0.001)), RIG["rocker"]["arm"] + 0.004))
    bc = Vector(RIG["bell"]["center"])
    out.append(("rig_bell", bc - Vector((0, 0, 0.006)), bc + Vector((0, 0, 0.006)), RIG["bell"]["radius"]))
    # Ribbon spools: flat cylinders on vertical axes, sampled as rings on their end faces and rim.
    rb = MACHINE["ribbon"]
    full = math.sqrt(rb["spoolRadiusEmpty"] ** 2 + rb["length"] * rb["thickness"] / math.pi) + 0.001
    for sx in (-1, 1):
        c = Vector((sx * rb["spoolX"], rb["spoolY"], rb["spoolZ"]))
        for dy in (-rb["spoolWidth"] / 2, 0, rb["spoolWidth"] / 2):
            for frac in (0, 0.33, 0.66, 1.0):
                for k in range(24):
                    ang = 2 * math.pi * k / 24
                    p = c + Vector((full * frac * math.cos(ang), dy, full * frac * math.sin(ang)))
                    out.append(("ribbon_spools", p, p, 0.0002))
    return out


def trees(nodes=NODES):
    res = {}
    dg = bpy.context.evaluated_depsgraph_get()
    for name in nodes:
        ob = bpy.data.objects.get(name)
        if ob is None:
            raise RuntimeError(f"node {name} missing")
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        verts = [BLENDER_TO_MACHINE(ob.matrix_world @ v.co) for v in me.vertices]
        me.calc_loop_triangles()
        tris = [tuple(t.vertices) for t in me.loop_triangles]
        res[name] = BVHTree.FromPolygons(verts, tris, epsilon=1e-7)
        ev.to_mesh_clear()
    return res


def odd_crossings(tree, p):
    """True if at least two of three axis rays cross the surface an odd number of times."""
    odd = 0
    for d in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):
        count = 0
        o = p.copy()
        while True:
            hit = tree.ray_cast(o, d)
            if hit[0] is None:
                break
            count += 1
            o = hit[0] + d * 1e-6
        odd += count % 2
    return odd >= 2


def run(nodes=NODES, report_name="clearance_report.json"):
    bvh = trees(nodes)
    cats = {}
    worst_overall = 1e9
    for cat, p0, p1, r in segments():
        length = (p1 - p0).length
        steps = max(1, int(length / 0.002))
        best = 1e9
        for i in range(steps + 1):
            p = p0.lerp(p1, i / steps)
            for name, tree in bvh.items():
                loc, nor, idx, dist = tree.find_nearest(p)
                if loc is None:
                    continue
                # Inside if the sample is behind the nearest surface and rays say so (odd crossing count).
                inside = (p - loc).dot(nor) < -1e-9 and dist < 0.012 and odd_crossings(tree, p)
                c = -dist - r if inside else dist - r
                rec = cats.setdefault(cat, {"min": 1e9, "node": None, "at": None})
                if c < rec["min"]:
                    rec.update(min=c, node=name, at=[round(p.x, 4), round(p.y, 4), round(p.z, 4)], inside=inside)
                best = min(best, c)
        worst_overall = min(worst_overall, best)
    # Lateral clearance of the comb teeth is by construction much smaller than capsule radii allow for.
    ok = all(v["min"] >= -MARGIN for v in cats.values())
    report = {"ok": ok, "worst_clearance_m": worst_overall,
              "categories": {k: dict(v, min=round(v["min"], 5)) for k, v in sorted(cats.items())}}
    with open(os.path.join(HERE, report_name), "w") as f:
        json.dump(report, f, indent=1)
    for k, v in sorted(cats.items()):
        print(f"  {k:24s} min clearance {v['min'] * 1000:8.2f} mm  node {v['node']}  at {v['at']}{'  INSIDE' if v.get('inside') else ''}")
    print("clearance:", "OK" if ok else "VIOLATION", f"worst {worst_overall * 1000:.2f} mm")
    return ok


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(argv[0]))
    enc = sorted(o.name for o in bpy.data.objects if o.name.startswith("enclosure_"))
    if enc:
        sys.exit(0 if run(enc, "clearance_enclosure.json") else 1)
    sys.exit(0 if run() else 1)
