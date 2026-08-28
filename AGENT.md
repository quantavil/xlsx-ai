# Project Agent (AGENT.md)

## Structure
- SvelteKit 2 + Svelte 5 runes (`$state`, `$derived`, `$props`) running on Bun 1.4+. `src/routes/+page.ts` owns `export const ssr = false`.
- Core Modules:
  - `src/lib/table/`: `DataTable.svelte`, `DropdownCellEditor.svelte`, `StatusCellEditor.svelte`, `store.svelte.ts`, `cells.ts`, `commands.ts`, `schema.ts`, `persistence.ts`.
  - `src/lib/components/`: `Header.svelte`, `RightRibbon.svelte`, `AiDrawer.svelte`, `SettingsModal.svelte`, `Icons.svelte`, `settings/` (`AiSection.svelte`, `AppearanceSection.svelte`, `ModulesSection.svelte`, `DatasetsSection.svelte`, `ShortcutsSection.svelte`, `AboutSection.svelte`).
  - `src/lib/modules/`: `types.ts`, `registry.ts`, `module-store.svelte.ts`, `icegrid/` (`index.ts`, `columns.ts`, `readers.ts`, `schema.ts`, `extract.ts`, `ai.server.ts`, `validate.ts`, `to-table.ts`).
  - `src/lib/server/modules/`: server-only AI handler types and the static module action registry.
  - `src/lib/data/`: `import.ts`, `export.ts`, `samples.ts`, `index.ts`.
  - `src/lib/ai/`: `client.ts`, `patches.ts`, `chat-session.svelte.ts`.
  - `src/lib/ui/`: `position.ts`, `combobox.ts`, `menu.ts`, `focus.ts`, `ToastHost.svelte`, `toast.svelte.ts`.
  - Root: `src/lib/constants.ts`, `src/lib/types.ts`.
- Routes: `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/api/ai/+server.ts`, `src/routes/api/ai/models/+server.ts`.
- Styling: Tailwind CSS v4 (`@tailwindcss/vite`) in `src/app.css` providing utility classes, non-black ultra-thin scrollbars, and design tokens across dark/light themes.
- Tests: `tests/table.test.ts`, `tests/data.test.ts`, `tests/ai.test.ts`, `tests/ai-client.test.ts`, `tests/modules.test.ts`, `tests/icegrid-readers.test.ts`, `tests/icegrid-schema.test.ts`, `tests/icegrid-mapping.test.ts`, `tests/icegrid-e2e-workflow.test.ts` (run via `bun test`), `e2e/table.spec.ts` (run via `bun run test:e2e`).



## Blunders
- Importing `pdfjs-dist/build/pdf.mjs` directly throws `ReferenceError: DOMMatrix is not defined` in headless Node/Bun test runners. Fixed by importing from `pdfjs-dist/legacy/build/pdf.mjs`.
- Pressing Enter in inline cell editor bubbled keydown event to table scroll wrapper, triggering table-level edit handler and immediately re-opening edit mode. Fixed by calling `e.stopPropagation()` in `handleEditorKeyDown`.
- Referencing `formattedModels.some(...)` during `allRawModels.map(...)` definition in `models/+server.ts` caused a TDZ 500 crash on any response with `gemini-2.5-flash`. Fixed by precomputing `hasDefaultModel` upfront.
- Binding `bind:this` on Svelte 5 template elements to arrow functions errors during `svelte-check`. Fixed by using custom Svelte action `use:registerCellNode`.
- Empty or 0-row tables were discarded on reload because `store.rows.length === 0` fallback in `+page.svelte` replaced them with SaaS sample. Fixed by returning explicit hydration status `{ status: 'restored' | 'missing' | 'invalid' }`.
- Exporting tables with duplicate column names dropped data when mapped directly to object keys. Fixed by disambiguating headers with `buildUniqueExportHeaders()`.
- Missing `@types/bun` in devDependencies caused `svelte-check` to fail in CI on `tests/setup.ts`. Fixed by installing `@types/bun` and adding explicit `PluginBuilder` typing.

## Notes & Discoveries
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
