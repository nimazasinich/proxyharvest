from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'patches/status-sync-v32.js'


def sub_once(text, pattern, replacement, label, flags=0):
    rx = re.compile(pattern, flags)
    matches = list(rx.finditer(text))
    if len(matches) != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {len(matches)}')
    return rx.sub(lambda _m: replacement, text, count=1)


s = PATH.read_text(encoding='utf-8')
if "const PH_V32_MUTATION_STABILITY = '40.0.0'" in s:
    print('V32 mutation stability patch already applied')
    raise SystemExit(0)

helper_anchor = '''  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    const next = String(value);
    if (el.textContent === next) return false;
    el.textContent = next;
    return true;
  }
'''
helper_replacement = helper_anchor + '''  const PH_V32_MUTATION_STABILITY = '40.0.0';
  function setHtml(target, value) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return false;
    const next = String(value ?? '');
    if (el.innerHTML === next) return false;
    el.innerHTML = next;
    return true;
  }
'''
if s.count(helper_anchor) != 1:
    raise RuntimeError('V32 helper anchor mismatch')
s = s.replace(helper_anchor, helper_replacement, 1)

s = sub_once(
    s,
    r"  function renderConfigStatus\(c\) \{.*?\n    if \(!c\.consistent\) console\.error\('\[ProxyHarvest V32\] verification count invariant failed', audit\);\n    return c;\n  \}",
    '''  function renderConfigStatus(c) {
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
      const html = [
        ['Verified', c.verified, 'Protocol/tunnel evidence', 'live'],
        ['Reachable', c.reachable, 'Endpoint only — not verified', 'bridge'],
        ['Untested', c.untested, 'No conclusive verification evidence', 'unknown'],
        ['Failed', c.failed, 'Explicit latest test failure', 'dead']
      ].map(([label, value, sub, key]) => `<div class="ph-status-card ph-card-${key}"><strong>${Number(value).toLocaleString()}</strong><span>${label}</span><small>${sub}</small></div>`).join('');
      setHtml(statusCards, html);
    }

    const v26 = $('#phv26VerifyMetrics');
    if (v26) {
      setHtml(v26, `<div class="good"><span>Verified</span><b>${c.verified.toLocaleString()}</b><small>Protocol/tunnel evidence</small></div><div class="info"><span>Reachable</span><b>${c.reachable.toLocaleString()}</b><small>Endpoint only</small></div><div><span>Untested</span><b>${c.untested.toLocaleString()}</b><small>No conclusive evidence</small></div><div class="bad"><span>Failed</span><b>${c.failed.toLocaleString()}</b><small>Explicit test failure</small></div>`);
    }

    if (!window.RealTestEngine?.isRunning) setText('realTestLive', `${c.verified} verified`);

    const verifiedCard = $('#phMetricVerified')?.closest('.ph-metric');
    if (verifiedCard) {
      const count = String(c.verified);
      const exportable = String(c.exportableVerified);
      if (verifiedCard.dataset.count !== count) verifiedCard.dataset.count = count;
      if (verifiedCard.dataset.exportable !== exportable) verifiedCard.dataset.exportable = exportable;
      verifiedCard.classList.toggle('ph-v32-has-live', c.verified > 0);
      verifiedCard.classList.toggle('ph-v32-no-live', c.verified === 0);
      const title = c.verified
        ? `${c.verified} verified; ${c.exportableVerified} safely exportable. Click to open Best Export.`
        : 'No protocol/tunnel verified configs yet. Configure Local Bridge and run Real Verify.';
      if (verifiedCard.title !== title) verifiedCard.title = title;
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
  }''',
    'renderConfigStatus',
    re.S,
)

old_top_status = "      const topStatus = $('#progStatus');\n      if (topStatus && label) topStatus.textContent = label;"
new_top_status = "      if (label) setText('progStatus', label);"
if s.count(old_top_status) != 1:
    raise RuntimeError('dashboardProgress progStatus anchor mismatch')
s = s.replace(old_top_status, new_top_status, 1)

PATH.write_text(s, encoding='utf-8')
print('Applied V32 mutation-loop stability patch 40.0.0')
