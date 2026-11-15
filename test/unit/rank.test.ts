import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dynamicInfo,
  isStableId,
  isVolatileValue,
  looksDynamic,
  looksGenerated,
  looksUtilityClass,
  rankCandidates,
  scoreCandidate,
  stableClasses,
  stablePart,
  stableRegex,
} from '../../src/locators/rank';
import type { Candidate } from '../../src/types';

describe('dynamic text detection', () => {
  const dynamic = [
    '6 new notifications',
    'Total: $42.10',
    'Order #482913',
    'Updated 5 minutes ago',
    'Delivered on Oct 20',
    '2026-10-20',
    '10/20/2026',
    'Starts at 10:30 am',
    'Inbox (3)',
    '45%',
    'TICKET-1234',
    '1',
  ];
  for (const t of dynamic) it(`flags "${t}"`, () => assert.equal(looksDynamic(t), true));

  const steady = ['Login', 'Add to cart', 'Sauce Labs Backpack', 'Continue Shopping', 'Your Cart', ''];
  for (const t of steady) it(`keeps "${t}" steady`, () => assert.equal(looksDynamic(t), false));

  it('treats digits next to words as a weak signal', () => {
    assert.equal(dynamicInfo('iPhone 15 case').level, 1);
    assert.equal(dynamicInfo('Total: $42.10').level, 2);
  });

  it('allows counts and prices as expected values but not dates or ids', () => {
    assert.equal(isVolatileValue('1'), false);
    assert.equal(isVolatileValue('$29.99'), false);
    assert.equal(isVolatileValue('Order #482913'), true);
    assert.equal(isVolatileValue('placed at 10:42:13 AM'), true);
  });
});

describe('stable part and regex', () => {
  it('keeps the label of a total', () => assert.equal(stablePart('Total: $42.10'), 'Total'));
  it('drops a leading count', () => assert.equal(stablePart('6 new notifications'), 'new notifications'));
  it('keeps the longest steady piece', () => assert.equal(stablePart('Item added to cart (3 items)'), 'Item added to cart'));
  it('anchors a regex on a steady prefix', () => assert.equal(stableRegex('Add to cart (3)'), '^Add to cart'));
  it('falls back to the steady middle', () => assert.equal(stableRegex('6 new notifications'), 'new notifications'));
  it('returns null for steady text', () => assert.equal(stableRegex('Login'), null));
  it('escapes regex characters', () => assert.equal(stableRegex('Price (USD): $10.00'), '^Price \\(USD\\)'));
});

describe('generated and utility names', () => {
  const generated = ['css-1x2y3z', 'ember123', ':r1:', 'a1b2c3d4e5', 'Button_primary__3xYz1', 'item-42', 'sc-AxjAm', 'jsx-2042', 'ng-tns-c12-3'];
  for (const n of generated) it(`rejects generated "${n}"`, () => assert.equal(looksGenerated(n), true));
  const fine = ['login-button', 'inventory_item', 'cart', 'user-name', 'checkout'];
  for (const n of fine) it(`accepts "${n}"`, () => assert.equal(looksGenerated(n), false));

  it('detects Tailwind and Bootstrap utilities', () => {
    for (const c of ['px-2', 'md:flex', 'w-full', 'bg-red-500', 'rounded', 'd-flex', 'mt-3', 'hover:underline', 'w-[200px]']) {
      assert.equal(looksUtilityClass(c), true, c);
    }
    assert.equal(looksUtilityClass('inventory-item'), false);
  });

  it('filters classes down to steady hand-written ones', () => {
    assert.deepEqual(stableClasses(['btn', 'px-2', 'inventory-item', 'css-1x2y3z', 'active']), ['inventory-item']);
  });

  it('accepts only steady ids', () => {
    assert.equal(isStableId('login-button'), true);
    assert.equal(isStableId('r-4f9a2c1b'), false);
    assert.equal(isStableId('field3'), false);
    assert.equal(isStableId(null), false);
  });
});

describe('scoring and ranking', () => {
  const cand = (over: Partial<Candidate>): Candidate => ({
    kind: 'role',
    chain: { frames: [], parts: [{ kind: 'role', role: 'button', name: 'Login' }] },
    base: 90,
    dynamic: false,
    warnings: [],
    ...over,
  });

  it('scores a unique role locator at its base', () => {
    const r = scoreCandidate(cand({}), { count: 1, matchesTarget: true });
    assert.equal(r.usable, true);
    assert.equal(r.score, 90);
    assert.equal(r.code, "page.getByRole('button', { name: 'Login' })");
  });

  it('marks non-unique candidates unusable', () => {
    const r = scoreCandidate(cand({}), { count: 3, matchesTarget: false });
    assert.equal(r.usable, false);
    assert.equal(r.score, 0);
  });

  it('marks a unique match on a different element unusable', () => {
    assert.equal(scoreCandidate(cand({}), { count: 1, matchesTarget: false }).usable, false);
  });

  it('penalizes dynamic text strongly and weakly', () => {
    assert.equal(scoreCandidate(cand({ dynamic: true, dynamicLevel: 2 }), { count: 1, matchesTarget: true }).score, 55);
    assert.equal(scoreCandidate(cand({ dynamic: true, dynamicLevel: 1 }), { count: 1, matchesTarget: true }).score, 75);
  });

  it('penalizes climbing to an ancestor', () => {
    assert.equal(scoreCandidate(cand({ fromAncestor: 2 }), { count: 1, matchesTarget: true }).score, 80);
  });

  it('boosts CSS only with --allow-css', () => {
    const css = cand({ kind: 'css', base: 45, chain: { frames: [], parts: [{ kind: 'css', selector: '#login' }] } });
    assert.equal(scoreCandidate(css, { count: 1, matchesTarget: true }).score, 45);
    assert.equal(scoreCandidate(css, { count: 1, matchesTarget: true }, { allowCss: true }).score, 70);
  });

  it('picks the best usable candidate and keeps coords as last resort', () => {
    const coords = scoreCandidate({ kind: 'coords', chain: { frames: [], parts: [] }, base: 10, dynamic: false, warnings: [] }, null);
    const testId = scoreCandidate(cand({ kind: 'testId', base: 100, chain: { frames: [], parts: [{ kind: 'testId', value: 'login' }] } }), { count: 2, matchesTarget: false });
    const role = scoreCandidate(cand({}), { count: 1, matchesTarget: true });
    const choice = rankCandidates([coords, testId, role]);
    assert.equal(choice.best.kind, 'role');
    const none = rankCandidates([coords, testId]);
    assert.equal(none.best.kind, 'coords');
  });
});
