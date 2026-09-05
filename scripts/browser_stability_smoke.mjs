import puppeteer from 'puppeteer-core';

const executablePath = process.env.PH_CHROME_PATH;
const appUrl = process.env.PH_APP || 'http://127.0.0.1:4173/';
if (!executablePath) throw new Error('PH_CHROME_PATH is required');

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking'],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(String(error?.message || error)));
  await page.goto(appUrl, { waitUntil: 'load', timeout: 15000 });
  await page.waitForFunction(() => window.PROXYHARVEST_V38?.BUILD, { timeout: 10000 });

  const result = await page.evaluate(async () => {
    let records = 0;
    let changedNodes = 0;
    const started = performance.now();
    let ticks = 0;
    const observer = new MutationObserver(batch => {
      records += batch.length;
      for (const r of batch) changedNodes += (r.addedNodes?.length || 0) + (r.removedNodes?.length || 0);
    });
    observer.observe(document.body, { subtree:true, childList:true, characterData:true });
    const beat = setInterval(() => ticks++, 100);
    await new Promise(resolve => setTimeout(resolve, 2500));
    clearInterval(beat);
    observer.disconnect();
    return {
      readyState: document.readyState,
      runtimeBuild: window.PROXYHARVEST_V38?.BUILD || null,
      ticks,
      elapsedMs: performance.now() - started,
      mutationRecords: records,
      changedNodes,
      pipelinePresent: !!document.getElementById('phv27AutoPipeline'),
      bodyChildren: document.body?.children?.length || 0,
    };
  });

  console.log(JSON.stringify({ ...result, pageErrors: consoleErrors }, null, 2));
  if (result.readyState !== 'complete') throw new Error(`document not complete: ${result.readyState}`);
  if (result.runtimeBuild !== '38.2.0-smart-runtime-stability') throw new Error(`unexpected runtime build: ${result.runtimeBuild}`);
  if (result.ticks < 18) throw new Error(`event loop starvation: ${result.ticks} heartbeats in 2.5s`);
  if (result.elapsedMs > 6000) throw new Error(`2.5s timer took ${result.elapsedMs}ms`);
  if (result.mutationRecords > 600) throw new Error(`mutation storm: ${result.mutationRecords} records`);
  if (result.changedNodes > 1200) throw new Error(`DOM churn too high: ${result.changedNodes} nodes`);
  if (!result.pipelinePresent) throw new Error('runtime patches did not finish booting');
  if (consoleErrors.length) throw new Error(`page errors: ${consoleErrors.join(' | ')}`);
  console.log('PASS browser-stability: renderer responsive; no mutation feedback storm');
} finally {
  await browser.close();
}
