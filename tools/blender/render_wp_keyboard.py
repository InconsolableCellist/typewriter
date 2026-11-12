"""Renders the word processor's keyboard from the reference photographs' and drawings' viewpoints (Cycles, CPU) into
tools/blender/previews/wp_keyboard/, for the side-by-side review that docs/displaywriter/models.md asks for.

  /root/bpyenv/bin/python tools/blender/render_wp_keyboard.py [in.glb] [--views a,b] [--samples N] [--size N]

in.glb defaults to the case alone (public/assets/models/wp_keyboard.glb). For the whole keyboard, caps and legends
included, export the live unit from the browser first (window.__tw.units.keyboard through GLTFExporter), since the caps
and their atlas are built at run time from src/machine/wp-keys.js.

Views (unit frame, metres; the photographs' cameras estimated from what they show):
  kbd2      keyboard/KBD_2.JPG: from in front and well above, a short lens, the whole key field filling the frame
  brochure  brochure p.18: a product shot from the front, about 26 degrees above the desk, a long lens
  plan      GIM p.22 and PSM p.34: square onto the key deck (orthographic)
  csg       Customer Setup Guide p.18 (step 1D): from the front left and above
  side      the right end, square on (orthographic): the wedge, the nose and the undercut front
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "previews", "wp_keyboard")
SLOPE = math.radians(12)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("glb", nargs="?", default=os.path.join(ROOT, "public", "assets", "models", "wp_keyboard.glb"))
ap.add_argument("--views", default="kbd2,brochure,plan,csg,side")
ap.add_argument("--samples", type=int, default=24)
ap.add_argument("--size", type=int, default=900)
ap.add_argument("--tag", default="")
args = ap.parse_args(argv)


def b(p):
    """unit frame (x right, y up, z toward the typist) to Blender (z up)"""
    return Vector((p[0], -p[2], p[1]))


# (position, target, lens mm or None for orthographic, ortho scale, aspect w/h)
VIEWS = {
    "kbd2": ((0.0, 0.40, 0.29), (0.0, 0.065, 0.0), 30, None, 3.27),
    "brochure": ((0.0, 0.70, 1.38), (0.0, 0.045, 0.0), 105, None, 2.6),
    "plan": ((0.0, 0.07 + 0.6 * math.cos(SLOPE), 0.6 * math.sin(SLOPE)), (0.0, 0.07, 0.0), None, 0.56, 2.6),
    "csg": ((-0.42, 0.42, 0.55), (0.0, 0.05, 0.0), 45, None, 1.5),
    "side": ((0.8, 0.05, 0.0), (0.0, 0.05, 0.0), None, 0.26, 1.6),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
s = bpy.context.scene
s.render.engine = "CYCLES"
s.cycles.device = "CPU"
s.cycles.samples = args.samples
s.cycles.use_denoising = True
s.cycles.max_bounces = 6
s.view_settings.view_transform = "AgX"
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.62, 0.64, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.55
s.world = w
# A desk to stand on, and a soft key light from the upper left front, as in a studio product shot.
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
desk = bpy.context.active_object
dm = bpy.data.materials.new("desk")
dm.use_nodes = True
dm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
dm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
desk.data.materials.append(dm)
light = bpy.data.lights.new("key", "AREA")
light.energy = 120
light.size = 1.2
lo = bpy.data.objects.new("key", light)
s.collection.objects.link(lo)
lo.location = b((-0.6, 1.1, 0.9))
lo.rotation_euler = (b((0, 0.05, 0)) - lo.location).to_track_quat("-Z", "Y").to_euler()
cam = bpy.data.cameras.new("c")
co = bpy.data.objects.new("c", cam)
s.collection.objects.link(co)
s.camera = co
os.makedirs(OUT, exist_ok=True)
for name in args.views.split(","):
    pos, tgt, lens, ortho, aspect = VIEWS[name]
    co.location = b(pos)
    co.rotation_euler = (b(tgt) - co.location).to_track_quat("-Z", "Y").to_euler()
    if lens:
        cam.type = "PERSP"
        cam.lens = lens
        cam.sensor_width = 36
    else:
        cam.type = "ORTHO"
        cam.ortho_scale = ortho
    s.render.resolution_x = args.size
    s.render.resolution_y = int(args.size / aspect)
    s.render.filepath = os.path.join(OUT, f"cycles_{name}{args.tag}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", s.render.filepath)
