#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_one(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


def replace_rx(text: str, pattern: str, new: str, label: str) -> str:
    if new in text:
        return text
    out, count = re.subn(pattern, new, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one regex match, found {count}")
    return out


def patch_v38() -> None:
    path = "patches/runtime-smart-v38.js"
    s = read(path)
    if "const BUILD = '38.2.0-smart-runtime-stability'" in s:
        return
    s = replace_one(s, "const BUILD = '38.1.0-smart-runtime';", "const BUILD = '38.2.0-smart-runtime-stability';", "v38 build")
    s = replace_one(
        s,
        "  function setValue(id,value){ const el=document.getElementById(id); if(!el)return; if(el.type==='checkbox')el.checked=!!value; else el.value=value??''; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }",
        "  function setValue(id,value){ const el=document.getElementById(id); if(!el)return false; const next=el.type==='checkbox'?!!value:String(value??''); const current=el.type==='checkbox'?!!el.checked:String(el.value??''); if(current===next)return false; if(el.type==='checkbox')el.checked=next; else el.value=next; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }\n  function setText(id,value){const el=document.getElementById(id);if(!el)return false;const next=String(value);if(el.textContent===next)return false;el.textContent=next;return true}",
        "v38 idempotent setters",
    )
    s = replace_rx(
        s,
        r"  function syncCounts\(\)\{.*?\}\n  function boot",
        "  function syncCounts(){const arr=window.S?.configs||[],c={v:0,r:0,u:0,f:0};for(const x of arr){if(verified(x))c.v++;else if(reachable(x))c.r++;else if(failed(x))c.f++;else c.u++}setText('phMetricVerified',c.v);setText('phMetricReachable',c.r);setText('phMetricUntested',c.u);setText('phMetricFailed',c.f);return c}\n  function boot",
        "v38 syncCounts",
    )
    s = replace_rx(
        s,
        r"  function boot\(\)\{migrateAppSettings\(\);.*?window\.PROXYHARVEST_V38=Object\.freeze\(\{BUILD,runtimeAudit,detectBridgeSmart,bestVerified,bestReachable,bestSplitVerified,applySmartInfrastructureDefaults\}\)\}\n  if\(document\.readyState",
        """  function boot(){
    migrateAppSettings();
    applySmartInfrastructureDefaults();
    sanitizeTokenFields();
    fixInfrastructureFields();
    installBestExports();
    installSmartButtons();
    syncCounts();

    let repairTimer=null;
    let repairing=false;
    const repairUi=()=>{
      if(repairing)return;
      repairing=true;
      try{sanitizeTokenFields();fixInfrastructureFields();installBestExports();installSmartButtons();syncCounts()}
      finally{repairing=false}
    };
    const scheduleRepair=()=>{
      if(repairTimer)clearTimeout(repairTimer);
      repairTimer=setTimeout(()=>{repairTimer=null;repairUi()},180);
    };
    const mo=new MutationObserver(records=>{
      if(records.some(r=>r.addedNodes?.length||r.removedNodes?.length))scheduleRepair();
    });
    if(document.body)mo.observe(document.body,{subtree:true,childList:true});

    const periodic=setInterval(()=>{if(document.visibilityState==='visible')syncCounts()},5000);
    window.addEventListener('pagehide',()=>{clearInterval(periodic);mo.disconnect();if(repairTimer)clearTimeout(repairTimer)},{once:true});
    setTimeout(()=>runtimeAudit({quiet:true}),250);
    window.PROXYHARVEST_V38=Object.freeze({BUILD,runtimeAudit,detectBridgeSmart,bestVerified,bestReachable,bestSplitVerified,applySmartInfrastructureDefaults});
  }
  if(document.readyState""",
        "v38 stable boot",
    )
    write(path, s)


def patch_v32() -> None:
    path = "patches/status-sync-v32.js"
    s = read(path)
    if "PH_V32_RUNTIME_STABILITY" in s:
        return
    s = replace_rx(
        s,
        r"  function setText\(id, value\) \{.*?\n  \}\n\n  function renderConfigStatus",
        """  const PH_V32_RUNTIME_STABILITY = '39.0.0';
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
  }

  function renderConfigStatus""",
        "v32 idempotent text",
    )
    s = replace_one(
        s,
        "    const audit = { ...c, at: Date.now() };\n    window.PROXYHARVEST_VERIFICATION_AUDIT = audit;\n    window.dispatchEvent(new CustomEvent('ph:v32-verification-sync', { detail: audit }));",
        "    const audit = { ...c, at: Date.now() };\n    window.PROXYHARVEST_VERIFICATION_AUDIT = audit;\n    const auditFingerprint = `${c.total}:${c.verified}:${c.reachable}:${c.failed}:${c.untested}:${c.exportableVerified}`;\n    if (window.__PH_V32_LAST_AUDIT_FP !== auditFingerprint) {\n      window.__PH_V32_LAST_AUDIT_FP = auditFingerprint;\n      window.dispatchEvent(new CustomEvent('ph:v32-verification-sync', { detail: audit }));\n    }",
        "v32 event dedupe",
    )
    s = replace_rx(
        s,
        r"  function syncAll\(\) \{.*?\n  \}\n\n  function openBestExport",
        """  let lastExportRefreshFingerprint = '';
  let lastExportRefreshAt = 0;
  function syncAll() {
    const c = counts();
    renderConfigStatus(c);
    updateBestExportAction(c);
    const fingerprint = `${c.total}:${c.verified}:${c.reachable}:${c.failed}:${c.untested}:${c.exportableVerified}`;
    const now = Date.now();
    if (fingerprint !== lastExportRefreshFingerprint || now - lastExportRefreshAt > 8000) {
      lastExportRefreshFingerprint = fingerprint;
      lastExportRefreshAt = now;
      $('#phv26RefreshExport')?.click();
    }
    return c;
  }

  function openBestExport""",
        "v32 throttled sync",
    )
    s = replace_rx(
        s,
        r"  function updateBestExportAction\(c = counts\(\)\) \{.*?\n  \}\n\n  const dashboardProgress",
        """  function updateBestExportAction(c = counts()) {
    ensureBestExportAction();
    let eligible = 0;
    for (const cfg of state()?.configs || []) {
      if (classify(cfg) === 'verified' && score(cfg) >= 70 && exportUri(cfg)) eligible++;
    }
    const count = Math.min(100, eligible);
    const btn = $('#phv32BestExport');
    const n = $('#phv32BestCount');
    if (n) setText('phv32BestCount', count);
    if (btn) {
      btn.disabled = count === 0;
      btn.title = count ? `Export top ${count} verified configs (score ≥70)` : 'No exportable verified configs yet';
    }
    return count;
  }

  const dashboardProgress""",
        "v32 lightweight best count",
    )
    s = replace_rx(
        s,
        r"  function observeRuntime\(\) \{.*?\n  \}\n\n  function boot",
        """  let runtimeSyncTimer = null;
  function scheduleRuntimeSync() {
    if (runtimeSyncTimer) return;
    runtimeSyncTimer = setTimeout(() => {
      runtimeSyncTimer = null;
      if (document.visibilityState !== 'visible') return;
      const c = syncAll();
      animateCountChanges(c);
    }, 140);
  }

  function observeRuntime() {
    const targets = ['realTestLive', 'realTestStatus', 'progStatus', 'progCount', 'dbStatusText'];
    const observer = new MutationObserver(scheduleRuntimeSync);
    for (const id of targets) {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    }
    window.addEventListener('pagehide', () => { observer.disconnect(); if (runtimeSyncTimer) clearTimeout(runtimeSyncTimer); }, { once: true });
  }

  function boot""",
        "v32 debounced observer",
    )
    s = replace_one(
        s,
        "    setInterval(() => {\n      patchStrictOption();\n      patchRealTestEngine();\n      const next = syncAll();\n      animateCountChanges(next);\n    }, 1400);",
        "    const periodic = setInterval(() => {\n      patchStrictOption();\n      patchRealTestEngine();\n      if (document.visibilityState !== 'visible') return;\n      const next = syncAll();\n      animateCountChanges(next);\n    }, 5000);\n    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });",
        "v32 slow periodic",
    )
    write(path, s)


def patch_v27() -> None:
    path = "patches/auto-pipeline-v27.js"
    s = read(path)
    if "PH_V27_RUNTIME_STABILITY" in s:
        return
    s = replace_rx(
        s,
        r"  function setText\(id, value\) \{.*?\n  \}\n\n  function refreshVisibleStats",
        """  const PH_V27_RUNTIME_STABILITY = '39.0.0';
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
  }

  function refreshVisibleStats""",
        "v27 idempotent text",
    )
    s = replace_rx(
        s,
        r"  function refreshVisibleStats\(\) \{.*?\n  \}\n\n  function setStage",
        """  let lastStatsFingerprint = '';
  function refreshVisibleStats({ force = false } = {}) {
    const c = counts();
    setText('s-total', c.total);
    setText('csr-total', c.total);
    setText('stat-alive', c.verified);
    setText('csr-live', c.verified);
    setText('csr-dead', c.failed);
    setText('s-active', c.highScore);
    setText('stat-tested', `${c.tested} tested`);
    setText('phv27Live', c.verified);
    setText('phv27Reachable', c.reachable);
    setText('phv27Failed', c.failed);
    setText('phv27Untested', c.untested);
    setText('phv27HighScore', c.highScore);
    const fingerprint = `${c.total}:${c.verified}:${c.reachable}:${c.failed}:${c.untested}:${c.tested}:${c.highScore}`;
    if (force || fingerprint !== lastStatsFingerprint) {
      lastStatsFingerprint = fingerprint;
      const search = $('#cfgSearch');
      if (search) search.dispatchEvent(new Event('input', { bubbles: true }));
      $('#phv26RefreshExport')?.click();
      window.dispatchEvent(new CustomEvent('ph:v27-stats', { detail: c }));
    }
    return c;
  }

  function setStage""",
        "v27 dedupe stats",
    )
    final_anchor = "      const c = refreshVisibleStats();"
    if s.count(final_anchor) == 1:
        s = s.replace(final_anchor, "      const c = refreshVisibleStats({ force: true });", 1)
    elif "refreshVisibleStats({ force: true })" not in s:
        raise RuntimeError(f"v27 final stats anchor count={s.count(final_anchor)}")
    s = replace_one(
        s,
        "    refreshVisibleStats();\n  }\n\n  function boot()",
        "    refreshVisibleStats({ force: true });\n  }\n\n  function boot()",
        "v27 initial force",
    )
    s = replace_one(
        s,
        "    setInterval(watchFetchState, 250);\n    setInterval(() => {\n      if (!pipelineRunning) refreshVisibleStats();\n      if (!$('#phv27AutoPipeline')) renderPipelineUI();\n    }, 2500);",
        "    const fetchWatch = setInterval(() => { if (document.visibilityState === 'visible' || state()?.fetchRunning === true) watchFetchState(); }, 650);\n    const statsWatch = setInterval(() => {\n      if (!pipelineRunning && document.visibilityState === 'visible') refreshVisibleStats();\n      if (!$('#phv27AutoPipeline')) renderPipelineUI();\n    }, 6000);\n    window.addEventListener('pagehide', () => { clearInterval(fetchWatch); clearInterval(statsWatch); }, { once: true });",
        "v27 slow pollers",
    )
    write(path, s)


def patch_v34() -> None:
    path = "patches/compact-interaction-v34.js"
    s = read(path)
    if "PH_V34_RUNTIME_STABILITY" in s:
        return
    s = replace_one(s, "  let currentRun = 'idle';", "  let currentRun = 'idle';\n  const PH_V34_RUNTIME_STABILITY = '39.0.0';", "v34 marker")
    s = replace_one(
        s,
        "    setInterval(() => {\n      ensureSessionNotice();\n      compactRealTestControls();\n      normalizeIdleUI();\n      syncFetchingState();\n      guardUnexpectedTesting();\n    }, 350);",
        "    const periodic = setInterval(() => {\n      if (document.visibilityState !== 'visible' && window.PH_STATE?.fetchRunning !== true) return;\n      ensureSessionNotice();\n      compactRealTestControls();\n      normalizeIdleUI();\n      syncFetchingState();\n      guardUnexpectedTesting();\n    }, 1200);\n    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });",
        "v34 poller",
    )
    write(path, s)


def patch_v35() -> None:
    path = "patches/configs-density-v35.js"
    s = read(path)
    if "PH_V35_RUNTIME_STABILITY" in s:
        return
    s = replace_one(s, "  window.PROXYHARVEST_CONFIGS_DENSITY = BUILD;", "  window.PROXYHARVEST_CONFIGS_DENSITY = BUILD;\n  const PH_V35_RUNTIME_STABILITY = '39.0.0';", "v35 marker")
    s = replace_one(
        s,
        "  function clarifyStatusOverview() {\n    const title = $('#phStatusOverview .ph-status-title span');\n    if (title) title.textContent = 'Verified = real protocol/tunnel evidence · Reachable = endpoint only';\n  }",
        "  function clarifyStatusOverview() {\n    const title = $('#phStatusOverview .ph-status-title span');\n    const next = 'Verified = real protocol/tunnel evidence · Reachable = endpoint only';\n    if (title && title.textContent !== next) title.textContent = next;\n  }",
        "v35 idempotent title",
    )
    s = replace_one(s, "      }, 40);", "      }, 140);", "v35 debounce")
    write(path, s)


def patch_v36() -> None:
    path = "patches/configs-row-v36.js"
    s = read(path)
    if "PH_V36_RUNTIME_STABILITY" in s:
        return
    s = replace_one(s, "  window.PROXYHARVEST_CONFIGS_ROW = BUILD;", "  window.PROXYHARVEST_CONFIGS_ROW = BUILD;\n  const PH_V36_RUNTIME_STABILITY = '39.0.0';", "v36 marker")
    s = replace_one(s, "  function normalizeEvidencePill(el) {\n    if (!el) return;", "  function normalizeEvidencePill(el) {\n    if (!el || el.dataset.phv36Normalized === '1') return;", "v36 self-loop")
    s = replace_one(s, "        timer = setTimeout(normalizeRows, 30);", "        timer = setTimeout(normalizeRows, 140);", "v36 debounce")
    write(path, s)


def patch_guard() -> None:
    path = "patches/status-guard-v32.js"
    s = read(path)
    if "PH_V32_GUARD_STABILITY" in s:
        return
    s = replace_one(s, "  let queued = false;", "  let queued = false;\n  const PH_V32_GUARD_STABILITY = '39.0.0';", "guard marker")
    s = replace_one(
        s,
        "    setInterval(guard, 900);",
        "    const periodic = setInterval(() => { if (document.visibilityState === 'visible') guard(); }, 4000);\n    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });",
        "guard poller",
    )
    write(path, s)


def patch_metadata() -> None:
    path = "scripts/build.mjs"
    s = read(path)
    s = replace_one(s, "smartRuntime: '38.1.0-smart-runtime'", "smartRuntime: '38.2.0-smart-runtime-stability'", "manifest runtime")
    write(path, s)

    path = "package.json"
    pkg = json.loads(read(path))
    pkg["version"] = "38.2.0-github-main-runtime-stability"
    check = str(pkg.get("scripts", {}).get("check", ""))
    if "runtime-stability-check.mjs" not in check:
        pkg["scripts"]["check"] = check + " && node scripts/runtime-stability-check.mjs"
    write(path, json.dumps(pkg, indent=2) + "\n")

    path = ".github/workflows/v38-runtime.yml"
    s = read(path)
    s = s.replace("38.1.0-smart-runtime", "38.2.0-smart-runtime-stability")
    s = s.replace("PASS V38.1-source-defaults-exports", "PASS V38.2-source-defaults-exports-stability")
    s = s.replace("PASS V38.1-build", "PASS V38.2-build-stability")
    s = s.replace("ProxyHarvest V38.1 PASS", "ProxyHarvest V38.2 PASS")
    write(path, s)


def main() -> int:
    patch_v38()
    patch_v32()
    patch_v27()
    patch_v34()
    patch_v35()
    patch_v36()
    patch_guard()
    patch_metadata()
    print("Applied ProxyHarvest runtime stability patch 38.2 / stability gate 39.0.0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
