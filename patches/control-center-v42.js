/* ProxyHarvest V42 — autonomous control center, source repair, live counters, cloud/local runtime health */
(()=>{
  'use strict';
  const BUILD='42.0.1-auto-control-center';
  if(window.PROXYHARVEST_V42?.build===BUILD)return;

  const WORKER='https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev';
  const AUTO_KEY='ph-v42-auto-harvest';
  const LAST_FETCH_KEY='ph-v42-last-auto-fetch';
  const MIGRATION_KEY='ph-v42-source-migration-1';
  const AUTO_INTERVAL=15*60*1000;
  const HEALTH_INTERVAL=45*1000;
  const FULL_SOURCE_INTERVAL=30*60*1000;
  const q=id=>document.getElementById(id);
  const state=()=>window.PH_STATE||{};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const fmt=n=>Number(n||0).toLocaleString();
  const now=()=>Date.now();
  const unique=a=>[...new Set(a.filter(Boolean))];
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function setText(el,v){if(!el)return false;const n=String(v??'');if(el.textContent===n)return false;el.textContent=n;return true}
  function setAttr(el,k,v){if(!el)return false;const n=String(v);if(el.getAttribute(k)===n)return false;el.setAttribute(k,n);return true}
  function storeGet(k){try{return localStorage.getItem(k)}catch{return null}}
  function storeSet(k,v){try{localStorage.setItem(k,String(v));return true}catch{return false}}

  const SOURCE_REPLACEMENTS=new Map([
    ['https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/All_Configs_Sub.txt','https://raw.githubusercontent.com/free-nodes/v2rayfree/main/sub'],
    ['https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub1.txt','https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt'],
    ['https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub2.txt','https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vless.txt'],
    ['https://raw.githubusercontent.com/yebekhe/TelegramV2rayCollector/main/sub/mix','https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vmess.txt'],
    ['https://raw.githubusercontent.com/yebekhe/TelegramV2rayCollector/main/sub/base64','https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/trojan.txt'],
    ['https://raw.githubusercontent.com/IranianCypherpunks/sub/main/config','https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/ss.txt'],
    ['https://raw.githubusercontent.com/aiboboxx/v2rayfree/main/v2','https://raw.githubusercontent.com/free-nodes/v2rayfree/main/sub'],
    ['https://raw.githubusercontent.com/mahdibland/ShadowsocksAggregator/master/Eternity.txt','https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt'],
    ['https://raw.githubusercontent.com/Surfboardv2ray/Proxy/refs/heads/main/Merged','https://raw.githubusercontent.com/free-nodes/v2rayfree/main/sub']
  ]);
  const FALLBACK_SOURCES=[
    {name:'Free Nodes Current',url:'https://raw.githubusercontent.com/free-nodes/v2rayfree/main/sub'},
    {name:'Mahdibland Aggregator',url:'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge.txt'},
    {name:'Epodonios VLESS',url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vless.txt'},
    {name:'Epodonios VMess',url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vmess.txt'},
    {name:'Epodonios Trojan',url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/trojan.txt'},
    {name:'Epodonios Shadowsocks',url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/ss.txt'}
  ];
  const runtime={
    worker:'checking',edge:'checking',bridge:'checking',ai:'checking',
    workerDetail:'Checking gateway…',edgeDetail:'Checking Cloud Edge Relay…',bridgeDetail:'Auto-detecting 127.0.0.1:8787…',aiDetail:'Checking provider…',
    sourceHealthy:null,sourceChecked:0,sourceTotal:0,lastAudit:0,lastFullSource:0,lastMigration:0,migrated:0,added:0,
    bridgeUrl:'',bridgeVerifier:false,fetchStartCount:null,lastDelta:0
  };

  function autoEnabled(){const v=storeGet(AUTO_KEY);return v===null?true:v!=='0'}
  function setAuto(on){storeSet(AUTO_KEY,on?'1':'0');render();}
  function counts(){
    const s=state();
    const configs=Array.isArray(s.configs)?s.configs:[];
    const split=Array.isArray(s.splitnetConfigs)?s.splitnetConfigs:[];
    const warpKeys=Array.isArray(s.warpKeys)?s.warpKeys:[];
    const warpEndpoints=Array.isArray(s.warpEndpoints)?s.warpEndpoints:[];
    const sources=Array.isArray(s.sources)?s.sources:[];
    const wg=configs.filter(c=>String(c?.type||'').toLowerCase()==='wireguard').length;
    let verified=0,reachable=0,untested=0,failed=0;
    try{const c=window.PROXYHARVEST_V32?.counts?.(configs);if(c){verified=Number(c.verified)||0;reachable=Number(c.reachable)||0;untested=Number(c.untested)||0;failed=Number(c.failed)||0;}}
    catch{}
    return {configs:configs.length,split:split.length,ircf:warpKeys.length+warpEndpoints.length,sources:sources.length,enabledSources:sources.filter(x=>x?.enabled!==false).length,wg,verified,reachable,untested,failed};
  }
  function syncNav(){
    const c=counts();
    [['nb-total',c.configs],['nb-configs',c.configs],['nb-splitnet',c.split],['nb-warpkeys',c.ircf],['nb-sources',c.sources],['nb-wg',c.wg]].forEach(([id,v])=>setText(q(id),fmt(v)));
    document.querySelectorAll('.ph-nav-count').forEach(el=>el.classList.toggle('is-zero',el.textContent.trim()==='0'));
    return c;
  }
  function tone(status){return status==='ok'?'ok':status==='bad'?'bad':status==='warn'?'warn':'checking'}
  function statusLabel(status){return status==='ok'?'Ready':status==='bad'?'Unavailable':status==='warn'?'Degraded':'Checking'}
  function updateField(key,value){document.querySelectorAll(`[data-ph42="${key}"]`).forEach(el=>setText(el,value))}
  function updateTone(key,value){document.querySelectorAll(`[data-ph42-tone="${key}"]`).forEach(el=>setAttr(el,'data-tone',tone(value)))}
  function render(){
    const c=syncNav();
    updateField('configs',fmt(c.configs));
    updateField('configs-detail',`${fmt(c.verified)} verified · ${fmt(c.reachable)} reachable · ${fmt(c.split)} SplitNet`);
    updateField('sources',`${fmt(runtime.sourceHealthy??0)} / ${fmt(runtime.sourceChecked||c.enabledSources)}`);
    updateField('sources-detail',runtime.sourceChecked?`${fmt(c.enabledSources)} enabled · health sweep ${runtime.sourceHealthy??0}/${runtime.sourceChecked}`:`${fmt(c.enabledSources)} enabled · health sweep pending`);
    updateField('worker',statusLabel(runtime.worker)); updateField('worker-detail',runtime.workerDetail); updateTone('worker',runtime.worker);
    updateField('edge',statusLabel(runtime.edge)); updateField('edge-detail',runtime.edgeDetail); updateTone('edge',runtime.edge);
    updateField('bridge',runtime.bridge==='ok'?(runtime.bridgeVerifier?'Verifier ready':'Transport only'):statusLabel(runtime.bridge)); updateField('bridge-detail',runtime.bridgeDetail); updateTone('bridge',runtime.bridge);
    updateField('ai',runtime.ai==='ok'?'HF Provider':runtime.ai==='warn'?'Rules fallback':statusLabel(runtime.ai)); updateField('ai-detail',runtime.aiDetail); updateTone('ai',runtime.ai);
    updateField('auto',autoEnabled()?'ON':'OFF'); updateField('auto-detail',autoEnabled()?'Harvest runs automatically when the 15-minute window is stale.':'Manual harvest only.');
    document.querySelectorAll('[data-ph42-action="toggle-auto"]').forEach(b=>setText(b,autoEnabled()?'AUTO HARVEST: ON':'AUTO HARVEST: OFF'));
    updateField('delta',runtime.lastDelta>0?`+${fmt(runtime.lastDelta)} new unique configs`:'Waiting for next harvest delta');
    const stamp=runtime.lastAudit?new Date(runtime.lastAudit).toLocaleTimeString():'not checked yet';
    updateField('audit-time',stamp);
  }

  function centerMarkup(context){
    const infra=context==='infrastructure';
    return `<section class="ph42-control-center" data-ph42-context="${context}">
      <div class="ph42-hero">
        <div><span class="ph42-eyebrow">AUTONOMOUS RUNTIME</span><h2>${infra?'Infrastructure Control Center':'Runtime & Automation'}</h2><p>${infra?'Cloud Edge Relay, local real verifier, AI provider and source health are checked automatically.':'ProxyHarvest continuously keeps source routing, counters and runtime health synchronized.'}</p></div>
        <div class="ph42-live"><i></i><span>AUTO HEALTH</span><b data-ph42="audit-time">not checked yet</b></div>
      </div>
      <div class="ph42-grid">
        <article class="ph42-stat"><span>CONFIG LIBRARY</span><strong data-ph42="configs">0</strong><small data-ph42="configs-detail">Loading canonical state…</small><em data-ph42="delta">Waiting for next harvest delta</em></article>
        <article class="ph42-stat"><span>SOURCE POOL</span><strong data-ph42="sources">0 / 0</strong><small data-ph42="sources-detail">Health sweep pending</small><em>${infra?'Bad/stale feeds are migrated automatically.':'Worker relay is preferred over public CORS proxies.'}</em></article>
        <article class="ph42-stat ph42-health" data-ph42-tone="worker"><span>CLOUDFLARE WORKER</span><strong data-ph42="worker">Checking</strong><small data-ph42="worker-detail">Checking gateway…</small><em>Streaming source relay + TCP/TLS probe</em></article>
        <article class="ph42-stat ph42-health" data-ph42-tone="edge"><span>CLOUD EDGE RELAY</span><strong data-ph42="edge">Checking</strong><small data-ph42="edge-detail">Checking transport relay…</small><em>Reachability only — never tunnel verification</em></article>
        <article class="ph42-stat ph42-health" data-ph42-tone="bridge"><span>LOCAL REAL VERIFIER</span><strong data-ph42="bridge">Checking</strong><small data-ph42="bridge-detail">Auto-detecting localhost…</small><em>sing-box + curl required for VERIFIED</em></article>
        <article class="ph42-stat ph42-health" data-ph42-tone="ai"><span>HF REPAIR ADVISOR</span><strong data-ph42="ai">Checking</strong><small data-ph42="ai-detail">Checking provider…</small><em>Advice only — verification remains independent</em></article>
      </div>
      <div class="ph42-actions">
        <button type="button" data-ph42-action="health">RUN HEALTH SWEEP</button>
        <button type="button" data-ph42-action="repair-sources">REPAIR SOURCE POOL</button>
        <button type="button" data-ph42-action="fetch">FETCH NOW</button>
        <button type="button" data-ph42-action="toggle-auto">AUTO HARVEST: ON</button>
        <button type="button" data-ph42-action="detect-bridge">DETECT LOCAL VERIFIER</button>
        <button type="button" data-ph42-action="copy-bridge">COPY BRIDGE COMMAND</button>
      </div>
      <div class="ph42-truth"><b>Verification boundary:</b> Cloudflare can fetch subscriptions and test TCP/TLS reachability. Only the Local Real Test Bridge may set protocol/tunnel/WireGuard verification evidence.</div>
    </section>`;
  }
  function mount(){
    const settings=q('settingsContent');
    const infra=q('panel-infrastructure');
    if(settings&&!settings.querySelector('.ph42-control-center'))settings.insertAdjacentHTML('afterbegin',centerMarkup('settings'));
    if(infra&&!infra.querySelector('.ph42-control-center'))infra.insertAdjacentHTML('afterbegin',centerMarkup('infrastructure'));
    const oldTip=document.querySelector('#tab-settings .perf-tip');
    if(oldTip&&!oldTip.closest('.ph42-legacy-details')){
      const d=document.createElement('details');d.className='ph42-legacy-details';d.innerHTML='<summary>Legacy feature notes & architecture reference</summary>';
      oldTip.parentNode?.insertBefore(d,oldTip);d.appendChild(oldTip);
    }
    q('panel-infrastructure')?.querySelector(':scope > h2')?.classList.add('ph42-old-title');
    document.querySelectorAll('.ph38-runtime-strip,.ph38-smart-btn,.ph38-bridge-note').forEach(el=>el.classList.add('ph42-superseded'));
    render();
  }

  async function fetchJson(url,options={},timeout=8000){
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),timeout);
    try{const r=await fetch(url,{...options,signal:ctrl.signal,cache:'no-store'});const data=await r.json().catch(()=>({}));return {ok:r.ok,data,status:r.status,response:r};}
    finally{clearTimeout(t)}
  }
  async function workerAudit(){
    runtime.worker='checking';runtime.edge='checking';
    try{
      const h=await fetchJson(`${WORKER}/health`,{},7000);
      if(h.ok&&h.data?.ok&&/v42/i.test(String(h.data?.service||''))){runtime.worker='ok';runtime.workerDetail=`${h.data.service} · ${Math.round((h.data.rawFetchLimitBytes||0)/1048576)}MB raw relay`;storeSet('cfg_force_worker','true');const cb=q('cfg-force-worker');if(cb&&!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}}
      else{runtime.worker='bad';runtime.workerDetail=`Gateway health failed (${h.status})`;}
    }catch(e){runtime.worker='bad';runtime.workerDetail=`Gateway unavailable: ${String(e?.message||e).slice(0,80)}`;}
    try{
      const h=await fetchJson(`${WORKER}/bridge/health`,{},7000);
      if(h.ok&&h.data?.ok&&h.data?.kind==='cloud-edge-relay'&&h.data?.verifier===false){runtime.edge='ok';runtime.edgeDetail='Source relay + TCP/TLS transport probe ready';}
      else{runtime.edge='bad';runtime.edgeDetail='Cloud Edge Relay contract unavailable';}
    }catch(e){runtime.edge='bad';runtime.edgeDetail=`Relay unavailable: ${String(e?.message||e).slice(0,80)}`;}
  }
  async function bridgeAudit(){
    runtime.bridge='checking';
    const configured=(q('localBridgeUrl')?.value||'').trim();
    const candidates=unique([configured,'http://127.0.0.1:8787','http://localhost:8787']);
    for(const base of candidates){
      try{const h=await fetchJson(`${base.replace(/\/$/,'')}/health`,{},2600);if(h.ok&&h.data?.ok){runtime.bridge='ok';runtime.bridgeUrl=base;runtime.bridgeVerifier=!!h.data?.verifier;runtime.bridgeDetail=runtime.bridgeVerifier?`${base} · sing-box + curl active`:`${base} reachable · verifier binaries missing`;const input=q('localBridgeUrl');if(input&&input.value!==base){input.value=base;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}return true;}}catch{}
    }
    runtime.bridge='warn';runtime.bridgeUrl='';runtime.bridgeVerifier=false;runtime.bridgeDetail='Not running locally — use npm run bridge on this PC/VPS';return false;
  }
  async function aiAudit(){
    runtime.ai='checking';
    let primary=null;
    try{primary=await fetchJson('/api/ai/health?deep=1',{},16000);}catch{}
    if(primary?.ok&&primary.data?.mode==='huggingface-provider'&&primary.data?.loaded){runtime.ai='ok';runtime.aiDetail=`Vercel HF · ${primary.data.model||'Qwen'} · ${primary.data.latency_ms||0}ms`;return;}
    try{
      const edge=await fetchJson(`${WORKER}/ai/health?deep=1`,{},16000);
      if(edge.ok&&edge.data?.mode==='huggingface-provider'&&edge.data?.loaded){runtime.ai='ok';runtime.aiDetail=`Cloudflare HF fallback · ${edge.data.model||'Qwen'} · ${edge.data.latency_ms||0}ms`;return;}
      if(edge.data?.configured){runtime.ai='warn';runtime.aiDetail=`HF configured but provider degraded: ${edge.data.warning||edge.data.mode||'fallback'}`;return;}
    }catch{}
    runtime.ai='warn';runtime.aiDetail=primary?.data?.mode?`Primary ${primary.data.mode}; deterministic repair rules remain active`:'Deterministic repair rules active; HF provider not reachable';
  }

  function persistSources(){const s=state();if(Array.isArray(s.sources))storeSet('ph-sources-v8',JSON.stringify(s.sources));}
  function migrateSources(force=false){
    const s=state();if(!Array.isArray(s.sources)||!s.sources.length)return {migrated:0,added:0};
    if(!force&&storeGet(MIGRATION_KEY)==='done')return {migrated:0,added:0};
    let migrated=0,added=0;let nextId=Math.max(0,...s.sources.map(x=>Number(x?.id)||0))+1;
    const rebuilt=[];const seen=new Set();
    for(const original of s.sources){
      if(!original?.url)continue;
      const replacement=SOURCE_REPLACEMENTS.get(String(original.url));
      const item={...original};
      if(replacement&&replacement!==item.url){item.url=replacement;item.lastStatus=null;item.lastError='';item.lastTime=0;migrated++;}
      if(seen.has(item.url))continue;
      seen.add(item.url);rebuilt.push(item);
    }
    for(const src of FALLBACK_SOURCES){if(seen.has(src.url))continue;rebuilt.push({id:nextId++,name:src.name,url:src.url,enabled:true,lastStatus:null,lastCount:0,lastTime:0,lastError:''});seen.add(src.url);added++;}
    s.sources.splice(0,s.sources.length,...rebuilt);
    persistSources();storeSet(MIGRATION_KEY,'done');runtime.migrated+=migrated;runtime.added+=added;runtime.lastMigration=now();
    try{window.dispatchEvent(new CustomEvent('ph:v42-source-migration',{detail:{migrated,added,total:rebuilt.length}}));}catch{}
    render();return {migrated,added};
  }

  async function checkOneSource(src){
    const started=now();
    try{
      const r=await fetchJson(`${WORKER}/source-check?url=${encodeURIComponent(src.url)}`,{},9000);
      const good=!!(r.ok&&r.data?.ok);
      src.lastStatus=good?'ok':'error';src.lastTime=now();src.lastError=good?'':`HTTP ${r.data?.status||r.status||0}`;
      return {good,latency:r.data?.latencyMs||now()-started};
    }catch(e){src.lastStatus='error';src.lastTime=now();src.lastError=String(e?.message||e).slice(0,100);return {good:false,latency:now()-started};}
  }
  async function sourceSweep(full=false){
    const s=state();const sources=(Array.isArray(s.sources)?s.sources:[]).filter(x=>x?.enabled!==false&&x?.url);
    const targets=full?sources:sources.filter(x=>FALLBACK_SOURCES.some(f=>f.url===x.url)).slice(0,6);
    const use=targets.length?targets:sources.slice(0,6);
    let good=0,checked=0;
    for(let i=0;i<use.length;i+=5){const batch=use.slice(i,i+5);const out=await Promise.all(batch.map(checkOneSource));for(const r of out){checked++;if(r.good)good++;}runtime.sourceHealthy=good;runtime.sourceChecked=checked;runtime.sourceTotal=sources.length;}
    if(full){runtime.lastFullSource=now();persistSources();}
    return {good,checked,total:sources.length};
  }

  async function runAudit(fullSources=false){
    runtime.lastAudit=now();runtime.worker='checking';runtime.edge='checking';runtime.bridge='checking';runtime.ai='checking';render();
    await Promise.allSettled([workerAudit(),bridgeAudit(),aiAudit()]);
    await sourceSweep(fullSources).catch(()=>{});
    runtime.lastAudit=now();render();
  }
  function busy(){const b=q('masterFetchBtn');return !!(b?.disabled||document.querySelector('.ph-app-shell')?.dataset.runtimeState==='running'||document.querySelector('.ph-app-shell')?.dataset.runtimeState==='busy')}
  function triggerFetch(force=false){
    const b=q('masterFetchBtn');if(!b||b.disabled||busy())return false;
    const last=Number(storeGet(LAST_FETCH_KEY)||0);if(!force&&now()-last<AUTO_INTERVAL)return false;
    runtime.fetchStartCount=counts().configs;storeSet(LAST_FETCH_KEY,now());b.click();render();return true;
  }
  async function copyBridge(){const cmd='npm run bridge';try{await navigator.clipboard.writeText(cmd)}catch{const ta=document.createElement('textarea');ta.value=cmd;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}document.querySelectorAll('[data-ph42-action="copy-bridge"]').forEach(b=>{const old=b.textContent;setText(b,'COPIED: npm run bridge');setTimeout(()=>setText(b,old),1500)});}

  function bind(){
    document.addEventListener('click',e=>{const b=e.target.closest('[data-ph42-action]');if(!b)return;const a=b.dataset.ph42Action;
      if(a==='health'){b.disabled=true;runAudit(true).finally(()=>{b.disabled=false})}
      else if(a==='repair-sources'){const r=migrateSources(true);setText(b,`REPAIRED ${r.migrated+r.added}`);setTimeout(()=>setText(b,'REPAIR SOURCE POOL'),1400);sourceSweep(true).catch(()=>{});}
      else if(a==='fetch')triggerFetch(true);
      else if(a==='toggle-auto')setAuto(!autoEnabled());
      else if(a==='detect-bridge'){b.disabled=true;bridgeAudit().finally(()=>{b.disabled=false;render()});}
      else if(a==='copy-bridge')copyBridge();
    });
    window.addEventListener('ph:tab',e=>{const n=e.detail?.name;if(n==='settings'||n==='infrastructure'){mount();runAudit(false).catch(()=>{});}});
    window.addEventListener('ph:status',e=>{const d=e.detail||{};if(runtime.fetchStartCount!==null&&/idle|complete|done/i.test(`${d.state||''} ${d.text||''}`)){runtime.lastDelta=Math.max(0,counts().configs-runtime.fetchStartCount);runtime.fetchStartCount=null;}render();});
    ['ph:v27-pipeline-complete','ph:v32-verification-sync','ph:runtime-ready-ui'].forEach(name=>window.addEventListener(name,render));
  }

  // When the Vercel AI endpoint is rules-only/provider-error, transparently use
  // the Cloudflare HF fallback. This never handles verification requests.
  function installAiFallback(){
    if(window.__PH42_AI_FETCH||typeof window.fetch!=='function')return;
    const native=window.fetch.bind(window);window.__PH42_AI_FETCH=native;
    window.fetch=async function(input,init){
      const raw=typeof input==='string'?input:(input instanceof URL?input.href:input?.url||'');
      const isHealth=/^\/api\/ai\/health(?:\?|$)/.test(raw);const isAdvise=/^\/api\/ai\/advise(?:\?|$)/.test(raw);
      if(!isHealth&&!isAdvise)return native(input,init);
      let primary=null;
      try{primary=await native(input,init);const clone=primary.clone();const d=await clone.json().catch(()=>null);if(primary.ok&&d?.mode==='huggingface-provider'&&d?.loaded===true)return primary;}catch{}
      const target=isHealth?`${WORKER}/ai/health${raw.includes('?')?'?'+raw.split('?')[1]:''}`:`${WORKER}/ai/advise`;
      try{const edge=await native(target,init);if(edge.ok)return edge;}catch{}
      if(primary)return primary;
      return native(input,init);
    };
  }

  async function waitState(){for(let i=0;i<80;i++){if(Array.isArray(state().sources)&&state().sources.length)return true;await sleep(100)}return false}
  async function boot(){
    mount();bind();installAiFallback();
    await waitState();migrateSources(false);render();
    setTimeout(()=>runAudit(false).catch(()=>{}),4500);
    setTimeout(()=>{if(autoEnabled())triggerFetch(false)},12000);
    const countTimer=setInterval(()=>{if(document.visibilityState==='visible')render()},2000);
    const healthTimer=setInterval(()=>{if(document.visibilityState==='visible'&&now()-runtime.lastAudit>=HEALTH_INTERVAL)runAudit(false).catch(()=>{})},HEALTH_INTERVAL);
    const autoTimer=setInterval(()=>{if(document.visibilityState==='visible'&&autoEnabled())triggerFetch(false);if(document.visibilityState==='visible'&&now()-runtime.lastFullSource>=FULL_SOURCE_INTERVAL)sourceSweep(true).catch(()=>{})},60000);
    window.addEventListener('pagehide',()=>{clearInterval(countTimer);clearInterval(healthTimer);clearInterval(autoTimer)},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.PROXYHARVEST_V42={build:BUILD,runAudit,migrateSources,sourceSweep,triggerFetch,bridgeAudit,worker:WORKER};
})();
