import { spawnSync } from 'node:child_process';
// The web deployment never needs Chromium or ERGO credentials.
if (!process.env.VERCEL) {
  const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
