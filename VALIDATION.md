# v1.2 optional AI update - actual validation

Validated on 21 October 2026 on Windows, Node.js 24.15.0 and Playwright 1.56.1.

## Results

- Full verification: **171 tests passed; 0 failed; 0 cancelled; 0 skipped**, exit code 0, approximately 376 seconds.
- `npm run typecheck` and `npm run qa:check` passed.
- Twelve additional AI checks cover provider request formats, explicit consent, disabled defaults, secret masking, session-only keys, HTTPS endpoint restrictions, budgets, cooldowns, caching, concurrency, errors, and browser-panel integration.
- Provider requests used mock HTTP responses. No real API key was supplied; live authentication, account quotas, model access and suggestion quality remain unverified.
- Browser validation used headless Chromium. Existing checks passed for frames, open shadow DOM, popups, dialogs, uploads, downloads, drag, SPA navigation, widgets, saved sessions, authoring controls, clipboard actions, generation, saving and native execution.
- AI browser integration verified preview without a provider call, required approval, a mocked suggestion, no automatic application or execution, explicit draft loading, explicit Apply and Save, and a real synthetic Playwright run.
- Four application modules remain empty. Synthetic verification cases are framework tests, not company regression cases. Empty application suites must not be reported as passing.

## Boundaries

- AI is disabled by default. Keys remain in server memory and must be entered locally; no key is included in this release.
- Redaction is best effort. Review every outbound preview and use only company-approved data and providers.
- Session request limits and cooldowns limit requests; they cannot enforce provider billing or guarantee free service.
- No automatic retry, fallback, code application, or AI-triggered execution is provided.
- Headed desktop interaction and company application journeys require local validation with authorized access.
- See AI-GUIDE.md for setup, provider-specific settings and troubleshooting. Historical reports are retained separately.

## Corrected Windows launcher package

The initial v1.2 ZIP omitted the launchers. The corrected ZIP includes Setup.bat, Start-Recorder.bat and Run-All-Tests.bat in its root project directory. All use their own directory, pause for readable output by default and preserve failure exit codes. Setup checks Node.js >=20, npm, dependency installation, Chromium executable and TypeScript.

Launcher verification: setup success and dependency/browser failure paths checked using stub npm/npx commands, with real Node and browser executable checks; recorder and runner exit code propagation checked with stub exit 7. An actual invocation of Run-All-Tests.bat on empty application modules returned nonzero and the correct no-tests message. Full dependency installation was not repeated. Earlier 171 passing checks cover the unchanged application code.
