#!/usr/bin/env node
import path from 'node:path';
import { parseArgs, str, bool, parseViewport } from '../util/args';
import { discoverModules, moduleDirectory } from './modules';
import { runTests } from './runner';
import { checkReadiness } from './doctor';

async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'init') {
    const { initProject } = await import('./init');
    const written = initProject(root);
    console.log(written.length ? `Created: ${written.join(', ')}` : 'Existing configuration preserved.');
    console.log('Module ready: tests/my-product. Record with vortex-qa record --url <url> --module my-product');
    return;
  }
  if (cmd === 'scout') {
    const url = str(args, 'url');
    const selector = str(args, 'selector');
    if (!url || !selector) throw new Error('Usage: vortex-qa scout --url <url> --selector <unique-css-selector>');
    const { runScout } = await import('../commands/scout');
    console.log(JSON.stringify(await runScout(url, selector), null, 2));
    return;
  }
  if (cmd === 'doctor') {
    const checks = await checkReadiness({ out: path.join(root, 'tests'), url: str(args, 'url'), panelPort: Number(str(args, 'panel-port', '4800')), storageState: str(args, 'storage-state'), launchBrowser: true });
    for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.message}`);
    if (checks.some(check => !check.ok)) process.exitCode = 1;
    return;
  }
  if (cmd === 'modules') { console.log(discoverModules(root).join('\n')); return; }
  if (cmd === 'run') {
    const result = await runTests(root, { module: str(args, 'module'), file: str(args, 'file'), title: str(args, 'title'), list: bool(args, 'list'), headed: bool(args, 'headed') }, s => process.stdout.write(s));
    // Execution streams its output; discovery and list results are returned.
    if (bool(args, 'list') || !result.output.includes('Running ')) console.log(result.output);
    process.exitCode = result.code;
    return;
  }
  if (cmd === 'record') {
    if (str(args, 'out')) throw new Error('Framework recordings use a selected module. Use --module, or use npm run record:legacy for the original --out option.');
    const module = str(args, 'module');
    if (module) moduleDirectory(root, module);
    const { runRecord } = await import('../commands/record');
    await runRecord('record', {
      frameworkRoot: root, module, url: str(args, 'url'), out: path.join(root, 'tests'), name: str(args, 'name'),
      viewport: parseViewport(str(args, 'viewport')), browser: 'chromium',
      panelPort: Number(str(args, 'panel-port', '4800')), style: str(args, 'style') === 'flat' ? 'flat' : 'pom',
      storageState: str(args, 'storage-state'), saveState: str(args, 'save-state'), baseURL: str(args, 'base-url') ?? process.env.BASE_URL,
      testIdAttr: str(args, 'test-id-attr') ?? process.env.TEST_ID_ATTRIBUTE, allowCss: bool(args, 'allow-css'), keepSecrets: false,
      overwrite: false, coordsRatio: bool(args, 'coords-ratio'), openPanel: !bool(args, 'no-panel-open'),
      headless: bool(args, 'headless'), screenshots: bool(args, 'screenshots'),
    });
    return;
  }
  console.log('Vortex QA v2\n  vortex-qa init\n  vortex-qa scout --url <url> --selector <unique-css-selector>\n  npm run qa:doctor\n  npm run qa -- modules\n  npm run qa -- record --url https://your-app.example --module my-product\n  npm run qa -- run [--module name | --file tests/module/flow/specs/flow.spec.ts] [--title "case name"] [--list] [--headed]');
  if (cmd && cmd !== 'help') process.exitCode = 1;
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
