"""Renders previews of frame.glb headlessly (Cycles CPU) to tools/blender/previews/.

  ~/bin/blender --background --python tools/blender/render_previews.py -- [--fit] [--samples N] [--size N] [--views a,b]

--fit adds grey proxies of the moving parts (keys, typebars at rest, platen, spools) from machine.json.
Textures from public/assets/textures/ are applied if present.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
GLB = os.path.join(ROOT, "public", "assets", "models", "frame.glb")
TEX = os.path.join(ROOT, "public", "assets", "textures")
OUT = os.path.join(HERE, "previews")
M = json.load(open(os.path.join(HERE, "machine.json")))
MACHINE, GEO = M["machine"], M["geometry"]


def b(p):
    """machine coordinates to Blender coordinates"""
    return Vector((p[0], -p[2], p[1]))


def tex_node(tree, name, non_color=False):
    path = os.path.join(TEX, name)
    if not os.path.exists(path):
        return None
    n = tree.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(path, check_existing=True)
    if non_color:
        n.image.colorspace_settings.name = "Non-Color"
    return n


def apply_tex(mat, prefix, uv_scale):
    if mat is None:
        return
    mat.use_nodes = True
    t = mat.node_tree
    bsdf = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
    albedo = tex_node(t, prefix + "_albedo.jpg")
    if albedo is None:
        return
    mp = t.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (uv_scale, uv_scale, 1)
    tc = t.nodes.new("ShaderNodeTexCoord")
    t.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    t.links.new(mp.outputs[0], albedo.inputs[0])
    t.links.new(albedo.outputs[0], bsdf.inputs["Base Color"])
    rough = tex_node(t, prefix + "_roughness.jpg", True)
    if rough:
        t.links.new(mp.outputs[0], rough.inputs[0])
        t.links.new(rough.outputs[0], bsdf.inputs["Roughness"])
    nrm = tex_node(t, prefix + "_normal.jpg", True)
    if nrm:
        t.links.new(mp.outputs[0], nrm.inputs[0])
        nm = t.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.4
        t.links.new(nrm.outputs[0], nm.inputs["Color"])
        t.links.new(nm.outputs[0], bsdf.inputs["Normal"])


def cyl(p0, p1, r, mat, segs=10):
    p0, p1 = b(p0), b(p1)
    d = p1 - p0
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=r, depth=d.length, location=(p0 + p1) / 2)
    o = bpy.context.active_object
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    o.data.materials.append(mat)
    return o


def proxies():
    mat = bpy.data.materials.new("proxy")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.55, 0.5, 0.42, 1)
    bsdf.inputs["Roughness"].default_value = 0.5
    keys = MACHINE["keys"]
    lp = Vector(keys["leverPivot"])
    for k in GEO["keys"]:
        p = Vector(k["pos"])
        if k["kind"] == "print":
            cyl(p + Vector((0, 0.002, 0)), p - Vector((0, 0.002, 0)), keys["topRadius"], mat, 20)
            cyl(p, p - Vector((0, keys["stemHeight"], 0)), 0.0015, mat)
            cyl(Vector((p.x, lp.y, lp.z)), p - Vector((0, keys["stemHeight"], 0)), 0.0015, mat)
        else:
            w = k["width"]
            cyl(p - Vector((w / 2, 0, 0)), p + Vector((w / 2, 0, 0)), 0.006, mat, 12)
    for bar in GEO["bars"]:
        piv = Vector(bar["pivot"])
        ax = Vector(bar["axis"])
        sd = Vector(bar["strikeDir"])
        a = bar["thetaTravel"]
        c, s = math.cos(a), math.sin(a)
        d = sd * c + ax.cross(sd) * s + ax * ax.dot(sd) * (1 - c)
        cyl(piv, piv + d * bar["length"], 0.0012, mat)
    pl = MACHINE["platen"]
    c = Vector(pl["center"])
    hl = Vector((pl["length"] / 2, 0, 0))
    cyl(c - hl, c + hl, pl["radius"], mat, 40)
    rb = MACHINE["ribbon"]
    for sx in (-1, 1):
        cc = Vector((sx * rb["spoolX"], rb["spoolY"], rb["spoolZ"]))
        cyl(cc - Vector((0, rb["spoolWidth"] / 2, 0)), cc + Vector((0, rb["spoolWidth"] / 2, 0)), 0.016, mat, 24)


def camera(name, loc, target, lens):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    ob = bpy.data.objects.new(name, cam)
    bpy.context.collection.objects.link(ob)
    ob.location = b(loc)
    ob.rotation_euler = (b(target) - b(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


VIEWS = {
    "hero": ((0.42, 0.42, 0.78), (0, 0.075, 0.03), 60),
    "front": ((0.0, 0.2, 0.78), (0, 0.085, 0.05), 60),
    "side": ((0.72, 0.13, 0.05), (0, 0.075, 0.04), 60),
    "top": ((0.0, 0.8, 0.09), (0, 0.05, 0.09), 60),
    "rear": ((-0.36, 0.34, -0.5), (0, 0.09, 0.0), 60),
    "segment": ((0.10, 0.27, 0.27), (0, 0.11, -0.01), 90),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fit", action="store_true")
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--size", type=int, default=1000)
    ap.add_argument("--views", default=",".join(VIEWS))
    ap.add_argument("--glb", default=GLB)
    ap.add_argument("--extra", default="", help="further GLBs to import, comma separated (e.g. the enclosure)")
    ap.add_argument("--tag", default="")
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=a.glb)
    for extra in filter(None, a.extra.split(",")):
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(extra))
    for name, prefix, sc in (("japanned", "japanned_enamel", 1), ("nickel", "nickel_plating", 1), ("rubber", "vulcanised_rubber", 1)):
        apply_tex(bpy.data.materials.get(name), prefix, sc)
    if a.fit:
        proxies()
    # A desk plane.
    bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, 0))
    desk = bpy.context.active_object
    dm = bpy.data.materials.new("desk")
    dm.use_nodes = True
    dm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.05, 0.03, 0.02, 1)
    dm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.5
    desk.data.materials.append(dm)
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.samples = a.samples
    scn.cycles.use_denoising = True
    scn.cycles.device = "CPU"
    scn.render.resolution_x = a.size
    scn.render.resolution_y = int(a.size * 0.8)
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.055, 0.058, 0.066, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    scn.world = world
    for name, loc, energy, size in (("key", (0.5, 0.55, 0.45), 1.6, 0.7), ("fill", (-0.6, 0.35, 0.5), 0.5, 0.9), ("rim", (0.1, 0.5, -0.7), 1.4, 0.6)):
        l = bpy.data.lights.new(name, "AREA")
        l.size = size
        l.energy = energy * 10
        ob = bpy.data.objects.new(name, l)
        bpy.context.collection.objects.link(ob)
        ob.location = b(loc)
        ob.rotation_euler = (b((0, 0.08, 0.03)) - b(loc)).to_track_quat("-Z", "Y").to_euler()
    for v in a.views.split(","):
        loc, target, lens = VIEWS[v]
        scn.camera = camera(v, loc, target, lens)
        scn.render.filepath = os.path.join(OUT, f"{v}{a.tag}{'_fit' if a.fit else ''}.png")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
