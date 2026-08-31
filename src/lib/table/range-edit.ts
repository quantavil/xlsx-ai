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
 * Two selections mean two different intents, so they get two different rules:
 *
 * - One rectangle is an Excel range. Typing into it fills straight down a single
 *   column, and only that - a multi-column block stays a single-cell edit, because
 *   nobody drags across four columns meaning "put this string in all of them", and
 *   the columns underneath rarely even share a type.
 * - Several cursors are several deliberate placements. Every one of them is a target,
 *   whatever column it sits in - that is the whole point of dropping them by hand.
 *
 * Either way the edit has to start from the cell the selection already focuses;
 * clicking somewhere else collapses the selection first, and this is what stops a
 * stray click from broadcasting a value across a range the user had moved on from.
 */
export function resolveEditTargets(
	selectionRects: readonly SelectionRect[],
	activeCell: CellRef | null,
	requestedCell: CellRef,
	filteredRows: readonly Row[],
	columns: readonly Column[]
): EditTarget[] {
	const single: EditTarget[] = [{ rowId: requestedCell.rowId, columnId: requestedCell.columnId }];
	if (selectionRects.length === 0 || !sameCell(activeCell, requestedCell)) return single;

	if (selectionRects.length === 1) {
		const { r0, r1, c0, c1 } = selectionRects[0];
		if (r1 <= r0 || c0 !== c1 || columns[c0]?.id !== requestedCell.columnId) return single;
		const targets: EditTarget[] = [];
		for (let r = r0; r <= r1; r++) {
			const row = filteredRows[r];
			if (row) targets.push({ rowId: row.id, columnId: requestedCell.columnId });
		}
		return targets.length > 1 ? targets : single;
	}

	const seen = new Set<string>();
	const targets: EditTarget[] = [];
	for (const rect of selectionRects) {
		for (let r = rect.r0; r <= rect.r1; r++) {
			const row = filteredRows[r];
			if (!row) continue;
			for (let c = rect.c0; c <= rect.c1; c++) {
				const col = columns[c];
				if (!col) continue;
				const key = `${row.id}::${col.id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				targets.push({ rowId: row.id, columnId: col.id });
			}
		}
	}
	return targets.length > 1 ? targets : single;
}
