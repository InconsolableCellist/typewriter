#!/usr/bin/env python3
"""Bakes type faces into height fields.
Run: uv run --with pillow --with scipy --with numpy tools/bake_glyphs.py FONT.ttf [--set wp]
Default set: the typewriter slugs, public/assets/glyphs.{bin,json} at 10 pitch.
--set wp: the printwheel's petals (docs/displaywriter/architecture.md 12.3), public/assets/glyphs_wp.{gz.bin,json}
at 12 pitch: the 94 distinct characters of the 96-character keyboard, gzipped.
Heights are 0..255 where 255 is the printing face and 0 is at or below the relief depth. The
shoulder is a true draft computed from the distance field, so wear and pressure act on a shape."""
import gzip, json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt as edt
N, TEXEL_MM = 96, 0.05
wp = '--set' in sys.argv and sys.argv[sys.argv.index('--set') + 1] == 'wp'
if wp:
    # Every character on the 96-character keyboard (hardware.md 2.6); the comma and period keys print the same
    # character in both cases, so 94 faces serve 96 petals.
    chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890" + "°±!@#$%¢&*()_-+=¼½[]:;\"'³²¶§,.?/"
    scale = 10 / 12                            # 12 pitch from the same font
else:
    # The first 80 are the machine's own slugs and must keep their indexes. The rest complete printable ASCII for
    # terminal mode (src/terminal/charmap.js), where a donor bar prints them with a glyph override. Append only.
    chars = "234567890-=qwertyuiop/asdfghjkl;zxcvbnm,.\"#$%_&'()*+QWERTYUIOP?ASDFGHJKL:ZXCVBNM"
    chars += "1!@[]{}\\|~^<>`"
    scale = 1
assert len(set(chars)) == len(chars)
SS = 6
font = ImageFont.truetype(sys.argv[1], int(N * SS * 0.92 * scale))
SHOULDER_MM = 0.07
heights, areas = [], []
for c in chars:
    img = Image.new('L', (N * SS, N * SS), 0)
    d = ImageDraw.Draw(img)
    base = font.getmetrics()[0]
    # horizontally centred by advance, baseline fixed so case offsets and descenders are true
    adv = d.textlength(c, font=font)
    d.text(((N * SS - adv) / 2, N * SS * 0.72 - base), c, font=font, fill=255)
    a = np.asarray(img) > 127
    dist = edt(a) * (TEXEL_MM / SS)            # mm inside the stroke
    h = np.clip(dist / SHOULDER_MM, 0, 1)
    h = np.asarray(Image.fromarray((h * 255).astype('uint8')).resize((N, N), Image.BOX))
    heights.append(h); areas.append(float((h > 200).sum()) * TEXEL_MM ** 2)
data = np.stack(heights).astype('uint8').tobytes()
name = 'glyphs_wp' if wp else 'glyphs'
if wp:
    with open(f'public/assets/{name}.gz.bin', 'wb') as f: f.write(gzip.compress(data, 9, mtime=0))
else:
    open(f'public/assets/{name}.bin', 'wb').write(data)
meta = {'N': N, 'texelMm': TEXEL_MM, 'baselineV': 0.72, 'chars': chars, 'faceAreaMm2': areas}
if wp: meta['gzip'] = True
json.dump(meta, open(f'public/assets/{name}.json', 'w'), ensure_ascii=False)
print(len(chars), 'glyphs; face area mm2: min', min(areas), 'max', max(areas))
