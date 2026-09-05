(() => {
  'use strict';
  const BUILD = '38.1.0-smart-runtime';
  const WORKER = 'https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev';
  const BRIDGES = ['http://127.0.0.1:8787','http://localhost:8787'];
  const BEST_SCORE = 70;
  const BEST_LATENCY = 1800;
  const MIGRATION_KEY = 'ph_v38_safe_defaults_381';
  const getStore = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const setStore = (k,v) => { try { localStorage.setItem(k,String(v)); return true; } catch { return false; } };
  const delStore = (k) => { try { localStorage.removeItem(k); } catch {} };
  const verified = (c) => !!(c?.probe?.tunnelVerified === true || c?.probe?.protocolVerified === true);
  const reachable = (c) => !verified(c) && !!(c?.probe?.bridgeReachable === true || c?.probe?.workerReachable === true || c?.probe?.browserReachable === true || c?.reachable === true);
  const failed = (c) => !verified(c) && !reachable(c) && (c?.live === false || c?.probe?.protocolVerified === false || c?.probe?.tunnelVerified === false);
  const score = (c) => Number(c?.score || 0);
  const latency = (c) => Number(c?.probe?.latencyMs ?? c?.latency ?? 999999);
  const fresh = (c) => { const ts=Number(c?.probe?.testedAt||c?.testedAt||0); return ts>0 && Date.now()-ts<86400000; };
  function toast(msg,type='info'){ try { window.toast?.(msg,type); } catch {} }
  function setValue(id,value){ const el=document.getElementById(id); if(!el)return; if(el.type==='checkbox')el.checked=!!value; else el.value=value??''; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
  function parseJson(raw,fallback={}){try{return JSON.parse(raw||'')||fallback}catch{return fallback}}

  function sanitizeTokenFields(){
    for(const id of ['cfg-worker-subtoken','cfg-worker-apitoken']){
      const el=document.getElementById(id); if(!el)continue; el.type='password'; el.autocomplete='off';
      if(/^hf_/i.test(el.value||'')){ el.value=''; el.placeholder='Worker-only token (not HF_TOKEN)'; el.title='Set Hugging Face credentials in Vercel Environment Variables as HF_TOKEN.'; }
    }
  }

  function migrateAppSettings(){
    if(getStore(MIGRATION_KEY)==='1') return;
    const s=parseJson(getStore('ph-settings-v8'),{});
    s['cfg-scoreThreshold']='70';
    s['cfg-strictRealPing']=false;
    if(!('cfg-dedup' in s)) s['cfg-dedup']=true;
    if(!('cfg-dohEnabled' in s)) s['cfg-dohEnabled']=true;
    if(!('cfg-timeout' in s) || Number(s['cfg-timeout'])<8) s['cfg-timeout']='10';
    setStore('ph-settings-v8',JSON.stringify(s));
    setStore('ph_strict_real_ping','false');
    setStore('ph_best_score_floor',BEST_SCORE);
    setStore('cfg_worker_url',WORKER);
    setStore('cfg_custom_cors',`${WORKER}/?url=`);
    setStore('cfg_clean_port','443');
    setStore('cfg_force_worker','false');
    setStore('cfg_use_clean_ip','false');
    setStore('cfg_doh_via_worker','false');
    const clean=getStore('cfg_clean_ip');
    if(!clean || clean==='162.159.192.203' || !/^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9a-f:]+$/i.test(clean)) delStore('cfg_clean_ip');
    const reality=getStore('cfg_reality_key'); if(reality) delStore('cfg_reality_key');
    const sni=(getStore('cfg_custom_sni')||'').toLowerCase(); if(!sni || sni.includes('workers.dev') || sni==='cloudflare.com' || sni==='www.cloudflare.com') delStore('cfg_custom_sni');
    setStore(MIGRATION_KEY,'1');
  }

  function applySmartInfrastructureDefaults(){
    migrateAppSettings();
    setStore('cfg_worker_url',WORKER);
    setStore('cfg_custom_cors',`${WORKER}/?url=`);
    setStore('cfg_clean_port','443');
    setStore('cfg_force_worker','false'); setStore('cfg_use_clean_ip','false'); setStore('cfg_doh_via_worker','false');
    const s=parseJson(getStore('ph-settings-v8'),{}); s['cfg-scoreThreshold']='70'; setStore('ph-settings-v8',JSON.stringify(s));
  }

  async function fetchJson(url,opts={}){const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),opts.timeout||4500);try{const r=await fetch(url,{cache:'no-store',signal:ctrl.signal,...opts});const j=await r.json().catch(()=>({}));return{ok:r.ok,status:r.status,data:j}}catch(e){return{ok:false,status:0,data:{error:String(e?.message||e)}}}finally{clearTimeout(tid)}}
  async function detectBridgeSmart({quiet=false}={}){
    for(const base of BRIDGES){const r=await fetchJson(`${base}/health`,{timeout:1800});if(r.ok&&r.data?.ok!==false){setStore('ph_real_ping_bridge',base);setStore('ph_strict_real_ping','true');setValue('localBridgeUrl',base);setValue('cfg-strictRealPing',true);if(!quiet)toast(r.data?.verifier?'Real verifier bridge ready':'Transport bridge ready','ok');return{base,...r.data}}}
    delStore('ph_real_ping_bridge');setStore('ph_strict_real_ping','false');setValue('cfg-strictRealPing',false);if(!quiet)toast('Real verifier bridge is not running. Reachability stays separate from VERIFIED.','warn');return null;
  }
  async function runtimeAudit({deepAI=false,quiet=false}={}){
    const [worker,bridge,ai]=await Promise.all([fetchJson(`${WORKER}/health`,{timeout:4500}),detectBridgeSmart({quiet:true}),fetchJson(`/api/ai/health${deepAI?'?deep=1':''}`,{timeout:12000})]);
    const result={worker:worker.ok&&worker.data?.ok!==false,workerDetail:worker.data||{},bridge:!!bridge,bridgeVerifier:!!bridge?.verifier,bridgeDetail:bridge||{},aiConfigured:!!ai.data?.configured,aiLoaded:!!ai.data?.loaded,aiMode:ai.data?.mode||'offline',aiModel:ai.data?.model||'',checkedAt:Date.now()};
    renderRuntimeAudit(result);if(!quiet)toast(`Runtime: Worker ${result.worker?'OK':'FAIL'} · Bridge ${result.bridgeVerifier?'VERIFIER':result.bridge?'TRANSPORT':'OFF'} · AI ${result.aiLoaded?'READY':result.aiConfigured?'CONFIGURED':'RULES'}`,result.worker?'ok':'warn');return result;
  }
  function renderRuntimeAudit(s){for(const tabId of ['tab-settings','tab-infrastructure']){const tab=document.getElementById(tabId);if(!tab)continue;let strip=tab.querySelector('.ph38-runtime-strip');if(!strip){strip=document.createElement('div');strip.className='ph38-runtime-strip';tab.prepend(strip)}strip.innerHTML=`<div><span>WORKER</span><b class="${s.worker?'ok':'bad'}">${s.worker?'Online':'Offline'}</b><small>${WORKER.replace(/^https?:\/\//,'')}</small></div><div><span>REAL BRIDGE</span><b class="${s.bridgeVerifier?'ok':s.bridge?'warn':'bad'}">${s.bridgeVerifier?'Verifier ready':s.bridge?'Transport only':'Not running'}</b><small>${s.bridgeDetail?.base||'npm run bridge'}</small></div><div><span>HF ADVISOR</span><b class="${s.aiLoaded?'ok':s.aiConfigured?'warn':''}">${s.aiLoaded?'Model ready':s.aiConfigured?'Configured':'Rules only'}</b><small>${s.aiModel||'Set HF_TOKEN in Vercel'}</small></div><div><span>BEST EXPORT</span><b>Score ≥ ${BEST_SCORE}</b><small>verified first · latency-aware</small></div>`}}

  function exportUri(c){try{if(typeof window.getExportUri==='function')return window.getExportUri(c,{allowSensitive:false})||''}catch{}return typeof c?.raw==='string'&&!/REDACTED|\*\*\*/i.test(c.raw)?c.raw:''}
  function rank(list){return[...list].sort((a,b)=>Number(verified(b))-Number(verified(a))||score(b)-score(a)||latency(a)-latency(b))}
  function bestFrom(list,limit=100){return rank((list||[]).filter(c=>verified(c)&&score(c)>=BEST_SCORE&&fresh(c)&&exportUri(c))).slice(0,limit)}
  function bestVerified(limit=100){return bestFrom(window.S?.configs||[],limit)}
  function bestReachable(limit=100){return rank((window.S?.configs||[]).filter(c=>reachable(c)&&!failed(c)&&score(c)>=BEST_SCORE&&latency(c)<=BEST_LATENCY&&fresh(c)&&exportUri(c))).slice(0,limit)}
  function bestSplitVerified(limit=100){return bestFrom(window.S?.splitnetConfigs||[],limit)}
  function download(name,list){const text=list.map(exportUri).filter(Boolean).join('\n');if(!text){toast('No eligible configs for this export','warn');return 0}const blob=new Blob([text+'\n'],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500);toast(`${list.length} configs exported`,'ok');return list.length}
  function installBestExports(){
    const tab=document.getElementById('tab-configs');if(tab&&!tab.querySelector('#ph38BestCandidates')){const anchor=tab.querySelector('.cfgs-action-bar')||tab.querySelector('.phv26-subnav');if(anchor){const box=document.createElement('div');box.id='ph38BestCandidates';box.className='ph38-best-actions';box.innerHTML='<button data-kind="verified">BEST VERIFIED</button><button data-kind="reachable">BEST REACHABLE</button><span>Reachable = candidate only.</span>';box.addEventListener('click',e=>{const b=e.target.closest('button[data-kind]');if(!b)return;b.dataset.kind==='verified'?download('proxyharvest-best-verified.txt',bestVerified()):download('proxyharvest-best-reachable-candidates.txt',bestReachable())});anchor.appendChild(box)}}
    const split=document.getElementById('tab-splitnet');if(split&&!split.querySelector('#ph38SplitVerified')){const bar=split.querySelector('.splitnet-bar')?.nextElementSibling||split.querySelector('.splitnet-bar');if(bar){const btn=document.createElement('button');btn.id='ph38SplitVerified';btn.className='btn btn-green';btn.textContent='VERIFIED .TXT';btn.title='Exports only fresh SplitNet configs with protocol/tunnel verification evidence.';btn.onclick=()=>{const rows=bestSplitVerified();if(!rows.length)return toast('No verified SplitNet configs yet — run the Real Bridge verifier first.','warn');download('proxyharvest-splitnet-verified.txt',rows)};bar.appendChild(btn)}}
  }

  function fixInfrastructureFields(){
    const worker=document.getElementById('cfg-worker-url');if(worker)worker.value=WORKER;
    const clean=document.getElementById('cfg-clean-ip');if(clean){clean.placeholder='Optional measured public IP — blank by default';if(clean.value==='162.159.192.203'||(clean.value&&!/^\d{1,3}(?:\.\d{1,3}){3}$|^[0-9a-f:]+$/i.test(clean.value)))clean.value=''}
    const reality=document.getElementById('cfg-reality-pubkey');if(reality){reality.placeholder='Per-config Reality public key — never a global default';reality.value=''}
    const sni=document.getElementById('cfg-custom-sni');if(sni){sni.placeholder='Optional — only when the source/server specifies SNI';if((sni.value||'').includes('workers.dev'))sni.value=''}
    setValue('cfg-force-worker',false);setValue('cfg-use-clean-ip',false);setValue('cfg-doh-via-worker',false);setValue('cfg-scoreThreshold',70);setValue('cfg-scoreThresholdSettings',70);sanitizeTokenFields();
  }
  function installSmartButtons(){const infra=document.getElementById('tab-infrastructure');if(infra&&!infra.querySelector('#ph38SmartInfra')){const btn=document.createElement('button');btn.id='ph38SmartInfra';btn.className='ph38-smart-btn';btn.textContent='SMART DEFAULTS + HEALTH CHECK';btn.onclick=async()=>{applySmartInfrastructureDefaults();fixInfrastructureFields();await runtimeAudit({deepAI:true})};infra.prepend(btn)}const settings=document.getElementById('tab-settings');if(settings&&!settings.querySelector('#ph38BridgeCmd')){const note=document.createElement('div');note.id='ph38BridgeCmd';note.className='ph38-bridge-note';note.innerHTML='<b>Real verification:</b> run <code>npm run bridge</code>. The UI auto-detects <code>127.0.0.1:8787</code>. With sing-box + curl, VLESS/Trojan/VMess/WireGuard candidates are checked through an actual local tunnel.';settings.prepend(note)}}
  function syncCounts(){const arr=window.S?.configs||[],c={v:0,r:0,u:0,f:0};for(const x of arr){if(verified(x))c.v++;else if(reachable(x))c.r++;else if(failed(x))c.f++;else c.u++}const set=(id,n)=>{const el=document.getElementById(id);if(el)el.textContent=String(n)};set('phMetricVerified',c.v);set('phMetricReachable',c.r);set('phMetricUntested',c.u);set('phMetricFailed',c.f)}
  function boot(){migrateAppSettings();applySmartInfrastructureDefaults();sanitizeTokenFields();fixInfrastructureFields();installBestExports();installSmartButtons();syncCounts();runtimeAudit({quiet:true});const mo=new MutationObserver(()=>{sanitizeTokenFields();fixInfrastructureFields();installBestExports();installSmartButtons();syncCounts()});mo.observe(document.documentElement,{subtree:true,childList:true});setInterval(syncCounts,2500);window.PROXYHARVEST_V38=Object.freeze({BUILD,runtimeAudit,detectBridgeSmart,bestVerified,bestReachable,bestSplitVerified,applySmartInfrastructureDefaults})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
