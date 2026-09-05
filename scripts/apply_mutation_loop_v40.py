from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def sub_once(text, pattern, replacement, label, flags=0):
    rx = re.compile(pattern, flags)
    matches = list(rx.finditer(text))
    if len(matches) != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {len(matches)}')
    return rx.sub(replacement, text, count=1)


def patch_core():
    path = 'proxyharvest.js'
    s = read(path)
    if "const PH_MUTATION_STABILITY_V40 = '40.0.0'" in s:
        return
    s = sub_once(
        s,
        r"  function syncActivity\(\) \{.*?\n  \}(?=\n\n  function )",
        '''  const PH_MUTATION_STABILITY_V40 = '40.0.0';
  function syncActivity() {
    const app = byId('phActApp');
    const prog = byId('phActProgress');
    const db = byId('phActDb');
    const bridge = byId('phActBridge');
    const setMirror = (el, value) => {
      if (!el) return false;
      const next = String(value ?? '');
      if (el.textContent === next) return false;
      el.textContent = next;
      return true;
    };
    setMirror(app, byId('statusText')?.textContent || (S?.fetchRunning ? 'Fetching' : 'Idle'));
    setMirror(prog, byId('progCount')?.textContent || byId('realTestStatus')?.textContent || '0 / 0');
    setMirror(db, (byId('dbStatusText')?.textContent || 'Unknown').replace(/^IndexedDB:\\s*/, '').slice(0, 42));
    if (bridge) {
      const b = (byId('localBridgeUrl')?.value || PH_STORAGE.get('ph_real_ping_bridge') || '').trim();
      setMirror(bridge, b ? (String(b).includes('127.0.0.1') ? 'Local 8787' : 'Configured') : 'Optional');
    }
  }''',
        'core syncActivity',
        re.S,
    )
    write(path, s)


def patch_ui_v26():
    path = 'patches/ui-v26.js'
    s = read(path)
    if "const PH_V26_MUTATION_STABILITY = '40.0.0'" in s:
        return

    anchor = "  function b64(t){const bytes=new TextEncoder().encode(t);let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin)}"
    helper = anchor + "\n  const PH_V26_MUTATION_STABILITY = '40.0.0';\n  function setTextStable(el,value){if(!el)return false;const next=String(value??'');if(el.textContent===next)return false;el.textContent=next;return true}\n  function setHtmlStable(el,value){if(!el)return false;const next=String(value??'');if(el.innerHTML===next)return false;el.innerHTML=next;return true}"
    if s.count(anchor) != 1:
        raise RuntimeError('ui-v26 helper anchor mismatch')
    s = s.replace(anchor, helper, 1)

    s = sub_once(
        s,
        r"  function refreshVerify\(\)\{.*?\}\n  function exportList",
        '''  function refreshVerify(){const r=$('#phv26VerifyMetrics');if(!r)return;const c=counts();const html=`<div class="good"><span>Verified</span><b>${c.verified.toLocaleString()}</b><small>Protocol/tunnel evidence</small></div><div class="info"><span>Reachable</span><b>${c.reachable.toLocaleString()}</b><small>Endpoint only</small></div><div><span>Untested</span><b>${c.untested.toLocaleString()}</b><small>No evidence yet</small></div><div class="bad"><span>Failed</span><b>${c.failed.toLocaleString()}</b><small>Latest probe failed</small></div>`;setHtmlStable(r,html);const b=bridge();setTextStable($('#phv26BridgeState'),b?'Configured':'Not configured');setTextStable($('#phv26BridgeDetail'),b||'Strict verification needs the local Real Test Bridge/Engine.')}
  function exportList''',
        'ui refreshVerify', re.S,
    )
    s = sub_once(
        s,
        r"  function refreshExport\(\)\{.*?\}\n  async function doExport",
        '''  function refreshExport(){const body=$('#phv26ExportRows');if(!body)return;const a=exportList(),bucket=$('#phv26ExportBucket')?.value||'verified',n=$('#phv26ExportNote');const note=bucket==='verified'?`<b>${a.length}</b> verified configs ready. These have protocol/tunnel evidence.`:bucket==='reachable'?`<b>${a.length}</b> reachable-only candidates. <strong>They are not protocol/tunnel verified.</strong>`:`<b>${a.length}</b> ranked verified/reachable entries. State remains explicit.`;setHtmlStable(n,note);const rows=a.slice(0,40).map((c,i)=>`<tr><td>${i+1}</td><td>${clean(c.type||'—')}</td><td>${clean(c.host||'—')}:${num(c.port)||'—'}</td><td><span class="phv26-state ${verified(c)?'verified':'reachable'}">${verified(c)?'VERIFIED':'REACHABLE'}</span></td><td>${score(c)}</td><td>${latency(c)===Infinity?'—':Math.round(latency(c))+' ms'}</td><td>${clean(c.sourceName||c.source||'—')}</td></tr>`).join('')||'<tr><td colspan="7" class="phv26-empty">No configs match this export bucket.</td></tr>';setHtmlStable(body,rows)}
  async function doExport''',
        'ui refreshExport', re.S,
    )
    s = sub_once(
        s,
        r"  function refreshSplit\(\)\{.*?\}\n  function ensureWG",
        '''  function refreshSplit(){const r=$('#phv26SplitMetrics');if(!r)return;const a=state().splitnetConfigs||[],c=counts(a),wg=a.filter(x=>String(x.type).toLowerCase()==='wireguard').length;setHtmlStable(r,`<span><b>${a.length}</b>Total</span><span><b>${c.verified}</b>Verified</span><span><b>${c.reachable}</b>Reachable</span><span><b>${wg}</b>WG</span>`)}
  function ensureWG''',
        'ui refreshSplit', re.S,
    )
    s = sub_once(
        s,
        r"  function refreshWG\(\)\{.*?\}\n\n  function candidates",
        '''  function refreshWG(){const r=$('#phv26WgSummary');if(!r)return;const a=(state().configs||[]).filter(c=>String(c.type).toLowerCase()==='wireguard'),structure=a.filter(c=>c.host&&c.port&&c.publicKey).length,reach=a.filter(reachable).length,v=a.filter(verified).length;setHtmlStable(r,`<div><span>Structure valid</span><b>${structure}/${a.length}</b></div><div><span>Endpoint reachable</span><b>${reach}</b></div><div><span>Handshake / tunnel verified</span><b>${v}</b></div><small>Worker/browser reachability never becomes a WireGuard handshake.</small>`)}

  function candidates''',
        'ui refreshWG', re.S,
    )
    s = sub_once(
        s,
        r"  function refreshSettings\(\)\{.*?\}\n  async function check",
        '''  function refreshSettings(){const r=$('#phv26SettingsStatus');if(!r)return;let w=$('#cfg-worker-url')?.value?.trim()||'default gateway';try{w=w||localStorage.getItem('cfg_worker_url')||'default gateway'}catch{}const strict=$('#cfg-strictRealPing')?.checked??true,thr=$('#cfg-scoreThresholdSettings')?.value??$('#cfg-scoreThreshold')?.value??0,b=bridge();setHtmlStable(r,`<div><span>Real Bridge</span><b class="${b?'ok':'warn'}">${b?'Configured':'Optional / missing'}</b></div><div><span>Worker</span><b>${clean(w)}</b></div><div><span>Strict Real Ping</span><b class="${strict?'ok':'warn'}">${strict?'Enabled':'Disabled'}</b></div><div><span>Export score floor</span><b>${clean(thr)}</b></div>`)}
  async function check''',
        'ui refreshSettings', re.S,
    )
    s = sub_once(
        s,
        r"  function boot\(\)\{mark\(\);ensureConfigs\(\);ensureSplit\(\);ensureWG\(\);ensureAI\(\);ensureSettings\(\);ensureInfra\(\);refreshVerify\(\);refreshSplit\(\);refreshWG\(\);refreshSettings\(\);const o=new MutationObserver\(\(\)=>\{ensureConfigs\(\);ensureSplit\(\);ensureWG\(\);ensureAI\(\);ensureSettings\(\);ensureInfra\(\)\}\);o\.observe\(\$\('\.ph-content'\)\|\|\$\('\.content'\)\|\|document\.body,\{childList:true,subtree:true\}\);setInterval\(\(\)=>\{refreshVerify\(\);refreshSplit\(\);refreshWG\(\);refreshSettings\(\)\},1500\)\}",
        '''  function boot(){mark();ensureConfigs();ensureSplit();ensureWG();ensureAI();ensureSettings();ensureInfra();refreshVerify();refreshSplit();refreshWG();refreshSettings();let ensureTimer=null;const ensure=()=>{if(ensureTimer)return;ensureTimer=setTimeout(()=>{ensureTimer=null;ensureConfigs();ensureSplit();ensureWG();ensureAI();ensureSettings();ensureInfra()},100)};const o=new MutationObserver(records=>{if(records.some(r=>r.addedNodes?.length||r.removedNodes?.length))ensure()});o.observe($('.ph-content')||$('.content')||document.body,{childList:true,subtree:true});const periodic=setInterval(()=>{if(document.visibilityState!=='visible')return;refreshVerify();refreshSplit();refreshWG();refreshSettings()},5000);window.addEventListener('pagehide',()=>{o.disconnect();clearInterval(periodic);if(ensureTimer)clearTimeout(ensureTimer)},{once:true})}''',
        'ui boot observer/interval', re.S,
    )
    write(path, s)


def patch_auto_v27():
    path = 'patches/auto-pipeline-v27.js'
    s = read(path)
    if "const PH_V27_MUTATION_STABILITY = '40.0.0'" in s:
        return
    s = s.replace("  const STORAGE_KEY = 'ph_auto_pipeline_enabled';", "  const STORAGE_KEY = 'ph_auto_pipeline_enabled';\n  const PH_V27_MUTATION_STABILITY = '40.0.0';", 1)
    s = sub_once(
        s,
        r"  const setEnabled = value => \{.*?\n  \};",
        '''  const setEnabled = value => {
    try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch {}
    const btn = $('#phv27Toggle');
    if (btn) {
      const on = value ? '1' : '0';
      const text = value ? 'AUTO PIPELINE ON' : 'AUTO PIPELINE OFF';
      if (btn.dataset.on !== on) btn.dataset.on = on;
      if (btn.textContent !== text) btn.textContent = text;
    }
  };''',
        'v27 setEnabled', re.S,
    )
    s = sub_once(
        s,
        r"  function setStage\(name, status, detail = ''\) \{.*?\n  \}\n\n  function resetStages",
        '''  function setStage(name, status, detail = '') {
    const step = document.querySelector(`[data-phv27-stage="${name}"]`);
    if (step) {
      if (step.dataset.status !== status) step.dataset.status = status;
      const small = step.querySelector('small');
      if (small && detail && small.textContent !== detail) small.textContent = detail;
    }
    const label = $('#phv27PipelineStatus');
    const next = detail || `${name}: ${status}`;
    if (label && label.textContent !== next) label.textContent = next;
  }

  function resetStages''',
        'v27 setStage', re.S,
    )
    s = sub_once(
        s,
        r"  function resetStages\(\) \{.*?\n  \}\n\n  async function checkBridgeCandidate",
        '''  function resetStages() {
    document.querySelectorAll('[data-phv27-stage]').forEach(el => {
      if (el.dataset.status !== 'queued') el.dataset.status = 'queued';
      const small = el.querySelector('small');
      if (small && small.textContent !== 'Queued') small.textContent = 'Queued';
    });
  }

  async function checkBridgeCandidate''',
        'v27 resetStages', re.S,
    )
    write(path, s)


def main():
    patch_core()
    patch_ui_v26()
    patch_auto_v27()
    print('Applied ProxyHarvest V40 mutation-loop stability patch')


if __name__ == '__main__':
    main()
