#!/usr/bin/env python3
"""Cut event samples from the decoded opening of the user-supplied clip. Run with python3 -I.
usage: cut_samples.py <mono.wav> <work dir>
Writes <work dir>/sprite.wav (mono, 48 kHz) and <work dir>/manifest.json with the source time of every cut.
Denoise is a single static spectral profile from quiet passages (no pumping)."""
import sys, json, numpy as np
from scipy.io import wavfile
from scipy import signal, ndimage

GAP_S = 0.03                         # silence between cuts in the sprite
PEAK = 0.7                           # every cut is normalised to this peak; natural level is kept in 'lvl'
QUIET = [(38.6, 41.8), (46.0, 48.8)]  # used only for the stationary noise profile

def denoise(x, sr):
    """Static subtraction with a floor: gain varies per frequency only, so nothing can pump."""
    n, hop = 2048, 512
    win = signal.windows.hann(n, sym=False)
    f, t, S = signal.stft(x, sr, window=win, nperseg=n, noverlap=n - hop)
    idx = np.zeros(S.shape[1], bool)
    for a, b in QUIET:
        idx |= (t >= a) & (t <= b)
    noise = np.sqrt(np.mean(np.abs(S[:, idx]) ** 2, axis=1))
    mag = np.abs(S) + 1e-12
    g = np.sqrt(np.maximum(1 - (1.3 * noise[:, None] / mag) ** 2, 0.04))     # floor -14 dB, light
    g = ndimage.uniform_filter(g, size=(3, 3))                      # avoids musical noise
    y = signal.istft(S * g, sr, window=win, nperseg=n, noverlap=n - hop)[1]
    return y[:len(x)]

def fades(seg, sr, fin=0.0015, fout=0.02):
    seg = seg.copy()
    a = max(2, int(fin * sr)); seg[:a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    b = min(len(seg) // 2, max(2, int(fout * sr))); seg[-b:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(b) / b)
    return seg

class Sprite:
    def __init__(self, sr): self.sr, self.parts, self.items, self.t = sr, [], [], 0.0
    def add(self, set_name, seg, src_t, lvl=1.0, pre=0.0, meta=None):
        pk = np.max(np.abs(seg)) + 1e-12
        s = seg / pk * PEAK
        self.items.append({'id': f'{set_name}_{sum(1 for i in self.items if i["set"] == set_name):02d}', 'set': set_name,
                           'o': round(self.t, 5), 'd': round(len(s) / self.sr, 5), 'lvl': round(float(lvl), 4),
                           'pre': round(float(pre), 5), 'srcT': round(float(src_t), 3), 'srcPk': round(float(pk), 4), **(meta or {})})
        self.parts.append(s); self.parts.append(np.zeros(int(GAP_S * self.sr)))
        self.t += (len(s) + int(GAP_S * self.sr)) / self.sr

def hf_env(x, sr, cut=2500, smooth=0.0015):
    h = signal.sosfiltfilt(signal.butter(4, cut, 'high', fs=sr, output='sos'), x)
    return np.sqrt(np.maximum(0, ndimage.uniform_filter1d(h ** 2, int(smooth * sr))))

TYPING = [(50.0, 90.0), (93.5, 139.0), (142.8, 180.5), (188.5, 232.2), (234.5, 239.5)]

def find_keystrokes(x, sr):
    env = hf_env(x, sr)
    db = 20 * np.log10(env + 1e-9)
    ev = []
    for t0, t1 in TYPING:
        i0, i1 = int(t0 * sr), int(t1 * sr)
        p, _ = signal.find_peaks(db[i0:i1], height=-48, prominence=10, distance=int(0.02 * sr))
        ev += list(p + i0)
    ev = np.array(sorted(ev))
    amp = np.array([np.max(np.abs(x[i - int(0.002 * sr):i + int(0.002 * sr)])) for i in ev])
    mains = []
    for j, i in enumerate(ev):
        near = np.abs(ev - i) < int(0.08 * sr)
        if amp[j] < amp[near].max(): continue
        mains.append(i)
    mains = np.array(mains)
    out = []
    for i in mains:
        a = float(np.max(np.abs(x[i - int(0.002 * sr):i + int(0.003 * sr)])))
        pre = float(np.max(np.abs(x[i - int(0.05 * sr):i - int(0.008 * sr)])))
        post = float(np.max(np.abs(x[i + int(0.04 * sr):i + int(0.14 * sr)])))
        nxt = ev[ev > i + int(0.04 * sr)]
        # the first event after the ring that reaches half this strike bounds the tail
        tail = 0.18
        strong = nxt[(nxt < i + int(0.3 * sr)) & (amp[np.searchsorted(ev, nxt)] > 0.5 * a)]
        if len(strong): tail = (strong[0] - i) / sr - 0.012
        w = x[i - int(0.003 * sr):i + int(0.13 * sr)]
        spec = np.abs(np.fft.rfft(w * np.hanning(len(w)), n=8192)) ** 2; f = np.fft.rfftfreq(8192, 1 / sr)
        ls = float(10 * np.log10(spec[(f > 70) & (f < 350)].sum() / spec.sum()))
        hs = float(10 * np.log10(spec[f > 3000].sum() / spec.sum()))
        e = np.sqrt(ndimage.uniform_filter1d(w ** 2, int(0.002 * sr)))
        ip = np.argmax(e[:int(0.03 * sr)]); tl = np.where(e[ip:] < e[ip] * 0.06)[0]; dec = float((tl[0] if len(tl) else len(e) - ip) / sr)
        out.append({'i': int(i), 't': i / sr, 'a': a, 'pre': pre / a, 'post': post / a, 'tail': float(tail), 'ls': ls, 'hs': hs, 'dec': dec})
    return out

def main():
    path, work = sys.argv[1:3]
    sr, x = wavfile.read(path); x = x.astype(float)
    y = denoise(x, sr)
    ks = find_keystrokes(y, sr)
    print('main events', len(ks))
    clean = [k for k in ks if k['pre'] < 0.45 and k['post'] < 0.55 and k['tail'] > 0.09]
    print('clean', len(clean))
    amps = np.array([k['a'] for k in clean])
    # Space: no slug on platen, deep thump, longer. Score among events that are clean and audible.
    median_hs = np.median([k['hs'] for k in clean])
    for k in clean: k['deep'] = k['ls'] - 0.8 * (k['hs'] - median_hs) + 25 * k['dec']
    cand = sorted([k for k in clean if k['a'] > 0.05 and k['ls'] > np.percentile([c['ls'] for c in clean], 40)], key=lambda k: -k['deep'])
    spaces = cand[:7]
    print('space picks:', [(round(k['t'], 2), round(k['a'], 3), round(k['ls'], 1), round(k['hs'], 1), round(k['dec'], 3), round(k['tail'], 2)) for k in spaces])
    used = {k['i'] for k in spaces}
    rest = [k for k in clean if k['i'] not in used]
    amps = np.array([k['a'] for k in rest])
    p1, p2 = np.percentile(amps, [33, 67])
    tiers = {'soft': [k for k in rest if k['a'] < p1], 'med': [k for k in rest if p1 <= k['a'] < p2], 'hard': [k for k in rest if k['a'] >= p2]}
    print('tier sizes', {k: len(v) for k, v in tiers.items()}, 'edges', round(float(p1), 3), round(float(p2), 3))
    sp = Sprite(sr)
    picked = []
    for name, lst in tiers.items():
        # keep the cleanest, then space them out across the clip to get different keys
        lst = sorted(lst, key=lambda k: k['pre'] + k['post'])[:40]
        lst = sorted(lst, key=lambda k: k['t'])
        chosen = lst[:: max(1, len(lst) // 13)][:13]
        med = np.median([k['a'] for k in chosen])
        for k in chosen:
            i = k['i']; n = int(min(0.17, max(0.1, k['tail'])) * sr)
            seg = fades(y[i - int(0.006 * sr):i + n], sr, fin=0.0012, fout=0.03)
            sp.add('strike_' + name, seg, k['t'], lvl=k['a'] / med, pre=0.006, meta={'peak': round(k['a'], 3)})
        picked += chosen
    # Space bar
    med = np.median([k['a'] for k in spaces])
    for k in spaces:
        i = k['i']; seg = fades(y[i - int(0.006 * sr):i + int(min(0.24, max(0.12, k['tail'] + 0.02)) * sr)], sr, fin=0.0012, fout=0.05)
        sp.add('space', seg, k['t'], lvl=k['a'] / med, pre=0.006, meta={'peak': round(k['a'], 3)})
    # Key and bar return: events 110-260 ms after isolated clean strikes
    env = hf_env(y, sr, 1500)
    rets = []
    for k in picked:
        i = k['i']; a, b = i + int(0.11 * sr), i + int(0.26 * sr)
        p = a + np.argmax(env[a:b]); v = float(np.max(np.abs(y[p - int(0.002 * sr):p + int(0.004 * sr)])))
        if env[p] > 3 * np.median(env[a:b]) and v < 0.5 * k['a']:
            rets.append((p, v))
    rets = sorted(rets, key=lambda r: r[1])[::max(1, len(rets) // 12)][:12]
    med = np.median([r[1] for r in rets])
    for p, v in rets:
        sp.add('bar_return', fades(y[p - int(0.004 * sr):p + int(0.07 * sr)], sr), p / sr, lvl=v / med, pre=0.004)
    # Light key touches, the keys touched without typing around 0:43
    for t in [42.273, 42.502, 43.4, 43.666, 43.882, 44.11, 44.332, 44.536, 44.771, 44.993, 45.208, 45.438, 45.671]:
        i = int(t * sr); a = y[i - 200:i + 200]
        sp.add('touch', fades(y[i - int(0.005 * sr):i + int(0.055 * sr)], sr), t, lvl=float(np.max(np.abs(a))) / 0.03, pre=0.005)
    # Shift: lift then drop around 0:49
    sp.add('shift_down', fades(y[int(49.205 * sr):int(49.37 * sr)], sr, fout=0.04), 49.21, pre=0.035)
    sp.add('shift_up', fades(y[int(49.495 * sr):int(49.70 * sr)], sr, fout=0.05), 49.5, pre=0.018)
    # Platen knob detent clicks 0:18-0:24
    for t in [18.297, 18.509, 18.66, 19.123, 19.498, 19.688, 19.981, 20.349, 20.764, 21.472, 21.618, 22.202, 22.531, 22.871, 23.111, 24.176, 24.508]:
        i = int(t * sr)
        sp.add('knob', fades(y[i - int(0.005 * sr):i + int(0.075 * sr)], sr, fout=0.02), t, lvl=float(np.max(np.abs(y[i - 200:i + 200]))) / 0.08, pre=0.005)
    # Line space lever throw: the two returns
    sp.add('lever', fades(y[int(90.25 * sr):int(90.63 * sr)], sr, fout=0.05), 90.25, pre=0.0)
    sp.add('lever', fades(y[int(139.70 * sr):int(140.22 * sr)], sr, fout=0.06), 139.7, pre=0.0)
    # Ratchet grains, one rack tooth each: 1:31.4-1:32.06 and 2:20.36-2:21.06
    env2 = hf_env(y, sr, 1500, 0.0008)
    ticks = []
    for t0, t1 in [(91.39, 92.08), (140.35, 141.08)]:
        i0, i1 = int(t0 * sr), int(t1 * sr)
        p, _ = signal.find_peaks(env2[i0:i1], distance=int(0.011 * sr), prominence=np.max(env2[i0:i1]) * 0.12)
        ticks += [int(q + i0) for q in p]
    amp = np.array([np.max(np.abs(y[q - 80:q + 80])) for q in ticks])
    med = np.median(amp)
    good = [q for q, a in zip(ticks, amp) if 0.5 * med < a < 1.8 * med]
    good = good[:: max(1, len(good) // 22)][:22]
    for q in good:
        seg = fades(y[q - int(0.003 * sr):q + int(0.011 * sr)], sr, fin=0.0008, fout=0.004)
        sp.add('ratchet', seg, q / sr, lvl=float(np.max(np.abs(y[q - 80:q + 80]))) / med, pre=0.003)
    print('ratchet ticks found', len(ticks), 'used', len(good))
    # End stops of the two returns and the carriage reset at 0:37
    stops = [92.817, 141.659, 37.302]
    alist = [float(np.max(np.abs(y[int(t * sr) - 200:int(t * sr) + 200]))) for t in stops]
    for t, a in zip(stops, alist):
        i = int(t * sr)
        sp.add('endstop', fades(y[i - int(0.006 * sr):i + int(0.32 * sr)], sr, fout=0.08), t, lvl=a / np.median(alist), pre=0.006)
    # Bell: rings under a keystroke at 3:52.5; isolate its partials, keep the ring.
    bt0 = 232.51
    seg = y[int(bt0 * sr):int(234.35 * sr)]
    b = np.zeros(len(seg))
    for fc, bw in [(3320, 260), (7330, 300), (12480, 300)]:
        b += signal.sosfiltfilt(signal.butter(3, [fc - bw / 2, fc + bw / 2], 'band', fs=sr, output='sos'), seg)
    sp.add('bell', fades(b, sr, fin=0.0015, fout=0.3), bt0, pre=0.0)
    # Paper loops, from the steadiest second in each handling passage
    def steadiest(a, b, dur):
        i0, i1 = int(a * sr), int(b * sr); n = int(dur * sr); best, bv = i0, 1e9
        for s in range(i0, i1 - n, int(0.02 * sr)):
            w = y[s:s + n]; v = float(np.max(np.abs(w)) / (np.sqrt(np.mean(w ** 2)) + 1e-9))
            if v < bv: bv, best = v, s
        return best, bv
    for name, a, b in [('paper_rustle', 6.4, 8.45), ('paper_feed', 14.0, 16.5)]:
        s, c = steadiest(a, b, 1.2)
        n = int(1.2 * sr); seg = y[s:s + n + int(0.05 * sr)]
        # crossfade the seam so the loop is continuous
        xf = int(0.05 * sr); up = np.linspace(0, 1, xf)
        loop = seg[:n].copy(); loop[:xf] = loop[:xf] * up + seg[n:n + xf] * (1 - up)
        rms = float(np.sqrt(np.mean(loop ** 2)))
        sp.add(name, loop, s / sr, lvl=rms / 0.07, pre=0.0, meta={'loop': 1, 'crest': round(c, 2)})
    # Clash: no recording of one. Short hard high-passed transients stand in, kept quiet under the modal metal.
    hard = sorted(tiers['hard'], key=lambda k: -k['a'])[:5]
    hp = signal.sosfiltfilt(signal.butter(4, 1800, 'high', fs=sr, output='sos'), y)
    for k in hard:
        i = k['i']; sp.add('clash', fades(hp[i - int(0.003 * sr):i + int(0.05 * sr)], sr, fout=0.02), k['t'], pre=0.003)
    sprite = np.concatenate(sp.parts)
    wavfile.write(f'{work}/sprite.wav', sr, sprite.astype(np.float32))
    json.dump({'sr': sr, 'gapS': GAP_S, 'peakNorm': PEAK, 'items': sp.items}, open(f'{work}/manifest.json', 'w'))
    sets = {}
    for it in sp.items: sets[it['set']] = sets.get(it['set'], 0) + 1
    print('sets', sets, 'sprite s', round(len(sprite) / sr, 1))

if __name__ == '__main__':
    main()
