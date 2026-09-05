from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding='utf-8')


def sub_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    rx = re.compile(pattern, flags)
    matches = list(rx.finditer(text))
    if len(matches) != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {len(matches)}')
    return rx.sub(lambda _m: replacement, text, count=1)


STABLE_HTML_HELPER = '''function htmlStructurallyEqual(el,next){
    if(el.innerHTML===next)return true;
    const tpl=document.createElement('template');
    tpl.innerHTML=next;
    const current=el.childNodes, wanted=tpl.content.childNodes;
    if(current.length!==wanted.length)return false;
    for(let i=0;i<current.length;i++)if(!current[i].isEqualNode(wanted[i]))return false;
    return true
  }'''


def patch_ui_v26() -> None:
    path = 'patches/ui-v26.js'
    s = read(path)
    marker = "const PH_V41_IDLE_STABILITY = '41.0.0';"
    if marker in s:
        return

    old = "  function setHtmlStable(el,value){if(!el)return false;const next=String(value??'');if(el.innerHTML===next)return false;el.innerHTML=next;return true}"
    new = """  const PH_V41_IDLE_STABILITY = '41.0.0';
  const phV41HtmlCache=new WeakMap();
  function htmlStructurallyEqual(el,next){if(el.innerHTML===next)return true;const tpl=document.createElement('template');tpl.innerHTML=next;const current=el.childNodes,wanted=tpl.content.childNodes;if(current.length!==wanted.length)return false;for(let i=0;i<current.length;i++)if(!current[i].isEqualNode(wanted[i]))return false;return true}
  function setHtmlStable(el,value){if(!el)return false;const next=String(value??'');if(phV41HtmlCache.get(el)===next&&htmlStructurallyEqual(el,next))return false;if(htmlStructurallyEqual(el,next)){phV41HtmlCache.set(el,next);return false}el.innerHTML=next;phV41HtmlCache.set(el,next);return true}"""
    if s.count(old) != 1:
        raise RuntimeError('V41 ui-v26 stable HTML helper anchor mismatch')
    s = s.replace(old, new, 1)

    old_counts = "  function counts(a=state().configs||[]){const o={verified:0,reachable:0,untested:0,failed:0};for(const c of a){if(verified(c))o.verified++;else if(failed(c))o.failed++;else if(reachable(c))o.reachable++;else o.untested++}return o}"
    new_counts = """  function counts(a=state().configs||[]){try{const c=window.PROXYHARVEST_V32?.counts?.(a);if(c)return{verified:num(c.verified),reachable:num(c.reachable),untested:num(c.untested),failed:num(c.failed)}}catch{}const o={verified:0,reachable:0,untested:0,failed:0};for(const c of a){if(verified(c))o.verified++;else if(failed(c))o.failed++;else if(reachable(c))o.reachable++;else o.untested++}return o}"""
    if s.count(old_counts) != 1:
        raise RuntimeError('V41 ui-v26 canonical counts anchor mismatch')
    s = s.replace(old_counts, new_counts, 1)
    write(path, s)


def patch_status_v32() -> None:
    path = 'patches/status-sync-v32.js'
    s = read(path)
    marker = "const PH_V32_RENDER_STABILITY = '41.0.0';"
    if marker in s:
        return
    pattern = r"  function setHtml\(target, value\) \{.*?\n  \}\n"
    replacement = '''  const PH_V32_RENDER_STABILITY = '41.0.0';
  const phV32HtmlCache = new WeakMap();
  function setHtml(target, value) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return false;
    const next = String(value ?? '');
    const structurallyEqual = () => {
      if (el.innerHTML === next) return true;
      const tpl = document.createElement('template');
      tpl.innerHTML = next;
      if (el.childNodes.length !== tpl.content.childNodes.length) return false;
      for (let i = 0; i < el.childNodes.length; i++) {
        if (!el.childNodes[i].isEqualNode(tpl.content.childNodes[i])) return false;
      }
      return true;
    };
    if (phV32HtmlCache.get(el) === next && structurallyEqual()) return false;
    if (structurallyEqual()) { phV32HtmlCache.set(el, next); return false; }
    el.innerHTML = next;
    phV32HtmlCache.set(el, next);
    return true;
  }
'''
    s = sub_once(s, pattern, replacement, 'V41 V32 setHtml', re.S)
    write(path, s)


def patch_v38() -> None:
    path = 'patches/runtime-smart-v38.js'
    s = read(path)
    marker = "const PH_V38_COUNT_STABILITY = '41.0.0';"
    if marker in s:
        return
    pattern = r"  function syncCounts\(\)\{const arr=runtimeState\(\)\?\.configs\|\|\[\],c=\{v:0,r:0,u:0,f:0\};for\(const x of arr\)\{if\(verified\(x\)\)c\.v\+\+;else if\(reachable\(x\)\)c\.r\+\+;else if\(failed\(x\)\)c\.f\+\+;else c\.u\+\+\}setText\('phMetricVerified',c\.v\);setText\('phMetricReachable',c\.r\);setText\('phMetricUntested',c\.u\);setText\('phMetricFailed',c\.f\);return c\}"
    replacement = '''  const PH_V38_COUNT_STABILITY = '41.0.0';
  function syncCounts(){const arr=runtimeState()?.configs||[];let c=null;try{const canonical=window.PROXYHARVEST_V32?.counts?.(arr);if(canonical)c={v:Number(canonical.verified)||0,r:Number(canonical.reachable)||0,u:Number(canonical.untested)||0,f:Number(canonical.failed)||0}}catch{}if(!c){c={v:0,r:0,u:0,f:0};for(const x of arr){if(verified(x))c.v++;else if(reachable(x))c.r++;else if(failed(x))c.f++;else c.u++}}setText('phMetricVerified',c.v);setText('phMetricReachable',c.r);setText('phMetricUntested',c.u);setText('phMetricFailed',c.f);return c}'''
    s = sub_once(s, pattern, replacement, 'V41 V38 canonical counts')
    write(path, s)


def patch_premium_html(path: str) -> str:
    s = read(path)
    marker = "const PH_PREMIUM_IDLE_STABILITY='41.0.0';"
    if marker in s:
        return s

    pattern = r"  function syncRows\(\)\{.*?\n  function activateRoute"
    replacement = r'''  const PH_PREMIUM_IDLE_STABILITY='41.0.0';
  const phPremiumHtmlCache=new WeakMap();
  function setTxt(el,value){if(!el)return false;const next=String(value??'');if(el.textContent===next)return false;el.textContent=next;return true}
  function sameHtml(el,next){if(el.innerHTML===next)return true;const tpl=document.createElement('template');tpl.innerHTML=next;const current=el.childNodes,wanted=tpl.content.childNodes;if(current.length!==wanted.length)return false;for(let i=0;i<current.length;i++)if(!current[i].isEqualNode(wanted[i]))return false;return true}
  function setHtml(el,value){if(!el)return false;const next=String(value??'');if(phPremiumHtmlCache.get(el)===next&&sameHtml(el,next))return false;if(sameHtml(el,next)){phPremiumHtmlCache.set(el,next);return false}el.innerHTML=next;phPremiumHtmlCache.set(el,next);return true}
  function setWidth(el,value){if(!el)return false;const next=String(value);if(el.style.width===next)return false;el.style.width=next;return true}
  function premiumCounts(a){try{const c=window.PROXYHARVEST_V32?.counts?.(a);if(c)return{verified:Number(c.verified)||0,reach:Number(c.reachable)||0,unknown:Number(c.untested)||0,dead:Number(c.failed)||0}}catch{}const counts={verified:0,reach:0,unknown:0,dead:0};a.forEach(c=>{const m=meta(c);if(verified(c))counts.verified++;else if(m.key==='dead')counts.dead++;else if(reachable(c)||m.key==='bridge'||m.key==='reach'||m.key==='probe')counts.reach++;else counts.unknown++});return counts}
  function syncRows(){const a=arr();setTxt(q('phRecentCount'),`Showing ${Math.min(6,a.length)} of ${a.length.toLocaleString()}`);const rows=a.slice().sort((x,y)=>(y.score||0)-(x.score||0)).slice(0,6);const html=rows.length?rows.map(c=>{const r=route(c),cl=r.toLowerCase(),lat=Number(c.latency);const live=meta(c).key==='live'||meta(c).key==='proto';return `<div class="ph-table-row"><div class="ph-cell-name"><i class="ph-rowdot" style="background:${live?'#0ead4b':meta(c).key==='dead'?'#ff2e2e':meta(c).key==='probe'?'#ff9d00':'#60718e'}"></i>${esc(c.remarks||c.host||c.type||'Config')}</div><div class="ph-source">${sourceIcon}${esc(c.sourceName||c.source||c.type||'Config')}</div><div><span class="ph-pill ${cl}">${r}</span></div><div class="ph-latency" style="color:${lat<500?'#0ead4b':lat<2000?'#ef7a00':'#8a96af'}">${Number.isFinite(lat)&&lat<9999?Math.round(lat)+' ms':'—'}</div><div>${statusPill(c)}</div><div style="color:#62708d">${c.tested?'recent':'—'}</div><div class="ph-more">•••</div></div>`}).join(''):`<div class="ph-empty-state"><span class="ph-empty-orbit"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="15"/><path d="M8 24h32M24 8c4 5 6 10.3 6 16s-2 11-6 16M24 8c-4 5-6 10.3-6 16s2 11 6 16"/></svg></span><b>No configs yet</b><p>Harvest from your sources or add a config manually.</p><div><button data-ph-action="fetch">Harvest Configs</button><button data-ph-action="manual">Add Manual</button></div></div>`;setHtml(q('phRecentRows'),html)}
  function sync(){const a=arr(),counts=premiumCounts(a);setTxt(q('phMetricVerified'),counts.verified.toLocaleString());setTxt(q('phMetricReachable'),counts.reach.toLocaleString());setTxt(q('phMetricUntested'),counts.unknown.toLocaleString());setTxt(q('phMetricFailed'),counts.dead.toLocaleString());syncRows();const fill=q('progFill');const pct=parseFloat(fill?.style.width)||0;setWidth(q('phHarvestBar'),Math.max(0,Math.min(100,pct))+'%');setTxt(q('phHarvestPct'),Math.round(pct)+'%');setTxt(q('phHarvestText'),q('progStatus')?.textContent?.trim()||`${a.length.toLocaleString()} configs`);const db=q('dbStatusText')?.textContent?.trim()||'IndexedDB';setTxt(q('phDbText'),db);setTxt(q('phDbState'),/active|ready|created/i.test(db)?'Connected':/unavailable/i.test(db)?'Unavailable':'Checking');const bridge=(q('localBridgeUrl')?.value||'').trim();setTxt(q('phBridgeState'),bridge?'Configured':'Optional');setTxt(q('phBridgeText'),bridge||'Not running / not required');setTxt(q('phRealPingState'),bridge?'Ready':'Optional');document.querySelectorAll('.ph-nav-count').forEach(n=>n.classList.toggle('is-zero',!n.textContent.trim()||n.textContent.trim()==='0'));}
  function activateRoute'''
    s = sub_once(s, pattern, replacement, f'{path} premium sync region', re.S)

    old = "  ['progStatus','dbStatusText','realTestStatus','realTestLive'].forEach(id=>{const el=q(id);if(el)new MutationObserver(sync).observe(el,{childList:true,characterData:true,subtree:true})});\n  setInterval(sync,1200);addEventListener('DOMContentLoaded',()=>{fit();sync();setTimeout(sync,500)});window.PH_PREMIUM_UI={sync,activateRoute};"
    new = """  let premiumSyncTimer=null;const schedulePremiumSync=()=>{if(premiumSyncTimer)return;premiumSyncTimer=setTimeout(()=>{premiumSyncTimer=null;sync()},80)};
  const premiumObservers=[];['progStatus','dbStatusText','realTestStatus','realTestLive'].forEach(id=>{const el=q(id);if(el){const o=new MutationObserver(schedulePremiumSync);o.observe(el,{childList:true,characterData:true,subtree:true});premiumObservers.push(o)}});
  const premiumPeriodic=setInterval(()=>{if(document.visibilityState==='visible')sync()},5000);addEventListener('pagehide',()=>{clearInterval(premiumPeriodic);if(premiumSyncTimer)clearTimeout(premiumSyncTimer);premiumObservers.forEach(o=>o.disconnect())},{once:true});addEventListener('DOMContentLoaded',()=>{fit();sync();setTimeout(schedulePremiumSync,500)});window.PH_PREMIUM_UI={sync,activateRoute};"""
    if s.count(old) != 1:
        raise RuntimeError(f'{path}: premium observer/interval anchor mismatch')
    s = s.replace(old, new, 1)
    return s


def patch_html_pair() -> None:
    index = patch_premium_html('index.html')
    proxy = patch_premium_html('proxyharvest.html')
    if index != proxy:
        raise RuntimeError('index.html and proxyharvest.html diverged after V41 patch')
    write('index.html', index)
    write('proxyharvest.html', proxy)


def main() -> None:
    patch_ui_v26()
    patch_status_v32()
    patch_v38()
    patch_html_pair()
    print('Applied ProxyHarvest V41 idle DOM churn patch')


if __name__ == '__main__':
    main()
