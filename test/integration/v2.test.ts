import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { it } from 'node:test';
import { chromium, type Browser } from 'playwright';
import { runScout } from '../../src/commands/scout';
import { RecorderSession } from '../../src/recorder/session';
import { startFixtureServer } from '../../src/fixtures/server';

const root = path.resolve(__dirname, '../..');

it('closes a launched browser when session initialization fails', async t => {
  let closed = false;
  t.mock.method(chromium, 'launch', async () => ({ close: async () => { closed = true; } }) as unknown as Browser);
  await assert.rejects(RecorderSession.launch({ url: 'https://example.test', viewport: { width: 800, height: 600 }, testIdAttr: 'data-testid', storageState: path.join(root, '.tmp', 'missing-state.json') }), /not found/);
  assert.equal(closed, true);
});

it('navigation failure closes the panel and browser so the CLI exits without hanging', { timeout: 20000 }, async () => {
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/framework/cli.ts', 'record', '--url', pathToFileURL(path.join(root, '.tmp', 'missing-start-page.html')).href, '--headless', '--no-panel-open', '--panel-port', '0'], { cwd: root });
    let output = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => output += data);
    const timeout = setTimeout(() => { child.kill(); reject(new Error('CLI failed to exit after startup failure')); }, 15000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => { clearTimeout(timeout); resolve({ code, output }); });
  });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /ERR_FILE_NOT_FOUND/);
});

it('the shared extension engine generates a usable semantic locator through npm scout', async () => {
  const fixture = await startFixtureServer(0);
  try {
    const result = await runScout(fixture.url + '/', 'button[type="submit"]');
    assert.equal(result.info.name, 'Login');
    assert.ok(result.candidates.some((candidate: any) => candidate.playwright === "page.getByRole('button', { name: 'Login' })"));
    await assert.rejects(runScout(fixture.url + '/', 'input'), /matches 2 elements/);
  } finally { await fixture.close(); }
});

it('the npm scout command and installed Chrome extension return the same locator candidates', { timeout: 45000, skip: process.env.VORTEX_EXTENSION_TEST !== '1' ? 'Set VORTEX_EXTENSION_TEST=1 on a machine permitting unpacked Chrome extensions.' : false }, async () => {
  const fixture = await startFixtureServer(0);
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const profile = fs.mkdtempSync(path.join(root, '.tmp', 'extension-profile-'));
  const extension = path.join(root, 'extension/dist');
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    const npmResult = await runScout(fixture.url + '/', 'button[type="submit"]');
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const isScoutWorker = (worker: { url(): string }) => worker.url().startsWith('chrome-extension://') && worker.url().endsWith('/background.js');
    const worker = context.serviceWorkers().find(isScoutWorker) ?? await context.waitForEvent('serviceworker', { predicate: isScoutWorker });
    // Chromium can announce a worker before its extension APIs are installed (notably on Windows).
    await worker.evaluate(async () => {
      const deadline = Date.now() + 10000;
      while (!(globalThis as any).chrome?.tabs?.query || !(globalThis as any).chrome?.scripting?.executeScript) {
        if (Date.now() >= deadline) throw new Error('Locator Scout worker extension APIs did not become ready');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    });
    const page = await context.newPage();
    await page.goto(fixture.url + '/');
    const scan = await worker.evaluate(async url => {
      const chrome = (globalThis as any).chrome;
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((tab: any) => tab.url === url);
      if (!tab?.id) throw new Error('Fixture tab not found');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tab.id, { type: 'ls:scan' }, { frameId: 0 });
    }, fixture.url + '/');
    const picked = scan.items.find((item: any) => item.result.info.name === 'Login');
    assert.ok(picked, 'Real extension content script must find Login');
    assert.deepEqual(picked.result.candidates, npmResult.candidates);
    assert.ok(npmResult.candidates.some((candidate: any) => candidate.playwright.includes("getByRole('button'")));
    const extensionId = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/panel.html`);
    await panel.getByRole('button', { name: 'Pick element', exact: true }).waitFor();
  } finally {
    await context?.close();
    await fixture.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
