import { describe, expect, it } from 'bun:test';
import { createTableStore } from '../../src/lib/table/store.svelte';
import type { CellRef } from '../../src/lib/table/store.svelte';
import type { TableData } from '../../src/lib/types';

const sampleData: TableData = {
	title: 'Cursor Mode & Selection Test Sheet',
	columns: [
		{ id: 'c1', name: 'Name', type: 'text' },
		{ id: 'c2', name: 'Category', type: 'text' },
		{ id: 'c3', name: 'Status', type: 'dropdown' }
	],
	rows: [
		{ id: 'r1', c1: 'Apple', c2: 'Fruit', c3: 'Active' },
		{ id: 'r2', c1: 'Banana', c2: 'Fruit', c3: 'Draft' },
		{ id: 'r3', c1: 'Carrot', c2: 'Vegetable', c3: 'Active' },
		{ id: 'r4', c1: 'Date', c2: 'Fruit', c3: 'Draft' }
	]
};

const COLS = ['c1', 'c2', 'c3'];
const ROWS = ['r1', 'r2', 'r3', 'r4'];

/** A cell reference by id, so a test never has to hand-count indexes. */
function at(rowId: string, columnId: string): CellRef {
	return { rowId, columnId, rowIndex: ROWS.indexOf(rowId), colIndex: COLS.indexOf(columnId) };
}

describe('cursor mode state', () => {
	it('starts off', () => {
		const store = createTableStore(sampleData, { persist: false });
		expect(store.cursorMode).toBe(false);
	});

	it('can be toggled on and off', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setCursorMode(true);
		expect(store.cursorMode).toBe(true);

		store.setCursorMode(false);
		expect(store.cursorMode).toBe(false);
	});
});

describe('single selection and range extension', () => {
	it('selects a single cell', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));

		expect(store.activeCell?.rowId).toBe('r1');
		expect(store.activeCell?.columnId).toBe('c1');
		expect(store.selectionRect).toEqual({ r0: 0, r1: 0, c0: 0, c1: 0 });
		expect([...store.selectionKeys]).toEqual(['r1::c1']);
	});

	it('extends selection to a range when extend is true', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));
		store.setSelection(at('r3', 'c2'), true);

		expect(store.activeCell?.rowId).toBe('r3');
		expect(store.activeCell?.columnId).toBe('c2');
		expect(store.selectionRect).toEqual({ r0: 0, r1: 2, c0: 0, c1: 1 });
		expect(store.selectionKeys.size).toBe(6);
	});

	it('clears selection when cell is null', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));
		store.setSelection(null);

		expect(store.activeCell).toBeNull();
		expect(store.selectionRect).toBeNull();
		expect(store.selectionKeys.size).toBe(0);
	});
});

describe('collapseSelection (escape)', () => {
	it('shrinks a range selection to its focus cell, returning true', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));
		store.setSelection(at('r3', 'c2'), true);
		expect(store.selectionRect).toEqual({ r0: 0, r1: 2, c0: 0, c1: 1 });

		expect(store.collapseSelection()).toBe(true);
		expect(store.selectionRect).toEqual({ r0: 2, r1: 2, c0: 1, c1: 1 });
		expect(store.activeCell?.rowId).toBe('r3');
	});

	it('reports false when there is nothing left to collapse', () => {
		const store = createTableStore(sampleData, { persist: false });
		expect(store.collapseSelection()).toBe(false);

		store.setSelection(at('r1', 'c1'));
		expect(store.collapseSelection()).toBe(false);
	});
});

describe('selection rectangles are derived, not stored', () => {
	it('re-clamps to the visible rows when a search shrinks the sheet', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.selectRow('r4');
		expect(store.selectionRect).toEqual({ r0: 3, r1: 3, c0: 0, c1: 2 });

		store.setSearchQuery('Apple');
		expect(store.filteredRows.length).toBe(1);
		expect(store.selectionRect?.r1).toBe(0);
		expect(store.selectionKeys.size).toBe(3);
	});

	it('reports no selection at all once every row is filtered out', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));

		store.setSearchQuery('nothing matches this');
		expect(store.selectionRect).toBeNull();
		expect(store.selectionKeys.size).toBe(0);
	});

	it('still covers the whole column after that column is re-sorted', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.selectColumn('c1');
		const before = [...store.selectionKeys].sort();

		store.setSort('c1');
		expect([...store.selectionKeys].sort()).toEqual(before);
	});
});

describe('edits and alignment on range selection', () => {
	it('applies a patch across selected range cells in a single undo step', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));
		store.setSelection(at('r2', 'c1'), true);

		store.applyCellPatches(
			[...store.selectionKeys].map((key) => {
				const [rowId, columnId] = key.split('::');
				return { rowId, columnId, newValue: 'Filled' };
			})
		);
		expect(store.rawCell('r1', 'c1')).toBe('Filled');
		expect(store.rawCell('r2', 'c1')).toBe('Filled');

		store.undo();
		expect(store.rawCell('r1', 'c1')).toBe('Apple');
		expect(store.rawCell('r2', 'c1')).toBe('Banana');
	});

	it('aligns selected range in a single undo step', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));
		store.setSelection(at('r2', 'c2'), true);

		store.alignSelection('center');
		expect(store.cellAlign['r1::c1']).toBe('center');
		expect(store.cellAlign['r1::c2']).toBe('center');
		expect(store.cellAlign['r2::c1']).toBe('center');
		expect(store.cellAlign['r2::c2']).toBe('center');

		store.undo();
		expect(store.cellAlign['r1::c1']).toBeUndefined();
		expect(store.cellAlign['r2::c2']).toBeUndefined();
	});
});
