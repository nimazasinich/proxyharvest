function chooseDeterministic(item) {
  const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
  const safe = candidates
    .filter(c => c && c.id && c.id !== 'keep-original')
    .sort((a,b) => Number(b.rule_confidence || b.confidence || 0) - Number(a.rule_confidence || a.confidence || 0));
  const selected = safe.slice(0, 2).map(c => c.id);
  return {
    index: item?.index,
    decision: selected.length ? 'apply_candidate_then_verify' : 'manual_review',
    candidate_ids: selected,
    confidence: selected.length ? Math.min(88, Math.max(45, Number(safe[0]?.rule_confidence || 55))) : 35,
    reason: selected.length
      ? 'Deterministic rules found bounded repair candidates. Apply only resets verification; run Real Test/Worker probe afterwards.'
      : 'No bounded safe candidate was available; manual review is safer.'
  };
}

function stripUnsafe(text='') {
  return String(text)
    .replace(/[A-Za-z0-9_-]{20,}/g, '[token-redacted]')
    .slice(0, 5000);
}

async function askHuggingFace(payload, model, token) {
  const prompt = [
    'You are ProxyHarvest Repair Advisor. Return only JSON.',
    'Never invent credentials. Never mark a config verified. Choose candidate IDs only.',
    stripUnsafe(JSON.stringify(payload))
  ].join('\n\n');
  const r = await fetch(`https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 512, temperature: 0.1, return_full_text: false } })
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Hugging Face HTTP ${r.status}: ${text.slice(0,180)}`);
  return text;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'method-not-allowed' });
  const started = Date.now();
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const items = Array.isArray(body.items) ? body.items : [];
    const model = process.env.HF_MODEL || 'Qwen/Qwen2.5-Coder-0.5B-Instruct';
    const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '';
    const deterministic = items.map(chooseDeterministic);

    if (!token) {
      return res.status(200).json({ ok:true, mode:'rules-only', loaded:false, model, latency_ms:Date.now()-started, items:deterministic });
    }

    let model_text = '';
    try { model_text = await askHuggingFace({ items }, model, token); }
    catch (modelError) {
      return res.status(200).json({ ok:true, mode:'rules-fallback', loaded:false, model, latency_ms:Date.now()-started, warning:String(modelError?.message || modelError), items:deterministic });
    }

    return res.status(200).json({ ok:true, mode:'huggingface-advisor', loaded:true, model, latency_ms:Date.now()-started, items:deterministic, model_text });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
}
