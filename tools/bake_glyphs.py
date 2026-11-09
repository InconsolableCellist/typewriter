#!/usr/bin/env python3
"""Bakes type-slug faces into height fields: public/assets/glyphs.{bin,json}.
Run: uv run --with pillow --with scipy --with numpy tools/bake_glyphs.py FONT.ttf
Heights are 0..255 where 255 is the printing face and 0 is at or below the relief depth. The
shoulder is a true draft computed from the distance field, so wear and pressure act on a shape."""
import json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt as edt
sys.path
N, TEXEL_MM = 96, 0.05
# The first 80 are the machine's own slugs and must keep their indexes. The rest complete printable ASCII for
# terminal mode (src/terminal/charmap.js), where a donor bar prints them with a glyph override. Append only.
chars = "234567890-=qwertyuiop/asdfghjkl;zxcvbnm,.\"#$%_&'()*+QWERTYUIOP?ASDFGHJKL:ZXCVBNM"
chars += "1!@[]{}\\|~^<>`"
SS = 6
font = ImageFont.truetype(sys.argv[1], int(N * SS * 0.92))
SHOULDER_MM = 0.07
heights, areas = [], []
for c in chars:
    img = Image.new('L', (N * SS, N * SS), 0)
    d = ImageDraw.Draw(img)
    l, t, r, b = d.textbbox((0, 0), c, font=font)
    base = font.getmetrics()[0]
    # horizontally centred by advance, baseline fixed so case offsets and descenders are true
    adv = d.textlength(c, font=font)
    d.text(((N * SS - adv) / 2, N * SS * 0.72 - base), c, font=font, fill=255)
    a = np.asarray(img) > 127
    dist = edt(a) * (TEXEL_MM / SS)            # mm inside the stroke
    h = np.clip(dist / SHOULDER_MM, 0, 1)
    h = np.asarray(Image.fromarray((h * 255).astype('uint8')).resize((N, N), Image.BOX))
    heights.append(h); areas.append(float((h > 200).sum()) * TEXEL_MM ** 2)
np.stack(heights).astype('uint8').tofile('public/assets/glyphs.bin')
json.dump({'N': N, 'texelMm': TEXEL_MM, 'baselineV': 0.72, 'chars': chars, 'faceAreaMm2': areas}, open('public/assets/glyphs.json', 'w'))
print(len(chars), 'glyphs; face area mm2: min', min(areas), 'max', max(areas))
