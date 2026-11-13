#!/usr/bin/env python3
"""Analyse the running Displaywriter's idle sound for the procedural hum (architecture.md 10.4, src/audio/wp-hum.js).
Run with python3 -I. usage: analyze_wp_hum.py <displaywriter.wav> [out.json] [out.js]

The input is the owner's Displaywriter recording decoded to mono 48 kHz WAV, as for cut_wp_samples.py:
  ffmpeg -i displaywriter_dc4nl.opus -ac 1 -ar 48000 displaywriter.wav
Writes tools/audio/wp_hum.json and src/audio/wp-hum-data.js (the same data as an ES module, for the worklet).

The machine is idle (running, nothing moving) at 117.5-128 s and 184-190.5 s. Those stretches also hold rustling and
handling in the room, so every spectrum here is a median over 1.4 s frames (Welch with median averaging): a sound
present in only a few frames does not move it, the steady machine does. From that spectrum:
  tones   the narrow lines standing at least 10 dB over the spectrum's running median (0.73 Hz bins), the strongest
          TONES of them between 40 Hz and 12 kHz (the display's 15.03 kHz line is voiced apart, wp-synth's crtWhine);
          each with its power (the bins of its main lobe over the floor). The 100 Hz family is the 50 Hz line's
          magnetostriction; on this 60 Hz machine every tone under the split plays at 1.2 times its frequency.
  bands   the noise floor (the running median, so with the lines taken out) in third-octave bands, 20 Hz to 20 kHz,
          as band power.
Both are split at 450 Hz as the old loops were: under it the drive motors' voice (follows the motors' speed and the
power), over it the fans' air (follows the station fan's speed). Levels are dBFS in the recording; the engine keeps only
their balance and sets the whole at the idle level of the old loops (BED_DBFS plus HUM_LIFT_DB)."""
import sys, os, json, numpy as np
from scipy.io import wavfile
from scipy import signal

SR = 48000
IDLE = [(117.5, 128.0), (184.0, 190.5)]
SPLIT_HZ = 450.0
NFFT = 65536
TONES = 16
TONE_LO, TONE_HI = 40.0, 12000.0
PROMINENCE_DB = 10.0
RECORDED_MAINS_HZ = 50


def main():
    src = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    out_json = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, 'wp_hum.json')
    out_js = sys.argv[3] if len(sys.argv) > 3 else os.path.join(here, '..', '..', 'src', 'audio', 'wp-hum-data.js')
    sr, x = wavfile.read(src)
    assert sr == SR, f'{src}: {sr} Hz, expected {SR}'
    x = x.astype(np.float64)
    if x.ndim > 1: x = x.mean(axis=1)
    x /= 32768.0 if np.abs(x).max() > 2 else 1.0
    segs = [x[int(a * SR):int(b * SR)] for a, b in IDLE]
    acc, n = 0, 0
    for s in segs:
        f, p = signal.welch(s, SR, window='hann', nperseg=NFFT, noverlap=NFFT * 3 // 4, average='median')
        acc = acc + p * len(s); n += len(s)
    p = acc / n
    df = f[1] - f[0]
    ldb = 10 * np.log10(p + 1e-30)
    floor_db = signal.medfilt(ldb, 301)
    floor = 10 ** (floor_db / 10)
    rms_all = float(np.sqrt(np.sum(p) * df))
    # Tones: peaks over the floor; power in the main lobe (+-2 bins) over the floor.
    pk, _ = signal.find_peaks(ldb - floor_db, height=PROMINENCE_DB, distance=3)
    cand = []
    for k in pk:
        if not TONE_LO <= f[k] <= TONE_HI: continue
        lobe = slice(k - 2, k + 3)
        pw = float(np.sum(np.maximum(p[lobe] - floor[lobe], 0)) * df)
        # the frequency from the lobe's centroid
        hz = float(np.sum(f[lobe] * p[lobe]) / np.sum(p[lobe]))
        cand.append((pw, hz))
    cand.sort(reverse=True)
    tones = sorted(cand[:TONES], key=lambda c: c[1])
    # Bands: the floor in third octaves.
    bands = []
    for k in range(13, 44):
        fc = 10 ** (k / 10)
        lo, hi = fc * 2 ** (-1 / 6), fc * 2 ** (1 / 6)
        sel = (f >= lo) & (f < hi)
        if not sel.any() or hi > SR / 2: continue
        pw = float(np.sum(floor[sel]) * df)
        bands.append((round(fc, 1), pw))
    db = lambda pw: round(10 * np.log10(max(pw, 1e-30)), 2)
    def voice(lo, hi):
        t = [{'hz': round(hz, 2), 'db': db(pw)} for pw, hz in tones if lo <= hz < hi]
        b = [{'hz': fc, 'db': db(pw)} for fc, pw in bands if lo <= fc < hi]
        rms = float(np.sqrt(sum(pw for pw, hz in tones if lo <= hz < hi) + sum(pw for fc, pw in bands if lo <= fc < hi)))
        tone_rms = float(np.sqrt(sum(pw for pw, hz in tones if lo <= hz < hi)))
        return {'rmsDb': db(rms ** 2), 'toneRmsDb': db(tone_rms ** 2), 'tones': t, 'bands': b}
    motor, fan = voice(0, SPLIT_HZ), voice(SPLIT_HZ, 1e9)
    total = 10 * np.log10(10 ** (motor['rmsDb'] / 10) + 10 ** (fan['rmsDb'] / 10))
    out = {
        'source': 'displaywriter_dc4nl.opus (public/assets/audio/SOURCES.md), idle at ' + ', '.join(f'{a}-{b} s' for a, b in IDLE),
        'method': 'tools/audio/analyze_wp_hum.py: median Welch spectrum (65536-point Hann, 0.73 Hz bins); tones over the '
                  'running median, noise floor in third-octave bands; levels in dBFS in the recording',
        'recordedMainsHz': RECORDED_MAINS_HZ, 'splitHz': SPLIT_HZ,
        'idleRmsDb': db(rms_all ** 2), 'modelRmsDb': round(float(total), 2),
        # The wander that keeps it from repeating: each tone's level and frequency random-walk around their means.
        'wander': {'ampDb': 1.0, 'ampTauS': 1.5, 'freqRel': 0.0015, 'freqTauS': 2.5, 'mainsFreqRel': 0.0003, 'bandDb': 0.5, 'bandTauS': 1.0},
        'motor': motor, 'fan': fan,
    }
    with open(out_json, 'w') as fh: json.dump(out, fh, indent=1)
    with open(out_js, 'w') as fh:
        fh.write('// Generated by tools/audio/analyze_wp_hum.py from the owner\'s Displaywriter recording: the idle machine\'s tones\n'
                 '// and noise floor (third-octave bands), dBFS in the recording. Do not edit; rerun the script.\n')
        fh.write('export const HUM = ' + json.dumps(out, indent=1) + ';\n')
    print(f'idle {out["idleRmsDb"]} dBFS (median spectrum), model {out["modelRmsDb"]}; motor {motor["rmsDb"]} '
          f'(tones {motor["toneRmsDb"]}, {len(motor["tones"])}), fan {fan["rmsDb"]} (tones {fan["toneRmsDb"]}, {len(fan["tones"])})')
    for v in (motor, fan):
        print(' '.join(f'{t["hz"]:.1f}:{t["db"]:.0f}' for t in v['tones']))
        print(' '.join(f'{b["hz"]:.0f}:{b["db"]:.0f}' for b in v['bands']))


if __name__ == '__main__':
    main()
