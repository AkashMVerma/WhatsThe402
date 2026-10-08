#!/usr/bin/env bash
# End-to-end check without a token: mock Radar -> pull -> build dataset -> build site.
# Writes only to a temp folder; the committed data is untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
python3 tests/mock_radar.py 8765 & MOCK=$!
trap 'kill $MOCK 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 1
RADAR_BASE=http://127.0.0.1:8765 CF_RADAR_TOKEN=test python3 scripts/pull_radar.py --sleep 0 --out "$TMP/pulls"
cp public/data/index.json "$TMP/index.real.json"
python3 scripts/build_dataset.py "$TMP/pulls"
npx tsc --noEmit
npx vite build --outDir "$TMP/dist" >/dev/null
cp "$TMP/index.real.json" public/data/index.json   # restore real data
echo "Pipeline OK"
