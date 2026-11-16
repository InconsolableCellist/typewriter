"""Builds public/assets/models/fax_fo70.glb, the Sharp FO-70 thermal fax (c. 1999), from tools/blender/fax_fo70.json.

  /root/bpyenv/bin/python tools/blender/build_fax_fo70.py

304 x 236 x 122 mm (docs/fax/research.md 8.2), after the owner's photograph from above (docs/fax/refs/owner/
sharp_fo70_top.png; the review and the reasoning are in docs/fax/models.md). A lilac-grey body whose side profile is a
low front face, the operation panel rising at 32 degrees, the document table rising behind it to a ridge, and the roll
cover falling steeply from the ridge to a low heel at the back (the photograph, taken from in front and above, sees
nothing behind the ridge, which the documented depth needs). The handset lies in a cradle moulded along the left side,
its earpiece end at the ridge. The panel carries a cream overlay with the LCD in a recess, five rapid keys, the round
START / STOP / COPY pad, the 3 x 4 number keys and the function keys on either side.

Nodes (unit coordinates: x right, y up, z toward the operator; origin on the desk under the footprint's centre). Every
moving part is its own node with its pivot at its origin; the press or slide axis, the travel and the legend are glTF
extras (JSON strings) on the node. See docs/fax/models.md for the contract.
"""
import json
import math
import os
import sys

import bpy  # noqa: F401  (first: it provides bmesh and mathutils)
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import wp_mould as W  # noqa: E402
from fax_fo70_layout import panel_layout  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "models", "fax_fo70.glb")
J = json.load(open(os.path.join(HERE, "fax_fo70.json")))


def lin(hexstr):
    """sRGB hex to linear RGBA for the Blender previews."""
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1,)


# Preview colours only: the view replaces every material by name (src/render/fax/fo70-view.js).
W.MATERIALS.update({
    "fax_body": (lin("#a8a7ba"), 0.55, 0.0),
    "fax_panel": (lin("#d9d4c0"), 0.5, 0.0),
    "fax_key": (lin("#8f9199"), 0.45, 0.0),
    "fax_key_start": (lin("#d8cba6"), 0.45, 0.0),
    "fax_lcd": (lin("#c3cabd"), 0.25, 0.0),
    "fax_rubber": ((0.02, 0.02, 0.02, 1), 0.9, 0.0),
    "fax_dark": ((0.022, 0.022, 0.026, 1), 0.6, 0.0),
    "fax_paper": (lin("#ecebe4"), 0.8, 0.0),
})

SX, SY, SZ = J["size"]
X = SX / 2
FEET = J["feet"]
WALL = J["wall"]
GAP = J["gap"]
PN = J["panel"]
PS = math.radians(PN["slope_deg"])
ZR, YR = PN["rear"]
L = PN["length"]
PT = PN["thickness"]
U0, U1 = PN["u"]
HS = J["handset"]
HA = math.radians(HS["slope_deg"])
HC = Vector(HS["center"])
XC = J["docPath"]["center"]


# ---------- frames ----------

def MP():
    """Panel frame (u, n, w) -> unit coordinates: u = x, n out of the panel, w down its slope from the rear edge."""
    return Matrix.Translation((0, YR, ZR)) @ Matrix.Rotation(PS, 4, "X")


def MH():
    """Handset frame (x, ly, lz) -> unit: ly out of its top, lz along it toward the mouthpiece (front)."""
    return Matrix.Translation(HC) @ Matrix.Rotation(HA, 4, "X")


def P(u, w, n=0.0):
    return MP() @ Vector((u, n, w))


PRESS = [0.0, -math.cos(PS), -math.sin(PS)]         # into the panel, in unit coordinates


def in_frame(ob, m):
    ob.data.transform(m)
    return ob


def tag(ob, **kv):
    for k, v in kv.items():
        ob[k] = json.dumps(v)
    return ob


def rr(u0, w0, u1, w1, r, seg=6):
    return W.rounded_rect(u0, w0, u1, w1, r, seg=seg)


def circle(cx, cy, r, seg=24):
    return W.ellipse(cx, cy, r, r, seg)


def poly_offset(pts, d):
    """Insets a closed polygon (z, y) by d (miter joins)."""
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)) / 2
    sgn = 1 if area > 0 else -1
    lines = []
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x)) * sgn                  # inward for an anticlockwise polygon
        lines.append((a + nrm * d, t))
    out = []
    for i in range(n):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        den = t1.x * t2.y - t1.y * t2.x
        if abs(den) < 1e-9:
            out.append(tuple(p2))
            continue
        s = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / den
        q = p1 + t1 * s
        out.append((q.x, q.y))
    return out


# ---------- the body's outer form ----------

PROFILE = [(p[0], p[1]) for p in J["profile"]["points"]]
RADII = [p[2] for p in J["profile"]["points"]]


def plan_poly(d=0.0, seg=6):
    """The footprint (x, z) inset by d: full width under the panel, narrower behind it on the right, where the
    photograph shows the document table and the roll cover stopping short of the panel's right edge."""
    pc = J["plan"]["corner"]
    xr, zn, rn = J["plan"]["rearRight"], J["plan"]["notchZ"], J["plan"]["notchRadius"]
    pts = [(-X + d, -SZ / 2 + d), (xr - d, -SZ / 2 + d), (xr - d, zn - d), (X - d, zn - d), (X - d, SZ / 2 - d), (-X + d, SZ / 2 - d)]
    rad = [pc - d, pc - d, rn + d, 0.002, pc - d, pc - d]
    return W.round_poly(pts, rad, seg=seg)


def outer(rounded=True):
    """The whole machine's envelope: the side profile across the width, plan corners rounded, side edges softened."""
    prof = W.round_poly(PROFILE, RADII, seg=6)
    ob = W.ob_from(W.prism(prof, "x", -X, X), "outer")
    W.boolean(ob, W.ob_from(W.prism(plan_poly(0.0, 6), "y", -0.01, SY + 0.05), "p"), "INTERSECT")
    if rounded:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(50)
        mod.width = J["plan"]["sideRound"]
        mod.segments = 3
        mod.profile = 0.6
        mod.use_clamp_overlap = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return ob


def inner(d=None):
    """The hollow: the profile inset by the wall (or by d)."""
    d = WALL if d is None else d
    prof = poly_offset(PROFILE, d)
    ob = W.ob_from(W.prism(prof, "x", -X + d, X - d), "inner")
    W.boolean(ob, W.ob_from(W.prism(plan_poly(d, 3), "y", -0.01, SY + 0.05), "p"), "INTERSECT")
    return ob


def panel_slab(grow=0.0):
    """The operation panel's region: in front of its rear edge, above its underside, right of the cradle."""
    poly = [(U0 - grow, -grow), (X + 0.02, -grow), (X + 0.02, L + 0.03), (U0 - grow, L + 0.03)]
    return in_frame(W.ob_from(W.prism(poly, "y", -PT - grow, 0.06), "slab"), MP())


def cover_region(grow=0.0):
    """The roll cover's region: behind its front parting line across the ridge, above a line that runs inside the
    hollow under the rear slope and leaves the shell at the heel."""
    c = J["cover"]
    f = c["front"] + grow
    cut = [(f, c["cut"][0][1] - grow)] + [(z, y - grow) for z, y in c["cut"][1:]]
    poly = [(f, 0.25)] + cut + [(cut[-1][0], 0.25)]
    return W.ob_from(W.prism(poly, "x", c["u"][0] - grow, X + 0.02), "cov")


def cradle_cuts():
    """The trough the handset lies in, pockets for its earpiece and mouthpiece and the hook switch's hole: separate
    cutters, each subtracted on its own (a union of them first upsets the exact solver)."""
    cr = J["cradle"]
    bar0 = HS["bar"][0]
    out = [W.ob_from(W.box_bm(cr["u"][0] - 0.01 - HC.x, bar0 - 0.0005, cr["lz"][0], cr["u"][1] - GAP + 0.0003 - HC.x, 0.09, cr["lz"][1]), "trough")]
    for pod in HS["pods"]:
        out.append(W.ob_from(W.prism(W.ellipse(0, pod["lz"], pod["r"][0] / 2 + 0.002, pod["r"][1] / 2 + 0.002, 24), "y", bar0 - pod["depth"] - 0.0015, bar0 + 0.003), "pod"))
    hk = cr["hook"]
    out.append(W.ob_from(W.cylinder_bm((0, bar0 - 0.012, hk["lz"]), "y", hk["r"] + 0.0006, 0.026, 16), "hk"))
    return [in_frame(o, MH()) for o in out]


def cradle_block():
    cr = J["cradle"]
    bar0 = HS["bar"][0]
    return in_frame(W.ob_from(W.box_bm(cr["u"][0] - 0.01 - HC.x, bar0 - 0.034, cr["lz"][0] - 0.004, cr["u"][1] + 0.004 - HC.x, bar0 + 0.02, cr["lz"][1]), "cblock"), MH())


def doc_channel():
    d = J["docPath"]
    s = d["slot"]
    ob = W.ob_from(W.box_bm(XC - d["slotWidth"] / 2, s["n"][0], -0.003, XC + d["slotWidth"] / 2, s["n"][1], s["w"][1]), "chan")
    return in_frame(ob, MP())


def front_cuts():
    d, p = J["docPath"], J["printPath"]
    a = W.box_bm(XC - d["slotWidth"] / 2, d["exit"]["y"][0], 0.100, XC + d["slotWidth"] / 2, d["exit"]["y"][1] + 0.004, 0.13)
    b = W.box_bm(XC - p["slotWidth"] / 2, p["slot"]["y"][0], 0.105, XC + p["slotWidth"] / 2, p["slot"]["y"][1], 0.13)
    return W.join_bms([a, b], "front")


def jack_cuts():
    j = J["jacks"]
    bms = []
    for k in ("line", "tel"):
        x, y, z = j[k]
        bms.append(W.box_bm(x - 0.0058, y - 0.0045, z - 0.01, x + 0.0058, y + 0.0045, z + 0.009))
    x, y, z = j["handset"]
    bms.append(W.box_bm(x - 0.01, y - 0.0035, z - 0.0045, x + 0.009, y + 0.0035, z + 0.0045))
    x, y, z = j["power"]
    bms.append(W.cylinder_bm((x, y, z), "z", 0.0042, 0.02, 16))
    return W.join_bms(bms, "jacks")


def speaker_cuts():
    sp = J["speaker"]
    cx, _, cz = sp["at"]
    bms = []
    for i in range(-3, 4):
        half = math.sqrt(max(0.0, sp["r"] ** 2 - (i * 0.0055) ** 2)) - 0.002
        if half > 0.003:
            bms.append(W.box_bm(cx - half, -0.01, cz + i * 0.0055 - 0.0011, cx + half, FEET + WALL + 0.002, cz + i * 0.0055 + 0.0011))
    return W.join_bms(bms, "spk")


def latch_cut():
    la = J["latch"]
    x, z = la["at"]
    w, d = la["size"]
    return W.ob_from(W.box_bm(x - w / 2 - 0.0007, 0.1050, z - d / 2 - 0.0007, x + w / 2 + 0.0007, 0.2, z + d / 2 + 0.0007), "lcut")


def check_solid(ob, what):
    """Exits 1 if a boolean left the part inside out or reaching outside the documented size."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    vol = bm.calc_volume(signed=True)
    bm.free()
    vs = [v.co for v in ob.data.vertices]
    mn = [min(v[i] for v in vs) for i in range(3)]
    mx = [max(v[i] for v in vs) for i in range(3)]
    lim = ((-X, X), (0.0, SY), (-SZ / 2, SZ / 2))
    bad = vol <= 0 or any(mn[i] < lim[i][0] - 1e-4 or mx[i] > lim[i][1] + 1e-4 for i in range(3))
    if bad:
        print(f"SOLID CHECK FAILED: {what}: volume {vol * 1e6:.1f} cm3, bounds {mn} {mx}")
        sys.exit(1)


def build_body():
    # A solid moulding with one hollow: the roll compartment under the cover (the slots and jacks are blind pockets
    # with dark linings; the mechanism under the panel is not modelled).
    body = outer()
    cav = inner()
    c = J["cover"]
    W.boolean(cav, W.ob_from(W.box_bm(U0 + WALL, FEET + WALL, -1, X, 1, c["front"] - WALL), "cb"), "INTERSECT")
    W.boolean(body, cav, "DIFFERENCE")
    W.boolean(body, panel_slab(GAP))
    W.boolean(body, cover_region(GAP))
    for c in cradle_cuts():
        W.boolean(body, c)
    W.boolean(body, doc_channel())
    W.boolean(body, front_cuts())
    W.boolean(body, jack_cuts())
    W.boolean(body, speaker_cuts())
    W.boolean(body, latch_cut())
    check_solid(body, "body")
    W.finish(body, "fax_body", 0.0006, 1)
    body.name = "fax_body"
    return body


def build_cover():
    cov = outer()
    W.boolean(cov, cover_region(0.0), "INTERSECT")
    W.boolean(cov, inner(), "DIFFERENCE")
    check_solid(cov, "roll cover")
    W.finish(cov, "fax_body", 0.0006, 1)
    cov.name = "fax_roll_cover"
    return cov


# ---------- the operation panel ----------

def key_list():
    return J["keys"]["list"]


def pad_sector(dirv, r0, r1, gap, seg=10):
    """An annular quarter of the pad round direction dirv (u, w), its edges a gap apart."""
    cu, cw = PN["pad"]["center"]
    base = math.atan2(dirv[1], dirv[0])
    a0o, a1o = base - math.pi / 4 + gap / (2 * r1), base + math.pi / 4 - gap / (2 * r1)
    a0i, a1i = base - math.pi / 4 + gap / (2 * r0), base + math.pi / 4 - gap / (2 * r0)
    pts = [(cu + r1 * math.cos(a0o + (a1o - a0o) * i / seg), cw + r1 * math.sin(a0o + (a1o - a0o) * i / seg)) for i in range(seg + 1)]
    pts += [(cu + r0 * math.cos(a1i + (a0i - a1i) * i / 4), cw + r0 * math.sin(a1i + (a0i - a1i) * i / 4)) for i in range(5)]
    return pts


def planar_uv(ob, u0, w0, size_u, size_w):
    """uv 0..1 over (u0, w0, size) of the panel frame (mesh still in the panel frame), canvas top = rear (small w)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = ((c.x - u0) / size_u, 1 - (c.z - w0) / size_w)
    bm.to_mesh(ob.data)
    bm.free()


def build_key(k):
    """A key cap in the panel frame, its uv 0..1 over its square (the view puts its legend there)."""
    kind = k["kind"]
    spec = J["keys"][kind]
    if kind == "pad":
        p = PN["pad"]
        poly = pad_sector(k["dir"], p["rIn"], p["rOut"], p["gap"])
        cap = W.ob_from(W.prism(poly, "y", -0.0018, spec["top"]), "fax_key_" + k["name"])
        W.bevel_finish(cap, width=0.0007, segs=2, angle=30)
        W.assign(cap, "fax_key_start")
        cu, cw = p["center"]
        mid = (p["rIn"] + p["rOut"]) / 2
        ku, kw = cu + mid * k["dir"][0], cw + mid * k["dir"][1]
        half = p["rOut"] * 0.75
        planar_uv(cap, ku - half, kw - half, 2 * half, 2 * half)
        return cap, (ku, kw), spec
    r = spec["r"]
    u, w = k["at"]
    seg = 28 if kind == "num" else 18
    cap = W.ob_from(W.loft(circle(u, w, r, seg), -0.0022, circle(u, w, r * 0.94, seg), spec["top"], axis="y"), "fax_key_" + k["name"])
    W.bevel_finish(cap, width=r * 0.16, segs=2, angle=30)
    W.assign(cap, "fax_key")
    planar_uv(cap, u - r, w - r, 2 * r, 2 * r)
    return cap, (u, w), spec


def build_panel():
    """The operation panel moulding (lilac) with its cream overlay, cut for the keys, the pad's well and the LCD."""
    mould = outer()
    W.boolean(mould, panel_slab(0.0), "INTERSECT")
    ov = PN["overlay"]
    overlay = W.ob_from(W.prism(rr(ov["u"][0], ov["w"][0], ov["u"][1], ov["w"][1], ov["radius"]), "y", -0.0003, ov["thickness"]), "overlay")
    holes = []
    for k in key_list():
        if k["kind"] == "pad":
            continue
        r = J["keys"][k["kind"]]["r"] + 0.0007
        holes.append(W.prism(circle(k["at"][0], k["at"][1], r, 28 if k["kind"] == "num" else 18), "y", -0.0026, 0.01))
    p = PN["pad"]
    holes.append(W.prism(circle(p["center"][0], p["center"][1], p["well"], 48), "y", -0.0021, 0.01))
    lr = PN["lcdRecess"]
    dr = lr["draft"]
    recess = W.loft(rr(lr["u"][0] + dr, lr["w"][0] + dr, lr["u"][1] - dr, lr["w"][1] - dr, 0.0015, 3), -lr["depth"],
                    rr(lr["u"][0], lr["w"][0], lr["u"][1], lr["w"][1], 0.0025, 3), 0.004, axis="y")
    holes.append(recess)
    cut = W.join_bms(holes, "holes")
    cut2 = W.copy_ob(cut, "holes2")
    W.boolean(overlay, cut)
    W.finish(overlay, "fax_panel", None)
    planar_uv(overlay, ov["u"][0], ov["w"][0], ov["u"][1] - ov["u"][0], ov["w"][1] - ov["w"][0])
    in_frame(overlay, MP())
    in_frame(cut2, MP())
    W.boolean(mould, cut2)
    W.finish(mould, "fax_body", 0.0006, 1)
    # The pad: the fixed lower quarter and the hub, in the well (the photograph shows no key there).
    fixed = W.ob_from(W.prism(pad_sector(J["keys"]["padFixed"], p["rIn"], p["rOut"], p["gap"]), "y", -0.0019, 0.0024), "padfix")
    W.bevel_finish(fixed, width=0.0006, segs=2, angle=30)
    W.assign(fixed, "fax_key_start")
    W.box_uv(fixed)
    hub = W.ob_from(W.loft(circle(p["center"][0], p["center"][1], p["hub"], 32), -0.0019, circle(p["center"][0], p["center"][1], p["hub"] * 0.96, 32), 0.0026, axis="y"), "hub")
    W.bevel_finish(hub, width=0.0008, segs=2, angle=30)
    W.assign(hub, "fax_panel")
    planar_uv(hub, ov["u"][0], ov["w"][0], ov["u"][1] - ov["u"][0], ov["w"][1] - ov["w"][0])
    for o in (fixed, hub):
        in_frame(o, MP())
    panel = W.merge([mould, overlay, fixed, hub], "fax_panel")
    return panel


def build_lcd():
    lc = PN["lcd"]
    d = PN["lcdRecess"]["depth"] - 0.0003
    ob = W.ob_from(W.prism(rr(lc["u"][0], lc["w"][0], lc["u"][1], lc["w"][1], 0.0004, 2), "y", -d - 0.0003, -d), "fax_lcd")
    W.smooth(ob)
    W.assign(ob, "fax_lcd")
    planar_uv(ob, lc["u"][0], lc["w"][0], lc["u"][1] - lc["u"][0], lc["w"][1] - lc["w"][0])
    return in_frame(ob, MP())


# ---------- handset, hook, cord ----------

def build_handset():
    """The handset in its own frame (x across, ly up out of its back, lz toward the mouthpiece): a bar with rounded ends,
    its back crowned, and the ear and mouth cups below it."""
    hl, hw = HS["length"] / 2, HS["width"] / 2
    b0, b1 = HS["bar"]
    plan = W.round_poly([(-hw, -hl), (hw, -hl), (hw, hl), (-hw, hl)], [0.020, 0.020, 0.016, 0.016], seg=8)
    bar = W.ob_from(W.prism([(x, z) for x, z in plan], "y", b0, b1), "bar")
    W.bevel_finish(bar, width=0.008, segs=4, angle=30)
    pods = []
    for pod in HS["pods"]:
        a, c = pod["r"][0] / 2, pod["r"][1] / 2
        top = W.ellipse(0, pod["lz"], a, c, 28)
        bot = W.ellipse(0, pod["lz"], a * 0.8, c * 0.8, 28)
        po = W.ob_from(W.loft(bot, b0 - pod["depth"], top, b0 + 0.004, axis="y"), "pod")
        W.bevel_finish(po, width=0.003, segs=3, angle=30)
        pods.append(po)
    W.boolean(bar, pods[0], "UNION")
    W.boolean(bar, pods[1], "UNION")
    # Ear holes and mouth holes: shallow dimples on the cups' faces.
    holes = []
    for pod, n in zip(HS["pods"], (7, 9)):
        for i in range(n):
            ang = 2 * math.pi * i / max(1, n - 1)
            rad = 0 if i == 0 else 0.0045
            holes.append(W.cylinder_bm((rad * math.cos(ang), b0 - pod["depth"], pod["lz"] + rad * math.sin(ang)), "y", 0.0011, 0.003, 8))
    W.boolean(bar, W.join_bms(holes, "h"))
    W.finish(bar, "fax_body", 0.0005, 1)
    bar.name = "fax_handset"
    return bar


def build_hook():
    hk = J["cradle"]["hook"]
    b0 = HS["bar"][0]
    ob = W.ob_from(W.cylinder_bm((0, b0 - 0.0035, hk["lz"]), "y", hk["r"], 0.007, 16), "fax_hook")
    W.bevel_finish(ob, width=0.0008, segs=2, angle=30)
    W.assign(ob, "fax_dark")
    return in_frame(ob, MH())


def catmull(points, per=24):
    pts = [Vector(p) for p in points]
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-2])
    return out


def build_cord():
    """The coiled handset cord, as it lies in the photograph: a helix swept round a path from the handset's mouthpiece end
    down to the desk, round to the left and back up to the jack in the body's left side."""
    c = J["cord"]
    path = catmull(c["points"], 30)
    lens = [0.0]
    for a, b in zip(path, path[1:]):
        lens.append(lens[-1] + (b - a).length)
    total = lens[-1]
    turns = total / c["pitch"]
    per_turn, sides = 7, 5
    n = int(turns * per_turn)
    # Parallel-transport frames along the path.
    def at(s):
        for i in range(len(lens) - 1):
            if lens[i + 1] >= s:
                t = (s - lens[i]) / max(1e-9, lens[i + 1] - lens[i])
                return path[i].lerp(path[i + 1], t), (path[i + 1] - path[i]).normalized()
        return path[-1], (path[-1] - path[-2]).normalized()
    p, t = at(0)
    nrm = t.cross(Vector((0, 1, 0)))
    if nrm.length < 1e-6:
        nrm = t.cross(Vector((1, 0, 0)))
    nrm.normalize()
    helix = []
    prev_t = t
    for i in range(n + 1):
        s = total * i / n
        p, t = at(s)
        axis = prev_t.cross(t)
        if axis.length > 1e-9:
            ang = math.asin(min(1.0, axis.length))
            nrm.rotate(Matrix.Rotation(ang, 3, axis.normalized()))
            nrm = (nrm - t * nrm.dot(t)).normalized()
        prev_t = t
        b = t.cross(nrm)
        ph = 2 * math.pi * i / per_turn
        helix.append(p + (nrm * math.cos(ph) + b * math.sin(ph)) * c["coil"])
    bm = bmesh.new()
    rings = []
    for i, q in enumerate(helix):
        tt = (helix[min(i + 1, len(helix) - 1)] - helix[max(i - 1, 0)]).normalized()
        a = tt.cross(Vector((0, 1, 0)))
        if a.length < 1e-6:
            a = tt.cross(Vector((1, 0, 0)))
        a.normalize()
        bb = tt.cross(a)
        rings.append([bm.verts.new(q + (a * math.cos(2 * math.pi * k / sides) + bb * math.sin(2 * math.pi * k / sides)) * c["wire"]) for k in range(sides)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    ob = W.ob_from(bm, "fax_cord")
    W.finish_small(ob, "fax_body", sharp=80)
    return ob


# ---------- paths, slots, mechanism ----------

def build_doc_slot():
    """Dark linings of the document entry under the panel's rear edge and of its exit under the panel's front lip."""
    d = J["docPath"]
    s = d["slot"]
    w2 = d["slotWidth"] / 2 - 0.0005
    floor = W.ob_from(W.box_bm(XC - w2, s["n"][0] - 0.0008, -0.002, XC + w2, s["n"][0] + 0.0002, s["w"][1] - 0.001), "fax_doc_slot")
    W.finish_small(floor, "fax_dark")
    in_frame(floor, MP())
    ey = d["exit"]["y"]
    ex = W.ob_from(W.box_bm(XC - w2, ey[0] - 0.0008, 0.098, XC + w2, ey[0] + 0.0002, 0.1165), "fax_doc_exit")
    W.finish_small(ex, "fax_dark")
    return floor, ex


def build_print_slot():
    pp = J["printPath"]
    w2 = pp["slotWidth"] / 2 - 0.0005
    y0, y1 = pp["slot"]["y"]
    lin_ = W.ob_from(W.box_bm(XC - w2, y0 - 0.004, 0.104, XC + w2, y1 + 0.004, 0.1158), "fax_print_slot")
    W.boolean(lin_, W.ob_from(W.box_bm(XC - w2 + 0.001, y0, 0.100, XC + w2 - 0.001, y1, 0.12), "o"))
    W.finish_small(lin_, "fax_dark")
    return lin_


def build_mech():
    """What shows through the exit slot: the thermal head over the platen roller and the cutter's fixed blade."""
    pp = J["printPath"]
    h = pp["head"]
    head = W.ob_from(W.box_bm(XC - 0.109, h["y"][0], h["z"] - h["depth"] / 2, XC + 0.109, h["y"][1], h["z"] + h["depth"] / 2), "head")
    W.finish_small(head, "fax_dark")
    blade = W.ob_from(W.box_bm(XC - 0.110, pp["slot"]["y"][0] - 0.0035, 0.1105, XC + 0.110, pp["slot"]["y"][0] - 0.0005, 0.1135), "fixed blade")
    W.finish_small(blade, "fax_dark")
    return W.merge([head, blade], "fax_mech")


def build_platen():
    p = J["printPath"]["platen"]
    ob = W.ob_from(W.cylinder_bm((XC, p["y"], p["z"]), "x", p["r"], p["length"], 24), "fax_platen")
    W.finish_small(ob, "fax_rubber")
    return ob


def build_cutter():
    c = J["printPath"]["cutter"]
    ob = W.ob_from(W.box_bm(XC - 0.110, c["y"][0], c["z"] - 0.0006, XC + 0.110, c["y"][1], c["z"] + 0.0006), "fax_cutter")
    W.finish_small(ob, "fax_dark")
    return ob


def build_roll():
    r = J["roll"]
    cx, cy, cz = r["center"]
    paper = W.ob_from(W.cylinder_bm((cx, cy, cz), "x", r["r"], r["width"], 40), "paper")
    W.boolean(paper, W.ob_from(W.cylinder_bm((cx, cy, cz), "x", r["core"], r["width"] + 0.01, 20), "c"))
    W.finish_small(paper, "fax_paper", sharp=50)
    core = W.ob_from(W.cylinder_bm((cx, cy, cz), "x", r["core"], r["width"] - 0.0004, 20), "core")
    W.boolean(core, W.ob_from(W.cylinder_bm((cx, cy, cz), "x", r["core"] - 0.0012, r["width"] + 0.01, 20), "c"))
    W.finish_small(core, "fax_dark", sharp=50)
    return W.merge([paper, core], "fax_paper_roll")


def build_guides():
    """The two document guides on the table behind the panel: a flat tab with a fence at its outer end. Each slides
    along x; its node sits at the fence's inner face on the table."""
    g = J["guides"]
    p5, p6 = Vector(PROFILE[5]), Vector(PROFILE[6])
    t = (p6 - p5).normalized()                      # up the table, toward the rear (z, y)
    nrm = Vector((t.y, -t.x))
    if nrm.y < 0:
        nrm = -nrm
    base = p5 + t * 0.003 + nrm * 0.0003
    out = []
    for side in (-1, 1):
        fx = XC + side * g["width"] / 2                 # fence inner face
        tab_u, tab_l = g["tab"]
        bms = []

        def plate(x0, x1, along0, along1, h0, h1):
            bm = bmesh.new()
            corners = []
            for a, h in ((along0, h0), (along1, h0), (along1, h1), (along0, h1)):
                q = base + t * a + nrm * h
                corners.append((q.x, q.y))
            prism = W.prism(corners, "x", min(x0, x1), max(x0, x1))
            return prism
        bms.append(plate(fx, fx - side * tab_u, 0.0, tab_l, 0.0, g["thick"]))
        bms.append(plate(fx, fx + side * g["thick"] * 1.6, 0.0, tab_l, 0.0, g["fence"]))
        ob = W.join_bms(bms, f"fax_guide_{'l' if side < 0 else 'r'}")
        W.bevel_finish(ob, width=0.0004, segs=1, angle=30)
        W.assign(ob, "fax_body")
        W.box_uv(ob)
        pivot = (fx, base.y, base.x)
        out.append((ob, pivot, -side))
    return out


def build_latch():
    la = J["latch"]
    x, z = la["at"]
    w, d = la["size"]
    ob = W.ob_from(W.prism(W.rounded_rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0.002, seg=3), "y", 0.1053, 0.1103), "fax_roll_latch")
    W.bevel_finish(ob, width=0.0006, segs=2, angle=30)
    W.assign(ob, "fax_body")
    W.box_uv(ob)
    # Grip ribs across its top.
    return ob


def build_speaker():
    sp = J["speaker"]
    cx, _, cz = sp["at"]
    ob = W.ob_from(W.cylinder_bm((cx, FEET + WALL + 0.004, cz), "y", sp["r"], 0.004, 28), "fax_speaker")
    W.finish_small(ob, "fax_dark")
    return ob


def build_feet():
    bms = [W.cylinder_bm((x, FEET / 2, z), "y", 0.0065, FEET, 14, r2=0.0075) for x in (-0.128, 0.128) for z in (-0.095, 0.095)]
    return W.finish_small(W.join_bms(bms, "fax_feet"), "fax_rubber")


def build_jacks():
    j = J["jacks"]
    objs = []
    for k in ("line", "tel"):
        x, y, z = j[k]
        objs.append(W.finish_small(W.ob_from(W.box_bm(x - 0.0052, y - 0.004, z + 0.002, x + 0.0052, y + 0.004, z + 0.008), "j"), "fax_dark"))
    x, y, z = j["handset"]
    objs.append(W.finish_small(W.ob_from(W.box_bm(x + 0.002, y - 0.003, z - 0.004, x + 0.008, y + 0.003, z + 0.004), "j"), "fax_dark"))
    # The handset cord's plug in its jack, and the mains cord's grommet and stub at the back.
    objs.append(W.finish_small(W.ob_from(W.box_bm(x - 0.0003, y - 0.0028, z - 0.0038, x + 0.006, y + 0.0028, z + 0.0038), "plug"), "fax_body"))
    x, y, z = j["power"]
    g = W.ob_from(W.cylinder_bm((x, y, z + 0.0032), "z", 0.0045, 0.008, 16, r2=0.0032), "grommet")
    objs.append(W.finish_small(g, "fax_dark"))
    return W.merge(objs, "fax_jacks")


def path_node(name, pts, x):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    p0 = Vector((x, pts[0][1], pts[0][0]))
    e.location = W.UNIT_TO_BLENDER @ p0
    rel = [[round(x - p0.x, 5) + 0.0, round(p[1] - p0.y, 5) + 0.0, round(p[0] - p0.z, 5) + 0.0] for p in pts]
    e["path"] = json.dumps(rel)
    return e


def empty_at(name, unit_pos, parent=None, parent_pivot=(0, 0, 0)):
    return W.node(name, unit_pos, parent, parent_pivot)


# ---------- main ----------

def main():
    W.reset()
    body = build_body()
    cover = build_cover()
    panel = build_panel()
    lcd = build_lcd()
    keys = []
    for k in key_list():
        cap, (ku, kw), spec = build_key(k)
        in_frame(cap, MP())
        tag(cap, press=[round(v, 5) for v in PRESS], travel=spec["travel"], legend=k.get("legend", ""), label=k.get("label", ""), kind=k["kind"])
        keys.append((cap, P(ku, kw, spec["top"])))
    handset = build_handset()
    hook = build_hook()
    cord = build_cord()
    doc_slot, doc_exit = build_doc_slot()
    print_slot = build_print_slot()
    mech = build_mech()
    platen = build_platen()
    cutter = build_cutter()
    roll = build_roll()
    guides = build_guides()
    latch = build_latch()
    speaker = build_speaker()
    feet = build_feet()
    jacks = build_jacks()

    statics = [body, mech, feet, jacks, doc_exit, print_slot, cord]
    movers = [cover, panel, lcd, handset, hook, doc_slot, platen, cutter, roll, latch, speaker] + [k[0] for k in keys] + [g[0] for g in guides]
    for o in statics + movers:
        o.data.name = o.name
        W.to_blender(o)

    # Pivots (unit coordinates).
    panel_pivot = tuple(P(U0, 0.0, -PT))                    # the panel's rear lower edge: it lifts at the front
    W.pivot_mesh(panel, panel_pivot)
    tag(panel, hinge=[1, 0, 0], open=-0.35, layout=panel_layout(J))
    for cap, top in keys:
        W.pivot_mesh(cap, tuple(top), panel, panel_pivot)
    lc = PN["lcd"]
    lcd_c = P((lc["u"][0] + lc["u"][1]) / 2, (lc["w"][0] + lc["w"][1]) / 2, -PN["lcdRecess"]["depth"] + 0.0003)
    W.pivot_mesh(lcd, tuple(lcd_c), panel, panel_pivot)
    tag(lcd, size=[round(lc["u"][1] - lc["u"][0], 5), round(lc["w"][1] - lc["w"][0], 5)], normal=[0, round(math.cos(PS), 5), round(math.sin(PS), 5)], chars=16)
    W.pivot_mesh(doc_slot, tuple(P(XC, 0.0, J["docPath"]["slot"]["n"][0])))
    c = J["cover"]
    W.pivot_mesh(cover, (0.0, c["hinge"][1], c["hinge"][0]))
    tag(cover, hinge=[1, 0, 0], open=c["open"])
    la = J["latch"]
    W.pivot_mesh(latch, (la["at"][0], 0.1103, la["at"][1]))
    tag(latch, press=[0, -1, 0], travel=la["travel"])
    # The handset: its node at its centre, turned to the cradle's slope.
    handset.location = W.UNIT_TO_BLENDER @ HC
    handset.rotation_euler = (HA, 0, 0)
    tag(handset, rest=[round(v, 5) for v in HC], slope=round(HA, 5))
    hk = J["cradle"]["hook"]
    hook_top = MH() @ Vector((0, HS["bar"][0], hk["lz"]))
    W.pivot_mesh(hook, tuple(hook_top))
    tag(hook, press=[0, round(-math.cos(HA), 5), round(-math.sin(HA), 5)], travel=hk["travel"])
    pl = J["printPath"]["platen"]
    W.pivot_mesh(platen, (XC, pl["y"], pl["z"]))
    tag(platen, axis=[1, 0, 0], radius=pl["r"])
    cu = J["printPath"]["cutter"]
    W.pivot_mesh(cutter, (XC, cu["y"][1], cu["z"]))
    tag(cutter, press=[0, -1, 0], travel=cu["travel"])
    r = J["roll"]
    W.pivot_mesh(roll, tuple((r["center"][0], r["center"][1], r["center"][2])))
    tag(roll, axis=[1, 0, 0], radius=r["r"], core=r["core"], width=r["width"])
    sp = J["speaker"]
    W.pivot_mesh(speaker, (sp["at"][0], FEET + WALL + 0.004, sp["at"][2]))
    g = J["guides"]
    for ob, pivot, inward in guides:
        W.pivot_mesh(ob, pivot)
        tag(ob, slide=[inward, 0, 0], travel=round((g["width"] - J["docPath"]["minWidth"]) / 2, 5))
    path_node("fax_doc_path", J["docPath"]["path"], XC)
    path_node("fax_print_path", J["printPath"]["path"], XC)
    # Cord ends, for a cord drawn at run time: the socket under the handset's mouthpiece end and the body's jack.
    hs_end = bpy.data.objects.new("fax_cord_handset", None)
    bpy.context.collection.objects.link(hs_end)
    hs_end.parent = handset
    hs_end.location = Vector((0.0, -0.080, HS["bar"][0]))   # handset frame in Blender axes: (x, -lz, ly)
    empty_at("fax_cord_jack", tuple(J["jacks"]["handset"]))
    W.report(statics + movers)
    W.export(OUT, extras=True)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
