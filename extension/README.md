# Vortex Locator Scout — v3 beta integration

This extension is part of the Vortex QA repository. Build with `npm ci --prefix extension` followed by `npm run build:extension` from the repository root. Load `extension/dist` unpacked, or extract the generated release ZIP. The source under `src/engine` also builds the browser engine shipped in the npm software's `scout` command. It does not contact a local recorder server or send page data to a provider.

The supplied extension's host permissions cover all URLs so its picker can work in page frames. Review these permissions when installing. Managed browsers may prevent installing custom extensions.

## Original extension guide

# Locator Scout (working name)

Chrome extension that finds an element and suggests ranked, verified locators for
**Playwright (TypeScript)** and **Selenium (Java)**. Rule-based: no AI, no network calls,
everything runs inside the page.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist` folder
4. Pin the extension. Reload any tab that was already open (or just start picking: the
   script is injected on demand).

Needs Chrome 116 or newer (also works in Edge).

## Use

| Action | How |
|---|---|
| Open the panel | Click the toolbar icon |
| Pick mode | **Pick element** in the panel, or `Alt+Shift+L` |
| Pick | Click an element. The best locator is copied to the clipboard |
| Parent / child | `↑` / `↓` while hovering, `Enter` to pick |
| Exact element (no retargeting) | Hold `Shift` while clicking |
| Stop | `Esc` |
| One-off pick | Right-click → *Locator Scout: suggest locator* |

Panel tabs:

- **Inspect**: candidates for the last pick with a stability score, the reason for each
  one, and a rule trace of what was rejected and why.
- **Collected**: every pick, renameable, exportable as one Page Object (`.ts` or `.java`).
- **Scan**: all interactive elements on the page in one pass. Rows of the same list are
  folded into one parameterised locator.
- **Verify**: paste any locator (CSS, XPath, Playwright chain, Selenium `By`) and see the
  match count and highlights live.
- **Settings**: test id attributes, auto-copy, continuous picking, auto-collect.

## The rules

Each candidate is checked against the live DOM and kept only if it matches exactly the
picked element.

| Rule | Score | Notes |
|---|---|---|
| Test id (`data-testid`, `data-test`, `data-qa`, `data-cy` ...) | 100 | configurable list |
| Role + accessible name | 92 | substring first, `exact: true` only when needed |
| Label | 88 | |
| Stable id | 86 | generated ids are rejected |
| Placeholder | 84 | |
| `name` attribute | 80 | |
| Text | 74 | |
| CSS on attributes / classes | 66 / 58 | minus 4 per ancestor hop, minus 18 for `:nth-of-type` |
| XPath on text / attribute / class / index | 60 / 56 / 46 / 28 | |

80+ is **high**, 50+ is **medium**, below is **low**.

Extra rules:

- **Dynamic values**: ids and classes that look generated (`ember1423`, `css-1x2y3z`,
  `sc-bdVaJa`, `Button_root__3xK2a`, `:r1a:`, long digit runs, UUIDs), state classes and
  utility classes are never used.
- **Dynamic numbers**: `Active (5675)` becomes `/^Active \(\d+\)$/` in Playwright and
  `starts-with(normalize-space(), 'Active (')` in XPath. `3G Router` is left alone.
- **Counter badges**: `Lead Manager` + `<span>71</span>` matches any count.
- **Retargeting**: a click on an `<svg>`/`<path>`/`<span>` inside a button or link picks
  the button or link.
- **Anchoring**: when an element is not unique on its own (the edit icon on every product
  card), it is anchored to the repeating container identified by its text, and exported
  as a method: `editIcon(text)`.
- **Scoping**: otherwise it is scoped to the nearest unique region.
- **Frames and shadow DOM**: `frameLocator()` chains for iframes; open shadow roots are
  searched for Playwright (Selenium gets no `By` there).

## Project layout

```
src/engine      rule engine, no chrome.* APIs (unit-testable, reusable in a recorder/codegen)
  generate.ts     pipeline: semantic rules -> CSS/XPath -> anchoring -> scoring + trace
  dynamic.ts      generated id / class / number detection
  queries.ts      DOM equivalents of getByRole / getByText / ... used for verification
  anchor.ts       repeating container and unique region detection
  css.ts xpath.ts structural locators
  emit.ts         Playwright TS / Selenium Java emitters and Page Object templates
  lookup.ts       reverse lookup parser (Verify tab)
  scan.ts         page scan + retargeting
src/content     picker overlay and message handling (runs in every frame)
src/background  service worker: shortcut, context menu, collection storage
src/panel       side panel UI
test            jsdom tests and the fixture page
```

## Develop

```
npm install
npm test          # engine tests
npm run build     # writes dist/
npm run watch
```

After a rebuild click the reload icon on `chrome://extensions`.

## Known limits

- Closed shadow roots and `<canvas>` UIs cannot be inspected.
- The frame selector for a cross-origin iframe is a best guess and is marked as such.
- Role and accessible name follow the ARIA rules but are not Playwright's own
  implementation, so check unusual widgets once in the Verify tab or in a test run.
- Scan and Verify work on the top frame; the picker works in every frame.
- Selenium has no role or label locators, so those candidates only appear for Playwright.
- The right-click entry needs the content script to be present, so reload tabs that were
  open before the extension was installed.
