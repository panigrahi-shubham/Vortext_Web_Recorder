import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { auditText } from '../../src/commands/audit';
import { loadRecording, recordingFile, runGenerate, stripSecrets } from '../../src/commands/recording';
import type { Step } from '../../src/types';

describe('audit command', () => {
  const sample = [
    "await page.waitForTimeout(3000);",
    "const el = await page.$('#login');",
    "await page.locator('/html/body/div[2]/button').click();",
    "await page.locator('.css-1x2y3z').click();",
    "await page.getByRole('button').nth(2).click();",
    "expect(await page.locator('#x').isVisible()).toBe(true);",
    "const password = 'hunter22';",
    "await page.getByRole('button', { name: 'Login' }).click(); // waitForTimeout in a comment is fine",
  ].join('\n');
  const findings = auditText('x.spec.ts', sample);
  const rules = findings.map((f) => `${f.line}:${f.rule}`);
  it('flags fixed waits and element handles', () => {
    assert.ok(rules.includes('1:fixed-wait'));
    assert.ok(rules.includes('2:element-handle'));
  });
  it('flags absolute XPath and generated classes', () => {
    assert.ok(rules.includes('3:absolute-xpath'));
    assert.ok(rules.includes('4:unstable-class'));
  });
  it('flags positional locators, non web-first checks and hard-coded secrets', () => {
    assert.ok(rules.includes('5:nth'));
    assert.ok(rules.includes('6:non-web-first'));
    assert.ok(rules.includes('7:hardcoded-secret'));
  });
  it('ignores comments and good code', () => {
    assert.ok(!rules.some((r) => r.startsWith('8:')));
  });
});

describe('recordings', () => {
  const steps: Step[] = [
    { id: 's1', kind: 'goto', target: null, value: 'https://x.test/', page: { url: 'https://x.test/', title: '', heading: null, tab: 0 }, preAssert: false, clickStyle: 'locator', suggestions: [], warnings: [], createdAt: 0 },
    { id: 's2', kind: 'fill', target: null, value: 'p@ss', secret: true, page: { url: 'https://x.test/', title: '', heading: null, tab: 0 }, preAssert: false, clickStyle: 'locator', suggestions: [], warnings: [], createdAt: 0 },
  ];
  it('never stores secret values', () => {
    assert.equal(stripSecrets(steps)[1].value, '');
    const f = recordingFile(steps, { flowName: 'My Flow', viewport: { width: 1, height: 1 }, style: 'pom', keepSecrets: false });
    assert.equal(f.path, 'recordings/my-flow.recording.json');
    assert.ok(!f.content.includes('p@ss'));
  });
  it('regenerates code from a saved recording', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tphub-rec-'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    const f = recordingFile(steps.slice(0, 1), { flowName: 'Open', viewport: { width: 800, height: 600 }, style: 'pom', keepSecrets: false });
    const file = path.join(dir, 'recordings', 'open.recording.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, f.content);
    assert.equal(loadRecording(file).steps.length, 1);
    const report = runGenerate({ from: file, out: dir, style: 'flat', overwrite: false });
    assert.match(report, /specs[\\/]open\.spec\.ts/);
    assert.match(fs.readFileSync(path.join(dir, 'specs', 'open.spec.ts'), 'utf8'), /await page\.goto\('https:\/\/x\.test\/'\);/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
