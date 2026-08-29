# Multi-Cell Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users Shift-select multiple cells in one column and replace them through the existing dropdown or inline editor as one undoable action.

**Architecture:** Keep selection in the table store and keep atomic writes in `store.applyCellPatches`. Add a small pure helper that snapshots edit targets from the current selection, add a second pure helper that intersects closed dependent-dropdown options, and let `DataTable.svelte` render one editor while committing its value to the captured targets. The target snapshot prevents focus changes from redirecting a pending edit.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Bun test runner, Playwright Chromium.

---

## File map

- Create `src/lib/table/range-edit.ts`: pure selection-to-edit-target resolution.
- Create `tests/app/range-edit.test.ts`: unit coverage for range qualification and sorted/filtered row targeting.
- Modify `src/lib/table/cells.ts`: resolve safe options shared by all rows in a bulk dropdown edit.
- Modify `tests/app/table-dropdown.test.ts`: unit coverage for common dependent-dropdown options.
- Modify `src/lib/table/DataTable.svelte`: preserve qualifying ranges, snapshot targets, bulk commit, retain range focus, and connect range-aware dropdown values/options.
- Modify `src/lib/table/DropdownCellEditor.svelte`: render an accessible empty state when no option is valid for the whole range.
- Modify `e2e/table.spec.ts`: browser coverage for all column types, keyboard behavior, Undo/Redo, cancellation, mixed-column fallback, and dependent dropdowns.
- Modify `README.md`: document the new range-replacement interaction and shortcut behavior.

Do not change `store.svelte.ts` or add another history mechanism. `applyCellPatches` already normalizes all supported types, skips no-ops, saves once, and creates exactly one Undo snapshot.

### Task 1: Resolve edit targets without mutating selection

**Files:**
- Create: `src/lib/table/range-edit.ts`
- Create: `tests/app/range-edit.test.ts`

- [ ] **Step 1: Write the failing target-resolution tests**

Create `tests/app/range-edit.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { resolveEditTargets } from '../../src/lib/table/range-edit';
import type { CellRef, SelectionRect } from '../../src/lib/table/store.svelte';
import type { Column, Row } from '../../src/lib/types';

const columns: Column[] = [
	{ id: 'name', name: 'Name', type: 'text' },
	{ id: 'status', name: 'Status', type: 'dropdown' }
];

const filteredRows: Row[] = [
	{ id: 'r3', name: 'C', status: 'Open' },
	{ id: 'r1', name: 'A', status: 'Open' },
	{ id: 'r2', name: 'B', status: 'Done' }
];

const active: CellRef = {
	rowId: 'r2',
	columnId: 'status',
	rowIndex: 2,
	colIndex: 1
};

describe('resolveEditTargets', () => {
	it('returns every visible row in a qualifying one-column selection', () => {
		const rect: SelectionRect = { r0: 0, r1: 2, c0: 1, c1: 1 };

		expect(resolveEditTargets(rect, active, active, filteredRows, columns)).toEqual([
			{ rowId: 'r3', columnId: 'status' },
			{ rowId: 'r1', columnId: 'status' },
			{ rowId: 'r2', columnId: 'status' }
		]);
	});

	it('falls back to only the requested cell for a one-cell selection', () => {
		const rect: SelectionRect = { r0: 2, r1: 2, c0: 1, c1: 1 };

		expect(resolveEditTargets(rect, active, active, filteredRows, columns)).toEqual([
			{ rowId: 'r2', columnId: 'status' }
		]);
	});

	it('falls back to only the requested cell for a multi-column rectangle', () => {
		const rect: SelectionRect = { r0: 0, r1: 2, c0: 0, c1: 1 };

		expect(resolveEditTargets(rect, active, active, filteredRows, columns)).toEqual([
			{ rowId: 'r2', columnId: 'status' }
		]);
	});

	it('does not reuse a range when editing a cell other than the active cell', () => {
		const rect: SelectionRect = { r0: 0, r1: 2, c0: 1, c1: 1 };
		const requested: CellRef = {
			rowId: 'r1',
			columnId: 'status',
			rowIndex: 1,
			colIndex: 1
		};

		expect(resolveEditTargets(rect, active, requested, filteredRows, columns)).toEqual([
			{ rowId: 'r1', columnId: 'status' }
		]);
	});
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run:

```bash
bun test tests/app/range-edit.test.ts
```

Expected: FAIL because `src/lib/table/range-edit.ts` does not exist.

- [ ] **Step 3: Implement the pure target resolver**

Create `src/lib/table/range-edit.ts`:

```ts
import type { Column, Row } from '$lib/types';
import type { CellRef, SelectionRect } from './store.svelte';

export interface EditTarget {
	rowId: string;
	columnId: string;
}

function sameCell(a: CellRef | null, b: CellRef): boolean {
	return a?.rowId === b.rowId && a.columnId === b.columnId;
}

export function resolveEditTargets(
	rect: SelectionRect | null,
	activeCell: CellRef | null,
	requestedCell: CellRef,
	filteredRows: readonly Row[],
	columns: readonly Column[]
): EditTarget[] {
	const single = [{ rowId: requestedCell.rowId, columnId: requestedCell.columnId }];
	if (
		!rect ||
		rect.r1 <= rect.r0 ||
		rect.c0 !== rect.c1 ||
		!sameCell(activeCell, requestedCell) ||
		columns[rect.c0]?.id !== requestedCell.columnId
	) {
		return single;
	}

	const targets: EditTarget[] = [];
	for (let rowIndex = rect.r0; rowIndex <= rect.r1; rowIndex++) {
		const row = filteredRows[rowIndex];
		if (row) targets.push({ rowId: row.id, columnId: requestedCell.columnId });
	}
	return targets.length > 1 ? targets : single;
}
```

- [ ] **Step 4: Run the focused tests and type checker**

Run:

```bash
bun test tests/app/range-edit.test.ts
bun run check
```

Expected: 4 tests PASS; `svelte-check` reports 0 errors and 0 warnings.

- [ ] **Step 5: Commit the target resolver**

```bash
git add src/lib/table/range-edit.ts tests/app/range-edit.test.ts
git commit -m "test(table): define bulk edit target resolution"
```

### Task 2: Intersect dependent dropdown options safely

**Files:**
- Modify: `src/lib/table/cells.ts:50-108`
- Modify: `tests/app/table-dropdown.test.ts`

- [ ] **Step 1: Add failing common-option tests**

Change the `cells.ts` import in `tests/app/table-dropdown.test.ts` to:

```ts
import {
	resolveDropdownOptions,
	resolveDropdownOptionsForRows,
	dropdownOptionLabel
} from '../../src/lib/table/cells';
```

Then add this block before `describe('dropdownOptionLabel', ...)`:

```ts
describe('resolveDropdownOptionsForRows', () => {
	const sharedDistrictCol: Column = {
		id: 'DistrictOrigin',
		name: 'DistrictOrigin',
		type: 'dropdown',
		dropdown: {
			options: [
				{ value: 'ANY', label: 'ALL DISTRICTS', parentValue: '8' },
				{ value: '102', label: 'JAIPUR', parentValue: '8' },
				{ value: 'ANY', label: 'ALL DISTRICTS', parentValue: '9' },
				{ value: '171', label: 'GHAZIABAD', parentValue: '9' }
			],
			allowCustom: false,
			dependsOnColumnId: 'StateOrigin'
		}
	};

	const rows: Row[] = [
		{ id: 'r1', StateOrigin: '08', DistrictOrigin: '102' },
		{ id: 'r2', StateOrigin: '09', DistrictOrigin: '171' }
	];

	it('keeps only configured values valid for every selected parent', () => {
		expect(
			resolveDropdownOptionsForRows(sharedDistrictCol, rows[0], rows, rows).map((o) => o.value)
		).toEqual(['ANY']);
	});

	it('returns no options when closed dependent rows share no valid value', () => {
		expect(resolveDropdownOptionsForRows(districtCol, rows[0], rows, rows)).toEqual([]);
	});

	it('does not treat the same stale current value as a valid shared option', () => {
		const staleRows: Row[] = [
			{ id: 'r1', StateOrigin: '08', DistrictOrigin: 'STALE' },
			{ id: 'r2', StateOrigin: '09', DistrictOrigin: 'STALE' }
		];
		expect(resolveDropdownOptionsForRows(districtCol, staleRows[0], staleRows, staleRows)).toEqual([]);
	});

	it('keeps ordinary dropdown behavior when the catalog is not closed and dependent', () => {
		expect(
			resolveDropdownOptionsForRows(stateCol, rows[0], rows, rows).map((o) => o.value)
		).toEqual(['08', '09']);
	});
});
```

- [ ] **Step 2: Run the focused test and verify the missing-export failure**

Run:

```bash
bun test tests/app/table-dropdown.test.ts
```

Expected: FAIL because `resolveDropdownOptionsForRows` is not exported.

- [ ] **Step 3: Implement the range-aware option resolver**

Add this function after `resolveDropdownOptions` and before `normalizeParentKey` in `src/lib/table/cells.ts`:

```ts
/**
 * Options safe to apply to every row in one dropdown range.
 * Only a closed dependent catalog needs intersection; ordinary and custom dropdowns
 * retain their active-row behavior.
 */
export function resolveDropdownOptionsForRows(
	column: Column,
	activeRow: Row | undefined,
	selectedRows: readonly Row[],
	allRows: readonly Row[]
): DropdownOption[] {
	const activeOptions = resolveDropdownOptions(column, activeRow, allRows);
	const config = column.dropdown;
	const dependsOn = config?.dependsOnColumnId;
	if (selectedRows.length <= 1 || !config || !dependsOn || config.allowCustom !== false) {
		return activeOptions;
	}

	return activeOptions.filter((candidate) =>
		selectedRows.every((row) => {
			const parentKey = normalizeParentKey(
				typeof row[dependsOn] === 'string' ? String(row[dependsOn]) : undefined
			);
			if (!parentKey) return false;
			return config.options.some(
				(option) =>
					option.value.toLowerCase() === candidate.value.toLowerCase() &&
					normalizeParentKey(option.parentValue) === parentKey
			);
		})
	);
}
```

- [ ] **Step 4: Run dropdown tests and all unit tests**

Run:

```bash
bun test tests/app/table-dropdown.test.ts
bun test tests
```

Expected: all dropdown tests PASS; the complete unit suite has 0 failures.

- [ ] **Step 5: Commit safe dropdown intersection**

```bash
git add src/lib/table/cells.ts tests/app/table-dropdown.test.ts
git commit -m "feat(table): intersect bulk dropdown options"
```

### Task 3: Bulk-commit text and dropdown ranges

**Files:**
- Modify: `e2e/table.spec.ts:4-26`
- Modify: `e2e/table.spec.ts` after the navigation/editing test
- Modify: `src/lib/table/DataTable.svelte:1-405`
- Modify: `src/lib/table/DataTable.svelte:784-836`
- Modify: `src/lib/table/DropdownCellEditor.svelte:9-26`
- Modify: `src/lib/table/DropdownCellEditor.svelte:159-181`

- [ ] **Step 1: Add failing browser tests for the two primary paths**

Add these tests after `supports Excel-style roving tabindex arrow navigation and in-place editing` in `e2e/table.spec.ts`:

```ts
test('replaces a Shift-selected text range and undoes it in one step', async ({ page }) => {
	const rows = page.locator('tbody tr.data-row');
	const first = rows.nth(0).locator('td.td-cell').nth(0);
	const third = rows.nth(2).locator('td.td-cell').nth(0);

	await first.click();
	await third.click({ modifiers: ['Shift'] });
	await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);

	await page.keyboard.press('U');
	const input = third.locator('input.cell-input');
	await input.fill('Unified plan');
	await input.press('Enter');

	for (let index = 0; index < 3; index++) {
		await expect(rows.nth(index).locator('td.td-cell').nth(0)).toContainText('Unified plan');
	}
	await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);

	await page.locator('button[aria-label="Undo"]').click();
	await expect(rows.nth(0).locator('td.td-cell').nth(0)).toContainText('Starter Cloud');
	await expect(rows.nth(1).locator('td.td-cell').nth(0)).toContainText('Developer Sandbox');
	await expect(rows.nth(2).locator('td.td-cell').nth(0)).toContainText('Plan 3');

	await page.locator('button[aria-label="Redo"]').click();
	for (let index = 0; index < 3; index++) {
		await expect(rows.nth(index).locator('td.td-cell').nth(0)).toContainText('Unified plan');
	}
});

test('choosing one dropdown option replaces the selected dropdown range', async ({ page }) => {
	const rows = page.locator('tbody tr.data-row');
	const first = rows.nth(0).locator('td.td-cell').nth(1);
	const third = rows.nth(2).locator('td.td-cell').nth(1);

	await first.click();
	await third.click({ modifiers: ['Shift'] });
	await third.locator('button[aria-label="Open dropdown options"]').click();
	const popover = third.locator('.custom-dropdown-popover');
	await expect(popover.locator('[role="option"][aria-selected="true"]')).toHaveCount(0);
	await popover.locator('button.dropdown-opt-btn', { hasText: 'Trial' }).click();

	for (let index = 0; index < 3; index++) {
		await expect(rows.nth(index).locator('td.td-cell').nth(1)).toContainText('Trial');
	}
	await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);

	await page.locator('button[aria-label="Undo"]').click();
	await expect(rows.nth(0).locator('td.td-cell').nth(1)).toContainText('Active');
	await expect(rows.nth(1).locator('td.td-cell').nth(1)).toContainText('Trial');
	await expect(rows.nth(2).locator('td.td-cell').nth(1)).toContainText('Pending');
});

test('a custom dropdown value replaces the selected dropdown range', async ({ page }) => {
	const rows = page.locator('tbody tr.data-row');
	const first = rows.nth(0).locator('td.td-cell').nth(1);
	const second = rows.nth(1).locator('td.td-cell').nth(1);

	await first.click();
	await second.click({ modifiers: ['Shift'] });
	await page.keyboard.press('Enter');
	const search = second.locator('input.dropdown-search-input');
	await search.fill('Archived');
	await search.press('Enter');

	await expect(first).toContainText('Archived');
	await expect(second).toContainText('Archived');
	await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(2);
});
```

- [ ] **Step 2: Build and run only the two new tests to verify failure**

Run:

```bash
bun run build
bunx playwright test e2e/table.spec.ts --grep "replaces a Shift-selected text range|choosing one dropdown option|custom dropdown value"
```

Expected: all 3 tests FAIL because editing collapses the range and only one cell changes. The initial `bun run build` is mandatory because Playwright preview serves the last build.

- [ ] **Step 3: Capture edit targets and bulk-commit through the store**

In `src/lib/table/DataTable.svelte`, change the cell imports to:

```ts
import { resolveDropdownOptionsForRows } from './cells';
import { resolveEditTargets, type EditTarget } from './range-edit';
```

Replace `let editingCell...` and the nearby edit state with:

```ts
let editingCell = $state<{ rowId: string; columnId: string } | null>(null);
let editTargets = $state<EditTarget[]>([]);
let cellNodes = new Map<string, HTMLElement>();
let editValue = $state<string>('');
```

Replace `getCellDropdownOptions`, `startEditing`, `commitEdit`, and `cancelEdit` with:

```ts
function rowsForEditTargets(): Row[] {
	const rowMap = new Map(store.rows.map((row) => [row.id, row]));
	return editTargets.flatMap((target) => {
		const row = rowMap.get(target.rowId);
		return row ? [row] : [];
	});
}

function getCellDropdownOptions(col: Column, rowId: string) {
	const activeRow = store.rows.find((row) => row.id === rowId);
	return resolveDropdownOptionsForRows(col, activeRow, rowsForEditTargets(), store.rows);
}

function dropdownEditorValue(columnId: string): string {
	const selectedRows = rowsForEditTargets();
	if (selectedRows.length <= 1) return editValue;
	const first = selectedRows[0]?.[columnId] ?? null;
	return selectedRows.every((row) => Object.is(row[columnId] ?? null, first))
		? String(first ?? '')
		: '';
}

function dropdownEditorIsMixed(columnId: string): boolean {
	const selectedRows = rowsForEditTargets();
	if (selectedRows.length <= 1) return false;
	const first = selectedRows[0]?.[columnId] ?? null;
	return !selectedRows.every((row) => Object.is(row[columnId] ?? null, first));
}

function startEditing(rowId: string, columnId: string, initialVal: unknown) {
	const requestedCell = {
		rowId,
		columnId,
		rowIndex: store.filteredRows.findIndex((row) => row.id === rowId),
		colIndex: store.columns.findIndex((column) => column.id === columnId)
	};
	const targets = resolveEditTargets(
		store.selectionRect,
		store.activeCell,
		requestedCell,
		store.filteredRows,
		store.columns
	);
	if (targets.length === 1) store.setSelection(requestedCell);
	editTargets = targets;
	editingCell = { rowId, columnId };
	editValue = initialVal !== null && initialVal !== undefined ? String(initialVal) : '';
}

function commitEdit(): boolean {
	if (!editingCell) return false;
	const wasBulk = editTargets.length > 1;
	store.applyCellPatches(
		editTargets.map((target) => ({
			rowId: target.rowId,
			columnId: target.columnId,
			newValue: editValue
		}))
	);
	const { rowId, columnId } = editingCell;
	editingCell = null;
	editTargets = [];
	cellNodes.get(`${rowId}-${columnId}`)?.focus();
	return wasBulk;
}

function cancelEdit() {
	editingCell = null;
	editTargets = [];
	if (activeCell) cellNodes.get(`${activeCell.rowId}-${activeCell.columnId}`)?.focus();
}
```

Delete the old `resolveDropdownOptions` import; it is replaced by `resolveDropdownOptionsForRows`.

- [ ] **Step 4: Keep bulk ranges stationary on Enter and Tab**

Replace `handleEditorKeyDown` with:

```ts
function handleEditorKeyDown(e: KeyboardEvent, rowIndex: number, colIndex: number) {
	e.stopPropagation();
	if (e.key === 'Enter') {
		e.preventDefault();
		const wasBulk = commitEdit();
		if (!wasBulk && rowIndex < store.filteredRows.length - 1) {
			const nextRow = store.filteredRows[rowIndex + 1];
			selectCell(nextRow.id, store.columns[colIndex].id, rowIndex + 1, colIndex);
		}
	} else if (e.key === 'Escape') {
		e.preventDefault();
		cancelEdit();
	} else if (e.key === 'Tab') {
		e.preventDefault();
		const wasBulk = commitEdit();
		if (wasBulk) return;
		if (e.shiftKey) {
			if (colIndex > 0) {
				selectCell(store.filteredRows[rowIndex].id, store.columns[colIndex - 1].id, rowIndex, colIndex - 1);
			}
		} else if (colIndex < store.columns.length - 1) {
			selectCell(store.filteredRows[rowIndex].id, store.columns[colIndex + 1].id, rowIndex, colIndex + 1);
		}
	}
}
```

Using a boolean return avoids reading `editTargets` after `commitEdit` clears them.

- [ ] **Step 5: Wire the dropdown editor to range state and preserve active-cell chevron selection**

In the dropdown chevron click handler, replace the unconditional `selectCell` call with:

```ts
if (!isActive) selectCell(row.id, col.id, rowIndex, colIndex);
startEditing(row.id, col.id, cellVal);
```

Change the dropdown editor props to:

```svelte
<DropdownCellEditor
	value={dropdownEditorValue(col.id)}
	mixed={dropdownEditorIsMixed(col.id)}
	options={getCellDropdownOptions(col, row.id)}
	allowCustom={col.dropdown?.allowCustom ?? true}
	triggerEl={cellNodes.get(cellKey)}
	onCommit={(newVal) => {
		editValue = newVal;
		commitEdit();
	}}
	onCancel={cancelEdit}
/>
```

In `DropdownCellEditor.svelte`, add the optional prop and default:

```ts
interface Props {
	value: string | null;
	mixed?: boolean;
	options: DropdownOption[];
	allowCustom?: boolean;
	triggerEl?: HTMLElement | null;
	onCommit: (val: string) => void;
	onCancel: () => void;
}

let {
	value,
	mixed = false,
	options,
	allowCustom = true,
	triggerEl = null,
	onCommit,
	onCancel
}: Props = $props();
```

Change Clear's selection state to:

```svelte
aria-selected={!mixed && (value === '' || value === null)}
```

Change each regular option's `isSelected` constant to:

```svelte
{@const isSelected = !mixed && (value || '').toLowerCase() === opt.value.toLowerCase()}
```

`mixed` must remain separate from an empty string: a uniformly empty range should announce Clear as selected, while a range containing different values should announce no selected option.

- [ ] **Step 6: Rebuild and rerun the focused browser tests**

Run:

```bash
bun run build
bunx playwright test e2e/table.spec.ts --grep "replaces a Shift-selected text range|choosing one dropdown option|custom dropdown value"
```

Expected: 3 tests PASS.

- [ ] **Step 7: Run checks and commit the primary feature**

Run:

```bash
bun run check
bun test tests/app/range-edit.test.ts tests/app/table-dropdown.test.ts
```

Expected: 0 Svelte errors/warnings and all focused unit tests PASS.

Commit:

```bash
git add src/lib/table/DataTable.svelte src/lib/table/DropdownCellEditor.svelte e2e/table.spec.ts
git commit -m "feat(table): replace selected cells through one editor"
```

### Task 4: Cover every typed editor and cancellation path

**Files:**
- Modify: `e2e/table.spec.ts:4-26`
- Modify: `e2e/table.spec.ts` after the primary bulk-replace tests
- Modify: `tests/app/table.test.ts`

- [ ] **Step 1: Lock down the existing atomic no-op behavior**

Add this test beside the existing `applyCellPatches` test in `tests/app/table.test.ts`:

```ts
it('creates no history entry when every bulk patch is unchanged', () => {
	const applied = store.applyCellPatches([
		{ rowId: 'r1', columnId: 'c1', newValue: 'SaaS Core' },
		{ rowId: 'r2', columnId: 'c1', newValue: 'Enterprise Addon' }
	]);

	expect(applied).toBe(0);
	expect(store.history).toHaveLength(0);
	expect(store.canUndo).toBe(false);
});
```

Run:

```bash
bun test tests/app/table.test.ts
```

Expected: all table-store tests PASS, proving bulk UI commits can safely use the existing no-op behavior.

- [ ] **Step 2: Extend the browser fixture with percent and date columns**

Append these columns after `c4` in `FIXTURE.columns`:

```ts
{ id: 'c5', name: 'Conversion', type: 'percent', width: 130 },
{ id: 'c6', name: 'Renewal Date', type: 'date', width: 150 }
```

Append these values to every generated fixture row:

```ts
c5: 0.05 + i / 1000,
c6: `2026-09-${String((i % 25) + 1).padStart(2, '0')}`
```

Update the sticky-header assertion to include `Conversion` and `Renewal Date`:

```ts
await expect(headers).toContainText([
	'#',
	'Product Plan',
	'Tier',
	'Monthly Price',
	'Active Accounts',
	'Conversion',
	'Renewal Date'
]);
```

- [ ] **Step 3: Add typed-range and Escape acceptance tests**

Add:

```ts
test('replaces currency, number, percent and date ranges through typed editors', async ({ page }) => {
	const rows = page.locator('tbody tr.data-row');
	const cases = [
		{ colIndex: 2, input: '321', rendered: '$321.00', commit: 'tab' },
		{ colIndex: 3, input: '42', rendered: '42', commit: 'tab' },
		{ colIndex: 4, input: '12.5%', rendered: '12.5%', commit: 'tab' },
		{ colIndex: 5, input: '2026-12-31', rendered: '2026-12-31', commit: 'blur' }
	];

	for (const item of cases) {
		const first = rows.nth(0).locator('td.td-cell').nth(item.colIndex);
		const third = rows.nth(2).locator('td.td-cell').nth(item.colIndex);
		await first.click();
		await third.click({ modifiers: ['Shift'] });
		await page.keyboard.press('Enter');
		const input = third.locator('input.cell-input');
		await input.fill(item.input);
		if (item.commit === 'tab') await input.press('Tab');
		else await page.locator('.search-box input').click();

		for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
			await expect(rows.nth(rowIndex).locator('td.td-cell').nth(item.colIndex)).toContainText(
				item.rendered
			);
		}
		await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);
	}
});

test('Escape cancels a range edit without changing or collapsing the selection', async ({ page }) => {
	const rows = page.locator('tbody tr.data-row');
	const first = rows.nth(0).locator('td.td-cell').nth(0);
	const third = rows.nth(2).locator('td.td-cell').nth(0);

	await first.click();
	await third.click({ modifiers: ['Shift'] });
	await page.keyboard.press('F2');
	const input = third.locator('input.cell-input');
	await input.fill('Cancelled value');
	await input.press('Escape');

	await expect(rows.nth(0).locator('td.td-cell').nth(0)).toContainText('Starter Cloud');
	await expect(rows.nth(1).locator('td.td-cell').nth(0)).toContainText('Developer Sandbox');
	await expect(rows.nth(2).locator('td.td-cell').nth(0)).toContainText('Plan 3');
	await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(3);
});

test('editing a mixed-column rectangle changes only its active cell', async ({ page }) => {
	const rows = page.locator('tbody tr.data-row');
	const topLeft = rows.nth(0).locator('td.td-cell').nth(0);
	const bottomRight = rows.nth(1).locator('td.td-cell').nth(1);

	await topLeft.click();
	await bottomRight.click({ modifiers: ['Shift'] });
	await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(4);
	await page.keyboard.press('Enter');
	await expect(page.locator('td.td-cell[aria-selected="true"]')).toHaveCount(1);

	const popover = bottomRight.locator('.custom-dropdown-popover');
	await popover.locator('button.dropdown-opt-btn', { hasText: 'Pending' }).click();
	await expect(rows.nth(1).locator('td.td-cell').nth(1)).toContainText('Pending');
	await expect(rows.nth(0).locator('td.td-cell').nth(1)).toContainText('Active');
});
```

- [ ] **Step 4: Run the new browser tests**

Run:

```bash
bun run build
bunx playwright test e2e/table.spec.ts --grep "currency, number, percent and date|Escape cancels|mixed-column rectangle"
```

Expected: 3 tests PASS. A failure means Task 3 is incomplete; stop and diagnose it before continuing rather than weakening an assertion.

- [ ] **Step 5: Commit typed editor coverage**

```bash
git add e2e/table.spec.ts tests/app/table.test.ts
git commit -m "test(table): cover typed range replacement"
```

### Task 5: Explain an empty dependent-dropdown intersection

**Files:**
- Modify: `src/lib/table/DropdownCellEditor.svelte:9-26`
- Modify: `src/lib/table/DropdownCellEditor.svelte:157-207`
- Modify: `src/lib/table/DataTable.svelte:799-811`
- Modify: `e2e/table.spec.ts`

- [ ] **Step 1: Add a dependent-dropdown fixture and failing empty-state test**

Add this constant after `FIXTURE` in `e2e/table.spec.ts`:

```ts
const DEPENDENT_DROPDOWN_FIXTURE = {
	version: 2,
	title: 'Dependent Dropdowns',
	columns: [
		{
			id: 'state',
			name: 'State',
			type: 'dropdown',
			width: 150,
			dropdown: {
				options: [{ value: '08' }, { value: '09' }],
				allowCustom: false
			}
		},
		{
			id: 'district',
			name: 'District',
			type: 'dropdown',
			width: 180,
			dropdown: {
				options: [
					{ value: '102', label: 'JAIPUR', parentValue: '8' },
					{ value: '171', label: 'GHAZIABAD', parentValue: '9' }
				],
				allowCustom: false,
				dependsOnColumnId: 'state'
			}
		}
	],
	rows: [
		{ id: 'r1', state: '08', district: '102' },
		{ id: 'r2', state: '09', district: '171' }
	]
};
```

Add this test:

```ts
test('shows when no dependent dropdown option is valid for the whole selection', async ({ page }) => {
	await page.evaluate((doc) => {
		const id = 'd_dependent';
		localStorage.setItem(`xlsx-ai:doc:${id}`, JSON.stringify(doc));
		localStorage.setItem(
			'xlsx-ai:docs:v1',
			JSON.stringify({
				docs: [{ id, title: doc.title, updatedAt: new Date().toISOString() }],
				activeId: id
			})
		);
	}, DEPENDENT_DROPDOWN_FIXTURE);
	await page.reload();

	const rows = page.locator('tbody tr.data-row');
	const first = rows.nth(0).locator('td.td-cell').nth(1);
	const second = rows.nth(1).locator('td.td-cell').nth(1);
	await first.click();
	await second.click({ modifiers: ['Shift'] });
	await page.keyboard.press('Enter');

	const popover = second.locator('.custom-dropdown-popover');
	await expect(popover.locator('.dropdown-empty-state')).toHaveText(
		'No options are valid for all selected cells.'
	);
	await expect(popover.locator('button.dropdown-opt-btn:not(.clear-opt-btn)')).toHaveCount(0);
	await popover.locator('input.dropdown-search-input').press('Escape');
	await expect(first).toContainText('102');
	await expect(second).toContainText('171');
});
```

- [ ] **Step 2: Build and confirm the empty-state test fails**

Run:

```bash
bun run build
bunx playwright test e2e/table.spec.ts --grep "no dependent dropdown option"
```

Expected: FAIL because `.dropdown-empty-state` is absent.

- [ ] **Step 3: Add the accessible empty-state prop and markup**

In `DropdownCellEditor.svelte`, add to `Props`:

```ts
emptyMessage?: string;
```

Destructure it with the other props:

```ts
emptyMessage = 'No matching options.',
```

Between the Clear button and the `{#each filteredOptions...}` block, add:

```svelte
{#if filteredOptions.length === 0 && !showCreate}
	<p
		class="dropdown-empty-state m-0 px-2.5 py-2 text-[11.5px] leading-snug text-[var(--text-3)]"
		role="status"
	>
		{emptyMessage}
	</p>
{/if}
```

In the `DropdownCellEditor` use in `DataTable.svelte`, pass:

```svelte
emptyMessage={editTargets.length > 1
	? 'No options are valid for all selected cells.'
	: 'No matching options.'}
```

- [ ] **Step 4: Rebuild and run dependent-dropdown coverage**

Run:

```bash
bun run build
bunx playwright test e2e/table.spec.ts --grep "no dependent dropdown option"
bun test tests/app/table-dropdown.test.ts
bun run check
```

Expected: browser test PASS, dropdown unit tests PASS, and 0 Svelte errors/warnings.

- [ ] **Step 5: Commit the empty state**

```bash
git add src/lib/table/DropdownCellEditor.svelte src/lib/table/DataTable.svelte e2e/table.spec.ts
git commit -m "feat(table): explain unavailable bulk dropdown options"
```

### Task 6: Document and verify the complete feature

**Files:**
- Modify: `README.md:10-48`

- [ ] **Step 1: Update feature and shortcut documentation**

In the `Range Selection & Cell Alignment` feature bullet, add this sentence:

```markdown
Shift-selected cells in one column can be replaced together through the normal dropdown or typed editor, with one-step Undo/Redo.
```

Add this row after `Shift + arrows / Shift + click` in the shortcut table:

```markdown
| Type or `Enter` / `F2` on a one-column range | Replace every selected cell through its typed editor |
```

- [ ] **Step 2: Run formatting and static checks**

Run:

```bash
git diff --check
bun run check
```

Expected: no whitespace errors; `svelte-check` reports 0 errors and 0 warnings.

- [ ] **Step 3: Run the complete unit suite**

Run:

```bash
bun test tests
```

Expected: all unit tests PASS with 0 failures.

- [ ] **Step 4: Run the complete browser suite from a fresh build**

Run:

```bash
bun run test:e2e
```

Expected: Vite build succeeds and all Chromium Playwright tests PASS. Do not substitute bare `playwright test`; it can exercise stale preview output.

- [ ] **Step 5: Review the final diff for scope and accidental changes**

Run:

```bash
git status --short
git diff --stat 71cb0a1..HEAD
git diff 71cb0a1..HEAD -- src/lib/table tests/app e2e/table.spec.ts README.md docs/superpowers/plans
```

Expected: only the files named in this plan changed; no generated build output, storage data, screenshots, or unrelated formatting is included.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain multi-cell replacement"
```

- [ ] **Step 7: Record verification evidence for review**

In the implementation handoff, report the exact successful commands and totals from:

```bash
bun run check
bun test tests
bun run test:e2e
git status --short
```

Expected: static checks, all unit tests, and all browser tests pass; `git status --short` is empty.

## Reviewer checklist

The reviewing agent should reject the implementation if any of these are true:

- `startEditing` always calls `store.setSelection` and therefore collapses a qualifying range.
- Bulk commit loops over `store.setCell`, creating multiple Undo entries or saves.
- Targets are recomputed after focus or selection changes instead of captured when editing starts.
- A multi-column selection bulk-replaces mixed column types.
- A closed dependent dropdown presents a value that is not configured for every selected row's parent.
- Mixed current dropdown values render one option as already selected.
- Enter or Tab moves/collapses a bulk range after commit.
- Escape mutates data or collapses the range.
- E2E tests were run without a fresh Vite build.
- The final worktree contains unrelated or uncommitted changes.
