const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct:fastest';
const ROUTER = 'https://router.huggingface.co/v1/chat/completions';
export default async function handler(req, res) {
  const model = process.env.HF_MODEL || DEFAULT_MODEL;
  const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '';
  const deep = String(req.query?.deep || '') === '1';
  res.setHeader('Cache-Control', 'no-store');
  if (!token) return res.status(200).json({ ok:true, configured:false, loaded:false, mode:'rules-only', model, endpoint:'/api/ai/advise', note:'Set HF_TOKEN in Vercel Environment Variables. Browser token fields are not used for Hugging Face.' });
  if (!deep) return res.status(200).json({ ok:true, configured:true, loaded:false, mode:'configured', model, endpoint:'/api/ai/advise', note:'HF token configured. Use deep=1 or Check Model to perform a real inference health check.' });
  const started = Date.now();
  try {
    const r = await fetch(ROUTER,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:'Reply with exactly OK.'}],max_tokens:4,temperature:0,stream:false})});
    const data = await r.json().catch(()=>({}));
    if (!r.ok) return res.status(200).json({ok:true,configured:true,loaded:false,mode:'provider-error',model,latency_ms:Date.now()-started,warning:data?.error?.message||data?.error||`HF HTTP ${r.status}`});
    const text = data?.choices?.[0]?.message?.content || '';
    return res.status(200).json({ok:true,configured:true,loaded:true,mode:'huggingface-provider',model,latency_ms:Date.now()-started,provider_response:Boolean(text),endpoint:'/api/ai/advise'});
  } catch(e) {
    return res.status(200).json({ok:true,configured:true,loaded:false,mode:'provider-error',model,latency_ms:Date.now()-started,warning:String(e?.message||e)});
  }
}
