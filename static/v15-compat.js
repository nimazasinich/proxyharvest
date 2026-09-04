import { state, replaceConfig } from './core.js';
import { summarizeVerification, scoreConfig } from './engine.js';
import { toast } from './ui.js';

const BUILD = 'v15-networkcanonical-parity-2026-09-04';
const BRIDGE_KEY = 'ph_real_ping_bridge';
let installed = false;
let running = false;
let realRunning = false;

function download(name, text, type='text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
}
function copy(text) { return navigator.clipboard?.writeText(text).catch(() => {}) || Promise.resolve(); }
function verified(c){ return c?.probe?.tunnelVerified === true || c?.probe?.protocolVerified === true; }
function reachable(c){ const p=c?.probe||{}; return p.browserReachable===true || p.workerReachable===true || p.bridgeReachable===true || c?.reachable===true; }
function rankedConfigs() {
  return state.configs.slice().sort((a, b) => {
    const av = verified(a) ? 3 : reachable(a) ? 1 : 0;
    const bv = verified(b) ? 3 : reachable(b) ? 1 : 0;
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
  if (kind === 'verified') list = state.configs.filter(verified);
  else if (kind === 'reachable') list = state.configs.filter(c => reachable(c) && !verified(c));
  else if (kind === 'working100') list = rankedConfigs().filter(c => verified(c) || reachable(c)).slice(0, 100);
  else if (kind === 'top100') list = rankedConfigs().slice(0, 100);
  else list = state.configs;
  const text = list.map(c => c.raw).filter(Boolean).join('\n');
  if (!text) { toast('No configs available for this export bucket.', 'warn'); return; }
  const filename = `proxyharvest-${kind}-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.txt`;
  download(filename, text); copy(text);
  const note = kind === 'verified' ? 'verified only' : kind === 'reachable' ? 'reachable-only; not protocol verified' : kind === 'working100' ? 'best verified/reachable mix' : kind;
  toast(`${list.length} configs exported (${note}) and copied.`, kind === 'verified' ? 'good' : 'warn');
}

function appendEvidence(oldProbe, line) {
  const ev = Array.isArray(oldProbe?.evidence) ? oldProbe.evidence.slice(-9) : [];
  if (line) ev.push(line);
  return ev.slice(-10);
}

async function probeOne(cfg) {
  const started = performance.now();
  const old = cfg.probe || {};
  try {
    const r = await fetch(`${state.worker}/probe?host=${encodeURIComponent(cfg.host)}&port=${encodeURIComponent(cfg.port || 443)}`, { cache:'no-store' });
    const data = await r.json().catch(() => ({}));
    const isReachable = r.ok && data?.reachable === true;
    cfg.tested = true;
    cfg.reachable = isReachable;
    cfg.latency = Number.isFinite(data?.latencyMs) ? data.latencyMs : Math.round(performance.now() - started);
    cfg.probe = {
      ...old,
      method: 'cloudflare-worker-endpoint-probe',
      confidence: verified(cfg) ? 'high' : isReachable ? 'medium' : 'low',
      workerReachable: isReachable,
      protocolVerified: old.protocolVerified === true,
      tunnelVerified: old.tunnelVerified === true,
      latencyMs: cfg.latency,
      testedAt: Date.now(),
      evidence: appendEvidence(old, isReachable
        ? `Worker reached ${cfg.host}:${cfg.port}; endpoint reachable only, protocol/tunnel not proven.`
        : `Worker could not reach ${cfg.host}:${cfg.port}.`)
    };
    cfg.live = cfg.probe.protocolVerified || cfg.probe.tunnelVerified ? true : null;
    cfg.score = scoreConfig(cfg);
  } catch (e) {
    cfg.tested = true; cfg.reachable = false; cfg.live = verified(cfg) ? true : null;
    cfg.latency = Math.round(performance.now() - started);
    cfg.probe = {
      ...old, method:'cloudflare-worker-endpoint-probe', confidence:verified(cfg)?'high':'low',
      workerReachable:false, protocolVerified:old.protocolVerified===true, tunnelVerified:old.tunnelVerified===true,
      latencyMs:cfg.latency, testedAt:Date.now(), evidence:appendEvidence(old,String(e?.message||e))
    };
    cfg.score = scoreConfig(cfg);
  }
  await replaceConfig(cfg.id, cfg);
  return cfg;
}

async function probeBatch(limit=100) {
  if (running) return;
  const queue = rankedConfigs().filter(c => c.host && c.port).slice(0, limit);
  if (!queue.length) { toast('No configs to probe. Harvest sources first.', 'warn'); return; }
  const total=queue.length; running=true; setCompatStatus(`Worker probe 0/${total}`);
  let done=0, ok=0;
  const workers=Array.from({length:Math.min(8,total)},async()=>{while(queue.length){const cfg=queue.shift();const out=await probeOne(cfg);if(reachable(out))ok++;done++;setCompatStatus(`Worker probe ${done}/${total} · reachable ${ok}`);}});
  await Promise.all(workers); running=false;
  setCompatStatus(`Ready · reachable ${ok}/${done}`);
  toast(`Endpoint probe complete: ${ok}/${done} reachable. REACHABLE is not VERIFIED.`, ok?'warn':'bad');
  refreshWorkspace();
}

function normalizeBridgeBase(raw='') { return String(raw).trim().replace(/\/$/,'').replace(/\/verify-config\/?$/,''); }
function getBridgeBase(){ return normalizeBridgeBase(document.getElementById('v15BridgeUrl')?.value || localStorage.getItem(BRIDGE_KEY) || ''); }
function saveBridge(){ const v=getBridgeBase(); if(v)localStorage.setItem(BRIDGE_KEY,v); else localStorage.removeItem(BRIDGE_KEY); toast(v?'Real Test Bridge saved.':'Bridge URL cleared.',v?'good':'warn'); setCompatStatus(v?'Bridge configured':'Bridge not configured'); }

async function bridgeVerifyOne(cfg, timeoutMs=15000) {
  const base=getBridgeBase();
  if(!base) throw new Error('Set Real Test Bridge URL first.');
  const started=performance.now(); const old=cfg.probe||{};
  const ctrl=new AbortController(); const tid=setTimeout(()=>ctrl.abort(),timeoutMs);
  try {
    const r=await fetch(`${base}/verify-config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uri:cfg.raw,host:cfg.host,port:cfg.port,type:cfg.type,timeoutMs}),signal:ctrl.signal,cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data?.error || `Bridge HTTP ${r.status}`);
    const bridgeReachable = data.bridgeReachable === true || data.reachable === true || data.tcpOk === true || data.tlsOk === true || data.udpSent === true;
    const protocolVerified = data.protocolVerified === true || data.handshakeOk === true;
    const tunnelVerified = data.tunnelVerified === true || data.httpViaTunnelOk === true;
    const explicitVerifyFail = data.protocolVerified === false || data.handshakeOk === false || data.tunnelVerified === false;
    const latency=Number(data.latencyMs ?? data.tcpLatencyMs ?? data.tlsLatencyMs ?? Math.round(performance.now()-started));
    const evidence=[];
    if(data.resolvedIp||data.ip)evidence.push(`ip=${data.resolvedIp||data.ip}`);
    if(data.tcpLatencyMs!=null)evidence.push(`tcp=${data.tcpLatencyMs}ms`);
    if(data.tlsLatencyMs!=null)evidence.push(`tls=${data.tlsLatencyMs}ms`);
    if(data.httpStatus!=null)evidence.push(`http=${data.httpStatus}`);
    if(data.egressIp)evidence.push(`egress=${data.egressIp}`);
    if(cfg.type==='wireguard' && protocolVerified)evidence.push('wireguard-handshake=verified');
    cfg.tested=true; cfg.reachable=bridgeReachable || old.workerReachable===true; cfg.latency=Number.isFinite(latency)?latency:null;
    cfg.probe={...old,method:data.method||'real-test-bridge',confidence:tunnelVerified||protocolVerified?'high':bridgeReachable?'medium':'low',bridgeReachable,protocolVerified,tunnelVerified,latencyMs:cfg.latency,testedAt:Date.now(),evidence:[...(old.evidence||[]).slice(-6),...evidence].slice(-10)};
    cfg.live=tunnelVerified||protocolVerified?true:explicitVerifyFail?false:null;
    cfg.score=scoreConfig(cfg); await replaceConfig(cfg.id,cfg); return cfg;
  } finally { clearTimeout(tid); }
}

async function realVerifyBatch(limit=100) {
  if(realRunning)return;
  const base=getBridgeBase(); if(!base){toast('Set Real Test Bridge URL first.','warn');document.getElementById('v15BridgeUrl')?.focus();return;}
  const queue=rankedConfigs().filter(c=>c.host&&c.port).slice(0,limit); if(!queue.length){toast('No configs to verify.','warn');return;}
  realRunning=true; const total=queue.length; let done=0,verifiedCount=0,fail=0; setCompatStatus(`Real verify 0/${total}`);
  const workers=Array.from({length:Math.min(4,total)},async()=>{while(queue.length){const cfg=queue.shift();try{const out=await bridgeVerifyOne(cfg);if(verified(out))verifiedCount++;else if(out.live===false)fail++;}catch(e){fail++;}done++;setCompatStatus(`Real verify ${done}/${total} · verified ${verifiedCount} · fail ${fail}`);}});
  await Promise.all(workers); realRunning=false; setCompatStatus(`Ready · verified ${verifiedCount}/${done}`);
  toast(`Real Bridge complete: ${verifiedCount}/${done} protocol/tunnel verified.`,verifiedCount?'good':'warn'); refreshWorkspace();
}

function refreshWorkspace(){ try{window.dispatchEvent(new CustomEvent('ph:navigate',{detail:{page:location.hash.replace('#','')||'configs'}}));}catch{} }
function setCompatStatus(text) { const el=document.getElementById('v15CompatStatus'); if(el)el.textContent=text; window.PROXYHARVEST_COMPAT_STATUS={build:BUILD,status:text,at:new Date().toISOString()}; }

function injectToolbar() {
  const root=document.getElementById('workspaceRoot'); if(!root||root.dataset.v15Compat==='1')return;
  const page=location.hash.replace('#','')||'dashboard'; if(!['configs','splitnet','wireguard','dashboard'].includes(page))return;
  const toolbar=root.querySelector('.toolbar') || root.querySelector('.panel-head'); if(!toolbar)return;
  root.dataset.v15Compat='1';
  const box=document.createElement('div'); box.className='v15-compat-actions';
  box.innerHTML=`<input class="field v15-bridge" id="v15BridgeUrl" placeholder="Real Test Bridge URL" value="${(localStorage.getItem(BRIDGE_KEY)||'').replace(/"/g,'&quot;')}">
    <button class="btn" id="v15SaveBridge">Save Bridge</button>
    <button class="btn" id="v15Probe100" title="Cloudflare Worker endpoint reachability only">Test/Ping Top 100</button>
    <button class="btn primary" id="v15RealVerify100" title="Protocol/tunnel verification through your Real Test Bridge">Real Verify Top 100</button>
    <button class="btn" id="v15ExportWorking">Export Working 100</button>
    <button class="btn" id="v15ExportReachable">Export Reachable</button>
    <button class="btn" id="v15ExportVerified">Export Verified Live</button>
    <span class="pill info" id="v15CompatStatus">V15 parity ready</span>`;
  toolbar.appendChild(box);
  document.getElementById('v15SaveBridge').onclick=saveBridge;
  document.getElementById('v15Probe100').onclick=()=>probeBatch(100);
  document.getElementById('v15RealVerify100').onclick=()=>realVerifyBatch(100);
  document.getElementById('v15ExportWorking').onclick=()=>exportSet('working100');
  document.getElementById('v15ExportReachable').onclick=()=>exportSet('reachable');
  document.getElementById('v15ExportVerified').onclick=()=>exportSet('verified');
}

function installProbeInterceptor(){
  document.addEventListener('click',async e=>{
    const b=e.target.closest?.('[data-probe]'); if(!b)return;
    e.preventDefault(); e.stopImmediatePropagation();
    const cfg=state.configs.find(x=>x.id===b.dataset.probe); if(!cfg)return;
    b.disabled=true; try{const out=await probeOne(cfg);toast(reachable(out)?'Endpoint reachable only; use Real Verify for protocol/tunnel.':'Endpoint probe failed.',reachable(out)?'warn':'bad');}catch(err){toast(String(err?.message||err),'bad');}finally{b.disabled=false;refreshWorkspace();}
  },true);
}

function injectStyle() {
  if(document.getElementById('v15CompatStyle'))return;
  const style=document.createElement('style'); style.id='v15CompatStyle';
  style.textContent=`.v15-compat-actions{margin-left:auto;display:flex;gap:7px;align-items:center;flex-wrap:wrap}.v15-compat-actions .btn{white-space:nowrap}.v15-bridge{width:min(260px,30vw);min-width:170px}.hero:before{content:'V15 NetworkCanonical · Full Feature Parity';display:inline-flex;margin-bottom:10px;padding:5px 10px;border:1px solid rgba(2,132,199,.28);border-radius:999px;background:rgba(2,132,199,.08);color:#0369a1;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.data-table td .endpoint{font-weight:800}.pill.info{border-color:rgba(2,132,199,.25)}@media(max-width:900px){.v15-bridge{width:100%;min-width:100%}.v15-compat-actions{width:100%;margin-left:0}}`;
  document.head.appendChild(style);
}

export function bootV15Compatibility() {
  if(installed)return; installed=true; injectStyle(); installProbeInterceptor();
  window.PROXYHARVEST_V15_COMPAT={build:BUILD,probeBatch,realVerifyBatch,exportSet,bridgeVerifyOne};
  const obs=new MutationObserver(()=>injectToolbar()); const target=document.getElementById('workspaceRoot')||document.body; obs.observe(target,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(()=>{const r=document.getElementById('workspaceRoot');if(r)delete r.dataset.v15Compat;injectToolbar();},50));
  setTimeout(injectToolbar,120);
}
