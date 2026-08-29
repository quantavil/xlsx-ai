# ICEGrid Evidence, Catalog, and Output Accuracy Implementation Plan

> **For the implementing AI:** Execute this plan one layer at a time. Stop after every **Manual gate** and let the user test before continuing. Use test-driven development: add the named failing test first, run it and capture the expected failure, implement only that layer, then rerun the focused tests. Do not rewrite the existing module host, AI client, table, or export path.

**Goal:** Make the existing ICEGrid module produce the closest defensible 37-column output from multiple selected files while preventing unsupported AI values, adding trusted/editable in-app dropdown catalogs, and preserving the current xlsx-ai architecture.

**Architecture:** Keep the current `File[] -> combined text -> one /api/ai module request -> TableData` flow. Gemini returns candidate rows plus transient evidence. Browser-side sanitization verifies the evidence against each extracted file block, normalizes only exact catalog matches, applies a very small set of documented mechanical rules, validates without discarding useful rows, and maps the clean report to the existing table. Catalogs are checked-in snapshots with a small user-custom overlay; ICEGATE is never called during import.

**Tech stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Bun/Vitest, Playwright, Zod 3, AI SDK 4 with the existing Google Gemini provider, SheetJS 0.20.3, PDF.js 6.1.200.

**Approved design:** `docs/superpowers/specs/2026-08-29-icegrid-accuracy-catalogs-design.md`

**Library rules:** Add no new runtime dependency. Use `xlsx` for spreadsheet input and workbook regression checks, `pdfjs-dist/legacy/build/pdf.mjs` for existing PDF text extraction, `zod` for AI/report/catalog/localStorage validation, `ai.generateObject` with the host-provided Gemini model for the single structured request, Svelte 5 runes for the module-local catalog store, and `node:crypto` only in the developer catalog-refresh tool for SHA-256 provenance.

---

## Non-negotiable guardrails

- Keep the module in `src/lib/modules/icegrid/`.
- Keep one AI request for all files selected in one picker action.
- Reuse `ModuleContext.ai` and `/api/ai`; add no provider, key, model setting, or route.
- Keep exactly 37 output headers in their current order.
- `Accessories` is always blank and has no dropdown.
- Do not calculate and fill missing customs values.
- Do not default `FTACode` to `NCPTI` or `RoDTEPQty` to `Quantity`.
- No fuzzy matching or nearest-option selection.
- Unknown or unsupported candidate values become blank plus a warning.
- Do not add OCR, grouping, reconciliation UI, a second table, or an Excel validation-list exporter.
- Preserve unrelated user changes. Before every layer, inspect `git status --short`; never reset or overwrite unrelated work.
- Do not commit unless the user/repository workflow authorizes commits. If authorized, use the checkpoint commit message shown after each layer.

## Target pipeline

```text
combineDocumentSources(files)
  -> requestIcegridExtraction(extraction)       // candidate rows + evidence
  -> sanitizeIcegridExtraction(raw, extraction, catalogs)
       -> verify evidence
       -> exact catalog resolution
       -> approved mechanical rules
  -> validateIcegridReport(cleanReport, catalogs)
  -> mapReportToTableData(cleanReport, catalogs)
  -> existing store.loadTable()
  -> existing Excel export
```

---

# Layer 0 — Lock the trusted behavior before changing code

## Task 0.1: Record the current baseline

**Files:**

- Read only: `package.json`
- Read only: `src/lib/modules/icegrid/**`
- Read only: `src/lib/table/**`
- Read only: `tests/icegrid-*.test.ts`
- Create: `docs/superpowers/verification/2026-08-29-icegrid-baseline.md`

- [ ] Run `git status --short` and record the existing modified/untracked files. Treat them as user-owned.
- [ ] Run `bun test tests/icegrid-schema.test.ts tests/icegrid-readers.test.ts tests/icegrid-mapping.test.ts tests/icegrid-e2e-workflow.test.ts tests/modules.test.ts`.
- [ ] Run `bun run check`.
- [ ] Run `bun run build`.
- [ ] Record the exact pass/fail counts and existing failures in the baseline document. Do not fix unrelated failures in this task.
- [ ] Search for the current integration points:

  ```bash
  rg -n "icegrid|WorkspaceModule|DropdownCellEditor|PersistedColumnSchema" src tests e2e
  ```

**Expected result:** The implementing AI knows the real starting state and can distinguish regressions from pre-existing failures.

## Task 0.2: Bring representative trusted fixtures into this repository

**Files:**

- Create: `tests/fixtures/icegrid/legacy/combined-pdf/input.pdf`
- Create: `tests/fixtures/icegrid/legacy/combined-pdf/expected-output.xlsx`
- Create: `tests/fixtures/icegrid/legacy/combined-xlsx/input.xlsx`
- Create: `tests/fixtures/icegrid/legacy/combined-xlsx/expected-output.xlsx`
- Create: `tests/fixtures/icegrid/legacy/split-xls/invoice.xls`
- Create: `tests/fixtures/icegrid/legacy/split-xls/packing.xls`
- Create: `tests/fixtures/icegrid/legacy/split-xls/expected-output.xlsx`
- Create: `tests/fixtures/icegrid/legacy/input-10/input.pdf`
- Create: `tests/fixtures/icegrid/legacy/input-10/expected-output.xlsx`
- Create: `tests/fixtures/icegrid/legacy/SHA256SUMS`
- Create: `tests/icegrid-golden-fixtures.test.ts`

Source every binary byte from Git `HEAD` in `/home/quantavil/Documents/Project/icegrid`; do not use the dirty legacy working tree. Copy the corresponding checksum entries from `tests/fixtures/legacy/SHA256SUMS` and verify them after copying.

- [ ] Add a failing golden-fixture test that reads each expected workbook with SheetJS and asserts:
  - one output worksheet;
  - exactly the 37 `ICEGRID_HEADERS` in order;
  - expected row counts;
  - every `Accessories` cell is blank;
  - representative `Per` cells equal `1`;
  - at least one sparse case keeps unsupported customs fields blank;
  - enriched cases preserve literal `IGST_Rate` values such as `18`;
  - a `RoDTEPQty` that differs from `Quantity` is preserved.
- [ ] Add an explicit assertion documenting the intentional migration from legacy code-only scheme `19` to canonical `19-Drawback (DBK)` for newly generated output.
- [ ] Run `bun test tests/icegrid-golden-fixtures.test.ts`; it should initially fail until the manifest, paths, and assertions are correct.
- [ ] Make only the fixture/test harness pass. Do not change production behavior yet.
- [ ] Run `bun test tests/icegrid-golden-fixtures.test.ts` and verify all fixture checks pass.

**Manual gate 0:** Show the user the four selected cases, their row counts, and why each case is retained: sparse PDF, enriched XLSX, multi-file XLS, and code-only scheme migration. Do not start Layer 1 until approved.

**Optional authorized commit:** `test(icegrid): add trusted golden fixture baseline`

---

# Layer 1 — Add the minimum generic dropdown capability to the host table

This is the only cross-cutting table change. It must remain generic and must not mention ICEGrid.

## Task 1.1: Extend the column contract and persistence

**Files:**

- Modify: `src/lib/types.ts`
- Modify: `src/lib/table/schema.ts`
- Modify: `src/lib/table/persistence.ts`
- Test: `tests/table.test.ts`
- Test: `tests/documents.test.ts`

- [ ] Add failing tests proving a table document preserves structured dropdown options through:
  - `sanitizeAndNormalizeTableData`;
  - local-storage serialization;
  - V2 parsing/hydration;
  - table-store load and undo/redo snapshots.
- [ ] Add a failing test proving malformed, empty, and duplicate dropdown options are sanitized without destroying the column.
- [ ] Run `bun test tests/table.test.ts tests/documents.test.ts` and confirm the new assertions fail because dropdown metadata is currently stripped.
- [ ] Add these types to `src/lib/types.ts`:

  ```ts
  export interface DropdownOption {
    value: string;
    label?: string;
    parentValue?: string;
  }

  export interface DropdownConfig {
    options: DropdownOption[];
    allowCustom: boolean;
    dependsOnColumnId?: string;
  }

  export interface Column {
    id: string;
    name: string;
    type: ColumnType;
    width?: number;
    dropdown?: DropdownConfig;
  }
  ```

- [ ] Extend `PersistedColumnSchema` with a strict optional `dropdown`. Limit option values and labels to 200 characters, cap options at 5,000, and require `dependsOnColumnId` to be non-empty when present.
- [ ] Add one pure sanitizer that:
  - trims `value`, `label`, and `parentValue`;
  - removes blank values;
  - deduplicates on case-insensitive `(value, parentValue)`;
  - retains first occurrence order;
  - removes `dropdown` from non-dropdown columns;
  - drops a dependency that references the column itself.
- [ ] Use that sanitizer in `sanitizeAndNormalizeTableData` and preserve `dropdown` in `createLocalStorageAdapter.scheduleSave`.
- [ ] Do not bump the whole table document version merely for an optional field; existing V2 documents must continue to load.
- [ ] Run the focused tests and `bun run check`.

## Task 1.2: Render labels while storing values

**Files:**

- Modify: `src/lib/table/DropdownCellEditor.svelte`
- Modify: `src/lib/table/DataTable.svelte`
- Modify only if required: `src/lib/ui/combobox.ts`
- Test: `tests/table.test.ts`
- Test: `e2e/table.spec.ts`

- [ ] Add tests for a pure helper, exported from a small table utility file if needed, that merges built-in options with current row values while preserving built-ins first and deduplicating exact values.
- [ ] Add Playwright assertions for:
  - option text displays `value — label`;
  - clicking commits only `value` to the cell;
  - `allowCustom: false` hides `+ Add` and Enter cannot create an unknown value;
  - `allowCustom: true` still permits explicit creation;
  - a dependent dropdown shows only options whose `parentValue` matches the dependency cell;
  - clearing the parent leaves the child value visible but offers no unrelated built-ins.
- [ ] Run the focused unit/e2e test and confirm the new assertions fail.
- [ ] Change `DropdownCellEditor` props to:

  ```ts
  interface Props {
    value: string | null;
    options: DropdownOption[];
    allowCustom: boolean;
    triggerEl?: HTMLElement | null;
    onCommit: (value: string) => void;
    onCancel: () => void;
  }
  ```

- [ ] Search/filter by both `value` and `label`; render `value — label`; pass the selected option's `value` to `onCommit`.
- [ ] Make `showCreate` and `onCreate` conditional on `allowCustom`.
- [ ] Replace `getColumnUniqueValues(columnId)` with a helper that receives the whole `Column` and current `Row`, merges configured options with values already present in the table, and applies `dependsOnColumnId` filtering.
- [ ] Keep the existing behavior for old dropdown columns with no `dropdown` config: use current unique values and allow custom values.
- [ ] Run `bun test tests/table.test.ts`, `bun run check`, and the focused Playwright test.

**Manual gate 1:** Open an ordinary non-ICEGrid table with a sample dropdown. Verify labels, stored values, `+ Add`, keyboard navigation, clear, persistence after reload, and dependent filtering. Confirm no ICEGrid-specific logic exists in table components.

**Optional authorized commit:** `feat(table): support structured and dependent dropdown options`

---

# Layer 2 — Add trusted ICEGrid catalogs and exact-only resolution

## Task 2.1: Define catalog types and approved fixed lists

**Files:**

- Create: `src/lib/modules/icegrid/catalogs/types.ts`
- Create: `src/lib/modules/icegrid/catalogs/fixed.ts`
- Create: `src/lib/modules/icegrid/catalogs/provenance.ts`
- Create: `src/lib/modules/icegrid/catalogs/index.ts`
- Test: `tests/icegrid-catalogs.test.ts`

- [ ] Write failing catalog-shape tests for:
  - 70 unique quantity units;
  - 69 complete scheme entries, retaining both code `36` entries and both code `56` entries;
  - 44 unique EndUse codes;
  - `NA`, `LUT`, `P` payment statuses;
  - `Yes`, `No` RewardItem values;
  - `Yes`, `No`, `N/A` RODTEP values;
  - no duplicate `(value, parentValue)` keys;
  - no Accessories catalog.
- [ ] Run `bun test tests/icegrid-catalogs.test.ts` and confirm failure because the catalog package does not exist.
- [ ] Define:

  ```ts
  export type IcegridCatalogId =
    | 'unit'
    | 'scheme'
    | 'endUse'
    | 'igstPaymentStatus'
    | 'rewardItem'
    | 'rodtep'
    | 'country'
    | 'fta'
    | 'state'
    | 'district';

  export interface IcegridCatalogOption extends DropdownOption {}

  export interface CatalogProvenance {
    sourceUrl: string;
    retrievedAt: string;
    sha256: string;
    entryCount: number;
  }
  ```

- [ ] Copy the exact approved lists from Appendix A of the design spec. Remove only exact duplicate `RLS` and `FSH700`; preserve all other spelling and punctuation.
- [ ] Freeze exported arrays and expose them only through `catalogs/index.ts`.
- [ ] Run focused tests and `bun run check`.

## Task 2.2: Generate official customs-directory snapshots

**Files:**

- Create: `tools/icegrid/refresh-catalogs.ts`
- Create: `tools/icegrid/sources/README.md`
- Create: `tools/icegrid/sources/icegate-states.html`
- Create: `tools/icegrid/sources/icegate-districts.csv`
- Create: `tools/icegrid/sources/icegate-fta.html`
- Create: `tools/icegrid/sources/icegate-countries.csv`
- Create: `src/lib/modules/icegrid/catalogs/generated/customs-directory.ts`
- Modify: `src/lib/modules/icegrid/catalogs/index.ts`
- Test: `tests/icegrid-catalog-refresh.test.ts`

The source files are saved official exports, not hand-authored production data. Record their URL, retrieval timestamp, and SHA-256 in the generated file. Use:

- `https://www.icegate.gov.in/Webappl/Codes`
- `https://www.icegate.gov.in/Webappl/state_det_all.jsp`
- `https://www.icegate.gov.in/Webappl/Ftp`

- [ ] Write parser tests with small HTML/CSV fixtures that prove:
  - state codes preserve leading zeroes (`08`);
  - district parent `8` normalizes to join state `08`;
  - district value `102` remains `102`;
  - FTA codes preserve exact case;
  - coded entries have display labels;
  - invalid source URL, missing columns, duplicate keys, orphan districts, and empty catalogs fail closed.
- [ ] Run the new test and confirm failure before implementing the parser.
- [ ] Implement the refresh command as a developer-only script. It reads local saved sources, parses/validates them, sorts deterministically, calculates provenance, and writes one generated TypeScript module.
- [ ] Do not fetch from ICEGATE in application code. If the refresh command supports a network download mode, keep it opt-in (`--fetch`) and still write source captures before generation.
- [ ] Require at minimum:
  - non-empty unique countries with two-character codes;
  - the complete state table, including `08`, `09`, `27`, `29`, `33`, `36`, `37`, and `97`;
  - at least one district for every represented parent state in the saved export;
  - the 21 FTA regression codes from Appendix A.5.
- [ ] Add a deterministic `--check` mode that regenerates in memory and fails when the checked-in generated module is stale.
- [ ] Run:

  ```bash
  bun tools/icegrid/refresh-catalogs.ts --check
  bun test tests/icegrid-catalog-refresh.test.ts tests/icegrid-catalogs.test.ts
  bun run check
  ```

## Task 2.3: Implement the exact resolver

**Files:**

- Create: `src/lib/modules/icegrid/catalogs/resolve.ts`
- Modify: `src/lib/modules/icegrid/catalogs/index.ts`
- Test: `tests/icegrid-catalogs.test.ts`

- [ ] Add failing table-driven tests for exact value, exact complete display string, unique exact label, code padding for state joins, and district-parent validation.
- [ ] Add negative tests proving no substring, partial description, misspelling, edit-distance, or nearest-code match occurs.
- [ ] Add scheme tests:
  - `19` resolves to `19-Drawback (DBK)`;
  - the complete canonical value remains unchanged;
  - bare `36` and `56` are ambiguous and unresolved;
  - exact complete `36-MEIS` resolves;
  - an unknown scheme returns `unresolved` with the raw value intact for warning text.
- [ ] Use a discriminated result, never `null` alone:

  ```ts
  export type CatalogResolution =
    | { status: 'resolved'; value: string; option: IcegridCatalogOption }
    | { status: 'unresolved'; raw: string; reason: 'unknown' | 'ambiguous' | 'wrong_parent' };
  ```

- [ ] Implement only trim/collapse-whitespace and case-insensitive exact comparisons. Keep the original canonical stored value.
- [ ] Run focused tests and `bun run check`.

**Manual gate 2:** In a small developer page/test harness, show the full unit, scheme, EndUse, country, state, district, and FTA catalogs. Verify `08 — RAJASTHAN`, state-dependent district lookup, `102 — JAIPUR`, all 21 FTA regression codes, and ambiguous `36`/`56` rejection. No import behavior changes yet.

**Optional authorized commit:** `feat(icegrid): add trusted catalogs and exact resolution`

---

# Layer 3 — Let users extend catalogs without changing trusted built-ins

## Task 3.1: Add the ICEGrid custom-catalog store

**Files:**

- Create: `src/lib/modules/icegrid/catalogs/store.svelte.ts`
- Modify: `src/lib/modules/icegrid/catalogs/index.ts`
- Test: `tests/icegrid-catalog-store.test.ts`

- [ ] Write failing tests for default empty state, localStorage hydration, corrupt-data fallback, exact duplicate rejection, add, delete, reset, and persistence.
- [ ] Use the namespaced versioned key:

  ```ts
  export const LS_ICEGRID_CATALOGS_KEY = 'xlsx-ai:module:icegrid:catalogs:v1';
  ```

- [ ] Persist only custom options, never a copy of built-ins:

  ```ts
  interface IcegridCatalogOverridesV1 {
    version: 1;
    custom: Partial<Record<IcegridCatalogId, IcegridCatalogOption[]>>;
  }
  ```

- [ ] Validate the stored document with Zod before using it. For a custom district require `parentValue`; for coded directories allow a separate label; for scalar catalogs require only `value`.
- [ ] Reject a custom option that duplicates a built-in or another custom option case-insensitively for the same parent.
- [ ] Expose a snapshot method so one import uses one stable catalog set even if Settings changes during the run:

  ```ts
  getSnapshot(): IcegridCatalogSnapshot;
  addCustom(catalogId: IcegridCatalogId, option: IcegridCatalogOption): Result;
  removeCustom(catalogId: IcegridCatalogId, optionKey: string): void;
  resetCustom(catalogId?: IcegridCatalogId): void;
  ```

- [ ] Run focused tests and `bun run check`.

## Task 3.2: Add a generic module-settings slot and ICEGrid settings UI

**Files:**

- Modify: `src/lib/modules/types.ts`
- Modify: `src/lib/components/settings/ModulesSection.svelte`
- Modify: `src/lib/modules/icegrid/index.ts`
- Create: `src/lib/modules/icegrid/IcegridSettings.svelte`
- Test: `tests/modules.test.ts`
- Test: `e2e/table.spec.ts`

- [ ] Add a failing manifest test for an optional, generic settings component:

  ```ts
  import type { Component } from 'svelte';

  interface WorkspaceModule {
    // existing fields unchanged
    settings?: {
      label: string;
      component: Component;
    };
  }
  ```

- [ ] Render the component generically inside the existing module card. Do not import ICEGrid from `ModulesSection.svelte` and do not branch on `mod.id`.
- [ ] Implement `IcegridSettings.svelte` with:
  - a catalog selector;
  - searchable read-only built-ins;
  - custom option add form;
  - delete controls only for custom options;
  - state selection required when adding a district;
  - source URL and retrieved date for official catalogs;
  - “Reset custom values” that does not touch built-ins;
  - clear validation messages for duplicates and missing fields.
- [ ] Do not add hide/rename controls for built-ins in this version.
- [ ] Register the settings component in the ICEGrid manifest and keep enable/disable behavior unchanged.
- [ ] Add UI tests proving built-ins cannot be removed, custom values survive reload, reset removes only customs, and disabling ICEGrid still only controls ribbon availability.
- [ ] Run focused tests, `bun run check`, and the focused Playwright case.

**Manual gate 3:** In Settings → Modules → ICEGrid, add a custom unit, a custom FTA option with label, and a district tied to a state. Reload Settings, verify they remain, delete/reset them, and verify built-ins are untouched. Disable/re-enable ICEGrid and confirm the existing ribbon icon behavior is unchanged.

**Optional authorized commit:** `feat(icegrid): add protected customizable catalogs`

---

# Layer 4 — Correct ICEGrid columns and deterministic mapping

## Task 4.1: Attach catalog dropdowns and correct column metadata

**Files:**

- Modify: `src/lib/modules/icegrid/columns.ts`
- Modify: `src/lib/modules/icegrid/to-table.ts`
- Test: `tests/icegrid-mapping.test.ts`

- [ ] Replace invalid old examples in test data before asserting behavior:
  - `RewardItem: 'Y'` -> `RewardItem: 'Yes'`;
  - `IGST_PaymentStatus: 'NP'` is invalid; use `NA`, `LUT`, or `P`;
  - `ApplicableExpSchemes: 'RODTEP'` -> a complete canonical scheme;
  - `FTACode: 'NONE'` -> a trusted code or `null`;
  - `RODTEP: '1.2%'` -> `Yes`, `No`, or `N/A`;
  - descriptive EndUse text -> a trusted EndUse code.
- [ ] Add failing tests proving the 13 catalog-backed columns are `dropdown`, `Accessories` is not, and `IGST_Rate` is `number` rather than `percent`.
- [ ] Add failing tests proving country/state/district/FTA dropdown labels display descriptions while table rows store only codes.
- [ ] Change `buildIcegridTableColumns` to accept an immutable `IcegridCatalogSnapshot` and attach:
  - the unit catalog to `QuantityUnit`, `SQCUnit`, `PerUnit`, and `dbk_unit`;
  - exact field catalogs to the remaining dropdown columns;
  - `dependsOnColumnId: 'StateOrigin'` to `DistrictOrigin`.
- [ ] Set `allowCustom: true` for ICEGrid dropdowns because user-created values are explicit user input. This permission affects table editing only; it does not allow AI-created options.
- [ ] Correct descriptions to match the approved catalogs and remove examples such as `Y/N`, `NP`, and “rate or code.”
- [ ] Run focused tests and `bun run check`.

## Task 4.2: Make serial/default mapping deterministic and minimal

**Files:**

- Modify: `src/lib/modules/icegrid/to-table.ts`
- Test: `tests/icegrid-mapping.test.ts`
- Test: `tests/icegrid-e2e-workflow.test.ts`

- [ ] Add failing tests for two invoices with multiple rows:

  ```text
  INV-A -> InvoiceSNo 1, ItemSNo 1
  INV-A -> InvoiceSNo 1, ItemSNo 2
  INV-B -> InvoiceSNo 2, ItemSNo 1
  INV-A -> InvoiceSNo 1, ItemSNo 3
  blank -> InvoiceSNo blank, ItemSNo blank
  ```

- [ ] Add assertions that mapping always clears `Accessories`, fills blank `Per` with `1`, and leaves all other absent fields blank.
- [ ] Add explicit negative assertions that mapping does not derive ProductAmount, PerUnit, SQC fields, drawback fields, FTA, region, RODTEP, or RoDTEPQty.
- [ ] Implement a pure `applyMechanicalRules(rows)` before cell mapping. Do not hide defaults in the AI prompt or Svelte component.
- [ ] Ignore AI-supplied `InvoiceSNo`, `ItemSNo`, `Accessories`, and blank `Per`; overwrite them with the documented mechanical results.
- [ ] Preserve source-backed numeric values exactly except for normal numeric parsing; no percent scaling.
- [ ] Pass the stable catalog snapshot into `mapReportToTableData` so the resulting table document retains the options used for that import.
- [ ] Run the focused tests and export the test table through `exportTableToXlsx`; read it back and assert the 37 headers and stored code values.

**Manual gate 4:** Load a synthetic clean report containing two invoices. Verify serial reset, blank Accessories, `Per = 1`, literal IGST rate, dropdown labels, district filtering, stored/exported codes, and that missing calculated/customs fields remain blank.

**Optional authorized commit:** `fix(icegrid): make columns and mechanical mapping exact`

---

# Layer 5 — Require field-level source evidence from the existing Gemini request

## Task 5.1: Separate raw AI extraction from the clean report

**Files:**

- Modify: `src/lib/modules/icegrid/schema.ts`
- Modify: `src/lib/modules/icegrid/extract.ts`
- Test: `tests/icegrid-schema.test.ts`
- Test: `tests/ai.test.ts`

- [ ] Add failing schema tests for valid evidence, unknown field headers, blank quotes, unselected source names, excessive evidence, and final clean reports without evidence.
- [ ] Preserve the Gemini response-schema regression test: no enum may be emitted on a non-string type.
- [ ] Define the header enum with the exact 37 strings and add:

  ```ts
  export const IcegridEvidenceSpanSchema = z.object({
    sourceFile: z.string().min(1).max(200),
    location: z.string().min(1).max(200),
    quote: z.string().min(1).max(1_000),
    fields: z.array(IcegridHeaderSchema).min(1).max(37)
  });

  export const IcegridCandidateRowSchema = IcegridRowSchema.extend({
    evidence: z.array(IcegridEvidenceSpanSchema).max(100)
  });
  ```

- [ ] Use separate types:
  - `IcegridAiExtraction`: Gemini rows plus evidence and warnings;
  - `IcegridAiReport`: server-stamped version/source files plus evidence;
  - `IcegridReport`: clean 37-field rows, version/source files, and warnings.
- [ ] Bump only the internal AI report version if necessary; do not change output workbook format.
- [ ] Keep `reportVersion` and `sourceFiles` out of the Gemini-generated schema and stamp them server-side as today.
- [ ] Update `requestIcegridExtraction` to validate and return `IcegridAiReport`, not the clean report.
- [ ] Run focused tests and `bun run check`.

## Task 5.2: Tighten the server prompt without adding another AI call

**Files:**

- Modify: `src/lib/modules/icegrid/ai.server.ts`
- Test: `tests/ai.test.ts`

- [ ] Add a failing test that captures the generated prompt/schema and asserts these explicit rules are present.
- [ ] Replace the unsafe prompt rules. The system instruction must say:
  - one row per distinct commercial-invoice line;
  - use all selected files only as one evidence set;
  - do not infer customs fields from product descriptions or general knowledge;
  - do not calculate ProductAmount or other missing values;
  - set `Accessories` to `null` and provide no Accessories evidence;
  - set serial fields to `null`; the client assigns them;
  - preserve source wording/numbers as candidate raw values;
  - when a field is non-null, include a short verbatim source span naming that field;
  - if sources conflict or line linkage is ambiguous, leave the affected value `null` and add a warning;
  - do not output currency because there is no currency output column;
  - do not create catalog values or choose a likely catalog option.
- [ ] Keep one `generateObject` call and the existing `context.model`, `context.signal`, request limits, server registry, and `/api/ai` dispatch.
- [ ] Do not embed the complete country/district catalogs in the prompt. Exact normalization is local and deterministic.
- [ ] Run `bun test tests/ai.test.ts tests/icegrid-schema.test.ts` and `bun run check`.

**Manual gate 5:** With a deliberately small source document, inspect the raw development response. Every populated candidate field must point to a selected filename and a visible quote. Accessories and serials must be null. Confirm only one `/api/ai` request occurs.

**Optional authorized commit:** `feat(icegrid): require source evidence in AI extraction`

---

# Layer 6 — Verify evidence, normalize exact values, and fail closed per field

## Task 6.1: Build source-block and value-support verification

**Files:**

- Create: `src/lib/modules/icegrid/evidence.ts`
- Modify if needed: `src/lib/modules/icegrid/readers.ts`
- Test: `tests/icegrid-evidence.test.ts`

- [ ] Add failing tests using a two-file combined extraction for:
  - valid quote in the correct source file;
  - quote present only in a different file;
  - fabricated quote;
  - wrong filename;
  - whitespace/case-normalized text support;
  - formatted numeric support such as `1,250.00` -> `1250`;
  - a field omitted from the evidence span's `fields` list;
  - duplicate filenames handled deterministically or rejected clearly.
- [ ] Expose exact document blocks from `CombinedExtractionResult.documents`; do not reparse `=== FILE` strings when the structured document array already exists.
- [ ] Implement pure helpers:

  ```ts
  normalizeEvidenceText(value: string): string;
  verifyEvidenceSpan(span: IcegridEvidenceSpan, extraction: CombinedExtractionResult): EvidenceCheck;
  quoteSupportsValue(quote: string, rawValue: string | number): boolean;
  ```

- [ ] Text normalization may change Unicode normalization, case, repeated whitespace, and punctuation spacing only. It must not stem words, translate, use synonyms, or perform fuzzy matching.
- [ ] Numeric normalization may remove grouping separators and compare finite numeric tokens. It must not calculate one number from other numbers.
- [ ] Run focused tests and `bun run check`.

## Task 6.2: Sanitize candidate rows

**Files:**

- Create: `src/lib/modules/icegrid/sanitize.ts`
- Modify: `src/lib/modules/icegrid/catalogs/resolve.ts`
- Test: `tests/icegrid-sanitize.test.ts`

- [ ] Add failing tests proving:
  - a supported ordinary field survives;
  - a field without evidence becomes null plus warning;
  - a field with a fabricated quote becomes null;
  - exact `Pcs` evidence normalizes to canonical `PCS`;
  - an unknown UOM becomes null plus warning;
  - an exact country name resolves to its code only when unique;
  - an exact state name resolves to its padded state code;
  - a district with the wrong state becomes null;
  - a complete scheme survives;
  - bare `19` becomes the complete canonical scheme;
  - ambiguous bare `36`/`56` becomes null;
  - user-configured custom values are accepted only with source evidence;
  - Accessories is null regardless of AI output;
  - serials and Per are handled mechanically rather than trusted from AI.
- [ ] Implement:

  ```ts
  interface SanitizationResult {
    report: IcegridReport;
    warnings: string[];
  }

  export function sanitizeIcegridExtraction(
    candidate: IcegridAiReport,
    extraction: CombinedExtractionResult,
    catalogs: IcegridCatalogSnapshot
  ): SanitizationResult;
  ```

- [ ] Process each non-null field independently. One unsupported field must not erase supported siblings or discard the row.
- [ ] Verify evidence before catalog normalization. A catalog match alone is never source evidence.
- [ ] Use field-specific catalogs; do not normalize free-text Description, invoice numbers, HAWB numbers, drawback descriptions, or numeric fields against catalogs.
- [ ] Attach warning codes internally if useful, but return the existing `string[]` public warning contract to avoid host changes.
- [ ] Run focused tests and `bun run check`.

## Task 6.3: Expand deterministic validation without turning gaps into blockers

**Files:**

- Modify: `src/lib/modules/icegrid/validate.ts`
- Test: `tests/icegrid-mapping.test.ts`
- Test: `tests/icegrid-sanitize.test.ts`

- [ ] Add failing tests for catalog validity, district-parent validity, negative numbers, RITC length, ProductAmount mismatch, IGST mismatch, and serial sequence.
- [ ] Keep only structural failures blocking: source mismatch, no rows, malformed report handled earlier.
- [ ] Change missing `ProductAmount` from “required” to a normal review warning only when the source was expected to contain it; do not calculate and fill it.
- [ ] Keep amount tolerances documented and warning-only.
- [ ] Explicitly verify `Accessories === null` after sanitization.
- [ ] Validate RODTEP as `Yes`, `No`, or `N/A`; RewardItem as `Yes` or `No`; IGST status as `NA`, `LUT`, or `P`.
- [ ] Validate all four UOM fields against the same active unit catalog.
- [ ] Validate `ApplicableExpSchemes` against complete canonical values, not numeric code alone.
- [ ] Run focused tests and `bun run check`.

**Manual gate 6:** Feed a synthetic response containing one valid field, one fabricated value, one misspelled catalog value, one wrong-state district, and one ambiguous scheme. Confirm the valid cells survive, invalid cells are blank, warnings explain each blank, and the table still loads.

**Optional authorized commit:** `feat(icegrid): verify evidence and sanitize candidate values`

---

# Layer 7 — Wire the improved pipeline into the module

## Task 7.1: Integrate one stable catalog snapshot per run

**Files:**

- Modify: `src/lib/modules/icegrid/index.ts`
- Modify: `src/lib/modules/icegrid/to-table.ts`
- Modify: `src/lib/modules/icegrid/extract.ts`
- Test: `tests/modules.test.ts`
- Test: `tests/icegrid-e2e-workflow.test.ts`

- [ ] Add a failing workflow test with mocked `ModuleContext.ai.request` that returns candidate rows plus evidence for two source files.
- [ ] Assert exact call count `1`, exact source filenames, successful evidence verification, exact catalog conversion, warning aggregation, and 37-column mapping.
- [ ] Assert a catalog setting changed after the run starts does not affect that in-flight run.
- [ ] In `icegridModule.run`:
  1. capture `catalogStore.getSnapshot()`;
  2. combine files;
  3. request one candidate extraction;
  4. sanitize with evidence and the captured snapshot;
  5. validate the clean report;
  6. map with the same snapshot;
  7. return combined AI, sanitization, and validation warnings.
- [ ] Preserve the current API-key preflight, AbortSignal cancellation, progress updates, module enable/disable behavior, and host-owned `store.loadTable()`.
- [ ] Use concise progress phases: Reading, Extracting, Verifying evidence, Validating, Preparing table.
- [ ] Ensure abort during any phase prevents a late result from replacing the table.
- [ ] Run:

  ```bash
  bun test tests/modules.test.ts tests/icegrid-e2e-workflow.test.ts tests/icegrid-sanitize.test.ts
  bun run check
  ```

## Task 7.2: Make warnings actionable without adding a review dashboard

**Files:**

- Modify only if needed: `src/lib/components/RightRibbon.svelte`
- Modify only if needed: `src/lib/workspace.svelte.ts`
- Test: `tests/modules.test.ts`
- Test: `e2e/table.spec.ts`

- [ ] First inspect how module warnings are currently shown. Reuse the existing notification mechanism.
- [ ] If warnings are currently collapsed into an unusable count, show a concise summary with the first three warnings and the total count. Do not build a new issue panel.
- [ ] Ensure warning text never includes the API key or the full combined document content.
- [ ] Verify a run with warnings still loads the table and a structural blocker does not.
- [ ] Run focused tests and `bun run check`.

**Manual gate 7:** Select multiple real files from the ribbon. Verify one request, progress phases, editable 37-column output, exact dropdown behavior, visible blank cells for unsupported data, useful warnings, cancellation, and module disable/re-enable. Export and reopen the XLSX to verify stored values.

**Optional authorized commit:** `feat(icegrid): integrate verified extraction pipeline`

---

# Layer 8 — Golden regression and final verification

## Task 8.1: Add fixture-backed semantic comparison

**Files:**

- Modify: `tests/icegrid-golden-fixtures.test.ts`
- Modify: `tests/icegrid-e2e-workflow.test.ts`
- Create: `tests/helpers/icegrid-workbook.ts`

- [ ] Add a helper that reads a workbook into ordered headers and normalized rows without mutating the file.
- [ ] For deterministic mapping/sanitization fixtures, compare:
  - exact 37 headers and order;
  - exact row count and row order;
  - invoice numbers, descriptions, quantities, units, unit prices, and explicit amounts;
  - expected blank cells;
  - country/FTA/state/district stored codes;
  - literal IGST rates;
  - source-backed RoDTEP quantities;
  - canonical complete scheme values.
- [ ] Do not call live Gemini in the unit suite. AI quality is manually evaluated against real files; deterministic code is tested with captured candidate responses containing evidence.
- [ ] Record intentional differences from old fixtures in one allowlist containing only:
  - code-only `19` -> `19-Drawback (DBK)`;
  - unsafe old guessed values blanked because they lack evidence;
  - old invalid enum spellings replaced by approved canonical values only when exact evidence exists.
- [ ] Fail the test for any new difference outside that allowlist.
- [ ] Run all ICEGrid and export tests.

## Task 8.2: Final automated verification and cleanup

**Files:**

- Modify: `docs/superpowers/specs/2026-08-29-icegrid-accuracy-catalogs-design.md` only if implementation decisions changed with user approval
- Modify: `AGENT.md` only if its existing module rules require the new generic dropdown/settings contract

- [ ] Search for stale invalid rules and examples:

  ```bash
  rg -n "Accessories.*N|ProductAmount =|FTACode.*NCPTI|RewardItem.*Y/N|IGST.*NP|RODTEP.*rate|RODTEP.*%|FTACode.*NONE|Apparel Manufacturing" src tests docs
  ```

- [ ] Search for prohibited architecture:

  ```bash
  rg -n "fetch\(.*icegate|new Google|createGoogleGenerativeAI|/api/icegrid|reconcil|fuzzy|levenshtein" src/lib/modules/icegrid src/routes
  ```

- [ ] Remove only stale ICEGrid code made redundant by this implementation. Do not refactor unrelated application code.
- [ ] Run fresh verification in this order:

  ```bash
  bun tools/icegrid/refresh-catalogs.ts --check
  bun test tests
  bun run check
  bun run build
  bun run test:e2e
  git diff --check
  git status --short
  ```

- [ ] Report exact test counts, check/build status, any skipped tests, and remaining pre-existing failures. Do not claim success from old output.
- [ ] Review the final diff against every non-negotiable guardrail at the top of this plan.

**Manual gate 8 — final acceptance:**

The user tests at least:

1. one combined PDF;
2. one combined XLSX;
3. invoice + packing XLS files selected together;
4. an input with incomplete customs data;
5. a source containing an unknown UOM;
6. a source whose district conflicts with its state;
7. export and reopen in Excel.

Acceptance requires:

- one request per selection;
- correct row count and line ordering;
- no unsupported populated cells;
- every blank caused by rejection has an actionable warning;
- Accessories blank;
- exact canonical dropdown values;
- full scheme text;
- state/district relationship enforced;
- stored/exported codes rather than display labels;
- existing Settings toggle and ribbon icon still work;
- current table/export features are otherwise unchanged.

**Optional authorized commit:** `test(icegrid): complete catalog and evidence regression coverage`

---

## Expected final file map

```text
src/lib/modules/icegrid/
  ai.server.ts
  columns.ts
  evidence.ts
  extract.ts
  index.ts
  readers.ts
  sanitize.ts
  schema.ts
  to-table.ts
  validate.ts
  IcegridSettings.svelte
  catalogs/
    fixed.ts
    index.ts
    provenance.ts
    resolve.ts
    store.svelte.ts
    types.ts
    generated/
      customs-directory.ts

tools/icegrid/
  refresh-catalogs.ts
  sources/
    README.md
    icegate-countries.csv
    icegate-districts.csv
    icegate-fta.html
    icegate-states.html

tests/
  icegrid-catalog-refresh.test.ts
  icegrid-catalog-store.test.ts
  icegrid-catalogs.test.ts
  icegrid-evidence.test.ts
  icegrid-golden-fixtures.test.ts
  icegrid-sanitize.test.ts
  helpers/icegrid-workbook.ts
  fixtures/icegrid/legacy/**
```

## Explicitly unchanged files/systems unless a named task requires them

- Gemini API key and model settings
- `src/lib/ai/client.ts` public behavior
- central module server registry design
- generic Import action
- table store ownership
- Excel export format and button
- module enable/disable persistence
- right-ribbon module icon manifest contract
- file grouping/history (not added)
