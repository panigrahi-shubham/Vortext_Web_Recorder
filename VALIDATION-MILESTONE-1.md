# Milestone 1 validation

Validated on 21 October 2026 using Windows, Node.js 24.15.0, TypeScript 5.9 and Playwright 1.56.1.

## Actual results

- `npm run typecheck`: passed.
- `npm run qa:check`: passed (configuration compiles; application modules have no tests yet).
- Full `npm test`: 158 checks discovered, 150 passed, 0 failed, 8 cancelled by the headed UI suite's browser-launch setup failure. Exit code 1; this was not reported as a successful full run.
- Added explicit `TPHUB_HEADLESS=1` support for recorder UI verification. The targeted UI rerun passed all 8 checks, with exit code 0. Together with the full run, all 158 checks have passing results across these runs. The entire full suite was not repeated after the targeted fix.
- Framework panel verification was extended to operate the real side panel in headless Chromium: module selection, typing the test name, saving, locating the saved file, running an edited verification spec, and showing exit code 0. This targeted rerun passed.
- New local browser verification recorded typing/clicks, iframe interaction, open shadow DOM and a popup, saved and compiled the generated Page Objects/spec, discovered the spec and executed it successfully.
- Existing recorder acceptance checks passed for locator generation, login/cart recordings, repeated execution, markup-class changes, expected failure on renamed text, flat generation, iframe, shadow DOM, popup, dialog, download, upload, drag, SPA, widgets and saved session state.
- Seven new framework checks passed: module changes, compile/save isolation and overwrite refusal, syntax/import validation, explicit unsupported-action errors, empty selection rejection, actual single/module/all execution with real pass/fail results and native HTML/JSON reports, lock handling and discovery errors.
- A real headless framework recorder CLI startup printed the recording URL and panel address successfully. Headed interactive startup remains unverified in this restricted session.
- Empty all-tests and empty my-product selections returned a nonzero code and the requested no-tests message.
- The application tests directory still contains only the four initial module folders and their empty marker files. No business regression tests were fabricated.

The runner checks include deliberately failing synthetic verification cases, isolated under .tmp/. Those expected failures prove that failure exit codes and report counts are preserved; they are not application regression results.

## Fixes made during validation

- Escaped native Windows path filters correctly, including module names containing regex metacharacters such as brackets.
- Kept dragged cards alive during incoming panel updates and initialized HTML drag data. The UI check uses the visible drag handle and waits for the actual reorder instead of a fixed sleep.
- Saved unsupported actions as explicit errors instead of empty methods.
- Saved coordinate fallback clicks explicitly after locator replay failure.
- Flushed final field typing and delayed clicks before explicit panel saving.
- Kept debug captures outside tests/ so they cannot appear as modules.
- Preserved recorded custom test-ID attributes in generated specs.

## Limits and remaining milestones

- Headed Chromium could not start in this session (Windows process exit 3221225506). UI verification passed in supported headless mode. For restricted/headless environments, use `$env:TPHUB_HEADLESS = '1'` before `npm test`.
- No company application journeys or credentials were available for acceptance testing. Record and replay your actual staging journeys before relying on regression coverage.
- Cross-origin iframe behaviour was preserved in source; these validations exercised local/same-origin iframe fixtures, not a separate cross-origin application.
- Latest native reports are configured; report history and richer metadata are deferred. Screenshot and trace options are configured, but the new synthetic failure-count check does not launch a browser and therefore does not demonstrate failure screenshot/trace attachment creation.
- Manual review is still required for suggested assertions, weak locators and coordinates. Scores are heuristic, not measured reliability probabilities.
- Generated flows use isolated support files. Sharing/refactoring Page Objects remains a deliberate manual operation.
- Single-worker execution and a run lock reduce overlaps; they do not create/reset business data or guarantee isolation from external users.
- The framework source archive excludes dependencies, browser binaries, runtime reports, screenshots, authentication state and temporary verification output. Install dependencies with npm ci and install Chromium after extraction. This is a milestone source snapshot, not the later production distribution release.
- Dynamic data generators, email reporting, Windows one-click launchers and production release packaging remain outside Milestone 1.

The original recorder project was not modified. All changes were made in a separate copied folder.
