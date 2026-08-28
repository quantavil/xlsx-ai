# Project Agent (AGENT.md)

## Structure
- SvelteKit 2 + Svelte 5 runes (`$state`, `$derived`, `$props`) running on Bun 1.4+. `src/routes/+layout.ts` owns `export const ssr = false` for every route.
- Core Modules:
  - `src/lib/table/`: `DataTable.svelte`, `DropdownCellEditor.svelte`, `store.svelte.ts`, `documents.svelte.ts` (multi-file index), `cells.ts`, `commands.ts`, `schema.ts`, `persistence.ts`.
  - `src/lib/components/`: `Header.svelte` (Files switcher + title + search + alignment control), `RightRibbon.svelte` (AI, modules, add row, export, theme, settings — **not** file creation or import), `AiDrawer.svelte`, `Icons.svelte`, `settings/` (`AiSection.svelte`, `ModulesSection.svelte`, `ShortcutsSection.svelte`) — rendered on the `/settings` page behind a three-item section rail (`nav.settings-sidebar`), not a modal.
  - `src/lib/modules/`: `types.ts`, `registry.ts`, `module-store.svelte.ts`, `icegrid/` (`index.ts`, `columns.ts`, `readers.ts`, `schema.ts`, `extract.ts`, `ai.server.ts`, `validate.ts`, `to-table.ts`).
  - `src/lib/server/`: `models.ts` (single source of truth for allowed Gemini model ids, shared by both API routes) and `modules/` (server-only AI handler types + static module action registry).
  - `src/lib/data/`: `import.ts`, `export.ts`, `index.ts`. There are no sample datasets — a new workspace opens a blank file.
  - `src/lib/ai/`: `client.ts`, `patches.ts`.
  - `src/lib/ui/`: `position.ts`, `combobox.ts`, `menu.ts`, `ToastHost.svelte`, `toast.svelte.ts`.
  - `src/lib/workspace.svelte.ts`: the single shared document/table/module/toast store + theme, owned above the router so `/settings` and `/` share one live workspace. `createFile`/`newBlankFile`/`openFile`/`deleteFile` are the only entry points that switch files.
  - Root: `src/lib/constants.ts`, `src/lib/types.ts`.
- Routes: `src/routes/+layout.svelte`, `src/routes/+page.svelte` (workspace), `src/routes/settings/+page.svelte` (settings; active section is local state, no URL param), `src/routes/api/ai/+server.ts`, `src/routes/api/ai/models/+server.ts`.
- Styling: Tailwind CSS v4 (`@tailwindcss/vite`) in `src/app.css` providing utility classes, non-black ultra-thin scrollbars, and design tokens across dark/light themes.
- Document shape: `TableData` is `{title, columns, rows, cellAlign?}`. `cellAlign` maps `rowId::columnId` to `left|center|right` and is part of the persisted v2 document, the undo history, and the document hash.
- Storage layout: `xlsx-ai:docs:v1` holds `{docs:[{id,title,updatedAt}], activeId}`; each file's rows live at `xlsx-ai:doc:<id>`. The table store takes its storage key as a getter so the active file can change without rebuilding the adapter.
- Tests: `tests/table.test.ts`, `tests/documents.test.ts`, `tests/data.test.ts`, `tests/ai.test.ts`, `tests/ai-client.test.ts`, `tests/modules.test.ts`, `tests/icegrid-readers.test.ts`, `tests/icegrid-schema.test.ts`, `tests/icegrid-mapping.test.ts`, `tests/icegrid-e2e-workflow.test.ts`, `tests/cell-align.test.ts` (run via `bun test`), `e2e/table.spec.ts` (run via `bun run test:e2e`).



## Blunders
- Importing `pdfjs-dist/build/pdf.mjs` directly throws `ReferenceError: DOMMatrix is not defined` in headless Node/Bun test runners. Fixed by importing from `pdfjs-dist/legacy/build/pdf.mjs`.
- Pressing Enter in inline cell editor bubbled keydown event to table scroll wrapper, triggering table-level edit handler and immediately re-opening edit mode. Fixed by calling `e.stopPropagation()` in `handleEditorKeyDown`.
- Referencing `formattedModels.some(...)` during `allRawModels.map(...)` definition in `models/+server.ts` caused a TDZ 500 crash on any response with `gemini-2.5-flash`. Fixed by precomputing `hasDefaultModel` upfront.
- Binding `bind:this` on Svelte 5 template elements to arrow functions errors during `svelte-check`. Fixed by using custom Svelte action `use:registerCellNode`.
- Empty or 0-row tables were discarded on reload because `store.rows.length === 0` fallback in `+page.svelte` replaced them with SaaS sample. Fixed by returning explicit hydration status `{ status: 'restored' | 'missing' | 'invalid' }`.
- Exporting tables with duplicate column names dropped data when mapped directly to object keys. Fixed by disambiguating headers with `buildUniqueExportHeaders()`.
- Missing `@types/bun` in devDependencies caused `svelte-check` to fail in CI on `tests/setup.ts`. Fixed by installing `@types/bun` and adding explicit `PluginBuilder` typing.
- **Every ICEGrid import failed with "Gemini could not complete the request."** Gemini's `responseSchema` only permits `enum` on STRING types, and `reportVersion: z.literal(1)` compiles to `{type:"number",enum:[1]}` -> HTTP 400 on every call. Fixed by generating `IcegridExtractionSchema` (rows + warnings only) and stamping `reportVersion`/`sourceFiles` server-side. `tests/icegrid-schema.test.ts` now asserts the emitted responseSchema contains no non-string enum. **Never put a numeric/boolean `z.literal` or `z.enum` in a schema handed to `generateObject` with the Google provider.**
- `/api/ai` collapsed every provider failure into one opaque 502 string, which is what made the above undebuggable. It now forwards the provider's own message and reads `statusCode` (the AI SDK's field) rather than `status`.
- `store.loadTable()` cleared undo history, so the "instant load, undo via Ctrl+Z" affordance on imports silently destroyed unsaved work. It now pushes history unless the current document is empty.
- `tbody` ends with a full-height `tr.grid-filler` so the `sticky bottom-0` summary row lands on the floor of the grid instead of floating mid-page when rows are shorter than the viewport. Consequence: `tbody tr.data-row:last-child` never matches — use `.locator('tr.data-row').last()`.
- Ribbon buttons render their own tooltip span; adding a native `title` too produced two stacked tooltips. Use `aria-label` only.
- Long cell text bled across the column border into the neighbouring cell. `truncate` was on an **inline** `<span>`, where `overflow: hidden` does nothing. Fixed with `block w-full` on `.cell-text-display` plus `overflow-hidden` on the `td`.
- `focus` fires between `mousedown` and `click`, so the cell's `onfocus` handler reset the selection anchor and collapsed every shift-click to a single cell. `onmousedown` now records `pointerExtend` for `onfocus` to read.
- **Clicking Settings popped a file-chooser.** `$effect(() => registerImportPicker?.(...))` returned the registered function, and Svelte runs an effect's return value as teardown — so unmounting the ribbon on navigation called `fileInput.click()`. **Never let an `$effect` body implicitly return anything but a cleanup function; always use a braced body.** Guarded by a `page.on('filechooser')` assertion in the settings e2e test.
- File creation/import belongs to the Files menu in the header only. The ribbon duplicated both; the hidden `<input type="file">` for import now lives in `src/routes/+page.svelte` next to the Files menu that opens it.

## Notes & Discoveries
- Grid selection lives in the table store (`setSelection(cell, extend)` / `selectionRect` / `activeCell`), not in `DataTable`, so the header's alignment control acts on the same range the grid shows. Anchor + focus; equal means one cell.
- Cell alignment is document state: `TableData.cellAlign` maps `rowId::columnId` -> `left|center|right`, defaulting per column type via `defaultAlignForType` (numbers right, everything else left — Excel's own rule). It is undoable, persisted in the v2 document, and orphan keys are pruned in `sanitizeAndNormalizeTableData`. The community SheetJS build ignores cell styles, so alignment is **not** carried into `.xlsx` export.
- Excel-Style Roving Tabindex: Active cell receives `tabindex="0"` while all other cells are `tabindex="-1"`. Arrow keys navigate cells without entering edit mode, updating focus immediately.
- Floating Popover Overflow: In scrollable table wrappers (`overflow: auto`), popovers are positioned using `position: fixed` with coordinates computed from `computeFloatingPosition()`.
- SheetJS Patched CE: Installed `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` to eliminate all high vulnerabilities from `bun audit`.
- CSV Injection Mitigation: Values starting with `=`, `+`, `-`, `@`, `\t`, `\r` are prefixed with `'` during export to neutralize spreadsheet execution vulnerabilities.
- Request Cancellation & Versioning: AI model fetching and chat sessions use versioned request IDs and `AbortController` cancellation to eliminate race conditions.

## Workspace Module Rules
- Register browser modules only in `src/lib/modules/registry.ts`; register server AI actions only in `src/lib/server/modules/registry.ts`. Runtime-downloaded modules are not supported.
- Use stable lowercase module IDs. Keep module-specific readers, schemas, prompts, validation, mapping, and server handlers inside the module directory.
- Every module manifest must declare its ribbon label, `IconName`, file-picker accept list, and multiple-selection behavior. `RightRibbon.svelte` must render this metadata generically and must not branch on a module ID.
- Modules receive the active Gemini configuration and JSON/streaming access through `ModuleContext.ai`. Server handlers receive the authenticated model and may use the installed AI SDK; do not create another endpoint, provider, key store, or model selector.
- Modules must respect the run `AbortSignal`, return `TableData` plus warnings, and never directly import or mutate the table store, Settings state, or toast store.
- Disabling a running module must abort it and prevent late results from replacing the table. Add tests for manifests, inputs, cancellation, validation, and returned table data.
