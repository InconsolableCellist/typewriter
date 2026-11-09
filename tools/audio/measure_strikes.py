#!/usr/bin/env python3
"""Measure the keystroke ensemble of a mono float WAV: run with python3 -I.
usage: measure_strikes.py <wav> <out.npz>
Finds impacts by high-frequency envelope peaks, keeps the strongest impact of each cluster, aligns them
by cross-correlation and writes the aligned matrix plus envelopes by third-octave band."""
import sys, numpy as np
from scipy.io import wavfile
from scipy import signal

def bandpass(x, sr, f1, f2):
    return signal.sosfiltfilt(signal.butter(4, [f1, f2], 'band', fs=sr, output='sos'), x)

def load(path):
    sr, x = wavfile.read(path)
    return sr, x.astype(np.float64)

def find_impacts(x, sr, min_db=-40.0, min_sep=0.12):
    h = bandpass(x, sr, 2500, 16000)
    win = int(0.002 * sr)
    env = np.sqrt(np.maximum(0, np.convolve(h * h, np.ones(win) / win, 'same')))
    db = 20 * np.log10(env + 1e-12)
    peaks, _ = signal.find_peaks(db, height=min_db, distance=int(0.02 * sr))
    keep = []
    for p in peaks:
        if keep and p - keep[-1] < min_sep * sr:
            if db[p] > db[keep[-1]]:
                keep[-1] = p
        else:
            keep.append(p)
    return np.array(keep), db

def main():
    sr, x = load(sys.argv[1])
    impacts, db = find_impacts(x, sr)
    pre, post = int(0.03 * sr), int(0.35 * sr)
    impacts = impacts[(impacts > pre) & (impacts < len(x) - post)]
    # keep loud impacts (> noise, and in the upper part of the level distribution)
    levels = np.array([np.max(np.abs(x[i - pre // 2:i + pre // 2])) for i in impacts])
    keep = levels > np.percentile(levels, 20)
    impacts = impacts[keep]
    # align to the strongest in the set by cross-correlation of the first 20 ms
    tmpl = x[impacts[np.argmax(levels[keep])] - pre // 2:impacts[np.argmax(levels[keep])] + int(0.02 * sr)]
    seg = []
    for i in impacts:
        y = x[i - pre:i + post]
        c = signal.correlate(y[:pre + int(0.02 * sr)], tmpl, 'same')
        lag = np.argmax(np.abs(c)) - (pre // 2 + (pre // 2 + int(0.02 * sr)) // 2)
        j = i + lag
        if j - pre < 0 or j + post >= len(x):
            continue
        seg.append(x[j - pre:j + post])
    seg = np.array(seg)
    print('strikes', seg.shape, 'sr', sr)
    np.savez(sys.argv[2], seg=seg, sr=sr, pre=pre)

if __name__ == '__main__':
    main()
