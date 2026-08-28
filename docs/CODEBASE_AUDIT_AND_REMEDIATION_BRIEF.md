# Table AI Codebase Audit and Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Table AI dependable for real spreadsheet work by fixing the confirmed dropdown failures, security and data-integrity defects, keyboard/accessibility conflicts, dependency drift, and maintainability bottlenecks without rewriting the product.

**Architecture:** Keep SvelteKit 2, Svelte 5 runes, the local-first product model, and the current table-store boundary. Split behavior only where a boundary is independently testable: table domain/persistence, grid interactions, reusable popovers, import/export, AI request state, and settings sections. Repair correctness and security before visual refactoring.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Bun, Vitest, Playwright, Vercel AI SDK, Google Gemini, SheetJS-compatible spreadsheet I/O.

---

## 1. Audit scope and method

This is an evidence-backed audit of all first-party source, test, configuration, and project-documentation files in the workspace. It covers:

- confirmed runtime bugs, with special focus on dropdowns;
- data integrity, persistence, import/export, undo/redo, and sorting;
- security and dependency risk;
- architecture, monoliths, duplication, dead code, and unnecessary complexity;
- Svelte/TypeScript usage and obsolete APIs;
- desktop, mobile, keyboard, screen-reader, and touch ergonomics;
- AI request/streaming behavior and model selection;
- test quality, deployment readiness, and documentation accuracy.

Checks performed on 2026-08-28:

| Check | Result |
|---|---|
| `bun run check` | Pass: 0 errors, 0 warnings |
| `bun test tests` | Pass: 33 tests |
| `bun run build` | Pass, but adapter-auto reports no production target; largest async client chunk is 423.99 kB (141.33 kB gzip) |
| `bun run test:e2e` | Pass: 14 tests |
| `bun install --frozen-lockfile --dry-run` | Fail: lockfile would change |
| `bun audit --audit-level=low` | Fail: 2 high vulnerabilities in `xlsx@0.18.5`, 1 low transitive `cookie` vulnerability |
| Model endpoint success-path probe | Confirmed HTTP 500: `Cannot access 'formattedModels' before initialization.` |
| Status dropdown, first visible row | One click does not open; double-click opens and selection works |
| Status dropdown, bottom row | Popover opens below the cell but is clipped by the scroll container/sticky footer and is visually absent |
| Samples menu, keyboard | ArrowDown leaves focus on the trigger and activates the table grid instead |
| Mobile visual inspection (390×844) | Layout renders, but status editing remains undiscoverable, settings tabs overflow, and many controls are below 44×44 px |

Passing tests are not evidence that the reported flows work: the existing E2E suite does not exercise model retrieval success, one-click/touch status editing, bottom-edge popover positioning, or menu-trigger keyboard behavior.

The workspace has no `.git` directory. Implementation agents must preserve files in place and cannot make the per-task commits normally requested by the planning workflow.

## 2. Executive verdict

The product has a sound base: typed cells are centralized, SheetJS is lazy-loaded, AI patches are applied as one undo step, server requests are schema-checked and size-limited, the visual language is consistent, responsive layouts exist, and the current automated suite is useful.

It is not ready for trusted real-world data yet. Four release blockers should be fixed first:

1. Live Gemini model retrieval crashes on a normal `gemini-2.5-flash` response, so the settings model dropdown cannot become usable.
2. Status dropdown behavior is incompatible with its visual affordance and mobile use; near the bottom of the grid, the options are clipped completely.
3. The application reads arbitrary uploaded workbooks with a SheetJS version affected by two high-severity advisories.
4. `package.json` and `bun.lock` describe materially different dependency graphs, so a reproducible frozen install fails.

The largest correctness risks after those blockers are silent export data loss with duplicate column names, CSV formula injection, date-only values displaying one day early in western time zones, empty tables being replaced on reload, global table shortcuts hijacking unrelated menus, and stale AI previews overwriting newer user edits.

## 3. What is already good and should be preserved

- `src/lib/cells.ts` centralizes typed normalization instead of repeating parsing in every UI path.
- `src/lib/table.svelte.ts:225-250` batches AI patches into one history entry.
- `src/lib/data.ts:90` and `:194` lazy-load `xlsx`, keeping the 423.99 kB spreadsheet chunk off the initial path.
- `src/routes/api/ai/+server.ts:15-44` restricts message roles, field sizes, row counts, and column counts.
- `src/routes/api/ai/+server.ts:71-91` rejects bodies over 1 MiB and malformed JSON.
- `src/lib/focus.ts` provides basic focus containment and restoration for current dialogs.
- `src/app.css:318-327` includes a reduced-motion path.
- The status palette is deterministic for unknown values rather than depending on an ever-growing hardcoded list.
- The UI is visually coherent on desktop and adapts to a phone-sized viewport without collapsing the table.
- The suite covers core CRUD, sorting, summaries, batch undo, samples, responsive sizing, focus containment, and destructive column/sample confirmation.

Do not discard these strengths in a rewrite.

## 4. Findings index

Severity definitions:

- **P0 — blocker:** security exposure, reproducibility failure, core workflow failure, or likely data loss.
- **P1 — high:** materially wrong behavior, accessibility blocker, overwrite risk, or scaling failure.
- **P2 — medium:** maintainability, confusing UX, incomplete validation, or avoidable performance cost.
- **P3 — low:** dead code, typing, documentation, or polish.

### P0 blockers

`src/routes/api/ai/models/+server.ts:46-106`: **P0 bug:** the `.map()` callback reads `formattedModels` at line 94 while `formattedModels` is still in its temporal dead zone. A Google response containing `gemini-2.5-flash` produces HTTP 500. Compute `hasPreferredDefault` from `allRawModels` before the chain, or apply default badges in a second pass after the array exists.

`src/lib/DataTable.svelte:607-614`: **P0 UX bug:** status cells show a dropdown arrow but one click only selects the cell; opening requires an undocumented double-click or Enter after selection. Make the arrow a real combobox trigger, open on one click/tap of the arrow, support `Alt+ArrowDown`/Space/Enter, and use a single tap on touch devices.

`src/lib/DataTable.svelte:1367-1385`: **P0 UX bug:** the status list is absolutely positioned downward inside `.table-scroll-wrap`; on row 25 its measured bottom was 839 px while the scroll region ended at 720 px, and the sticky footer covered the only visible portion. Render through a portal/floating layer and flip above/shift into the viewport.

`package.json:31`, `src/lib/data.ts:90-113`: **P0 security:** `xlsx@0.18.5` parses arbitrary user uploads and is affected by high-severity prototype-pollution and ReDoS advisories. Move to a verified patched SheetJS CE distribution `>=0.20.2` or a maintained replacement, add file/row/column limits, and parse in a worker. Do not assume `bun audit fix` can resolve this; the npm `xlsx` package has no patched release.

`package.json:15-32`, `bun.lock:5-26`: **P0 build:** the manifest declares old major ranges while the lockfile/node_modules contain newer majors and extra direct dependencies. `bun install --frozen-lockfile --dry-run` fails. Choose one dependency graph, update `package.json`, regenerate `bun.lock`, remove undeclared/unused direct packages, and require frozen installs in CI.

### P1 correctness, data integrity, and interaction findings

`src/lib/table-export.ts:12-15`: **P1 data loss:** duplicate user-renamed column names become duplicate object keys and earlier values disappear. A table with columns `a → Name` and `b → Name` exports only `{"Name":"second"}`. Reject duplicate display names or generate unique export headers before constructing records.

`src/lib/data.ts:210-232`: **P1 security:** CSV export emits cells such as `=2+3` unchanged, enabling spreadsheet-formula injection when the file is opened in Excel or similar software. Escape formula-leading strings in headers and cells (`=`, `+`, `-`, `@`, leading tab/CR) under an explicit safe-export policy.

`src/lib/constants.ts:105-113`: **P1 date bug:** `new Date('2025-01-15')` is UTC, so `TZ=America/Los_Angeles` displays `Jan 14, 2025`. Parse date-only strings as calendar components or format with `timeZone: 'UTC'`; keep date-only and timestamp types conceptually separate.

`src/lib/data.ts:46-49`, `src/lib/constants.ts:67-71`: **P1 semantic corruption:** import recognizes `$`, `€`, `£`, and `¥`, but all currency columns display as USD. Store a currency/locale format on `Column`, prompt on ambiguous imports, or leave mixed/unknown currency columns as text.

`src/lib/table.svelte.ts:449-484`, `src/routes/+page.svelte:62-65`: **P1 data loss:** hydration accepts only tables with at least one row, and the page replaces any zero-row table with the SaaS sample. Deleting the final row or saving a header-only table is not durable. Validate and restore zero-row tables; only seed the sample when no persisted document exists.

`src/lib/table.svelte.ts:443-503`: **P1 persistence:** saved state has no schema version, strict runtime schema, duplicate-ID checks, width bounds, or cell normalization. Add a shared `PersistedTableDocumentV2` schema, migration function, and recoverable quarantine/fallback path.

`src/lib/table.svelte.ts:38-52`: **P1 trust:** autosave failures are only logged, and the 300 ms debounce has no flush on visibility/page teardown. Expose `saving/saved/error` state, notify on quota failures, and flush the pending snapshot on `visibilitychange`/destroy.

`src/lib/table.svelte.ts:272-337`: **P1 history bug:** invalid/no-op row and column mutations still call `pushHistory()` before validation. Validate target existence and equality first for `deleteRow`, `deleteColumn`, `renameColumn`, and `updateColumnType`.

`src/lib/table.svelte.ts:36-69`, `:375-440`: **P1 dirty-state bug:** `isDirty` becomes true after the first edit and never reflects undoing back to the saved baseline. Track a saved revision/content hash or history baseline index; confirmations should depend on actual unsaved divergence.

`src/lib/table.svelte.ts:331-338`: **P1 type bug:** changing a column type updates metadata but leaves all cell values unnormalized. Convert cells atomically, preview destructive conversions, report invalid counts, and make the conversion one undo step.

`src/lib/table.svelte.ts:55-69`: **P1 scaling:** every edit stores a deep clone of all rows and columns, up to 30 full copies. This becomes untenable for imported tables. Replace snapshots with reversible commands/patches, while keeping a bounded checkpoint for load/reset operations.

`src/lib/DataTable.svelte:324-342`: **P1 input bug:** table navigation listens on `window`, so ArrowDown on the Samples trigger activates a grid cell instead of entering the menu. Scope navigation to a focusable grid container/cell and ignore all controls outside the grid.

`src/lib/DataTable.svelte:359-360`, `:607-614`: **P1 accessibility:** the grid and cells are not in a roving tab order; every data cell has `tabindex="-1"`, and visual `activeCell` is not DOM focus or `aria-activedescendant`. Implement the ARIA grid pattern with one tabbable cell, real focus movement, and clear edit/navigation modes.

`src/lib/Header.svelte:157-176`, `src/lib/RightRibbon.svelte:179-200`, `src/lib/DataTable.svelte:423-477`: **P1 accessibility:** custom menus open without moving focus and only handle arrow keys if focus is already inside. Create one reusable menu behavior: open+focus first/selected item, Arrow keys, Home/End, Enter/Space, Escape, Tab close, outside click, and trigger focus restoration.

`src/lib/SettingsModal.svelte:402-503`: **P1 accessibility:** the model control uses listbox roles but lacks trigger keyboard opening, active-option state, `aria-controls`, `aria-activedescendant`, option focus management, and search autofocus. Implement it as a real combobox or use a proven accessible headless primitive.

`src/app.css:308-315`, `src/lib/DataTable.svelte:1166-1209`: **P1 mobile ergonomics:** many measured controls are 22–34 px; the coarse-pointer rule sets only a 40 px minimum. Make interactive targets at least 44×44 CSS px or provide 44 px hit areas, especially row actions, column menus, history, and the bottom command bar.

`src/lib/AiDrawer.svelte:280-305`, `:946-977`: **P1 accessibility:** on tablet/mobile the drawer becomes a full-screen/overlay surface but has no dialog semantics, focus trap, Escape close, scrim, or inert background. Treat overlay mode as a modal sheet; desktop inline mode may remain non-modal.

`src/routes/+page.svelte:67-117`: **P1 modal bug:** global shortcuts remain live when focus is on non-input controls inside Settings. `Ctrl+N` can add a row behind the modal and `Ctrl+/` can open AI behind it. Suppress workspace commands while a modal is active except the modal’s own close shortcut.

`src/lib/AiDrawer.svelte:121-167`: **P1 overwrite risk:** a diff captures `oldValue`, but Apply does not verify that the live value is unchanged. Revalidate `(rowId, columnId, oldValue)` at apply time, show conflicts, and never overwrite a user edit made after preview generation without explicit confirmation.

`src/lib/AiDrawer.svelte:176-265`: **P1 request-state bug:** pressing Enter or an example chip during generation aborts the prior request, but the aborted assistant message remains `isStreaming: true`; closing and reopening can show a permanent cursor. Block duplicate sends or finalize aborted messages as cancelled, and test close/reopen and replacement requests.

`src/lib/AiDrawer.svelte:192-218`, `src/routes/api/ai/+server.ts:16-24`: **P1 chat-limit bug:** the client retains unlimited messages and response length, while the server permits 50 messages and 8,000 characters each. Prune/summarize history by serialized bytes/tokens and cap stored assistant content before the next request.

`src/routes/api/ai/+server.ts:10-13`, `:117-123`: **P1 model validation:** a regex accepts any plausible `gemini-*` text ID, not the known/catalog models claimed in documentation. Share a validated model policy between catalog and generation, and gracefully migrate invalid saved choices to the current default.

`src/lib/constants.ts:48-59`, `README.md:3-4`: **P1 stale model configuration:** `gemini-2.0-flash` and `gemini-2.0-flash-lite` remain advertised even though Google shut them down in June 2026. Remove them from defaults/docs and handle old localStorage values.

`src/routes/api/ai/models/+server.ts:16-28`: **P1 secret handling:** the API key is sent both as `?key=` in the URL and `x-goog-api-key`. Query strings are more likely to appear in proxy/observability logs. Use the header only and sanitize all server logging.

`src/lib/data.ts:85-181`: **P1 availability:** imports have no file-size, decompression, row, or column limit and parse on the UI thread. A large or adversarial workbook can freeze the app even after upgrading SheetJS. Reject oversized inputs early and move parsing/type inference to a Web Worker with progress/cancellation.

### P2 architecture, maintainability, and product-quality findings

`src/routes/api/ai/+server.ts:96-115`: **P2 product mismatch:** the client sends the full table but only the first 40 rows reach Gemini. “Fill Missing” cannot operate on missing cells outside that sample. Send a targeted bounded set of missing/dirty rows, batch operations, and disclose sampling in the UI.

`src/routes/api/ai/+server.ts:100-115`: **P2 AI safety:** raw cell content is interpolated into the system prompt without an explicit untrusted-data boundary. Delimit the dataset, instruct the model never to follow instructions inside cell data, and validate patch semantics server-side.

`src/routes/api/ai/+server.ts:46-56`: **P2 response validation:** patch count and string lengths are unbounded, duplicate targets are allowed, and old values are not required. Add bounds, dedupe deterministically, and validate targets against the submitted table before returning.

`src/lib/AiDrawer.svelte:231-250`: **P2 streaming:** the decoder is never flushed after the read loop, no auto-scroll behavior exists, and Markdown requested by the system prompt is displayed as plain text. Flush the decoder, add user-respecting auto-scroll, and either render sanitized Markdown or request plain text.

`src/lib/SettingsModal.svelte:59-89`, `:137-164`: **P2 race:** overlapping model fetches are not aborted/versioned; clearing or changing a key can be undone visually by a late response. Use an AbortController/request ID and ignore stale completions.

`src/routes/api/ai/models/+server.ts:31-34`, `:122-124`: **P2 error leakage:** raw Google error messages and arbitrary statuses are returned to the browser. Map authentication, rate limit, timeout, and upstream failures to stable messages; keep sanitized diagnostic detail server-side.

`src/routes/api/ai/models/+server.ts:11-43`: **P2 robustness:** external JSON is `any`, pagination is unbounded, and there is no timeout. Parse a local Zod schema, cap pages/models, detect repeated tokens, and pass an abort timeout.

`src/lib/cells.ts:5-12`: **P2 parsing:** `parseFloat` after deleting nonnumeric characters silently turns malformed strings such as `abc123xyz` into `123` and `1.2.3` into `1.2`. Use strict full-string parsing and surface invalid input instead of coercing it to a plausible number.

`src/lib/cells.ts:21-23`: **P2 percent ergonomics:** bare `1` means 100% while bare `1.1` means 1.1%, creating a discontinuity. Pick and document one model (recommended: display/edit percentage points, store fractions) and show a `%` suffix in the editor.

`src/lib/data.ts:119-148`: **P2 import data loss:** the “50% strings” header heuristic can consume a legitimate first data row. Add an import preview with “first row is headers,” sheet selection, detected types, and the ability to correct them before replacing the table.

`src/lib/data.ts:135-137`: **P2 naming bug:** generated labels after column Z become `A1`, `B1`, etc., not spreadsheet-style `AA`, `AB`. Use a proper base-26 column-label helper.

`src/lib/data.ts:192-208`: **P2 redundant work:** Excel export calls `writeFile()` and then serializes the workbook again with `write()` although the UI discards the bytes. Separate `buildWorkbookBytes()` from `downloadWorkbook()` and perform one serialization.

`src/routes/+layout.svelte:9-51`, `src/routes/+page.svelte:19-37`, `:166-177`: **P2 DRY/dead system:** there are two independent toast implementations; the layout one is never called but still renders an empty live region and ships styles/icons. Keep one toast store/host.

`src/lib/DataTable.svelte` (1,588 lines): **P2 monolith:** grid selection/editing, resizing, four popover types, destructive confirmation, status combobox, rendering, summaries, and ~800 lines of CSS change together. Extract behavior-focused units; do not split solely to chase line counts.

`src/lib/SettingsModal.svelte` (1,708 lines): **P2 monolith:** API-key state, remote model loading, combobox, five settings pages, sample reset confirmation, responsive navigation, and ~950 lines of CSS are one component. Extract each settings section and a model-catalog state module.

`src/lib/AiDrawer.svelte` (979 lines): **P2 monolith:** request transport, chat state, patch validation, diff UI, streaming UI, and layout styles are coupled. Extract `ai-client.ts`, `chat-session.svelte.ts`, `patches.ts`, `DiffPreview.svelte`, and `ChatView.svelte`.

`src/lib/Header.svelte:6-15`: **P2 dead props:** `theme`, `onToggleTheme`, and `onOpenSettings` are declared and passed but never used. Remove them from Header’s contract and call site.

`src/lib/types.ts:36-42`, `src/lib/constants.ts:171-178`: **P2 dead exports:** `AiOperationKind`, `AiTransformOperation`, and `COLUMN_TYPE_ICON_MAP` have no consumers. Delete or use one canonical domain type; do not keep parallel type maps.

`src/routes/+layout.svelte:3`: **P2 dead import:** `onMount` is unused. Enable `noUnusedLocals`/`noUnusedParameters` or add ESLint so this class of drift fails CI.

`package.json:29`, `bun.lock:9`: **P2 dead dependency:** `@ai-sdk/svelte` is not imported. `bun.lock` also lists undeclared direct packages such as `lucide-svelte` and type packages. Remove unused dependencies when reconciling the manifest.

`src/lib/Icon.svelte:10-16`, `:32`: **P2 typing/fragility:** rest props use `any` and SVG markup is injected with `{@html}`. The current source is static and therefore not an active XSS bug, but use Svelte SVG attribute types and either components/snippets or a single audited icon package.

`src/routes/+page.svelte:68-70`: **P2 obsolete API:** `navigator.platform` is deprecated. The code can simply treat `metaKey || ctrlKey` as the command modifier and label shortcuts `Ctrl/⌘` without platform sniffing.

`src/lib/Header.svelte:152`, `src/lib/RightRibbon.svelte:151-165`: **P2 UX:** visible shortcut labels always show Command even on Windows/Linux. Render `Ctrl/⌘` or compute a presentation-only modifier safely.

`src/lib/SettingsModal.svelte:211-257`, mobile CSS: **P2 mobile UX:** the horizontal settings nav clips later tabs without a clear affordance. Use scroll snapping, edge fade, and `scrollIntoView` for the active tab, or replace it with a compact select/overflow menu below 640 px.

`svelte.config.js:1-9`: **P2 deployment:** adapter-auto cannot identify a production platform during build. Select and configure the actual deployment adapter, then smoke-test its artifact.

`README.md`: **P2 documentation:** the README overstates dropdown reliability, advertises shut-down Gemini 2.0 models, and quotes an outdated initial-bundle figure. Generate claims from verified behavior/build output or update them during release.

`tsconfig.json`, `package.json`: **P2 quality gate:** there is no lint, formatting check, coverage threshold, or CI configuration. Add non-mutating checks and use `bun install --frozen-lockfile` in CI.

### P3 polish

- Comments such as “Pure Minimal,” “Clean,” “Zen-Brutalist,” and “agency” narrate style rather than intent. Remove marketing commentary from source and keep comments for invariants or surprising behavior.
- Title and column-name inputs have no shared length policy; apply domain limits and visible validation.
- Row delete is immediate while column delete is confirmed. This can be acceptable because undo exists, but add an Undo action to the toast so the recovery model is visible and consistent.
- Settings auto-fetches the model catalog every time it mounts. Cache it per key/session with a refresh button and expiry.
- Google Fonts make a network request even for a local-first workspace. Consider self-hosting or system fonts for stronger offline/privacy behavior.

## 5. Recommended interaction design

Three design directions were considered:

1. **Native controls everywhere.** Highest accessibility and lowest code, but a native `<select>` cannot provide the required searchable/create-new status workflow or rich model metadata.
2. **Keep the current custom popovers and patch each bug.** Fastest short-term change, but it leaves three separate menu implementations and fragile collision/focus behavior.
3. **Recommended: shared accessible primitives plus purpose-built editors.** Build one positioned floating layer, one menu behavior, and one combobox behavior; use them for status, models, samples, export, and column actions. This costs more than a patch but removes the source of repeated bugs.

Adopt option 3 with these explicit behaviors:

### Status cells

- Single click selects the cell.
- Clicking/tapping the visible chevron opens the combobox immediately.
- On coarse pointers, tapping anywhere in a status cell opens it; selection remains visually clear.
- Enter, Space, or `Alt+ArrowDown` on a selected status cell opens it.
- Search input receives focus and announces the number of matches.
- ArrowUp/ArrowDown changes the active option; Enter commits; Escape restores the original value; Tab commits and moves to the next cell.
- The list flips above near the footer, shifts horizontally into the viewport, and is rendered outside overflow clipping.
- “Create status” is a separate final action, not an option whose `aria-selected` state means “highlighted.”

### Grid keyboard model

- The grid is reached with one Tab stop.
- One cell has `tabindex="0"`; moving updates DOM focus.
- Arrow keys work only while a grid cell is focused.
- Enter/F2 enters edit mode; Escape cancels; Enter commits; Tab commits and moves.
- Toolbar/menu inputs retain native arrow, delete, typing, and undo behavior.

### Mobile layout

- Preserve horizontal table scrolling and sticky row/header orientation.
- Give bottom-bar actions 44 px hit boxes; keep Add Row and AI primary, put Import/Export/Theme/Settings in a labeled overflow sheet if space is insufficient.
- Replace two tiny row icons with one 44 px row-actions button opening Duplicate/Delete.
- Make Settings navigation scroll to the active item and visibly indicate more tabs.
- Treat AI and Settings as modal sheets with a scrim, inert background, focus containment, and Escape/back handling.

### Save and destructive feedback

- Show `Saving…`, `Saved locally`, or `Save failed — export a copy` near the title.
- Toasts for row/column deletion include Undo.
- Import shows a preview and does not replace the current table until the user confirms.
- AI Apply shows conflicts and applies only nonconflicting changes unless the user explicitly overrides.

## 6. Target architecture and file map

Keep the current flat structure for unrelated files, but introduce focused subfolders where multiple files change together:

```text
src/lib/
  table/
    schema.ts                 # TableData + persisted-document Zod schemas/migrations
    commands.ts               # reversible domain commands and patch application
    persistence.ts            # debounced storage adapter + save status + flush
    table.svelte.ts           # rune state and derived views only
  grid/
    DataGrid.svelte           # table structure and roving focus
    GridCell.svelte           # display/edit boundary
    StatusCellEditor.svelte   # accessible searchable/create combobox
    ColumnMenu.svelte         # column actions
    SummaryFooter.svelte
    grid-navigation.ts        # pure navigation functions
  floating/
    position.ts               # flip/shift/collision positioning
    menu.ts                   # shared menu focus behavior
    combobox.ts               # shared combobox active-option behavior
  import-export/
    import-worker.ts          # bounded workbook parsing
    import.ts                 # orchestration and preview model
    export.ts                 # unique headers + safe CSV + one-pass downloads
  ai/
    client.ts                 # fetch/stream/cancel/error mapping
    patches.ts                # validate, dedupe, conflict detection
    chat-session.svelte.ts    # bounded message/request state
    DiffPreview.svelte
    ChatView.svelte
  settings/
    SettingsDialog.svelte
    AiSettings.svelte
    AppearanceSettings.svelte
    DatasetSettings.svelte
    ShortcutSettings.svelte
    AboutSettings.svelte
    model-catalog.ts
  toast/
    toast.svelte.ts
    ToastHost.svelte
```

This is a target, not permission for a big-bang rewrite. Extract only in the task that changes that behavior, keep public contracts small, and preserve a passing suite after every task.

## 7. Remediation tasks

### Task 1: Lock regressions for the confirmed dropdown failures

**Files:**

- Modify: `e2e/table.spec.ts`
- Modify: `tests/ai.test.ts`
- Test: `e2e/table.spec.ts`, `tests/ai.test.ts`

- [ ] Add an API test that mocks Google’s model list with `gemini-2.5-flash`, calls `GET`, and expects `200` with a model array. Verify it currently fails with `500` and the temporal-dead-zone error.
- [ ] Add E2E coverage that one click/tap on a status chevron opens a visible combobox.
- [ ] Add E2E coverage for the last status row: after opening, assert the option list’s bounding box is fully inside the viewport and not covered by the summary footer.
- [ ] Add E2E coverage for Samples, Export, Column options, and Model selection: trigger keyboard open, arrow navigation, Enter selection, Escape close, and focus restoration.
- [ ] Run `bun test tests/ai.test.ts` and the focused E2E grep; preserve the expected failures before implementation.

Minimum model test shape:

```ts
it('formats a successful Google model catalog containing gemini-2.5-flash', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    models: [{
      name: 'models/gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      supportedGenerationMethods: ['generateContent'],
      inputTokenLimit: 1_048_576
    }]
  })));
  const response = await GET({ request: requestWithKey() } as Parameters<typeof GET>[0]);
  expect(response.status).toBe(200);
  expect((await response.json()).models[0].id).toBe('gemini-2.5-flash');
});
```

### Task 2: Fix model catalog, model policy, and key handling

**Files:**

- Modify: `src/routes/api/ai/models/+server.ts`
- Modify: `src/routes/api/ai/+server.ts`
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/SettingsModal.svelte` or create `src/lib/settings/model-catalog.ts`
- Modify: `tests/ai.test.ts`

- [ ] Compute catalog-wide facts before mapping; never reference the output array inside its initializer.
- [ ] Parse Google JSON with a bounded Zod schema, cap pagination, detect repeated tokens, and add a timeout signal.
- [ ] Send the API key only in `x-goog-api-key`; remove the query parameter.
- [ ] Centralize key-shape validation and stable upstream error mapping.
- [ ] Remove shut-down Gemini 2.0 entries and migrate invalid persisted model IDs to `DEFAULT_AI_MODEL`.
- [ ] Share a model-ID policy between model retrieval and generation; test unsupported plausible `gemini-*` IDs.
- [ ] Add request versioning/abort to Settings so stale fetches cannot repopulate cleared state.
- [ ] Run `bun test tests/ai.test.ts && bun run check`.

### Task 3: Replace fragile dropdowns with shared positioned/focus behavior

**Files:**

- Create: `src/lib/floating/position.ts`
- Create: `src/lib/floating/menu.ts`
- Create: `src/lib/floating/combobox.ts`
- Create: `src/lib/grid/StatusCellEditor.svelte`
- Modify: `src/lib/DataTable.svelte`
- Modify: `src/lib/Header.svelte`
- Modify: `src/lib/RightRibbon.svelte`
- Modify: `src/lib/SettingsModal.svelte`
- Modify: `e2e/table.spec.ts`

- [ ] Implement a floating-layer position function that takes trigger/layer/viewport rectangles and returns a flipped/shifted placement; unit-test bottom, right, and mobile edges.
- [ ] Implement menu open/focus/arrow/Home/End/Enter/Escape/Tab restoration once and reuse it.
- [ ] Implement the status interaction contract in Section 5, including one-tap coarse-pointer behavior and original-value restoration.
- [ ] Implement a standards-based model combobox with active descendant and search autofocus.
- [ ] Remove the window-level table keyboard listener from unrelated controls.
- [ ] Run focused dropdown tests at desktop, 390×844 touch emulation, and the bottom grid row.

### Task 4: Repair table persistence, history, and typed mutations

**Files:**

- Create: `src/lib/table/schema.ts`
- Create: `src/lib/table/commands.ts`
- Create: `src/lib/table/persistence.ts`
- Modify or move: `src/lib/table.svelte.ts`
- Modify: `src/routes/+page.svelte`
- Modify: `tests/table.test.ts`

- [ ] Add failing tests for zero-row hydration, malformed JSON, duplicate IDs, invalid widths/types, invalid/no-op row/column commands, undo-to-clean, save failure, and type conversion.
- [ ] Define a versioned persisted schema that accepts zero rows and normalizes every cell through its declared column type.
- [ ] Return hydration status (`restored`, `missing`, `invalid`) so the page seeds a sample only for `missing`.
- [ ] Validate mutations before history; make column conversion atomic and undoable.
- [ ] Replace full snapshots for ordinary edits with reversible patches/commands; retain bounded checkpoints for load/reset.
- [ ] Track save baseline/revision so undoing back to it clears dirty state.
- [ ] Expose save status and flush pending saves on visibility teardown.
- [ ] Run `bun test tests/table.test.ts && bun run check`.

### Task 5: Make import/export safe and truthful

**Files:**

- Create: `src/lib/import-export/import-worker.ts`
- Create: `src/lib/import-export/import.ts`
- Create: `src/lib/import-export/export.ts`
- Modify: `src/lib/data.ts`
- Modify: `src/lib/RightRibbon.svelte`
- Modify: `tests/data.test.ts`
- Modify: `package.json`, `bun.lock`

- [ ] Replace/upgrade vulnerable SheetJS and verify `bun audit` no longer reports the two `xlsx` advisories.
- [ ] Add strict file-size, row, column, and decompressed-work limits before committing imported data.
- [ ] Parse in a worker with progress and cancellation; return a preview rather than calling `loadTable` immediately.
- [ ] Add sheet selection and explicit “first row is headers”/type overrides.
- [ ] Generate unique export headers and test duplicate names.
- [ ] Neutralize formula-leading CSV headers/cells and test `=`, `+`, `-`, `@`, tab, and CR cases.
- [ ] Preserve/ask for currency metadata instead of relabeling all currencies USD.
- [ ] Fix date-only parsing and test under `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata`.
- [ ] Serialize Excel only once and preserve header-only exports.
- [ ] Run `bun test tests/data.test.ts && bun run build && bun audit`.

### Task 6: Harden AI patching and chat lifecycle

**Files:**

- Create: `src/lib/ai/client.ts`
- Create: `src/lib/ai/patches.ts`
- Create: `src/lib/ai/chat-session.svelte.ts`
- Modify: `src/lib/AiDrawer.svelte`
- Modify: `src/routes/api/ai/+server.ts`
- Modify: `tests/ai.test.ts`
- Add focused client/unit tests under `tests/`

- [ ] Add tests for stale-preview conflicts, duplicate patches, out-of-table targets, patch bounds, aborted/replaced requests, close/reopen, 51-message history, and oversized assistant replies.
- [ ] Require old-value/version agreement at Apply; present conflicts instead of overwriting.
- [ ] Bound/dedupe patches on both server and client.
- [ ] Make one request state machine own `idle | generating | streaming | cancelling | error`; every exit must finalize the placeholder message.
- [ ] Disable or intentionally replace in-flight requests; expose a visible Cancel action.
- [ ] Bound chat context by serialized size/token estimate and summarize or prune old turns.
- [ ] Send targeted rows for fill/clean rather than pretending a 40-row sample covers the full table.
- [ ] Treat table cells as untrusted prompt data and validate patch semantics.
- [ ] Flush streamed decoding and add respectful auto-scroll.
- [ ] Run AI and client tests plus `bun run check`.

### Task 7: Implement scoped grid focus and modal ergonomics

**Files:**

- Create: `src/lib/grid/grid-navigation.ts`
- Modify: `src/lib/DataTable.svelte`
- Modify: `src/lib/AiDrawer.svelte`
- Modify: `src/lib/SettingsModal.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/app.css`
- Modify: `e2e/table.spec.ts`

- [ ] Add roving-tabindex grid tests: Tab entry, Arrow movement, edit/cancel/commit, and no interception in menus/search/settings.
- [ ] Make overlay AI/Settings modal, inert the background, trap/restore focus, and close with Escape.
- [ ] Suppress workspace shortcuts while a modal is open.
- [ ] Enforce 44 px hit areas under coarse pointers and replace tiny mobile row buttons with one actions menu.
- [ ] Make mobile settings navigation reveal and scroll to the active tab.
- [ ] Add an accessibility scan (for example, axe-core) for the default workspace, each menu/combobox, Settings, confirmations, and mobile AI.
- [ ] Run the full E2E suite in desktop Chrome plus a real touch-capable Playwright device profile.

### Task 8: Decompose monoliths and remove duplication/dead code

**Files:**

- Create focused components/modules from the file map in Section 6 as their behaviors are touched.
- Modify: `src/routes/+layout.svelte`, `src/routes/+page.svelte`
- Modify: `src/lib/Header.svelte`, `src/lib/DataTable.svelte`, `src/lib/AiDrawer.svelte`, `src/lib/SettingsModal.svelte`
- Modify: `src/lib/types.ts`, `src/lib/constants.ts`, `src/lib/Icon.svelte`
- Modify: `package.json`, `tsconfig.json`

- [ ] Consolidate the two toast systems into one host/store with optional Undo action.
- [ ] Extract settings sections, AI transport/state/presentation, grid cell/status/menu/footer behavior.
- [ ] Remove unused Header props, dead domain types, duplicate icon map, unused imports, and unused dependencies.
- [ ] Type icon props without `any` and choose one icon strategy.
- [ ] Enable `noUnusedLocals`, `noUnusedParameters`, lint, and formatting checks.
- [ ] Keep each extraction behavior-preserving and run the relevant test after every move.

### Task 9: Reconcile deployment, docs, and verification

**Files:**

- Modify: `package.json`, `bun.lock`, `svelte.config.js`, `README.md`, `AGENT.md`
- Create: project CI configuration when the repository is restored to Git.

- [ ] Make `package.json` exactly match intended direct dependencies and current majors; regenerate the lockfile once.
- [ ] Verify `bun install --frozen-lockfile --dry-run` succeeds.
- [ ] Select the real SvelteKit adapter and smoke-test its output.
- [ ] Remove shut-down model IDs, stale bundle numbers, and unsupported reliability claims from docs.
- [ ] Document API-key transmission/storage accurately and offer a nonpersistent/session-only mode.
- [ ] Run the complete matrix below and record outputs in the implementation handoff.

## 8. Required final verification matrix

An implementation is not complete until all of these are green and the manual dropdown reproductions are rechecked:

```bash
bun install --frozen-lockfile --dry-run
bun run check
bun test tests
bun run build
bun run test:e2e
bun audit --audit-level=low
```

Required browser checks:

1. Desktop status dropdown opens from the chevron with one click and from keyboard.
2. The dropdown is fully visible for the first and last row and after horizontal/vertical scrolling.
3. Touch status editing works with one tap and every action has an adequate hit area.
4. Samples, Export, Column options, and Models work with pointer and full keyboard navigation.
5. Settings and mobile AI contain focus, close with Escape, restore focus, and leave the background inert.
6. Grid keys do nothing when focus is in toolbar, menu, dialog, input, or textarea controls.
7. Empty/header-only tables survive reload.
8. Duplicate-named columns export without loss; CSV formulas are neutralized; date-only values are timezone-stable.
9. AI stale-preview conflicts cannot overwrite newer edits silently.
10. Model retrieval succeeds against a mocked representative Google catalog and an optional real key smoke test performed manually by the owner.

## 9. Acceptance criteria for judging the implementing AI

Score the implementation against these gates:

| Area | Gate |
|---|---|
| P0 closure | All five P0 findings have regression tests and verified fixes |
| Data integrity | No silent loss on duplicate export, empty persistence, dates, currencies, CSV, or AI conflicts |
| Dropdowns | Pointer, touch, keyboard, and edge positioning all work across status/models/menus |
| Accessibility | Scoped grid focus, modal inertness, focus restoration, meaningful ARIA, 44 px touch targets, no serious automated violations |
| Security | Patched spreadsheet parser, bounded worker import, no key in URL, safe CSV, safe upstream errors |
| Architecture | Behavior is separated at the proposed boundaries without a rewrite or duplicate abstractions |
| Tests | New tests fail on the old behavior and pass on the fix; no network-dependent E2E calls |
| Reproducibility | Frozen install, type-check, unit, build, E2E, and audit commands succeed |
| Documentation | Matches actual models, behavior, privacy, bundle, and deployment target |

Automatic rejection conditions:

- It merely changes status `ondblclick` to `onclick` without fixing focus, touch semantics, or clipping.
- It hides the model endpoint error instead of removing the temporal-dead-zone reference and testing the success path.
- It suppresses `bun audit` or pins the same vulnerable `xlsx` version.
- It resolves lock drift by deleting the lockfile without producing a reproducible frozen install.
- It “fixes” stale AI previews by discarding `oldValue` rather than detecting conflicts.
- It introduces a large UI library solely to avoid understanding the three required primitives.
- It performs a broad rewrite that loses existing import/export, undo/redo, responsive, or AI functionality.
- It claims completion without the verification evidence in Section 8.

## 10. External references used for time-sensitive findings

- [Google Gemini model catalog](https://ai.google.dev/gemini-api/docs/models) — current model IDs and shut-down Gemini 2.0 entries.
- [Google Gemini API changelog](https://ai.google.dev/gemini-api/docs/changelog) — Gemini 2.0 shutdown timing.
- [GitHub advisory: SheetJS prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) — affected `<0.19.3`; no patched npm release.
- [GitHub advisory: SheetJS ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) — affected `<0.20.2`; no patched npm release.
- [MDN Navigator](https://developer.mozilla.org/docs/Web/API/Navigator) — `navigator.platform` is deprecated.
- [Svelte 5 migration guide/search](https://svelte.dev/search?q=svelte+onclick) — current event attributes are `onclick`/`onkeydown`; this project already uses the modern syntax.

## 11. Final recommendation

Do not start with the monolith refactor. Start with regression tests, fix the model catalog and status/menu primitives, remove the vulnerable spreadsheet parser, and reconcile dependencies. Then repair data integrity and persistence, followed by AI concurrency and accessibility. Extract components only along the behavior being fixed. This ordering produces a usable, safer product after every phase and gives reviewers concrete evidence instead of a cosmetically cleaner but still unreliable codebase.
