// Save generated files without silently overwriting hand-edited code.
import fs from 'node:fs';
import path from 'node:path';
import type { GeneratedFile } from '../types';
import { readTextFile } from '../util/files';

export interface SaveEntry {
  file: string; // absolute path written (or skipped)
  status: 'written' | 'unchanged' | 'generated-alongside' | 'overwritten' | 'kept';
  added: number;
  removed: number;
}

export function lineDiff(oldText: string, newText: string): { added: number; removed: number } {
  const count = (t: string) => {
    const m = new Map<string, number>();
    for (const l of t.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(oldText);
  const b = count(newText);
  let added = 0;
  let removed = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) removed += Math.max(0, n - (b.get(l) ?? 0));
  return { added, removed };
}

/** `pages/LoginPage.ts` -> `pages/LoginPage.generated.ts` */
export function generatedName(file: string): string {
  const ext = path.extname(file);
  const special = file.endsWith('.spec.ts') ? '.spec.ts' : file.endsWith('.data.json') ? '.data.json' : ext;
  return file.slice(0, file.length - special.length) + '.generated' + special;
}

export const OUT_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'preserve',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['**/*.ts'],
  },
  null,
  2,
) + '\n';

function hasTsconfigUpTo(dir: string, stopAt: string): boolean {
  let cur = path.resolve(dir);
  const stop = path.resolve(stopAt);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(cur, 'tsconfig.json'))) return true;
    if (cur === stop) return false;
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
  return false;
}

export function saveFiles(files: GeneratedFile[], outDir: string, opts: { overwrite?: boolean; cwd?: string } = {}): SaveEntry[] {
  const out: SaveEntry[] = [];
  const root = path.resolve(outDir);
  const all = [...files];
  if (!hasTsconfigUpTo(root, opts.cwd ?? process.cwd())) all.push({ path: 'tsconfig.json', content: OUT_TSCONFIG });
  for (const f of all) {
    const target = path.join(root, ...f.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, f.content, 'utf8');
      out.push({ file: target, status: 'written', added: f.content.split('\n').length, removed: 0 });
      continue;
    }
    if (f.path.startsWith('assets/')) {
      out.push({ file: target, status: 'kept', added: 0, removed: 0 });
      continue;
    }
    const existing = readTextFile(target);
    if (existing === f.content) {
      out.push({ file: target, status: 'unchanged', added: 0, removed: 0 });
      continue;
    }
    const d = lineDiff(existing, f.content);
    if (opts.overwrite || f.path.startsWith('recordings/')) {
      fs.writeFileSync(target, f.content, 'utf8');
      out.push({ file: target, status: 'overwritten', ...d });
    } else {
      const alt = path.join(root, ...generatedName(f.path).split('/'));
      fs.writeFileSync(alt, f.content, 'utf8');
      out.push({ file: alt, status: 'generated-alongside', ...d });
    }
  }
  return out;
}

export function formatSaveReport(entries: SaveEntry[]): string {
  return entries
    .map((e) => {
      const rel = path.relative(process.cwd(), e.file) || e.file;
      switch (e.status) {
        case 'written':
          return `  + ${rel}`;
        case 'unchanged':
          return `  = ${rel} (unchanged)`;
        case 'kept':
          return `  = ${rel} (kept your file)`;
        case 'overwritten':
          return `  ! ${rel} (overwritten: +${e.added} / -${e.removed} lines)`;
        case 'generated-alongside':
          return `  ~ ${rel} (your file was edited or differs: +${e.added} / -${e.removed} lines; compare and merge)`;
      }
    })
    .join('\n');
}
