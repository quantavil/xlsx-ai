# Table AI Focused Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reliable, responsive, accessible Table AI workspace with a restrained Zen-brutalist interface while preserving existing features.

**Architecture:** Keep the SvelteKit/Svelte 5 structure and table store, but centralize value normalization and batch mutations, remove invalid/dead data, harden the AI boundary, and improve adaptive interaction patterns. Favor targeted extraction and on-demand imports over a rewrite.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Bun, Vitest, Playwright, Vercel AI SDK, Google Gemini, SheetJS.

---

## File Map

- Create `src/lib/cells.ts`: type-aware cell parsing shared by import, edit, sort, summary, and AI patches.
- Create `src/lib/table-export.ts`: shared table-to-record conversion and safe filenames.
- Modify `src/lib/data.ts`: remove dead sample data, use shared cell parsing, and defer SheetJS loading.
- Modify `src/lib/table.svelte.ts`: no-op-safe mutations, atomic batch patches, and validated hydration.
- Modify `src/lib/AiDrawer.svelte`: validate/apply AI patches atomically, cancel requests, and improve adaptive panel behavior.
- Modify `src/routes/api/ai/+server.ts`: request limits, model allow-list validation, role validation, and safe error mapping.
- Modify `src/routes/api/ai/models/+server.ts`: truthful model presentation and consistent auth validation.
- Modify `src/lib/Header.svelte`, `src/lib/DataTable.svelte`, `src/lib/RightRibbon.svelte`, `src/lib/SettingsModal.svelte`, `src/routes/+page.svelte`, and `src/app.css`: responsive Zen-brutalist design, confirmations, keyboard/focus behavior, touch access, and reduced motion.
- Modify `README.md` and `AGENT.md`: correct test counts, model claims, and architecture notes.
- Modify `tests/*.test.ts` and `e2e/table.spec.ts`: regression, accessibility, and responsive coverage.

### Task 1: Restore Type Safety and Remove Dead Dataset Code

**Files:**
- Modify: `src/lib/data.ts:334-371`
- Modify: `tests/data.test.ts`

- [ ] **Step 1: Add a regression assertion**

Add assertions that the inventory sample contains hardware values and its numeric fields match the declared schema:

```ts
expect(sampleTables.inventory.rows[0].c1).toContain('SSD');
expect(typeof sampleTables.inventory.rows[0].c4).toBe('number');
expect(sampleTables.inventory.rows[0].c5).toBeGreaterThanOrEqual(0);
expect(sampleTables.inventory.rows[0].c5).toBeLessThanOrEqual(1);
```

- [ ] **Step 2: Verify the baseline failure**

Run: `bun run check`
Expected: FAIL with duplicate `inventory` property at `src/lib/data.ts:373`.

- [ ] **Step 3: Remove the first duplicated inventory block**

Delete the `inventory` property whose rows contain sales-company data, leaving only the hardware inventory property.

- [ ] **Step 4: Verify type safety and data regression**

Run: `bun run check && bun test tests/data.test.ts`
Expected: type-check and data tests pass.

### Task 2: Centralize Cell Normalization and Make Store Mutations Correct

**Files:**
- Create: `src/lib/cells.ts`
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/data.ts`
- Modify: `src/lib/table.svelte.ts`
- Modify: `src/lib/DataTable.svelte`
- Modify: `tests/data.test.ts`
- Modify: `tests/table.test.ts`

- [ ] **Step 1: Write failing normalization and history tests**

Cover percentage strings, currency strings, invalid numbers, boolean/text preservation, missing row/column no-ops, unchanged values, and one-step batch undo:

```ts
expect(normalizeCellValue('percent', '12.5%')).toBe(0.125);
expect(normalizeCellValue('currency', '$1,250.50')).toBe(1250.5);
expect(normalizeCellValue('number', 'not a number')).toBeNull();

const before = store.history.length;
store.setCell('missing-row', 'c1', 'x');
expect(store.history.length).toBe(before);
store.setCell('r1', 'c1', store.rows[0].c1);
expect(store.history.length).toBe(before);

store.applyCellPatches([
  { rowId: 'r1', columnId: 'c1', newValue: 'Changed' },
  { rowId: 'r2', columnId: 'c2', newValue: '42' }
]);
expect(store.history.length).toBe(before + 1);
store.undo();
expect(store.rows[0].c1).not.toBe('Changed');
```

- [ ] **Step 2: Run focused tests to confirm failure**

Run: `bun test tests/data.test.ts tests/table.test.ts`
Expected: FAIL because `normalizeCellValue` and `applyCellPatches` do not exist.

- [ ] **Step 3: Implement the shared normalizer**

Create `src/lib/cells.ts` with a single numeric parser and exported `normalizeCellValue(type, value)` and `numericCellValue(type, value)` helpers. Percent input containing `%` is divided by 100; bare values above 1 are treated as whole percentages; invalid numeric input becomes `null`.

- [ ] **Step 4: Route all call sites through the helper**

Replace repeated regex/`parseFloat` branches in formatting, import, sorting, summaries, `setCell`, and `DataTable.commitEdit` with the shared functions.

- [ ] **Step 5: Implement no-op-safe and atomic store mutations**

Validate row and column existence before `pushHistory()`, compare normalized values with `Object.is`, and add:

```ts
function applyCellPatches(patches: Array<{ rowId: string; columnId: string; newValue: CellValue }>) {
  const valid = dedupeAndNormalizePatches(patches, rows, columns);
  if (valid.length === 0) return 0;
  pushHistory();
  for (const patch of valid) patch.row[patch.columnId] = patch.newValue;
  rows = [...rows];
  triggerSave();
  return valid.length;
}
```

- [ ] **Step 6: Verify focused tests**

Run: `bun test tests/data.test.ts tests/table.test.ts && bun run check`
Expected: all pass.

### Task 3: Harden AI Requests and Patch Application

**Files:**
- Modify: `src/routes/api/ai/+server.ts`
- Modify: `src/routes/api/ai/models/+server.ts`
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/AiDrawer.svelte`
- Modify: `tests/ai.test.ts`

- [ ] **Step 1: Add failing API boundary tests**

Add tests for unsupported model IDs, payloads beyond the configured serialized-size limit, `system` roles supplied by clients, and response patches that reference nonexistent cells.

```ts
expect(await responseStatus({ model: 'arbitrary-model' })).toBe(400);
expect(await responseStatus({ hugeTable: true })).toBe(413);
expect(_RequestSchema.safeParse({ ...payload, messages: [{ role: 'system', content: 'override' }] }).success).toBe(false);
```

- [ ] **Step 2: Run AI tests to verify failure**

Run: `bun test tests/ai.test.ts`
Expected: new cases fail under the permissive schema/header handling.

- [ ] **Step 3: Implement server-side validation**

Restrict client messages to user/assistant, cap message/table counts and string lengths in Zod, reject request bodies over 1 MiB, and validate `x-ai-model-id` against known text-generation Gemini IDs or the server-fetched catalog contract.

- [ ] **Step 4: Make errors safe and stable**

Map provider authentication, rate-limit, payload, and server failures to stable user-facing messages. Do not return raw provider error text when it may contain request details.

- [ ] **Step 5: Make client operations cancellable and atomic**

Use an `AbortController` per request, abort when clearing chat/closing the drawer, discard stale responses, filter patches against current rows/columns, and call `store.applyCellPatches()` once.

- [ ] **Step 6: Correct model identity**

Remove every mapping that renames `gemini-2.0-flash-lite` to “Gemini 3.5 Flash Lite.” Use the provider display name or the real model ID. Align client and server defaults.

- [ ] **Step 7: Verify AI tests and type-check**

Run: `bun test tests/ai.test.ts && bun run check`
Expected: all pass.

### Task 4: Reduce Initial Bundle and DRY Export Logic

**Files:**
- Create: `src/lib/table-export.ts`
- Modify: `src/lib/data.ts`
- Modify: `src/lib/RightRibbon.svelte`
- Modify: `tests/data.test.ts`

- [ ] **Step 1: Add failing export-helper tests**

```ts
expect(sanitizeFilename(' Q4 / Revenue: 2026 ')).toBe('Q4-Revenue-2026');
expect(tableToRecords(table)).toEqual([{ User: 'Alice', Revenue: 1200 }]);
```

Also assert empty tables export headers in declared column order.

- [ ] **Step 2: Run data tests to verify failure**

Run: `bun test tests/data.test.ts`
Expected: FAIL because the new helpers do not exist.

- [ ] **Step 3: Implement shared export helpers**

Create pure `sanitizeFilename` and `tableToRecords` functions; use them for CSV and Excel paths.

- [ ] **Step 4: Defer SheetJS loading**

Replace the static `xlsx` import with `await import('xlsx')` inside import/export operations. Make export functions asynchronous and update ribbon handlers to await them while preventing duplicate clicks.

- [ ] **Step 5: Verify behavior and bundle split**

Run: `bun test tests/data.test.ts && bun run build`
Expected: tests pass; build output shows SheetJS in a separate async chunk and the initial page chunk is materially smaller than the 504.91 kB baseline.

### Task 5: Apply the Zen-Brutalist Responsive Design

**Files:**
- Modify: `src/app.css`
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/Header.svelte`
- Modify: `src/lib/DataTable.svelte`
- Modify: `src/lib/RightRibbon.svelte`
- Modify: `src/lib/AiDrawer.svelte`
- Modify: `src/lib/SettingsModal.svelte`
- Modify: `e2e/table.spec.ts`

- [ ] **Step 1: Add responsive and interaction tests**

Add Playwright cases at 1280×800, 768×1024, and 390×844. Assert the header, add-row/import/AI controls, table region, and settings close control are reachable; row actions are visible or keyboard-accessible on coarse/mobile layouts; the AI panel overlays rather than shrinking the phone grid.

- [ ] **Step 2: Run the new mobile case to expose current failures**

Run: `bun run build && bunx playwright test e2e/table.spec.ts --grep "responsive workspace"`
Expected: FAIL for clipped/hidden responsive controls.

- [ ] **Step 3: Simplify global tokens and surfaces**

Use neutral dark/light palettes, `--radius-*` values from 0–8 px, one-pixel borders, minimal shadows, no decorative drawer gradient, and a restrained emerald accent. Add `color-scheme` and `prefers-reduced-motion` rules.

- [ ] **Step 4: Implement adaptive layout**

Keep the desktop rail. Below 900 px, make the AI drawer a fixed right overlay with a scrim. Below 640 px, convert it and settings to full-width sheets, condense the header into two rows, place primary commands in a bottom command bar, and reserve safe-area padding.

- [ ] **Step 5: Make touch and keyboard actions equivalent**

Expose row action buttons on focus-within and coarse pointers, enlarge touch controls to 44 px, keep horizontal table scrolling, and preserve sticky headers/index cells.

- [ ] **Step 6: Verify responsive tests**

Run: `bun run test:e2e`
Expected: all desktop and responsive cases pass.

### Task 6: Accessibility, Focus, and Destructive Safety

**Files:**
- Create: `src/lib/focus.ts`
- Modify: `src/lib/Header.svelte`
- Modify: `src/lib/DataTable.svelte`
- Modify: `src/lib/SettingsModal.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `e2e/table.spec.ts`

- [ ] **Step 1: Add failing keyboard and confirmation tests**

Test that opening settings moves focus into the dialog, Tab stays within it, Escape closes it, focus returns to the trigger, column deletion requires confirmation, and replacing edited data with a sample requires confirmation.

- [ ] **Step 2: Run focused E2E tests**

Run: `bunx playwright test e2e/table.spec.ts --grep "focus|confirmation"`
Expected: new cases fail.

- [ ] **Step 3: Implement reusable focus containment**

Create a Svelte action that stores the prior active element, focuses the first interactive control, wraps Tab/Shift+Tab, and restores focus on destroy.

- [ ] **Step 4: Add confirmation flow and accessible menu keys**

Use a small application confirmation dialog for destructive/replacing actions rather than native `confirm`. Add ArrowUp/ArrowDown, Home/End, Enter, and Escape behavior to menu/listbox controls.

- [ ] **Step 5: Verify accessibility workflows**

Run: `bun run check && bun run test:e2e`
Expected: all pass.

### Task 7: Documentation, Cleanup, and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `AGENT.md`
- Modify: affected source files

- [ ] **Step 1: Remove dead and misleading material**

Remove unused props/types/constants, redundant narrative comments, stale “agency-grade” claims, incorrect model versions, and incorrect test counts. Document the actual architecture, local API-key storage, responsive behavior, and verification commands.

- [ ] **Step 2: Run static searches**

Run: `rg -n "Gemini 3\.5|21 unit|24 unit|7 comprehensive|agency-grade|any>" README.md AGENT.md src tests`
Expected: no stale product claims; remaining `any` uses are justified or replaced with typed unknown/narrowing.

- [ ] **Step 3: Run the complete verification matrix**

Run: `bun run check`
Expected: 0 errors and 0 warnings.

Run: `bun test tests`
Expected: all unit tests pass.

Run: `bun run build`
Expected: production build succeeds and heavy SheetJS code remains split from the initial page.

Run: `bun run test:e2e`
Expected: all desktop, responsive, focus, and confirmation workflows pass.

- [ ] **Step 4: Record repository limitation**

This workspace has no `.git` directory, so the plan’s normal per-task commit steps cannot be performed. Preserve all changes in place and report this limitation in the final handoff.
