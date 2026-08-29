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
