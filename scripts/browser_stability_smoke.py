#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import socket
import sys
import time
import urllib.request

import websocket

CDP = os.environ.get("PH_CDP", "http://127.0.0.1:9222")
APP = os.environ.get("PH_APP", "http://127.0.0.1:4173/")


def http_json(url: str, method: str = "GET"):
    req = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(req, timeout=5) as res:
        return json.load(res)


def wait_cdp() -> None:
    last = None
    for _ in range(50):
        try:
            http_json(CDP + "/json/version")
            return
        except Exception as exc:
            last = exc
            time.sleep(0.1)
    raise RuntimeError(f"CDP did not start: {last}")


def main() -> int:
    wait_cdp()
    target = http_json(CDP + "/json/new?" + urllib.parse.quote(APP, safe=":/?=&"), method="PUT")
    ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=12, origin="http://127.0.0.1:9222")
    seq = 0

    def call(method: str, params=None, timeout: float = 12.0):
        nonlocal seq
        seq += 1
        msg_id = seq
        ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            ws.settimeout(max(0.1, deadline - time.time()))
            raw = ws.recv()
            data = json.loads(raw)
            if data.get("id") == msg_id:
                if "error" in data:
                    raise RuntimeError(f"CDP {method} failed: {data['error']}")
                return data.get("result", {})
        raise TimeoutError(f"CDP timeout waiting for {method}")

    call("Runtime.enable")
    call("Page.enable")
    call("Page.navigate", {"url": APP})
    time.sleep(1.0)

    expr = r"""
new Promise(resolve => {
  let records = 0;
  let changedNodes = 0;
  const started = performance.now();
  let ticks = 0;
  const observer = new MutationObserver(batch => {
    records += batch.length;
    for (const r of batch) changedNodes += (r.addedNodes?.length || 0) + (r.removedNodes?.length || 0);
  });
  observer.observe(document.body, {subtree:true, childList:true, characterData:true});
  const beat = setInterval(() => ticks++, 100);
  setTimeout(() => {
    clearInterval(beat);
    observer.disconnect();
    resolve({
      readyState: document.readyState,
      runtimeBuild: window.PROXYHARVEST_V38?.BUILD || null,
      ticks,
      elapsedMs: performance.now() - started,
      mutationRecords: records,
      changedNodes,
      pipelinePresent: !!document.getElementById('phv27AutoPipeline'),
      bodyChildren: document.body?.children?.length || 0
    });
  }, 2500);
})
"""
    try:
        result = call(
            "Runtime.evaluate",
            {"expression": expr, "awaitPromise": True, "returnByValue": True},
            timeout=10.0,
        )
    except (TimeoutError, socket.timeout, websocket.WebSocketTimeoutException) as exc:
        print(f"FAIL browser-stability: renderer/event-loop starvation: {exc}", file=sys.stderr)
        return 1
    finally:
        try:
            ws.close()
        except Exception:
            pass

    value = result.get("result", {}).get("value", {})
    print(json.dumps(value, indent=2, sort_keys=True))
    if value.get("readyState") != "complete":
        raise AssertionError(f"document did not reach complete: {value}")
    if value.get("runtimeBuild") != "38.2.0-smart-runtime-stability":
        raise AssertionError(f"unexpected runtime build: {value.get('runtimeBuild')}")
    if int(value.get("ticks") or 0) < 18:
        raise AssertionError(f"event loop was starved: only {value.get('ticks')} heartbeats in 2.5s")
    if float(value.get("elapsedMs") or 0) > 6000:
        raise AssertionError(f"2.5s timer took too long: {value.get('elapsedMs')}ms")
    if int(value.get("mutationRecords") or 0) > 600:
        raise AssertionError(f"mutation storm detected: {value.get('mutationRecords')} records")
    if int(value.get("changedNodes") or 0) > 1200:
        raise AssertionError(f"DOM churn too high: {value.get('changedNodes')} changed nodes")
    if not value.get("pipelinePresent"):
        raise AssertionError("runtime patches did not finish booting")
    print("PASS browser-stability: renderer responsive; no mutation feedback storm")
    return 0


if __name__ == "__main__":
    import urllib.parse
    raise SystemExit(main())
