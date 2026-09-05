import { readFile, writeFile } from 'node:fs/promises';

const files = {
  v38: 'patches/runtime-smart-v38.js',
  v32: 'patches/status-sync-v32.js',
  v27: 'patches/auto-pipeline-v27.js',
  v34: 'patches/compact-interaction-v34.js',
  v35: 'patches/configs-density-v35.js',
  v36: 'patches/configs-row-v36.js',
  guard: 'patches/status-guard-v32.js',
  build: 'scripts/build.mjs',
  pkg: 'package.json',
  v38wf: '.github/workflows/v38-runtime.yml',
};

function replaceOne(text, from, to, label) {
  if (text.includes(to)) return text;
  const first = text.indexOf(from);
  const second = first < 0 ? -1 : text.indexOf(from, first + from.length);
  if (first < 0 || second >= 0) throw new Error(`${label}: expected exactly one anchor`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

function replaceRegex(text, rx, to, label) {
  if (typeof to === 'string' && text.includes(to)) return text;
  const matches = [...text.matchAll(new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, got ${matches.length}`);
  return text.replace(rx, to);
}

async function patchV38() {
  let s = await readFile(files.v38, 'utf8');
  if (s.includes("const BUILD = '38.2.0-smart-runtime-stability'")) return;
  s = replaceOne(s, "const BUILD = '38.1.0-smart-runtime';", "const BUILD = '38.2.0-smart-runtime-stability';", 'v38 build');
  s = replaceOne(
    s,
    "  function setValue(id,value){ const el=document.getElementById(id); if(!el)return; if(el.type==='checkbox')el.checked=!!value; else el.value=value??''; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }",
    "  function setValue(id,value){ const el=document.getElementById(id); if(!el)return false; const next=el.type==='checkbox'?!!value:String(value??''); const current=el.type==='checkbox'?!!el.checked:String(el.value??''); if(current===next)return false; if(el.type==='checkbox')el.checked=next; else el.value=next; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }\n  function setText(id,value){const el=document.getElementById(id);if(!el)return false;const next=String(value);if(el.textContent===next)return false;el.textContent=next;return true}",
    'v38 idempotent setters',
  );
  s = replaceRegex(
    s,
    /  function syncCounts\(\)\{[^\n]*\}/,
    "  function syncCounts(){const arr=window.S?.configs||[],c={v:0,r:0,u:0,f:0};for(const x of arr){if(verified(x))c.v++;else if(reachable(x))c.r++;else if(failed(x))c.f++;else c.u++}setText('phMetricVerified',c.v);setText('phMetricReachable',c.r);setText('phMetricUntested',c.u);setText('phMetricFailed',c.f);return c}",
    'v38 syncCounts',
  );
  s = replaceRegex(
    s,
    /  function boot\(\)\{migrateAppSettings\(\);[\s\S]*?window\.PROXYHARVEST_V38=Object\.freeze\(\{BUILD,runtimeAudit,detectBridgeSmart,bestVerified,bestReachable,bestSplitVerified,applySmartInfrastructureDefaults\}\)\}/,
    `  function boot(){
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
  }`,
    'v38 stable boot',
  );
  await writeFile(files.v38, s);
}

async function patchV32() {
  let s = await readFile(files.v32, 'utf8');
  if (!s.includes('PH_V32_RUNTIME_STABILITY')) {
    s = replaceRegex(
      s,
      /  function setText\(id, value\) \{[\s\S]*?\n  \}/,
      `  const PH_V32_RUNTIME_STABILITY = '39.0.0';
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
  }`,
      'v32 idempotent setText',
    );
    s = replaceOne(
      s,
      "    const audit = { ...c, at: Date.now() };\n    window.PROXYHARVEST_VERIFICATION_AUDIT = audit;\n    window.dispatchEvent(new CustomEvent('ph:v32-verification-sync', { detail: audit }));",
      "    const audit = { ...c, at: Date.now() };\n    window.PROXYHARVEST_VERIFICATION_AUDIT = audit;\n    const auditFingerprint = `${c.total}:${c.verified}:${c.reachable}:${c.failed}:${c.untested}:${c.exportableVerified}`;\n    if (window.__PH_V32_LAST_AUDIT_FP !== auditFingerprint) {\n      window.__PH_V32_LAST_AUDIT_FP = auditFingerprint;\n      window.dispatchEvent(new CustomEvent('ph:v32-verification-sync', { detail: audit }));\n    }",
      'v32 event dedupe',
    );
    s = replaceRegex(
      s,
      /  function syncAll\(\) \{[\s\S]*?\n  \}\n\n  function openBestExport/,
      `  let lastExportRefreshFingerprint = '';
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

  function openBestExport`,
      'v32 throttled syncAll',
    );
    s = replaceRegex(
      s,
      /  function updateBestExportAction\(c = counts\(\)\) \{[\s\S]*?\n  \}\n\n  const dashboardProgress/,
      `  function updateBestExportAction(c = counts()) {
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

  const dashboardProgress`,
      'v32 lightweight best action',
    );
    s = replaceRegex(
      s,
      /  function observeRuntime\(\) \{[\s\S]*?\n  \}\n\n  function boot/,
      `  let runtimeSyncTimer = null;
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

  function boot`,
      'v32 debounced observers',
    );
    s = replaceOne(
      s,
      "    setInterval(() => {\n      patchStrictOption();\n      patchRealTestEngine();\n      const next = syncAll();\n      animateCountChanges(next);\n    }, 1400);",
      "    const periodic = setInterval(() => {\n      patchStrictOption();\n      patchRealTestEngine();\n      if (document.visibilityState !== 'visible') return;\n      const next = syncAll();\n      animateCountChanges(next);\n    }, 5000);\n    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });",
      'v32 slower periodic sync',
    );
  }
  await writeFile(files.v32, s);
}

async function patchV27() {
  let s = await readFile(files.v27, 'utf8');
  if (!s.includes('PH_V27_RUNTIME_STABILITY')) {
    s = replaceRegex(
      s,
      /  function setText\(id, value\) \{[\s\S]*?\n  \}/,
      `  const PH_V27_RUNTIME_STABILITY = '39.0.0';
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
  }`,
      'v27 idempotent setText',
    );
    s = replaceRegex(
      s,
      /  function refreshVisibleStats\(\) \{[\s\S]*?\n  \}\n\n  function setStage/,
      `  let lastStatsFingerprint = '';
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

  function setStage`,
      'v27 stats dedupe',
    );
    s = replaceOne(s, "      const c = refreshVisibleStats();", "      const c = refreshVisibleStats({ force: true });", 'v27 force final stats');
    s = replaceOne(s, "    refreshVisibleStats();\n  }\n\n  function boot()", "    refreshVisibleStats({ force: true });\n  }\n\n  function boot()", 'v27 force initial stats');
    s = replaceOne(
      s,
      "    setInterval(watchFetchState, 250);\n    setInterval(() => {\n      if (!pipelineRunning) refreshVisibleStats();\n      if (!$('#phv27AutoPipeline')) renderPipelineUI();\n    }, 2500);",
      "    const fetchWatch = setInterval(() => { if (document.visibilityState === 'visible' || state()?.fetchRunning === true) watchFetchState(); }, 650);\n    const statsWatch = setInterval(() => {\n      if (!pipelineRunning && document.visibilityState === 'visible') refreshVisibleStats();\n      if (!$('#phv27AutoPipeline')) renderPipelineUI();\n    }, 6000);\n    window.addEventListener('pagehide', () => { clearInterval(fetchWatch); clearInterval(statsWatch); }, { once: true });",
      'v27 slower pollers',
    );
  }
  await writeFile(files.v27, s);
}

async function patchV34() {
  let s = await readFile(files.v34, 'utf8');
  if (!s.includes('PH_V34_RUNTIME_STABILITY')) {
    s = replaceOne(s, "  let currentRun = 'idle';", "  let currentRun = 'idle';\n  const PH_V34_RUNTIME_STABILITY = '39.0.0';", 'v34 stability marker');
    s = replaceOne(
      s,
      "    setInterval(() => {\n      ensureSessionNotice();\n      compactRealTestControls();\n      normalizeIdleUI();\n      syncFetchingState();\n      guardUnexpectedTesting();\n    }, 350);",
      "    const periodic = setInterval(() => {\n      if (document.visibilityState !== 'visible' && window.PH_STATE?.fetchRunning !== true) return;\n      ensureSessionNotice();\n      compactRealTestControls();\n      normalizeIdleUI();\n      syncFetchingState();\n      guardUnexpectedTesting();\n    }, 1200);\n    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });",
      'v34 slower poller',
    );
  }
  await writeFile(files.v34, s);
}

async function patchV35() {
  let s = await readFile(files.v35, 'utf8');
  if (!s.includes('PH_V35_RUNTIME_STABILITY')) {
    s = replaceOne(s, "  window.PROXYHARVEST_CONFIGS_DENSITY = BUILD;", "  window.PROXYHARVEST_CONFIGS_DENSITY = BUILD;\n  const PH_V35_RUNTIME_STABILITY = '39.0.0';", 'v35 marker');
    s = replaceOne(
      s,
      "  function clarifyStatusOverview() {\n    const title = $('#phStatusOverview .ph-status-title span');\n    if (title) title.textContent = 'Verified = real protocol/tunnel evidence · Reachable = endpoint only';\n  }",
      "  function clarifyStatusOverview() {\n    const title = $('#phStatusOverview .ph-status-title span');\n    const next = 'Verified = real protocol/tunnel evidence · Reachable = endpoint only';\n    if (title && title.textContent !== next) title.textContent = next;\n  }",
      'v35 idempotent overview',
    );
    s = replaceOne(s, "      }, 40);", "      }, 140);", 'v35 debounce');
  }
  await writeFile(files.v35, s);
}

async function patchV36() {
  let s = await readFile(files.v36, 'utf8');
  if (!s.includes('PH_V36_RUNTIME_STABILITY')) {
    s = replaceOne(s, "  window.PROXYHARVEST_CONFIGS_ROW = BUILD;", "  window.PROXYHARVEST_CONFIGS_ROW = BUILD;\n  const PH_V36_RUNTIME_STABILITY = '39.0.0';", 'v36 marker');
    s = replaceOne(
      s,
      "  function normalizeEvidencePill(el) {\n    if (!el) return;",
      "  function normalizeEvidencePill(el) {\n    if (!el || el.dataset.phv36Normalized === '1') return;",
      'v36 stop self-trigger',
    );
    s = replaceOne(s, "        timer = setTimeout(normalizeRows, 30);", "        timer = setTimeout(normalizeRows, 140);", 'v36 debounce');
  }
  await writeFile(files.v36, s);
}

async function patchGuard() {
  let s = await readFile(files.guard, 'utf8');
  if (!s.includes('PH_V32_GUARD_STABILITY')) {
    s = replaceOne(s, "  let queued = false;", "  let queued = false;\n  const PH_V32_GUARD_STABILITY = '39.0.0';", 'guard marker');
    s = replaceOne(s, "    setInterval(guard, 900);", "    const periodic = setInterval(() => { if (document.visibilityState === 'visible') guard(); }, 4000);\n    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });", 'guard poller');
  }
  await writeFile(files.guard, s);
}

async function patchMetadata() {
  let build = await readFile(files.build, 'utf8');
  build = replaceOne(build, "smartRuntime: '38.1.0-smart-runtime'", "smartRuntime: '38.2.0-smart-runtime-stability'", 'build manifest runtime');
  await writeFile(files.build, build);

  const pkg = JSON.parse(await readFile(files.pkg, 'utf8'));
  pkg.version = '38.2.0-github-main-runtime-stability';
  pkg.scripts.check = pkg.scripts.check.includes('runtime-stability-check.mjs') ? pkg.scripts.check : `${pkg.scripts.check} && node scripts/runtime-stability-check.mjs`;
  await writeFile(files.pkg, JSON.stringify(pkg, null, 2) + '\n');

  let wf = await readFile(files.v38wf, 'utf8');
  wf = wf.replaceAll('38.1.0-smart-runtime', '38.2.0-smart-runtime-stability');
  wf = wf.replaceAll('PASS V38.1-source-defaults-exports', 'PASS V38.2-source-defaults-exports-stability');
  wf = wf.replaceAll('PASS V38.1-build', 'PASS V38.2-build-stability');
  wf = wf.replaceAll('ProxyHarvest V38.1 PASS', 'ProxyHarvest V38.2 PASS');
  await writeFile(files.v38wf, wf);
}

await patchV38();
await patchV32();
await patchV27();
await patchV34();
await patchV35();
await patchV36();
await patchGuard();
await patchMetadata();
console.log('Applied ProxyHarvest runtime stability patch 38.2 / stability gate 39.0.0');
