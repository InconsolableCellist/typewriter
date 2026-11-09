#!/usr/bin/env python3
"""Accumulate the third-octave error from compare.py into the calibration file. Run with python3 -I."""
import sys, json
calp, errp = sys.argv[1:3]
c = json.load(open(calp)); e = json.load(open(errp))
errs = e['errs']; bands = c.get('band_db', [0.0] * len(errs))
for i, d in enumerate(errs):
    if abs(d) < 0.01:     # empty bands (no analysis energy)
        continue
    d = max(-20, min(20, d))
    bands[i] -= 0.8 * d
c['band_db'] = [round(b, 2) for b in bands]
if e.get('later') is not None:
    c['mech_db'] = round(c.get('mech_db', 0.0) + 0.7 * (-17.5 - e['later']), 2)
json.dump(c, open(calp, 'w'), indent=0)
