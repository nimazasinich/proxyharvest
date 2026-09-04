import { state, stats, subscribe } from './core.js';

export const pages = [
  ['dashboard','Dashboard','Real-time overview of the proxy harvesting pipeline','home'],
  ['configs','Configs','Inspect, test, filter, sort and export harvested configs','list'],
  ['splitnet','SplitNet','Free WARP and transport candidates with bulk actions','network'],
  ['ircf','IRCF','WARP+ keys and clean Cloudflare endpoints','grid'],
  ['sources','Sources','Subscription catalog, source health and selective harvest','database'],
  ['wireguard','WireGuard','Provenance, reachability, handshake and self-healing workflow','shield'],
  ['repair','AI Healer','Deterministic Repair Lab + Hugging Face Qwen advisor + verification','spark'],
  ['settings','Settings','Runtime, network, export, storage and appearance preferences','settings'],
  ['infrastructure','Infrastructure','Cloudflare Worker, model backend and Real Test Bridge','server'],
];

const iconPaths = {
  home:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M9 20v-6h6v6"/>',
  list:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  network:'<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5M12 12 6.4 17M12 12l5.6 5"/>',
  grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  database:'<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  shield:'<path d="M12 3 5 6v5c0 4.7 3 8 7 10 4-2 7-5.3 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/>',
  spark:'<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/><circle cx="12" cy="12" r="3"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
  server:'<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 7h.01M8 18h.01M12 7h5M12 18h5"/>',
};
export function icon(name){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.grid}</svg>`; }

let current = location.hash.replace('#','') || 'dashboard';
export function getCurrentPage(){ return current; }
export function navigate(page){ if(!pages.some(p=>p[0]===page)) page='dashboard'; current=page; location.hash=page; renderShellState(); window.dispatchEvent(new CustomEvent('ph:navigate',{detail:{page}})); }

export function buildShell(){
  document.body.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark"><svg viewBox="0 0 28 28" fill="none"><path d="M7 8.5h9.5a4.5 4.5 0 1 1 0 9H12" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="m10 5-5 3.5 5 3.5" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="brand-copy"><strong>ProxyHarvest</strong><span>Network Intelligence</span></div></div>
        <div class="nav-group"><div class="nav-label">Workspace</div>${pages.slice(0,5).map(navMarkup).join('')}</div>
        <div class="nav-group"><div class="nav-label">Intelligence</div>${pages.slice(5,7).map(navMarkup).join('')}</div>
        <div class="nav-group"><div class="nav-label">System</div>${pages.slice(7).map(navMarkup).join('')}</div>
        <div class="sidebar-foot"><div class="plan"><strong>V15 NetworkCanonical parity</strong><small>Worker reachability + HF advisor + Real Bridge verification</small><div class="plan-bar"><i></i></div><small id="sideStatus">Ready</small></div></div>
      </aside>
      <main class="main">
        <header class="topbar"><div class="page-title"><h1 id="pageTitle"></h1><p id="pageSubtitle"></p></div><div class="top-actions"><button class="btn" id="verifySourcesTop">Verify sources</button><button class="btn primary" id="harvestTop">Fetch enabled</button></div></header>
        <div class="progress-shell"><div class="progress-line" id="progressLine"></div></div>
        <section class="workspace"><div class="progress-card" id="progressCard"><div class="spinner"></div><div class="progress-copy"><strong id="progressStage">Working</strong><span id="progressDetail"></span></div><div class="progress-pct" id="progressPct">0%</div></div><div id="workspaceRoot"></div></section>
      </main>
    </div><div class="toast-wrap" id="toastWrap"></div><div class="modal-backdrop" id="modalBackdrop"><div class="modal"><div class="modal-head"><h3 id="modalTitle">Details</h3><button class="btn small right" id="modalClose">Close</button></div><div class="modal-body" id="modalBody"></div><div class="modal-foot" id="modalFoot"></div></div></div>`;
  document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));
  $('modalClose').onclick=closeModal; $('modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal()});
  window.addEventListener('hashchange',()=>{ current=location.hash.replace('#','')||'dashboard'; renderShellState(); window.dispatchEvent(new CustomEvent('ph:navigate',{detail:{page:current}})); });
  subscribe((type,detail)=>{ if(type==='progress') renderProgress(detail); renderCounts(); });
  renderShellState(); renderCounts();
}
function navMarkup([id,label,,ico]){ return `<button class="nav-item" data-page="${id}">${icon(ico)}<span>${label}</span><span class="count" data-count="${id}">0</span></button>`; }
function $(id){return document.getElementById(id)}
function renderShellState(){ const meta=pages.find(p=>p[0]===current)||pages[0]; $('pageTitle').textContent=meta[1];$('pageSubtitle').textContent=meta[2];document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===current)); }
function renderCounts(){ const s=stats(); const map={dashboard:s.total,configs:s.total,splitnet:s.vless+s.wireguard,ircf:state.ircf.keys.length+state.ircf.endpoints.length,sources:state.sources.length,wireguard:s.wireguard,repair:state.configs.filter(c=>c.tested&&c.live===false).length,settings:'',infrastructure:''}; Object.entries(map).forEach(([k,v])=>{const el=document.querySelector(`[data-count="${k}"]`);if(el)el.textContent=v===''?'–':Number(v).toLocaleString();}); }
function renderProgress(p){ const active=state.busy || (p.total>0 && p.pct<100); $('progressCard').classList.toggle('show',active);$('progressLine').style.width=active?`${Math.max(2,p.pct)}%`:'0';$('progressStage').textContent=p.stage||'Working';$('progressDetail').textContent=p.detail||'';$('progressPct').textContent=p.total?`${p.pct}%`:'';$('sideStatus').textContent=active?`${p.stage} · ${p.pct}%`:'Ready'; }
export function toast(msg,tone='info',ttl=3200){const t=document.createElement('div');t.className=`toast ${tone==='good'?'good':tone==='bad'?'bad':tone==='warn'?'warn':''}`;t.innerHTML=`<div>${escapeHtml(msg)}</div>`;$('toastWrap').appendChild(t);setTimeout(()=>t.remove(),ttl)}
export function openModal(title,body,foot=''){ $('modalTitle').textContent=title;$('modalBody').innerHTML=body;$('modalFoot').innerHTML=foot;$('modalBackdrop').classList.add('show'); }
export function closeModal(){ $('modalBackdrop').classList.remove('show'); }
export function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
