#!/usr/bin/env python3
"""Cut samples for the electric single-element machine from a user-supplied recording. Run with python3 -I.
usage: cut_element_samples.py <mono 48 kHz wav> <output dir>
Writes sprite.wav and manifest.json. Each 'el_cycle' cut is one whole print cycle from the first sound of the clutch,
so the mechanism's clutch trip is what triggers it; the strike falls at the recorded delay into the cut.
'el_run' is a seamless loop of the carrier running under power, played for as long as the simulated carrier runs."""
import sys, json, numpy as np
from scipy.io import wavfile
from scipy import signal, ndimage

SR = 48000
GAP_S = 0.03
PEAK = 0.7
CYCLE_S = 0.17                      # a cycle has died away by this long after its onset
MAX_CYCLES = 70
TYPING = (2.4, 100.0)               # the opening passage is ordinary typing
SPACES = (108.6, 110.6)             # single presses of the space bar
SPACE_S = 0.14
BACKSPACES = (113.85, 114.7)
BACK_S = 0.15
CORRECTIONS = (139.2, 140.75)       # backspace and correction tape, a double burst each
CORRECT_S = 0.24
RETURN_START = (103.360, 103.545)   # the return clutch taking up
RUN = (103.56, 103.98)              # the carrier running; looped
RETURN_STOP = (103.995, 104.22)     # the carrier arriving at the margin
TAB_START = (134.475, 134.655)      # the tab latch letting the carrier go
BELL = (134.655, 136.095)           # ringing through machine noise: kept only at its partials
BELL_PARTIALS = (2370, 5989, 10720)
BELL_HALF_BAND = 70.0
RING_BANDS = ((2300, 2440), (5920, 6060))

def fades(seg, fin=0.0012, fout=0.02):
    seg = seg.copy()
    a = max(2, int(fin * SR)); seg[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    b = max(2, int(fout * SR)); seg[-b:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(b) / b)
    return seg

def onsets(x, lo_db=-56, hi_db=-44):
    h = signal.sosfiltfilt(signal.butter(4, 2500, 'high', fs=SR, output='sos'), x)
    db = 20 * np.log10(np.sqrt(ndimage.uniform_filter1d(h ** 2, int(0.003 * SR))) + 1e-9)
    out, quiet = [], 0
    for i in range(1, len(db)):
        if db[i] < lo_db: quiet += 1
        else:
            if quiet > int(0.020 * SR) and db[i] > hi_db: out.append(i)
            if db[i] > hi_db: quiet = 0
    return np.array(out)

def rings(seg):
    """True when a bell is sounding through this cut: its partials stand far above their neighbouring bins."""
    F = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))); f = np.fft.rfftfreq(len(seg), 1 / SR)
    for a, b in RING_BANDS:
        band = F[(f >= a) & (f <= b)]; near = F[(f >= a - 600) & (f <= b + 600)]
        if band.max() > 7 * np.median(near): return True
    return False

def seamless(seg, xf_s=0.06):
    """A loop whose end crossfades into its own start, at equal power because the two ends are uncorrelated noise."""
    n = int(xf_s * SR)
    t = np.arange(n) / n
    body = seg[:-n].copy()
    body[:n] = body[:n] * np.sqrt(t) + seg[-n:] * np.sqrt(1 - t)
    return body

def bell_only(x):
    seg = x[int(BELL[0] * SR) - 4096:int(BELL[1] * SR) + 4096]
    y = np.zeros_like(seg)
    for f0 in BELL_PARTIALS:
        sos = signal.butter(3, [f0 - BELL_HALF_BAND, f0 + BELL_HALF_BAND], 'band', fs=SR, output='sos')
        y += signal.sosfiltfilt(sos, seg)
    y = y[4096:-4096]
    return fades(y, 0.0008, 0.25)

def main(path, out):
    sr, x = wavfile.read(path)
    assert sr == SR
    x = x.astype(np.float64)
    items, parts, t = [], [], 0.0
    def put(name, seg, src, loop=False):
        nonlocal t
        pk = float(np.max(np.abs(seg))) + 1e-12
        i = sum(1 for it in items if it['set'] == name)
        item = {'id': f'{name}_{i:02d}', 'set': name, 'o': round(t, 5), 'd': round(len(seg) / SR, 5), 'lvl': 1.0, 'srcT': round(src, 3), 'srcPk': round(pk, 4)}
        if loop: item['loop'] = True
        items.append(item)
        parts.extend([seg / pk * PEAK, np.zeros(int(GAP_S * SR))])
        t += (len(seg) + int(GAP_S * SR)) / SR
    def add(name, a, b, src, **kw):
        put(name, fades(x[a:b]), src, **kw)
    def window(name, span, dur):
        """Each press in a span of the recording, from its own onset."""
        on = onsets(x[int(span[0] * SR):int(span[1] * SR)]) + int(span[0] * SR)
        n, kept, last = int(dur * SR), 0, -10**9
        for i in on:
            if i - last < n: continue
            add(name, max(0, i - int(0.002 * SR)), i + n, i / SR); kept += 1; last = i
        return kept

    on = onsets(x); on = on[(on >= TYPING[0] * SR) & (on < TYPING[1] * SR)]
    n = int(CYCLE_S * SR); keep = rung = 0
    for k, i in enumerate(on):
        nxt = on[k + 1] if k + 1 < len(on) else len(x)
        if nxt - i < n: continue            # runs into the next cycle: no clean tail
        a = max(0, i - int(0.002 * SR))
        if rings(x[a:i + n]): rung += 1; continue
        if keep >= MAX_CYCLES: continue
        add('el_cycle', a, i + n, i / SR); keep += 1
    counts = {name: window(name, span, dur) for name, span, dur in (('el_space', SPACES, SPACE_S), ('el_back', BACKSPACES, BACK_S), ('el_correct', CORRECTIONS, CORRECT_S))}
    add('el_return_start', int(RETURN_START[0] * SR), int(RETURN_START[1] * SR), RETURN_START[0])
    add('el_return_stop', int(RETURN_STOP[0] * SR), int(RETURN_STOP[1] * SR), RETURN_STOP[0])
    add('el_tab_start', int(TAB_START[0] * SR), int(TAB_START[1] * SR), TAB_START[0])
    put('el_run', seamless(x[int(RUN[0] * SR):int(RUN[1] * SR)]), RUN[0], loop=True)
    put('el_bell', bell_only(x), BELL[0])
    audio = np.concatenate(parts)
    wavfile.write(out + '/sprite.wav', SR, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
    pks = sorted(it['srcPk'] for it in items if it['set'] == 'el_cycle')
    manifest = {'sr': SR, 'gapS': GAP_S, 'peakNorm': PEAK, 'sprite': 'sprite.ogg', 'source': 'user-supplied recording, see ../SOURCES.md; srcT is the time in seconds in the source', 'items': items}
    json.dump(manifest, open(out + '/manifest.json', 'w'))
    print(f'{keep} cycles of {len(on)} onsets ({rung} with a bell in them), {counts}, sprite {len(audio) / SR:.2f} s, cycle peaks {pks[0]:.2f}..{pks[-1]:.2f}')

main(sys.argv[1], sys.argv[2])
