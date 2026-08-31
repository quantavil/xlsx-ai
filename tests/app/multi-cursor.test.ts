import { describe, expect, it } from 'bun:test';
import { createTableStore } from '../../src/lib/table/store.svelte';
import type { CellRef } from '../../src/lib/table/store.svelte';
import type { TableData } from '../../src/lib/types';

const sampleData: TableData = {
	title: 'Multi-Cursor Test Sheet',
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

function inCursorMode() {
	const store = createTableStore(sampleData, { persist: false });
	store.setCursorMode(true);
	return store;
}

describe('cursor mode gates every multi-cursor action', () => {
	it('starts off', () => {
		expect(createTableStore(sampleData, { persist: false }).cursorMode).toBe(false);
	});

	it('ignores cursor placement while off', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));

		store.toggleSelection(at('r2', 'c1'));
		expect(store.selectionRects.length).toBe(1);

		store.addCursor(1);
		store.addCursor(-1);
		expect(store.selectionRects.length).toBe(1);
	});

	it('collapses back to one cursor when switched off', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r3', 'c1'));
		expect(store.selectionRects.length).toBe(2);

		store.setCursorMode(false);
		expect(store.cursorMode).toBe(false);
		expect(store.selectionRects.length).toBe(1);
	});

	it('leaves the selection alone when set to the mode it is already in', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r3', 'c1'));

		store.setCursorMode(true);
		expect(store.selectionRects.length).toBe(2);
	});
});

describe('toggleSelection (ctrl-click)', () => {
	it('adds a disjoint cursor and makes it primary', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r3', 'c2'));

		expect(store.selectionRects.length).toBe(2);
		expect([...store.selectionKeys].sort()).toEqual(['r1::c1', 'r3::c2']);
		expect(store.activeCell?.rowId).toBe('r3');
	});

	it('lifts a cursor that already covers the clicked cell', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r3', 'c2'));
		store.toggleSelection(at('r3', 'c2'));

		expect([...store.selectionKeys]).toEqual(['r1::c1']);
	});

	it('lifts the cursor whose range covers the cell, not only an exact hit', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.setSelection(at('r3', 'c1'), true); // range r1..r3
		store.toggleSelection(at('r4', 'c1'));
		expect(store.selectionRects.length).toBe(2);

		store.toggleSelection(at('r2', 'c1')); // inside the range, not its focus
		expect([...store.selectionKeys]).toEqual(['r4::c1']);
	});

	it('never lifts the last cursor - a sheet with no caret has nothing to type into', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r1', 'c1'));

		expect(store.selectionRects.length).toBe(1);
		expect(store.activeCell?.rowId).toBe('r1');
	});

	// Clamping the index would silently hand the primary role to a different cell.
	it('keeps the primary on its own cell when an earlier cursor is lifted', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r2', 'c1'));
		store.toggleSelection(at('r3', 'c1'));
		store.toggleSelection(at('r4', 'c1'));
		store.toggleSelection(at('r4', 'c1')); // primary falls back to r3
		expect(store.activeCell?.rowId).toBe('r3');

		store.toggleSelection(at('r1', 'c1')); // lift a cursor *below* the primary
		expect(store.activeCell?.rowId).toBe('r3');
		expect([...store.selectionKeys].sort()).toEqual(['r2::c1', 'r3::c1']);
	});
});

describe('addCursor (ctrl+alt+up/down)', () => {
	it('stacks cursors outward from the furthest one in the column', () => {
		const store = inCursorMode();
		store.setSelection(at('r2', 'c1'));

		store.addCursor(1);
		store.addCursor(1);
		expect([...store.selectionKeys].sort()).toEqual(['r2::c1', 'r3::c1', 'r4::c1']);

		store.addCursor(-1);
		expect([...store.selectionKeys].sort()).toEqual(['r1::c1', 'r2::c1', 'r3::c1', 'r4::c1']);
	});

	it('measures from the primary cursor column only', () => {
		const store = inCursorMode();
		store.setSelection(at('r4', 'c2'));
		store.toggleSelection(at('r1', 'c1')); // primary is now r1 in another column

		store.addCursor(1);
		expect([...store.selectionKeys].sort()).toEqual(['r1::c1', 'r2::c1', 'r4::c2']);
	});

	it('stops at the top and bottom rows', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.addCursor(-1);
		expect(store.selectionRects.length).toBe(1);

		store.setSelection(at('r4', 'c1'));
		store.addCursor(1);
		expect(store.selectionRects.length).toBe(1);
	});
});

describe('collapseSelections (escape)', () => {
	it('drops secondary cursors first, keeping the primary', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r3', 'c1'));

		expect(store.collapseSelections()).toBe(true);
		expect([...store.selectionKeys]).toEqual(['r3::c1']);
	});

	it('then shrinks a range to its focus, so two presses always reach one cell', () => {
		const store = createTableStore(sampleData, { persist: false });
		store.setSelection(at('r1', 'c1'));
		store.setSelection(at('r3', 'c2'), true);
		expect(store.selectionRect).toEqual({ r0: 0, r1: 2, c0: 0, c1: 1 });

		expect(store.collapseSelections()).toBe(true);
		expect(store.selectionRect).toEqual({ r0: 2, r1: 2, c0: 1, c1: 1 });
	});

	// A no-op Escape has to report false so the caller can pass it on to close a panel.
	it('reports false when there is nothing left to collapse', () => {
		const store = createTableStore(sampleData, { persist: false });
		expect(store.collapseSelections()).toBe(false);

		store.setSelection(at('r1', 'c1'));
		expect(store.collapseSelections()).toBe(false);
	});
});

describe('selection rectangles are derived, not stored', () => {
	// A stored rectangle keeps pointing at indexes that no longer exist once a search
	// shrinks the sheet, and scoped Find then reports zero matches with no explanation.
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
		expect(store.selectionRects).toEqual([]);
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

describe('edits reach every cursor', () => {
	it('applies a patch per cursor in a single undo step', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r3', 'c1'));

		store.applyCellPatches(
			[...store.selectionKeys].map((key) => {
				const [rowId, columnId] = key.split('::');
				return { rowId, columnId, newValue: 'Filled' };
			})
		);
		expect(store.rawCell('r1', 'c1')).toBe('Filled');
		expect(store.rawCell('r3', 'c1')).toBe('Filled');

		store.undo();
		expect(store.rawCell('r1', 'c1')).toBe('Apple');
		expect(store.rawCell('r3', 'c1')).toBe('Carrot');
	});

	it('aligns every cursor, across columns, in a single undo step', () => {
		const store = inCursorMode();
		store.setSelection(at('r1', 'c1'));
		store.toggleSelection(at('r2', 'c2'));

		store.alignSelection('center');
		expect(store.cellAlign['r1::c1']).toBe('center');
		expect(store.cellAlign['r2::c2']).toBe('center');

		store.undo();
		expect(store.cellAlign['r1::c1']).toBeUndefined();
		expect(store.cellAlign['r2::c2']).toBeUndefined();
	});
});
