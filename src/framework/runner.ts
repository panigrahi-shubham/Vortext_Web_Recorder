import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EMPTY_SUITE, moduleDirectory } from './modules';

export interface RunSelection { module?: string; file?: string; title?: string; list?: boolean; headed?: boolean }
export interface RunResult { code: number; output: string }

export function selectionArgs(root: string, selection: RunSelection): string[] {
  if (selection.module && selection.file) throw new Error('Choose --module or --file, not both.');
  const args: string[] = [];
  let selected: string | undefined;
  if (selection.module) selected = moduleDirectory(root, selection.module);
  if (selection.file) {
    selected = path.resolve(root, selection.file);
    const tests = fs.realpathSync(path.join(root, 'tests'));
    if (!fs.existsSync(selected) || !fs.statSync(selected).isFile() || !selected.endsWith('.spec.ts')) throw new Error('Select an existing .spec.ts file inside tests/.');
    const rel = path.relative(tests, fs.realpathSync(selected));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Test must stay inside tests/.');
  }
  if (selected) {
    // Playwright file filters are regexes, not literal paths.
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    args.push(escape(selected) + (selection.file ? '$' : escape(path.sep)));
  }
  if (selection.title) args.push('--grep', selection.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return args;
}

function child(root: string, args: string[], output?: (text: string) => void): Promise<RunResult> {
  const configuration = ['ts', 'js', 'mjs', 'cjs'].map(ext => path.join(root, `playwright.config.${ext}`)).find(file => fs.existsSync(file));
  if (!configuration) throw new Error('No Playwright configuration found. Run vortex-qa init in your project first.');
  return new Promise(resolve => {
    let combined = '';
    const proc = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '-c', configuration, ...args], {
      cwd: root, env: { ...process.env, FORCE_COLOR: '0' }, shell: false,
    });
    const append = (chunk: Buffer) => { const s = chunk.toString(); combined += s; output?.(s); };
    proc.stdout.on('data', append); proc.stderr.on('data', append);
    const interrupt = () => { proc.kill(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const cleanup = () => { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); };
    proc.on('error', e => { cleanup(); resolve({ code: 1, output: combined + e.message }); });
    proc.on('close', (code, signal) => { cleanup(); resolve({ code: code ?? (signal ? 130 : 1), output: combined }); });
  });
}

/** Serialize framework runs across terminals and panel requests. */
export async function runTests(root: string, selection: RunSelection, output?: (text: string) => void): Promise<RunResult> {
  const args = selectionArgs(root, selection);
  const lockFile = path.join(root, '.framework-run.lock');
  let fd: number;
  try { fd = fs.openSync(lockFile, 'wx'); }
  catch { throw new Error('Another framework run is active. If it crashed, verify no runner is active before removing .framework-run.lock.'); }
  fs.writeFileSync(fd, String(process.pid));
  try {
    const discovered = await child(root, [...args, '--list', '--reporter=json']);
    let count = 0;
    try {
      const report = JSON.parse(discovered.output);
      const walk = (suites: any[]) => suites.forEach(s => { count += (s.specs ?? []).reduce((n: number, spec: any) => n + (spec.tests?.length ?? 0), 0); walk(s.suites ?? []); });
      walk(report.suites ?? []);
    } catch {
      return { code: discovered.code || 1, output: discovered.output || 'Could not read Playwright discovery results.' };
    }
    if (!count) {
      const errors = JSON.parse(discovered.output).errors ?? [];
      const otherErrors = errors.filter((e: { message?: string }) => !e.message?.includes('No tests found'));
      return { code: discovered.code || 2, output: otherErrors.length ? discovered.output : EMPTY_SUITE };
    }
    if (discovered.code) return discovered;
    if (selection.list) return { code: 0, output: discovered.output };
    return await child(root, [...args, ...(selection.headed ? ['--headed'] : [])], output);
  } finally { fs.closeSync(fd); fs.unlinkSync(lockFile); }
}
