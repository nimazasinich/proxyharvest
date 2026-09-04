#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$ROOT/deploy/v25.1"
WORK="$ROOT/.v25_1_unpack"
EXPECTED_XZ_SHA="51761f2b6897f80bcce5401645285ad8d4a2b0e631642c78c31404d21ba273dc"
rm -rf "$WORK"
mkdir -p "$WORK"

# V25.1 materialization source of truth: xz8 segmented tar.xz.
# Do not fall back to preview URLs; incomplete artifacts must fail closed.
if compgen -G "$DEPLOY/xz8/seg-*.b64" > /dev/null; then
  SEG_COUNT=$(find "$DEPLOY/xz8" -maxdepth 1 -name 'seg-*.b64' | wc -l | tr -d ' ')
  if [ "$SEG_COUNT" != "29" ]; then
    echo "ERROR: expected 29 xz8 segments, found $SEG_COUNT" >&2
    exit 20
  fi
  cat "$DEPLOY"/xz8/seg-*.b64 | tr -d '\n\r' | base64 -d > "$WORK/v25.1-minruntime.tar.xz"
  echo "$EXPECTED_XZ_SHA  $WORK/v25.1-minruntime.tar.xz" | sha256sum -c -
  tar -xJf "$WORK/v25.1-minruntime.tar.xz" -C "$WORK"
else
  echo "ERROR: missing deploy/v25.1/xz8/seg-*.b64 artifact segments" >&2
  exit 21
fi

rm -rf "$ROOT/static" "$ROOT/app.py" "$ROOT/deploy_space.py" "$ROOT/requirements.txt"
cp -f "$WORK/index.html" "$ROOT/index.html"
cp -f "$WORK/index.html" "$ROOT/proxyharvest.html"
cp -f "$WORK/proxyharvest.js" "$ROOT/proxyharvest.js"
cp -f "$WORK/vercel.json" "$ROOT/vercel.json"
mkdir -p "$ROOT/api"
cp -f "$WORK/api/hf-advisor.js" "$ROOT/api/hf-advisor.js"

grep -R "FETCH / HARVEST\|FETCH ALL ENABLED\|Fetch & Harvest" "$ROOT/index.html" "$ROOT/proxyharvest.html" "$ROOT/proxyharvest.js"
grep -R "forceRefresh" "$ROOT/index.html" "$ROOT/proxyharvest.html" "$ROOT/proxyharvest.js"
grep -R "verifyAllSources" "$ROOT/index.html" "$ROOT/proxyharvest.html" "$ROOT/proxyharvest.js"
grep -R "WireGuard" "$ROOT/index.html" "$ROOT/proxyharvest.html" "$ROOT/proxyharvest.js"
rm -rf "$WORK"
