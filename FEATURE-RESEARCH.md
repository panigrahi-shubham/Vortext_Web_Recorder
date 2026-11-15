# Automation authoring feature choices

This research records the v1.1 authoring scope. Optional AI support was added in v1.2; see AI-GUIDE.md for its separate design, provider references and limits.

Reviewed official Playwright documentation on 21 October 2026. These choices cover common documented automation tasks; no market-share or usage-frequency measurement is claimed. The implementation is kept compatible with the installed Playwright 1.56.1 rather than depending on newer APIs shown in current documentation.

| Task | Implementation in this update | Reason |
| --- | --- | --- |
| Ordinary text and pasted values | Explicit text box, replace/clear via fill() | Playwright recommends fill() for normal text entry. |
| Autocomplete and keyboard-sensitive inputs | Replace then pressSequentially(), or append; configurable delay | Per-character keyboard events can be needed by such widgets. |
| Copy dynamic values between elements | copyText/pasteText helpers scoped to BrowserContext | Reads the value at runtime and avoids OS clipboard permission dependencies. This is not native clipboard-event testing. |
| Enter, Tab, Escape, arrows, modifiers | Common keys and custom press() action | Keyboard shortcuts are part of Playwright's documented input capabilities. |
| Native dropdowns | Single/multiple option selection with stored values | selectOption() supports single/multiple selections. |
| Checkbox/radio control | Explicit check()/uncheck() | Expresses the desired state rather than relying on a blind toggle. |
| Maintainable locator reuse | Existing verification plus Copy locator | Official guidance prioritizes user-facing attributes and explicit test contracts. |
| Script maintenance | Recorded text editing, duplicate/reorder, editable TypeScript/JSON | Lets testers review generated actions and make intentional edits before replay. |
| Reliable checks/waits | Existing web-first assertions and Wait for mode retained | Prefer retrying assertions over arbitrary sleeps. |
| Upload, dialogs, popup, iframe and open shadow DOM | Existing engine retained and regression-tested | These capabilities already existed; they were not rebuilt. |

## Official references

- Input actions, text, character typing, keys, selections and uploads: https://playwright.dev/docs/input
- Locator API: https://playwright.dev/docs/api/class-locator
- Keyboard shortcuts and ControlOrMeta: https://playwright.dev/docs/api/class-keyboard
- Locators and resilience: https://playwright.dev/docs/locators
- Web-first assertions: https://playwright.dev/docs/test-assertions
- Test generator and reviewing generated code: https://playwright.dev/docs/codegen

## Deliberately outside this update

Native clipboard event testing, arbitrary highlighted-substring clipboard capture, self-healing claims, AI APIs, a custom test runner, automatic company login, SMTP, dynamic product-data generators, CI setup and framework-wide shared Page Object refactoring are not added. Application-specific selectors and expected business outcomes still require a tester's review.
