"""Places each reference photograph or drawing beside the render from its viewpoint (render_wp_diskette.py), for the
review in docs/displaywriter/models.md. python3 tools/blender/compare_wp_diskette.py REFDIR

REFDIR holds the reference crops named below (rendered from the PDFs listed in models.md); the pairs are written to
tools/blender/previews/wp_diskette_cmp_<view>.png (gitignored).
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(HERE, "previews")
PAIRS = {   # view: (reference file, crop box as fractions of the page or None, caption)
    "bro18": ("bro18.png", None, "BRO p.18 product photo"),
    "gim25": ("gim-025.png", (0.25, 0.10, 0.85, 0.52), "GIM p.25 (single unit)"),
    "lever": ("csg-042.png", (0.6, 0.62, 0.85, 0.86), "CSG p.42 lever closed"),
    "rear": ("psm-061.png", (0.07, 0.30, 0.31, 0.78), "PSM p.61 cover removal"),
    "file": ("b01-01.png", None, "BRO p.1 diskette in hand"),
}


def main():
    ref_dir = sys.argv[1]
    for view, (ref, crop, caption) in PAIRS.items():
        render = os.path.join(PREV, f"wp_diskette_{view}.png")
        if not os.path.exists(render):
            continue
        a = Image.open(os.path.join(ref_dir, ref)).convert("RGB")
        if crop:
            w, h = a.size
            a = a.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        b = Image.open(render).convert("RGB")
        hgt = 560
        a = a.resize((int(a.width * hgt / a.height), hgt))
        b = b.resize((int(b.width * hgt / b.height), hgt))
        out = Image.new("RGB", (a.width + b.width + 10, hgt + 28), "white")
        out.paste(a, (0, 28))
        out.paste(b, (a.width + 10, 28))
        d = ImageDraw.Draw(out)
        d.text((6, 8), caption, fill="black")
        d.text((a.width + 16, 8), f"wp_diskette.glb, {view}", fill="black")
        path = os.path.join(PREV, f"wp_diskette_cmp_{view}.png")
        out.save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
