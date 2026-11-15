import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { saveFiles } from '../../src/codegen/save';
import type { GeneratedFile } from '../../src/types';

export const ROOT = path.join(__dirname, '..', '..');
const PW_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/** A throwaway Playwright project inside the repo (so it resolves our node_modules). */
export function makeProject(name: string, files: GeneratedFile[]): { dir: string; outDir: string } {
  const dir = path.join(ROOT, '.tmp', 'it', name);
  fs.rmSync(dir, { recursive: true, force: true });
  const outDir = path.join(dir, 'tests');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'playwright.config.ts'),
    [
      "import { defineConfig } from '@playwright/test';",
      'export default defineConfig({',
      "  testDir: './tests/specs',",
      '  timeout: 30000,',
      '  retries: 0,',
      '  workers: 1,',
      "  reporter: 'line',",
      '  use: { baseURL: process.env.TPHUB_BASE_URL },',
      '});',
      '',
    ].join('\n'),
  );
  saveFiles(files, outDir, { cwd: dir });
  return { dir, outDir };
}

export interface RunResult {
  code: number;
  output: string;
}

/** Async on purpose: the fixture server lives in this process and must keep answering. */
function run(args: string[], cwd: string, env: Record<string, string> = {}, timeoutMs = 180000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env, FORCE_COLOR: '0' } });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output });
    });
  });
}

export function runPlaywright(dir: string, env: Record<string, string>): Promise<RunResult> {
  return run([PW_CLI, 'test', '-c', path.join(dir, 'playwright.config.ts')], dir, env);
}

export function typecheck(outDir: string): Promise<RunResult> {
  return run([TSC, '--noEmit', '-p', path.join(outDir, 'tsconfig.json')], outDir);
}

export function allCode(files: GeneratedFile[]): string {
  return files.filter((f) => f.path.endsWith('.ts')).map((f) => f.content).join('\n');
}
