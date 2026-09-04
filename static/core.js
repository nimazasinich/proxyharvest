import { SOURCES, IRCF, CANONICAL_WORKER, BUILD } from './catalog.js';
import { extractUris, parseConfig, dedupeConfigs, scoreConfig } from './engine.js';

const DB_NAME = 'proxyharvest-v18';
const DB_VERSION = 1;
const STORE = 'kv';

export const state = {
  build: BUILD,
  worker: CANONICAL_WORKER,
  sources: SOURCES.map(x => ({...x, health:'untested', count:0, latency:null, error:'', lastChecked:0})),
  configs: [],
  ircf:{keys:[], endpoints:[]},
  busy:false,
  progress:{stage:'Ready', done:0, total:0, pct:0, detail:''},
  settings:{ concurrency:4, fetchLimit:16, theme:'light', compact:false },
};

const listeners = new Set();
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn); }
export function emit(type='state', detail={}){ for(const fn of listeners){ try{ fn(type,detail,state); }catch{} } }
export function setProgress(stage, done=0, total=0, detail=''){
  state.progress = {stage,done,total,pct: total ? Math.round(done/total*100) : 0,detail}; emit('progress',state.progress);
}

function openDb(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function dbGet(key, fallback=null){ try{ const db=await openDb(); return await new Promise((res,rej)=>{const t=db.transaction(STORE,'readonly').objectStore(STORE).get(key);t.onsuccess=()=>res(t.result??fallback);t.onerror=()=>rej(t.error);}); }catch{return fallback;} }
async function dbSet(key,val){ try{ const db=await openDb(); await new Promise((res,rej)=>{const t=db.transaction(STORE,'readwrite').objectStore(STORE).put(val,key);t.onsuccess=()=>res();t.onerror=()=>rej(t.error);}); return true;}catch{return false;} }

export async function bootState(){
  const [configs,sources,settings,ircf] = await Promise.all([dbGet('configs',[]),dbGet('sources',null),dbGet('settings',null),dbGet('ircf',null)]);
  if(Array.isArray(configs)) state.configs = configs;
  if(Array.isArray(sources)) {
    const map = new Map(sources.map(s=>[s.id,s]));
    state.sources = SOURCES.map(s=>({...s,...(map.get(s.id)||{})}));
  }
  if(settings) state.settings = {...state.settings,...settings};
  if(ircf) state.ircf = {...state.ircf,...ircf};
  emit('boot');
}
export async function persist(){ await Promise.all([dbSet('configs',state.configs),dbSet('sources',state.sources),dbSet('settings',state.settings),dbSet('ircf',state.ircf)]); }

export async function workerHealth(){
  const started=performance.now();
  try{
    const r=await fetch(`${state.worker}/health`,{cache:'no-store'}); const data=await r.json();
    return {ok:r.ok && data?.ok===true,status:r.status,latency:Math.round(performance.now()-started),data};
  }catch(e){return {ok:false,status:0,latency:Math.round(performance.now()-started),error:String(e?.message||e)};}
}

export async function fetchText(url,{timeout=15000}={}){
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeout); const started=performance.now();
  try{
    const endpoint=`${state.worker}/fetch-sub?url=${encodeURIComponent(url)}`;
    const r=await fetch(endpoint,{signal:ctl.signal,cache:'no-store'});
    const data=await r.json().catch(()=>null);
    if(!r.ok || !data?.ok) throw new Error(data?.error || `Gateway HTTP ${r.status}`);
    return {text:String(data.text||''),latency:Math.round(performance.now()-started),bytes:Number(data.bytes||0),cached:Boolean(data.cached)};
  }finally{clearTimeout(timer);}
}

export async function verifySource(source){
  const started=performance.now();
  try{
    const out=await fetchText(source.url,{timeout:18000}); const uris=extractUris(out.text);
    Object.assign(source,{health:uris.length?'healthy':'empty',count:uris.length,latency:Math.round(performance.now()-started),error:'',lastChecked:Date.now()});
  }catch(e){ Object.assign(source,{health:'failed',count:0,latency:Math.round(performance.now()-started),error:String(e?.message||e),lastChecked:Date.now()}); }
  emit('sources'); await dbSet('sources',state.sources); return source;
}

async function poolMap(items,limit,fn){
  let i=0; const workers=Array.from({length:Math.max(1,Math.min(limit,items.length))},async()=>{while(i<items.length){const idx=i++; await fn(items[idx],idx);}}); await Promise.all(workers);
}

export async function verifyEnabledSources(){
  const list=state.sources.filter(s=>s.enabled); state.busy=true; setProgress('Verifying sources',0,list.length,'Checking provider health through Cloudflare Gateway');
  let done=0; await poolMap(list,state.settings.concurrency,async s=>{await verifySource(s); done++; setProgress('Verifying sources',done,list.length,s.name);});
  state.busy=false; setProgress('Ready',0,0,`${list.filter(s=>s.health==='healthy').length} healthy providers`); emit('done');
}

export async function harvestSource(source,{merge=true}={}){
  const out=await fetchText(source.url,{timeout:20000});
  const uris=extractUris(out.text); const parsed=uris.map(u=>parseConfig(u,{sourceId:source.id,sourceName:source.name,sourceUrl:source.url})).filter(Boolean);
  Object.assign(source,{health:parsed.length?'healthy':'empty',count:parsed.length,latency:out.latency,error:'',lastChecked:Date.now()});
  if(merge) state.configs=dedupeConfigs([...state.configs,...parsed]);
  return parsed;
}

export async function harvestEnabled(){
  const list=state.sources.filter(s=>s.enabled).slice(0,state.settings.fetchLimit); state.busy=true; setProgress('Queue',0,list.length,'Preparing enabled sources');
  let done=0, imported=0;
  await poolMap(list,state.settings.concurrency,async s=>{
    setProgress('Fetch + parse',done,list.length,`Fetching ${s.name}`);
    try{ const got=await harvestSource(s); imported+=got.length; }
    catch(e){ Object.assign(s,{health:'failed',count:0,error:String(e?.message||e),lastChecked:Date.now()}); }
    done++; setProgress('Fetch + parse',done,list.length,`${imported.toLocaleString()} configs parsed`);
  });
  setProgress('Dedupe + score',list.length,list.length,'Normalizing library');
  state.configs=dedupeConfigs(state.configs).map(c=>({...c,score:scoreConfig(c)}));
  await persist(); state.busy=false; setProgress('Complete',1,1,`${state.configs.length.toLocaleString()} unique configs`); emit('configs');
  setTimeout(()=>setProgress('Ready',0,0,''),1400);
  return state.configs;
}

export async function clearConfigs(){ state.configs=[]; await dbSet('configs',[]); emit('configs'); }
export async function replaceConfig(id,next){ const idx=state.configs.findIndex(c=>c.id===id); if(idx>=0){state.configs[idx]=next;await dbSet('configs',state.configs);emit('configs');} }
export async function removeConfig(id){ state.configs=state.configs.filter(c=>c.id!==id);await dbSet('configs',state.configs);emit('configs'); }
export function toggleSource(id,enabled){const s=state.sources.find(x=>x.id===id);if(s){s.enabled=enabled;dbSet('sources',state.sources);emit('sources');}}

export async function fetchIRCF(){
  state.busy=true; setProgress('IRCF',0,2,'Fetching WARP+ keys');
  let keys=[], endpoints=[];
  try{ const k=await fetchText(IRCF.warpKeyLite); keys=String(k.text).split(/\r?\n/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#')).slice(0,500); }catch{}
  setProgress('IRCF',1,2,'Fetching clean Cloudflare endpoints');
  try{ const e=await fetchText(IRCF.endpointJson); const obj=JSON.parse(e.text); const walk=v=>{if(Array.isArray(v)) v.forEach(x=>typeof x==='string'&&endpoints.push(x)); else if(v&&typeof v==='object') Object.values(v).forEach(walk);}; walk(obj); endpoints=[...new Set(endpoints)].slice(0,1000); }catch{}
  state.ircf={keys,endpoints}; await dbSet('ircf',state.ircf); state.busy=false; setProgress('Ready',0,0,`${keys.length} keys · ${endpoints.length} endpoints`); emit('ircf');
}

export function stats(){
  const c=state.configs; return {
    total:c.length,
    verified:c.filter(x=>x.probe?.protocolVerified||x.probe?.tunnelVerified).length,
    failed:c.filter(x=>x.tested&&x.live===false).length,
    vless:c.filter(x=>x.type==='vless').length, vmess:c.filter(x=>x.type==='vmess').length,
    trojan:c.filter(x=>x.type==='trojan').length, wireguard:c.filter(x=>x.type==='wireguard').length,
    sourcesHealthy:state.sources.filter(x=>x.health==='healthy').length,
  };
}
