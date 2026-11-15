import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
rmSync('dist', { recursive: true, force: true });
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
for (const name of ['page-core.js', 'page-ui.js']) cpSync(`src/recorder/${name}`, `dist/recorder/${name}`);
cpSync('src/server/public', 'dist/server/public', { recursive: true });
mkdirSync('dist/scout', { recursive: true });
cpSync('extension/dist/engine.js', 'dist/scout/engine.js');
for (const file of ['dist/framework/cli.js', 'dist/cli.js']) chmodSync(file, 0o755);
