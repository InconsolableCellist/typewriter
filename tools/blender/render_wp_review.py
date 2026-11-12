"""Review renders of the display station (models.md, Review): the module and the display assembled as on the desk,
seen from a reference photograph's viewpoint, Cycles on the CPU at small samples.

  /root/bpyenv/bin/python tools/blender/render_wp_review.py -- VIEW [VIEW ...] [--tilt DEG] [--swivel DEG] [--off] [--nodisplay]

Writes tools/blender/previews/wp_station_<VIEW>.png (gitignored). The CRT's glass, which the browser builds, is stood
in for here by makeTubeFace's shape at the display's face position.
"""
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
MODELS = os.path.join(ROOT, "public", "assets", "models")
OUTDIR = os.path.join(HERE, "previews")
STATION_H, DISPLAY_Z = 0.178, -0.004

# Viewpoints in unit coordinates (x right, y up, z toward the operator; desk at y = 0, module centre at the origin):
# camera position, target, focal length (mm, 36 mm film), resolution.
VIEWS = {
    "bro18": ((0.0, 0.62, 1.95), (0.0, 0.21, 0.0), 105, (560, 520)),          # brochure p.18, product photo
    "bro01": ((-0.36, 0.30, 1.05), (-0.03, 0.17, 0.0), 60, (640, 520)),        # brochure p.1, module from the front left
    "csg37": ((-0.85, 0.62, 1.75), (0.02, 0.19, 0.0), 70, (640, 520)),         # CSG p.37, the station in its place
    "csg40": ((0.0, 0.45, 2.4), (0.0, 0.2, 0.0), 120, (560, 560)),             # CSG p.40 / ST p.28 front view
    "csg23": ((0.85, 0.95, -1.35), (0.0, 0.14, 0.0), 70, (640, 560)),          # CSG p.23, from the rear right
    "psm46": ((0.95, 1.25, 1.05), (0.0, 0.12, 0.0), 70, (640, 520)),           # PSM p.46 top cover
    "psm7": ((0.0, 0.33, 1.6), (0.0, 0.33, 0.0), 120, (560, 420)),             # PSM p.7 display front
    "st28side": ((1.8, 0.33, 0.0), (0.0, 0.27, 0.0), 120, (560, 480)),        # ST p.28 right side
    "back": ((0.07, 0.11, -0.80), (0.07, 0.105, -0.18), 70, (900, 360)),       # PH Displaywriter_back.JPG
    "switch": ((-0.12, 0.36, 0.45), (-0.157, 0.170, 0.152), 90, (520, 340)),     # PH module_front_power_switch, close-up
    # The owner's photographs (docs/displaywriter/refs/owner/), module alone with --nodisplay:
    "mfront": ((0.0, 0.44, 0.50), (0.0, 0.03, -0.03), 30, (640, 480)),          # module_front_power_switch
    "mleft": ((-0.62, 0.55, 0.10), (0.0, 0.05, 0.02), 27, (640, 480)),          # module_side_vents_left_switch
    "mright": ((0.62, 0.62, 0.30), (0.0, 0.05, -0.04), 27, (640, 480)),        # module_side_vents_right
    "mrear": ((0.0, 0.55, -0.72), (0.0, 0.05, 0.0), 30, (640, 480)),         # module_rear_panel
    "mleds": ((0.15, 0.10, -0.42), (0.17, 0.075, -0.18), 50, (360, 480)),      # module_rear_led_column
    "dfront": ((0.0, 0.335, 0.62), (0.0, 0.335, 0.0), 40, (640, 480)),         # display_front_close
    "desk": ((-0.42, 0.52, 0.80), (0.0, 0.20, 0.0), 32, (600, 560)),          # desk_station_keyboard_diskette
    "deskfront": ((0.0, 0.45, 1.9), (0.0, 0.21, 0.0), 95, (640, 480)),       # desk_front_scott_peterson
}


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"views": [], "tilt": 0.0, "swivel": 0.0, "on": True, "display": True}
    i = 0
    while i < len(a):
        if a[i] == "--tilt":
            out["tilt"] = float(a[i + 1]); i += 2
        elif a[i] == "--swivel":
            out["swivel"] = float(a[i + 1]); i += 2
        elif a[i] == "--nodisplay":
            out["display"] = False; i += 1
        elif a[i] == "--off":
            out["on"] = False; i += 1
        else:
            out["views"].append(a[i]); i += 1
    return out


def unit(v):
    """Unit coordinates to Blender's."""
    return Vector((v[0], -v[2], v[1]))


def tube_face(face, parent):
    """makeTubeFace(w, h, radius) from src/render/wp/crt.js: a sphere patch, corners at z = 0."""
    w, h, r = face["w"], face["h"], face["radius"]
    bm = bmesh.new()
    nx, ny = 24, 16
    corner = math.sqrt(r * r - (w * w + h * h) / 4)
    vs = [[bm.verts.new(unit((face["x"] + x, face["y"] + y, face["z"] + math.sqrt(r * r - x * x - y * y) - corner)))
           for x in [(-0.5 + i / nx) * w for i in range(nx + 1)]] for y in [(-0.5 + j / ny) * h for j in range(ny + 1)]]
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    me = bpy.data.meshes.new("glass")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("glass", me)
    bpy.context.collection.objects.link(ob)
    mat = bpy.data.materials.new("glass")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.012, 0.016, 0.014, 1)
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Coat Weight"].default_value = 0.6
    me.materials.append(mat)
    ob.parent = parent
    return ob


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, "wp_station.glb"))
    st = {o.name: o for o in s.objects}
    disp_path = os.path.join(MODELS, "wp_display.glb")
    if a["display"] and os.path.exists(disp_path):
        before = set(s.objects)
        bpy.ops.import_scene.gltf(filepath=disp_path)
        new = [o for o in s.objects if o not in before]
        holder = bpy.data.objects.new("display", None)
        s.collection.objects.link(holder)
        holder.location = unit((0, STATION_H, DISPLAY_Z))
        for o in new:
            if o.parent is None:
                o.parent = holder
        dn = {o.name: o for o in new}
        bpy.context.view_layer.update()
        tilt, swivel = dn.get("display_tilt"), dn.get("display_swivel")
        face = json.loads(tilt["face"]) if tilt and "face" in tilt else None
        if face and tilt:
            tube_face(face, tilt)                                     # face is given in the tilt node's frame
        if swivel:
            swivel.rotation_mode = "XYZ"
            swivel.rotation_euler.z += math.radians(a["swivel"])     # unit y is Blender z
        if tilt:
            tilt.rotation_mode = "XYZ"
            tilt.rotation_euler.x -= math.radians(a["tilt"])          # unit x is Blender x; the top goes back
    rk = st.get("station_rocker")
    if rk:
        rk.rotation_mode = "XYZ"
        rk.rotation_euler.y = 0.16 if a["on"] else -0.16              # unit z (the axle) is Blender -y: on is -0.16 about unit z
    # Desk, world, light.
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    desk = s.objects[-1] if s.objects[-1].type == "MESH" else bpy.context.active_object
    dm = bpy.data.materials.new("desk")
    dm.use_nodes = True
    dm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.35, 0.34, 1)
    dm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    bpy.context.active_object.data.materials.append(dm)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.35
    s.world = w
    for loc, energy, size in (((-1.2, 1.4, 1.6), 70, 1.6), ((1.5, 0.8, 1.0), 22, 1.2), ((0.3, 1.2, -1.4), 18, 1.5)):
        ld = bpy.data.lights.new("l", "AREA")
        ld.energy, ld.size = energy, size
        lo = bpy.data.objects.new("l", ld)
        s.collection.objects.link(lo)
        lo.location = unit(loc)
        lo.rotation_euler = (Vector((0, 0, 0.2)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 24
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 4
    s.view_settings.view_transform = "Standard"
    s.view_settings.exposure = -0.6
    cam = bpy.data.cameras.new("c")
    co = bpy.data.objects.new("c", cam)
    s.collection.objects.link(co)
    s.camera = co
    os.makedirs(OUTDIR, exist_ok=True)
    for v in a["views"] or ["bro18"]:
        pos, tgt, lens, res = VIEWS[v]
        cam.lens = lens
        co.location = unit(pos)
        co.rotation_euler = (unit(tgt) - co.location).to_track_quat("-Z", "Y").to_euler()
        s.render.resolution_x, s.render.resolution_y = res
        tag = v + ("" if a["display"] else "_m") + (f"_t{a['tilt']:g}" if a["tilt"] else "") + (f"_s{a['swivel']:g}" if a["swivel"] else "") + ("" if a["on"] else "_off")
        s.render.filepath = os.path.join(OUTDIR, f"wp_station_{tag}.png")
        bpy.ops.render.render(write_still=True)
        print("wrote", s.render.filepath)


if __name__ == "__main__":
    main()
