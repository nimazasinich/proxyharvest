---
title: ProxyHarvest V18
emoji: 🛠️
colorFrom: indigo
colorTo: cyan
sdk: gradio
app_file: app.py
pinned: false
suggested_hardware: zero-a10g
models:
  - Qwen/Qwen2.5-Coder-0.5B-Instruct
---

# ProxyHarvest

ProxyHarvest is a multi-file rebuild focused on readable workspaces, canonical Cloudflare source transport, truthful verification semantics, and a bounded Hugging Face model advisor.

## Architecture

- **Frontend:** modular HTML/CSS/ES modules under `static/`
- **Source transport:** canonical Cloudflare Worker only by default
- **Repair Lab:** deterministic candidate generator + Qwen advisor
- **Model:** `Qwen/Qwen2.5-Coder-0.5B-Instruct`
- **HF runtime:** Gradio ZeroGPU via `@spaces.GPU`

The model is loaded directly from the Hugging Face Hub with `transformers.pipeline()`. Model weights are not committed to this repository and are not downloaded by the browser.

Model advice is never treated as protocol/tunnel verification. Raw proxy URIs, UUIDs, passwords, tokens and WireGuard private/preshared keys are excluded from the model payload.

## Local development

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Hugging Face Space

This repository is prepared for a Gradio ZeroGPU Space. `deploy_space.py` creates/updates `<hf-user>/ProxyHarvest-V18` when `HF_TOKEN` is available in the environment. The GitHub Actions workflow expects `HF_TOKEN` as a repository secret; no credential belongs in source control.

## Verification boundary

| Component | Fetch sources | Endpoint reachability | Proxy tunnel verification | WireGuard handshake |
|---|---:|---:|---:|---:|
| Cloudflare Worker | Yes | Yes | No | No |
| Qwen advisor | No | No | No | No |
| Real Test bridge/engine | Optional | Yes | Yes if protocol engine supports it | Yes with WG-capable engine |
