#!/usr/bin/env python3
"""Measure the recordings listed in public/assets/audio/SOURCES.md. Run with python3 -I.
usage: measure.py <decoded_wav_dir> <strikes.npz> <out.json>
Writes: third-octave band levels and decay per band, attack, crest, sub-event timing and levels
for keystrokes (aligned ensemble from measure_strikes.py); bell partials, T60 and attack for both bells;
level and spectrum of the carriage-slide noise event."""
import sys, json, numpy as np
from scipy.io import wavfile
from scipy import signal, ndimage

TO = np.array([63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000], float)

def third_oct(x, sr):
    """x: 1d array; returns band energies (linear power) at TO centres."""
    n = len(x)
    X = np.fft.rfft(x * np.hanning(n), n=max(n, 16384))
    f = np.fft.rfftfreq(max(n, 16384), 1 / sr)
    P = np.abs(X) ** 2
    out = []
    for c in TO:
        out.append(P[(f >= c * 2 ** (-1 / 6)) & (f < c * 2 ** (1 / 6))].sum())
    return np.array(out)

def band_env(x, sr, f1, f2, smooth):
    b = signal.sosfiltfilt(signal.butter(4, [f1, min(f2, 0.49 * sr)], 'band', fs=sr, output='sos'), x)
    return np.sqrt(np.maximum(0, ndimage.uniform_filter1d(b ** 2, int(smooth * sr))))

def t60_from_env(env, sr, t_start, t_stop, floor_db):
    i0, i1 = int(t_start * sr), min(len(env), int(t_stop * sr))
    t = np.arange(i0, i1) / sr
    db = 20 * np.log10(env[i0:i1] + 1e-12)
    ok = db > floor_db + 6
    if ok.sum() < 8:
        return None
    # stop at first crossing into the floor
    last = np.where(~ok)[0]
    if len(last) and last[0] > 8:
        t, db = t[:last[0]], db[:last[0]]
    a, b = np.polyfit(t, db, 1)
    if a >= -1:
        return None
    return float(-60.0 / a)

def strike_stats(d):
    seg, sr, pre = d['seg'], int(d['sr']), int(d['pre'])
    n = seg.shape[0]
    res = {'count': n, 'sr': sr}
    post = int(0.025 * sr)
    # per strike normalised to its own window RMS for spectrum comparison
    bands = np.array([third_oct(s[pre - int(0.001 * sr):pre + post], sr) for s in seg])
    refband = bands.sum(axis=1, keepdims=True)
    res['third_oct_rel_db'] = dict(zip([str(int(c)) for c in TO], np.round(10 * np.log10(np.median(bands / refband, axis=0) + 1e-16), 2).tolist()))
    # crest factor: peak over RMS in [0,200ms]; attack: 10-90% of peak on smoothed |x| before the peak
    cfs, atts = [], []
    for s in seg:
        y = s[pre - int(0.02 * sr):pre + int(0.2 * sr)]
        pk = np.max(np.abs(y)); rms = np.sqrt(np.mean(y ** 2))
        cfs.append(pk / rms)
        e = ndimage.uniform_filter1d(np.abs(s), max(3, int(0.00025 * sr)))
        p = np.argmax(e[pre - int(0.02 * sr):pre + int(0.02 * sr)]) + pre - int(0.02 * sr)
        pv = e[p]
        i90 = p
        while i90 > 0 and e[i90] > 0.9 * pv:
            i90 -= 1
        i10 = i90
        while i10 > 0 and e[i10] > 0.1 * pv:
            i10 -= 1
        atts.append((i90 - i10) / sr * 1e3)
    res['crest_factor_median'] = round(float(np.median(cfs)), 2)
    res['attack_10_90_ms_median'] = round(float(np.median(atts)), 3)
    res['attack_10_90_ms_p25_p75'] = [round(float(np.percentile(atts, 25)), 3), round(float(np.percentile(atts, 75)), 3)]
    # decay by band from the ensemble median power envelope
    bandsd = {'100-300': (100, 300), '300-1k': (300, 1000), '1k-3k': (1000, 3000), '3k-8k': (3000, 8000), '8k-16k': (8000, 16000)}
    decay = {}
    for name, (f1, f2) in bandsd.items():
        env = np.median(band_env(seg, sr, f1, f2, 0.002), axis=0)
        floor = 20 * np.log10(np.median(env[:int(0.012 * sr)]) + 1e-12)
        ipk = pre + np.argmax(env[pre - int(0.003 * sr):pre + int(0.01 * sr)]) - int(0.003 * sr)
        env_db = 20 * np.log10(env + 1e-12) - 20 * np.log10(env[ipk] + 1e-12)
        def fall(x):
            k = np.where(env_db[ipk:] < x)[0]
            return None if len(k) == 0 else round(k[0] / sr * 1e3, 1)
        t60 = t60_from_env(env, sr, ipk / sr + 0.002, ipk / sr + 0.10, floor)
        decay[name] = {'db_rel_peak_at': {str(ms): round(float(env_db[ipk + int(ms * 1e-3 * sr)]), 1) for ms in (5, 10, 20, 40, 80, 160)}, 't60_s': None if t60 is None else round(t60, 3), 'to_-20dB_ms': fall(-20), 'to_-40dB_ms': fall(-40)}
    res['decay_by_band'] = decay
    # sub-events: precursor window and later events
    hp = signal.sosfiltfilt(signal.butter(4, 2000, 'high', fs=sr, output='sos'), seg, axis=1)
    win = int(0.0015 * sr)
    henv = np.sqrt(ndimage.uniform_filter1d(hp ** 2, win, axis=1))
    mainpk = henv[:, pre - int(0.002 * sr):pre + int(0.004 * sr)].max(axis=1)
    prec = henv[:, pre - int(0.022 * sr):pre - int(0.003 * sr)].max(axis=1)
    res['precursor_level_db_rel_main'] = round(float(np.median(20 * np.log10(prec / mainpk + 1e-9))), 1)
    prec_t = (np.argmax(henv[:, pre - int(0.022 * sr):pre - int(0.003 * sr)], axis=1) - int(0.022 * sr) + int(0.003 * sr) * 0) / sr * 1e3
    res['precursor_time_ms_median'] = round(float(np.median(prec_t + int(-0.022 * sr) * 0)), 1)
    later = []
    for k in range(n):
        h = henv[k, pre + int(0.03 * sr):pre + int(0.3 * sr)]
        peaks, prop = signal.find_peaks(20 * np.log10(h + 1e-12), prominence=10, distance=int(0.02 * sr))
        for p in peaks:
            later.append(((p + int(0.03 * sr)) / sr * 1e3, 20 * np.log10(h[p] / mainpk[k] + 1e-9)))
    later = np.array(later)
    if len(later):
        hist, edges = np.histogram(later[:, 0], bins=np.arange(30, 310, 20))
        res['later_events'] = {'time_hist_ms': {f'{int(edges[i])}-{int(edges[i + 1])}': int(hist[i]) for i in range(len(hist))}, 'level_db_rel_main_median': round(float(np.median(later[:, 1])), 1), 'level_db_rel_main_p10_p90': [round(float(np.percentile(later[:, 1], 10)), 1), round(float(np.percentile(later[:, 1], 90)), 1)], 'count_per_strike': round(len(later) / n, 2)}
    # spectrum of later events (third-oct, mean of windows around each detected event)
    lat_bands = []
    for k in range(n):
        h = henv[k, pre + int(0.03 * sr):pre + int(0.3 * sr)]
        peaks, _ = signal.find_peaks(20 * np.log10(h + 1e-12), prominence=10, distance=int(0.02 * sr))
        if len(peaks) == 0:
            continue
        j = pre + int(0.03 * sr) + peaks[np.argmax(h[peaks])]
        lat_bands.append(third_oct(seg[k, j - int(0.003 * sr):j + int(0.03 * sr)], sr))
    if lat_bands:
        lb = np.array(lat_bands)
        res['later_events_third_oct_rel_db'] = dict(zip([str(int(c)) for c in TO], np.round(10 * np.log10(np.median(lb / lb.sum(axis=1, keepdims=True), axis=0) + 1e-16), 2).tolist()))
    # peak level spread of the strikes
    pk = np.max(np.abs(seg[:, pre - int(0.005 * sr):pre + int(0.03 * sr)]), axis=1)
    res['peak_percentiles'] = {str(p): round(float(np.percentile(pk, p)), 4) for p in (10, 25, 50, 75, 90)}
    res['peak_spread_p90_over_p10_db'] = round(float(20 * np.log10(np.percentile(pk, 90) / np.percentile(pk, 10))), 1)
    return res

def bell_partials(x, sr, t0, label, fmax=20000):
    x = x[int(t0 * sr):]
    n = 8192
    f, t, S = signal.stft(x, sr, nperseg=n, noverlap=n - 512, padded=False, boundary=None)
    A = np.abs(S)
    mean = A[:, 1:5].mean(axis=1)
    db = 20 * np.log10(mean + 1e-12)
    peaks, _ = signal.find_peaks(db, height=np.percentile(db, 96), distance=int(180 / (f[1] - f[0])))
    peaks = [p for p in peaks if 600 < f[p] < fmax]
    out = []
    for p in peaks:
        # refine frequency by parabolic interpolation over time-mean spectrum
        a, b, c = db[p - 1], db[p], db[p + 1]
        d = 0.5 * (a - c) / (a - 2 * b + c)
        fp = f[p] + d * (f[1] - f[0])
        tr = A[p, :]
        trdb = 20 * np.log10(tr + 1e-12)
        i0 = int(np.argmax(trdb[:8]))
        peakdb = trdb[i0]
        idx = np.where(trdb[i0:] < peakdb - 35)[0]
        i1 = i0 + (idx[0] if len(idx) else len(trdb) - i0 - 1)
        if i1 - i0 < 6:
            continue
        tv = t[i0:i1]
        s, ic = np.polyfit(tv, trdb[i0:i1], 1)
        if s >= -1:
            continue
        out.append({'f': round(float(fp), 1), 't60': round(float(-60 / s), 3), 'amp_db': round(float(peakdb), 1), 'r2': round(float(np.corrcoef(tv, trdb[i0:i1])[0, 1] ** 2), 3)})
    out.sort(key=lambda m: m['f'])
    ref = max([m['amp_db'] for m in out]) if out else 0
    for m in out:
        m['amp_rel_db'] = round(m['amp_db'] - ref, 1)
    # onset of broadband and attack: 10->90% peak of the 1 ms smoothed envelope in the first 30 ms
    e = ndimage.uniform_filter1d(np.abs(x), max(1, int(0.00025 * sr)))
    head = e[:int(0.03 * sr)]
    p = int(np.argmax(head)); i10 = p
    while i10 > 0 and head[i10] > 0.1 * head[p]:
        i10 -= 1
    return {'label': label, 'partials': out, 'attack_10_peak_ms': round(float((p - i10) / sr * 1e3), 2), 'peak': round(float(np.max(np.abs(x))), 4)}

def main():
    dec, npz, outp = sys.argv[1:4]
    res = {}
    d = np.load(npz)
    res['strike'] = strike_stats(d)
    sr, a = wavfile.read(f'{dec}/a65525.wav'); a = a.astype(float)
    # Bell on the strike-recording machine (two events near 61.37 and 61.52 s)
    res['bell_a'] = bell_partials(a, sr, 61.495, 'a65525 bell at 61.52 s')
    sr2, b = wavfile.read(f'{dec}/bell.wav'); b = b.astype(float)
    res['bell_b'] = bell_partials(b, sr2, 0.02, 'stubb bell (near mono)')
    # Carriage slide noise event (unconfirmed attribution): 52.7..53.35 s
    seg = a[int(52.7 * sr):int(53.35 * sr)]
    sb = third_oct(seg, sr)
    medpk = res['strike']['peak_percentiles']['50']
    res['slide_noise'] = {'duration_s': 0.65, 'rms_db_rel_median_strike_peak': round(float(20 * np.log10(np.sqrt(np.mean(seg ** 2)) / medpk)), 1), 'third_oct_rel_db': dict(zip([str(int(c)) for c in TO], np.round(10 * np.log10(sb / sb.sum() + 1e-16), 2).tolist()))}
    # background floor between bursts of the recording
    json.dump(res, open(outp, 'w'), indent=1)
    print(json.dumps({k: res[k] for k in res if k != 'strike'}, indent=1)[:3000])
    print(json.dumps({k: v for k, v in res['strike'].items() if 'third' not in k}, indent=1))

if __name__ == '__main__':
    main()
