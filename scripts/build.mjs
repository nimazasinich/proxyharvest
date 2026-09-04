import { rm, mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const cssTag = '<link rel="stylesheet" href="/patches/ui-v26.css" data-proxyharvest-ui="v26">';
const jsTag = '<script defer src="/patches/ui-v26.js" data-proxyharvest-ui="v26"></script>';

function inject(html) {
  let out = html;
  if (!out.includes('data-proxyharvest-ui="v26"')) {
    out = out.includes('</head>') ? out.replace('</head>', `${cssTag}\n</head>`) : `${cssTag}\n${out}`;
    out = out.includes('</body>') ? out.replace('</body>', `${jsTag}\n</body>`) : `${out}\n${jsTag}`;
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
  source: 'github-main',
  indexSha256: createHash('sha256').update(index).digest('hex'),
  runtimeSha256: createHash('sha256').update(runtime).digest('hex'),
  generatedAt: new Date().toISOString()
};
await writeFile('public/build.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
