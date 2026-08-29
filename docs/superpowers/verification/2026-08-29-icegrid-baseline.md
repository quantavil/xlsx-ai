# ICEGrid Accuracy Work — Pre-Implementation Baseline

**Date:** 2026-08-29
**Repo:** `/home/quantavil/Documents/Project/xlsx-ai`
**Commit:** `bb37153` (`style(settings): polish layout, scrolling and closing`)
**Plan:** `docs/superpowers/plans/2026-08-29-icegrid-accuracy-catalogs.md`
**Spec:** `docs/superpowers/specs/2026-08-29-icegrid-accuracy-catalogs-design.md`

Recorded before Layer 1 so that later regressions can be distinguished from
pre-existing failures. Nothing in this document was fixed as part of Task 0.1.

## 1. Working tree at start

`git status --short`:

```text
?? docs/superpowers/plans/2026-08-29-icegrid-accuracy-catalogs.md
?? docs/superpowers/specs/2026-08-29-icegrid-accuracy-catalogs-design.md
```

Both untracked files are the approved plan and spec. **There is no other
user-owned modified or untracked work.** Any file appearing in `git status`
from here on was created by this implementation.

## 2. Test baseline

### Plan-named focused suites

```bash
bun test tests/icegrid-schema.test.ts tests/icegrid-readers.test.ts \
         tests/icegrid-mapping.test.ts tests/icegrid-e2e-workflow.test.ts \
         tests/modules.test.ts
```

```text
30 pass
 0 fail
197 expect() calls
Ran 30 tests across 5 files. [2.67s]
```

### Full unit suite

```bash
bun test tests
```

```text
92 pass
 0 fail
413 expect() calls
Ran 92 tests across 11 files. [5.01s]
```

**Zero pre-existing failures. Zero skipped tests.** Any future failure is a
regression introduced by this work.

The `Warning: Indexing all PDF objects` lines emitted by
`tests/icegrid-readers.test.ts` and `tests/icegrid-e2e-workflow.test.ts` are
pdf.js diagnostics on the sample PDF, not failures.

### Type check

```bash
bun run check
```

```text
546 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

### Production build

```bash
bun run build
```

Succeeds — `✓ built in 16.56s`. The only console notice is
`@sveltejs/adapter-auto` reporting no detected production environment, which is
expected for local development and is not an error.

E2E (`bun run test:e2e`) was not run in Task 0.1; the plan schedules it for
Task 8.2.

## 3. Integration points

`rg -n "icegrid|WorkspaceModule|DropdownCellEditor|PersistedColumnSchema" src tests e2e`
touches these files:

### Production

| File | Role in this work |
| --- | --- |
| `src/lib/types.ts` | `Column` / `ColumnType` — gains `DropdownConfig` in Layer 1 |
| `src/lib/table/schema.ts:10` | `PersistedColumnSchema` — gains optional `dropdown` |
| `src/lib/table/persistence.ts` | localStorage adapter — must preserve `dropdown` |
| `src/lib/table/DataTable.svelte:188` | `getColumnUniqueValues(columnId)` — replaced by a `Column`+`Row` aware helper |
| `src/lib/table/DataTable.svelte:788` | `<DropdownCellEditor>` call site |
| `src/lib/table/DropdownCellEditor.svelte` | props change to `options: DropdownOption[]` + `allowCustom` |
| `src/lib/modules/types.ts:25` | `WorkspaceModule` — gains optional generic `settings` slot |
| `src/lib/modules/registry.ts:4` | `BUILTIN_MODULES` — unchanged |
| `src/lib/server/modules/registry.ts` | server AI handler registry — unchanged |
| `src/lib/components/RightRibbon.svelte:39` | module trigger + warning surfacing |
| `src/lib/modules/icegrid/*` | 618 lines total; the module under change |

### Tests

`tests/ai-client.test.ts`, `tests/ai.test.ts`, `tests/icegrid-e2e-workflow.test.ts`,
`tests/icegrid-mapping.test.ts`, `tests/icegrid-readers.test.ts`,
`tests/icegrid-schema.test.ts`, `tests/modules.test.ts`.

`e2e/table.spec.ts` contains no current match for these symbols.

### Current ICEGrid module size

```text
ai.server.ts    49
columns.ts      61
extract.ts      56
index.ts        62
readers.ts     197
schema.ts       59
to-table.ts     45
validate.ts     89
             ---
             618 lines
```

## 4. Corrections to the plan discovered during Task 0.1

Recorded here so Task 0.2 and Layer 2 do not stall on inputs that do not exist.

### 4.1 Task 0.2 fixture source does not exist (corrected)

The plan says to source fixture bytes from Git `HEAD` of
`/home/quantavil/Documents/Project/icegrid` and to copy checksum entries from
`tests/fixtures/legacy/SHA256SUMS`.

Verified against that repository at commit `a79d2aa`:

```text
tests/fixtures/
  sample.pdf        <- the only file
```

There is no `tests/fixtures/legacy/` directory and no `SHA256SUMS`.

**Correction applied:** fixtures are sourced from the trusted corpus at
`/home/quantavil/Downloads/INPUT & OUTPUT FILES/` (17 input/output cases), and
`tests/fixtures/icegrid/legacy/SHA256SUMS` is generated at copy time rather than
copied. The plan's own fixture directory name `input-10` matches `INPUT 10` /
`OUTPUT 10` in that corpus, so this is the corpus the plan intended.

### 4.2 Layer 2 Task 2.2 has no available source data (deferred decision)

Task 2.2 requires saved official ICEGATE exports at
`tools/icegrid/sources/icegate-{states.html,districts.csv,fta.html,countries.csv}`.

- The legacy repo has no checked-in ICEGATE state/district/FTA data.
  `src/domain/regions.ts` defines only the snapshot *shape* plus
  `isOfficialCustomsDirectory()`; the data was fetched at runtime by
  `src/customs/client.ts`.
- Legacy `src/domain/countries.ts` is ISO 3166-1 alpha-2 sourced from
  `iban.com`, not from ICEGATE.
- All three ICEGATE URLs named in the spec returned HTTP `000` / 0 bytes from
  this environment.

This is an unresolved input dependency for Layer 2, flagged now rather than at
Manual gate 2. It does not block Layers 0 or 1.

### 4.3 Golden-fixture assertions that do not hold for the corpus

Recorded now; Task 0.2 adapts each assertion minimally and documents it in the
test file.

| Plan assertion | Corpus reality |
| --- | --- |
| "one output worksheet" | 10 of 17 outputs carry a second `Guidelines` sheet holding the unit/scheme/EndUse catalogs |
| "exactly the 37 `ICEGRID_HEADERS` in order" | header 6 is `HAWBL_No` in 7 files and `HAWBL_NO` in 10; compared case-insensitively |
| numeric cell comparison | `ProductExportExcel` sheets store numbers as strings (`"1"`, `"18"`, `"45000.0000"`); `Sheet1` sheets store them as numbers |

## 5. Baseline summary

| Check | Result |
| --- | --- |
| `bun test tests` | 92 pass / 0 fail / 0 skip |
| Plan-named focused suites | 30 pass / 0 fail |
| `bun run check` | 546 files, 0 errors, 0 warnings |
| `bun run build` | success |
| Pre-existing failures | none |
| User-owned uncommitted work | plan + spec docs only |
