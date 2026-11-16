#!/usr/bin/env python3
"""Golden vectors for the T.4 codec (docs/fax/plan.md 7.3 items 1 and 2), made with libtiff through Pillow.

Run from the repository root with an isolated interpreter:

    python3 -I tools/fax/make_vectors.py

It draws bilevel pages (our test chart, random pages at the three standard widths, and a page holding every run
length from 0 to 2600 in both colours), has libtiff code them as CCITT Group 3 (1-D and 2-D, with and without
byte-aligned EOLs, both fill orders) and Group 4, and writes the raw strip of each to tests/fixtures/fax/t4/ with
a manifest giving the options (T4Options, FillOrder, K from the vertical resolution) and the SHA-256 of the page
bitmap.

It then runs our encoder on the same pages (tools/fax/encode_vectors.mjs, Node), wraps each stream in a TIFF with
src/fax/t4/tiff.js, and has libtiff decode it: the manifest records, per vector, the hash of our stream, whether
libtiff read it back to the identical bitmap, and whether it is byte-identical to libtiff's own. The test suite
checks our encoder against those hashes, so it needs neither Python nor libtiff.

Bitmap convention throughout: packed rows, first pel in the most significant bit, 1 = black.
"""

import hashlib
import io
import json
import os
import random
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont, features

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'fax', 't4')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def packed(im):
    """Packed bits of a mode '1' image with pel value 1 = black, trailing bits of each row cleared."""
    data = bytearray(im.tobytes())
    w, h = im.size
    stride = (w + 7) // 8
    if w % 8:
        mask = (0xFF << (8 - w % 8)) & 0xFF
        for y in range(h):
            data[y * stride + stride - 1] &= mask
    return bytes(data)


# --- pages --------------------------------------------------------------------------------------------------------

def chart(width=1728, height=1145):
    """Our own test chart: text, rules, a checkerboard, a halftone wedge, an all-black line, fine lines."""
    im = Image.new('1', (width, height), 0)
    d = ImageDraw.Draw(im)
    big = ImageFont.load_default(size=56)
    mid = ImageFont.load_default(size=28)
    small = ImageFont.load_default(size=14)
    d.rectangle([20, 20, width - 21, height - 21], outline=1, width=3)
    d.text((60, 50), 'TYPEWRITER FAX TEST CHART  No. 1', font=big, fill=1)
    d.text((60, 130), 'ITU-T T.4 Group 3   1728 pels   3.85 lines/mm', font=mid, fill=1)
    para = ('The quick brown fox jumps over the lazy dog. 0123456789 '
            'PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS. ')
    for i in range(6):
        d.text((60, 190 + i * 18), (para * 3)[i * 7:i * 7 + 150], font=small, fill=1)
    # an all-black line across the whole width, and a thick bar
    d.line([0, 420, width - 1, 420], fill=1, width=1)
    d.rectangle([0, 424, width - 1, 431], fill=1)
    # rules of 1 to 8 pels, horizontal and vertical
    for i in range(8):
        d.rectangle([60, 450 + i * 20, 760, 450 + i * 20 + i], fill=1)
        d.rectangle([800 + i * 24, 450, 800 + i * 24 + i, 610], fill=1)
    # diagonals and a circle: every vertical mode
    for i in range(10):
        d.line([1020, 450 + i * 16, 1680, 610 - i * 16], fill=1, width=1)
    d.ellipse([1300, 630, 1660, 990], outline=1, width=2)
    # checkerboards of 1, 2, 4 and 8 pels
    y0 = 640
    for j, s in enumerate((1, 2, 4, 8)):
        x0 = 60 + j * 300
        for y in range(48):
            for x in range(128):
                if ((x // s) + (y // s)) % 2:
                    im.putpixel((x0 + x, y0 + y), 1)
    # halftone: a horizontal grey wedge through a 4x4 Bayer matrix (16 levels)
    bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    for y in range(840, 880):
        for x in range(60, 960):
            level = (x - 60) * 17 // 900
            if bayer[y % 4][x % 4] < level:
                im.putpixel((x, y), 1)
    # resolution wedge: converging lines
    for i in range(24):
        d.line([60 + i * 6, 1010, 60 + i * 60, 1110], fill=1)
    d.text((1000, 1040), 'END OF CHART', font=mid, fill=1)
    return im


def random_page(width, height, seed):
    """Random runs (geometric lengths, some long) with rectangles and isolated pels laid over them."""
    rng = random.Random(seed)
    im = Image.new('1', (width, height), 0)
    px = im.load()
    for y in range(height):
        mean = rng.choice((2, 8, 40, 300))
        x, c = 0, rng.random() < 0.3
        while x < width:
            n = 1 + int(rng.expovariate(1 / mean))
            if c:
                for i in range(x, min(width, x + n)):
                    px[i, y] = 1
            x += n
            c = not c
    d = ImageDraw.Draw(im)
    for _ in range(12):
        x0, y0 = rng.randrange(width), rng.randrange(height)
        d.rectangle([x0, y0, x0 + rng.randrange(1, 400), y0 + rng.randrange(1, 20)], fill=rng.randrange(2))
    for _ in range(200):
        px[rng.randrange(width), rng.randrange(height)] = rng.randrange(2)
    # an all-white and an all-black line
    d.line([0, 1, width - 1, 1], fill=0)
    d.line([0, 2, width - 1, 2], fill=1)
    return im


def runs_page(width=2600):
    """Row r: a white run of r pels, then black to the end. Every run length 0..width in both colours."""
    im = Image.new('1', (width, width + 1), 0)
    d = ImageDraw.Draw(im)
    for r in range(width + 1):
        if r < width:
            d.line([r, r, width - 1, r], fill=1)
    return im


# --- libtiff --------------------------------------------------------------------------------------------------------

def libtiff_encode(im, coding, align, fill_order, ydpi):
    w, h = im.size
    info = {278: h, 266: fill_order}
    if coding == 'mmr':
        comp = 'group4'
    else:
        comp = 'group3'
        info[292] = (1 if coding == 'mr' else 0) | (4 if align else 0)
    buf = io.BytesIO()
    im.save(buf, format='TIFF', compression=comp, tiffinfo=info, dpi=(204, ydpi))
    data = buf.getvalue()
    buf.seek(0)
    t = Image.open(buf)
    tags = t.tag_v2
    assert len(tags[273]) == 1, 'expected one strip'
    assert tags[266] == fill_order
    if coding != 'mmr':
        assert tags[292] == info[292]
    off, n = tags[273][0], tags[279][0]
    back = packed(t.convert('1') if t.mode != '1' else t)
    assert back == packed(im), 'libtiff did not read its own page back'
    return data[off:off + n]


def libtiff_decode_ours(path, w, h):
    """Decode a TIFF we wrote (WhiteIsZero) with libtiff; returns packed bits with 1 = black."""
    t = Image.open(path)
    assert t.size == (w, h), t.size
    t.load()
    inv = Image.eval(t.convert('L'), lambda v: 255 - v).convert('1')
    return packed(inv)


def main():
    if features.version('libtiff') is None:
        sys.exit('Pillow has no libtiff')
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.bin'):
            os.remove(os.path.join(OUT, f))

    pages = {
        'chart': chart(),
        'rand1728': random_page(1728, 32, 1),
        'rand2048': random_page(2048, 24, 2),
        'rand2432': random_page(2432, 24, 3),
        'runs2600': runs_page(2600),
    }
    # (page, coding, alignEol, fillOrder, ydpi); K follows libtiff's rule: 4 above 150 lines per inch, else 2
    plan = [
        ('chart', 'mh', False, 1, 98), ('chart', 'mr', True, 2, 196),
        ('chart', 'mmr', False, 1, 98),
        ('rand1728', 'mh', False, 1, 98), ('rand1728', 'mr', False, 1, 98), ('rand1728', 'mr', True, 2, 196),
        ('rand1728', 'mmr', False, 2, 98),
        ('rand2048', 'mh', True, 1, 98), ('rand2048', 'mr', False, 1, 196), ('rand2048', 'mmr', False, 1, 98),
        ('rand2432', 'mh', False, 2, 98), ('rand2432', 'mr', False, 1, 98), ('rand2432', 'mmr', False, 1, 98),
        ('runs2600', 'mh', False, 1, 98), ('runs2600', 'mr', False, 1, 196), ('runs2600', 'mmr', False, 1, 98),
    ]

    vectors = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, im in pages.items():
            with open(os.path.join(tmp, name + '.raw'), 'wb') as f:
                f.write(packed(im))
        for page, coding, align, fo, ydpi in plan:
            im = pages[page]
            w, h = im.size
            k = 4 if ydpi > 150 else 2
            vid = f'{page}.{coding}' + (f'.k{k}' if coding == 'mr' else '') + ('.align' if align else '') + \
                  ('.lsb' if fo == 2 else '')
            strip = libtiff_encode(im, coding, align, fo, ydpi)
            with open(os.path.join(OUT, vid + '.bin'), 'wb') as f:
                f.write(strip)
            vectors.append({
                'id': vid, 'page': page, 'file': vid + '.bin', 'width': w, 'height': h, 'coding': coding,
                'k': k if coding == 'mr' else None, 'alignEol': align, 'bitOrder': 'lsb' if fo == 2 else 'msb',
                'ydpi': ydpi, 'bytes': len(strip), 'sha256': sha(strip), 'bitmapSha256': sha(packed(im)),
            })

        # our encoder on the same pages, then libtiff reads our streams
        jobs = os.path.join(tmp, 'jobs.json')
        with open(jobs, 'w') as f:
            json.dump({'dir': tmp, 'vectors': vectors}, f)
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'fax', 'encode_vectors.mjs'), jobs], check=True)
        for v in vectors:
            ours = open(os.path.join(tmp, v['id'] + '.ours.bin'), 'rb').read()
            src = packed(pages[v['page']])
            back = libtiff_decode_ours(os.path.join(tmp, v['id'] + '.ours.tif'), v['width'], v['height'])
            lib = open(os.path.join(OUT, v['file']), 'rb').read()
            v['ours'] = {
                'bytes': len(ours), 'sha256': sha(ours),
                'libtiffDecodesIdentical': back == src,
                'identicalToLibtiff': ours == lib,
            }
            print(f"{v['id']:28s} libtiff {v['bytes']:7d} B   ours {len(ours):7d} B   "
                  f"libtiff reads ours: {'yes' if back == src else 'NO'}   "
                  f"byte-identical: {'yes' if ours == lib else 'no'}")

    manifest = {
        'generator': 'tools/fax/make_vectors.py',
        'pillow': Image.__version__ if hasattr(Image, '__version__') else None,
        'libtiff': features.version('libtiff'),
        'bitmap': 'packed rows, MSB first, 1 = black, stride ceil(width / 8)',
        'vectors': vectors,
    }
    import PIL
    manifest['pillow'] = PIL.__version__
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    total = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
    print(f'{len(vectors)} vectors, {total} bytes in {OUT}')
    if not all(v['ours']['libtiffDecodesIdentical'] for v in vectors):
        sys.exit('libtiff did not read every one of our streams back to the identical bitmap')


if __name__ == '__main__':
    main()
