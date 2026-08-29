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
