import { describe, it, expect, beforeEach } from 'bun:test';
import { createTableStore } from '../../src/lib/table/store.svelte';
import type { TableData } from '../../src/lib/types';
import { buildXlsxSheetData } from '../../src/lib/data/export';
import { compileFilters, passesColumnFilter } from '../../src/lib/table/filters';

function makeData(): TableData {
	return {
		title: 'Filter QA',
		columns: [
			{ id: 'c1', name: 'Name', type: 'text', width: 160 },
			{ id: 'c2', name: 'Score', type: 'number', width: 120 },
			{ id: 'c3', name: 'Price', type: 'currency', width: 120 },
			{ id: 'c4', name: 'Pct', type: 'percent', width: 120 },
			{ id: 'c5', name: 'Status', type: 'dropdown', width: 130 },
			{ id: 'c6', name: 'When', type: 'date', width: 150 },
			{ id: 'c7', name: 'Computed', type: 'number', width: 120 }
		],
		rows: [
			{ id: 'r1', c1: 'Alice', c2: 10, c3: 100, c4: 0.1, c5: 'Active', c6: '2026-01-10', c7: '=B2*2' },
			{ id: 'r2', c1: 'Bob', c2: 20, c3: 200, c4: 0.25, c5: 'Trial', c6: '2026-01-20', c7: '=B3*2' },
			{ id: 'r3', c1: 'Carol', c2: 30, c3: 300, c4: 0.5, c5: 'Active', c6: '2026-02-15', c7: '=B4*2' },
			{ id: 'r4', c1: 'Dave', c2: null as any, c3: null as any, c4: null as any, c5: '' as any, c6: '' as any, c7: null as any }
		]
	};
}

describe('Column filters', () => {
	let store: ReturnType<typeof createTableStore>;
	beforeEach(() => {
		store = createTableStore(makeData(), { persist: false });
	});

	it('value list filter on text column keeps only selected values', () => {
		store.setColumnFilter('c1', { kind: 'values', values: ['Alice', 'Carol'] });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r3']);
	});

	it('value list filter on status dropdown column', () => {
		store.setColumnFilter('c5', { kind: 'values', values: ['Active'] });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r3']);
	});

	it('condition contains on text column (case-insensitive)', () => {
		store.setColumnFilter('c1', { kind: 'condition', op: 'contains', value: 'ali' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1']);
	});

	it('condition does not contain', () => {
		store.setColumnFilter('c1', { kind: 'condition', op: 'notContains', value: 'ali' });
		expect(store.filteredRows.map((r) => r.c1).includes('Alice')).toBe(false);
	});

	it('condition equals on text', () => {
		store.setColumnFilter('c1', { kind: 'condition', op: 'eq', value: 'Bob' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2']);
	});

	it('condition startsWith / endsWith on text', () => {
		store.setColumnFilter('c1', { kind: 'condition', op: 'startsWith', value: 'Car' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r3']);
		store.clearColumnFilter('c1');
		store.setColumnFilter('c1', { kind: 'condition', op: 'endsWith', value: 'ob' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2']);
	});

	it('condition isEmpty / isNotEmpty on text', () => {
		store.setColumnFilter('c5', { kind: 'condition', op: 'isEmpty' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r4']);
		store.clearColumnFilter('c5');
		store.setColumnFilter('c5', { kind: 'condition', op: 'isNotEmpty' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
	});

	it('numeric equals and not equals', () => {
		store.setColumnFilter('c2', { kind: 'condition', op: 'eq', value: '20' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2']);
		store.setColumnFilter('c2', { kind: 'condition', op: 'neq', value: '20' });
		expect(store.filteredRows.map((r) => r.id).sort()).toEqual(['r1', 'r3', 'r4'].sort());
	});

	it('numeric > >= < <= ', () => {
		store.setColumnFilter('c2', { kind: 'condition', op: 'gt', value: '15' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2', 'r3']);
		store.setColumnFilter('c2', { kind: 'condition', op: 'gte', value: '20' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2', 'r3']);
		store.setColumnFilter('c2', { kind: 'condition', op: 'lt', value: '20' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1']);
		store.setColumnFilter('c2', { kind: 'condition', op: 'lte', value: '20' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r2']);
	});

	it('numeric between', () => {
		store.setColumnFilter('c2', { kind: 'condition', op: 'between', value: '15', value2: '25' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2']);
	});

	it('currency behaves like numeric', () => {
		store.setColumnFilter('c3', { kind: 'condition', op: 'gt', value: '150' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2', 'r3']);
	});

	it('percent behaves like numeric (0.25 == 25%)', () => {
		store.setColumnFilter('c4', { kind: 'condition', op: 'gte', value: '0.25' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2', 'r3']);
	});

	it('numeric isEmpty / isNotEmpty', () => {
		store.setColumnFilter('c2', { kind: 'condition', op: 'isEmpty' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r4']);
		store.setColumnFilter('c2', { kind: 'condition', op: 'isNotEmpty' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
	});

	it('date before / after / on / between', () => {
		store.setColumnFilter('c6', { kind: 'condition', op: 'before', value: '2026-01-15' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1']);
		store.setColumnFilter('c6', { kind: 'condition', op: 'after', value: '2026-01-15' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2', 'r3']);
		store.setColumnFilter('c6', { kind: 'condition', op: 'on', value: '2026-01-20' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2']);
		store.setColumnFilter('c6', { kind: 'condition', op: 'between', value: '2026-01-11', value2: '2026-02-10' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2']);
	});

	it('date isEmpty / isNotEmpty', () => {
		store.setColumnFilter('c6', { kind: 'condition', op: 'isEmpty' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r4']);
		store.setColumnFilter('c6', { kind: 'condition', op: 'isNotEmpty' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
	});

	it('multiple columns AND together', () => {
		store.setColumnFilter('c5', { kind: 'values', values: ['Active'] });
		store.setColumnFilter('c2', { kind: 'condition', op: 'gte', value: '30' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r3']);
	});

	it('filter composes with global search (AND)', () => {
		store.setColumnFilter('c5', { kind: 'values', values: ['Active'] }); // r1,r3
		store.setSearchQuery('Carol');
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r3']);
		store.setSearchQuery('');
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r3']);
	});

	it('filter composes with sort', () => {
		store.setColumnFilter('c5', { kind: 'values', values: ['Active'] });
		store.setSort('c2'); // asc
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1', 'r3']); // 10,30
		store.setSort('c2'); // desc
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r3', 'r1']);
	});

	it('reads from resolved/computed rows: formula cell filters by computed value', () => {
		// r1:c7 = B2*2 = 20, r2:c7=40, r3:60
		store.setColumnFilter('c7', { kind: 'condition', op: 'eq', value: '40' });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2']);
		// value list on computed column
		store.clearColumnFilter('c7');
		store.setColumnFilter('c7', { kind: 'values', values: ['20', '60'] });
		expect(store.filteredRows.map((r) => r.id).sort()).toEqual(['r1', 'r3'].sort());
	});

	it('deleting a column clears its filter', () => {
		store.setColumnFilter('c1', { kind: 'values', values: ['Alice'] });
		store.deleteColumn('c1');
		expect((store as any).columnFilters['c1']).toBeUndefined();
		expect(store.filteredRows.length).toBe(4);
	});

	it('loadTable clears filters (must not leak across documents)', () => {
		store.setColumnFilter('c1', { kind: 'values', values: ['Alice'] });
		expect(store.filteredRows.length).toBe(1);
		store.loadTable(makeData(), { undoable: false });
		expect(store.filteredRows.length).toBe(4);
		expect(Object.keys((store as any).columnFilters).length).toBe(0);
	});

	it('newSheet clears filters', () => {
		store.setColumnFilter('c1', { kind: 'values', values: ['Alice'] });
		store.newSheet({ undoable: false });
		expect(Object.keys((store as any).columnFilters).length).toBe(0);
	});

	it('clearColumnFilter and clearAllFilters work', () => {
		store.setColumnFilter('c1', { kind: 'values', values: ['Alice'] });
		store.setColumnFilter('c2', { kind: 'condition', op: 'gt', value: '15' });
		expect(store.filteredRows.length).toBe(0); // Alice has score 10 not >15
		store.clearColumnFilter('c1');
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r2', 'r3']);
		store.clearAllFilters();
		expect(store.filteredRows.length).toBe(4);
	});

	it('row gutter keeps numbering by storage row (sheetRowFor)', () => {
		// storage rows: r1=2,r2=3,r3=4,r4=5
		store.setColumnFilter('c2', { kind: 'condition', op: 'gt', value: '15' }); // leaves r2,r3
		expect(store.filteredRows.map(r => r.id)).toEqual(['r2','r3']);
		expect(store.sheetRowFor('r2')).toBe(3);
		expect(store.sheetRowFor('r3')).toBe(4);
		expect(store.sheetRowFor('r1')).toBe(2);
		expect(store.sheetRowFor('r4')).toBe(5);
	});

	it('drops the selection rect when the anchored row is filtered out', () => {
		store.setSelection({ rowId: 'r3', columnId: 'c1', rowIndex: 2, colIndex: 0 });
		expect(store.selectionRect).not.toBeNull();

		// r3 is gone from the view, so there is no rectangle to draw. DataTable's own
		// effect is what re-clamps the selection; the store's contract is only that
		// asking for the rect of a filtered-out row is null rather than out of bounds.
		store.setColumnFilter('c1', { kind: 'values', values: ['Alice'] });
		expect(store.filteredRows.map((r) => r.id)).toEqual(['r1']);
		expect(store.selectionRect).toBeNull();

		store.clearColumnFilter('c1');
		expect(store.selectionRect).not.toBeNull();
	});

	it('export writes full sheet, not filtered view (match search behavior)', () => {
		store.setColumnFilter('c1', { kind: 'values', values: ['Alice'] });
		expect(store.filteredRows.length).toBe(1);
		const sheet = buildXlsxSheetData({ title: store.title, columns: store.columns, rows: store.rows, cellAlign: store.cellAlign });
		// header + 4 rows
		expect(sheet.length).toBe(5);
	});

	it('value filter with empty string selects empty rows', () => {
		store.setColumnFilter('c5', { kind: 'values', values: [''] });
		expect(store.filteredRows.map(r=>r.id)).toEqual(['r4']);
	});

	it('condition text contains does not treat empty filter as match-all?', () => {
		store.setColumnFilter('c1', { kind: 'condition', op: 'contains', value: '' });
		// empty contains should match all (every string contains "")
		expect(store.filteredRows.length).toBe(4);
	});
});

describe('date conditions across formats', () => {
	// `Date.parse('2026-01-10')` is UTC midnight while `Date.parse('01/10/2026')` is
	// local midnight, so west of Greenwich the two land on different calendar days.
	it('matches a US-formatted cell against an ISO filter value on `on`', () => {
		const filter = { kind: 'condition', op: 'on', value: '2026-01-10' } as const;
		expect(passesColumnFilter('01/10/2026', filter, 'date')).toBe(true);
		expect(passesColumnFilter('2026-01-10', filter, 'date')).toBe(true);
		expect(passesColumnFilter('01/11/2026', filter, 'date')).toBe(false);
	});

	it('keeps `between` inclusive on its own endpoints in either format', () => {
		const filter = { kind: 'condition', op: 'between', value: '2026-01-10', value2: '2026-01-20' } as const;
		expect(passesColumnFilter('01/10/2026', filter, 'date')).toBe(true);
		expect(passesColumnFilter('2026-01-20', filter, 'date')).toBe(true);
		expect(passesColumnFilter('01/21/2026', filter, 'date')).toBe(false);
	});
});

describe('compileFilters', () => {
	it('ignores a filter naming a column that no longer exists', () => {
		const columns = [{ id: 'c1', type: 'text' as const }];
		const tests = compileFilters(columns, {
			c1: { kind: 'values', values: ['Alice'] },
			gone: { kind: 'values', values: ['nothing'] }
		});
		expect(tests.length).toBe(1);
		expect(tests[0]({ c1: 'Alice' })).toBe(true);
		expect(tests[0]({ c1: 'Bob' })).toBe(false);
	});
});
