import { rm, mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const assets = {
  css: [
    { path: '/patches/ui-v26.css', tag: '<link rel="stylesheet" href="/patches/ui-v26.css" data-proxyharvest-ui="v26">' },
    { path: '/patches/auto-pipeline-v27.css', tag: '<link rel="stylesheet" href="/patches/auto-pipeline-v27.css" data-proxyharvest-pipeline="v27">' },
    { path: '/patches/layout-v28.css', tag: '<link rel="stylesheet" href="/patches/layout-v28.css" data-proxyharvest-layout="v29">' },
    { path: '/patches/layout-v31-1368.css', tag: '<link rel="stylesheet" href="/patches/layout-v31-1368.css" data-proxyharvest-layout="v31-1368x753">' },
    { path: '/patches/status-sync-v32.css', tag: '<link rel="stylesheet" href="/patches/status-sync-v32.css" data-proxyharvest-status="v32">' },
    { path: '/patches/compact-contrast-v34.css', tag: '<link rel="stylesheet" href="/patches/compact-contrast-v34.css" data-proxyharvest-compact="v34">' },
    { path: '/patches/configs-density-v35.css', tag: '<link rel="stylesheet" href="/patches/configs-density-v35.css" data-proxyharvest-configs-density="v35">' },
    { path: '/patches/configs-row-v36.css', tag: '<link rel="stylesheet" href="/patches/configs-row-v36.css" data-proxyharvest-configs-row="v36">' },
    { path: '/patches/workspace-balance-v37.css', tag: '<link rel="stylesheet" href="/patches/workspace-balance-v37.css" data-proxyharvest-workspace-balance="v37">' }
  ],
  js: [
    { path: '/patches/ui-v26.js', tag: '<script defer src="/patches/ui-v26.js" data-proxyharvest-ui="v26"></script>' },
    { path: '/patches/auto-pipeline-v27.js', tag: '<script defer src="/patches/auto-pipeline-v27.js" data-proxyharvest-pipeline="v27"></script>' },
    { path: '/patches/status-sync-v32.js', tag: '<script defer src="/patches/status-sync-v32.js" data-proxyharvest-status="v32"></script>' },
    { path: '/patches/status-guard-v32.js', tag: '<script defer src="/patches/status-guard-v32.js" data-proxyharvest-status-guard="v32"></script>' },
    { path: '/patches/compact-interaction-v34.js', tag: '<script defer src="/patches/compact-interaction-v34.js" data-proxyharvest-compact="v34"></script>' },
    { path: '/patches/configs-density-v35.js', tag: '<script defer src="/patches/configs-density-v35.js" data-proxyharvest-configs-density="v35"></script>' },
    { path: '/patches/configs-row-v36.js', tag: '<script defer src="/patches/configs-row-v36.js" data-proxyharvest-configs-row="v36"></script>' }
  ]
};

function inject(html) {
  let out = html;
  for (const asset of assets.css) {
    if (!out.includes(asset.path)) out = out.includes('</head>') ? out.replace('</head>', `${asset.tag}\n</head>`) : `${asset.tag}\n${out}`;
  }
  for (const asset of assets.js) {
    if (!out.includes(asset.path)) out = out.includes('</body>') ? out.replace('</body>', `${asset.tag}\n</body>`) : `${out}\n${asset.tag}`;
  }
  return out;
}

const index = await readFile('index.html', 'utf8');
const pair = await readFile('proxyharvest.html', 'utf8');
const runtime = await readFile('proxyharvest.js', 'utf8');
const expected = index.match(/PROXYHARVEST_EXPECTED_BUILD=["']([^"']+)/)?.[1];
const actual = runtime.match(/PROXYHARVEST_BUILD\s*=\s*["']([^"']+)/)?.[1];
if (!expected || !actual || expected !== actual) throw new Error(`HTML/JS build mismatch: expected=${expected || 'missing'} actual=${actual || 'missing'}`);

await rm('public', { recursive: true, force: true });
await mkdir('public/patches', { recursive: true });
await writeFile('public/index.html', inject(index));
await writeFile('public/proxyharvest.html', inject(pair));
await copyFile('proxyharvest.js', 'public/proxyharvest.js');
await cp('patches', 'public/patches', { recursive: true });

const manifest = {
  build: actual,
  uiPatch: '26.0.0-github-main-ui',
  autoPipeline: '27.0.0-auto-pipeline',
  layoutPatch: '31.0.0-canonical-1368x753',
  verificationSync: '32.0.0-verification-sync',
  verificationGuard: '32.0.0-canonical-count-guard',
  compactContrast: '34.0.0-compact-interaction',
  configsDensity: '35.0.0-configs-density',
  configsRow: '36.0.0-single-line-rows',
  workspaceBalance: '37.0.0-row-splitnet-shared-contrast',
  canonicalViewport: '1368x753',
  source: 'github-main',
  indexSha256: createHash('sha256').update(index).digest('hex'),
  runtimeSha256: createHash('sha256').update(runtime).digest('hex'),
  generatedAt: new Date().toISOString()
};
await writeFile('public/build.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
