import { spawnSync } from 'node:child_process';

const result = spawnSync('python3', ['scripts/apply_runtime_stability_v39.py'], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
