import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const HOST = process.env.PH_BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.PH_BRIDGE_PORT || 8787);
const MAX_BODY = 256 * 1024;
const TEST_URL = process.env.PH_BRIDGE_TEST_URL || 'https://www.cloudflare.com/cdn-cgi/trace';
const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|0\.|::1$|fc|fd|fe80)/i;
const cors = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Access-Control-Allow-Private-Network':'true',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'
};
function send(res,status,obj){res.writeHead(status,{...cors,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
function commandExists(cmd){const r=spawnSync(cmd,['version'],{stdio:'ignore',shell:false});return !r.error;}
const SING_BOX = process.env.SING_BOX_BIN || (commandExists('sing-box') ? 'sing-box' : '');
const CURL = process.env.CURL_BIN || (commandExists('curl') ? 'curl' : '');
function validHost(host){return !!host && !PRIVATE.test(host) && host.length < 254;}
async function body(req){let n=0,s='';for await(const c of req){n+=c.length;if(n>MAX_BODY)throw new Error('body-too-large');s+=c}return s?JSON.parse(s):{};}
async function tcpPing(host,port,useTLS=false,timeoutMs=7000){
  if(!validHost(host)) return {ok:false,bridgeReachable:false,error:'blocked-host'};
  const started=Date.now();
  return await new Promise(resolve=>{
    let done=false; const finish=(obj)=>{if(done)return;done=true;clearTimeout(timer);try{sock.destroy()}catch{};resolve(obj)};
    const opts={host,port:Number(port),servername:useTLS&&!net.isIP(host)?host:undefined,rejectUnauthorized:false};
    const sock=useTLS?tls.connect(opts,()=>finish({ok:true,bridgeReachable:true,tlsOk:true,tcpOk:true,latencyMs:Date.now()-started,method:'node-tls'})):net.connect({host,port:Number(port)},()=>finish({ok:true,bridgeReachable:true,tcpOk:true,latencyMs:Date.now()-started,method:'node-tcp'}));
    sock.once('error',e=>finish({ok:true,bridgeReachable:false,tcpOk:false,latencyMs:Date.now()-started,error:e.message,method:useTLS?'node-tls':'node-tcp'}));
    const timer=setTimeout(()=>finish({ok:true,bridgeReachable:false,tcpOk:false,latencyMs:Date.now()-started,error:'timeout',method:useTLS?'node-tls':'node-tcp'}),Math.max(1000,timeoutMs));
  });
}
async function udpHint(host,port,timeoutMs=1800){
  if(!validHost(host)) return {ok:false,error:'blocked-host'};
  const started=Date.now(); let address=host; try{address=(await dns.lookup(host)).address}catch{}
  return await new Promise(resolve=>{const s=dgram.createSocket(address.includes(':')?'udp6':'udp4');let done=false;const finish=o=>{if(done)return;done=true;clearTimeout(t);try{s.close()}catch{};resolve(o)};s.once('error',e=>finish({ok:true,bridgeReachable:null,udpSent:false,error:e.message,method:'node-udp'}));s.send(Buffer.from([0]),Number(port),address,e=>{if(e)return finish({ok:true,bridgeReachable:null,udpSent:false,error:e.message,method:'node-udp'});});s.once('message',()=>finish({ok:true,bridgeReachable:true,udpSent:true,udpReply:true,latencyMs:Date.now()-started,method:'node-udp-reply'}));const t=setTimeout(()=>finish({ok:true,bridgeReachable:null,udpSent:true,udpReply:false,latencyMs:Date.now()-started,method:'node-udp-send'}),timeoutMs);});
}
function decodeB64(s){s=String(s||'').replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Buffer.from(s,'base64').toString('utf8')}
function parseUri(raw){
  const text=String(raw||'').trim();
  if(text.startsWith('vmess://')){const j=JSON.parse(decodeB64(text.slice(8)));return {type:'vmess',server:j.add,server_port:Number(j.port),uuid:j.id,security:j.scy||'auto',alter_id:Number(j.aid||0),tls:j.tls==='tls'?{enabled:true,server_name:j.sni||j.host||j.add,insecure:true}:undefined,transport:j.net==='ws'?{type:'ws',path:j.path||'/',headers:j.host?{Host:j.host}:undefined}:undefined};}
  const u=new URL(text); const type=u.protocol.replace(':',''); const q=u.searchParams; const common={type,server:u.hostname,server_port:Number(u.port||443)};
  const tlsEnabled=(q.get('security')||'').toLowerCase()==='tls'; const transportType=(q.get('type')||'tcp').toLowerCase();
  let transport; if(transportType==='ws') transport={type:'ws',path:q.get('path')||'/',headers:q.get('host')?{Host:q.get('host')}:undefined}; else if(transportType==='grpc') transport={type:'grpc',service_name:q.get('serviceName')||q.get('service_name')||''};
  if(type==='vless') return {...common,uuid:decodeURIComponent(u.username),flow:q.get('flow')||undefined,tls:tlsEnabled?{enabled:true,server_name:q.get('sni')||q.get('serverName')||u.hostname,insecure:true}:undefined,transport};
  if(type==='trojan') return {...common,password:decodeURIComponent(u.username),tls:{enabled:true,server_name:q.get('sni')||u.hostname,insecure:true},transport};
  if(type==='wireguard') return {type:'wireguard',server:u.hostname,server_port:Number(u.port||51820),local_address:(q.get('address')||'172.16.0.2/32').split(','),private_key:decodeURIComponent(u.username),peer_public_key:q.get('publickey')||q.get('public_key')||'',pre_shared_key:q.get('presharedkey')||q.get('pre_shared_key')||undefined,reserved:(q.get('reserved')||'').split(',').map(Number).filter(Number.isFinite),mtu:Number(q.get('mtu')||1408)};
  throw new Error('unsupported-protocol');
}
async function freePort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))});s.on('error',reject)});}
async function waitPort(port,timeout=3500){const end=Date.now()+timeout;while(Date.now()<end){const ok=await new Promise(r=>{const s=net.connect({host:'127.0.0.1',port},()=>{s.destroy();r(true)});s.once('error',()=>r(false));setTimeout(()=>{s.destroy();r(false)},250)});if(ok)return true;await new Promise(r=>setTimeout(r,120));}return false;}
function singConfig(outbound,port){
  const config={log:{level:'error'},inbounds:[{type:'mixed',tag:'in',listen:'127.0.0.1',listen_port:port}],outbounds:[],route:{final:'proxy'}};
  if(outbound.type==='wireguard'){
    const peer={address:outbound.server,port:outbound.server_port,public_key:outbound.peer_public_key,allowed_ips:['0.0.0.0/0','::/0']}; if(outbound.pre_shared_key)peer.pre_shared_key=outbound.pre_shared_key;if(outbound.reserved?.length)peer.reserved=outbound.reserved;
    config.endpoints=[{type:'wireguard',tag:'proxy',system:false,name:'phwg',mtu:outbound.mtu||1408,address:outbound.local_address,private_key:outbound.private_key,peers:[peer]}];
    config.outbounds=[{type:'direct',tag:'direct'}];
  } else { config.outbounds=[{...outbound,tag:'proxy'}]; }
  return config;
}
async function verifyViaSingBox(uri,timeoutMs=15000){
  if(!SING_BOX||!CURL) return {ok:true,bridgeReachable:null,protocolVerified:null,tunnelVerified:null,method:'transport-only',evidence:['sing-box or curl not found']};
  let outbound; try{outbound=parseUri(uri)}catch(e){return {ok:true,protocolVerified:null,tunnelVerified:null,method:'unsupported-uri',error:e.message,evidence:[e.message]};}
  const port=await freePort(); const dir=await fs.mkdtemp(path.join(os.tmpdir(),'proxyharvest-')); const conf=path.join(dir,'sing-box.json'); await fs.writeFile(conf,JSON.stringify(singConfig(outbound,port)));
  const child=spawn(SING_BOX,['run','-c',conf],{stdio:['ignore','ignore','pipe']}); let stderr=''; child.stderr.on('data',d=>{stderr=(stderr+d).slice(-2000)});
  try{
    const ready=await waitPort(port,4500); if(!ready)return {ok:true,protocolVerified:false,tunnelVerified:false,method:'sing-box-start-failed',error:stderr||'sing-box did not open local proxy'};
    const started=Date.now(); const r=spawnSync(CURL,['--silent','--show-error','--max-time',String(Math.max(4,Math.ceil(timeoutMs/1000))),'--proxy',`socks5h://127.0.0.1:${port}`,TEST_URL],{encoding:'utf8',timeout:timeoutMs+1500});
    const ok=r.status===0 && /(^|\n)ip=/.test(r.stdout||''); return {ok:true,bridgeReachable:true,protocolVerified:ok,tunnelVerified:ok,latencyMs:Date.now()-started,method:'sing-box-tunnel',egressIp:(r.stdout||'').match(/(?:^|\n)ip=([^\n]+)/)?.[1]||null,evidence:[ok?'curl-through-tunnel=ok':'curl-through-tunnel=failed',stderr].filter(Boolean)};
  } finally { try{child.kill('SIGTERM')}catch{}; await fs.rm(dir,{recursive:true,force:true}).catch(()=>{}); }
}
const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}
  const u=new URL(req.url,`http://${req.headers.host||HOST}`);
  try{
    if(u.pathname==='/health') return send(res,200,{ok:true,service:'ProxyHarvest Real Test Bridge',verifier:!!SING_BOX&&!!CURL,capabilities:{tcp:true,tls:true,udpTransport:true,singBox:!!SING_BOX,curl:!!CURL},listen:`http://${HOST}:${PORT}`});
    if(u.pathname==='/ping-host'){
      const host=u.searchParams.get('host')||'';const port=Number(u.searchParams.get('port')||443);const type=(u.searchParams.get('type')||'').toLowerCase();const useTLS=u.searchParams.get('tls')==='1';const timeoutMs=Math.min(15000,Number(u.searchParams.get('timeoutMs')||8000));
      const out=type==='wireguard'?await udpHint(host,port):await tcpPing(host,port,useTLS,timeoutMs);return send(res,200,out);
    }
    if(u.pathname==='/verify-config'&&req.method==='POST'){const b=await body(req);const transport=b.type==='wireguard'?await udpHint(b.host,b.port):await tcpPing(b.host,b.port,true,Math.min(10000,Number(b.timeoutMs||8000)));const verified=await verifyViaSingBox(b.uri,Math.min(20000,Number(b.timeoutMs||15000)));return send(res,200,{...transport,...verified,dns:'ok'});}
    return send(res,404,{ok:false,error:'not-found'});
  }catch(e){return send(res,500,{ok:false,error:String(e?.message||e)})}
});
server.listen(PORT,HOST,()=>console.log(`ProxyHarvest Real Test Bridge listening on http://${HOST}:${PORT} | verifier=${!!SING_BOX&&!!CURL}`));
