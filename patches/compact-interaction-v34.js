(() => {
  'use strict';

  const BUILD = '34.0.0-compact-interaction';
  window.PROXYHARVEST_COMPACT_INTERACTION = BUILD;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const AUTO_KEY = 'ph_auto_pipeline_enabled';
  let sessionArmed = false;
  let manualTestRequested = false;
  let currentRun = 'idle';

  function setAutoEnabled(on) {
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch {}
    try { window.PROXYHARVEST_AUTO_PIPELINE?.setEnabled?.(on); } catch {}
  }

  function setRunState(state, text) {
    currentRun = state;
    document.body.dataset.phv34Run = state;
    const notice = $('#phv34SessionNotice');
    if (notice) {
      notice.dataset.state = state;
      notice.textContent = text || ({
        idle: 'Previous evidence may be visible · no test is running in this session.',
        armed: 'Fetch requested · verification starts only after this harvest finishes.',
        fetching: 'Harvesting sources…',
        testing: 'Verification is running from an explicit user action.',
        done: 'Run completed · counters show the latest stored evidence.',
        stopped: 'Run stopped by user.'
      }[state] || 'Ready.');
    }
  }

  function ensureSessionNotice() {
    const nav = $('#phv26ConfigNav');
    if (!nav || $('#phv34SessionNotice')) return;
    const note = document.createElement('span');
    note.id = 'phv34SessionNotice';
    note.className = 'phv34-session-notice';
    nav.appendChild(note);
    setRunState(currentRun);
  }

  function compactRealTestControls() {
    const filter = $('#tab-configs .cfgs-filter');
    if (!filter) return;
    const real = $('#realTestBtn');
    const stop = $('#realTestStopBtn');
    if (real && real.parentElement !== filter) {
      real.classList.add('phv34-realtest-inline');
      real.title = 'Run strict Real Verify only when you explicitly click this button.';
      filter.appendChild(real);
    }
    if (stop && stop.parentElement !== filter) {
      stop.classList.add('phv34-realtest-inline', 'phv34-stop-inline');
      filter.appendChild(stop);
    }
  }

  function isExplicitFetchTarget(target) {
    return !!target?.closest?.('#masterFetchBtn,[data-ph-action="fetch"],[data-ux-action="fetch-all"],[onclick*="masterFetch"]');
  }

  function isExplicitTestTarget(target) {
    return !!target?.closest?.('#realTestBtn,#phv26ProbeBtn,#phv26RealVerifyBtn,#runConnTestBtn,#runConnTestBtnAction,#splitnetPingAllBtn,[data-action="run-conn-test"]');
  }

  function isStopTarget(target) {
    return !!target?.closest?.('#realTestStopBtn,#phv26StopVerifyBtn,#stopBtn');
  }

  function armFromUserFetch() {
    sessionArmed = true;
    manualTestRequested = false;
    setAutoEnabled(true);
    setRunState('armed');
    document.body.dataset.phv34ExplicitFetch = '1';
    window.dispatchEvent(new CustomEvent('ph:v34-explicit-fetch'));
  }

  function markManualTest() {
    manualTestRequested = true;
    setRunState('testing');
    document.body.dataset.phv34ExplicitTest = '1';
  }

  function disarmAfterRun(state = 'done') {
    sessionArmed = false;
    manualTestRequested = false;
    setAutoEnabled(false);
    setRunState(state);
    delete document.body.dataset.phv34ExplicitFetch;
    delete document.body.dataset.phv34ExplicitTest;
  }

  function guardUnexpectedTesting() {
    const running = window.RealTestEngine?.isRunning === true;
    if (!running) return;
    if (sessionArmed || manualTestRequested) return;
    try { window.stopRealTest?.(); } catch {}
    setRunState('idle', 'Blocked an implicit verification start · click Fetch or a Test button to run it.');
  }

  function syncFetchingState() {
    const s = window.PH_STATE;
    if (!s) return;
    if (s.fetchRunning === true && sessionArmed) setRunState('fetching');
  }

  function installEvents() {
    document.addEventListener('click', e => {
      if (!e.isTrusted) return;
      if (isExplicitFetchTarget(e.target)) armFromUserFetch();
      else if (isExplicitTestTarget(e.target)) markManualTest();
      else if (isStopTarget(e.target)) disarmAfterRun('stopped');
    }, true);

    window.addEventListener('ph:v27-pipeline-complete', () => disarmAfterRun('done'));
    window.addEventListener('ph:v32-verify-progress', () => {
      if (sessionArmed || manualTestRequested) setRunState('testing');
    });
    window.addEventListener('beforeunload', () => setAutoEnabled(false));
  }

  function normalizeIdleUI() {
    const progress = $('#realTestProgressBar');
    if (progress && currentRun === 'idle') progress.setAttribute('aria-hidden', 'true');
    const real = $('#realTestBtn');
    if (real) real.dataset.explicitOnly = '1';
    const probe = $('#phv26ProbeBtn');
    if (probe) probe.dataset.explicitOnly = '1';
    const strict = $('#phv26RealVerifyBtn');
    if (strict) strict.dataset.explicitOnly = '1';
  }

  function boot() {
    // Session safety: persisted evidence is allowed, persisted auto-run permission is not.
    setAutoEnabled(false);
    setRunState('idle');
    ensureSessionNotice();
    compactRealTestControls();
    normalizeIdleUI();
    installEvents();

    setInterval(() => {
      ensureSessionNotice();
      compactRealTestControls();
      normalizeIdleUI();
      syncFetchingState();
      guardUnexpectedTesting();
    }, 350);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
