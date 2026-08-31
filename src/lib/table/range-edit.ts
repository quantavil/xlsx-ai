import type { Column, Row } from '$lib/types';
import type { CellRef, SelectionRect } from './store.svelte';

export interface EditTarget {
	rowId: string;
	columnId: string;
}

function sameCell(a: CellRef | null, b: CellRef): boolean {
	return a?.rowId === b.rowId && a.columnId === b.columnId;
}

/**
 * Which cells one edit writes to.
 *
 * An Excel range selection typing fills straight down a single column, and only that —
 * a multi-column block stays a single-cell edit, because nobody drags across four columns
 * meaning "put this string in all of them", and the columns underneath rarely share a type.
 *
 * Either way the edit has to start from the cell the selection already focuses;
 * clicking somewhere else collapses the selection first, which stops a stray click
 * from broadcasting a value across a range the user had moved on from.
 */
export function resolveEditTargets(
	selectionRect: SelectionRect | null,
	activeCell: CellRef | null,
	requestedCell: CellRef,
	filteredRows: readonly Row[],
	columns: readonly Column[]
): EditTarget[] {
	const single: EditTarget[] = [{ rowId: requestedCell.rowId, columnId: requestedCell.columnId }];
	if (!selectionRect || !sameCell(activeCell, requestedCell)) return single;

	const { r0, r1, c0, c1 } = selectionRect;
	if (r1 <= r0 || c0 !== c1 || columns[c0]?.id !== requestedCell.columnId) return single;
	const targets: EditTarget[] = [];
	for (let r = r0; r <= r1; r++) {
		const row = filteredRows[r];
		if (row) targets.push({ rowId: row.id, columnId: requestedCell.columnId });
	}
	return targets.length > 1 ? targets : single;
}
