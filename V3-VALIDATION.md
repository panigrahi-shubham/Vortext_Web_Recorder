# v3.0.0-beta.1: persistent run history

Built and validated on Linux with Node 24.22.1 and Playwright 1.56.1.

## Behavior

- Every executed framework run receives a unique directory containing selection, timestamps, status, exit code, and console output.
- The supplied Playwright configuration stores HTML/JSON reports and browser evidence in that directory. The latest native report is copied to reports/latest.
- `vortex-qa history [--json]` lists runs. `vortex-qa report --run <id>` serves a selected HTML report; `--path` returns its directory without a server.
- Recorder-panel executions also preserve history and display the run ID.
- Discovery, unmatched selections, and empty suites do not create run records or replace latest reports.
- Existing user configurations are preserved. Custom configurations that ignore VORTEX_REPORT_DIR retain metadata/logs only; report lookup explains missing HTML rather than returning a stale report.
- Runs left unfinished by a killed process remain marked running; no successful outcome is inferred.

## Executed validation

- Full framework suite: 179 discovered, 178 passed, 0 failed, 1 skipped; exit 0, about 225 seconds.
- Extension engine suite: 17 passed, 0 failed.
- Framework, QA-config, and extension TypeScript checks passed.
- New browser regression verifies failed-test screenshots and traces survive a later passing run; it also verifies discovery/empty selections preserve latest, custom config behavior, and invalid run-ID rejection.
- Clean npm consumer smoke passed: installation, project initialization, doctor browser launch, shared-engine inspection, native test execution, history JSON, and HTML report lookup.
- Both product builds, ZIP integrity, compiled history-module packaging, and release checksums passed.

## Limits

- One actual-extension installation test remains skipped in this managed Chrome environment. The unpacked-extension CI check remains enabled for compatible runners; no new GitHub CI execution is claimed.
- The Chrome extension is versioned with the coordinated release; this milestone changes the npm recorder's reporting workflow, not extension locator behavior.
- Reference-shop validation, live AI providers, and Windows execution were not performed in this milestone.
- Draft recovery and datasets remain future milestones. History has no automatic retention policy and stays local.
- No Git push, npm publication, Chrome Web Store submission, or environment publication was performed for v3.
