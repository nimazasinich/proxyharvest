// ============================================================
// ProxyHarvest Real v8 — app.js
// ENHANCEMENTS:
//  - SplitNet/WARP Free subscription tab (offline-capable)
//  - IndexedDB persistence for configs (survive reload)
//  - Offline-first config retrieval with stale-while-revalidate
//  - Enhanced Settings (theme, font, score thresholds, proxy health)
//  - Improved UI (search in configs, live stats bar, health indicator)
//  - Config retrieval guaranteed even on worst internet via multi-CDN
//  - QR codes, column sort, bulk SplitNet ops, WG .conf export
//  - IRCF.space: Warp+ keys, clean Cloudflare IPs, offline detection
//  - Local Bridge URL configurable from Settings tab
//  - Synchronized HTML element IDs — all event bindings verified
// ============================================================
// ProxyHarvest paired runtime marker
window.PROXYHARVEST_JS_LOADED = true;
window.PROXYHARVEST_BUILD = '25.0.0-original-fullstack';
window.PROXYHARVEST_LOCAL_FILE_MODE = location.protocol === 'file:';
const PH_STORAGE = Object.freeze({
  get(key) { try { return window.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set(key, value) { try { window.localStorage?.setItem(key, String(value)); return true; } catch { return false; } },
  remove(key) { try { window.localStorage?.removeItem(key); return true; } catch { return false; } },
});
const PH_RUNTIME = {
  localBridgeVerified: false,
  networkMode: window.PROXYHARVEST_LOCAL_FILE_MODE ? 'canonical-worker' : 'adaptive',
  transportMigrated: false,
};
document.addEventListener('DOMContentLoaded', () => {

// ============================================================
// UTILITIES
// ============================================================
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escAttr(s) { return escHtml(s); }

const WG_KEY_RE = /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{42,44}=?)(?![A-Za-z0-9+/=])/g;
function sanitizeLogMsg(msg) {
  return String(msg).replace(WG_KEY_RE, '[KEY_REDACTED]');
}


// ============================================================
// VERIFICATION + SECRET HYGIENE HELPERS (CP-REAL-01)
// ============================================================
const PH_UPGRADE = Object.freeze({ version: 'real-verification-2026-09-04' });
function normalizeDnsState(v) { if (v === true || v === 'ok') return 'ok'; if (v === false || v === 'fail' || v === 'bad') return 'fail'; return 'unknown'; }
function boolOrNull(v) { return v === true ? true : v === false ? false : null; }
function isSensitiveUri(uri) { const u = String(uri || '').trim().toLowerCase(); return u.startsWith('wireguard://') || u.includes('privatekey=') || u.includes('private_key='); }
function redactUri(uri) { const raw = String(uri || ''); if (!raw) return ''; try { if (raw.toLowerCase().startsWith('wireguard://')) return raw.replace(/^wireguard:\/\/([^@?#]+)@/i, 'wireguard://[REDACTED_PRIVATE_KEY]@'); return raw.replace(/(privatekey=)[^&#]+/ig, '$1[REDACTED]').replace(/(private_key=)[^&#]+/ig, '$1[REDACTED]'); } catch { return '[REDACTED_URI]'; } }
function configHasSessionSecret(cfg) { return !!(cfg && cfg._privateKeyRaw && !String(cfg._privateKeyRaw).includes('***') && !String(cfg._privateKeyRaw).includes('REDACTED')); }
function hasRedactedRaw(cfg) { return !!(cfg && typeof cfg.raw === 'string' && /REDACTED|\*\*\*/i.test(cfg.raw)); }
function cloneForPersistence(item) { const clean = Object.assign({}, item || {}); if (clean.raw && isSensitiveUri(clean.raw)) clean.rawRedacted = redactUri(clean.raw); if (clean.type === 'wireguard' || isSensitiveUri(clean.raw)) { clean.secretMissing = !configHasSessionSecret(clean); clean.raw = clean.rawRedacted || null; } delete clean._privateKeyRaw; return clean; }
function makeProbe(overrides = {}) { return { dns:'unknown', browserReachable:null, workerReachable:null, bridgeReachable:null, protocolVerified:null, tunnelVerified:null, latencyMs:null, method:'unverified', confidence:'low', evidence:[], testedAt:Date.now(), ...overrides }; }
function probeToLegacyLive(probe) { if (!probe) return null; if (probe.tunnelVerified === true || probe.protocolVerified === true) return true; if (probe.tunnelVerified === false || probe.protocolVerified === false) return false; if (probe.browserReachable === false && probe.workerReachable === false && probe.bridgeReachable === false) return false; return null; }
function applyProbeResult(cfg, probe) { if (!cfg) return cfg; const p = makeProbe(probe || {}); p.dns = normalizeDnsState(p.dns); if (!Array.isArray(p.evidence)) p.evidence = [String(p.evidence || '')].filter(Boolean); cfg.probe = p; cfg.doh = p.dns === 'ok' ? true : p.dns === 'fail' ? false : null; cfg.latency = typeof p.latencyMs === 'number' ? p.latencyMs : 9999; cfg.live = probeToLegacyLive(p); cfg.reachable = !!(p.browserReachable || p.workerReachable || p.bridgeReachable); cfg.tested = true; cfg.testMethod = p.method; return cfg; }
function verificationLabel(cfg) { const p = cfg?.probe; if (p?.tunnelVerified === true) return { cls:'conn-live', text:'LIVE', title:'Tunnel verified end-to-end' }; if (p?.protocolVerified === true) return { cls:'conn-live', text:'PROTO', title:'Protocol/handshake verified' }; if (p?.browserReachable || p?.workerReachable || p?.bridgeReachable) return { cls:'conn-reachable', text:'REACHABLE', title:'Network probe reached the endpoint; tunnel not verified' }; if (cfg?.live === false || p?.browserReachable === false || p?.workerReachable === false || p?.bridgeReachable === false) return { cls:'conn-dead', text:'DEAD', title:'Probe failed or endpoint appears unavailable' }; return { cls:'conn-unknown', text:'UNVERIFIED', title:'No verification evidence yet' }; }
function verificationPass(cfg) { const p = cfg?.probe; return !!(p?.tunnelVerified === true || p?.protocolVerified === true); }
function getExportUri(cfg, opts = {}) { const allowSensitive = !!opts.allowSensitive; if (!cfg) return ''; if (cfg.raw && !hasRedactedRaw(cfg) && (!isSensitiveUri(cfg.raw) || allowSensitive)) return cfg.raw; const built = buildUriFromConfig(cfg); if (!built || hasRedactedRaw({raw:built})) return ''; if (isSensitiveUri(built) && !allowSensitive && !configHasSessionSecret(cfg)) return ''; return built; }
function normalizeWorkerBase(workerUrl) { return String(workerUrl || '').replace(/\?url=$/, '').replace(/\/$/, ''); }
function makeWorkerFetchUrl(workerUrl, targetUrl) { const base = normalizeWorkerBase(workerUrl); if (!base) return ''; return `${base}/fetch-sub?url=${encodeURIComponent(targetUrl)}`; }
function makeWorkerProbeUrl(workerUrl, host, port) { const base = normalizeWorkerBase(workerUrl); if (!base) return ''; return `${base}/probe?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port || '')}`; }
async function basicDoHCheck(hostname) {
  if (!hostname || hostname.length < 3) return 'unknown';
  if (/^[\d.]+$/.test(hostname) || /^[0-9a-fA-F:]+$/.test(hostname)) return 'ok';
  const resolvers = (typeof DOH_RESOLVERS !== 'undefined' && Array.isArray(DOH_RESOLVERS) && DOH_RESOLVERS.length)
    ? DOH_RESOLVERS
    : ['https://cloudflare-dns.com/dns-query','https://dns.google/resolve'];
  for (const resolver of resolvers) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${resolver}?name=${encodeURIComponent(hostname)}&type=A`, { signal:ctrl.signal, headers:{'Accept':'application/dns-json'}, cache:'no-store' });
      clearTimeout(tid);
      if (!res.ok) continue;
      const d = await res.json();
      if (d.Status === 0 && Array.isArray(d.Answer) && d.Answer.length > 0) return 'ok';
      if (d.Status === 3) return 'fail';
    } catch {}
  }
  return 'unknown';
}
function normalizeBridgeBase(raw) {
  return String(raw || '')
    .trim()
    .replace(/\?url=$/, '')
    .replace(/[?&]url=$/, '')
    .replace(/\/proxy\/?$/, '')
    .replace(/\/fetch-sub\/?$/, '')
    .replace(/\/$/, '');
}
function getBridgeBase() {
  const input = document.getElementById('localBridgeUrl')?.value?.trim() || '';
  let stored = '';
  try { stored = PH_STORAGE.get('ph_real_ping_bridge') || ''; } catch {}
  const raw = input || stored;
  if (!raw || isLegacyBridgeUrl(raw)) return '';
  return normalizeBridgeBase(raw);
}
function likelyTLSForConfig(cfg) {
  const sec = String(cfg?.security || '').toLowerCase();
  const port = Number(cfg?.port || 0);
  return sec === 'tls' || sec === 'reality' || sec === 'xtls' || [443,8443,2053,2083,2087,2096].includes(port);
}
function probeFromBridgePayload(data, fallbackMethod = 'bridge-real-ping', startedAt = Date.now()) {
  if (!data || typeof data !== 'object') return null;
  const latency = Number(data.latencyMs ?? data.latency ?? data.tcpLatencyMs ?? data.tlsLatencyMs ?? (Date.now() - startedAt));
  const tcpOk = boolOrNull(data.tcpOk ?? data.tcpConnected ?? data.reachable ?? data.bridgeReachable ?? data.startOk);
  const tlsOk = boolOrNull(data.tlsOk ?? data.tlsHandshakeOk);
  const udpOk = boolOrNull(data.udpOk ?? data.udpSent);
  const bridgeReachable = boolOrNull(data.bridgeReachable ?? data.reachable ?? data.startOk ?? tcpOk ?? tlsOk ?? udpOk);
  const protocolVerified = boolOrNull(data.protocolVerified ?? data.handshakeOk);
  const tunnelVerified = boolOrNull(data.tunnelVerified ?? data.httpViaTunnelOk);
  const evidence = [];
  if (data.ip || data.resolvedIp) evidence.push(`ip=${data.ip || data.resolvedIp}`);
  if (data.addresses && Array.isArray(data.addresses)) evidence.push(`dns=${data.addresses.join(',')}`);
  if (data.tcpLatencyMs != null) evidence.push(`tcp=${data.tcpLatencyMs}ms`);
  if (data.tlsLatencyMs != null) evidence.push(`tls=${data.tlsLatencyMs}ms`);
  if (data.httpStatus != null || data.status != null) evidence.push(`http=${data.httpStatus ?? data.status}`);
  if (data.udpSent === true) evidence.push(data.udpReply ? 'udp=reply' : 'udp=sent-no-reply');
  if (data.egressIp) evidence.push(`egress=${data.egressIp}`);
  if (data.client) evidence.push(`client=${data.client}`);
  if (data.error) evidence.push(`error=${data.error}`);
  const confidence = tunnelVerified === true ? 'high' : protocolVerified === true ? 'high' : bridgeReachable === true ? 'medium' : 'low';
  return makeProbe({
    dns: normalizeDnsState(data.dns ?? data.dnsOk ?? (data.resolved || data.ip || data.resolvedIp ? 'ok' : 'unknown')),
    browserReachable: null,
    workerReachable: null,
    bridgeReachable,
    protocolVerified,
    tunnelVerified,
    latencyMs: Number.isFinite(latency) ? latency : null,
    method: data.method || (data.client ? `bridge:${data.client}` : fallbackMethod),
    confidence,
    evidence,
  });
}
async function bridgePingHost(host, port, useTLS = false, timeoutMs = 10000, type = '') {
  const base = getBridgeBase();
  if (!base || !host) return null;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const url = `${base}/ping-host?host=${encodeURIComponent(host)}&port=${encodeURIComponent(port || 443)}&tls=${useTLS ? '1' : '0'}&type=${encodeURIComponent(type || '')}&timeoutMs=${encodeURIComponent(timeoutMs)}`;
    const res = await fetch(url, { signal:ctrl.signal, cache:'no-store' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return probeFromBridgePayload(data, 'bridge-real-ping', started);
  } catch { return null; }
  finally { clearTimeout(tid); }
}
async function bridgeVerifyConfig(cfg, timeoutMs = 15000) {
  const base = getBridgeBase();
  if (!base || !cfg) return null;
  const uri = getExportUri(cfg, { allowSensitive:true });
  if (!uri) return bridgePingHost(cfg.host, cfg.port, likelyTLSForConfig(cfg), Math.min(timeoutMs, 10000), cfg.type);
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${base}/verify-config`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ uri, host:cfg.host, port:cfg.port, type:cfg.type, timeoutMs }),
      signal:ctrl.signal,
      cache:'no-store'
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return probeFromBridgePayload(data, 'bridge-verify-config', started);
  } catch { return null; }
  finally { clearTimeout(tid); }
}

function logConsole(level, msg) {
  const safeMsg = sanitizeLogMsg(msg);
  const lvlMap = {info:'INFO',success:'OK',warning:'WARN',error:'ERR'};
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const ss = String(now.getSeconds()).padStart(2,'0');
  const markup = `<span class="log-time">[${hh}:${mm}:${ss}]</span><span class="log-lvl">${lvlMap[level]||'INFO'}</span><span class="log-msg">${escHtml(safeMsg)}</span>`;
  const append = (el, cls) => {
    if (!el) return;
    const entry = document.createElement('div');
    entry.className = cls;
    entry.innerHTML = markup;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;
    while (el.children.length > 300) el.removeChild(el.firstChild);
  };
  append(document.getElementById('log-console'), `log-entry log-${level === 'warning' ? 'warning' : level === 'error' ? 'error' : level === 'success' ? 'success' : 'info'}`);
  append(document.getElementById('logOutput'), `log-line log-${level === 'warning' ? 'warning' : level === 'error' ? 'error' : level === 'success' ? 'success' : 'info'}`);
  phEmit('ph:log', { level, message: safeMsg, ts: Date.now() });
}

function toast(msg, type = 'info') {
  const c = document.getElementById('toastCont');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = {ok:'✓',err:'✗',warn:'⚠',info:'ℹ'};
  el.innerHTML = `<span>${icons[type]||'ℹ'}</span><span>${escHtml(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.35s'; setTimeout(() => el.remove(), 350); }, 3500);
}

// ============================================================
// INDEXEDDB — check existence, auto-create if missing, repair
//   stores if schema is incomplete (e.g. partial upgrade).
//   Uses indexedDB.databases() where available (Chrome/Firefox)
//   and falls back to a probe-open on older engines.
// ============================================================
const DB_NAME = 'proxyharvest_v8';
const DB_VER  = 2;
// All stores the application needs — add new ones here only.
const DB_STORES = [
  { name: 'configs',  opts: { keyPath: 'uid', autoIncrement: true } },
  { name: 'splitnet', opts: { keyPath: 'uid', autoIncrement: true } },
  { name: 'meta',     opts: { keyPath: 'key' } },
  { name: 'configSecrets', opts: { keyPath: 'uid' } },
  { name: 'testResults', opts: { keyPath: 'uid' } },
  { name: 'healingHistory', opts: { keyPath: 'id', autoIncrement: true } },
];
let db = null;

/**
 * Check whether DB_NAME already exists in this browser origin.
 * Returns true  → DB exists (may need upgrade)
 * Returns false → brand-new, must be created
 */
async function checkDBExists() {
  try {
    if (typeof indexedDB.databases === 'function') {
      // Modern API — Chrome 71+, Firefox 126+, Safari 16.4+
      const list = await indexedDB.databases();
      return list.some(d => d.name === DB_NAME);
    }
    // Fallback: probe open and watch for onupgradeneeded
    return await new Promise(resolve => {
      const probe = indexedDB.open(DB_NAME, DB_VER);
      let isNew   = false;
      probe.onupgradeneeded = () => { isNew = true; };
      probe.onsuccess = e  => { e.target.result.close(); resolve(!isNew); };
      probe.onerror   = () => resolve(false);
    });
  } catch { return false; }
}

/**
 * Ensure every required object-store exists inside an already-open
 * IDBDatabase handle.  Missing stores are recreated via a version bump.
 * Returns the (possibly new) db handle.
 */
function repairStores(existingDb) {
  const missing = DB_STORES.filter(s => !existingDb.objectStoreNames.contains(s.name));
  if (!missing.length) return Promise.resolve(existingDb);

  logConsole('warning', `DB repair: adding missing stores — ${missing.map(s => s.name).join(', ')}`);
  existingDb.close();
  const newVer = existingDb.version + 1;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, newVer);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      for (const store of DB_STORES) {
        if (!d.objectStoreNames.contains(store.name))
          d.createObjectStore(store.name, store.opts);
      }
    };
    req.onsuccess = e => { resolve(e.target.result); };
    req.onerror   = e => { logConsole('error', 'DB repair failed: ' + e.target.error); reject(e.target.error); };
  });
}

/**
 * Main entry-point called once at startup:
 *  1. Check whether the database exists.
 *  2. Open it (creates + initialises schema if brand-new).
 *  3. Verify all required stores are present; repair if not.
 *  4. Expose the ready handle via `db` and `window.__dbReady`.
 */
async function openDB() {
  try {
    const existed = await checkDBExists();
    if (!existed) {
      logConsole('info', `IndexedDB "${DB_NAME}" not found — creating fresh database…`);
      updateDBStatusUI('creating');
    } else {
      logConsole('info', `IndexedDB "${DB_NAME}" found — opening…`);
      updateDBStatusUI('opening');
    }

    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = e => {
        const d = e.target.result;
        const isCreate = e.oldVersion === 0;
        logConsole(isCreate ? 'success' : 'info',
          isCreate ? 'DB schema: creating all stores…' : 'DB schema: upgrading stores…'
        );
        for (const store of DB_STORES) {
          if (!d.objectStoreNames.contains(store.name)) {
            d.createObjectStore(store.name, store.opts);
            logConsole('info', `  ✓ store created: ${store.name}`);
          }
        }
      };

      req.onblocked = () => {
        logConsole('warning', 'DB open blocked — close other tabs running this app');
        toast('IndexedDB blocked — close other tabs', 'warn');
      };

      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });

    // Verify schema integrity and repair silently if needed
    db = await repairStores(db);

    window.__dbReady = true;
    const storeList = Array.from(db.objectStoreNames).join(', ');
    logConsole('success', `IndexedDB ready — stores: [${storeList}]`);
    updateDBStatusUI('ready', existed);
    return db;

  } catch(e) {
    logConsole('warning', `IndexedDB unavailable (${e.message || e}) — running session-only mode`);
    updateDBStatusUI('unavailable');
    db = null;
    return null;
  }
}

/** Update the DB status bar in the UI based on current DB state */
function updateDBStatusUI(state, existed) {
  const el = document.getElementById('dbStatusText');
  if (!el) return;
  const msgs = {
    creating:    'IndexedDB: creating new database…',
    opening:     'IndexedDB: opening existing database…',
    ready:       existed === false
                   ? 'IndexedDB: ✓ new database created — configs will persist across reloads'
                   : 'IndexedDB: ✓ active — configs persist across reloads',
    unavailable: 'IndexedDB: ✗ unavailable — session only (private browsing?)',
  };
  el.textContent = msgs[state] || 'IndexedDB: checking…';
  // Also update header badge colour
  const badge = document.getElementById('dbBadge');
  if (badge) {
    if (state === 'unavailable') {
      badge.style.background = 'var(--red-dim)';
      badge.style.borderColor = 'rgba(244,63,94,.3)';
      badge.style.color = 'var(--red)';
      badge.title = 'IndexedDB unavailable — session only';
    } else if (state === 'ready') {
      badge.style.background = '';
      badge.style.borderColor = '';
      badge.style.color = '';
      badge.title = existed === false
        ? 'IndexedDB created fresh this session'
        : 'Configs saved to IndexedDB';
    }
  }
}

async function dbSave(store, items) {
  if (!db) return;
  try {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    await new Promise(r => { const req = os.clear(); req.onsuccess = r; });
    for (const item of items) {
      const clean = cloneForPersistence(item);
      os.put(clean);
    }
    await new Promise((res,rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch(e) { logConsole('warning', 'DB save failed: ' + e.message); }
}

async function dbLoad(store) {
  if (!db) return [];
  try {
    const tx = db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    return await new Promise((res,rej) => {
      const req = os.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror   = () => res([]);
    });
  } catch { return []; }
}

async function dbSetMeta(key, value) {
  if (!db) return;
  try {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({key, value});
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch {}
}

async function dbGetMeta(key) {
  if (!db) return null;
  try {
    const tx = db.transaction('meta', 'readonly');
    return await new Promise(res => {
      const req = tx.objectStore('meta').get(key);
      req.onsuccess = () => res(req.result?.value ?? null);
      req.onerror   = () => res(null);
    });
  } catch { return null; }
}

// ============================================================
// STATE
// ============================================================
const S = {
  configs: [],
  splitnetConfigs: [],
  sources: [],
  globalSigs: new Set(),
  fetchRunning: false,
  stopReq: false,
  autoTimer: null,
  autoCountdownTimer: null,
  autoCountdownSec: 0,
  dohCache: new Map(),
  stats: { fetched: 0, failed: 0, tested: 0 },
  theme: 'dark',
    settings: {},
  configSearch: '',
  sortCol: 'score',
  sortDir: 'desc',
  splitnetFilter: '',
  splitnetSearch: '',
  warpKeySearch: '',
  endpointSearch: '',
  // IRCF data
  warpKeys: [],       // Warp+ licence keys from ircfspace/warpkey
  warpEndpoints: [],  // Clean Cloudflare IPs/endpoints from ircfspace/endpoint
  ircfConfigs: [],    // Free configs from ircfspace/tconfig
  viewMode: 'table',  // 'table' | 'compact'
};

// Premium UI bridge: read-only access to the canonical runtime state.
try { Object.defineProperty(window, 'PH_STATE', { configurable: true, get: () => S }); } catch (_) { window.PH_STATE = S; }
function phEmit(name, detail = {}) { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) {} }


// ============================================================
// IRCF.SPACE — Data URLs (ircfspace GitHub repos)
// Updated hourly automatically by IRCF project
// ============================================================
const IRCF_URLS = {
  // Warp+ licence keys — updated every 1h, 15 keys per file
  warpKeyLite:  'https://raw.githubusercontent.com/ircfspace/warpkey/main/plus/lite',
  warpKeyFull:  'https://raw.githubusercontent.com/ircfspace/warpkey/main/plus/full',
  // Clean Cloudflare endpoints for Warp/Oblivion
  endpointJson: 'https://raw.githubusercontent.com/ircfspace/endpoint/main/ip.json',
  endpointWg:   'https://raw.githubusercontent.com/ircfspace/endpoint/main/wg.txt',
  // Free v2ray/WireGuard configs from ircfspace/tconfig
  tconfig:      'https://raw.githubusercontent.com/ircfspace/tconfig/main/sub/mix',
  // CF IP ranges
  cfIpRanges:   'https://raw.githubusercontent.com/ircfspace/cf-ip-ranges/main/ipv4.txt',
};

// ============================================================
// SPLITNET / WARP FREE SUBSCRIPTION SOURCES
// Multi-CDN with mirrors so it works on bad internet
// ============================================================
const SPLITNET_SOURCES = [
  // IRCF official
  { name: 'IRCF WG Endpoints',     url: IRCF_URLS.endpointWg,   proto: 'wireguard' },
  { name: 'IRCF Free Configs',     url: IRCF_URLS.tconfig,       proto: 'mixed'     },
  // Community wireguard
  { name: 'WARP Free Tier',        url: 'https://raw.githubusercontent.com/MrMohebi/xray-proxy-grabber-telegram/master/collected-proxies/row-url/wireguard.txt', proto: 'wireguard' },
  { name: 'SplitNet WireGuard',    url: 'https://raw.githubusercontent.com/hamedeslami/wireguard/main/wireguard.txt', proto: 'wireguard' },
  // Mixed configs
  { name: 'Cloudflare WARP Mix',   url: 'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub1.txt',   proto: 'mixed'     },
  { name: 'SplitNet Mirror 1',     url: 'https://raw.githubusercontent.com/Surfboardv2ray/Proxy/refs/heads/main/Merged', proto: 'mixed' },
  // New 2025 sources
  { name: 'EbraSha All Configs',   url: 'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/refs/heads/main/all_extracted_configs.txt', proto: 'mixed' },
  { name: 'Mahdi0024 Collector',   url: 'https://raw.githubusercontent.com/Mahdi0024/ProxyCollector/main/sub/proxies.txt', proto: 'mixed' },
  { name: 'Firmfox Proxify',       url: 'https://raw.githubusercontent.com/Firmfox/Proxify/refs/heads/main/v2ray_configs/mixed/subscription-1.txt', proto: 'mixed' },
  { name: 'ALIILAPRO NG Config',   url: 'https://raw.githubusercontent.com/ALIILAPRO/v2rayNG-Config/main/server.txt', proto: 'mixed' },
  { name: '4n0nymou3 Multi',       url: 'https://raw.githubusercontent.com/4n0nymou3/multi-proxy-config-fetcher/refs/heads/main/configs/proxy_configs.txt', proto: 'mixed' },
  { name: 'Farid-Karimi Iran',     url: 'https://raw.githubusercontent.com/Farid-Karimi/Config-Collector/refs/heads/main/mixed_iran.txt', proto: 'mixed' },
  // Additional 2025 sources
  { name: 'NiREvil VLESS SVN',     url: 'https://raw.githubusercontent.com/NiREvil/vless/main/sub/SVN', proto: 'mixed' },
  { name: 'LalatinaHub Mineral',   url: 'https://raw.githubusercontent.com/LalatinaHub/Mineral/refs/heads/master/result/nodes', proto: 'mixed' },
  { name: 'snakem982 Proxypool',   url: 'https://raw.githubusercontent.com/snakem982/proxypool/main/source/v2ray.txt', proto: 'mixed' },
  { name: 'Epodonios VLESS',       url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Splitted-By-Protocol/vless.txt', proto: 'mixed' },
  { name: 'Epodonios VMess',       url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Splitted-By-Protocol/vmess.txt', proto: 'mixed' },
  { name: 'Epodonios Trojan',      url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Splitted-By-Protocol/trojan.txt', proto: 'mixed' },
  { name: 'MrPooyaX VpnsFucking',  url: 'https://raw.githubusercontent.com/MrPooyaX/VpnsFucking/main/Shenzo.txt', proto: 'mixed' },
  { name: 'Argh94 Hysteria2',      url: 'https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/Hysteria2.txt', proto: 'mixed' },
  { name: 'yebekhe TVC Mix',       url: 'https://raw.githubusercontent.com/yebekhe/TelegramV2rayCollector/main/sub/mix', proto: 'mixed' },
  { name: 'Barry-far Sub2',        url: 'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub2.txt', proto: 'mixed' },
  { name: 'Mahdibland Eternity',   url: 'https://raw.githubusercontent.com/mahdibland/ShadowsocksAggregator/master/Eternity.txt', proto: 'mixed' },
  { name: 'IranCypherpunks Sub',   url: 'https://raw.githubusercontent.com/IranianCypherpunks/sub/main/config', proto: 'mixed' },
];

// Mirror CDNs for worst-internet fallback (same content via different CDNs)
const CDN_MIRRORS = [
  (u) => `https://cdn.jsdelivr.net/gh/${u.replace('https://raw.githubusercontent.com/','').replace('/main/','/').replace('/master/','/').replace(/^([^/]+\/[^/]+)\/(.+)$/,'$1@main/$2')}`,
  (u) => `https://ghproxy.com/${u}`,
  (u) => `https://mirror.ghproxy.com/${u}`,
  (u) => `https://github.moeyy.xyz/${u}`,
];

// ============================================================
// MAHSA WIREGUARD CONFIG — PRE-LOADED
// ============================================================
const MAHSA_CONFIG_RAW = 'wireguard://WFrE2gfMmhhinkTwIbTj8ldoUn3zDDcfBH0scLLBk3U%3D@162.159.192.203:859?address=172.16.0.2%2F32&reserved=87%2C220%2C1&publickey=bmXOC%2BF1FxEMF9dyiK2H5%2F1SUtzH0JuVo51h2wPfgyo%3D&presharedkey=&mtu=1280&keepalive=5&wnoise=quic&wnoisecount=15&wnoisedelay=1-2&wpayloadsize=5-10#W+2026-04-09+23%3A21';

// ============================================================
// INFRASTRUCTURE DEFAULTS — Known-good Cloudflare edge values
// ============================================================
const INFRASTRUCTURE_DEFAULTS = {
  cleanIP:     '162.159.192.203',
  cleanPort:   859,
  cfPublicKey: 'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=',
  cfEdgeDomains: ['cloudflare.com','workers.dev','pages.dev','cdn-cgi.com'],
  defaultSNI:  'cloudflare.com',
};
// NOTE: Private key is server-side only — NEVER injected here.

// ============================================================
// WORKER CONFIG — Personal Cloudflare Worker (auto-fill source)
// ============================================================
const WORKER_CONFIG = {
  workerUrl:      'https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev',
  corsEndpoint:   'https://proxyharvest-gateway.amin-chinisaz-edu.workers.dev/?url=',
  mirrorBase:     '',
  workerName:     'proxyharvest-gateway',
  accountId:      '',
  apiToken:       '',
  dashboardUrl:   '',
  cleanIps:       ['zula.ir','icook.hk','www.visa.com','www.shopify.com','104.17.10.10','104.18.2.2','162.159.192.1'],
  defaultPorts:   [443, 8443, 2053, 2083, 2087, 2096],
  defaultProxyIp: 'cdn.xn--b6gac.eu.org',
};

const PH_LEGACY_WORKER_HOSTS = new Set([
  'small-thunder-6298.amin-chinisaz.workers.dev',
  'small-thunder-6298.amin-chinisaz-edu.workers.dev',
]);
function workerHostOf(raw) {
  try { return new URL(normalizeWorkerBase(raw)).hostname.toLowerCase(); } catch { return ''; }
}
function isLegacyWorkerUrl(raw) {
  const host = workerHostOf(raw);
  return !!host && PH_LEGACY_WORKER_HOSTS.has(host);
}
function canonicalWorkerUrl(raw) {
  const value = normalizeWorkerBase(raw);
  if (window.PROXYHARVEST_LOCAL_FILE_MODE) return WORKER_CONFIG.workerUrl;
  if (!value || isLegacyWorkerUrl(value)) return WORKER_CONFIG.workerUrl;
  return value;
}
function isLegacyBridgeUrl(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return !!value && /127\.0\.0\.1:8080|localhost:8080/.test(value);
}
function migrateLegacyTransportSettings() {
  if (PH_RUNTIME.transportMigrated) return;
  PH_RUNTIME.transportMigrated = true;

  const storedWorker = PH_STORAGE.get('cfg_worker_url') || '';
  if (!storedWorker || isLegacyWorkerUrl(storedWorker) || window.PROXYHARVEST_LOCAL_FILE_MODE) {
    PH_STORAGE.set('cfg_worker_url', WORKER_CONFIG.workerUrl);
  }

  const storedCors = PH_STORAGE.get('cfg_custom_cors') || '';
  if (!storedCors || /small-thunder-6298/i.test(storedCors)) {
    PH_STORAGE.set('cfg_custom_cors', WORKER_CONFIG.corsEndpoint);
  }

  const bridgeStored = PH_STORAGE.get('ph_real_ping_bridge') || '';
  if (window.PROXYHARVEST_LOCAL_FILE_MODE || isLegacyBridgeUrl(bridgeStored)) {
    PH_STORAGE.remove('ph_real_ping_bridge');
    PH_RUNTIME.localBridgeVerified = false;
  }

  try {
    const key = 'ph-settings-v8';
    const raw = PH_STORAGE.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (window.PROXYHARVEST_LOCAL_FILE_MODE || isLegacyBridgeUrl(parsed?.localBridgeUrl)) parsed.localBridgeUrl = '';
      PH_STORAGE.set(key, JSON.stringify(parsed));
    }
  } catch {}

  PH_STORAGE.set('ph_transport_migration', '15.0.0-network-canonical');
}

// ============================================================
// DEFAULT SOURCES
// ============================================================
const DEFAULT_SOURCES = [
  {name:'Mahsa WARP WG',          url:'https://raw.githubusercontent.com/MrMohebi/xray-proxy-grabber-telegram/master/collected-proxies/row-url/all.txt'},
  {name:'Hamedeslami WireGuard',  url:'https://raw.githubusercontent.com/hamedeslami/wireguard/main/wireguard.txt'},
  {name:'IRCF WireGuard',         url:'https://raw.githubusercontent.com/ircfspace/endpoint/main/wg.txt'},
  {name:'Barry-far All',          url:'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/All_Configs_Sub.txt'},
  {name:'Barry-far Sub1',         url:'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub1.txt'},
  {name:'Barry-far Sub2',         url:'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub2.txt'},
  {name:'Mahdibland Eternity',    url:'https://raw.githubusercontent.com/mahdibland/ShadowsocksAggregator/master/Eternity.txt'},
  {name:'Mahdibland SSAgg',       url:'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge_base64.txt'},
  {name:'yebekhe TVC Merged',     url:'https://raw.githubusercontent.com/yebekhe/TelegramV2rayCollector/main/sub/mix'},
  {name:'yebekhe TVC Config',     url:'https://raw.githubusercontent.com/yebekhe/TelegramV2rayCollector/main/sub/base64'},
  {name:'IranianCypherpunks Mix', url:'https://raw.githubusercontent.com/IranianCypherpunks/sub/main/config'},
  {name:'Peasoft NoMoreWalls',    url:'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.txt'},
  {name:'Roosterkid V2RAY',       url:'https://raw.githubusercontent.com/roosterkid/openproxylist/main/V2RAY_RAW.txt'},
  {name:'Aiboboxx V2rayfree',     url:'https://raw.githubusercontent.com/aiboboxx/v2rayfree/main/v2'},
  {name:'Surfboard Merged',       url:'https://raw.githubusercontent.com/Surfboardv2ray/Proxy/refs/heads/main/Merged'},
  {name:'Surfboard VMess',        url:'https://raw.githubusercontent.com/Surfboardv2ray/TGParse/main/splitted/vmess'},
  {name:'Surfboard VLess',        url:'https://raw.githubusercontent.com/Surfboardv2ray/TGParse/main/splitted/vless'},
  {name:'Surfboard Trojan',       url:'https://raw.githubusercontent.com/Surfboardv2ray/TGParse/main/splitted/trojan'},
  {name:'SoliSpirit All',         url:'https://raw.githubusercontent.com/SoliSpirit/v2ray-configs/main/all_configs.txt'},
  {name:'AzadNet Telegram',       url:'https://raw.githubusercontent.com/AzadNet/Telegram_V2RAY/main/config'},
  {name:'Mheidari Proxy',         url:'https://raw.githubusercontent.com/mheidari98/.proxy/main/all'},
  {name:'VxiaoV Free',            url:'https://raw.githubusercontent.com/vxiaov/free_proxies/main/v2ray/v2ray.share.txt'},
  {name:'ZywChannel Free',        url:'https://raw.githubusercontent.com/ZywChannel/free/main/sub'},
  {name:'W1770946466 Sub1',       url:'https://raw.githubusercontent.com/w1770946466/Auto_proxy/main/Long_term_subscription1'},
  {name:'W1770946466 Sub2',       url:'https://raw.githubusercontent.com/w1770946466/Auto_proxy/main/Long_term_subscription2'},
  // ── NEW SOURCES (2025) ──
  {name:'EbraSha V2Ray All',      url:'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/refs/heads/main/all_extracted_configs.txt'},
  {name:'EbraSha V2Ray List',     url:'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/refs/heads/main/V2Ray-Config-By-EbraSha.txt'},
  {name:'Mahdi0024 ProxyCollector',url:'https://raw.githubusercontent.com/Mahdi0024/ProxyCollector/main/sub/proxies.txt'},
  {name:'Firmfox Proxify Mix1',   url:'https://raw.githubusercontent.com/Firmfox/Proxify/refs/heads/main/v2ray_configs/mixed/subscription-1.txt'},
  {name:'Firmfox Proxify Mix2',   url:'https://raw.githubusercontent.com/Firmfox/Proxify/refs/heads/main/v2ray_configs/mixed/subscription-2.txt'},
  {name:'Epodonios VMess',        url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Splitted-By-Protocol/vmess.txt'},
  {name:'Epodonios VLess',        url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Splitted-By-Protocol/vless.txt'},
  {name:'Epodonios Trojan',       url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Splitted-By-Protocol/trojan.txt'},
  {name:'Epodonios SS',           url:'https://raw.githubusercontent.com/Epodonios/v2ray-configs/refs/heads/main/Splitted-By-Protocol/ss.txt'},
  {name:'NiREvil VLESS',          url:'https://raw.githubusercontent.com/NiREvil/vless/main/sub/SVN'},
  {name:'ALIILAPRO V2rayNG',      url:'https://raw.githubusercontent.com/ALIILAPRO/v2rayNG-Config/main/server.txt'},
  {name:'4n0nymou3 Multi-Proxy',  url:'https://raw.githubusercontent.com/4n0nymou3/multi-proxy-config-fetcher/refs/heads/main/configs/proxy_configs.txt'},
  {name:'Farid-Karimi Iran Mix',  url:'https://raw.githubusercontent.com/Farid-Karimi/Config-Collector/refs/heads/main/mixed_iran.txt'},
  {name:'LalatinaHub Mineral',    url:'https://raw.githubusercontent.com/LalatinaHub/Mineral/refs/heads/master/result/nodes'},
  {name:'snakem982 Proxypool',    url:'https://raw.githubusercontent.com/snakem982/proxypool/main/source/v2ray.txt'},
  {name:'F0rc3Run XX',            url:'https://raw.githubusercontent.com/10ium/MihomoSaz/main/Sublist/F0rc3Run_XX.yaml'},
  {name:'Argh94 VMess',           url:'https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/Vmess.txt'},
  {name:'Argh94 Hysteria2',       url:'https://raw.githubusercontent.com/Argh94/V2RayAutoConfig/refs/heads/main/configs/Hysteria2.txt'},
  {name:'MrPooyaX VpnsFucking',   url:'https://raw.githubusercontent.com/MrPooyaX/VpnsFucking/main/Shenzo.txt'},
];

const PROTOS = ['vmess://','vless://','trojan://','ss://','ssr://','hysteria2://','hy2://','tuic://','wireguard://'];

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://cors-anywhere.herokuapp.com/',
  'https://thingproxy.freeboard.io/fetch/',
  'https://proxy.cors.sh/',
  'https://cors.eu.org/',
  'https://api.codetabs.com/v1/proxy?quest='
];

const DOH_RESOLVERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
  'https://doh.opendns.com/dns-query',
  'https://dns.quad9.net:5053/dns-query',
  // Additional resolvers (UPGRADE-04)
  'https://dns.quad9.net/dns-query',
  'https://doh.dns.sb/dns-query',
  'https://dns.nextdns.io/dns-query',
  'https://doh.libredns.gr/dns-query',
  'https://private.canadianshield.cira.ca/dns-query',
  'https://dns.comss.one/dns-query',
  'https://doh-de.blahdns.com/dns-query',
  'https://doh-jp.blahdns.com/dns-query',
];

// ============================================================
// CORS PROXY POOL — Tiered with fail-tracking (UPGRADE-02)
// ============================================================
const CORS_PROXY_POOL = {
  tier1: [], // populated from "My Infrastructure" panel (user's CF Worker)
  tier2: [], // additional user-provided proxies
  tier3: [
    { id:'corsproxy-io',  url:'https://corsproxy.io/?',                    active:!window.PROXYHARVEST_LOCAL_FILE_MODE, failed:false, failCount:0 },
    { id:'allorigins',    url:'https://api.allorigins.win/raw?url=',        active:!window.PROXYHARVEST_LOCAL_FILE_MODE, failed:false, failCount:0 },
    { id:'codetabs',      url:'https://api.codetabs.com/v1/proxy?quest=',  active:!window.PROXYHARVEST_LOCAL_FILE_MODE, failed:false, failCount:0 },
    { id:'cors-anywhere', url:'https://cors-anywhere.herokuapp.com/',       active:!window.PROXYHARVEST_LOCAL_FILE_MODE, failed:false, failCount:0 },
    { id:'thingproxy',    url:'https://thingproxy.freeboard.io/fetch/',     active:!window.PROXYHARVEST_LOCAL_FILE_MODE, failed:false, failCount:0 },
    { id:'proxy-cors-sh', url:'https://proxy.cors.sh/',                    active:!window.PROXYHARVEST_LOCAL_FILE_MODE, failed:false, failCount:0 },
    { id:'cors-eu',       url:'https://cors.eu.org/',                      active:!window.PROXYHARVEST_LOCAL_FILE_MODE, failed:false, failCount:0 },
  ],
  _idx: 0,
  next() {
    const all = [...this.tier1, ...this.tier2, ...this.tier3];
    const available = all.filter(p => p.active && p.failCount <= 3);
    if (!available.length) {
      all.forEach(p => { p.failCount = 0; p.failed = false; });
      return all.find(p => p.active) || null;
    }
    const idx = this._idx % available.length;
    this._idx = idx + 1;
    return available[idx];
  }
};

function getActiveCorsProxies() {
  return [
    ...CORS_PROXY_POOL.tier1,
    ...CORS_PROXY_POOL.tier2,
    ...CORS_PROXY_POOL.tier3,
  ].filter(p => p.active && p.failCount <= 3);
}

function markProxyFailed(id) {
  const all = [...CORS_PROXY_POOL.tier1, ...CORS_PROXY_POOL.tier2, ...CORS_PROXY_POOL.tier3];
  const proxy = all.find(p => p.id === id);
  if (proxy) { proxy.failCount++; proxy.failed = proxy.failCount > 3; }
}

function showNotification(msg, type = 'ok') { toast(msg, type); }

// ============================================================
// EXPONENTIAL BACKOFF WITH JITTER
// ============================================================
async function backoffDelay(retryCount) {
  const base  = 1500;
  const jitter = Math.floor(Math.random() * 501);
  const delay  = Math.min(base * Math.pow(2, retryCount) + jitter, 30000);
  return new Promise(r => setTimeout(r, delay));
}

// ============================================================
// SVG ICON SYSTEM
// ============================================================
function getIcon(name, colorCode, size = 16) {
  const base = `width="${size}" height="${size}" viewBox="0 0 24 24" stroke-width="1.8" fill="none" stroke="${colorCode}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  const paths = {
    'check-circle':  '<circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/>',
    'x-circle':      '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
    'shield-star':   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polygon points="12,7 13.5,10.5 17,11 14.5,13.5 15,17 12,15.5 9,17 9.5,13.5 7,11 10.5,10.5"/>',
    'shield-lock':   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><rect x="9" y="11" width="6" height="5" rx="1"/><path d="M10 11V9a2 2 0 014 0v2"/>',
    'shield-slash':  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="4" y1="4" x2="20" y2="20"/>',
    'shield':        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'lightning':     '<polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>',
    'cube':          '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27,6.96 12,12.01 20.73,6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    'horse':         '<path d="M17 3h2a2 2 0 012 2v2M3 17l1 4h4l1-4M3 17a5 5 0 015-5h6a5 5 0 015 5"/><path d="M13 12V7a2 2 0 00-2-2H9a2 2 0 00-2 2v5"/><path d="M19 5l-3 3-2-2"/>',
    'key':           '<circle cx="8" cy="15" r="4"/><line x1="21" y1="3" x2="11.5" y2="12.5"/><line x1="17" y1="7" x2="20" y2="4"/><line x1="14" y1="10" x2="17" y2="7"/>',
    'hexagon':       '<polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/>',
    'rocket':        '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>',
    'layers':        '<polygon points="12,2 2,7 12,12 22,7"/><polyline points="2,17 12,22 22,17"/><polyline points="2,12 12,17 22,12"/>',
    'zap':           '<polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>',
    'zap-fill':      `<polygon points="13,2 3,14 12,14 11,22 21,10 12,10" fill="${colorCode}" stroke="none"/>`,
    'clock':         '<circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>',
    'snail':         '<path d="M2 13a6 6 0 1012 0 4 4 0 10-8 0 2 2 0 004 0"/><polyline points="7,19 5,22 9,22"/><path d="M16 12h4l2-2-2-2h-4"/>',
    'chevron':       '<polyline points="6,9 12,15 18,9"/>',
    'globe-check':   '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/><path d="M8 16l2 2 4-4"/>',
    'globe-x':       '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/><path d="M10 10l4 4M14 10l-4 4"/>',
    'star-filled':   `<polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="${colorCode}"/>`,
    'star-half':     `<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77V2z" fill="${colorCode}"/><path d="M12 2L8.91 8.26 2 9.27l5 4.87L5.82 21.02 12 17.77V2z"/>`,
    'star-empty':    '<polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>',
    'clipboard':     '<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
    'copy':          '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    'trash':         '<polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
    'spinner':       '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
    'warning':       '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'info':          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    'wifi':          '<path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    'wifi-off':      '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/><path d="M5 12.55a11 11 0 015.17-2.39"/><path d="M10.71 5.05A16 16 0 0122.56 9"/><path d="M1.42 9a15.91 15.91 0 014.7-2.88"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    'download':      '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'refresh':       '<polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>',
    'splitnet':      '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    'database':      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    'activity':      '<polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>',
    'search':        '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    'health':        '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    'pencil':        '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    'eye':           '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'qr':            '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/><path d="M14 14h3v3M14 17h1M17 17v-1"/>',
    'xmark':         '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'filter':        '<polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/>',
    'test':          '<path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v11l3 3 3-3V3M9 14H5a2 2 0 01-2-2V8m16 0v4a2 2 0 01-2 2h-4"/>',
    'doh':           '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/><path d="M9 12l2 2 4-4"/>',
  };
  const path = paths[name] || paths['info'];
  return `<svg ${base}>${path}</svg>`;
}

function getProtoIcon(type, size = 16) {
  const BLUE = '#22D3EE'; const YELLOW = '#FCD34D'; const RED = '#FB7185';
  const map = {
    vless:['lightning',BLUE], vmess:['cube',BLUE], trojan:['horse',BLUE],
    ss:['key',YELLOW], ssr:['key',RED], wireguard:['hexagon',BLUE],
    hy2:['rocket',BLUE], tuic:['layers',BLUE],
  };
  const [iconName, color] = map[type] || ['info', BLUE];
  return getIcon(iconName, color, size);
}

function getSecurityIcon(security, type, size = 16) {
  const GREEN='#34D399', RED='#FB7185', GRAY='#3D5A7A';
  if (security==='reality') return getIcon('shield-star', GREEN, size);
  if (security==='tls') return getIcon('shield-lock', GREEN, size);
  if (type==='wireguard') return getIcon('hexagon', GREEN, size);
  if (security==='none' && type!=='wireguard') return getIcon('shield-slash', RED, size);
  return getIcon('shield', GRAY, size);
}

function getLatencyIcon(ms) {
  const GREEN='#34D399',YELLOW='#FCD34D',RED='#FB7185',GRAY='#3D5A7A';
  if (ms==null||isNaN(ms)) return getIcon('clock', GRAY);
  if (ms<200) return getIcon('zap', GREEN);
  if (ms<1000) return getIcon('clock', YELLOW);
  return getIcon('warning', RED);
}

function getScoreIcon(score) {
  const GREEN='#34D399',YELLOW='#FCD34D',RED='#FB7185';
  if (score>=70) return getIcon('star-filled', GREEN);
  if (score>=40) return getIcon('star-half', YELLOW);
  return getIcon('star-empty', RED);
}

// ============================================================
// BUILD URI FROM CONFIG
// ============================================================
function buildUriFromConfig(cfg) {
  if (cfg.raw && !hasRedactedRaw(cfg)) return cfg.raw;
  try {
    if (cfg.type==='wireguard') {
      if (!configHasSessionSecret(cfg)) return '';
      const pk = encodeURIComponent(cfg._privateKeyRaw);
      let uri = `wireguard://${pk}@${cfg.host}:${cfg.port}?`;
      const params = [];
      if (cfg.publicKey)    params.push(`publickey=${encodeURIComponent(cfg.publicKey)}`);
      if (cfg.presharedKey) params.push(`presharedkey=${encodeURIComponent(cfg.presharedKey)}`);
      if (cfg.address)      params.push(`address=${encodeURIComponent(cfg.address)}`);
      if (cfg.reserved)     params.push(`reserved=${encodeURIComponent(cfg.reserved)}`);
      if (cfg.mtu)          params.push(`mtu=${cfg.mtu}`);
      if (cfg.keepalive)    params.push(`keepalive=${cfg.keepalive}`);
      if (cfg.wnoise)       params.push(`wnoise=${cfg.wnoise}`);
      if (cfg.wnoisecount)  params.push(`wnoisecount=${cfg.wnoisecount}`);
      if (cfg.wnoisedelay)  params.push(`wnoisedelay=${cfg.wnoisedelay}`);
      if (cfg.wpayloadsize) params.push(`wpayloadsize=${cfg.wpayloadsize}`);
      uri += params.join('&');
      if (cfg.remarks) uri += '#' + encodeURIComponent(cfg.remarks);
      return uri;
    }
    if (cfg.type==='vmess') {
      const obj = {ps:cfg.remarks||'',add:cfg.host,port:cfg.port,id:cfg.id,net:cfg.net,tls:cfg.security==='tls'?'tls':'',sni:cfg.sni,path:cfg.path};
      return 'vmess://' + btoa(JSON.stringify(obj));
    }
    if (cfg.type==='vless') {
      let uri = `vless://${cfg.id}@${cfg.host}:${cfg.port}?security=${cfg.security||'none'}&type=${cfg.net||'tcp'}`;
      if (cfg.sni)  uri+=`&sni=${encodeURIComponent(cfg.sni)}`;
      if (cfg.flow) uri+=`&flow=${cfg.flow}`;
      if (cfg.pbk)  uri+=`&pbk=${encodeURIComponent(cfg.pbk)}`;
      if (cfg.fp)   uri+=`&fp=${cfg.fp}`;
      if (cfg.path) uri+=`&path=${encodeURIComponent(cfg.path)}`;
      if (cfg.remarks) uri+='#'+encodeURIComponent(cfg.remarks);
      return uri;
    }
    if (cfg.type==='trojan') {
      let uri = `trojan://${cfg.id}@${cfg.host}:${cfg.port}?security=tls`;
      if (cfg.sni) uri+=`&sni=${encodeURIComponent(cfg.sni)}`;
      if (cfg.net) uri+=`&type=${cfg.net}`;
      if (cfg.remarks) uri+='#'+encodeURIComponent(cfg.remarks);
      return uri;
    }
    if (cfg.type === 'hy2') {
      let uri = `hy2://${cfg.id}@${cfg.host}:${cfg.port}?security=tls`;
      if (cfg.sni) uri += `&sni=${encodeURIComponent(cfg.sni)}`;
      if (cfg.remarks) uri += '#' + encodeURIComponent(cfg.remarks);
      return uri;
    }
    if (cfg.type === 'tuic') {
      let uri = `tuic://${cfg.id}@${cfg.host}:${cfg.port}`;
      if (cfg.remarks) uri += '#' + encodeURIComponent(cfg.remarks);
      return uri;
    }
    if (['ss','ssr'].includes(cfg.type)) return cfg.raw||'';
  } catch {}
  return cfg.raw||'';
}

// ============================================================
// INFRASTRUCTURE CONFIG — reads from localStorage / UI
// ============================================================
function getUserInfrastructure() {
  const workerUrl = canonicalWorkerUrl(PH_STORAGE.get('cfg_worker_url') || WORKER_CONFIG.workerUrl);
  return {
    workerUrl,
    cleanIP:               PH_STORAGE.get('cfg_clean_ip')      || INFRASTRUCTURE_DEFAULTS.cleanIP,
    cleanPort:             parseInt(PH_STORAGE.get('cfg_clean_port') || INFRASTRUCTURE_DEFAULTS.cleanPort),
    realityPubKey:         PH_STORAGE.get('cfg_reality_key')   || INFRASTRUCTURE_DEFAULTS.cfPublicKey,
    customSNI:             PH_STORAGE.get('cfg_custom_sni')    || '',
    customCors:            window.PROXYHARVEST_LOCAL_FILE_MODE ? WORKER_CONFIG.corsEndpoint : (PH_STORAGE.get('cfg_custom_cors') || WORKER_CONFIG.corsEndpoint || ''),
    mirrorBase:            window.PROXYHARVEST_LOCAL_FILE_MODE ? '' : (PH_STORAGE.get('cfg_mirror_base') || WORKER_CONFIG.mirrorBase || ''),
    forceWorker:           window.PROXYHARVEST_LOCAL_FILE_MODE || PH_STORAGE.get('cfg_force_worker') === 'true',
    useCleanIP:            PH_STORAGE.get('cfg_use_clean_ip')  === 'true',
    routeDoHthroughWorker: PH_STORAGE.get('cfg_doh_via_worker') === 'true',
  };
}

function saveInfrastructureConfig() {
  const get = id => document.getElementById(id)?.value?.trim() || '';
  const chk = id => document.getElementById(id)?.checked || false;

  PH_STORAGE.set('cfg_worker_url',    canonicalWorkerUrl(get('cfg-worker-url') || WORKER_CONFIG.workerUrl));
  PH_STORAGE.set('cfg_clean_ip',      get('cfg-clean-ip'));
  PH_STORAGE.set('cfg_clean_port',    get('cfg-clean-port'));
  PH_STORAGE.set('cfg_reality_key',   get('cfg-reality-pubkey'));
  PH_STORAGE.set('cfg_custom_sni',    get('cfg-custom-sni'));
  PH_STORAGE.set('cfg_custom_cors',   window.PROXYHARVEST_LOCAL_FILE_MODE ? WORKER_CONFIG.corsEndpoint : get('cfg-custom-cors'));
  PH_STORAGE.set('cfg_mirror_base',   get('cfg-mirror-base'));
  PH_STORAGE.set('cfg_force_worker',  String(chk('cfg-force-worker')));
  PH_STORAGE.set('cfg_use_clean_ip',  String(chk('cfg-use-clean-ip')));
  PH_STORAGE.set('cfg_doh_via_worker',String(chk('cfg-doh-via-worker')));

  // Tokens are intentionally session-only: never persist API/subscription secrets in localStorage.
  try { PH_STORAGE.remove('infraConfig_extras'); } catch {}

  // Rebuild tier-1 proxy pool from new URL
  const newWorker = get('cfg-worker-url');
  if (newWorker) {
    CORS_PROXY_POOL.tier1 = [{
      id: 'user-worker', name: 'My CF Worker',
      // Tiered CORS expects a raw-body prefix. /fetch-sub returns JSON and is
      // reserved for the dedicated Worker attempt in resilientFetch().
      url: normalizeWorkerBase(newWorker) + '/?url=', active: true, failed: false, failCount: 0,
    }];
  } else {
    CORS_PROXY_POOL.tier1 = [];
  }

  toast('Infrastructure config saved ✓', 'ok');
  logConsole('success', 'Infrastructure config saved to localStorage');
}

// ── Fill all infra form fields from a config object ──────────
function fillInfraFields(cfg) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) {
      el.value = val;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  set('cfg-worker-url',      cfg.workerUrl);
  set('cfg-worker-apitoken', ''); // API tokens are not injected into the client
  set('cfg-clean-ip',        cfg.cleanIps ? cfg.cleanIps[0] : '162.159.192.1');
  set('cfg-clean-port',      '443');
  let workerHost = '';
  try { workerHost = cfg.workerUrl ? new URL(cfg.workerUrl).hostname : ''; } catch {}
  set('cfg-custom-sni',      workerHost || (cfg.workerName ? cfg.workerName + '.workers.dev' : ''));
  set('cfg-custom-cors',     cfg.corsEndpoint);
  set('cfg-mirror-base',     cfg.mirrorBase);
  chk('cfg-force-worker',   true);
  chk('cfg-doh-via-worker', true);
  chk('cfg-use-clean-ip',   false);
  logConsole('success', `✦ Infrastructure auto-filled from Worker: ${cfg.workerName}`);
}

// ── Inject the personal Worker as tier-1 in the CORS pool ────
function injectWorkerIntoCorsPool(workerUrl) {
  if (!workerUrl) return;
  const already = CORS_PROXY_POOL.tier1.find(p => p.id === 'my-worker');
  if (!already) {
    CORS_PROXY_POOL.tier1.unshift({
      id: 'my-worker', name: 'My CF Worker (auto)',
      url: normalizeWorkerBase(workerUrl) + '/?url=', active: true, failed: false, failCount: 0,
    });
    logConsole('info', '✦ Personal Worker injected into CORS pool tier-1');
  }
}

// ── Test worker connectivity and update the status badge ─────
async function testWorkerConnection() {
  const urlEl = document.getElementById('cfg-worker-url');
  const url   = urlEl?.value?.trim() || WORKER_CONFIG.workerUrl;
  const badge = document.getElementById('worker-status');
  if (!url) { if (badge) badge.textContent = '⚠ No URL set'; return; }
  if (badge) { badge.textContent = '⟳ Testing…'; badge.style.color = 'var(--yellow)'; }
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(tid);
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (badge) {
        badge.textContent = '● Online';
        badge.style.color = 'var(--green)';
        badge.title = json ? JSON.stringify(json) : 'Worker responding';
      }
      toast('Worker online ✓', 'ok');
      logConsole('success', `Worker health OK: ${url}/health`);
      return;
    }
  } catch { /* worker may block direct browser fetch */ }
  if (badge) {
    badge.textContent = '● Configured';
    badge.style.color = 'var(--cyan)';
    badge.title = 'Worker URL set — test from App';
  }
}

// ── Inject "Auto-Fill from Cloudflare" button into infra tab ─
function injectAutoFillButton() {
  const section = document.querySelector('#tab-infrastructure .infra-section');
  if (!section || document.getElementById('btnAutoFillInfra')) return;
  const btn = document.createElement('button');
  btn.id = 'btnAutoFillInfra';
  btn.className = 'btn btn-primary';
  btn.style.cssText = 'margin-bottom:12px;font-size:.72rem;padding:6px 14px';
  btn.innerHTML = '⚡ Auto-Fill from Cloudflare Worker';
  btn.title = `Auto-fill from worker: ${WORKER_CONFIG.workerName}`;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '⟳ Filling…';
    fillInfraFields(WORKER_CONFIG);
    injectWorkerIntoCorsPool(WORKER_CONFIG.workerUrl);
    await testWorkerConnection();
    btn.disabled = false;
    btn.innerHTML = '✓ Auto-Filled from Cloudflare Worker';
    setTimeout(() => { btn.innerHTML = '⚡ Auto-Fill from Cloudflare Worker'; }, 3000);
  });
  section.parentElement.insertBefore(btn, section);
}

// ── Add "Worker deployed" notice + dashboard link ────────────
function updateDeploySection() {
  const instrList = document.querySelector('.worker-script-section ol');
  if (instrList && !instrList.querySelector('.worker-deployed-note')) {
    const li = document.createElement('li');
    li.className = 'worker-deployed-note';
    if (!WORKER_CONFIG.workerUrl) return;
    li.innerHTML = `Configured worker endpoint: <a href="${WORKER_CONFIG.workerUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--green)">${WORKER_CONFIG.workerUrl}</a>`;
    li.style.color = 'var(--green)';
    instrList.prepend(li);
  }
  const deploySection = document.querySelector('#tab-infrastructure .infra-section:last-of-type');
  if (!WORKER_CONFIG.dashboardUrl) return;
  if (deploySection && !document.getElementById('workerDashboardLink')) {
    const linkDiv = document.createElement('div');
    linkDiv.id = 'workerDashboardLink';
    linkDiv.style.cssText = 'margin-top:10px;padding:8px 12px;background:var(--cyan-dim);border:1px solid var(--border);border-radius:var(--r);font-size:.7rem';
    linkDiv.innerHTML = `
      <span style="color:var(--cyan)">☁ Active Worker:</span>
      <a href="${WORKER_CONFIG.dashboardUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--green);margin-left:6px">
        ${WORKER_CONFIG.workerName} — Open Cloudflare Dashboard ↗
      </a>
      <span style="color:var(--text3);margin-left:8px">|</span>
      <a href="${WORKER_CONFIG.workerUrl}/__admin" target="_blank" rel="noopener noreferrer" style="color:var(--purple);margin-left:6px">
        Admin Panel ↗
      </a>`;
    deploySection.appendChild(linkDiv);
  }
}

const WORKER_V2_SCRIPT = `const ALLOWED_HOSTS = new Set(['raw.githubusercontent.com','cdn.jsdelivr.net','fastly.jsdelivr.net','gcore.jsdelivr.net','github.moeyy.xyz','mirror.ghproxy.com','ghproxy.com']);
const PRIVATE_IP_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.|0\.|::1|fc00:|fd00:|fe80:)/i;
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, X-PH-Signature', 'Cache-Control':'no-store' }}); }
function ensureAllowedUrl(raw) { const u = new URL(raw); if (!['https:','http:'].includes(u.protocol)) throw new Error('unsupported protocol'); if (PRIVATE_IP_RE.test(u.hostname)) throw new Error('private target blocked'); if (!ALLOWED_HOSTS.has(u.hostname) && !u.hostname.endsWith('.githubusercontent.com')) throw new Error('host not allowlisted'); return u; }
export default { async fetch(request) { if (request.method === 'OPTIONS') return json({ ok:true }); const url = new URL(request.url); try { if (url.pathname === '/health') return json({ ok:true, service:'ProxyHarvest Fetch Gateway v2' }); if (url.pathname === '/probe') { const host = url.searchParams.get('host') || ''; const port = Number(url.searchParams.get('port') || 443); if (!host || PRIVATE_IP_RE.test(host)) return json({ ok:false, error:'blocked-host' }, 400); const target = new URL('https://' + host + ':' + port + '/'); const started = Date.now(); const res = await fetch(target, { method:'GET', redirect:'manual', cf:{ cacheTtl:0 } }); return json({ ok:true, reachable:true, status:res.status, latencyMs:Date.now()-started }); } if (url.pathname === '/fetch-sub') { const target = ensureAllowedUrl(url.searchParams.get('url') || ''); const started = Date.now(); const res = await fetch(target, { headers:{ 'User-Agent':'ProxyHarvest/10', 'Accept':'text/plain,*/*' }, cf:{ cacheTtl:300 } }); const body = await res.text(); if (body.length > 2000000) return json({ ok:false, error:'response-too-large' }, 413); return json({ ok:res.ok, status:res.status, latencyMs:Date.now()-started, text:body }); } return json({ ok:false, error:'unknown-route' }, 404); } catch (e) { return json({ ok:false, error:e.message }, 502); } } };`;

function copyWorkerScript() {
  const scriptEl = document.getElementById('worker-script-display');
  const script = scriptEl ? scriptEl.textContent : WORKER_V2_SCRIPT;
  navigator.clipboard.writeText(script.trim())
    .then(() => { toast('Worker script copied to clipboard ✓', 'ok'); logConsole('success', 'Worker script copied'); })
    .catch(() => { toast('Copy failed — please copy manually', 'err'); });
}

function loadInfrastructureUI() {
  const cfg = getUserInfrastructure();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

  // If no saved Worker URL, auto-fill from WORKER_CONFIG defaults
  const hasStoredConfig = !!canonicalWorkerUrl(PH_STORAGE.get('cfg_worker_url') || WORKER_CONFIG.workerUrl);
  if (!hasStoredConfig) {
    fillInfraFields(WORKER_CONFIG);
    injectWorkerIntoCorsPool(WORKER_CONFIG.workerUrl);
    logConsole('info', '\u2726 No saved infra config \u2014 auto-filled from Worker defaults');
    setTimeout(() => { injectAutoFillButton(); updateDeploySection(); testWorkerConnection(); }, 800);
    return;
  }

  set('cfg-worker-url',     cfg.workerUrl);
  set('cfg-clean-ip',       cfg.cleanIP);
  set('cfg-clean-port',     cfg.cleanPort);
  set('cfg-reality-pubkey', cfg.realityPubKey);
  set('cfg-custom-sni',     cfg.customSNI);
  set('cfg-custom-cors',    cfg.customCors);
  set('cfg-mirror-base',    cfg.mirrorBase);
  chk('cfg-force-worker',   cfg.forceWorker);
  chk('cfg-use-clean-ip',   cfg.useCleanIP);
  chk('cfg-doh-via-worker', cfg.routeDoHthroughWorker);

  // Restore tier-1 Worker proxy if URL is saved
  if (cfg.workerUrl) {
    injectWorkerIntoCorsPool(cfg.workerUrl);
  }

  // Inject UI extras (button + dashboard link) after DOM is ready
  setTimeout(() => { injectAutoFillButton(); updateDeploySection(); }, 800);
}

// ============================================================
// MIRROR URL BUILDER — GitHub raw URL → CDN alternatives (UPGRADE-03)
// ============================================================
function buildMirrorUrls(originalUrl) {
  const cfg = getUserInfrastructure();
  if (window.PROXYHARVEST_LOCAL_FILE_MODE) return [];
  const mirrors = [];
  const ghRawPattern = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;
  const match = originalUrl.match(ghRawPattern);
  if (match) {
    const [, user, repo, branch, path] = match;
    mirrors.push(
      `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`,
      `https://fastly.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`,
      `https://gcore.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`,
      `https://ghproxy.com/${originalUrl}`,
      `https://mirror.ghproxy.com/${originalUrl}`,
      `https://github.moeyy.xyz/${originalUrl}`,
      `https://raw.githubusercontents.com/${user}/${repo}/${branch}/${path}`,
    );
  }
  if (cfg.mirrorBase) mirrors.push(`${cfg.mirrorBase}${encodeURIComponent(originalUrl)}`);
  return mirrors;
}

// ============================================================
// OFFLINE-FIRST FETCH — tries local cache first, then network
// Stale-while-revalidate pattern for maximum resilience
// ============================================================
const FETCH_CACHE = new Map(); // in-memory cache keyed by URL

async function fetchWithCache(url, forceRefresh = false) {
  const cacheKey = `fetch:${url}`;

  // Return cache immediately if available (stale-while-revalidate)
  if (!forceRefresh && FETCH_CACHE.has(cacheKey)) {
    const cached = FETCH_CACHE.get(cacheKey);
    const age = Date.now() - cached.ts;
    if (age < 30 * 60 * 1000) { // 30 min freshness
      logConsole('info', `Cache hit: ${url.slice(0, 50)}`);
      phEmit('ph:route', { stage:'cache', status:'success', strategy:'cache', url });
      return { text: cached.text, strategy: 'cache' };
    }
  }

  // Try actual fetch
  try {
    const result = await resilientFetch(url);
    FETCH_CACHE.set(cacheKey, { text: result.text, ts: Date.now() });
    await dbSetMeta(cacheKey, { text: result.text, ts: Date.now() });
    return result;
  } catch (e) {
    // Try IndexedDB stale cache as last resort
    const stale = await dbGetMeta(cacheKey);
    if (stale && stale.text) {
      logConsole('warning', `Using stale DB cache for: ${url.slice(0, 50)}`);
      FETCH_CACHE.set(cacheKey, stale);
      phEmit('ph:route', { stage:'cache', status:'success', strategy:'stale-cache', stale:true, url });
      return { text: stale.text, strategy: 'stale-cache' };
    }
    throw e;
  }
}

// ============================================================
// RESILIENT FETCH — Concurrent Promise.any() fail-fast (UPGRADE-01)
// Direct fetch: 1500ms timeout; all others: full timeout concurrent
// ============================================================
const CACHE_TTL = 30 * 60 * 1000; // 30 min

async function resilientFetch(url) {
  phEmit('ph:route', { stage:'race', status:'active', url });
  const timeoutMs = parseInt(document.getElementById('cfg-timeout')?.value || '30') * 1000;
  const cfg = getUserInfrastructure();
  const fileMode = window.PROXYHARVEST_LOCAL_FILE_MODE === true;

  const controllers = [];
  const makeController = (ms) => {
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), ms);
    controllers.push({ ac, id });
    return ac.signal;
  };
  const cleanup = () => {
    controllers.forEach(({ ac, id }) => {
      clearTimeout(id);
      try { ac.abort(); } catch (_) {}
    });
  };

  const fetchWorker = async (workerUrl, strategy = 'worker-v2') => {
    const endpoint = makeWorkerFetchUrl(canonicalWorkerUrl(workerUrl), url);
    if (!endpoint) throw new Error('Worker URL missing');
    phEmit('ph:route', { stage:'cors', status:'probing', strategy, url });
    const res = await fetch(endpoint, {
      signal: makeController(timeoutMs),
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept:'application/json,text/plain,*/*' },
    });
    if (!res.ok) throw new Error(`Worker HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    let text = '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (data?.ok === false) throw new Error(`Worker ${data.error || 'fetch failed'}`);
      text = data?.text || data?.body || '';
    } else {
      text = await res.text();
    }
    if (!text || text.length < 8) throw new Error('Worker returned empty payload');
    phEmit('ph:route', { stage:'cors', status:'success', strategy, url });
    return { text, strategy };
  };

  if (fileMode) {
    try {
      return await fetchWorker(WORKER_CONFIG.workerUrl, 'canonical-worker');
    } catch (error) {
      phEmit('ph:route', { stage:'cors', status:'error', strategy:'canonical-worker', url, error:String(error?.message || error) });
      throw new Error(`Canonical Cloudflare Gateway failed: ${error?.message || error}`);
    } finally {
      cleanup();
    }
  }

  if (PH_RUNTIME.localBridgeVerified === true) {
    const bridgeUrl = getBridgeBase();
    if (bridgeUrl) {
      phEmit('ph:route', { stage:'bridge', status:'probing', url });
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch(`${bridgeUrl}/fetch-sub?url=${encodeURIComponent(url)}`, {
          signal: ctrl.signal, cache:'no-store', credentials:'omit'
        });
        clearTimeout(timer);
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          let text = '';
          if (ct.includes('application/json')) {
            const data = await res.json().catch(() => null);
            text = data?.text || data?.body || '';
          } else text = await res.text();
          if (text && text.length >= 8) {
            phEmit('ph:route', { stage:'bridge', status:'success', strategy:'local-bridge', url });
            cleanup();
            return { text, strategy:'local-bridge' };
          }
        }
      } catch (_) {}
    }
  }

  const attempts = [];

  phEmit('ph:route', { stage:'direct', status:'probing', url });
  attempts.push(
    fetch(url, { signal:makeController(1800), mode:'cors', cache:'no-store', credentials:'omit' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(t => { if (!t || t.length < 8) throw new Error('Empty'); return { text:t, strategy:'direct' }; })
  );

  attempts.push(fetchWorker(cfg.workerUrl || WORKER_CONFIG.workerUrl, 'worker-v2'));

  if (getActiveCorsProxies().length) phEmit('ph:route', { stage:'cors', status:'probing', url });
  getActiveCorsProxies().forEach(proxy => {
    const proxied = proxy.url + encodeURIComponent(url);
    attempts.push(
      fetch(proxied, { signal:makeController(timeoutMs), cache:'no-store', credentials:'omit' })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(t => { if (!t || t.length < 8) throw new Error('Empty'); return { text:t, strategy:`proxy:${proxy.id}` }; })
        .catch(err => { markProxyFailed(proxy.id); return Promise.reject(err); })
    );
  });

  const mirrors = buildMirrorUrls(url);
  if (mirrors.length) phEmit('ph:route', { stage:'cdn', status:'probing', url });
  mirrors.forEach(mirror => {
    attempts.push(
      fetch(mirror, { signal:makeController(timeoutMs), cache:'no-store', credentials:'omit' })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(t => { if (!t || t.length < 8) throw new Error('Empty'); return { text:t, strategy:'mirror' }; })
    );
  });

  try {
    const result = await Promise.any(attempts);
    const strategy = String(result?.strategy || 'race');
    const stage = strategy === 'direct' ? 'direct'
      : strategy === 'worker-v2' || strategy === 'canonical-worker' || strategy.startsWith('proxy:') ? 'cors'
      : strategy === 'mirror' ? 'cdn'
      : strategy === 'local-bridge' ? 'bridge'
      : 'race';
    phEmit('ph:route', { stage, status:'success', strategy, url });
    return result;
  } catch (_) {
    phEmit('ph:route', { stage:'race', status:'error', url });
    throw new Error(`All fetch attempts failed for: ${url}`);
  } finally {
    cleanup();
  }
}

async function smartFetch(url) { return await resilientFetch(url); }

// Legacy helpers kept for backward compat
async function fetchViaSmartProxy(url) { return resilientFetch(url); }
async function fetchViaMirrors(url)    { return resilientFetch(url); }

// ============================================================
// PROTOCOL PARSERS
// ============================================================
function parseUri(uri) {
  try {
    if (uri.startsWith('vmess://'))     return parseVmess(uri);
    if (uri.startsWith('vless://'))     return parseVless(uri);
    if (uri.startsWith('trojan://'))    return parseTrojan(uri);
    if (uri.startsWith('ss://'))        return parseSS(uri);
    if (uri.startsWith('ssr://'))       return parseSSR(uri);
    if (uri.startsWith('hysteria2://') || uri.startsWith('hy2://')) return parseHy2(uri);
    if (uri.startsWith('tuic://'))      return parseTuic(uri);
    if (uri.startsWith('wireguard://')) return parseWireGuard(uri);
  } catch {}
  return null;
}

function parseVmess(uri) {
  const json = JSON.parse(atob(uri.slice(8).replace(/-/g,'+').replace(/_/g,'/')));
  return {type:'vmess',id:json.id||'',host:json.add||json.host||'',port:parseInt(json.port)||443,
    path:json.path||'',net:json.net||json.network||'tcp',security:json.tls?'tls':'none',
    sni:json.sni||json.host||'',flow:'',remarks:json.ps||json.remark||'',
    raw:uri,score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe()};
}
function parseVless(uri) {
  const u=new URL(uri.replace('vless://','https://')); const p=new URLSearchParams(u.search);
  const security = p.get('security') || 'none';
  let reality = null;
  if (security === 'reality') {
    reality = {
      publicKey:   p.get('pbk') || '',
      fingerprint: p.get('fp')  || '',
      shortId:     p.get('sid') || '',
      spiderX:     p.get('spx') || '',
    };
  }
  return {type:'vless',id:u.username||'',host:u.hostname||'',port:parseInt(u.port)||443,
    security,sni:p.get('sni')||p.get('host')||'',
    flow:p.get('flow')||'',net:p.get('type')||'tcp',
    pbk:p.get('pbk')||'',fp:p.get('fp')||'',sid:p.get('sid')||'',spx:p.get('spx')||'',
    path:p.get('path')||'',remarks:decodeURIComponent(u.hash.slice(1)||''),
    reality,
    raw:uri,score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe()};
}
function parseTrojan(uri) {
  const u=new URL(uri.replace('trojan://','https://')); const p=new URLSearchParams(u.search);
  return {type:'trojan',id:u.username||'',host:u.hostname||'',port:parseInt(u.port)||443,
    security:'tls',sni:p.get('sni')||p.get('peer')||'',net:p.get('type')||'tcp',path:'',
    remarks:decodeURIComponent(u.hash.slice(1)||''),
    raw:uri,score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe()};
}
function parseSS(uri) {
  const h=uri.indexOf('#'); const remarks=h>=0?decodeURIComponent(uri.slice(h+1)):'';
  const main=h>=0?uri.slice(5,h):uri.slice(5); const at=main.lastIndexOf('@');
  let host='',port=443;
  if (at>=0) { const hp=main.slice(at+1); const c=hp.lastIndexOf(':'); host=c>=0?hp.slice(0,c):hp; port=c>=0?parseInt(hp.slice(c+1))||443:443; }
  return {type:'ss',id:'',host,port,security:'none',sni:'',net:'tcp',path:'',remarks,raw:uri,score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe()};
}
function parseSSR(uri) {
  return {type:'ssr',id:'',host:'',port:0,security:'none',sni:'',net:'tcp',path:'',remarks:'SSR',raw:uri,score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe()};
}
function parseHy2(uri) {
  const u=new URL(uri.replace('hysteria2://','https://').replace('hy2://','https://')); const p=new URLSearchParams(u.search);
  return {type:'hy2',id:u.username||'',host:u.hostname||'',port:parseInt(u.port)||443,
    security:'tls',sni:p.get('sni')||'',net:'udp',path:'',
    remarks:decodeURIComponent(u.hash.slice(1)||''),
    extra:{
      obfs:         p.get('obfs') || '',
      obfsPassword: p.get('obfs-password') || '',
      insecure:     p.get('insecure') === '1',
      pinSHA256:    p.get('pinSHA256') || '',
    },
    raw:uri,score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe()};
}
function parseTuic(uri) {
  const u=new URL(uri.replace('tuic://','https://')); const p=new URLSearchParams(u.search);
  return {type:'tuic',id:u.username||'',password:u.password||'',host:u.hostname||'',port:parseInt(u.port)||443,
    security:'tls',sni:p.get('sni')||'',net:'udp',path:'',
    remarks:decodeURIComponent(u.hash.slice(1)||''),
    extra:{
      congestion:   p.get('congestion_control') || 'bbr',
      alpn:         p.get('alpn') || 'h3',
      udpRelayMode: p.get('udp_relay_mode') || 'native',
    },
    raw:uri,score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe()};
}
function parseWireGuard(uri) {
  const hashIdx=uri.indexOf('#');
  const remarks=hashIdx>=0?decodeURIComponent(uri.slice(hashIdx+1).replace(/\+/g,' ')):'';
  const noHash=hashIdx>=0?uri.slice(0,hashIdx):uri;
  try {
    const fakeUrl=noHash.replace('wireguard://','https://wg:');
    const u=new URL(fakeUrl); const p=new URLSearchParams(u.search);
    const privateKeyRaw=decodeURIComponent(u.password||u.username||'');
    const maskedKey=privateKeyRaw.substring(0,4)+'***'+privateKeyRaw.slice(-4);
    return {
      type:'wireguard',id:maskedKey,_privateKeyRaw:privateKeyRaw,
      host:u.hostname||'',port:parseInt(u.port)||51820,
      security:'wireguard',sni:'',net:'udp',path:'',remarks,
      publicKey:decodeURIComponent(p.get('publickey')||''),
      presharedKey:p.get('presharedkey')||'',
      address:decodeURIComponent(p.get('address')||'172.16.0.2/32'),
      reserved:decodeURIComponent(p.get('reserved')||''),
      mtu:p.get('mtu')||'1420',keepalive:p.get('keepalive')||'25',
      wnoise:p.get('wnoise')||'',wnoisecount:p.get('wnoisecount')||'',
      wnoisedelay:p.get('wnoisedelay')||'',wpayloadsize:p.get('wpayloadsize')||'',
      raw:uri,rawRedacted:redactUri(uri),score:0,latency:null,tested:false,doh:null,live:null,probe:makeProbe(),
      isMahsa:!!(p.get('wnoise')),privateKey:maskedKey,
    };
  } catch(err) {
    logConsole('error', sanitizeLogMsg(`WireGuard parse error: ${err.message}`));
    return null;
  }
}

// ============================================================
// CONFIG EXTRACTION
// ============================================================
function tryBase64Decode(text) {
  try {
    const cleaned=text.trim().replace(/\s+/g,'');
    const padded=cleaned+'='.repeat((4-cleaned.length%4)%4);
    const decoded=atob(padded);
    if (PROTOS.some(p=>decoded.includes(p))) return decoded;
    return null;
  } catch { return null; }
}

function extractConfigs(rawText) {
  let text=rawText;
  if (!PROTOS.some(p=>text.includes(p))) {
    const dec=tryBase64Decode(text);
    if (dec) { text=dec; logConsole('info','Auto-decoded Base64 subscription'); }
  }
  const uriSet=new Set();
  for (const line of text.split(/[\n\r]+/)) {
    const t=line.trim().replace(/^["'`]|["'`]$/g,'').replace(/\\n|\\r/g,'').replace(/^data:[^,]+,/,'');
    for (const proto of PROTOS) {
      const idx=t.indexOf(proto);
      if (idx>=0) {
        const raw=t.slice(idx).split(/[\s"'<>,\]]/)[0].replace(/[^\x20-\x7E]/g,'').replace(/\\u0026/g,'&');
        if (raw.length>proto.length+3) uriSet.add(raw);
      }
    }
  }
  const pat=new RegExp(`(?:${PROTOS.map(p=>p.replace('://',':\\/\\/')).join('|')})[a-zA-Z0-9%+/=@:._?#&\\-\\[\\]{}()~!]+`,'g');
  let m;
  while ((m=pat.exec(text))!==null) {
    let rawUri=m[0].split(/[\s"'<>,\]]/)[0].replace(/[^\x20-\x7E]/g,'');
    if (rawUri.length>15) uriSet.add(rawUri);
  }
  const configs=[]; const dedup=new Map();
  const dedupEnabled=document.getElementById('cfg-dedup')?.checked!==false;
  for (const uri of uriSet) {
    const parsed=parseUri(uri);
    if (!parsed) continue;
    const keyId=parsed.type==='wireguard'?(parsed.privateKey||parsed.id||''):(parsed.id||parsed.password||'').slice(0,8);
    const key=[parsed.type,(parsed.host||'').toLowerCase(),parsed.port,parsed.security||'none',keyId].join(':');
    if (dedupEnabled&&dedup.has(key)) continue;
    dedup.set(key,true);
    configs.push(parsed);
  }
  return configs;
}

// ============================================================
// SCORING ENGINE
// ============================================================
function scoreConfig(cfg) {
  let s=0;
  const breakdown=[];
  const protoScores={hy2:22,tuic:20,wireguard:18,vless:15,trojan:15,vmess:10,ss:7,ssr:1};
  const protoPts=protoScores[cfg.type]||5; s+=protoPts; breakdown.push({factor:'protocol',points:protoPts});
  if (cfg.type==='ssr') s-=5;

  const wTls  = Math.max(0,Math.min(50,parseInt(document.getElementById('w-tls')?.value)||25));
  const wPort = Math.max(0,Math.min(30,parseInt(document.getElementById('w-port443')?.value)||15));
  const wLat  = Math.max(0,Math.min(50,parseInt(document.getElementById('w-latency')?.value)||30));

  if      (cfg.security==='reality')   s+=wTls+5;
  else if (cfg.security==='tls')       s+=wTls;
  else if (cfg.security==='wireguard') s+=20;
  if (cfg.security==='none'&&cfg.type!=='wireguard') s=Math.max(0,s-20);

  const tlsPorts=[8443,2053,2083,2087,2096]; const httpPorts=[8080,8880];
  if      (cfg.port===443||cfg.port==='443') s+=wPort;
  else if (tlsPorts.includes(cfg.port))      s+=8;
  else if (httpPorts.includes(cfg.port))     s+=3;
  else if (cfg.port===80)                    s+=2;
  else if (cfg.port>0)                       s+=5;

  if (cfg.sni&&cfg.sni.length>3) s+=5;
  if (cfg.host&&cfg.host.length>3) s+=5;
  if (cfg.host&&cfg.host.includes('.')) s+=3;

  if (cfg.type==='wireguard') {
    if (cfg.isMahsa)   s+=10;
    if (cfg.reserved)  s+=5;
    if (cfg.publicKey) s+=8;
  }

  if (cfg.latency!=null&&!isNaN(cfg.latency)) {
    if      (cfg.latency<200)  s+=wLat;
    else if (cfg.latency<500)  s+=Math.round(wLat*0.8);
    else if (cfg.latency<1000) s+=Math.round(wLat*0.5);
    else if (cfg.latency<2000) s+=Math.round(wLat*0.2);
  }

  if (verificationPass(cfg)) { s+=25; breakdown.push({factor:'verified',points:25}); }
  else if (cfg.reachable===true) { s+=6; breakdown.push({factor:'reachable-only',points:6}); }
  if (cfg.live===false) { s=Math.max(0,s-20); breakdown.push({factor:'dead-penalty',points:-20}); }
  if (cfg.doh===true)   { s+=5; breakdown.push({factor:'dns-ok',points:5}); }
  if (cfg.doh===false)  { s=Math.max(0,s-15); breakdown.push({factor:'dns-fail-penalty',points:-15}); }
  if (cfg.flow&&cfg.flow.includes('xtls')) s+=5;
  if (cfg.pbk&&cfg.pbk.length>5) s+=8;

  cfg.score=Math.max(0,s);
  cfg.scoreBreakdown=breakdown;
}

// ============================================================
// ANTI-CENSORSHIP SCORING ENGINE (UPGRADE-05)
// Separate from scoreConfig — focused on bypass capability
// ============================================================
function computeAnticensorScore(proxy) {
  let score = 0;
  const cfg = getUserInfrastructure();

  // S_protocol
  const protocolScores = {
    'hysteria2':90,'hy2':90,'tuic':85,
    'vless':60,'trojan-go':65,'trojan':55,
    'vmess':40,'ss':30,'shadowsocks':30,'ssr':20,'socks5':10,
  };
  score += protocolScores[(proxy.type||proxy.protocol||'').toLowerCase()] || 0;

  // S_security
  const sec = (proxy.security || '').toLowerCase();
  if (sec === 'reality')    score += 40;
  else if (sec === 'xtls')  score += 20;
  else if (sec === 'tls')   score += 15;

  // Reality public key bonus (trusted key match)
  const pbk = proxy.pbk || proxy.reality?.publicKey || '';
  if (pbk && pbk === (cfg.realityPubKey || INFRASTRUCTURE_DEFAULTS.cfPublicKey)) score += 5;

  // S_transport
  const net = (proxy.net || proxy.network || '').toLowerCase();
  if (net === 'quic')      score += 12;
  else if (net === 'grpc') score += 10;
  else if (net === 'h2')   score += 8;
  else if (net === 'ws')   score += 5;

  // S_port
  const port = Number(proxy.port);
  if (port === 443)                              score += 10;
  else if (port === 8443)                        score += 8;
  else if (port === 80)                          score += 5;
  else if (port > 1000)                          score += 3;
  if (port === (cfg.cleanPort || INFRASTRUCTURE_DEFAULTS.cleanPort)) score += 5;

  // S_obfuscation
  if (proxy.sni)             score += 10;
  if (proxy.reality)         score += 15;
  if (proxy.flow && proxy.flow.includes('xtls')) score += 8;
  if (proxy.extra?.plugin)   score += 12;
  if (proxy.extra?.obfs)     score += 10;

  return Math.min(score, 150);
}
async function runDoHBatch() {
  const untested = S.configs.filter(c => c.doh === null || c.probe?.dns === 'unknown').filter(c => c.host).slice(0, 300);
  if (!untested.length) { toast('All DNS states already checked', 'warn'); return; }
  toast(`DNS check: ${untested.length} hosts...`, 'info');
  const q = [...untested];
  await Promise.all(Array.from({ length: Math.min(8, untested.length) }, async () => {
    while (q.length > 0) {
      const cfg = q.shift(); if (!cfg) continue;
      const dns = await basicDoHCheck(cfg.host).catch(() => 'unknown');
      cfg.probe = makeProbe({ ...(cfg.probe || {}), dns:normalizeDnsState(dns), method:cfg.probe?.method || 'dns-check', evidence:[...(cfg.probe?.evidence || []), `dns=${dns}`] });
      cfg.doh = cfg.probe.dns === 'ok' ? true : cfg.probe.dns === 'fail' ? false : null;
      scoreConfig(cfg);
    }
  }));
  S.configs.sort((a,b)=>b.score-a.score);
  renderTable(); renderWgPanel(); updateExportArea(); updateHeaderStats();
  await persistConfigs();
  const fail = S.configs.filter(c => c.probe?.dns === 'fail').length;
  const unknown = S.configs.filter(c => c.probe?.dns === 'unknown').length;
  toast(`DNS complete — ${fail} fail, ${unknown} unknown`, fail ? 'warn' : 'ok');
}

async function testConfigLatency(cfg) {
  if (!cfg || !cfg.host) {
    applyProbeResult(cfg, makeProbe({ browserReachable:false, bridgeReachable:false, latencyMs:9999, method:'no-host', evidence:['missing-host'] }));
    return;
  }
  const timeout = 10000;
  const useTLS = likelyTLSForConfig(cfg);
  const bridgeProbe = await bridgeVerifyConfig(cfg, timeout).catch(() => null);
  if (bridgeProbe) {
    applyProbeResult(cfg, bridgeProbe);
    return;
  }
  const result = typeof fetchTest === 'function'
    ? await fetchTest(cfg.host, cfg.port, useTLS, timeout).catch(() => ({ latency:9999, live:false, method:'browser-fetch-fail' }))
    : { latency:9999, live:false, method:'no-test-engine' };
  const dns = !/^[\d.]+$/.test(cfg.host) && !/^[0-9a-fA-F:]+$/.test(cfg.host)
    ? await basicDoHCheck(cfg.host).then(normalizeDnsState).catch(() => 'unknown')
    : 'ok';
  applyProbeResult(cfg, makeProbe({
    dns,
    browserReachable: result.live === true,
    bridgeReachable: false,
    latencyMs: result.latency,
    method: `browser-fallback:${result.method}`,
    confidence:'low',
    evidence:[result.method, 'fallback only — run proxyharvest-bridge.js for real TCP/TLS ping']
  }));
}

async function pingWgHost(cfg) {
  if (!cfg || !cfg.host) {
    applyProbeResult(cfg, makeProbe({ browserReachable:false, bridgeReachable:false, latencyMs:9999, method:'no-host', evidence:['missing-host'] }));
    return;
  }
  const port = cfg.port || 51820;
  const bridgeProbe = await bridgeVerifyConfig(cfg, 12000).catch(() => null)
    || await bridgePingHost(cfg.host, port, false, 8000, 'wireguard').catch(() => null);
  if (bridgeProbe) {
    applyProbeResult(cfg, bridgeProbe);
    return;
  }
  const result = typeof wsTest === 'function'
    ? await wsTest(cfg.host, port, false, 5000).catch(() => ({ latency:9999, live:false, method:'wg-browser-fail' }))
    : { latency:9999, live:false, method:'no-test-engine' };
  applyProbeResult(cfg, makeProbe({
    dns:/^[\d.]+$/.test(cfg.host) || /^[0-9a-fA-F:]+$/.test(cfg.host) ? 'ok' : 'unknown',
    browserReachable: result.live === true,
    bridgeReachable: false,
    latencyMs: result.latency,
    method:`wg-browser-fallback:${result.method}`,
    confidence:'low',
    evidence:['WireGuard UDP handshake requires local bridge verification', 'fallback only — not a real WG handshake']
  }));
}

async function runConnTest(opts = {}) {
  const limit = opts.limit || Number(document.getElementById('cfg-test-limit')?.value || 100);
  const candidates = S.configs.filter(c => opts.force || !c.tested || c.probe?.confidence === 'low').slice(0, limit);
  if (!candidates.length) { toast('All configs already tested. Use Real Test for forced retest.', 'warn'); return; }
  toast(`Real ping test: ${candidates.length} configs...`, 'info');
  logConsole('info', `Real ping batch started — bridge=${getBridgeBase() || 'none'}, count=${candidates.length}`);
  const q = [...candidates];
  await Promise.all(Array.from({ length: Math.min(5, candidates.length) }, async () => {
    while (q.length > 0) {
      const cfg = q.shift(); if (!cfg) continue;
      if (cfg.type === 'wireguard') await pingWgHost(cfg); else await testConfigLatency(cfg);
      scoreConfig(cfg); S.stats.tested++;
    }
  }));
  S.configs.sort((a,b)=>b.score-a.score);
  renderTable(); renderWgPanel(); updateExportArea(); updateHeaderStats();
  await persistConfigs();
  const live = S.configs.filter(verificationPass).length;
  const reachable = S.configs.filter(c => c.reachable === true && !verificationPass(c)).length;
  toast(`Real ping complete — ${live} verified, ${reachable} reachable`, live > 0 ? 'ok' : 'warn');
}

async function healWireGuard(idx) {
  const index = Number(idx);
  const cfg = S.configs[index];
  if (!cfg || cfg.type !== 'wireguard') {
    toast('WireGuard config not found', 'warn');
    return { fixed:false, reason:'not-found' };
  }

  const card = document.getElementById(`wgcard-${index}`);
  card?.classList.add('healing');
  try {
    // Establish current evidence before attempting any mutation.
    if (!cfg.tested || !cfg.probe) await pingWgHost(cfg);
    if (verificationPass(cfg)) {
      toast('WireGuard config is already verified', 'ok');
      return { fixed:false, alreadyVerified:true };
    }
    if (cfg.reachable === true && cfg.live !== false) {
      toast('Endpoint is reachable; no destructive heal applied without a failed verification result', 'warn');
      return { fixed:false, reachableOnly:true };
    }

    const rawMethod = String(cfg.testMethod || cfg.probe?.method || '');
    let method = rawMethod;
    if (/timeout/i.test(rawMethod) || !method) method = 'ws-timeout';
    else if (/refused|closed/i.test(rawMethod)) method = 'tcp-refused';
    else if (/exception|connection/i.test(rawMethod)) method = 'ws-exception';
    else if (/worker/i.test(rawMethod)) method = 'worker-fail';

    const result = await healer.heal(cfg, {
      live:false,
      latency:Number.isFinite(cfg.latency) ? cfg.latency : 9999,
      method,
    });

    if (result?.fixed) {
      // Re-test the applied candidate and only let verification evidence set LIVE.
      await pingWgHost(cfg);
      scoreConfig(cfg);
      await persistConfigs();
      renderTable();
      renderWgPanel();
      updateExportArea();
      updateHeaderStats();
      const verified = verificationPass(cfg);
      toast(verified ? 'WireGuard healed and verified' : (cfg.reachable ? 'WireGuard candidate is reachable; tunnel still unverified' : 'WireGuard candidate applied'), verified ? 'ok' : 'warn');
      return { ...result, verified };
    }

    toast('No verified healing candidate found', 'warn');
    return result || { fixed:false };
  } catch (e) {
    logConsole('error', `WireGuard heal failed: ${e?.message || e}`);
    toast(`WireGuard heal failed: ${e?.message || e}`, 'err');
    return { fixed:false, error:String(e?.message || e) };
  } finally {
    document.getElementById(`wgcard-${index}`)?.classList.remove('healing');
  }
}

async function healAllWireGuard() {
  const dead = S.configs.filter(c => c.type === 'wireguard' && c.live === false);
  if (!dead.length) { toast('No dead WireGuard configs to heal', 'warn'); return; }
  const statusEl = document.getElementById('wgHealStatus');
  if (statusEl) statusEl.textContent = `⏳ Healing ${dead.length} dead configs...`;
  logConsole('info', `WG Heal All: healing ${dead.length} dead configs`);
  let healed = 0;
  for (const cfg of dead) {
    const idx = S.configs.indexOf(cfg);
    await healWireGuard(idx);
    if (cfg.live === true) healed++;
  }
  toast(`Auto-heal complete: ${healed}/${dead.length} healed`, healed > 0 ? 'ok' : 'warn');
  if (statusEl) statusEl.textContent = `✓ ${healed}/${dead.length} healed`;
}

// ============================================================
// ============================================================
// SMART LOCAL HEALER — 100% offline, zero external API calls
// Rule-based expert system with self-learning pattern memory
// ============================================================

const AI_HEALER = (() => {
  // ─── Cloudflare WARP known-good endpoints ─────────────────
  const WARP_IPS = [
    '162.159.192.1','162.159.192.2','162.159.192.3','162.159.192.4',
    '162.159.192.5','162.159.192.6','162.159.192.7','162.159.192.8',
    '162.159.192.9','162.159.192.10','162.159.192.100','162.159.192.203',
    '162.159.193.1','162.159.193.2','162.159.193.3','162.159.193.4',
    '162.159.193.5','162.159.193.6','162.159.193.7','162.159.193.8',
    '162.159.195.1','162.159.195.2','162.159.195.3','162.159.195.4',
    '188.114.96.1','188.114.96.2','188.114.96.3','188.114.96.4',
    '188.114.96.5','188.114.96.6','188.114.96.7','188.114.96.8',
    '188.114.97.1','188.114.97.2','188.114.97.3','188.114.97.4',
    '188.114.98.1','188.114.98.2','188.114.98.3','188.114.98.4',
    '188.114.99.1','188.114.99.2','188.114.99.3','188.114.99.4',
  ];
  const WARP_PORTS = [2408, 859, 51820, 1701, 500, 4500, 7152];
  const TLS_PORTS  = [443, 8443, 2053, 2083, 2087, 2096];
  const HTTP_PORTS = [80, 8080, 8880];
  const CF_SNI     = ['cloudflare.com','www.cloudflare.com','speed.cloudflare.com'];
  const VALID_SS_METHODS = [
    'aes-256-gcm','aes-128-gcm','chacha20-ietf-poly1305',
    'aes-256-cfb','aes-128-cfb','aes-256-ctr','aes-128-ctr',
    'rc4-md5','bf-cfb','camellia-128-cfb','camellia-192-cfb',
    'camellia-256-cfb','salsa20','chacha20','chacha20-ietf',
  ];

  // ─── Self-learning pattern memory (localStorage) ──────────
  const MEM_KEY = 'smartheal_patterns_v1';
  let _memory   = (() => { try { return JSON.parse(PH_STORAGE.get(MEM_KEY)||'{}'); } catch { return {}; } })();
  const _saveMem = () => { try { PH_STORAGE.set(MEM_KEY, JSON.stringify(_memory)); } catch {} };
  const _learnSuccess = (proto, issueType, fix) => {
    const k = `${proto}:${issueType}`;
    if (!_memory[k]) _memory[k] = { count:0, fix:null };
    _memory[k].count++; _memory[k].fix = fix; _memory[k].last = Date.now();
    _saveMem();
  };
  const _getBestFix = (proto, issueType) => {
    const k = `${proto}:${issueType}`;
    return _memory[k]?.count > 2 ? _memory[k].fix : null;
  };

  // ─── Shared state ─────────────────────────────────────────
  let pendingFixes = [];
  let healedCount  = 0;
  let protoFilter  = '';

  // ─── Utility ──────────────────────────────────────────────
  const isIP  = h => /^(\d{1,3}\.){3}\d{1,3}$/.test(h||'') || /^[0-9a-fA-F:]+$/.test(h||'');
  const rnd   = arr => arr[Math.floor(Math.random() * arr.length)];

  // ─── UI helpers ───────────────────────────────────────────
  function updateStats() {
    const dead    = S.configs.filter(c => c.live===false||c.doh===false).length;
    const pending = pendingFixes.length;
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    el('ai-dead-count',   dead);
    el('ai-healed-count', healedCount);
    el('ai-pending-count',pending);
    const badge = document.getElementById('aiKeyStatusBadge');
    if (badge) {
      badge.textContent = '⚡ Local Engine Active';
      badge.style.cssText = 'font-size:.58rem;font-family:var(--mono);padding:2px 8px;border-radius:20px;background:rgba(52,211,153,0.14);border:1px solid rgba(52,211,153,0.4);color:var(--green)';
    }
  }

  function setLoading(on, msg='') {
    const sp = document.getElementById('aiSpinner');
    const st = document.getElementById('aiStatusText');
    if (sp) sp.style.display = on ? 'inline-block' : 'none';
    if (st) st.textContent   = msg;
  }

  function log(msg, level='info') {
    const el = document.getElementById('aiLog');
    if (!el) return;
    const col = {info:'#94a3b8',success:'#34d399',warn:'#fcd34d',error:'#fb7185',debug:'#60a5fa'}[level] || '#94a3b8';
    const now = new Date();
    const ts  = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    el.innerHTML += `<div style="margin:2px 0;border-bottom:1px solid rgba(255,255,255,0.04);padding:2px 0"><span style="color:rgba(100,130,160,0.7);font-size:9px">[${ts}]</span> <span style="color:${col};font-size:10px">${escHtml(msg)}</span></div>`;
    el.scrollTop = el.scrollHeight;
  }

  // ─── DIAGNOSIS ENGINE ─────────────────────────────────────
  function diagnose(cfg) {
    if (!cfg) return [];
    const issues = [];
    const p      = cfg.type || '';
    const port   = Number(cfg.port) || 0;
    const sec    = cfg.security || 'none';
    const host   = cfg.host || '';

    if (cfg.live  === false) issues.push('UNREACHABLE');
    if (cfg.doh   === false) issues.push('DNS_FAIL');
    if ((cfg.score||0) < 5) issues.push('LOW_SCORE');

    // ── WireGuard ──────────────────────────────────────────
    if (p === 'wireguard') {
      if (!cfg.publicKey)                    issues.push('WG_NO_PUBKEY');
      if (!cfg.id && !cfg._privateKeyRaw)   issues.push('WG_NO_PRIVKEY');
      if (!cfg.address)                      issues.push('WG_NO_ADDRESS');
      if (!cfg.mtu || cfg.mtu < 1000 || cfg.mtu > 1500) issues.push('WG_BAD_MTU');
      if (cfg.live === false || cfg.doh === false) issues.push('WG_BAD_ENDPOINT');
    }

    // ── VLESS / VMess ──────────────────────────────────────
    if (p === 'vless' || p === 'vmess') {
      if (!cfg.id || cfg.id.length < 8)       issues.push('BAD_UUID');
      if (sec === 'none' && !HTTP_PORTS.includes(port)) issues.push('NEEDS_TLS');
      if (sec === 'tls' && !cfg.sni && !isIP(host))     issues.push('MISSING_SNI');
      if (sec === 'reality' && !cfg.pbk)                 issues.push('REALITY_NO_PBK');
      if (cfg.doh === false && !isIP(host))              issues.push('HOSTNAME_UNRESOLVABLE');
    }

    // ── Trojan ─────────────────────────────────────────────
    if (p === 'trojan') {
      if (sec !== 'tls')        issues.push('TROJAN_NEEDS_TLS');
      if (!cfg.sni)             issues.push('TROJAN_MISSING_SNI');
      if (port !== 443)         issues.push('TROJAN_WRONG_PORT');
    }

    // ── Hysteria2 ──────────────────────────────────────────
    if (p === 'hy2' || p === 'hysteria2') {
      if (!cfg.sni) issues.push('HY2_MISSING_SNI');
      if (!cfg.id)  issues.push('HY2_NO_AUTH');
    }

    // ── Shadowsocks ────────────────────────────────────────
    if (p === 'ss' || p === 'shadowsocks') {
      if (!cfg.id) issues.push('SS_NO_PASSWORD');
      const method = (cfg.net || cfg.remarks || '').toLowerCase();
      if (method && !VALID_SS_METHODS.some(m => method.includes(m))) issues.push('SS_BAD_CIPHER');
    }

    return [...new Set(issues)];
  }

  // ─── FIX GENERATOR ────────────────────────────────────────
  function generateFixes(cfg, issues) {
    if (!issues || !issues.length) return [];
    const fixes   = [];
    const p       = cfg.type || '';
    const curIP   = cfg.host || '';
    const curPort = Number(cfg.port) || 0;

    // Check learned patterns first — highest priority
    for (const issue of issues) {
      const learned = _getBestFix(p, issue);
      if (learned) {
        fixes.push({ ...learned, reason:`✓ Learned pattern (used ${_memory[p+':'+issue].count}x)`, confidence:90 });
      }
    }

    // ── WireGuard ──────────────────────────────────────────
    if (p === 'wireguard') {
      if (issues.some(i => ['WG_BAD_ENDPOINT','UNREACHABLE','DNS_FAIL'].includes(i))) {
        const candidates = (S.warpEndpoints?.length > 0)
          ? S.warpEndpoints.slice(0,20).map(e => e.ip?.split(':')[0]).filter(Boolean)
          : WARP_IPS;
        const newIp = rnd(candidates.filter(ip => ip !== curIP).length ? candidates.filter(ip => ip !== curIP) : WARP_IPS);
        fixes.push({ field:'host', value:newIp,  reason:'Cloudflare WARP endpoint (known-good)', confidence:85 });
        fixes.push({ field:'port', value:2408,   reason:'WARP primary UDP port',                 confidence:85 });
      }
      if (issues.includes('WG_NO_ADDRESS'))
        fixes.push({ field:'address',  value:'172.16.0.2/32,2606:4700:110:8f0a:bdab:d9d3:bef3:7962/128', reason:'Standard WARP dual-stack address', confidence:70 });
      if (issues.includes('WG_BAD_MTU'))
        fixes.push({ field:'mtu',      value:1280, reason:'Safe WARP MTU',              confidence:85 });
      if (!cfg.keepalive)
        fixes.push({ field:'keepalive',value:25,   reason:'Standard keepalive interval', confidence:80 });
    }

    // ── VLESS / VMess ──────────────────────────────────────
    else if (p === 'vless' || p === 'vmess') {
      if (issues.some(i => ['HOSTNAME_UNRESOLVABLE','DNS_FAIL'].includes(i))) {
        fixes.push({ field:'sni',      value:curIP || cfg.host, reason:'Preserve original as SNI for CDN routing', confidence:55 });
        fixes.push({ field:'host',     value:'104.17.1.1',      reason:'Cloudflare CDN IP (bypasses DNS fail)',    confidence:50 });
        fixes.push({ field:'security', value:'tls',             reason:'TLS required for CDN routing',             confidence:70 });
        fixes.push({ field:'port',     value:443,               reason:'Standard HTTPS port',                      confidence:70 });
      }
      if (issues.includes('NEEDS_TLS')) {
        fixes.push({ field:'security', value:'tls', reason:'TLS needed on non-HTTP ports', confidence:75 });
        if (!TLS_PORTS.includes(curPort))
          fixes.push({ field:'port', value:443, reason:'Standard TLS port', confidence:75 });
      }
      if (issues.includes('MISSING_SNI'))
        fixes.push({ field:'sni', value:cfg.host || CF_SNI[0], reason:'SNI required for TLS handshake', confidence:80 });
      if (issues.includes('UNREACHABLE') && cfg.doh !== false) {
        const altPort = TLS_PORTS.find(p => p !== curPort) || 443;
        fixes.push({ field:'port', value:altPort, reason:`Try port ${altPort} (port ${curPort} blocked)`, confidence:65 });
        if (!cfg.sni) fixes.push({ field:'sni', value:cfg.host, reason:'Set SNI for reliable TLS', confidence:70 });
      }
    }

    // ── Trojan ─────────────────────────────────────────────
    else if (p === 'trojan') {
      if (issues.includes('TROJAN_NEEDS_TLS'))
        fixes.push({ field:'security', value:'tls', reason:'Trojan protocol requires TLS',  confidence:95 });
      if (issues.includes('TROJAN_WRONG_PORT'))
        fixes.push({ field:'port',     value:443,   reason:'Trojan standard port is 443',   confidence:90 });
      if (issues.includes('TROJAN_MISSING_SNI'))
        fixes.push({ field:'sni', value:cfg.host || CF_SNI[0], reason:'SNI mandatory for Trojan TLS', confidence:85 });
      if (issues.includes('UNREACHABLE') && cfg.doh !== false) {
        fixes.push({ field:'port', value:443,   reason:'Retry on standard port',     confidence:60 });
        fixes.push({ field:'net',  value:'tcp', reason:'Trojan works best over TCP', confidence:75 });
      }
    }

    // ── Hysteria2 ──────────────────────────────────────────
    else if (p === 'hy2' || p === 'hysteria2') {
      if (issues.includes('HY2_MISSING_SNI'))
        fixes.push({ field:'sni', value:cfg.host||'', reason:'SNI required for hy2 TLS', confidence:85 });
      if (issues.includes('UNREACHABLE'))
        fixes.push({ field:'port', value:443, reason:'Try standard HTTPS port', confidence:60 });
    }

    // ── Shadowsocks ────────────────────────────────────────
    else if (p === 'ss' || p === 'shadowsocks') {
      if (issues.includes('SS_BAD_CIPHER'))
        fixes.push({ field:'net', value:'chacha20-ietf-poly1305', reason:'Modern fast cipher', confidence:60 });
      if (issues.includes('UNREACHABLE'))
        fixes.push({ field:'port', value:443, reason:'Try port 443 for SS', confidence:55 });
    }

    // ── Universal: Low score boost ─────────────────────────
    if (issues.includes('LOW_SCORE') && fixes.length === 0 && p !== 'wireguard') {
      if (!cfg.sni && cfg.host) fixes.push({ field:'sni', value:cfg.host, reason:'SNI improves score & TLS reliability', confidence:65 });
      if (!TLS_PORTS.includes(curPort) && !HTTP_PORTS.includes(curPort))
        fixes.push({ field:'port', value:443, reason:'Standard port improves score', confidence:60 });
    }

    // Dedup: one fix per field — keep highest confidence
    const seen = new Map();
    for (const f of fixes) {
      if (!seen.has(f.field) || f.confidence > seen.get(f.field).confidence) seen.set(f.field, f);
    }
    return [...seen.values()];
  }

  // ─── CONFIDENCE ESTIMATOR ─────────────────────────────────
  function estimateConfidence(cfg, issues, fixes) {
    if (!fixes.length) return 0;
    let base = fixes.reduce((s, f) => s + (f.confidence||50), 0) / fixes.length;
    if (cfg.type === 'wireguard') base = Math.max(base, 80);
    if (cfg.type === 'trojan')    base = Math.max(base, 75);
    if (issues.includes('DNS_FAIL') && cfg.type !== 'wireguard') base *= 0.7;
    return Math.min(95, Math.round(base));
  }

  // ─── SINGLE CONFIG HEAL ───────────────────────────────────
  async function healOne(idx) {
    const cfg = S.configs[idx];
    if (!cfg) return;

    log(`🔍 Diagnosing ${cfg.type}://${cfg.host}:${cfg.port}...`, 'info');
    setLoading(true, `analyzing ${cfg.host}…`);
    await new Promise(r => setTimeout(r, 10));

    const issues = diagnose(cfg);
    if (!issues.length) {
      log(`✓ ${cfg.host}:${cfg.port} — no issues detected (score: ${cfg.score})`, 'success');
      setLoading(false);
      return;
    }
    log(`⚠ Issues: ${issues.join(', ')}`, 'warn');

    const fixes = generateFixes(cfg, issues);
    if (!fixes.length) {
      log(`✗ ${cfg.host}:${cfg.port} — unfixable (${issues.join(', ')})`, 'error');
      cfg._aiReason     = issues.join('; ');
      cfg._aiFixes      = [];
      cfg._aiConfidence = 0;
      setLoading(false);
      updateStats();
      return;
    }

    const conf = estimateConfidence(cfg, issues, fixes);
    log(`💡 ${fixes.length} fix(es) — confidence: ${conf}%`, 'info');
    fixes.forEach(f => log(`  → ${f.field}: ${String(f.value).slice(0,40)} (${f.reason})`, 'debug'));

    cfg._aiFixes      = fixes;
    cfg._aiReason     = issues.join('; ');
    cfg._aiConfidence = conf;
    cfg._aiIssues     = issues;

    // Auto-test: WireGuard — immediately try new endpoint
    if (cfg.type === 'wireguard' && issues.includes('WG_BAD_ENDPOINT')) {
      log(`🔄 Auto-testing WireGuard new endpoint...`, 'info');
      const backup = { host:cfg.host, port:cfg.port };
      fixes.forEach(f => { if (['host','port'].includes(f.field)) cfg[f.field] = f.value; });
      try {
        if (typeof pingWgHost === 'function') await pingWgHost(cfg);
        if (cfg.live === true) {
          log(`✅ WireGuard healed! ${cfg.host}:${cfg.port} (${cfg.latency}ms)`, 'success');
          _learnSuccess(cfg.type, 'WG_BAD_ENDPOINT', { field:'host', value:cfg.host, reason:'Auto-healed endpoint' });
          cfg.raw = null; scoreConfig(cfg);
          delete cfg._aiFixes; delete cfg._aiReason; delete cfg._aiIssues;
          healedCount++;
          try { renderTable(); updateExportArea(); persistConfigs(); } catch {}
          toast(`✅ WireGuard healed → ${cfg.host}:${cfg.port}`, 'ok');
          setLoading(false); updateStats(); _renderFixPreview();
          return;
        } else {
          Object.assign(cfg, backup);
          log(`⚠ Auto-test failed — queued for manual apply`, 'warn');
        }
      } catch(e) {
        Object.assign(cfg, backup);
        log(`⚠ Auto-test error: ${e.message}`, 'warn');
      }
    }

    log(`Fix queued for ${cfg.host}:${cfg.port} — click "Apply Fixes"`, 'success');
    _renderFixPreview();
    setLoading(false);
    updateStats();
  }

  // ─── ANALYZE ALL DEAD CONFIGS ─────────────────────────────
  async function analyzeDeadConfigs() {
    const dead = S.configs.filter(c =>
      (c.live===false || c.doh===false || (c.score||0) < 10) &&
      (!protoFilter || c.type === protoFilter)
    ).slice(0, 100);

    const listEl = document.getElementById('aiConfigList');
    if (!listEl) return;
    pendingFixes = [];

    if (!dead.length) {
      listEl.innerHTML = `<div class="empty" style="padding:30px"><div class="empty-icon">✓</div><div style="color:var(--green)">All configs are healthy!</div></div>`;
      log('Scan complete — no issues found.', 'success');
      return;
    }

    log(`🔍 Scanning ${dead.length} problematic configs...`, 'info');

    listEl.innerHTML = dead.map(cfg => {
      const issues  = diagnose(cfg);
      const fixes   = generateFixes(cfg, issues);
      const conf    = estimateConfidence(cfg, issues, fixes);
      const status  = cfg.live===false ? 'DEAD' : cfg.doh===false ? 'DNS✗' : 'LOW';
      const col     = status==='DEAD'?'var(--red)':status==='DNS✗'?'var(--yellow)':'var(--text3)';
      const fixable = fixes.length > 0;
      const idx     = S.configs.indexOf(cfg);
      const issueTxt= issues.slice(0,2).join(' · ');
      return `<div class="ai-config-row" style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid rgba(139,92,246,0.07);font-size:10px;transition:background .1s" onmouseover="this.style.background='rgba(139,92,246,0.05)'" onmouseout="this.style.background=''">
        <input type="checkbox" class="ai-cfg-check" data-idx="${idx}" data-status="${status}" style="accent-color:var(--purple);flex-shrink:0" ${fixable?'checked':''}>
        <span class="pbadge p-${escHtml(cfg.type)}" style="flex-shrink:0">${escHtml(cfg.type)}</span>
        <span style="flex:1;overflow:hidden;min-width:0">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-family:var(--mono)">${escHtml(cfg.host||'?')}:${cfg.port}</div>
          <div style="color:var(--text3);font-size:8.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(issueTxt)}</div>
        </span>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0">
          <span style="color:${col};font-size:9px;font-weight:700">${status}</span>
          ${fixable
            ? `<span style="color:var(--green);font-size:8px">${conf}% conf.</span>`
            : `<span style="color:var(--red);font-size:8px">unfixable</span>`}
        </div>
        <button class="btn btn-xs btn-purple" onclick="AI_HEALER.healOne(${idx})" style="flex-shrink:0;font-size:8px">⚡Fix</button>
      </div>`;
    }).join('');

    pendingFixes = dead.map(c => S.configs.indexOf(c));

    // Issue summary in log
    const byIssue = {};
    dead.forEach(cfg => { diagnose(cfg).forEach(issue => { byIssue[issue]=(byIssue[issue]||0)+1; }); });
    Object.entries(byIssue).sort((a,b)=>b[1]-a[1]).forEach(([issue,count]) => {
      log(`  ${issue}: ${count} configs`, 'info');
    });
    log(`─── Ready to heal — select configs and run "Heal Selected" ───`, 'info');

    const countEl = document.getElementById('aiListCount');
    if (countEl) countEl.textContent = `(${dead.length})`;
    updateStats();

    listEl.addEventListener('change', () => {
      const total   = listEl.querySelectorAll('.ai-cfg-check').length;
      const checked = listEl.querySelectorAll('.ai-cfg-check:checked').length;
      const el      = document.getElementById('aiSelectedCount');
      if (el) el.textContent = `${checked}/${total} selected`;
    });
  }

  // ─── HEAL SELECTED (with progress bar) ────────────────────
  async function healSelected() {
    const checks = document.querySelectorAll('.ai-cfg-check:checked');
    if (!checks.length) { toast('No configs selected', 'warn'); return; }
    log(`⚡ Healing ${checks.length} selected configs...`, 'info');

    const pbar = document.getElementById('aiProgressBar');
    const fill = document.getElementById('aiProgressFill');
    const txt  = document.getElementById('aiProgressText');
    if (pbar) pbar.style.display = 'flex';

    let done = 0;
    for (const check of checks) {
      await healOne(parseInt(check.dataset.idx));
      done++;
      const pct = Math.round((done / checks.length) * 100);
      if (fill) fill.style.width = pct + '%';
      if (txt)  txt.textContent  = pct + '%';
    }
    setTimeout(() => { if (pbar) pbar.style.display = 'none'; }, 2000);
    log(`✅ Scan complete — ${done} configs processed`, 'success');
    toast(`Healing complete: ${done} configs`, 'ok');
    _renderFixPreview();
  }

  // ─── BATCH FIX ────────────────────────────────────────────
  async function batchFix() {
    const dead = S.configs.filter(c => c.live===false || c.doh===false || (c.score||0) < 10).slice(0, 200);
    if (!dead.length) { toast('No problematic configs found', 'warn'); return; }
    log(`⚡ Batch healing: ${dead.length} configs...`, 'info');
    setLoading(true, 'batch analysis…');

    let fixed = 0, unfixable = 0;
    for (const cfg of dead) {
      await new Promise(r => setTimeout(r, 0));
      const issues = diagnose(cfg);
      const fixes  = generateFixes(cfg, issues);
      if (fixes.length) {
        cfg._aiFixes      = fixes;
        cfg._aiReason     = issues.join('; ');
        cfg._aiIssues     = issues;
        cfg._aiConfidence = estimateConfidence(cfg, issues, fixes);
        fixed++;
      } else {
        unfixable++;
      }
    }

    log(`Batch: ${fixed} fixable, ${unfixable} unfixable`, fixed>0?'success':'warn');
    toast(`${fixed} fixes ready — run "Apply Fixes"`, fixed>0?'ok':'warn');
    _renderFixPreview();
    setLoading(false);
    updateStats();
  }

  // ─── APPLY QUEUED FIXES ───────────────────────────────────
  function applyFixes() {
    const minConf = parseInt(document.getElementById('aiConfidenceThresh')?.value||'0');
    const fixable = S.configs.filter(c => c._aiFixes?.length>0 && (c._aiConfidence||0)>=minConf);
    if (!fixable.length) { toast('No fixes queued — run Heal Selected first', 'warn'); return; }

    let applied = 0;
    const allowed = ['host','port','security','sni','net','path','flow','mtu','keepalive','address','pbk','fp','sid'];
    fixable.forEach(cfg => {
      const issues = cfg._aiIssues || [];
      cfg._aiFixes.forEach(fix => {
        if (allowed.includes(fix.field)) {
          const old = cfg[fix.field];
          cfg[fix.field] = (fix.field==='port'||fix.field==='mtu'||fix.field==='keepalive') ? parseInt(fix.value) : fix.value;
          log(`Applied ${fix.field}: ${String(old).slice(0,20)} → ${String(fix.value).slice(0,20)} (${cfg.host})`, 'success');
          // Learn successful pattern
          issues.forEach(issue => _learnSuccess(cfg.type, issue, { field:fix.field, value:fix.value, reason:fix.reason }));
        }
      });
      cfg.raw    = null;
      cfg.live   = null;
      cfg.latency= null;
      cfg.tested = false;
      cfg._healed  = true;
      cfg._healFix = cfg._aiFixes.map(f=>`${f.field}=${f.value}`).join(', ');
      try { scoreConfig(cfg); } catch {}
      delete cfg._aiFixes;
      delete cfg._aiReason;
      delete cfg._aiIssues;
      healedCount++;
      applied++;
    });

    try { renderTable(); renderWgPanel(); updateExportArea(); updateHeaderStats(); } catch {}
    try { persistConfigs(); } catch {}
    toast(`${applied} fixes applied ✓`, 'ok');
    log(`✅ ${applied} configs patched and rescored`, 'success');
    updateStats();
    _renderFixPreview();
  }

  // ─── FIX PREVIEW PANEL ────────────────────────────────────
  function _renderFixPreview() {
    const previewEl   = document.getElementById('aiFixPreview');
    const countEl     = document.getElementById('aiFixes-count');
    const avgEl       = document.getElementById('aiAvgConfidence');
    const fixableEl   = document.getElementById('aiFixableCount');
    const unfixableEl = document.getElementById('aiUnfixableCount');

    const withFixes = S.configs.filter(c => c._aiFixes?.length>0);
    const unfixable = S.configs.filter(c => c._aiReason && !c._aiFixes?.length);

    if (countEl)     countEl.textContent     = `${withFixes.length} fixes ready`;
    if (fixableEl)   fixableEl.textContent   = withFixes.length;
    if (unfixableEl) unfixableEl.textContent = unfixable.length;
    if (avgEl) {
      avgEl.textContent = withFixes.length
        ? Math.round(withFixes.reduce((s,c)=>s+(c._aiConfidence||0),0)/withFixes.length)+'%'
        : '—';
    }

    if (!previewEl) return;
    if (!withFixes.length) {
      previewEl.innerHTML = '<div style="color:rgba(139,92,246,0.3);padding:20px 8px;text-align:center;font-size:.6rem;line-height:1.7">No fixes queued.<br>Run “Heal Selected” first.</div>';
      return;
    }

    previewEl.innerHTML = withFixes.map(cfg => {
      const conf      = cfg._aiConfidence || 0;
      const confColor = conf>=80?'var(--green)':conf>=55?'var(--yellow)':'var(--red)';
      return `<div style="padding:7px 9px;border-bottom:1px solid rgba(139,92,246,0.1);font-size:.6rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span style="font-family:var(--mono);color:var(--text);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">${escHtml(cfg.host)}:${cfg.port}</span>
          <span style="color:${confColor};font-size:.58rem;flex-shrink:0;margin-left:4px;background:rgba(0,0,0,0.3);padding:1px 5px;border-radius:8px">${conf}% conf.</span>
        </div>
        <div style="color:var(--yellow);font-size:.56rem;margin-bottom:5px;font-family:var(--mono);opacity:.8">${escHtml(cfg._aiReason||'')}</div>
        ${(cfg._aiFixes||[]).map(f=>`
          <div style="display:flex;gap:4px;align-items:baseline;font-size:.58rem;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.03)">
            <span style="color:var(--cyan);min-width:60px;flex-shrink:0;font-family:var(--mono)">${escHtml(f.field)}</span>
            <span style="color:rgba(255,255,255,0.2)">→</span>
            <span style="color:var(--green);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-family:var(--mono)">${escHtml(String(f.value).slice(0,35))}</span>
          </div>
          <div style="color:rgba(148,163,184,0.5);font-size:.52rem;padding-bottom:2px;line-height:1.4">${escHtml(f.reason||'')}</div>
        `).join('')}
      </div>`;
    }).join('');
  }

  function clearLog() {
    const el = document.getElementById('aiLog');
    if (el) el.innerHTML = '<div style="color:rgba(139,92,246,0.4);font-size:.62rem">─── Log cleared ───</div>';
  }

  function getPatternStats() {
    const patterns  = Object.keys(_memory).length;
    const total     = Object.values(_memory).reduce((s,v)=>s+(v.count||0),0);
    return { patterns, totalFixes: total };
  }

  // ─── Public interface ─────────────────────────────────────
  return {
    get pendingFixes() { return pendingFixes; },
    get healedCount()  { return healedCount;  },
    get protoFilter()  { return protoFilter;  },
    set protoFilter(v) { protoFilter = v;     },
    updateStats, log, setLoading,
    analyzeDeadConfigs, healOne, healSelected,
    batchFix, applyFixes, clearLog,
    diagnose, generateFixes, getPatternStats,
  };
})();

// ============================================================
// SPLITNET FREE SUBSCRIPTION — fetch + cache + render
// ============================================================
async function fetchSplitNetSub() {
  const panel = document.getElementById('splitnetPanel');
  const statusEl = document.getElementById('splitnet-status');
  if (statusEl) statusEl.textContent = '⏳ Fetching SplitNet/WARP configs...';

  S.splitnetConfigs = [];
  let totalFound = 0;
  let successCount = 0;

  // Process sources concurrently in batches of 3
  const batchSize = 3;
  for (let i = 0; i < SPLITNET_SOURCES.length; i += batchSize) {
    const batch = SPLITNET_SOURCES.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(async src => {
      try {
        logConsole('info', `SplitNet fetch: ${src.name}`);
        const { text, strategy } = await fetchWithCache(src.url, false);
        // Accept ALL config types for mixed sources; wireguard-only for wireguard sources
        const found = extractConfigs(text).filter(c => 
          src.proto === 'wireguard' ? c.type === 'wireguard' : true
        );
        const limited = found.slice(0, 300);
        for (const cfg of limited) {
          cfg.sourceName = `SplitNet: ${src.name}`;
          cfg.isSplitnet = true;
          scoreConfig(cfg);
          S.splitnetConfigs.push(cfg);
        }
        totalFound += found.length;
        successCount++;
        logConsole('success', `SplitNet ${src.name}: +${limited.length} configs [${strategy}]`);
        if (statusEl) statusEl.textContent = `Fetching... ${S.splitnetConfigs.length} found so far`;
      } catch(e) {
        logConsole('warning', `SplitNet ${src.name} failed: ${e.message.slice(0,80)}`);
      }
    }));
    // Live render after each batch
    if (S.splitnetConfigs.length > 0) renderSplitNetPanel();
  }

  // Dedup
  const seen = new Set();
  S.splitnetConfigs = S.splitnetConfigs.filter(c => {
    const key = `${c.type}:${(c.host||'').toLowerCase()}:${c.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  S.splitnetConfigs.sort((a,b) => b.score - a.score);

  // Extract IRCF tconfig into S.ircfConfigs
  S.ircfConfigs = S.splitnetConfigs.filter(c =>
    c.sourceName && c.sourceName.includes('IRCF Free Configs')
  );
  await dbSetMeta('ircf:tconfigs', { configs: S.ircfConfigs, ts: Date.now() });
  if (S.ircfConfigs.length) {
    logConsole('success', `IRCF tconfig: ${S.ircfConfigs.length} configs cached to DB`);
  }

  // Persist
  await dbSave('splitnet', S.splitnetConfigs);

  const msg = S.splitnetConfigs.length > 0
    ? `✓ ${S.splitnetConfigs.length} configs loaded from ${successCount}/${SPLITNET_SOURCES.length} sources`
    : `⚠ No configs found — try again or check CORS proxies`;
  if (statusEl) statusEl.textContent = msg;
  renderSplitNetPanel();
  toast(`SplitNet: ${S.splitnetConfigs.length} free configs`, S.splitnetConfigs.length > 0 ? 'ok' : 'warn');
}

function getFilteredSplitnet() {
  let list = S.splitnetConfigs;
  if (S.splitnetFilter) list = list.filter(c => c.type === S.splitnetFilter);
  if (S.splitnetSearch) {
    const q = S.splitnetSearch.toLowerCase();
    list = list.filter(c => `${c.host} ${c.type} ${c.remarks||''}`.toLowerCase().includes(q));
  }
  return list;
}

function renderSplitNetPanel() {
  const panel = document.getElementById('splitnetGrid');
  if (!panel) return;

  const configs = getFilteredSplitnet().slice(0, 200);
  const nbEl = document.getElementById('nb-splitnet');
  if (nbEl) nbEl.textContent = S.splitnetConfigs.length;
  const filtEl = document.getElementById('splitnetFilteredCount');
  if (filtEl) filtEl.textContent = `${getFilteredSplitnet().length} of ${S.splitnetConfigs.length}`;

  if (!configs.length) {
    panel.innerHTML = `<div class="empty"><div class="empty-icon ph-empty-svg" data-empty-icon="splitnet">${getIcon('layers','#6f4cf2',28)}</div><div>Click "Refresh Free Configs" to load SplitNet/WARP configs</div></div>`;
    return;
  }

  panel.innerHTML = configs.map((cfg, i) => {
    const idx = S.splitnetConfigs.indexOf(cfg);
    const latBadge = cfg.latency == null
      ? `<span class="lat-pending">${getIcon('clock','#607D96',11)} —</span>`
      : cfg.latency >= 9999
        ? `<span class="lat-slow">${getIcon('warning','#FB7185',11)} TIMEOUT</span>`
        : cfg.latency < 300
          ? `<span class="lat-good">${getIcon('zap-fill','#34D399',11)} ${cfg.latency}ms</span>`
          : cfg.latency <= 800
            ? `<span class="lat-ok">${getIcon('clock','#FCD34D',11)} ${cfg.latency}ms</span>`
            : `<span class="lat-slow">${getIcon('clock','#FB7185',11)} ${cfg.latency}ms</span>`;

    const v = verificationLabel(cfg);
    const borderColor = verificationPass(cfg) ? '#22c55e' : cfg.live === false ? '#ef4444' : '#1E3A5F';

    const scoreWidth = Math.min(cfg.score, 100);
    const liveColor = verificationPass(cfg) ? 'rgba(52,211,153,0.5)' : cfg.live === false ? 'rgba(251,113,133,0.4)' : cfg.reachable === true ? 'rgba(45,212,191,0.45)' : 'rgba(45,212,191,0.15)';
    return `<div class="splitnet-card" style="border-color:${liveColor}">
      <div class="splitnet-card-hdr">
        ${getProtoIcon(cfg.type, 13)}
        <span class="pbadge p-${escHtml(cfg.type)}">${escHtml(cfg.type)}</span>
        ${cfg.isMahsa ? '<span class="badge-mahsa" style="font-size:.5rem">MAHSA</span>' : ''}
        ${`<span class="conn-badge ${v.cls}" style="font-size:.52rem;padding:1px 4px" title="${escAttr(v.title)}">${v.text}</span>`}
        <span style="margin-left:auto;font-size:.56rem;color:var(--text3);font-family:var(--mono)">#${i+1}</span>
      </div>
      <div class="splitnet-host" title="${escAttr((cfg.host||'')+ ':' + cfg.port)}">${escHtml(cfg.host || '—')}<span style="color:var(--cyan2)">:${cfg.port}</span></div>
      <div class="splitnet-score-bar"><div class="splitnet-score-fill" style="width:${scoreWidth}%"></div></div>
      <div class="splitnet-meta">
        <span style="color:var(--text3)">Score: <b style="color:var(--cyan)">${cfg.score}</b></span>
        <span>${latBadge}</span>
        ${getSecurityIcon(cfg.security, cfg.type, 11)}
        <span style="color:var(--text3)">${escHtml(cfg.security||'none')}</span>
      </div>
      <div class="splitnet-actions">
        <button class="btn btn-xs btn-cyan" onclick="splitnetCopy(${idx})" title="Copy URI">${getIcon('copy','#22D3EE',11)} Copy</button>
        <button class="btn btn-xs btn-teal" onclick="splitnetPing(${idx})" title="Ping host">${getIcon('zap-fill','#2DD4BF',11)} Ping</button>
        <button class="btn btn-xs btn-green" onclick="splitnetImport(${idx})" title="Import to main list">${getIcon('download','#34D399',11)} Import</button>
        <button class="btn btn-xs btn-ghost" onclick="splitnetDetail(${idx})" title="View detail">${getIcon('eye','#94A3B8',11)}</button>
        <button class="btn btn-xs btn-purple" onclick="showQR(${idx},'splitnet')" title="QR Code">${getIcon('qr','#C4B5FD',11)}</button>
      </div>
    </div>`;
  }).join('');
}

function splitnetCopy(idx) {
  const cfg = S.splitnetConfigs[idx];
  if (!cfg) return;
  navigator.clipboard.writeText(cfg.raw || '').then(() => toast('Copied!','ok'));
}

function splitnetDetail(idx) {
  const cfg = S.splitnetConfigs[idx];
  if (!cfg) return;
  showDetailCfg(cfg);
}

function splitnetImport(idx) {
  const cfg = S.splitnetConfigs[idx];
  if (!cfg) return;
  const dup = S.configs.find(c => c.host === cfg.host && c.port === cfg.port && c.type === cfg.type);
  if (dup) { toast('Already in configs', 'warn'); return; }
  scoreConfig(cfg);
  cfg.sourceName = 'SplitNet Import';
  S.configs.push(cfg);
  S.configs.sort((a,b) => b.score - a.score);
  updateHeaderStats(); renderTable(); updateExportArea();
  toast('Config imported to main list', 'ok');
  persistConfigs();
}

function splitnetCopyAll() {
  const configs = getFilteredSplitnet();
  const uris = configs.map(c => getExportUri(c)).filter(Boolean).join('\n');
  if (!uris) { toast('No configs to copy', 'warn'); return; }
  navigator.clipboard.writeText(uris).then(() => toast(`${configs.length} configs copied`, 'ok'));
}

function splitnetDownload() {
  const configs = getFilteredSplitnet();
  if (!configs.length) { toast('No configs to download', 'warn'); return; }
  const raw = configs.map(c => getExportUri(c)).filter(Boolean).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(raw);
  a.download = `splitnet-${Date.now()}.txt`;
  a.click();
  toast(`${configs.length} configs downloaded`, 'ok');
}

function splitnetDownloadBase64() {
  const configs = getFilteredSplitnet();
  if (!configs.length) { toast('No configs', 'warn'); return; }
  const raw = configs.map(c => getExportUri(c)).filter(Boolean).join('\n');
  const b64 = btoa(new TextEncoder().encode(raw).reduce((s,b)=>s+String.fromCharCode(b),''));
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(b64);
  a.download = `splitnet-sub-${Date.now()}.txt`;
  a.click();
  toast(`Base64 subscription downloaded`, 'ok');
}

function splitnetImportAll() {
  const configs = getFilteredSplitnet();
  if (!configs.length) { toast('No configs to import', 'warn'); return; }
  let added = 0;
  for (const cfg of configs) {
    const dup = S.configs.find(c => c.host === cfg.host && c.port === cfg.port && c.type === cfg.type);
    if (dup) continue;
    const clone = { ...cfg, sourceName: 'SplitNet Import' };
    scoreConfig(clone);
    S.configs.push(clone);
    added++;
  }
  if (added) {
    S.configs.sort((a,b) => b.score - a.score);
    updateHeaderStats(); renderTable(); updateExportArea(); persistConfigs();
    toast(`Imported ${added} configs to main list`, 'ok');
  } else {
    toast('All configs already in main list', 'warn');
  }
}

async function splitnetPingAll() {
  const configs = getFilteredSplitnet().slice(0, 30);
  if (!configs.length) { toast('No configs to ping', 'warn'); return; }
  toast(`Pinging ${configs.length} configs...`, 'info');
  const btn = document.getElementById('splitnetPingAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Pinging...'; }
  const q = [...configs];
  await Promise.all(Array.from({length: 5}, async () => {
    while (q.length > 0) {
      const cfg = q.shift(); if (!cfg) continue;
      if (cfg.type === 'wireguard') await pingWgHost(cfg); else await testConfigLatency(cfg);
      scoreConfig(cfg);
    }
  }));
  S.splitnetConfigs.sort((a,b) => b.score - a.score);
  renderSplitNetPanel();
  if (btn) { btn.disabled = false; btn.textContent = '⚡ Ping All'; }
  const live = configs.filter(verificationPass).length;
  toast(`Ping done — ${live}/${configs.length} live`, live > 0 ? 'ok' : 'warn');
}

async function splitnetPing(idx) {
  const cfg = S.splitnetConfigs[idx];
  if (!cfg) return;
  toast(`Ping ${cfg.host}...`, 'info');
  if (cfg.type === 'wireguard') await pingWgHost(cfg); else await testConfigLatency(cfg);
  scoreConfig(cfg);
  S.splitnetConfigs.sort((a, b) => b.score - a.score);
  renderSplitNetPanel();
  toast(`Latency: ${cfg.latency >= 9999 ? 'TIMEOUT' : cfg.latency + 'ms'}`, cfg.latency < 2000 ? 'ok' : 'warn');
}

// ============================================================
// IRCF.SPACE — WARP+ KEYS FETCHER
// Keys auto-updated every 1h at ircfspace/warpkey
// ============================================================
async function fetchWarpKeys() {
  const btn = document.getElementById('warpKeyRefreshBtn');
  const container = document.getElementById('warpKeysContainer');
  const countEl = document.getElementById('warpKeyCount');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching...'; }
  if (container) container.innerHTML = '<div style="padding:14px;color:var(--text3);font-size:.7rem">Fetching from ircfspace/warpkey...</div>';

  try {
    // Try full list first, fall back to lite
    let text = '';
    try {
      const res = await fetchWithCache(IRCF_URLS.warpKeyFull);
      text = res.text;
    } catch {
      const res = await fetchWithCache(IRCF_URLS.warpKeyLite);
      text = res.text;
    }

    S.warpKeys = text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 10 && /^[A-Za-z0-9]{8}-[A-Za-z0-9]{8}-[A-Za-z0-9]{8}$/.test(l));

    // Persist to DB meta
    await dbSetMeta('ircf:warpkeys', { keys: S.warpKeys, ts: Date.now() });

    if (countEl) countEl.textContent = S.warpKeys.length;
    const nbEl = document.getElementById('nb-warpkeys');
    if (nbEl) nbEl.textContent = S.warpKeys.length;
    renderWarpKeys();
    updateIrcfBadge();
    toast(`${S.warpKeys.length} Warp+ keys loaded from IRCF`, 'ok');
    logConsole('success', `IRCF Warp+ keys: ${S.warpKeys.length} keys fetched`);
  } catch(e) {
    if (container) container.innerHTML = `<div style="padding:14px;color:var(--red);font-size:.7rem">Failed: ${escHtml(e.message.slice(0,80))}</div>`;
    toast('Warp+ key fetch failed', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔑 Fetch Warp+ Keys'; }
  }
}


function copyWarpKey(i) {
  const key = S.warpKeys[i];
  if (!key) return;
  navigator.clipboard.writeText(key).then(() => toast(`Key copied: ${key.slice(0,8)}...`, 'ok'));
}

function copyAllWarpKeys() {
  if (!S.warpKeys.length) { toast('No keys', 'warn'); return; }
  navigator.clipboard.writeText(S.warpKeys.join('\n')).then(() => toast(`${S.warpKeys.length} keys copied`, 'ok'));
}

// ============================================================
// IRCF.SPACE — CLEAN CLOUDFLARE ENDPOINTS
// From ircfspace/endpoint — best IPs for Warp/Oblivion
// ============================================================
async function fetchWarpEndpoints() {
  const btn = document.getElementById('endpointRefreshBtn');
  const container = document.getElementById('endpointsContainer');
  const countEl = document.getElementById('endpointCount');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching...'; }
  if (container) container.innerHTML = '<div style="padding:14px;color:var(--text3);font-size:.7rem">Fetching endpoints from ircfspace/endpoint...</div>';

  try {
    // Try JSON first for rich data, fall back to plain WG text
    let endpoints = [];
    try {
      const res = await fetchWithCache(IRCF_URLS.endpointJson);
      const parsed = JSON.parse(res.text);
      // ip.json is an object with categories
      const flatten = (obj) => {
        if (Array.isArray(obj)) return obj.map(x => typeof x === 'string' ? {ip: x, type:'warp'} : x);
        if (typeof obj === 'object') return Object.entries(obj).flatMap(([cat, arr]) => 
          (Array.isArray(arr) ? arr : []).map(ip => ({ip: String(ip), type: cat}))
        );
        return [];
      };
      endpoints = flatten(parsed);
    } catch {
      // Plain text fallback
      const res = await fetchWithCache(IRCF_URLS.endpointWg);
      endpoints = res.text.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 4)
        .map(ip => ({ip, type: ip.includes(':') ? 'IPv6' : 'IPv4'}));
    }

    S.warpEndpoints = endpoints.slice(0, 500);
    await dbSetMeta('ircf:endpoints', { endpoints: S.warpEndpoints, ts: Date.now() });
    if (countEl) countEl.textContent = S.warpEndpoints.length;
    renderWarpEndpoints();
    updateIrcfBadge();
    toast(`${S.warpEndpoints.length} clean endpoints loaded`, 'ok');
    logConsole('success', `IRCF Endpoints: ${S.warpEndpoints.length} IPs`);
  } catch(e) {
    if (container) container.innerHTML = `<div style="padding:14px;color:var(--red);font-size:.7rem">Failed: ${escHtml(e.message.slice(0,80))}</div>`;
    toast('Endpoint fetch failed', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🌐 Fetch Endpoints'; }
  }
}


function copyEndpoint(ip) {
  navigator.clipboard.writeText(ip).then(() => toast(`Copied: ${ip}`, 'ok'));
}

function copyEndpointGroup(type) {
  const ips = S.warpEndpoints.filter(e => e.type === type).map(e => e.ip).join('\n');
  navigator.clipboard.writeText(ips).then(() => toast(`${type} IPs copied`, 'ok'));
}

function copyAllEndpoints() {
  if (!S.warpEndpoints.length) { toast('No endpoints', 'warn'); return; }
  const text = S.warpEndpoints.map(e => e.ip).join('\n');
  navigator.clipboard.writeText(text).then(() => toast(`${S.warpEndpoints.length} IPs copied`, 'ok'));
}

// ============================================================
// IRCF TAB — load all IRCF data from DB cache on init
// ============================================================
function updateIrcfBadge() {
  const nbEl = document.getElementById('nb-warpkeys');
  if (nbEl) nbEl.textContent = S.warpKeys.length + S.warpEndpoints.length;
}

async function loadIrcfFromDB() {
  const keys = await dbGetMeta('ircf:warpkeys');
  if (keys && keys.keys && keys.keys.length) {
    S.warpKeys = keys.keys;
    const el = document.getElementById('warpKeyCount');
    if (el) el.textContent = S.warpKeys.length;
    renderWarpKeys();
    logConsole('info', `IRCF: ${S.warpKeys.length} Warp+ keys from DB cache`);
  }
  const eps = await dbGetMeta('ircf:endpoints');
  if (eps && eps.endpoints && eps.endpoints.length) {
    S.warpEndpoints = eps.endpoints;
    const el = document.getElementById('endpointCount');
    if (el) el.textContent = S.warpEndpoints.length;
    renderWarpEndpoints();
    logConsole('info', `IRCF: ${S.warpEndpoints.length} endpoints from DB cache`);
  }
  // Fix 5 — restore ircfConfigs from DB cache
  const tconfigs = await dbGetMeta('ircf:tconfigs');
  if (tconfigs && tconfigs.configs && tconfigs.configs.length) {
    S.ircfConfigs = tconfigs.configs;
    logConsole('info', `IRCF: ${S.ircfConfigs.length} tconfig configs from DB cache`);
  }
  // Fix 4 — update sidebar badge with total IRCF item count
  updateIrcfBadge();
}
async function checkProxyHealth() {
  const btn = document.getElementById('checkProxyHealthBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  const results = document.getElementById('proxyHealthResults');
  if (results) results.innerHTML = '';

  const testUrl = 'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/Sub1.txt';
  const proxies = getActiveCorsProxies();
  if (!proxies.length) {
    if (results) results.innerHTML = '<div style="padding:10px;color:var(--text3);font-size:.7rem">No active proxies configured.</div>';
    if (btn) { btn.disabled = false; btn.textContent = '🔬 Check Proxy Health'; }
    return;
  }

  for (const proxy of proxies) {
    const row = document.createElement('div');
    row.className = 'proxy-health-row';
    row.innerHTML = `<span class="proxy-url" title="${escHtml(proxy.url)}">${escHtml((proxy.name || proxy.id || proxy.url).slice(0,40))}</span><span class="proxy-status checking">⏳</span><span class="proxy-ms"></span>`;
    if (results) results.appendChild(row);

    const statusEl = row.querySelector('.proxy-status');
    const msEl     = row.querySelector('.proxy-ms');
    const start    = Date.now();
    try {
      const ctrl  = new AbortController();
      setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(proxy.url + encodeURIComponent(testUrl), {signal:ctrl.signal, cache:'no-store'});
      const ms  = Date.now() - start;
      if (res.ok) {
        statusEl.textContent = '✓'; statusEl.className = 'proxy-status ok';
        msEl.textContent = `${ms}ms`;
      } else {
        statusEl.textContent = `✗ ${res.status}`; statusEl.className = 'proxy-status bad';
        msEl.textContent = `${ms}ms`;
      }
    } catch(e) {
      const ms = Date.now() - start;
      statusEl.textContent = e.name === 'AbortError' ? '⏱ Timeout' : '✗ Failed';
      statusEl.className = 'proxy-status bad';
      msEl.textContent = `${ms}ms`;
    }
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔬 Check Proxy Health'; }
}

// ============================================================
// MASTER FETCH PIPELINE
// ============================================================
async function masterFetch() {
  if (S.fetchRunning) return;
  S.fetchRunning = true; S.stopReq = false;
  S.stats = {fetched:0,failed:0,tested:0};
  setBtnState('running'); setStatus('busy','FETCHING');
  logConsole('info',`Starting fetch from ${S.sources.filter(s=>s.enabled).length} active sources`);

  const enabled   = S.sources.filter(s=>s.enabled);
  const concurrency = parseInt(document.getElementById('concurrency')?.value||'3');
  const maxPerSrc   = parseInt(document.getElementById('cfg-maxperSource')?.value||'2000');
  const maxTotal    = parseInt(document.getElementById('cfg-maxConfigs')?.value||'15000');
  const dohEnabled  = document.getElementById('cfg-dohEnabled')?.checked;
  let completed = 0; const total = enabled.length;

  document.getElementById('srcLog').innerHTML = '';
  enabled.forEach(src => createSrcItem(src.id, src.name));
  S.globalSigs = new Set(S.configs.map(c=>`${c.type}:${(c.host||'').toLowerCase()}:${c.port}`));
  const queue = [...enabled];

  async function doFetch(src) {
    if (S.stopReq) return;
    setSrcStatus(src.id,'loading');
    const t0=Date.now();
    try {
      const {text,strategy} = await fetchWithCache(src.url);
      const found   = extractConfigs(text);
      const limited = found.slice(0,maxPerSrc);
      let added=0;
      for (const cfg of limited) {
        if (S.stopReq||S.configs.length>=maxTotal) break;
        const sig=`${cfg.type}:${(cfg.host||'').toLowerCase()}:${cfg.port}`;
        if (S.globalSigs.has(sig)) continue;
        S.globalSigs.add(sig);
        scoreConfig(cfg);
        cfg.sourceId=src.id; cfg.sourceName=src.name;
        if (dohEnabled&&cfg.host&&!/^[\d.]+$/.test(cfg.host)) {
          checkDoH(cfg.host).then(ok => { cfg.doh=ok; if (!ok) cfg.score=Math.max(0,cfg.score-15); });
        }
        S.configs.push(cfg); added++;
      }
      const elapsed=Date.now()-t0;
      src.lastStatus='ok'; src.lastCount=added; src.lastTime=elapsed;
      S.stats.fetched++;
      setSrcStatus(src.id,'ok',added,elapsed,strategy);
      logConsole('success',`${src.name}: +${added} [${strategy}] (${elapsed}ms)`);
    } catch(e) {
      src.lastStatus='err'; src.lastError=e.message;
      S.stats.failed++;
      setSrcStatus(src.id,'err',0,Date.now()-t0,'fail');
      logConsole('error',`${src.name}: ${e.message.slice(0,80)}`);
    }
    completed++;
    updateProgress(completed,total);
    updateHeaderStats(); renderTable(); updateExportArea();
  }

  await Promise.all(Array.from({length:concurrency},async()=>{
    while (queue.length>0&&!S.stopReq) { const src=queue.shift(); if (src) await doFetch(src); }
  }));

  S.fetchRunning=false;
  S.configs.sort((a,b)=>b.score-a.score);
  setBtnState(S.stopReq?'stopped':'complete');
  setStatus('idle', S.stopReq?'STOPPED':'DONE');
  logConsole('success',`Fetch complete. Total: ${S.configs.length} from ${S.stats.fetched}/${total} sources`);
  updateHeaderStats(); renderTable(); updateExportArea(); renderWgPanel();
  toast(`${S.configs.length} configs from ${S.stats.fetched}/${total} sources`,'ok');

  // Persist to IndexedDB
  await persistConfigs();

  if (S.autoTimer) clearTimeout(S.autoTimer);
  const interval=parseInt(document.getElementById('cfg-autoInterval')?.value||'0');
  if (interval>0) {
    S.autoTimer=setTimeout(()=>masterFetch(),interval*60*1000);
    startCountdown(interval * 60);
    logConsole('info',`Auto-refresh in ${interval} minutes`);
  }
  setTimeout(()=>{ if (!S.fetchRunning) setBtnState('idle'); },4000);
}

async function persistConfigs() {
  await dbSave('configs', S.configs);
  await dbSetMeta('last_save', Date.now());
  logConsole('info', `${S.configs.length} configs persisted to IndexedDB`);
}

function stopAll() {
  S.stopReq=true;
  if (S.autoTimer) { clearTimeout(S.autoTimer); S.autoTimer=null; }
  if (S.autoCountdownTimer) { clearInterval(S.autoCountdownTimer); S.autoCountdownTimer=null; S.autoCountdownSec=0; updateCountdownUI(); }
  logConsole('warning','Stop requested');
  setStatus('idle','STOPPED');
}

// ============================================================
// UI HELPERS
// ============================================================
function setBtnState(state) {
  const btn=document.getElementById('masterFetchBtn');
  const stop=document.getElementById('stopBtn');
  const setLabel=(el,text)=>{
    if (!el) return;
    let label=el.querySelector('[data-ph-btn-label]');
    if (!label) {
      label=[...el.querySelectorAll('span')].find(s=>!s.classList.contains('fetch-ripple')&&!s.classList.contains('spin')) || null;
      if (label) label.setAttribute('data-ph-btn-label','1');
    }
    if (label) label.textContent=text;
    else {
      // Legacy fallback: keep any SVG icon instead of destroying the button structure.
      const svg=el.querySelector('svg');
      [...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).forEach(n=>n.remove());
      const span=document.createElement('span'); span.setAttribute('data-ph-btn-label','1'); span.textContent=text;
      if (svg?.nextSibling) el.insertBefore(span,svg.nextSibling); else el.appendChild(span);
    }
  };
  if (state==='running') {
    if (btn) { btn.disabled=true; btn.dataset.phState='running'; setLabel(btn,'Fetching…'); }
    if (stop) stop.disabled=false;
  } else if (state==='complete') {
    if (btn) { btn.disabled=false; btn.dataset.phState='complete'; setLabel(btn,'Done'); }
    if (stop) stop.disabled=true;
  } else if (state==='stopped') {
    if (btn) { btn.disabled=false; btn.dataset.phState='stopped'; setLabel(btn,'Stopped'); }
    if (stop) stop.disabled=true;
  } else {
    if (btn) { btn.disabled=false; btn.dataset.phState='idle'; setLabel(btn,'FETCH ALL'); }
    if (stop) stop.disabled=true;
  }
  window.PH_PREMIUM_UI?.sync?.();
}

function setStatus(state, text) {
  const d=document.getElementById('statusDot');
  const t=document.getElementById('statusText');
  if (d) {
    d.className='sdot';
    if (state==='busy'||state==='running') d.classList.add('busy');
    else if (state==='idle'||state==='error') d.classList.add('idle');
  }
  if (t) t.textContent=text;
  phEmit('ph:status', { state, text, ts: Date.now() });
}

function updateProgress(done,total) {
  const pct=total>0?Math.round(done/total*100):0;
  const pf=document.getElementById('progFill');
  const ps=document.getElementById('progStatus');
  const pc=document.getElementById('progCount');
  if (pf) pf.style.width=pct+'%';
  if (ps) {
    const txt = done < total ? `Fetching… (${pct}%)` : done === 0 ? 'Ready — press FETCH ALL' : 'Complete ✓';
    // keep SVG icon, update only the text node
    const textNode = [...ps.childNodes].find(n=>n.nodeType===3);
    if (textNode) textNode.textContent = ' ' + txt;
    else ps.append(' ' + txt);
  }
  if (pc) pc.textContent=`${done} / ${total}`;
  phEmit('ph:progress', { done, total, pct, ts: Date.now() });
}

function updateHeaderStats() {
  const total  = S.configs.length;
  const alive  = S.configs.filter(c=>c.live===true).length;
  const dead   = S.configs.filter(c=>c.live===false).length;
  const dohok  = S.configs.filter(c=>c.doh===true).length;
  const tested = S.configs.filter(c=>c.tested).length;
  const active = S.configs.filter(c=>c.score>=30).length;
  const wg     = S.configs.filter(c=>c.type==='wireguard').length;
  const vless  = S.configs.filter(c=>c.type==='vless').length;
  const vmess  = S.configs.filter(c=>c.type==='vmess').length;
  const trojan = S.configs.filter(c=>c.type==='trojan').length;
  const other  = S.configs.filter(c=>!['vless','vmess','trojan','wireguard'].includes(c.type)).length;
  const setEl  = (id,val) => { const el=document.getElementById(id); if (el) el.textContent=val; };
  setEl('h-total',total); setEl('h-active',active); setEl('h-wg',wg);
  setEl('h-fetched',S.stats.fetched); setEl('h-failed',S.stats.failed);
  setEl('nb-total',total); setEl('nb-configs',total); setEl('nb-wg',wg);
  setEl('s-total',total); setEl('s-active',active);
  setEl('s-vmess',vmess);
  setEl('s-vless',vless);
  setEl('s-trojan',trojan);
  setEl('s-wg',wg);
  setEl('stat-total',total); setEl('stat-alive',alive); setEl('stat-dohok',dohok);
  // stat-tested is now a sub-label inside the Live card
  const testedEl = document.getElementById('stat-tested');
  if (testedEl) testedEl.textContent = tested + ' tested';
  setEl('badge-total',total);
  // Config stats ribbon
  setEl('csr-total', total);
  setEl('csr-live',  alive);
  setEl('csr-dead',  dead);
  setEl('csr-vless', vless);
  setEl('csr-vmess', vmess);
  setEl('csr-trojan',trojan);
  setEl('csr-wg',    wg);
  setEl('csr-other', other);
  try { window.PH_PREMIUM_UI?.sync?.(); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('ph:counts', { detail: { total, alive, dead, dohok, tested, active, wg, vless, vmess, trojan, other, fetched:S.stats.fetched, failed:S.stats.failed } })); } catch (_) {}
}

function createSrcItem(id, name) {
  // Remove empty placeholder if present
  const srcLog = document.getElementById('srcLog');
  if (srcLog) {
    const empty = srcLog.querySelector('.empty');
    if (empty) empty.remove();
  }
  const el = document.createElement('div');
  el.className = 'src-log-row src-log-pending';
  el.id = `si-${id}`;
  el.innerHTML = `
    <span class="src-log-dot" id="sd-${id}"></span>
    <span class="src-name" title="${escHtml(name)}">${escHtml(name)}</span>
    <span class="src-count zero" id="sc-${id}">—</span>
    <span class="src-time" id="sm-${id}"></span>
    <span id="ss-${id}" style="font-size:8.5px;text-align:right;font-family:var(--head)"></span>
  `;
  if (srcLog) srcLog.appendChild(el);
  // update count display
  const countEl = document.getElementById('srcLogCount');
  if (countEl) countEl.textContent = (srcLog?.querySelectorAll('.src-log-row').length || 0) + ' sources';
}

function setSrcStatus(id, state, cnt=0, ms=0, strategy='') {
  const row   = document.getElementById(`si-${id}`);
  const dot   = document.getElementById(`sd-${id}`);
  const cntEl = document.getElementById(`sc-${id}`);
  const msEl  = document.getElementById(`sm-${id}`);
  const ssEl  = document.getElementById(`ss-${id}`);
  if (!dot) return;

  if (row) {
    row.classList.remove('src-log-ok','src-log-err','src-log-pending');
    row.classList.add(state === 'ok' ? 'src-log-ok' : state === 'err' ? 'src-log-err' : 'src-log-pending');
  }

  if (state === 'ok') {
    // Map strategy → badge style class and label
    const stratMap = {
      'local-bridge': ['strat-1','BRIDGE'],
      'direct':       ['strat-2','DIRECT'],
      'smart':        ['strat-3','SMART'],
      'cache':        ['strat-0','CACHE'],
      'stale-cache':  ['strat-0','STALE'],
      'mirror':       ['strat-4','MIRROR'],
    };
    let [stratCls, stratLbl] = stratMap[strategy] || (strategy.startsWith('proxy:') ? ['strat-5','CORS'] : ['strat-2', strategy.toUpperCase().slice(0,6)]);
    if (cntEl) {
      cntEl.className = 'src-count';
      cntEl.textContent = '+' + cnt;
    }
    if (msEl)  msEl.textContent = ms + 'ms';
    if (ssEl)  ssEl.innerHTML = `<span class="strategy-badge ${stratCls}" style="padding:1px 5px;font-size:8px">${stratLbl}</span>`;
  } else if (state === 'err') {
    if (cntEl) { cntEl.className = 'src-count zero'; cntEl.innerHTML = '<span style="color:var(--red);font-size:9px">ERR</span>'; }
    if (msEl)  msEl.textContent = ms ? ms+'ms' : '';
    if (ssEl)  ssEl.innerHTML = '';
  }
}

function clearLog() { const a=document.getElementById('log-console'); const b=document.getElementById('logOutput'); if (a) a.innerHTML=''; if (b) b.innerHTML=''; }

// ============================================================
// GET FILTERED CONFIGS — shared filter+sort helper used by
// renderTable, renderCompactGrid, and all export buttons
// ============================================================
function getFilteredConfigs() {
  const pf = document.getElementById('protoFilter')?.value || '';
  const df = document.getElementById('dohFilter')?.value || '';
  const search = (S.configSearch || '').toLowerCase();
  const scoreThreshold = parseInt(document.getElementById('cfg-scoreThreshold')?.value || '0');
  let filtered = S.configs.filter(c => {
    if (pf && c.type !== pf) return false;
    if (df === 'ok'   && c.doh  !== true)  return false;
    if (df === 'bad'  && c.doh  !== false) return false;
    if (df === 'live' && !verificationPass(c))  return false;
    if (scoreThreshold > 0 && c.score < scoreThreshold) return false;
    if (search) {
      const h = `${c.host} ${c.remarks} ${c.type} ${c.sni}`.toLowerCase();
      if (!h.includes(search)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    let av, bv;
    if      (S.sortCol === 'score')   { av = a.score||0;   bv = b.score||0; }
    else if (S.sortCol === 'latency') { av = a.latency==null?99999:a.latency; bv = b.latency==null?99999:b.latency; }
    else if (S.sortCol === 'host')    { av = (a.host||'').toLowerCase(); bv = (b.host||'').toLowerCase(); }
    else if (S.sortCol === 'port')    { av = parseInt(a.port)||0; bv = parseInt(b.port)||0; }
    else if (S.sortCol === 'type')    { av = a.type||''; bv = b.type||''; }
    else { av = a.score||0; bv = b.score||0; }
    if (S.sortDir === 'desc') return av < bv ? 1 : av > bv ? -1 : 0;
    return av > bv ? 1 : av < bv ? -1 : 0;
  });
  return filtered;
}

// ============================================================
// TABLE RENDERING
// ============================================================
function getInsecureBadge(cfg) {
  if (cfg.security==='none'&&cfg.type!=='wireguard') return '<span class="badge-insecure">INSECURE</span>';
  return '';
}
function getMahsaBadge(cfg) { return cfg.isMahsa?'<span class="badge-mahsa">MAHSA</span>':''; }
function getCardBorderStyle(cfg) {
  if (cfg.live===true&&cfg.security!=='none') return 'border:1px solid #22c55e;';
  if (cfg.live===false||(cfg.security==='none'&&cfg.type!=='wireguard')) return 'border:1px solid #ef4444;';
  return 'border:1px solid #374151;';
}
function buildSecurityLabel(cfg) {
  let secLabel=escHtml(cfg.security||'none');
  if (cfg.security==='none'&&cfg.type!=='wireguard') secLabel+=' <span class="badge-insecure">INSECURE</span>';
  if (cfg.isMahsa) secLabel+=' <span class="badge-mahsa">MAHSA</span>';
  return secLabel;
}

function renderTableRow(cfg, i, idx) {
  const latMs = cfg.latency;
  const latBadge = latMs === null
    ? `<span class="lat-pending">${getIcon('clock','#607D96',13)} —</span>`
    : latMs >= 9999
      ? `<span class="lat-slow">${getIcon('warning','#FB7185',13)} TIMEOUT</span>`
      : latMs > 800
        ? `<span class="lat-slow">${getIcon('clock','#FB7185',13)} ${latMs}ms</span>`
        : latMs < 300
          ? `<span class="lat-good">${getIcon('zap-fill','#34D399',13)} ${latMs}ms</span>`
          : `<span class="lat-ok">${getIcon('clock','#FCD34D',13)} ${latMs}ms</span>`;

  const dohBadge = cfg.doh === true
    ? `<span class="doh-ok">${getIcon('check-circle','#34D399',14)} OK</span>`
    : cfg.doh === false
      ? `<span class="doh-bad">${getIcon('x-circle','#FB7185',14)} Dead</span>`
      : `<span class="doh-pend">${getIcon('info','#607D96',14)} Unknown</span>`;

  const v = verificationLabel(cfg);
  const liveBadge = `<span class="conn-badge ${v.cls}" title="${escAttr(v.title)}">${v.text}</span>`;

  const secLabel = buildSecurityLabel(cfg);
  const score = Math.min(cfg.score, 100);
  const scoreColor = score >= 70 ? '#22d3ee' : score >= 40 ? '#a78bfa' : '#f59e0b';
  const rowClass = cfg.live === true ? 'row-live' : cfg.live === false ? 'row-dead' : '';
  const rowBorder = cfg.live === true
    ? 'border-left:2px solid rgba(52,211,153,0.55)'
    : cfg.live === false || (cfg.security === 'none' && cfg.type !== 'wireguard')
      ? 'border-left:2px solid rgba(251,113,133,0.35)'
      : 'border-left:2px solid transparent';

  return `<tr data-idx="${idx}" class="${rowClass}" style="${rowBorder}">
    <td style="color:var(--text3);font-size:.58rem;padding-left:10px;width:36px">${i+1}</td>
    <td>
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
        <span class="cfg-icon">${getProtoIcon(cfg.type, 13)}</span>
        <span class="pbadge p-${escHtml(cfg.type)}">${escHtml(cfg.type)}</span>
        ${getMahsaBadge(cfg)}${getInsecureBadge(cfg)}
      </div>
    </td>
    <td class="host-cell" title="${escAttr(cfg.host || '')}">${liveBadge}${escHtml(cfg.host || '—')}</td>
    <td class="port-cell">${cfg.port}</td>
    <td style="font-size:.67rem;color:var(--text2)">
      <div style="display:flex;align-items:center;gap:4px">
        <span class="cfg-icon">${getSecurityIcon(cfg.security, cfg.type, 12)}</span>
        ${secLabel}
      </div>
    </td>
    <td>
      <div class="score-wrap">
        <span class="cfg-icon">${getScoreIcon(cfg.score)}</span>
        <div class="score-bar"><div class="score-fill" style="width:${score}%;background:linear-gradient(90deg,${scoreColor},var(--purple))"></div></div>
        <span class="score-num" style="color:${scoreColor}">${cfg.score}</span>
      </div>
    </td>
    <td>${latBadge}</td>
    <td>${dohBadge}</td>
    <td>
      <div class="cfg-row-actions">
        <button class="btn btn-xs btn-green connect-btn" data-idx="${idx}" title="Connect to Proxy">▶</button>
        <button class="btn btn-xs btn-cyan"   onclick="showDetail(${idx})"     title="Detail">${getIcon('eye','#22D3EE',12)}</button>
        <button class="btn btn-xs btn-ghost"  onclick="copyUri(${idx})"        title="Copy URI">${getIcon('copy','#94A3B8',12)}</button>
        <button class="btn btn-xs btn-purple" onclick="showQR(${idx},'main')"  title="QR Code">${getIcon('qr','#C4B5FD',12)}</button>
        <button class="btn btn-xs btn-yellow" onclick="testOne(${idx})"        title="Test">${getIcon('zap-fill','#FCD34D',12)}</button>
        <button class="btn btn-xs btn-orange" onclick="enterEditMode(${idx})"  title="Edit">${getIcon('pencil','#FDBA74',12)}</button>
        <button class="btn btn-xs btn-red"    onclick="deleteConfig(${idx})"   title="Delete">${getIcon('trash','#FB7185',12)}</button>
      </div>
    </td>
  </tr>`;
}

// ============================================================
// ACTIVE FILTER BADGE
// ============================================================
function updateActiveFilterBadge() {
  const el = document.getElementById('cfgActiveFilterBadge');
  if (!el) return;
  const proto     = document.getElementById('protoFilter')?.value     || '';
  const doh       = document.getElementById('dohFilter')?.value       || '';
  const score     = parseInt(document.getElementById('cfg-scoreThreshold')?.value || '0');
  const search    = (S.configSearch || '').trim();

  const parts = [];
  if (proto)    parts.push(`${getIcon('lightning','#22D3EE',11)} ${escHtml(proto.toUpperCase())}`);
  if (doh === 'ok')   parts.push(`${getIcon('check-circle','#34D399',11)} DoH OK`);
  if (doh === 'bad')  parts.push(`${getIcon('x-circle','#FB7185',11)} DoH Dead`);
  if (doh === 'live') parts.push(`${getIcon('zap-fill','#34D399',11)} Live Only`);
  if (score > 0)  parts.push(`${getIcon('star-filled','#FCD34D',11)} Score≥${score}`);
  if (search)     parts.push(`${getIcon('search','#C4B5FD',11)} "${escHtml(search)}"`);

  if (parts.length === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
  } else {
    el.style.display = 'inline-flex';
    el.innerHTML = parts.join('<span style="color:var(--text3);margin:0 3px">·</span>');
  }
}

function renderTable() {
  const tbody=document.getElementById('cfgsBody');
  const empty=document.getElementById('cfgsEmpty');

  const filtered = getFilteredConfigs();

  if (!tbody||!empty) return;
  if (filtered.length===0) { tbody.innerHTML=''; empty.style.display='flex'; return; }
  empty.style.display='none';

  tbody.innerHTML=filtered.slice(0,500).map((cfg,i)=>{
    const idx=S.configs.indexOf(cfg);
    return renderTableRow(cfg,i,idx);
  }).join('');

  // Update sort column indicators (active class + arrow)
  document.querySelectorAll('.sort-th').forEach(th => {
    // Remove stale arrow first
    th.querySelector('.sort-arrow')?.remove();
    const isActive = th.dataset.sort === S.sortCol;
    th.classList.toggle('active', isActive);
    if (isActive) {
      const a = document.createElement('span');
      a.className = 'sort-arrow';
      a.textContent = S.sortDir === 'desc' ? ' ▾' : ' ▴';
      th.appendChild(a);
    }
  });

  // Update count display
  const countEl=document.getElementById('configsCountDisplay');
  if (countEl) countEl.textContent=`${filtered.length} of ${S.configs.length} configs`;

  // Always sync compact grid when in compact mode
  if (S.viewMode === 'compact') renderCompactGrid();

  updateActiveFilterBadge();
}

// ============================================================
// COMPACT GRID VIEW
// ============================================================
function renderCompactGrid() {
  const grid  = document.getElementById('cfgsCompactGrid');
  const empty = document.getElementById('cfgsEmpty');
  if (!grid) return;

  const filtered = getFilteredConfigs();
  const countEl = document.getElementById('configsCountDisplay');

  if (!filtered.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    if (countEl) countEl.textContent = `0 of ${S.configs.length} configs`;
    return;
  }
  if (empty) empty.style.display = 'none';
  if (countEl) countEl.textContent = `${filtered.length} of ${S.configs.length} configs`;

  grid.innerHTML = filtered.slice(0, 500).map((cfg, i) => {
    const idx = S.configs.indexOf(cfg);
    const latMs = cfg.latency;
    const latBadge = latMs == null
      ? `<span class="lat-pending">${getIcon('clock','#607D96',11)} —</span>`
      : latMs >= 9999
        ? `<span class="lat-slow">${getIcon('warning','#FB7185',11)} TIMEOUT</span>`
        : latMs < 300
          ? `<span class="lat-good">${getIcon('zap-fill','#34D399',11)} ${latMs}ms</span>`
          : latMs <= 800
            ? `<span class="lat-ok">${getIcon('clock','#FCD34D',11)} ${latMs}ms</span>`
            : `<span class="lat-slow">${getIcon('clock','#FB7185',11)} ${latMs}ms</span>`;
    const v = verificationLabel(cfg);
    const liveBadge = `<span class="conn-badge ${v.cls}" style="font-size:.55rem;padding:1px 4px" title="${escAttr(v.title)}">${v.text}</span>`;
    const dohDot = cfg.doh === true
      ? `<span title="DoH OK" style="color:#34D399">${getIcon('check-circle','#34D399',11)}</span>`
      : cfg.doh === false
        ? `<span title="DoH Dead" style="color:#FB7185">${getIcon('x-circle','#FB7185',11)}</span>`
        : '';
    const liveDot = verificationPass(cfg)
      ? 'border-color:rgba(52,211,153,0.5)'
      : cfg.live === false
        ? 'border-color:rgba(251,113,133,0.4)'
        : cfg.reachable === true ? 'border-color:rgba(45,212,191,0.45)' : '';
    return `<div class="compact-card" style="${liveDot}">
      <div class="compact-card-top">
        <span style="display:flex;align-items:center;gap:3px">${getProtoIcon(cfg.type, 12)}<span class="pbadge p-${escHtml(cfg.type)}">${escHtml(cfg.type)}</span></span>
        ${liveBadge}
        <span class="compact-card-host" title="${escAttr(cfg.host)}">${escHtml(cfg.host || '—')}</span>
        <span class="compact-card-port">:${cfg.port}</span>
      </div>
      <div class="compact-score-bar">
        <div class="compact-score-fill" style="width:${Math.min(cfg.score,100)}%"></div>
      </div>
      <div class="compact-card-meta">
        <span>Score: <b style="color:var(--cyan)">${cfg.score}</b></span>
        <span>${latBadge}</span>
        <span style="display:flex;align-items:center;gap:3px;font-size:.58rem">${getSecurityIcon(cfg.security,cfg.type,11)} ${escHtml(cfg.security||'none')} ${dohDot}</span>
      </div>
      <div class="compact-card-actions">
        <button class="btn btn-xs btn-cyan"   onclick="showDetail(${idx})"    title="Detail">${getIcon('eye','#22D3EE',12)}</button>
        <button class="btn btn-xs btn-green"  onclick="copyUri(${idx})"       title="Copy URI">${getIcon('copy','#34D399',12)}</button>
        <button class="btn btn-xs btn-purple" onclick="showQR(${idx},'main')" title="QR Code">${getIcon('qr','#C4B5FD',12)}</button>
        <button class="btn btn-xs btn-yellow" onclick="testOne(${idx})"       title="Test">${getIcon('zap-fill','#FCD34D',12)}</button>
        <button class="btn btn-xs btn-orange" onclick="enterEditMode(${idx})" title="Edit">${getIcon('pencil','#FDBA74',12)}</button>
        <button class="btn btn-xs btn-red"    onclick="deleteConfig(${idx})"  title="Delete">${getIcon('trash','#FB7185',12)}</button>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// VIEW TOGGLE — table ↔ compact grid
// ============================================================
function setConfigsView(mode) {
  S.viewMode = mode;
  const table       = document.getElementById('cfgsTable');
  const compactGrid = document.getElementById('cfgsCompactGrid');
  const tableBtn    = document.getElementById('viewTableBtn');
  const compactBtn  = document.getElementById('viewCompactBtn');

  if (mode === 'compact') {
    if (table)       table.style.display       = 'none';
    if (compactGrid) compactGrid.style.display  = 'grid';
    tableBtn?.classList.remove('active');
    compactBtn?.classList.add('active');
    renderCompactGrid();
  } else {
    if (table)       table.style.display       = '';
    if (compactGrid) compactGrid.style.display  = 'none';
    tableBtn?.classList.add('active');
    compactBtn?.classList.remove('active');
    renderTable();
  }
}

// ============================================================
// FULL CONFIG EDIT MODAL — works in table AND compact view
// ============================================================
let _editIdx = -1;

function enterEditMode(idx) {
  const cfg = S.configs[idx];
  if (!cfg) return;
  _editIdx = idx;

  // Populate fields
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  document.getElementById('editModalTitle').textContent =
    `EDIT — ${cfg.type.toUpperCase()} — ${cfg.host}:${cfg.port}`;
  set('em-host',    cfg.host    || '');
  set('em-port',    cfg.port    || 443);
  set('em-uuid',    cfg.id      || '');
  set('em-sni',     cfg.sni     || '');
  set('em-security',cfg.security|| 'none');
  set('em-net',     cfg.net     || 'tcp');
  set('em-path',    cfg.path    || '');
  set('em-flow',    cfg.flow    || '');
  set('em-remarks', cfg.remarks || '');
  set('em-raw',     cfg.raw     || '');

  document.getElementById('editModal').classList.add('open');
}

function saveEditModal() {
  if (_editIdx < 0) return;
  const cfg = S.configs[_editIdx];
  if (!cfg) return;

  const get = (id) => document.getElementById(id)?.value?.trim() || '';
  const newHost = get('em-host');
  const newPort = parseInt(get('em-port')) || 0;
  if (!newHost)                     { toast('Host cannot be empty', 'err'); return; }
  if (newPort < 1 || newPort > 65535) { toast('Invalid port (1–65535)', 'err'); return; }

  cfg.host     = newHost;
  cfg.port     = newPort;
  cfg.id       = get('em-uuid')     || cfg.id;
  cfg.sni      = get('em-sni');
  cfg.security = get('em-security') || cfg.security;
  cfg.net      = get('em-net')      || cfg.net;
  cfg.path     = get('em-path');
  cfg.flow     = get('em-flow');
  cfg.remarks  = get('em-remarks');
  cfg.raw      = buildUriFromConfig(cfg);

  // Update raw preview
  const rawEl = document.getElementById('em-raw');
  if (rawEl) rawEl.value = cfg.raw;

  scoreConfig(cfg);
  S.configs.sort((a, b) => b.score - a.score);
  updateHeaderStats(); renderTable(); renderWgPanel(); updateExportArea(); persistConfigs();
  document.getElementById('editModal').classList.remove('open');
  _editIdx = -1;
  toast('Config updated', 'ok');
}

function cancelEditModal() {
  document.getElementById('editModal').classList.remove('open');
  _editIdx = -1;
}

// Legacy inline edit stubs (kept for backward-compat with any existing calls)
function saveEditMode(idx) { saveEditModal(); }
function cancelEditMode(idx) { cancelEditModal(); }

function deleteConfig(idx) {
  S.configs.splice(idx,1);
  updateHeaderStats(); renderTable(); updateExportArea(); renderWgPanel(); persistConfigs();
  toast('Config deleted','ok');
}

// ============================================================
// WG PANEL
// ============================================================
function renderWgPanel() {
  const panel=document.getElementById('wgPanel'); if (!panel) return;
  const wgs=S.configs.filter(c=>c.type==='wireguard');
  const nbWg=document.getElementById('nb-wg'); if (nbWg) nbWg.textContent=wgs.length;
  if (!wgs.length) {
    panel.innerHTML=`<div class="empty"><div class="empty-icon ph-empty-svg" data-empty-icon="wireguard">${getIcon('shield','#6f4cf2',28)}</div><div style="font-family:var(--head);font-weight:700;font-size:.9rem;color:var(--text)">No WireGuard Configs</div><div style="font-size:.7rem;color:var(--text3);margin-top:8px">Fetch sources or add manually using the button above</div></div>`;
    return;
  }
  panel.className='wg-grid';
  panel.innerHTML=wgs.map((cfg,i)=>{
    const idx=S.configs.indexOf(cfg);
    const isDead = cfg.live === false;
    const isAlive = cfg.live === true;
    const latColor = cfg.latency>=9999||isDead ? 'var(--red)' : cfg.latency!=null&&cfg.latency<300 ? 'var(--green)' : 'var(--yellow)';
    const latLabel = cfg.latency==null ? '—' : cfg.latency>=9999 ? 'TIMEOUT' : cfg.latency+'ms';
    const statusCls = isAlive ? 'wg-status-alive' : isDead ? 'wg-status-dead' : 'wg-status-pending';
    const statusTxt = isAlive ? `${getIcon('check-circle','#16824c',10)} LIVE` : isDead ? `${getIcon('x-circle','#cd4450',10)} DEAD` : `${getIcon('clock','#74819a',10)} UNTESTED`;
    const scoreColor = cfg.score>=70 ? 'var(--cyan)' : cfg.score>=40 ? 'var(--purple)' : 'var(--orange)';
    const healBtn = isDead
      ? `<button class="btn btn-xs btn-purple" onclick="healWireGuard(${idx})" title="Auto-heal with fresh clean IP + key">${getIcon('shield-star','#ffffff',11)} Heal</button>`
      : '';
    return `<div class="wg-card" id="wgcard-${idx}">
      <div class="wg-card-hdr">
        <span class="wg-card-name">${getIcon('hexagon','#ff7043',13)} ${escHtml(cfg.remarks||`WireGuard #${i+1}`)}</span>
        <span class="wg-card-status ${statusCls}">${statusTxt}</span>
        ${cfg.isMahsa?'<span class="badge-mahsa">Mahsa</span>':''}
      </div>
      <div class="wg-card-fields">
        <div class="wg-field">
          <span class="wg-field-label">Server</span>
          <span class="wg-field-value" onclick="navigator.clipboard.writeText('${escAttr(cfg.host+':'+cfg.port)}');toast('Copied','ok')" style="cursor:pointer;color:var(--cyan)" title="Click to copy">${escHtml(cfg.host||'—')}:${escHtml(String(cfg.port||'—'))}</span>
        </div>
        <div class="wg-field">
          <span class="wg-field-label">Latency</span>
          <span class="wg-field-value" style="color:${latColor};font-weight:700">${latLabel}</span>
        </div>
        <div class="wg-field">
          <span class="wg-field-label">Address</span>
          <span class="wg-field-value">${escHtml(cfg.address||'—')}</span>
        </div>
        <div class="wg-field">
          <span class="wg-field-label">Score</span>
          <span class="wg-field-value" style="color:${scoreColor};font-weight:800">${cfg.score}</span>
        </div>
        <div class="wg-field" style="grid-column:1/-1">
          <span class="wg-field-label">Public Key</span>
          <span class="wg-field-value" onclick="navigator.clipboard.writeText('${escAttr(cfg.publicKey||'')}');toast('Key copied','ok')" style="cursor:pointer;word-break:break-all;font-size:9.5px;color:var(--text3)" title="Click to copy">${escHtml((cfg.publicKey||'—').substring(0,48))}${cfg.publicKey&&cfg.publicKey.length>48?'…':''}</span>
        </div>
        ${cfg.reserved?`<div class="wg-field"><span class="wg-field-label">Reserved</span><span class="wg-field-value" style="color:var(--text3)">${escHtml(cfg.reserved)}</span></div>`:''}
        ${cfg.mtu?`<div class="wg-field"><span class="wg-field-label">MTU</span><span class="wg-field-value">${escHtml(String(cfg.mtu))}</span></div>`:''}
        ${cfg.wnoise?`<div class="wg-field"><span class="wg-field-label">Noise</span><span class="wg-field-value" style="color:var(--teal)">${escHtml(cfg.wnoise)}</span></div>`:''}
        ${cfg.sourceName?`<div class="wg-field"><span class="wg-field-label">Source</span><span class="wg-field-value" style="color:var(--text3);font-size:9.5px">${escHtml(cfg.sourceName)}</span></div>`:''}
      </div>
      <div class="wg-latency-bar"><div class="wg-latency-fill" style="width:${isAlive&&cfg.latency<2000?Math.max(5,100-cfg.latency/20)+'%':'0%'}"></div></div>
      <div class="wg-card-actions">
        <button class="btn btn-orange btn-xs" onclick="copyUri(${idx})" title="Copy URI">${getIcon('copy','#c96c14',11)} URI</button>
        <button class="btn btn-cyan btn-xs" onclick="pingWgCfg(${idx})" title="Ping host">${getIcon('zap-fill','#167cb8',11)} Ping</button>
        <button class="btn btn-green btn-xs" onclick="wgExportConf(${idx})" title="Download .conf">${getIcon('download','#16824c',11)} .conf</button>
        <button class="btn btn-purple btn-xs" onclick="showQR(${idx},'main')" title="QR Code">${getIcon('qr','#ffffff',11)} QR</button>
        <button class="btn btn-ghost btn-xs" onclick="enterEditMode(${idx})" title="Edit">${getIcon('pencil','#53617a',11)}</button>
        ${healBtn}
        <button class="btn btn-red btn-xs" onclick="deleteConfig(${idx})" style="margin-left:auto" title="Delete">${getIcon('trash','#cf4653',11)}</button>
      </div>
    </div>`;
  }).join('');
}

async function pingWgCfg(idx) {
  const cfg=S.configs[idx]; if (!cfg) return;
  toast(`Ping ${cfg.host}...`,'info');
  await pingWgHost(cfg); scoreConfig(cfg);
  S.configs.sort((a,b)=>b.score-a.score);
  renderTable(); renderWgPanel(); updateHeaderStats(); updateExportArea();
  toast(`Latency: ${cfg.latency>=9999?'TIMEOUT':cfg.latency+'ms'}`,cfg.latency<2000?'ok':'warn');
}

// ============================================================
// SOURCES TAB
// ============================================================
function renderSourceGrid() {
  const grid=document.getElementById('srcGrid'); if (!grid) return;
  const search=document.getElementById('srcSearch')?.value?.toLowerCase()||'';
  const filtered=S.sources.filter(s=>!search||s.name.toLowerCase().includes(search)||s.url.toLowerCase().includes(search));
  const nbSources=document.getElementById('nb-sources');
  if (nbSources) nbSources.textContent=S.sources.length;
  grid.innerHTML=filtered.map(s=>`
    <div class="src-card ${s.enabled?'enabled':'disabled'}">
      <div class="src-card-hdr">
        <span class="src-card-name">${escHtml(s.name)}</span>
        <div class="src-toggle ${s.enabled?'on':'off'}" onclick="toggleSrc(${s.id})"><div class="src-toggle-knob"></div></div>
      </div>
      <div class="src-url" title="${escAttr(s.url)}">${escHtml(s.url)}</div>
      <div class="src-meta">
        ${s.lastStatus==='ok'?`<span class="src-status-ok">${getIcon('check-circle','#16824c',10)} ${s.lastCount} configs (${s.lastTime}ms)</span>`:''}
        ${s.lastStatus==='err'?`<span class="src-status-err">${getIcon('x-circle','#cd4450',10)} ${escHtml(s.lastError?.slice(0,40)||'Error')}</span>`:''}
        ${!s.lastStatus?'<span>Not fetched yet</span>':''}
        <button class="btn btn-xs btn-red" onclick="removeSrc(${s.id})" style="margin-left:auto" title="Remove source">${getIcon('trash','#cf4653',10)}</button>
      </div>
    </div>`).join('');
}

function toggleSrc(id) { const src=S.sources.find(s=>s.id===id); if (src) { src.enabled=!src.enabled; saveSources(); renderSourceGrid(); updateHeaderStats(); } }
function removeSrc(id) { S.sources=S.sources.filter(s=>s.id!==id); saveSources(); renderSourceGrid(); }
function enableAll()   { S.sources.forEach(s=>s.enabled=true);  saveSources(); renderSourceGrid(); }
function disableAll()  { S.sources.forEach(s=>s.enabled=false); saveSources(); renderSourceGrid(); }

function addSourcePrompt() {
  const url=prompt('Source URL:');
  if (!url||(!url.startsWith('http://')&&!url.startsWith('https://'))) { toast('Invalid URL','err'); return; }
  const name=prompt('Source name:',url.split('/').pop()||'New Source')||'New Source';
  const id=Date.now();
  S.sources.push({id,name,url,enabled:true,lastStatus:null,lastCount:0,lastTime:0,lastError:''});
  saveSources(); renderSourceGrid(); toast('Source added','ok');
}

function addManualConfig() {
  const raw=prompt('Enter config URI (wireguard://, vmess://, vless:// ...):');
  if (!raw) return;
  const cfg=parseUri(raw.trim());
  if (!cfg) { toast('Invalid config format','err'); return; }
  scoreConfig(cfg); cfg.sourceName='Manual';
  S.configs.push(cfg); S.configs.sort((a,b)=>b.score-a.score);
  updateHeaderStats(); renderTable(); renderWgPanel(); updateExportArea(); persistConfigs();
  toast('Config added','ok');
}

// ============================================================
// CONFIG DETAIL MODAL
// ============================================================
function showDetailCfg(cfg) {
  if (!cfg) return;
  document.getElementById('modalTitle').textContent=`${cfg.type.toUpperCase()} — ${cfg.remarks||cfg.host}`;
  const isWg=cfg.type==='wireguard';
  const pkField=isWg
    ?`<span id="wg-modal-key-display">${escHtml(cfg.id)}</span> <button class="btn btn-xs btn-ghost" id="wg-modal-reveal-btn" style="margin-left:6px">👁 Reveal</button>`
    :null;
  const fields=[
    ['Type',`<span class="pbadge p-${escHtml(cfg.type)}">${escHtml(cfg.type.toUpperCase())}</span>${cfg.isMahsa?' <span class="badge-mahsa">Mahsa App</span>':''}`],
    ['Host',escHtml(cfg.host||'—')],['Port',cfg.port],['Security',escHtml(cfg.security||'none')],
    ['SNI',escHtml(cfg.sni||'—')],['Network',escHtml(cfg.net||'—')],['Score',cfg.score],
    ['Latency',cfg.latency!=null?(cfg.latency>=9999?'TIMEOUT':cfg.latency+'ms'):'Not tested'],
    ['Live',cfg.live===true?'ONLINE':cfg.live===false?'DEAD':'Not checked'],
    ['DoH',cfg.doh===true?'Valid':cfg.doh===false?'Dead':'Not checked'],
    ['Remarks',escHtml(cfg.remarks||'—')],['Source',escHtml(cfg.sourceName||'—')],
    ...(isWg?[
      ['Private Key',pkField],['Public Key',escHtml(cfg.publicKey||'—')],
      ['Address',escHtml(cfg.address||'—')],['Reserved',escHtml(cfg.reserved||'—')],
      ['MTU',cfg.mtu],['Keepalive',cfg.keepalive+'s'],
      ...(cfg.isMahsa?[['Noise Type',escHtml(cfg.wnoise)],['Noise Count',escHtml(cfg.wnoisecount)],
        ['Noise Delay',escHtml(cfg.wnoisedelay)],['Payload Size',escHtml(cfg.wpayloadsize)]]:[]
      )
    ]:[]),
  ];
  document.getElementById('modalBody').innerHTML=
    fields.map(([k,v])=>`<div class="detail-row"><span class="detail-key">${escHtml(k)}</span><span class="detail-val">${v}</span></div>`).join('')+
    `<div class="detail-raw">${escHtml(cfg.raw)}</div>`;
  if (isWg) {
    const revBtn=document.getElementById('wg-modal-reveal-btn');
    if (revBtn&&cfg._privateKeyRaw) {
      revBtn.onclick=()=>{
        if (confirm('Reveal private key? Handle with care.')) {
          const disp=document.getElementById('wg-modal-key-display');
          if (disp) disp.textContent=cfg._privateKeyRaw;
          revBtn.remove();
        }
      };
    }
  }
  document.getElementById('modalCopyBtn').onclick=()=>{ navigator.clipboard.writeText(cfg.raw||''); toast('Copied','ok'); };
  document.getElementById('cfgModal').classList.add('open');
}

function showDetail(idx) { showDetailCfg(S.configs[idx]); }

function copyUri(idx) {
  const cfg=S.configs[idx]; if (!cfg) return;
  const uri = getExportUri(cfg, { allowSensitive: true });
  if (!uri) { toast('No exportable URI available for this config — secret was not persisted','warn'); return; }
  navigator.clipboard.writeText(uri).then(()=>toast('Copied','ok'));
}

async function testOne(idx) {
  const cfg=S.configs[idx]; if (!cfg) return;
  toast('Testing...','info');
  if (cfg.type==='wireguard') await pingWgHost(cfg); else await testConfigLatency(cfg);
  scoreConfig(cfg); S.stats.tested++;
  S.configs.sort((a,b)=>b.score-a.score);
  updateHeaderStats(); renderTable(); updateExportArea();
  if (cfg.type==='wireguard') renderWgPanel();
  toast(`Latency: ${cfg.latency>=9999?'TIMEOUT':cfg.latency+'ms'}`,cfg.latency<2000?'ok':'warn');
}

// ============================================================
// EXPORT
// ============================================================
function updateExportArea() {
  const n=parseInt(document.getElementById('exportCount')?.value||'20');
  const pf=document.getElementById('protoFilter')?.value||'';
  const df=document.getElementById('dohFilter')?.value||'';
  const exportMode=document.getElementById('exportMode')?.value||'top';
  const scoreThreshold=parseInt(document.getElementById('cfg-scoreThreshold')?.value||'0');
  let filtered=S.configs.filter(c=>{
    if (pf&&c.type!==pf) return false;
    if (df==='ok'&&c.doh!==true) return false;
    if (df==='bad'&&c.doh!==false) return false;
    if (df==='live'&&!verificationPass(c)) return false;
    if (scoreThreshold>0&&c.score<scoreThreshold) return false;
    return true;
  });
  let list;
  if      (exportMode==='all')      list=S.configs;          // all configs, ignore active filters
  else if (exportMode==='filtered') list=filtered;            // respect active filters
  else                              list=n>0?filtered.slice(0,n):filtered; // 'top'
  const ea=document.getElementById('exportArea'); if (ea) ea.value=list.map(c=>getExportUri(c)).filter(Boolean).join('\n');
  const countDisp=document.getElementById('exportCountDisplay');
  if (countDisp) countDisp.textContent=`Showing ${list.length} of ${S.configs.length} configs`;
}

function exportBest() { updateExportArea(); showTab('dashboard'); }
function downloadRaw() {
  const text=document.getElementById('exportArea')?.value;
  if (!text) { toast('No configs','warn'); return; }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
  a.download=`proxyharvest-${Date.now()}.txt`; a.click();
}
function downloadBase64() {
  const text=document.getElementById('exportArea')?.value;
  if (!text) { toast('No configs','warn'); return; }
  const b64 = btoa(new TextEncoder().encode(text).reduce((s,b)=>s+String.fromCharCode(b),''));
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([b64],{type:'text/plain'}));
  a.download=`proxyharvest-sub-${Date.now()}.txt`; a.click();
}
function downloadTxt() {
  const text=document.getElementById('exportArea')?.value;
  if (!text) { toast('No configs','warn'); return; }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
  a.download=`configs-${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.txt`; a.click();
}
function copyAll() {
  const text=document.getElementById('exportArea')?.value;
  if (!text) { toast('No configs','warn'); return; }
  navigator.clipboard.writeText(text).then(()=>toast(`${text.split('\n').filter(Boolean).length} configs copied`,'ok'));
}
function copyFiltered() {
  const text=document.getElementById('exportArea')?.value;
  if (!text) { toast('No configs','warn'); return; }
  navigator.clipboard.writeText(text).then(()=>toast(`${text.split('\n').filter(Boolean).length} filtered configs copied`,'ok'));
}

function clearAll() {
  if (!confirm('Clear all configs? (IndexedDB will also be cleared)')) return;
  S.configs=[]; S.stats={fetched:0,failed:0,tested:0};
  S.globalSigs=new Set();
  S.dohCache=new Map();
  S.dohCache=new Map();
  const srcLog=document.getElementById('srcLog');
  if (srcLog) srcLog.innerHTML='<div class="empty"><div class="ph-empty-svg" data-empty-icon="splitnet"></div><div>Sources will appear here</div></div>';
  const pf=document.getElementById('progFill'); const ps=document.getElementById('progStatus'); const pc=document.getElementById('progCount');
  if (pf) pf.style.width='0%'; if (ps) ps.textContent='Ready — press FETCH ALL'; if (pc) pc.textContent='0 / 0';
  const ea=document.getElementById('exportArea'); if (ea) ea.value='';
  updateHeaderStats(); renderTable(); renderWgPanel();
  dbSave('configs',[]);
  toast('Cleared','ok');
  loadMahsaConfig();
}

// ============================================================
// TAB NAVIGATION
// ============================================================
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(`tab-${name}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${name}"]`)?.classList.add('active');
  if (name==='sources')   renderSourceGrid();
  if (name==='configs')   renderTable();
  if (name==='wireguard') renderWgPanel();
  if (name==='splitnet')  renderSplitNetPanel();
  if (name==='ircf') {
    renderWarpKeys();
    renderWarpEndpoints();
  }
  if (name==='infrastructure') loadInfrastructureUI();
  if (name==='ai-healer') AI_HEALER.updateStats();
  try { document.body.dataset.activeTab = name; window.dispatchEvent(new CustomEvent('ph:tab', { detail: { name } })); } catch (_) {}
}
// Expose navigation immediately; Premium UI must not wait for async DB restoration in init().
window.showTab = showTab;

// ============================================================
// SETTINGS PERSISTENCE
// ============================================================
function saveSettings() {
  const ids=['cfg-timeout','cfg-maxperSource','cfg-autoInterval','cfg-maxConfigs','cfg-dedup','cfg-dohEnabled','w-tls','w-port443','w-latency','exportMode','proxy-1','proxy-2','proxy-3','localBridgeUrl','cfg-theme','cfg-fontSize','cfg-scoreThreshold','cfg-strictRealPing'];
  const s={};
  ids.forEach(id=>{
    const el=document.getElementById(id); if (!el) return;
    s[id]=el.type==='checkbox'?el.checked:el.value;
  });
  try { PH_STORAGE.set('ph-settings-v8',JSON.stringify(s)); if ('cfg-strictRealPing' in s) PH_STORAGE.set('ph_strict_real_ping', s['cfg-strictRealPing'] ? 'true' : 'false'); } catch {}
  applyTheme();
  applyFontSize();
  toast('Settings saved','ok');
}

function loadSettings() {
  try {
    const saved=JSON.parse(PH_STORAGE.get('ph-settings-v8')||PH_STORAGE.get('ph-settings-v7')||PH_STORAGE.get('ph-settings-v5')||PH_STORAGE.get('ph-settings-v4')||'{}');
    Object.entries(saved).forEach(([id,val])=>{
      const el=document.getElementById(id); if (!el) return;
      if (el.type==='checkbox') el.checked=val; else if (id==='localBridgeUrl' && (window.PROXYHARVEST_LOCAL_FILE_MODE || isLegacyBridgeUrl(val))) el.value=''; else el.value=val;
    });
  } catch {}
  const scoreMain = document.getElementById('cfg-scoreThreshold');
  const scoreSettings = document.getElementById('cfg-scoreThresholdSettings');
  if (scoreMain && scoreSettings) scoreSettings.value = scoreMain.value;
  const strict = document.getElementById('cfg-strictRealPing');
  if (strict) { try { const v = PH_STORAGE.get('ph_strict_real_ping'); if (v !== null) strict.checked = v !== 'false'; else PH_STORAGE.set('ph_strict_real_ping', strict.checked ? 'true' : 'false'); } catch {} }
  applyTheme();
  applyFontSize();
}

function resetSettings() {
  try {
    ['ph-settings-v8','ph-settings-v7','ph-settings-v5','ph-settings-v4','ph-sources-v8','ph-sources-v5','ph-sources-v4','ph_real_ping_bridge'].forEach(k=>PH_STORAGE.remove(k));
  } catch {}
  const root = document.getElementById('settingsContent') || document;
  root.querySelectorAll('input,select,textarea').forEach(el => {
    if (el.id === 'localBridgeUrl') { el.value = ''; return; }
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = el.defaultChecked;
    else if (el.tagName === 'SELECT') {
      const idx = Array.from(el.options).findIndex(o => o.defaultSelected);
      el.selectedIndex = idx >= 0 ? idx : 0;
    } else el.value = el.defaultValue ?? '';
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  });
  S.sources = DEFAULT_SOURCES.map((s,i)=>({id:i+1,name:s.name,url:s.url,enabled:true,lastStatus:null,lastCount:0,lastTime:0,lastError:''}));
  saveSources();
  applyTheme();
  applyFontSize();
  renderSourceGrid();
  updateHeaderStats();
  toast('Settings reset — no page reload required', 'ok');
  logConsole('success','Settings reset in-place');
}

// ============================================================
// THEME & FONT SIZE
// ============================================================
function applyTheme() {
  const themeEl=document.getElementById('cfg-theme');
  const theme=themeEl?.value||'dark';
  S.theme=theme;
  document.documentElement.setAttribute('data-theme',theme);
}

function applyFontSize() {
  const fsEl=document.getElementById('cfg-fontSize');
  const fs=parseInt(fsEl?.value||'14');
  document.documentElement.style.fontSize=fs+'px';
}

// ============================================================
// SOURCES PERSISTENCE
// ============================================================
function saveSources() { try { PH_STORAGE.set('ph-sources-v8',JSON.stringify(S.sources)); } catch {} }

function loadSources() {
  try {
    const saved=JSON.parse(PH_STORAGE.get('ph-sources-v8')||PH_STORAGE.get('ph-sources-v7')||PH_STORAGE.get('ph-sources-v5')||PH_STORAGE.get('ph-sources-v4')||'[]');
    if (saved.length>0) { S.sources=saved; return; }
  } catch {}
  S.sources=DEFAULT_SOURCES.map((s,i)=>({id:i+1,name:s.name,url:s.url,enabled:true,lastStatus:null,lastCount:0,lastTime:0,lastError:''}));
}

// ============================================================
// MAHSA CONFIG LOADER
// ============================================================
function loadMahsaConfig() {
  try {
    const cfg=parseWireGuard(MAHSA_CONFIG_RAW);
    if (!cfg) return;
    scoreConfig(cfg);
    cfg.sourceName='Mahsa App (User)'; cfg.isMahsa=true;
    const exists=S.configs.find(c=>c.host===cfg.host&&c.port===cfg.port&&c.type==='wireguard');
    if (!exists) {
      S.configs.unshift(cfg);
      logConsole('success',`Mahsa WireGuard loaded: ${cfg.host}:${cfg.port}`);
    }
  } catch(e) { logConsole('error',`Mahsa config load error: ${e.message}`); }
}

// ============================================================
// DB DIAGNOSTICS — manual check / repair from Settings tab
// ============================================================
async function runDBDiagnostics() {
  const panel   = document.getElementById('dbDiagPanel');
  const content = document.getElementById('dbDiagContent');
  if (!panel || !content) return;
  panel.style.display = 'block';
  content.innerHTML   = '<span style="color:var(--text3)">⏳ Checking IndexedDB…</span>';

  const lines = [];
  const ok  = s => `<span style="color:var(--green)">✓ ${s}</span>`;
  const err  = s => `<span style="color:var(--red)">✗ ${s}</span>`;
  const warn = s => `<span style="color:var(--yellow)">⚠ ${s}</span>`;

  try {
    // 1. API availability
    if (!('indexedDB' in window)) {
      lines.push(err('IndexedDB API not available in this browser'));
      content.innerHTML = lines.join('<br>'); return;
    }
    lines.push(ok('IndexedDB API available'));

    // 2. DB existence
    const existed = await checkDBExists();
    lines.push(existed ? ok(`Database "${DB_NAME}" exists`) : warn(`Database "${DB_NAME}" did not exist — will create`));

    // 3. Open / create
    if (!db) {
      lines.push(warn('Connection closed — reopening…'));
      await openDB();
    }
    lines.push(db ? ok('Connection open') : err('Connection failed — session-only mode'));
    if (!db) { content.innerHTML = lines.join('<br>'); return; }

    // 4. Store inventory
    const storeNames = Array.from(db.objectStoreNames);
    lines.push(ok(`Object stores found: [${storeNames.join(', ')}]`));
    const missing = DB_STORES.filter(s => !storeNames.includes(s.name));
    if (missing.length) {
      lines.push(warn(`Missing stores: ${missing.map(s=>s.name).join(', ')} — repairing…`));
      db = await repairStores(db);
      const after = Array.from(db.objectStoreNames);
      lines.push(ok(`After repair: [${after.join(', ')}]`));
    } else {
      lines.push(ok('All required stores present'));
    }

    // 5. Record counts
    for (const store of DB_STORES) {
      const items = await dbLoad(store.name);
      lines.push(ok(`"${store.name}" → ${items.length} record(s)`));
    }

    // 6. Last save timestamp
    const lastSave = await dbGetMeta('last_save');
    lines.push(lastSave
      ? ok(`Last save: ${new Date(lastSave).toLocaleString()}`)
      : warn('No save timestamp found (DB may be empty)')
    );

    lines.push(ok('Diagnostics complete — DB is healthy'));
    toast('DB diagnostics passed', 'ok');
  } catch(e) {
    lines.push(err(`Unexpected error: ${e.message}`));
    toast('DB diagnostics error', 'err');
  }
  content.innerHTML = lines.join('<br>');
}

// ============================================================
// WARP AUTO-DETECTION
// ============================================================
async function detectLocalBridge() {
  const candidates = [
    'http://127.0.0.1:8787',
    'http://localhost:8787',
  ];
  for (const raw of candidates) {
    const base = normalizeBridgeBase(raw);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${base}/health`, { signal:ctrl.signal, cache:'no-store' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const el = document.getElementById('localBridgeUrl');
      if (el) el.value = base;
      try { PH_STORAGE.set('ph_real_ping_bridge', base); } catch {}
      toast(data?.verifier ? 'Real Ping Bridge detected — verifier enabled' : 'Real Ping Bridge detected — transport mode', 'ok');
      PH_RUNTIME.localBridgeVerified = true;
      logConsole('success', `Local Real Ping Bridge detected at ${base}`);
      return true;
    } catch {}
  }
  PH_RUNTIME.localBridgeVerified = false;
  logConsole('info','Local Real Ping Bridge not found — optional transport remains disabled');
  toast('Real Ping Bridge not found', 'warn');
  return false;
}
// ============================================================
// FILTER HELPERS
// ============================================================
function clearFilters() {
  const cfgSearch      = document.getElementById('cfgSearch');
  const protoFilter    = document.getElementById('protoFilter');
  const dohFilter      = document.getElementById('dohFilter');
  const scoreThreshold = document.getElementById('cfg-scoreThreshold');
  if (cfgSearch)      { cfgSearch.value = '';      S.configSearch = ''; }
  if (protoFilter)      protoFilter.selectedIndex = 0;
  if (dohFilter)        dohFilter.selectedIndex   = 0;
  if (scoreThreshold)   scoreThreshold.value = '0';
  S.sortCol = 'score';
  S.sortDir = 'desc';
  renderTable();
  if (S.viewMode === 'compact') renderCompactGrid();
  updateActiveFilterBadge();
  updateExportArea();
  toast('Filters cleared', 'info');
}

// ============================================================
// EVENT WIRING
// ============================================================
// ============================================================
// QR CODE — lightweight canvas-based generator
// ============================================================
function showQR(idx, source) {
  const cfg = source === 'splitnet' ? S.splitnetConfigs[idx] : S.configs[idx];
  if (!cfg || !cfg.raw) { toast('No URI to generate QR', 'warn'); return; }
  const modal = document.getElementById('qrModal');
  const canvas = document.getElementById('qrCanvas');
  const label  = document.getElementById('qrLabel');
  if (!modal || !canvas || !label) return;
  label.textContent = `${cfg.type.toUpperCase()} — ${cfg.host}:${cfg.port}`;
  drawQR(canvas, cfg.raw);
  modal.classList.add('open');
  const copyBtn = document.getElementById('qrCopyUriBtn');
  if (copyBtn) copyBtn.onclick = () => { navigator.clipboard.writeText(cfg.raw); toast('URI copied','ok'); };
  const dlBtn = document.getElementById('qrDownloadBtn');
  if (dlBtn) dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.download = `qr-${cfg.type}-${cfg.host}.png`;
    a.href = canvas.toDataURL();
    a.click();
  };
}

// Minimal QR encoder — builds QR matrix and draws on canvas
function drawQR(canvas, text) {
  try {
    const qr = qrcodegen(text);
    const size = qr.size;
    const scale = Math.max(2, Math.floor(240 / size));
    canvas.width = canvas.height = size * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#080F1E';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#38BDF8';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.getModule(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  } catch(e) {
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.height = 240;
    ctx.fillStyle = '#0F1A2E';
    ctx.fillRect(0,0,240,240);
    ctx.fillStyle = '#F43F5E';
    ctx.font = '12px monospace';
    ctx.fillText('QR lib loading...', 10, 120);
    logConsole('warning', 'QR: library not loaded yet, retry in a moment');
  }
}

// QR Code library loader (uses qrcodegen from CDN, cached)
let qrcodegen = null;
function loadQRLib() {
  if (qrcodegen) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => {
      // Wrap QRCode lib into qrcodegen interface
      qrcodegen = function(text) {
        const div = document.createElement('div');
        div.style.display = 'none';
        document.body.appendChild(div);
        const qr = new QRCode(div, { text, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
        const img = div.querySelector('img') || div.querySelector('canvas');
        document.body.removeChild(div);
        // Return matrix via second QRCode approach
        const obj = { size: 0, modules: [] };
        // Use internal API if available
        if (qr._oQRCode) {
          const m = qr._oQRCode;
          obj.size = m.moduleCount;
          obj.modules = m.modules;
          obj.getModule = (x, y) => m.modules[y][x];
        } else {
          // Fallback: decode from canvas
          const can = document.createElement('canvas');
          const px = 4;
          can.width = can.height = 256;
          const c2 = can.getContext('2d');
          const tmpImg = new Image(); tmpImg.src = div.querySelector && div.querySelector('img')?.src;
          obj.size = 33; obj.getModule = () => false;
        }
        return obj;
      };
      resolve();
    };
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}

// Better QR: use qrcode-generator which exposes the matrix properly
function initQRLib() {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  s.onload = () => {
    // We use QRCode to draw directly to canvas via its own canvas mode
    qrcodegen = function(text) {
      // dummy matrix accessor — real drawing is done differently
      return { _text: text };
    };
    // Override drawQR to use QRCode's built-in canvas
    drawQR = function(canvas, text) {
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#080F1E';
      ctx.fillRect(0,0,256,256);
      try {
        const qr = new QRCode(canvas, {
          text,
          width: 256,
          height: 256,
          colorDark: '#38BDF8',
          colorLight: '#080F1E',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch(e2) {
        ctx.fillStyle = '#F43F5E';
        ctx.font = '11px monospace';
        ctx.fillText('QR error: ' + e2.message.slice(0,40), 5, 128);
      }
    };
    logConsole('info', 'QR code library loaded');
  };
  document.head.appendChild(s);
}

// ============================================================
// WIREGUARD .CONF FILE EXPORT
// ============================================================
function wgExportConf(idx) {
  const cfg = S.configs[idx];
  if (!cfg || cfg.type !== 'wireguard') return;
  const privateKey = cfg._privateKeyRaw || 'REPLACE_WITH_YOUR_PRIVATE_KEY';
  const conf = `[Interface]
PrivateKey = ${privateKey}
Address = ${cfg.address || '172.16.0.2/32'}
DNS = 1.1.1.1, 1.0.0.1
MTU = ${cfg.mtu || 1280}

[Peer]
PublicKey = ${cfg.publicKey || ''}
${cfg.reserved ? `Reserved = ${cfg.reserved}` : ''}
Endpoint = ${cfg.host}:${cfg.port}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = ${cfg.keepalive || 25}
`;
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(conf);
  a.download = `wg-${(cfg.host||'config').replace(/[^a-z0-9]/gi,'-')}.conf`;
  a.click();
  toast('.conf file downloaded', 'ok');
}

// ============================================================
// IRCF SEARCH FILTERS
// ============================================================
function renderWarpKeysFiltered() {
  const container = document.getElementById('warpKeysContainer');
  if (!container) return;
  const q = S.warpKeySearch.toLowerCase();
  const keys = q ? S.warpKeys.filter(k => k.toLowerCase().includes(q)) : S.warpKeys;
  if (!keys.length) {
    container.innerHTML = `<div style="padding:14px;color:var(--text3);font-size:.7rem">${S.warpKeySearch ? 'No keys match search.' : 'No keys loaded. Click "Fetch Warp+ Keys".'}</div>`;
    return;
  }
  container.innerHTML = keys.map((key, i) => `
    <div class="warpkey-row">
      <span class="warpkey-num">${i+1}</span>
      <span class="warpkey-val" id="wk-${i}">${escHtml(key)}</span>
      <button class="btn btn-xs btn-cyan" onclick="navigator.clipboard.writeText('${escAttr(key)}').then(()=>toast('Copied','ok'))" title="Copy key">⧉</button>
    </div>`).join('');
}

function renderEndpointsFiltered() {
  const container = document.getElementById('endpointsContainer');
  if (!container) return;
  const q = S.endpointSearch.toLowerCase();
  const eps = q ? S.warpEndpoints.filter(e => e.ip.includes(q) || (e.type||'').includes(q)) : S.warpEndpoints;
  if (!eps.length) {
    container.innerHTML = `<div style="padding:14px;color:var(--text3);font-size:.7rem">${S.endpointSearch ? 'No endpoints match.' : 'No endpoints loaded.'}</div>`;
    return;
  }
  // Group by type
  const groups = {};
  for (const ep of eps) {
    const t = ep.type || 'warp';
    if (!groups[t]) groups[t] = [];
    groups[t].push(ep);
  }
  container.innerHTML = Object.entries(groups).map(([type, list]) => `
    <div class="endpoint-group">
      <div class="endpoint-group-hdr">
        <span style="font-size:.62rem;color:var(--teal);font-weight:bold;letter-spacing:1px">${escHtml(type.toUpperCase())}</span>
        <span style="font-size:.6rem;color:var(--text3);margin-left:auto">${list.length} IPs</span>
        <button class="btn btn-xs btn-ghost" onclick="copyEndpointGroup('${escAttr(type)}')">⧉ Copy</button>
      </div>
      <div class="endpoint-list">
        ${list.map(ep => `
          <div class="endpoint-row">
            <span class="endpoint-ip">${escHtml(ep.ip)}</span>
            <button class="btn btn-xs btn-ghost" onclick="copyEndpoint('${escAttr(ep.ip)}')">⧉</button>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

// Override renderWarpEndpoints to use filtered version
function renderWarpEndpoints() { renderEndpointsFiltered(); }
function renderWarpKeys()      { renderWarpKeysFiltered();  }

// ============================================================
// AUTO-REFRESH COUNTDOWN DISPLAY
// ============================================================
function startCountdown(totalSec) {
  if (S.autoCountdownTimer) clearInterval(S.autoCountdownTimer);
  S.autoCountdownSec = totalSec;
  updateCountdownUI();
  S.autoCountdownTimer = setInterval(() => {
    S.autoCountdownSec--;
    updateCountdownUI();
    if (S.autoCountdownSec <= 0) {
      clearInterval(S.autoCountdownTimer);
      S.autoCountdownTimer = null;
      updateCountdownUI();
    }
  }, 1000);
}

function updateCountdownUI() {
  const el = document.getElementById('autoCountdown');
  if (!el) return;
  if (S.autoCountdownSec > 0) {
    const m = Math.floor(S.autoCountdownSec / 60);
    const s = S.autoCountdownSec % 60;
    el.textContent = `⏱ Auto: ${m}:${String(s).padStart(2,'0')}`;
    el.style.display = 'inline-flex';
  } else {
    el.style.display = 'none';
  }
}

// ============================================================
// COLUMN SORT
// ============================================================
function sortBy(col) {
  if (S.sortCol === col) {
    S.sortDir = S.sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    S.sortCol = col;
    S.sortDir = col === 'score' || col === 'latency' ? 'desc' : 'asc';
  }
  renderTable();
}



// ============================================================
// TUNNEL STATUS & CONNECTION MANAGEMENT (FIX 3 & 4)
// ============================================================

/**
 * Alias for toast function to match spec naming
 */
function showToast(msg, type) {
  toast(msg, type === 'success' ? 'ok' : type === 'error' ? 'err' : type);
}

/**
 * Connect to a proxy config by index (FIX 3)
 */
function connectToProxy(idx) {
  const config = S.configs[idx];
  if (!config) return;

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    const uri = getExportUri(config, { allowSensitive: true });
    if (!uri) { showToast('No usable URI: secret material was not persisted', 'error'); return; }
    chrome.runtime.sendMessage({ action: 'CONNECT', uri }, res => {
      if (chrome.runtime.lastError) {
        showToast('Extension error: ' + chrome.runtime.lastError.message, 'error');
      } else {
        updateTunnelStatus(res?.status === 'ok' ? 'connected' : 'error', uri);
      }
    });
  } else {
    // Mock mode: UI-only feedback
    const uri = getExportUri(config, { allowSensitive: true });
    updateTunnelStatus('mock', uri || config.rawRedacted || 'redacted-config');
    showToast('Mock connect: ' + (uri || config.rawRedacted || 'redacted-config').substring(0, 40) + '…', 'info');
  }
}

/**
 * Update tunnel status bar display (FIX 4)
 */
function updateTunnelStatus(state, uri = '') {
  const bar   = document.getElementById('tunnelStatusBar');
  const icon  = document.getElementById('tunnelStatusIcon');
  const label = document.getElementById('tunnelStatusLabel');
  const disc  = document.getElementById('tunnelDisconnectBtn');
  if (!bar) return;

  const states = {
    connected: { cls: 'tunnel-connected', icon: '🟢', text: 'Tunneled via ' + uri.substring(0,30) + '…' },
    error:     { cls: 'tunnel-error',     icon: '🔴', text: 'Connection failed' },
    mock:      { cls: 'tunnel-mock',      icon: '🟡', text: '[MOCK] ' + uri.substring(0,30) + '…' },
    idle:      { cls: 'tunnel-idle',      icon: '⬤',  text: 'No tunnel active' },
  };
  const s = states[state] || states.idle;
  bar.className   = 'tunnel-status-bar ' + s.cls;
  icon.textContent  = s.icon;
  label.textContent = s.text;
  disc.style.display = state !== 'idle' ? 'inline-block' : 'none';
}

/**
 * Helper: Download text as file (FIX 2)
 */
function downloadText(filename, content) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: 'text/plain' })),
    download: filename
  });
  document.body.appendChild(a); a.click(); a.remove();
}

/**
 * Helper: Copy text to clipboard (FIX 2)
 */
// showToast is already defined earlier in this file — kept as single definition.

function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => toast('Copied to clipboard', 'ok'))
    .catch(() => toast('Copy failed', 'err'));
}

/**
 * Handle config export/copy actions (FIX 2)
 */
function handleCfgAction(id) {
  const all      = S.configs;
  const filtered = getFilteredConfigs();
  const toB64    = s => btoa(unescape(encodeURIComponent(s)));

  const actions = {
    cfgExportAllBtn:      () => downloadText('configs-all.txt',    all.map(c => getExportUri(c)).filter(Boolean).join('\n')),
    cfgExportLiveBtn:     () => downloadText('configs-live.txt',   filtered.filter(verificationPass).map(c => getExportUri(c)).filter(Boolean).join('\n')),
    cfgExportB64Btn:      () => downloadText('configs-b64.txt',    toB64(filtered.map(c => getExportUri(c)).filter(Boolean).join('\n'))),
    cfgCopyAllBtn:        () => copyToClipboard(all.map(c => getExportUri(c)).filter(Boolean).join('\n')),
    cfgCopyFilteredBtn:   () => copyToClipboard(filtered.map(c => getExportUri(c)).filter(Boolean).join('\n')),
  };
  actions[id]?.();
}

function wireEvents() {
  if (window.__PH_EVENTS_WIRED) return;
  window.__PH_EVENTS_WIRED = true;
  const bind=(id,fn)=>{ const el=document.getElementById(id); if (el) el.addEventListener('click',fn); };
  if (!window.__phDelegatedActions) { window.__phDelegatedActions = true; document.addEventListener('click', (e) => { const actionEl = e.target.closest('[data-action]'); if (!actionEl) return; const action = actionEl.dataset.action; const map = { 'run-doh-batch': runDoHBatch, 'run-conn-test': runConnTest, 'clear-filters': clearFilters, 'add-manual-config': addManualConfig, 'cfg-export-all': () => handleCfgAction('cfgExportAllBtn'), 'cfg-export-live': () => handleCfgAction('cfgExportLiveBtn'), 'cfg-export-b64': () => handleCfgAction('cfgExportB64Btn'), 'cfg-copy-all': () => handleCfgAction('cfgCopyAllBtn'), 'cfg-copy-filtered': () => handleCfgAction('cfgCopyFilteredBtn') }; if (map[action]) { e.preventDefault(); map[action](e, actionEl); } }); }

  bind('masterFetchBtn',()=>masterFetch());
  bind('stopBtn',()=>stopAll());
  bind('exportBestBtn',()=>exportBest());
  bind('clearAllBtn',()=>clearAll());
  bind('clearLogBtn',()=>clearLog());
  bind('downloadRawBtn',()=>downloadRaw());
  bind('downloadBase64Btn',()=>downloadBase64());
  bind('downloadTxtBtn',()=>downloadTxt());
  bind('copyAllBtn',()=>copyAll());
  bind('copyFilteredBtn',()=>copyFiltered());
  bind('runDoHBatchBtn',()=>runDoHBatch());
  bind('runConnTestBtn',()=>runConnTest());
  bind('cfgClearFiltersBtn', ()=>clearFilters());
  bind('addSourceBtn',()=>addSourcePrompt());
  bind('enableAllBtn',()=>enableAll());
  bind('disableAllBtn',()=>disableAll());
  bind('addManualBtn',()=>addManualConfig());
  bind('pingWgHostsBtn',()=>pingWgHosts());
  bind('saveSettingsBtn',()=>saveSettings());
  bind('resetSettingsBtn',()=>resetSettings());
  bind('checkDBBtn',()=>runDBDiagnostics());
  const scoreMain = document.getElementById('cfg-scoreThreshold');
  const scoreSettings = document.getElementById('cfg-scoreThresholdSettings');
  if (scoreMain && scoreSettings && !scoreSettings.__phSyncBound) {
    scoreSettings.__phSyncBound = true;
    scoreSettings.addEventListener('input', () => { scoreMain.value = scoreSettings.value; updateExportArea(); renderTable(); });
  }
  // Search clear button
  bind('cfgSearchClearBtn', () => {
    const cfgSearch = document.getElementById('cfgSearch');
    if (cfgSearch) { cfgSearch.value = ''; S.configSearch = ''; }
    renderTable();
    if (S.viewMode === 'compact') renderCompactGrid();
    updateExportArea();
    updateActiveFilterBadge();
  });
  bind('modalCloseBtn',()=>document.getElementById('cfgModal')?.classList.remove('open'));
  bind('modalFooterCloseBtn',()=>document.getElementById('cfgModal')?.classList.remove('open'));

  // Edit modal
  bind('editModalSaveBtn',   ()=>saveEditModal());
  bind('editModalCancelBtn', ()=>cancelEditModal());
  bind('editModalCloseBtn',  ()=>cancelEditModal());
  const editModalBg = document.getElementById('editModal');
  if (editModalBg) editModalBg.addEventListener('click', function(e){ if (e.target===this) cancelEditModal(); });

  // SplitNet tab
  bind('splitnetRefreshBtn',()=>fetchSplitNetSub());
  bind('splitnetCopyAllBtn',()=>splitnetCopyAll());
  bind('splitnetDownloadBtn',()=>splitnetDownload());
  bind('splitnetDownloadB64Btn',()=>splitnetDownloadBase64());
  bind('splitnetImportAllBtn',()=>splitnetImportAll());
  bind('splitnetPingAllBtn',()=>splitnetPingAll());

  // SplitNet filter/search
  const snFilter = document.getElementById('splitnetProtoFilter');
  if (snFilter) snFilter.addEventListener('change', () => { S.splitnetFilter = snFilter.value; renderSplitNetPanel(); });
  const snSearch = document.getElementById('splitnetSearch');
  if (snSearch) snSearch.addEventListener('input', () => { S.splitnetSearch = snSearch.value; renderSplitNetPanel(); });

  // IRCF tab
  bind('warpKeyRefreshBtn',()=>fetchWarpKeys());
  bind('copyAllWarpKeysBtn',()=>copyAllWarpKeys());
  bind('endpointRefreshBtn',()=>fetchWarpEndpoints());
  bind('copyAllEndpointsBtn',()=>copyAllEndpoints());

  // IRCF search
  const wkSearch = document.getElementById('warpKeySearch');
  if (wkSearch) wkSearch.addEventListener('input', () => { S.warpKeySearch = wkSearch.value; renderWarpKeysFiltered(); });
  const epSearch = document.getElementById('endpointSearch');
  if (epSearch) epSearch.addEventListener('input', () => { S.endpointSearch = epSearch.value; renderEndpointsFiltered(); });

  // QR Modal
  bind('qrModalCloseBtn', () => document.getElementById('qrModal')?.classList.remove('open'));
  const qrModal = document.getElementById('qrModal');
  if (qrModal) qrModal.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });

  // Proxy health checker
  bind('checkProxyHealthBtn',()=>checkProxyHealth());

  bind('qrModalCloseBtn2', () => document.getElementById('qrModal')?.classList.remove('open'));

  // Infrastructure panel
  bind('saveInfrastructureConfigBtn', ()=>saveInfrastructureConfig());
  loadInfrastructureUI();

  // ── FIX 3: Event delegation for connect buttons ──────────────
  document.getElementById('cfgsBody')?.addEventListener('click', e => {
    const btn = e.target.closest('.connect-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    connectToProxy(idx);
  });

  // ── FIX 4: Tunnel disconnect button ──────────────────────────
  document.getElementById('tunnelDisconnectBtn')?.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'DISCONNECT' });
    }
    updateTunnelStatus('idle');
  });

  const exportCount=document.getElementById('exportCount');
  if (exportCount) exportCount.addEventListener('change',()=>updateExportArea());

  const protoFilter=document.getElementById('protoFilter');
  if (protoFilter) protoFilter.addEventListener('change',()=>{
    renderTable();          // syncs compact grid internally
    updateExportArea();
    if (S.viewMode==='compact') renderCompactGrid();
  });

  const dohFilter=document.getElementById('dohFilter');
  if (dohFilter) dohFilter.addEventListener('change',()=>{
    renderTable();
    updateExportArea();
    if (S.viewMode==='compact') renderCompactGrid();
  });

  const srcSearch=document.getElementById('srcSearch');
  if (srcSearch) srcSearch.addEventListener('input',()=>renderSourceGrid());

  // Config search — debounced input + Escape to clear
  const cfgSearch=document.getElementById('cfgSearch');
  if (cfgSearch) {
    let searchDebounce;
    cfgSearch.addEventListener('input', e => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        S.configSearch = e.target.value.trim();
        renderTable();
        if (S.viewMode === 'compact') renderCompactGrid();
        updateExportArea();
      }, 180);
    });
    cfgSearch.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        cfgSearch.value = '';
        S.configSearch  = '';
        clearTimeout(searchDebounce);
        renderTable();
        if (S.viewMode === 'compact') renderCompactGrid();
        updateExportArea();
        cfgSearch.blur();
      }
    });
  }

  // Tab navigation
  document.querySelectorAll('.nav-item[data-tab]').forEach(item=>{
    item.addEventListener('click',()=>{
      showTab(item.dataset.tab);
      const sidebar=document.getElementById('sidebar');
      const mo=document.getElementById('mobileOverlay');
      if (sidebar&&window.innerWidth<=768) {
        sidebar.classList.remove('open');
        if (mo) mo.style.display='none';
      }
    });
  });

  // Modal backdrop
  const cfgModal=document.getElementById('cfgModal');
  if (cfgModal) cfgModal.addEventListener('click',function(e){ if (e.target===this) this.classList.remove('open'); });

  // Mobile hamburger
  const menuToggle=document.getElementById('menu-toggle');
  const sidebar=document.getElementById('sidebar');
  if (menuToggle&&sidebar) {
    const overlay = document.getElementById('mobileOverlay');
    menuToggle.addEventListener('click',()=>{
      const isOpen = sidebar.classList.toggle('open');
      if (overlay) overlay.style.display = isOpen ? 'block' : 'none';
    });
    document.addEventListener('click',e=>{
      if (window.innerWidth<=768&&sidebar.classList.contains('open'))
        if (!sidebar.contains(e.target)&&e.target!==menuToggle) {
          sidebar.classList.remove('open');
          if (overlay) overlay.style.display = 'none';
        }
    });
  }

  // Column sort headers
  document.querySelectorAll('.sort-th').forEach(th => {
    th.addEventListener('click', () => sortBy(th.dataset.sort));
  });

  // Offline / online detection
  function handleOffline() {
    const b = document.getElementById('offline-banner');
    if (b) b.classList.add('show');
    logConsole('warning', 'Network offline — using cached data');
    toast('Network offline — cached data only', 'warn');
  }
  function handleOnline() {
    const b = document.getElementById('offline-banner');
    if (b) b.classList.remove('show');
    logConsole('info', 'Network restored');
    toast('Network restored', 'ok');
  }
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online',  handleOnline);
  if (!navigator.onLine) handleOffline();

  // Theme live preview
  const themeEl=document.getElementById('cfg-theme');
  if (themeEl) themeEl.addEventListener('change',()=>applyTheme());

  // Font size live preview
  const fsEl=document.getElementById('cfg-fontSize');
  if (fsEl) fsEl.addEventListener('change',()=>applyFontSize());

  // Score threshold — re-filter immediately on change
  const scoreThreshEl = document.getElementById('cfg-scoreThreshold');
  if (scoreThreshEl) scoreThreshEl.addEventListener('change', () => {
    renderTable();
    if (S.viewMode === 'compact') renderCompactGrid();
    updateExportArea();
  });

  // ── WireGuard tab: Auto-Heal All button ──────────────────────
  bind('healAllWgBtn', () => healAllWireGuard());

  // ── AI Healer tab: toolbar buttons ──────────────────────────
  bind('aiAnalyzeBtn',     () => AI_HEALER.analyzeDeadConfigs());
  bind('aiHealSelectedBtn',() => AI_HEALER.healSelected());
  // "Auto-Fix All" runs AI batch analysis on general configs AND
  // WG self-heal in parallel for a one-click full sweep.
  bind('aiAutoFixAllBtn', async () => {
    await AI_HEALER.batchFix();
    await healAllWireGuard();
  });

  // ── AI Healer tab: bottom panel buttons ──────────────────────
  bind('aiBatchFixBtn',   () => AI_HEALER.batchFix());
  bind('aiApplyFixesBtn', () => AI_HEALER.applyFixes());
  bind('aiClearLogBtn',   () => AI_HEALER.clearLog());

  // ── Initialize SmartHeal badge on load ────────────────────────
  (function() {
    const badge = document.getElementById('aiKeyStatusBadge');
    if (badge) {
      badge.textContent = '⚡ Local Engine Active';
      badge.style.cssText = 'font-size:.58rem;font-family:var(--mono);padding:2px 8px;border-radius:20px;background:rgba(52,211,153,0.14);border:1px solid rgba(52,211,153,0.4);color:var(--green)';
    }
    setTimeout(() => AI_HEALER.updateStats(), 500);
  })();

  // ── AI Healer tab: protocol filter select ───────────────────
  // Re-runs analyzeDeadConfigs() scoped to selected protocol.
  // AI_HEALER.protoFilter is read inside analyzeDeadConfigs().
  const aiProtoFilter = document.getElementById('aiProtoFilter');
  if (aiProtoFilter) {
    aiProtoFilter.addEventListener('change', () => {
      AI_HEALER.protoFilter = aiProtoFilter.value;
      AI_HEALER.analyzeDeadConfigs();
    });
  }
}

// ============================================================
// INIT
// ============================================================
async function init() {
  // V15: purge stale transport settings before the UI can consume them.
  migrateLegacyTransportSettings();
  wireEvents();
  loadSettings();
  loadSources();
  setStatus('idle','IDLE');
  try { window.dispatchEvent(new CustomEvent('ph:runtime-ready-ui')); } catch {}

  // ── Step 1: Open / create IndexedDB ──────────────────────
  // openDB() now checks existence first and creates if missing.
  // All status updates (creating / opening / ready / error) are
  // handled inside openDB() via updateDBStatusUI().
  await openDB();

  // ── Step 2: Restore persisted configs ────────────────────
  const savedConfigs = await dbLoad('configs');
  if (savedConfigs.length > 0) {
    S.configs = savedConfigs.map(c => { if (!c.probe) c.probe = makeProbe({ dns:c.doh, browserReachable:c.live === true ? true : null, latencyMs:c.latency, method:c.testMethod || 'legacy-restored', evidence:['restored legacy record'] }); return c; });
    logConsole('success', `Restored ${savedConfigs.length} configs from IndexedDB`);
    toast(`Restored ${savedConfigs.length} saved configs`, 'ok');
  } else {
    logConsole('info', db
      ? 'IndexedDB ready — no saved configs yet (first run or after clear)'
      : 'No IndexedDB — running in session-only mode'
    );
  }

  // ── Step 3: Restore SplitNet configs ─────────────────────
  const savedSplitnet = await dbLoad('splitnet');
  if (savedSplitnet.length > 0) {
    S.splitnetConfigs = savedSplitnet;
    logConsole('info', `Restored ${savedSplitnet.length} SplitNet configs from DB`);
    const splitnetStatusEl = document.getElementById('splitnet-status');
    if (splitnetStatusEl) splitnetStatusEl.textContent = `${savedSplitnet.length} configs loaded from cache — click Refresh to update`;
  }

  // ── Step 4: Finish restored-state rendering ───────────────
  // UI events/settings/sources were initialized before storage.
  loadMahsaConfig();
  updateHeaderStats();
  setStatus('idle','IDLE');
  renderTable();
  renderWgPanel();
  renderSplitNetPanel();
  renderSourceGrid();

  const nbSources=document.getElementById('nb-sources');
  if (nbSources) nbSources.textContent=S.sources.length;

  // ── Step 5: Warm in-memory fetch cache from DB meta ──────
  for (const src of S.sources) {
    const cacheKey = `fetch:${src.url}`;
    const cached = await dbGetMeta(cacheKey);
    if (cached) FETCH_CACHE.set(cacheKey, cached);
  }

  // ── Step 6: Restore IRCF data ────────────────────────────
  await loadIrcfFromDB();

  // ── Step 7: Startup log ──────────────────────────────────
  logConsole('info','ProxyHarvest Real v8 initialized');
  logConsole('info',`${S.sources.length} sources | ${S.configs.length} configs in DB`);
  logConsole('info','6-layer fetch: Cache → Bridge → Direct → Smart Proxy → CDN Mirrors → CORS Rotation');
  logConsole('info','IndexedDB: configs + IRCF data persist across reloads');
  logConsole('success','Mahsa WireGuard pre-loaded | IRCF tab: Warp+ keys + clean IPs');
  logConsole('info','SplitNet tab: free WARP/WG configs | IRCF tab: ircf.space tools');
  logConsole('info','v8: QR codes, column sort, bulk SplitNet ops, WG .conf export, IRCF search, offline detection');

  initQRLib();
  // Local Bridge is optional. Never probe localhost automatically at startup.
  logConsole('info','Local Real Ping Bridge: optional — use Settings → Auto Detect when needed');

  // ══════════════════════════════════════════════════════
  // CRITICAL FIX: expose all inline-onclick functions to
  // global (window) scope so dynamically-generated HTML
  // onclick="fn()" handlers can actually find them.
  // ══════════════════════════════════════════════════════
  Object.assign(window, {
    showDetail, copyUri, showQR, testOne, enterEditMode,
    saveEditMode, cancelEditMode, saveEditModal, cancelEditModal, deleteConfig,
    splitnetCopy, splitnetPing, splitnetDetail, splitnetImport,
    copyWarpKey, copyEndpoint, copyEndpointGroup,
    pingWgCfg, wgExportConf, toggleSrc, removeSrc,
    sortBy, toast, escHtml, setConfigsView, renderCompactGrid, getFilteredConfigs, showTab,
    clearFilters, updateActiveFilterBadge,
    // infrastructure functions called via onclick in HTML
    testWorkerConnection, copyWorkerScript, saveInfrastructureConfig,
    // new functions for tunnel and connection management
    connectToProxy, updateTunnelStatus, showToast, fetchSplitNetSub,
    // WireGuard self-heal (called via onclick in renderWgPanel cards)
    healWireGuard, healAllWireGuard,
    // AI Healer object (called via onclick in analyzeDeadConfigs row buttons)
    AI_HEALER,
    // id-less onclick= buttons in HTML (no bind() path available)
    addManualConfig,   // configs-tab quick-add button
    masterFetch,       // dashboard duplicate FETCH ALL button
    detectLocalBridge, // settings panel "🔍 Auto" bridge detection button
  });

  // ── View toggle button wiring ────────────────────────
  document.getElementById('viewTableBtn')?.addEventListener('click',   () => setConfigsView('table'));
  document.getElementById('viewCompactBtn')?.addEventListener('click', () => setConfigsView('compact'));

  // ── Configs tab export buttons ───────────────────────
  function cfgDownload(list, suffix) {
    if (!list.length) { toast('No configs to export', 'warn'); return; }
    const text = list.map(c => getExportUri(c)).filter(Boolean).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `proxyharvest-${suffix}-${Date.now()}.txt`;
    a.click();
    toast(`${list.length} configs exported`, 'ok');
  }

  function cfgDownloadB64(list) {
    if (!list.length) { toast('No configs to export', 'warn'); return; }
    const text = list.map(c => getExportUri(c)).filter(Boolean).join('\n');
    const b64  = btoa(new TextEncoder().encode(text).reduce((s, b) => s + String.fromCharCode(b), ''));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([b64], { type: 'text/plain' }));
    a.download = `proxyharvest-sub-${Date.now()}.txt`;
    a.click();
    toast(`${list.length} configs → Base64 exported`, 'ok');
  }

  document.getElementById('cfgExportAllBtn')?.addEventListener('click',  () => cfgDownload(getFilteredConfigs(), 'all'));
  document.getElementById('cfgExportLiveBtn')?.addEventListener('click', () => cfgDownload(getFilteredConfigs().filter(verificationPass), 'live'));
  document.getElementById('cfgExportB64Btn')?.addEventListener('click',  () => cfgDownloadB64(getFilteredConfigs()));
  document.getElementById('cfgCopyAllBtn')?.addEventListener('click', () => {
    const list = getFilteredConfigs();
    const uris = list.map(c => getExportUri(c)).filter(Boolean).join('\n');
    if (!uris) { toast('No configs', 'warn'); return; }
    navigator.clipboard.writeText(uris).then(() => toast(`${list.length} configs copied`, 'ok'));
  });
  document.getElementById('cfgCopyFilteredBtn')?.addEventListener('click', () => {
    const list = getFilteredConfigs();
    const uris = list.map(c => getExportUri(c)).filter(Boolean).join('\n');
    if (!uris) { toast('No configs', 'warn'); return; }
    navigator.clipboard.writeText(uris).then(() => toast(`${list.length} filtered configs copied`, 'ok'));
  });

  // ── Warp+ Keys export ────────────────────────────────
  document.getElementById('exportWarpKeysBtn')?.addEventListener('click', () => {
    if (!S.warpKeys.length) { toast('No keys to export', 'warn'); return; }
    const text = S.warpKeys.join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `warp-keys-${Date.now()}.txt`;
    a.click();
    toast(`${S.warpKeys.length} Warp+ keys exported`, 'ok');
  });
}


// ╔══════════════════════════════════════════════════════════════════════╗
// ║  ProxyHarvest v10 — REAL TEST ENGINE                               ║
// ║  Fully integrated into DOMContentLoaded scope.                     ║
// ║  No external dependencies — all fallbacks are self-contained.      ║
// ║  Features: wsTest · imgPing · workerTest · fetchTest               ║
// ║            geoIranTest · SelfHealingEngine · ResultCache            ║
// ║            AdaptiveTimeout · RealTestEngine orchestrator           ║
// ╚══════════════════════════════════════════════════════════════════════╝
(function() {
  'use strict';

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §1  CONFIGURATION & CONSTANTS                                ║
  // ╚════════════════════════════════════════════════════════════════╝
  const CFG = Object.freeze({
    // ── Timeouts ──
    WS_TIMEOUT:           8000,
    IMG_TIMEOUT:          6000,
    WORKER_TIMEOUT:       8000,
    FETCH_TIMEOUT:        7000,
    GEO_RELAY_TIMEOUT:    10000,
    BMI_TIMEOUT:          8000,
    HEALING_TIMEOUT:      10000,

    // ── Concurrency ──
    DEFAULT_CONCURRENCY:  15,
    WG_CONCURRENCY:       10,
    SPLITNET_CONCURRENCY: 12,
    HEALING_CONCURRENCY:  5,

    // ── Cache ──
    CACHE_TTL_MS:         90_000,
    CACHE_MAX_SIZE:       2000,

    // ── Adaptive Timeout ──
    LATENCY_HISTORY_SIZE: 200,
    P90_MULTIPLIER:       2.5,
    MIN_ADAPTIVE_TIMEOUT: 3000,
    MAX_ADAPTIVE_TIMEOUT: 15000,

    // ── Retry ──
    MAX_RETRIES:          2,
    RETRY_BASE_DELAY_MS:  500,

    // ── Self-Healing ──
    HEALING_ENABLED:      true,
    HEALING_MAX_ATTEMPTS: 4,
    HEALING_STORAGE_KEY:  'phv10_healing_patterns',

    // ── Geo Iran ──
    GEO_IRAN_ENABLED:     true,
    IRAN_RELAY_URL:       '',  // e.g. 'https://your-relay.ir/probe'
    BMI_TEST_URL:         'https://bmi.ir/favicon.ico',
    BMI_FALLBACK_URLS:    [
      'https://www.shaparak.ir/favicon.ico',
      'https://sib.ir/favicon.ico',
    ],

    // ── Host Intelligence ──
    HOST_INTEL_ENABLED:    true,
    HOST_CLUSTER_THRESHOLD: 3,   // min configs per host to cluster

    // ── Scoring ──
    SCORE_LATENCY_WEIGHT:  0.40,
    SCORE_LIVE_WEIGHT:     0.30,
    SCORE_GEO_WEIGHT:      0.15,
    SCORE_HEAL_WEIGHT:     0.10,
    SCORE_FRESH_WEIGHT:    0.05,

    // ── TLS Ports ──
    TLS_PORTS: new Set([443, 8443, 2053, 2083, 2087, 2096]),

    // ── UI ──
    UI_RENDER_INTERVAL:    10,
    UI_BUTTON_DELAY:       1500,

    // ── Logging ──
    LOG_LEVEL:             'INFO',  // DEBUG | INFO | SUCCESS | WARN | ERROR
  });


  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §2  STRUCTURED LOGGER                                        ║
  // ╚════════════════════════════════════════════════════════════════╝
  const LOG_LEVELS = { DEBUG: 0, INFO: 1, SUCCESS: 2, WARN: 3, ERROR: 4 };
  const LOG_ICONS  = { DEBUG: '🔍', INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌' };
  const LOG_COLORS = {
    DEBUG:   'color:#888',
    INFO:    'color:#4fc3f7',
    SUCCESS: 'color:#66bb6a',
    WARN:    'color:#ffa726',
    ERROR:   'color:#ef5350',
  };

  const currentLogLevel = LOG_LEVELS[CFG.LOG_LEVEL] ?? LOG_LEVELS.INFO;

  function log(level, ...args) {
    const lv = LOG_LEVELS[level] ?? LOG_LEVELS.INFO;
    if (lv < currentLogLevel) return;

    const icon = LOG_ICONS[level] || '';
    const ts   = new Date().toLocaleTimeString('en-US', { hour12: false });
    const tag  = `[v10 ${ts}]`;

    // Console output
    console.log(`%c${tag} ${icon} ${level}`, LOG_COLORS[level] || '', ...args);

    // Pipe to app's logConsole if available
    if (typeof logConsole === 'function') {
      const appLevel = level === 'SUCCESS' ? 'success'
                     : level === 'WARN'    ? 'warning'
                     : level === 'ERROR'   ? 'error'
                     : 'info';
      logConsole(appLevel, `${icon} ${args.join(' ')}`);
    }
  }


  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §3  RESULT CACHE                                             ║
  // ╚════════════════════════════════════════════════════════════════╝
  class ResultCache {
    constructor(ttl = CFG.CACHE_TTL_MS, maxSize = CFG.CACHE_MAX_SIZE) {
      this._map     = new Map();
      this._ttl     = ttl;
      this._maxSize = maxSize;
    }

    _key(host, port) {
      return `${host}:${port}`;
    }

    get(host, port) {
      const k     = this._key(host, port);
      const entry = this._map.get(k);
      if (!entry) return null;
      if (Date.now() - entry.ts > this._ttl) {
        this._map.delete(k);
        return null;
      }
      log('DEBUG', `Cache HIT: ${k} → ${entry.result.latency}ms`);
      return entry.result;
    }

    set(host, port, result) {
      if (this._map.size >= this._maxSize) {
        // Evict oldest
        const oldest = this._map.keys().next().value;
        this._map.delete(oldest);
      }
      this._map.set(this._key(host, port), { result: { ...result }, ts: Date.now() });
    }

    clear() {
      this._map.clear();
      log('INFO', 'Cache cleared');
    }

    get size() { return this._map.size; }
  }

  const cache = new ResultCache();


  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §4  ADAPTIVE TIMEOUT ENGINE                                  ║
  // ╚════════════════════════════════════════════════════════════════╝
  class AdaptiveTimeout {
    constructor() {
      this._history = [];
      this._maxSize = CFG.LATENCY_HISTORY_SIZE;
    }

    record(latencyMs) {
      if (latencyMs > 0 && latencyMs < 30000) {
        this._history.push(latencyMs);
        if (this._history.length > this._maxSize) {
          this._history.shift();
        }
      }
    }

    /**
     * Compute timeout based on P90 of recorded latencies.
     * Returns P90 * multiplier, clamped to [min, max].
     */
    compute(fallback = CFG.WS_TIMEOUT) {
      if (this._history.length < 10) return fallback;

      const sorted = [...this._history].sort((a, b) => a - b);
      const p90idx = Math.floor(sorted.length * 0.9);
      const p90    = sorted[p90idx] || fallback;
      const result = Math.round(p90 * CFG.P90_MULTIPLIER);

      return Math.max(
        CFG.MIN_ADAPTIVE_TIMEOUT,
        Math.min(CFG.MAX_ADAPTIVE_TIMEOUT, result)
      );
    }

    get stats() {
      if (!this._history.length) return { count: 0, avg: 0, p50: 0, p90: 0, p99: 0 };
      const s = [...this._history].sort((a, b) => a - b);
      return {
        count: s.length,
        avg:   Math.round(s.reduce((a, b) => a + b, 0) / s.length),
        p50:   s[Math.floor(s.length * 0.5)] || 0,
        p90:   s[Math.floor(s.length * 0.9)] || 0,
        p99:   s[Math.floor(s.length * 0.99)] || 0,
      };
    }
  }

  const adaptiveTimeout = new AdaptiveTimeout();


  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §5  UTILITY HELPERS                                          ║
  // ╚════════════════════════════════════════════════════════════════╝

  /** Check if a host string is an IP address */
  function isIP(host) {
    return /^[\d.]+$/.test(host) || /^[0-9a-fA-F:]+$/.test(host);
  }

  /** Determine if TLS should be used for a config */
  function shouldUseTLS(cfg) {
    const sec  = (cfg.security || '').toLowerCase();
    const port = Number(cfg.port) || 443;
    return sec === 'tls' || sec === 'reality' || sec === 'xtls' || CFG.TLS_PORTS.has(port);
  }

  /** Sleep for ms */
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** Retry a function with exponential backoff */
  async function withRetry(fn, maxRetries = CFG.MAX_RETRIES, baseDelay = CFG.RETRY_BASE_DELAY_MS) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn(attempt);
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200;
          log('DEBUG', `Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`);
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }


  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §6  CORE TEST METHODS                                       ║
  // ╚════════════════════════════════════════════════════════════════╝

  // ──────────────────────────────────────────────────────────────
  // 6A. WebSocket TCP Test
  //
  // Opens a real TCP connection via WebSocket.
  // Unlike fetch/no-cors, this gives real RTT timing.
  //
  //  • onopen  → server accepted TCP + WS handshake (LIVE)
  //  • onerror < 150ms → server TCP refused (port open = likely LIVE)
  //  • onerror 150ms-7s → connection established, WS rejected (LIVE)
  //  • timeout > 8s → server unresponsive (DEAD/FILTERED)
  // ──────────────────────────────────────────────────────────────
  function wsTest(host, port, useTLS, timeoutMs) {
    return new Promise((resolve) => {
      const start   = Date.now();
      const to      = timeoutMs || adaptiveTimeout.compute(CFG.WS_TIMEOUT);
      const scheme  = useTLS ? 'wss' : 'ws';
      const url     = `${scheme}://${host}:${port}/`;
      let   settled = false;
      let   ws      = null;

      const done = (live, method) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { if (ws && ws.readyState < 2) ws.close(); } catch {}
        const latency = Date.now() - start;
        if (live) adaptiveTimeout.record(latency);
        resolve({ latency, live, method });
      };

      const timer = setTimeout(() => done(false, 'ws-timeout'), to);

      try {
        ws = new WebSocket(url);

        ws.onopen = () => done(true, 'ws-open');

        ws.onerror = () => {
          const ms = Date.now() - start;
          // <80ms  → TCP immediately refused (possibly a closed port or firewall)
          // 80ms - (to-200ms) → connection reached server, WS upgrade rejected = LIVE
          // >(to-200ms) → essentially a timeout
          const live = ms >= 80 && ms < (to - 200);
          done(live, ms < 80 ? 'tcp-refused' : 'ws-rejected');
        };

        ws.onclose = () => {
          const ms = Date.now() - start;
          if (!settled) done(ms > 100, 'ws-closed');
        };
      } catch (e) {
        done(false, 'ws-exception');
      }
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 6B. Image Ping — fallback for port 80/443
  // Opens real TCP+TLS connection via image load
  // ──────────────────────────────────────────────────────────────
  function imgPing(host, port, useTLS, timeoutMs) {
    return new Promise((resolve) => {
      const start  = Date.now();
      const to     = timeoutMs || CFG.IMG_TIMEOUT;
      const scheme = useTLS ? 'https' : 'http';
      const url    = `${scheme}://${host}:${port}/favicon.ico?_=${Date.now()}`;
      let   done   = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ latency: Date.now() - start, live: false, method: 'img-timeout' });
      }, to);

      const img    = new Image();
      const finish = (live) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const latency = Date.now() - start;
        if (live) adaptiveTimeout.record(latency);
        resolve({ latency, live, method: 'img' });
      };

      img.onload  = () => finish(true);
      img.onerror = () => {
        // Error can be 404 or CORS — but TCP was established
        const ms = Date.now() - start;
        finish(ms > 50 && ms < to - 100);
      };
      img.src = url;
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 6C. Fetch Test — direct fetch with no-cors
  // ──────────────────────────────────────────────────────────────
  async function fetchTest(host, port, useTLS, timeoutMs) {
    const to     = timeoutMs || CFG.FETCH_TIMEOUT;
    const scheme = useTLS ? 'https' : 'http';
    const url    = `${scheme}://${host}:${port}/`;

    try {
      const ctrl  = new AbortController();
      const tid   = setTimeout(() => ctrl.abort(), to);
      const start = Date.now();

      await fetch(url, {
        mode:    'no-cors',
        cache:   'no-store',
        signal:  ctrl.signal,
      });

      clearTimeout(tid);
      const latency = Date.now() - start;
      adaptiveTimeout.record(latency);
      return { latency, live: true, method: 'fetch' };
    } catch (e) {
      if (e.name === 'AbortError') {
        return { latency: to, live: false, method: 'fetch-timeout' };
      }
      // Network error may still mean server is up (CORS blocking)
      return { latency: CFG.FETCH_TIMEOUT, live: false, method: 'fetch-error' };
    }
  }

  // ──────────────────────────────────────────────────────────────
  // 6D. Worker Proxy Test — via Cloudflare Worker
  // Most accurate test when available
  // ──────────────────────────────────────────────────────────────
  async function workerTest(host, port, workerUrl, timeoutMs) {
    const to = timeoutMs || CFG.WORKER_TIMEOUT;
    try {
      const ctrl = new AbortController(); const tid = setTimeout(() => ctrl.abort(), to); const start = Date.now();
      const res = await fetch(makeWorkerProbeUrl(workerUrl, host, port), { signal: ctrl.signal, cache:'no-store' });
      clearTimeout(tid); const latency = Date.now() - start;
      if (!res.ok) return { latency, live:false, method:`worker-http-${res.status}`, probe:makeProbe({ workerReachable:false, latencyMs:latency, method:'worker-probe', evidence:[`HTTP ${res.status}`] }) };
      const data = await res.json().catch(() => null);
      const ok = !!(data && (data.ok === true || data.reachable === true));
      if (ok) adaptiveTimeout.record(latency);
      return { latency:Number(data?.latencyMs || data?.latency || latency), live:ok, method:'worker-probe', probe:makeProbe({ dns:normalizeDnsState(data?.dns ?? data?.dnsOk), workerReachable:ok, protocolVerified:boolOrNull(data?.protocolVerified ?? data?.handshakeOk), tunnelVerified:boolOrNull(data?.tunnelVerified ?? data?.httpViaTunnelOk), latencyMs:Number(data?.latencyMs || data?.latency || latency), method:'worker-probe', confidence:data?.httpViaTunnelOk || data?.tunnelVerified ? 'high' : ok ? 'medium' : 'low', evidence:[data?.status ? `status=${data.status}` : '', data?.resolvedIp ? `ip=${data.resolvedIp}` : '', data?.error ? `error=${data.error}` : ''].filter(Boolean) }) };
    } catch (e) {
      return { latency:to, live:false, method:'worker-fail', probe:makeProbe({ workerReachable:false, latencyMs:to, method:'worker-fail', evidence:[e.message || 'worker failed'] }) };
    }
  }



  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §7  DNS OVER HTTPS CHECK                                     ║
  // ╚════════════════════════════════════════════════════════════════╝

  /**
   * Check if hostname resolves via DoH (uses app's checkDoH if available).
   * Returns true if DNS resolves, false otherwise.
   */
  async function dnsCheck(host) {
    if (isIP(host)) return true;

    // Use app's built-in DoH checker if available
    if (typeof checkDoH === 'function') {
      try {
        return await checkDoH(host);
      } catch {
        return 'unknown'; // DoH failure is unknown, not OK
      }
    }

    // Fallback: query Cloudflare DoH directly
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 4000);

      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
        {
          headers: { 'Accept': 'application/dns-json' },
          signal:  ctrl.signal,
          cache:   'no-store',
        }
      );

      clearTimeout(tid);
      const data = await res.json();
      return !!(data.Answer && data.Answer.length > 0);
    } catch {
      return 'unknown'; // DoH failure is unknown, not OK
    }
  }


  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §8  GEO-SPECIFIC IRAN TEST                                  ║
  // ║                                                               ║
  // ║  Three-layer approach:                                        ║
  // ║    Layer 1: Iranian Relay probe (if configured)               ║
  // ║    Layer 2: Mellat Bank (bmi.ir) access test                  ║
  // ║    Layer 3: Heuristic (DNS patterns, SNI analysis)            ║
  // ╚════════════════════════════════════════════════════════════════╝

  /**
   * Layer 1: Test connectivity through an Iranian network relay.
   * The relay must expose: GET /probe?host=HOST&port=PORT
   * Returns { reachable: bool, latency: number } or null if relay unavailable.
   */
  async function iranRelayProbe(host, port) {
    if (!CFG.IRAN_RELAY_URL) return null;

    try {
      const ctrl  = new AbortController();
      const tid   = setTimeout(() => ctrl.abort(), CFG.GEO_RELAY_TIMEOUT);
      const start = Date.now();

      const res = await fetch(
        `${CFG.IRAN_RELAY_URL}?host=${encodeURIComponent(host)}&port=${port}`,
        { signal: ctrl.signal, cache: 'no-store' }
      );

      clearTimeout(tid);

      if (!res.ok) return null;
      const data = await res.json();
      return {
        reachable: !!data.reachable,
        latency:   data.latency || (Date.now() - start),
        method:    'iran-relay',
      };
    } catch {
      log('WARN', `Iran relay probe failed for ${host}:${port}`);
      return null;
    }
  }

  /**
   * Layer 2: Test if config can access Mellat Bank (bmi.ir).
   * Logic: If a config is supposed to work from Iran, it should be
   * able to reach major Iranian websites. If it can't reach bmi.ir,
   * it's likely not usable from inside Iran.
   *
   * We test by checking if bmi.ir is accessible in the current network.
   * This validates the user's own network path.
   */
  async function bmiAccessTest() {
    const urls = [CFG.BMI_TEST_URL, ...CFG.BMI_FALLBACK_URLS];

    for (const url of urls) {
      try {
        const ctrl  = new AbortController();
        const tid   = setTimeout(() => ctrl.abort(), CFG.BMI_TIMEOUT);
        const start = Date.now();

        const img = new Image();
        const result = await new Promise((resolve) => {
          let settled = false;
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            clearTimeout(tid);
            resolve({ accessible: ok, latency: Date.now() - start, url });
          };
          img.onload  = () => finish(true);
          img.onerror = () => {
            // Error could be CORS but TCP was established
            const ms = Date.now() - start;
            finish(ms > 50 && ms < CFG.BMI_TIMEOUT - 500);
          };
          setTimeout(() => finish(false), CFG.BMI_TIMEOUT);
          img.src = `${url}?_=${Date.now()}`;
        });

        if (result.accessible) {
          log('DEBUG', `BMI test passed via ${url} (${result.latency}ms)`);
          return { accessible: true, latency: result.latency };
        }
      } catch {
        continue;
      }
    }

    return { accessible: false, latency: 0 };
  }

  /**
   * Layer 3: Heuristic analysis for Iranian accessibility.
   * Analyzes DNS patterns, SNI, and known blocked patterns.
   */
  function iranHeuristic(host, port, cfg) {
    let score = 50; // Start neutral
    const reasons = [];

    // Check for known Iranian-blocked patterns
    const blockedPatterns = [
      /\.google\./i, /\.youtube\./i, /\.facebook\./i,
      /\.twitter\./i, /\.instagram\./i, /\.telegram\./i,
    ];

    const hostLower = (cfg.sni || cfg.host || '').toLowerCase();

    // SNI matching blocked domains lowers confidence
    for (const pat of blockedPatterns) {
      if (pat.test(hostLower)) {
        score -= 15;
        reasons.push(`SNI matches blocked pattern: ${pat}`);
      }
    }

    // CDN-based configs are usually more accessible
    const cdnPatterns = [/cloudflare/i, /fastly/i, /akamai/i, /cloudfront/i, /gcore/i];
    for (const pat of cdnPatterns) {
      if (pat.test(hostLower) || pat.test(cfg.host || '')) {
        score += 20;
        reasons.push(`CDN detected: ${pat}`);
      }
    }

    // TLS is generally more reliable through Iranian filters
    if (shouldUseTLS(cfg)) {
      score += 10;
      reasons.push('TLS enabled');
    }

    // Reality protocol is designed for censorship resistance
    if ((cfg.security || '').toLowerCase() === 'reality') {
      score += 25;
      reasons.push('Reality protocol');
    }

    // XTLS also good
    if ((cfg.security || '').toLowerCase() === 'xtls') {
      score += 15;
      reasons.push('XTLS protocol');
    }

    // WebSocket transport is more filter-resistant
    if ((cfg.network || '').toLowerCase() === 'ws') {
      score += 10;
      reasons.push('WebSocket transport');
    }

    // gRPC transport
    if ((cfg.network || '').toLowerCase() === 'grpc') {
      score += 10;
      reasons.push('gRPC transport');
    }

    // Standard ports are less likely to be blocked
    if (port === 443 || port === 80) {
      score += 10;
      reasons.push('Standard port');
    }

    // Very unusual ports may be blocked
    if (port > 10000 && port !== 51820) {
      score -= 10;
      reasons.push('Unusual high port');
    }

    return {
      score:   Math.max(0, Math.min(100, score)),
      reasons,
      likely:  score >= 50,
    };
  }

  /**
   * Combined Geo-Iran test. Runs all three layers.
   * Returns: { iranAccessible: bool, iranScore: number, iranMethod: string }
   */
  async function geoIranTest(cfg) {
    if (!CFG.GEO_IRAN_ENABLED) {
      return { iranAccessible: null, iranScore: 0, iranMethod: 'disabled' };
    }

    const host = cfg.host;
    const port = Number(cfg.port) || 443;

    // Layer 1: Relay
    const relay = await iranRelayProbe(host, port);
    if (relay) {
      return {
        iranAccessible: relay.reachable,
        iranScore:      relay.reachable ? 95 : 5,
        iranLatency:    relay.latency,
        iranMethod:     'relay',
      };
    }

    // Layer 2: BMI Access
    const bmi = await bmiAccessTest();

    // Layer 3: Heuristic
    const heuristic = iranHeuristic(host, port, cfg);

    // Combine: if BMI is accessible + heuristic is positive → likely works from Iran
    const combined = bmi.accessible
      ? Math.min(100, heuristic.score + 20)
      : Math.max(0, heuristic.score - 20);

    return {
      iranAccessible: combined >= 50,
      iranScore:      combined,
      iranLatency:    bmi.latency || 0,
      iranMethod:     bmi.accessible ? 'bmi+heuristic' : 'heuristic-only',
      iranReasons:    heuristic.reasons,
    };
  }


  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §9  SELF-HEALING ENGINE                                      ║
  // ║                                                               ║
  // ║  Automatically repairs broken configs by:                     ║
  // ║  1. Diagnosing the failure type                               ║
  // ║  2. Applying correction rules                                 ║
  // ║  3. Re-testing after each fix                                 ║
  // ║  4. Learning from successful corrections                      ║
  // ╚════════════════════════════════════════════════════════════════╝

  class SelfHealingEngine {
    constructor() {
      this._patterns = this._loadPatterns();
    }

    // ── Persistence ──
    _loadPatterns() {
      try {
        const raw = PH_STORAGE.get(CFG.HEALING_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }

    _savePatterns() {
      try {
        PH_STORAGE.set(CFG.HEALING_STORAGE_KEY, JSON.stringify(this._patterns));
      } catch {}
    }

    _recordSuccess(originalKey, fix) {
      if (!this._patterns[originalKey]) {
        this._patterns[originalKey] = [];
      }
      const existing = this._patterns[originalKey].find(
        f => f.type === fix.type
      );
      if (existing) {
        existing.count = (existing.count || 0) + 1;
        existing.lastUsed = Date.now();
      } else {
        this._patterns[originalKey].push({
          ...fix,
          count: 1,
          lastUsed: Date.now(),
        });
      }
      this._savePatterns();
    }

    // ── Diagnosis ──
    _diagnose(cfg, result) {
      const issues = [];

      if (!result.live) {
        if (result.method === 'ws-timeout' || result.method === 'img-timeout' || result.method === 'fetch-timeout') {
          issues.push('TIMEOUT');
        }
        if (result.method === 'tcp-refused') {
          issues.push('PORT_CLOSED');
        }
        if (result.method === 'ws-exception') {
          issues.push('CONNECTION_ERROR');
        }
        if (result.method === 'worker-fail') {
          issues.push('WORKER_ERROR');
        }
        if (cfg.doh === false) {
          issues.push('DNS_FAIL');
        }
      }
      return issues;
    }

    // ── Fix application — completely self-contained ──
    _applyFix(cfg, issue) {
      const fixes = [];

      // Read infra settings directly from localStorage (no getUserInfrastructure dependency)
      const cleanIP  = (() => { try { return PH_STORAGE.get('cfg_clean_ip') || '162.159.192.203'; } catch { return '162.159.192.203'; } })();
      const cleanPort = (() => { try { return parseInt(PH_STORAGE.get('cfg_clean_port') || '859'); } catch { return 859; } })();

      if (issue === 'TIMEOUT' || issue === 'PORT_CLOSED') {
        const altPorts = [443, 8443, 2053, 2083, 2087, 2096, 80, 8080, 8880, 2096];
        const nextPort = altPorts.find(p => p !== cfg.port);
        if (nextPort) fixes.push({ type: 'PORT_SWAP', field: 'port', value: nextPort });

        if (cfg.type === 'wireguard') {
          fixes.push({ type: 'IP_SWAP',   field: 'host', value: cleanIP  });
          fixes.push({ type: 'PORT_SWAP2', field: 'port', value: cleanPort });
        }
      }
      if (issue === 'DNS_FAIL') {
        if (cfg.type === 'wireguard') {
          fixes.push({ type: 'IP_FALLBACK', field: 'host', value: cleanIP });
        }
      }
      if (issue === 'CONNECTION_ERROR') {
        const newSec = (cfg.security || 'none') === 'tls' ? 'none' : 'tls';
        fixes.push({ type: 'TLS_TOGGLE', field: 'security', value: newSec });
      }
      return fixes;
    }

    // ── Main heal flow — NO external function calls ──
    async heal(cfg, testResult) {
      if (!CFG.HEALING_ENABLED) return null;
      const issues = this._diagnose(cfg, testResult);
      if (!issues.length) return null;
      const originalKey = `${cfg.type}:${cfg.host}:${cfg.port}`;
      const original = { host:cfg.host, port:cfg.port, security:cfg.security, raw:cfg.raw };
      cfg.healing = cfg.healing || { status:'idle', original:null, candidates:[], selectedCandidateId:null };
      cfg.healing.status = 'building-candidates'; cfg.healing.original = cfg.healing.original || original;
      log('INFO', `SelfHeal: ${originalKey} → issues=[${issues.join(',')}]`);
      let candidateSeq = 0; const candidates = [];
      for (const issue of issues) for (const fix of this._applyFix(cfg, issue)) candidates.push({ id:`${Date.now()}-${candidateSeq++}`, issue, fix, candidate:{ ...original, [fix.field]:fix.value, raw:null }, probe:null, verified:false, applied:false });
      cfg.healing.candidates = candidates;
      for (const candidate of candidates.slice(0, CFG.HEALING_MAX_ATTEMPTS)) {
        const trial = { ...cfg, ...candidate.candidate, raw:null, tested:false, live:null, latency:null, probe:null };
        try {
          const probe = await bridgeVerifyConfig(trial, CFG.HEALING_TIMEOUT);
          if (probe) { candidate.probe = probe; candidate.verified = probe.tunnelVerified === true || probe.protocolVerified === true; }
          let result = null;
          if (!candidate.verified) { const useTLS = shouldUseTLS(trial); result = await wsTest(trial.host, trial.port, useTLS, CFG.HEALING_TIMEOUT); candidate.probe = makeProbe({ browserReachable:result.live === true, latencyMs:result.latency, method:`heal-browser-probe:${result.method}`, confidence:'medium', evidence:['candidate reachability; not auto-live without bridge'] }); }
          if (candidate.verified || candidate.probe?.browserReachable === true) {
            Object.assign(cfg, candidate.candidate); cfg._healed = true; cfg._healFix = `${candidate.fix.type}:${candidate.fix.field}=${candidate.fix.value}`;
            cfg.healing.status = candidate.verified ? 'applied-verified' : 'applied-reachable'; cfg.healing.selectedCandidateId = candidate.id; candidate.applied = true;
            this._recordSuccess(originalKey, candidate.fix);
            log(candidate.verified ? 'SUCCESS' : 'WARN', `SelfHeal ${candidate.verified ? 'verified' : 'reachable-only'} ${candidate.fix.type}`);
            return { fixed:true, verified:candidate.verified, tunnelVerified:candidate.probe?.tunnelVerified === true, fix:candidate.fix, latency:candidate.probe?.latencyMs || result?.latency || CFG.HEALING_TIMEOUT, method:candidate.probe?.method || result?.method || 'v10-healed-candidate' };
          }
        } catch(e) { candidate.error = e.message; log('DEBUG', `SelfHeal candidate failed: ${e.message}`); }
      }
      Object.assign(cfg, original); cfg.healing.status = 'no-working-candidate'; log('WARN', `SelfHeal exhausted for ${originalKey}`); return { fixed:false };
    }


    clearPatterns() {
      this._patterns = {};
      this._savePatterns();
    }
    get patternCount() { return Object.keys(this._patterns).length; }
    get stats() {
      let totalFixes = 0, totalSuccess = 0;
      for (const arr of Object.values(this._patterns)) {
        totalFixes   += arr.length;
        totalSuccess += arr.reduce((s, p) => s + (p.count || 0), 0);
      }
      return { patterns: Object.keys(this._patterns).length, fixes: totalFixes, applied: totalSuccess };
    }
  }

  const healer = new SelfHealingEngine();

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §10  REAL TEST ENGINE ORCHESTRATOR                          ║
  // ╚════════════════════════════════════════════════════════════════╝
  const RealTestEngine = (() => {
    let _running  = false;
    let _stopReq  = false;
    let _progress = { total: 0, done: 0, live: 0, dead: 0, healed: 0, tested: 0 };

    /**
     * Test a single config using the best available method.
     * Completely self-contained — no mandatory external calls.
     */
    async function testOne(cfg, opts = {}) {
      if (!cfg || !cfg.host) {
        applyProbeResult(cfg, makeProbe({
          browserReachable:false,
          bridgeReachable:false,
          latencyMs:9999,
          method:'no-host',
          evidence:['missing-host']
        }));
        return { live:false, latency:9999, method:'no-host', probe:cfg?.probe };
      }

      const cacheKeyHost = cfg.host;
      const cached = cache.get(cacheKeyHost, cfg.port);
      if (cached && !opts.forceRefresh && cached.probe && cached.probe.method && !String(cached.probe.method).includes('browser-fallback')) {
        applyProbeResult(cfg, cached.probe);
        cfg.testMethod = 'cache:' + cached.probe.method;
        return { live:cfg.live === true, latency:cfg.latency, method:cfg.testMethod, probe:cfg.probe };
      }

      const useTLS    = shouldUseTLS(cfg);
      const isWg      = cfg.type === 'wireguard';
      const workerUrl = getUserInfrastructure().workerUrl;
      const strictRealPing = (() => { try { return PH_STORAGE.get('ph_strict_real_ping') !== 'false'; } catch { return true; } })();
      let result = { live:false, latency:9999, method:'unverified' };
      let probe  = null;

      // 1) Highest quality: local verifier bridge. This is the only path that can
      // mark a config LIVE when it returns protocol/tunnel evidence.
      probe = await bridgeVerifyConfig(cfg, opts.bridgeTimeout || CFG.WORKER_TIMEOUT || 15000).catch(() => null);
      if (!probe) {
        // 2) Real host ping via local bridge. This is real TCP/TLS/UDP transport
        // from Node, not a browser heuristic, but it still does not prove proxy tunnel use.
        probe = await bridgePingHost(cfg.host, cfg.port, useTLS, opts.pingTimeout || CFG.FETCH_TIMEOUT || 10000, cfg.type).catch(() => null);
      }
      if (probe) {
        applyProbeResult(cfg, probe);
        result = { live:cfg.live === true, latency:cfg.latency, method:cfg.testMethod, probe:cfg.probe };
      }

      // 3) Cloudflare Worker probe. Useful cross-network HTTP/TLS evidence, but
      // not raw TCP and not a protocol tunnel proof unless a custom worker says so.
      if (!probe && workerUrl) {
        const r4 = await workerTest(cfg.host, cfg.port, workerUrl, CFG.WORKER_TIMEOUT);
        if (r4.probe) {
          probe = r4.probe;
          applyProbeResult(cfg, probe);
          result = { live:cfg.live === true, latency:cfg.latency, method:cfg.testMethod, probe:cfg.probe };
        }
      }

      // 4) Browser probes are fallback only. They are never promoted to LIVE.
      if (!probe && !strictRealPing) {
        if (isWg) {
          result = await wsTest(cfg.host, cfg.port, false, CFG.WS_TIMEOUT);
          if (!result.live) {
            const r2 = await imgPing(cfg.host, cfg.port, false, CFG.IMG_TIMEOUT);
            if (r2.live) result = r2;
          }
        } else {
          result = await wsTest(cfg.host, cfg.port, useTLS, adaptiveTimeout.compute(CFG.WS_TIMEOUT));
          if (!result.live) {
            const r2 = await imgPing(cfg.host, cfg.port, useTLS, CFG.IMG_TIMEOUT);
            if (r2.live) result = r2;
          }
          if (!result.live) {
            const r3 = await fetchTest(cfg.host, cfg.port, useTLS, CFG.FETCH_TIMEOUT);
            if (r3.live) result = r3;
          }
        }
      }

      const dnsState = isIP(cfg.host) ? 'ok' : await dnsCheck(cfg.host).then(normalizeDnsState).catch(() => 'unknown');
      if (!probe) {
        probe = makeProbe({
          dns:dnsState,
          browserReachable: strictRealPing ? null : result.live === true,
          workerReachable:null,
          bridgeReachable:false,
          protocolVerified:null,
          tunnelVerified:null,
          latencyMs: strictRealPing ? null : result.latency,
          method: strictRealPing ? 'real-ping-unavailable' : `browser-fallback:${result.method}`,
          confidence:'low',
          evidence:[
            strictRealPing ? 'local bridge not reachable: run proxyharvest-bridge.js' : result.method,
            isWg ? 'WireGuard UDP handshake requires bridge verification' : 'browser fallback does not prove proxy protocol/tunnel'
          ]
        });
      } else {
        probe.dns = dnsState === 'unknown' ? probe.dns : dnsState;
      }
      applyProbeResult(cfg, probe);

      // Healing is allowed to suggest/apply candidates, but only verified bridge
      // results can become LIVE. Non-verified candidates remain REACHABLE.
      if ((cfg.live === false || cfg.reachable === false) && CFG.HEALING_ENABLED && !opts.skipHeal) {
        const heal = await healer.heal(cfg, { live:cfg.reachable === true, latency:cfg.latency, method:cfg.testMethod });
        if (heal && heal.fixed) {
          const healedProbe = makeProbe({
            dns: normalizeDnsState(cfg.doh),
            browserReachable: heal.verified !== true ? true : null,
            bridgeReachable: true,
            protocolVerified: heal.verified === true ? true : null,
            tunnelVerified: heal.tunnelVerified === true ? true : null,
            latencyMs: heal.latency,
            method: heal.method || 'v10-healed-candidate',
            confidence: heal.verified ? 'high' : 'medium',
            evidence:['self-heal candidate applied', heal.fix?.type || 'fix'].filter(Boolean)
          });
          applyProbeResult(cfg, healedProbe);
          result = { live:cfg.live === true, latency:cfg.latency, method:cfg.testMethod, probe:cfg.probe };
          _progress.healed++;
        }
      }

      if (CFG.GEO_IRAN_ENABLED && (cfg.live === true || cfg.reachable === true)) {
        geoIranTest(cfg).then(geo => {
          cfg.iranAccessible = geo.iranAccessible;
          cfg.iranScore      = geo.iranScore;
          cfg.iranMethod     = geo.iranMethod;
        }).catch(() => {});
      }

      cache.set(cfg.host, cfg.port, { live:cfg.live, latency:cfg.latency, doh:cfg.doh, method:cfg.testMethod, probe:cfg.probe });
      return { live:cfg.live === true, latency:cfg.latency, method:cfg.testMethod, probe:cfg.probe };
    }


    /**
     * Run a batch of configs with concurrency control.
     */
    async function runBatch(configs, opts = {}) {
      if (_running) { log('WARN', 'RealTestEngine already running'); return; }
      _running  = true;
      _stopReq  = false;
      _progress = { total: configs.length, done: 0, live: 0, dead: 0, healed: 0, tested: 0 };

      const concurrency = opts.concurrency || CFG.DEFAULT_CONCURRENCY;
      log('INFO', `RealTestEngine: ${configs.length} configs, concurrency=${concurrency}`);

      const queue = [...configs];
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (queue.length > 0 && !_stopReq) {
          const cfg = queue.shift();
          if (!cfg) continue;
          try {
            const res = await testOne(cfg, opts);
            _progress.done++;
            _progress.tested++;
            if (res.live) _progress.live++; else _progress.dead++;
          } catch (e) {
            log('ERROR', `testOne failed [${cfg.host}]: ${e.message}`);
            _progress.done++;
          }
          if (typeof opts.onProgress === 'function') opts.onProgress({ ..._progress }, cfg);
        }
      }));

      _running = false;
      log('SUCCESS', `Batch done: ${_progress.live}/${_progress.total} live, ${_progress.healed} healed`);
      return { ..._progress };
    }

    return {
      testOne,
      runBatch,
      stop()     { _stopReq = true; },
      get isRunning()   { return _running; },
      get progress()    { return { ..._progress }; },
      get cacheSize()   { return cache.size; },
      get healerStats() { return healer.stats; },
      get latencyStats(){ return adaptiveTimeout.stats; },
    };
  })();

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §11  OVERRIDE EXISTING TEST FUNCTIONS                       ║
  // ╚════════════════════════════════════════════════════════════════╝

  // Override the original simple-fetch testConfigLatency with wsTest-powered version
  testConfigLatency = async function v10TestConfigLatency(cfg) {
    await RealTestEngine.testOne(cfg);
    // scoreConfig is in-scope (same DOMContentLoaded closure)
    scoreConfig(cfg);
  };

  // Override pingWgHost with multi-method version
  pingWgHost = async function v10PingWgHost(cfg) {
    await RealTestEngine.testOne(cfg);
    scoreConfig(cfg);
  };

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §12  ENHANCED TABLE ROW — adds Iran score + heal badge      ║
  // ╚════════════════════════════════════════════════════════════════╝

  // Capture original renderTableRow
  const _origRenderTableRow = renderTableRow;

  renderTableRow = function v10RenderTableRow(cfg, i, idx) {
    // Get the original row HTML
    let html = _origRenderTableRow(cfg, i, idx);

    // Inject heal badge into the type cell (after existing badges)
    if (cfg._healed) {
      html = html.replace(
        getInsecureBadge(cfg) || getMahsaBadge(cfg) || ')',
        `<span class="badge-mahsa" style="background:rgba(167,139,250,.18);color:var(--purple);border:1px solid rgba(167,139,250,.35);font-size:.47rem">✦ HEALED</span>`
      );
    }

    // Inject Iran score badge into score cell
    if (cfg.iranScore != null) {
      const iranColor  = cfg.iranScore >= 70 ? 'var(--green)' : cfg.iranScore >= 40 ? 'var(--yellow)' : 'var(--red)';
      const iranBadge  = `<span title="Iran accessibility score: ${cfg.iranScore}% via ${cfg.iranMethod||'heuristic'}" style="font-size:.5rem;padding:1px 4px;border-radius:3px;background:rgba(0,0,0,.3);color:${iranColor};border:1px solid ${iranColor};margin-left:3px">IR:${cfg.iranScore}</span>`;
      // Insert after the score number
      html = html.replace(
        `<span class="score-num"`,
        `${iranBadge}<span class="score-num"`
      );
    }

    // Inject test method tooltip on host cell
    if (cfg.testMethod) {
      html = html.replace(
        `class="host-cell"`,
        `class="host-cell" title="${escAttr(cfg.host || '')} — tested via: ${escAttr(cfg.testMethod || '')}"`
      );
    }

    return html;
  };

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §13  UI INJECTION — Real Test controls                      ║
  // ╚════════════════════════════════════════════════════════════════╝

  function injectRealTestUI() {
    // ── Real Test button in Configs tab toolbar ──────────────────
    const toolbar = document.querySelector('#tab-configs .cfg-toolbar-row');
    if (toolbar && !document.getElementById('realTestBtn')) {
      const btn = document.createElement('button');
      btn.id        = 'realTestBtn';
      btn.className = 'btn btn-cyan btn-sm';
      btn.title     = 'Real connectivity test using WebSocket + imgPing + workerTest + self-healing';
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h4l2-7 4 14 3-9 2 5h3"/></svg><span class="btn-label">REAL TEST</span>`;
      toolbar.appendChild(btn);

      const stopBtn = document.createElement('button');
      stopBtn.id        = 'realTestStopBtn';
      stopBtn.className = 'btn btn-red btn-sm';
      stopBtn.title     = 'Stop Real Test';
      stopBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg><span class="btn-label">STOP</span>`;
      stopBtn.style.display = 'none';
      toolbar.appendChild(stopBtn);

      btn.addEventListener('click', () => window.startRealTest());
      stopBtn.addEventListener('click', () => {
        RealTestEngine.stop();
        stopBtn.style.display = 'none';
        btn.disabled = false;
        btn.querySelector('.btn-label') ? (btn.querySelector('.btn-label').textContent='REAL TEST') : (btn.textContent='REAL TEST');
      });
    }

    // ── Real Test progress bar in Configs tab ──────────────────
    const cfgsPanel = document.getElementById('tab-configs');
    if (cfgsPanel && !document.getElementById('realTestProgressBar')) {
      const bar = document.createElement('div');
      bar.id = 'realTestProgressBar';
      bar.style.cssText = 'display:none;padding:6px 14px;background:rgba(0,212,255,.04);border-bottom:1px solid var(--border);font-size:.65rem;color:var(--text2)';
      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="color:var(--cyan)">⚡ Real Test v10</span>
          <div style="flex:1;min-width:80px;height:4px;background:rgba(255,255,255,.07);border-radius:2px">
            <div id="realTestFill" style="height:4px;background:var(--cyan);border-radius:2px;width:0%;transition:width .3s"></div>
          </div>
          <span id="realTestStatus" style="color:var(--text3)">0 / 0</span>
          <span id="realTestLive" style="color:var(--green)">0 verified</span>
          <span id="realTestHealed" style="color:var(--purple)">0 healed</span>
          <span id="realTestMethod" style="color:var(--text3);font-family:var(--mono);font-size:.58rem"></span>
        </div>`;
      // Insert after the config stats ribbon
      const ribbon = cfgsPanel.querySelector('.cfg-stats-ribbon') || cfgsPanel.firstElementChild;
      if (ribbon && ribbon.parentNode) ribbon.parentNode.insertBefore(bar, ribbon.nextSibling);
      else cfgsPanel.insertBefore(bar, cfgsPanel.firstChild);
    }

    // ── Heal badge styles ───────────────────────────────────────
    if (!document.getElementById('v10styles')) {
      const style = document.createElement('style');
      style.id = 'v10styles';
      style.textContent = `
        .badge-healed {
          display:inline-flex;align-items:center;padding:1px 5px;
          border-radius:3px;font-size:.46rem;font-weight:700;letter-spacing:.5px;
          background:rgba(167,139,250,.15);color:var(--purple);
          border:1px solid rgba(167,139,250,.4);
        }
        .iran-badge {
          display:inline-flex;align-items:center;padding:1px 4px;
          border-radius:3px;font-size:.5rem;font-weight:600;
        }
        #realTestBtn { background:linear-gradient(135deg,rgba(0,212,255,.15),rgba(0,212,255,.05));border-color:rgba(0,212,255,.4); }
        #realTestBtn:hover { background:rgba(0,212,255,.2); }
      `;
      document.head.appendChild(style);
    }
  }

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  §14  GLOBAL EXPORTS                                         ║
  // ╚════════════════════════════════════════════════════════════════╝

  // Progress updater
  function updateRealTestProgress(prog, cfg) {
    const fill   = document.getElementById('realTestFill');
    const status = document.getElementById('realTestStatus');
    const live   = document.getElementById('realTestLive');
    const healed = document.getElementById('realTestHealed');
    const method = document.getElementById('realTestMethod');
    const bar    = document.getElementById('realTestProgressBar');
    if (bar) bar.style.display = 'block';
    const pct = prog.total > 0 ? Math.round(prog.done / prog.total * 100) : 0;
    if (fill)   fill.style.width  = pct + '%';
    if (status) status.textContent = `${prog.done} / ${prog.total} (${pct}%)`;
    if (live)   live.textContent  = `${prog.live} verified`; 
    if (healed) healed.textContent = prog.healed > 0 ? `${prog.healed} healed` : '';
    if (method && cfg) method.textContent = cfg.testMethod || '';
    // Periodic re-render
    if (prog.done % CFG.UI_RENDER_INTERVAL === 0) {
      if (typeof renderTable === 'function') renderTable();
      if (typeof updateHeaderStats === 'function') updateHeaderStats();
    }
  }

  // startRealTest — can be called from UI or console
  async function startRealTest(opts = {}) {
    const configs = typeof getFilteredConfigs === 'function'
      ? getFilteredConfigs()
      : (S?.configs || []);

    if (!configs.length) {
      toast('No configs to test', 'warn');
      return;
    }

    // Update button state
    const btn  = document.getElementById('realTestBtn');
    const stop = document.getElementById('realTestStopBtn');
    if (btn)  { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Testing…'; }
    if (stop) stop.style.display = '';

    toast(`Real Test v10: ${configs.length} configs (local bridge real ping + self-heal)`, 'info');
    logConsole('info', `⚡ Real Test v10 starting — ${configs.length} configs`);

    const result = await RealTestEngine.runBatch(configs, {
      concurrency: CFG.DEFAULT_CONCURRENCY,
      onProgress: updateRealTestProgress,
      ...opts,
    });

    // Final sort and render
    S.configs.sort((a, b) => b.score - a.score);
    if (typeof renderTable    === 'function') renderTable();
    if (typeof renderWgPanel  === 'function') renderWgPanel();
    if (typeof updateExportArea === 'function') updateExportArea();
    if (typeof updateHeaderStats === 'function') updateHeaderStats();
    if (typeof persistConfigs === 'function') await persistConfigs();

    // Restore button
    if (btn)  { btn.disabled = false; const l=btn.querySelector('.btn-label'); if(l) l.textContent='REAL TEST'; else btn.textContent='REAL TEST'; }
    if (stop) stop.style.display = 'none';

    // Hide progress bar after delay
    setTimeout(() => {
      const bar = document.getElementById('realTestProgressBar');
      if (bar) bar.style.display = 'none';
    }, 4000);

    logConsole('success',
      `⚡ Real Test v10 done — ${result.live}/${result.total} verified, ${result.healed} self-healed`);
    toast(`Real Test: ${result.live} verified, ${result.healed} self-healed`, 'ok');

    return result;
  }

  // Expose everything to global scope
  Object.assign(window, {
    // Engine
    RealTestEngine, verificationPass, getExportUri, applyProbeResult, makeProbe, bridgePingHost, bridgeVerifyConfig, injectRealTestUI,
    // Test primitives (callable from console or buttons)
    wsTest, imgPing, fetchTest, workerTest, dnsCheck,
    geoIranTest,
    // Batch runner
    startRealTest,
    stopRealTest: () => {
      RealTestEngine.stop();
      const btn  = document.getElementById('realTestBtn');
      const stop = document.getElementById('realTestStopBtn');
      if (btn)  { btn.disabled = false; const l=btn.querySelector('.btn-label'); if(l) l.textContent='REAL TEST'; else btn.textContent='REAL TEST'; }
      if (stop) stop.style.display = 'none';
    },
    // Cache & diagnostics
    resetTestCache: () => { cache.clear(); toast('Test cache cleared', 'ok'); },
    setIranRelayUrl: (url) => { CFG.IRAN_RELAY_URL = url; },
    getTestStats: () => ({
      cache:   { size: cache.size, ttlMs: CFG.CACHE_TTL_MS },
      latency: adaptiveTimeout.stats,
      healer:  healer.stats,
      engine:  RealTestEngine.progress,
    }),
    // Export results
    exportTestResults: () => {
      if (!S?.configs?.length) { toast('No results', 'warn'); return; }
      const rows = S.configs.map(c => ({
        type: c.type, host: c.host, port: c.port,
        latency: c.latency, live: c.live, doh: c.doh, score: c.score,
        method: c.testMethod || '', healed: !!c._healed, healFix: c._healFix || '',
        iranAccessible: c.iranAccessible ?? null,
        iranScore: c.iranScore ?? null, iranMethod: c.iranMethod || '',
      }));
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `v10-test-results-${Date.now()}.json`,
      });
      a.click();
      toast(`${rows.length} results exported`, 'ok');
    },
  });

  log('SUCCESS', 'ProxyHarvest v10 Real Test Engine installed ✓');

})(); // end v10 engine IIFE

init().then(() => { window.PROXYHARVEST_READY = true; }).catch((e) => {
  window.PROXYHARVEST_READY = false;
  window.PROXYHARVEST_INIT_ERROR = String(e?.message || e || 'Unknown initialization error');
  console.error('ProxyHarvest initialization failed:', e);
  try { setStatus('error','INIT ERROR'); } catch {}
});

// ── v10 UI injection (runs after init() sets up all tabs/buttons) ──
if (typeof window.injectRealTestUI === 'function') {
  try { window.injectRealTestUI(); } catch(e) {
    console.warn('v10 UI injection deferred:', e.message);
    setTimeout(() => { try { window.injectRealTestUI?.(); } catch {} }, 500);
  }
}



// ===============================================================
// ██  AUTO-INJECTED BY inject_features.py — 2026-04-11T13:02:31.539889
// ===============================================================

// ═══════════════════════════════════════════════════════════════
// ██  HELPER GUARDS — ensure utility functions exist
// ═══════════════════════════════════════════════════════════════
if (typeof escHtml === 'undefined') {
  function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
}
if (typeof escAttr === 'undefined') {
  function escAttr(s) { return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
}
if (typeof sanitizeLogMsg === 'undefined') {
  function sanitizeLogMsg(s) { return escHtml(String(s).slice(0, 2000)); }
}
if (typeof logConsole === 'undefined') {
  function logConsole(level, msg) {
    const el = document.getElementById('logOutput');
    if (!el) { console.log(`[${level}] ${msg}`); return; }
    const ts = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line log-' + level;
    line.innerHTML = `<span class="log-ts">[${ts}]</span> <span class="log-lvl">[${level.toUpperCase()}]</span> ${sanitizeLogMsg(msg)}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
}
if (typeof toast === 'undefined') {
  function toast(msg, type) {
    const wrap = document.getElementById('toastWrap') || document.body;
    const t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'info');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 400); }, 3000);
  }
}
if (typeof handleCfgAction === 'undefined') {
  handleCfgAction = function(action, uid) {
    logConsole('info', `Config action: ${action} on uid=${uid}`);
    if (action === 'copy') {
      const cfg = (window.__allConfigs || []).find(c => c.uid === uid);
      if (cfg) {
        navigator.clipboard.writeText(cfg.raw || cfg.host || JSON.stringify(cfg))
          .then(() => toast('Copied to clipboard ✓', 'ok'))
          .catch(() => toast('Copy failed', 'err'));
      }
    } else if (action === 'test') {
      toast(`Testing config #${uid}…`, 'info');
    } else if (action === 'delete') {
      if (confirm(`Delete config #${uid}?`)) {
        window.__allConfigs = (window.__allConfigs || []).filter(c => c.uid !== uid);
        SortableTable.render(window.__allConfigs);
        toast('Config deleted', 'ok');
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ██  SORTABLE TABLE ENGINE — Configs Tab
// ═══════════════════════════════════════════════════════════════
const SortableTable = (() => {
  let _sortCol = 'latency';
  let _sortDir = 'asc';
  let _filterText = '';
  let _currentPage = 1;
  let _pageSize = 25;

  const COLUMNS = [
    { key: 'uid',      label: '#',         sortable: false, width: '50px'  },
    { key: 'type',     label: 'Type',      sortable: true,  width: '80px'  },
    { key: 'host',     label: 'Host',      sortable: true,  width: 'auto'  },
    { key: 'port',     label: 'Port',      sortable: true,  width: '70px'  },
    { key: 'latency',  label: 'Latency',   sortable: true,  width: '90px'  },
    { key: 'doh',      label: 'DoH',       sortable: true,  width: '70px'  },
    { key: 'status',   label: 'Status',    sortable: true,  width: '90px'  },
    { key: 'source',   label: 'Source',    sortable: true,  width: 'auto'  },
    { key: 'actions',  label: 'Actions',   sortable: false, width: '120px' },
  ];

  function compare(a, b, col) {
    let va = a[col], vb = b[col];
    if (col === 'latency' || col === 'port') {
      va = parseFloat(va) || Infinity;
      vb = parseFloat(vb) || Infinity;
    }
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  }

  function sortData(data) {
    const sorted = [...data].sort((a, b) => compare(a, b, _sortCol));
    return _sortDir === 'desc' ? sorted.reverse() : sorted;
  }

  function filterData(data) {
    if (!_filterText) return data;
    const q = _filterText.toLowerCase();
    return data.filter(c =>
      (c.host || '').toLowerCase().includes(q) ||
      (c.type || '').toLowerCase().includes(q) ||
      (c.source || '').toLowerCase().includes(q) ||
      String(c.port || '').includes(q)
    );
  }

  function paginate(data) {
    const start = (_currentPage - 1) * _pageSize;
    return {
      items: data.slice(start, start + _pageSize),
      total: data.length,
      totalPages: Math.ceil(data.length / _pageSize) || 1
    };
  }

  function statusBadge(status) {
    const map = {
      active:   { cls: 'badge-ok',   icon: '●', text: 'Active'   },
      testing:  { cls: 'badge-warn', icon: '◉', text: 'Testing'  },
      dead:     { cls: 'badge-err',  icon: '○', text: 'Dead'     },
      unknown:  { cls: 'badge-dim',  icon: '◌', text: 'Unknown'  },
    };
    const s = map[(status || 'unknown').toLowerCase()] || map.unknown;
    return `<span class="cfg-badge ${s.cls}">${s.icon} ${s.text}</span>`;
  }

  function latencyColor(ms) {
    const v = parseFloat(ms);
    if (isNaN(v)) return 'var(--dim)';
    if (v < 100) return 'var(--green)';
    if (v < 300) return 'var(--yellow)';
    return 'var(--red)';
  }

  function renderHead() {
    return COLUMNS.map(col => {
      if (!col.sortable) return `<th style="width:${col.width}">${col.label}</th>`;
      const active = _sortCol === col.key;
      const arrow = active ? (_sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
      return `<th style="width:${col.width};cursor:pointer" class="sortable-th${active ? ' sort-active' : ''}"
                  data-sort-col="${col.key}">${col.label}${arrow}</th>`;
    }).join('');
  }

  function renderRow(cfg, idx) {
    const lat = parseFloat(cfg.latency);
    const latStr = isNaN(lat) ? '—' : `<span style="color:${latencyColor(lat)}">${lat}ms</span>`;
    return `<tr data-uid="${cfg.uid || idx}">
      <td>${cfg.uid || idx}</td>
      <td><span class="cfg-type-tag">${escHtml(cfg.type || '?')}</span></td>
      <td class="mono">${escHtml(cfg.host || '—')}</td>
      <td class="mono">${cfg.port || '—'}</td>
      <td>${latStr}</td>
      <td>${cfg.doh ? '✓' : '✗'}</td>
      <td>${statusBadge(cfg.status)}</td>
      <td>${escHtml(cfg.source || '—')}</td>
      <td>
        <button class="btn-xs btn-test" data-action="test" data-uid="${cfg.uid}">Test</button>
        <button class="btn-xs btn-copy" data-action="copy" data-uid="${cfg.uid}">Copy</button>
        <button class="btn-xs btn-del"  data-action="delete" data-uid="${cfg.uid}">✗</button>
      </td>
    </tr>`;
  }

  function renderPagination(total, totalPages) {
    if (totalPages <= 1) return '';
    let html = '<div class="pagination">';
    html += `<button class="btn-xs pg-btn" data-page="prev" ${_currentPage <= 1 ? 'disabled' : ''}>◀</button>`;
    const start = Math.max(1, _currentPage - 2);
    const end = Math.min(totalPages, _currentPage + 2);
    for (let i = start; i <= end; i++) {
      html += `<button class="btn-xs pg-btn ${i === _currentPage ? 'pg-active' : ''}" data-page="${i}">${i}</button>`;
    }
    html += `<button class="btn-xs pg-btn" data-page="next" ${_currentPage >= totalPages ? 'disabled' : ''}>▶</button>`;
    html += `<span class="pg-info">${total} configs — page ${_currentPage}/${totalPages}</span>`;
    html += '</div>';
    return html;
  }

  function render(configs, container) {
    if (!container) container = document.getElementById('cfgsTableWrap');
    if (!container) return;

    const filtered = filterData(configs);
    const sorted = sortData(filtered);
    const { items, total, totalPages } = paginate(sorted);

    let html = `
      <div class="cfgs-toolbar">
        <input type="text" id="cfgSearchInput" class="search-input" placeholder="Search configs…"
               value="${escAttr(_filterText)}" />
        <select id="cfgPageSize" class="search-input" style="width:auto">
          ${[10,25,50,100].map(n => `<option value="${n}" ${n===_pageSize?'selected':''}>${n}/page</option>`).join('')}
        </select>
        <span class="cfgs-count">${filtered.length} of ${configs.length} configs</span>
      </div>
      <div class="table-scroll">
        <table class="cfgs-table sortable-table">
          <thead><tr>${renderHead()}</tr></thead>
          <tbody>${items.map((c,i) => renderRow(c, (_currentPage-1)*_pageSize + i + 1)).join('')}</tbody>
        </table>
      </div>
      ${renderPagination(total, totalPages)}
    `;
    container.innerHTML = html;
    bindEvents(container, configs);
  }

  function bindEvents(container, configs) {
    // Sort headers
    container.querySelectorAll('.sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sortCol;
        if (_sortCol === col) {
          _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          _sortCol = col;
          _sortDir = 'asc';
        }
        _currentPage = 1;
        render(configs, container);
      });
    });

    // Search
    const searchEl = container.querySelector('#cfgSearchInput');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        _filterText = searchEl.value.trim();
        _currentPage = 1;
        render(configs, container);
      });
      searchEl.focus();
    }

    // Page size
    const psEl = container.querySelector('#cfgPageSize');
    if (psEl) {
      psEl.addEventListener('change', () => {
        _pageSize = parseInt(psEl.value, 10) || 25;
        _currentPage = 1;
        render(configs, container);
      });
    }

    // Pagination
    container.querySelectorAll('.pg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.page;
        if (p === 'prev') _currentPage = Math.max(1, _currentPage - 1);
        else if (p === 'next') _currentPage++;
        else _currentPage = parseInt(p, 10);
        render(configs, container);
      });
    });

    // Row actions
    container.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const uid = parseInt(btn.dataset.uid, 10);
        if (typeof handleCfgAction === 'function') {
          handleCfgAction(action, uid);
        }
      });
    });
  }

  function setSort(col, dir) { _sortCol = col; _sortDir = dir || 'asc'; }
  function setFilter(text) { _filterText = text; _currentPage = 1; }
  function setPage(p) { _currentPage = p; }
  function getState() { return { sortCol: _sortCol, sortDir: _sortDir, filter: _filterText, page: _currentPage, pageSize: _pageSize }; }

  return { render, setSort, setFilter, setPage, getState };
})();

// ═══════════════════════════════════════════════════════════════
// ██  API FETCH + LIVE STATS + LOG STREAMING
// ═══════════════════════════════════════════════════════════════
const LiveEngine = (() => {
  let _statsInterval = null;
  let _logStream = null;
  let _apiBase = '';
  let _fetchInterval = 60000;
  let _statsRefresh = 5000;

  // ── API Fetch: دریافت configs از endpoint ──
  async function fetchConfigs(url, opts = {}) {
    const endpoint = url || _apiBase;
    if (!endpoint) {
      logConsole('warning', 'API fetch: no endpoint configured');
      return [];
    }
    logConsole('info', `API fetch: ${endpoint} …`);
    try {
      const resp = await fetch(endpoint, {
        method: opts.method || 'GET',
        headers: Object.assign({ 'Accept': 'application/json' }, opts.headers || {}),
        signal: AbortSignal.timeout(opts.timeout || 15000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      const configs = Array.isArray(data) ? data : (data.configs || data.results || data.data || []);
      logConsole('success', `API fetch: received ${configs.length} configs`);
      toast(`Fetched ${configs.length} configs`, 'ok');
      return configs;
    } catch (e) {
      logConsole('error', `API fetch failed: ${e.message}`);
      toast(`Fetch failed: ${e.message}`, 'err');
      return [];
    }
  }

  // ── Auto Fetch: دریافت خودکار در بازه‌های زمانی ──
  let _autoFetchTimer = null;
  function startAutoFetch(url, interval, onData) {
    stopAutoFetch();
    _fetchInterval = interval || _fetchInterval;
    logConsole('info', `Auto-fetch started: every ${_fetchInterval / 1000}s`);
    const tick = async () => {
      const data = await fetchConfigs(url);
      if (data.length && typeof onData === 'function') onData(data);
    };
    tick();
    _autoFetchTimer = setInterval(tick, _fetchInterval);
  }
  function stopAutoFetch() {
    if (_autoFetchTimer) { clearInterval(_autoFetchTimer); _autoFetchTimer = null; }
  }

  // ── Live Stats: آمار زنده در هدر ──
  function updateStats(configs) {
    const total = configs.length;
    const active = configs.filter(c => (c.status || '').toLowerCase() === 'active').length;
    const avgLat = configs.reduce((s, c) => s + (parseFloat(c.latency) || 0), 0) / (total || 1);
    const types = {};
    configs.forEach(c => { types[c.type || 'unknown'] = (types[c.type || 'unknown'] || 0) + 1; });

    const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setTxt('statTotal',   total);
    setTxt('statActive',  active);
    setTxt('statDead',    total - active);
    setTxt('statAvgLat',  avgLat.toFixed(0) + 'ms');

    // Mini chart data (last 20 latency values)
    const latencies = configs.slice(-20).map(c => parseFloat(c.latency) || 0);
    renderMiniChart(latencies);

    // Type breakdown
    const breakEl = document.getElementById('statTypeBreak');
    if (breakEl) {
      breakEl.innerHTML = Object.entries(types)
        .sort((a,b) => b[1] - a[1])
        .map(([t, n]) => `<span class="type-chip">${escHtml(t)}: ${n}</span>`)
        .join(' ');
    }
  }

  function renderMiniChart(values) {
    const canvas = document.getElementById('miniChart');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!values.length) return;

    const max = Math.max(...values, 1);
    const step = W / (values.length - 1 || 1);

    ctx.beginPath();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00e5ff';
    ctx.lineWidth = 1.5;
    values.forEach((v, i) => {
      const x = i * step;
      const y = H - (v / max) * (H - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill gradient
    ctx.lineTo((values.length - 1) * step, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,229,255,0.15)');
    grad.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function startStatsRefresh(getConfigs, interval) {
    stopStatsRefresh();
    _statsRefresh = interval || _statsRefresh;
    _statsInterval = setInterval(() => {
      const cfgs = typeof getConfigs === 'function' ? getConfigs() : [];
      if (cfgs.length) updateStats(cfgs);
    }, _statsRefresh);
  }
  function stopStatsRefresh() {
    if (_statsInterval) { clearInterval(_statsInterval); _statsInterval = null; }
  }

  // ── Log Streaming: اتصال به endpoint لاگ (SSE / polling) ──
  function startLogStream(url) {
    stopLogStream();
    if (!url) return;
    if (typeof EventSource !== 'undefined' && url.includes('/stream')) {
      logConsole('info', `Log stream (SSE): connecting to ${url}`);
      _logStream = new EventSource(url);
      _logStream.onmessage = e => {
        try {
          const d = JSON.parse(e.data);
          logConsole(d.level || 'info', sanitizeLogMsg(d.message || d.msg || e.data));
        } catch {
          logConsole('info', sanitizeLogMsg(e.data));
        }
      };
      _logStream.onerror = () => {
        logConsole('warning', 'Log stream disconnected — will retry');
      };
    } else {
      logConsole('info', `Log polling: ${url} every 3s`);
      let lastId = 0;
      _logStream = setInterval(async () => {
        try {
          const resp = await fetch(`${url}?after=${lastId}`, { signal: AbortSignal.timeout(5000) });
          if (!resp.ok) return;
          const logs = await resp.json();
          (Array.isArray(logs) ? logs : []).forEach(l => {
            logConsole(l.level || 'info', sanitizeLogMsg(l.message || l.msg || ''));
            if (l.id > lastId) lastId = l.id;
          });
        } catch {}
      }, 3000);
    }
  }
  function stopLogStream() {
    if (_logStream) {
      if (_logStream.close) _logStream.close();
      else clearInterval(_logStream);
      _logStream = null;
    }
  }

  function setApiBase(url) { _apiBase = url; }

  return {
    fetchConfigs, startAutoFetch, stopAutoFetch,
    updateStats, startStatsRefresh, stopStatsRefresh,
    renderMiniChart,
    startLogStream, stopLogStream,
    setApiBase,
  };
})();

// ═══════════════════════════════════════════════════════════════
// ██  THEME ENGINE + SETTINGS PERSISTENCE
// ═══════════════════════════════════════════════════════════════
const ThemeEngine = (() => {
  const STORAGE_KEY = 'proxyharvest_settings';

  const DEFAULTS = {
    theme: 'dark',
    accentColor: '#00e5ff',
    fontSize: 14,
    fontFamily: "'JetBrains Mono', monospace",
    sidebarCollapsed: false,
    logLevel: 'info',
    autoFetchEnabled: false,
    autoFetchUrl: '',
    autoFetchInterval: 60,
    logStreamUrl: '',
    pageSize: 25,
    animationsEnabled: true,
    glassEnabled: true,
    scanlineEnabled: true,
    // AI Settings
    aiEngineName: 'LocalHealerV2',
    aiMaxTokens: 1000,
    aiAutoApply: false,
    aiBatchSize: 20,
  };

  let _settings = { ...DEFAULTS };

  // ── Load / Save ──
  function load() {
    try {
      const raw = PH_STORAGE.get(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        _settings = { ...DEFAULTS, ...parsed };
      }
    } catch (e) {
      logConsole('warning', 'Settings load failed: ' + e.message);
    }
    return _settings;
  }

  function save() {
    try {
      PH_STORAGE.set(STORAGE_KEY, JSON.stringify(_settings));
    } catch (e) {
      logConsole('warning', 'Settings save failed: ' + e.message);
    }
  }

  function get(key) { return key ? _settings[key] : { ..._settings }; }

  function set(key, value) {
    _settings[key] = value;
    save();
    apply();
  }

  function reset() {
    _settings = { ...DEFAULTS };
    save();
    apply();
    toast('Settings reset to defaults', 'ok');
  }

  // ── Apply Theme ──
  function apply() {
    const root = document.documentElement;

    // Theme
    root.setAttribute('data-theme', _settings.theme);

    // Accent color
    if (_settings.accentColor) {
      root.style.setProperty('--accent', _settings.accentColor);
      root.style.setProperty('--accent-dim', _settings.accentColor + '33');
    }

    // Font
    root.style.setProperty('--font-size', _settings.fontSize + 'px');
    root.style.setProperty('--font-family', _settings.fontFamily);
    document.body.style.fontSize = _settings.fontSize + 'px';

    // Sidebar
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.toggle('collapsed', !!_settings.sidebarCollapsed);
    }

    // Animations
    if (!_settings.animationsEnabled) {
      root.style.setProperty('--transition', 'none');
    } else {
      root.style.removeProperty('--transition');
    }

    // Scanline overlay
    const scanline = document.querySelector('body::before') || null;
    if (!_settings.scanlineEnabled) {
      root.classList.add('no-scanline');
    } else {
      root.classList.remove('no-scanline');
    }

    // Glass effect
    if (!_settings.glassEnabled) {
      root.classList.add('no-glass');
    } else {
      root.classList.remove('no-glass');
    }

    logConsole('info', `Theme applied: ${_settings.theme}, accent: ${_settings.accentColor}`);
  }

  // ── Settings Panel Render ──
  function renderSettingsPanel(container) {
    if (!container) container = document.getElementById('settingsContent');
    if (!container) return;

    container.innerHTML = `
      <div class="settings-grid">

        <!-- ── Appearance ── -->
        <div class="setting-group">
          <h3 class="setting-title">🎨 Appearance</h3>
          <label class="setting-row">
            <span>Theme</span>
            <select id="setTheme" class="setting-input">
              <option value="dark" ${_settings.theme==='dark'?'selected':''}>🌙 Dark</option>
              <option value="light" ${_settings.theme==='light'?'selected':''}>☀️ Light</option>
              <option value="coffee" ${_settings.theme==='coffee'?'selected':''}>☕ Coffee</option>
            </select>
          </label>
          <label class="setting-row">
            <span>Accent Color</span>
            <input type="color" id="setAccent" class="setting-input" value="${_settings.accentColor}" />
          </label>
          <label class="setting-row">
            <span>Font Size</span>
            <input type="range" id="setFontSize" min="10" max="20" value="${_settings.fontSize}" class="setting-input" />
            <span id="setFontSizeVal">${_settings.fontSize}px</span>
          </label>
          <label class="setting-row">
            <span>Font Family</span>
            <select id="setFontFamily" class="setting-input">
              <option value="'JetBrains Mono', monospace" ${_settings.fontFamily.includes('JetBrains')?'selected':''}>JetBrains Mono</option>
              <option value="'Fira Code', monospace" ${_settings.fontFamily.includes('Fira')?'selected':''}>Fira Code</option>
              <option value="monospace" ${_settings.fontFamily==='monospace'?'selected':''}>System Mono</option>
            </select>
          </label>
          <label class="setting-row">
            <span>Animations</span>
            <input type="checkbox" id="setAnimations" ${_settings.animationsEnabled?'checked':''} />
          </label>
          <label class="setting-row">
            <span>Scanline Overlay</span>
            <input type="checkbox" id="setScanline" ${_settings.scanlineEnabled?'checked':''} />
          </label>
          <label class="setting-row">
            <span>Glass Effect</span>
            <input type="checkbox" id="setGlass" ${_settings.glassEnabled?'checked':''} />
          </label>
        </div>

        <!-- ── Smart Local Healer ── -->
        <div class="setting-group" style="border:1px solid rgba(52,211,153,0.25);background:rgba(52,211,153,0.04);border-radius:8px;padding:14px">
          <h3 class="setting-title" style="color:var(--green)">⚡ Smart Local Healer</h3>
          <div style="font-size:.62rem;color:var(--text3);margin-bottom:10px;line-height:1.7;padding:6px 8px;background:rgba(52,211,153,0.07);border-radius:4px;border-left:2px solid var(--green)">
            Local intelligent engine — no external API required<br>
            Automatic diagnosis + direct fixes + learning from successes<br>
            <span style="color:var(--green)">✓ Fully offline · ✓ No API key · ✓ Self-learning</span>
          </div>
          <label class="setting-row">
            <span>Batch Size</span>
            <input type="number" id="setAiBatchSize" class="setting-input" min="5" max="500" step="10"
                   value="${_settings.aiBatchSize||50}" />
            <span style="font-size:.6rem;color:var(--text3)">configs/batch</span>
          </label>
          <label class="setting-row">
            <span>Auto-Apply Fixes</span>
            <input type="checkbox" id="setAiAutoApply" ${_settings.aiAutoApply?'checked':''} />
            <span style="font-size:.6rem;color:var(--text3);margin-right:4px">Auto-apply after diagnosis</span>
          </label>
          <div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
            <button type="button" onclick="(()=>{ const s=AI_HEALER.getPatternStats(); document.getElementById('healerStatsBox').textContent='Patterns: '+s.patterns+' · Total fixes: '+s.totalFixes; })()" class="btn btn-xs btn-green" style="width:100%">📊 Show learning stats</button>
            <div id="healerStatsBox" style="font-size:.62rem;font-family:var(--mono);min-height:16px;color:var(--green);padding:4px 6px;background:rgba(52,211,153,0.05);border-radius:4px"></div>
            <button type="button" id="btnTestHealEngine" class="btn btn-xs btn-ghost" style="width:100%">🧪 Quick engine test</button>
            <div id="healEngineTestResult" style="font-size:.62rem;font-family:var(--mono);min-height:16px;color:var(--text3)"></div>
          </div>
        </div>

        <!-- ── API & Streaming ── -->
        <div class="setting-group">
          <h3 class="setting-title">🔌 API & Streaming</h3>
          <label class="setting-row">
            <span>Auto-Fetch</span>
            <input type="checkbox" id="setAutoFetch" ${_settings.autoFetchEnabled?'checked':''} />
          </label>
          <label class="setting-row">
            <span>API URL</span>
            <input type="text" id="setApiUrl" class="setting-input" placeholder="https://api.example.com/configs"
                   value="${escAttr(_settings.autoFetchUrl)}" />
          </label>
          <label class="setting-row">
            <span>Fetch Interval (sec)</span>
            <input type="number" id="setFetchInterval" class="setting-input" min="10" max="3600"
                   value="${_settings.autoFetchInterval}" />
          </label>
          <label class="setting-row">
            <span>Log Stream URL</span>
            <input type="text" id="setLogStreamUrl" class="setting-input" placeholder="https://api.example.com/logs/stream"
                   value="${escAttr(_settings.logStreamUrl)}" />
          </label>
        </div>

        <!-- ── General ── -->
        <div class="setting-group">
          <h3 class="setting-title">⚙️ General</h3>
          <label class="setting-row">
            <span>Page Size</span>
            <select id="setPageSize" class="setting-input">
              ${[10,25,50,100].map(n => `<option value="${n}" ${n===_settings.pageSize?'selected':''}>${n} rows</option>`).join('')}
            </select>
          </label>
          <label class="setting-row">
            <span>Log Level</span>
            <select id="setLogLevel" class="setting-input">
              <option value="debug" ${_settings.logLevel==='debug'?'selected':''}>Debug (all)</option>
              <option value="info" ${_settings.logLevel==='info'?'selected':''}>Info</option>
              <option value="warn" ${_settings.logLevel==='warn'?'selected':''}>Warning</option>
              <option value="error" ${_settings.logLevel==='error'?'selected':''}>Error only</option>
            </select>
          </label>
          <label class="setting-row">
            <span>Collapse Sidebar</span>
            <input type="checkbox" id="setSidebarCollapse" ${_settings.sidebarCollapsed?'checked':''} />
          </label>
        </div>

        <!-- ── Storage & Data ── -->
        <div class="setting-group">
          <h3 class="setting-title">💾 Storage & Data</h3>
          <div style="font-size:.62rem;color:var(--text3);margin-bottom:8px;line-height:1.6">
            Manage data stored in this browser
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button type="button" id="btnExportAllData" class="btn btn-xs btn-ghost" style="width:100%;justify-content:flex-start">
              📤 Export all configs
            </button>
            <button type="button" id="btnExportSettings" class="btn btn-xs btn-ghost" style="width:100%;justify-content:flex-start">
              📋 Export settings
            </button>
            <button type="button" id="btnImportSettings" class="btn btn-xs btn-ghost" style="width:100%;justify-content:flex-start">
              📥 Import settings
            </button>
            <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:2px 0">
            <button type="button" id="btnClearCache" class="btn btn-xs btn-ghost" style="width:100%;justify-content:flex-start;color:var(--yellow)">
              🗑 Clear IndexedDB cache
            </button>
            <button type="button" id="btnResetSettings" class="btn btn-xs btn-ghost" style="width:100%;justify-content:flex-start;color:var(--red)">
              ↺ Reset all settings
            </button>
          </div>
        </div>

        <!-- ── About ── -->
        <div class="setting-group">
          <h3 class="setting-title">ℹ️ About</h3>
          <div style="font-size:.62rem;color:var(--text3);line-height:2;font-family:var(--mono)">
            <div style="display:flex;justify-content:space-between"><span>Version</span><span style="color:var(--text)">v10 — ProxyHarvest</span></div>
            <div style="display:flex;justify-content:space-between"><span>Healer Engine</span><span style="color:var(--green)">⚡ Local — No API</span></div>
            <div style="display:flex;justify-content:space-between"><span>Storage</span><span style="color:var(--teal)">IndexedDB + localStorage</span></div>
            <div style="display:flex;justify-content:space-between"><span>Pattern Memory</span><span style="color:var(--green)">✓ Self-learning</span></div>
          </div>
        </div>

      </div>

      <div class="settings-actions">
        <button id="btnSaveSettings" class="btn-primary">💾 Save settings</button>
        <button id="btnResetSettingsMain" class="btn-secondary">↺ Reset Defaults</button>
        <button id="btnExportSettingsMain" class="btn-secondary">📤 Export</button>
        <button id="btnImportSettingsMain" class="btn-secondary">📥 Import</button>
      </div>
    `;

    bindSettingsEvents(container);
  }

  function bindSettingsEvents(container) {
    const $ = id => container.querySelector('#' + id);

    // Live preview font size
    const fsEl = $('setFontSize');
    const fsVal = $('setFontSizeVal');
    if (fsEl) fsEl.addEventListener('input', () => {
      if (fsVal) fsVal.textContent = fsEl.value + 'px';
    });

    // Test local heal engine
    const testHealBtn = $('btnTestHealEngine');
    if (testHealBtn) testHealBtn.addEventListener('click', () => {
      const resultEl = $('healEngineTestResult');
      try {
        const testCfg = { type:'vless', host:'test.example.com', port:80, security:'tls', score:5, live:false };
        const issues  = AI_HEALER.diagnose(testCfg);
        const fixes   = AI_HEALER.generateFixes(testCfg, issues);
        if (resultEl) resultEl.innerHTML = `<span style="color:var(--green)">✅ Engine active — ${issues.length} issues / ${fixes.length} fixes detected</span>`;
      } catch(e) {
        if (resultEl) resultEl.innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
      }
    });

    // Save
    const saveBtn = $('btnSaveSettings');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      _settings.theme = $('setTheme')?.value || 'dark';
      _settings.accentColor = $('setAccent')?.value || '#00e5ff';
      _settings.fontSize = parseInt($('setFontSize')?.value, 10) || 14;
      _settings.fontFamily = $('setFontFamily')?.value || "'JetBrains Mono', monospace";
      _settings.animationsEnabled = !!$('setAnimations')?.checked;
      _settings.scanlineEnabled = !!$('setScanline')?.checked;
      _settings.glassEnabled = !!$('setGlass')?.checked;
      _settings.autoFetchEnabled = !!$('setAutoFetch')?.checked;
      _settings.autoFetchUrl = $('setApiUrl')?.value || '';
      _settings.autoFetchInterval = parseInt($('setFetchInterval')?.value, 10) || 60;
      _settings.logStreamUrl = $('setLogStreamUrl')?.value || '';
      _settings.pageSize = parseInt($('setPageSize')?.value, 10) || 25;
      _settings.logLevel = $('setLogLevel')?.value || 'info';
      _settings.sidebarCollapsed = !!$('setSidebarCollapse')?.checked;
      // Local Healer Settings
      _settings.aiBatchSize = parseInt($('setAiBatchSize')?.value, 10) || 50;
      _settings.aiAutoApply = !!$('setAiAutoApply')?.checked;
      // Save clean IP/port for WireGuard healing
      const cleanIpVal = $('setCleanIp')?.value?.trim();
      const cleanPortVal = $('setCleanPort')?.value?.trim();
      if (cleanIpVal)   PH_STORAGE.set('cfg_clean_ip',   cleanIpVal);
      if (cleanPortVal) PH_STORAGE.set('cfg_clean_port', cleanPortVal);
      save();
      apply();
      toast('Settings saved ✓', 'ok');
      logConsole('success', 'Settings saved and applied');
    });

    // Reset (in storage section)
    const resetBtn = $('btnResetSettings');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      if (confirm('Reset all settings to defaults?')) {
        reset();
        renderSettingsPanel(container);
      }
    });

    // Reset (main actions bar)
    const resetBtnMain = $('btnResetSettingsMain');
    if (resetBtnMain) resetBtnMain.addEventListener('click', () => {
      if (confirm('Reset all settings to defaults?')) {
        reset();
        renderSettingsPanel(container);
      }
    });

    // Export Settings
    const doExport = () => {
      const exportData = { ..._settings };
      // No API keys to remove from export
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'proxyharvest_settings.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast('Settings exported ✓ (API key excluded)', 'ok');
    };
    const expBtn = $('btnExportSettings');
    if (expBtn) expBtn.addEventListener('click', doExport);
    const expBtnMain = $('btnExportSettingsMain');
    if (expBtnMain) expBtnMain.addEventListener('click', doExport);

    // Import Settings
    const doImport = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const imported = JSON.parse(reader.result);
            _settings = { ...DEFAULTS, ...imported };
            save();
            apply();
            renderSettingsPanel(container);
            toast('Settings imported ✓', 'ok');
            logConsole('success', 'Settings imported and applied');
          } catch (e) {
            toast('Import failed: invalid JSON', 'err');
            logConsole('error', 'Settings import failed: ' + e.message);
          }
        };
        reader.readAsText(file);
      });
      input.click();
    };
    const impBtn = $('btnImportSettings');
    if (impBtn) impBtn.addEventListener('click', doImport);
    const impBtnMain = $('btnImportSettingsMain');
    if (impBtnMain) impBtnMain.addEventListener('click', doImport);

    // Clear cache
    const clearCacheBtn = $('btnClearCache');
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', () => {
      if (confirm('Clear the IndexedDB cache? Stored configs will be removed.')) {
        if (typeof clearStorage === 'function') clearStorage();
        else {
          ['ph-settings-v8','ph-settings-v7','ph-settings-v5','ph-settings-v4','ph-sources-v8','ph-sources-v5','ph-sources-v4'].forEach(k=>PH_STORAGE.remove(k));
        }
        toast('Cache cleared ✓', 'ok');
      }
    });

    // Export all data
    const exportAllBtn = $('btnExportAllData');
    if (exportAllBtn) exportAllBtn.addEventListener('click', () => {
      try {
        const configs = window.S?.configs || window.__allConfigs || [];
        if (!configs.length) { toast('No configs available to export', 'warn'); return; }
        const blob = new Blob([JSON.stringify(configs, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `proxyharvest_configs_${Date.now()}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        toast(`${configs.length} configs exported ✓`, 'ok');
      } catch(e) { toast('Export failed: ' + e.message, 'err'); }
    });
  }

  return {
    load, save, get, set, reset, apply,
    renderSettingsPanel,
  };
})();


// ═══════════════════════════════════════════════════════════════
// ██  PH UX SPRINT — guided UX layer, status clarity, activity hub
// ═══════════════════════════════════════════════════════════════
const PH_UX = (() => {
  const LS_ONBOARD = 'ph-ux-onboarding-dismissed-v1';
  const state = { lastEvent: 'Ready', lastType: 'info', installed:false };

  const esc = (s) => (typeof escHtml === 'function' ? escHtml(s) : String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  const attr = (s) => (typeof escAttr === 'function' ? escAttr(s) : esc(String(s ?? '')));
  const byId = (id) => document.getElementById(id);
  const configs = () => Array.isArray(S?.configs) ? S.configs : [];
  const isVerified = (cfg) => typeof verificationPass === 'function' ? verificationPass(cfg) : !!(cfg?.probe?.tunnelVerified || cfg?.probe?.protocolVerified);

  function statusMeta(cfg) {
    const p = cfg?.probe || {};
    const evidence = Array.isArray(p.evidence) ? p.evidence.filter(Boolean) : [];
    if (p.tunnelVerified === true) return { key:'live', short:'LIVE', label:'Verified Live', desc:'End-to-end tunnel verified', confidence:'high', icon:'✓', tone:'green', evidence };
    if (p.protocolVerified === true) return { key:'proto', short:'PROTO', label:'Handshake OK', desc:'Protocol handshake verified', confidence:p.confidence || 'high', icon:'✓', tone:'green', evidence };
    if (p.bridgeReachable === true) return { key:'bridge', short:'BRIDGE', label:'Bridge Reachable', desc:'Local bridge confirmed real reachability; tunnel not yet verified', confidence:p.confidence || 'medium', icon:'↯', tone:'cyan', evidence };
    if (p.workerReachable === true) return { key:'reachable', short:'REACH', label:'Worker Reachable', desc:'Worker reached the endpoint; tunnel not verified', confidence:p.confidence || 'medium', icon:'◇', tone:'cyan', evidence };
    if (p.browserReachable === true || cfg?.reachable === true) return { key:'probe', short:'PROBE', label:'Browser Probe', desc:'Only the browser probe succeeded; low confidence', confidence:p.confidence || 'low', icon:'◌', tone:'yellow', evidence };
    if (cfg?.live === false || p.bridgeReachable === false || p.workerReachable === false || p.browserReachable === false) return { key:'dead', short:'DEAD', label:'Dead / Failed', desc:'Network test or verification failed', confidence:p.confidence || 'medium', icon:'×', tone:'red', evidence };
    return { key:'unknown', short:'UNTESTED', label:'Untested', desc:'Not tested yet or insufficient evidence', confidence:'none', icon:'?', tone:'gray', evidence };
  }

  function statusTooltip(cfg) {
    const p = cfg?.probe || {};
    const m = statusMeta(cfg);
    const parts = [m.label, m.desc];
    if (p.method) parts.push('method: ' + p.method);
    if (p.confidence) parts.push('confidence: ' + p.confidence);
    if (p.dns) parts.push('dns: ' + p.dns);
    if (typeof p.latencyMs === 'number') parts.push('latency: ' + p.latencyMs + 'ms');
    if (m.evidence.length) parts.push('evidence: ' + m.evidence.slice(0,3).join(' · '));
    return parts.join('\n');
  }

  function badgeHtml(cfg, compact=false) {
    const m = statusMeta(cfg);
    const p = cfg?.probe || {};
    const bits = [];
    if (p.method) bits.push(`<span class="ph-method">${esc(String(p.method).replace(/^bridge-verify-config$/, 'bridge verify').replace(/^bridge-real-ping$/, 'real ping'))}</span>`);
    if (p.confidence && p.confidence !== 'none') bits.push(`<span class="ph-conf ph-conf-${esc(p.confidence)}">${esc(p.confidence)}</span>`);
    if (p.dns && p.dns !== 'unknown') bits.push(`<span class="ph-dns ph-dns-${esc(p.dns)}">DNS ${esc(String(p.dns).toUpperCase())}</span>`);
    return `<span class="ph-vbadge ph-v-${m.key}${compact?' ph-v-compact':''}" title="${attr(statusTooltip(cfg))}" aria-label="${attr(m.label + ': ' + m.desc)}"><span class="ph-v-dot">${esc(m.icon)}</span><span class="ph-v-label">${esc(compact ? m.short : m.label)}</span></span>${compact?'':`<span class="ph-vbits">${bits.join('')}</span>`}`;
  }

  function evidenceHtml(cfg) {
    const m = statusMeta(cfg);
    const p = cfg?.probe || {};
    const latency = typeof p.latencyMs === 'number' ? `${p.latencyMs}ms` : (cfg?.latency != null && cfg.latency < 9999 ? `${cfg.latency}ms` : '—');
    const method = p.method || cfg?.testMethod || 'not tested';
    return `<div class="ph-row-evidence" title="${attr(statusTooltip(cfg))}">
      <span>${esc(m.desc)}</span>
      <span>Method: ${esc(method)}</span>
      <span>Latency: ${esc(latency)}</span>
    </div>`;
  }

  function counts() {
    const arr = configs();
    return arr.reduce((a,c) => { a.total++; a[statusMeta(c).key] = (a[statusMeta(c).key] || 0) + 1; if (isVerified(c)) a.verified++; if (c.reachable && !isVerified(c)) a.reachable++; return a; }, { total:0, verified:0, reachable:0, live:0, proto:0, bridge:0, dead:0, unknown:0, probe:0 });
  }

  function ensureOnboarding() {
    const dash = byId('tab-dashboard');
    if (!dash || byId('phOnboarding')) return;
    const dismissed = PH_STORAGE.get(LS_ONBOARD) === '1';
    const el = document.createElement('section');
    el.id = 'phOnboarding';
    el.className = dismissed ? 'ph-onboarding ph-onboarding-collapsed' : 'ph-onboarding';
    el.innerHTML = `
      <div class="ph-onboard-head">
        <div><b>Start clean: Fetch → Verify → Heal → Export</b><span>All features remain available; this guide only clarifies the recommended workflow.</span></div>
        <button class="btn btn-xs btn-ghost" data-ux-action="toggle-onboarding">${dismissed ? 'Show Guide' : 'Hide Guide'}</button>
      </div>
      <div class="ph-onboard-grid">
        <button class="ph-step-card" data-ux-action="fetch-all"><span>1</span><b>Harvest configs</b><small>Fetch configs from Sources and cache them.</small></button>
        <button class="ph-step-card" data-ux-action="open-configs"><span>2</span><b>Review status</b><small>LIVE is distinct from REACHABLE and UNTESTED.</small></button>
        <button class="ph-step-card" data-ux-action="open-settings"><span>3</span><b>Enable real ping</b><small>Connect the local Bridge for real verification.</small></button>
        <button class="ph-step-card" data-ux-action="export-live"><span>4</span><b>Export verified</b><small>Export verified configs only.</small></button>
      </div>`;
    const anchor = dash.querySelector('.dash') || dash.firstElementChild;
    if (anchor) dash.insertBefore(el, anchor); else dash.appendChild(el);
  }

  function ensureStatusOverview() {
    const cfgTab = byId('tab-configs');
    if (!cfgTab || byId('phStatusOverview')) return;
    const el = document.createElement('section');
    el.id = 'phStatusOverview';
    el.className = 'ph-status-overview';
    el.innerHTML = `
      <div class="ph-status-title"><b>Verification status</b><span>LIVE means verified; REACHABLE only confirms reachability.</span></div>
      <div class="ph-status-cards" id="phStatusCards"></div>
      <div class="ph-status-legend">
        <span class="ph-vbadge ph-v-live"><span class="ph-v-dot">✓</span><span class="ph-v-label">Verified Live</span></span>
        <span class="ph-vbadge ph-v-bridge"><span class="ph-v-dot">↯</span><span class="ph-v-label">Bridge Reachable</span></span>
        <span class="ph-vbadge ph-v-probe"><span class="ph-v-dot">◌</span><span class="ph-v-label">Browser Probe</span></span>
        <span class="ph-vbadge ph-v-unknown"><span class="ph-v-dot">?</span><span class="ph-v-label">Untested</span></span>
        <span class="ph-vbadge ph-v-dead"><span class="ph-v-dot">×</span><span class="ph-v-label">Dead</span></span>
      </div>`;
    const toolbar = cfgTab.querySelector('.cfgs-action-bar') || cfgTab.firstElementChild;
    if (toolbar && toolbar.parentNode) toolbar.parentNode.insertBefore(el, toolbar.nextSibling); else cfgTab.insertBefore(el, cfgTab.firstChild);
  }

  function renderStatusOverview() {
    const cards = byId('phStatusCards');
    if (!cards) return;
    const c = counts();
    cards.innerHTML = [
      ['Verified', c.verified, 'Eligible for Live Only export', 'live'],
      ['Reachable', c.reachable + (c.bridge||0), 'Endpoint reached; tunnel not verified', 'bridge'],
      ['Untested', c.unknown || 0, 'No verification evidence yet', 'unknown'],
      ['Failed', c.dead || 0, 'Needs healing or removal', 'dead'],
    ].map(([label, value, sub, key]) => `<div class="ph-status-card ph-card-${key}"><strong>${value}</strong><span>${label}</span><small>${sub}</small></div>`).join('');
  }

  function ensureActivityDock() {
    if (byId('phActivityDock')) return;
    const dock = document.createElement('aside');
    dock.id = 'phActivityDock';
    dock.className = 'ph-activity-dock';
    dock.innerHTML = `
      <button class="ph-activity-toggle" data-ux-action="toggle-activity" aria-label="Toggle activity center">Activity</button>
      <div class="ph-activity-body">
        <div class="ph-activity-head"><b>Activity Center</b><span id="phActivityNow">Ready</span></div>
        <div class="ph-activity-grid">
          <div><small>App</small><b id="phActApp">Idle</b></div>
          <div><small>Progress</small><b id="phActProgress">0 / 0</b></div>
          <div><small>Database</small><b id="phActDb">Checking</b></div>
          <div><small>Bridge</small><b id="phActBridge">Unknown</b></div>
        </div>
        <div class="ph-activity-last" id="phActivityLast">No recent events</div>
      </div>`;
    document.body.appendChild(dock);
  }

  function updateActivity(msg, type='info') {
    state.lastEvent = String(msg || 'Ready');
    state.lastType = type || 'info';
    const now = byId('phActivityNow');
    const last = byId('phActivityLast');
    if (now) now.textContent = state.lastEvent.slice(0, 80);
    if (last) { last.textContent = state.lastEvent; last.className = 'ph-activity-last ph-last-' + String(state.lastType).replace(/[^a-z0-9_-]/gi,''); }
    syncActivity();
  }

  const PH_MUTATION_STABILITY_V40 = '40.0.0';
  function syncActivity() {
    const app = byId('phActApp');
    const prog = byId('phActProgress');
    const db = byId('phActDb');
    const bridge = byId('phActBridge');
    const setMirror = (el, value) => {
      if (!el) return false;
      const next = String(value ?? '');
      if (el.textContent === next) return false;
      el.textContent = next;
      return true;
    };
    setMirror(app, byId('statusText')?.textContent || (S?.fetchRunning ? 'Fetching' : 'Idle'));
    setMirror(prog, byId('progCount')?.textContent || byId('realTestStatus')?.textContent || '0 / 0');
    setMirror(db, (byId('dbStatusText')?.textContent || 'Unknown').replace(/^IndexedDB:\s*/, '').slice(0, 42));
    if (bridge) {
      const b = (byId('localBridgeUrl')?.value || PH_STORAGE.get('ph_real_ping_bridge') || '').trim();
      setMirror(bridge, b ? (String(b).includes('127.0.0.1') ? 'Local 8787' : 'Configured') : 'Optional');
    }
  }

  function decorateButtons() {
    document.querySelectorAll('.cfg-row-actions .btn, .compact-card-actions .btn').forEach(btn => {
      const label = btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent.trim() || 'Action';
      btn.setAttribute('aria-label', label);
      btn.dataset.label = label.replace(' to Proxy','').replace(' URI','').replace(' Code','');
    });
    document.querySelectorAll('.cfg-act-btn2[data-tip]').forEach(btn => {
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', btn.textContent.trim() || btn.dataset.tip || 'Action');
    });
  }

  function enhanceSettings() {
    const settings = byId('settingsContent');
    if (!settings) return;
    if (!byId('phSettingsGuide')) {
      const guide = document.createElement('div');
      guide.id = 'phSettingsGuide';
      guide.className = 'ph-settings-guide';
      guide.innerHTML = `
        <div><b>Recommended setup</b><span>For the recommended setup, focus on fetch limits, Strict Real Ping, and Local Bridge. Everything else is advanced.</span></div>
        <div class="ph-settings-quick">
          <button class="btn btn-xs btn-cyan" data-ux-action="open-bridge-readme">Bridge guide</button>
          <button class="btn btn-xs btn-green" data-ux-action="detect-bridge">Detect Bridge</button>
          <button class="btn btn-xs btn-ghost" data-ux-action="mark-advanced">Mark advanced fields</button>
        </div>`;
      settings.insertBefore(guide, settings.firstElementChild);
    }
    const help = {
      'cfg-maxperSource':'Maximum configs imported per source. Reduce this if the UI becomes slow.',
      'cfg-maxConfigs':'Total session/cache cap. Very high values can slow weaker systems.',
      'cfg-scoreThreshold':'Filters display/export only; configs are not deleted.',
      'cfg-scoreThresholdSettings':'Same score threshold, exposed in Settings.',
      'exportMode':'Top N is faster; Filtered provides more precise export control.',
      'cfg-dedup':'Removes obvious duplicates. Disable it if you need every raw entry.',
      'cfg-dohEnabled':'DNS is supporting evidence; DNS UNKNOWN must not imply LIVE.',
      'cfg-timeout':'Timeout for each fetch/test attempt. Increase it on weak networks, at the cost of slower feedback.',
      'cfg-autoInterval':'Zero disables auto refresh. Avoid short intervals for large source sets.',
      'localBridgeUrl':'Run the local bridge on 127.0.0.1:8787 for real ping verification.',
      'cfg-worker-url':'Optional gateway for fetch/probe when direct GitHub or CORS is unavailable.',
      'cfg-worker-subtoken':'Optional; only needed if your Worker requires authentication.',
      'cfg-worker-apitoken':'Advanced and optional; not required for normal UI use.',
      'cfg-clean-ip':'Used for WARP/WireGuard healing candidates.',
      'cfg-clean-port':'Fallback clean-IP port used during healing.',
      'cfg-reality-pubkey':'Used only for Reality scoring/heuristics; not a secret field.',
      'cfg-custom-cors':'Optional fallback; public proxies have privacy risks.',
      'cfg-mirror-base':'Custom mirror for environments where GitHub raw is restricted.'
    };
    Object.entries(help).forEach(([id, text]) => {
      const input = byId(id);
      if (!input) return;
      const item = input.closest('.setting-item,.infra-field') || input.parentElement;
      if (!item || item.querySelector('.ph-field-help')) return;
      const div = document.createElement('div');
      div.className = 'ph-field-help';
      div.textContent = text;
      item.appendChild(div);
      if (/token|cors|mirror|reality|clean|worker/i.test(id)) item.classList.add('ph-advanced-field');
    });
  }

  function enhanceEmptyStates() {
    const cfgEmpty = byId('cfgsEmpty');
    if (cfgEmpty && !cfgEmpty.querySelector('[data-ux-empty="configs"]')) {
      cfgEmpty.innerHTML = `<div data-ux-empty="configs" class="ph-empty-action">
        <div class="empty-icon">◇</div><b>No configs yet</b>
        <span>Fetch a source or add a config manually. Statuses will then separate Verified, Reachable, and Untested.</span>
        <div class="ph-empty-actions"><button class="btn btn-sm btn-primary" data-ux-action="fetch-all">Fetch All</button><button class="btn btn-sm btn-cyan" data-ux-action="add-manual">Add Manual</button><button class="btn btn-sm btn-ghost" data-ux-action="open-sources">Sources</button></div>
      </div>`;
    }
    const srcLog = byId('srcLog');
    const srcEmpty = srcLog?.querySelector('.empty');
    if (srcEmpty && !srcEmpty.querySelector('[data-ux-empty="sourcefeed"]')) {
      srcEmpty.innerHTML = `<div data-ux-empty="sourcefeed" class="ph-empty-action"><div class="empty-icon">↯</div><b>Ready to fetch</b><span>Run Fetch All to begin; each source result will stream here.</span><button class="btn btn-sm btn-primary" data-ux-action="fetch-all">Fetch All</button></div>`;
    }
  }

  function patchRenderers() {
    if (typeof verificationLabel === 'function' && !verificationLabel.__phUx) {
      const uxLabel = function(cfg) {
        const m = statusMeta(cfg);
        const cls = m.key === 'live' || m.key === 'proto' ? 'conn-live' : m.key === 'dead' ? 'conn-dead' : m.key === 'unknown' ? 'conn-unknown' : 'conn-reachable';
        return { cls, text:m.short, title:statusTooltip(cfg), ux:m };
      };
      uxLabel.__phUx = true;
      verificationLabel = uxLabel;
    }

    if (typeof renderTableRow === 'function' && !renderTableRow.__phUx) {
      const prev = renderTableRow;
      renderTableRow = function uxRenderTableRow(cfg, i, idx) {
        let html = prev(cfg, i, idx);
        html = html.replace(/<span class="conn-badge [^"]+"[^>]*>.*?<\/span>/, badgeHtml(cfg));
        html = html.replace(/(<td class="host-cell"[^>]*>)([\s\S]*?)(<\/td>\s*<td class="port-cell">)/, `$1<div class="ph-host-stack">$2</div>${evidenceHtml(cfg)}$3`);
        return html;
      };
      renderTableRow.__phUx = true;
    }

    if (typeof renderTable === 'function' && !renderTable.__phUx) {
      const prev = renderTable;
      renderTable = function uxRenderTable() {
        const out = prev.apply(this, arguments);
        renderStatusOverview();
        decorateButtons();
        enhanceEmptyStates();
        syncActivity();
        return out;
      };
      renderTable.__phUx = true;
    }

    if (typeof renderCompactGrid === 'function' && !renderCompactGrid.__phUx) {
      const prev = renderCompactGrid;
      renderCompactGrid = function uxRenderCompactGrid() {
        const out = prev.apply(this, arguments);
        document.querySelectorAll('.compact-card .conn-badge').forEach((el, n) => {
          const cfg = getFilteredConfigs()[n];
          if (cfg) el.outerHTML = badgeHtml(cfg, true);
        });
        decorateButtons();
        return out;
      };
      renderCompactGrid.__phUx = true;
    }

    if (typeof renderWgPanel === 'function' && !renderWgPanel.__phUx) {
      const prev = renderWgPanel;
      renderWgPanel = function uxRenderWgPanel() {
        const out = prev.apply(this, arguments);
        document.querySelectorAll('.wg-card').forEach(card => {
          if (card.querySelector('.ph-wg-status-detail')) return;
          const idx = Number((card.id || '').replace('wgcard-',''));
          const cfg = configs()[idx];
          if (!cfg) return;
          const detail = document.createElement('div');
          detail.className = 'ph-wg-status-detail';
          detail.innerHTML = badgeHtml(cfg) + evidenceHtml(cfg);
          const hdr = card.querySelector('.wg-card-hdr');
          if (hdr) hdr.insertAdjacentElement('afterend', detail);
        });
        decorateButtons();
        return out;
      };
      renderWgPanel.__phUx = true;
    }
  }

  function patchFeedback() {
    if (typeof toast === 'function' && !toast.__phUx) {
      const prev = toast;
      toast = function uxToast(msg, type) { updateActivity(msg, type || 'info'); return prev.apply(this, arguments); };
      toast.__phUx = true;
    }
    if (typeof logConsole === 'function' && !logConsole.__phUx) {
      const prev = logConsole;
      logConsole = function uxLogConsole(level, msg) { updateActivity(msg, level || 'info'); return prev.apply(this, arguments); };
      logConsole.__phUx = true;
    }
    if (typeof setStatus === 'function' && !setStatus.__phUx) {
      const prev = setStatus;
      setStatus = function uxSetStatus(state, text) { const out = prev.apply(this, arguments); updateActivity(text || state, state || 'info'); return out; };
      setStatus.__phUx = true;
    }
  }

  function bindActions() {
    if (document.__phUxActions) return;
    document.__phUxActions = true;
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-ux-action]');
      if (!el) return;
      const action = el.dataset.uxAction;
      if (action === 'toggle-onboarding') {
        const box = byId('phOnboarding');
        const collapsed = !box?.classList.contains('ph-onboarding-collapsed');
        box?.classList.toggle('ph-onboarding-collapsed', collapsed);
        PH_STORAGE.set(LS_ONBOARD, collapsed ? '1' : '0');
        el.textContent = collapsed ? 'Show Guide' : 'Hide Guide';
      } else if (action === 'toggle-activity') {
        byId('phActivityDock')?.classList.toggle('ph-activity-open');
      } else if (action === 'fetch-all') {
        if (typeof masterFetch === 'function') masterFetch();
      } else if (action === 'open-configs') {
        if (typeof showTab === 'function') showTab('configs');
      } else if (action === 'open-sources') {
        if (typeof showTab === 'function') showTab('sources');
      } else if (action === 'open-settings') {
        if (typeof showTab === 'function') showTab('settings'); setTimeout(enhanceSettings, 50);
      } else if (action === 'add-manual') {
        if (typeof addManualConfig === 'function') addManualConfig();
      } else if (action === 'export-live') {
        if (typeof showTab === 'function') showTab('configs');
        const btn = byId('cfgExportLiveBtn'); if (btn) btn.click();
      } else if (action === 'detect-bridge') {
        if (typeof detectLocalBridge === 'function') detectLocalBridge();
      } else if (action === 'open-bridge-readme') {
        toast('Run: node proxyharvest-bridge.js, then set bridge URL to http://127.0.0.1:8787', 'info');
      } else if (action === 'mark-advanced') {
        document.body.classList.toggle('ph-show-advanced-notes');
      }
    });
  }

  function autoCompactOnSmallScreens() {
    const mq = window.matchMedia('(max-width: 760px)');
    const apply = () => { if (mq.matches && typeof setConfigsView === 'function') setConfigsView('compact'); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
  }

  function observeActivityTargets() {
    const ids = ['progStatus','progCount','dbStatusText','tunnelStatusLabel','realTestStatus','realTestLive','splitnet-status'];
    ids.forEach(id => {
      const el = byId(id); if (!el || el.__phUxObs) return;
      el.__phUxObs = true;
      new MutationObserver(syncActivity).observe(el, { childList:true, characterData:true, subtree:true });
    });
    setInterval(syncActivity, 2000);
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    const premiumShell = document.body?.dataset?.premiumShell === '1';
    if (!premiumShell) ensureOnboarding();
    ensureStatusOverview();
    if (!premiumShell) ensureActivityDock();
    enhanceSettings();
    enhanceEmptyStates();
    patchRenderers();
    patchFeedback();
    bindActions();
    autoCompactOnSmallScreens();
    observeActivityTargets();
    renderStatusOverview();
    decorateButtons();
    syncActivity();
    window.PH_UX = { refresh, statusMeta, badgeHtml, counts, updateActivity };
  }

  function refresh() {
    const premiumShell = document.body?.dataset?.premiumShell === '1';
    if (!premiumShell) ensureOnboarding();
    ensureStatusOverview();
    if (!premiumShell) ensureActivityDock();
    enhanceSettings(); enhanceEmptyStates(); renderStatusOverview(); decorateButtons(); syncActivity();
  }

  return { install, refresh, statusMeta, badgeHtml, counts, updateActivity };
})();
PH_UX.install();

// ═══════════════════════════════════════════════════════════════
// ██  INTEGRATION BOOTSTRAP — اتصال سیستم‌ها به هم
// ═══════════════════════════════════════════════════════════════
(function bootstrapInjectedSystems() {
  // Global config store
  window.__allConfigs = window.__allConfigs || [];

  // 1) Load & apply theme
  ThemeEngine.load();
  ThemeEngine.apply();

  // 2) Hook into existing init if available
  const _origInit = typeof init === 'function' ? init : null;
  window.init = function() {
    if (_origInit) _origInit.apply(this, arguments);

    // Apply saved settings
    const s = ThemeEngine.get();

    // Start auto-fetch if enabled
    if (s.autoFetchEnabled && s.autoFetchUrl) {
      LiveEngine.setApiBase(s.autoFetchUrl);
      LiveEngine.startAutoFetch(s.autoFetchUrl, (s.autoFetchInterval || 60) * 1000, (data) => {
        data.forEach((c, i) => { if (!c.uid) c.uid = i + 1; });
        window.__allConfigs = data;
        SortableTable.render(data);
        LiveEngine.updateStats(data);
      });
    }

    // Start log stream if configured
    if (s.logStreamUrl) {
      LiveEngine.startLogStream(s.logStreamUrl);
    }

    // Start stats refresh
    LiveEngine.startStatsRefresh(() => window.__allConfigs, (s.autoFetchInterval || 5) * 1000);

    logConsole('success', 'Injected systems initialized: SortableTable, LiveEngine, ThemeEngine');
  };

  // 3) Hook into existing wireEvents if available
  const _origWire = typeof wireEvents === 'function' ? wireEvents : null;
  window.wireEvents = function() {
    if (_origWire) _origWire.apply(this, arguments);

    // Settings tab render
    const settingsTab = document.querySelector('[data-tab="settings"]');
    if (settingsTab) {
      settingsTab.addEventListener('click', () => {
        setTimeout(() => ThemeEngine.renderSettingsPanel(), 100);
      });
    }

    // Configs tab: re-render table when switching to it
    const cfgsTab = document.querySelector('[data-tab="configs"]');
    if (cfgsTab) {
      cfgsTab.addEventListener('click', () => {
        setTimeout(() => {
          if (window.__allConfigs.length) {
            SortableTable.render(window.__allConfigs);
          }
        }, 100);
      });
    }

    logConsole('info', 'Injected event bindings wired');
  };

  // 4) init() has already been called above this block.
  //    Do NOT call it again here — that would cause a double-init.
  //    The LiveEngine, SortableTable, and ThemeEngine are all
  //    available in scope already. Just apply the theme.
  ThemeEngine.apply();
})();
}); // end DOMContentLoaded
