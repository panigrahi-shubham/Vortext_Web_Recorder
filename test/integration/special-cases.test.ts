// M4 acceptance: each special case has a fixture page, is recorded through the real
// capture path, generates code that type-checks, and the generated spec passes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Page } from 'playwright';
import { generate } from '../../src/codegen/index';
import { startFixtureServer, type FixtureServer } from '../../src/fixtures/server';
import { RecorderSession } from '../../src/recorder/session';
import type { GeneratedFile, Step } from '../../src/types';
import { makeProject, ROOT, runPlaywright, typecheck } from './helpers';

const VIEWPORT = { width: 1280, height: 720 };

interface Case {
  name: string;
  start: string;
  storageState?: object;
  drive(s: RecorderSession, page: Page): Promise<void>;
  check(steps: Step[], files: GeneratedFile[]): void;
}

const spec = (files: GeneratedFile[]) => files.find((f) => f.path.startsWith('specs/'))!.content;
const pages = (files: GeneratedFile[]) => files.filter((f) => f.path.startsWith('pages/')).map((f) => f.content).join('\n');

const CASES: Case[] = [
  {
    name: 'iframe',
    start: '/frames.html',
    async drive(s, page) {
      const f = page.frameLocator('iframe[name="payment"]');
      await f.getByLabel('Card holder').fill('Asha Rao');
      await f.getByRole('button', { name: 'Pay now' }).click();
      await s.idle();
    },
    check(steps, files) {
      const click = steps.find((x) => x.kind === 'click')!;
      assert.deepEqual(click.target!.chain.frames, ['iframe[name="payment"]']);
      assert.match(pages(files), /frameLocator\('iframe\[name="payment"\]'\)/);
      assert.match(spec(files), /toContainText\('Payment accepted for Asha Rao'\)/);
    },
  },
  {
    name: 'shadow-dom',
    start: '/shadow.html',
    async drive(s, page) {
      await page.locator('user-card').filter({ hasText: 'Ben Ortiz' }).getByRole('button', { name: 'Follow' }).click();
      await s.idle();
    },
    check(steps) {
      const click = steps.find((x) => x.kind === 'click')!;
      assert.equal(click.target!.code, "page.locator('user-card').filter({ hasText: 'Ben Ortiz' }).getByRole('button', { name: 'Follow' })");
    },
  },
  {
    name: 'popup',
    start: '/popup.html',
    async drive(s, page) {
      await page.getByRole('link', { name: 'Open help center' }).click();
      await s.idle();
      const pop = s.pages[1];
      assert.ok(pop, 'popup tab was captured');
      await pop.getByRole('button', { name: 'Contact support' }).click();
      await s.idle();
    },
    check(steps, files) {
      assert.equal(steps.find((x) => x.kind === 'click')!.popup!.tab, 1);
      assert.equal(steps[steps.length - 1].page.tab, 1);
      assert.match(pages(files), /this\.page\.context\(\)\.waitForEvent\('page'\)/);
      assert.match(spec(files), /const popup = await /);
    },
  },
  {
    name: 'dialog',
    start: '/dialogs.html',
    async drive(s, page) {
      await page.getByRole('button', { name: 'Delete account' }).click();
      await s.idle();
    },
    check(steps, files) {
      assert.equal(steps[1].dialog!.type, 'confirm');
      assert.match(pages(files), /this\.page\.once\('dialog', \(dialog\) => dialog\.accept\(\)\);/);
      assert.match(spec(files), /toHaveText\('Account deleted'\)|toContainText\('Account deleted'\)/);
    },
  },
  {
    name: 'download',
    start: '/download.html',
    async drive(s, page) {
      await page.getByRole('link', { name: 'Download sales report' }).click();
      await s.idle();
    },
    check(steps, files) {
      assert.equal(steps[1].download!.suggestedFilename, 'report.csv');
      assert.match(spec(files), /expect\(download\.suggestedFilename\(\)\)\.toBe\('report\.csv'\)/);
    },
  },
  {
    name: 'upload',
    start: '/upload.html',
    async drive(s, page) {
      await page.getByLabel('Resume').setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
      await s.idle();
    },
    check(steps, files) {
      assert.deepEqual(steps[1].files, ['resume.txt']);
      assert.ok(files.some((f) => f.path === 'assets/resume.txt'));
      assert.match(spec(files), /'tests\/assets\/resume\.txt'/);
    },
  },
  {
    name: 'drag',
    start: '/drag.html',
    async drive(s, page) {
      await s.setMode('drag');
      await page.getByText('Write tests').click();
      await page.getByRole('region', { name: 'Done' }).click({ position: { x: 150, y: 90 } });
      await s.idle();
      await s.setMode('record');
    },
    check(steps, files) {
      const d = steps.find((x) => x.kind === 'drag')!;
      assert.ok(d.target2);
      assert.match(pages(files), /\.dragTo\(this\.\w+\)/);
      assert.match(spec(files), /Moved to Done/);
    },
  },
  {
    name: 'spa',
    start: '/spa/home',
    async drive(s, page) {
      await page.getByRole('link', { name: 'Settings' }).click();
      await s.idle();
      await page.getByRole('checkbox', { name: 'Dark mode' }).click();
      await s.idle();
      await page.getByRole('button', { name: 'Save settings' }).click();
      await s.idle();
    },
    check(steps, files) {
      assert.deepEqual(steps.map((x) => x.kind), ['goto', 'click', 'check', 'click']);
      assert.match(spec(files), /toHaveURL\(\/\\\/spa\\\/settings\/\)/);
      assert.ok(files.some((f) => f.path === 'pages/SettingsPage.ts'));
    },
  },
  {
    name: 'widgets',
    start: '/widgets.html',
    async drive(s, page) {
      await s.setMode('hover');
      await page.getByRole('button', { name: 'Account menu' }).click();
      await s.idle();
      await s.setMode('record');
      await page.getByRole('link', { name: 'Profile' }).click();
      await s.idle();
      await page.getByText('Untitled note').dblclick();
      await s.idle();
      await page.getByText('Right-click me').click({ button: 'right' });
      await s.idle();
      await page.getByRole('combobox', { name: 'Country' }).selectOption('Germany');
      await s.idle();
      await page.getByRole('searchbox', { name: 'Search' }).fill('playwright');
      await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
      await s.idle();
      await s.setMode('scroll');
      await page.getByRole('button', { name: 'Back to top' }).click();
      await s.idle();
      await s.setMode('record');
      await page.getByRole('button', { name: 'Back to top' }).click();
      await s.idle();
    },
    check(steps, files) {
      assert.deepEqual(steps.map((x) => x.kind), ['goto', 'hover', 'click', 'dblclick', 'rightclick', 'select', 'fill', 'press', 'scrollIntoView', 'click']);
      const code = pages(files);
      assert.match(code, /\.hover\(\);/);
      assert.match(code, /\.dblclick\(\);/);
      assert.match(code, /\.click\(\{ button: 'right' \}\);/);
      assert.match(code, /\.selectOption\(/);
      assert.match(code, /\.press\('Enter'\);/);
      assert.match(code, /\.scrollIntoViewIfNeeded\(\);/);
      assert.match(spec(files), /await test\.step\(/);
    },
  },
  {
    name: 'storage-state',
    start: '/account.html',
    storageState: { cookies: [], origins: [{ origin: '__ORIGIN__', localStorage: [{ name: 'user', value: 'standard_user' }] }] },
    async drive(s, page) {
      assert.match(await page.locator('#hello').innerText(), /standard_user/);
      await page.getByRole('button', { name: 'Show orders' }).click();
      await s.idle();
    },
    check(steps, files) {
      assert.equal(steps[0].page.url.endsWith('/account.html'), true, 'stayed logged in (no redirect)');
      assert.match(spec(files), /storageState: 'auth\.json'/);
    },
  },
];

describe('special cases: fixture page -> record -> generated spec passes', () => {
  let server: FixtureServer;
  before(async () => {
    server = await startFixtureServer(0);
  });
  after(async () => server.close());

  for (const c of CASES) {
    it(c.name, async () => {
      let stateFile: string | undefined;
      if (c.storageState) {
        // written as UTF-16 with BOM, like PowerShell's Out-File, to test decoding
        const json = JSON.stringify(c.storageState).replace('__ORIGIN__', server.url);
        stateFile = path.join(ROOT, '.tmp', `auth-${c.name}.json`);
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]));
      }
      const s = await RecorderSession.launch({ url: server.url + c.start, viewport: VIEWPORT, headless: true, testIdAttr: 'data-testid', storageState: stateFile });
      let steps: Step[];
      try {
        await s.start();
        await c.drive(s, s.pages[0]);
        steps = JSON.parse(JSON.stringify(s.steps));
      } finally {
        await s.close();
      }
      const { files } = generate(steps, {
        flowName: c.name + ' flow',
        viewport: VIEWPORT,
        baseURL: server.url,
        style: 'pom',
        keepSecrets: false,
        outDirFromCwd: 'tests',
        storageState: c.storageState ? 'auth.json' : undefined,
      });
      c.check(steps, files);
      const { dir, outDir } = makeProject('case-' + c.name, files);
      if (c.storageState) fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(c.storageState).replace('__ORIGIN__', server.url));
      const tc = await typecheck(outDir);
      assert.equal(tc.code, 0, tc.output);
      const r = await runPlaywright(dir, { TPHUB_BASE_URL: server.url });
      assert.equal(r.code, 0, `generated spec failed:\n${r.output}\n\n${files.map((f) => '=== ' + f.path + '\n' + f.content).join('\n')}`);
    });
  }
});
