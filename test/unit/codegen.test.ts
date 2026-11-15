import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { camelCase, formatTs, humanize, uniqueName, wrapChain } from '../../src/codegen/format';
import { generate } from '../../src/codegen/index';
import { groupSteps } from '../../src/codegen/model';
import { clickMethodName, pageClassName, paramName, propName } from '../../src/codegen/naming';
import { generatedName, lineDiff, saveFiles } from '../../src/codegen/save';
import type { Step, TargetRef } from '../../src/types';

function target(over: Partial<TargetRef> = {}): TargetRef {
  return {
    chain: { frames: [], parts: [{ kind: 'role', role: 'button', name: over.name ?? 'Login' }] },
    code: `page.getByRole('button', { name: '${over.name ?? 'Login'}' })`,
    score: 90,
    kind: 'role',
    warnings: [],
    role: 'button',
    name: 'Login',
    tag: 'button',
    text: 'Login',
    inputType: null,
    label: null,
    placeholder: null,
    testId: null,
    nameAttr: null,
    anchor: null,
    describe: 'button "Login"',
    ...over,
  };
}

const input = (name: string, extra: Partial<TargetRef> = {}) =>
  target({ name, role: 'textbox', tag: 'input', inputType: 'text', placeholder: name, chain: { frames: [], parts: [{ kind: 'placeholder', value: name }] }, code: `page.getByPlaceholder('${name}')`, describe: `placeholder "${name}"`, ...extra });

let n = 0;
function step(kind: Step['kind'], t: TargetRef | null, url: string, extra: Partial<Step> = {}): Step {
  return { id: `s${++n}`, kind, target: t, page: { url, title: '', heading: null, tab: 0 }, preAssert: !!t, clickStyle: 'locator', suggestions: [], warnings: [], createdAt: 0, ...extra };
}

describe('naming', () => {
  it('names pages from routes', () => {
    assert.equal(pageClassName('https://x.test/inventory.html'), 'InventoryPage');
    assert.equal(pageClassName('https://x.test/checkout-step-one.html'), 'CheckoutStepOnePage');
    assert.equal(pageClassName('https://x.test/product/123'), 'ProductPage');
    assert.equal(pageClassName('https://x.test/users/42/edit'), 'UsersEditPage');
    assert.equal(pageClassName('https://x.test/', { hasPassword: true }), 'LoginPage');
    assert.equal(pageClassName('https://x.test/', { heading: 'Dashboard' }), 'DashboardPage');
    assert.equal(pageClassName('https://x.test/app#/settings'), 'SettingsPage');
  });

  it('names locator properties from accessible names and roles', () => {
    assert.equal(propName(target()), 'loginButton');
    assert.equal(propName(input('Username')), 'usernameInput');
    assert.equal(propName(target({ name: 'Cart', role: 'link' })), 'cartLink');
    assert.equal(propName(target({ name: '', text: '1', role: null, tag: 'span', testId: 'cart-badge' })), 'cartBadge');
    assert.equal(propName(target({ name: '', text: 'Saved!', role: 'status', tag: 'div' })), 'statusMessage');
  });

  it('derives parameter and method names', () => {
    assert.equal(paramName('usernameInput'), 'username');
    assert.equal(clickMethodName(target(), 'click', 'Login', true), 'login');
    assert.equal(clickMethodName(target({ name: 'Continue' }), 'click', 'Checkout', true), 'continueCheckout');
    assert.equal(clickMethodName(target({ name: 'Add to cart' }), 'click', 'Inventory', false), 'addToCart');
    assert.equal(clickMethodName(target({ name: 'Cart', role: 'link' }), 'click', 'Inventory', false), 'openCart');
    assert.equal(clickMethodName(target({ name: 'Delete' }), 'click', 'Users', false), 'clickDelete');
  });

  it('formats identifiers and resolves clashes deterministically', () => {
    assert.equal(camelCase('Add to cart (3)'), 'addToCart3');
    assert.equal(humanize('addToCart'), 'Add to cart');
    const taken = new Set(['loginButton']);
    assert.equal(uniqueName('loginButton', taken), 'loginButton2');
    assert.equal(uniqueName('loginButton', taken), 'loginButton3');
  });
});

describe('formatting', () => {
  it('wraps long locator chains like Prettier', () => {
    const line = "    this.addToCartButton = this.page.getByRole('listitem').filter({ hasText: 'Trail Backpack' }).getByRole('button', { name: 'Add to cart' });";
    const out = wrapChain(line);
    assert.equal(out.split('\n').length, 4);
    assert.ok(out.split('\n')[1].startsWith('      .getByRole'));
  });
  it('collapses blank lines and trims', () => {
    assert.equal(formatTs('a;  \n\n\n\nb;\n\n'), 'a;\n\nb;\n');
  });
});

describe('code generation', () => {
  const base = 'https://shop.test';
  const login = [
    step('goto', null, base + '/', { value: base + '/' }),
    step('fill', input('Username'), base + '/', { value: 'standard_user' }),
    step('fill', input('Password', { inputType: 'password' }), base + '/', { value: 'secret', secret: true }),
    step('click', target(), base + '/', {
      suggestions: [{ id: 'x', assertion: { type: 'urlMatches', target: null, expected: '\\/inventory', regex: true }, label: 'URL changed to /inventory', reason: 'navigated', score: 95, accepted: true, pageUrl: base + '/inventory' }],
    }),
    step('click', target({ name: 'Add to cart', describe: 'button "Add to cart"' }), base + '/inventory'),
  ];

  it('groups fills and the submit click into one intention', () => {
    const groups = groupSteps(login);
    assert.deepEqual(groups.map((g) => g.length), [1, 3, 1]);
  });

  it('generates a login() method with parameters and masks the password', () => {
    const { files } = generate(login, { flowName: 'Log in', viewport: { width: 1280, height: 720 }, baseURL: base, style: 'pom', keepSecrets: false });
    const loginPage = files.find((f) => f.path === 'pages/LoginPage.ts')!.content;
    assert.match(loginPage, /async login\(username: string, password: string\) \{/);
    assert.match(loginPage, /async goto\(\) \{\n    await this\.page\.goto\('\/'\);/);
    const spec = files.find((f) => f.path === 'specs/log-in.spec.ts')!.content;
    assert.match(spec, /await login\.login\(data\.username, process\.env\.TEST_PASSWORD \?\? data\.password\);/);
    assert.match(spec, /await expect\(page\)\.toHaveURL\(\/\\\/inventory\/\); \/\/ suggested: URL changed/);
    assert.match(spec, /await inventory\.expectLoaded\(\);/);
    const data = JSON.parse(files.find((f) => f.path.endsWith('.data.json'))!.content);
    assert.deepEqual(data, { username: 'standard_user', password: '<password>' });
  });

  it('keeps secrets only with --keep-secrets', () => {
    const { files } = generate(login, { flowName: 'Log in', viewport: { width: 1280, height: 720 }, style: 'pom', keepSecrets: true });
    assert.equal(JSON.parse(files.find((f) => f.path.endsWith('.data.json'))!.content).password, 'secret');
  });

  it('wraps blocks in test.step for long flows and hoists nothing unnecessary', () => {
    const many = [...login];
    for (let i = 0; i < 8; i++) many.push(step('click', target({ name: `Tab ${String.fromCharCode(65 + i)}`, describe: `tab ${i}` }), base + '/inventory'));
    const spec = generate(many, { flowName: 'long', viewport: { width: 800, height: 600 }, style: 'pom', keepSecrets: false }).files[0].content;
    assert.match(spec, /await test\.step\('Login', async \(\) => \{/);
    assert.match(spec, /test\.use\(\{ viewport: \{ width: 800, height: 600 \} \}\);/);
  });

  it('emits coordinate fallbacks through utils/smart.ts', () => {
    const s = step('click', target(), base + '/', { clickStyle: 'fallback', coords: { x: 100, y: 50, vw: 1280, vh: 720 } });
    const { files } = generate([login[0], s], { flowName: 'coords', viewport: { width: 1280, height: 720 }, style: 'pom', keepSecrets: false });
    assert.ok(files.some((f) => f.path === 'utils/smart.ts'));
    assert.match(files.find((f) => f.path.startsWith('pages/'))!.content, /await clickOrAt\(this\.page, this\.loginButton, \{ x: 100, y: 50 \}\);/);
  });

  it('never emits waitForTimeout', () => {
    const { files } = generate(login, { flowName: 'x', viewport: { width: 1280, height: 720 }, style: 'flat', keepSecrets: false });
    assert.ok(!files.some((f) => f.content.includes('waitForTimeout')));
  });
});

describe('saving', () => {
  it('writes .generated files instead of overwriting edits', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tphub-save-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    saveFiles([{ path: 'pages/LoginPage.ts', content: 'v1\n' }], dir, { cwd: dir });
    fs.writeFileSync(path.join(dir, 'pages', 'LoginPage.ts'), 'v1 edited by hand\n');
    const r = saveFiles([{ path: 'pages/LoginPage.ts', content: 'v2\n' }], dir, { cwd: dir });
    assert.equal(r[0].status, 'generated-alongside');
    assert.ok(fs.existsSync(path.join(dir, 'pages', 'LoginPage.generated.ts')));
    assert.equal(fs.readFileSync(path.join(dir, 'pages', 'LoginPage.ts'), 'utf8'), 'v1 edited by hand\n');
    const o = saveFiles([{ path: 'pages/LoginPage.ts', content: 'v2\n' }], dir, { cwd: dir, overwrite: true });
    assert.equal(o[0].status, 'overwritten');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('names generated twins and counts diffs', () => {
    assert.equal(generatedName('specs/a.spec.ts'), 'specs/a.generated.spec.ts');
    assert.equal(generatedName('fixtures/a.data.json'), 'fixtures/a.generated.data.json');
    assert.deepEqual(lineDiff('a\nb\nc', 'a\nc\nd'), { added: 1, removed: 1 });
  });
});
