# ICEGrid Live Duty Lookup Design

## Goal

Let a human choose the drawback schedule serial from the candidates that actually apply to a tariff code, and settle RoDTEP eligibility honestly, without making an import depend on a third party staying up.

## The service

`impexcube.in` renders an empty page shell to a plain GET and fills its tables from JSON POSTs. Those POSTs are the interface; nothing is scraped.

```
POST /DutyStructureExport/FillDBK     {RITC, Country:'null', Mode:'DBK'}
POST /DutyStructureExport/GetDetails  {RITC, Country:'null', Mode:'RODEP'}
```

Two behaviours shape everything below. **Drawback is keyed on the four-digit heading** - `94032090` and `94038900` return the same three serials - so a tariff item is routinely offered several, and choosing between them is a classification only the exporter can make. **RoDTEP is keyed on all eight digits** - the same two codes give `KGS` and `NOS` - so it stays a derivation. An unknown code returns empty arrays rather than an error.

The service sends no CORS headers and its disclaimer says its contents carry no legal force. Both facts are load-bearing: the first is why a server route exists, the second is why nothing it says is ever asserted without provenance.

## Trust boundary

The lookup is layered **over** the bundled schedules, never replacing them. Every failure is per tariff code, becomes a warning, and falls back to `catalogs/generated/schedules.ts` - the behaviour every import had before this existed. An outage costs detail, not the run.

`set()` in `derive.ts` is fill-only, so nothing here can overwrite a value the documents supported or a human typed. A new `lookup` provenance marks what the service supplied, so a filing can be audited back to it.

## Per-column rules

| Column | Rule |
| --- | --- |
| `RITCCode` | Unchanged: extracted, strict verbatim evidence. Gates everything below; `<8` digits means no lookup. |
| `drawback_schno` | Printed serial wins; else a single candidate; else the residual "Others" line, marked a suggestion with the alternatives named in a warning. |
| `dbk_rate`, `dbk_desc`, `ROSLRate`, `ROSLCapValue` | Consequences of whichever serial the row carries. A serial the service does not list leaves them blank and warns. |
| `dbk_unit` | The schedule's unit for the chosen serial when it prescribes one, else the invoiced `QuantityUnit`. |
| `RODTEP` | `No` when the documents declare it (only they know a declined claim); `Yes` when the tariff item is in the schedule; `N/A` when it is absent. |
| `SQCUnit` | `uqcToUnit` of the RoDTEP statistical unit, as before. |
| `SQCQTY` | Unchanged, and the service cannot help: it equals `Quantity` only when the units agree, otherwise it is a packing-list weight. |
| `RoDTEPQty` | Tracks `SQCQTY`, and is not written at all when `RODTEP` is `N/A`. |
| `dbk_qty` | Unchanged: copies `Quantity`. |

## Why `RODTEP` keeps three states

Absent from Appendix 4R is not the same as refused. Writing `No` for an unlisted tariff item claims the question was considered and answered; `N/A` says it does not apply. `No` remains reachable and is the one RoDTEP fact a commercial invoice genuinely carries - a free shipping bill or an EOU/SEZ shipment declining an otherwise eligible claim. The reference corpus contains such rows (`corpus.test.ts` `rodtep-declined`), so collapsing to `Yes`/`N/A` would contradict workbooks verified by hand.

## Why the dropdown needed no core table change

Options are fetched per distinct tariff code and tagged `parentValue` = that eight-digit code, then `drawback_schno` depends on `RITCCode`. The table already narrows a dependent dropdown to options whose `parentValue` matches the row's dependency cell - the mechanism `DistrictOrigin` uses against `StateOrigin`. Per-row scoping therefore falls out for free, and `normalizeParentKey` normalizes both sides identically so leading-zero codes compare correctly.

`drawback_schno` is a `dropdown` with `runtimeOptions`, deliberately **not** a `catalog`. A catalog-backed value must resolve to a catalog entry or be cleared, and a serial the documents printed has to survive an unreachable lookup. `allowCustom` stays true for the same reason: the service can be down, and a broker can be right against it.

## Non-goals

- Recomputing `dbk_rate`/`dbk_desc`/`dbk_unit` when a human edits the serial in the grid. They are filled at import from the serial the row lands on. Editing the serial afterwards leaves them stale - which is exactly what hand-editing that column did before this change, so nothing regressed, but it is the obvious next piece.
- Caching beyond process lifetime, or any TTL. The schedule changes by annual notification.
- Trusting the service over the documents, or over the bundled notification, for anything.
