#!/usr/bin/env python3
"""element_crinkle_*: the fine crinkle paint of the element1971 housing, from one Qwen-Image 2.1 macro photograph.

  python3 tools/gen/element_crinkle.py     # reads tools/gen/raw/element_crinkle_s71002.png

The photograph has no usable absolute height, only the bright/dark shape of the grain, so it is treated as a height
*proxy*: flatten the slow lighting, make it periodic (periodic + smooth decomposition, Moisan 2011, then an
edge-weighted blend across the seams, which removes the discontinuity without a visible cross), normalise to a real
slope, and author albedo and roughness from the same field. Output 1024 px, tile 0.08 m (grain about 0.8 mm).

Files: public/assets/textures/element_crinkle_{albedo,normal,roughness,roughness_mips}.avif (conventions and AVIF quality as materials.py).
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import materials as M  # noqa: E402

RAW = os.path.join(HERE, "raw", "element_crinkle_s71002.png")
OUT = M.OUT
SIZE = 1024
T = 0.08                         # m per tile: cells of about 10 px are then about 0.8 mm across
RMS_SLOPE = 0.13                 # mean slope of the wrinkles; sets normal strength in physical terms
PUTTY = (0.255, 0.205, 0.145)    # linear base colour, read against the photographs through ACES under the studio key


def periodic_component(u):
    """Moisan's periodic plus smooth decomposition: u minus the smooth field that carries the boundary mismatch."""
    h, w = u.shape
    v = np.zeros_like(u)
    a = u[-1, :] - u[0, :]
    b = u[:, -1] - u[:, 0]
    v[0, :] += a; v[-1, :] -= a
    v[:, 0] += b; v[:, -1] -= b
    k = 2 * np.cos(2 * np.pi * np.fft.fftfreq(w)[None, :]) + 2 * np.cos(2 * np.pi * np.fft.fftfreq(h)[:, None]) - 4
    k[0, 0] = 1
    s = np.fft.ifft2(np.fft.fft2(v) / k).real
    return u - s


def seam_fade(u, band=48):
    """The periodic component is continuous but the grain still meets its opposite edge; cross-blend it there."""
    h, w = u.shape
    out = u.copy()
    r = np.roll(u, (h // 2, w // 2), (0, 1))
    wx = np.minimum(np.arange(w), w - 1 - np.arange(w)).astype(np.float32)
    wy = np.minimum(np.arange(h), h - 1 - np.arange(h)).astype(np.float32)
    mask = np.clip(np.minimum.outer(wy, wx) / band, 0, 1)
    mask = mask * mask * (3 - 2 * mask)
    return out * mask + r * (1 - mask)


def main():
    img = np.asarray(Image.open(RAW).convert("L").resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float32) / 255
    low = ndimage.gaussian_filter(img, 40, mode="reflect")     # the macro's slow illumination and vignette
    u = (img - low) / (low + 1e-3)
    u = ndimage.gaussian_filter(u, 0.7, mode="reflect")        # rings left by the VAE
    u = periodic_component(u)
    u = seam_fade(u)
    u -= u.mean()
    px = T / SIZE
    # Scale so the RMS of the forward differences is the wanted slope.
    dx = np.roll(u, -1, 1) - u
    dy = np.roll(u, -1, 0) - u
    h = u * RMS_SLOPE * px / float(np.sqrt((dx * dx + dy * dy).mean()))
    n = M.normal_from_height(h, T, SIZE)
    ridge = M.smooth(-1.2, 1.2, u / (u.std() + 1e-9))
    valley = 1 - ridge
    albedo = np.dstack([np.full((SIZE, SIZE), c, np.float32) for c in PUTTY])
    albedo = albedo * (0.90 + 0.14 * ridge)[..., None]          # paint thins and pales very slightly on the ridges
    albedo *= (0.995 + 0.012 * ndimage.gaussian_filter(np.random.default_rng(71002).standard_normal((SIZE, SIZE)), 60, mode="wrap") * 90)[..., None]
    rough = 0.50 + 0.10 * ridge - 0.04 * valley
    chain = M.roughness_chain(np.clip(rough, 0.3, 0.8), n)
    M.save(os.path.join(OUT, "element_crinkle_albedo.avif"), M.linear_to_srgb(albedo), "albedo")
    M.save(os.path.join(OUT, "element_crinkle_normal.avif"), n * 0.5 + 0.5, "normal")
    M.save(os.path.join(OUT, "element_crinkle_roughness.avif"), chain[0], "roughness")
    M.save(os.path.join(OUT, "element_crinkle_roughness_mips.avif"), M.mip_atlas(chain), "roughness_mips")
    print(f"element_crinkle: rms slope {np.sqrt(((1 - n[..., 2] ** 2) / n[..., 2] ** 2).mean()):.3f}, albedo {albedo.reshape(-1, 3).mean(axis=0).round(3)}, rough {chain[0].mean():.3f}..{chain[5].mean():.3f}")


if __name__ == "__main__":
    main()
