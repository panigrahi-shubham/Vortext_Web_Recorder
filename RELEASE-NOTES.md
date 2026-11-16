# Vortex QA 3.0.0

V3 retains the result and evidence of each framework test execution, so a later passing run does not erase the earlier failure. Both the npm recorder and Locator Scout extension carry version `3.0.0`.

## Included

- Persistent run history with status, selection, timestamps, exit code, and console output.
- Per-run native HTML/JSON reports, screenshots, and traces with the supplied Playwright configuration.
- `vortex-qa history [--json]` and `vortex-qa report --run <run-id> [--path]`.
- Recorder-panel run IDs and compatibility copies under `reports/latest`.
- Shared locator inspection through the extension and npm `scout` command.
- `vortex-qa --version` and `vortex-recorder --version` for checking an installed package.
- Release guards that reject mismatched package, lockfile, or extension manifest versions.
- An extension integration check that selects the Scout background worker and waits for Chrome API readiness on Windows.
- A recorder layout fix that keeps run controls reachable while the AI assistant and code editor are open, including smaller windows.

## Install from a local build

```sh
npm ci
npm ci --prefix extension
npx playwright install chromium
npm run release
```

The resulting files are `artifacts/vortex-web-recorder-3.0.0.tgz`, `artifacts/vortex-locator-scout-3.0.0.zip`, and `artifacts/SHA256SUMS`. Install the tarball in your test project or extract the ZIP and load it as an unpacked extension. Release building does not publish to npm or the Chrome Web Store.

Pushing a version tag runs the Linux and Windows checks. After both pass, GitHub Actions creates a GitHub release with the Linux-built archives and checksums attached. The npm and Chrome Web Store registries remain separate publication steps.

## Upgrade notes

Existing project configurations are preserved. Set report paths using `VORTEX_REPORT_DIR` as described in README.md to retain native evidence per run. Configurations that ignore it still retain run metadata and console output.

History is local with no automatic retention. A killed process can leave a `running` entry. Direct `npx playwright test` bypasses framework history. Draft recovery and datasets are proposed for V4; see V4-ROADMAP.md.

The older `v3.0.0` Git tag points to the beta baseline, and `v3.0.0-final` preserves the first finalization checkpoint. Both are preserved; the stable package version is `3.0.0` and its final release tag is `v3.0.0-final.1`.

See V3-VALIDATION.md for the checks executed for this release and their limits.
