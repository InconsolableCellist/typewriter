"""Rewrites a GLB with KHR_mesh_quantization, which three.js's GLTFLoader reads with no decoder: positions as normalized
shorts (the node gets a uniform scale, so its origin, the pivot, is unchanged), normals as normalized bytes, texture
coordinates as floats. About half the size of Blender's float export.

  python3 tools/blender/gltf_quantize.py in.glb [out.glb]

Each mesh must belong to one node with no rotation or scale (true of the word-processor models, whose pivots are node
translations).
"""
import json
import struct
import sys

import numpy as np

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and version == 2
    off, js, binary = 12, None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk)
        elif ctype == 0x004E4942:
            binary = chunk
        off += 8 + clen
    return js, binary


def accessor_array(js, binary, i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    dt = np.dtype(COMPONENT[a["componentType"]])
    n = COUNT[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", dt.itemsize * n)
    raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=start)
    out = np.empty((a["count"], n), dtype=dt)
    for k in range(a["count"]):
        out[k] = np.frombuffer(raw[k * stride: k * stride + dt.itemsize * n].tobytes(), dtype=dt)
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    src = argv[0]
    dst = argv[1] if len(argv) > 1 else src
    js, binary = read_glb(src)
    arrays = {i: accessor_array(js, binary, i) for i in range(len(js["accessors"]))}
    new_acc, chunks, views = [], [], []
    size = 0

    def add_view(buf, target, stride=None):
        nonlocal size
        pad = (-size) % 4
        if pad:
            chunks.append(b"\0" * pad)
            size += pad
        v = {"buffer": 0, "byteOffset": size, "byteLength": len(buf)}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        chunks.append(buf)
        size += len(buf)
        views.append(v)
        return len(views) - 1

    def add_acc(arr, ctype, type_, normalized=False, minmax=False, target=34962, stride=None):
        v = add_view(arr.tobytes(), target, stride)
        a = {"bufferView": v, "componentType": ctype, "count": arr.shape[0], "type": type_}
        if normalized:
            a["normalized"] = True
        if minmax:
            n = COUNT[type_]
            vals = arr[:, :n] if arr.ndim == 2 else arr.reshape(-1, 1)
            a["min"] = [int(x) if ctype != 5126 else float(x) for x in vals.min(axis=0)]
            a["max"] = [int(x) if ctype != 5126 else float(x) for x in vals.max(axis=0)]
        new_acc.append(a)
        return len(new_acc) - 1

    mesh_scale = {}
    for mi, mesh in enumerate(js["meshes"]):
        s = 0.0
        for p in mesh["primitives"]:
            s = max(s, float(np.abs(arrays[p["attributes"]["POSITION"]]).max()))
        mesh_scale[mi] = max(s, 1e-6)
    for mi, mesh in enumerate(js["meshes"]):
        s = mesh_scale[mi]
        for p in mesh["primitives"]:
            attrs = {}
            pos = arrays[p["attributes"]["POSITION"]].astype(np.float64)
            q = np.round(pos / s * 32767).astype(np.int16)
            q4 = np.zeros((q.shape[0], 4), np.int16)
            q4[:, :3] = q
            attrs["POSITION"] = add_acc(q4, 5122, "VEC3", True, True, stride=8)
            new_acc[-1]["min"] = new_acc[-1]["min"][:3]
            new_acc[-1]["max"] = new_acc[-1]["max"][:3]
            if "NORMAL" in p["attributes"]:
                nrm = arrays[p["attributes"]["NORMAL"]].astype(np.float64)
                nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
                n4 = np.zeros((nrm.shape[0], 4), np.int8)
                n4[:, :3] = np.round(nrm * 127).astype(np.int8)
                attrs["NORMAL"] = add_acc(n4, 5120, "VEC3", True, stride=4)
            for k, idx in p["attributes"].items():
                if k.startswith("TEXCOORD"):
                    attrs[k] = add_acc(arrays[idx].astype(np.float32), 5126, "VEC2")
            p["attributes"] = attrs
            if "indices" in p:
                ind = arrays[p["indices"]].reshape(-1)
                ind = ind.astype(np.uint16) if ind.max() < 65535 else ind.astype(np.uint32)
                p["indices"] = add_acc(ind.reshape(-1, 1), 5123 if ind.dtype == np.uint16 else 5125, "SCALAR", target=34963)
    for node in js["nodes"]:
        if "mesh" in node:
            assert "rotation" not in node and "scale" not in node and "matrix" not in node, node["name"]
            s = mesh_scale[node["mesh"]]
            node["scale"] = [s, s, s]
    js["accessors"] = new_acc
    js["bufferViews"] = views
    body = b"".join(chunks)
    body += b"\0" * ((-len(body)) % 4)
    js["buffers"] = [{"byteLength": len(body)}]
    for key in ("extensionsUsed", "extensionsRequired"):
        js[key] = sorted(set(js.get(key, [])) | {"KHR_mesh_quantization"})
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * ((-len(jb)) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(body))
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb + struct.pack("<II", len(body), 0x004E4942) + body
    open(dst, "wb").write(out)
    print(f"quantized {src}: {len(out)} bytes")


if __name__ == "__main__":
    main()
