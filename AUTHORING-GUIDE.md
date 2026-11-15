# Type, paste and edit automation scripts

## Start the updated version

Extract this new ZIP into its own folder. Run PowerShell there:

```powershell
npm ci
npx playwright install chromium
npm run record -- --url "https://your-staging-app.example" --module my-product
```

Use the new folder's command. Running a previous copy continues to open its previous interface.

## Enter text through an explicit control

1. In the webpage toolbar or side panel, choose **Actions**.
2. Click the input, textarea or editable element on your website.
3. In the action menu, type or paste into **Text to enter**. Ctrl+V uses your normal clipboard in this text box. Unicode and multiple lines are supported by compatible target fields.
4. Choose an entry method:
   - **Replace / paste text** clears and fills the target via `fill()`.
   - **Replace, then type characters** clears the field and uses `pressSequentially()` for keyboard-driven widgets.
   - **Append characters** moves to the end and types additional text.
5. Optionally set a delay between characters, from 0 to 1000 milliseconds.
6. Click **Apply text**. This executes the action in the website and records it. An action error is displayed instead of pretending it succeeded.

Use **Clear field** to record `fill('')`. For ordinary recording, switch to **Record** and type directly into your website; pending values are captured when you leave a field or explicitly save.

## Copy and paste between elements

1. Choose **Actions**, click the source input or text element, then choose **Copy value / text**.
2. Click the destination input/textarea, then choose **Paste recorder clipboard**.

This copies the whole input value or element text and replaces the destination value. At replay time, the generated helper reads the source again, so it can transfer a newly generated ID instead of a stale literal.

This is a portable clipboard tied to each Playwright BrowserContext, not the operating system clipboard. It works across pages in the same context and does not require clipboard permissions. Pasting before a Copy action fails clearly. It does not copy an arbitrary highlighted substring or test whether your application handles native clipboard events. Use normal system Ctrl+C/Ctrl+V while recording if you only need the resulting final field value recorded as a fill.

## Keys, dropdowns and checkboxes

The Actions menu includes Enter, Tab, Escape, ArrowUp/Down, Select All (`ControlOrMeta+A`), and a custom shortcut input such as Shift+Tab or ControlOrMeta+End.

For a native select element, choose one or more options and click **Apply selection**. Values are stored using the option values; Page Object method parameters support arrays for multiple selections. Custom dropdown widgets still use their normal clicks, typing and keyboard events.

Checkboxes and radios expose **Check / enable**. Checkboxes also expose **Uncheck / disable**. Existing hover, scroll, drag, right-click/double-click capture, assertions, waits, uploads, dialogs, iframe/shadow/popup handling and module execution remain available.

## Edit recorded steps

Each text step has editable text, entry method and typing delay. Secret steps have a replacement password input instead of displaying their current value.

**Duplicate step** inserts a copy after the selected step. **Copy locator** copies the locator string. Drag the step number handle to reorder, or delete a step.

Editing, duplicating or reordering a recorded step changes the proposed test; it does not execute that change in the current browser. Save and run the test to validate the edited journey.

## Type or paste raw automation code

1. Choose the module, test name and output style first.
2. Select a generated TypeScript or JSON file tab.
3. Click **Edit code**. You can type, select text and paste code normally in the editor.
4. Click **Apply code edit**. **Save files** also applies an outstanding edit before saving.
5. Save the flow. TypeScript syntax, imports and types are checked at the final file paths. Invalid code is rejected before the flow is created.
6. Run the saved test. Compilation is not proof of successful execution.

The editor changes existing generated files; it does not create new file tabs. Applied manual edits remain active for those files when recording changes. **Reset code edits** restores generated content and discards the edits. Changing the module, test name or output style clears applied overrides, so copy any code you want to keep first. Apply an unfinished edit before changing file tabs.

The raw recording retains recorded steps, not arbitrary code edits. Regenerating from the recording JSON recreates generated code and does not reconstruct your manual source edits. Your edited source is preserved in the saved test folder.

Secret fields detected by the recorder use environment variables in generated code. Manually pasted code is not automatically redacted; do not paste literal credentials into it.

## Save and run

Choose a test name and click **Save files**, then **Run saved test**. The application modules are still empty in this package; verification tests live separately under test/ and .tmp/. Existing recordings with the same name are protected from overwriting.
