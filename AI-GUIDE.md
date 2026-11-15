# Optional AI assistant — free-tier setup and use

This version adds optional AI to the existing custom recorder. It does not replace the recorder or Playwright runner. AI starts disabled, and no key is required for normal recording, editing, saving or execution.

## Quick setup without editing code

1. Extract the new ZIP into its own folder and install dependencies/browser as described in README.md.
2. Start the recorder from this new folder:

```powershell
npm run record -- --url "https://your-staging-app.example" --module my-product
```

3. Open **Optional AI assistant — free-tier controls** in the side panel.
4. Select your provider and model. For Gemini, the initial model is `gemini-2.5-flash-lite`, listed with a free tier when checked on 21 October 2026. Confirm current eligibility in your account before use.
5. Enter your API key in the local password field. Do not post it in chat or paste it into your automation source.
6. Check **Enable AI** and click **Save AI settings**. The input clears; the local server keeps the key in memory for this recorder session. Saving settings does not contact the provider or verify the key. The status explicitly says the provider is contacted only on Send.

For Groq, enter a model ID available to your free account; no potentially ineligible Groq model is selected automatically. For a custom provider, use its HTTPS OpenAI-compatible chat-completions base URL, such as `https://your-provider.example/v1`, and its matching key/model. A standard Anthropic or other noncompatible API is not supported merely by pasting its key into this field.

The software does not determine whether an account is billed. A free key is subject to provider/model/account/region rules. Use an eligible free account/model and verify billing settings with your provider. The app never upgrades your account or falls back to a paid provider/model.

## Features

| Task | Input | Result |
| --- | --- | --- |
| Improve selected script | One selected generated TypeScript/JSON file, plus your optional request | Proposed complete replacement for that file, preserving existing behaviour and assertions where possible |
| Suggest assertions | Selected source and your optional requirements | Suggested checks, snippets and assumptions for review |
| Explain failure | Selected source plus the latest runner text, or an error you paste into the preview | Likely causes, evidence and debugging suggestions; not an executed fix |

The selected-file limit for complete-file improvement is 7,000 characters to avoid sending an incomplete file and asking the model to invent the rest. Larger files are rejected for improvement. Assertion/failure advice may use a labelled truncated file context. The model does not see imported Page Object implementations unless that file is the selected input.

## Preview, send, review, apply

1. Select a file tab and a task. If desired, enter an instruction such as "explain the selector failure" or "suggest a check after submission".
2. Click **Prepare preview (no API call)**. This does not use quota. Any unapplied source edit is first applied locally so the preview reflects it.
3. Read/edit the exact outgoing text. Remove private identifiers, customer details and any data that is not approved for external processing.
4. Check the approval checkbox and click **Send reviewed request**. One HTTP request is made to the configured provider. There are no tool calls, background AI requests, retries or provider fallbacks.
5. Read the response. AI may be wrong and cannot invent successful execution evidence.
6. For **Improve selected script**, **Load proposed code into editor** loads an unsaved draft. Select the original file tab first. Review the code; it is not applied, saved or executed yet.
7. Click **Apply code edit**, then **Save files**. The existing TypeScript/import/type validation runs before the flow is written. Then explicitly click **Run saved test**.

Assertion/failure advice can be copied manually. It is not inserted automatically. Truncated model output is labelled and the Load button is disabled. If the model returns prose instead of a complete file, copy/edit the intended code yourself or revise the request; invalid TypeScript is rejected on save. Compilation does not prove business correctness or safety of arbitrary generated code.

## Quota controls

- One active request at a time.
- At least 15 seconds between new requests. Provider Retry-After on HTTP 429 is respected, up to a one-hour cooldown. No automatic retry is scheduled.
- 20 HTTP requests per recorder session by default, adjustable deliberately from 1 to 100. Failed calls count too. Changing settings does not reset the request count.
- Maximum 12,000 input characters. By default the preview includes up to 7,000 file characters, up to 800 instruction characters and, for failure analysis, up to 3,000 recent log characters.
- Output cap of 1,024 tokens by default, adjustable from 128 to 2,048. A longer complete script may need the larger cap or a smaller selected file. Provider thinking/accounting rules may differ.
- Up to 10 identical responses cached in process memory. Re-sending identical reviewed input with unchanged settings uses that cache and does not create another provider request. Changing settings clears the cache.
- No images, full DOM, traces, entire project uploads, embeddings, search grounding or conversation history are sent.
- Provider token usage is displayed when returned. It is not a price calculation or a guarantee that a call is free.

These controls reduce accidental usage; they are not the provider's quota system or a billing cap. A provider can reject an eligible free request when shared limits are exhausted.

## Keys and data

Keys entered in the panel are sent only to the local loopback server and retained in its memory. They are not returned in panel state/SSE, stored in localStorage/sessionStorage, written into project configuration, or included in generated scripts/release archives. Only the provider authentication header receives the key. Keys are not put in API URLs. Changing providers without supplying a matching key clears the old provider key; keys are not forwarded across providers automatically.

Use **Disable and clear key** when finished, or stop the recorder process. Environment-based keys are still present in that process environment until it exits; a new recorder will remain AI-disabled until explicitly enabled.

Outgoing previews mask known recorded secret values, the configured API key and common secret patterns. This is best effort, not complete anonymization. Code comments, unknown credentials, email addresses and runner logs can still contain private data; review the preview before sending. Returned text is displayed as plain text, not executed HTML.

Gemini's free-tier pricing documentation says submitted content can be used to improve Google's products. Other providers have their own terms. Use approved/synthetic data for free-tier experimentation and follow your company's external-AI policy. No screenshot, trace, full DOM or authentication state is automatically submitted by this version.

## Optional environment configuration

Instead of entering a session key in the UI, set environment variables locally before launching:

- `AI_PROVIDER`: `gemini`, `groq` or `compatible`.
- `AI_MODEL`: a model available to your account.
- `AI_API_KEY`: the key for that initial provider.
- `GEMINI_API_KEY` / `GROQ_API_KEY`: optional provider-specific alternatives.
- `AI_BASE_URL`: required for a custom compatible provider.

AI still starts disabled. Enable it in the panel explicitly. `.env.example` documents placeholders; `.env` is not loaded automatically. Do not commit real keys.

## Troubleshooting

- **AI disabled/key missing:** enable it, enter a key and Save AI settings. A configured key has not been tested until you explicitly Send.
- **401:** invalid/revoked key or authentication issue.
- **403:** check provider key permissions and free-plan model access.
- **404:** model ID or endpoint unavailable; select an accessible model. There is no automatic fallback.
- **429:** free quota or a local request budget/cooldown was reached. Wait, check the provider console or deliberately adjust the local session budget.
- **Network/timeout:** the request stops after 45 seconds and is not retried. Recorder features remain usable.
- **Empty/blocked/truncated response:** revise the approved prompt, model or output budget; the software does not treat it as a valid executed fix.
- **Unsaved settings:** save settings before sending; provider/model changes do not silently affect a previous request.

## Provider references (checked 21 October 2026)

- Gemini keys: https://ai.google.dev/gemini-api/docs/api-key
- Gemini pricing/free-tier data-use notes: https://ai.google.dev/gemini-api/docs/pricing
- Gemini content generation: https://ai.google.dev/api/generate-content
- Groq compatible endpoint: https://console.groq.com/docs/openai
- Groq model IDs: https://console.groq.com/docs/models
- Groq limits: https://console.groq.com/docs/rate-limits

## Validation limit

No real provider key was supplied. Adapter request formats, redaction, budgets, HTTP errors and the browser review/apply/save/run flow were tested using isolated mock responses. Real provider authentication, current model availability and response quality must be checked with your own account after configuration. No live AI response or free quota was invented.
