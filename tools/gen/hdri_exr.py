#!/usr/bin/env python3
"""Convert the downloaded Radiance HDRI to the half-float, DWAB-compressed OpenEXR the renderer loads.

  python3 tools/gen/hdri_exr.py path/to/combination_room_2k.hdr     # or a 2k .exr (the one this script wrote before)

Box-filters the 2048 x 1024 source to 1024 x 512 and writes public/assets/hdri/combination_room_1k.exr. The renderer
only ever samples the HDRI through its prefiltered cube map (image light, and the backdrop at backgroundBlurriness
0.06), whose face is a quarter of the image's width: 256 px from a 1k image, the size of the studio environment it
replaces, so the lit programs are not relinked when it arrives. DWAB at its default level (45); after the renderer's
exposure and a tone curve the error is under one 8-bit display step. See docs/assets.md. Needs numpy and the OpenEXR
bindings (pip install OpenEXR).
"""
import os
import sys

import numpy as np
import OpenEXR

OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "assets", "hdri",
                                   "combination_room_1k.exr"))
WIDTH = 1024


def read_rgbe(path):
    """Radiance .hdr (-Y h +X w, new-style RLE scanlines) to float32 RGB, top row first."""
    data = open(path, "rb").read()
    pos = 0
    while True:
        end = data.index(b"\n", pos)
        line = data[pos:end]
        pos = end + 1
        if line.startswith(b"-Y "):
            _, h, _, w = line.split()
            h, w = int(h), int(w)
            break
    buf = np.frombuffer(data, np.uint8, offset=pos)
    rgbe = np.empty((h, w, 4), np.uint8)
    i = 0
    for y in range(h):
        if buf[i] != 2 or buf[i + 1] != 2 or (int(buf[i + 2]) << 8 | int(buf[i + 3])) != w:
            raise ValueError("only RLE scanlines are supported")
        i += 4
        for c in range(4):
            x = 0
            while x < w:
                n = int(buf[i])
                i += 1
                if n > 128:
                    rgbe[y, x:x + n - 128, c] = buf[i]
                    x += n - 128
                    i += 1
                else:
                    rgbe[y, x:x + n, c] = buf[i:i + n]
                    x += n
                    i += n
    e = rgbe[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0).astype(np.float32)
    return rgbe[..., :3].astype(np.float32) * scale[..., None]


def read_exr(path):
    with OpenEXR.File(path) as f:
        return np.asarray(f.channels()["RGB"].pixels, np.float32)


def box_halve(rgb):
    """Mean of each 2 x 2 block, in linear light (rows and columns even)."""
    return 0.25 * (rgb[0::2, 0::2] + rgb[1::2, 0::2] + rgb[0::2, 1::2] + rgb[1::2, 1::2])


def main():
    rgb = read_exr(sys.argv[1]) if sys.argv[1].endswith(".exr") else read_rgbe(sys.argv[1])
    while rgb.shape[1] > WIDTH:
        rgb = box_halve(rgb)
    header = {"compression": OpenEXR.DWAB_COMPRESSION, "type": OpenEXR.scanlineimage, "dwaCompressionLevel": 45.0}
    with OpenEXR.File(header, {"RGB": np.ascontiguousarray(rgb.astype(np.float16))}) as f:
        f.write(OUT)
    print(f"{OUT}: {rgb.shape[1]} x {rgb.shape[0]}, peak {rgb.max():.1f}, {os.path.getsize(OUT) // 1024} KiB")


if __name__ == "__main__":
    main()
