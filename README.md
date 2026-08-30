# xlsx-ai — Fast, Modern AI Spreadsheet Workspace

**xlsx-ai** is a high-performance, Zen-brutalist spreadsheet and data workspace application built with **SvelteKit 2**, **Svelte 5 Runes**, **Bun**, **TypeScript**, **SheetJS CE (`xlsx`)**, **xlsx-calc**, and official **Google Gemini** generative models (`gemini-3.5-flash-lite` default, `gemini-3.6-flash`, `gemini-3.1-pro-preview`).

---

## Key Features

- **Svelte 5 Runes Reactivity**: State management powered by `$state`, `$derived`, and `$props` for low-latency table updates, search filtering, and sorting.
- **Multi-File Workspace**: A **Files** menu in the header holds every file — imported spreadsheets, new blank files, and tables produced by AI modules such as ICEGrid. Each file gets its own storage slot, so switching never overwrites another. Provenance is not tracked: once a file is in the workspace it is just a file.
- **Excel-Grade Active Cell Navigation**: Roving tabindex (`tabindex="0"` on active cell, `-1` on others) with arrow-key hopping (`↑`, `↓`, `←`, `→`), `Tab` column cycling, `Delete` clearing, and direct typing/`F2` inline edit activation.
- **Range Selection & Cell Alignment**: Shift-click or shift-arrow to select a rectangle, then set **left / center / right** alignment from the header control or `Ctrl+Shift+L/E/R`. Defaults follow Excel (numbers right, everything else left); overrides are per-cell, undoable, and saved with the document. `Delete` clears the whole range and `Ctrl+C` copies it as TSV. Alignment is carried into `.xlsx` export. Shift-selected cells in one column can be replaced together through the normal dropdown or typed editor, with one-step Undo/Redo.
- **Excel Formulas**: Type `=SUM(B2:B9)` into any cell and the grid shows what it computes while the editor still shows the formula — the split Excel makes. Evaluated locally by `xlsx-calc`; nothing is sent anywhere. Column letters sit in their own sticky strip above the named header and the row gutter counts from 2, because **row 1 is the header** — so an address means the same cells in the workbook you download. Typing `=SU` opens a completion list of the functions the engine can actually evaluate, and clicking a cell mid-formula writes its address (drag for a range). Drag the fill handle to copy a formula down a column with every relative reference stepped; `$` pins one in place. Deleting a row re-aims the formulas that pointed past it and gives `#REF!` to any that named it, rather than silently summing different cells.
- **Interactive Column Resizing & Auto-Fit**: Draggable right-edge resize handles (`.th-resize-handle`) on every column header with double-click content auto-fit.
- **Accessible Floating Status Dropdowns**: Boundary-colliding, viewport-flipping status combobox with search, custom status creation, and single-click chevron trigger outside scroll overflow.
- **Typed Column System**: First-class support for `text`, `number`, `currency`, `percent`, `dropdown`, and `date` with type-aware inline cell editors and centralized normalization (`src/lib/table/cells.ts`).
- **Coupled Columns**: A dropdown option can carry the sibling cells its value determines (`DropdownOption.fills`), so picking a drawback serial moves its rate, description and ROSL figures with it — in one undo step, and on paste and AI edits too, not just the editor. A fill is a literal or `{ from: 'OtherColumn' }`, which reads that column in the same row; that is how a serial with no schedule unit falls back to the invoiced one. A second record, `fillsIfBlank`, writes only where the target cell is still empty — for a value an option implies rather than determines, so choosing a unit of measure fills a blank drawback unit but never overwrites one the document printed. Values only, evaluated once on write: for a live relationship between two of your own columns, write a formula.
- **Dependent Dropdowns**: `dependsOnColumnId` scopes a column's options to the value of another column in the same row — districts to their state, drawback serials to their tariff code. A dependent column offers its catalog for that parent plus whatever the row itself already holds; it never borrows values from other rows.
- **Live Summary Calculations**: Pinned footer calculates real-time `SUM`, `AVG`, `MIN`, `MAX`, and `COUNT` over computed values. A totals row written as `=SUM(D2:D9)` is excluded from its own column's sum — those values are already in there once — and `AVG` divides by what actually went into the sum.
- **SheetJS Client File I/O & Dynamic Chunking**:
  - **Import**: Drag & drop or upload `.xlsx`, `.xls`, `.csv`, and `.tsv` files with automatic column header deduplication, size limits (10 MB / 10k rows / 100 cols), and type inference heuristics. Formulas a workbook carries are read back as formulas, not flattened to the numbers Excel last computed.
  - **Export**: One-click export to native Excel Workbooks (`.xlsx`, via `write-excel-file`) or CSV files (`.csv`) with automatic formula injection escaping (`=`, `+`, `-`, `@`, `\t`, `\r`) and unique header disambiguation. Exported workbooks keep per-cell alignment, column widths, a bold header row, real Excel number formats for `currency` / `percent` columns, and **formulas as formulas** — `.csv`, which has no formula concept, carries the computed value instead.
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
  - Seamless **Dark** & **Light** themes with FOUC prevention and explicit `color-scheme` support. Both palettes are generated in OKLCH on a single neutral hue with flat chroma, and every text/surface and accent/surface pairing is verified at >= 4.5:1 (WCAG AA).
  - 30-entry undo/redo history stack (`Ctrl+Z` / `Ctrl+Y`) and robust debounced auto-saving to `localStorage` with unload flush.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `↑` / `↓` / `←` / `→` | Navigate active cell box (Excel-style) |
| `Enter` / `F2` | Start editing cell / commit & move down |
| `Shift` + arrows / `Shift` + click | Extend the selection into a range |
| Type or `Enter` / `F2` on a one-column range | Replace every selected cell through its typed editor |
| `Delete` / `Backspace` | Clear the selection |
| `Ctrl + C` / `Cmd + C` | Copy the selection as TSV |
| `Ctrl + Shift + L` / `E` / `R` | Align selection left / center / right |
| `Tab` / `Shift + Tab` | Navigate and edit cells horizontally |
| `=` then `↑` / `↓`, `Enter` / `Tab` | Move through and accept a function suggestion |
| `Escape` (suggestions open) | Close the suggestion list, keeping the edit |
| Drag the fill handle | Copy the cell along a row or column, stepping its references |
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
  -> requestDutyLookups()         one request per distinct tariff code
  -> requestExchangeRates()       the customs rate board, export side
  -> deriveRows()                 PROPOSAL: schedule lookups, formulas, shipment profile
  -> requestTariffClassification()  search phrases -> DGFT -> ranked candidates
  -> confirmIcegridChoices()      the dialog. nothing is written until a human confirms
  -> deriveRows()                 again, over the confirmed answers
  -> validateIcegridReport()      deterministic checks, warnings not blockers
  -> mapReportToTableData()       the existing table + Excel export
```

### The four provenances

A cell is populated only if one of these can answer *"where did this come from?"*:

| Provenance | Guarantee |
| :--- | :--- |
| **Extracted** | The model returned a verbatim source quote; the quote is confirmed to exist in that file, to name that field, and to contain the value. A fabricated quote loses the field. |
| **Schedule** | A lookup keyed by the 8-digit RITC in a bundled snapshot of a published customs schedule, cited with its notification number and effective date. |
| **Lookup** | The live duty-structure service, queried per tariff code. Supplies the drawback candidates a human chooses between, plus the description, cap and unit the bundled snapshot does not carry. Layered over the schedules, never replacing them. |
| **Derived** | A formula over fields already established, confirmed against every row of the reference corpus. Never overwrites an extracted value. |
| **Profile** | The exporter typed it once in Settings → Modules → ICEGrid. |
| **Confirmed** | A human answered it in the confirmation dialog, against this shipment. Nothing here is filled by any of the routes above. |

Precedence is **extracted > lookup > schedule > derived > profile**, and a confirmed
answer outranks all of them — that is what asking is for. Nothing overwrites a
value a document supported. Every run opens its warnings with a count per provenance.

Bundled schedules (`catalogs/generated/schedules.ts`, never fetched at runtime):

- **Duty Drawback All Industry Rates** — Notification No. 77/2023-Customs (N.T.), effective 2023-10-30, 2,209 serials.
- **RoDTEP Appendix 4R** — Notification No. 32 dated 30.09.2024, effective 2024-10-10, 8,563 tariff items.

Both are **dated snapshots and change by notification**. The UI shows the effective date;
verify against the current notification before filing.

### The confirmation dialog

An import stops before it writes anything and shows what it proposes. Every field is
already filled — by the extractor, the schedules and the live lookup — so this is a
confirmation, not a form. It exists because each of these is a declaration the exporter
signs and **no document can confirm it for them**: a drawback serial is a classification,
IGST status is a decision taken before the shipment, an end use is a statement about the
buyer.

| Asked once per | Fields |
| :--- | :--- |
| **The whole invoice** | `EndUse`, `RewardItem`, `StateOrigin`, `DistrictOrigin`, invoice currency and exchange rate |
| **Each distinct tariff code** | `drawback_schno`, `RODTEP`, `IGST_PaymentStatus`, `IGST_Rate` |
| **Each item with no filable code** | the tariff code itself — see below |

The pipeline runs `deriveRows` **twice**: once to produce what it proposes, which is what
fills the dialog, and again over the confirmed answers. Because `set()` is fill-only, a
confirmed answer sits on the raw row *before* derivation, so its consequences recompute for
free — a changed drawback serial pulls its own rate, description, ROSL values and unit;
an `IGST_PaymentStatus` changed to `LUT` zeroes the tax block.

State and district of origin, currency and exchange rate used to be Settings defaults and
are not any more: they change per consignment, so remembering them was wrong as often as it
was right.

### Exchange rate

`impexcube.in/Home/LoadExRate` answers a plain GET with the whole customs rate board, both
directions, no session or key. Exports convert at the **`Export`** column — `Import` is the
other direction of the same notification and would overstate every `Taxable_Value`. The
invoice currency is detected by scanning the documents for three-letter codes the board
actually lists, with `INR` excluded: an Indian exporter's letterhead, GSTIN block and rupee
totals name it on every document without the goods being invoiced in it. Proxied through
`/api/icegrid/exchange-rate`; the dialog carries a manual override and a refresh.

### Finding a tariff code

Roughly a third of the corpus prints no RITC on some lines, or prints a heading like `9403`
that narrows the answer without being one. Only an 8-digit code can be filed, so both go to
the dialog to be chosen.

**Every code offered comes out of DGFT's own ITC-HS master.** Their public lookup takes
either a code prefix or plain description text in one parameter, unauthenticated, and
answers with real codes and their official wording. Proxied through
`/api/icegrid/tariff-search`, because it sends no CORS headers.

The match is **literal**, and that is the whole reason a model is involved:

| Query | Result |
| :--- | :--- |
| `wall clock` | 2 codes |
| `bed linen` | 8 codes |
| `cotton bed sheet` | **0** |
| `wooden furniture` | 5 codes |
| `furniture of wood` | **0** — word order matters |
| `SIDE TABLE LARGE MANGO WOOD` | **0** |

So the model's job is to translate invoice language into tariff language. It returns
**search phrases, never codes** — the schema it answers with has no field a code could
travel in. A second pass then *orders* the candidates DGFT returned, and any code it names
that was not on the list it was given is discarded. A hallucinated code cannot reach the
dialog: it would have to exist in the schedule to be returned at all.

| Case | What runs |
| :--- | :--- |
| Heading printed (`9403`) | DGFT enumerates its 16 filable children. **No model at all** — the document decided. |
| Nothing printed | One batched call for phrases → DGFT → one call to rank → shortlist of 6 |

Choosing a code fires its duty lookup immediately, so the drawback serial and RoDTEP verdict
are prefilled and visible rather than settled silently afterwards. Change the code and both
are dropped, because they are consequences of it; IGST status and rate survive, because they
are decisions about the shipment.

An item left unclassified imports blank with a review note. Nothing is preselected —
classifying goods is the exporter's call, and a suggestion is a suggestion until a human
takes it.

### Live duty lookup

The bundled snapshots store `serial:rate` alone, so they had to *guess* which drawback
serial applies and never carried the description, cap or unit columns of the notification.
`impexcube.in` publishes all four. One request per **distinct tariff code** — not per row —
goes out through `/api/icegrid/duty-lookup`, which exists only because the service sends no
CORS headers.

| | Drawback (`FillDBK`) | RoDTEP (`GetDetails`, `Mode: RODEP`) |
| :--- | :--- | :--- |
| Keyed on | the **4-digit heading** | all **8 digits** |
| So | `94032090` and `94038900` return the same three serials | the same two codes give `KGS` and `NOS` |
| Therefore | a human chooses — the module suggests and warns | it stays a derivation |

**It agrees with the reference corpus exactly.** Replaying every distinct RITC the
17-shipment corpus carries against the live service reproduces the hand-verified values:
RoDTEP membership **20/20**, `SQCUnit` **20/20**, `drawback_schno` **13/13**, `dbk_rate`
**13/13** — the same figures the bundled schedule scores, from an independent source.

Nothing depends on it staying up. Failures are per tariff code, become a warning, and fall
back to the bundled schedule — the behaviour every import had before this existed. Its own
disclaimer says its contents carry no legal force, which is why every cell it fills is
marked `lookup` rather than silently asserted.

The choice stays live after the import. `drawback_schno` is a dropdown scoped to the row's
RITC, and each serial carries the fields it determines — `dbk_rate`, `dbk_desc`, `ROSLRate`,
`ROSLCapValue`, `dbk_unit` — so changing the serial in the grid leaves the row exactly as a
fresh import of that serial would, in one undo step. A serial the schedule gives no unit for
defers to `QuantityUnit`, the same rule `deriveRows` applies, rather than keeping the unit
the previous serial left in the cell.

### Column fill rates

Measured by replaying the finished pipeline against the 17-shipment reference corpus and
comparing every cell to the trusted output — **8,513 of 10,249 cells match (83.1%)**.
Supplying an RITC for every line raises this to **88.8%**; see `RITCCode` below.

> These figures predate the live duty lookup and are **not recomputed here**: the replay
> needs a live model run, which no test performs. Measured against the corpus tariff codes,
> the lookup moves three columns and leaves the rest untouched — `dbk_desc` now fills where
> the legacy output left it blank (a deliberate divergence), while
> `dbk_unit`, `ROSLRate` and `ROSLCapValue` barely move because the service prescribes a
> unit for 1 of 20 codes and ROSL values for none. `RODTEP` gains an `N/A` state that never
> fires on this corpus, since all 20 codes are in Appendix 4R.

| # | Column | Source | Fill | Why not 100% |
| ---: | :--- | :--- | ---: | :--- |
| 1 | `InvoiceSNo` | derived | 100% | — |
| 2 | `ItemSNo` | derived | 100% | — |
| 3 | `InvoiceNo` | extracted | 100% | — |
| 4 | `Description` | extracted | **6%** | The item name extracts correctly, but trusted output prepends an exporter house-style goods-class phrase (`OTHER FURNITURE ARTICLES OF IRON ARTWARE - …`). It is not the tariff text — the drawback schedule says `Others`, RoDTEP says `Other` — so composing it would mean inventing customs wording. |
| 5 | `EndUse` | profile | 100% | — |
| 6 | `HAWBL_No` | — | 100% | **Always blank in trusted output.** No AWB or B/L number appears in any of the 34 input files. |
| 7 | `Total_Package` | — | 100% | **Always blank by rule.** Blank in all 277 trusted rows: a carton count is per consignment, not per line item, so a packing list offers many numbers that look like one and none that belong on a row. Not requested from the model at all. |
| 8 | `Accessories` | — | 100% | **Always blank by rule**, like `Total_Package`. Never populated on import and deliberately not offered as a dropdown. |
| 9 | `RewardItem` | profile | 95% | Held per shipment; one case varies it across lines (6 rows `No`, the rest `Yes`), which a single profile value cannot express. |
| 10 | `IGST_PaymentStatus` | profile / extracted | 100% | — |
| 11 | `RITCCode` | extracted | **41%** | Only 11 of 17 invoices print an HSN code. It is per-line, so no profile can supply it — and it **gates `SQCUnit`, `drawback_schno`, `dbk_rate` and `RODTEP`**. A saved product→HSN mapping is the single highest-value addition left. |
| 12 | `ApplicableExpSchemes` | profile | 92% | Per-shipment value; one case mixes two schemes across its lines. |
| 13 | `Quantity` | extracted | 100% | — |
| 14 | `QuantityUnit` | extracted | 90% | Not printed on every line, or printed in a spelling outside the 70-code catalog, which is rejected rather than guessed. |
| 15 | `SQCQTY` | extracted / derived | 91% | Counted in the tariff's own unit, so which figure it takes depends on `SQCUnit`: the line's net weight when that unit is `KGS`, otherwise `Quantity`, and nothing at all when `SQCUnit` is blank (no unit to declare a quantity in). The net weight comes from `NetWeight`, an internal extracted field; 5 corpus cases ship no per-line weight, and those rows stay blank with a warning rather than borrow a count. |
| 16 | `SQCUnit` | schedule | **41%** | Gated by `RITCCode`. Where the code is present the RoDTEP `UQC` column resolves it **20/20 exactly**. |
| 17 | `UnitPrice` | extracted | 98% | 5 rows carry a rate back-computed to more precision than the invoice prints. |
| 18 | `ProductAmount` | extracted | 89% | Some invoices print only a grouped total. Never computed from `Quantity × UnitPrice` — that mismatch is reported as a warning instead. |
| 19 | `Per` | derived | 100% | — |
| 20 | `PerUnit` | derived | 90% | Copies `QuantityUnit`, so it inherits that column's gaps — but the copy is also wired to the `QuantityUnit` dropdown, so a unit filled in the grid after import fills this too. |
| 21 | `drawback_schno` | lookup / schedule | **43%** | Gated by `RITCCode`. Resolves **13/13 exactly** from either source. **14 of the corpus's 20 tariff codes carry more than one eligible serial** — the module now offers them as a per-row dropdown and warns that the residual line is a suggestion, instead of guessing silently. The `B` suffix is the schedule's column B, *"drawback when Cenvat facility has been availed"*. |
| 22 | `dbk_qty` | derived | 90% | Copies `Quantity` wherever it exists; 23 trusted rows leave it blank because no drawback is claimed on that line. |
| 23 | `dbk_rate` | lookup / schedule | **43%** | Gated by `RITCCode`. Resolves **13/13 exactly** from either source. Follows whichever serial the row carries, so changing the serial changes the rate. |
| 24 | `dbk_unit` | lookup / derived | 79% | The schedule's unit for the chosen serial when it prescribes one — true for 1 of 20 corpus codes — otherwise copies `QuantityUnit` — at import, and again whenever the serial or the unit is changed in the grid. 28 trusted rows leave it blank on lines with no drawback claim. |
| 25 | `dbk_desc` | lookup | 77% | Was deliberately blank: the drawback PDF's description column bleeds across entries when parsed. The lookup publishes it cleanly, and **all 20 corpus codes return one**, so it now fills wherever a serial resolves. It is blank in 212 of 277 trusted rows, so **expect this column to diverge downward** against the legacy output — a deliberate improvement, like `Total_Package`. |
| 26 | `ROSLRate` | lookup | 71% | The RoSCTL schedule is not bundled; the lookup carries a ROSL column but returns nothing for any of the 20 corpus codes, so this is unchanged in practice. Trusted output writes a literal `0` in 81 rows; the module leaves them blank rather than assert an unsourced zero. |
| 27 | `ROSLCapValue` | lookup | 100% | **Always blank in trusted output**, and the lookup returns no ROSL cap for any corpus code, so it stays blank. |
| 28 | `CountryDestination` | extracted | 97% | 7 rows where the destination is implied by the consignee address rather than named, so it stays blank. |
| 29 | `FTACode` | profile | 100% | — |
| 30 | `StateOrigin` | derived | 100% | First two digits of the exporter's GSTIN — correct in **17/17** shipments. |
| 31 | `DistrictOrigin` | profile | 100% | The 725-district ICEGATE catalog is bundled, so the dropdown is real and values are validated against `StateOrigin` — but nothing derives it. The exporter address names its district in only 4 of 6 fixtures, and 3 of those 4 match two in-state districts. |
| 32 | `Taxable_Value` | derived | 76% | `ProductAmount × exchange rate`, and the customs rate is printed on only 2 of 17 invoices. Set the rate in the ICEGrid profile to close this. |
| 33 | `IGST_Rate` | extracted / derived | 100% | — |
| 34 | `IGST_Amount` | derived | 82% | `Taxable_Value × IGST_Rate ÷ 100`, so it inherits the exchange-rate gap above. |
| 35 | `GSTCCessAmount` | — | 55% | Trusted output writes a literal `0` in 124 rows; the module leaves them blank rather than assert an unsourced zero. |
| 36 | `RODTEP` | lookup / schedule / extracted | **39%** | Gated by `RITCCode`. Appendix 4R membership answers it **20/20** from either source. Three states, not two: `No` only when the documents declare a declined claim, `Yes` when the tariff item is listed, `N/A` when it is absent — previously an absent code was written `No`, which claimed the question had been considered and refused. All 20 corpus codes are listed, so `N/A` does not fire here. |
| 37 | `RoDTEPQty` | derived | 89% | Tracks `SQCQTY` — *not* `Quantity`, which is wrong in 169 of 277 rows — so it inherits the net-weight gap. |

**Columns blank in the trusted output:** `HAWBL_No`, `Accessories`, `ROSLCapValue`, and
`Total_Package` are empty in all 277 rows — the module matches this by rule for the last two; `dbk_desc` in 212, `ROSLRate` in 196, and
`GSTCCessAmount` in 153.

### What the module will not do

- Compute `ProductAmount`, or copy `Quantity` into `RoDTEPQty`, or `QuantityUnit` into `SQCUnit`. `SQCQTY` does take `Quantity`, but only where the tariff states a non-`KGS` unit to declare it in.
- Extract a net weight that is not printed against the individual line. A consignment total is never divided across lines, and a weight in any unit but kilograms is discarded rather than converted.
- Populate `Total_Package` or `Accessories`. Both are blanked by rule and omitted from the extraction request entirely.
- Default `FTACode` to `NCPTI`, despite it appearing in 277/277 trusted rows and 0 input files.
- Fuzzy-match, substring-match, or nearest-match a catalog value. Unknown values are blanked with a warning.
- Classify `EndUse` from the goods. The corpus refutes it directly: motor-vehicle parts are `GNX100` in cases 6 and 16 but `GNX200` in case 15, because the code describes what the *buyer* does. A classifier would score ~80% and be confidently wrong on the rest.
- Write a tariff code, a drawback serial or an end use that no human confirmed. Suggestions are ranked and shown; taking one is a click, and skipping it imports the cell blank with a review note.
- Let a model emit a tariff code. It supplies search phrases and an ordering; every code shown came back from DGFT's own master, and a ranked code that was not on the list it was handed is discarded.
- Reach ICEGATE or CBIC during an import. It does call DGFT's public ITC-HS lookup and a commercial mirror of the published duty schedules — both read-only, both advisory, both marked as their own provenance, and an import completes without either.


---

## Testing & Verification

### Run Unit Tests (Bun Test)
```bash
bun test
```
Runs **461 unit tests across 24 files**, covering the table store, the multi-file document
index, cell alignment, formula evaluation and reference remapping, SheetJS import/export,
the AI endpoint, structured dropdowns, the duty-structure lookup, tariff-code search and
ranking, the confirmation dialog's answer model, and the ICEGrid extraction pipeline.

| Suite | Tests | Covers |
| :--- | ---: | :--- |
| `formulas` | 31 | Evaluation, `#ERROR!` containment, A1 addressing, completion, point mode, fill and structural reference remapping |
| `icegrid-golden-fixtures` | 38 | The trusted workbook contract: 37 headers, row counts, blank `Accessories`, `Per = 1`, serial rules, literal IGST rates |
| `icegrid-sanitize` | 40 | Evidence verification — fabricated quotes, wrong file, unlisted field, numeric support, reordered extraction, trusted prose, fragments of a printed identifier |
| `icegrid-derive` | 24 | Schedule lookups and formulas, asserted against every corpus RITC |
| `icegrid-duty-lookup` | 18 | Serial selection and its basis, per-tariff-code dropdown scoping, the three `RODTEP` states, and fallback to the bundled schedule |
| `icegrid-catalogs` | 21 | Catalog shape and exact-only resolution, including negative fuzzy-match tests |
| `icegrid-pipeline` | 16 | `icegridModule.run` end to end with a mocked AI response |
| `icegrid-columns` | 17 | Column types, catalog vs per-run dropdown wiring, mechanical rules |
| `table-dropdown` | 15 | Generic structured/dependent dropdowns and their persistence |
| `icegrid-readers` | 9 | PDF/spreadsheet text extraction and boundary markers |
| `icegrid-tariff` | 18 | ITC-HS parsing, filable-code filtering, candidate ranking and the residual rule, ranking applied without trusting it |
| `icegrid-confirm` | 16 | The confirmation answer model: grouping, per-code vs per-invoice application, exchange rate board, code-change invariants |
| `icegrid-classify` | 7 | The classify handler against a stubbed Gemini and DGFT — opaque ids, prefix-only paths, discarded codes, search budget |
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

No test calls a live Gemini model or the live duty-structure service — the duty tests run
against recorded response shapes, so the suite stays offline and deterministic.
AI quality is evaluated manually against the real files;
the deterministic code is tested with captured responses that carry evidence spans.

### Run Playwright E2E Tests
```bash
bun run test:e2e
```
Runs 45 end-to-end user workflows in headless Chromium. CI runs this suite as its own
job alongside `check`/`test`/`build`, so a regression here fails the branch. Covered:
- The column-letter strip above the named header, and the row gutter counting from spreadsheet row 2.
- Formula completion (`=SU` → `SUM(`), point mode writing a clicked cell's address, and the outline over what a formula reads.
- Dragging the fill handle down a column, and deleting a row re-aiming the formulas that pointed past it.
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
├── app.d.ts                  # Ambient declaration for the untyped xlsx-calc module
├── routes/
│   ├── +layout.svelte        # Root layout with Toast notifications
│   ├── +layout.ts            # SSR disabled for every route (export const ssr = false)
│   ├── +page.svelte          # Workspace assembling Header, DataTable, Ribbon, and AiDrawer
│   ├── settings/+page.svelte # Settings route with AI / Modules / Shortcuts section rail
│   ├── api/ai/
│   │   ├── +server.ts        # Unified Gemini AI endpoint (x-ai-api-key authentication)
│   │   └── models/+server.ts # Gemini model catalog endpoint
│   └── api/icegrid/          # Read-only proxies for services that send no CORS headers
│       ├── duty-lookup/      # Drawback + RoDTEP, per tariff code
│       ├── exchange-rate/    # The customs rate board
│       └── tariff-search/    # DGFT ITC-HS search, for the dialog's own search box
└── lib/
    ├── types.ts              # Strict TypeScript definitions
    ├── constants.ts          # Official Gemini models, column configs, and status palettes
    ├── workspace.svelte.ts   # Shared document/table/module/toast stores, owned above the router
    ├── table/                # Complete Spreadsheet Engine
    │   ├── DataTable.svelte     # Semantic <table> with inline editing, keyboard nav, & sticky footer
    │   ├── DropdownCellEditor.svelte # Viewport-safe floating dropdown editor
    │   ├── FormulaHintPopup.svelte   # Function suggestion list for the cell editor
    │   ├── store.svelte.ts      # Svelte 5 runes table store (CRUD, search, sort, summaries)
    │   ├── documents.svelte.ts  # Multi-file index: one storage slot per file
    │   ├── cells.ts             # Typed cell parsing and normalization
    │   ├── formulas.ts          # xlsx-calc evaluation, A1 addressing, reference remapping
    │   ├── formula-hints.ts     # Completion catalog and the caret rules point mode uses
    │   ├── commands.ts          # Reversible atomic mutations for undo/redo + coupled fills
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
    │       ├── ai.server.ts        # Both Gemini contracts: extraction, and tariff search + ranking
    │       ├── schema.ts           # Candidate rows, evidence spans, clean report (Zod)
    │       ├── columns.ts          # The 37 filed columns, plus internal ones the rules need
    │       ├── evidence.ts         # Quote verification: does the source really say this?
    │       ├── sanitize.ts         # Per-field evidence gate; one bad field never kills a row
    │       ├── derive.ts           # Schedule lookups, formulas, GSTIN state, provenance map
    │       ├── validate.ts         # Deterministic checks; warnings, not blockers
    │       ├── to-table.ts         # Mechanical rules; drops internal fields to the 37 filed columns
    │       ├── profile.ts          # Per-exporter defaults - only what never changes per shipment
    │       ├── confirm.ts          # The answer model: what is asked, and how answers reach the rows
    │       ├── confirm.client.ts   # Mounts the dialog and awaits it; resolves headlessly with no DOM
    │       ├── tariff.ts           # ITC-HS candidates: parsing, ranking, budget, browser transport
    │       ├── tariff.server.ts    # DGFT ITC-HS search, chunked and cached
    │       ├── exchange-rate.ts    # Customs rate board, export side, and currency detection
    │       ├── duty-lookup.ts      # Drawback/RoDTEP types, serial choice, dropdown payloads
    │       ├── duty-lookup.client.ts / .server.ts # Browser transport / impexcube fetch
    │       ├── IcegridSettings.svelte     # Settings panel, mounted via the generic module slot
    │       ├── IcegridConfirmDialog.svelte # The pre-import confirmation dialog
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
