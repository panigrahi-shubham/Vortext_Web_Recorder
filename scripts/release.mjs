import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
mkdirSync('artifacts', { recursive: true });
const files = {};
function collect(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file, name + '/');
    else files[name] = new Uint8Array(readFileSync(file));
  }
}
collect('extension/dist');
const extensionName = `vortex-locator-scout-${version}.zip`;
writeFileSync(path.join('artifacts', extensionName), zipSync(files));
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--ignore-scripts', '--json', '--pack-destination', 'artifacts'], { encoding: 'utf8' });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status ?? 1); }
const [{ filename }] = JSON.parse(result.stdout);
const names = [filename, extensionName];
writeFileSync('artifacts/SHA256SUMS', names.map(name => `${createHash('sha256').update(readFileSync(path.join('artifacts', name))).digest('hex')}  ${name}`).join('\n') + '\n');
console.log(names.map(name => path.join('artifacts', name)).join('\n'));
