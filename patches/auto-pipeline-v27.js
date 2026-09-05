(() => {
  'use strict';

  const BUILD = '27.0.0-auto-pipeline';
  const STORAGE_KEY = 'ph_auto_pipeline_enabled';
  const PH_V27_MUTATION_STABILITY = '40.0.0';
  const state = () => window.PH_STATE || null;
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const enabled = () => {
    try { return localStorage.getItem(STORAGE_KEY) !== '0'; } catch { return true; }
  };
  const setEnabled = value => {
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch {}
    const btn = $('#phv27Toggle');
    if (btn) {
      const on = value ? '1' : '0';
      const text = value ? 'AUTO PIPELINE ON' : 'AUTO PIPELINE OFF';
      if (btn.dataset.on !== on) btn.dataset.on = on;
      if (btn.textContent !== text) btn.textContent = text;
    }
  };
  const toast = (message, type = 'info') => {
    if (typeof window.toast === 'function') return window.toast(message, type);
    console[type === 'err' ? 'error' : 'log'](`[ProxyHarvest] ${message}`);
  };

  const verified = cfg => {
    const p = cfg?.probe || {};
    return p.tunnelVerified === true || p.protocolVerified === true ||
      (typeof window.verificationPass === 'function' && window.verificationPass(cfg) === true);
  };
  const reachable = cfg => {
    const p = cfg?.probe || {};
    return p.browserReachable === true || p.workerReachable === true || p.bridgeReachable === true || cfg?.reachable === true;
  };
  const failed = cfg => cfg?.tested === true && !verified(cfg) && !reachable(cfg) &&
    (cfg?.live === false || cfg?.probe?.browserReachable === false || cfg?.probe?.workerReachable === false || cfg?.probe?.bridgeReachable === false);
  const latency = cfg => {
    const n = Number(cfg?.probe?.latencyMs ?? cfg?.latency);
    return Number.isFinite(n) && n >= 0 && n < 9999 ? n : Infinity;
  };

  function qualityScore(cfg) {
    let score = 0;
    const breakdown = [];
    const add = (name, points) => { score += points; breakdown.push({ factor: name, points }); };
    const type = String(cfg?.type || '').toLowerCase();
    const sec = String(cfg?.security || '').toLowerCase();
    const net = String(cfg?.net || cfg?.network || '').toLowerCase();
    const proto = { hy2: 12, tuic: 12, wireguard: 11, vless: 10, trojan: 10, vmess: 8, ss: 6, ssr: 3 }[type] || 5;
    add('protocol', proto);
    if (cfg?.host) add('host', 4);
    if (Number(cfg?.port) > 0 && Number(cfg?.port) <= 65535) add('port', 3);
    if (['reality', 'xtls'].includes(sec)) add('security', 9);
    else if (sec === 'tls') add('security', 7);
    else if (sec && sec !== 'none') add('security', 3);
    if (net === 'grpc') add('transport', 5);
    else if (net === 'ws') add('transport', 4);
    else if (net === 'h2' || net === 'quic') add('transport', 3);
    if (cfg?.doh === true) add('dns', 5);
    else if (cfg?.doh === false) add('dns', -6);

    if (verified(cfg)) add('verified', 45);
    else if (reachable(cfg)) add('reachable-only', 12);
    else if (failed(cfg)) add('failed', -22);

    const ms = latency(cfg);
    if (ms !== Infinity) {
      if (ms <= 80) add('latency', 18);
      else if (ms <= 150) add('latency', 15);
      else if (ms <= 300) add('latency', 11);
      else if (ms <= 600) add('latency', 7);
      else if (ms <= 1200) add('latency', 3);
      else add('latency', -5);
    }
    score = clamp(Math.round(score), 0, 100);
    cfg.score = score;
    cfg.qualityScore = score;
    cfg.qualityGrade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    cfg.scoreBreakdownV27 = breakdown;
    return score;
  }

  function rescoreAndRank() {
    const s = state();
    if (!s?.configs?.length) return [];
    for (const cfg of s.configs) qualityScore(cfg);
    s.configs.sort((a, b) => {
      const av = verified(a) ? 2 : reachable(a) ? 1 : 0;
      const bv = verified(b) ? 2 : reachable(b) ? 1 : 0;
      if (bv !== av) return bv - av;
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return latency(a) - latency(b);
    });
    s.configs.forEach((cfg, index) => { cfg.qualityRank = index + 1; });
    return s.configs;
  }

  function counts() {
    const configs = state()?.configs || [];
    const out = { total: configs.length, verified: 0, reachable: 0, failed: 0, untested: 0, tested: 0, highScore: 0 };
    for (const cfg of configs) {
      if (cfg?.tested === true) out.tested++;
      if (verified(cfg)) out.verified++;
      else if (failed(cfg)) out.failed++;
      else if (reachable(cfg)) out.reachable++;
      else out.untested++;
      if ((Number(cfg?.score) || 0) >= 80) out.highScore++;
    }
    return out;
  }

  const PH_V27_RUNTIME_STABILITY = '39.0.0';
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
  }

  let lastStatsFingerprint = '';
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

  function setStage(name, status, detail = '') {
    const step = document.querySelector(`[data-phv27-stage="${name}"]`);
    if (step) {
      if (step.dataset.status !== status) step.dataset.status = status;
      const small = step.querySelector('small');
      if (small && detail && small.textContent !== detail) small.textContent = detail;
    }
    const label = $('#phv27PipelineStatus');
    const next = detail || `${name}: ${status}`;
    if (label && label.textContent !== next) label.textContent = next;
  }

  function resetStages() {
    document.querySelectorAll('[data-phv27-stage]').forEach(el => {
      if (el.dataset.status !== 'queued') el.dataset.status = 'queued';
      const small = el.querySelector('small');
      if (small && small.textContent !== 'Queued') small.textContent = 'Queued';
    });
  }

  async function checkBridgeCandidate(base) {
    if (!base) return null;
    const url = String(base).replace(/\/$/, '');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1800);
    try {
      const response = await fetch(`${url}/health`, { cache: 'no-store', signal: ctrl.signal });
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      return { base: url, data };
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  async function detectRealBridge() {
    const candidates = [];
    const input = $('#localBridgeUrl')?.value?.trim();
    if (input) candidates.push(input);
    try {
      const stored = localStorage.getItem('ph_real_ping_bridge');
      if (stored) candidates.push(stored);
    } catch {}
    candidates.push('http://127.0.0.1:8787', 'http://localhost:8787');
    for (const candidate of [...new Set(candidates)]) {
      const found = await checkBridgeCandidate(candidate);
      if (!found) continue;
      const inputEl = $('#localBridgeUrl');
      if (inputEl) inputEl.value = found.base;
      try { localStorage.setItem('ph_real_ping_bridge', found.base); } catch {}
      return found;
    }
    return null;
  }

  function snapshotFilters() {
    const ids = ['cfgSearch', 'protoFilter', 'dohFilter', 'cfg-scoreThreshold', 'cfg-test-limit'];
    return ids.map(id => {
      const el = document.getElementById(id);
      return { id, value: el?.value ?? null };
    });
  }

  function clearFiltersForFullTest() {
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    set('cfgSearch', '');
    set('protoFilter', '');
    set('dohFilter', '');
    set('cfg-scoreThreshold', '0');
    const total = state()?.configs?.length || 100;
    set('cfg-test-limit', String(Math.max(100, total)));
  }

  function restoreFilters(snapshot) {
    for (const item of snapshot) {
      if (item.value == null) continue;
      const el = document.getElementById(item.id);
      if (el) el.value = item.value;
    }
  }

  async function runVerificationStage() {
    if (typeof window.startRealTest !== 'function') throw new Error('Real Test engine is not loaded');
    const filters = snapshotFilters();
    clearFiltersForFullTest();
    try {
      setStage('bridge', 'active', 'Detecting Real Test Bridge…');
      const bridge = await detectRealBridge();
      if (bridge) {
        setStage('bridge', 'done', `Bridge ready: ${bridge.base}`);
        setStage('verify', 'active', 'Running strict protocol/tunnel verification…');
        const result = await window.startRealTest({ strictRealPing: true });
        setStage('verify', 'done', `${result?.live || 0} verified of ${result?.total || 0}`);
        return { mode: 'strict-real-verify', bridge, result };
      }

      setStage('bridge', 'blocked', 'Real Bridge unavailable');
      setStage('verify', 'blocked', 'Strict verification blocked — running reachability screening only');
      setStage('reach', 'active', 'Worker/browser endpoint screening…');
      const result = await window.startRealTest({ strictRealPing: false });
      setStage('reach', 'done', 'Reachability screening complete; no reachable-only result is counted as LIVE');
      return { mode: 'reachability-only', bridge: null, result };
    } finally {
      restoreFilters(filters);
    }
  }

  let pipelineRunning = false;
  let pendingAfterFetch = false;
  let fetchWasRunning = false;
  let fetchStartedAt = 0;

  async function runAfterFetch(reason = 'fetch-complete') {
    if (!enabled() || pipelineRunning) return;
    const s = state();
    if (!s?.configs?.length) {
      setStage('fetch', 'done', 'Fetch finished with 0 configs');
      refreshVisibleStats();
      return;
    }
    pipelineRunning = true;
    document.body.dataset.phAutoPipeline = 'running';
    try {
      setStage('fetch', 'done', `${s.configs.length.toLocaleString()} configs harvested`);
      setStage('score', 'active', 'Initial normalize + score…');
      rescoreAndRank();
      setStage('score', 'done', 'Initial ranking ready');

      await runVerificationStage();

      setStage('score', 'active', 'Re-scoring with verification + latency evidence…');
      rescoreAndRank();
      setStage('score', 'done', 'Quality scores recalculated');
      setStage('rank', 'active', 'Ranking verified first, then score and latency…');
      rescoreAndRank();
      setStage('rank', 'done', 'Ranking complete');
      setStage('summary', 'active', 'Updating live counts and best export…');
      const c = refreshVisibleStats({ force: true });
      setStage('summary', 'done', `${c.verified} LIVE · ${c.reachable} reachable · ${c.failed} failed · ${c.highScore} score≥80`);

      try {
        localStorage.setItem('ph_v27_last_pipeline', JSON.stringify({
          at: Date.now(), reason, ...c,
          bridge: document.querySelector('[data-phv27-stage="bridge"]')?.dataset.status || 'unknown'
        }));
      } catch {}
      toast(`Auto pipeline complete: ${c.verified} verified LIVE, ${c.reachable} reachable, ${c.highScore} high-score`, c.verified ? 'ok' : 'warn');
      window.dispatchEvent(new CustomEvent('ph:v27-pipeline-complete', { detail: c }));
    } catch (error) {
      console.error('ProxyHarvest auto pipeline failed', error);
      setStage('summary', 'error', `Pipeline error: ${String(error?.message || error).slice(0, 140)}`);
      toast(`Auto pipeline error: ${String(error?.message || error).slice(0, 120)}`, 'err');
    } finally {
      pipelineRunning = false;
      document.body.dataset.phAutoPipeline = 'idle';
    }
  }

  function watchFetchState() {
    const s = state();
    if (!s) return;
    const nowRunning = s.fetchRunning === true;
    if (nowRunning && !fetchWasRunning) {
      fetchWasRunning = true;
      pendingAfterFetch = true;
      fetchStartedAt = Date.now();
      resetStages();
      setStage('fetch', 'active', 'Harvesting sources…');
    }
    if (!nowRunning && fetchWasRunning) {
      fetchWasRunning = false;
      if (pendingAfterFetch) {
        pendingAfterFetch = false;
        if (s.stopReq === true) {
          setStage('fetch', 'blocked', 'Fetch stopped by user');
          return;
        }
        runAfterFetch(`fetch-${Date.now() - fetchStartedAt}ms`);
      }
    }
  }

  function renderPipelineUI() {
    if ($('#phv27AutoPipeline')) return;
    const dashboard = $('#tab-dashboard');
    if (!dashboard) return;
    const host = $('#phProcessPanel', dashboard) || dashboard.firstElementChild;
    const box = document.createElement('section');
    box.id = 'phv27AutoPipeline';
    box.className = 'phv27-auto-pipeline';
    box.innerHTML = `
      <div class="phv27-head">
        <div><span>AUTONOMOUS PIPELINE</span><b>Fetch → Verify → Score → Rank → Live Summary</b><small id="phv27PipelineStatus">Ready. Every Fetch continues automatically.</small></div>
        <button id="phv27Toggle" class="phv27-toggle" data-on="1">AUTO PIPELINE ON</button>
      </div>
      <div class="phv27-steps">
        <div data-phv27-stage="fetch" data-status="queued"><span>01</span><b>Fetch</b><small>Queued</small></div>
        <div data-phv27-stage="bridge" data-status="queued"><span>02</span><b>Bridge</b><small>Queued</small></div>
        <div data-phv27-stage="verify" data-status="queued"><span>03</span><b>Real Verify</b><small>Queued</small></div>
        <div data-phv27-stage="reach" data-status="queued"><span>04</span><b>Reachability</b><small>Fallback only</small></div>
        <div data-phv27-stage="score" data-status="queued"><span>05</span><b>Score</b><small>Queued</small></div>
        <div data-phv27-stage="rank" data-status="queued"><span>06</span><b>Rank</b><small>Queued</small></div>
        <div data-phv27-stage="summary" data-status="queued"><span>07</span><b>Summary</b><small>Queued</small></div>
      </div>
      <div class="phv27-kpis">
        <div><span>Verified LIVE</span><b id="phv27Live">0</b></div>
        <div><span>Reachable only</span><b id="phv27Reachable">0</b></div>
        <div><span>Failed</span><b id="phv27Failed">0</b></div>
        <div><span>Untested</span><b id="phv27Untested">0</b></div>
        <div><span>Score ≥80</span><b id="phv27HighScore">0</b></div>
      </div>`;
    host?.insertAdjacentElement('afterend', box);
    $('#phv27Toggle')?.addEventListener('click', () => setEnabled(!enabled()));
    setEnabled(enabled());
    refreshVisibleStats({ force: true });
  }

  function boot() {
    renderPipelineUI();
    const fetchWatch = setInterval(() => { if (document.visibilityState === 'visible' || state()?.fetchRunning === true) watchFetchState(); }, 650);
    const statsWatch = setInterval(() => {
      if (!pipelineRunning && document.visibilityState === 'visible') refreshVisibleStats();
      if (!$('#phv27AutoPipeline')) renderPipelineUI();
    }, 6000);
    window.addEventListener('pagehide', () => { clearInterval(fetchWatch); clearInterval(statsWatch); }, { once: true });
    $('#masterFetchBtn')?.addEventListener('click', () => {
      if (!enabled()) return;
      resetStages();
      setStage('fetch', 'active', 'Fetch command received…');
      setTimeout(watchFetchState, 0);
      setTimeout(watchFetchState, 150);
    });
    window.PROXYHARVEST_AUTO_PIPELINE = Object.freeze({
      build: BUILD,
      runNow: () => runAfterFetch('manual'),
      rescoreAndRank,
      counts,
      detectRealBridge,
      enabled,
      setEnabled
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
