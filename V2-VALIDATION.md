# v2.0.0-beta.1 validation

This first v2 milestone integrates the supplied Web QA Framework v1.2.0 and Locator Scout v0.1.0 into one repository with two deliverables. The original hello.ts is preserved.

## Implemented

- Chrome MV3 extension source, build, and ZIP distribution.
- Installable npm CLI: `vortex-qa` and `vortex-recorder`, compiled JavaScript and runtime assets.
- The extension's locator engine also powers `vortex-qa scout`; capture/replay continues using the existing recorder engine.
- Consumer-project initialization without overwriting existing configuration; commands use the current project directory.
- Readiness diagnostics for Node, URLs, output access, authentication JSON, panel ports, browser installation, and optional launch.
- Cleanup after partial initialization and failed navigation; graceful shutdown propagates save failures instead of forcing success.
- Fix for the AI-panel test server leak when browser startup fails.
- Matching Playwright runtime dependencies pinned to 1.56.1 after clean-install validation exposed version drift.
- Linux/Windows GitHub Actions workflow, release ZIP/tarball, checksums, and clean-consumer smoke verification.

## Current-instance evidence

Validated on Linux with Node 24.22.1 and Chromium 141.0.7390.37 (Playwright 1.56.1).

- Framework: 178 tests discovered, **177 passed, 0 failed, 1 skipped**, exit 0. Approximately 183 seconds.
- Extension engine: **17 passed**, exit 0.
- Framework TypeScript, extension TypeScript, and generated-test/config TypeScript checks passed.
- Both product builds succeeded.
- npm tarball installed into a separate temporary consumer project. Initialization, browser doctor, packaged fixture serving, shared-engine locator inspection, and an actual native Playwright browser test passed.
- Regression checks cover browser cleanup after initialization failure, clean CLI exit after navigation failure, invalid authentication state without leaking its contents, occupied ports, and non-destructive project initialization.

## Explicit limits

- The unpacked-extension browser integration check is skipped locally because this cloud machine's managed Chrome policy sets `ExtensionInstallBlocklist` to `*`. That policy was left unchanged. Set `VORTEX_EXTENSION_TEST=1` on a machine allowing unpacked extensions to execute the check; CI enables it.
- The GitHub Actions workflow was added but has not run on GitHub. Windows launchers have not been executed in this Linux session.
- https://vortex-qa.vercel.app/shop returned a network-policy 403 when requested. Reference-shop selectors and application journeys remain unverified pending access.
- AI provider tests use mock responses. No live AI provider credentials or requests were used.
- Crash recovery, datasets, report history, and replacing the recorder's ranking engine are outside this first milestone.
- The artifacts are local beta builds. No npm publication, Chrome Web Store upload, Git push, or environment publication was performed.
