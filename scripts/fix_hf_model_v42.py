#!/usr/bin/env python3
from __future__ import annotations
import subprocess
from pathlib import Path

OLD = "Qwen/Qwen2.5-7B-Instruct" + "-1M:fastest"
NEW = "Qwen/Qwen2.5-7B-Instruct:fastest"
ROOT = Path(__file__).resolve().parents[1]

proc = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, stdout=subprocess.PIPE)
paths = [Path(p.decode()) for p in proc.stdout.split(b"\0") if p]
changed = []
for rel in paths:
    path = ROOT / rel
    if not path.is_file() or path.stat().st_size > 2_000_000:
        continue
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        continue
    if OLD not in text:
        continue
    path.write_text(text.replace(OLD, NEW), encoding="utf-8")
    changed.append(str(rel))

print(f"HF model migration: {len(changed)} file(s) changed")
for item in changed:
    print(item)
if not changed:
    print("No stale 1M model references remain.")
