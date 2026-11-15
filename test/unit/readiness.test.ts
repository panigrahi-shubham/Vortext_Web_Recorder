import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { it } from 'node:test';
import { checkReadiness } from '../../src/framework/doctor';
import { initProject } from '../../src/framework/init';

it('reports invalid URL, port and authentication JSON without exposing supplied secrets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-readiness-'));
  try {
    const state = path.join(root, 'auth.json');
    fs.writeFileSync(state, 'private-value-not-valid-json');
    const checks = await checkReadiness({ out: root, url: 'https://user:private-password@example.test', panelPort: -1, storageState: state });
    for (const name of ['Target URL', 'Panel port', 'Authentication state']) assert.equal(checks.find(c => c.name === name)?.ok, false);
    assert.doesNotMatch(JSON.stringify(checks), /private-password|private-value/);
    assert.deepEqual(fs.readdirSync(root), ['auth.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('detects occupied ports and releases its own port probe', async () => {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    const checks = await checkReadiness({ out: os.tmpdir(), panelPort: port });
    assert.equal(checks.find(c => c.name === 'Panel port')?.ok, false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  const checks = await checkReadiness({ out: os.tmpdir(), panelPort: port });
  assert.equal(checks.find(c => c.name === 'Panel port')?.ok, true);
});

it('initializes a consumer project repeatedly without overwriting existing config or tests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-init-'));
  try {
    fs.writeFileSync(path.join(root, 'playwright.config.js'), '// user configuration');
    assert.deepEqual(initProject(root), ['tsconfig.qa.json']);
    assert.deepEqual(initProject(root), []);
    assert.equal(fs.readFileSync(path.join(root, 'playwright.config.js'), 'utf8'), '// user configuration');
    assert.equal(fs.existsSync(path.join(root, 'playwright.config.ts')), false);
    assert.equal(fs.statSync(path.join(root, 'tests/my-product')).isDirectory(), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
