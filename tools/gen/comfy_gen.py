#!/usr/bin/env python3
"""Generate images with Qwen-Image 2.1 on a ComfyUI server (text-to-image, or
edit/re-draw with up to 16 reference images).

Only the Python standard library is needed. Examples:

  python3 gen.py -p "a red apple" -o /tmp/apple.png
  python3 gen.py -p "..." --seed 7 --batch 4 -W 1024 -H 640 -o out/gun.png
      (a batch writes out/gun_00.png, out/gun_01.png, ...)
  python3 gen.py -p "Redraw this as pixel art" --ref in.png -o out.png
  python3 gen.py --jobs jobs.json      # [{"prompt":..., "out":..., "seed":...}, ...]
      (servers that share one output folder need a distinct
      "prefix" per server in the jobs, or their file numbers collide)

The server is $COMFY_URL, else http://127.0.0.1:8188. Nothing is installed or changed on it:
this only queues prompts and downloads results.
"""
import argparse
import json
import mimetypes
import os
import random
import sys
import time
import urllib.parse
import urllib.request
import uuid

URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
UNET = "qwen_image_2.1_int8_convrot.safetensors"
# Turbo: the same model distilled to about 8 steps (--turbo, or "unet" in a job).
TURBO = "qwen_image_2.1_turbo_int8_convrot.safetensors"
CLIP = "qwen3vl_8b_int8_convrot.safetensors"
VAE = "qwen_image_2.1_vae_bf16.safetensors"
CLIENT = str(uuid.uuid4())


def _req(path, data=None, headers=None):
    r = urllib.request.Request(URL + path, data=data, headers=headers or {})
    with urllib.request.urlopen(r, timeout=120) as f:
        return f.read()


def upload(path):
    """Uploads a local image to the server's input folder; returns its name."""
    boundary = uuid.uuid4().hex
    name = "tw_" + uuid.uuid4().hex[:8] + "_" + os.path.basename(path)
    ctype = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        body = f.read()
    parts = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
        f"Content-Type: {ctype}\r\n\r\n").encode() + body + (
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue"
        f"\r\n--{boundary}--\r\n").encode()
    res = json.loads(_req("/upload/image", parts, {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
    return res["name"] if not res.get("subfolder") else res["subfolder"] + "/" + res["name"]


def workflow(prompt, seed, width, height, steps, cfg=1.0, negative="", batch=1, refs=(), ref_res=1024,
             sampler="euler", scheduler="simple", prefix="typewriter", init=None, denoise=1.0, unet=None):
    """The API-format graph: the same nodes as the Comfy-Org Qwen Image 2.1 template.
    init: an uploaded image to start from (img2img) instead of noise; the
    output then takes its size, and denoise < 1 keeps that much of it."""
    g = {
        "unet": {"class_type": "UNETLoader", "inputs": {"unet_name": unet or UNET, "weight_dtype": "default"}},
        "clip": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP, "type": "qwen_image", "device": "default"}},
        "vae": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "enc": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["clip", 0], "prompt": prompt, "negative_prompt": negative, "resolution": ref_res, "vae": ["vae", 0]}},
        "lat": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": batch}},
        "ks": {"class_type": "KSampler", "inputs": {
            "model": ["unet", 0], "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": sampler,
            "scheduler": scheduler, "positive": ["enc", 0], "negative": ["enc", 1], "latent_image": ["lat", 0], "denoise": 1.0}},
        "dec": {"class_type": "VAEDecode", "inputs": {"samples": ["ks", 0], "vae": ["vae", 0]}},
        "save": {"class_type": "SaveImage", "inputs": {"images": ["dec", 0], "filename_prefix": prefix}},
    }
    if init:
        g["init"] = {"class_type": "LoadImage", "inputs": {"image": init}}
        g["lat"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["init", 0], "vae": ["vae", 0]}}
        if batch > 1:
            g["latb"] = {"class_type": "RepeatLatentBatch", "inputs": {"samples": ["lat", 0], "amount": batch}}
            g["ks"]["inputs"]["latent_image"] = ["latb", 0]
        g["ks"]["inputs"]["denoise"] = denoise
    for i, name in enumerate(refs):
        g[f"ref{i}"] = {"class_type": "LoadImage", "inputs": {"image": name}}
        g["enc"]["inputs"][f"images.image_{i + 1}"] = [f"ref{i}", 0]
    return g


def queue(graph):
    body = json.dumps({"prompt": graph, "client_id": CLIENT}).encode()
    try:
        res = json.loads(_req("/prompt", body, {"Content-Type": "application/json"}))
    except urllib.error.HTTPError as e:
        sys.exit("queue failed: %s\n%s" % (e, e.read().decode(errors="replace")[:3000]))
    return res["prompt_id"]


def wait(pid, timeout=1800):
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = json.loads(_req("/history/" + pid))
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                sys.exit("generation failed: %s" % json.dumps(st.get("messages"))[:3000])
            imgs = []
            for out in h[pid].get("outputs", {}).values():
                imgs += out.get("images", [])
            return imgs
        time.sleep(1.5)
    sys.exit("timed out waiting for " + pid)


def fetch(img, dest):
    q = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")})
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(_req("/view?" + q))


def outputs_for(out, n):
    if n == 1:
        return [out]
    stem, ext = os.path.splitext(out)
    return ["%s_%02d%s" % (stem, i, ext or ".png") for i in range(n)]


def run(job, defaults):
    j = dict(defaults)
    j.update({k: v for k, v in job.items() if v is not None})
    seed = j.get("seed")
    if seed is None or seed < 0:
        seed = random.randrange(2 ** 48)
    refs = [upload(p) for p in j.get("ref") or []]
    init = upload(j["init"]) if j.get("init") else None
    g = workflow(j["prompt"], seed, j["width"], j["height"], j["steps"], j["cfg"], j.get("negative", ""),
                 j["batch"], refs, j.get("ref_res", 1024), init=init, denoise=j.get("denoise", 1.0),
                 prefix=j.get("prefix", "typewriter"), unet=j.get("unet"))
    pid = queue(g)
    return pid, seed, j


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-p", "--prompt")
    ap.add_argument("-n", "--negative", default="")
    ap.add_argument("-o", "--out", help="output PNG (a batch appends _00, _01, ...)")
    ap.add_argument("--seed", type=int, default=-1, help="-1: random")
    ap.add_argument("-W", "--width", type=int, default=1024)
    ap.add_argument("-H", "--height", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--cfg", type=float, default=1.0, help="1 = official path; >1 enables the negative prompt")
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--ref", action="append", help="reference image (repeatable): edit / redraw mode")
    ap.add_argument("--ref-res", type=int, default=1024, help="0: keep each reference's own size")
    ap.add_argument("--init", help="start from this image (img2img) instead of noise")
    ap.add_argument("--denoise", type=float, default=1.0, help="with --init: 1 = ignore it, lower keeps more")
    ap.add_argument("--unet", help="diffusion model file on the server (default: %s)" % UNET)
    ap.add_argument("--turbo", action="store_true", help="the turbo model (%s); use about --steps 8" % TURBO)
    ap.add_argument("--jobs", help="JSON list of jobs (keys as the long options, 'out' required); all queued at once")
    a = ap.parse_args()
    defaults = {"width": a.width, "height": a.height, "steps": a.steps, "cfg": a.cfg, "batch": a.batch,
                "negative": a.negative, "seed": a.seed, "ref": a.ref, "ref_res": a.ref_res,
                "init": a.init, "denoise": a.denoise, "unet": TURBO if a.turbo else a.unet}
    jobs = json.load(open(a.jobs)) if a.jobs else [{"prompt": a.prompt, "out": a.out}]
    pending = []
    for job in jobs:
        if not job.get("prompt") or not job.get("out"):
            sys.exit("each job needs a prompt and an out path")
        pending.append(run(job, defaults))
    for pid, seed, j in pending:
        t0 = time.time()
        imgs = wait(pid)
        for img, dest in zip(imgs, outputs_for(j["out"], len(imgs))):
            fetch(img, dest)
            print("%s  <- %s  seed=%d  %.0fs" % (dest, img["filename"], seed, time.time() - t0), flush=True)
        meta = os.path.splitext(j["out"])[0] + ".json"
        with open(meta, "w") as f:
            json.dump({"prompt": j["prompt"], "negative": j.get("negative", ""), "seed": seed, "width": j["width"],
                       "height": j["height"], "steps": j["steps"], "cfg": j["cfg"], "batch": j["batch"],
                       "ref": j.get("ref"), "ref_res": j.get("ref_res"), "init": j.get("init"),
                       "denoise": j.get("denoise", 1.0), "model": j.get("unet") or UNET,
                       "comfy_files": [i["filename"] for i in imgs]}, f, indent=1)


if __name__ == "__main__":
    main()
