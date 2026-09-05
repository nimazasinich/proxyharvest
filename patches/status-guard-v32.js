(() => {
  'use strict';
  let queued = false;
  const PH_V32_GUARD_STABILITY = '39.0.0';
  function expected() {
    const api = window.PROXYHARVEST_V32;
    if (!api?.counts) return null;
    return api.counts();
  }
  function differs(c) {
    const map = {
      phMetricVerified: c.verified,
      phMetricReachable: c.reachable,
      phMetricUntested: c.untested,
      phMetricFailed: c.failed,
      statAlive: c.verified,
      csrLive: c.verified,
      csrDead: c.failed
    };
    const ids = {
      phMetricVerified: 'phMetricVerified',
      phMetricReachable: 'phMetricReachable',
      phMetricUntested: 'phMetricUntested',
      phMetricFailed: 'phMetricFailed',
      statAlive: 'stat-alive',
      csrLive: 'csr-live',
      csrDead: 'csr-dead'
    };
    return Object.entries(map).some(([key, value]) => {
      const el = document.getElementById(ids[key]);
      if (!el) return false;
      const shown = Number(String(el.textContent || '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(shown) && shown !== Number(value);
    });
  }
  function guard() {
    queued = false;
    const api = window.PROXYHARVEST_V32;
    const c = expected();
    if (!api?.syncAll || !c) return;
    if (differs(c)) api.syncAll();
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(guard);
  }
  function install() {
    const ids = ['phMetricVerified','phMetricReachable','phMetricUntested','phMetricFailed','stat-alive','csr-live','csr-dead','phStatusCards','phv26VerifyMetrics'];
    const observer = new MutationObserver(schedule);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
    }
    const periodic = setInterval(() => { if (document.visibilityState === 'visible') guard(); }, 4000);
    window.addEventListener('pagehide', () => clearInterval(periodic), { once: true });
    guard();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})();
