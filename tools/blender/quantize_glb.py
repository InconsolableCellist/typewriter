"""Quantizes a GLB in place with KHR_mesh_quantization (read natively by three.js's GLTFLoader and by Blender):
positions become 16-bit integers in steps of STEP metres, normals 8-bit normalized. UVs stay float, so one UV unit is
still 0.2 m (models.md); a primitive whose UVs are all zero (small parts) loses them. Each mesh moves onto a child node that carries the dequantizing scale, so the named node
keeps its own transform and anything that rotates it about its origin is unaffected.

  python3 tools/blender/quantize_glb.py public/assets/models/wp_station.glb
"""
import json
import struct
import sys

STEP = 5e-5                    # m per position step: 0.05 mm, range +-1.6 m


def pad4(b):
    return b + b"\0" * (-len(b) % 4)


def quantize(path):
    raw = open(path, "rb").read()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    gltf = json.loads(raw[20:20 + jlen])
    bin_off = 20 + jlen + 8
    blob = raw[bin_off:bin_off + struct.unpack_from("<I", raw, 20 + jlen)[0]]
    views, accs = gltf["bufferViews"], gltf["accessors"]

    def read(ai):
        a = accs[ai]
        v = views[a["bufferView"]]
        n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        fmt = {5126: "f", 5123: "H", 5125: "I", 5121: "B"}[a["componentType"]]
        size = struct.calcsize(fmt)
        stride = v.get("byteStride", n * size)
        base = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        return [struct.unpack_from("<" + fmt * n, blob, base + i * stride) for i in range(a["count"])]

    out = bytearray()
    new_views, new_accs = [], []

    def add(data, target=None, stride=None):
        nonlocal out
        out += b"\0" * (-len(out) % 4)
        v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(data)}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        out += data
        new_views.append(v)
        return len(new_views) - 1

    def acc(view, ctype, count, typ, normalized=False, mn=None, mx=None):
        a = {"bufferView": view, "componentType": ctype, "count": count, "type": typ}
        if normalized:
            a["normalized"] = True
        if mn is not None:
            a["min"], a["max"] = mn, mx
        new_accs.append(a)
        return len(new_accs) - 1

    remap = {}
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            at = prim["attributes"]
            for key, ai in list(at.items()):
                if key.startswith("TEXCOORD") and all(c == 0 for p in read(ai) for c in p):
                    del at[key]            # a small part with one UV (wp_mould.finish_small): no texture detail to place
                    continue
                if (key, ai) in remap:
                    at[key] = remap[(key, ai)]
                    continue
                vals = read(ai)
                if key == "POSITION":
                    q = [tuple(max(-32767, min(32767, round(c / STEP))) for c in p) for p in vals]
                    data = b"".join(struct.pack("<hhhh", *p, 0) for p in q)
                    mn = [min(p[i] for p in q) for i in range(3)]
                    mx = [max(p[i] for p in q) for i in range(3)]
                    na = acc(add(data, 34962, 8), 5122, len(q), "VEC3", False, mn, mx)
                elif key == "NORMAL":
                    data = b"".join(struct.pack("<bbbb", *(max(-127, min(127, round(c * 127))) for c in p), 0) for p in vals)
                    na = acc(add(data, 34962, 4), 5120, len(vals), "VEC3", True)
                else:
                    a = accs[ai]
                    data = b"".join(struct.pack("<" + "f" * len(p), *p) for p in vals)
                    na = acc(add(data, 34962), a["componentType"], len(vals), a["type"], False, a.get("min"), a.get("max"))
                remap[(key, ai)] = na
                at[key] = na
            if "indices" in prim:
                ai = prim["indices"]
                if ("idx", ai) not in remap:
                    vals = [p[0] for p in read(ai)]
                    big = max(vals) > 65535
                    data = b"".join(struct.pack("<I" if big else "<H", i) for i in vals)
                    remap[("idx", ai)] = acc(add(data, 34963), 5125 if big else 5123, len(vals), "SCALAR")
                prim["indices"] = remap[("idx", ai)]
    # The dequantizing scale goes on a child node holding the mesh.
    nodes = gltf["nodes"]
    for ni in range(len(nodes)):
        nd = nodes[ni]
        if "mesh" not in nd:
            continue
        child = {"name": nd.get("name", "") + "_mesh", "mesh": nd.pop("mesh"), "scale": [STEP] * 3}
        nodes.append(child)
        nd.setdefault("children", []).append(len(nodes) - 1)
    gltf["bufferViews"], gltf["accessors"] = new_views, new_accs
    gltf["buffers"] = [{"byteLength": len(out)}]
    for k in ("extensionsUsed", "extensionsRequired"):
        gltf[k] = sorted(set(gltf.get(k, [])) | {"KHR_mesh_quantization"})
    js = pad4(json.dumps(gltf, separators=(",", ":")).encode()).replace(b"\0", b" ")
    js = js + b" " * (-len(js) % 4)
    bn = pad4(bytes(out))
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(bn), 0x004E4942) + bn)
    print(f"quantized {path}: {len(raw)} -> {total} bytes")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        quantize(p)
