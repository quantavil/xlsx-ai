# OpenRouter Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenRouter as a selectable, independently configured AI provider for the spreadsheet assistant and every AI module while preserving existing Gemini users.

**Architecture:** Provider selection lives in a small shared AI provider module and provider-scoped store profiles. The browser sends the provider with the existing key/model headers; the server validates that tuple and constructs either a Google or OpenRouter AI SDK `LanguageModel`, leaving all structured generation workflows shared.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript 5.9, Bun test, AI SDK 7, `@ai-sdk/google`, `@openrouter/ai-sdk-provider` 3.x, Zod 4.

---

## File Map

- Create `src/lib/ai/providers.ts`: provider identifiers, labels, storage-safe defaults, header parsing, and provider-specific model-ID validation.
- Create `src/lib/server/ai-provider.ts`: construct a provider-neutral AI SDK language model from provider, key, model, and request origin.
- Modify `src/lib/constants.ts`: replace Gemini-only persistence/default constants with provider-profile constants while retaining legacy migration constants.
- Modify `src/lib/table/store.svelte.ts`: hold provider-scoped keys/models/favorites, migrate legacy Gemini settings, and expose the active profile through existing getters.
- Modify `src/lib/ai/client.ts`: carry the provider in the shared client and request header.
- Modify `src/routes/api/ai/models/+server.ts`: dispatch Gemini/OpenRouter catalog requests and map OpenRouter models.
- Modify `src/routes/api/ai/+server.ts`: validate provider configuration, use the provider factory, carry provider into modules, and format provider-specific errors.
- Modify `src/lib/server/modules/types.ts`, `src/lib/modules/types.ts`, `src/lib/modules/module-store.svelte.ts`, `src/lib/modules/icegrid/index.ts`, and `src/lib/modules/icegrid/extract.ts`: make module requirements and execution provider-neutral.
- Modify `src/routes/settings/+page.svelte` and `src/lib/components/settings/AiSection.svelte`: provider selector, provider-specific credentials, model discovery, and unavailable-model handling.
- Modify `src/lib/components/AiDrawer.svelte` and `src/lib/components/RightRibbon.svelte`: pass the active provider and remove Gemini-only copy.
- Modify `tests/app/table.test.ts`, `tests/app/ai-client.test.ts`, `tests/app/ai.test.ts`, and `tests/app/modules.test.ts`: provider behavior and regressions.
- Modify `package.json` and `bun.lock`: add the OpenRouter AI SDK provider.

### Task 1: Provider Types and Provider-Scoped Store State

**Files:**
- Create: `src/lib/ai/providers.ts`
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/table/store.svelte.ts`
- Test: `tests/app/table.test.ts`

- [ ] **Step 1: Write failing store tests**

Add tests that demonstrate provider isolation and legacy migration:

```ts
it('keeps credentials, models, and favorites isolated by provider', () => {
	const store = createTableStore({ title: 'T', columns: [], rows: [] }, { persist: false });
	store.addApiKey('AIzaSyGeminiKey1234567890');
	store.setAiModel('gemini-3.6-flash');
	store.toggleFavoriteModel('gemini-3.6-flash');

	store.setAiProvider('openrouter');
	expect(store.apiKey).toBe('');
	expect(store.aiModel).toBe('');
	expect(store.favoriteModels).toEqual([]);

	store.addApiKey('sk-or-v1-openrouter-test-key');
	store.setAiModel('anthropic/claude-sonnet-4');
	store.toggleFavoriteModel('anthropic/claude-sonnet-4');
	store.setAiProvider('gemini');

	expect(store.apiKey).toBe('AIzaSyGeminiKey1234567890');
	expect(store.aiModel).toBe('gemini-3.6-flash');
	expect(store.favoriteModels).toEqual(['gemini-3.6-flash']);
});

it('migrates legacy Gemini settings into the Gemini profile', () => {
	localStorage.setItem('xlsx-ai:gemini-keys', JSON.stringify({ keys: ['AIzaSyLegacyKey'], active: 0 }));
	localStorage.setItem('xlsx-ai:gemini-model', 'gemini-3.6-flash');
	localStorage.setItem('xlsx-ai:gemini-favorites', JSON.stringify(['gemini-3.6-flash']));
	const store = createTableStore({ title: 'T', columns: [], rows: [] }, { storageKey: 'test:provider-migration' });
	store.hydrate();
	expect(store.aiProvider).toBe('gemini');
	expect(store.apiKeys).toEqual(['AIzaSyLegacyKey']);
	expect(store.aiModel).toBe('gemini-3.6-flash');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test tests/app/table.test.ts`

Expected: FAIL because `setAiProvider` and `aiProvider` do not exist and settings are not provider-scoped.

- [ ] **Step 3: Add provider definitions and defaults**

Create `src/lib/ai/providers.ts` with the concrete public contract:

```ts
export const AI_PROVIDERS = ['gemini', 'openrouter'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiProviderProfile {
	keys: string[];
	activeKeyIndex: number;
	modelId: string;
	favoriteModels: string[];
}

export function parseAiProvider(value: string | null | undefined): AiProvider | null {
	return value === 'gemini' || value === 'openrouter' ? value : null;
}

export function providerLabel(provider: AiProvider): string {
	return provider === 'gemini' ? 'Google Gemini' : 'OpenRouter';
}

export function isSupportedModelId(provider: AiProvider, modelId: string): boolean {
	if (provider === 'gemini') {
		return /^gemini-[a-z0-9][a-z0-9._-]{2,80}$/i.test(modelId) &&
			!/(?:image|imagen|embedding|audio|speech|tts|live|robotics|aqa|transcribe|veo|lyria)/i.test(modelId);
	}
	return /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._:+-]{0,127}$/i.test(modelId);
}
```

Add `LS_AI_SETTINGS = 'xlsx-ai:ai-settings:v1'`, keep the old Gemini constants explicitly marked for migration, and define `DEFAULT_AI_PROVIDER = 'gemini'`.

- [ ] **Step 4: Implement provider profiles in the table store**

Replace the single key/model/favorites fields with a record whose active getters preserve the existing API:

```ts
let aiProvider = $state<AiProvider>(DEFAULT_AI_PROVIDER);
let aiProfiles = $state<Record<AiProvider, AiProviderProfile>>({
	gemini: { keys: [], activeKeyIndex: 0, modelId: DEFAULT_AI_MODEL, favoriteModels: [] },
	openrouter: { keys: [], activeKeyIndex: 0, modelId: '', favoriteModels: [] }
});
const activeAiProfile = $derived(aiProfiles[aiProvider]);
const apiKey = $derived(activeAiProfile.keys[activeAiProfile.activeKeyIndex] ?? '');
```

Implement `setAiProvider`, and make `addApiKey`, `removeApiKey`, `useApiKey`, `setAiModel`, and `toggleFavoriteModel` update only the active profile before persisting the complete settings object. Hydration must parse the new object defensively and, when absent, migrate the old Gemini keys/model/favorites into only the Gemini profile. Continue retiring obsolete Gemini models during migration.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `bun test tests/app/table.test.ts`

Expected: PASS, including all pre-existing table/store tests.

- [ ] **Step 6: Commit the state slice**

```bash
git add src/lib/ai/providers.ts src/lib/constants.ts src/lib/table/store.svelte.ts tests/app/table.test.ts
git commit -m "feat(ai): add provider-scoped settings"
```

### Task 2: Shared Client and Server Provider Factory

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/lib/server/ai-provider.ts`
- Modify: `src/lib/ai/client.ts`
- Modify: `src/lib/server/models.ts`
- Test: `tests/app/ai-client.test.ts`
- Test: `tests/app/ai.test.ts`

- [ ] **Step 1: Write failing client and validation tests**

Add `provider: 'openrouter'` to a client fixture and assert:

```ts
expect(ai.provider).toBe('openrouter');
expect(capturedRequest?.headers.get('x-ai-provider')).toBe('openrouter');
```

Add server validation tests:

```ts
expect(_isSupportedModelId('openrouter', 'anthropic/claude-sonnet-4')).toBe(true);
expect(_isSupportedModelId('openrouter', 'gemini-3.6-flash')).toBe(false);
expect(_isSupportedModelId('gemini', 'anthropic/claude-sonnet-4')).toBe(false);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `bun test tests/app/ai-client.test.ts tests/app/ai.test.ts`

Expected: FAIL because the client and validator accept no provider.

- [ ] **Step 3: Add the compatible OpenRouter provider dependency**

Run: `bun add @openrouter/ai-sdk-provider@^3.0.0`

Expected: `package.json` and `bun.lock` update; peer dependencies remain compatible with AI SDK 7 and Zod 4.

- [ ] **Step 4: Extend the shared browser client**

Change `CreateAiApiOptions` and `AiApi` to expose `provider: AiProvider`, default omitted providers to `gemini`, and send:

```ts
headers: {
	'Content-Type': 'application/json',
	'x-ai-provider': provider,
	'x-ai-api-key': apiKey,
	'x-ai-model-id': modelId
}
```

- [ ] **Step 5: Implement the server provider factory**

Create the provider-neutral boundary:

```ts
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { AiProvider } from '$lib/ai/providers';

export function createAiLanguageModel(options: {
	provider: AiProvider;
	apiKey: string;
	modelId: string;
	appUrl?: string;
}): LanguageModel {
	if (options.provider === 'gemini') {
		return createGoogleGenerativeAI({ apiKey: options.apiKey })(options.modelId);
	}
	const openrouter = createOpenRouter({
		apiKey: options.apiKey,
		appName: 'xlsx-ai',
		...(options.appUrl ? { appUrl: options.appUrl } : {})
	});
	return openrouter.chat(options.modelId);
}
```

Update `src/lib/server/models.ts` to re-export the provider-aware validator from `providers.ts`, maintaining a thin compatibility export for tests.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `bun test tests/app/ai-client.test.ts tests/app/ai.test.ts`

Expected: PASS for client headers and both provider validators.

- [ ] **Step 7: Commit the provider boundary**

```bash
git add package.json bun.lock src/lib/ai/client.ts src/lib/server/models.ts src/lib/server/ai-provider.ts tests/app/ai-client.test.ts tests/app/ai.test.ts
git commit -m "feat(ai): add OpenRouter provider boundary"
```

### Task 3: Provider-Aware Model Catalog

**Files:**
- Modify: `src/routes/api/ai/models/+server.ts`
- Test: `tests/app/ai.test.ts`

- [ ] **Step 1: Write failing OpenRouter catalog tests**

Mock `/api/v1/models` with one eligible model, one model lacking structured output, and one image-only model:

```ts
{
	data: [
		{
			id: 'anthropic/claude-sonnet-4',
			name: 'Claude Sonnet 4',
			description: 'Structured reasoning model',
			context_length: 200000,
			supported_parameters: ['structured_outputs'],
			architecture: { output_modalities: ['text'] }
		},
		{
			id: 'vendor/plain-chat',
			name: 'Plain Chat',
			context_length: 32000,
			supported_parameters: ['temperature'],
			architecture: { output_modalities: ['text'] }
		},
		{
			id: 'vendor/image-model',
			name: 'Image Model',
			context_length: 32000,
			supported_parameters: ['structured_outputs'],
			architecture: { output_modalities: ['image'] }
		}
	]
}
```

Call the route with `x-ai-provider: openrouter` and a test key. Assert only the Claude model is returned, its ID remains unchanged, and its context label is `200k tokens`. Add tests for OpenRouter `401`, `429`, malformed JSON shape, and unsupported provider headers.

- [ ] **Step 2: Run the catalog tests and verify RED**

Run: `bun test tests/app/ai.test.ts --test-name-pattern "OpenRouter|provider"`

Expected: FAIL because the route always calls Google and expects Google's schema.

- [ ] **Step 3: Split provider-specific catalog loading behind shared formatting**

Parse `x-ai-provider`, defaulting absence to Gemini and rejecting unknown values. Preserve the existing Gemini loader. Add Zod schemas for OpenRouter's `data` envelope and fields used by the app, then fetch:

```ts
await fetch('https://openrouter.ai/api/v1/models?output_modalities=text', {
	headers: {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json'
	},
	signal: controller.signal
});
```

Filter on `architecture.output_modalities.includes('text')`, `supported_parameters.includes('structured_outputs')`, and the OpenRouter model validator. Return the existing `{ success, count, models }` envelope. Map upstream auth/rate-limit errors to provider-named responses and malformed schemas to `502`.

- [ ] **Step 4: Run catalog tests and the complete AI endpoint test file**

Run: `bun test tests/app/ai.test.ts`

Expected: PASS for both existing Gemini and new OpenRouter catalog cases.

- [ ] **Step 5: Commit catalog support**

```bash
git add src/routes/api/ai/models/+server.ts tests/app/ai.test.ts
git commit -m "feat(ai): list structured OpenRouter models"
```

### Task 4: Provider-Aware Generation and Errors

**Files:**
- Modify: `src/routes/api/ai/+server.ts`
- Modify: `src/lib/server/modules/types.ts`
- Test: `tests/app/ai.test.ts`

- [ ] **Step 1: Write failing route tests**

Add tests proving:

```ts
it('rejects a missing OpenRouter model before generation', async () => {
	const response = await POST({ request: new Request('http://localhost/api/ai', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-ai-provider': 'openrouter',
			'x-ai-api-key': 'sk-or-v1-valid-test-key'
		},
		body: JSON.stringify({ tableContext: { columns: [], rows: [] } })
	}) } as any);
	expect(response.status).toBe(400);
	expect((await response.json()).error).toContain('OpenRouter model');
});
```

Also test that an OpenRouter module request reaches the registered handler with `provider`, `modelId`, and a provider-neutral `model`, and that sanitized errors say `OpenRouter` for `401`, `429`, `404`, and timeout cases. Existing no-provider requests must still behave as Gemini.

- [ ] **Step 2: Run route tests and verify RED**

Run: `bun test tests/app/ai.test.ts`

Expected: FAIL because `/api/ai` constructs Google unconditionally and emits Gemini-only errors.

- [ ] **Step 3: Route generation through the provider factory**

At the start of `POST`, parse the header with Gemini as the backward-compatible default. Validate provider-specific credentials and require an explicit OpenRouter model. Replace direct Google construction with:

```ts
const model = createAiLanguageModel({
	provider,
	apiKey,
	modelId: targetModel,
	appUrl: new URL(request.url).origin
});
```

Add `provider: AiProvider` to `ModuleAiServerContext` and pass it to module handlers. Include provider in sanitized logging. Centralize provider labels when building key, timeout, rate-limit, missing-model, and generic messages. Do not include request bodies or raw keys.

- [ ] **Step 4: Run route tests and verify GREEN**

Run: `bun test tests/app/ai.test.ts`

Expected: PASS for existing Gemini behavior and OpenRouter behavior.

- [ ] **Step 5: Commit generation support**

```bash
git add src/routes/api/ai/+server.ts src/lib/server/modules/types.ts tests/app/ai.test.ts
git commit -m "feat(ai): route generation through OpenRouter"
```

### Task 5: Provider-Neutral Module Execution

**Files:**
- Modify: `src/lib/modules/types.ts`
- Modify: `src/lib/modules/module-store.svelte.ts`
- Modify: `src/lib/modules/icegrid/index.ts`
- Modify: `src/lib/modules/icegrid/extract.ts`
- Modify: `src/lib/components/RightRibbon.svelte`
- Test: `tests/app/modules.test.ts`

- [ ] **Step 1: Write failing module tests**

Change the manifest expectation to:

```ts
expect(icegrid?.requirements.ai).toBe(true);
```

Run a module with an OpenRouter context and capture the request headers from the shared client:

```ts
await store.runModule('icegrid', [mockFile], {
	provider: 'openrouter',
	apiKey: 'sk-or-v1-valid-test-key',
	modelId: 'anthropic/claude-sonnet-4'
});
```

- [ ] **Step 2: Run module tests and verify RED**

Run: `bun test tests/app/modules.test.ts`

Expected: FAIL because requirements and module context remain Gemini-specific.

- [ ] **Step 3: Make the module interfaces provider-neutral**

Change `requirements` to `{ ai: boolean }`, add `provider: AiProvider` to `runModule` context, and pass it to `createAiApi`. Update ICEGrid progress and validation messages:

```ts
const label = providerLabel(context.ai.provider);
if (!context.ai.apiKey.trim()) {
	throw new Error(`${label} API key is missing. Please configure it in Settings.`);
}
context.onProgress(`Sending ${extraction.sourceFiles.length} document(s) to ${label} (${context.ai.modelId})...`);
```

Update `RightRibbon` to check `requirements.ai`, validate both key and selected model, and pass `store.aiProvider` into `runModule`.

- [ ] **Step 4: Run module and ICEGrid tests**

Run: `bun test tests/app/modules.test.ts tests/icegrid`

Expected: PASS; all ICEGrid schemas and transformations remain unchanged.

- [ ] **Step 5: Commit module support**

```bash
git add src/lib/modules/types.ts src/lib/modules/module-store.svelte.ts src/lib/modules/icegrid/index.ts src/lib/modules/icegrid/extract.ts src/lib/components/RightRibbon.svelte tests/app/modules.test.ts
git commit -m "refactor(ai): make module execution provider-neutral"
```

### Task 6: Settings and AI Drawer Provider UX

**Files:**
- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/lib/components/settings/AiSection.svelte`
- Modify: `src/lib/components/AiDrawer.svelte`
- Modify: `src/lib/components/settings/ModulesSection.svelte`
- Test: `tests/app/ai.test.ts`
- Test: `e2e/table.spec.ts`

- [ ] **Step 1: Add failing source-contract and browser tests**

Extend the app source assertions to require provider-neutral copy and provider controls:

```ts
expect(settingsPageSource).toContain("'x-ai-provider': store.aiProvider");
expect(aiSectionSource).toContain('Select AI provider');
expect(aiDrawerSource).toContain('AI Assistant');
expect(aiDrawerSource).not.toContain('Ask Gemini');
expect(modulesSectionSource).not.toContain('requirements.gemini');
```

Add a Playwright flow that opens Settings, selects OpenRouter, verifies the `sk-or-v1-...` placeholder and OpenRouter help link, then switches back and verifies the Gemini profile remains selected.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun test tests/app/ai.test.ts`

Expected: FAIL on missing provider selector and Gemini-specific copy.

- [ ] **Step 3: Implement provider-aware Settings orchestration**

Generalize `fetchModelsFromGoogle` to `fetchModels`. Capture provider and request ID before fetching; send both headers:

```ts
headers: {
	'x-ai-provider': provider,
	'x-ai-api-key': key
}
```

On provider change, abort the previous request, reset transient input/error/loading state, restore Gemini's offline fallback catalog or OpenRouter's empty catalog, and fetch only when the active profile has a key. Keep a selected-but-missing model visible as an unavailable card and disable AI execution until the user selects a returned model.

- [ ] **Step 4: Implement provider-aware settings controls**

Add a two-button segmented control with `aria-label="Select AI provider"` and `aria-pressed`. Derive provider metadata for labels, placeholders, and links:

```ts
const providerUi = $derived(store.aiProvider === 'gemini'
	? { label: 'Google Gemini', placeholder: 'AIzaSy...', href: 'https://aistudio.google.com/app/apikey', link: 'Google AI Studio' }
	: { label: 'OpenRouter', placeholder: 'sk-or-v1-...', href: 'https://openrouter.ai/settings/keys', link: 'OpenRouter Keys' });
```

Use provider-neutral model-card aria labels and provider-specific fetch titles/messages.

- [ ] **Step 5: Update assistant and module copy**

Pass `provider: store.aiProvider` to every `createAiApi` call in `AiDrawer`. Replace “Gemini Assistant,” “Gemini API Key Required,” and “Ask Gemini…” with provider-neutral equivalents. Keep failure messages returned by the server unchanged so provider-specific failures remain actionable. Change module badges from “Gemini” to “AI”.

- [ ] **Step 6: Run focused tests and checks**

Run: `bun test tests/app/ai.test.ts tests/app/ai-client.test.ts tests/app/modules.test.ts tests/app/table.test.ts`

Expected: PASS.

Run: `bun x tsc --noEmit && bun run check`

Expected: both commands exit 0 with no TypeScript or Svelte diagnostics.

- [ ] **Step 7: Build and run the relevant browser flow**

Run: `bun run test:e2e`

Expected: Vite production build succeeds and all Playwright tests pass, including provider switching.

- [ ] **Step 8: Commit the UX slice**

```bash
git add src/routes/settings/+page.svelte src/lib/components/settings/AiSection.svelte src/lib/components/AiDrawer.svelte src/lib/components/settings/ModulesSection.svelte tests/app/ai.test.ts e2e/table.spec.ts
git commit -m "feat(ai): add OpenRouter settings and assistant UX"
```

### Task 7: Full Verification and Documentation Alignment

**Files:**
- Modify: `README.md`
- Modify: `AGENT.md`

- [ ] **Step 1: Update user and maintainer documentation**

Document that users may configure either Gemini or OpenRouter, credentials remain browser-local and are forwarded per request, OpenRouter only lists structured-output text models, and Gemini settings migrate automatically. Update architecture references and replace claims that `/api/ai` is Gemini-only.

- [ ] **Step 2: Run the complete verification suite**

Run: `bun test`

Expected: all unit and ICEGrid tests pass.

Run: `bun x tsc --noEmit && bun run check`

Expected: no TypeScript or Svelte errors.

Run: `bun x oxlint && bun x knip`

Expected: no lint, dead-code, or unused-export failures introduced by this feature.

Run: `bun run build`

Expected: Cloudflare-targeted production build completes successfully.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Inspect the final diff for scope and secrets**

Run: `git diff --stat HEAD~6..HEAD && rg -n "sk-or-v1-|AIzaSy" src README.md AGENT.md`

Expected: only placeholders/test fixtures appear; no real credentials or unrelated changes are present.

- [ ] **Step 4: Commit documentation and any verification-only corrections**

```bash
git add README.md AGENT.md
git commit -m "docs: document OpenRouter configuration"
```

