export default async function handler(req, res) {
  const model = process.env.HF_MODEL || 'Qwen/Qwen2.5-Coder-0.5B-Instruct';
  const hasToken = Boolean(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    mode: hasToken ? 'huggingface-advisor' : 'rules-only',
    loaded: hasToken,
    model,
    endpoint: '/api/ai/advise',
    note: hasToken
      ? 'HF token configured; advisor can call the model. Output remains advisory only.'
      : 'HF token not configured in Vercel; deterministic repair rules still work.'
  });
}
