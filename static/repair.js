import { state, replaceConfig } from './core.js';
import { diagnose, generateCandidates, sanitizeForModel, applyCandidate } from './engine.js';
import { escapeHtml, toast } from './ui.js';

export async function aiHealth(){
  try{const r=await fetch('/api/ai/health',{cache:'no-store'});return await r.json();}catch(e){return {ok:false,mode:'rules-only',error:String(e?.message||e)};}
}

export function brokenConfigs(){
  return state.configs.map((cfg,index)=>({cfg,index,issues:diagnose(cfg)})).filter(x=>x.issues.length);
}

export function renderRepairLab(root){
  const broken=brokenConfigs();
  root.innerHTML=`
  <div class="hero">
    <div><h2>Repair Lab</h2><p>Deterministic rules create safe candidate fixes first. The Hugging Face model only reviews those candidates; it never invents credentials or marks a tunnel as verified.</p></div>
    <div class="status-stack"><div class="mini-stat"><strong>${broken.length}</strong><span>Issues</span></div><div class="mini-stat"><strong id="aiModeMini">…</strong><span>Model</span></div><div class="mini-stat"><strong>0</strong><span>Auto-applied</span></div></div>
  </div>
  <div class="grid repair-layout">
    <div class="panel">
      <div class="panel-head"><div><h2>Problem queue</h2><p>Choose an item to inspect evidence and candidate fixes.</p></div><div class="push"><button class="btn small" id="repairRefresh">Refresh</button></div></div>
      <div class="toolbar"><input class="field search" id="repairSearch" placeholder="Search host or issue…"><select class="field" id="repairSeverity"><option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="info">Info</option></select></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Protocol / endpoint</th><th>Issues</th><th>Verification</th><th>Actions</th></tr></thead><tbody id="repairRows"></tbody></table></div>
    </div>
    <div class="grid">
      <div class="panel engine-card"><div class="panel-head" style="padding:0 0 14px;border:0"><div><h2>Engine status</h2><p>What is actually running right now.</p></div></div>
        <div class="engine-state"><div class="icon">R</div><div><strong>Deterministic Repair Engine</strong><span>Local parser + explicit repair rules · always available</span></div><span class="pill good right">READY</span></div>
        <div class="engine-state"><div class="icon">HF</div><div><strong>Qwen2.5-Coder-0.5B Advisor</strong><span id="aiHealthText">Checking Hugging Face backend…</span></div><span class="pill right" id="aiHealthPill">CHECKING</span></div>
        <div class="notice warn">Model output is advisory only. Every applied candidate is reset to <b>unverified</b> and must pass Real Test before it can be considered live.</div>
      </div>
      <div class="panel"><div class="panel-head"><div><h2>Selected item</h2><p id="selectedRepairHint">Choose a row from the queue.</p></div></div><div id="repairInspector" class="empty"><strong>No item selected</strong>Select a problematic config to inspect rule candidates and ask the model.</div></div>
    </div>
  </div>`;

  let selected=null;
  const rows=document.getElementById('repairRows');
  const renderRows=()=>{
    const q=(document.getElementById('repairSearch').value||'').toLowerCase(); const sev=document.getElementById('repairSeverity').value;
    const items=brokenConfigs().filter(x=>(!q||`${x.cfg.host} ${x.cfg.type} ${x.issues.map(i=>i.text).join(' ')}`.toLowerCase().includes(q))&&(sev==='all'||x.issues.some(i=>i.severity===sev)));
    rows.innerHTML=items.length?items.map(x=>`<tr data-ridx="${x.index}"><td>${x.index+1}</td><td><span class="pill violet">${escapeHtml(x.cfg.type)}</span> <span class="endpoint">${escapeHtml(x.cfg.host)}:${x.cfg.port}</span><span class="subline">${escapeHtml(x.cfg.sourceName||'Unknown source')}</span></td><td>${x.issues.slice(0,3).map(i=>`<span class="pill ${i.severity==='high'?'bad':i.severity==='medium'?'warn':'info'}">${escapeHtml(i.code)}</span>`).join(' ')}</td><td>${x.cfg.probe?.protocolVerified||x.cfg.probe?.tunnelVerified?'<span class="pill good">Verified</span>':'<span class="pill warn">Needs verification</span>'}</td><td><button class="btn small" data-inspect="${x.index}">Inspect</button></td></tr>`).join(''):`<tr><td colspan="5"><div class="empty"><strong>No matching issues</strong>Try a different filter.</div></td></tr>`;
    rows.querySelectorAll('[data-inspect]').forEach(b=>b.onclick=()=>select(Number(b.dataset.inspect)));
  };
  const select=(idx)=>{
    const cfg=state.configs[idx]; if(!cfg)return; const issues=diagnose(cfg), candidates=generateCandidates(cfg,issues); selected={idx,cfg,issues,candidates};
    document.getElementById('selectedRepairHint').textContent=`${cfg.type.toUpperCase()} · ${cfg.host}:${cfg.port}`;
    document.getElementById('repairInspector').innerHTML=`<div style="padding:16px"><div class="detail-grid"><div class="detail-card"><label>Source</label><b>${escapeHtml(cfg.sourceName||'Unknown')}</b></div><div class="detail-card"><label>Evidence</label><b>${escapeHtml(cfg.probe?.method||'none')}</b></div></div><h3 style="margin:18px 0 9px">Detected issues</h3>${issues.map(i=>`<div class="notice ${i.severity==='high'?'warn':''}" style="margin-bottom:8px"><b>${escapeHtml(i.code)}</b> — ${escapeHtml(i.text)}</div>`).join('')||'<div class="notice good">No deterministic issue detected.</div>'}<h3 style="margin:18px 0 9px">Rule candidates</h3><div id="candidateList">${candidates.length?candidates.map((c,i)=>`<div class="proposal"><h4>${escapeHtml(c.id)} <span class="pill">${c.confidence}% rule confidence</span></h4><p>${escapeHtml(c.reason)}</p><div class="candidate"><b>${escapeHtml(c.field)}</b> → ${escapeHtml(c.value)}</div><div style="margin-top:10px"><button class="btn small" data-apply-candidate="${i}">Apply candidate</button></div></div>`).join(''):'<div class="empty"><strong>No safe automatic candidates</strong>Manual review is safer for this item.</div>'}</div><button class="btn primary" id="askModel" ${candidates.length?'':'disabled'}>Ask Hugging Face model to review candidates</button><div id="modelResult" style="margin-top:12px"></div></div>`;
    document.querySelectorAll('[data-apply-candidate]').forEach(b=>b.onclick=async()=>{const cand=candidates[Number(b.dataset.applyCandidate)];await replaceConfig(cfg.id,applyCandidate(cfg,cand));toast('Candidate applied. Verification status reset to unverified.','good');renderRows();select(idx);});
    const ask=document.getElementById('askModel'); if(ask) ask.onclick=()=>askAdvisor(selected);
  };
  document.getElementById('repairSearch').oninput=renderRows; document.getElementById('repairSeverity').onchange=renderRows; document.getElementById('repairRefresh').onclick=renderRows; renderRows();
  aiHealth().then(h=>{document.getElementById('aiModeMini').textContent=h.ok?'ON':'RULE';const pill=document.getElementById('aiHealthPill');pill.textContent=h.ok?(h.loaded?'READY':'LAZY'):'OFFLINE';pill.className=`pill right ${h.ok?'good':'warn'}`;document.getElementById('aiHealthText').textContent=h.ok?`${h.model} · Hugging Face ZeroGPU · ${h.loaded?'model loaded':'model unavailable until Space runtime starts'}`:(h.error||'Backend unavailable; rules continue to work');});
}

async function askAdvisor(sel){
  const out=document.getElementById('modelResult'); const btn=document.getElementById('askModel'); btn.disabled=true; btn.textContent='Model reviewing…'; out.innerHTML='<div class="notice">Sending only sanitized evidence and candidate IDs. No raw URI, UUID, password or WireGuard private key is sent.</div>';
  try{
    const item=sanitizeForModel(sel.cfg,sel.issues,sel.candidates);
    const data=await callZeroGpuAdvisor({items:[{index:sel.idx,...item}]}); if(!data?.ok)throw new Error(data?.error||'ZeroGPU model call failed');
    const ans=data.items?.[0]; out.innerHTML=`<div class="proposal"><h4>Model decision <span class="pill info">${escapeHtml(ans?.decision||'manual_review')}</span></h4><p>${escapeHtml(ans?.reason||'No reason returned')}</p><div class="candidate">Selected candidate IDs: <b>${escapeHtml((ans?.candidate_ids||[]).join(', ')||'none')}</b> · confidence ${Number(ans?.confidence||0)}%</div><div class="subline">Model: ${escapeHtml(data.model)} · ZeroGPU · ${Number(data.latency_ms||0)} ms</div></div>`;
  }catch(e){out.innerHTML=`<div class="notice warn"><b>Model unavailable:</b> ${escapeHtml(String(e?.message||e))}<br>Deterministic Repair Engine remains available.</div>`;}
  finally{btn.disabled=false;btn.textContent='Ask Hugging Face model to review candidates';}
}


async function callZeroGpuAdvisor(payload){
  const submit=await fetch('/gradio/gradio_api/call/advise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:[JSON.stringify(payload)]})});
  const first=await submit.json().catch(()=>({}));
  if(!submit.ok||!first.event_id) throw new Error(first?.detail||first?.error||`Gradio submit HTTP ${submit.status}`);
  const stream=await fetch(`/gradio/gradio_api/call/advise/${encodeURIComponent(first.event_id)}`);
  if(!stream.ok) throw new Error(`Gradio result HTTP ${stream.status}`);
  const text=await stream.text();
  let result=null;
  for(const line of text.split(/\r?\n/)){
    if(!line.startsWith('data:')) continue;
    try{
      const parsed=JSON.parse(line.slice(5).trim());
      if(Array.isArray(parsed)&&parsed.length) result=parsed[0];
    }catch{}
  }
  if(result==null) throw new Error('ZeroGPU result stream did not contain model output');
  if(typeof result==='string') return JSON.parse(result);
  return result;
}
