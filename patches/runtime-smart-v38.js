(() => {
  'use strict';
  const BUILD = '38.0.0-smart-runtime';
  const WORKER = 'https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev';
  const BRIDGES = ['http://127.0.0.1:8787','http://localhost:8787'];
  const BEST_SCORE = 70;
  const BEST_LATENCY = 1800;
  const $ = (s,r=document) => r.querySelector(s);
  const $$ = (s,r=document) => [...r.querySelectorAll(s)];
  const getStore = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const setStore = (k,v) => { try { localStorage.setItem(k,String(v)); return true; } catch { return false; } };
  const delStore = (k) => { try { localStorage.removeItem(k); } catch {} };
  const verified = (c) => !!(c?.probe?.tunnelVerified === true || c?.probe?.protocolVerified === true);
  const reachable = (c) => !verified(c) && !!(c?.probe?.bridgeReachable === true || c?.probe?.workerReachable === true || c?.probe?.browserReachable === true || c?.reachable === true);
  const failed = (c) => !verified(c) && !reachable(c) && (c?.live === false || c?.probe?.protocolVerified === false || c?.probe?.tunnelVerified === false);
  const score = (c) => Number(c?.score || 0);
  const latency = (c) => Number(c?.probe?.latencyMs ?? c?.latency ?? 999999);
  const fresh = (c) => {
    const ts = Number(c?.probe?.testedAt || c?.testedAt || 0);
    return ts > 0 && Date.now() - ts < 24 * 60 * 60 * 1000;
  };
  function toast(msg, type='info') { try { window.toast?.(msg,type); } catch {} }
  function setValue(id,value){ const el=document.getElementById(id); if(!el) return; if(el.type==='checkbox') el.checked=!!value; else el.value=value ?? ''; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }

  function sanitizeTokenFields(){
    for (const id of ['cfg-worker-subtoken','cfg-worker-apitoken']) {
      const el = document.getElementById(id); if (!el) continue;
      el.type = 'password'; el.autocomplete = 'off';
      if (/^hf_/i.test(el.value || '')) {
        el.value = '';
        el.placeholder = 'Worker-only token (not HF_TOKEN)';
        el.title = 'Hugging Face tokens belong in Vercel Environment Variables as HF_TOKEN, not in this browser field.';
      }
    }
  }

  function applySmartInfrastructureDefaults(){
    if (!getStore('cfg_worker_url')) setStore('cfg_worker_url', WORKER);
    if (!getStore('cfg_custom_cors')) setStore('cfg_custom_cors', `${WORKER}/?url=`);
    if (!getStore('ph_best_score_floor')) setStore('ph_best_score_floor', BEST_SCORE);
    const clean = getStore('cfg_clean_ip');
    if (clean && !/^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9a-f:]+$/i.test(clean)) delStore('cfg_clean_ip');
    if (!getStore('cfg_clean_port')) setStore('cfg_clean_port', '443');
    if (!getStore('cfg_force_worker')) setStore('cfg_force_worker','false');
    if (!getStore('cfg_use_clean_ip')) setStore('cfg_use_clean_ip','false');
    if (!getStore('cfg_doh_via_worker')) setStore('cfg_doh_via_worker','false');
    const reality = getStore('cfg_reality_key');
    if (reality === 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=') delStore('cfg_reality_key');
  }

  async function fetchJson(url, opts={}){
    const ctrl = new AbortController(); const tid = setTimeout(()=>ctrl.abort(), opts.timeout || 4500);
    try { const r = await fetch(url,{cache:'no-store',signal:ctrl.signal,...opts}); const j=await r.json().catch(()=>({})); return {ok:r.ok,status:r.status,data:j}; }
    catch(e){ return {ok:false,status:0,data:{error:String(e?.message||e)}}; } finally { clearTimeout(tid); }
  }

  async function detectBridgeSmart({quiet=false}={}){
    for (const base of BRIDGES) {
      const r = await fetchJson(`${base}/health`,{timeout:1800});
      if (r.ok && r.data?.ok !== false) {
        setStore('ph_real_ping_bridge', base);
        setStore('ph_strict_real_ping','true');
        setValue('localBridgeUrl',base); setValue('cfg-strictRealPing',true);
        if (!quiet) toast(r.data?.verifier ? 'Real verifier bridge ready' : 'Transport bridge ready', 'ok');
        return {base,...r.data};
      }
    }
    delStore('ph_real_ping_bridge');
    setStore('ph_strict_real_ping','false');
    setValue('cfg-strictRealPing',false);
    if (!quiet) toast('Real verifier bridge is not running. Reachability can still be ranked, but VERIFIED stays truthful.', 'warn');
    return null;
  }

  async function runtimeAudit({deepAI=false,quiet=false}={}){
    const [worker,bridge,ai] = await Promise.all([
      fetchJson(`${WORKER}/health`,{timeout:4500}),
      detectBridgeSmart({quiet:true}),
      fetchJson(`/api/ai/health${deepAI?'?deep=1':''}`,{timeout:12000})
    ]);
    const result = {
      worker: worker.ok && worker.data?.ok !== false,
      workerDetail: worker.data || {},
      bridge: !!bridge,
      bridgeVerifier: !!bridge?.verifier,
      bridgeDetail: bridge || {},
      aiConfigured: !!ai.data?.configured,
      aiLoaded: !!ai.data?.loaded,
      aiMode: ai.data?.mode || 'offline',
      aiModel: ai.data?.model || '',
      checkedAt: Date.now()
    };
    renderRuntimeAudit(result);
    if (!quiet) toast(`Runtime: Worker ${result.worker?'OK':'FAIL'} · Bridge ${result.bridgeVerifier?'VERIFIER':result.bridge?'TRANSPORT':'OFF'} · AI ${result.aiLoaded?'READY':result.aiConfigured?'CONFIGURED':'RULES'}`, result.worker?'ok':'warn');
    return result;
  }

  function renderRuntimeAudit(s){
    for (const tabId of ['tab-settings','tab-infrastructure']) {
      const tab=document.getElementById(tabId); if(!tab) continue;
      let strip=tab.querySelector('.ph38-runtime-strip');
      if(!strip){ strip=document.createElement('div'); strip.className='ph38-runtime-strip'; tab.prepend(strip); }
      strip.innerHTML = `
        <div><span>WORKER</span><b class="${s.worker?'ok':'bad'}">${s.worker?'Online':'Offline'}</b><small>${WORKER.replace(/^https?:\/\//,'')}</small></div>
        <div><span>REAL BRIDGE</span><b class="${s.bridgeVerifier?'ok':s.bridge?'warn':'bad'}">${s.bridgeVerifier?'Verifier ready':s.bridge?'Transport only':'Not running'}</b><small>${s.bridgeDetail?.base || 'npm run bridge'}</small></div>
        <div><span>HF ADVISOR</span><b class="${s.aiLoaded?'ok':s.aiConfigured?'warn':''}">${s.aiLoaded?'Model ready':s.aiConfigured?'Configured':'Rules only'}</b><small>${s.aiModel || 'Set HF_TOKEN in Vercel'}</small></div>
        <div><span>BEST EXPORT</span><b>Score ≥ ${BEST_SCORE}</b><small>verified first · latency-aware</small></div>`;
    }
  }

  function exportUri(c){
    try { if (typeof window.getExportUri === 'function') return window.getExportUri(c,{allowSensitive:false}) || ''; } catch {}
    return typeof c?.raw === 'string' && !/REDACTED|\*\*\*/i.test(c.raw) ? c.raw : '';
  }
  function rank(list){ return [...list].sort((a,b)=>Number(verified(b))-Number(verified(a)) || score(b)-score(a) || latency(a)-latency(b)); }
  function bestVerified(limit=100){ return rank((window.S?.configs||[]).filter(c=>verified(c)&&score(c)>=BEST_SCORE&&fresh(c)&&exportUri(c))).slice(0,limit); }
  function bestReachable(limit=100){ return rank((window.S?.configs||[]).filter(c=>reachable(c)&&!failed(c)&&score(c)>=BEST_SCORE&&latency(c)<=BEST_LATENCY&&fresh(c)&&exportUri(c))).slice(0,limit); }
  function download(name,list){
    const text=list.map(exportUri).filter(Boolean).join('\n');
    if(!text){ toast('No eligible configs for this export','warn'); return 0; }
    const blob=new Blob([text+'\n'],{type:'text/plain;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); toast(`${list.length} configs exported`,'ok'); return list.length;
  }
  function installBestExports(){
    const tab=document.getElementById('tab-configs'); if(!tab || tab.querySelector('#ph38BestCandidates')) return;
    const anchor=tab.querySelector('.cfgs-action-bar') || tab.querySelector('.phv26-subnav'); if(!anchor) return;
    const box=document.createElement('div'); box.id='ph38BestCandidates'; box.className='ph38-best-actions';
    box.innerHTML='<button data-kind="verified">BEST VERIFIED</button><button data-kind="reachable">BEST REACHABLE</button><span>Reachable is a candidate set, not tunnel verification.</span>';
    box.addEventListener('click',e=>{const b=e.target.closest('button[data-kind]'); if(!b)return; if(b.dataset.kind==='verified') download('proxyharvest-best-verified.txt',bestVerified()); else download('proxyharvest-best-reachable-candidates.txt',bestReachable());});
    anchor.appendChild(box);
  }

  function fixInfrastructureFields(){
    const worker=document.getElementById('cfg-worker-url'); if(worker && !worker.value) worker.value=WORKER;
    const clean=document.getElementById('cfg-clean-ip'); if(clean){ clean.placeholder='Optional public IP — leave blank unless measured'; if(clean.value && !/^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9a-f:]+$/i.test(clean.value)) clean.value=''; }
    const reality=document.getElementById('cfg-reality-pubkey'); if(reality){ reality.placeholder='Per-config Reality public key — do not use a global default'; if(reality.value==='bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=') reality.value=''; }
    const sni=document.getElementById('cfg-custom-sni'); if(sni) sni.placeholder='Optional — only when the source/server specifies an SNI';
    setValue('cfg-force-worker',false); setValue('cfg-use-clean-ip',false); setValue('cfg-doh-via-worker',false);
    sanitizeTokenFields();
  }

  function installSmartButtons(){
    const infra=document.getElementById('tab-infrastructure'); if(infra && !infra.querySelector('#ph38SmartInfra')){
      const btn=document.createElement('button'); btn.id='ph38SmartInfra'; btn.className='ph38-smart-btn'; btn.textContent='SMART DEFAULTS + HEALTH CHECK';
      btn.onclick=async()=>{applySmartInfrastructureDefaults(); fixInfrastructureFields(); await runtimeAudit({deepAI:true});};
      infra.prepend(btn);
    }
    const settings=document.getElementById('tab-settings'); if(settings && !settings.querySelector('#ph38BridgeCmd')){
      const note=document.createElement('div'); note.id='ph38BridgeCmd'; note.className='ph38-bridge-note'; note.innerHTML='<b>Real verification:</b> run <code>npm run bridge</code> on the device that has network access. The app auto-detects <code>127.0.0.1:8787</code>. Without this verifier, endpoint reachability is never mislabeled as VERIFIED.';
      settings.prepend(note);
    }
  }

  function syncCounts(){
    const arr=window.S?.configs||[]; const c={v:0,r:0,u:0,f:0};
    for(const x of arr){ if(verified(x))c.v++; else if(reachable(x))c.r++; else if(failed(x))c.f++; else c.u++; }
    const set=(id,n)=>{const el=document.getElementById(id); if(el)el.textContent=String(n)};
    set('phMetricVerified',c.v); set('phMetricReachable',c.r); set('phMetricUntested',c.u); set('phMetricFailed',c.f);
  }

  function boot(){
    applySmartInfrastructureDefaults(); sanitizeTokenFields(); fixInfrastructureFields(); installBestExports(); installSmartButtons(); syncCounts(); runtimeAudit({quiet:true});
    const mo=new MutationObserver(()=>{sanitizeTokenFields(); installBestExports(); installSmartButtons(); syncCounts();});
    mo.observe(document.documentElement,{subtree:true,childList:true});
    setInterval(syncCounts,2500);
    window.PROXYHARVEST_V38 = Object.freeze({BUILD,runtimeAudit,detectBridgeSmart,bestVerified,bestReachable,applySmartInfrastructureDefaults});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
