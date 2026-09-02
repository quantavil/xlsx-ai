# ICEGrid Gemini Capacity Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ICEGrid tolerate transient capacity failures from the exact selected Gemini model and report exhausted 503 responses accurately.

**Architecture:** Configure every ICEGrid structured-generation call with four AI SDK retries while leaving interactive table/chat calls unchanged. Add a small pure error-inspection helper in the AI route that follows AI SDK `lastError` and `cause` wrappers, then use its status, retryability, and provider message when mapping the final response.

**Tech Stack:** SvelteKit request handlers, TypeScript, AI SDK 7, Zod 4, Bun test.

---

## File Structure

- Modify `src/lib/modules/icegrid/ai.server.ts`: define the ICEGrid retry budget and apply it to extraction, search-term, and ranking generation calls.
- Modify `src/routes/api/ai/+server.ts`: unwrap nested provider failures and map an exhausted capacity failure to HTTP 503 without changing model selection.
- Modify `tests/icegrid/schema.test.ts`: verify the ICEGrid generation retry budget is four.
- Modify `tests/app/ai.test.ts`: verify nested AI SDK retry errors preserve provider status, retryability, and message, and verify the 503 response copy builder.

### Task 1: Add the ICEGrid retry budget

**Files:**
- Modify: `tests/icegrid/schema.test.ts`
- Modify: `src/lib/modules/icegrid/ai.server.ts`

- [ ] **Step 1: Write the failing retry-budget test**

Add `ICEGRID_GENERATION_MAX_RETRIES` to the import from `ai.server.ts`, then add:

```ts
it('allows four retries for transient ICEGrid generation failures', () => {
	expect(ICEGRID_GENERATION_MAX_RETRIES).toBe(4);
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `bun test tests/icegrid/schema.test.ts`

Expected: FAIL because `ICEGRID_GENERATION_MAX_RETRIES` is not exported.

- [ ] **Step 3: Define and apply the retry budget**

Near the prompts in `src/lib/modules/icegrid/ai.server.ts`, add:

```ts
export const ICEGRID_GENERATION_MAX_RETRIES = 4;
```

Add this option to all three `generateObject` calls in that file:

```ts
maxRetries: ICEGRID_GENERATION_MAX_RETRIES,
```

Do not add it to the table/chat calls in `src/routes/api/ai/+server.ts`; those retain the AI SDK default of two retries.

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run: `bun test tests/icegrid/schema.test.ts`

Expected: PASS with no failures.

- [ ] **Step 5: Commit the retry change**

```bash
git add tests/icegrid/schema.test.ts src/lib/modules/icegrid/ai.server.ts
git commit -m "fix(icegrid): extend generation retries"
```

### Task 2: Preserve nested provider failure details

**Files:**
- Modify: `tests/app/ai.test.ts`
- Modify: `src/routes/api/ai/+server.ts`

- [ ] **Step 1: Write failing tests for retry-wrapper inspection and capacity copy**

Import `_inspectProviderError` and `_capacityErrorMessage` from the route, then add:

```ts
it('reads status and message from the final provider error in a retry wrapper', () => {
	const providerError = Object.assign(new Error('provider failed'), {
		statusCode: 503,
		isRetryable: true,
		responseBody: JSON.stringify({
			error: { message: 'This model is currently experiencing high demand.' }
		})
	});
	const retryError = Object.assign(new Error('Failed after 3 attempts'), {
		lastError: providerError,
		errors: [providerError]
	});

	expect(_inspectProviderError(retryError)).toEqual({
		statusCode: 503,
		isRetryable: true,
		message: 'This model is currently experiencing high demand.'
	});
});

it('describes exhausted selected-model capacity without suggesting fallback', () => {
	expect(_capacityErrorMessage('Gemini', 'gemini-3.8-flash', 5)).toBe(
		'Gemini model "gemini-3.8-flash" is temporarily overloaded after 5 attempts. Try importing again shortly.'
	);
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `bun test tests/app/ai.test.ts`

Expected: FAIL because the two helpers are not exported.

- [ ] **Step 3: Implement bounded wrapper traversal**

In `src/routes/api/ai/+server.ts`, add these exported pure helpers:

```ts
type ProviderErrorDetails = {
	statusCode: number;
	isRetryable: boolean;
	message: string;
};

export function _inspectProviderError(err: unknown): ProviderErrorDetails {
	let current: unknown = err;
	let statusCode = 500;
	let isRetryable = false;
	let message = describeProviderError(err);

	for (let hops = 0; current && hops < 8; hops++) {
		const node = current as Record<string, unknown>;
		if (typeof node.statusCode === 'number') statusCode = node.statusCode;
		else if (typeof node.status === 'number') statusCode = node.status;
		if (node.isRetryable === true) isRetryable = true;
		const described = describeProviderError(current);
		if (described !== 'unknown provider error') message = described;
		current = node.lastError ?? node.cause;
	}

	return {
		statusCode,
		isRetryable: isRetryable || statusCode === 429 || statusCode >= 500,
		message
	};
}

export function _capacityErrorMessage(provider: string, modelId: string, attempts: number): string {
	return `${provider} model "${modelId}" is temporarily overloaded after ${attempts} attempts. Try importing again shortly.`;
}
```

The traversal is bounded to avoid malformed cyclic causes. `lastError` takes precedence because it is the AI SDK's documented final retry failure.

- [ ] **Step 4: Use nested details in the route response**

Replace the catch block's top-level status extraction with:

```ts
const providerError = _inspectProviderError(err);
const { statusCode: providerStatus, isRetryable } = providerError;
```

Use `providerError.message` in the generic 502 response. Before the generic response, add:

```ts
if (providerStatus === 503) {
	return json(
		{
			error: moduleHandler?.moduleId === 'icegrid'
				? _capacityErrorMessage(providerName, targetModel, ICEGRID_GENERATION_MAX_RETRIES + 1)
				: `${providerName} model "${targetModel}" is temporarily overloaded. Try again shortly.`
		},
		{ status: 503 }
	);
}
```

Import `ICEGRID_GENERATION_MAX_RETRIES` from `$lib/modules/icegrid/ai.server`. Keep the selected `targetModel` and model construction unchanged.

- [ ] **Step 5: Run the targeted test and verify GREEN**

Run: `bun test tests/app/ai.test.ts`

Expected: PASS with no failures.

- [ ] **Step 6: Commit provider error handling**

```bash
git add tests/app/ai.test.ts src/routes/api/ai/+server.ts
git commit -m "fix(ai): surface exhausted Gemini capacity"
```

### Task 3: Full verification

**Files:**
- Verify: `src/lib/modules/icegrid/ai.server.ts`
- Verify: `src/routes/api/ai/+server.ts`
- Verify: `tests/icegrid/schema.test.ts`
- Verify: `tests/app/ai.test.ts`

- [ ] **Step 1: Run focused regression tests**

Run: `bun test tests/icegrid/schema.test.ts tests/app/ai.test.ts tests/app/ai-client.test.ts`

Expected: all tests PASS.

- [ ] **Step 2: Run the full unit suite**

Run: `bun test tests`

Expected: all tests PASS.

- [ ] **Step 3: Run static checks**

Run: `bun run check`

Expected: exit code 0 with no Svelte or TypeScript errors.

- [ ] **Step 4: Run the production build**

Run: `bun run build`

Expected: exit code 0.

- [ ] **Step 5: Inspect the final diff**

Run: `git diff HEAD~2 --check && git status --short`

Expected: no whitespace errors and a clean worktree.
