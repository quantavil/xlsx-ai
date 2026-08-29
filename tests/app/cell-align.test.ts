import { describe, it, expect, beforeEach } from 'vitest';
import { createTableStore } from '../../src/lib/table/store.svelte';
import { defaultAlignForType } from '../../src/lib/table/cells';
import type { TableData } from '../../src/lib/types';

const DATA: TableData = {
	title: 'Align',
	columns: [
		{ id: 'c1', name: 'Name', type: 'text' },
		{ id: 'c2', name: 'Qty', type: 'number' },
		{ id: 'c3', name: 'Note', type: 'text' }
	],
	rows: [
		{ id: 'r1', c1: 'a', c2: 1, c3: 'x' },
		{ id: 'r2', c1: 'b', c2: 2, c3: 'y' },
		{ id: 'r3', c1: 'c', c2: 3, c3: 'z' }
	]
};

function seeded() {
	const store = createTableStore(undefined, { persist: true });
	store.loadTable(structuredClone(DATA), { undoable: false });
	return store;
}

describe('Cell alignment', () => {
	beforeEach(() => localStorage.clear());

	it('defaults to right for numeric types and left for everything else', () => {
		expect(defaultAlignForType('number')).toBe('right');
		expect(defaultAlignForType('currency')).toBe('right');
		expect(defaultAlignForType('percent')).toBe('right');
		expect(defaultAlignForType('text')).toBe('left');
		expect(defaultAlignForType('date')).toBe('left');
		expect(defaultAlignForType('dropdown')).toBe('left');
	});

	it('applies an override across the whole selected range, not just the focused cell', () => {
		const store = seeded();
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		store.setSelection({ rowId: 'r2', columnId: 'c2', rowIndex: 1, colIndex: 1 }, true);
		store.alignSelection('center');

		expect(store.alignFor('r1', 'c1', 'text')).toBe('center');
		expect(store.alignFor('r2', 'c2', 'number')).toBe('center');
		// Outside the rectangle keeps the type default.
		expect(store.alignFor('r3', 'c1', 'text')).toBe('left');
		expect(store.alignFor('r1', 'c3', 'text')).toBe('left');
	});

	it('clears back to the type default and is undoable', () => {
		const store = seeded();
		store.setSelection({ rowId: 'r1', columnId: 'c2', rowIndex: 0, colIndex: 1 });
		store.alignSelection('left');
		expect(store.alignFor('r1', 'c2', 'number')).toBe('left');

		store.undo();
		expect(store.alignFor('r1', 'c2', 'number')).toBe('right');

		store.redo();
		expect(store.alignFor('r1', 'c2', 'number')).toBe('left');

		store.alignSelection(null);
		expect(store.alignFor('r1', 'c2', 'number')).toBe('right');
	});

	it('survives a save/reload round trip', () => {
		const store = seeded();
		store.setSelection({ rowId: 'r2', columnId: 'c1', rowIndex: 1, colIndex: 0 });
		store.alignSelection('right');
		store.flushSave();

		const reloaded = createTableStore(undefined, { persist: true });
		expect(reloaded.hydrate().status).toBe('restored');
		expect(reloaded.alignFor('r2', 'c1', 'text')).toBe('right');
	});

	it('drops overrides pointing at rows that no longer exist', () => {
		const store = seeded();
		store.setSelection({ rowId: 'r3', columnId: 'c1', rowIndex: 2, colIndex: 0 });
		store.alignSelection('center');
		store.deleteRow('r3');
		store.flushSave();

		const reloaded = createTableStore(undefined, { persist: true });
		reloaded.hydrate();
		expect(Object.keys(reloaded.cellAlign)).toHaveLength(0);
	});

	it('reports a single-cell rectangle when nothing is extended', () => {
		const store = seeded();
		store.setSelection({ rowId: 'r1', columnId: 'c1', rowIndex: 0, colIndex: 0 });
		expect(store.selectionRect).toEqual({ r0: 0, r1: 0, c0: 0, c1: 0 });
		store.setSelection(null);
		expect(store.selectionRect).toBeNull();
	});
});
