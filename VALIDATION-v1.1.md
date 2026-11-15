# v1.1 authoring update — actual validation

Validated on 21 October 2026 on Windows with Node.js 24.15.0 and Playwright 1.56.1.

## Results

- Full verification run: **159 tests passed; 0 failed; 0 cancelled; 0 skipped**, exit code 0. Duration approximately 302 seconds.
- Framework TypeScript checking passed: `npm run typecheck`.
- Application/configuration TypeScript checking passed: `npm run qa:check`.
- Browser scripts and panel JavaScript parsed successfully.
- Dynamic module listing returned the four intended empty modules.

The full run used the existing installed Chromium cache and `$env:TPHUB_HEADLESS = '1'`. Normal users should run `npx playwright install chromium`; no machine-specific browser path is hardcoded in the framework.

## New authoring verification

The new integration scenario used a real headless Chromium browser and synthetic local pages. It checked:

- Visible Actions mode and its text-entry box, including Unicode and multiline input.
- Replace text, character-by-character typing with delay, append and clear.
- Copying an element's current value and pasting it into another field using the recorder clipboard.
- Keyboard shortcuts, single/multiple option values, check and uncheck.
- Secret-value removal from saved recording content.
- Step duplication with a new ID and editable text in the side panel.
- Typing/pasting into the built-in source editor.
- Rejection of invalid edited TypeScript before writing the saved flow.
- Persistence of valid edited source.
- Compilation and successful execution of both generated Page Object and flat tests, including a value assertion.

The existing recorder tests also passed for locator choices, suggestions, repeated generated-test execution, expected failures, iframe, open shadow DOM, popups, dialogs, upload/download, drag, SPA navigation, widgets, session reuse, toolbar modes, saving previews, deletion and reordering. Framework checks for module discovery, file/module/all execution, real failure exit codes, native reports, empty selections and overlapping-run protection passed.

## Practical limits

- Headed desktop-browser startup remains unverified in this restricted session. The full verification run used headless Chromium.
- There are no company application tests in the package. The application test modules contain only empty marker files. Verification results do not claim company regression coverage.
- Explicit Copy/Paste transfers the entire source value/text through a BrowserContext-scoped helper. It does not test native clipboard events, arbitrary highlighted substrings or system clipboard permissions.
- Ordinary system paste into a webpage is recorded as the resulting final field value. Use explicit recorder Copy/Paste when a fresh runtime value must be transferred.
- Editing a step or source does not execute it in the current browser. Save and run the saved test to check the changed journey.
- Applied raw source overrides stay active for matching files until reset. Set the module, name and style before editing. Changing those clears the overrides. Raw recording JSON does not contain arbitrary code edits.
- Generated-code validation checks syntax, imports and types; it cannot prove business correctness. Review weak locators, coordinates and assertions.
- Sensitive data manually pasted into raw code is not automatically redacted.
- Long delayed typing may need a larger action/test timeout in your application configuration.
- Cross-origin frames, closed shadow DOM, custom canvas controls and application-specific login/data constraints require separate application testing.
- Email, product-data generators, CI configuration and one-click Windows launchers are outside this update.

The original recorder and the previous Milestone 1 copy were left unchanged. This update was made in a new separate copy.
