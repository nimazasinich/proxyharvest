import { connect } from 'cloudflare:sockets';

const VERSION = 'ProxyHarvest Worker Gateway v42';
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_RAW_BYTES = 24 * 1024 * 1024;
const DEFAULT_HF_MODEL = 'Qwen/Qwen2.5-7B-Instruct-1M:fastest';
const HF_ROUTER = 'https://router.huggingface.co/v1/chat/completions';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,Range',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Type,ETag,Last-Modified,X-ProxyHarvest-Upstream-Status,X-ProxyHarvest-Upstream-URL',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};
const PRIVATE = /(^localhost$)|(^127\.)|(^10\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^192\.168\.)|(^0\.)|(^169\.254\.)|(^::1$)|(^fc)|(^fd)|(^fe80)/i;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8' }
  });
}
function target(raw) {
  const u = new URL(raw);
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) throw new Error('blocked-protocol');
  if (!u.hostname || PRIVATE.test(u.hostname)) throw new Error('blocked-host');
  return u;
}
function upstreamHeaders(r, extra = {}) {
  const h = new Headers(CORS);
  const type = r.headers.get('content-type');
  const etag = r.headers.get('etag');
  const modified = r.headers.get('last-modified');
  const length = r.headers.get('content-length');
  if (type) h.set('Content-Type', type);
  if (etag) h.set('ETag', etag);
  if (modified) h.set('Last-Modified', modified);
  if (length) h.set('Content-Length', length);
  h.set('X-ProxyHarvest-Upstream-Status', String(r.status));
  h.set('X-ProxyHarvest-Upstream-URL', r.url || '');
  for (const [k, v] of Object.entries(extra)) h.set(k, String(v));
  return h;
}
async function upstreamFetch(u, request, { range = null } = {}) {
  const headers = {
    'User-Agent': 'ProxyHarvest/42',
    'Accept': 'text/plain,application/json,application/yaml,text/yaml,*/*'
  };
  if (range) headers.Range = range;
  return fetch(u.toString(), {
    method: request?.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
    cf: { cacheTtl: 120, cacheEverything: false }
  });
}

// Raw CORS relay used by the tiered fetch pool. This route intentionally
// returns the upstream body, not the /fetch-sub JSON envelope.
async function rawRelay(raw, request) {
  const u = target(raw);
  const started = Date.now();
  const r = await upstreamFetch(u, request);
  const declared = Number(r.headers.get('content-length') || 0);
  if (declared > MAX_RAW_BYTES) {
    try { await r.body?.cancel(); } catch {}
    return json({ ok:false, error:'response-too-large', limitBytes:MAX_RAW_BYTES, upstreamStatus:r.status }, 413);
  }
  const headers = upstreamHeaders(r, { 'X-ProxyHarvest-Latency-Ms': Date.now() - started });
  return new Response(request.method === 'HEAD' ? null : r.body, { status:r.status, headers });
}

// Structured fetch path used by resilientFetch(). It keeps enough headroom for
// large public subscription feeds without allowing unbounded JSON expansion.
async function fetchSub(raw, request) {
  const u = target(raw);
  const started = Date.now();
  const r = await upstreamFetch(u, request);
  const declared = Number(r.headers.get('content-length') || 0);
  if (declared > MAX_JSON_BYTES) {
    try { await r.body?.cancel(); } catch {}
    return json({ ok:false, error:'response-too-large', limitBytes:MAX_JSON_BYTES, bytes:declared, upstreamStatus:r.status }, 413);
  }
  const text = await r.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_JSON_BYTES) return json({ ok:false, error:'response-too-large', limitBytes:MAX_JSON_BYTES, bytes, upstreamStatus:r.status }, 413);
  return json({ ok:r.ok, status:r.status, latencyMs:Date.now()-started, bytes, finalUrl:r.url, text });
}

// Lightweight source health check. Range is advisory; some origins ignore it,
// so the response body is cancelled immediately after headers arrive.
async function sourceCheck(raw) {
  const u = target(raw);
  const started = Date.now();
  const r = await upstreamFetch(u, { method:'GET' }, { range:'bytes=0-2047' });
  const out = {
    ok: r.ok,
    status: r.status,
    latencyMs: Date.now() - started,
    finalUrl: r.url,
    contentType: r.headers.get('content-type') || '',
    contentLength: Number(r.headers.get('content-length') || 0) || null,
    acceptsRanges: r.headers.get('accept-ranges') || null
  };
  try { await r.body?.cancel(); } catch {}
  return json(out, r.ok ? 200 : 502);
}

async function socketProbe(host, port, tlsMode = false, timeoutMs = 6000) {
  if (!host || PRIVATE.test(host)) return { ok:false, reachable:false, error:'blocked-host' };
  const p = Number(port || 443);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok:false, reachable:false, error:'invalid-port' };
  const started = Date.now();
  let sock;
  let timer;
  try {
    sock = connect({ hostname:host, port:p }, { secureTransport:tlsMode ? 'on' : 'off' });
    const opened = await Promise.race([
      sock.opened,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); })
    ]);
    clearTimeout(timer);
    await sock.close().catch(() => {});
    return { ok:true, reachable:true, tcpOk:true, tlsOk:tlsMode ? true : null, latencyMs:Date.now()-started, method:tlsMode ? 'cf-socket-tls' : 'cf-socket-tcp', remoteAddress:opened?.remoteAddress || null };
  } catch (e) {
    clearTimeout(timer);
    try { await sock?.close(); } catch {}
    return { ok:true, reachable:false, tcpOk:false, tlsOk:tlsMode ? false : null, latencyMs:Date.now()-started, method:tlsMode ? 'cf-socket-tls' : 'cf-socket-tcp', error:String(e?.message || e) };
  }
}
async function probe(host, port, tlsHint) {
  const p = Number(port || 443);
  const tlsMode = tlsHint === '1' || [443,8443,2053,2083,2087,2096].includes(p);
  const raw = await socketProbe(host, p, tlsMode);
  if (raw.reachable) return json(raw);
  if (tlsMode) return json(await socketProbe(host, p, false));
  return json(raw);
}

function redact(v) {
  return String(v ?? '')
    .replace(/hf_[A-Za-z0-9_-]+/g, '[HF_TOKEN_REDACTED]')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '[SECRET_REDACTED]')
    .slice(0, 12000);
}
function chooseDeterministic(item) {
  const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
  const safe = candidates
    .filter(c => c && c.id && c.id !== 'keep-original')
    .sort((a,b) => Number(b.rule_confidence || b.confidence || 0) - Number(a.rule_confidence || a.confidence || 0));
  const selected = safe.slice(0,2).map(c => c.id);
  return {
    index:item?.index,
    decision:selected.length ? 'apply_candidate_then_verify' : 'manual_review',
    candidate_ids:selected,
    confidence:selected.length ? Math.min(88, Math.max(45, Number(safe[0]?.rule_confidence || 55))) : 35,
    reason:selected.length ? 'Bounded deterministic candidates selected; verification is still required.' : 'No bounded safe candidate was available.'
  };
}
function safeModelItem(raw, item, fallback) {
  const allowed = new Set((item?.candidates || []).map(c => c?.id).filter(Boolean));
  const ids = (Array.isArray(raw?.candidate_ids) ? raw.candidate_ids : [])
    .filter(id => allowed.has(id) && id !== 'keep-original')
    .slice(0,2);
  if (!ids.length) return fallback;
  return {
    index:item?.index,
    decision:'apply_candidate_then_verify',
    candidate_ids:ids,
    confidence:Math.max(0, Math.min(95, Number(raw?.confidence || 65))),
    reason:redact(raw?.reason || 'HF advisor selected bounded candidate IDs; verification is still required.')
  };
}
function extractJson(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  try { return JSON.parse(s); } catch {}
  const a=s.indexOf('{'), b=s.lastIndexOf('}');
  if (a>=0 && b>a) { try { return JSON.parse(s.slice(a,b+1)); } catch {} }
  return null;
}
async function hfCompletion({ token, model, messages, max_tokens=700, temperature=0.1 }) {
  const r = await fetch(HF_ROUTER, {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ model, messages, max_tokens, temperature, stream:false })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || data?.error || `HF HTTP ${r.status}`);
  return data;
}
async function aiHealth(url, env) {
  const model = env?.HF_MODEL || DEFAULT_HF_MODEL;
  const token = env?.HF_TOKEN || '';
  const deep = url.searchParams.get('deep') === '1';
  if (!token) return json({ ok:true, configured:false, loaded:false, mode:'rules-only', model, endpoint:'/ai/advise', note:'HF_TOKEN Worker secret is not configured.' });
  if (!deep) return json({ ok:true, configured:true, loaded:false, mode:'configured', model, endpoint:'/ai/advise', note:'HF token configured; use deep=1 for a real provider check.' });
  const started=Date.now();
  try {
    const data=await hfCompletion({ token, model, messages:[{role:'user',content:'Reply with exactly OK.'}], max_tokens:4, temperature:0 });
    const text=data?.choices?.[0]?.message?.content || '';
    return json({ ok:true, configured:true, loaded:true, mode:'huggingface-provider', model, latency_ms:Date.now()-started, provider_response:Boolean(text), endpoint:'/ai/advise' });
  } catch(e) {
    return json({ ok:true, configured:true, loaded:false, mode:'provider-error', model, latency_ms:Date.now()-started, warning:String(e?.message || e) });
  }
}
async function aiAdvise(request, env) {
  if (request.method !== 'POST') return json({ ok:false, error:'method-not-allowed' }, 405);
  const started=Date.now();
  try {
    const body=await request.json().catch(() => ({}));
    const items=Array.isArray(body?.items) ? body.items.slice(0,50) : [];
    const model=env?.HF_MODEL || DEFAULT_HF_MODEL;
    const token=env?.HF_TOKEN || '';
    const fallback=items.map(chooseDeterministic);
    if (!token) return json({ ok:true, mode:'rules-only', configured:false, loaded:false, model, latency_ms:Date.now()-started, items:fallback });

    const compact=items.map(it => ({
      index:it.index,
      issues:it.issues || [],
      type:it.type || '',
      security:it.security || '',
      network:it.network || '',
      score:it.score || 0,
      candidates:(it.candidates || []).map(c => ({ id:c.id, summary:c.summary || c.label || '', rule_confidence:c.rule_confidence || c.confidence || 0 }))
    }));
    const prompt=`You are ProxyHarvest Repair Advisor. Choose only candidate IDs already provided. Never invent credentials, hosts, ports, keys, UUIDs, passwords, SNI, public keys, or verification. Return strict JSON: {"items":[{"index":number,"candidate_ids":["id"],"confidence":0-95,"reason":"short reason"}]}. Prefer the smallest reversible repair. A repair is never verification.\n\n${redact(JSON.stringify(compact))}`;
    try {
      const data=await hfCompletion({ token, model, messages:[{role:'user',content:prompt}] });
      const parsed=extractJson(data?.choices?.[0]?.message?.content || '');
      const byIndex=new Map((parsed?.items || []).map(x => [Number(x.index),x]));
      const advised=items.map((item,i) => safeModelItem(byIndex.get(Number(item.index)),item,fallback[i]));
      return json({ ok:true, mode:'huggingface-provider', configured:true, loaded:true, model, latency_ms:Date.now()-started, items:advised, model_used:true, verification:false });
    } catch(e) {
      return json({ ok:true, mode:'rules-fallback', configured:true, loaded:false, model, latency_ms:Date.now()-started, warning:String(e?.message || e), items:fallback, verification:false });
    }
  } catch(e) {
    return json({ ok:false, error:String(e?.message || e) }, 500);
  }
}

function health(env) {
  return json({
    ok:true,
    service:VERSION,
    routes:['/health','/?url=','/fetch-sub','/source-check','/probe','/bridge/health','/ai/health','/ai/advise'],
    fetch:'streaming-cors-relay',
    jsonFetchLimitBytes:MAX_JSON_BYTES,
    rawFetchLimitBytes:MAX_RAW_BYTES,
    probe:'raw-tcp-tls',
    ai:{ configured:Boolean(env?.HF_TOKEN), role:'repair-advisor-only', verifier:false },
    note:'Cloud Edge Relay provides source fetch and transport reachability only; never protocol/tunnel/WireGuard verification'
  });
}
function edgeBridgeHealth() {
  return json({
    ok:true,
    service:'ProxyHarvest Cloud Edge Relay v42',
    kind:'cloud-edge-relay',
    verifier:false,
    capabilities:{ sourceFetch:true, sourceCheck:true, tcp:true, tls:true, protocolVerification:false, tunnelVerification:false, wireguardHandshake:false },
    note:'For VERIFIED status run the Local Real Test Bridge with sing-box + curl.'
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response('', { status:204, headers:CORS });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' && url.searchParams.has('url')) return rawRelay(url.searchParams.get('url') || '', request);
      if (url.pathname === '/' || url.pathname === '/health') return health(env);
      if (url.pathname === '/bridge/health') return edgeBridgeHealth();
      if (url.pathname === '/fetch-sub') return fetchSub(url.searchParams.get('url') || '', request);
      if (url.pathname === '/source-check') return sourceCheck(url.searchParams.get('url') || '');
      if (url.pathname === '/probe') return probe(url.searchParams.get('host') || '', url.searchParams.get('port') || '443', url.searchParams.get('tls') || '');
      if (url.pathname === '/ai/health') return aiHealth(url, env);
      if (url.pathname === '/ai/advise') return aiAdvise(request, env);
      return json({ ok:false, error:'unknown-route' }, 404);
    } catch (e) {
      return json({ ok:false, error:String(e?.message || e) }, 502);
    }
  }
};
