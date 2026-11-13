#!/usr/bin/env python3
"""Cut the word processor's samples from the two owner-supplied recordings (public/assets/audio/SOURCES.md). Run with
python3 -I. usage: cut_wp_samples.py <beamspring.wav> <displaywriter.wav> <work dir>

Both inputs are the recordings decoded by ffmpeg to mono 48 kHz WAV, for example
  ffmpeg -i beamspring_typing.opus -ac 1 -ar 48000 beamspring.wav
Writes, in <work dir>:
  wpkeys/sprite.wav, wpkeys/manifest.json   the beam spring keyboard, for the main-thread key sampler (src/audio/wp-keys.js)
  wp/sprite.wav, wp/manifest.json           the diskette unit and the running machine, for the worklet (src/audio/wp-sampler.js)
  levels.json                               the level ratios measured in the Displaywriter recording (architecture.md 10.4)
then encode each sprite as the existing ones are:
  ffmpeg -i sprite.wav -c:a libopus -b:a 64k -ac 1 sprite.ogg

What is in each recording, and so what is cut where (times in seconds of the source):

Displaywriter (197 s). 0-52.3: the machine is off (no mains lines): handling, knocks with ringing metal, loud clacks
and speech; nothing here is used. 52.04: a loud clack, then 100 Hz mains hum and the drive and fan lines from 52.5:
power on. 60.7 on: a 15.03 kHz line (the display's horizontal deflection). 76-93: murmured speech over the running
machine. From 93.9 the machine is heard alone: program load. 93.88-94.48 the first access (a soft 180 ms run, then 410 ms
of loud seek buzz); 96.3-105.9 single steps between tracks, 0.3-0.7 s apart, each a soft 30-60 ms burst; sharp clacks
at the start of accesses (104.58, 106.43, 115.67): head load; 106.4-117.2 seeks (100-480 ms of buzz); 117.5-128 idle;
128.5-171 keystrokes on the beam spring keyboard (press and release, 60-160 ms apart), with the speaker's beep at
160.10-160.31 (960 Hz square, odd harmonics); 172.43-174.9 seven seeks of about 240 ms and 176.25-178.6 four more;
184-190.5 idle; keystrokes to the end. No printing is heard anywhere: there are no trains of strikes, so the printer
keeps its synthesis. No lever, diskette insertion or recalibrate against the stop can be identified with confidence.

Beam spring (240 s). 0.9-3.8: six finger snaps (left out). 4.3-240: continuous fast typing, about 17 key sounds a
second, in a reverberant room with a 6-7 kHz hiss band. Each keystroke is a press and, 60-160 ms later, a quieter
release; they are told apart by level against their neighbours. The space bar and the wide keys are told apart from
the alphanumeric keys by the low-frequency share of their body, which their longer stabilised bars give them; this is a
classification by sound, not an identification of keys."""
import sys, os, json, numpy as np
from scipy.io import wavfile
from scipy import signal, ndimage

SR = 48000
GAP_S = 0.02
PEAK = 0.7

# ---- Displaywriter recording ------------------------------------------------------------------------------------
DW_IDLE = [(118.6, 125.9), (184.0, 190.4)]          # the machine running, nothing moving: the hum and the noise profile
DW_ACCESS = [(93.8, 117.6), (172.3, 178.5)]         # program load and later accesses: steps, head loads, seeks
DW_KEYS = [(128.3, 159.9), (160.4, 171.9), (180.0, 196.0)]   # keystrokes, for the level of a key against the hum
DW_SKIP = [(98.8, 99.4), (128.8, 129.3), (152.9, 153.2)]     # speech-like or an electrical click
DW_BEEP = (160.11, 160.30)
DW_CRT_HZ = 15032.0
LOOP_S = 4.0
SPLIT_HZ = 450.0                                     # the motors' hum and tones below, the fans' air above

# ---- beam spring recording ------------------------------------------------------------------------------------------
BS_QUIET = [(0.05, 0.85)]                            # before the first snap: the noise profile
BS_TYPING = (4.6, 239.5)
N_KEYS = {'key_press': 16, 'key_release': 16, 'wide_press': 8, 'wide_release': 8, 'space_press': 8, 'space_release': 8}


def read(path):
    sr, x = wavfile.read(path)
    assert sr == SR, f'{path}: {sr} Hz, expected {SR}'
    x = x.astype(np.float64)
    if x.ndim > 1: x = x.mean(axis=1)
    return x / (32768.0 if np.abs(x).max() > 2 else 1.0)


def denoise(x, spans, over=1.3, floor=0.04):
    """Static spectral subtraction against the mean spectrum of the given spans: per frequency only, so nothing pumps."""
    n, hop = 2048, 512
    win = signal.windows.hann(n, sym=False)
    f, t, S = signal.stft(x, SR, window=win, nperseg=n, noverlap=n - hop)
    idx = np.zeros(S.shape[1], bool)
    for a, b in spans: idx |= (t >= a) & (t <= b)
    noise = np.sqrt(np.mean(np.abs(S[:, idx]) ** 2, axis=1))
    mag = np.abs(S) + 1e-12
    g = np.sqrt(np.maximum(1 - (over * noise[:, None] / mag) ** 2, floor))
    g = ndimage.uniform_filter(g, size=(3, 3))
    return signal.istft(S * g, SR, window=win, nperseg=n, noverlap=n - hop)[1][:len(x)]


def fades(seg, fin=0.0012, fout=0.015):
    seg = seg.copy()
    a = max(2, int(fin * SR)); seg[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    b = min(len(seg) // 2, max(2, int(fout * SR))); seg[-b:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(b) / b)
    return seg


def seamless(seg, xf_s=0.08):
    """A loop whose end crossfades into its own start, at equal power (the two ends are uncorrelated noise)."""
    n = int(xf_s * SR); t = np.arange(n) / n
    body = seg[:-n].copy()
    body[:n] = body[:n] * np.sqrt(t) + seg[-n:] * np.sqrt(1 - t)
    return body


def env_db(x, hp=1000, fs=2000):
    h = signal.sosfiltfilt(signal.butter(4, hp, 'high', fs=SR, output='sos'), x)
    e = np.sqrt(signal.resample_poly(h ** 2, 1, SR // fs).clip(1e-14))
    return 20 * np.log10(e + 1e-9)


def inside(t, spans): return any(a <= t < b for a, b in spans)
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
def pk_db(x): return 20 * np.log10(np.abs(x).max() + 1e-12)


class Sprite:
    def __init__(self): self.parts, self.items, self.t = [], [], 0.0

    def add(self, name, seg, src, pk=None, meta=None, norm=True):
        p = float(np.abs(seg).max()) + 1e-12
        s = seg / p * PEAK if norm else seg
        i = sum(1 for it in self.items if it['set'] == name)
        # scale: the source amplitude of one unit of the sprite, so a cut played at `scale` keeps its recorded level
        self.items.append({'id': f'{name}_{i:02d}', 'set': name, 'o': round(self.t, 5), 'd': round(len(s) / SR, 5), 'lvl': 1.0,
                           'srcT': round(float(src), 3), 'srcPk': round(float(pk if pk is not None else p), 5),
                           'scale': round(p / PEAK, 6) if norm else 1.0, **(meta or {})})
        self.parts += [s, np.zeros(int(GAP_S * SR))]
        self.t += (len(s) + int(GAP_S * SR)) / SR

    def write(self, out, source):
        os.makedirs(out, exist_ok=True)
        audio = np.concatenate(self.parts)
        wavfile.write(f'{out}/sprite.wav', SR, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
        json.dump({'sr': SR, 'gapS': GAP_S, 'peakNorm': PEAK, 'sprite': 'sprite.ogg', 'source': source, 'items': self.items},
                  open(f'{out}/manifest.json', 'w'), indent=None)
        sets = {}
        for it in self.items: sets[it['set']] = sets.get(it['set'], 0) + 1
        print(out, sets, f'{len(audio) / SR:.2f} s')


# ---- the Displaywriter: events -----------------------------------------------------------------------------------
def dw_events(y, spans, thr=12):
    """Regions over the running background; for each its start, end, peak, sharpness (ms from 10 dB over the background
    to the peak) and the background level."""
    fs = 2000
    d = env_db(y, 1000, fs)
    bg = ndimage.percentile_filter(d, 15, size=3 * fs)
    on = ndimage.binary_closing(d > bg + thr, np.ones(int(0.02 * fs)))
    lab, n = ndimage.label(on)
    out = []
    for k in range(1, n + 1):
        idx = np.where(lab == k)[0]
        i0, i1 = idx[0], idx[-1] + 1
        t0 = i0 / fs
        if i1 - i0 < int(0.008 * fs) or not inside(t0, spans) or inside(t0, DW_SKIP): continue
        # back up to where it first stood 6 dB over the background
        while i0 > 0 and d[i0 - 1] > bg[i0 - 1] + 6: i0 -= 1
        ip = i0 + int(np.argmax(d[i0:i1]))
        sharp = (ip - i0) / fs * 1000
        out.append({'t0': i0 / fs, 't1': i1 / fs, 'dur': (i1 - i0) / fs, 'pk': float(d[ip]), 'over': float(d[ip] - bg[ip]), 'sharp': sharp})
    return out


def cut_displaywriter(x, out):
    y = denoise(x, DW_IDLE)
    idle = np.concatenate([x[int(a * SR):int(b * SR)] for a, b in DW_IDLE])
    bed = rms_db(idle)
    ev = dw_events(y, DW_ACCESS)
    # A head load is a sharp clack (at its peak within 8 ms); a single step a softer burst under 100 ms; a seek a buzz.
    seeks = [e for e in ev if e['dur'] >= 0.14 and e['over'] >= 30]
    loads = [e for e in ev if e['dur'] < 0.11 and e['sharp'] <= 8 and e['over'] >= 28]
    steps = [e for e in ev if e['dur'] < 0.1 and e['sharp'] > 8 and e['over'] >= 26]
    print(f'Displaywriter: idle bed {bed:.1f} dBFS; {len(seeks)} seeks, {len(loads)} head loads, {len(steps)} single steps')
    for e in seeks + loads: print(f"   {'seek' if e in seeks else 'load'} {e['t0']:.3f} {e['dur'] * 1000:.0f} ms, {e['over']:.1f} dB over, sharp {e['sharp']:.1f} ms")
    sp = Sprite()
    lv = {'idleBedRmsDb': round(bed, 2)}
    # single steps: from 4 ms before to 70 ms after; head loads to 90 ms
    meas = []
    for e in steps:
        a = int((e['t0'] - 0.004) * SR); seg = y[a:a + int(0.074 * SR)]
        sp.add('disk_step', fades(seg, fout=0.03), e['t0']); meas.append(pk_db(x[a:a + int(0.074 * SR)]))
    lv['stepPeakOverBed'] = round(float(np.median(meas)) - bed, 2)
    meas = []
    for e in loads:
        a = int((e['t0'] - 0.003) * SR); seg = y[a:a + int(0.09 * SR)]
        sp.add('disk_load', fades(seg, fout=0.035), e['t0']); meas.append(pk_db(x[a:a + int(0.09 * SR)]))
    lv['headLoadPeakOverBed'] = round(float(np.median(meas)) - bed, 2)
    # seeks: the body of each buzz, its first and last 30 ms left out, as the texture each step plays a grain of
    meas = []
    for e in seeks:
        a, b = int((e['t0'] + 0.03) * SR), int((e['t1'] - 0.03) * SR)
        if b - a < int(0.08 * SR): continue
        # only where the buzz is within 10 dB of its loudest 10 ms: the run, not a quiet lead-in
        w = int(0.01 * SR); lvl = 10 * np.log10(ndimage.uniform_filter1d(y[a:b] ** 2, w) + 1e-15)
        keep = np.where(lvl > lvl.max() - 10)[0]
        a, b = a + keep[0], a + keep[-1]
        if b - a < int(0.06 * SR): continue
        sp.add('disk_seek', fades(y[a:b], 0.004, 0.004), a / SR, meta={'rms': round(float(np.sqrt(np.mean(y[a:b] ** 2))), 6)})
        meas.append(rms_db(x[a:b]))
    lv['seekRmsOverBed'] = round(float(np.median(meas)) - bed, 2)
    # the running machine: the steadiest LOOP_S of each idle span, split at SPLIT_HZ into the motors' hum and the fans' air
    lo = signal.butter(4, SPLIT_HZ, 'low', fs=SR, output='sos'); hi = signal.butter(4, SPLIT_HZ, 'high', fs=SR, output='sos')
    a, b = DW_IDLE[0]
    seg = x[int(a * SR):int(a * SR) + int((LOOP_S + 0.08) * SR)]
    for name, sos in (('bed_motor', lo), ('bed_fan', hi)):
        part = signal.sosfiltfilt(sos, seg)
        loop = seamless(part)
        sp.add(name, loop, a, meta={'loop': True, 'rms': round(float(np.sqrt(np.mean(loop ** 2))), 6)}, norm=False)
        lv[name + 'RmsOverBed'] = round(rms_db(loop) - bed, 2)
    # the speaker's beep, the display's line whistle and the keys, for the levels only
    lv['beepRmsOverBed'] = round(rms_db(x[int(DW_BEEP[0] * SR):int(DW_BEEP[1] * SR)]) - bed, 2)
    crt = signal.sosfiltfilt(signal.butter(2, [DW_CRT_HZ - 25, DW_CRT_HZ + 25], 'band', fs=SR, output='sos'), idle)
    lv['crtLineRmsOverBed'] = round(rms_db(crt) - bed, 2)
    kev = [e for e in dw_events(y, DW_KEYS, 14) if e['dur'] < 0.2]
    # the key level as the upper half of the events (the presses), raw peak against the bed
    pks = []
    for e in kev:
        a = int(e['t0'] * SR); pks.append(pk_db(x[a:a + int(0.03 * SR)]))
    pks = np.sort(pks)
    lv['keyPressPeakOverBed'] = round(float(np.median(pks[len(pks) // 2:])) - bed, 2)
    lv['keyReleasePeakOverBed'] = round(float(np.median(pks[:len(pks) // 2])) - bed, 2)
    lv['keyEvents'] = len(kev)
    lv['beepHz'] = 960.0
    sp.write(out, 'Displaywriter recording supplied by the owner, see ../SOURCES.md; srcT is the time in seconds in it, srcPk the peak after denoising, scale the source amplitude of one sprite unit')
    return lv


# ---- the beam spring keyboard -------------------------------------------------------------------------------------
def key_events(y):
    """Onsets merged within 25 ms (a press's buckle and bottom are one event), with features."""
    fs = 2000
    d = env_db(y, 1500, fs)
    bg = ndimage.percentile_filter(d, 10, size=fs)
    rise = d - ndimage.minimum_filter1d(d, 20, origin=9)
    cand = np.where((rise > 12) & (d > bg + 15))[0]
    cand = cand[(cand > BS_TYPING[0] * fs) & (cand < BS_TYPING[1] * fs)]
    on = []
    for c in cand:
        if on and c - on[-1] < int(0.025 * fs): continue
        on.append(c)
    ev = []
    for k, c in enumerate(on):
        a = c * SR // fs - int(0.003 * SR)
        seg = y[a:a + int(0.04 * SR)]
        F = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2; f = np.fft.rfftfreq(len(seg), 1 / SR)
        ev.append({'i': a, 't': c / fs, 'pk': pk_db(y[a:a + int(0.03 * SR)]),
                   'low': float(np.sum(F[(f > 80) & (f < 1000)]) / np.sum(F[f > 80])),
                   'prev': (c - on[k - 1]) / fs if k else 9.0, 'next': (on[k + 1] - c) / fs if k + 1 < len(on) else 9.0,
                   'pre': float(d[max(0, c - int(0.008 * fs)):c - int(0.002 * fs)].max())})
    # press or release: louder or quieter than the keys around it (1.5 s each side)
    t = np.array([e['t'] for e in ev]); p = np.array([e['pk'] for e in ev])
    for k, e in enumerate(ev):
        m = np.abs(t - e['t']) < 1.5
        e['press'] = e['pk'] >= np.median(p[m])
    return ev


def cut_keys(x, out):
    y = denoise(x, BS_QUIET, over=1.5, floor=0.03)
    ev = key_events(y)
    sp = Sprite()
    picks = {}
    for kind in ('press', 'release'):
        group = [e for e in ev if e['press'] == (kind == 'press')]
        lows = np.array([e['low'] for e in group])
        q85, q70 = np.percentile(lows, [85, 70])
        need = 0.07 if kind == 'press' else 0.05
        clean = [e for e in group if e['prev'] > 0.06 and e['next'] > need and e['pk'] - e['pre'] > 15]
        for cls, sel in (('space', lambda e: e['low'] >= q85), ('wide', lambda e: q70 <= e['low'] < q85), ('key', lambda e: e['low'] < q70)):
            c = [e for e in clean if sel(e)]
            med = np.median([e['pk'] for e in c])
            c = sorted(c, key=lambda e: abs(e['pk'] - med))[:4 * N_KEYS[f'{cls}_{kind}']]   # typical level
            c = sorted(c, key=lambda e: e['t'])
            n = N_KEYS[f'{cls}_{kind}']
            picks[f'{cls}_{kind}'] = c[::max(1, len(c) // n)][:n]                         # spread over the recording
    lv = {}
    for name, lst in picks.items():
        for e in lst:
            n = int(min(e['next'] - 0.004, 0.11 if 'press' in name else 0.08) * SR)
            seg = y[e['i']:e['i'] + int(0.003 * SR) + n]
            sp.add(name, fades(seg, fout=0.02), e['t'], meta={'low': round(e['low'], 3)})
        lv[name + 'PeakDb'] = round(float(np.median([e['pk'] for e in lst])), 2)
    print(f'beam spring: {len(ev)} key events,', {k: len(v) for k, v in picks.items()})
    sp.write(out, 'beam spring keyboard recording supplied by the owner, see ../SOURCES.md; srcT is the time in seconds in it, scale the source amplitude of one sprite unit')
    return lv


def main():
    bs, dw, work = sys.argv[1:4]
    lv_keys = cut_keys(read(bs), f'{work}/wpkeys')
    lv = cut_displaywriter(read(dw), f'{work}/wp')
    lv['beamspring'] = lv_keys
    json.dump(lv, open(f'{work}/levels.json', 'w'), indent=1)
    print(json.dumps(lv, indent=1))


if __name__ == '__main__':
    main()
