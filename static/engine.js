export const PROTOCOLS = ['vless','vmess','trojan','ss','ssr','hysteria2','hy2','tuic','wireguard'];
const URI_RE = /(vless|vmess|trojan|ss|ssr|hysteria2|hy2|tuic|wireguard):\/\/[^\s"'<>]+/gi;

export function safeB64Decode(input='') {
  const s = String(input).trim().replace(/-/g,'+').replace(/_/g,'/');
  try {
    const padded = s + '='.repeat((4 - s.length % 4) % 4);
    return decodeURIComponent(Array.prototype.map.call(atob(padded), c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0')).join(''));
  } catch {
    try { return atob(s); } catch { return ''; }
  }
}

export function extractUris(text='') {
  const raw = String(text || '');
  const found = raw.match(URI_RE) || [];
  if (found.length) return [...new Set(found.map(s => s.trim()))];
  const decoded = safeB64Decode(raw);
  if (!decoded || decoded === raw) return [];
  return [...new Set(decoded.match(URI_RE) || [])];
}

function parseStandard(uri, type) {
  const u = new URL(uri);
  const p = u.searchParams;
  return {
    type,
    host: u.hostname,
    port: Number(u.port || (u.protocol === 'https:' ? 443 : 443)),
    security: p.get('security') || p.get('tls') || '',
    net: p.get('type') || p.get('net') || '',
    sni: p.get('sni') || p.get('serverName') || '',
    path: p.get('path') || '',
    flow: p.get('flow') || '',
    fp: p.get('fp') || '',
    pbk: p.get('pbk') || '',
    sid: p.get('sid') || '',
    name: decodeURIComponent((u.hash || '').slice(1) || ''),
  };
}

function parseVmess(uri) {
  const decoded = safeB64Decode(uri.slice(8));
  const v = JSON.parse(decoded || '{}');
  return {
    type:'vmess', host:v.add || '', port:Number(v.port||0), security:v.tls||'', net:v.net||'',
    sni:v.sni||v.host||'', path:v.path||'', name:v.ps||'', fp:v.fp||'', idPresent:Boolean(v.id),
  };
}

function parseWireGuard(uri) {
  const u = new URL(uri);
  const p = u.searchParams;
  return {
    type:'wireguard', host:u.hostname, port:Number(u.port||0), security:'wireguard', net:'udp',
    address:p.get('address') || '', publicKey:p.get('publickey') || '', presharedKeyPresent:Boolean(p.get('presharedkey')),
    privateKeyPresent:Boolean(u.username), mtu:Number(p.get('mtu')||0), keepalive:Number(p.get('keepalive')||0),
    reserved:p.get('reserved')||'', name:decodeURIComponent((u.hash||'').slice(1)||''),
  };
}

export function emptyProbe(method='none') {
  return {
    dns:'unknown', browserReachable:null, workerReachable:null, bridgeReachable:null,
    protocolVerified:false, tunnelVerified:false, latencyMs:null,
    method, confidence:'unknown', evidence:[], testedAt:null,
  };
}

export function parseConfig(uri, meta={}) {
  try {
    const type = String(uri).split('://')[0].toLowerCase();
    let base;
    if (type === 'vmess') base = parseVmess(uri);
    else if (type === 'wireguard') base = parseWireGuard(uri);
    else base = parseStandard(uri, type);
    if (!base.host || !Number(base.port)) return null;
    const id = `${type}:${base.host}:${base.port}:${base.sni||''}:${base.path||''}`.toLowerCase();
    const cfg = {
      id, raw:uri, ...base,
      sourceId: meta.sourceId || '', sourceName:meta.sourceName || '', sourceUrl:meta.sourceUrl || '',
      importedAt: Date.now(), tested:false, live:null, reachable:false, latency:null,
      probe:emptyProbe(),
    };
    cfg.score = scoreConfig(cfg);
    return cfg;
  } catch { return null; }
}

function anyReachable(p={}) {
  return p.browserReachable === true || p.workerReachable === true || p.bridgeReachable === true;
}
function knownReachability(p={}) {
  return [p.browserReachable,p.workerReachable,p.bridgeReachable].filter(v => v === true || v === false);
}
function explicitReachabilityFailure(p={}) {
  const known = knownReachability(p);
  return known.length > 0 && known.every(v => v === false);
}

export function scoreConfig(cfg) {
  let s = 46;
  if (cfg.host) s += 8;
  if (cfg.port === 443) s += 6;
  if (cfg.security === 'tls' || cfg.security === 'reality') s += 8;
  if (cfg.sni) s += 6;
  if (cfg.type === 'vless') s += 5;
  if (cfg.type === 'wireguard') s += 3;
  if (cfg.probe?.protocolVerified || cfg.probe?.tunnelVerified) s += 20;
  else if (anyReachable(cfg.probe)) s += 3;
  else if (explicitReachabilityFailure(cfg.probe) || cfg.live === false) s -= 20;
  if (Number.isFinite(cfg.latency)) s += cfg.latency < 250 ? 10 : cfg.latency < 700 ? 4 : -4;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export function dedupeConfigs(items=[]) {
  const map = new Map();
  for (const c of items) {
    if (!c?.id) continue;
    const prev = map.get(c.id);
    if (!prev || (c.score||0) > (prev.score||0)) map.set(c.id, c);
  }
  return [...map.values()];
}

export function summarizeVerification(cfg) {
  const p = cfg?.probe || {};
  if (p.tunnelVerified === true) return {key:'verified', label:'Tunnel verified', tone:'good'};
  if (p.protocolVerified === true) return {key:'verified', label:cfg?.type === 'wireguard' ? 'Handshake verified' : 'Protocol verified', tone:'good'};
  if (anyReachable(p) || cfg?.reachable === true) return {key:'reachable', label:'Reachable only', tone:'warn'};
  if (cfg?.tested && (explicitReachabilityFailure(p) || cfg?.live === false)) return {key:'failed', label:'Failed', tone:'bad'};
  if (p.method && p.method !== 'none' && p.method !== 'repair-candidate') return {key:'reachable', label:'Probe evidence', tone:'warn'};
  return {key:'untested', label:'Untested', tone:'muted'};
}

export function diagnose(cfg) {
  const issues = [];
  if (!cfg?.host) issues.push({code:'missing_host', severity:'high', text:'Host is missing'});
  if (!Number(cfg?.port)) issues.push({code:'invalid_port', severity:'high', text:'Port is missing or invalid'});
  if (cfg?.type === 'vless' && cfg?.security === 'reality' && !cfg?.sni) issues.push({code:'reality_sni', severity:'medium', text:'Reality config has no SNI'});
  if (cfg?.type === 'vless' && cfg?.net === 'ws' && !cfg?.path) issues.push({code:'ws_path', severity:'medium', text:'WebSocket path is empty'});
  if (cfg?.type === 'wireguard') {
    if (!cfg.privateKeyPresent) issues.push({code:'wg_private_key_missing', severity:'high', text:'WireGuard private key is missing'});
    if (!cfg.publicKey) issues.push({code:'wg_public_key_missing', severity:'high', text:'WireGuard public key is missing'});
    if (!cfg.address) issues.push({code:'wg_address_missing', severity:'high', text:'WireGuard interface address is missing'});
    if (!(cfg.probe?.tunnelVerified || cfg.probe?.protocolVerified)) issues.push({code:'wg_unverified', severity:'info', text:'No WireGuard handshake/tunnel verification evidence'});
  }
  if (summarizeVerification(cfg).key === 'failed') issues.push({code:'failed_probe', severity:'medium', text:'Most recent reachability/verification attempt failed'});
  if (Number(cfg?.latency) > 1500) issues.push({code:'high_latency', severity:'low', text:'Observed latency is very high'});
  return issues;
}

export function generateCandidates(cfg, issues=diagnose(cfg)) {
  const out = [];
  const codes = new Set(issues.map(i => i.code));
  if (codes.has('reality_sni') && cfg.host && !/^\d+\.\d+\.\d+\.\d+$/.test(cfg.host)) {
    out.push({id:'use-host-as-sni', field:'sni', value:cfg.host, confidence:58, reason:'Use hostname as SNI candidate; requires verification'});
  }
  if (codes.has('ws_path')) out.push({id:'ws-root-path', field:'path', value:'/', confidence:45, reason:'Common WebSocket fallback path; requires verification'});
  if (codes.has('invalid_port')) out.push({id:'port-443', field:'port', value:443, confidence:38, reason:'Conservative TLS port candidate; requires verification'});
  if (codes.has('high_latency')) out.push({id:'keep-original', field:'noop', value:null, confidence:90, reason:'Do not mutate config solely because of latency'});
  return out;
}

export function sanitizeForModel(cfg, issues, candidates) {
  const p = cfg?.probe || {};
  return {
    protocol:String(cfg.type||'unknown'), endpoint:`${cfg.host||'?'}:${Number(cfg.port||0)}`,
    security:String(cfg.security||''), network:String(cfg.net||''), sni_present:Boolean(cfg.sni), path_present:Boolean(cfg.path),
    score:Number(cfg.score||0), tested:Boolean(cfg.tested), live:cfg.live === true ? true : cfg.live === false ? false : null,
    latency_ms:Number.isFinite(cfg.latency) ? Math.round(cfg.latency) : null,
    verification:{
      method:String(p.method||'none'),
      worker_reachable:p.workerReachable===true,
      bridge_reachable:p.bridgeReachable===true,
      browser_reachable:p.browserReachable===true,
      protocol_verified:p.protocolVerified===true,
      tunnel_verified:p.tunnelVerified===true,
    },
    issues:issues.map(x => ({code:x.code,severity:x.severity,text:x.text})),
    candidates:candidates.map(c => ({id:c.id,field:c.field,value:c.value,rule_confidence:c.confidence,reason:c.reason})),
  };
}

export function applyCandidate(cfg, candidate) {
  if (!cfg || !candidate || candidate.field === 'noop') return {...cfg};
  const next = structuredClone(cfg);
  next[candidate.field] = candidate.value;
  next.tested = false; next.live = null; next.reachable = false; next.latency = null;
  next.probe = {...emptyProbe('repair-candidate'), evidence:['Candidate applied; verification required.']};
  next.score = scoreConfig(next);
  return next;
}
