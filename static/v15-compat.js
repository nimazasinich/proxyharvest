import { state, replaceConfig } from './core.js';
import { summarizeVerification, scoreConfig } from './engine.js';
import { toast } from './ui.js';

const BUILD = 'v15-network-compat-2026-09-04';
let installed = false;
let running = false;

function download(name, text, type='text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
}

function copy(text) {
  return navigator.clipboard?.writeText(text).catch(() => {}) || Promise.resolve();
}

function rankedConfigs() {
  return state.configs.slice().sort((a, b) => {
    const av = a.probe?.tunnelVerified || a.probe?.protocolVerified ? 3 : a.live === true ? 2 : summarizeVerification(a).key === 'reachable' ? 1 : 0;
    const bv = b.probe?.tunnelVerified || b.probe?.protocolVerified ? 3 : b.live === true ? 2 : summarizeVerification(b).key === 'reachable' ? 1 : 0;
    if (bv !== av) return bv - av;
    const as = Number(a.score || 0), bs = Number(b.score || 0);
    if (bs !== as) return bs - as;
    const al = Number.isFinite(a.latency) ? a.latency : 999999;
    const bl = Number.isFinite(b.latency) ? b.latency : 999999;
    return al - bl;
  });
}

function exportSet(kind) {
  let list = [];
  if (kind === 'verified') list = state.configs.filter(c => c.probe?.tunnelVerified || c.probe?.protocolVerified);
  else if (kind === 'reachable') list = state.configs.filter(c => c.live === true || summarizeVerification(c).key === 'reachable');
  else if (kind === 'working100') list = rankedConfigs().filter(c => c.live === true || c.probe?.tunnelVerified || c.probe?.protocolVerified || summarizeVerification(c).key === 'reachable').slice(0, 100);
  else if (kind === 'top100') list = rankedConfigs().slice(0, 100);
  else list = state.configs;

  const text = list.map(c => c.raw).filter(Boolean).join('\n');
  if (!text) {
    toast('No configs available for this export bucket.', 'warn');
    return;
  }
  const filename = `proxyharvest-${kind}-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.txt`;
  download(filename, text);
  copy(text);
  toast(`${list.length} configs exported and copied for direct client import.`, 'good');
}

async function probeOne(cfg) {
  const started = performance.now();
  try {
    const r = await fetch(`${state.worker}/probe?host=${encodeURIComponent(cfg.host)}&port=${encodeURIComponent(cfg.port || 443)}`, { cache:'no-store' });
    const data = await r.json().catch(() => ({}));
    const reachable = r.ok && data?.reachable === true;
    cfg.tested = true;
    cfg.live = reachable;
    cfg.latency = Number.isFinite(data?.latencyMs) ? data.latencyMs : Math.round(performance.now() - started);
    cfg.probe = {
      method: 'cloudflare-worker-endpoint-probe',
      confidence: reachable ? 'medium' : 'low',
      protocolVerified: false,
      tunnelVerified: false,
      evidence: reachable
        ? [`Worker reached ${cfg.host}:${cfg.port}; endpoint is reachable, protocol/tunnel still needs Real Test Bridge.`]
        : [`Worker could not reach ${cfg.host}:${cfg.port}.`]
    };
    cfg.score = scoreConfig(cfg);
  } catch (e) {
    cfg.tested = true;
    cfg.live = false;
    cfg.latency = Math.round(performance.now() - started);
    cfg.probe = {
      method: 'cloudflare-worker-endpoint-probe',
      confidence: 'low',
      protocolVerified: false,
      tunnelVerified: false,
      evidence: [String(e?.message || e)]
    };
    cfg.score = scoreConfig(cfg);
  }
  await replaceConfig(cfg.id, cfg);
  return cfg;
}

async function probeBatch(limit=100) {
  if (running) return;
  const list = rankedConfigs().filter(c => c.host && c.port).slice(0, limit);
  if (!list.length) {
    toast('No configs to probe. Harvest sources first.', 'warn');
    return;
  }
  running = true;
  setCompatStatus(`Testing ${list.length} configs…`);
  toast(`Testing top ${list.length} configs through Worker endpoint probe…`, 'warn');
  let done = 0, ok = 0;
  const workers = Array.from({ length: Math.min(8, list.length) }, async () => {
    while (list.length) {
      const cfg = list.shift();
      const out = await probeOne(cfg);
      if (out.live === true) ok++;
      done++;
      setCompatStatus(`Testing ${done}/${done + list.length} · reachable ${ok}`);
    }
  });
  await Promise.all(workers);
  running = false;
  setCompatStatus(`Ready · reachable ${ok}/${done}`);
  toast(`Probe complete: ${ok}/${done} reachable. Use Export Working 100.`, ok ? 'good' : 'warn');
}

function setCompatStatus(text) {
  const el = document.getElementById('v15CompatStatus');
  if (el) el.textContent = text;
  window.PROXYHARVEST_COMPAT_STATUS = { build: BUILD, status: text, at: new Date().toISOString() };
}

function injectToolbar() {
  const root = document.getElementById('workspaceRoot');
  if (!root || root.dataset.v15Compat === '1') return;
  const toolbar = root.querySelector('.toolbar');
  if (!toolbar) return;
  const page = location.hash.replace('#','') || 'dashboard';
  if (!['configs','splitnet','dashboard'].includes(page)) return;
  root.dataset.v15Compat = '1';
  const box = document.createElement('span');
  box.className = 'v15-compat-actions';
  box.style.display = 'flex';
  box.style.gap = '8px';
  box.style.flexWrap = 'wrap';
  box.innerHTML = `
    <button class="btn" id="v15Probe100" title="Probe top ranked configs via Cloudflare Worker endpoint probe">Test/Ping Top 100</button>
    <button class="btn primary" id="v15ExportWorking">Export Working 100</button>
    <button class="btn" id="v15ExportReachable">Export Reachable</button>
    <button class="btn" id="v15ExportVerified">Export Verified Live</button>
    <span class="pill info" id="v15CompatStatus">V15 compat ready</span>`;
  toolbar.appendChild(box);
  document.getElementById('v15Probe100').onclick = () => probeBatch(100);
  document.getElementById('v15ExportWorking').onclick = () => exportSet('working100');
  document.getElementById('v15ExportReachable').onclick = () => exportSet('reachable');
  document.getElementById('v15ExportVerified').onclick = () => exportSet('verified');
}

function injectStyle() {
  if (document.getElementById('v15CompatStyle')) return;
  const style = document.createElement('style');
  style.id = 'v15CompatStyle';
  style.textContent = `
    .v15-compat-actions{margin-left:auto;align-items:center}.v15-compat-actions .btn{white-space:nowrap}
    .hero:before{content:'V15 NetworkCanonical Feature Layer';display:inline-flex;margin-bottom:10px;padding:5px 10px;border:1px solid rgba(2,132,199,.28);border-radius:999px;background:rgba(2,132,199,.08);color:#0369a1;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
    .data-table td .endpoint{font-weight:800}.pill.info{border-color:rgba(2,132,199,.25)}
  `;
  document.head.appendChild(style);
}

export function bootV15Compatibility() {
  if (installed) return;
  installed = true;
  injectStyle();
  window.PROXYHARVEST_V15_COMPAT = { build: BUILD, probeBatch, exportSet };
  const obs = new MutationObserver(() => injectToolbar());
  const target = document.getElementById('workspaceRoot') || document.body;
  obs.observe(target, { childList:true, subtree:true });
  window.addEventListener('hashchange', () => setTimeout(() => { const r=document.getElementById('workspaceRoot'); if(r) delete r.dataset.v15Compat; injectToolbar(); }, 50));
  setTimeout(injectToolbar, 150);
}
