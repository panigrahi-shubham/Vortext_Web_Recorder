import fs from 'node:fs';
import path from 'node:path';

export function discoverModules(root: string): string[] {
  const dir = path.join(root, 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name).sort();
}

export function moduleDirectory(root: string, name: string): string {
  if (!discoverModules(root).includes(name)) throw new Error(`Unknown module: ${name}. Refresh modules or create a directory under tests/.`);
  const dir = path.join(root, 'tests', name);
  const tests = fs.realpathSync(path.join(root, 'tests'));
  const relative = path.relative(tests, fs.realpathSync(dir));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Module must stay inside tests/.');
  return dir;
}

export const EMPTY_SUITE = 'No Playwright test cases found. Record and save your first test.';
