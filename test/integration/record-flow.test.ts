// M2 acceptance: record login -> add item -> open cart through the real capture path,
// generate files, type-check them and run the generated spec twice.
// M4 mutation tests: the same spec survives a class rename and fails clearly on a text change.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { generate } from '../../src/codegen/index';
import { startFixtureServer, type FixtureServer } from '../../src/fixtures/server';
import { RecorderSession } from '../../src/recorder/session';
import type { GeneratedFile, Step } from '../../src/types';
import { allCode, makeProject, runPlaywright, typecheck } from './helpers';

const VIEWPORT = { width: 1280, height: 720 };

async function recordShopFlow(server: FixtureServer): Promise<Step[]> {
  const s = await RecorderSession.launch({ url: server.url + '/', viewport: VIEWPORT, headless: true, testIdAttr: 'data-testid' });
  try {
    await s.start();
    const page = s.pages[0];
    // The test drives the page like a user would; the recorder intercepts and replays.
    await page.getByPlaceholder('Username').fill('standard_user');
    await page.getByPlaceholder('Password').fill('secret_sauce');
    await page.getByRole('button', { name: 'Login' }).click();
    await s.idle();
    await page.getByRole('listitem').filter({ hasText: 'Trail Backpack' }).getByRole('button', { name: 'Add to cart' }).click();
    await s.idle();
    await page.getByRole('link', { name: 'Cart' }).click();
    await s.idle();
    return JSON.parse(JSON.stringify(s.steps));
  } finally {
    await s.close();
  }
}

describe('record -> generate -> run (POM)', () => {
  let server: FixtureServer;
  let steps: Step[];
  let files: GeneratedFile[];
  let dir: string;
  let outDir: string;

  before(async () => {
    server = await startFixtureServer(0);
    steps = await recordShopFlow(server);
    files = generate(steps, { flowName: 'standard user adds the backpack to the cart', viewport: VIEWPORT, baseURL: server.url, style: 'pom', keepSecrets: false }).files;
    ({ dir, outDir } = makeProject('pom', files));
  });
  after(async () => server.close());

  it('records the expected steps with verified locators', () => {
    const kinds = steps.map((s) => s.kind);
    assert.deepEqual(kinds, ['goto', 'fill', 'fill', 'click', 'click', 'click']);
    assert.equal(steps[3].target!.code, "page.getByRole('button', { name: 'Login' })");
    assert.equal(steps[4].target!.kind, 'scoped');
    assert.equal(steps[2].secret, true);
  });

  it('suggests the URL change and the cart badge', () => {
    assert.equal(steps[3].suggestions.find((s) => s.accepted)!.assertion.type, 'urlMatches');
    const badge = steps[4].suggestions.find((s) => s.accepted)!;
    assert.equal(badge.assertion.target!.code, "page.getByTestId('cart-badge')");
    assert.equal(badge.assertion.expected, '1');
  });

  it('writes page objects, a spec and masked fixtures', () => {
    const names = files.map((f) => f.path).sort();
    assert.deepEqual(names, ['fixtures/standard-user-adds-the-backpack-to-the-cart.data.json', 'pages/InventoryPage.ts', 'pages/LoginPage.ts', 'specs/standard-user-adds-the-backpack-to-the-cart.spec.ts']);
    const data = JSON.parse(files.find((f) => f.path.endsWith('.data.json'))!.content);
    assert.equal(data.password, '<password>');
    const code = allCode(files);
    assert.ok(!/waitForTimeout|page\.\$|xpath=|\/\/html/.test(code), 'no forbidden calls');
    assert.ok(code.includes("async login(username: string, password: string)"));
    assert.ok(code.includes("await inventory.addToCart('Trail Backpack');"));
    assert.ok(code.includes("await expect(inventory.cartBadge).toHaveText('1');"));
  });

  it('type-checks with tsc --noEmit', async () => {
    const r = await typecheck(outDir);
    assert.equal(r.code, 0, r.output);
  });

  it('passes when run with Playwright, twice in a row', async () => {
    const env = { TPHUB_BASE_URL: server.url, TEST_PASSWORD: 'secret_sauce' };
    const first = await runPlaywright(dir, env);
    assert.equal(first.code, 0, first.output);
    const second = await runPlaywright(dir, env);
    assert.equal(second.code, 0, second.output);
  });

  it('survives a class-name change (roles and text unchanged)', async () => {
    server.setMutation('classes');
    try {
      const r = await runPlaywright(dir, { TPHUB_BASE_URL: server.url, TEST_PASSWORD: 'secret_sauce' });
      assert.equal(r.code, 0, r.output);
    } finally {
      server.setMutation('none');
    }
  });

  it('fails with a clear message when a button text changes', async () => {
    server.setMutation('text');
    try {
      const r = await runPlaywright(dir, { TPHUB_BASE_URL: server.url, TEST_PASSWORD: 'secret_sauce' });
      assert.notEqual(r.code, 0, 'spec should fail');
      assert.match(r.output, /Add to cart/);
      assert.match(r.output, /toBeVisible|Timeout|waiting for/);
    } finally {
      server.setMutation('none');
    }
  });

  it('also generates a flat spec that passes', async () => {
    const flat = generate(steps, { flowName: 'flat flow', viewport: VIEWPORT, baseURL: server.url, style: 'flat', keepSecrets: false }).files;
    const p = makeProject('flat', flat);
    const tc = await typecheck(p.outDir);
    assert.equal(tc.code, 0, tc.output);
    const r = await runPlaywright(p.dir, { TPHUB_BASE_URL: server.url, TEST_PASSWORD: 'secret_sauce' });
    assert.equal(r.code, 0, r.output);
  });
});
