from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'patches/runtime-smart-v38.js'
s = PATH.read_text(encoding='utf-8')

marker = "const PH_V38_STATE_STABILITY = '40.0.0';"
if marker in s:
    print('V38 canonical state patch already applied')
    raise SystemExit(0)

anchor = "  const latency = (c) => Number(c?.probe?.latencyMs ?? c?.latency ?? 999999);\n"
if s.count(anchor) != 1:
    raise RuntimeError('V38 state helper anchor mismatch')
s = s.replace(anchor, anchor + "  const PH_V38_STATE_STABILITY = '40.0.0';\n  const runtimeState = () => window.PH_STATE || window.S || null;\n", 1)

replacements = {
    "function bestVerified(limit=100){return bestFrom(window.S?.configs||[],limit)}":
        "function bestVerified(limit=100){return bestFrom(runtimeState()?.configs||[],limit)}",
    "function bestReachable(limit=100){return rank((window.S?.configs||[]).filter(c=>reachable(c)&&!failed(c)&&score(c)>=BEST_SCORE&&latency(c)<=BEST_LATENCY&&fresh(c)&&exportUri(c))).slice(0,limit)}":
        "function bestReachable(limit=100){return rank((runtimeState()?.configs||[]).filter(c=>reachable(c)&&!failed(c)&&score(c)>=BEST_SCORE&&latency(c)<=BEST_LATENCY&&fresh(c)&&exportUri(c))).slice(0,limit)}",
    "function bestSplitVerified(limit=100){return bestFrom(window.S?.splitnetConfigs||[],limit)}":
        "function bestSplitVerified(limit=100){return bestFrom(runtimeState()?.splitnetConfigs||[],limit)}",
    "function syncCounts(){const arr=window.S?.configs||[],c={v:0,r:0,u:0,f:0};":
        "function syncCounts(){const arr=runtimeState()?.configs||[],c={v:0,r:0,u:0,f:0};",
}

for old, new in replacements.items():
    if old not in s:
        raise RuntimeError(f'V38 expected anchor not found: {old[:80]}')
    s = s.replace(old, new, 1)

PATH.write_text(s, encoding='utf-8')
print('Applied V38 canonical PH_STATE patch 40.0.0')
