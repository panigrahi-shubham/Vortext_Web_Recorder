import fs from 'node:fs';
import path from 'node:path';

/** Prepare a consumer project without replacing existing configuration or tests. */
export function initProject(root: string): string[] {
  fs.mkdirSync(root, { recursive: true });
  const written: string[] = [];
  const write = (name: string, contents: string) => {
    try { fs.writeFileSync(path.join(root, name), contents, { flag: 'wx' }); written.push(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  };
  // An existing JS or TS configuration always takes precedence.
  if (!['ts', 'js', 'mjs', 'cjs'].some(ext => fs.existsSync(path.join(root, `playwright.config.${ext}`)))) {
    write('playwright.config.ts', fs.readFileSync(path.join(__dirname, '..', '..', 'playwright.config.ts'), 'utf8'));
  }
  write('tsconfig.qa.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'preserve', moduleResolution: 'bundler', strict: true, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, noEmit: true }, include: ['tests/**/*.ts', 'playwright.config.ts'] }, null, 2) + '\n');
  fs.mkdirSync(path.join(root, 'tests', 'my-product'), { recursive: true });
  return written;
}
