# V4 proposal: recover work and reuse tests

V3 records journeys, saves executable Playwright tests, and retains run evidence. V4 should make that daily workflow easier to recover and maintain. This is a proposal, not functionality included in V3.

## 1. Recording drafts and crash recovery

Persist a local draft after each completed action or editor change. On restart, offer to restore, inspect, or discard it. A restored draft must require an explicit save before it becomes a runnable test. Mask detected secrets before writing a draft, exclude authentication state, and document draft location and deletion.

Acceptance: terminate the recorder after several actions; restart and restore the same ordered steps and unsaved edits. Existing saved tests stay intact.

## 2. Data-driven tests

Allow a recorded input to reference a named field. Start with JSON datasets, a small table editor, and environment variables for secret fields. Generate native Playwright tests with a distinct dataset name in each title and preserve the dataset selection in run history. Add CSV import only after the JSON workflow is stable.

Acceptance: replay one saved flow with three datasets and inspect three separately named results. Missing fields fail validation before a browser starts. Secrets remain environment references.

## 3. Run history in the recorder panel

Show recent runs with status, module, duration, and links to their native HTML reports. Add module/status filters and compare consecutive runs. Provide explicit delete and configurable retention controls with a preview of affected runs; keep CLI access available.

Acceptance: a failed run and its trace remain accessible after a passing run. Custom configurations without HTML show their retained logs and explain the missing report.

## 4. Locator repair with review

Use the extension engine to suggest alternatives when a locator fails. Show the old locator, candidates, match counts, and relevant evidence. Apply a chosen candidate only after review, then rerun explicitly. Start with unique main-frame elements; expand frame and shadow-root handling when regression coverage supports it.

Acceptance: a changed test ID yields a usable role/name candidate. Ambiguous matches are rejected and the generated patch never changes assertions or marks an unexecuted test as passed.

## Suggested delivery order

1. **V4.0:** draft recovery plus JSON datasets, with Linux and Windows verification.
2. **V4.1:** history panel and retention controls.
3. **V4.2:** reviewed locator repair and broader browser coverage.

Keep the local workflow usable without AI or a hosted account. Continue native Playwright reports and explicit save/run actions. Defer cloud collaboration and automatic test repair until recovery and data reuse are reliable.
