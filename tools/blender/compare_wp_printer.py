"""Puts each reference photograph beside the render from its viewpoint (render_wp_printer.py), for the review of
docs/displaywriter/models.md: tools/blender/previews/compare_<view>.png.

  python3 tools/blender/compare_wp_printer.py <reference dir>

The reference dir holds the Bitsavers photos (5218_1.jpg ...) and the brochure page (hi-18.png); none are committed.
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(HERE, "previews")
# view: (reference file, crop box in the reference or None)
PAIRS = {
    "front": ("5218_1.jpg", None),
    "open": ("5218_2.jpg", None),
    "rear": ("5218_3.jpg", None),
    "carrier": ("5218_4.jpg", (0, 700, 1200, 1304)),
    "feeder": ("hi-18.png", (276, 1236, 661, 1621)),
    "plain": ("hi-18.png", (742, 897, 1127, 1161)),
}


def main():
    ref_dir = sys.argv[1]
    for view, (name, crop) in PAIRS.items():
        render = os.path.join(PREV, f"printer_{'front' if view == 'plain' else view}.png")
        ref = os.path.join(ref_dir, name)
        if not (os.path.exists(render) and os.path.exists(ref)):
            continue
        a = Image.open(ref).convert("RGB")
        if crop:
            a = a.crop(crop)
        b = Image.open(render).convert("RGB")
        h = 480
        a = a.resize((round(a.width * h / a.height), h))
        b = b.resize((round(b.width * h / b.height), h))
        out = Image.new("RGB", (a.width + b.width + 10, h + 24), "white")
        out.paste(a, (0, 24))
        out.paste(b, (a.width + 10, 24))
        d = ImageDraw.Draw(out)
        d.text((6, 6), f"reference: {name}", fill="black")
        d.text((a.width + 16, 6), f"model: printer_{view}", fill="black")
        path = os.path.join(PREV, f"compare_{view}.png")
        out.save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
