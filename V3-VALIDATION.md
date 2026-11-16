# Vortex QA 3.0.0: final release validation

Local validation performed on 16 November 2026 with Linux, Node 24.22.1, and Playwright 1.56.1. The package and extension versions are `3.0.0`. The final Git tag is `v3.0.0-final.2`; the older `v3.0.0` tag is preserved at the beta baseline.

## Behavior

- Every executed framework run receives a unique directory containing selection, timestamps, status, exit code, and console output.
- The supplied Playwright configuration stores HTML/JSON reports and browser evidence in that directory. The latest native report is copied to `reports/latest`.
- `vortex-qa history [--json]` lists runs. `vortex-qa report --run <id>` serves a selected HTML report; `--path` returns its directory without a server.
- Recorder-panel executions preserve history and display the run ID.
- Discovery, unmatched selections, and empty suites do not create run records or replace latest reports.
- Existing user configurations are preserved. Custom configurations that ignore `VORTEX_REPORT_DIR` retain metadata/logs only; report lookup explains missing HTML rather than returning a stale report.
- Runs left unfinished by a killed process remain marked `running`; no successful outcome is inferred.

## Finalization fixes

- Reproduced the prior GitHub Linux failure in the recorder UI: the expanded AI assistant covered the run button when the code editor was open.
- Made the code pane scroll within its allocated space and kept its controls from shrinking into the assistant.
- The browser regression checks ordinary pointer access at 1500×1100, 1280×720, and 800×700, then executes the saved test. No forced clicks or test retries hide the defect.
- Windows CI exposed inconsistent service-worker debugger startup in the real-extension test. The check now loads a temporary copy with an ephemeral public key for a predictable extension ID and exercises its real panel and content scripts. The release manifest is unchanged. The check remains required on both operating systems.
- Added installed `--version` output to both command-line tools.
- Release generation rejects inconsistent package, lockfile, source-manifest, and built-manifest versions before writing release archives.
- Corrected report-opening instructions and included release notes and the proposed V4 roadmap in the npm package.

## Executed local checks

| Check | Result |
| --- | --- |
| Framework TypeScript (`npm run typecheck`) | Passed |
| Extension TypeScript (`npm run typecheck:extension`) | Passed |
| Application configuration (`npm run qa:check`) | Passed |
| Extension engine (`npm run test:extension`) | 17 passed |
| Full suite with `TPHUB_HEADLESS=1 VORTEX_EXTENSION_TEST=1 npm test` | 179 tests: 178 passed, 1 blocked by managed extension policy; exit 1, 216 seconds |
| Focused AI-panel regression after the layout fix | Passed at all three viewport sizes |
| Both product builds and `npm run release` | Passed |
| `npm run test:package` | Passed in a separate clean consumer project |
| Deliberately mismatched release metadata | Rejected before artifacts were written |
| Extension ZIP integrity, entry points, manifest versions | Passed |
| npm archive version and compiled history/shared-engine/version modules | Passed |
| SHA-256 checksums for both archives | Passed |

The full suite verified browser recording, generated POM and flat-spec replay, iframe and shadow DOM flows, popups, dialogs, downloads, uploads, drag, SPA navigation, saved authentication state, native reporting, and retention of failed screenshots/traces across a later passing run.

The consumer smoke installed the tarball, checked both installed CLI versions, initialized a project, launched Chromium through doctor, inspected a local fixture through the shared engine, executed a real native browser test, listed history as JSON, and resolved its HTML report.

## GitHub validation and release

The workflow runs the complete checks on Linux and Windows with the real unpacked-extension integration test enabled. For version tags, a release job depends on both OS checks and attaches the Linux-built npm tarball, extension ZIP, and checksums to a GitHub release. Live results are available at:

https://github.com/panigrahi-shubham/Vortext_Web_Recorder/actions

This document records the executed local results; the workflow run for the final tag records the independent CI outcome.

## Limits

- The local extension integration timed out waiting for its service worker because `/etc/chromium/policies/managed/extensions.json` sets `ExtensionInstallBlocklist` to `*`. That policy was left intact. Engine and shared-engine browser checks passed; actual extension installation is covered by the required GitHub jobs.
- Reference-shop validation and live AI-provider requests were not performed. AI tests use mock HTTP.
- Windows execution is delegated to the required GitHub job, not claimed as a local result.
- History has no automatic retention policy and stays local. Direct Playwright invocations bypass framework history.
- Draft recovery and datasets remain proposed V4 work.
- Building or pushing this release does not publish to npm or the Chrome Web Store.
