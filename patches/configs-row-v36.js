(() => {
  'use strict';

  const BUILD = '36.0.0-single-line-rows';
  window.PROXYHARVEST_CONFIGS_ROW = BUILD;
  const PH_V36_RUNTIME_STABILITY = '39.0.0';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function shortEvidence(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    const low = raw.toLowerCase();
    if (low.includes('verified live') || low.includes('protocol verified') || low.includes('tunnel verified')) return ['Verified', 'Protocol/tunnel verification evidence is present.'];
    if (low.includes('worker reachable')) return ['Reachable', 'Worker reached the endpoint only; protocol/tunnel is not verified.'];
    if (low.includes('bridge reachable')) return ['Reachable', 'Bridge reached the endpoint only; protocol/tunnel is not verified.'];
    if (low.includes('browser reachable')) return ['Reachable', 'Browser probe reached the endpoint only; protocol/tunnel is not verified.'];
    if (low.includes('browser probe')) return ['Probe', 'Browser probe evidence only; not protocol/tunnel verification.'];
    if (low.includes('untested') || low.includes('not tested')) return ['Untested', 'No verification evidence yet.'];
    if (low.includes('dead') || low.includes('failed')) return ['Failed', 'Explicit latest test failure.'];
    return null;
  }

  function normalizeEvidencePill(el) {
    if (!el || el.dataset.phv36Normalized === '1') return;
    const full = el.dataset.phv36Original || String(el.textContent || '').replace(/\s+/g, ' ').trim();
    const mapped = shortEvidence(full);
    if (!mapped) return;
    el.dataset.phv36Original = full;
    el.textContent = mapped[0];
    el.title = mapped[1];
    el.setAttribute('aria-label', `${mapped[0]}. ${mapped[1]}`);
    el.dataset.phv36Normalized = '1';
  }

  function normalizeRows() {
    const tab = $('#tab-configs');
    if (!tab) return;

    $$('.host-cell .conn-badge,.host-cell .ph-vbadge,.host-cell .ph-status-pill', tab).forEach(normalizeEvidencePill);

    $$('.host-cell', tab).forEach(cell => {
      const full = cell.getAttribute('title') || String(cell.textContent || '').replace(/\s+/g, ' ').trim();
      if (full) cell.setAttribute('aria-label', full);
    });

    $$('.cfg-row-actions .btn', tab).forEach(btn => {
      const title = btn.getAttribute('title');
      if (title && !btn.getAttribute('aria-label')) btn.setAttribute('aria-label', title);
    });
  }

  function boot() {
    normalizeRows();
    let timer = null;
    const tab = $('#tab-configs');
    if (tab) {
      const mo = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(normalizeRows, 140);
      });
      mo.observe(tab, { subtree: true, childList: true, characterData: true });
    }
    window.addEventListener('ph:v27-stats', normalizeRows);
    window.addEventListener('ph:v32-verification-sync', normalizeRows);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
