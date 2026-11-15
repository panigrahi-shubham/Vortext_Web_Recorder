import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { initProject } from '../../src/framework/init';
import { runTests } from '../../src/framework/runner';
import { listRuns, reportDirectory, runDirectory } from '../../src/framework/history';

it('preserves failed browser evidence across a passing run and ignores empty/discovery runs', { timeout: 90000 }, async () => {
  const project = path.resolve(__dirname, '../..');
  fs.mkdirSync(path.join(project, '.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.join(project, '.tmp', 'history-'));
  try {
    initProject(root);
    const file = path.join(root, 'tests/my-product/history.spec.ts');
    fs.writeFileSync(file, `import {test,expect} from '@playwright/test';
test('failure with evidence',async({page})=>{await page.setContent('<h1>Actual</h1>');await expect(page.locator('h1')).toHaveText('Expected',{timeout:100});});`);
    const failed = await runTests(root, {});
    assert.equal(failed.code, 1, failed.output);
    const failedDir = runDirectory(root, failed.runId!);
    assert.equal(listRuns(root)[0].status, 'failed');
    assert.ok(fs.existsSync(path.join(reportDirectory(root, failed.runId!), 'index.html')));
    const assets = fs.readdirSync(path.join(failedDir, 'artifacts'), { recursive: true }).map(String);
    assert.ok(assets.some(file => file.endsWith('.png')), 'Failure screenshot retained');
    assert.ok(assets.some(file => file.endsWith('.zip')), 'Failure trace retained');
    const originalResults = fs.readFileSync(path.join(failedDir, 'results.json'), 'utf8');
    fs.writeFileSync(file, `import {test,expect} from '@playwright/test';test('passing',async()=>{expect(2+2).toBe(4);});`);
    const passed = await runTests(root, {});
    assert.equal(passed.code, 0, passed.output);
    assert.notEqual(passed.runId, failed.runId);
    assert.deepEqual(listRuns(root).map(run => run.status), ['passed', 'failed']);
    assert.equal(fs.readFileSync(path.join(failedDir, 'results.json'), 'utf8'), originalResults);
    const latest = fs.readFileSync(path.join(root, 'reports/latest/run.json'), 'utf8');
    assert.equal(JSON.parse(latest).id, passed.runId);
    assert.equal((await runTests(root, { list: true })).code, 0);
    assert.notEqual((await runTests(root, { title: 'does not exist' })).code, 0);
    assert.equal(listRuns(root).length, 2);
    assert.equal(fs.readFileSync(path.join(root, 'reports/latest/run.json'), 'utf8'), latest);
    assert.throws(() => runDirectory(root, '../escape'), /Invalid run ID/);
    fs.writeFileSync(path.join(root, 'playwright.config.ts'), `import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./tests',reporter:'list'});`);
    const custom = await runTests(root, {});
    assert.equal(custom.code, 0, custom.output);
    assert.equal(listRuns(root)[0].htmlReport, false);
    assert.throws(() => reportDirectory(root, custom.runId!), /no HTML report/);
    assert.ok(fs.readFileSync(path.join(runDirectory(root, custom.runId!), 'output.log'), 'utf8').includes('1 passed'));
    assert.equal(fs.readFileSync(path.join(root, 'reports/latest/run.json'), 'utf8'), latest);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
