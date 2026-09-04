import { buildShell, navigate, toast } from './ui.js';
import { bootState } from './core.js';
import { bindGlobalActions, renderCurrent } from './workspaces.js';
import { bootV15Compatibility } from './v15-compat.js';

async function main(){
  buildShell();
  bindGlobalActions();
  await bootState();
  renderCurrent();
  bootV15Compatibility();
  if(!location.hash) navigate('dashboard');
  toast('ProxyHarvest V18 + V15 NetworkCanonical compatibility ready.','good',1800);
}
main().catch(err=>{console.error(err);document.body.innerHTML=`<pre style="padding:24px">Startup failed: ${String(err?.stack||err)}</pre>`;});