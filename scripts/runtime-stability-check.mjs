import { readFile } from 'node:fs/promises';

const read = p => readFile(p, 'utf8');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const [v38,v32,v27,v34,v35,v36,guard,build,pkgRaw] = await Promise.all([
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

assert(build.includes("smartRuntime: '38.2.0-smart-runtime-stability'"), 'build.json manifest version not upgraded');
const pkg = JSON.parse(pkgRaw);
assert(pkg.version === '38.2.0-github-main-runtime-stability', 'package version not upgraded');
assert(String(pkg.scripts?.check || '').includes('runtime-stability-check.mjs'), 'stability check is not part of npm run check');

console.log('PASS runtime-stability-static: mutation feedback loops removed and background polling throttled');
