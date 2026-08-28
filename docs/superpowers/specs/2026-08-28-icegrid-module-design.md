# ICEGrid Module Design

**Date:** 2026-08-28
**Status:** Approved for implementation planning

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
- Add focused automated tests and a manual acceptance checkpoint for every layer.

### Excluded

- A file-grouping interface, saved groups, queues, jobs, or batch history.
- A separate invoice/packing reconciliation engine. Gemini receives all selected documents together and produces the combined rows.
- Customs, tariff, drawback, exchange-rate, or ICEGATE network lookups.
- A replacement grid, review dashboard, issue-management system, or legacy ICEGrid UI.
- A new workbook engine, custom workbook styling, or a second export button.
- AI editing after import, persistence changes, authentication, cloud storage, or unrelated refactoring.

## 3. Module boundary

All reusable ICEGrid logic lives under:

```text
src/lib/modules/icegrid/
  index.ts
  columns.ts
  read-files.ts
  extract.ts
  schema.ts
  validate.ts
  to-table.ts
```

`index.ts` is the browser-facing public entry point. Code outside the module imports only from `$lib/modules/icegrid`, not from its internal files.

Two small integration changes are permitted outside this directory:

1. `src/lib/components/RightRibbon.svelte` gets one ICEGrid document-import action and a hidden `multiple` file input.
2. `src/routes/api/icegrid/+server.ts` is a thin Gemini endpoint. It validates the request, calls Gemini with structured output, and returns JSON. Column definitions, prompt construction, response schema, mapping, and business validation stay in the module.

This separate endpoint avoids coupling ICEGrid extraction into the existing general table-assistant route.

## 4. End-to-end flow

```text
File[]
  -> validate supported files
  -> extract each file locally
  -> combine sections with source boundaries
  -> send one structured request to /api/icegrid
  -> parse the response with the report schema
  -> run deterministic validation
  -> map canonical row fields to TableData
  -> store.loadTable(table)
  -> review in the existing table
  -> use the existing Excel export
```

The input files are one document set because they were selected together. There is no additional grouping or pairing step.

## 5. File reading and combination

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

## 6. Fixed columns and clean JSON report

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

## 7. Gemini extraction

`extract.ts` builds the extraction request from:

- selected source file names;
- combined boundary-preserving document text;
- the fixed column definitions;
- concise rules for numeric types, serial numbering, missing values, and output JSON.

The browser sends the current Gemini API key and selected model using the same headers already used by the application. The dedicated endpoint uses the existing AI SDK packages and `generateObject` with the ICEGrid report schema. It makes one model call per import action.

The endpoint returns controlled errors for an invalid key, unsupported model, oversized payload, rate limiting, malformed model output, and provider failure. It does not log document text or the API key.

## 8. Validation

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

## 9. Existing-table mapping and export

`to-table.ts` converts validated rows to the application's existing `TableData` shape:

- title comes from the primary invoice number when present, otherwise `ICEGrid Import`;
- columns use the exact 37 headers and appropriate existing table column types;
- row IDs are deterministic within the import;
- `null` remains an empty editable cell;
- numeric values remain numbers.

The UI calls `store.loadTable()` only after the whole pipeline succeeds. A failure must not partially replace the user's current table.

The current Excel export is reused. Because the table already has the exact headers and order, it produces the required single-sheet workbook without a second compiler.

## 10. Layered delivery and manual gates

Implementation stops after each layer for user testing.

### Layer 1: Multi-file reading

- Add fixed columns and file readers.
- Select multiple supported files through the ICEGrid action.
- Extract and combine their content.
- Report file, sheet/page, and character counts without calling AI or changing the table.

Manual gate: select combined and split examples from the input/output folder; confirm every selected filename and expected sheet/page appears and scanned/empty sources fail clearly.

### Layer 2: Clean AI report

- Add the report schema, prompt, dedicated endpoint, and one Gemini request.
- Parse and return the clean JSON report.
- Do not map it into the table yet.

Manual gate: run several document sets and inspect the returned row count, invoice numbers, descriptions, quantities, prices, and source filenames. Confirm invalid keys and malformed results produce clear errors.

### Layer 3: Validation and table mapping

- Add deterministic validation and `TableData` mapping.
- Load the table atomically after success.
- Summarize warnings through the current notification mechanism.

Manual gate: import representative XLS, XLSX, PDF, and mixed-file sets; confirm the table always has exactly 37 columns in the required order and that invalid data does not silently replace the current table.

### Layer 4: Output accuracy

- Reuse the current Excel export.
- Add fixture-driven comparisons against the supplied input/output examples.
- Tune only the extraction prompt, schema descriptions, deterministic defaults, and mapping rules needed for observed accuracy.

Manual gate: process the agreed fixture cases, export each workbook, and compare headers, row counts, key values, and calculations with the corresponding output workbook.

## 11. Testing strategy

Keep tests focused on the pipeline:

- column catalog has exactly 37 unique headers in the required order;
- XLS/XLSX readers preserve non-empty sheets and cells;
- PDF reader preserves page boundaries and rejects image-only content;
- combined text preserves every selected filename in order;
- report schema accepts valid nullable rows and rejects missing/wrong fields;
- validators catch required-field, numeric, RITC, and calculation errors;
- mapping produces exact `TableData` headers, types, order, and values;
- orchestrator does not mutate the current table on failure;
- endpoint rejects invalid authentication, models, payloads, and model output;
- recorded AI JSON supports deterministic tests without network calls;
- representative provided outputs establish expected headers, row counts, and values.

Live Gemini calls remain manual acceptance tests so automated tests are deterministic and do not consume API quota.

## 12. Completion criteria

The module is complete when:

1. A user can select multiple supported files in one action.
2. Content from every file is included in one boundary-preserving AI request.
3. Gemini returns one schema-validated clean JSON report.
4. Deterministic blocking validation runs before table replacement.
5. Successful output fills the current table with exactly 37 ordered columns.
6. The existing Excel export downloads the reviewed data.
7. Representative input/output fixtures pass automated checks and manual comparison.
8. Existing generic import, table editing, AI assistant, and export behavior continue to work.
