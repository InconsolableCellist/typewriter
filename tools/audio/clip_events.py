#!/usr/bin/env python3
"""Detect and describe keystroke events in the decoded opening of the user-supplied clip. Run with python3 -I.
usage: clip_events.py <mono.wav> <out.json>"""
import sys, json, numpy as np
from scipy.io import wavfile
from scipy import signal, ndimage
TYPING = [(50.0, 90.0), (93.5, 139.0), (142.8, 180.5), (188.5, 230.5), (234.5, 240.0)]
def main():
    sr, x = wavfile.read(sys.argv[1]); x = x.astype(float)
    h = signal.sosfiltfilt(signal.butter(4, 2500, 'high', fs=sr, output='sos'), x)
    env = np.sqrt(ndimage.uniform_filter1d(h ** 2, int(0.0015 * sr)))
    db = 20 * np.log10(env + 1e-9)
    events = []
    for t0, t1 in TYPING:
        i0, i1 = int(t0 * sr), int(t1 * sr)
        p, pr = signal.find_peaks(db[i0:i1], height=-55, prominence=14, distance=int(0.03 * sr))
        for k, q in zip(p + i0, pr['prominences']): events.append(int(k))
    events = sorted(events); out = []
    for n, k in enumerate(events):
        prev = (k - events[n - 1]) / sr if n else 9.0
        nxt = (events[n + 1] - k) / sr if n + 1 < len(events) else 9.0
        a = x[max(0, k - int(0.012 * sr)):k + int(0.012 * sr)]
        w = x[k - int(0.003 * sr):k + int(0.15 * sr)]
        pk = float(np.max(np.abs(a)))
        spec = np.abs(np.fft.rfft(w * np.hanning(len(w)), n=8192)) ** 2; f = np.fft.rfftfreq(8192, 1 / sr)
        low = spec[(f > 80) & (f < 400)].sum(); mid = spec[(f > 400) & (f < 2000)].sum(); high = spec[f > 2500].sum()
        cent = float((f * spec).sum() / spec.sum())
        # decay length: time to fall 26 dB below the local peak in a 2 ms broadband envelope
        e = np.sqrt(ndimage.uniform_filter1d(w ** 2, int(0.002 * sr)))
        i = np.argmax(e[:int(0.03 * sr)]); tail = np.where(e[i:] < e[i] * 0.05)[0]; dur = float((tail[0] if len(tail) else len(e) - i) / sr)
        out.append({'t': k / sr, 'peak': pk, 'prev': prev, 'next': nxt, 'centroid': cent, 'lowDb': 10 * np.log10((low + 1e-12) / (spec.sum() + 1e-12)), 'hfDb': 10 * np.log10((high + 1e-12) / (spec.sum() + 1e-12)), 'decay': dur})
    json.dump(out, open(sys.argv[2], 'w'))
    e = np.array([[v['peak'], v['prev'], v['next'], v['centroid'], v['lowDb'], v['hfDb'], v['decay']] for v in out])
    print('events', len(out))
    for name, col in [('peak', 0), ('prev', 1), ('next', 2), ('centroid', 3), ('lowDb', 4), ('hfDb', 5), ('decay', 6)]:
        print(name, np.round(np.percentile(e[:, col], [5, 25, 50, 75, 95]), 3))
    iso = (e[:, 1] > 0.1) & (e[:, 2] > 0.14)
    print('isolated', iso.sum())
    # candidate spacebars: deep/long and little slug HF
    score = (e[:, 4] - np.median(e[:, 4])) - 0.7 * (e[:, 5] - np.median(e[:, 5])) + 30 * (e[:, 6] - np.median(e[:, 6]))
    print('space candidates (t, peak, centroid, lowDb, hfDb, decay, prev):')
    for i in np.argsort(score)[::-1][:24]:
        if iso[i]: print('  %.2f %.3f %.0f %.1f %.1f %.3f %.2f' % (out[i]['t'], e[i, 0], e[i, 3], e[i, 4], e[i, 5], e[i, 6], e[i, 1]))
if __name__ == '__main__':
    main()
