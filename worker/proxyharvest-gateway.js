const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

const PRIVATE_HOST_RE = /(^localhost$)|(^127\.)|(^10\.)|(^172\.(1[6-9]|2\d|3[0-1])\.)|(^192\.168\.)|(^0\.)|(^169\.254\.)|(^::1$)/i;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function json(body, status=200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type':'application/json; charset=utf-8' } });
}

function cleanTarget(raw) {
  const u = new URL(raw);
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) throw new Error('blocked-protocol');
  if (!u.hostname || PRIVATE_HOST_RE.test(u.hostname)) throw new Error('blocked-host');
  return u;
}

async function fetchSub(url) {
  const target = cleanTarget(url);
  const started = Date.now();
  const r = await fetch(target.toString(), {
    method: 'GET',
    headers: { 'User-Agent':'ProxyHarvest/worker-gateway', 'Accept':'text/plain,application/json,*/*' },
    redirect: 'follow',
    cf: { cacheTtl: 120, cacheEverything: false }
  });
  const text = await r.text();
  if (text.length > 2500000) return json({ ok:false, error:'response-too-large', status:r.status }, 413);
  return json({ ok:r.ok, status:r.status, latencyMs:Date.now()-started, bytes:text.length, text });
}

async function probe(host, port) {
  if (!host || PRIVATE_HOST_RE.test(host)) return json({ ok:false, reachable:false, error:'blocked-host' }, 400);
  const numericPort = Number(port || 443);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) return json({ ok:false, reachable:false, error:'invalid-port' }, 400);
  const started = Date.now();
  try {
    const r = await fetch(`https://${host}:${numericPort}/`, { method:'GET', redirect:'manual', cf:{ cacheTtl:0 } });
    return json({ ok:true, reachable:true, status:r.status, latencyMs:Date.now()-started, method:'https-get' });
  } catch (e1) {
    try {
      const r = await fetch(`http://${host}:${numericPort}/`, { method:'GET', redirect:'manual', cf:{ cacheTtl:0 } });
      return json({ ok:true, reachable:true, status:r.status, latencyMs:Date.now()-started, method:'http-get' });
    } catch (e2) {
      return json({ ok:true, reachable:false, latencyMs:Date.now()-started, error:String(e2?.message || e1?.message || e2) });
    }
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response('', { status:204, headers:CORS });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/' || url.pathname === '/health') return json({ ok:true, service:'ProxyHarvest Worker Gateway', routes:['/health','/fetch-sub','/probe'] });
      if (url.pathname === '/fetch-sub') return fetchSub(url.searchParams.get('url') || '');
      if (url.pathname === '/probe') return probe(url.searchParams.get('host') || '', url.searchParams.get('port') || '443');
      return json({ ok:false, error:'unknown-route' }, 404);
    } catch (e) {
      return json({ ok:false, error:String(e?.message || e) }, 502);
    }
  }
};
