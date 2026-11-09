#!/usr/bin/env python3
"""Set the master gain and bell level from unlimited renders. Run with python3 -I.
usage: set_levels.py <cal.json> <renderdir>  (renders made with NO_LIMIT=1: strike_nominal.wav, bell.wav)
Ordinary stroke (28 N) -> -6 dBFS peak. Bell peak -> 4.7 dB below it (measured on the recording: 0.103 / 0.177)."""
import sys, json, numpy as np
from scipy.io import wavfile
from scipy import signal
cal, rd = sys.argv[1:3]
c = json.load(open(cal))
sr, x = wavfile.read(f'{rd}/strike_nominal.wav'); nom = 20 * np.log10(np.max(np.abs(x)))
sr, b = wavfile.read(f'{rd}/bell.wav'); b = b.astype(float)
e = signal.sosfiltfilt(signal.butter(4, [2500, 3200], 'band', fs=sr, output='sos'), b) ** 2
wn = int(0.02 * sr); pk = int(np.argmax(np.convolve(e, np.ones(wn) / wn, 'same')))
bell = 20 * np.log10(np.max(np.abs(b[pk - int(0.02 * sr):pk + int(0.04 * sr)])))
m0 = c.get('master', 3.0); m1 = m0 * 10 ** ((-6.0 - nom) / 20)
g0 = c.get('bell_gain', 0.019); g1 = g0 * 10 ** ((-10.7 - (bell + 20 * np.log10(m1 / m0))) / 20)
c['master'] = round(float(m1), 5); c['bell_gain'] = float(g1)
json.dump(c, open(cal, 'w'))
print('nominal', round(float(nom), 2), 'bell', round(float(bell), 2), '-> master', c['master'], 'bell_gain', g1)
