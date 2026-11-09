#!/usr/bin/env python3
"""Fit the acoustic body from the recording measurements. Run with python3 -I.
usage: fit_model.py <strikes.npz> <measured.json> <portsdir> <out.js> [cal.json]
Writes src/audio/measured_body.js: modal tables (thump/metal/bell), the commuted FIR body responses
for the strike and mechanism paths, normalised by the simulator's own force pulses, so that the
force pulse (and only it) excites the measured body."""
import sys, json, numpy as np
from scipy import signal, ndimage

def env_median(seg, sr, f1, f2, smooth):
    b = signal.sosfiltfilt(signal.butter(3, [f1, f2], 'band', fs=sr, output='sos'), seg, axis=1)
    return np.median(b ** 2, axis=0) ** 0.5

def pick_modes(seg, sr, pre, flo, fhi, n, twin, nper, prom, minsep):
    """Peak-pick from the median spectrum in [twin] seconds after the impact; refine; fit T60 and amplitude."""
    t1, t2 = twin
    i1, i2 = pre + int(t1 * sr), pre + int(t2 * sr)
    w = np.hanning(i2 - i1)
    S = np.abs(np.fft.rfft(seg[:, i1:i2] * w, n=max(nper, i2 - i1), axis=1)) ** 2
    med = np.median(S, axis=0)
    f = np.fft.rfftfreq(max(nper, i2 - i1), 1 / sr)
    db = 10 * np.log10(med + 1e-20)
    db = ndimage.uniform_filter1d(db, 3)
    sel = (f >= flo) & (f <= fhi)
    p, pr = signal.find_peaks(db[sel], prominence=prom, distance=max(2, int(minsep / (f[1] - f[0]))))
    idx = np.where(sel)[0][p]
    prom_v = pr['prominences']
    order = np.argsort(prom_v + (db[idx] - db[idx].max()) * 0.15)[::-1][:n]
    idx = np.sort(idx[order])
    modes = []
    for k in idx:
        fc = f[k]
        bw = max(fc * 0.012, 3.5)
        a, b, c = db[k - 1], db[k], db[k + 1]
        fc += 0.5 * (a - c) / (a - 2 * b + c) * (f[1] - f[0])
        env = env_median(seg, sr, max(20, fc - bw * 2), min(fc + bw * 2, 0.49 * sr), 0.002)
        env = ndimage.uniform_filter1d(env, int(0.001 * sr))
        edb = 20 * np.log10(env + 1e-12)
        pk = pre + int(0.001 * sr) + np.argmax(edb[pre + int(0.001 * sr):pre + int(0.02 * sr)])
        # Fit the early slope only: later keystroke events and the room re-excite these bands, so the
        # late part of the ensemble is a plateau, not this mode's decay.
        max_fit = 0.05 if fc > 800 else 0.09
        below = np.where(edb[pk:] < edb[pk] - 20)[0]
        stop = pk + int(max_fit * sr) if len(below) == 0 else min(pk + below[0], pk + int(max_fit * sr))
        if stop - pk < int(0.002 * sr):
            continue
        t = np.arange(pk, stop) / sr
        s, ic = np.polyfit(t - pk / sr, edb[pk:stop], 1)
        if s >= -5:
            s = -5
        t60 = float(np.clip(-60 / s, 0.012, 0.35 if fc > 800 else 0.45))
        # amplitude extrapolated back to pre (t=0), from a sine in that band
        A = 10 ** ((ic - s * (pk / sr - pre / sr)) / 20) * np.sqrt(2)
        modes.append((round(float(fc), 1), round(t60, 4), float(A)))
    return modes

def synth_modes(modes, sr, n):
    t = np.arange(n) / sr
    y = np.zeros(n)
    for f, t60, A in modes:
        y += A * np.exp(-6.9078 * t / t60) * np.sin(2 * np.pi * f * t + 0.3)
    return y

def pulse_mag(p, f, sr, L):
    F = np.abs(np.fft.rfft(p, n=L))
    return F

def smooth_log(y, sr, L, octs=1/6):
    f = np.fft.rfftfreq(L, 1 / sr)
    out = np.zeros_like(y)
    for i in range(len(y)):
        fc = max(f[i], 30)
        k = (f >= fc * 2 ** (-octs)) & (f <= fc * 2 ** octs)
        k[i] = True                     # always includes the bin itself (low frequencies have no neighbours)
        out[i] = np.exp(np.mean(np.log(y[k] + 1e-30)))
    return out

def design_fir(target_power, phase_seg, L, sr, pulse, fade_in=0.0004, fade_out=0.45, reg_rel=1e-3, cap_db=34, band_gain=lambda f: 1.0):
    """target_power: linear power spectrum (length L/2+1) in recording units; phase_seg: a real strike for
    the temporal structure; pulse: the sim force pulse used to normalise the excitation."""
    Mt = smooth_log(np.sqrt(np.maximum(target_power, 1e-16)), sr, L, 1 / 8)
    Fp = np.abs(np.fft.rfft(pulse, n=L))
    Fp = smooth_log(Fp + 1e-9, sr, L, 1 / 6)
    Fref = np.max(Fp)
    reg = Fref * reg_rel
    H = Mt / np.maximum(Fp, reg)
    # cap the boost relative to the low-frequency gain (<1.5 kHz) so a very smooth pulse doesn't amplify noise
    f = np.fft.rfftfreq(L, 1 / sr)
    base = np.median(H[(f > 300) & (f < 1500)])
    H = np.minimum(H, base * 10 ** (cap_db / 20)) * band_gain(f)
    ph = np.angle(np.fft.rfft(phase_seg, n=L))
    h = np.fft.irfft(H * np.exp(1j * ph), n=L)[:len(phase_seg)]
    # windows
    n = len(h)
    w = np.ones(n)
    a = max(2, int(fade_in * sr)); w[:a] = 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    b = int(fade_out * n); w[-b:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(b) / b)
    h = h * w
    return h

def main():
    npz, meas, portsdir, outp = sys.argv[1:5]
    cal = json.load(open(sys.argv[5])) if len(sys.argv) > 5 else {}
    d = np.load(npz); seg = d['seg']; sr = int(d['sr']); pre = int(d['pre'])
    m = json.load(open(meas))
    ports24 = np.fromfile(f'{portsdir}/strike28.bin', dtype=np.float32).reshape(-1, 11)
    names = 'SLUG FELT PAD GUIDE BARBAR DOG UBAR STOP BELL PAWL RAIL'.split()
    def pulse(port, half_ms=3.0):
        x = ports24[:, names.index(port)]
        i = np.argmax(np.abs(x)); hw = int(half_ms * 1e-3 * sr)
        return x[max(0, i - hw):i + hw].astype(np.float64)
    slug_pulse = pulse('SLUG'); dog_pulse = pulse('DOG', 5.0); ubar_pulse = pulse('UBAR')
    dog_diff = np.diff(dog_pulse, prepend=0.0)   # the mechanism path is driven by dF/dt
    # keep the louder half of strikes for the modal fit
    pk = np.max(np.abs(seg[:, pre - int(0.003 * sr):pre + int(0.02 * sr)]), axis=1)
    use = seg[pk > np.percentile(pk, 40)]
    thump = pick_modes(use, sr, pre, 60, 520, 8, (0.012, 0.28), 16384, 3.0, 12)
    metal = pick_modes(use, sr, pre, 520, 19000, 32, (0.003, 0.12), 8192, 2.5, 60)
    print('thump', len(thump), thump); print('metal', len(metal), [(a[0], round(a[1], 3)) for a in metal])
    # modal gains = recording-unit amplitude / sim pulse magnitude at f
    TO = np.array([63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000], float)
    band_db = np.array(cal.get('band_db', [0.0] * len(TO)))
    def cal_gain(fq):
        return 10 ** (np.interp(np.log(np.maximum(fq, 1.0)), np.log(TO), band_db) / 20)
    def norm(modes, p):
        F = np.abs(np.fft.rfft(p, n=4096)); ff = np.fft.rfftfreq(4096, 1 / sr)
        out = []
        for f, t60, A in modes:
            g = A / max(F[np.argmin(np.abs(ff - f))], 1e-6) * float(cal_gain(np.array([f]))[0])
            out.append([f, t60, g])
        return out
    # FIR: strike path. The target is the median power spectrum of the first 18 ms minus the modal energy.
    PRE_S = 0.006
    L_fir = int(0.024 * sr)
    Lfft = 4096
    w = signal.windows.tukey(L_fir, 0.3)
    start = pre - int(PRE_S * sr)      # keeps the measured pre-impact build-up in the response
    Y = np.abs(np.fft.rfft(use[:, start:start + L_fir] * w, n=Lfft, axis=1)) ** 2
    target_pow = np.median(Y, axis=0)
    modal_sig = np.concatenate([np.zeros(int(PRE_S * sr)), synth_modes(thump + metal, sr, L_fir - int(PRE_S * sr))]) * w
    S_m = np.abs(np.fft.rfft(modal_sig, n=Lfft)) ** 2
    target_fir = np.maximum(target_pow - S_m, 0.02 * target_pow)
    # phase structure from the strike whose peak is the ensemble median (a real, ordinary hit)
    mid = np.argmin(np.abs(pk - np.median(pk)))
    phase_strike = seg[mid, start:start + L_fir]
    fir_strike = design_fir(target_fir, phase_strike, Lfft, sr, slug_pulse, band_gain=cal_gain)
    # FIR: mechanism path, from the later events (escapement, returning parts).
    hp = signal.sosfiltfilt(signal.butter(4, 2000, 'high', fs=sr, output='sos'), seg, axis=1)
    henv = np.sqrt(ndimage.uniform_filter1d(hp ** 2, int(0.0015 * sr), axis=1))
    mech = []
    wl = int(0.012 * sr)
    i0 = pre + int(0.05 * sr)
    for k in range(seg.shape[0]):
        h = henv[k, i0:pre + int(0.32 * sr)]
        p, _ = signal.find_peaks(20 * np.log10(h + 1e-12), prominence=10, distance=int(0.02 * sr))
        if len(p) == 0:
            continue
        j = i0 + p[np.argmax(h[p])]
        if j - int(0.002 * sr) < 0 or j + wl > seg.shape[1]:
            continue
        mech.append(seg[k, j - int(0.002 * sr):j - int(0.002 * sr) + wl])
    mech = np.array(mech)
    print('mech events', mech.shape)
    Wm = signal.windows.tukey(wl, 0.3)
    Ym = np.abs(np.fft.rfft(mech * Wm, n=Lfft, axis=1)) ** 2
    mech_target = np.median(Ym, axis=0)
    pkm = np.max(np.abs(mech), axis=1)
    mid_m = np.argmin(np.abs(pkm - np.median(pkm)))
    fir_mech = design_fir(mech_target, mech[mid_m], Lfft, sr, dog_diff, cap_db=30, band_gain=cal_gain)
    thump_g = norm(thump, slug_pulse); metal_g = norm(metal, slug_pulse)
    # Closed-loop calibration from a previous fit (see tools/audio/calibrate), optional.
    fg_strike = np.array(cal.get('strike_band_gain', []))
    # Bell: partials above 2.5 kHz with long decay from the recording of the machine in a65525.
    bell = [p for p in m['bell_a']['partials'] if p['f'] > 2000 and p['t60'] >= 0.18 and p['amp_rel_db'] >= -22]
    ref = bell[0]['f']
    bell_tbl = [[round(p['f'] / ref, 4), p['t60'], round(10 ** (p['amp_rel_db'] / 20), 4)] for p in bell]
    print('bell', bell_tbl)
    slide = m['slide_noise']['third_oct_rel_db']
    def arr(h): return '[' + ','.join(f'{v:.4e}' if abs(v) > 1e-9 else '0' for v in h) + ']'
    with open(outp, 'w') as o:
        o.write('// Generated by tools/audio/fit_model.py from the recordings in public/assets/audio/SOURCES.md.\n')
        o.write('// Do not edit by hand. Frequencies in Hz, T60 in s. All gains are in recording units per unit\n')
        o.write('// of simulated force (N) at the fitted pulse, so overall level is set once by engine MASTER.\n')
        o.write(f'export const MEASURED_SR = {sr};\n')
        o.write(f'export const PRE_S = {PRE_S};\n')
        o.write('export const THUMP = ' + json.dumps(thump_g) + ';\n')
        o.write('export const METAL = ' + json.dumps(metal_g) + ';\n')
        o.write('export const BELL = ' + json.dumps(bell_tbl) + ';\n')
        o.write('export const FIR_STRIKE = Float64Array.from(' + arr(fir_strike) + ');\n')
        o.write('export const FIR_MECH = Float64Array.from(' + arr(fir_mech) + ');\n')
        o.write('export const SLIDE_NOISE_THIRD_OCT_DB = ' + json.dumps(slide) + ';\n')
        o.write(f"export const MECH_SCALE = {10 ** (cal.get('mech_db', 0.0) / 20):.5f};\n")
        o.write(f"export const THUMP_SCALE = {10 ** (cal.get('thump_db', 0.0) / 20):.5f};\n")
        o.write(f"export const METAL_LATE_SCALE = {10 ** (cal.get('metal_late_db', 0.0) / 20):.5f};\n")
        o.write(f"export const BELL_GAIN = {cal.get('bell_gain', 0.019):.5f};\n")
        o.write(f"export const MASTER_CAL = {cal.get('master', 3.0):.5f};\n")
    print('wrote', outp, 'fir', len(fir_strike), len(fir_mech))

if __name__ == '__main__':
    main()
