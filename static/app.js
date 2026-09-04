import { buildShell, navigate, toast } from './ui.js';
import { bootState } from './core.js';
import { bindGlobalActions, renderCurrent } from './workspaces.js';

async function main(){
  buildShell();
  bindGlobalActions();
  await bootState();
  renderCurrent();
  if(!location.hash) navigate('dashboard');
  toast('ProxyHarvest V18 ready.','good',1800);
}
main().catch(err=>{console.error(err);document.body.innerHTML=`<pre style="padding:24px">Startup failed: ${String(err?.stack||err)}</pre>`;});
