(() => {
  'use strict';
  const BUILD = '32.0.0-verification-sync';
  window.PROXYHARVEST_STATUS_SYNC = BUILD;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const state = () => window.PH_STATE || null;
  const clamp = (n, a = 0, b = 100) => Math.max(a, Math.min(b, Number(n) || 0));
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const latency = c => {
    const n = Number(c?.probe?.latencyMs ?? c?.latency);
    return Number.isFinite(n) && n >= 0 && n < 9999 ? n : Infinity;
  };
  const score = c => clamp(c?.qualityScore ?? c?.score ?? 0);

  function classify(c) {
    const p = c?.probe || {};
    if (p.tunnelVerified === true || p.protocolVerified === true) return 'verified';
    if (p.bridgeReachable === true || p.workerReachable === true || p.browserReachable === true || c?.reachable === true) return 'reachable';
    const method = String(p.method || c?.testMethod || '').toLowerCase();
    const unavailable = /real-ping-unavailable|bridge-unavailable|verifier-unavailable|not-tested|unverified/.test(method);
    const explicitNegative = p.bridgeReachable === false || p.workerReachable === false || p.browserReachable === false;
    if (!unavailable && c?.tested === true && explicitNegative) return 'failed';
    if (!unavailable && c?.tested === true && c?.live === false && method && method !== 'none') return 'failed';
    return 'untested';
  }

  function counts(list = state()?.configs || []) {
    const out = { total: list.length, verified: 0, reachable: 0, failed: 0, untested: 0, exportableVerified: 0, highScoreVerified: 0 };
    for (const c of list) {
      out[classify(c)]++;
      if (classify(c) === 'verified') {
        if (exportUri(c)) out.exportableVerified++;
        if (score(c) >= 80) out.highScoreVerified++;
      }
    }
    const sum = out.verified + out.reachable + out.failed + out.untested;
    out.consistent = sum === out.total;
    return out;
  }

  function exportUri(c) {
    try {
      if (typeof window.getExportUri === 'function') {
        const value = window.getExportUri(c, { allowSensitive: false });
        if (value && !/REDACTED|\*\*\*/i.test(value)) return String(value).trim();
      }
    } catch {}
    const raw = String(c?.raw || '').trim();
    if (!raw || /REDACTED|\*\*\*/i.test(raw)) return '';
    if (/privatekey\s*=|private_key\s*=/i.test(raw)) return '';
    return raw;
  }

  function bestVerified({ minScore = 70, limit = 100, protocol = '' } = {}) {
    return (state()?.configs || [])
      .filter(c => classify(c) === 'verified')
      .filter(c => score(c) >= minScore)
      .filter(c => !protocol || String(c?.type || '').toLowerCase() === String(protocol).toLowerCase())
      .filter(c => exportUri(c))
      .sort((a, b) => {
        if (score(b) !== score(a)) return score(b) - score(a);
        return latency(a) - latency(b);
      })
      .slice(0, Math.max(1, Math.min(5000, Number(limit) || 100)));
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  }

  function exportBestVerified(opts = {}) {
    const list = bestVerified(opts);
    if (!list.length) {
      window.toast?.('No verified, exportable configs yet. Run strict Real Verify with the Local Bridge.', 'warn');
      return [];
    }
    const text = list.map(exportUri).filter(Boolean).join('\n');
    download(`proxyharvest-best-verified-${list.length}-${new Date().toISOString().slice(0, 10)}.txt`, text);
    window.toast?.(`${list.length} best VERIFIED configs exported.`, 'ok');
    return list;
  }

  const PH_V32_RUNTIME_STABILITY = '39.0.0';
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
  }

  function renderConfigStatus(c) {
    setText('phMetricVerified', c.verified.toLocaleString());
    setText('phMetricReachable', c.reachable.toLocaleString());
    setText('phMetricUntested', c.untested.toLocaleString());
    setText('phMetricFailed', c.failed.toLocaleString());
    setText('stat-alive', c.verified.toLocaleString());
    setText('csr-live', c.verified.toLocaleString());
    setText('csr-dead', c.failed.toLocaleString());
    setText('csr-total', c.total.toLocaleString());
    setText('s-total', c.total.toLocaleString());
    setText('nb-total', c.total.toLocaleString());
    setText('nb-configs', c.total.toLocaleString());

    const statusCards = $('#phStatusCards');
    if (statusCards) {
      statusCards.innerHTML = [
        ['Verified', c.verified, 'Protocol/tunnel evidence', 'live'],
        ['Reachable', c.reachable, 'Endpoint only — not verified', 'bridge'],
        ['Untested', c.untested, 'No conclusive verification evidence', 'unknown'],
        ['Failed', c.failed, 'Explicit latest test failure', 'dead']
      ].map(([label, value, sub, key]) => `<div class="ph-status-card ph-card-${key}"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span><small>${sub}</small></div>`).join('');
    }

    const v26 = $('#phv26VerifyMetrics');
    if (v26) {
      v26.innerHTML = `<div class="good"><span>Verified</span><b>${c.verified.toLocaleString()}</b><small>Protocol/tunnel evidence</small></div><div class="info"><span>Reachable</span><b>${c.reachable.toLocaleString()}</b><small>Endpoint only</small></div><div><span>Untested</span><b>${c.untested.toLocaleString()}</b><small>No conclusive evidence</small></div><div class="bad"><span>Failed</span><b>${c.failed.toLocaleString()}</b><small>Explicit test failure</small></div>`;
    }

    const realLive = $('#realTestLive');
    if (realLive && !window.RealTestEngine?.isRunning) realLive.textContent = `${c.verified} verified`;

    const verifiedCard = $('#phMetricVerified')?.closest('.ph-metric');
    if (verifiedCard) {
      verifiedCard.dataset.count = String(c.verified);
      verifiedCard.dataset.exportable = String(c.exportableVerified);
      verifiedCard.classList.toggle('ph-v32-has-live', c.verified > 0);
      verifiedCard.classList.toggle('ph-v32-no-live', c.verified === 0);
      verifiedCard.title = c.verified
        ? `${c.verified} verified; ${c.exportableVerified} safely exportable. Click to open Best Export.`
        : 'No protocol/tunnel verified configs yet. Configure Local Bridge and run Real Verify.';
    }

    const audit = { ...c, at: Date.now() };
    window.PROXYHARVEST_VERIFICATION_AUDIT = audit;
    const auditFingerprint = `${c.total}:${c.verified}:${c.reachable}:${c.failed}:${c.untested}:${c.exportableVerified}`;
    if (window.__PH_V32_LAST_AUDIT_FP !== auditFingerprint) {
      window.__PH_V32_LAST_AUDIT_FP = auditFingerprint;
      window.dispatchEvent(new CustomEvent('ph:v32-verification-sync', { detail: audit }));
    }
    if (!c.consistent) console.error('[ProxyHarvest V32] verification count invariant failed', audit);
    return c;
  }

  let lastExportRefreshFingerprint = '';
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

  function openBestExport() {
    if (typeof window.showTab === 'function') window.showTab('configs');
    else document.querySelector('.nav-item[data-tab="configs"], .ph-nav-item[data-tab="configs"]')?.click();
    setTimeout(() => {
      const button = document.querySelector('[data-phv26-config="export"]');
      button?.click();
      const bucket = $('#phv26ExportBucket'); if (bucket) bucket.value = 'verified';
      const min = $('#phv26ExportScore'); if (min) min.value = '70';
      const limit = $('#phv26ExportLimit'); if (limit) limit.value = '100';
      $('#phv26RefreshExport')?.click();
    }, 80);
  }

  function ensureBestExportAction() {
    const metric = $('#phMetricVerified')?.closest('.ph-metric');
    if (!metric || $('#phv32BestExport', metric)) return;
    metric.classList.add('ph-v32-clickable');
    metric.tabIndex = 0;
    metric.setAttribute('role', 'button');
    const action = document.createElement('button');
    action.id = 'phv32BestExport';
    action.type = 'button';
    action.className = 'ph-v32-best-export';
    action.innerHTML = '<span>BEST VERIFIED</span><b id="phv32BestCount">0</b>';
    action.addEventListener('click', e => { e.stopPropagation(); exportBestVerified({ minScore: 70, limit: 100 }); });
    metric.addEventListener('click', e => { if (!e.target.closest('button')) openBestExport(); });
    metric.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBestExport(); } });
    metric.appendChild(action);
  }

  function updateBestExportAction(c = counts()) {
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

  const dashboardProgress = {
    pct: 0,
    mode: 'idle',
    set(pct, label, detail, mode = 'running') {
      this.pct = clamp(pct);
      this.mode = mode;
      const process = $('#phProcessPanel');
      if (process) {
        process.dataset.v32State = mode;
        process.classList.toggle('is-running', mode === 'running');
      }
      setText('phProcessLabel', label || 'Ready for commands');
      setText('phProcessLive', detail || 'Press Fetch All to start the harvest pipeline.');
      const bars = [$('#phHarvestBar'), $('#progFill')].filter(Boolean);
      for (const bar of bars) bar.style.width = `${this.pct}%`;
      setText('phHarvestPct', `${Math.round(this.pct)}%`);
      const topStatus = $('#progStatus');
      if (topStatus && label) topStatus.textContent = label;
      syncQuickSteps(this.pct, mode);
    }
  };

  function syncQuickSteps(pct, mode) {
    const steps = $$('#tab-dashboard .ph-steps > button');
    if (!steps.length) return;
    const active = pct < 46 ? 0 : pct < 58 ? 1 : pct < 94 ? 2 : 3;
    steps.forEach((step, i) => {
      step.classList.toggle('ph-v32-step-active', mode === 'running' && i === active);
      step.classList.toggle('ph-v32-step-done', i < active || (pct >= 100 && mode === 'done'));
    });
  }

  function syncProcessPhases(fetchPct) {
    const phases = $$('#phProcessPanel [data-process-phase]');
    if (!phases.length) return;
    const idx = Math.min(phases.length - 1, Math.floor(clamp(fetchPct, 0, 99.99) / (100 / phases.length)));
    phases.forEach((el, i) => {
      el.classList.toggle('is-active', i === idx && fetchPct < 100);
      el.classList.toggle('is-done', i < idx || fetchPct >= 100);
    });
  }

  function pulseMetric(id) {
    const card = document.getElementById(id)?.closest('.ph-metric');
    if (!card || !card.animate) return;
    card.animate([
      { transform: 'translateY(0) scale(1)', boxShadow: '0 10px 28px rgba(31,48,88,.08)' },
      { transform: 'translateY(-2px) scale(1.012)', boxShadow: '0 16px 38px rgba(38,121,255,.16)' },
      { transform: 'translateY(0) scale(1)', boxShadow: '0 10px 28px rgba(31,48,88,.08)' }
    ], { duration: 440, easing: 'ease-out' });
  }

  let previousCounts = null;
  function animateCountChanges(c) {
    if (!previousCounts) { previousCounts = c; return; }
    if (c.verified !== previousCounts.verified) pulseMetric('phMetricVerified');
    if (c.reachable !== previousCounts.reachable) pulseMetric('phMetricReachable');
    if (c.failed !== previousCounts.failed) pulseMetric('phMetricFailed');
    if (c.untested !== previousCounts.untested) pulseMetric('phMetricUntested');
    previousCounts = c;
  }

  function patchRealTestEngine() {
    const engine = window.RealTestEngine;
    if (!engine || engine.runBatch?.__phv32) return;
    const original = engine.runBatch.bind(engine);
    const wrapped = async (configs, opts = {}) => {
      const prior = opts.onProgress;
      const strict = (() => { try { return localStorage.getItem('ph_strict_real_ping') !== 'false'; } catch { return true; } })();
      dashboardProgress.set(58, strict ? 'Strict verification running' : 'Reachability screening running', `${configs.length} configs queued`, 'running');
      document.querySelector('.ph-route-card[data-route="bridge"]')?.classList.add('ph-v32-verify-active');
      const merged = {
        ...opts,
        onProgress(prog, cfg) {
          try { prior?.(prog, cfg); } catch (e) { console.warn(e); }
          const ratio = prog.total ? prog.done / prog.total : 0;
          const pct = 58 + ratio * 34;
          const live = Number(prog.live || 0);
          dashboardProgress.set(pct, strict ? 'Strict verification running' : 'Reachability screening running', `${prog.done}/${prog.total} tested · ${live} verified`, 'running');
          const c = syncAll();
          animateCountChanges(c);
          window.dispatchEvent(new CustomEvent('ph:v32-verify-progress', { detail: { ...prog, strict, classified: c } }));
        }
      };
      try {
        const result = await original(configs, merged);
        const c = syncAll();
        dashboardProgress.set(92, strict ? 'Verification complete' : 'Reachability screening complete', `${c.verified} verified · ${c.reachable} reachable`, 'running');
        return result;
      } finally {
        document.querySelector('.ph-route-card[data-route="bridge"]')?.classList.remove('ph-v32-verify-active');
      }
    };
    wrapped.__phv32 = true;
    engine.runBatch = wrapped;
  }

  function patchStrictOption() {
    if (typeof window.startRealTest !== 'function' || window.startRealTest.__phv32) return;
    const original = window.startRealTest.bind(window);
    const wrapped = async (opts = {}) => {
      const has = Object.prototype.hasOwnProperty.call(opts || {}, 'strictRealPing');
      let prior = null;
      if (has) {
        try {
          prior = localStorage.getItem('ph_strict_real_ping');
          localStorage.setItem('ph_strict_real_ping', opts.strictRealPing ? 'true' : 'false');
        } catch {}
      }
      try { return await original(opts); }
      finally {
        if (has) {
          try {
            if (prior == null) localStorage.removeItem('ph_strict_real_ping');
            else localStorage.setItem('ph_strict_real_ping', prior);
          } catch {}
        }
      }
    };
    wrapped.__phv32 = true;
    window.startRealTest = wrapped;
  }

  function installEvents() {
    window.addEventListener('ph:progress', e => {
      const d = e.detail || {};
      const raw = clamp(d.pct);
      syncProcessPhases(raw);
      const pct = raw * 0.52;
      dashboardProgress.set(pct, 'Harvesting sources', d.total ? `${d.done || 0}/${d.total} ${d.unit || 'items'}` : 'Fetching source subscriptions…', 'running');
      const card = document.querySelector('.ph-route-card[data-route="cache"]');
      card?.classList.toggle('ph-v32-fetch-active', raw < 100);
    });

    window.addEventListener('ph:route', e => {
      const d = e.detail || {};
      const card = document.querySelector(`.ph-route-card[data-route="${String(d.stage || '').toLowerCase()}"]`);
      if (card && /active|probing/.test(String(d.status || ''))) card.classList.add('ph-v32-route-active');
      if (card && /success|error|idle/.test(String(d.status || ''))) card.classList.remove('ph-v32-route-active');
    });

    window.addEventListener('ph:v27-pipeline-complete', e => {
      const c = syncAll();
      animateCountChanges(c);
      dashboardProgress.set(100, 'Pipeline complete', `${c.verified} verified · ${c.reachable} reachable · ${c.failed} failed · ${bestVerified({ minScore: 70, limit: 100 }).length} best exportable`, 'done');
      $$('.ph-route-card').forEach(card => card.classList.remove('ph-v32-fetch-active', 'ph-v32-route-active', 'ph-v32-verify-active'));
      setTimeout(() => dashboardProgress.set(100, 'Ready — ranked results available', `${c.verified} verified · ${c.exportableVerified} exportable verified configs`, 'done'), 600);
    });

    window.addEventListener('ph:v27-stats', () => {
      const c = syncAll();
      animateCountChanges(c);
    });
  }

  let runtimeSyncTimer = null;
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

  function boot() {
    patchStrictOption();
    patchRealTestEngine();
    installEvents();
    observeRuntime();
    ensureBestExportAction();
    const c = syncAll();
    animateCountChanges(c);
    dashboardProgress.set(0, 'Ready for commands', 'Fetch All will continue automatically through test, score, rank and export preparation.', 'idle');
    window.PROXYHARVEST_V32 = Object.freeze({ BUILD, classify, counts, bestVerified, exportBestVerified, syncAll });
    const periodic = setInterval(() => {
      patchStrictOption();
      patchRealTestEngine();
      if (document.visibilityState !== 'visible') return;
      const next = syncAll();
      animateCountChanges(next);
    }, 5000);
    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
