"""Places each reference photograph or drawing of the display station beside the render from its viewpoint
(render_wp_review.py), for the review in docs/displaywriter/models.md. python3 tools/blender/compare_wp_station.py REFDIR

REFDIR holds the references named below: the owner's photographs (docs/displaywriter/refs/owner/) and pages rendered
from the PDFs listed in models.md. The pairs are written to tools/blender/previews/wp_station_cmp_<render>.png
(gitignored); a render that does not exist yet is skipped.
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PREV = os.path.join(HERE, "previews")
PAIRS = {   # render name: (reference file, crop box as fractions of the image or None, caption)
    "mfront_m_off": ("module_front_power_switch.webp", None, "PH module_front_power_switch"),
    "mleft_m_off": ("module_side_vents_left_switch.webp", None, "PH module_side_vents_left_switch"),
    "mright_m_off": ("module_side_vents_right.webp", None, "PH module_side_vents_right"),
    "mrear_m_off": ("module_rear_panel.webp", None, "PH module_rear_panel"),
    "mleds_m": ("module_rear_led_column_lit.webp", None, "PH module_rear_led_column_lit"),
    "switch_m_off": ("module_front_power_switch.webp", (0.09, 0.50, 0.30, 0.69), "PH module_front_power_switch, switch"),
    "switch": ("desk_station_keyboard_diskette.jpg", (0.47, 0.47, 0.63, 0.54), "PH desk_station_keyboard_diskette, switch on"),
    "dfront": ("display_front_close.jpg", None, "PH display_front_close"),
    "desk": ("desk_station_keyboard_diskette.jpg", (0.25, 0.0, 1.0, 0.72), "PH desk_station_keyboard_diskette"),
    "deskfront": ("desk_front_scott_peterson.jpg", (0.0, 0.0, 0.62, 0.75), "PH desk_front_scott_peterson"),
    "bro18": ("bro18-000.jpg", (0.185, 0.18, 0.38, 0.33), "BRO p.18 product photo"),
    "st28side": ("st-028.png", (0.30, 0.52, 0.44, 0.70), "ST p.28 fig. 2, right side"),
}


def main():
    ref_dir = sys.argv[1]
    for view, (ref, crop, caption) in PAIRS.items():
        render = os.path.join(PREV, f"wp_station_{view}.png")
        if not os.path.exists(render) or not os.path.exists(os.path.join(ref_dir, ref)):
            continue
        a = Image.open(os.path.join(ref_dir, ref)).convert("RGB")
        if crop:
            w, h = a.size
            a = a.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        b = Image.open(render).convert("RGB")
        hgt = 480
        a = a.resize((int(a.width * hgt / a.height), hgt))
        b = b.resize((int(b.width * hgt / b.height), hgt))
        out = Image.new("RGB", (a.width + b.width + 10, hgt + 28), "white")
        out.paste(a, (0, 28))
        out.paste(b, (a.width + 10, 28))
        d = ImageDraw.Draw(out)
        d.text((6, 8), caption, fill="black")
        d.text((a.width + 16, 8), f"wp_station.glb + wp_display.glb, {view}", fill="black")
        path = os.path.join(PREV, f"wp_station_cmp_{view}.png")
        out.save(path)
        print("wrote", path)


if __name__ == "__main__":
    main()
