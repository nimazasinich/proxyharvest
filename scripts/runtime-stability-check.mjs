import { readFile } from 'node:fs/promises';

const read = p => readFile(p, 'utf8');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const [v42,v38,v32,v27,v34,v35,v36,guard,build,pkgRaw] = await Promise.all([
  read('patches/control-center-v42.js'),
  read('patches/runtime-smart-v38.js'),
  read('patches/status-sync-v32.js'),
  read('patches/auto-pipeline-v27.js'),
  read('patches/compact-interaction-v34.js'),
  read('patches/configs-density-v35.js'),
  read('patches/configs-row-v36.js'),
  read('patches/status-guard-v32.js'),
  read('scripts/build.mjs'),
  read('package.json'),
]);

assert(v38.includes("38.2.0-smart-runtime-stability"), 'V38.2 stability build marker missing');
assert(v38.includes("if(el.textContent===next)return false"), 'V38 counters are not idempotent');
assert(v38.includes("if(current===next)return false"), 'V38 form setters still dispatch unchanged values');
assert(!v38.includes("mo.observe(document.documentElement,{subtree:true,childList:true})"), 'V38 broad self-triggering documentElement observer still present');
assert(v38.includes("setTimeout(()=>{repairTimer=null;repairUi()},180)"), 'V38 DOM repair is not debounced');
assert(v38.includes("document.visibilityState==='visible'"), 'V38 periodic work is not visibility-aware');

assert(v42.includes("42.0.1-auto-control-center"), 'V42 control center marker missing');
assert(v42.includes("if(el.textContent===n)return false"), 'V42 text writes are not idempotent');
assert(v42.includes("if(el.getAttribute(k)===n)return false"), 'V42 attribute writes are not idempotent');
assert(!v42.includes('new MutationObserver'), 'V42 must not add mutation observers');
assert(v42.includes('AUTO_INTERVAL=15*60*1000'), 'V42 auto-harvest cadence missing');
assert(v42.includes("document.visibilityState==='visible'"), 'V42 periodic work is not visibility-aware');
assert(v42.includes('ph-v42-source-migration-1'), 'V42 source migration marker missing');
assert(v42.includes('PROXYHARVEST_V32?.counts'), 'V42 verification counters are not using the canonical V32 source');
assert(v42.includes('Only the Local Real Test Bridge may set protocol/tunnel/WireGuard verification evidence'), 'V42 truthful verification boundary missing');

assert(v36.includes("el.dataset.phv36Normalized === '1'"), 'V36 evidence pill observer can still rewrite normalized text forever');
assert(v35.includes("title && title.textContent !== next"), 'V35 status title can still self-trigger its observer');
assert(v32.includes("PH_V32_RUNTIME_STABILITY"), 'V32 stability patch missing');
assert(v32.includes('lastExportRefreshFingerprint'), 'V32 export refresh is not throttled');
assert(v32.includes('runtimeSyncTimer'), 'V32 runtime observers are not debounced');
assert(v27.includes('lastStatsFingerprint'), 'V27 expensive table/filter refresh is not deduplicated');
assert(v27.includes('6000'), 'V27 background stats polling was not relaxed');
assert(v34.includes('1200'), 'V34 high-frequency poller was not relaxed');
assert(guard.includes('4000'), 'V32 guard poller was not relaxed');

const knownHotIntervals = [
  ['auto-pipeline-v27', v27, /setInterval\(watchFetchState,\s*250\)/],
  ['compact-interaction-v34', v34, /},\s*350\);/],
  ['status-sync-v32', v32, /},\s*1400\);/],
  ['status-guard-v32', guard, /setInterval\(guard,\s*900\)/],
];
for (const [name, text, rx] of knownHotIntervals) assert(!rx.test(text), `${name}: legacy hot polling remains`);

assert(build.includes("smartRuntime: '38.2.0-smart-runtime-stability'"), 'V38 build manifest marker missing');
assert(build.includes("controlCenter: '42.0.1-auto-control-center'"), 'V42 build manifest marker missing');
assert(build.includes("cloudEdgeRelay: '42.0.0-streaming-cors-relay'"), 'V42 Cloud Edge Relay manifest marker missing');
const pkg = JSON.parse(pkgRaw);
assert(pkg.version === '42.0.1-github-main-auto-control-center', 'package version is not V42');
assert(String(pkg.scripts?.check || '').includes('runtime-stability-check.mjs'), 'stability check is not part of npm run check');
assert(String(pkg.scripts?.check || '').includes('control-center-v42.js'), 'V42 syntax check is not part of npm run check');

console.log('PASS runtime-stability-static: V38 mutation hardening preserved; V42 automation is idempotent, visibility-aware, and verifier-safe');

assert(!v42.includes("runtime.sourceHealthy=good;runtime.sourceChecked=checked;runtime.sourceTotal=sources.length;render();"), 'V42 source sweep renders inside every batch');
assert(!v42.includes("async function workerAudit(){\n    runtime.worker='checking';runtime.edge='checking';render();"), 'V42 worker audit performs redundant intermediate render');
assert(!v42.includes("async function bridgeAudit(){\n    runtime.bridge='checking';render();"), 'V42 bridge audit performs redundant intermediate render');
assert(!v42.includes("async function aiAudit(){\n    runtime.ai='checking';render();"), 'V42 AI audit performs redundant intermediate render');
