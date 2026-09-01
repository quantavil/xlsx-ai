# OpenRouter Support Design

## Goal

Add OpenRouter as a first-class AI provider for every AI-powered feature while preserving Gemini behavior and existing user settings.

## Scope

OpenRouter supports the spreadsheet AI drawer and all module AI operations, including ICEGrid extraction. Users select either Gemini or OpenRouter in Settings. Each provider retains independent credentials, model selection, and favorites.

The integration does not add automatic provider fallback, server-side credential storage, usage accounting, price estimation, or non-text AI models.

## Architecture

Introduce an `AiProvider` identifier with the values `gemini` and `openrouter`. Provider-specific configuration is stored as independent profiles containing saved API keys, the active key index, selected model, and favorite models. The existing public store getters for the active API key and model remain derived from the selected profile, limiting changes in existing consumers.

The browser AI client sends an `x-ai-provider` header in addition to the existing `x-ai-api-key` and `x-ai-model-id` headers. Requests without `x-ai-provider` default to Gemini for backward compatibility.

On the server, a provider factory validates the provider/model pair and creates an AI SDK `LanguageModel`:

- Gemini uses the existing `@ai-sdk/google` integration.
- OpenRouter uses `@openrouter/ai-sdk-provider` and its chat model interface.

The existing `generateObject` table workflows and module handlers receive the resulting provider-neutral language model. Prompt construction, response schemas, timeouts, and patch review remain shared.

Module manifests replace the Gemini-specific `requirements.gemini` capability with provider-neutral `requirements.ai`. The module execution context carries the provider alongside the active key and model.

## Persistence and Migration

Provider settings are persisted separately so switching providers restores the last configuration used for that provider. The active provider is also persisted.

Existing Gemini local-storage keys remain valid inputs to migration:

- `xlsx-ai:gemini-key`
- `xlsx-ai:gemini-keys`
- `xlsx-ai:gemini-model`
- `xlsx-ai:gemini-favorites`

On hydration, those values populate the Gemini profile without altering the OpenRouter profile. Existing users therefore retain saved keys, their selected Gemini model, and favorites. Corrupt or partially valid provider data falls back only within the affected profile.

OpenRouter does not receive an arbitrary offline default model. Until the user fetches the catalog and chooses a model, AI actions report that a model must be selected. This avoids silently selecting a model with unknown cost. If a previously selected model is absent from a refreshed catalog, it remains displayed as unavailable and the app requires an explicit replacement.

## Model Discovery and Eligibility

`GET /api/ai/models` becomes provider-aware through `x-ai-provider`.

For Gemini, the endpoint preserves the current paginated Google Generative Language API behavior and model formatting.

For OpenRouter, the endpoint calls `https://openrouter.ai/api/v1/models` with bearer authentication and maps the returned `data` items into the existing `AiModelConfig` shape. It only includes models that:

- produce text output; and
- explicitly advertise `structured_outputs` in `supported_parameters`.

This filtering is required because all current generation paths use schema-constrained structured output. Context length is formatted into the existing token-window label. Model IDs remain the exact OpenRouter slugs, such as `anthropic/claude-...`.

Model validation is provider-specific. Gemini retains its existing ID restrictions and specialized-model exclusions. OpenRouter accepts bounded `author/model` slugs and rejects malformed identifiers before contacting the upstream provider.

## Settings and UI

The AI settings page adds a Gemini/OpenRouter segmented selector above the credentials card. The selected provider controls:

- credential label and placeholder;
- saved-key list and active key;
- API-key help link;
- live model catalog, selected model, and favorites;
- provider-specific loading, success, and failure messages.

The existing model cards and search behavior are reused. The model list is cleared or restored when the provider changes, and in-flight catalog requests are cancelled so a late response cannot overwrite the newly selected provider.

The AI drawer and shared warnings use provider-neutral copy such as “AI Assistant” and “Ask AI…”. Where a provider-specific action fails, messages name Gemini or OpenRouter. Module UI checks for a valid active AI provider configuration rather than a Gemini key specifically.

## Request Flow

1. The user selects a provider, active API key, and model in Settings.
2. The AI drawer or module runner reads the active provider profile.
3. The shared browser client sends provider, key, model, payload, and abort signal to `/api/ai`.
4. The API route validates the request envelope and provider credentials.
5. The provider factory validates the model ID and creates the appropriate AI SDK model.
6. The existing table or module handler executes with the provider-neutral model.
7. The route returns the same structured response shape currently consumed by the UI.

OpenRouter API keys remain in browser local storage and are forwarded per request. They are never persisted by the server. OpenRouter attribution headers identify xlsx-ai when a reliable request origin is available.

## Error Handling

Authentication, model discovery, and generation errors retain useful upstream status codes where safe:

- missing or malformed active configuration: `401` for credentials and `400` for provider/model selection;
- invalid or unauthorized key: `401`;
- unavailable or unknown model: `404` or the provider's equivalent mapped to a clear model-selection message;
- rate limit: `429`;
- application deadline: `504`;
- malformed upstream response or other provider failure: `502`.

Messages name the active provider and never include API keys, prompts, table contents, or full upstream error objects. Existing sanitized diagnostic logging gains the provider identifier.

## Testing

Implementation follows test-driven development. Tests cover:

- provider-specific state hydration, persistence, switching, and legacy Gemini migration;
- isolation of keys, models, and favorites between providers;
- shared client transmission of `x-ai-provider`;
- provider-aware model-ID validation and language-model construction;
- Gemini and OpenRouter model-catalog response mapping and filtering;
- missing-key, invalid-key, unknown-model, rate-limit, timeout, and malformed-response behavior;
- module execution carrying OpenRouter context through the shared route;
- provider-neutral requirements and UI copy;
- settings provider switching, catalog cancellation, unavailable selection behavior, and model selection.

Focused tests run after each red/green cycle. Final verification runs the complete Bun test suite, TypeScript and Svelte checks, lint/dead-code scans, production build, and the relevant Playwright flow.

## Dependencies

Add `@openrouter/ai-sdk-provider`, using a version compatible with the repository's AI SDK v7 dependency. No second generic OpenAI client is added.

## Success Criteria

- A user can save OpenRouter keys, fetch eligible OpenRouter models, select one, and use it for both spreadsheet AI and ICEGrid.
- Switching between Gemini and OpenRouter restores each provider's independent settings.
- Existing Gemini users retain their current settings after upgrading.
- Gemini behavior and response contracts remain backward compatible.
- Unsupported OpenRouter models are excluded before selection, and provider failures produce actionable, sanitized messages.
- All automated verification passes.
