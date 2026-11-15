import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAllCandidates, buildCandidates } from '../../src/locators/candidates';
import { regexLiteral, renderChain, renderChainWithParam, q } from '../../src/locators/render';
import type { ElementDescriptor } from '../../src/types';

export function desc(over: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    tag: 'button',
    role: 'button',
    name: 'Login',
    text: 'Login',
    testId: null,
    testIdAttr: 'data-testid',
    id: null,
    label: null,
    placeholder: null,
    alt: null,
    title: null,
    inputType: null,
    nameAttr: null,
    classes: [],
    rect: { x: 10, y: 10, width: 80, height: 30 },
    editable: false,
    checked: null,
    disabled: false,
    inShadow: false,
    headingLevel: null,
    repeat: null,
    ...over,
  };
}

const codes = (d: ElementDescriptor, frames: string[] = []) => buildCandidates(d, frames).map((c) => renderChain(c.chain));

describe('candidate building', () => {
  it('orders test id first, then role', () => {
    const c = buildCandidates(desc({ testId: 'login-btn' }));
    assert.equal(c[0].kind, 'testId');
    assert.equal(c[1].kind, 'role');
  });

  it('builds label and placeholder candidates for inputs, no getByText', () => {
    const list = codes(desc({ tag: 'input', role: 'textbox', name: 'Username', text: '', placeholder: 'Username', label: 'User name', inputType: 'text' }));
    assert.ok(list.includes("page.getByPlaceholder('Username')"));
    assert.ok(list.includes("page.getByLabel('User name')"));
    assert.ok(!list.some((c) => c.includes('getByText')));
  });

  it('uses a regex for dynamic names', () => {
    const list = codes(desc({ name: 'Add to cart (3)', text: 'Add to cart (3)' }));
    assert.ok(list.includes("page.getByRole('button', { name: /^Add to cart/ })"), list.join('\n'));
  });

  it('skips generated ids and utility classes for CSS', () => {
    const list = codes(desc({ id: 'r-4f9a2c1b', classes: ['px-2', 'css-1x2y3z'] }));
    assert.ok(!list.some((c) => c.includes('locator(')), list.join('\n'));
  });

  it('builds a steady id CSS candidate with a warning', () => {
    const c = buildCandidates(desc({ id: 'login-button' })).find((x) => x.kind === 'css')!;
    assert.equal(renderChain(c.chain), "page.locator('#login-button')");
    assert.ok(c.warnings[0].includes('CSS'));
  });

  it('builds a scoped locator for repeated rows', () => {
    const d = desc({
      name: 'Edit',
      text: 'Edit',
      repeat: { containerRole: 'row', containerTag: 'tr', containerClasses: [], containerTestId: null, siblings: 3, anchorText: 'Alice Brown', index: 0 },
    });
    const scoped = buildCandidates(d).find((c) => c.kind === 'scoped')!;
    assert.equal(renderChain(scoped.chain), "page.getByRole('row').filter({ hasText: 'Alice Brown' }).getByRole('button', { name: 'Edit' })");
    assert.equal(scoped.anchor, 'Alice Brown');
    assert.equal(
      renderChainWithParam(scoped.chain, 'this.page', 'name'),
      "this.page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Edit' })",
    );
  });

  it('uses the container class when the card has no role', () => {
    const d = desc({
      name: 'Choose',
      role: 'link',
      tag: 'a',
      repeat: { containerRole: null, containerTag: 'div', containerClasses: ['card'], containerTestId: null, siblings: 2, anchorText: 'Pro plan', index: 1 },
    });
    const scoped = buildCandidates(d).find((c) => c.kind === 'scoped')!;
    assert.equal(renderChain(scoped.chain), "page.locator('.card').filter({ hasText: 'Pro plan' }).getByRole('link', { name: 'Choose' })");
  });

  it('prefixes iframe chains', () => {
    const list = codes(desc(), ['iframe[name="pay"]']);
    assert.equal(list[0], "page.frameLocator('iframe[name=\"pay\"]').getByRole('button', { name: 'Login' })");
  });

  it('climbs to a small interactive ancestor and always ends with coords', () => {
    const icon = desc({ tag: 'svg', role: null, name: '', text: '', rect: { x: 0, y: 0, width: 16, height: 16 } });
    icon.ancestors = [{ ...desc({ name: 'Export', text: 'Export' }), level: 1 }];
    const all = buildAllCandidates(icon);
    assert.ok(all.some((c) => c.fromAncestor === 1 && c.kind === 'role'));
    assert.equal(all[all.length - 1].kind, 'coords');
  });
});

describe('rendering helpers', () => {
  it('quotes strings safely', () => {
    assert.equal(q("it's"), "'it\\'s'");
    assert.equal(q('a\\b\nc'), "'a\\\\b\\nc'");
  });
  it('renders regex literals with slashes escaped', () => {
    assert.equal(regexLiteral('a/b'), '/a\\/b/');
    assert.equal(regexLiteral('^Add', 'i'), '/^Add/i');
  });
  it('renders exact text and nth', () => {
    const code = renderChain({ frames: [], parts: [{ kind: 'text', value: 'Edit', exact: true }, { kind: 'nth', index: 2 }] });
    assert.equal(code, "page.getByText('Edit', { exact: true }).nth(2)");
  });
});
