const DEFAULT_MODEL = 'Qwen/Qwen3-4B-Instruct-2507:fastest';
const ROUTER = 'https://router.huggingface.co/v1/chat/completions';
function chooseDeterministic(item) {
  const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
  const safe = candidates.filter(c=>c&&c.id&&c.id!=='keep-original').sort((a,b)=>Number(b.rule_confidence||b.confidence||0)-Number(a.rule_confidence||a.confidence||0));
  const selected=safe.slice(0,2).map(c=>c.id);
  return {index:item?.index,decision:selected.length?'apply_candidate_then_verify':'manual_review',candidate_ids:selected,confidence:selected.length?Math.min(88,Math.max(45,Number(safe[0]?.rule_confidence||55))):35,reason:selected.length?'Bounded deterministic candidates selected; verification is still required.':'No bounded safe candidate was available.'};
}
function redact(v){return String(v??'').replace(/hf_[A-Za-z0-9_-]+/g,'[HF_TOKEN_REDACTED]').replace(/[A-Za-z0-9+/=_-]{32,}/g,'[SECRET_REDACTED]').slice(0,12000)}
function safeModelItem(raw, item, fallback){
  const allowed=new Set((item?.candidates||[]).map(c=>c?.id).filter(Boolean));
  const ids=(Array.isArray(raw?.candidate_ids)?raw.candidate_ids:[]).filter(id=>allowed.has(id)&&id!=='keep-original').slice(0,2);
  if(!ids.length)return fallback;
  return {index:item?.index,decision:'apply_candidate_then_verify',candidate_ids:ids,confidence:Math.max(0,Math.min(95,Number(raw?.confidence||65))),reason:redact(raw?.reason||'HF advisor selected bounded candidate IDs; verification is still required.')};
}
function extractJson(text){
  const s=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(s)}catch{}
  const a=s.indexOf('{'),b=s.lastIndexOf('}'); if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1))}catch{}}
  return null;
}
async function askHF(items,model,token){
  const compact=items.map(it=>({index:it.index,issues:it.issues||[],type:it.type||'',security:it.security||'',network:it.network||'',score:it.score||0,candidates:(it.candidates||[]).map(c=>({id:c.id,summary:c.summary||c.label||'',rule_confidence:c.rule_confidence||c.confidence||0}))}));
  const prompt=`You are ProxyHarvest Repair Advisor. Choose only candidate IDs already provided. Never invent credentials, hosts, ports, keys, UUIDs, passwords, SNI, public keys, or verification. Return strict JSON: {"items":[{"index":number,"candidate_ids":["id"],"confidence":0-95,"reason":"short reason"}]}. Prefer the smallest reversible repair. A repair is never verification.\n\n${redact(JSON.stringify(compact))}`;
  const r=await fetch(ROUTER,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],max_tokens:700,temperature:0.1,stream:false})});
  const data=await r.json().catch(()=>({})); if(!r.ok)throw new Error(data?.error?.message||data?.error||`HF HTTP ${r.status}`);
  return {text:data?.choices?.[0]?.message?.content||'',provider:data?.provider||null};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store'); if(req.method!=='POST')return res.status(405).json({ok:false,error:'method-not-allowed'});
  const started=Date.now();
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}); const items=Array.isArray(body.items)?body.items.slice(0,50):[]; const model=process.env.HF_MODEL||DEFAULT_MODEL; const token=process.env.HF_TOKEN||process.env.HUGGINGFACE_TOKEN||''; const fallback=items.map(chooseDeterministic);
    if(!token)return res.status(200).json({ok:true,mode:'rules-only',configured:false,loaded:false,model,latency_ms:Date.now()-started,items:fallback});
    try{
      const out=await askHF(items,model,token); const parsed=extractJson(out.text); const byIndex=new Map((parsed?.items||[]).map(x=>[Number(x.index),x])); const advised=items.map((item,i)=>safeModelItem(byIndex.get(Number(item.index)),item,fallback[i]));
      return res.status(200).json({ok:true,mode:'huggingface-provider',configured:true,loaded:true,model,latency_ms:Date.now()-started,items:advised,model_used:true});
    }catch(e){return res.status(200).json({ok:true,mode:'rules-fallback',configured:true,loaded:false,model,latency_ms:Date.now()-started,warning:String(e?.message||e),items:fallback});}
  }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
}
