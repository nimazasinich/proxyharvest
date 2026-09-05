from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'patches/compact-interaction-v34.js'
s = PATH.read_text(encoding='utf-8')

if "const PH_V34_MUTATION_STABILITY = '40.0.1'" in s:
    print('V34 mutation stability patch already applied')
    raise SystemExit(0)

s = s.replace(
    "  const PH_V34_RUNTIME_STABILITY = '39.0.0';",
    "  const PH_V34_RUNTIME_STABILITY = '39.0.0';\n  const PH_V34_MUTATION_STABILITY = '40.0.1';",
    1,
)

old = '''  function setRunState(state, text) {
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
  }'''
new = '''  function setRunState(state, text) {
    currentRun = state;
    if (document.body.dataset.phv34Run !== state) document.body.dataset.phv34Run = state;
    const notice = $('#phv34SessionNotice');
    if (notice) {
      if (notice.dataset.state !== state) notice.dataset.state = state;
      const next = text || ({
        idle: 'Previous evidence may be visible · no test is running in this session.',
        armed: 'Fetch requested · verification starts only after this harvest finishes.',
        fetching: 'Harvesting sources…',
        testing: 'Verification is running from an explicit user action.',
        done: 'Run completed · counters show the latest stored evidence.',
        stopped: 'Run stopped by user.'
      }[state] || 'Ready.');
      if (notice.textContent !== next) notice.textContent = next;
    }
  }'''
if s.count(old) != 1:
    raise RuntimeError('V34 setRunState anchor mismatch')
s = s.replace(old, new, 1)

old = '''  function normalizeIdleUI() {
    const progress = $('#realTestProgressBar');
    if (progress && currentRun === 'idle') progress.setAttribute('aria-hidden', 'true');
    const real = $('#realTestBtn');
    if (real) real.dataset.explicitOnly = '1';
    const probe = $('#phv26ProbeBtn');
    if (probe) probe.dataset.explicitOnly = '1';
    const strict = $('#phv26RealVerifyBtn');
    if (strict) strict.dataset.explicitOnly = '1';
  }'''
new = '''  function normalizeIdleUI() {
    const progress = $('#realTestProgressBar');
    if (progress && currentRun === 'idle' && progress.getAttribute('aria-hidden') !== 'true') progress.setAttribute('aria-hidden', 'true');
    const real = $('#realTestBtn');
    if (real && real.dataset.explicitOnly !== '1') real.dataset.explicitOnly = '1';
    const probe = $('#phv26ProbeBtn');
    if (probe && probe.dataset.explicitOnly !== '1') probe.dataset.explicitOnly = '1';
    const strict = $('#phv26RealVerifyBtn');
    if (strict && strict.dataset.explicitOnly !== '1') strict.dataset.explicitOnly = '1';
  }'''
if s.count(old) != 1:
    raise RuntimeError('V34 normalizeIdleUI anchor mismatch')
s = s.replace(old, new, 1)

old = '''    const periodic = setInterval(() => {
      if (document.visibilityState !== 'visible' && window.PH_STATE?.fetchRunning !== true) return;
      ensureSessionNotice();
      compactRealTestControls();
      normalizeIdleUI();
      syncFetchingState();
      guardUnexpectedTesting();
    }, 1200);'''
new = '''    // Safety polling must never perform routine DOM maintenance. Reparenting or
    // rewriting UI from this loop wakes every subtree MutationObserver and can
    // create an observer/render feedback cycle. UI normalization is performed
    // once during boot; this poll only reacts to actual runtime state changes.
    const periodic = setInterval(() => {
      if (document.visibilityState !== 'visible' && window.PH_STATE?.fetchRunning !== true) return;
      syncFetchingState();
      guardUnexpectedTesting();
    }, 1200);'''
if s.count(old) != 1:
    raise RuntimeError('V34 periodic block anchor mismatch')
s = s.replace(old, new, 1)

PATH.write_text(s, encoding='utf-8')
print('Applied V34 mutation-idempotence patch 40.0.1')
