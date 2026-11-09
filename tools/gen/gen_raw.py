#!/usr/bin/env python3
"""Generates the raw texture candidates with Qwen-Image 2.1 on ComfyUI servers listed in $COMFY_SERVERS (comma-separated).

  python3 tools/gen/gen_raw.py [name ...]     # default: every texture, every seed
Writes tools/gen/raw/<name>_s<seed>.png; tools/gen/pinstripe.py turns the picked candidate into the decal.
Prompts must stay generic: no brand names, no text, no logos.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
SERVERS = os.environ.get("COMFY_SERVERS", "http://127.0.0.1:8188").split(",")
TAIL = " Top-down, even diffuse lighting, no shadows, no vignette, the material fills the entire frame " \
       "edge to edge, seamless photographic material texture. No text, no letters, no logos, no objects."
PROMPTS = {
    "pinstripe": "Decorative gold pinstripe line ornament on a pure black background: thin elegant gold double border "
                 "lines with curved scroll flourishes at the corners, symmetrical, vintage 1920s machine striping, "
                 "flat graphic illustration, thin lines, no text, no letters, no numbers, no logos, no emblem.",
}
NO_TAIL = {"pinstripe"}
SEEDS = [7]   # the seed of each picked source; tools/gen/materials.py authors everything else
STEPS, W = 8, 2048


def main():
    names = sys.argv[1:] or list(PROMPTS)
    os.makedirs(RAW, exist_ok=True)
    jobs = [{"prompt": PROMPTS[n] + ("" if n in NO_TAIL else TAIL),
             "out": os.path.join(RAW, f"{n}_s{s}.png"), "seed": s, "prefix": f"tw_{n}_{s}"}
            for n in names for s in SEEDS
            if not os.path.exists(os.path.join(RAW, f"{n}_s{s}.png"))]
    procs = []
    for i, url in enumerate(SERVERS):
        sub = jobs[i::len(SERVERS)]
        if not sub:
            continue
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(sub, f)
        f.close()
        procs.append(subprocess.Popen([sys.executable, os.path.join(HERE, "comfy_gen.py"), "--turbo", "--steps", str(STEPS),
                                       "-W", str(W), "-H", str(W), "--jobs", f.name],
                                      env=dict(os.environ, COMFY_URL=url)))
    sys.exit(max([p.wait() for p in procs] + [0]))


if __name__ == "__main__":
    main()
