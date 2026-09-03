import { describe, it, expect, beforeEach } from 'bun:test';
import { createTableStore } from '../../src/lib/table/store.svelte';
import type { TableData } from '../../src/lib/types';

const baseData: TableData = {
	title: 'Actions Sheet',
	columns: [
		{ id: 'c1', name: 'Name', type: 'text' },
		{ id: 'c2', name: 'Units', type: 'number' },
		{ id: 'c3', name: 'Notes', type: 'text' }
	],
	rows: [
		{ id: 'r1', c1: 'a1', c2: 1, c3: 'n1' },
		{ id: 'r2', c1: 'a2', c2: 2, c3: 'n2' },
		{ id: 'r3', c1: 'a3', c2: 3, c3: 'n3' }
	]
};

describe('selectAll', () => {
	let store: ReturnType<typeof createTableStore>;

	beforeEach(() => {
		store = createTableStore(structuredClone(baseData), { persist: false });
	});

	it('selects all cells from (0,0) to (maxRow,maxCol)', () => {
		store.selectAll();
		const rect = store.selectionRect;
		expect(rect).not.toBeNull();
		expect(rect?.r0).toBe(0);
		expect(rect?.c0).toBe(0);
		expect(rect?.r1).toBe(2);
		expect(rect?.c1).toBe(2);
		expect(store.activeCell?.rowId).toBe('r3');
		expect(store.activeCell?.columnId).toBe('c3');
	});

	it('sets selectionKeys size to rows * cols', () => {
		store.selectAll();
		expect(store.selectionKeys.size).toBe(3 * 3);
	});

	it('does nothing when there are no rows or columns', () => {
		const empty = createTableStore(
			{ title: 'Empty', columns: [], rows: [] },
			{ persist: false }
		);
		empty.selectAll();
		expect(empty.selectionRect).toBeNull();
		expect(empty.selectionKeys.size).toBe(0);
	});
});

describe('insertRow', () => {
	let store: ReturnType<typeof createTableStore>;

	beforeEach(() => {
		store = createTableStore(structuredClone(baseData), { persist: false });
	});

	it('inserts row at the beginning', () => {
		const created = store.insertRow(0, { c1: 'first' });
		expect(store.rows.length).toBe(4);
		expect(store.rows[0].id).toBe(created.id);
		expect(store.rows[0].c1).toBe('first');
		expect(created.id.startsWith('row-')).toBe(true);
	});

	it('inserts row in the middle', () => {
		const created = store.insertRow(1, { c1: 'middle' });
		expect(store.rows.length).toBe(4);
		expect(store.rows[1].id).toBe(created.id);
		expect(store.rows[1].c1).toBe('middle');
		expect(store.rows[0].id).toBe('r1');
		expect(store.rows[2].id).toBe('r2');
	});

	it('appends at the end when no index is given', () => {
		const created = store.insertRow(undefined, { c1: 'last' });
		expect(store.rows.length).toBe(4);
		expect(store.rows[3].id).toBe(created.id);
		expect(store.rows[3].c1).toBe('last');
	});

	it('undo restores previous rows array', () => {
		const beforeIds = store.rows.map((r) => r.id);
		store.insertRow(1, { c1: 'tmp' });
		expect(store.rows.length).toBe(4);
		store.undo();
		expect(store.rows.map((r) => r.id)).toEqual(beforeIds);
		expect(store.rows.length).toBe(3);
	});
});

describe('deleteRows', () => {
	let store: ReturnType<typeof createTableStore>;

	beforeEach(() => {
		store = createTableStore(structuredClone(baseData), { persist: false });
	});

	it('deletes multiple rows by IDs atomically', () => {
		const historyBefore = store.history.length;
		store.deleteRows(['r1', 'r3']);
		expect(store.rows.length).toBe(1);
		expect(store.rows[0].id).toBe('r2');
		expect(store.history.length).toBe(historyBefore + 1);
	});

	it('undo restores all deleted rows', () => {
		store.deleteRows(['r1', 'r2']);
		expect(store.rows.length).toBe(1);
		store.undo();
		expect(store.rows.length).toBe(3);
		expect(store.rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
	});

	it('resets selection when selected rows are deleted', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		store.deleteRows(['r1']);
		expect(store.selectionRect).toBeNull();
		expect(store.selectionKeys.size).toBe(0);
	});
});

describe('multi-cell selection preservation', () => {
	let store: ReturnType<typeof createTableStore>;

	beforeEach(() => {
		store = createTableStore(structuredClone(baseData), { persist: false });
	});

	it('maintains range selection keys across multi-cell rectangle', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		store.setSelection({ rowId: 'r2', columnId: 'c2', rowIndex: 1, colIndex: 1 }, true);

		expect(store.selectionRect).toEqual({ r0: 0, r1: 1, c0: 0, c1: 1 });
		expect(store.selectionKeys.size).toBe(4);
		expect(store.selectionKeys.has('r1::c1')).toBe(true);
		expect(store.selectionKeys.has('r1::c2')).toBe(true);
		expect(store.selectionKeys.has('r2::c1')).toBe(true);
		expect(store.selectionKeys.has('r2::c2')).toBe(true);
		// An unselected cell is not in the set
		expect(store.selectionKeys.has('r3::c3')).toBe(false);
	});

	it('clears all cells across multi-cell range atomically', () => {
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		store.setSelection({ rowId: 'r2', columnId: 'c2', rowIndex: 1, colIndex: 1 }, true);

		const patches = Array.from(store.selectionKeys).map((key) => {
			const [rowId, columnId] = key.split('::');
			return { rowId, columnId, newValue: null };
		});
		store.applyCellPatches(patches);

		expect(store.rows[0].c1).toBeNull();
		expect(store.rows[0].c2).toBeNull();
		expect(store.rows[1].c1).toBeNull();
		expect(store.rows[1].c2).toBeNull();
		// Untouched cells retain values
		expect(store.rows[0].c3).toBe('n1');
		expect(store.rows[2].c1).toBe('a3');
	});
});
