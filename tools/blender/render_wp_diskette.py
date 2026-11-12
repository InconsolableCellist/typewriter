"""Renders wp_diskette.glb from the reference photographs' viewpoints, for the review in docs/displaywriter/models.md.

  /root/bpyenv/bin/python tools/blender/render_wp_diskette.py -- [view ...] [--glb PATH] [--tag NAME]

Views: front, sp, desk, deskfront, levers (the owner's photographs, docs/displaywriter/refs/owner/), bro18, gim25,
rear, lever, file. Writes tools/blender/previews/wp_diskette_<view>[_<tag>].png (gitignored); --glb renders another
GLB (an earlier build, for before/after pairs). In the photographs' views the slots are empty, the left lever closed and
the right one open, as the owner's unit stands; deskfront adds the display station (wp_station.glb, wp_display.glb)
where the desk layout puts it. The other views place one diskette half way into the right drive with its lever open
and the others in their envelopes in the file. Cycles on the CPU at small samples; colours stand in for the run-time
materials and labels.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "public", "assets", "models")
GLB = os.path.join(MODELS, "wp_diskette.glb")
OUT = os.path.join(HERE, "previews")
STATION_DX = -(0.483 / 2 + 0.04 + 0.254 / 2)     # the station's centre from the unit's (src/machine/wp-geometry.js)

COLOURS = {   # linear RGB, roughness
    "wp_pearl": ((0.66, 0.63, 0.55), 0.55), "wp_gray": ((0.45, 0.44, 0.40), 0.6), "wp_dark": ((0.022, 0.022, 0.021), 0.45),
    "wp_rubber": ((0.015, 0.015, 0.015), 0.9), "wp_metal": ((0.62, 0.62, 0.6), 0.3), "wp_label": ((0.62, 0.62, 0.6), 0.35),
    "wp_jacket": ((0.012, 0.012, 0.012), 0.4), "wp_media": ((0.09, 0.05, 0.028), 0.3), "wp_disk_label": ((0.75, 0.72, 0.62), 0.7),
    "wp_envelope": ((0.8, 0.79, 0.74), 0.85), "wp_drive_label": ((0.30, 0.30, 0.29), 0.5),
}


def m2b(v):
    """Machine (y up, z toward the operator) to Blender (z up, -y toward the operator)."""
    return Vector((v[0], -v[2], v[1]))


def colour_materials():
    for mat in bpy.data.materials:
        c = COLOURS.get(mat.name)
        if c and mat.node_tree and mat.node_tree.nodes.get("Principled BSDF"):
            b = mat.node_tree.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = (*c[0], 1)
            b.inputs["Roughness"].default_value = c[1]


def add_station():
    """The module and the display beside the unit, as the desk layout places them (same z, the gap between)."""
    holder = bpy.data.objects.new("station", None)
    bpy.context.collection.objects.link(holder)
    holder.location = m2b((STATION_DX, 0, 0))
    for f, at in (("wp_station.glb", (0, 0, 0)), ("wp_display.glb", (0, 0.178, -0.004))):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f))
        sub = bpy.data.objects.new(f, None)
        bpy.context.collection.objects.link(sub)
        sub.parent = holder
        sub.location = m2b(at)
        for o in set(bpy.data.objects) - before:
            if o.parent is None and o is not sub:
                o.parent = sub


def setup(glb, photo=False, station=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    ob = bpy.data.objects
    if station:
        add_station()
    colour_materials()
    lever0 = ob["wp_diskette_lever0"]
    lever0.rotation_mode = "XYZ"
    lever0.rotation_euler = (0, math.pi / 2, 0)      # closed: -90 degrees about machine z, which is -y in Blender
    if photo:
        # The owner's unit: slots empty, the left lever closed, the right one open; no file on the desk.
        for name in ("wp_diskette_file", "wp_diskette_jacket", "wp_diskette_envelope"):
            for o in [ob[name]] + list(ob[name].children_recursive):
                o.hide_render = True
        return
    # The templates: a diskette half into drive 1 (lever open), copies in envelopes in the file at the unit's right.
    file_ = ob["wp_diskette_file"]
    file_.location = m2b((0.27, 0, 0.08))
    jacket = ob["wp_diskette_jacket"]
    env = ob["wp_diskette_envelope"]
    slot = ob["wp_diskette_slot1"].location
    # Card frame to slot: card x -> -y, card y -> +z (the label edge last, head window first), card z -> -x (machine).
    basis = Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0))).to_4x4()          # columns: card x, y, z in machine axes
    to_b = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))).to_4x4()
    from_b = to_b.inverted()
    jacket.matrix_world = Matrix.Translation(slot + m2b((0, 0, 0.1016 - 0.09))) @ to_b @ basis @ from_b
    bpy.context.view_layer.update()
    places = sorted([o for o in ob if o.name.startswith("wp_diskette_place")], key=lambda o: o.name)
    for k, pl in enumerate(places[:4]):
        e = env.copy()
        bpy.context.collection.objects.link(e)
        e.matrix_world = pl.matrix_world.copy()
        j = jacket.copy()
        bpy.context.collection.objects.link(j)
        for ch in jacket.children:
            c2 = ch.copy()
            bpy.context.collection.objects.link(c2)
            c2.parent = j
        j.matrix_world = pl.matrix_world @ Matrix.Translation(m2b((0, 0.122, 0)))
    env.hide_render = True


def scene():
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 40
    s.cycles.use_denoising = True
    s.view_settings.exposure = -0.8
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.4
    s.world = w
    # A grey studio floor and a big soft key from above front, as the product photographs.
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    floor = bpy.context.object
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.45, 0.45, 1)
    floor.data.materials.append(fm)
    light = bpy.data.lights.new("key", "AREA")
    light.energy = 90
    light.size = 1.2
    lo = bpy.data.objects.new("key", light)
    s.collection.objects.link(lo)
    lo.location = (0.4, -1.2, 1.4)
    lo.rotation_euler = (Vector((0, 0, 0.15)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    cam = bpy.data.cameras.new("c")
    co = bpy.data.objects.new("c", cam)
    s.collection.objects.link(co)
    s.camera = co
    return s, cam, co


VIEWS = {   # camera position and target in machine coordinates (unit frame), focal length, resolution
    # The owner's photographs (models.md, Diskette unit). front: diskette_front.jpg, whose width is stretched about 9 %
    # (compare_wp_diskette.py narrows it back); sp: desk_front_scott_peterson.jpg; desk: desk_station_keyboard_diskette.jpg.
    "front": ((0.0, 0.36, 1.20), (0.0, 0.150, 0.0), 105, (560, 600)),
    "sp": ((-0.28, 0.46, 2.0), (0.0, 0.150, 0.0), 130, (560, 560)),
    "desk": ((0.30, 0.52, 0.62), (-0.02, 0.12, 0.19), 42, (480, 860)),
    "deskfront": ((-0.30, 0.46, 2.3), (-0.33, 0.20, 0.0), 50, (820, 460)),
    "levers": ((0.0, 0.13, 0.60), (0.0, 0.090, 0.19), 70, (640, 400)),
    "bro18": ((0.0, 0.48, 1.45), (0.0, 0.15, 0.0), 120, (640, 640)),
    "gim25": ((-0.62, 0.78, 1.15), (0.0, 0.13, 0.0), 85, (640, 640)),
    "rear": ((-0.45, 0.55, -0.85), (0.0, 0.12, 0.0), 70, (640, 640)),
    "lever": ((-0.16, 0.19, 0.48), (-0.045, 0.09, 0.19), 85, (640, 640)),
    "file": ((0.55, 0.50, 0.75), (0.15, 0.12, 0.05), 50, (640, 640)),
}
PHOTO_VIEWS = {"front", "sp", "desk", "deskfront", "levers"}


def main():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    glb, tag, views = GLB, "", []
    i = 0
    while i < len(args):
        if args[i] == "--glb":
            glb = args[i + 1]; i += 2
        elif args[i] == "--tag":
            tag = "_" + args[i + 1]; i += 2
        else:
            views.append(args[i]); i += 1
    views = views or list(VIEWS)
    os.makedirs(OUT, exist_ok=True)
    # One scene per kind: the photographs' views show the owner's unit alone (deskfront with the station beside it).
    kinds = {"studio": [v for v in views if v not in PHOTO_VIEWS],
             "photo": [v for v in views if v in PHOTO_VIEWS and v != "deskfront"],
             "station": [v for v in views if v == "deskfront"]}
    for kind, group in kinds.items():
        if not group:
            continue
        setup(glb, photo=kind != "studio", station=kind == "station")
        s, cam, co = scene()
        for v in group:
            pos, tgt, lens, res = VIEWS[v]
            s.render.resolution_x, s.render.resolution_y = res
            cam.lens = lens
            co.location = m2b(pos)
            co.rotation_euler = (m2b(tgt) - co.location).to_track_quat("-Z", "Y").to_euler()
            s.render.filepath = os.path.join(OUT, f"wp_diskette_{v}{tag}.png")
            bpy.ops.render.render(write_still=True)
            print("wrote", s.render.filepath)


if __name__ == "__main__":
    main()
