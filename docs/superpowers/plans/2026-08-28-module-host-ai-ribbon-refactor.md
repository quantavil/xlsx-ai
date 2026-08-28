# Module Host AI and Ribbon Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give trusted workspace modules full access to the application's existing AI endpoint through a shared client, make ribbon actions/icons a required host contract, and preserve the completed ICEGrid pipeline.

**Architecture:** Client modules receive an `AiApi` capability created by the host; it exposes the active key/model plus JSON and streaming requests to the existing `/api/ai`. Server-side module AI handlers are statically registered and receive the authenticated Gemini model, allowing them to use `generateObject`, `generateText`, or `streamText` without adding module prompts and schemas to the central route. Ribbon metadata moves onto a required `ribbon` action descriptor rendered generically by the host UI.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Bun/Vitest, AI SDK 4, Google AI SDK provider, Zod 3, SheetJS, PDF.js.

---

### Task 1: Restore the claimed clean baseline

**Files:**
- Modify: `src/lib/modules/icegrid/readers.ts`

- [x] Replace the invalid `InstanceType<typeof XLSX.WorkBook> | any` declaration with the imported SheetJS `WorkBook` type.
- [x] Run `bun run check`; expect zero errors and zero warnings.

### Task 2: Add the shared client AI capability

**Files:**
- Create: `src/lib/ai/client.ts`
- Modify: `src/lib/modules/types.ts`
- Modify: `src/lib/modules/module-store.svelte.ts`
- Test: `tests/ai-client.test.ts`
- Test: `tests/modules.test.ts`

- [x] Write failing tests proving the client injects the current key/model, supports JSON and streaming responses, carries the run abort signal, and returns the server's readable error.
- [x] Run the focused tests and confirm failure because the client capability does not exist.
- [x] Implement `createAiApi({ apiKey, modelId, signal })` with `request<T>()` and `requestStream()` against `/api/ai`.
- [x] Replace `ModuleContext.apiKey/modelId` with `ModuleContext.ai: AiApi`; create that capability in the host module store for every run.
- [x] Run the focused tests and expect them to pass.

### Task 3: Move module-specific AI work behind a server registry

**Files:**
- Create: `src/lib/server/modules/types.ts`
- Create: `src/lib/server/modules/registry.ts`
- Create: `src/lib/modules/icegrid/ai.server.ts`
- Modify: `src/routes/api/ai/+server.ts`
- Modify: `src/lib/modules/icegrid/extract.ts`
- Test: `tests/ai.test.ts`

- [x] Replace the public `icegrid_extract` request test with a failing generic `{ operation: { kind: 'module', moduleId, action }, input }` contract test, including unknown module/action rejection.
- [x] Run `bun test tests/ai.test.ts` and confirm the generic module request fails.
- [x] Add a static server registry and an ICEGrid `extract` handler whose own Zod schema validates input before it calls `generateObject` with the authenticated model.
- [x] Make `/api/ai` dispatch the generic module operation after shared authentication, size, and model checks; remove ICEGrid prompts and output-schema imports from the central route.
- [x] Update ICEGrid's browser extractor to call `context.ai.request()` and validate the returned report again at the module boundary.
- [x] Run `bun test tests/ai.test.ts tests/modules.test.ts tests/icegrid-schema.test.ts` and expect all focused tests to pass.

### Task 4: Make the ribbon action and icon a first-class host contract

**Files:**
- Modify: `src/lib/modules/types.ts`
- Modify: `src/lib/modules/icegrid/index.ts`
- Modify: `src/lib/components/RightRibbon.svelte`
- Modify: `src/lib/components/settings/ModulesSection.svelte`
- Test: `tests/modules.test.ts`

- [x] Write a failing manifest test requiring `ribbon.label`, `ribbon.icon`, and `ribbon.fileInput` metadata.
- [x] Run `bun test tests/modules.test.ts` and confirm the old top-level `icon`/`action` contract fails.
- [x] Move ICEGrid's `layers` icon and file-picker declaration into `ribbon`; keep execution under `run`.
- [x] Render the enabled module's icon, label, accepted files, and multiple selection solely from `ribbon` metadata, with no module-ID conditionals.
- [x] Run `bun test tests/modules.test.ts` and `bun run check`; expect both to pass.

### Task 5: Remove related redundancy and verify the complete system

**Files:**
- Modify: `AGENT.md`
- Modify: `docs/superpowers/specs/2026-08-28-icegrid-module-design.md`

- [x] Document the shared AI capability, client/server registries, and required ribbon icon contract.
- [x] Search for obsolete `icegrid_extract`, duplicated module fetch headers, and the old `action`/top-level `icon` contract; remove remaining stale references.
- [x] Run `bun test tests`, `bun run check`, and `bun run build` fresh.
- [x] Inspect `git diff --check` and the final diff; preserve unrelated user changes and do not commit without request.
