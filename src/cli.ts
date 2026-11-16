#!/usr/bin/env node
// TPHub Web Recorder command line.
import { bool, parseArgs, parseViewport, str } from './util/args';
import { VERSION } from './util/version';

const HELP = `
Vortex QA Recorder: Playwright recording and test generation

Usage (PowerShell or any shell):
  vortex-recorder record --url <url> --out <dir> [options]
  vortex-recorder check <snapshot.html|url> [--selector "css"] [--json]
  vortex-recorder demo
  vortex-recorder generate --from <recording.json> [--out dir] [--style pom|flat] [--name "..."]
  vortex-recorder audit <folder-or-file>
  vortex-recorder serve-fixtures [--port 4900]

record options:
  --url <url>                 page to open (required)
  --out <dir>                 where generated files go (default ./tests)
  --name "flow name"          test title and file names
  --viewport 1280x720         browser viewport, also written to the spec
  --browser chromium|firefox|webkit
  --storage-state auth.json   start logged in from a saved state
  --save-state auth.json      save cookies/localStorage when you stop
  --base-url <url>            write relative page.goto('/path') calls
  --panel-port 4800           side panel port (127.0.0.1 only)
  --test-id-attr data-test    test id attribute (default: from playwright.config.ts or data-testid)
  --allow-css                 let CSS selectors compete with semantic locators
  --style pom|flat            Page Objects + spec (default) or one flat spec
  --keep-secrets              keep typed passwords in the fixtures JSON
  --overwrite                 overwrite existing files instead of writing *.generated.ts
  --coords-ratio              store coordinate clicks as viewport ratios
  --screenshots               offer toHaveScreenshot() in Assert mode
  --no-panel-open             do not open the panel window automatically
  --headless                  (testing only) run without a visible browser

check options:
  --selector "css"            only analyse elements matching this selector
  --allow-css, --test-id-attr as above
  --json                      machine-readable output
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (bool(args, 'version')) { console.log(VERSION); return; }
  const cmd = args._[0];
  if (!cmd || bool(args, 'help') || cmd === 'help') {
    console.log(HELP);
    return;
  }
  if (cmd === 'check') {
    const input = args._[1];
    if (!input) throw new Error('check needs a file: vortex-recorder check .\\page.html');
    const { runCheck, formatResults } = await import('./commands/check');
    const { resolveTestIdAttr } = await import('./util/config');
    const results = await runCheck(input, {
      selector: str(args, 'selector'),
      testIdAttr: str(args, 'test-id-attr') ?? resolveTestIdAttr(process.cwd()),
      allowCss: bool(args, 'allow-css'),
    });
    if (bool(args, 'json')) console.log(JSON.stringify(results, null, 2));
    else console.log(formatResults(results, Number(str(args, 'alternatives', '3')), process.stdout.isTTY));
    return;
  }
  if (cmd === 'generate') {
    const from = str(args, 'from') ?? args._[1];
    if (!from) throw new Error('generate needs --from <file>.recording.json (written next to your tests on every Save)');
    const { runGenerate } = await import('./commands/recording');
    const style = str(args, 'style');
    console.log(
      runGenerate({
        from,
        out: str(args, 'out'),
        style: style === 'flat' || style === 'pom' ? style : undefined,
        name: str(args, 'name'),
        baseURL: str(args, 'base-url'),
        overwrite: bool(args, 'overwrite'),
      }),
    );
    return;
  }
  if (cmd === 'audit') {
    const target = args._[1] ?? './tests';
    const { auditPath, formatFindings } = await import('./commands/audit');
    const findings = auditPath(target);
    console.log(formatFindings(findings));
    if (findings.some((f) => f.severity === 'error')) process.exitCode = 2;
    return;
  }
  if (cmd === 'serve-fixtures') {
    const { startFixtureServer } = await import('./fixtures/server');
    const s = await startFixtureServer(Number(str(args, 'port', '4900')));
    console.log(`Demo site: ${s.url}  (Ctrl+C to stop)`);
    return;
  }
  if (cmd === 'record' || cmd === 'demo') {
    const { runRecord } = await import('./commands/record');
    await runRecord(cmd, {
      url: str(args, 'url'),
      out: str(args, 'out', './tests')!,
      name: str(args, 'name'),
      viewport: parseViewport(str(args, 'viewport')),
      browser: (str(args, 'browser', 'chromium') as 'chromium' | 'firefox' | 'webkit'),
      storageState: str(args, 'storage-state'),
      saveState: str(args, 'save-state'),
      baseURL: str(args, 'base-url'),
      panelPort: Number(str(args, 'panel-port', '4800')),
      testIdAttr: str(args, 'test-id-attr'),
      allowCss: bool(args, 'allow-css'),
      style: (str(args, 'style', 'pom') as 'pom' | 'flat'),
      keepSecrets: bool(args, 'keep-secrets'),
      overwrite: bool(args, 'overwrite'),
      coordsRatio: bool(args, 'coords-ratio'),
      openPanel: !bool(args, 'no-panel-open'),
      headless: bool(args, 'headless'),
      screenshots: bool(args, 'screenshots'),
    });
    return;
  }
  throw new Error(`Unknown command "${cmd}". Run: vortex-recorder help`);
}

main().catch((e) => {
  console.error('\nError: ' + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
});
