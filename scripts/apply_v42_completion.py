#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLD_MODEL = 'Qwen/Qwen2.5-7B-Instruct:fastest'
NEW_MODEL = 'Qwen/Qwen3-4B-Instruct-2507:fastest'


def replace_required(path: str, old: str, new: str, label: str) -> bool:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if new in text and old not in text:
        return False
    count = text.count(old)
    if count < 1:
        raise RuntimeError(f'{label}: anchor not found in {path}')
    p.write_text(text.replace(old, new), encoding='utf-8')
    print(f'updated {path}: {label} ({count})')
    return True


def migrate_model() -> None:
    for path in ['worker/proxyharvest-gateway.js', 'api/ai/health.js', 'api/ai/advise.js', 'README.md']:
        p = ROOT / path
        text = p.read_text(encoding='utf-8')
        if OLD_MODEL in text:
            p.write_text(text.replace(OLD_MODEL, NEW_MODEL), encoding='utf-8')
            print(f'updated {path}: HF model')
        elif NEW_MODEL not in text and path != 'README.md':
            raise RuntimeError(f'expected HF model reference missing in {path}')


def harden_control_center() -> None:
    path = 'patches/control-center-v42.js'
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    replacements = [
        ("runtime.worker='checking';runtime.edge='checking';render();", "runtime.worker='checking';runtime.edge='checking';", 'worker audit render batching'),
        ("runtime.bridge='checking';render();", "runtime.bridge='checking';", 'bridge audit render batching'),
        ("runtime.ai='checking';render();", "runtime.ai='checking';", 'AI audit render batching'),
        ("runtime.sourceHealthy=good;runtime.sourceChecked=checked;runtime.sourceTotal=sources.length;render();", "runtime.sourceHealthy=good;runtime.sourceChecked=checked;runtime.sourceTotal=sources.length;", 'source sweep render batching'),
        ("runtime.lastAudit=now();render();\n    await Promise.allSettled([workerAudit(),bridgeAudit(),aiAudit()]);", "runtime.lastAudit=now();runtime.worker='checking';runtime.edge='checking';runtime.bridge='checking';runtime.ai='checking';render();\n    await Promise.allSettled([workerAudit(),bridgeAudit(),aiAudit()]);", 'single audit start render'),
    ]
    for old, new, label in replacements:
        if new in text:
            continue
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f'{label}: expected one anchor, found {count}')
        text = text.replace(old, new, 1)
        print(f'updated {path}: {label}')
    marker = "const BUILD='42.0.1-auto-control-center';"
    if marker not in text:
        text = text.replace("const BUILD='42.0.0-auto-control-center';", marker, 1)
    p.write_text(text, encoding='utf-8')


def update_build_metadata() -> None:
    p = ROOT / 'scripts/build.mjs'
    text = p.read_text(encoding='utf-8')
    text = text.replace("controlCenter: '42.0.0-auto-control-center'", "controlCenter: '42.0.1-auto-control-center'")
    p.write_text(text, encoding='utf-8')

    p = ROOT / 'package.json'
    text = p.read_text(encoding='utf-8')
    text = text.replace('42.0.0-github-main-auto-control-center', '42.0.1-github-main-auto-control-center')
    p.write_text(text, encoding='utf-8')

    p = ROOT / 'package-lock.json'
    text = p.read_text(encoding='utf-8')
    text = text.replace('42.0.0-github-main-auto-control-center', '42.0.1-github-main-auto-control-center')
    p.write_text(text, encoding='utf-8')

    p = ROOT / 'scripts/runtime-stability-check.mjs'
    text = p.read_text(encoding='utf-8')
    text = text.replace('42.0.0-auto-control-center', '42.0.1-auto-control-center')
    text = text.replace("42.0.0-github-main-auto-control-center", "42.0.1-github-main-auto-control-center")
    if "runtime.worker='checking';runtime.edge='checking';render();" in text:
        text = text.replace("assert(v42.includes(\"AUTO_INTERVAL=15*60*1000\"), 'V42 auto-harvest interval marker missing');", "assert(v42.includes(\"AUTO_INTERVAL=15*60*1000\"), 'V42 auto-harvest interval marker missing');")
    if "source sweep renders inside every batch" not in text:
        text += "\nassert(!v42.includes(\"runtime.sourceHealthy=good;runtime.sourceChecked=checked;runtime.sourceTotal=sources.length;render();\"), 'V42 source sweep renders inside every batch');\nassert(!v42.includes(\"runtime.worker='checking';runtime.edge='checking';render();\"), 'V42 worker audit performs redundant intermediate render');\n"
    p.write_text(text, encoding='utf-8')


def main() -> int:
    migrate_model()
    harden_control_center()
    update_build_metadata()
    print('PASS applied ProxyHarvest V42.0.1 completion migration')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
