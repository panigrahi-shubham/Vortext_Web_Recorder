# Vortex QA v2.0.0-beta.1

Two local development tools live in this repository:

- **Chrome extension:** Locator Scout, under `extension/`. Pick elements, inspect ranked locators, scan pages, verify expressions, and export Playwright or Selenium Page Objects.
- **npm software:** `vortex-web-recorder`. Record browser journeys, edit generated code, save tests, run them with Playwright, and inspect locators with the same engine used by the extension.

This beta adds packaging and reliability improvements to the supplied v1.2 recorder and v0.1 extension. It is a first v2 milestone; draft recovery, datasets, and report history are future work. The recorder's existing capture engine remains in place. The extension and the new `scout` command share the extension locator engine; the recorder's locator ranking has not been replaced.

## Build both products

Requires Node.js 20+ (Node 24 is used in CI).

```sh
npm ci
npm ci --prefix extension
npx playwright install chromium
npm run build
npm run release
```

`artifacts/` contains an npm `.tgz`, an extension `.zip`, and `SHA256SUMS`. Releases are built locally; these commands do not publish to npm or the Chrome Web Store. Both dependency lockfiles are retained; Playwright is pinned to 1.56.1 so the packaged software uses the verified browser build.

## Install the Chrome extension

Extract `artifacts/vortex-locator-scout-2.0.0-beta.1.zip` into a folder. In Chrome or Edge, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose that extracted folder. Developers can load `extension/dist` directly after building. See [extension/README.md](extension/README.md) for usage and permissions.

## Install the npm software in your test project

```sh
npm install --save-dev /path/to/vortex-web-recorder-2.0.0-beta.1.tgz
npx playwright install chromium
npx vortex-qa init
npx vortex-qa doctor --panel-port 0
npx vortex-qa record --url https://your-app.example --module my-product
npx vortex-qa run --module my-product
```

Commands use your current project directory. `init` creates a default configuration and `tests/my-product`, preserving existing files. Add authentication state and generated reports to your project's `.gitignore`. Existing JavaScript and TypeScript Playwright configurations are supported. Empty suites return a nonzero exit code.

Inspect one element using the extension engine, without installing the extension:

```sh
npx vortex-qa scout --url https://your-app.example --selector '[data-testid="submit"]'
```

`scout` prints JSON with ranked Playwright/Selenium candidates, scores, and rule notes. It uses the extension's default test-id settings, inspects one unique CSS selection in the main frame, and does not click or submit the page. This is a locator inspection command, not a business test.

## Validation

```sh
npm run typecheck
npm run typecheck:extension
npm run qa:check
npm run test:extension
npm run build
npm test
npm run release
npm run test:package
```

`test:package` installs the tarball into a separate temporary consumer project, initializes it, launches Chromium through doctor, inspects the local fixture using the packaged engine, and runs an actual Playwright browser test. It requires the Playwright browser installation above.

The real unpacked-extension integration test is opt-in: set `VORTEX_EXTENSION_TEST=1` on a machine allowing custom extensions before `npm test`. It is enabled in `.github/workflows/verify.yml` on Linux and Windows. Managed browsers that block extensions cannot run that check; the remaining engine tests and browser inspection still run. GitHub CI results are only established after the workflow executes.

The proposed reference site is https://vortex-qa.vercel.app/shop. Cloud network access to it was blocked during development, so no selectors or business journeys for that site are claimed as verified. To try it after access is available:

```sh
npx vortex-qa record --url https://vortex-qa.vercel.app/shop --module my-product
```

## Earlier recorder documentation

The following documentation came with the v1.2 input archive and describes its existing workflows. Historical validation results are not v2 release evidence.

# Web QA Framework v1.2 — Optional AI assistance

A separate copy of the TPHub custom Playwright recorder, extended with module selection, safe saving, and native Playwright execution. It contains no company regression tests; AI integration is optional and uses native HTTP without an AI SDK dependency.

## New in v1.2: optional AI for free-tier API accounts

Expand **Optional AI assistant** in the side panel. Choose Gemini, Groq or a custom compatible endpoint, enter your key locally, enable AI and save settings. Then prepare a text preview and explicitly approve/send it. Recording, authoring, saving, running and reporting still work without AI.

Features: **Improve selected script**, **Suggest assertions**, **Explain failure**. Proposals are never applied or executed automatically. A code proposal can be loaded into the existing editor for review, validation, saving and an explicit run.

Defaults conserve quota: one request at a time, 15-second pacing, 20 requests per session, 12,000 input characters, 1,024 output tokens (adjustable up to 2,048), exact-request memory caching, no automatic retries or provider fallback. This cannot enforce a free billing plan; your provider account/model controls eligibility and charges.

See [AI-GUIDE.md](AI-GUIDE.md) for setup, privacy, provider details and limitations. AI is disabled by default. API keys are never written into source files, generated tests, recordings, reports or browser storage. No screenshots, DOM, traces or authentication state are automatically attached.

## Recording and script authoring (v1.1 features retained)

Use **Actions** in the webpage toolbar or side panel, then click a field on the website. You can now type/paste text, type characters, append, clear, copy and paste values between elements, press keys, choose dropdown options, and check/uncheck controls.

The side panel now includes editable recorded text, entry method/delay settings, **Duplicate step**, **Copy locator**, and **Edit code** with a plain TypeScript/JSON editor. Text pasted into the editor is compiled with imports before saving.

`npm run record -- --url https://your-app.example --module my-product` now opens the framework by default. The previous raw recorder command is available as `npm run record:legacy -- --url https://your-app.example --out ./legacy-tests`. The custom capture engine remains the primary recorder.

Read [AUTHORING-GUIDE.md](AUTHORING-GUIDE.md) for step-by-step instructions and [FEATURE-RESEARCH.md](FEATURE-RESEARCH.md) for feature choices and official documentation.

## Windows launchers (corrected package)

Extract the whole ZIP, open `Web-QA-Framework`, and double-click `Setup.bat`. After setup finishes, double-click `Start-Recorder.bat`. Use `Run-All-Tests.bat` after recording and saving tests. Node.js 20 or newer with npm is required. The launchers keep their console open to show errors and preserve exit codes. Optional CLI arguments can be passed from a terminal, for example `Start-Recorder.bat --url https://example.com`. Set `WEB_QA_NO_PAUSE=1` when invoking from automation.

## Install

Use Node.js 20 or newer (validated here with Node 24.15.0). Open PowerShell in this extracted folder:

```powershell
npm ci
npx playwright install chromium
npm run typecheck
```

The lockfile pins Playwright 1.56.1. Browser binaries and node_modules are not included in the source archive. This project is independent of the Android framework.

## Record, review, save and run

```powershell
$env:BASE_URL = 'https://your-staging-app.example'
npm run qa:record -- --url "$env:BASE_URL" --module my-product
```

1. Use the website in the recording browser. The existing toolbar modes, locator alternatives, assertions, comments and code previews are preserved.
2. Choose a module in the existing side panel. Use **Refresh modules** after adding, renaming or removing a directory.
3. Enter a test case name and review the code and warnings. Remove or correct unsupported steps.
4. Click **Save files**. Saving flushes pending typing/clicks and compiles the generated TypeScript, including imports, at its destination before writing.
5. Click **Run saved test** to execute that saved file with the official Playwright runner. Read the runner output and exit code in the panel. The saved path is shown for opening/editing in your editor.

Framework mode saves only on an explicit Save action. Closing the recording browser does not save unfinished work automatically. The original recorder CLI remains available through `npm run record:legacy` with its original save behaviour.

Each flow owns its generated Page Objects, data, assets and raw recording:

```text
tests/
  my-product/
    verify-add-product/
      specs/verify-add-product.spec.ts
      pages/...
      fixtures/...
      recordings/verify-add-product.recording.json
```

This nested layout preserves the recorder's working relative imports and prevents Page Object collisions between recordings. Two flows in different modules may have the same name. A second save with an existing name is refused: choose a new name or edit the saved flow directly. Files are never silently overwritten by framework saving. Preview updates automatically; saving remains explicit.

To edit a saved spec, open its path in your editor, for example:

```powershell
notepad tests/my-product/verify-add-product/specs/verify-add-product.spec.ts
```

**Run saved test** executes the last saved file, including manual edits. It does not execute later unsaved recording changes. Choose a new test name when saving another version.

## Modules

```powershell
npm run qa:modules
New-Item -ItemType Directory tests/future-module
npm run qa:modules
```

The four initial folders are my-profile, my-product, hamburger-menu and my-drive. Module discovery reads immediate subdirectories of tests/; no runner edits are required. Empty folders are supported. Rename/remove folders using Explorer or normal filesystem commands; refresh the panel afterward. Directory symlinks/junctions are excluded from discovery.

## Execution

```powershell
# All application tests
npm run qa:run

# One module
npm run qa:run -- --module my-product

# One saved spec (quote paths containing spaces)
npm run qa:run -- --file tests/my-product/verify-add-product/specs/verify-add-product.spec.ts

# Select by literal title text within one file
npm run qa:run -- --file tests/my-product/verify-add-product/specs/verify-add-product.spec.ts --title "Verify Add Product Journey"

# Discover without executing; use --headed for visible execution
npm run qa:run -- --module my-product --list
npm run qa:run -- --module my-product --headed

# Compile existing application tests
npm run qa:check
```

The wrapper uses Playwright's actual discovery and exits nonzero for empty selections, discovery errors and failures. With zero tests it prints:

> No Playwright test cases found. Record and save your first test.

Title selection matches literal text as a substring of Playwright's full test title; use a file selection and a distinctive title when several names overlap. Tests default to one worker, zero retries and Chromium only. Framework CLI/panel runs share an exclusive run lock. Direct `npx playwright test` commands bypass that lock; avoid overlapping account/state usage. Following a hard crash, verify there is no active runner before deleting .framework-run.lock.

Normal runner exit codes are propagated. A child terminated by a signal returns a nonzero code (130 if no numeric exit code is provided).

## Configuration and session reuse

Set environment variables in PowerShell; .env.example is a reference and is not automatically loaded:

```powershell
$env:BASE_URL = 'https://your-staging-app.example'
$env:TEST_ID_ATTRIBUTE = 'data-test'
npm run qa:record -- --url "$env:BASE_URL/login" --module my-profile --save-state .auth/session.json
npm run qa:record -- --url "$env:BASE_URL/dashboard" --module my-profile --storage-state .auth/session.json
```

Create the .auth directory first if supplying an existing state file. Treat saved authentication state as a credential and keep it out of distribution. Relative goto URLs require BASE_URL during execution. Set TEST_ID_ATTRIBUTE or pass --test-id-attr when recording custom test IDs; each generated spec also preserves its recorded attribute via test.use().

Password/token/OTP input values detected by the recorder are masked in saved recordings and fixtures. Set the generated TEST_* environment variables shown in the spec before execution. Always review recorded URLs, comments, assertions, upload names and debug captures for sensitive information; masking is heuristic.

## Native reports

The milestone includes a minimal native configuration so execution produces actual results:

- HTML: reports/latest/html/index.html
- JSON: reports/latest/results.json
- Failure screenshots/traces: reports/latest/artifacts/
- Video disabled; traces retained on failure; no retries by default.

```powershell
npm run qa:report
npx playwright show-trace "reports/latest/artifacts/<test-folder>/trace.zip"
```

The latest report is replaced on the next executed run. Empty/discovery-only selections do not replace an older execution report; consult the terminal/panel result for the current command. Report history, email, dynamic data generators, Windows launchers and a production distribution release are later milestones.

## Recorder compatibility and generation safeguards

The original recorder source layout and capture engine are retained. `npm run record:legacy`, `npm run demo`, `npm run check`, `npm run generate` and `npm run audit` are still available; see RECORDER-README.md.

- Unsupported actions generate an explicit error instead of an empty action method. Repair/delete the step before using the test.
- If recording a click requires coordinates after locator replay fails, the saved click explicitly uses coordinates.
- Coordinate clicks, positional locators and broad CSS still require review; they are not evidence of resilience.
- Suggestions describe observed changes, not the application's requirements. Review every accepted assertion.
- Generated validation checks types/imports, not business correctness or successful execution.
- Existing typing, settle detection, URL-based Page Object grouping and closed-shadow-root limitations remain.
- The supported initial run target is Chromium. Do not infer Firefox/WebKit coverage from API compatibility.

## Framework verification

```powershell
npm run test:unit
npm run test:integration
npm test
# If visible browsers cannot start in your environment:
$env:TPHUB_HEADLESS = '1'
npm test
```

`test/` contains framework/recorder verification, while `tests/` contains your future application tests. Verification uses synthetic local fixtures, including deliberate failure checks, in .tmp/ and never seeds the application modules with fictional regression tests. A successful verification suite does not mean your application regression suite exists or has passed. See VALIDATION.md for this milestone's actual results and blockers.
