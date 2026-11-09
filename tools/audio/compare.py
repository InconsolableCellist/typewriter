#!/usr/bin/env python3
"""Compare rendered scenarios against the recording measurements. Run with python3 -I.
usage: compare.py <measured.json> <renderdir>  (renderdir contains sentence.wav, bell.wav, return.wav, strike_*.wav)
Prints a table of recording target vs render for third-octave bands, band decay, attack and crest,
using the same analysis as the recordings (the sentence render is segmented like the recording)."""
import sys, json, importlib.util, os, numpy as np
from scipy.io import wavfile
from scipy import signal
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('measure', os.path.join(here, 'measure.py')); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
spec2 = importlib.util.spec_from_file_location('mstrk', os.path.join(here, 'measure_strikes.py')); ms = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(ms)

def segments(x, sr):
    imp, db = ms.find_impacts(x, sr, min_db=-45)
    pre, post = int(0.03 * sr), int(0.2 * sr)
    imp = imp[(imp > pre) & (imp < len(x) - post)]
    return np.array([x[i - pre:i + post] for i in imp]), pre

def main():
    m = json.load(open(sys.argv[1])); rd = sys.argv[2]
    sr, x = wavfile.read(f'{rd}/sentence.wav'); x = x.astype(float)
    seg, pre = segments(x, sr)
    print(f'sentence: {seg.shape[0]} strikes detected')
    r = mod.strike_stats({'seg': seg, 'sr': sr, 'pre': pre})
    t, tar = r['third_oct_rel_db'], m['strike']['third_oct_rel_db']
    print('\nThird-octave strike spectrum (first 25 ms, dB relative to broadband window energy):')
    print(f'  {"band Hz":>8} {"record":>8} {"render":>8} {"diff":>7}')
    keys = list(tar.keys())
    errs = []
    for k in keys:
        d = t[k] - tar[k]; errs.append(d if float(k) >= 125 else 0.0)
        print(f'  {k:>8} {tar[k]:8.1f} {t[k]:8.1f} {d:7.1f}')
    r['_band_errs'] = errs
    print(f'  rms band error {np.sqrt(np.mean(np.square(errs))):.2f} dB (63 Hz-16 kHz)')
    print('\nBand decay (dB below band peak at +ms) and T60 estimate:')
    for b in m['strike']['decay_by_band']:
        a, bb = m['strike']['decay_by_band'][b], r['decay_by_band'][b]
        print(f'  {b}: rec {a["db_rel_peak_at"]} T60 {a["t60_s"]}')
        print(f'  {" ":{len(b)}}  ren {bb["db_rel_peak_at"]} T60 {bb["t60_s"]}')
    print('\nAttack 10-90 % (ms) rec', m['strike']['attack_10_90_ms_median'], m['strike']['attack_10_90_ms_p25_p75'], 'ren', r['attack_10_90_ms_median'], r['attack_10_90_ms_p25_p75'])
    print('Crest factor (0-200 ms) rec', m['strike']['crest_factor_median'], 'ren', r['crest_factor_median'])
    print('Precursor level rel main (dB) rec', m['strike']['precursor_level_db_rel_main'], 'ren', r['precursor_level_db_rel_main'])
    print('Later events rel main (dB, median) rec', m['strike'].get('later_events', {}).get('level_db_rel_main_median'), 'ren', r.get('later_events', {}).get('level_db_rel_main_median'))
    print('Peak spread p90/p10 (dB) rec', m['strike']['peak_spread_p90_over_p10_db'], 'ren', r['peak_spread_p90_over_p10_db'])
    print('\nStrike-force dynamics (peak dBFS / HF-to-LF ratio dB of the strike window):')
    for name in ('strike_soft', 'strike_nominal', 'strike_hard'):
        try:
            sr2, y = wavfile.read(f'{rd}/{name}.wav'); y = y.astype(float)
        except Exception:
            continue
        pk = np.max(np.abs(y)); ipk = np.argmax(np.abs(y))
        s = y[max(0, ipk - int(0.002 * sr2)):ipk + int(0.03 * sr2)]
        bands = mod.third_oct(s, sr2)
        hf = bands[list(mod.TO).index(5000):].sum(); lf = bands[list(mod.TO).index(200):list(mod.TO).index(1000)].sum()
        print(f'  {name:16s} peak {20*np.log10(pk+1e-9):6.2f} dBFS, HF/LF {10*np.log10(hf/lf+1e-12):6.1f} dB')
    print('\nBell partials (recording bell_a, bell_b) vs render (bell.wav):')
    sr3, b = wavfile.read(f'{rd}/bell.wav'); b = b.astype(float)
    bp = signal.sosfiltfilt(signal.butter(4, [2500, 3200], 'band', fs=sr3, output='sos'), b)
    env = ms.bandpass(b, sr3, 2500, 3200) ** 2
    wn = int(0.02 * sr3); ee = np.convolve(env, np.ones(wn) / wn, 'same')
    pk = int(np.argmax(ee)); pre_b = int(0.005 * sr3)
    # the bell fires at the strike that trips it; partials are measured from its own band peak
    rb = mod.bell_partials(b, sr3, max(0, pk / sr3 - 0.012), 'render bell')
    hb = signal.sosfiltfilt(signal.butter(4, 2000, 'high', fs=sr3, output='sos'), b[max(0, pk - int(0.03 * sr3)):pk + int(0.02 * sr3)])
    eb = np.abs(hb); eb = np.convolve(eb, np.ones(12) / 12, 'same'); ip = int(np.argmax(eb)); i10 = ip
    while i10 > 0 and eb[i10] > 0.1 * eb[ip]: i10 -= 1
    print('  render bell attack (2 kHz+ envelope, 10 % to peak):', round((ip - i10) / sr3 * 1e3, 2), 'ms')
    print('  rec A:', [(p['f'], p['t60']) for p in m['bell_a']['partials'] if p['amp_rel_db'] > -15])
    print('  rec B:', [(p['f'], p['t60']) for p in m['bell_b']['partials'] if p['amp_rel_db'] > -25])
    print('  ren  :', [(p['f'], p['t60']) for p in rb['partials'] if p['amp_rel_db'] > -25], 'attack', rb['attack_10_peak_ms'], 'rec attack', m['bell_a']['attack_10_peak_ms'], m['bell_b']['attack_10_peak_ms'])
    # return scenario summary
    sr4, c = wavfile.read(f'{rd}/return.wav'); c = c.astype(float)
    print('\nReturn scenario: peak', round(20 * np.log10(np.max(np.abs(c)) + 1e-9), 2), 'dBFS, rms', round(20 * np.log10(np.sqrt(np.mean(c ** 2)) + 1e-9), 2), 'dBFS')
    return r

if __name__ == '__main__':
    r = main()
    if len(sys.argv) > 3:
        json.dump({'errs': r['_band_errs'], 'later': r.get('later_events', {}).get('level_db_rel_main_median')}, open(sys.argv[3], 'w'))
