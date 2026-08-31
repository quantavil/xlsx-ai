import { describe, expect, it } from 'bun:test';
import { resolveEditTargets } from '../../src/lib/table/range-edit';
import type { CellRef, SelectionRect } from '../../src/lib/table/store.svelte';
import type { Column, Row } from '../../src/lib/types';

const columns: Column[] = [
	{ id: 'name', name: 'Name', type: 'text' },
	{ id: 'status', name: 'Status', type: 'dropdown' }
];

const filteredRows: Row[] = [
	{ id: 'r3', name: 'Gamma', status: 'Open' },
	{ id: 'r1', name: 'Alpha', status: 'Open' },
	{ id: 'r2', name: 'Beta', status: 'Done' }
];

const active: CellRef = {
	rowId: 'r2',
	columnId: 'status',
	rowIndex: 2,
	colIndex: 1
};

const rect = (r0: number, r1: number, c0: number, c1: number): SelectionRect => ({ r0, r1, c0, c1 });

describe('resolveEditTargets', () => {
	describe('a single rectangle behaves like an Excel range', () => {
		it('returns every visible row in a qualifying one-column selection', () => {
			expect(resolveEditTargets([rect(0, 2, 1, 1)], active, active, filteredRows, columns)).toEqual([
				{ rowId: 'r3', columnId: 'status' },
				{ rowId: 'r1', columnId: 'status' },
				{ rowId: 'r2', columnId: 'status' }
			]);
		});

		it('falls back to only the requested cell for a one-cell selection', () => {
			expect(resolveEditTargets([rect(2, 2, 1, 1)], active, active, filteredRows, columns)).toEqual([
				{ rowId: 'r2', columnId: 'status' }
			]);
		});

		// A drag across columns means "look at these", not "make these all the same". The
		// columns underneath rarely share a type, so a bulk write here destroys data.
		it('falls back to only the requested cell for a multi-column rectangle', () => {
			expect(resolveEditTargets([rect(0, 2, 0, 1)], active, active, filteredRows, columns)).toEqual([
				{ rowId: 'r2', columnId: 'status' }
			]);
		});

		it('falls back when the edit starts somewhere other than the focused cell', () => {
			const elsewhere: CellRef = { rowId: 'r1', columnId: 'status', rowIndex: 1, colIndex: 1 };
			expect(resolveEditTargets([rect(0, 2, 1, 1)], active, elsewhere, filteredRows, columns)).toEqual([
				{ rowId: 'r1', columnId: 'status' }
			]);
		});

		it('falls back when the range is in a different column from the edit', () => {
			expect(resolveEditTargets([rect(0, 2, 0, 0)], active, active, filteredRows, columns)).toEqual([
				{ rowId: 'r2', columnId: 'status' }
			]);
		});
	});

	describe('several cursors are several deliberate placements', () => {
		it('returns every cursor, in reading order, across different columns', () => {
			const rects = [rect(0, 0, 0, 0), rect(2, 2, 1, 1)];
			expect(resolveEditTargets(rects, active, active, filteredRows, columns)).toEqual([
				{ rowId: 'r3', columnId: 'name' },
				{ rowId: 'r2', columnId: 'status' }
			]);
		});

		it('deduplicates cells covered by more than one cursor', () => {
			const rects = [rect(0, 1, 1, 1), rect(1, 2, 1, 1)];
			expect(resolveEditTargets(rects, active, active, filteredRows, columns)).toEqual([
				{ rowId: 'r3', columnId: 'status' },
				{ rowId: 'r1', columnId: 'status' },
				{ rowId: 'r2', columnId: 'status' }
			]);
		});

		it('skips rectangles that reach past the visible rows', () => {
			const rects = [rect(0, 0, 0, 0), rect(9, 9, 0, 0)];
			expect(resolveEditTargets(rects, active, active, filteredRows, columns)).toEqual([
				{ rowId: 'r2', columnId: 'status' }
			]);
		});

		it('falls back when the edit starts somewhere other than the focused cell', () => {
			const rects = [rect(0, 0, 0, 0), rect(2, 2, 1, 1)];
			const elsewhere: CellRef = { rowId: 'r1', columnId: 'name', rowIndex: 1, colIndex: 0 };
			expect(resolveEditTargets(rects, active, elsewhere, filteredRows, columns)).toEqual([
				{ rowId: 'r1', columnId: 'name' }
			]);
		});
	});

	it('falls back to the requested cell when nothing is selected', () => {
		expect(resolveEditTargets([], active, active, filteredRows, columns)).toEqual([
			{ rowId: 'r2', columnId: 'status' }
		]);
	});
});
