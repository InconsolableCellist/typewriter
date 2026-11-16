"""Review of the Sharp FO-70 model (docs/fax/models.md, Review): renders fax_fo70.glb from the owner's photograph's
viewpoint and others, and puts the photograph and the render side by side.

  python3 tools/blender/compare_fax_fo70.py [--views top,three,side,rear,open,front] [--samples 32] [--dist 0.45]

Runs in two halves. Under python3 (PIL) it draws the panel's print, the key faces and the LCD as the view does at run
time (src/render/fax/fo70-view.js) into PNGs, then runs itself under Blender's Python (/root/bpyenv/bin/python, one
Blender at a time) to render with those images on the panel, and finally composes
tools/blender/previews/fax/compare_top.png: the photograph, the render from its camera, and the two blended half and
half. The camera: the photograph sees the panel square on (its round keys are round, the pad's hole too), so it sits on
the panel's normal through the panel point at the image's centre, at --dist metres, with the focal length that gives the
panel the photograph's 0.925 px/mm.
"""
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
GLB = os.path.join(ROOT, "public", "assets", "models", "fax_fo70.glb")
PHOTO = os.path.join(ROOT, "docs", "fax", "refs", "owner", "sharp_fo70_top.png")
OUT = os.path.join(HERE, "previews", "fax")
ART = os.path.join(OUT, "art")
J = json.load(open(os.path.join(HERE, "fax_fo70.json")))
sys.path.insert(0, HERE)
from fax_fo70_layout import panel_layout  # noqa: E402
PX_PER_M = 925.0          # the photograph's scale in the panel's plane (474 px image)
CENTRE_UW = (-0.0239, 0.0605)   # the panel point at the photograph's centre


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = {"views": "top,three,side,rear,open", "samples": 32, "dist": 0.45, "render": False}
    i = 0
    while i < len(a):
        if a[i] == "--render":
            out["render"] = True; i += 1
        else:
            out[a[i][2:]] = a[i + 1]; i += 2
    out["samples"] = int(out["samples"]); out["dist"] = float(out["dist"])
    return out


# ---------------------------------------------------------------- artwork (python3, PIL)

def draw_art():
    from PIL import Image, ImageDraw, ImageFont
    os.makedirs(ART, exist_ok=True)
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    S = 8000.0                                    # px per metre
    pn = J["panel"]
    ov = pn["overlay"]
    u0, u1, w0, w1 = ov["u"][0], ov["u"][1], ov["w"][0], ov["w"][1]
    W_, H_ = round((u1 - u0) * S), round((w1 - w0) * S)
    im = Image.new("RGB", (W_, H_), "#dbd8c6")
    d = ImageDraw.Draw(im)
    X = lambda u: (u - u0) * S
    Y = lambda w: (w - w0) * S
    # The light grey window round the LCD and the rapid keys, its key band under a shallow curve.
    win = pn["window"]
    d.rounded_rectangle([X(win["u"][0]), Y(win["w"][0]), X(win["u"][1]), Y(win["w"][1])], radius=0.002 * S, fill="#dadcda")
    pts = []
    for i in range(41):
        t = i / 40
        u = win["u"][0] + (win["u"][1] - win["u"][0]) * t
        pts.append((X(u), Y(win["curveTop"] + win["curveSag"] * (1 - (2 * t - 1) ** 2))))
    d.polygon(pts + [(X(win["u"][1]), Y(win["w"][1]) - 0.002 * S), (X(win["u"][0]), Y(win["w"][1]) - 0.002 * S)], fill="#cfd2d1")
    d.line(pts, fill="#b9bcbc", width=3)
    # The pad's bezel disc.
    p = pn["pad"]
    cu, cw = p["center"]
    r = p["bezel"]
    d.ellipse([X(cu - r), Y(cw - r), X(cu + r), Y(cw + r)], fill="#e3dbc1", outline="#cbc2a6", width=3)
    lay = panel_layout(J)
    ink = lay["ink"]

    def text(s, u, w, size, anchor="mm"):
        f = ImageFont.truetype(bold, max(6, round(size * S * 1.35)))
        lines = s.split("\n")
        lh = size * S * 1.25
        for k, ln in enumerate(lines):
            d.text((X(u), Y(w) + (k - (len(lines) - 1) / 2) * lh), ln, font=f, fill=ink, anchor=anchor)
    for lb in lay["labels"]:
        text(lb["text"], lb["at"][0], lb["at"][1], lb["size"])
    lg = pn["logo"]
    f = ImageFont.truetype(bold, round(lg["height"] * S * 1.38))
    tw = d.textlength("SHARP", font=f)
    logo = Image.new("L", (round(tw) + 8, round(lg["height"] * S * 2)), 0)
    ImageDraw.Draw(logo).text((4, logo.height / 2), "SHARP", font=f, fill=255, anchor="lm")
    logo = logo.resize((round(lg["width"] * S), logo.height))
    im.paste("#2c2c34", (round(X(lg["center"][0]) - logo.width / 2), round(Y(lg["center"][1]) - logo.height / 2)), logo)
    im.save(os.path.join(ART, "panel.png"))
    # Key faces: 128 px over the key's square (the pad keys over 1.5 x their outer radius).
    for k in J["keys"]["list"]:
        kind = k["kind"]
        col = {"num": "#8f9199", "small": "#a3a4ab", "rapid": "#a3a4ab", "pad": "#d8cba6"}[kind]
        im = Image.new("RGB", (128, 128), col)
        g = ImageDraw.Draw(im)
        if kind == "num":
            f = ImageFont.truetype(bold, 62)
            g.text((64, 66), k["legend"], font=f, fill="#c6c7cc", anchor="mm")
        elif kind == "pad":
            dx, dy = k["dir"]
            cx, cy = 64 + dx * 22, 64 + dy * 22
            s = 13
            if k["name"] == "start":
                g.polygon([(cx - s, cy), (cx, cy - s), (cx + s, cy), (cx, cy + s)], outline="#a99b74", width=4)
            elif k["name"] == "stop":
                g.ellipse([cx - s, cy - s, cx + s, cy + s], outline="#a99b74", width=4)
            else:
                g.rectangle([cx - s * 0.8, cy - s, cx + s * 0.8, cy + s], outline="#a99b74", width=4)
        im.save(os.path.join(ART, f"key_{k['name']}.png"))
    lc = pn["lcd"]
    im = Image.new("RGB", (round((lc["u"][1] - lc["u"][0]) * S), round((lc["w"][1] - lc["w"][0]) * S)), "#c3cabd")
    g = ImageDraw.Draw(im)
    f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 52)
    g.text((im.width / 2, im.height / 2), "FAX     01-01 12:00", font=f, fill="#2c3330", anchor="mm")
    im.save(os.path.join(ART, "lcd.png"))


def compose(dist):
    from PIL import Image, ImageDraw
    photo = Image.open(PHOTO).convert("RGB")
    rend = Image.open(os.path.join(OUT, "fo70_top.png")).convert("RGB").resize(photo.size)
    blend = Image.blend(photo, rend, 0.5)
    k = 2
    W_, H_ = photo.width * k, photo.height * k
    out = Image.new("RGB", (W_ * 3 + 20, H_ + 28), "white")
    for i, im in enumerate((photo, rend, blend)):
        out.paste(im.resize((W_, H_), Image.LANCZOS), (i * (W_ + 10), 28))
    g = ImageDraw.Draw(out)
    for i, t in enumerate(("owner's photograph", f"fax_fo70.glb, camera on the panel's normal at {dist} m", "50 % blend")):
        g.text((i * (W_ + 10) + 6, 8), t, fill="black")
    path = os.path.join(OUT, "compare_top.png")
    out.save(path)
    # The machine alone, larger.
    box = (100, 125, 420, 335)
    crop = Image.new("RGB", ((box[2] - box[0]) * 3 * 2 + 20, (box[3] - box[1]) * 3 + 28), "white")
    for i, im in enumerate((photo, rend)):
        crop.paste(im.crop(box).resize(((box[2] - box[0]) * 3, (box[3] - box[1]) * 3), Image.LANCZOS), (i * ((box[2] - box[0]) * 3 + 20), 28))
    ImageDraw.Draw(crop).text((6, 8), "photograph | model (same camera)", fill="black")
    crop.save(os.path.join(OUT, "compare_top_close.png"))
    print("wrote", path)


# ---------------------------------------------------------------- render (Blender)

def unit(v):
    from mathutils import Vector
    return Vector((v[0], -v[2], v[1]))


def render(a):
    import bpy
    from mathutils import Vector
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=GLB)
    obs = {o.name: o for o in s.objects}

    def image_mat(name, path, rough=0.5):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(path)
        tex.extension = "EXTEND"
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = rough
        return m
    panel_mat = image_mat("panel_art", os.path.join(ART, "panel.png"), 0.5)
    for o in s.objects:
        if o.type != "MESH":
            continue
        for i, slot in enumerate(o.material_slots):
            if slot.material and slot.material.name.startswith("fax_panel"):
                o.material_slots[i].material = panel_mat
        base = o.name[:-5] if o.name.endswith("_mesh") else o.name
        if base.startswith("fax_key_"):
            o.material_slots[0].material = image_mat(base, os.path.join(ART, f"key_{base[8:]}.png"), 0.42)
        if base == "fax_lcd":
            o.material_slots[0].material = image_mat("lcd", os.path.join(ART, "lcd.png"), 0.2)
    # Desk, world and light: an overcast day, as in the photograph.
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
    dm = bpy.data.materials.new("desk")
    dm.use_nodes = True
    dm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.18, 0.17, 0.16, 1)
    bpy.context.active_object.data.materials.append(dm)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.87, 0.9, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.45
    s.world = w
    ld = bpy.data.lights.new("l", "AREA")
    ld.energy, ld.size = 22, 2.0
    lo = bpy.data.objects.new("l", ld)
    s.collection.objects.link(lo)
    lo.location = unit((-0.5, 1.4, 0.6))
    lo.rotation_euler = (Vector((0, 0, 0.05)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = a["samples"]
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 4
    s.view_settings.view_transform = "Standard"
    cam = bpy.data.cameras.new("c")
    co = bpy.data.objects.new("c", cam)
    s.collection.objects.link(co)
    s.camera = co
    ps = math.radians(J["panel"]["slope_deg"])
    zr, yr = J["panel"]["rear"]

    def P(u, w, n=0.0):
        return (u, yr + n * math.cos(ps) - w * math.sin(ps), zr + n * math.sin(ps) + w * math.cos(ps))
    cover = obs.get("fax_roll_cover")
    handset = obs.get("fax_handset")
    guides = [obs.get("fax_guide_l"), obs.get("fax_guide_r")]
    views = {
        # name: (camera position, target, lens mm or None for the photograph's camera, resolution, pose)
        "top": None,
        "three": ((-0.55, 0.42, 0.62), (0.0, 0.055, 0.0), 45, (720, 540), ""),
        "front": ((0.0, 0.10, 0.9), (0.0, 0.055, 0.0), 60, (720, 400), ""),
        "side": ((0.9, 0.07, 0.0), (0.0, 0.06, 0.0), 60, (720, 400), ""),
        "rear": ((0.45, 0.45, -0.65), (0.0, 0.05, 0.0), 45, (720, 540), ""),
        "open": ((-0.45, 0.55, 0.55), (0.0, 0.06, -0.02), 45, (720, 540), "open"),
    }
    os.makedirs(OUT, exist_ok=True)
    rest = {}
    for o in [cover, handset] + guides:
        if o:
            rest[o.name] = (o.location.copy(), o.rotation_quaternion.copy() if o.rotation_mode == "QUATERNION" else None, o.rotation_euler.copy())
    for v in a["views"].split(","):
        for o in [cover, handset] + guides:
            if o:
                loc, q, e = rest[o.name]
                o.location = loc
                if q is not None:
                    o.rotation_quaternion = q
                o.rotation_euler = e
        if v == "top":
            D = a["dist"]
            n = (0, math.cos(ps), math.sin(ps))
            c = P(*CENTRE_UW)
            pos = tuple(c[i] + D * n[i] for i in range(3))
            co.location = unit(pos)
            co.rotation_euler = (unit(c) - co.location).to_track_quat("-Z", "Y").to_euler()
            cam.sensor_fit = "HORIZONTAL"
            cam.sensor_width = 36
            cam.lens = PX_PER_M * D * 36 / 474
            s.render.resolution_x = s.render.resolution_y = 474
        else:
            pos, tgt, lens, res, pose = views[v]
            if pose == "open" and cover:
                cover.rotation_mode = "XYZ"
                cover.rotation_euler.x += J["cover"]["open"]          # unit x is Blender x
                if handset:
                    handset.location.z += 0.12
            cam.sensor_fit = "AUTO"
            cam.lens = lens
            co.location = unit(pos)
            co.rotation_euler = (unit(tgt) - co.location).to_track_quat("-Z", "Y").to_euler()
            s.render.resolution_x, s.render.resolution_y = res
        s.render.filepath = os.path.join(OUT, f"fo70_{v}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", s.render.filepath)


def main():
    a = args()
    if a["render"]:
        render(a)
        return
    draw_art()
    cmd = ["/root/bpyenv/bin/python", os.path.abspath(__file__), "--", "--render", "--views", a["views"], "--samples", str(a["samples"]), "--dist", str(a["dist"])]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    if "top" in a["views"].split(","):
        compose(a["dist"])


if __name__ == "__main__":
    main()
