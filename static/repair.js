import { state, replaceConfig } from './core.js';
import { diagnose, generateCandidates, sanitizeForModel, applyCandidate } from './engine.js';
import { escapeHtml, toast } from './ui.js';

export async function aiHealth(){
  try {
    const r = await fetch('/api/ai/health', { cache:'no-store' });
    return await r.json();
  } catch(e) {
    return { ok:false, mode:'offline', loaded:false, error:String(e?.message || e) };
  }
}

export function brokenConfigs(){
  return state.configs
    .map((cfg,index)=>({cfg,index,issues:diagnose(cfg)}))
    .filter(x=>x.issues.length || x.cfg.live === false || x.cfg.tested === false);
}

function issuePill(issue){
  const tone = issue.severity === 'high' ? 'bad' : issue.severity === 'medium' ? 'warn' : 'info';
  return `<span class="pill ${tone}">${escapeHtml(issue.code)}</span>`;
}

function applyButtons(candidates){
  if (!candidates.length) return '<div class="empty"><strong>No safe rule candidate</strong>Manual repair is required; no credentials or keys will be invented.</div>';
  return candidates.map((c,i)=>`<div class="proposal"><h4>${escapeHtml(c.id)} <span class="pill info">${Number(c.confidence||0)}% rule</span></h4><p>${escapeHtml(c.reason||'Bounded repair candidate; verification required.')}</p><div class="candidate"><b>${escapeHtml(c.field)}</b> → ${escapeHtml(String(c.value ?? 'noop'))}</div><div style="margin-top:10px"><button class="btn small" data-apply-candidate="${i}">Apply candidate, reset verification</button></div></div>`).join('');
}

export function renderRepairLab(root){
  let selected = null;
  root.innerHTML = `
    <div class="hero">
      <div><h2>AI Healer / Repair Lab</h2><p>V15-compatible repair flow: local deterministic rules first, Hugging Face advisor through Vercel API second, real verification last.</p></div>
      <div class="status-stack"><div class="mini-stat"><strong id="repairIssueCount">0</strong><span>Queue</span></div><div class="mini-stat"><strong id="aiModeMini">…</strong><span>AI</span></div><div class="mini-stat"><strong>0</strong><span>Auto-pass</span></div></div>
    </div>
    <div class="grid repair-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>Problem queue</h2><p>Broken, unverified, failed or incomplete configs. The model receives sanitized metadata only.</p></div><div class="push"><button class="btn small" id="repairRefresh">Refresh</button></div></div>
        <div class="toolbar"><input class="field search" id="repairSearch" placeholder="Search host, source, protocol or issue…"><select class="field" id="repairSeverity"><option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="info">Info</option></select></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Protocol / endpoint</th><th>Issues</th><th>Verification</th><th>Actions</th></tr></thead><tbody id="repairRows"></tbody></table></div>
      </div>
      <div class="grid">
        <div class="panel engine-card">
          <div class="panel-head" style="padding:0 0 14px;border:0"><div><h2>Engine status</h2><p>Rules always run locally. HF model requires Vercel env HF_TOKEN/HUGGINGFACE_TOKEN.</p></div></div>
          <div class="engine-state"><div class="icon">R</div><div><strong>Deterministic Repair Engine</strong><span>Parser + safe candidate rules</span></div><span class="pill good right">READY</span></div>
          <div class="engine-state"><div class="icon">HF</div><div><strong>Qwen Advisor</strong><span id="aiHealthText">Checking /api/ai/health…</span></div><span class="pill right" id="aiHealthPill">CHECKING</span></div>
          <div class="notice warn">AI Healer never claims PASS. Applying a fix resets the config to unverified; use Test/Ping/Real Bridge after repair.</div>
        </div>
        <div class="panel"><div class="panel-head"><div><h2>Selected item</h2><p id="selectedRepairHint">Choose a row from the queue.</p></div></div><div id="repairInspector" class="empty"><strong>No item selected</strong>Select a config to inspect issues and repair candidates.</div></div>
      </div>
    </div>`;

  const rows = document.getElementById('repairRows');
  const renderRows = () => {
    const q = (document.getElementById('repairSearch').value || '').toLowerCase();
    const sev = document.getElementById('repairSeverity').value;
    const items = brokenConfigs().filter(x => {
      const hay = `${x.cfg.host} ${x.cfg.type} ${x.cfg.sourceName} ${x.issues.map(i=>i.code+' '+i.text).join(' ')}`.toLowerCase();
      return (!q || hay.includes(q)) && (sev === 'all' || x.issues.some(i=>i.severity === sev));
    });
    document.getElementById('repairIssueCount').textContent = items.length.toLocaleString();
    rows.innerHTML = items.length ? items.slice(0,800).map(x => `
      <tr><td>${x.index+1}</td><td><span class="pill violet">${escapeHtml(String(x.cfg.type||'cfg').toUpperCase())}</span> <span class="endpoint">${escapeHtml(x.cfg.host||'?')}:${escapeHtml(String(x.cfg.port||'?'))}</span><span class="subline">${escapeHtml(x.cfg.sourceName||'Unknown source')}</span></td><td>${(x.issues.length?x.issues:[{code:'unverified',severity:'info'}]).slice(0,4).map(issuePill).join(' ')}</td><td>${x.cfg.probe?.protocolVerified || x.cfg.probe?.tunnelVerified ? '<span class="pill good">Verified</span>' : x.cfg.live === true ? '<span class="pill warn">Reachable only</span>' : x.cfg.live === false ? '<span class="pill bad">Failed</span>' : '<span class="pill">Untested</span>'}</td><td><button class="btn small" data-inspect="${x.index}">Inspect</button></td></tr>`).join('') : `<tr><td colspan="5"><div class="empty"><strong>No matching queue items</strong>Harvest, test, or change filters.</div></td></tr>`;
    rows.querySelectorAll('[data-inspect]').forEach(b => b.onclick = () => select(Number(b.dataset.inspect)));
  };

  const select = (idx) => {
    const cfg = state.configs[idx];
    if (!cfg) return;
    const issues = diagnose(cfg);
    const candidates = generateCandidates(cfg, issues);
    selected = { idx, cfg, issues, candidates };
    document.getElementById('selectedRepairHint').textContent = `${String(cfg.type||'cfg').toUpperCase()} · ${cfg.host}:${cfg.port}`;
    document.getElementById('repairInspector').innerHTML = `<div style="padding:16px"><div class="detail-grid"><div class="detail-card"><label>Source</label><b>${escapeHtml(cfg.sourceName||'Unknown')}</b></div><div class="detail-card"><label>Evidence</label><b>${escapeHtml(cfg.probe?.method||'none')}</b></div><div class="detail-card"><label>Status</label><b>${cfg.live===true?'Reachable':cfg.live===false?'Failed':'Untested'}</b></div></div><h3 style="margin:18px 0 9px">Detected issues</h3>${issues.map(i=>`<div class="notice ${i.severity==='high'?'warn':''}" style="margin-bottom:8px"><b>${escapeHtml(i.code)}</b> — ${escapeHtml(i.text)}</div>`).join('') || '<div class="notice info">No deterministic structural issue; verification may still be required.</div>'}<h3 style="margin:18px 0 9px">Rule candidates</h3><div id="candidateList">${applyButtons(candidates)}</div><button class="btn primary" id="askModel" ${candidates.length?'':'disabled'}>Ask AI Healer</button><div id="modelResult" style="margin-top:12px"></div></div>`;
    document.querySelectorAll('[data-apply-candidate]').forEach(b => b.onclick = async () => {
      const cand = candidates[Number(b.dataset.applyCandidate)];
      await replaceConfig(cfg.id, applyCandidate(cfg, cand));
      toast('Candidate applied. Verification reset; run Test/Ping again.', 'good');
      renderRows(); select(idx);
    });
    const ask = document.getElementById('askModel');
    if (ask) ask.onclick = () => askAdvisor(selected);
  };

  document.getElementById('repairSearch').oninput = renderRows;
  document.getElementById('repairSeverity').onchange = renderRows;
  document.getElementById('repairRefresh').onclick = renderRows;
  renderRows();

  aiHealth().then(h => {
    const ok = h.ok === true;
    document.getElementById('aiModeMini').textContent = h.loaded ? 'HF' : 'RULE';
    const pill = document.getElementById('aiHealthPill');
    pill.textContent = h.loaded ? 'MODEL READY' : ok ? 'RULES ONLY' : 'OFFLINE';
    pill.className = `pill right ${h.loaded ? 'good' : 'warn'}`;
    document.getElementById('aiHealthText').textContent = ok ? `${h.model || 'advisor'} · ${h.mode || 'rules'} · ${h.note || ''}` : (h.error || 'AI endpoint unavailable');
  });
}

async function askAdvisor(sel){
  const out = document.getElementById('modelResult');
  const btn = document.getElementById('askModel');
  btn.disabled = true;
  btn.textContent = 'AI reviewing…';
  out.innerHTML = '<div class="notice">Sending sanitized metadata and candidate IDs to /api/ai/advise. Raw URI and keys stay local.</div>';
  try {
    const item = sanitizeForModel(sel.cfg, sel.issues, sel.candidates);
    const r = await fetch('/api/ai/advise', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ items:[{ index:sel.idx, ...item }] }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.ok !== true) throw new Error(data?.error || `AI endpoint HTTP ${r.status}`);
    const ans = data.items?.[0] || {};
    out.innerHTML = `<div class="proposal"><h4>AI decision <span class="pill info">${escapeHtml(ans.decision || 'manual_review')}</span></h4><p>${escapeHtml(ans.reason || 'No reason returned')}</p><div class="candidate">Selected candidate IDs: <b>${escapeHtml((ans.candidate_ids || []).join(', ') || 'none')}</b> · confidence ${Number(ans.confidence || 0)}%</div><div class="subline">Mode: ${escapeHtml(data.mode || 'unknown')} · Model: ${escapeHtml(data.model || 'rules')} · ${Number(data.latency_ms || 0)} ms</div>${data.warning ? `<div class="notice warn" style="margin-top:10px">${escapeHtml(data.warning)}</div>` : ''}</div>`;
  } catch(e) {
    out.innerHTML = `<div class="notice warn"><b>AI endpoint unavailable:</b> ${escapeHtml(String(e?.message || e))}<br>Deterministic Repair Engine remains available.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ask AI Healer';
  }
}
