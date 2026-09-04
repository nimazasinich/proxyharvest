#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$ROOT/deploy/v25.1-xz"
ARCHIVE="$DEPLOY/runtime.tar.xz"
EXPECTED="51761f2b6897f80bcce5401645285ad8d4a2b0e631642c78c31404d21ba273dc"

test -f "$ARCHIVE"
echo "$EXPECTED  $ARCHIVE" | sha256sum -c -
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xJf "$ARCHIVE" -C "$WORK"

test -f "$WORK/index.html"
test -f "$WORK/proxyharvest.js"
test -f "$WORK/api/hf-advisor.js"
test -f "$WORK/vercel.json"
grep -q 'FETCH / HARVEST' "$WORK/index.html"
grep -q 'FETCH ALL ENABLED' "$WORK/index.html"
grep -q 'forceRefresh:true' "$WORK/proxyharvest.js"
grep -q 'verifyAllSources' "$WORK/proxyharvest.js"
node --check "$WORK/proxyharvest.js"
node --check "$WORK/api/hf-advisor.js"

rm -rf "$ROOT/static" "$ROOT/app.py" "$ROOT/deploy_space.py" "$ROOT/requirements.txt"
cp -f "$WORK/index.html" "$ROOT/index.html"
cp -f "$WORK/index.html" "$ROOT/proxyharvest.html"
cp -f "$WORK/proxyharvest.js" "$ROOT/proxyharvest.js"
cp -f "$WORK/vercel.json" "$ROOT/vercel.json"
mkdir -p "$ROOT/api"
cp -f "$WORK/api/hf-advisor.js" "$ROOT/api/hf-advisor.js"

cmp -s "$ROOT/index.html" "$ROOT/proxyharvest.html"
node --check "$ROOT/proxyharvest.js"
node --check "$ROOT/api/hf-advisor.js"
echo 'V25.1 materialization PASS'
