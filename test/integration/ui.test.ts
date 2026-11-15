// M3 acceptance: drive a recording through the real toolbar in a headed browser
// (run under xvfb on Linux CI), and check the panel shows the same code that gets saved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { startFixtureServer, type FixtureServer } from '../../src/fixtures/server';
import { RecorderSession } from '../../src/recorder/session';
import { startPanel, type Panel } from '../../src/server/panel';
import { ROOT } from './helpers';

const HEADED = process.env.TPHUB_HEADLESS !== '1' && (!!process.env.DISPLAY || process.platform === 'win32' || process.platform === 'darwin');

async function clickUi(page: Page, kind: string, value?: string) {
  let rect: { x: number; y: number } | null = null;
  for (let i = 0; i < 20 && !rect; i++) {
    rect = (await page.evaluate(`window.__tphub.uiRect(${JSON.stringify(kind)}, ${JSON.stringify(value ?? '')})`)) as { x: number; y: number } | null;
    if (!rect) await page.waitForTimeout(100);
  }
  assert.ok(rect, `toolbar element ${kind}:${value} not found`);
  await page.mouse.click(rect!.x, rect!.y);
}

describe(`toolbar and panel (${HEADED ? 'headed' : 'headless'})`, () => {
  let server: FixtureServer;
  let session: RecorderSession;
  let panel: Panel;
  let page: Page;
  let panelBrowser: Browser;
  const outDir = path.join(ROOT, '.tmp', 'it', 'ui', 'tests');

  before(async () => {
    fs.rmSync(path.dirname(outDir), { recursive: true, force: true });
    server = await startFixtureServer(0);
    session = await RecorderSession.launch({ url: server.url + '/', viewport: { width: 1280, height: 800 }, headless: !HEADED, testIdAttr: 'data-testid', ui: true });
    panel = await startPanel(session, {
      port: 0,
      outDir,
      overwrite: false,
      cwd: path.dirname(outDir),
      gen: { flowName: 'toolbar flow', viewport: { width: 1280, height: 800 }, baseURL: server.url, style: 'pom', keepSecrets: false, outDirFromCwd: 'tests' },
    });
    await session.start();
    page = session.pages[0];
    panelBrowser = await chromium.launch({ headless: true });
  });
  after(async () => {
    await panelBrowser?.close();
    await panel?.close();
    await session?.close();
    await server?.close();
  });

  it('shows the toolbar and a hover tooltip with the chosen locator and score', async () => {
    const login = page.getByRole('button', { name: 'Login' });
    const box = (await login.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    let tip = '';
    for (let i = 0; i < 30 && !tip.includes('getByRole'); i++) {
      await page.waitForTimeout(100);
      tip = (await page.evaluate('window.__tphub.uiText("tip")')) as string;
    }
    assert.match(tip, /90page\.getByRole\('button', \{ name: 'Login' \}\)/);
  });

  it('records actions in Record mode and keeps the toolbar out of the recording', async () => {
    await page.getByPlaceholder('Username').fill('standard_user');
    await page.getByPlaceholder('Password').fill('secret_sauce');
    await page.getByRole('button', { name: 'Login' }).click();
    await session.idle();
    assert.deepEqual(session.steps.map((s) => s.kind), ['goto', 'fill', 'fill', 'click']);
    assert.match(String(await page.evaluate('window.__tphub.uiText("count")')), /4 steps/);
  });

  it('adds a check through Assert mode without clicking the page', async () => {
    await clickUi(page, 'mode', 'assert');
    await session.idle(200);
    assert.equal(session.mode, 'assert');
    await page.getByRole('heading', { name: 'Products' }).click();
    await clickUi(page, 'menu', 'text equals');
    await session.idle();
    const last = session.steps[session.steps.length - 1];
    assert.equal(last.kind, 'assert');
    assert.equal(last.assertion!.type, 'textEquals');
    assert.equal(last.assertion!.expected, 'Products');
    assert.equal(last.target!.code, "page.getByRole('heading', { name: 'Products' })");
  });

  it('counts repeated items from the Assert menu', async () => {
    await page.getByRole('listitem').filter({ hasText: 'Bike Light' }).getByRole('heading').click();
    await clickUi(page, 'menu', 'count equals');
    await session.idle();
    const last = session.steps[session.steps.length - 1];
    assert.equal(last.assertion!.type, 'countEquals');
    assert.equal(last.assertion!.expected, 6);
    assert.equal(last.target!.code, "page.getByRole('listitem')");
  });

  it('switches back to Record, records a click, and Undo removes it', async () => {
    await clickUi(page, 'mode', 'record');
    await session.idle(200);
    assert.equal(session.mode, 'record');
    await page.getByRole('listitem').filter({ hasText: 'Bike Light' }).getByRole('button', { name: 'Add to cart' }).click();
    await session.idle();
    const n = session.steps.length;
    assert.equal(session.steps[n - 1].kind, 'click');
    await clickUi(page, 'cmd', 'undo');
    await session.idle(200);
    assert.equal(session.steps.length, n - 1);
  });

  it('Pause mode records nothing', async () => {
    await clickUi(page, 'mode', 'pause');
    await session.idle(200);
    const n = session.steps.length;
    await page.getByRole('combobox', { name: 'Sort products' }).selectOption('price');
    await session.idle();
    assert.equal(session.steps.length, n);
    await clickUi(page, 'mode', 'record');
    await session.idle(200);
  });

  it('panel shows the steps and the same code that gets saved', async () => {
    const pp = await panelBrowser.newPage();
    await pp.goto(panel.url);
    await pp.locator('.card').first().waitFor();
    await assertCardCount(pp, session.steps.length);
    // toggle a pre-assertion and switch a click to "locator + point" from the panel UI
    const loginCard = pp.locator('.card').filter({ hasText: 'Click button "Login"' });
    await loginCard.locator('input[data-act="pre"]').uncheck();
    await loginCard.locator('select[data-act="style"]').selectOption('fallback');
    await pp.waitForFunction(() => document.getElementById('tabs')!.textContent!.includes('utils/smart.ts'));
    const loginStep = session.steps.find((s) => s.target?.code.includes("'Login'"))!;
    assert.equal(loginStep.preAssert, false);
    assert.equal(loginStep.clickStyle, 'fallback');
    // the preview of each file equals what Save writes
    const shown: Record<string, string> = {};
    const tabs = await pp.locator('#tabs .tab').allTextContents();
    for (const t of tabs) {
      await pp.locator('#tabs .tab', { hasText: t }).click();
      shown[t] = (await pp.locator('#preview').textContent())!;
    }
    await pp.getByRole('button', { name: 'Save files' }).click();
    await pp.locator('#toast').waitFor({ state: 'visible' });
    for (const [file, content] of Object.entries(shown)) {
      const disk = fs.readFileSync(path.join(outDir, ...file.split('/')), 'utf8');
      assert.equal(disk, content, `${file} on disk differs from the panel preview`);
    }
    assert.ok(shown['pages/LoginPage.ts'].includes('clickOrAt(this.page, this.loginButton'));
  });

  it('panel can delete and reorder steps', async () => {
    const pp = await panelBrowser.newPage();
    await pp.goto(panel.url);
    await pp.locator('.card').first().waitFor();
    const before = session.steps.length;
    await pp.locator('.card').last().locator('button[data-act="delete"]').click();
    await pp.waitForFunction((n) => document.querySelectorAll('.card').length === n, before - 1);
    assert.equal(session.steps.length, before - 1);
    const firstFill = session.steps[1].id;
    await pp.locator('.card').nth(1).locator('.num').dragTo(pp.locator('.card').nth(2));
    await pp.waitForFunction((id) => document.querySelectorAll('.card')[2]?.getAttribute('data-id') === id, firstFill);
    assert.equal(session.steps[2].id, firstFill);
  });
});

async function assertCardCount(pp: Page, n: number) {
  await pp.waitForFunction((count) => document.querySelectorAll('.card').length === count, n, { timeout: 5000 });
}
