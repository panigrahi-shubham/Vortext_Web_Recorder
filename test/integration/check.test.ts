import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { runCheck, type CheckResult } from '../../src/commands/check';
import { startFixtureServer, type FixtureServer } from '../../src/fixtures/server';

const SNAP = path.join(__dirname, '..', '..', 'fixtures', 'snapshots', 'users-table.html');
const opts = { testIdAttr: 'data-testid', allowCss: false };
const best = (r: CheckResult[], i: number) => r[i].choice.best;

describe('check command (M1 acceptance)', () => {
  let results: CheckResult[];
  let server: FixtureServer;
  before(async () => {
    results = await runCheck(SNAP, opts);
    server = await startFixtureServer(0);
  });
  after(async () => server.close());

  it('gives every interactive element a usable locator', () => {
    assert.ok(results.length >= 15, `found ${results.length}`);
    for (const r of results) assert.ok(r.choice.best.usable, r.element);
  });

  it('prefers the test id', () => {
    const r = results.find((x) => x.element.includes('Add user'))!;
    assert.equal(r.choice.best.code, "page.getByTestId('add-user')");
    assert.equal(r.choice.best.score, 100);
  });

  it('scopes repeated row buttons by a unique cell text', () => {
    const edits = results.filter((x) => x.element.endsWith('Edit'));
    assert.equal(edits.length, 3);
    assert.equal(edits[1].choice.best.code, "page.getByRole('row').filter({ hasText: 'Bob Singh' }).getByRole('button', { name: 'Edit' })");
    assert.equal(edits[1].choice.best.kind, 'scoped');
  });

  it('penalizes dynamic text and uses its steady part', () => {
    const r = results.find((x) => x.element.includes('notifications'))!;
    assert.equal(r.choice.best.code, "page.getByRole('link', { name: /new notifications/ })");
    assert.ok(r.choice.best.score < 90);
    assert.ok(r.choice.best.warnings.some((w) => w.includes('dynamic')));
  });

  it('climbs from an icon to its labelled button and ignores generated classes', () => {
    const r = results.find((x) => x.element.includes('Export'))!;
    assert.equal(best(results, results.indexOf(r)).code, "page.getByRole('button', { name: 'Export' })");
    assert.ok(!r.choice.alternatives.some((a) => a.code.includes('sc-AxjAm') || a.code.includes('ember1234')));
  });

  it('works against the live demo site with a --selector filter', async () => {
    const live = await runCheck(server.url + '/inventory.html', { ...opts, selector: '.inventory-item button' });
    assert.equal(live.length, 6);
    assert.equal(live[0].choice.best.kind, 'scoped');
    assert.match(live[0].choice.best.code, /getByRole\('listitem'\)\.filter\(\{ hasText: '.+' \}\)\.getByRole\('button', \{ name: 'Add to cart' \}\)/);
  });
});
