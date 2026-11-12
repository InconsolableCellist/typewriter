"""Renders wp_printer.glb from the reference photographs' viewpoints (Cycles, CPU) to tools/blender/previews/, for the
side-by-side review of docs/displaywriter/models.md.

  /root/bpyenv/bin/python tools/blender/render_wp_printer.py [--views front,open,...] [--samples N] [--size N]

Views: front (PH 5218_1), open (PH 5218_2, cover raised, no feeder), feeder (brochure p.18, sheet-feed paper handler),
rear (PH 5218_3), carrier (PH 5218_4, close over the carrier), three (a three-quarter view).
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
GLB = os.path.join(ROOT, "public", "assets", "models", "wp_printer.glb")
OUT = os.path.join(HERE, "previews")

# camera position and target in machine coordinates (x right, y up, z to the operator), lens mm, cover angle, feeder
VIEWS = {
    "front": ((0.0, 0.62, 2.5), (0.0, 0.10, 0.0), 85, 0, False),
    "open": ((0.0, 1.05, 0.80), (0.0, 0.08, -0.03), 40, 75, False),
    "feeder": ((0.0, 0.45, 3.0), (0.0, 0.25, 0.0), 85, 0, True),
    "rear": ((-0.32, 0.22, -0.80), (-0.27, 0.10, -0.32), 50, 0, False),
    "carrier": ((0.0, 0.60, 0.42), (0.0, 0.10, 0.13), 40, 75, False),
    "three": ((1.1, 0.85, 1.3), (0.0, 0.17, -0.02), 55, 0, True),
}


def b(p):
    return Vector((p[0], -p[2], p[1]))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--views", default=",".join(VIEWS))
    ap.add_argument("--samples", type=int, default=24)
    ap.add_argument("--size", type=int, default=720)
    a = ap.parse_args(argv)
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = a.samples
    s.cycles.use_denoising = True
    s.render.resolution_x = a.size
    s.render.resolution_y = int(a.size * 0.62)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.55, 0.56, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    s.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.angle = 0.3
    sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))
    s.collection.objects.link(sun)
    floor = bpy.data.meshes.new("floor")
    floor.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new("floor", floor)
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.25, 0.18, 1)
    floor.materials.append(fm)
    s.collection.objects.link(fo)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    s.collection.objects.link(cam)
    s.camera = cam
    cover = bpy.data.objects.get("printer_cover")
    feeder = bpy.data.objects.get("printer_feeder")
    for name in a.views.split(","):
        pos, tgt, lens, open_deg, show_feeder = VIEWS[name]
        cam.data.lens = lens
        cam.location = b(pos)
        cam.rotation_euler = (b(tgt) - b(pos)).to_track_quat("-Z", "Y").to_euler()
        if cover:
            cover.rotation_mode = "XYZ"
            cover.rotation_euler = (-math.radians(open_deg), 0, 0)
        if feeder:
            feeder.hide_render = not show_feeder
        s.render.filepath = os.path.join(OUT, f"printer_{name}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", s.render.filepath)


if __name__ == "__main__":
    main()
