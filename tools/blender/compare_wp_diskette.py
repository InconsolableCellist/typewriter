"""Places each reference photograph or drawing beside the render from its viewpoint (render_wp_diskette.py), for the
review in docs/displaywriter/models.md.

  python3 tools/blender/compare_wp_diskette.py REFDIR [--tag NAME] [--before NAME]

REFDIR holds the references named below: the owner's photographs (docs/displaywriter/refs/owner/) and the crops rendered
from the PDFs listed in models.md; a missing one is skipped. Each pair is written to
tools/blender/previews/wp_diskette_cmp_<view>.png (gitignored). With --before, the render tagged NAME (an earlier
build) goes between the photograph and the current render, so the triple reads reference, before, after.
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(HERE, "previews")
# view: (reference file, crop box as fractions of the image or None, horizontal scale of the reference, caption).
# diskette_front.jpg is stretched sideways: its face is 226 px wide and 238 px tall where the documented 254 x 292 mm and
# the undistorted desk_front_scott_peterson.jpg (H/W 1.14) say it should be 1.09 times narrower, so it is narrowed back.
PAIRS = {
    "front": ("diskette_front.jpg", (0.30, 0.05, 0.93, 0.88), 1 / 1.09, "PH diskette_front (width / 1.09)"),
    "sp": ("desk_front_scott_peterson.jpg", (0.55, 0.22, 0.95, 0.95), 1.0, "PH desk_front_scott_peterson"),
    "desk": ("desk_station_keyboard_diskette.jpg", (0.0, 0.33, 0.33, 0.95), 1.0, "PH desk_station_keyboard_diskette"),
    "deskfront": ("desk_front_scott_peterson.jpg", (0.0, 0.0, 0.95, 1.0), 1.0, "PH desk_front_scott_peterson"),
    "levers": ("diskette_front.jpg", (0.45, 0.50, 0.77, 0.80), 1 / 1.09, "PH diskette_front, levers"),
    "bro18": ("bro18.png", None, 1.0, "BRO p.18 product photo"),
    "gim25": ("gim-025.png", (0.25, 0.10, 0.85, 0.52), 1.0, "GIM p.25 (single unit)"),
    "lever": ("csg-042.png", (0.6, 0.62, 0.85, 0.86), 1.0, "CSG p.42 lever closed"),
    "rear": ("psm-061.png", (0.07, 0.30, 0.31, 0.78), 1.0, "PSM p.61 cover removal"),
    "file": ("b01-01.png", None, 1.0, "BRO p.1 diskette in hand"),
}


def main():
    ref_dir = sys.argv[1]
    a = sys.argv[2:]
    tag = "_" + a[a.index("--tag") + 1] if "--tag" in a else ""
    before = "_" + a[a.index("--before") + 1] if "--before" in a else None
    hgt = 560
    for view, (ref, crop, sx, caption) in PAIRS.items():
        render = os.path.join(PREV, f"wp_diskette_{view}{tag}.png")
        ref_path = os.path.join(ref_dir, ref)
        if not os.path.exists(render) or not os.path.exists(ref_path):
            continue
        r = Image.open(ref_path).convert("RGB")
        if crop:
            w, h = r.size
            r = r.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        r = r.resize((int(r.width * sx * hgt / r.height), hgt), Image.LANCZOS)
        panels = [(r, caption)]
        if before:
            bp = os.path.join(PREV, f"wp_diskette_{view}{before}.png")
            if os.path.exists(bp):
                b = Image.open(bp).convert("RGB")
                panels.append((b.resize((int(b.width * hgt / b.height), hgt), Image.LANCZOS), "before"))
        b = Image.open(render).convert("RGB")
        panels.append((b.resize((int(b.width * hgt / b.height), hgt), Image.LANCZOS), f"wp_diskette.glb, {view}"))
        out = Image.new("RGB", (sum(p.width for p, _ in panels) + 10 * (len(panels) - 1), hgt + 28), "white")
        d = ImageDraw.Draw(out)
        x = 0
        for p, cap in panels:
            out.paste(p, (x, 28))
            d.text((x + 6, 8), cap, fill="black")
            x += p.width + 10
        path = os.path.join(PREV, f"wp_diskette_cmp_{view}.png")
        out.save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
