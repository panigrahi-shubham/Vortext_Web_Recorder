import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSettled, NetworkTracker } from '../../src/recorder/settle';
import { diffSnapshots, routePattern, urlRegexSource } from '../../src/suggest/suggest';
import type { PageSnapshot, SnapElement } from '../../src/types';
import { desc } from './candidates.test';

function el(key: string, over: Partial<SnapElement> = {}, d: Parameters<typeof desc>[0] = {}): SnapElement {
  return { key, d: desc(d), value: null, selected: null, expanded: null, pressed: null, volatile: null, landmark: false, ...over };
}
function snap(url: string, elements: SnapElement[], extra: Partial<PageSnapshot> = {}): PageSnapshot {
  return { url, title: 'Shop', elements, groups: [], focusedKey: null, ...extra };
}

describe('route normalization', () => {
  it('replaces ids in paths', () => assert.equal(routePattern('https://x.test/product/123/reviews?x=1'), '/product/:id/reviews'));
  it('replaces uuids and hex tokens', () => assert.equal(routePattern('https://x.test/o/3f2a9c1e-8b7d-4e2f-9a1b-0c2d3e4f5a6b'), '/o/:id'));
  it('keeps hash routes', () => assert.equal(routePattern('https://x.test/app#/cart/42'), '/app#/cart/:id'));
  it('builds a URL regex without host and volatile parts', () => {
    assert.equal(urlRegexSource('http://127.0.0.1:4900/inventory.html?session=abc'), '\\/inventory\\.html');
    assert.equal(urlRegexSource('https://x.test/product/123'), '\\/product\\/[^/?#]+');
    assert.equal(urlRegexSource('https://x.test/'), '\\/(?:[?#].*)?$');
  });
});

describe('before/after diff', () => {
  it('suggests the URL first on navigation, plus the top heading only', () => {
    const before = snap('https://x.test/', [el('a', {}, { name: 'Login' })]);
    const after = snap('https://x.test/inventory', [
      el('h1', { landmark: true }, { role: 'heading', name: 'Products', text: 'Products', headingLevel: 1 }),
      el('h2a', { landmark: true }, { role: 'heading', name: 'Backpack', text: 'Backpack', headingLevel: 2 }),
      el('btn', {}, { name: 'Add to cart' }),
    ], { title: 'Products' });
    const s = diffSnapshots(before, after);
    assert.equal(s[0].type, 'urlMatches');
    assert.ok(s.some((x) => x.label === "heading 'Products' appeared"));
    assert.ok(!s.some((x) => x.label.includes('Backpack')));
    assert.ok(!s.some((x) => x.label.includes('Add to cart')));
  });

  it('suggests a dialog that appeared above everything else', () => {
    const before = snap('https://x.test/c', [el('btn', {}, { name: 'Continue' })]);
    const after = snap('https://x.test/c', [el('btn', {}, { name: 'Continue' }), el('dlg', { volatile: 'dialog' }, { role: 'dialog', name: 'Confirm your order', tag: 'div' })]);
    const s = diffSnapshots(before, after);
    assert.equal(s[0].type, 'visible');
    assert.equal(s[0].label, "dialog 'Confirm your order' appeared");
  });

  it('asserts the steady part of a toast message', () => {
    const before = snap('https://x.test/c', []);
    const after = snap('https://x.test/c', [el('t', { volatile: 'toast' }, { role: 'status', name: '', text: 'Order #482913 placed', tag: 'div' })]);
    const s = diffSnapshots(before, after);
    assert.equal(s[0].type, 'textContains');
    assert.equal(s[0].expected, 'placed');
  });

  it('suggests not visible for a spinner or modal that disappeared', () => {
    const before = snap('https://x.test/c', [el('sp', { volatile: 'spinner' }, { role: 'progressbar', name: 'Loading', tag: 'span' })]);
    const after = snap('https://x.test/c', []);
    const s = diffSnapshots(before, after);
    assert.equal(s[0].type, 'hidden');
    assert.equal(s[0].side, 'before');
  });

  it('detects checkbox state changes', () => {
    const before = snap('https://x.test/c', [el('cb', {}, { role: 'checkbox', name: 'Terms', checked: false })]);
    const after = snap('https://x.test/c', [el('cb', {}, { role: 'checkbox', name: 'Terms', checked: true })]);
    const s = diffSnapshots(before, after, { actionKey: 'cb' });
    assert.equal(s[0].type, 'checked');
  });

  it('detects aria-expanded and aria-selected', () => {
    const before = snap('https://x.test/c', [el('acc', { expanded: false }, { name: 'Details' }), el('tab', { selected: false }, { role: 'tab', name: 'Billing' })]);
    const after = snap('https://x.test/c', [el('acc', { expanded: true }, { name: 'Details' }), el('tab', { selected: true }, { role: 'tab', name: 'Billing' })]);
    const s = diffSnapshots(before, after);
    assert.ok(s.some((x) => x.attrName === 'aria-expanded' && x.expected === 'true'));
    assert.ok(s.some((x) => x.attrName === 'aria-selected' && x.expected === 'true'));
  });

  it('suggests text changes but skips dates', () => {
    const before = snap('https://x.test/c', [el('b', {}, { role: null, tag: 'span', name: '', text: '1', testId: 'badge' }), el('d', {}, { role: null, tag: 'span', name: '', text: 'Saved 10:41' })]);
    const after = snap('https://x.test/c', [el('b', {}, { role: null, tag: 'span', name: '', text: '2', testId: 'badge' }), el('d', {}, { role: null, tag: 'span', name: '', text: 'Saved 10:42' })]);
    const s = diffSnapshots(before, after);
    assert.ok(s.some((x) => x.type === 'textEquals' && x.expected === '2'));
    assert.ok(!s.some((x) => String(x.expected).includes('10:42')));
  });

  it('suggests a count when a list changes length, one suggestion per element, max N', () => {
    const g = { key: 'ul|li', role: 'listitem', tag: 'li', classes: [], testId: null };
    const before = snap('https://x.test/c', [], { groups: [{ ...g, count: 3 }] });
    const after = snap('https://x.test/c', [], { groups: [{ ...g, count: 2 }] });
    const s = diffSnapshots(before, after, { maxSuggestions: 6 });
    assert.equal(s[0].type, 'countEquals');
    assert.equal(s[0].expected, 2);
  });

  it('ignores value changes caused by typing', () => {
    const before = snap('https://x.test/c', [el('i', { value: '' }, { tag: 'input', role: 'textbox', name: 'Email' })]);
    const after = snap('https://x.test/c', [el('i', { value: 'a@b.c' }, { tag: 'input', role: 'textbox', name: 'Email' })]);
    assert.equal(diffSnapshots(before, after, { actionKind: 'fill' }).length, 0);
  });
});

describe('settle detection', () => {
  it('needs both DOM and network quiet', () => {
    assert.equal(isSettled({ msSinceMutation: 400, inflight: 0, msSinceNetwork: 400, readyState: 'complete' }), true);
    assert.equal(isSettled({ msSinceMutation: 100, inflight: 0, msSinceNetwork: 400, readyState: 'complete' }), false);
    assert.equal(isSettled({ msSinceMutation: 400, inflight: 1, msSinceNetwork: 400, readyState: 'complete' }), false);
    assert.equal(isSettled({ msSinceMutation: 400, inflight: 0, msSinceNetwork: 400, readyState: 'loading' }), false);
  });

  it('ignores long-polling requests', () => {
    let now = 0;
    const t = new NetworkTracker(() => now);
    const req = (url: string, type = 'fetch') => ({ url: () => url, resourceType: () => type, headers: () => ({}) }) as never;
    t.onStart(req('https://x.test/api/poll'));
    t.onStart(req('https://x.test/img.png', 'image'));
    assert.equal(t.activeCount(), 0);
    const r = req('https://x.test/api/cart');
    t.onStart(r);
    assert.equal(t.activeCount(), 1);
    now = 5000; // open for 5 s: treated as a long-poll
    assert.equal(t.activeCount(), 0);
    t.onEnd(r);
    assert.equal(t.msSinceActivity(), 0);
  });
});
