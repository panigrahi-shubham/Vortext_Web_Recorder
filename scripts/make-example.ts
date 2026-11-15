// Regenerates examples/demo-shop by recording a full checkout on the fixture site.
//   npx tsx scripts/make-example.ts
import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../src/codegen/index';
import { recordingFile } from '../src/commands/recording';
import { saveFiles } from '../src/codegen/save';
import { startFixtureServer } from '../src/fixtures/server';
import { RecorderSession } from '../src/recorder/session';

(async () => {
  const server = await startFixtureServer(4900);
  const s = await RecorderSession.launch({ url: server.url + '/', viewport: { width: 1280, height: 720 }, headless: true, testIdAttr: 'data-testid' });
  await s.start();
  const page = s.pages[0];
  await page.getByPlaceholder('Username').fill('standard_user');
  await page.getByPlaceholder('Password').fill('secret_sauce');
  await page.getByRole('button', { name: 'Login' }).click();
  await s.idle();
  for (const item of ['Trail Backpack', 'Bike Light']) {
    await page.getByRole('listitem').filter({ hasText: item }).getByRole('button', { name: 'Add to cart' }).click();
    await s.idle();
  }
  await page.getByRole('link', { name: 'Cart' }).click();
  await s.idle();
  await page.getByRole('row').filter({ hasText: 'Bike Light' }).getByRole('button', { name: 'Remove' }).click();
  await s.idle();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await s.idle();
  await page.getByLabel('First Name').fill('Asha');
  await page.getByLabel('Last Name').fill('Rao');
  await page.getByLabel('Postal Code').fill('500038');
  await page.getByRole('checkbox', { name: 'I agree to the terms' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await s.idle();
  await page.getByRole('button', { name: 'Place order' }).click();
  await s.idle();
  const steps = s.steps;
  await s.close();
  const options = { flowName: 'standard user buys a backpack', viewport: { width: 1280, height: 720 }, baseURL: server.url, style: 'pom' as const, keepSecrets: false, outDirFromCwd: 'tests' };
  const root = path.join(__dirname, '..', 'examples', 'demo-shop');
  fs.rmSync(path.join(root, 'tests'), { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const { files } = generate(steps, options);
  const entries = saveFiles([...files, recordingFile(steps, options)], path.join(root, 'tests'), { cwd: root, overwrite: true });
  for (const e of entries) console.log(e.status, path.relative(root, e.file));
  await server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
