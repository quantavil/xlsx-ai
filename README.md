# xlsx-ai — Fast, Modern AI Spreadsheet Workspace

**xlsx-ai** is a high-performance, Zen-brutalist spreadsheet and data workspace application built with **SvelteKit 2**, **Svelte 5 Runes**, **Bun**, **TypeScript**, **SheetJS CE (`xlsx`)**, and official **Google Gemini** generative models (`gemini-3.7-flash-lite` default, `gemini-3.7-flash`, `gemini-3.1-pro-preview`).

---

## Key Features

- **Svelte 5 Runes Reactivity**: State management powered by `$state`, `$derived`, and `$props` for low-latency table updates, search filtering, and sorting.
- **Multi-File Workspace**: A **Files** menu in the header holds every file — imported spreadsheets, new blank files, and tables produced by AI modules such as ICEGrid. Each file gets its own storage slot, so switching never overwrites another. Provenance is not tracked: once a file is in the workspace it is just a file.
- **Excel-Grade Active Cell Navigation**: Roving tabindex (`tabindex="0"` on active cell, `-1` on others) with arrow-key hopping (`↑`, `↓`, `←`, `→`), `Tab` column cycling, `Delete` clearing, and direct typing/`F2` inline edit activation.
- **Range Selection & Cell Alignment**: Shift-click or shift-arrow to select a rectangle, then set **left / center / right** alignment from the header control or `Ctrl+Shift+L/E/R`. Defaults follow Excel (numbers right, everything else left); overrides are per-cell, undoable, and saved with the document. `Delete` clears the whole range and `Ctrl+C` copies it as TSV. Alignment is carried into `.xlsx` export.
- **Interactive Column Resizing & Auto-Fit**: Draggable right-edge resize handles (`.th-resize-handle`) on every column header with double-click content auto-fit.
- **Accessible Floating Status Dropdowns**: Boundary-colliding, viewport-flipping status combobox with search, custom status creation, and single-click chevron trigger outside scroll overflow.
- **Typed Column System**: First-class support for `text`, `number`, `currency`, `percent`, `dropdown`, and `date` with type-aware inline cell editors and centralized normalization (`src/lib/cells.ts`).
- **Live Summary Calculations**: Pinned footer calculates real-time `SUM`, `AVG`, `MIN`, `MAX`, and `COUNT` metrics using plain JavaScript `reduce` directly on `filteredRows`.
- **SheetJS Client File I/O & Dynamic Chunking**:
  - **Import**: Drag & drop or upload `.xlsx`, `.xls`, `.csv`, and `.tsv` files with automatic column header deduplication, size limits (10 MB / 10k rows / 100 cols), and type inference heuristics.
  - **Export**: One-click export to native Excel Workbooks (`.xlsx`, via `write-excel-file`) or CSV files (`.csv`) with automatic formula injection escaping (`=`, `+`, `-`, `@`, `\t`, `\r`) and unique header disambiguation. Exported workbooks keep per-cell alignment, column widths, a bold header row, and real Excel number formats for `number` / `currency` / `percent` columns.
- **Google Gemini AI Assistant**:
  - **AI Grounding**: Contextually grounds the LLM on your active table schema, summary metrics, and data rows.
  - **Structured Data Operations (`generateObject`)**:
    - 🪄 **Fill Missing**: Identifies missing/null cells and predicts values based on data patterns.
    - 🧹 **Clean Data**: Normalizes inconsistent formats, trims whitespace, and fixes typos.
    - 🔍 **Interactive Diff Preview**: Review proposed cell mutations before clicking **Apply** or **Discard** with stale patch conflict detection.
  - **Streaming Data Q&A**: Real-time natural language answers, dataset trends, and executive summaries.
- **Zen-Brutalist Design System & Accessibility**:
  - Clean borders, tight radius tokens (0–8px), subtle elevation, and responsive layouts across desktop, tablet, and mobile.
  - Keyboard navigation (`ArrowUp`/`ArrowDown`, `Home`/`End`, `Escape`) and instant actions for column deletion and document replacement with undo (`Ctrl+Z`) — no confirmation modals.
  - Settings is a route (`/settings`) with a three-item section rail — AI & Models, Modules, Shortcuts — not a floating modal.
  - Seamless **Dark** & **Light** themes with FOUC prevention and explicit `color-scheme` support.
  - 30-entry undo/redo history stack (`Ctrl+Z` / `Ctrl+Y`) and robust debounced auto-saving to `localStorage` with unload flush.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `↑` / `↓` / `←` / `→` | Navigate active cell box (Excel-style) |
| `Enter` / `F2` | Start editing cell / commit & move down |
| `Shift` + arrows / `Shift` + click | Extend the selection into a range |
| `Delete` / `Backspace` | Clear the selection |
| `Ctrl + C` / `Cmd + C` | Copy the selection as TSV |
| `Ctrl + Shift + L` / `E` / `R` | Align selection left / center / right |
| `Tab` / `Shift + Tab` | Navigate and edit cells horizontally |
| `Ctrl + K` / `Cmd + K` | Focus instant search bar |
| `Ctrl + N` / `Cmd + N` | Add new row |
| `Ctrl + Z` / `Cmd + Z` | Undo last table edit |
| `Ctrl + Y` / `Cmd + Shift + Z` | Redo table edit |
| `Ctrl + /` / `Cmd + /` | Toggle AI Assistant drawer |
| `Ctrl + ,` / `Cmd + ,` | Open Settings |
| `Escape` | Cancel active cell edit / close panel or menu |

---

## Quick Start

### 1. Install Dependencies
```bash
bun install
```

### 2. Start Development Server
```bash
bun run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## ICEGrid Module — ICEGATE 37-Column Extraction

`src/lib/modules/icegrid/` turns a multi-file selection of commercial invoices and
packing lists (`.pdf`, `.xls`, `.xlsx`) into the fixed 37-column ICEGATE shipping-bill
format, using one Gemini request for the whole selection.

### Pipeline

```
combineDocumentSources(files)     local PDF/XLS text extraction, boundary-preserving
  -> requestIcegridExtraction()   ONE /api/ai request, candidate rows + evidence spans
  -> sanitizeIcegridExtraction()  verify every quote against the extracted file text
  -> deriveRows()                 schedule lookups, formulas, shipment profile
  -> validateIcegridReport()      deterministic checks, warnings not blockers
  -> mapReportToTableData()       the existing table + Excel export
```

### The four provenances

A cell is populated only if one of these can answer *"where did this come from?"*:

| Provenance | Guarantee |
| :--- | :--- |
| **Extracted** | The model returned a verbatim source quote; the quote is confirmed to exist in that file, to name that field, and to contain the value. A fabricated quote loses the field. |
| **Schedule** | A lookup keyed by the 8-digit RITC in a bundled snapshot of a published customs schedule, cited with its notification number and effective date. |
| **Derived** | A formula over fields already established, confirmed against every row of the reference corpus. Never overwrites an extracted value. |
| **Profile** | The exporter typed it once in Settings → Modules → ICEGrid. |

Precedence is **extracted > schedule > derived > profile**. Nothing overwrites a value a
document supported. Every run opens its warnings with a count per provenance.

Bundled schedules (`catalogs/generated/schedules.ts`, never fetched at runtime):

- **Duty Drawback All Industry Rates** — Notification No. 77/2023-Customs (N.T.), effective 2023-10-30, 2,209 serials.
- **RoDTEP Appendix 4R** — Notification No. 32 dated 30.09.2024, effective 2024-10-10, 8,563 tariff items.

Both are **dated snapshots and change by notification**. The UI shows the effective date;
verify against the current notification before filing.

### Column fill rates

Measured by replaying the finished pipeline against the 17-shipment reference corpus and
comparing every cell to the trusted output — **8,513 of 10,249 cells match (83.1%)**.
Supplying an RITC for every line raises this to **88.8%**; see `RITCCode` below.

| # | Column | Source | Fill | Why not 100% |
| ---: | :--- | :--- | ---: | :--- |
| 1 | `InvoiceSNo` | derived | 100% | — |
| 2 | `ItemSNo` | derived | 100% | — |
| 3 | `InvoiceNo` | extracted | 100% | — |
| 4 | `Description` | extracted | **6%** | The item name extracts correctly, but trusted output prepends an exporter house-style goods-class phrase (`OTHER FURNITURE ARTICLES OF IRON ARTWARE - …`). It is not the tariff text — the drawback schedule says `Others`, RoDTEP says `Other` — so composing it would mean inventing customs wording. |
| 5 | `EndUse` | profile | 100% | — |
| 6 | `HAWBL_No` | — | 100% | **Always blank in trusted output.** No AWB or B/L number appears in any of the 34 input files. |
| 7 | `Total_Package` | extracted | 100% | **Blank in all 277 trusted rows**, yet every packing list states a carton or pallet count. The module now extracts it — a deliberate improvement on the legacy output, so expect a difference here. |
| 8 | `Accessories` | — | 100% | **Always blank by rule.** Never populated on import and deliberately not offered as a dropdown. |
| 9 | `RewardItem` | profile | 95% | Held per shipment; one case varies it across lines (6 rows `No`, the rest `Yes`), which a single profile value cannot express. |
| 10 | `IGST_PaymentStatus` | profile / extracted | 100% | — |
| 11 | `RITCCode` | extracted | **41%** | Only 11 of 17 invoices print an HSN code. It is per-line, so no profile can supply it — and it **gates `SQCUnit`, `drawback_schno`, `dbk_rate` and `RODTEP`**. A saved product→HSN mapping is the single highest-value addition left. |
| 12 | `ApplicableExpSchemes` | profile | 92% | Per-shipment value; one case mixes two schemes across its lines. |
| 13 | `Quantity` | extracted | 100% | — |
| 14 | `QuantityUnit` | extracted | 90% | Not printed on every line, or printed in a spelling outside the 70-code catalog, which is rejected rather than guessed. |
| 15 | `SQCQTY` | extracted / derived | 91% | Needs the packing-list net weight when the tariff counts in KGS; 5 cases ship no weight. |
| 16 | `SQCUnit` | schedule | **41%** | Gated by `RITCCode`. Where the code is present the RoDTEP `UQC` column resolves it **20/20 exactly**. |
| 17 | `UnitPrice` | extracted | 98% | 5 rows carry a rate back-computed to more precision than the invoice prints. |
| 18 | `ProductAmount` | extracted | 89% | Some invoices print only a grouped total. Never computed from `Quantity × UnitPrice` — that mismatch is reported as a warning instead. |
| 19 | `Per` | derived | 100% | — |
| 20 | `PerUnit` | derived | 90% | Copies `QuantityUnit`, so it inherits that column's gaps. |
| 21 | `drawback_schno` | schedule | **43%** | Gated by `RITCCode`. Where present, resolves **13/13 exactly**. The `B` suffix is the schedule's column B, *"drawback when Cenvat facility has been availed"*. |
| 22 | `dbk_qty` | derived | 90% | Copies `Quantity` wherever it exists; 23 trusted rows leave it blank because no drawback is claimed on that line. |
| 23 | `dbk_rate` | schedule | **43%** | Gated by `RITCCode`. Where present, resolves **13/13 exactly**. |
| 24 | `dbk_unit` | derived | 79% | Copies `QuantityUnit`; 28 trusted rows leave it blank on lines with no drawback claim. |
| 25 | `dbk_desc` | — | 77% | **Deliberately not filled.** The drawback PDF's description column bleeds across entries when parsed, and the field is blank in 212 of 277 trusted rows — a bad parse would cost more than a blank. |
| 26 | `ROSLRate` | — | 71% | The RoSCTL schedule is not bundled. Trusted output writes a literal `0` in 81 rows; the module leaves them blank rather than assert an unsourced zero. |
| 27 | `ROSLCapValue` | — | 100% | **Always blank in trusted output.** |
| 28 | `CountryDestination` | extracted | 97% | 7 rows where the destination is implied by the consignee address rather than named, so it stays blank. |
| 29 | `FTACode` | profile | 100% | — |
| 30 | `StateOrigin` | derived | 100% | First two digits of the exporter's GSTIN — correct in **17/17** shipments. |
| 31 | `DistrictOrigin` | profile | 100% | The 725-district ICEGATE catalog is bundled, so the dropdown is real and values are validated against `StateOrigin` — but nothing derives it. The exporter address names its district in only 4 of 6 fixtures, and 3 of those 4 match two in-state districts. |
| 32 | `Taxable_Value` | derived | 76% | `ProductAmount × exchange rate`, and the customs rate is printed on only 2 of 17 invoices. Set the rate in the ICEGrid profile to close this. |
| 33 | `IGST_Rate` | extracted / derived | 100% | — |
| 34 | `IGST_Amount` | derived | 82% | `Taxable_Value × IGST_Rate ÷ 100`, so it inherits the exchange-rate gap above. |
| 35 | `GSTCCessAmount` | — | 55% | Trusted output writes a literal `0` in 124 rows; the module leaves them blank rather than assert an unsourced zero. |
| 36 | `RODTEP` | schedule | **39%** | Gated by `RITCCode`. Where present, Appendix 4R membership answers it **20/20**. |
| 37 | `RoDTEPQty` | derived | 89% | Tracks `SQCQTY` — *not* `Quantity`, which is wrong in 169 of 277 rows — so it inherits the net-weight gap. |

**Columns blank in the trusted output:** `HAWBL_No`, `Accessories`, `ROSLCapValue`, and
`Total_Package` are empty in all 277 rows; `dbk_desc` in 212, `ROSLRate` in 196, and
`GSTCCessAmount` in 153.

### What the module will not do

- Compute `ProductAmount`, or copy `Quantity` into `SQCQTY`/`RoDTEPQty`, or `QuantityUnit` into `SQCUnit`.
- Default `FTACode` to `NCPTI`, despite it appearing in 277/277 trusted rows and 0 input files.
- Fuzzy-match, substring-match, or nearest-match a catalog value. Unknown values are blanked with a warning.
- Classify `EndUse` from the goods. The corpus refutes it directly: motor-vehicle parts are `GNX100` in cases 6 and 16 but `GNX200` in case 15, because the code describes what the *buyer* does. A classifier would score ~80% and be confidently wrong on the rest.
- Call ICEGATE, DGFT, or CBIC during an import.


---

## Testing & Verification

### Run Unit Tests (Bun Test)
```bash
bun test
```
Runs **247 unit tests across 18 files**, covering the table store, the multi-file document
index, cell alignment, SheetJS import/export, the AI endpoint, structured dropdowns, and
the ICEGrid extraction pipeline.

| Suite | Tests | Covers |
| :--- | ---: | :--- |
| `icegrid-golden-fixtures` | 38 | The trusted workbook contract: 37 headers, row counts, blank `Accessories`, `Per = 1`, serial rules, literal IGST rates |
| `icegrid-sanitize` | 26 | Evidence verification — fabricated quotes, wrong file, unlisted field, numeric support |
| `icegrid-derive` | 24 | Schedule lookups and formulas, asserted against every corpus RITC |
| `icegrid-catalogs` | 21 | Catalog shape and exact-only resolution, including negative fuzzy-match tests |
| `icegrid-pipeline` | 16 | `icegridModule.run` end to end with a mocked AI response |
| `icegrid-columns` | 15 | Column types, dropdown wiring, mechanical rules |
| `table-dropdown` | 15 | Generic structured/dependent dropdowns and their persistence |
| `icegrid-readers` | 9 | PDF/spreadsheet text extraction and boundary markers |
| `icegrid-mapping`, `icegrid-schema`, `icegrid-e2e-workflow` | 15 | Validation, Zod contracts, and the export round-trip |

### How the ICEGrid test cases are built from the input/output files

The reference corpus is **17 real shipments — 34 input files and 17 expected output
workbooks**. It is the source of truth for every ICEGrid assertion, used in three ways.

**1. Checked-in corpus fixtures.** Six shipments — the smallest subset that still
exercises every distinct shape in the corpus — are copied into
`tests/icegrid/fixtures/`, each as its own directory holding the input file(s) and the
expected workbook. Bytes are verified against a generated `SHA256SUMS` on every run, so
a silently edited fixture fails the suite rather than quietly changing what "correct"
means. `tests/icegrid/corpus.test.ts` carries an `EDGE_CASES` ledger and a detector per
entry: one test fails if any edge case stops being covered, another fails if any
shipment stops adding one the others lack.

| Fixture directory | Built from | Rows | Why this case is kept |
| :--- | :--- | ---: | :--- |
| `01-split-xls-igst-paid/` | `INPUT 5 - INV.xls` + `INPUT 5 - PL.xls` → `OUTPUT 5` | 25 | The only IGST-paid shipment (5% and 18%, status `P`), and the only `.xls` source |
| `02-single-pdf-combined/` | `INPUT 9 - INV & PL.pdf` → `OUTPUT 9` | 16 | Invoice and packing list inside one PDF; mixed `PCS`/`SET` quantity units |
| `03-multi-invoice-pdf/` | `INPUT 12` (6 PDFs) → `OUTPUT 12` | 11 | The only multi-invoice output: `InvoiceSNo` increments while `ItemSNo` restarts |
| `04-no-drawback-pdf/` | `INPUT 13 - Inv/PL 30744.pdf` → `OUTPUT 13` | 5 | EOU/SEZ shipment claiming no drawback at all; `GNX200` end use; `RoDTEPQty == Quantity` |
| `05-authorisation-plus-xlsx/` | `INPUT 16` (authorisation PDF + `.xlsx`) → `OUTPUT 16` | 7 | A licence PDF read alongside trade documents; two schemes in one shipment; partial drawback; `dbk_desc` and `GSTCCessAmount` |
| `06-mixed-scheme-xlsx-pdf/` | `INPUT 17` (`.xlsx` invoice + `.pdf` packing list) → `OUTPUT 17` | 14 | `RODTEP = No` rows, which zero `RoDTEPQty`; free-shipping-bill rows beside drawback rows |

Two quirks of the real workbooks that the harness handles rather than "fixes": ten of the
seventeen outputs carry a second `Guidelines` worksheet holding the unit/scheme/EndUse
catalogs, and the sixth header is spelled `HAWBL_No` in seven files and `HAWBL_NO` in ten,
so headers are compared case-insensitively. Numbers are stored as text in the
`ProductExportExcel` sheets and as numbers in the `Sheet1` sheets, so comparisons normalise
type before value.

**2. Corpus-derived constants inside unit tests.** `icegrid-derive.test.ts` embeds every
distinct RITC in the corpus with the value its output carried, and asserts the bundled
schedules reproduce them: **20/20 for `SQCUnit`** via the RoDTEP `UQC` column, and **13/13
for `drawback_schno` + `dbk_rate`** via the drawback schedule. These are not hand-written
expectations — they are what the trusted workbooks actually contain.

**3. Fixed catalogs generated from the corpus.** The 70 quantity units, 69 export schemes,
44 EndUse codes, and the `NA/LUT/P` and `Yes/No` lists in
`catalogs/fixed.ts` are lifted verbatim from the `Guidelines` worksheet that the trusted
outputs ship, with the workbook's SHA-256 recorded in the generated file. They cannot drift
from the values the downstream ICEGATE upload accepts, and regenerating means re-reading
that sheet rather than retyping 180 strings. The 40 states and 725 districts come from the
ICEGATE state/district list, each district scoped to its state by `parentValue` so a district
can never resolve under the wrong one.

No test calls a live Gemini model. AI quality is evaluated manually against the real files;
the deterministic code is tested with captured responses that carry evidence spans.

### Run Playwright E2E Tests
```bash
bun run test:e2e
```
Runs 21 end-to-end user workflows in headless Chromium, including:
- Sticky headers and floor-pinned footer summaries on the restored active file.
- Search filtering, column sorting, row addition, and inline cell editing.
- Excel active-cell navigation, column resizing, and double-click column rename.
- Hover-only sort chevrons and the AI drawer's ribbon/Escape toggle (it has no close button).
- The `/settings` route: section rail, API key save, and a guard that opening it never pops a file chooser.
- File creation and import living only in the Files menu, file switching, rename persistence, and deleting the last file.
- Long cell text clipping inside its own column, and range alignment with undo/redo and reload persistence.
- Module ribbon metadata, dropdown clipping in light mode, instant column deletion, and the responsive mobile layout.

### Type Check & Build
```bash
bun run check     # svelte-check strict verification (0 errors, 0 warnings)
bun run build     # Production build with async chunk verification
bun audit         # Dependency security audit (0 high vulnerabilities)
```

---

## Deployment — Cloudflare Pages

`@sveltejs/adapter-cloudflare` builds to `.svelte-kit/cloudflare`. Every route sets
`ssr = false`, so the entire app ships as static assets and the only code that reaches
the Pages Function is `/api/ai` and `/api/ai/models`.

Connect the GitHub repo in the Cloudflare dashboard and set:

| Setting | Value |
| --- | --- |
| Framework preset | `SvelteKit` |
| Build command | `bun run build` |
| Build output directory | `.svelte-kit/cloudflare` |
| Production branch | `main` |

Then, under **Settings → Runtime**, add the `nodejs_als` compatibility flag to both the
production and preview environments. The AI SDK needs Node's `AsyncLocalStorage`, and the
function throws at runtime without it. Every push to `main` deploys; pull requests get
preview URLs.

**No environment variables are needed.** The Gemini key is supplied by the browser on each
request via the `x-ai-api-key` header and is never stored server-side, so the function
holds no secret.

Free-tier fit: static asset requests are free and unlimited, so only AI calls count against
the 100,000/day Workers quota that Pages Functions share. The 10 ms CPU ceiling excludes
time awaiting `fetch`, so streaming a Gemini response costs almost no CPU. The bundled
function is 170 KB gzipped, against a 3 MB limit.

---

## Architecture Overview

```
src/
├── app.html                  # HTML template with Google Fonts preconnect & theme script
├── app.css                   # Zen-brutalist design tokens, radius scales, accessibility
├── routes/
│   ├── +layout.svelte        # Root layout with Toast notifications
│   ├── +layout.ts            # SSR disabled for every route (export const ssr = false)
│   ├── +page.svelte          # Workspace assembling Header, DataTable, Ribbon, and AiDrawer
│   ├── settings/+page.svelte # Settings route with AI / Modules / Shortcuts section rail
│   └── api/ai/
│       ├── +server.ts        # Unified Gemini AI endpoint (x-ai-api-key authentication)
│       └── models/+server.ts # Gemini model catalog endpoint
└── lib/
    ├── types.ts              # Strict TypeScript definitions
    ├── constants.ts          # Official Gemini models, column configs, and status palettes
    ├── workspace.svelte.ts   # Shared document/table/module/toast stores, owned above the router
    ├── table/                # Complete Spreadsheet Engine
    │   ├── DataTable.svelte     # Semantic <table> with inline editing, keyboard nav, & sticky footer
    │   ├── DropdownCellEditor.svelte # Viewport-safe floating dropdown editor
    │   ├── store.svelte.ts      # Svelte 5 runes table store (CRUD, search, sort, summaries)
    │   ├── documents.svelte.ts  # Multi-file index: one storage slot per file
    │   ├── cells.ts             # Typed cell parsing and normalization
    │   ├── commands.ts          # Reversible atomic mutations for undo/redo
    │   ├── schema.ts            # Zod V2 schema & table migrations
    │   └── persistence.ts       # Debounced localStorage persistence
    ├── components/           # Application UI Shell
    │   ├── Header.svelte        # Files switcher, file title, search, alignment control, undo/redo
    │   ├── RightRibbon.svelte   # AI, modules, add row, export, theme, settings (no file/import)
    │   ├── AiDrawer.svelte      # AI assistant with structured diff preview & streaming chat
    │   ├── Icons.svelte         # Universal SVG icon component and path catalog
    │   └── settings/            # /settings page sections (Ai, Modules, Shortcuts)
    ├── modules/              # Workspace module system
    │   ├── registry.ts          # Browser module registry (no runtime-downloaded modules)
    │   ├── module-store.svelte.ts # Enablement, run lifecycle, cancellation
    │   └── icegrid/             # ICEGATE 37-column invoice extraction module
    │       ├── pipeline.ts         # The run: read -> extract -> sanitize -> derive -> validate
    │       │                       # (dynamically imported, so its 168 KB of data stays lazy)
    │       ├── readers.ts          # Local PDF/XLS/XLSX text extraction with file boundaries
    │       ├── ai.server.ts        # The single Gemini request and its extraction contract
    │       ├── schema.ts           # Candidate rows, evidence spans, clean report (Zod)
    │       ├── evidence.ts         # Quote verification: does the source really say this?
    │       ├── sanitize.ts         # Per-field evidence gate; one bad field never kills a row
    │       ├── derive.ts           # Schedule lookups, formulas, GSTIN state, provenance map
    │       ├── validate.ts         # Deterministic checks; warnings, not blockers
    │       ├── to-table.ts         # Mechanical rules and the 37-column mapping
    │       ├── profile.ts          # Per-exporter shipment defaults
    │       ├── IcegridSettings.svelte # Settings panel, mounted via the generic module slot
    │       └── catalogs/           # Trusted catalogs and exact-only resolution
    │           ├── fixed.ts            # Units/schemes/EndUse from the trusted Guidelines sheet
    │           ├── resolve.ts          # Exact match only - no fuzzy, no nearest option
    │           └── generated/
    │               ├── schedules.ts    # Drawback AIR + RoDTEP 4R snapshots, keyed by RITC
    │               └── provenance.ts   # Notification/SHA metadata, split out to stay eager-safe
    ├── server/               # Server-only code
    │   ├── models.ts            # Allowed Gemini model ids, shared by both API routes
    │   └── modules/             # Server AI handler types + static action registry
    ├── data/                 # SheetJS I/O
    │   ├── import.ts            # SheetJS workbook parser & column type inference
    │   ├── export.ts            # CSV/XLSX export & formula injection mitigation
    ├── ai/                   # Gemini AI Pipeline
    │   ├── client.ts            # Browser-side /api/ai transport
    │   └── patches.ts           # Patch conflict verification
    └── ui/                   # Feedback & Headless UI
        ├── position.ts          # Floating popover positioning engine
        ├── combobox.ts          # Combobox keyboard navigation
        ├── menu.ts              # Dropdown menu focus management
        ├── ToastHost.svelte     # Reactive toast notification container
        └── toast.svelte.ts      # Global toast store
```



---

## License
MIT
