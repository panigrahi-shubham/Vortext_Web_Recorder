// `record` and `demo` commands: launch the headed browser, the side panel, and save on exit.
import fs from 'node:fs';
import path from 'node:path';
import { defaultFlowName } from '../codegen/index';
import { startFixtureServer, type FixtureServer } from '../fixtures/server';
import { RecorderSession } from '../recorder/session';
import { startPanel, type Panel } from '../server/panel';
import { resolveTestIdAttr } from '../util/config';
import { assertRecorderReady } from '../framework/doctor';

export interface RecordOptions {
  frameworkRoot?: string;
  module?: string;
  url?: string;
  out: string;
  name?: string;
  viewport: { width: number; height: number };
  browser: 'chromium' | 'firefox' | 'webkit';
  storageState?: string;
  saveState?: string;
  baseURL?: string;
  panelPort: number;
  testIdAttr?: string;
  allowCss: boolean;
  style: 'pom' | 'flat';
  keepSecrets: boolean;
  overwrite: boolean;
  coordsRatio: boolean;
  openPanel: boolean;
  headless: boolean;
  screenshots: boolean;
}

function axeInstalled(cwd: string): boolean {
  try {
    require.resolve('@axe-core/playwright', { paths: [cwd] });
    return true;
  } catch {
    return false;
  }
}

export async function runRecord(cmd: 'record' | 'demo', o: RecordOptions): Promise<void> {
  let fixture: FixtureServer | null = null;
  let activeSession: RecorderSession | undefined;
  let activePanel: Panel | undefined;
  const removeListeners: (() => void)[] = [];
  try {
    if (cmd === 'demo') {
      fixture = await startFixtureServer(4900).catch(() => startFixtureServer(0));
      o.url = fixture.url + '/';
      o.baseURL = o.baseURL ?? fixture.url;
      if (o.out === './tests') o.out = './demo-tests/tests';
      // a ready-to-run Playwright config for the demo output
      const demoRoot = path.dirname(path.resolve(o.out));
      const cfg = path.join(demoRoot, 'playwright.config.ts');
      if (!fs.existsSync(cfg)) {
        fs.mkdirSync(demoRoot, { recursive: true });
        fs.writeFileSync(
          cfg,
          [
            "import { defineConfig } from '@playwright/test';",
            '',
            '// Written by `npm run demo`. Keep the demo site running (npm run fixture-site), then:',
            '//   npx playwright test -c ' + path.relative(process.cwd(), demoRoot).split(path.sep).join('/'),
            'export default defineConfig({',
            "  testDir: './tests/specs',",
            "  reporter: 'list',",
            "  use: { baseURL: process.env.TPHUB_BASE_URL ?? 'http://127.0.0.1:4900' },",
            '});',
            '',
          ].join('\n'),
        );
      }
      o.name = o.name ?? 'standard user adds the backpack to the cart';
    }
    if (!o.url) throw new Error('Missing --url. Example: npx tsx src/cli.ts record --url https://example.com --out ./tests');
    try {
      new URL(o.url);
    } catch {
      throw new Error(`"${o.url}" is not a valid URL. Include the scheme, for example https://example.com`);
    }
    const cwd = process.cwd();
    const testIdAttr = o.testIdAttr ?? resolveTestIdAttr(cwd);
    const outDir = path.resolve(o.out);
    const outDirFromCwd = path.relative(cwd, outDir).split(path.sep).join('/') || '.';

    await assertRecorderReady({ out: outDir, url: o.url, panelPort: o.panelPort, storageState: o.storageState, browser: o.browser });
    const axe = axeInstalled(cwd);
    const session = activeSession = await RecorderSession.launch({
      pageFlags: { axe, screenshots: o.screenshots },
      url: o.url,
      viewport: o.viewport,
      browser: o.browser,
      headless: o.headless,
      storageState: o.storageState,
      testIdAttr,
      allowCss: o.allowCss,
      ui: true,
      log: (m) => console.log('  ' + m),
    });

    let panel: Panel;
    try {
      panel = activePanel = await startPanel(session, {
        frameworkRoot: o.frameworkRoot,
        module: o.module,
        port: o.panelPort,
        outDir,
        overwrite: o.overwrite,
        cwd,
        log: (m) => console.log(m),
        gen: {
          flowName: o.name ?? 'recorded flow',
          viewport: o.viewport,
          baseURL: o.baseURL,
          style: o.style,
          keepSecrets: o.keepSecrets,
          outDirFromCwd,
          coordsAsRatio: o.coordsRatio,
          storageState: o.storageState ? path.relative(cwd, path.resolve(o.storageState)).split(path.sep).join('/') : undefined,
          testIdAttr,
        },
      });
    } catch (e) {
      await session.close();
      throw e;
    }

    // name the flow from the steps unless --name was given
    panel.userNamed = !!o.name;
    if (!o.name) {
      panel.userNamed = false;
      session.on('update', () => {
        if (!panel.userNamed) panel.gen.flowName = defaultFlowName(session.steps);
      });
    }

    await session.start();

    if (o.openPanel && !o.headless) {
      // A separate context: the panel is never recorded and gets no init script.
      const panelContext = await session.browser.newContext({ viewport: null });
      const pp = await panelContext.newPage();
      await pp.goto(panel.url).catch(() => {});
    }

    console.log('');
    console.log('  TPHub Web Recorder is running');
    console.log(`  Recording:  ${o.url}`);
    console.log(`  Side panel: ${panel.url}`);
    console.log(`  Output:     ${outDir}`);
    console.log(`  Test id:    ${testIdAttr}${o.allowCss ? '   (CSS allowed)' : ''}`);
    if (!axe) console.log('  Note: @axe-core/playwright is not installed, so the accessibility check is disabled.');
    if (cmd === 'record' && !['ts', 'js', 'mjs', 'cjs'].some((e) => fs.existsSync(path.join(cwd, `playwright.config.${e}`)))) {
      console.log('  Tip: no playwright.config.ts here. Create one with testDir pointing at ' + outDirFromCwd + '/specs' + (o.baseURL ? ' and use.baseURL = ' + o.baseURL : '') + '.');
    }
    console.log('');
    if (cmd === 'demo') {
      console.log('  Demo: try this in the browser window');
      console.log('    1. Type standard_user and secret_sauce, click Login');
      console.log('    2. Click "Add to cart" on Trail Backpack (watch the suggested badge check)');
      console.log('    3. Click the cart icon, then Assert mode -> click a row -> "count equals"');
      console.log('    4. Click "Save files" in the side panel (or press Ctrl+C here)');
      console.log('    5. Keep the site up (npm run fixture-site) and run, in PowerShell:');
      console.log("         $env:TEST_PASSWORD = 'secret_sauce'; npx playwright test -c " + path.relative(cwd, path.dirname(outDir)).split(path.sep).join('/'));
      console.log('');
    }
    console.log(o.frameworkRoot ? '  Use the toolbar to switch modes. Click Save files in the panel to save; Ctrl+C quits without saving unfinished work.' : '  Use the toolbar at the bottom of the page to switch modes. Press Ctrl+C here to save and quit.');
    console.log('');

    let resolveFinished!: () => void;
    let rejectFinished!: (error: unknown) => void;
    const done = new Promise<void>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
    let finished = false;
    const finish = async (reason: string) => {
      if (finished) return;
      finished = true;
      console.log(o.frameworkRoot ? `\n  ${reason}: closing recorder.` : `\n  ${reason}: saving what was recorded.`);
      try {
        await session.idle(200).catch(() => {});
        if (o.frameworkRoot) console.log('  Framework recordings save only when you click Save files in the panel.');
        else if (session.steps.length > 1) panel.save();
        else console.log('  Nothing recorded besides opening the page; no files written.');
        if (o.saveState) {
          fs.mkdirSync(path.dirname(path.resolve(o.saveState)), { recursive: true });
          await session.context.storageState({ path: o.saveState });
          console.log(`  Login state saved to ${o.saveState} (reuse it with --storage-state)`);
        }
        resolveFinished();
      } catch (error) {
        rejectFinished(error);
      }
    };
    const interrupt = () => void finish('Ctrl+C');
    const terminate = () => void finish('Stopped');
    const disconnected = () => void finish('Browser closed');
    const tabsClosed = () => {
      if (session.pages.length && session.pages.every(p => p.isClosed())) void finish('All tabs closed');
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);
    session.browser.once('disconnected', disconnected);
    session.on('update', tabsClosed);
    removeListeners.push(() => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
      session.browser.removeListener('disconnected', disconnected);
      session.removeListener('update', tabsClosed);
    });
    await done;
  } finally {
    for (const remove of removeListeners) remove();
    // Each resource is closed even if a later startup stage failed.
    await activePanel?.close().catch(() => {});
    await activeSession?.close().catch(() => {});
    await fixture?.close().catch(() => {});
  }
}
