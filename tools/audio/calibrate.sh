#!/usr/bin/env bash
# <work dir> holds strikes.npz (measure_strikes.py), measured.json (measure.py) and sim/ (dump_ports.mjs).
# The decoded recordings are not in the repo: see public/assets/audio/SOURCES.md to fetch them.
# Closed-loop calibration: fit -> render the sentence through the full mechanism -> compare with the recording
# in third-octave bands -> adjust band gains and path gains. Usage: calibrate.sh <work dir> <iterations>
set -e
W="$1"; ITER="${2:-3}"
cd "$(dirname "$0")/../.."
[ -f "$W/cal.json" ] || echo '{}' > "$W/cal.json"
for i in $(seq 1 "$ITER"); do
  python3 -I tools/audio/fit_model.py "$W/strikes.npz" "$W/measured.json" "$W/sim" src/audio/measured_body.js "$W/cal.json" 2>/dev/null >/dev/null
  NO_LIMIT=1 node tools/audio/render_proofs.mjs "$W/render" sentence >/dev/null
  python3 -I tools/audio/compare.py "$W/measured.json" "$W/render" "$W/err.json" | grep -E "rms band error|Later events"
  python3 -I tools/audio/update_cal.py "$W/cal.json" "$W/err.json"
done
