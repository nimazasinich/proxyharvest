import { connect } from 'cloudflare:sockets';

const VERSION = 'ProxyHarvest Worker Gateway v42';
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_RAW_BYTES = 24 * 1024 * 1024;
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

function health() {
  return json({
    ok:true,
    service:VERSION,
    routes:['/health','/?url=','/fetch-sub','/source-check','/probe','/bridge/health'],
    fetch:'streaming-cors-relay',
    jsonFetchLimitBytes:MAX_JSON_BYTES,
    rawFetchLimitBytes:MAX_RAW_BYTES,
    probe:'raw-tcp-tls',
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
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response('', { status:204, headers:CORS });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' && url.searchParams.has('url')) return rawRelay(url.searchParams.get('url') || '', request);
      if (url.pathname === '/' || url.pathname === '/health') return health();
      if (url.pathname === '/bridge/health') return edgeBridgeHealth();
      if (url.pathname === '/fetch-sub') return fetchSub(url.searchParams.get('url') || '', request);
      if (url.pathname === '/source-check') return sourceCheck(url.searchParams.get('url') || '');
      if (url.pathname === '/probe') return probe(url.searchParams.get('host') || '', url.searchParams.get('port') || '443', url.searchParams.get('tls') || '');
      return json({ ok:false, error:'unknown-route' }, 404);
    } catch (e) {
      return json({ ok:false, error:String(e?.message || e) }, 502);
    }
  }
};
