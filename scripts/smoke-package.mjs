import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const archive = path.join(root, 'artifacts', `${name}-${version}.tgz`);
const consumer = mkdtempSync(path.join(os.tmpdir(), 'vortex-package-smoke-'));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: consumer, env: process.env });
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Package smoke command timed out')); }, 120000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(output);
      else reject(new Error(`Command failed (${code}): ${output}`));
    });
  });
}
let fixture;
try {
  writeFileSync(path.join(consumer, 'package.json'), '{"private":true}');
  await run([process.env.npm_execpath, 'install', '--ignore-scripts', '--no-audit', '--no-fund', archive]);
  const installed = path.join(consumer, 'node_modules', name);
  const cli = path.join(installed, 'dist/framework/cli.js');
  await run([cli, 'init']);
  assert.match(await run([cli, 'doctor', '--panel-port', '0']), /PASS Browser/);
  const require = createRequire(import.meta.url);
  const { startFixtureServer } = require(path.join(installed, 'dist/fixtures/server.js'));
  fixture = await startFixtureServer(0);
  const scout = JSON.parse(await run([cli, 'scout', '--url', fixture.url + '/', '--selector', 'button[type="submit"]']));
  assert.equal(scout.info.name, 'Login');
  writeFileSync(path.join(consumer, 'tests/my-product/package-smoke.spec.ts'), `import {test,expect} from '@playwright/test';\ntest('installed package browser workflow',async({page})=>{await page.goto(${JSON.stringify(fixture.url + '/')});await expect(page.getByRole('button',{name:'Login'})).toBeVisible();});\n`);
  assert.match(await run([cli, 'run', '--module', 'my-product']), /1 passed/);
  const history = JSON.parse(await run([cli, 'history', '--json']));
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'passed');
  const report = (await run([cli, 'report', '--run', history[0].id, '--path'])).trim();
  assert.ok(readFileSync(path.join(report, 'index.html'), 'utf8').includes('<html'));
  console.log('Package smoke passed: clean consumer installation, init, browser doctor, shared locator engine, packaged fixtures, native test run, persistent history and report lookup.');
} finally {
  await fixture?.close();
  rmSync(consumer, { recursive: true, force: true });
}
