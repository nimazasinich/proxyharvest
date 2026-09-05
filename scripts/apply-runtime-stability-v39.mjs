import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const packagePath = new URL('../package.json', import.meta.url);
const originalPackage = JSON.parse(await readFile(packagePath, 'utf8'));

const result = spawnSync('python3', ['scripts/apply_runtime_stability_v39.py'], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

// V39 is a legacy hardening patcher. It may add missing stability guards, but it
// must never downgrade a newer release train (V42+) back to the historical
// 38.2 package marker. Preserve the current release identity after the Python
// patcher has done its idempotent source hardening.
const originalMajor = Number(String(originalPackage.version || '').split('.')[0]) || 0;
if (originalMajor > 38) {
  const patchedPackage = JSON.parse(await readFile(packagePath, 'utf8'));
  patchedPackage.version = originalPackage.version;
  patchedPackage.scripts = { ...(patchedPackage.scripts || {}), ...(originalPackage.scripts || {}) };
  await writeFile(packagePath, JSON.stringify(patchedPackage, null, 2) + '\n');
  console.log(`Preserved newer package release identity: ${originalPackage.version}`);
}
