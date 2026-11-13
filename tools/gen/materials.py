#!/usr/bin/env python3
"""Authored, physically-based texture sets, built procedurally from spectra, cells and strokes: no image is
derived from a photograph's luminance. Heights are in metres at a known tile size, so normals are true slopes.

  python3 tools/gen/materials.py [set ...]

Writes public/assets/textures/<set>_{albedo,normal,roughness,metalness}.avif (2048 px, tileable; sets no machine
draws, UNSHIPPED, go to tools/gen/out/textures/ instead) and
<set>_roughness_mips.avif, a mip atlas (see docs/assets.md) whose roughness grows with the normal variance lost at
each level, so glints turn into broader highlights at distance instead of aliasing.

Conventions: albedo sRGB, base colour holding F0 for metals (linear F0 from published n,k data); normal +G up;
roughness is perceptual; metalness 0..1. numpy, scipy, Pillow only.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

OUT = os.environ.get("TEXTURE_OUT") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "assets", "textures"))
# Sets no machine draws are written outside public/ (not deployed, not committed): kept for previews and later use.
UNSHIPPED = {"wrinkle_paint", "nickel_worn", "key_glass", "japanned_enamel", "ribbon_cloth"}
OUT_UNSHIPPED = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "textures"))


def out_dir(name):
    d = OUT_UNSHIPPED if name in UNSHIPPED and not os.environ.get("TEXTURE_OUT") else OUT
    os.makedirs(d, exist_ok=True)
    return d
SIZE = 2048
MAX_SIZE = 2048   # largest file written; a set authored larger (walnut_desk) is filtered down to this

# AVIF (AV1, 4:4:4) quality per map, chosen against the float source: each map's error is at or below what the
# previous JPEG files (q92-95) had, at a quarter to a tenth of the size. See docs/assets.md.
QUALITY = {"albedo": 80, "normal": 85, "roughness": 85, "metalness": 80, "roughness_mips": 85}

# Linear-light F0 (normal incidence reflectance) of the metals.
F0 = {
    "nickel": (0.660, 0.609, 0.526),
    "chrome": (0.549, 0.556, 0.554),
    "aluminium": (0.913, 0.922, 0.924),
    "iron": (0.560, 0.570, 0.580),
    "brass": (0.910, 0.778, 0.423),
}


def rng_for(name):
    return np.random.default_rng(abs(hash_str(name)) % (2 ** 32))


def hash_str(s):
    h = 5381
    for c in s:
        h = (h * 33 + ord(c)) & 0xffffffff
    return h


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def spectral(rng, lam_min, lam_max, size=SIZE):
    """Periodic Gaussian noise with energy between wavelengths lam_min and lam_max (pixels), RMS 1."""
    f = np.fft.fftfreq(size)
    r = np.hypot(*np.meshgrid(f, f))
    r[0, 0] = 1
    lo, hi = 1 / lam_max, 1 / lam_min
    k = np.exp(-((np.log(r) - np.log(np.sqrt(lo * hi))) / (0.5 * np.log(hi / lo) + 0.12)) ** 2)
    k[0, 0] = 0
    z = rng.standard_normal((size, size)) + 1j * rng.standard_normal((size, size))
    x = np.real(np.fft.ifft2(np.fft.fft2(z) * k))
    return (x - x.mean()) / (x.std() + 1e-9)


def directional(rng, lam_along, lam_across, angle, size=SIZE):
    """Periodic noise stretched along a direction (rolling lines, grinding, brushed streaks), RMS 1."""
    f = np.fft.fftfreq(size)
    fx, fy = np.meshgrid(f, f)
    c, s = np.cos(angle), np.sin(angle)
    along = fx * c + fy * s
    across = -fx * s + fy * c
    k = np.exp(-(along * lam_along) ** 2 - (across * lam_across) ** 2)
    k[0, 0] = 0
    z = rng.standard_normal((size, size)) + 1j * rng.standard_normal((size, size))
    x = np.real(np.fft.ifft2(np.fft.fft2(z) * k))
    return (x - x.mean()) / (x.std() + 1e-9)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(x, s):
    return ndimage.gaussian_filter(x, s, mode="wrap")


def cells(rng, n, size=SIZE):
    """Periodic Voronoi: returns (distance to the nearest edge in pixels, cell id)."""
    pts = rng.random((n, 2)) * size
    tree = cKDTree(pts, boxsize=size)
    yy, xx = np.mgrid[0:size, 0:size]
    q = np.column_stack((xx.ravel() + 0.5, yy.ravel() + 0.5)) % size
    d, i = tree.query(q, k=2, workers=-1)
    edge = (d[:, 1] - d[:, 0]).reshape(size, size) * 0.5
    return edge, i[:, 0].reshape(size, size)


def strokes(rng, n, length, angle=None, spread=np.pi, width=1, curve=0.0, size=SIZE):
    """Periodic line drawing (float image): random scratches or fibres of a given length in pixels."""
    im = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y = rng.random(2) * size
        a = (rng.random() * 2 * np.pi) if angle is None else angle + rng.normal(0, spread)
        L = length * (0.3 + 1.4 * rng.random())
        k = curve * rng.normal() / max(L, 1)
        v = int(40 + 215 * rng.random())
        pts = [(x, y)]
        for _s in range(8):
            a += k * L / 8
            x += np.cos(a) * L / 8
            y += np.sin(a) * L / 8
            pts.append((x, y))
        for ox in (-size, 0, size):
            for oy in (-size, 0, size):
                if min(p[0] + ox for p in pts) < size and max(p[0] + ox for p in pts) > 0 \
                        and min(p[1] + oy for p in pts) < size and max(p[1] + oy for p in pts) > 0:
                    d.line([(p[0] + ox, p[1] + oy) for p in pts], fill=v, width=width)
    return np.asarray(im, dtype=np.float32) / 255


def normal_from_height(h, tile_m, size=SIZE):
    """Unit normal map from height in metres at tile size tile_m. OpenGL convention."""
    px = tile_m / size
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 / px
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 / px
    n = np.dstack((-dx, dy, np.ones_like(h)))
    return n / np.linalg.norm(n, axis=2, keepdims=True)


def perturb_normals(n, mask, sx, sy):
    """Tilts normals where mask is 1 by slopes sx, sy (per-flake orientation)."""
    out = n.copy()
    out[..., 0] += mask * sx
    out[..., 1] += mask * sy
    return out / np.linalg.norm(out, axis=2, keepdims=True)


def flakes(rng, density, radius, size=SIZE):
    """Periodic disc mask of flakes, plus a per-flake random id field in [-1, 1] for two axes."""
    count = int(density * size * size / (np.pi * radius * radius))
    pts = rng.random((count, 2)) * size
    tree = cKDTree(pts, boxsize=size)
    yy, xx = np.mgrid[0:size, 0:size]
    d, i = tree.query(np.column_stack((xx.ravel() + 0.5, yy.ravel() + 0.5)) % size, k=1, workers=-1)
    mask = smooth(radius, radius * 0.45, d.reshape(size, size))
    rnd = rng.random((count, 2)) * 2 - 1
    idx = i.reshape(size, size)
    return mask, rnd[idx, 0], rnd[idx, 1], idx


# ---- Filtering roughness against normal variance ---------------------------------------------------------

def downsample(x):
    """Box halving with wrap (the arrays are tileable, side even)."""
    return 0.25 * (x + np.roll(x, -1, 0) + np.roll(x, -1, 1) + np.roll(np.roll(x, -1, 0), -1, 1))[::2, ::2]


def toksvig(alpha2, nlen):
    """alpha^2 widened by the variance implied by a shortened mean normal (Toksvig)."""
    nlen = np.clip(nlen, 1e-3, 1.0)
    var = (1.0 - nlen) / nlen
    return np.clip(alpha2 + 2.0 * var, 0.0, 1.0)


def roughness_chain(rough, normal):
    """Mip chain [L0, L1, ...] of perceptual roughness, with the normal variance inside each footprint added in."""
    a2 = np.clip(rough, 0.02, 1.0) ** 4
    n = normal.copy()
    # L0: absorb what the bilinear footprint already loses, measured at one texel.
    avg = np.dstack([blur(n[..., c], 0.7) for c in range(3)])
    chain = [np.sqrt(np.sqrt(toksvig(a2, np.linalg.norm(avg, axis=2))))]
    while a2.shape[0] > 1:
        a2 = downsample(a2)
        n = np.dstack([downsample(n[..., c]) for c in range(3)])
        nlen = np.linalg.norm(n, axis=2)
        chain.append(np.sqrt(np.sqrt(toksvig(a2, nlen))))
    return chain


def mip_atlas(chain):
    """Classic mip atlas: L0 at the left, the rest stacked in a column of width L0/2, row sizes halving."""
    w0 = chain[0].shape[1]
    atlas = np.zeros((w0, w0 + w0 // 2), np.float32)
    atlas[:w0, :w0] = chain[0]
    y = 0
    for m in chain[1:]:
        h, w = m.shape
        atlas[y:y + h, w0:w0 + w] = m
        y += h
    return atlas


def save(path, a, kind):
    """AVIF, 4:4:4; a 2-D array is written as greyscale. kind is a QUALITY key."""
    a = np.clip(a, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(path, quality=QUALITY[kind], subsampling="4:4:4", speed=4)


def downsample_n(x):
    """downsample() over each channel of an (h, w) or (h, w, c) array."""
    return downsample(x) if x.ndim == 2 else np.dstack([downsample(x[..., c]) for c in range(x.shape[2])])


def write(name, albedo_linear, normal, rough, metal, max_size=MAX_SIZE):
    chain = roughness_chain(rough, normal)
    # Filter a larger set down to MAX_SIZE: albedo averaged in linear light, normals averaged then renormalised,
    # and roughness taken from its own chain, so the variance of the dropped detail stays in the roughness.
    while albedo_linear.shape[0] > max_size:
        albedo_linear, metal = downsample_n(albedo_linear), downsample_n(metal)
        normal = downsample_n(normal)
        normal /= np.linalg.norm(normal, axis=2, keepdims=True)
        chain = chain[1:]
    out = out_dir(name)
    save(os.path.join(out, f"{name}_albedo.avif"), linear_to_srgb(albedo_linear), "albedo")
    save(os.path.join(out, f"{name}_normal.avif"), normal * 0.5 + 0.5, "normal")
    save(os.path.join(out, f"{name}_roughness.avif"), chain[0], "roughness")
    save(os.path.join(out, f"{name}_metalness.avif"), metal if metal.ndim == 2 else np.mean(metal, axis=2), "metalness")
    save(os.path.join(out, f"{name}_roughness_mips.avif"), mip_atlas(chain), "roughness_mips")
    print(f"{name}: rough {chain[0].mean():.3f}..L5 {chain[5].mean():.3f}, normal z mean {normal[..., 2].mean():.4f}, "
          f"metal {np.mean(metal):.3f}, albedo {albedo_linear.reshape(-1, 3).mean(axis=0).round(3)}", flush=True)


def col(rgb, x=None):
    a = np.broadcast_to(np.array(rgb, dtype=np.float32), (SIZE, SIZE, 3)).copy()
    return a if x is None else a * x[..., None]


# ---- The materials ----------------------------------------------------------------------------------------

def powder_coat():
    """Charcoal electrostatic powder coat on steel: orange peel, a fine metallic flake, microscale haze."""
    T = 0.08
    r = rng_for("powder")
    peel = spectral(r, 0.0016 / (T / SIZE), 0.0045 / (T / SIZE))
    h = peel * 3.5e-6 + spectral(r, 0.0002 / (T / SIZE), 0.0006 / (T / SIZE)) * 0.15e-6
    n = normal_from_height(h, T)
    fm, fx, fy, _ = flakes(r, 0.028, 1.5)
    n = perturb_normals(n, fm, fx * 0.16, fy * 0.16)
    base = col((0.030, 0.032, 0.037)) * (1 + 0.012 * blur(spectral(r, 300, 900), 2))[..., None]
    flake = col((0.42, 0.43, 0.46)) * (0.4 + 0.6 * np.abs(fx))[..., None]
    alb = base * (1 - fm[..., None]) + flake * fm[..., None]
    rough = 0.43 + 0.012 * spectral(r, 90, 500) + 0.012 * peel - fm * 0.14
    metal = fm * 0.55
    write("powder_coat", alb, n, np.clip(rough, 0.2, 0.7), metal)


def wrinkle_paint():
    """Wrinkle finish: a Swift-Hohenberg labyrinth pattern, ridges matte and valleys glossier."""
    T = 0.06
    r = rng_for("wrinkle")
    lam = 0.00135 / (T / SIZE)
    f = np.fft.fftfreq(SIZE)
    k2 = (2 * np.pi * np.hypot(*np.meshgrid(f, f))) ** 2
    k0 = (2 * np.pi / lam) ** 2
    u = r.standard_normal((SIZE, SIZE)) * 0.1
    L = -(k2 - k0) ** 2 / (k0 * k0)
    eps = 0.6
    dt = 0.45
    for _ in range(90):
        un = np.fft.fft2(u)
        nl = np.fft.fft2(eps * u - u ** 3)
        u = np.real(np.fft.ifft2((un + dt * nl) / (1 - dt * L)))
    u /= u.std() + 1e-9
    warp = blur(spectral(r, 40, 400) * 25, 2)
    h = (blur(u, 1.2) * 28e-6) + spectral(r, 2, 8) * 1.2e-6
    n = normal_from_height(h, T)
    ridge = smooth(-0.3, 1.0, u)
    alb = col((0.022, 0.022, 0.024)) * (0.9 + 0.3 * ridge)[..., None]
    rough = 0.42 + 0.20 * ridge + 0.03 * spectral(r, 12, 90) + warp * 0.0
    write("wrinkle_paint", alb, n, np.clip(rough, 0.3, 0.8), np.zeros((SIZE, SIZE), np.float32))


def bead_blasted_aluminium():
    """Bead-blasted aluminium: overlapping micro craters, statistically isotropic, satin. Metal throughout."""
    T = 0.04
    r = rng_for("bead")
    px = T / SIZE
    d = spectral(r, 0.00005 / px, 0.00018 / px)
    craters, _ = cells(r, 26000)
    pits = smooth(0.0, 5.0, craters)
    h = -(1 - pits) * 2.2e-6 + d * 0.8e-6
    n = normal_from_height(h, T)
    # Normal detail stays deliberately shallow: at this scale the look is mostly carried by roughness.
    n = normal_from_height(blur(h, 0.6), T)
    tint = 0.97 + 0.015 * spectral(r, 80, 300)
    alb = col(F0["aluminium"], tint * (0.94 + 0.05 * pits))
    rough = 0.47 + 0.05 * (1 - pits) + 0.018 * spectral(r, 60, 240)
    write("bead_blasted_aluminium", alb, n, np.clip(rough, 0.36, 0.62), np.ones((SIZE, SIZE), np.float32))


def _scratch_layers(r, count, length, width, angle=None, spread=np.pi):
    return np.clip(blur(strokes(r, count, length, angle=angle, spread=spread, width=width), 0.5), 0, 1)


def nickel_polished():
    """Polished nickel plate: rouge haze, random buffing arcs, very fine micro-scratches that raise roughness."""
    T = 0.06
    r = rng_for("nickel_p")
    micro = _scratch_layers(r, 5000, 170, 1)
    fine = _scratch_layers(r, 1500, 500, 1)
    buff = directional(r, 300, 6, 0.3) * 0.5 + spectral(r, 100, 500) * 0.5
    h = -(micro * 0.09e-6 + fine * 0.18e-6) + buff * 0.05e-6
    n = normal_from_height(h, T)
    haze = np.clip(0.5 + 0.5 * spectral(r, 90, 700) * 0.6, 0, 1)
    alb = col(F0["nickel"], np.clip(1.0 - 0.03 * haze, 0, 1))
    rough = 0.115 + 0.035 * haze + 0.19 * np.clip(micro, 0, 1) + 0.11 * np.clip(fine, 0, 1)
    write("nickel_polished", alb, n, np.clip(rough, 0.09, 0.42), np.ones((SIZE, SIZE), np.float32))


def nickel_worn():
    """Worn nickel plating: rubbed-through patches (brass strike, then steel), haze, dark corrosion specks."""
    T = 0.1
    r = rng_for("nickel_w")
    field = 0.55 * spectral(r, 260, 1000) + 0.32 * spectral(r, 90, 300) + 0.13 * directional(r, 800, 40, 0.0)
    wear = smooth(0.85, 1.35, field)                  # the areas that see the fingers and the cloth
    strike = smooth(1.1, 1.6, field + 0.25 * spectral(r, 12, 60))
    sc_a = _scratch_layers(r, 9000, 230, 1, angle=0.05, spread=0.4)
    sc_b = _scratch_layers(r, 3500, 110, 1)
    h = -(sc_a * 0.35e-6 + sc_b * 0.25e-6) * (1 + 1.2 * wear) + spectral(r, 25, 120) * 0.25e-6
    h -= smooth(0.86, 1.05, field) * 0.15e-6              # edge of the plating
    # Pits and corrosion specks: non-metallic, dark and rough, sparse where the nickel is thin.
    pit_mask, _, _, _ = flakes(r, 0.0035, 2.4)
    pit = pit_mask * smooth(0.5, 1.1, field + 0.3)
    h -= pit * 2.5e-6
    n = normal_from_height(h, T)
    base = col(F0["nickel"])
    under = col(F0["brass"]) * (1 - strike[..., None]) + col(F0["iron"]) * strike[..., None]
    tarnish = 0.84 + 0.14 * smooth(-1.0, 1.0, spectral(r, 40, 500))
    alb = (base * (1 - wear[..., None]) + under * wear[..., None]) * tarnish[..., None]
    alb = alb * (1 - pit[..., None]) + col((0.06, 0.05, 0.04)) * pit[..., None]
    rough = (0.26 + 0.12 * wear + 0.08 * np.clip(0.5 + 0.5 * spectral(r, 25, 200), 0, 1)
             + 0.18 * sc_a + 0.10 * sc_b)
    rough = rough * (1 - pit) + 0.82 * pit
    metal = np.clip(1 - pit, 0, 1)
    write("nickel_worn", alb, n, np.clip(rough, 0.14, 0.9), metal)


def chrome_steel():
    """Bright chromed steel: very low roughness and mirror-grade polish with only a trace of haze."""
    T = 0.06
    r = rng_for("chrome")
    micro = _scratch_layers(r, 1400, 240, 1)
    pits, _, _, _ = flakes(r, 0.0006, 1.8)
    h = -(micro * 0.03e-6) - pits * 0.6e-6 + spectral(r, 150, 700) * 0.04e-6
    n = normal_from_height(h, T)
    alb = col(F0["chrome"], 1 - pits * 0.5)
    rough = 0.055 + 0.012 * spectral(r, 90, 500) + 0.13 * np.clip(micro, 0, 1) + pits * 0.25
    write("chrome_steel", alb, n, np.clip(rough, 0.04, 0.4), np.ones((SIZE, SIZE), np.float32))


def key_glass():
    """A glass-capped key top: tiny surface ripple and bubbles in glass over ivory card. Dielectric."""
    T = 0.03
    r = rng_for("keyglass")
    rip = spectral(r, 120, 800)
    bub, _, _, _ = flakes(r, 0.0007, 3.8)
    h = rip * 0.25e-6 - bub * 0.25e-6 + spectral(r, 8, 40) * 0.02e-6
    n = normal_from_height(blur(h, 0.8), T)
    alb = col((0.78, 0.74, 0.63)) * (0.97 + 0.02 * spectral(r, 80, 700))[..., None]
    alb = alb * (1 - 0.35 * bub[..., None])
    rough = 0.05 + 0.012 * spectral(r, 60, 350) + 0.1 * bub
    write("key_glass", alb, n, np.clip(rough, 0.03, 0.25), np.zeros((SIZE, SIZE), np.float32))


def blued_spring_steel():
    """Spring steel, heat blued: a thin oxide film over fine rolling lines. Metal throughout."""
    T = 0.05
    r = rng_for("blued")
    lines = directional(r, 900, 2.5, 0.0)
    temper = np.clip(0.5 + 0.18 * spectral(r, 700, 2000), 0, 1)
    h = lines * 0.18e-6 + spectral(r, 90, 400) * 0.12e-6
    n = normal_from_height(h, T)
    deep = col((0.05, 0.075, 0.15))
    straw = col((0.09, 0.115, 0.20))
    alb = deep * (1 - temper[..., None]) + straw * temper[..., None]
    rough = 0.30 + 0.05 * spectral(r, 90, 500) + 0.06 * np.abs(lines)
    write("blued_spring_steel", alb, n, np.clip(rough, 0.2, 0.5), np.ones((SIZE, SIZE), np.float32))


def japanned_enamel():
    """Black japanned enamel on cast iron: deep gloss, orange peel, fine crazing, chips through to the iron."""
    T = 0.2
    r = rng_for("japan")
    px = T / SIZE
    edge, cell = cells(r, 3400)
    crack = smooth(1.1, 0.3, edge)
    breaks = smooth(0.1, 0.8, spectral(r, 100, 500))
    crack = crack * breaks
    h = spectral(r, 0.003 / px, 0.009 / px) * 5e-6 - crack * 2.5e-6
    chips, _, _, _ = flakes(r, 0.0004, 4.0)
    chip = chips * smooth(0.2, 1.2, spectral(r, 60, 300))
    h -= chip * 14e-6
    n = normal_from_height(h, T)
    alb = col((0.0060, 0.0060, 0.0065))
    alb = alb * (1 - 0.5 * crack[..., None]) + col((0.012, 0.010, 0.008)) * 0.5 * crack[..., None]
    alb = alb * (1 - chip[..., None]) + col((0.24, 0.23, 0.22)) * chip[..., None]
    rough = 0.20 + 0.015 * spectral(r, 200, 900) + 0.34 * crack + 0.42 * chip
    metal = chip * 0.85
    write("japanned_enamel", alb, n, np.clip(rough, 0.16, 0.8), metal)


def vulcanised_rubber():
    """Hard aged rubber: fine grinding stipple and light oxidation bloom. Dielectric."""
    T = 0.1
    r = rng_for("rubber")
    px = T / SIZE
    h = spectral(r, 0.00025 / px, 0.0012 / px) * 2.5e-6 + directional(r, 700, 3, 0.0) * 0.6e-6
    n = normal_from_height(h, T)
    bloom = smooth(-0.4, 1.3, spectral(r, 200, 900))
    alb = col((0.015, 0.015, 0.016)) * (1.0 + 0.25 * bloom)[..., None]
    rough = 0.78 + 0.08 * bloom + 0.02 * spectral(r, 25, 120)
    write("vulcanised_rubber", alb, n, np.clip(rough, 0.6, 0.95), np.zeros((SIZE, SIZE), np.float32))


def green_felt():
    """Green felt: a dense mat of short curved fibres."""
    T = 0.08
    r = rng_for("felt")
    f = blur(strokes(r, 180000, 95, width=1, curve=1.6), 0.6)
    f = f / (f.std() + 1e-6)
    h = f * 22e-6 + spectral(r, 90, 500) * 18e-6
    n = normal_from_height(h, T)
    shade = 0.75 + 0.5 * np.clip(0.5 + 0.2 * f, 0, 1)
    alb = col((0.022, 0.085, 0.040)) * shade[..., None]
    rough = 0.95 + 0.03 * spectral(r, 12, 80)
    write("green_felt", alb, n, np.clip(rough, 0.85, 1.0), np.zeros((SIZE, SIZE), np.float32))


def paper_fibre():
    """Laid writing paper: cellulose fibre mat with shallow laid lines. Dielectric."""
    T = 0.2159
    r = rng_for("paper")
    f = blur(strokes(r, 240000, 80, width=1, curve=1.0), 0.8)
    f = f / (f.std() + 1e-6)
    y = np.arange(SIZE, dtype=np.float32)[..., None] * np.ones((SIZE, SIZE), np.float32).T[0:1].T
    laid = 0.5 + 0.5 * np.cos(2 * np.pi * y * 256 / SIZE)
    h = f * 2.2e-6 + laid * 2.8e-6 + spectral(r, 150, 900) * 3e-6
    n = normal_from_height(h, T)
    alb = col((0.86, 0.83, 0.74)) * (0.965 + 0.01 * f + 0.012 * laid)[..., None]
    rough = 0.92 + 0.02 * spectral(r, 20, 120) - 0.03 * laid
    write("paper_fibre", alb, n, np.clip(rough, 0.8, 1.0), np.zeros((SIZE, SIZE), np.float32))


def ribbon_cloth():
    """Inked plain-weave cotton ribbon, 40 threads across the tile (thread pitch from the machine definition)."""
    pitch = 0.00062
    threads = 40
    T = threads * pitch
    r = rng_for("ribbon")
    n_tile = SIZE / threads
    yy, xx = np.mgrid[0:SIZE, 0:SIZE] + 0.5
    u = (xx / n_tile) % 2
    v = (yy / n_tile) % 2
    ix = np.floor(xx / n_tile).astype(int)
    iy = np.floor(yy / n_tile).astype(int)
    warp_top = (ix + iy) % 2 == 0
    fx = (xx / n_tile) % 1 - 0.5
    fy = (yy / n_tile) % 1 - 0.5
    warp = np.sqrt(np.clip(1 - (2 * fx) ** 2, 0, 1)) * np.cos(np.pi * fy) ** 2
    weft = np.sqrt(np.clip(1 - (2 * fy) ** 2, 0, 1)) * np.cos(np.pi * fx) ** 2
    height = np.where(warp_top, warp, weft * 0.92) * 95e-6
    h = height + spectral(r, 10, 60) * 2e-6
    n = normal_from_height(blur(h, 1.2), T)
    worn = blur(spectral(r, 100, 900), 8)
    alb = col((0.010, 0.010, 0.011)) * (1 + 1.2 * np.where(warp_top, warp, weft)[..., None])
    rough = 0.72 - 0.22 * np.where(warp_top, warp, weft) + 0.02 * worn
    write("ribbon_cloth", alb, n, np.clip(rough, 0.4, 0.9), np.zeros((SIZE, SIZE), np.float32))


def walnut_desk():
    """Solid walnut desk top, French polished and aged: glued-up boards, each cut from its own log, grain along U.

    The tile is larger than the desk, so nothing repeats across it. Each board gets its own ring pattern from a
    real sawing model: the log's rings are cylinders round the pith, the board a plane through them, so its
    ring coordinate is the distance from the pith. Where the board's depth from the pith varies along its length
    (the log tapers and wanders) the rings close in the cathedral shapes of plain-sawn walnut.
    """
    T, S = 2.2, 4096
    px = T / S
    r = rng_for("walnut")
    # Board widths, jittered then rescaled so the boards close the tile exactly.
    w = []
    while sum(w) < T - 0.1:
        w.append(float(r.uniform(0.13, 0.24)))
    w = np.array(w) * T / sum(w)
    edges = np.round(np.cumsum(np.r_[0, w]) / px).astype(int)
    edges[-1] = S
    print(f"  walnut: {len(w)} boards, widths {w.min():.3f}..{w.max():.3f} m", flush=True)

    u = np.arange(S) * px
    wander = directional(r, 0.4 / px, 0.035 / px, 0, S) * 0.0065   # the grain drifts a few mm, long along its length
    fine_wander = directional(r, 0.09 / px, 0.012 / px, 0, S) * 0.0006
    fibre = directional(r, 90, 1.25, 0, S)
    pore_n = directional(r, 16, 0.75, 0, S)
    streak = directional(r, 900, 14, 0, S)
    mottle = spectral(r, 0.05 / px, 0.4 / px, S)
    ring_val = r.random(8192)                                 # tone of a ring, blended between rings below
    ring_lat = r.random(8192)                                 # per-ring latewood weight

    N = np.zeros((S, S), np.float32)
    tone = np.zeros((S, S, 3), np.float32)
    seam = np.zeros((S, S), np.float32)
    board_h = np.zeros((S, S), np.float32)
    fibre2, pore2, streak2 = [np.zeros((S, S), np.float32) for _ in range(3)]
    for b in range(len(w)):
        y0, y1 = int(edges[b]), int(edges[b + 1])
        V = (np.arange(y0, y1) + 0.5 - 0.5 * (y0 + y1)) * px
        rows = np.arange(y0, y1)
        du, dv = r.integers(0, S, 2)
        # The board sits somewhere on the log: closer to the pith gives tight cathedrals, further out straighter grain.
        depth = r.uniform(0.055, 0.14) if r.random() < 0.65 else r.uniform(0.2, 0.38)   # plain sawn, or nearly quartered
        centre = r.uniform(-0.45, 0.45) * w[b]
        h = depth * np.ones(S)
        for k in range(1, 4):
            h += 0.07 * depth / k * r.uniform(0.4, 1.0) * np.sin(2 * np.pi * (k * u / T + r.random()))   # slow taper: long flames
        rings_per_m = r.uniform(190, 330)
        VV, HH = np.meshgrid(V, h, indexing="ij")
        ix = np.ix_((rows + dv) % S, (np.arange(S) + du) % S)
        rad = np.sqrt(HH ** 2 + (VV - centre + wander[ix] + fine_wander[ix]) ** 2)
        N[y0:y1] = (rad + b * 3.7) * rings_per_m
        fibre2[y0:y1], pore2[y0:y1], streak2[y0:y1] = fibre[ix], pore_n[ix], streak[ix]
        t = 1 + r.normal(0, 0.055)
        tone[y0:y1] = np.array([t, t * (1 + r.normal(0, 0.012)), t * (1 + r.normal(0, 0.025))], np.float32)
        board_h[y0:y1] = r.normal(0, 6e-6)
        # glue line along the board's lower edge, about 0.4 mm wide (the texture's own resolution limit)
        seam[max(y0 - 1, 0):y0 + 1] = 1.0
    seam[-1:] = 1.0
    N = np.asarray(N, np.float64)
    idx = np.floor(N).astype(np.int64) % 8192
    frac = N - np.floor(N)

    late = smooth(0.3, 0.97, frac) * (1 - smooth(0.97, 1.0, frac)) * (0.35 + 0.65 * ring_lat[idx])   # dense dark late wood
    early = 1 - smooth(0.0, 0.34, frac)                                                              # porous early wood
    val = ring_val[idx] * (1 - frac) + ring_val[(idx + 1) % 8192] * frac                             # rings blend, no hard steps
    val = 0.8 * val + 0.2 * (mottle * 0.5 + 0.5)

    t = 0.53 + 0.24 * (val - 0.5) + 0.06 * fibre2 + 0.09 * np.clip(streak2, -2, 2) - 0.3 * late
    t = np.clip(t, 0.0, 1.0)[..., None]
    dark, light = np.array((0.034, 0.016, 0.0085), np.float32), np.array((0.27, 0.145, 0.072), np.float32)
    alb = (dark + (light - dark) * t ** 1.25) * tone
    pore = smooth(1.15 - 0.95 * early, 2.1 - 0.95 * early, pore2)                                    # vessels, densest in the early wood
    alb *= (1 - 0.58 * pore)[..., None]
    alb *= (1 - 0.65 * seam)[..., None]

    scr = strokes(r, 1400, 0.16 / px, angle=0.0, spread=0.45, width=1, curve=0.3, size=S)
    scr2 = strokes(r, 900, 0.05 / px, spread=np.pi, width=1, curve=0.5, size=S)
    wave = spectral(r, 0.05 / px, 0.4 / px, S)
    hgt = -6e-6 * late - 40e-6 * pore - 0.8e-6 * fibre2 - 2.8e-6 * scr - 1.6e-6 * scr2 + 22e-6 * wave - 45e-6 * blur(seam, 0.7) + board_h
    n = normal_from_height(hgt, T, S)
    rough = 0.325 + 0.018 * mottle + 0.03 * blur(spectral(r, 0.2 / px, 1.0 / px, S), 1) + 0.16 * pore + 0.1 * np.maximum(scr, scr2) \
        - 0.012 * late + 0.012 * spectral(r, 4, 30, S) + 0.14 * seam
    write("walnut_desk", alb, n, np.clip(rough, 0.2, 0.75), np.zeros((S, S), np.float32))


def wp_pebble():
    """The word processor's moulded covers (HW 1.8): a fine pebble grain, rounded bumps about 0.4 mm across standing
    out of a slightly rougher ground, with a soft sheen on their tops. Neutral albedo: the material colour gives Pearl
    White, Pebble Gray or the dark bezels. Written at 1024 px (the budget, architecture.md 12.3). Dielectric."""
    T = 0.05
    r = rng_for("wppebble")
    px = T / SIZE
    d, _ = cells(r, int((T / 0.00042) ** 2), SIZE)
    bumps = smooth(0.0, 9.0, d) ** 0.6                     # domes rising from each cell's edge
    h = bumps * 9e-6 + spectral(r, 0.00008 / px, 0.0003 / px) * 0.6e-6 + spectral(r, 0.003 / px, 0.02 / px) * 1.5e-6
    n = normal_from_height(blur(h, 0.7), T)
    alb = col((0.92, 0.92, 0.92)) * (0.985 + 0.02 * bumps + 0.01 * spectral(r, 200, 1200))[..., None]
    rough = 0.62 - 0.12 * bumps + 0.02 * spectral(r, 40, 300)
    write("wp_pebble", alb, n, np.clip(rough, 0.35, 0.8), np.zeros((SIZE, SIZE), np.float32), max_size=1024)


def wp_keycap():
    """Keycap plastic: a satin, finely sanded surface with faint sink marks; neutral albedo for the cap colour."""
    T = 0.03
    r = rng_for("wpkeycap")
    px = T / SIZE
    h = spectral(r, 0.00003 / px, 0.00015 / px) * 0.35e-6 + spectral(r, 0.002 / px, 0.012 / px) * 0.8e-6
    n = normal_from_height(h, T)
    alb = col((0.93, 0.93, 0.92)) * (0.99 + 0.01 * spectral(r, 100, 900))[..., None]
    rough = 0.42 + 0.03 * spectral(r, 30, 300)
    write("wp_keycap", alb, n, np.clip(rough, 0.3, 0.6), np.zeros((SIZE, SIZE), np.float32), max_size=1024)


SETS = [powder_coat, wrinkle_paint, bead_blasted_aluminium, nickel_polished, nickel_worn, chrome_steel, key_glass,
        blued_spring_steel, japanned_enamel, vulcanised_rubber, green_felt, paper_fibre, ribbon_cloth, walnut_desk,
        wp_pebble, wp_keycap]


# Recommended tile size and three.js MeshPhysicalMaterial parameters. Written to materials.json for the renderer.
PARAMS = {
    "powder_coat": {"tile": 0.08, "physical": {"metalness": 1, "roughness": 1, "clearcoat": 0.2, "clearcoatRoughness": 0.42, "ior": 1.5}, "note": "metalnessMap carries the flake; normalScale 1 is physically scaled"},
    "wrinkle_paint": {"tile": 0.06, "physical": {"metalness": 1, "roughness": 1, "ior": 1.5}, "note": "keep repeat honest, the labyrinth period is 1.35 mm"},
    "bead_blasted_aluminium": {"tile": 0.04, "physical": {"metalness": 1, "roughness": 1}, "note": "colour is measured F0, leave material.color white"},
    "nickel_polished": {"tile": 0.06, "physical": {"metalness": 1, "roughness": 1, "envMapIntensity": 1.1}, "note": "bright plating"},
    "nickel_worn": {"tile": 0.1, "physical": {"metalness": 1, "roughness": 1}, "note": "rubbed through to brass then steel; albedo holds F0 of each layer"},
    "chrome_steel": {"tile": 0.06, "physical": {"metalness": 1, "roughness": 1, "envMapIntensity": 1.15}},
    "key_glass": {"tile": 0.03, "physical": {"metalness": 0, "roughness": 1, "clearcoat": 1, "clearcoatRoughness": 0.02, "ior": 1.52, "specularIntensity": 1}, "note": "tint is the card under the glass; multiply the printed legend over albedo"},
    "blued_spring_steel": {"tile": 0.05, "physical": {"metalness": 1, "roughness": 1, "anisotropy": 0.55, "anisotropyRotation": 0}, "note": "rolling lines run along U"},
    "japanned_enamel": {"tile": 0.2, "physical": {"metalness": 1, "roughness": 1, "clearcoat": 1, "clearcoatRoughness": 0.07, "ior": 1.52}, "note": "metalnessMap marks chips through to the iron"},
    "vulcanised_rubber": {"tile": 0.1, "physical": {"metalness": 0, "roughness": 1, "ior": 1.52}},
    "green_felt": {"tile": 0.08, "physical": {"metalness": 0, "roughness": 1, "sheen": 0.35, "sheenRoughness": 0.65, "sheenColor": [0.1, 0.26, 0.13]}, "note": "sheen simulates the fibre halo"},
    "paper_fibre": {"tile": 0.2159, "physical": {"metalness": 0, "roughness": 1}, "note": "laid lines along U"},
    "walnut_desk": {"tile": 2.2, "physical": {"metalness": 0, "roughness": 1, "clearcoat": 0.45, "clearcoatRoughness": 0.2, "ior": 1.5}, "note": "2048 px (authored at 4096 and filtered down), 1.07 mm per texel; larger than the desk so it never repeats; grain along U; no metalnessMap needed"},
    "wp_pebble": {"tile": 0.05, "physical": {"metalness": 0, "roughness": 1, "ior": 1.49, "sheen": 0.2, "sheenRoughness": 0.6, "sheenColor": [0.8, 0.8, 0.78]}, "note": "1024 px; neutral albedo, colour in the material (Pearl White, Pebble Gray, dark mouldings)"},
    "wp_keycap": {"tile": 0.03, "physical": {"metalness": 0, "roughness": 1, "ior": 1.49}, "note": "1024 px; neutral albedo, colour in the material"},
    "ribbon_cloth": {"tile": 0.0248, "physical": {"metalness": 0, "roughness": 1, "sheen": 0.3, "sheenRoughness": 0.5, "sheenColor": [0.05, 0.05, 0.06]}, "note": "tile is 40 threads at the definition's pitch"},
}


def main():
    want = sys.argv[1:] or [f.__name__ for f in SETS]
    for f in SETS:
        if f.__name__ in want:
            f()
    with open(os.path.join(OUT, "materials.json"), "w") as fh:
        json.dump(PARAMS, fh, indent=1)


if __name__ == "__main__":
    main()
