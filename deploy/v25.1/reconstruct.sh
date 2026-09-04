#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY="$ROOT/deploy/v25.1"
WORK="$ROOT/.v25_1_unpack"
rm -rf "$WORK"
mkdir -p "$WORK"
cat "$DEPLOY"/chunks/part-*.b64 | base64 -d > "$WORK/package.zip"
echo "2a60d028c7290bf440bcf74281ee04639fdb119cff7df96f83c57e34af169a48  $WORK/package.zip" | sha256sum -c -
unzip -q "$WORK/package.zip" -d "$WORK/unpacked"
# Replace the legacy V18/Python runtime with the exact V25.1 package contents.
rm -rf "$ROOT/static" "$ROOT/app.py" "$ROOT/deploy_space.py" "$ROOT/requirements.txt"
cp -f "$WORK/unpacked/index.html" "$ROOT/index.html"
cp -f "$WORK/unpacked/proxyharvest.html" "$ROOT/proxyharvest.html"
cp -f "$WORK/unpacked/proxyharvest.js" "$ROOT/proxyharvest.js"
cp -f "$WORK/unpacked/vercel.json" "$ROOT/vercel.json"
mkdir -p "$ROOT/api"
cp -f "$WORK/unpacked/api/hf-advisor.js" "$ROOT/api/hf-advisor.js"
cp -f "$WORK/unpacked/V25_1_CHANGELOG.md" "$ROOT/V25_1_CHANGELOG.md" || true
cp -f "$WORK/unpacked/V25_1_VERIFICATION.json" "$ROOT/V25_1_VERIFICATION.json" || true
cp -f "$WORK/unpacked/V25_1_BROWSER_AUDIT.json" "$ROOT/V25_1_BROWSER_AUDIT.json" || true
rm -rf "$WORK"
