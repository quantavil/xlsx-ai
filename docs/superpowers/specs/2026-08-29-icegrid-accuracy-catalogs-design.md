# ICEGrid Accuracy and Catalog Design

**Date:** 2026-08-29  
**Status:** Approved requirements captured for implementation  
**Related implemented design:** `docs/superpowers/specs/2026-08-28-icegrid-module-design.md`

## 1. Outcome

Improve the existing `src/lib/modules/icegrid/` importer without replacing its module host, AI provider, ribbon action, table, or Excel export.

The completed flow remains:

```text
one multi-file selection
  -> local PDF/XLS/XLSX text extraction
  -> one combined, boundary-preserving AI request
  -> evidence verification
  -> exact catalog normalization
  -> deterministic validation
  -> exact 37-column table
  -> existing Excel export
```

The priority is source fidelity. A populated cell is allowed only when its value is:

1. explicitly supported by selected source content;
2. produced by an approved deterministic rule documented in this specification; or
3. explicitly entered or selected by the user.

If none applies, the value is `null`/blank and the module emits a review warning. The module must never guess, fuzzy-match, choose a nearest option, or silently substitute a default.

## 2. Scope and non-goals

### Included

- Retain one AI request for all selected files.
- Require source evidence for AI-populated fields.
- Verify evidence against the exact extracted file block before accepting a value.
- Add trusted in-app catalogs and exact-only normalization.
- Add editable dropdowns that protect built-ins while allowing explicit user-created values.
- Use official ICEGATE catalog snapshots for country, state, district, and FTA data.
- Preserve legacy state/district relationship behavior, including padded state-code joins.
- Correct current column types, serial generation, descriptions, and unsafe prompt rules.
- Keep all 37 output headers and their order unchanged.
- Add regression coverage using representative trusted legacy workbooks.
- Keep every implementation layer independently testable by the user.

### Excluded

- Multi-file grouping, saved groups, queues, or job history.
- A separate reconciliation engine or hidden shipment-domain model.
- OCR for image-only PDFs.
- Runtime ICEGATE network calls during import.
- Fuzzy matching, semantic nearest-neighbor matching, or AI-created catalog options.
- Automatic tariff, scheme, state, district, FTA, drawback, RoDTEP, or tax selection.
- Automatic `ProductAmount`, `SQCQTY`, `PerUnit`, `FTACode`, `StateOrigin`, `DistrictOrigin`, `RODTEP`, or `RoDTEPQty` defaults.
- Excel data-validation lists embedded in exported workbooks. Dropdowns live in the application table.
- A new table, export system, AI provider, API key, model picker, or API route.

## 3. Fixed output contract

The output remains exactly these 37 headers in this order:

```text
InvoiceSNo, ItemSNo, InvoiceNo, Description, EndUse, HAWBL_No,
Total_Package, Accessories, RewardItem, IGST_PaymentStatus, RITCCode,
ApplicableExpSchemes, Quantity, QuantityUnit, SQCQTY, SQCUnit,
UnitPrice, ProductAmount, Per, PerUnit, drawback_schno, dbk_qty,
dbk_rate, dbk_unit, dbk_desc, ROSLRate, ROSLCapValue,
CountryDestination, FTACode, StateOrigin, DistrictOrigin, Taxable_Value,
IGST_Rate, IGST_Amount, GSTCCessAmount, RODTEP, RoDTEPQty
```

No evidence, confidence, warning, source, or internal matching fields become exported columns.

## 4. Provenance rules

### 4.1 Evidence returned by Gemini

Each AI row carries transient evidence spans:

```ts
interface IcegridEvidenceSpan {
  sourceFile: string;
  location: string; // for example "Sheet Invoice row 14" or "Page 2"
  quote: string;
  fields: IcegridHeader[];
}
```

One span may support multiple fields from the same source passage. One row may have spans from multiple selected files.

The server stamps `sourceFiles` and `reportVersion`; Gemini does not repeat them. Evidence is retained only until sanitization and is not mapped to `TableData`.

### 4.2 Evidence verification

Before accepting a non-null AI value, the client must verify:

- `sourceFile` exactly names a selected file;
- the normalized quote occurs in that file's extracted content;
- the evidence span lists the populated header;
- the quote contains the source token used for the value, allowing only whitespace, punctuation, case, and numeric-format normalization;
- catalog conversion is an exact code/value/unique-label conversion from that supported raw token.

If verification fails, the field becomes `null` and a warning identifies row, field, source, and reason. A fabricated quote therefore cannot legitimize a fabricated value.

The following fields do not require AI evidence because the module owns them mechanically:

- `InvoiceSNo`
- `ItemSNo`
- `Per`
- `Accessories`

### 4.3 Conflicting values

When selected files contain conflicting values and there is no exact identifier proving which one belongs to the row, the field stays blank and a warning is emitted. The AI must not pick whichever value looks more likely.

Cross-file line consolidation is permitted only when the sources share an explicit invoice number and an exact line identifier such as SKU/article number, or an exact normalized description-plus-quantity pair. Otherwise invoice rows remain the base rows and ambiguous packing values remain blank.

## 5. Approved deterministic rules

Only these rules may populate output without source evidence:

1. `Accessories` is always `null`. Do not ask Gemini to extract it. Do not default it to `N`. Do not create an Accessories dropdown.
2. `Per` is `1` when blank. This is a fixed ProductFormat/legacy-output rule.
3. `InvoiceSNo` is assigned by the first appearance of each non-empty normalized `InvoiceNo`.
4. `ItemSNo` starts at `1` and increments within each known invoice number.
5. If `InvoiceNo` is blank, serials that depend on invoice grouping remain blank rather than guessing a group.
6. Exact catalog normalization may change representation but not meaning, such as `19` to `19-Drawback (DBK)` or `RAJASTHAN` to `08` when the label match is unique.

Specifically forbidden automatic fills:

- `ProductAmount = Quantity * UnitPrice`: calculate only for a warning/suggestion; do not write the result.
- `PerUnit = QuantityUnit`
- `SQCQTY = Quantity`
- `SQCUnit = QuantityUnit`
- `dbk_qty = Quantity`
- `dbk_unit = QuantityUnit`
- `FTACode = NCPTI`
- `RoDTEPQty = Quantity`
- country/state/district/scheme/tax values inferred from product description or past imports.

## 6. Dropdown behavior

### 6.1 Host table contract

The host `Column` contract gains a structured dropdown definition:

```ts
interface DropdownOption {
  value: string; // value stored in the table and exported
  label?: string; // descriptive display text in the dropdown
  parentValue?: string; // optional dependency key, for example a district's state code
}

interface DropdownConfig {
  options: DropdownOption[];
  allowCustom: boolean;
  dependsOnColumnId?: string;
}

interface Column {
  id: string;
  name: string;
  type: ColumnType;
  width?: number;
  dropdown?: DropdownConfig;
}
```

For coded catalogs, the dropdown displays `value — label` but commits only `value`. When `dependsOnColumnId` is present, the table shows only options whose `parentValue` exactly matches that row's dependency cell. Existing row values not present in the active catalog remain visible and selectable so loading an older table never destroys data.

### 6.2 Rigidity and flexibility

- Built-in options are immutable in Settings: they cannot be renamed or deleted.
- Users may add and delete custom options in ICEGrid module Settings.
- Custom options persist under a versioned ICEGrid-only localStorage key.
- A user may also use `+ Add` in a table cell when `allowCustom` is true; that explicit value belongs to the current table.
- AI extraction cannot add catalog options.
- Catalog normalization recognizes built-ins plus settings-level custom options, but only with exact matching and verified source evidence.
- Duplicate values are rejected case-insensitively.
- Reset removes only custom options and leaves built-ins untouched.

### 6.3 Dropdown columns

These headers use dropdowns:

- `EndUse`
- `RewardItem`
- `IGST_PaymentStatus`
- `ApplicableExpSchemes`
- `QuantityUnit`
- `SQCUnit`
- `PerUnit`
- `dbk_unit`
- `CountryDestination`
- `FTACode`
- `StateOrigin`
- `DistrictOrigin`
- `RODTEP`

`Accessories` remains a non-dropdown text column whose imported value is always blank.

`IGST_Rate` is a number, not the host `percent` type: ICEGrid stores `18`, not `0.18`, and must not render it as `1800%`.

## 7. Catalog representation and exact resolver

The module uses one internal option shape:

```ts
interface IcegridCatalogOption {
  value: string;
  label?: string;
  parentValue?: string; // district -> normalized state code
}
```

Resolver order for a raw source value:

1. trim and collapse whitespace;
2. exact case-insensitive match on stored `value`;
3. exact case-insensitive match on the complete display string `value — label`;
4. exact case-insensitive match on a unique `label`;
5. for export schemes only, exact numeric-prefix match maps to the complete canonical scheme string when the code has one unambiguous canonical target for the supplied text;
6. otherwise return `unresolved`; never use substring, edit distance, prefix guessing, or an AI fallback.

For `ApplicableExpSchemes`, store and export the complete canonical entry, for example `19-Drawback (DBK)`. The historical code-only value `19` is normalized to that complete value. Duplicate numeric codes with different descriptions remain distinct catalog entries; a bare ambiguous code must not be auto-resolved.

For `CountryDestination`, `FTACode`, `StateOrigin`, and `DistrictOrigin`, display `code — name/description` and store only the code.

District options are filtered by the row's current `StateOrigin`. A district value is valid only when its normalized parent state matches that state. ICEGATE state `08` and district parent `8` are the same relationship for validation; exported state stays `08`, while district code is preserved exactly as supplied by the official directory.

## 8. Catalog sources and lifecycle

Runtime imports never depend on ICEGATE availability. Catalogs are checked-in, versioned snapshots with provenance:

```ts
interface CatalogProvenance {
  sourceUrl: string;
  retrievedAt: string;
  sha256: string;
  entryCount: number;
}
```

Source hierarchy:

- Quantity units, schemes, EndUse, payment status, RewardItem, and RODTEP: the approved values in Appendix A, cross-checked against the trusted ProductFormat workbook.
- Country, state, district, and FTA: ICEGATE Codes directory, `https://www.icegate.gov.in/Webappl/Codes`.
- State snapshot: `https://www.icegate.gov.in/Webappl/state_det_all.jsp`.
- FTA snapshot: `https://www.icegate.gov.in/Webappl/Ftp`.
- State/district parent normalization follows the trusted legacy behavior in `/home/quantavil/Documents/Project/icegrid/src/domain/regions.ts` and `/home/quantavil/Documents/Project/icegrid/src/domain/issues.ts`.

A developer-only refresh tool reads saved official ICEGATE HTML/CSV exports and writes generated TypeScript. It must fail closed if required fields are missing, codes are duplicated unexpectedly, a district lacks a valid parent, provenance is absent, or catalog shape changes unexpectedly. It never runs in the browser or during an import.

## 9. Sanitization and validation pipeline

The browser pipeline is ordered and explicit:

```text
combineDocumentSources
  -> requestIcegridExtraction (raw rows + evidence)
  -> sanitizeEvidence
  -> normalizeCatalogFields
  -> applyMechanicalRules
  -> validateIcegridReport
  -> mapReportToTableData
```

Validation blocks the run only for structural failures:

- malformed response/schema;
- source-file mismatch;
- no rows;
- evidence refers to an unselected source in a way that makes the report structurally untrustworthy.

Row-level missing, unsupported, unknown, inconsistent, or suspicious values become blanks plus warnings so the user receives an editable table instead of losing all extracted work.

Warnings cover at least:

- field blanked because evidence is missing or invalid;
- unknown catalog value;
- ambiguous scheme code/label;
- district not belonging to state;
- missing required invoice fields;
- negative numeric values;
- non-eight-digit RITC;
- `ProductAmount` arithmetic mismatch without overwriting it;
- `IGST_Amount` arithmetic mismatch without overwriting it;
- serial anomalies corrected mechanically;
- cross-file conflict or ambiguous line match.

## 10. Trusted-output compatibility

Representative legacy fixtures must be copied into this repository or converted into deterministic test fixtures with checksums. They must not be read from the sibling legacy repository at test runtime.

Regression checks must preserve:

- exactly 37 ordered headers;
- row counts and invoice-line ordering;
- blank `Accessories`;
- `Per = 1` where absent;
- sparse outputs keeping unsupported customs fields blank;
- an explicit source `ProductAmount` being preserved;
- a missing `ProductAmount` remaining blank even when arithmetic is possible;
- literal `IGST_Rate = 18`, not percent-scaled output;
- source-backed `RoDTEPQty`, including cases where it differs from `Quantity`;
- complete canonical export-scheme values in all newly generated output.

The legacy fixtures contain both `19` and `19-Drawback (DBK)`. New output intentionally standardizes this to the complete canonical value required by this specification; tests must record that as an explicit migration rather than treating it as accidental mismatch.

## Appendix A: approved fixed values

Exact duplicates in the supplied source list are removed; no spelling is otherwise corrected silently.

### A.1 Quantity-unit catalog (70 unique values)

```text
BAG BAL BDL BGS BKL BLK BOU BOX BRL BTL BUN CAN CAS CBM CCM CFT CLS CMS
COL CON CRT CSK CTM CTN DOZ DRM FTS GGR GMS GRS GYD JRS KGS KIT KLR KME
LBS LOT LTR MGS MLT MOU MTR MTS NOS PAC PCS PKG PLT PRS QTL RLS ROL SAC
SET SHT SLB SQF SQM SQY TBS TGM THD TIN TON TUB UGS UNT VLS YDS
```

The supplied duplicate `RLS` is stored once.

### A.2 Applicable export schemes (complete stored values)

```text
00-Free Shipping bill
01-Advance Licence with actual user condition
02-Advance licence for intermediate supplies
03-Advance licence
04-Advance Release order
05-Advance Licence for deemed exports
06-DEPB-post exports
07-DEPB-pre exports
08-Replenishment licence
09-Diamond imprest licence
10-Bulk licence
11-Concessional duty EPCG scheme
12-Zero duty EPCG scheme
13-CCP
14-Import License For Restricted Items Of Imports
15-Special Import licence
16-Export licence
17-Advance Licence for annual requirement
18-Duty Free Replenishment Certificate
19-Drawback (DBK)
20-Jobbing (JBG)
21-EOU/EPZ/SEZ/EHTP/STP
22-SERVED FROM INDIA SCHEME
23-Target Plus Scheme
24-Vishesh Krishi Upaj Yojana
25-DFCE for Status Holder
26-Duty Free Import Authorisation
27-Focus Market Scheme
28-Focus Product Scheme
29-High-Tech Products Export Promotion Scheme
30-EPCG Duty Based
31-Status Holder Incentive Scheme
35-Incremental Incentivisation Scheme
36-MEIS
36-Merchandise Export Incentive Scheme
37-Service Export Incentive Scheme
40-DBK and Advance Licence for annual requirement
41-Drawback and Advance Licence
42-Drawback and DFRC
43-Drawback and zero duty EPCG
44-Drawback and concessional duty EPCG
45-Drawback and Pre export DEPB
46-Drawback and post export DEPB
47-Drawback and JBG
48-Drawback and Diamond Imprest licence
49-Drawback and EOU/EPZ/SEZ
50-EPCG and Advance licence
51-EPCG and DFRC
52-EPCG and JBG
53-EPCG and Diamond imprest Licence
54-EPCG and Replenishment Licences
55-EPCG and DEPB (Post exports)
56-EPCG and Advance Licence for annual requirement
56-EPCG and DEPB (Pre-exports)
59-EPCG AND DFIA
60-Drawback and Rebate of State Levies
61-EPCG,Drawback and Rebate of State Levies
62-Drawback and special DEEC(4.04A)
63-EPCG,Drawback and special DEEC(4.04A)
64-Drawback,special DEEC(4.04A) and Rebate of State Levis
65-EPCG,Drawback "&" special DEEC(4.04A) and Rebate of State Levis
71-EPCG, DRAWBACK AND DEEC
72-EPCG, DRAWBACK AND DFRC
73-EPCG, DRAWBACK AND JOBBING
74-EPCG, DRAWBACK AND DIAMOND IMPREST LICENCE
75-EPCG, DRAWBACK AND DEPB POST EXPORT
79-EPCG, DRAWBACK AND DFIA
98-Free Shipping Bill involving Indian Currency
99-NFEI
```

Codes `36` and `56` intentionally have multiple complete entries. A bare `36` or `56` is ambiguous and must remain blank unless the exact description is also supported or the user selects the intended complete value.

### A.3 EndUse catalog (44 unique values)

```text
DCA100 DCH100 DCH300 DCH400 DCH800 DCX200 DCX900 FSA100 FSA200 FSA800
FSA900 FSH100 FSH200 FSH700 FSH750 FSH800 FSH900 FSH910 FSH920 FSH930
GNX100 GNX200 GNX300 GNX600 GNX650 GNX680 GNX700 GNX810 GNX815 GNX915
LVA100 LVA200 LVA300 LVA400 LVA500 LVA710 LVA760 LVA800 LVA900 LVA950
LVP100 LVP400 LVP500 LVP730
```

The supplied duplicate `FSH700` is stored once.

### A.4 Small catalogs

```text
IGST_PaymentStatus: NA, LUT, P
RewardItem: Yes, No
RODTEP: Yes, No, N/A
```

### A.5 Official FTA codes observed in the ICEGATE directory snapshot

```text
FTA0SL FTA0SA FTA0NL FTA0BT FTA0TH CEPASG CEPASEA CEPAKR CEPAJP CECAMY
PTAAPTA GSTP PTA0SA PTA0AF PTA0MER PTA0CL NCPTI ECTAAU CEPAOM CEPAAE CETAUK
```

The generated official snapshot remains authoritative; this list is a shape/regression check, not permission to invent an FTA default.
