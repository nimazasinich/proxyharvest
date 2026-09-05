import { connect } from 'cloudflare:sockets';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const PRIVATE=/(^localhost$)|(^127\.)|(^10\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^192\.168\.)|(^0\.)|(^169\.254\.)|(^::1$)|(^fc)|(^fd)|(^fe80)/i;
const ALLOWED_PROTOCOLS=new Set(['http:','https:']);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json; charset=utf-8'}})}
function target(raw){const u=new URL(raw);if(!ALLOWED_PROTOCOLS.has(u.protocol))throw new Error('blocked-protocol');if(!u.hostname||PRIVATE.test(u.hostname))throw new Error('blocked-host');return u}
async function fetchSub(raw){const u=target(raw);const started=Date.now();const r=await fetch(u.toString(),{headers:{'User-Agent':'ProxyHarvest/38','Accept':'text/plain,application/json,*/*'},redirect:'follow',cf:{cacheTtl:120,cacheEverything:false}});const text=await r.text();if(text.length>2500000)return json({ok:false,error:'response-too-large',status:r.status},413);return json({ok:r.ok,status:r.status,latencyMs:Date.now()-started,bytes:text.length,text})}
async function socketProbe(host,port,tlsMode=false,timeoutMs=6000){
  if(!host||PRIVATE.test(host))return {ok:false,reachable:false,error:'blocked-host'};const p=Number(port||443);if(!Number.isInteger(p)||p<1||p>65535)return {ok:false,reachable:false,error:'invalid-port'};
  const started=Date.now();let sock;let timer;
  try{sock=connect({hostname:host,port:p},{secureTransport:tlsMode?'on':'off'});const opened=await Promise.race([sock.opened,new Promise((_,rej)=>timer=setTimeout(()=>rej(new Error('timeout')),timeoutMs))]);clearTimeout(timer);await sock.close().catch(()=>{});return {ok:true,reachable:true,tcpOk:true,tlsOk:tlsMode?true:null,latencyMs:Date.now()-started,method:tlsMode?'cf-socket-tls':'cf-socket-tcp',remoteAddress:opened?.remoteAddress||null};}
  catch(e){clearTimeout(timer);try{await sock?.close()}catch{};return {ok:true,reachable:false,tcpOk:false,tlsOk:tlsMode?false:null,latencyMs:Date.now()-started,method:tlsMode?'cf-socket-tls':'cf-socket-tcp',error:String(e?.message||e)}}
}
async function probe(host,port,tlsHint){
  const p=Number(port||443);const tlsMode=tlsHint==='1'||[443,8443,2053,2083,2087,2096].includes(p);
  const raw=await socketProbe(host,p,tlsMode);if(raw.reachable)return json(raw);
  if(tlsMode){const plain=await socketProbe(host,p,false);return json(plain)}
  return json(raw);
}
export default{async fetch(request){if(request.method==='OPTIONS')return new Response('',{status:204,headers:CORS});const url=new URL(request.url);try{if(url.pathname==='/'||url.pathname==='/health')return json({ok:true,service:'ProxyHarvest Worker Gateway v38',routes:['/health','/fetch-sub','/probe'],probe:'raw-tcp-tls',note:'transport reachability only; never protocol/tunnel verification'});if(url.pathname==='/fetch-sub')return fetchSub(url.searchParams.get('url')||'');if(url.pathname==='/probe')return probe(url.searchParams.get('host')||'',url.searchParams.get('port')||'443',url.searchParams.get('tls')||'');return json({ok:false,error:'unknown-route'},404)}catch(e){return json({ok:false,error:String(e?.message||e)},502)}}};
