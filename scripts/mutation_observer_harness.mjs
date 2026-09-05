import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { webcrypto } from 'node:crypto';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');

class LocalLoader extends ResourceLoader {
  async fetch(url) {
    const u = new URL(url);
    if (u.hostname !== 'proxyharvest.local') return null;
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir)) return null;
    try { return await readFile(file); } catch { return null; }
  }
}

const vc = new VirtualConsole();
const jsErrors = [];
vc.on('jsdomError', e => jsErrors.push(String(e?.message || e)));
vc.on('error', e => jsErrors.push(String(e?.message || e)));

const dom = new JSDOM(html, {
  url: 'http://proxyharvest.local/',
  runScripts: 'dangerously',
  resources: new LocalLoader(),
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    try {
      Object.defineProperty(window, 'indexedDB', { value: indexedDB, configurable: true });
      Object.defineProperty(window, 'IDBKeyRange', { value: IDBKeyRange, configurable: true });
      Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
    } catch {}

    window.matchMedia = window.matchMedia || (() => ({
      matches: false, media: '', onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; }
    }));
    window.fetch = async () => ({
      ok: false, status: 503, statusText: 'Harness offline', headers: { get: () => null },
      json: async () => ({ ok: false, error: 'harness-offline' }), text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0), clone() { return this; }
    });
    window.URL.createObjectURL = () => 'blob:proxyharvest-harness';
    window.URL.revokeObjectURL = () => {};
    window.navigator.clipboard = { writeText: async () => {} };
    window.confirm = () => true;
    window.alert = () => {};
    window.open = () => null;

    try {
      window.localStorage.setItem('ph_auto_pipeline_enabled', '0');
      window.localStorage.setItem('ph_strict_real_ping', 'false');
    } catch {}

    const describe = node => {
      if (!node) return 'null';
      if (node.nodeType === 3) return '#text';
      if (node.id) return `#${node.id}`;
      const tag = String(node.tagName || node.nodeName || 'node').toLowerCase();
      const cls = typeof node.className === 'string' && node.className.trim()
        ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
      return `${tag}${cls}`;
    };
    const state = { observers: [], idleTracking: false };
    const NativeMutationObserver = window.MutationObserver;
    let nextId = 1;

    class InstrumentedMutationObserver {
      constructor(callback) {
        const rec = {
          id: nextId++, callbacks: 0, records: 0, changedNodes: 0, targets: [],
          signatures: new Map(),
          stack: String(new Error().stack || '').split('\n').slice(1, 8).join('\n')
        };
        state.observers.push(rec);
        this._rec = rec;
        this._native = new NativeMutationObserver(records => {
          rec.callbacks += 1;
          rec.records += records.length;
          for (const r of records) {
            rec.changedNodes += (r.addedNodes?.length || 0) + (r.removedNodes?.length || 0) + (r.type === 'characterData' ? 1 : 0);
            if (state.idleTracking) {
              const added = [...(r.addedNodes || [])].slice(0, 4).map(describe).join(',');
              const removed = [...(r.removedNodes || [])].slice(0, 4).map(describe).join(',');
              const sig = `${r.type}|${describe(r.target)}|attr=${r.attributeName || ''}|+${added}|-${removed}`;
              rec.signatures.set(sig, (rec.signatures.get(sig) || 0) + 1);
            }
          }
          callback(records, this);
        });
      }
      observe(target, options) {
        const name = describe(target);
        if (!this._rec.targets.includes(name)) this._rec.targets.push(name);
        return this._native.observe(target, options);
      }
      disconnect() { return this._native.disconnect(); }
      takeRecords() { return this._native.takeRecords(); }
    }

    window.MutationObserver = InstrumentedMutationObserver;
    window.__PH_MUTATION_HARNESS = state;
  }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await new Promise(resolve => {
  if (dom.window.document.readyState === 'complete') return resolve();
  dom.window.addEventListener('load', resolve, { once: true });
  setTimeout(resolve, 5000);
});

await sleep(3500);
const harness = dom.window.__PH_MUTATION_HARNESS;
const baseline = new Map(harness.observers.map(o => [o.id, { callbacks: o.callbacks, records: o.records, changedNodes: o.changedNodes }]));
harness.idleTracking = true;
await sleep(3500);
harness.idleTracking = false;

const rows = harness.observers.map(o => {
  const b = baseline.get(o.id) || { callbacks: 0, records: 0, changedNodes: 0 };
  const source = o.stack.split('\n').find(line => /proxyharvest\.js|patches\//.test(line))?.trim() || o.stack.split('\n')[0]?.trim() || 'unknown';
  const topMutations = [...o.signatures.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([signature, count]) => ({ count, signature }));
  return {
    id: o.id, source, targets: o.targets.join(','),
    callbacks: o.callbacks - b.callbacks,
    records: o.records - b.records,
    changedNodes: o.changedNodes - b.changedNodes,
    topMutations
  };
}).sort((a, b) => b.callbacks - a.callbacks || b.records - a.records);

const totalCallbacks = rows.reduce((n, r) => n + r.callbacks, 0);
const totalRecords = rows.reduce((n, r) => n + r.records, 0);
const maxCallbacks = rows.reduce((n, r) => Math.max(n, r.callbacks), 0);
const stormers = rows.filter(r => r.callbacks > 8 || r.records > 40);
const relevantErrors = jsErrors.filter(e => !/Could not load|harness-offline|Not implemented: navigation/i.test(e));

console.log(JSON.stringify({
  readyState: dom.window.document.readyState,
  observerCount: rows.length,
  idleWindowMs: 3500,
  totalCallbacks,
  totalRecords,
  maxCallbacks,
  observers: rows,
  jsErrors: relevantErrors.slice(0, 12)
}, null, 2));

if (stormers.length) {
  console.error('FAIL mutation-observer-harness: idle observer callback storm remains');
  process.exitCode = 1;
} else if (totalCallbacks > 40) {
  console.error('FAIL mutation-observer-harness: aggregate idle callbacks remain too high');
  process.exitCode = 1;
} else if (relevantErrors.length > 10) {
  console.error('FAIL mutation-observer-harness: excessive runtime errors');
  process.exitCode = 1;
} else {
  console.log('PASS mutation-observer-harness: no sustained idle MutationObserver loop');
}

dom.window.close();
