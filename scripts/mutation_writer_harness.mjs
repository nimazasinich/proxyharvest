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
vc.on('jsdomError', () => {});
vc.on('error', () => {});

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
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
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

    const state = { enabled: false, writes: new Map(), currentTask: null, timers: [] };
    const sourceLines = () => String(new Error().stack || '').split('\n').slice(2, 30)
      .filter(line => /http:\/\/proxyharvest\.local\/(proxyharvest\.js|patches\/)/.test(line))
      .map(line => line.trim());
    const timerSource = () => {
      const lines = sourceLines();
      return { source: lines[0] || 'unknown-timer', stack: lines.slice(0, 8) };
    };
    const withTask = (task, fn, self, args) => {
      const prev = state.currentTask;
      state.currentTask = task;
      try { return fn.apply(self, args); }
      finally { state.currentTask = prev; }
    };

    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = function(fn, delay, ...args) {
      const meta = timerSource();
      const task = { kind: 'interval', delay: Number(delay) || 0, ...meta };
      state.timers.push(task);
      if (typeof fn !== 'function') return nativeSetInterval(fn, delay, ...args);
      return nativeSetInterval(function(...cbArgs) { return withTask(task, fn, this, cbArgs); }, delay, ...args);
    };
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = function(fn, delay, ...args) {
      const meta = timerSource();
      const task = { kind: 'timeout', delay: Number(delay) || 0, ...meta };
      state.timers.push(task);
      if (typeof fn !== 'function') return nativeSetTimeout(fn, delay, ...args);
      return nativeSetTimeout(function(...cbArgs) { return withTask(task, fn, this, cbArgs); }, delay, ...args);
    };
    if (typeof window.requestAnimationFrame === 'function') {
      const nativeRaf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function(fn) {
        const meta = timerSource();
        const task = { kind: 'raf', delay: 0, ...meta };
        state.timers.push(task);
        return nativeRaf(function(...cbArgs) { return withTask(task, fn, this, cbArgs); });
      };
    }

    const record = (kind, target, value) => {
      if (!state.enabled) return;
      const id = target?.id ? `#${target.id}` : target?.className ? `.${String(target.className).trim().replace(/\s+/g, '.')}` : target?.nodeName || 'unknown';
      const direct = sourceLines();
      const task = state.currentTask;
      const source = direct[0] || task?.source || 'unknown';
      const sourceStack = direct.length ? direct.slice(0, 8) : (task?.stack || []);
      const taskLabel = task ? `${task.kind}:${task.delay}:${task.source}` : 'direct';
      const key = `${kind}|${id}|${source}|${taskLabel}`;
      const item = state.writes.get(key) || { kind, target: id, source, sourceStack, task: taskLabel, count: 0, samples: [] };
      item.count += 1;
      if (item.samples.length < 3) item.samples.push(String(value ?? '').slice(0, 180));
      state.writes.set(key, item);
    };

    const textDesc = Object.getOwnPropertyDescriptor(window.Node.prototype, 'textContent');
    if (textDesc?.get && textDesc?.set) {
      Object.defineProperty(window.Node.prototype, 'textContent', {
        configurable: true,
        enumerable: textDesc.enumerable,
        get: textDesc.get,
        set(value) { record('textContent', this, value); return textDesc.set.call(this, value); }
      });
    }

    const htmlDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML');
    if (htmlDesc?.get && htmlDesc?.set) {
      Object.defineProperty(window.Element.prototype, 'innerHTML', {
        configurable: true,
        enumerable: htmlDesc.enumerable,
        get: htmlDesc.get,
        set(value) { record('innerHTML', this, value); return htmlDesc.set.call(this, value); }
      });
    }

    const nativeSetAttribute = window.Element.prototype.setAttribute;
    window.Element.prototype.setAttribute = function(name, value) {
      if (name === 'class' || name === 'data-status' || name === 'style') record(`setAttribute:${name}`, this, value);
      return nativeSetAttribute.call(this, name, value);
    };

    window.__PH_WRITER_HARNESS = state;
  }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
await new Promise(resolve => {
  if (dom.window.document.readyState === 'complete') return resolve();
  dom.window.addEventListener('load', resolve, { once: true });
  setTimeout(resolve, 5000);
});
await sleep(3500);
dom.window.__PH_WRITER_HARNESS.enabled = true;
await sleep(3500);
dom.window.__PH_WRITER_HARNESS.enabled = false;

const rows = [...dom.window.__PH_WRITER_HARNESS.writes.values()].sort((a, b) => b.count - a.count);
const suspicious = rows.filter(r => r.count >= 3);
const timers = dom.window.__PH_WRITER_HARNESS.timers
  .filter(t => /proxyharvest\.local/.test(t.source))
  .map(t => ({ kind: t.kind, delay: t.delay, source: t.source, stack: t.stack }));
console.log(JSON.stringify({
  idleWindowMs: 3500,
  totalWrites: rows.reduce((n, r) => n + r.count, 0),
  suspiciousWrites: suspicious.slice(0, 40),
  allTopWrites: rows.slice(0, 60),
  timerCreators: timers.slice(0, 80)
}, null, 2));
console.log('TRACE mutation-writer-harness complete');
dom.window.close();
