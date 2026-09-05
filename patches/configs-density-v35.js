(() => {
  'use strict';

  const BUILD = '35.0.0-configs-density';
  window.PROXYHARVEST_CONFIGS_DENSITY = BUILD;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const LABELS = new Map([
    ['Worker Reachable', ['Reachable', 'Worker endpoint reached; protocol/tunnel is not verified.']],
    ['Bridge Reachable', ['Reachable', 'Bridge endpoint reached; protocol/tunnel is not verified.']],
    ['Browser Reachable', ['Reachable', 'Browser probe reached the endpoint; protocol/tunnel is not verified.']],
    ['Browser Probe', ['Probe', 'Browser probe evidence only; not protocol/tunnel verification.']],
    ['Verified Live', ['Verified', 'Protocol/tunnel verification evidence is present.']],
    ['Protocol Verified', ['Verified', 'Protocol verification evidence is present.']],
    ['Tunnel Verified', ['Verified', 'Tunnel verification evidence is present.']],
    ['Not Tested', ['Untested', 'No verification evidence yet.']]
  ]);

  function normalizeBadge(el) {
    if (!el || el.dataset.phv35Normalized === '1') return;
    const raw = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    const match = LABELS.get(raw);
    if (!match) return;
    el.textContent = match[0];
    el.title = match[1];
    el.setAttribute('aria-label', `${match[0]}. ${match[1]}`);
    el.dataset.phv35Original = raw;
    el.dataset.phv35Normalized = '1';
  }

  function normalizeTable() {
    const tab = $('#tab-configs');
    if (!tab) return;
    $$('.ph-vbadge,.conn-badge,.ph-status-pill', tab).forEach(normalizeBadge);

    // Preserve full endpoint/evidence in tooltips while keeping rows short.
    $$('.host-cell', tab).forEach(cell => {
      if (cell.dataset.phv35Title === '1') return;
      const full = String(cell.textContent || '').replace(/\s+/g, ' ').trim();
      if (full) cell.title = full;
      cell.dataset.phv35Title = '1';
    });

    // The upper toolbar already exposes Test / DoH / Clear; avoid duplicate controls below.
    ['runDoHBatchBtnAction', 'runConnTestBtnAction', 'cfgClearFiltersBtnAction'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;
      }
    });
  }

  function clarifyStatusOverview() {
    const title = $('#phStatusOverview .ph-status-title span');
    if (title) title.textContent = 'Verified = real protocol/tunnel evidence · Reachable = endpoint only';
  }

  function boot() {
    normalizeTable();
    clarifyStatusOverview();
    let timer = null;
    const mo = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        normalizeTable();
        clarifyStatusOverview();
      }, 40);
    });
    const tab = $('#tab-configs');
    if (tab) mo.observe(tab, { subtree: true, childList: true, characterData: true });
    window.addEventListener('ph:v27-stats', normalizeTable);
    window.addEventListener('ph:v32-verification-sync', normalizeTable);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
