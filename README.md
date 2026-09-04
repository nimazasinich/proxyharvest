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

# ProxyHarvest V18

Readable multi-file rebuild of ProxyHarvest with the canonical Cloudflare fetch gateway, truthful verification semantics, and a real Hugging Face model advisor.

## Free-account AI architecture

The Space is designed for **Gradio ZeroGPU**, the Hugging Face compute option that eligible free personal accounts can host. The model is loaded directly from the Hub with Transformers and moved to the ZeroGPU CUDA environment at Space startup:

```python
from transformers import pipeline
pipe = pipeline("text-generation", model="Qwen/Qwen2.5-Coder-0.5B-Instruct", device=0)
```

The model function is decorated with `@spaces.GPU(duration=45)`. Model weights are not bundled in this repository and the user's browser never downloads them.

The deterministic Repair Engine creates bounded candidate fixes. Qwen may only select existing candidate IDs. Raw proxy URIs, UUIDs, passwords and WireGuard private keys are not sent to the model.

Model advice never counts as protocol/tunnel verification.
