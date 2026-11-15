import fs from 'node:fs';
import path from 'node:path';
import { readTextFile } from './files';

/**
 * Read `testIdAttribute` from playwright.config.(ts|js|mjs|cjs) without executing it.
 * Looks in `dir` and its parents. Falls back to data-testid.
 */
export function resolveTestIdAttr(dir: string): string {
  let cur = path.resolve(dir);
  for (let i = 0; i < 6; i++) {
    for (const name of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']) {
      const f = path.join(cur, name);
      if (fs.existsSync(f)) {
        const m = /testIdAttribute\s*:\s*['"`]([^'"`]+)['"`]/.exec(readTextFile(f));
        if (m) return m[1];
        return 'data-testid';
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return 'data-testid';
}
