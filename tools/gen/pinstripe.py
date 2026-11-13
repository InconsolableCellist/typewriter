#!/usr/bin/env python3
"""Turns a raw Qwen pinstripe border (tools/gen/raw/pinstripe_s7.png) into an RGBA decal: gold ink with
alpha taken from the line brightness, background fully transparent. Writes
tools/gen/out/textures/pinstripe_border.png (no machine draws it, so it is not deployed)."""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
a = np.asarray(Image.open(os.path.join(HERE, "raw", "pinstripe_s7.png")).convert("RGB"), dtype=np.float32) / 255
lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
alpha = np.clip((lum - 0.10) / 0.28, 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)
alpha = ndimage.gaussian_filter(alpha, 0.5)
gold = np.array([0.78, 0.60, 0.26], dtype=np.float32)
shade = np.clip(0.7 + lum, 0.7, 1.25)
rgb = np.clip(gold * shade[..., None], 0, 1)
out = np.dstack((rgb, alpha))
os.makedirs(os.path.join(HERE, "out", "textures"), exist_ok=True)
path = os.path.join(HERE, "out", "textures", "pinstripe_border.png")
Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA").save(path, optimize=True)
print("wrote", path, f"alpha coverage {(alpha > 0.5).mean():.3f}")
