"""Renders any GLB from two sides on a neutral background and prints its mesh statistics. Used to judge
TRELLIS.2 results. ~/bin/blender --background --python tools/blender/render_glb.py -- in.glb out_prefix"""
import os
import sys

import bpy
from mathutils import Vector

src, prefix = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
lo = Vector((min(p[i] for p in pts) for i in range(3)))
hi = Vector((max(p[i] for p in pts) for i in range(3)))
c, r = (lo + hi) / 2, (hi - lo).length / 2
tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
print(f"STATS {os.path.basename(src)}: {len(meshes)} meshes, {tris} tris, size {tuple(round(v, 3) for v in hi - lo)}, "
      f"materials {[m.name for o in meshes for m in o.data.materials][:4]}")
s = bpy.context.scene
s.render.engine = "CYCLES"
s.cycles.samples = 48
s.cycles.use_denoising = True
s.render.resolution_x = s.render.resolution_y = 800
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.52, 1)
s.world = w
cam = bpy.data.cameras.new("c")
cam.lens = 70
ob = bpy.data.objects.new("c", cam)
s.collection.objects.link(ob)
s.camera = ob
for tag, d in (("front", Vector((0.7, -1.4, 0.7))), ("back", Vector((-0.8, 1.3, 0.5)))):
    ob.location = c + d.normalized() * r * 4.2
    ob.rotation_euler = (c - ob.location).to_track_quat("-Z", "Y").to_euler()
    s.render.filepath = os.path.abspath(f"{prefix}_{tag}.png")
    bpy.ops.render.render(write_still=True)
