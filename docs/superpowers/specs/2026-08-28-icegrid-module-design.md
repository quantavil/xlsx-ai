# ICEGrid Module Design

**Date:** 2026-08-28
**Status:** Implemented and refined

## 1. Goal

Add a focused ICEGrid import module to `xlsx-ai`. A user selects one or more invoice or packing documents in a single action. The application extracts readable content from every file, combines that content with explicit source boundaries, sends one request to Gemini, validates the returned JSON report, maps the report to the fixed 37-column ICEGrid format, and loads the result into the existing table. The current Excel export then downloads the reviewed table.

The implementation must be delivered layer by layer. After each layer, the user must be able to run a defined manual check before implementation continues.

## 2. Scope

### Included

- Select multiple `.pdf`, `.xls`, and `.xlsx` files in one browser file picker action.
- Extract searchable PDF text and spreadsheet cell data locally.
- Preserve file, page, and sheet boundaries in the combined AI input.
- Make one Gemini structured-output request for the whole selected set.
- Validate the AI response as one clean JSON report.
- Map the validated rows to the exact 37 output columns found in the provided output workbooks.
- Load the mapped result into the existing `TableData` store and table UI.
- Reuse the current Gemini key/model settings and the current Excel export.
- Register ICEGrid as a host-controlled workspace module that can be enabled or disabled in Settings.
- Show a dedicated ICEGrid action in the right ribbon only while the module is enabled.
- Add focused automated tests and a manual acceptance checkpoint for every layer.

### Excluded

- A file-grouping interface, saved groups, queues, jobs, or batch history.
- A separate invoice/packing reconciliation engine. Gemini receives all selected documents together and produces the combined rows.
- Customs, tariff, drawback, exchange-rate, or ICEGATE network lookups.
- A replacement grid, review dashboard, issue-management system, or legacy ICEGrid UI.
- A new workbook engine, custom workbook styling, or a second export button.
- AI editing after import, table-data persistence changes, authentication, cloud storage, or unrelated refactoring.
- Runtime-downloaded plugins, remote code execution, a plugin marketplace, or third-party module installation.

## 3. Module boundary

The application gets a small build-time module standard:

```text
src/lib/modules/
  types.ts
  registry.ts
  module-store.svelte.ts
  icegrid/
    index.ts
    columns.ts
    readers.ts
    extract.ts
    ai.server.ts
    schema.ts
    validate.ts
    to-table.ts

src/lib/server/modules/
  types.ts
  registry.ts

src/lib/ai/
  client.ts

src/lib/components/settings/
  ModulesSection.svelte
```

`types.ts` defines the host contract, `registry.ts` statically registers built-in modules, and `module-store.svelte.ts` owns enablement and active-run cancellation. This is not a dynamic plugin loader: modules ship in the application bundle and are only activated or deactivated at runtime.

ICEGrid exposes its browser-facing API through `$lib/modules/icegrid`. A separate static server registry imports `ai.server.ts`, so browser code never bundles server handlers and the central AI route does not import ICEGrid prompts or schemas.

Integration outside the module is limited to:

1. `+page.svelte` creates one module store and passes it to Settings and the ribbon.
2. `SettingsModal.svelte` adds a **Modules** tab that renders `ModulesSection.svelte`.
3. `RightRibbon.svelte` renders enabled module actions from the registry.
4. The existing `src/routes/api/ai/+server.ts` accepts a generic trusted-module request and dispatches it through the server registry.
5. `AGENT.md` records the module rules so future extensions follow the same contract.

No second AI endpoint, provider, API-key store, model selector, table store, or export path is created. A shared client wrapper centralizes calls to the existing `/api/ai` endpoint for both core UI and workspace modules.

## 4. Libraries and module contract

### Libraries

Reuse the versions already resolved in `bun.lock`:

- `xlsx@0.20.3` for `.xls` and `.xlsx` parsing;
- `ai@4.3.19` and `@ai-sdk/google@1.2.22` for the existing Gemini service;
- `zod@3.25.76` for request and structured-output validation;
- Svelte 5 runes for reactive module enablement;
- browser `File`, `ArrayBuffer`, `AbortController`, and `localStorage` APIs.

Add one pinned runtime dependency: `pdfjs-dist@6.1.200`. Use its display-layer `getDocument`, `getPage`, and `getTextContent` APIs. Vite loads `pdf.worker.mjs` through a `?url` import assigned to `GlobalWorkerOptions.workerSrc`. No PDF viewer or canvas renderer is included.

Do not upgrade the existing AI SDK or Zod as part of this work. AI SDK 4 uses the current Zod 3 schema format and the existing `/api/ai` implementation already proves that combination.

### Host module contract

Every built-in workspace module implements:

```ts
interface WorkspaceModule {
  id: string;
  name: string;
  description: string;
  version: string;
  defaultEnabled: boolean;
  requirements: { gemini: boolean };
  ribbon: {
    label: string;
    icon: IconName;
    fileInput: {
      accept: string;
      multiple: boolean;
    };
  };
  run(files: File[], context: ModuleContext): Promise<ModuleResult>;
}

interface ModuleContext {
  ai: {
    readonly apiKey: string;
    readonly modelId: string;
    request<T>(payload: unknown): Promise<T>;
    requestStream(payload: unknown): Promise<Response>;
  };
  signal: AbortSignal;
  onProgress(message: string): void;
}

interface ModuleResult {
  table: TableData;
  warnings: string[];
}
```

Standard rules:

- `registry.ts` is the only place that registers modules.
- A registry entry is statically imported and bundled; enabling a module never downloads or executes new code.
- A module receives the full existing AI capability through `ModuleContext`, including the active key/model and JSON/streaming requests. It does not import the table store, Settings state, or toast state.
- Every module declares its required ribbon label, icon, and file-picker behavior in its manifest. The ribbon contains no module-ID conditionals.
- Server AI handlers are statically registered by module ID and action. They receive the authenticated Gemini model and may use the installed AI SDK's `generateObject`, `generateText`, or `streamText` APIs.
- A module returns data and warnings; the host decides when to notify and call `store.loadTable()`.
- The host starts one `AbortController` per run. Disabling a running module aborts the operation and prevents its result from replacing the table.
- Module IDs and storage keys are stable and namespaced. ICEGrid uses the ID `icegrid`.
- Modules cannot change another module's settings or import another module's internals.
- Every module must provide unit tests for its manifest, input contract, cancellation behavior, and returned `TableData`.

### Enablement and ribbon behavior

`module-store.svelte.ts` persists a versioned enablement map under `xlsx-ai:modules:v1`. Corrupt or unavailable storage falls back to each manifest's `defaultEnabled` value. ICEGrid is enabled by default and can be disabled immediately from Settings.

`+page.svelte` creates one module store beside the existing table store. It passes the same instance to `SettingsModal` and `RightRibbon`, keeping enablement, cancellation, and action visibility synchronized. The module store does not become part of the table store and does not alter table persistence.

The **Modules** Settings tab lists the manifest name, version, description, supported file types, Gemini requirement, and an accessible enable/disable switch. The setting takes effect without reloading the page.

When ICEGrid is enabled, `RightRibbon.svelte` shows one dedicated `layers` icon with the label **ICEGrid Documents**. Clicking it opens the module action's hidden file input with `accept=".pdf,.xls,.xlsx"` and `multiple=true`. The existing generic Import button remains unchanged.

When ICEGrid is disabled, its ribbon action disappears. If a run is active, the store aborts it, ignores any late result, and preserves the current table. Re-enabling restores the action but does not restore old files or results.

`AGENT.md` gains a concise **Workspace Module Rules** section covering registry-only installation, namespaced IDs/storage, manifest requirements, no deep cross-module imports, host-owned table mutation, cancellation, Settings/ribbon behavior, and required tests. This is the durable extension standard for later coding agents.

## 5. End-to-end flow

```text
File[]
  -> validate supported files
  -> extract each file locally
  -> combine sections with source boundaries
  -> send one registered module request to /api/ai
  -> parse the response with the report schema
  -> run deterministic validation
  -> map canonical row fields to TableData
  -> store.loadTable(table)
  -> review in the existing table
  -> use the existing Excel export
```

The input files are one document set because they were selected together. There is no additional grouping or pairing step.

## 6. File reading and combination

### Supported input

- PDF: `.pdf`
- Modern Excel: `.xlsx`
- Legacy Excel: `.xls`

The reader rejects empty files, unsupported extensions, and files over the current 10 MiB per-file import limit. The combined extracted request must fit the API endpoint's request-body limit. If it does not fit, processing stops with a clear error; content must never be silently truncated.

### Spreadsheet extraction

Reuse the installed SheetJS package. Read every non-empty worksheet, preserving displayed cell values. Convert each sheet to a compact tab-separated text matrix. Empty trailing rows and columns may be removed, but non-empty cells must not be discarded.

### PDF extraction

Add `pdfjs-dist` as the only new runtime dependency required by the module. Extract text page by page. If a PDF has no meaningful searchable text, reject it with an instruction to use a searchable PDF or spreadsheet source. OCR is not included.

### Combined document format

The reader produces deterministic text with explicit boundaries:

```text
=== FILE: invoice.xlsx ===
=== SHEET: Invoice ===
...

=== FILE: packing-list.pdf ===
=== PAGE: 1 ===
...
```

Files retain the browser selection order. Sheets and pages retain source order. The combined text contains no invented interpretation; it is only a readable representation of source content.

## 7. Fixed columns and clean JSON report

`columns.ts` defines the exact output order and canonical field mapping for these 37 headers:

```text
InvoiceSNo, ItemSNo, InvoiceNo, Description, EndUse, HAWBL_No,
Total_Package, Accessories, RewardItem, IGST_PaymentStatus, RITCCode,
ApplicableExpSchemes, Quantity, QuantityUnit, SQCQTY, SQCUnit,
UnitPrice, ProductAmount, Per, PerUnit, drawback_schno, dbk_qty,
dbk_rate, dbk_unit, dbk_desc, ROSLRate, ROSLCapValue,
CountryDestination, FTACode, StateOrigin, DistrictOrigin, Taxable_Value,
IGST_Rate, IGST_Amount, GSTCCessAmount, RODTEP, RoDTEPQty
```

Header spelling and order are fixed by the supplied output workbooks. The module uses stable camel-case field IDs internally and maps them to these headers at the table boundary.

Gemini returns one report:

```ts
interface IcegridReport {
  reportVersion: 1;
  sourceFiles: string[];
  rows: IcegridRow[];
  warnings: string[];
}
```

`IcegridRow` contains one property for every fixed column. Numeric fields are numbers or `null`; text fields are strings or `null`. The prompt requires `null` when a value cannot be supported by the selected documents. Gemini must not invent missing document facts.

Safe mechanical defaults may be applied only when listed in `columns.ts`. All defaults must be visible and testable there; they must not be hidden in prompts or UI code.

## 8. Gemini extraction

`extract.ts` builds the extraction request from:

- selected source file names;
- combined boundary-preserving document text;
- the fixed column definitions;
- concise rules for numeric types, serial numbering, missing values, and output JSON.

`extract.ts` calls the existing `/api/ai` route with the same headers already used by `xlsx-ai`:

```text
x-ai-api-key: current store API key
x-ai-model-id: current store model ID
```

The module request envelope is:

```ts
{
  operation: {
    kind: 'module',
    moduleId: 'icegrid',
    action: 'extract'
  },
  input: {
    sourceFiles: string[];
    content: string;
  }
}
```

The existing `_RequestSchema` accepts the generic module envelope while current table/chat operations retain their existing `tableContext` contract. The static server registry validates each action's `input` using its own Zod schema before execution, and the module branch runs before general table prompt construction.

The branch reuses `_isSupportedModelId`, `createGoogleGenerativeAI`, the current API-key and model headers, the existing 1 MiB byte limit, and the current provider error mapping. The registered ICEGrid handler calls the already-installed `generateObject` with its own Zod report schema and makes one model call per import action. `input.sourceFiles` is capped at 20 names and `content` at 750,000 characters so the JSON envelope remains below the route limit. Oversized content fails before the Gemini call and is never silently truncated.

The route returns controlled errors for an invalid key, unsupported model, oversized payload, rate limiting, malformed model output, and provider failure. It does not log document text or the API key. Existing fill, clean, summarize, and Q&A behavior and request shapes remain unchanged.

## 9. Validation

Validation has two levels.

### Structural validation

The Zod report schema verifies:

- report version;
- source-file list;
- at least one output row;
- all 37 canonical fields on every row;
- nullable string/number types;
- bounded row and warning counts.

Structural failure stops the import and leaves the existing table unchanged.

### Deterministic row validation

Pure validation checks:

- positive sequential `InvoiceSNo` and `ItemSNo` values;
- required invoice number, description, quantity, unit, and price fields;
- non-negative quantities, prices, amounts, rates, and tax values;
- eight-digit RITC codes when present;
- `ProductAmount` against `Quantity * UnitPrice` within a small currency tolerance;
- `IGST_Amount` against `Taxable_Value * IGST_Rate / 100` when those values are present;
- source filenames in the report against the selected filenames.

Validation does not perform customs-law enrichment. Blocking issues stop the table replacement. Non-blocking warnings allow the table to load and are summarized in the existing notification system. The pipeline returns issues in its result so a richer review UI can be added later without changing the core contract.

## 10. Existing-table mapping and export

`to-table.ts` converts validated rows to the application's existing `TableData` shape:

- title comes from the primary invoice number when present, otherwise `ICEGrid Import`;
- columns use the exact 37 headers and appropriate existing table column types;
- row IDs are deterministic within the import;
- `null` remains an empty editable cell;
- numeric values remain numbers.

The UI calls `store.loadTable()` only after the whole pipeline succeeds. A failure must not partially replace the user's current table.

The current Excel export is reused. Because the table already has the exact headers and order, it produces the required single-sheet workbook without a second compiler.

## 11. Layered delivery and manual gates

Implementation stops after each layer for user testing.

### Layer 1: Module host, Settings, and ribbon

- Add the module types, static registry, and enablement store.
- Register the ICEGrid manifest with `defaultEnabled: true`.
- Add the Modules Settings tab and dedicated enabled-only ribbon action.
- Add cancellation and late-result protection, but do not read files yet.

Manual gate: disable ICEGrid and confirm its ribbon icon disappears; enable it and confirm the icon returns immediately; reload and confirm the setting persists; verify the existing generic Import and AI buttons behave exactly as before.

### Layer 2: Multi-file reading

- Add fixed columns and file readers.
- Select multiple supported files through the ICEGrid action.
- Extract and combine their content.
- Report file, sheet/page, and character counts without calling AI or changing the table.

Manual gate: select combined and split examples from the input/output folder; confirm every selected filename and expected sheet/page appears and scanned/empty sources fail clearly.

### Layer 3: Clean AI report through the existing AI service

- Add the report schema and prompt.
- Register the ICEGrid `extract` action with the existing `/api/ai` module dispatcher and call its existing Gemini provider.
- Parse and return the clean JSON report.
- Do not map it into the table yet.

Manual gate: run several document sets and inspect the returned row count, invoice numbers, descriptions, quantities, prices, and source filenames. Confirm the currently selected Gemini model is used, invalid keys and malformed results produce clear errors, and existing AI chat/clean/fill operations still work.

### Layer 4: Validation and table mapping

- Add deterministic validation and `TableData` mapping.
- Load the table atomically after success.
- Summarize warnings through the current notification mechanism.

Manual gate: import representative XLS, XLSX, PDF, and mixed-file sets; confirm the table always has exactly 37 columns in the required order and that invalid data does not silently replace the current table.

### Layer 5: Output accuracy

- Reuse the current Excel export.
- Add fixture-driven comparisons against the supplied input/output examples.
- Tune only the extraction prompt, schema descriptions, deterministic defaults, and mapping rules needed for observed accuracy.

Manual gate: process the agreed fixture cases, export each workbook, and compare headers, row counts, key values, and calculations with the corresponding output workbook.

## 12. Testing strategy

Keep tests focused on the pipeline:

- registry rejects duplicate module IDs and exposes one ICEGrid manifest;
- module enablement defaults, persistence, corrupt-storage fallback, cancellation, and late-result suppression work;
- ribbon visibility follows enablement while generic Import remains available;
- column catalog has exactly 37 unique headers in the required order;
- XLS/XLSX readers preserve non-empty sheets and cells;
- PDF reader preserves page boundaries and rejects image-only content;
- combined text preserves every selected filename in order;
- report schema accepts valid nullable rows and rejects missing/wrong fields;
- validators catch required-field, numeric, RITC, and calculation errors;
- mapping produces exact `TableData` headers, types, order, and values;
- orchestrator does not mutate the current table on failure;
- the existing AI endpoint accepts registered module operations, rejects unknown modules/actions and invalid authentication, models, payloads, and model output, and preserves all previous request variants;
- recorded AI JSON supports deterministic tests without network calls;
- representative provided outputs establish expected headers, row counts, and values.

Live Gemini calls remain manual acceptance tests so automated tests are deterministic and do not consume API quota.

## 13. Completion criteria

The module is complete when:

1. ICEGrid can be enabled and disabled from the Modules Settings tab.
2. Its dedicated ribbon icon appears only while enabled, and the setting survives reload.
3. A user can select multiple supported files in one action.
4. Content from every file is included in one boundary-preserving ICEGrid module request to the existing `/api/ai` service.
5. The existing Gemini key, selected model, provider setup, and error handling are reused.
6. Gemini returns one schema-validated clean JSON report.
7. Deterministic blocking validation runs before table replacement.
8. Successful output fills the current table with exactly 37 ordered columns.
9. The existing Excel export downloads the reviewed data.
10. Representative input/output fixtures pass automated checks and manual comparison.
11. Existing generic import, table editing, AI assistant, and export behavior continue to work.
