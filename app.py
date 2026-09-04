from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import gradio as gr
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

try:
    import spaces
except Exception:
    class _SpacesFallback:
        @staticmethod
        def GPU(*args, **kwargs):
            def deco(fn):
                return fn
            return deco
    spaces = _SpacesFallback()

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
MODEL_ID = os.environ.get("PH_MODEL_ID", "Qwen/Qwen2.5-Coder-0.5B-Instruct")
MAX_ITEMS = 5
MAX_CANDIDATES = 8
IS_HF_SPACE = bool(os.environ.get("SPACE_ID"))

SECRET_KEYS = re.compile(r"(?:raw|uri|uuid|password|private.?key|preshared|psk|token|secret|credential)", re.I)
ALLOWED_ITEM_KEYS = {
    "index", "protocol", "endpoint", "security", "network", "sni_present", "path_present", "score",
    "tested", "live", "latency_ms", "verification", "issues", "candidates",
}
ALLOWED_CANDIDATE_KEYS = {"id", "field", "value", "rule_confidence", "reason"}

MODEL_LOAD_ERROR: str | None = None
pipe = None
if IS_HF_SPACE:
    try:
        from transformers import pipeline
        # ZeroGPU docs recommend placing the model on CUDA at module load time.
        # HF provides CUDA emulation before @spaces.GPU acquires a real GPU.
        pipe = pipeline("text-generation", model=MODEL_ID, device=0)
    except Exception as exc:
        MODEL_LOAD_ERROR = f"{type(exc).__name__}: {exc}"


def _sanitize_scalar(value: Any, limit: int = 220) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:limit]


def sanitize_item(item: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in item.items():
        if key not in ALLOWED_ITEM_KEYS or SECRET_KEYS.search(key):
            continue
        if key == "candidates":
            arr = []
            for c in (value if isinstance(value, list) else [])[:MAX_CANDIDATES]:
                if not isinstance(c, dict):
                    continue
                safe = {k: _sanitize_scalar(v) for k, v in c.items() if k in ALLOWED_CANDIDATE_KEYS and not SECRET_KEYS.search(k)}
                if safe.get("id"):
                    arr.append(safe)
            clean[key] = arr
        elif key == "issues":
            clean[key] = [
                {k: _sanitize_scalar(v) for k, v in issue.items() if k in {"code", "severity", "text"}}
                for issue in (value if isinstance(value, list) else [])[:12] if isinstance(issue, dict)
            ]
        elif key == "verification" and isinstance(value, dict):
            clean[key] = {k: _sanitize_scalar(v) for k, v in value.items() if k in {"method", "protocol_verified", "tunnel_verified"}}
        else:
            clean[key] = _sanitize_scalar(value)
    return clean


def system_prompt() -> str:
    return (
        "You are ProxyHarvest Model Advisor, a conservative network configuration repair reviewer. "
        "ONLY choose candidate IDs already provided. Never invent host, port, SNI, path, UUID, password, credential, "
        "or WireGuard private/public/preshared keys. Do not claim reachability is protocol or tunnel verification. "
        "Prefer manual_review when evidence is insufficient. Return strict JSON only: "
        '{"items":[{"index":0,"decision":"apply_candidates|manual_review|no_change","candidate_ids":["id"],"confidence":0,"reason":"short reason"}]}.'
    )


def extract_generated_text(result: Any) -> str:
    generated = result[0].get("generated_text", "") if isinstance(result, list) and result else ""
    if isinstance(generated, list) and generated:
        last = generated[-1]
        if isinstance(last, dict):
            return str(last.get("content", ""))
    return str(generated)


def parse_json_output(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            raise ValueError("model returned non-JSON output")
        return json.loads(match.group(0))


def validate_output(model_obj: dict[str, Any], input_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_index = {int(x.get("index", -1)): x for x in input_items}
    out = []
    for item in model_obj.get("items", []) if isinstance(model_obj, dict) else []:
        if not isinstance(item, dict):
            continue
        try:
            idx = int(item.get("index"))
        except Exception:
            continue
        src = by_index.get(idx)
        if not src:
            continue
        allowed = {str(c.get("id")) for c in src.get("candidates", []) if c.get("id")}
        ids = [str(x) for x in (item.get("candidate_ids") or []) if str(x) in allowed]
        decision = str(item.get("decision", "manual_review"))
        if decision not in {"apply_candidates", "manual_review", "no_change"}:
            decision = "manual_review"
        if decision == "apply_candidates" and not ids:
            decision = "manual_review"
        try:
            confidence = max(0, min(100, int(float(item.get("confidence", 0) or 0))))
        except Exception:
            confidence = 0
        out.append({
            "index": idx,
            "decision": decision,
            "candidate_ids": ids,
            "confidence": confidence,
            "reason": str(item.get("reason", ""))[:240],
        })
    return out


@spaces.GPU(duration=45)
def advise_gpu(payload_json: str) -> str:
    started = time.perf_counter()
    if pipe is None:
        return json.dumps({"ok": False, "error": MODEL_LOAD_ERROR or "model is not loaded"})
    try:
        payload = json.loads(payload_json)
        raw_items = payload.get("items", []) if isinstance(payload, dict) else []
        clean_items = [sanitize_item(x) for x in raw_items[:MAX_ITEMS] if isinstance(x, dict)]
        if not clean_items:
            return json.dumps({"ok": False, "error": "no valid items"})
        messages = [
            {"role": "system", "content": system_prompt()},
            {"role": "user", "content": json.dumps({"task": "review_bounded_repair_candidates", "items": clean_items}, separators=(",", ":"))},
        ]
        result = pipe(messages, max_new_tokens=300, do_sample=False, return_full_text=False)
        parsed = parse_json_output(extract_generated_text(result))
        items = validate_output(parsed, clean_items)
        return json.dumps({
            "ok": True,
            "model": MODEL_ID,
            "mode": "transformers.pipeline + ZeroGPU",
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "items": items,
        })
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


# Hidden Gradio endpoint used by the custom frontend. Calling this endpoint routes
# model work through the ZeroGPU queue/quota system.
with gr.Blocks(title="ProxyHarvest Model Backend") as demo:
    gr.Markdown("ProxyHarvest model backend. Open the main app at the Space root.")
    payload_in = gr.Textbox(label="Payload JSON", visible=False)
    payload_out = gr.Textbox(label="Result JSON", visible=False)
    run_btn = gr.Button("Run advisor", visible=False)
    run_btn.click(fn=advise_gpu, inputs=payload_in, outputs=payload_out, api_name="advise")

app = FastAPI(title="ProxyHarvest V18", version="18.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/api/health")
def health():
    return {"ok": True, "service": "ProxyHarvest", "version": "18.0.0", "model": MODEL_ID}

@app.get("/api/ai/health")
def ai_health():
    return {
        "ok": MODEL_LOAD_ERROR is None,
        "model": MODEL_ID,
        "mode": "gradio-zerogpu-pipeline",
        "loaded": pipe is not None,
        "hardware": "ZeroGPU when hosted on eligible HF Space",
        "error": MODEL_LOAD_ERROR,
        "space": IS_HF_SPACE,
    }

app = gr.mount_gradio_app(app, demo, path="/gradio", ssr_mode=False)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
