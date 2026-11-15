import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, firefox, webkit } from 'playwright';
import { readTextFile } from '../util/files';

export interface ReadinessOptions {
  out: string;
  url?: string;
  panelPort: number;
  storageState?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  launchBrowser?: boolean;
}
export interface ReadinessCheck { name: string; ok: boolean; message: string }

/** Check local prerequisites without contacting the target application or exposing credentials. */
export async function checkReadiness(options: ReadinessOptions): Promise<ReadinessCheck[]> {
  const checks: ReadinessCheck[] = [];
  const check = async (name: string, work: () => void | Promise<void>, success: string) => {
    try { await work(); checks.push({ name, ok: true, message: success }); }
    catch (error) { checks.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) }); }
  };
  await check('Node.js', () => {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Install Node.js 20 or newer.');
  }, process.versions.node);
  if (options.url) await check('Target URL', () => {
    let url: URL;
    try { url = new URL(options.url!); } catch { throw new Error('Use a complete http://, https:// or file:// URL.'); }
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('Only http://, https:// and file:// targets are supported.');
    if (url.username || url.password) throw new Error('Do not embed credentials in the target URL. Use a login flow or --storage-state.');
  }, 'Valid target URL (connectivity is checked when recording starts).');
  await check('Output directory', () => {
    let parent = path.resolve(options.out);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    if (!fs.statSync(parent).isDirectory()) throw new Error('The output path or one of its parents is a file. Choose a directory.');
    const probe = fs.mkdtempSync(path.join(parent, '.qa-write-check-'));
    try { fs.writeFileSync(path.join(probe, 'probe'), ''); }
    finally { fs.rmSync(probe, { recursive: true, force: true }); }
  }, 'Writable; no recording files created.');
  if (options.storageState) await check('Authentication state', () => {
    if (!fs.existsSync(options.storageState!)) throw new Error('--storage-state file not found. Supply an existing Playwright storage state file.');
    let state: unknown;
    try { state = JSON.parse(readTextFile(options.storageState!)); }
    catch { throw new Error('Authentication state is not valid JSON. Export it again with Playwright.'); }
    const value = state as { cookies?: unknown; origins?: unknown } | null;
    if (!value || !Array.isArray(value.cookies) || !Array.isArray(value.origins)) throw new Error('Authentication state must contain cookies and origins arrays.');
  }, 'Readable Playwright state; contents are not displayed.');
  await check('Panel port', async () => {
    if (!Number.isInteger(options.panelPort) || options.panelPort < 0 || options.panelPort > 65535) throw new Error('--panel-port must be an integer from 0 to 65535. Use 0 for an available port.');
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(new Error(`Panel port ${options.panelPort} is unavailable. Choose another --panel-port or use 0.`)));
      server.listen(options.panelPort, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
    });
  }, 'Available (recording reserves it at startup).');
  const engine = { chromium, firefox, webkit }[options.browser ?? 'chromium'];
  await check('Browser', async () => {
    if (!fs.existsSync(engine.executablePath())) throw new Error(`Browser is missing. Run npx playwright install ${options.browser ?? 'chromium'}.`);
    if (options.launchBrowser) {
      try { const browser = await engine.launch({ headless: true }); await browser.close(); }
      catch { throw new Error(`Browser could not launch on ${os.platform()}. Run npx playwright install --with-deps ${options.browser ?? 'chromium'} and retry npm run qa:doctor.`); }
    }
  }, options.launchBrowser ? 'Headless launch and shutdown succeeded.' : 'Installed; recording will launch the browser.');
  return checks;
}

export async function assertRecorderReady(options: ReadinessOptions): Promise<void> {
  const failed = (await checkReadiness(options)).filter(check => !check.ok);
  if (failed.length) throw new Error('Recorder prerequisites failed:\n' + failed.map(check => `  ${check.name}: ${check.message}`).join('\n'));
}
