#!/usr/bin/env python3
"""Decode fax TIFFs written by src/fax/t4/tiff.js with libtiff (through Pillow) and compare with the source bitmaps.

    python3 -I tools/fax/check_tiff.py page.tif page.raw [more.tif more.raw ...]

Each .raw is the packed bitmap (MSB first, 1 = black). Prints one line per pair, 'ok' or 'differs', and exits 1 if
any differ. Used by tests/fax_t4.test.js when Python and Pillow are present.
"""
import sys

from PIL import Image


def main(args):
    bad = 0
    for tif, raw in zip(args[0::2], args[1::2]):
        t = Image.open(tif)
        t.load()
        w, h = t.size
        stride = (w + 7) // 8
        inv = Image.eval(t.convert('L'), lambda v: 255 - v).convert('1')
        got = bytearray(inv.tobytes())
        want = bytearray(open(raw, 'rb').read())
        if w % 8:
            mask = (0xFF << (8 - w % 8)) & 0xFF
            for y in range(h):
                got[y * stride + stride - 1] &= mask
                want[y * stride + stride - 1] &= mask
        ok = got == want
        bad += not ok
        print(f"{tif} {w}x{h} {'ok' if ok else 'differs'}")
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
