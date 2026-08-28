import type { Column, Row, ColumnType, CellValue } from '$lib/types';
import { normalizeCellValue } from './cells';


export interface CellPatch {
	rowId: string;
	columnId: string;
	oldValue?: CellValue;
	newValue: CellValue;
}

export function dedupeAndNormalizePatches(
	patches: CellPatch[],
	rows: Row[],
	columns: Column[]
): Array<{ row: Row; columnId: string; oldValue: CellValue; newValue: CellValue }> {
	const colMap = new Map<string, Column>();
	for (const col of columns) colMap.set(col.id, col);

	const rowMap = new Map<string, Row>();
	for (const row of rows) rowMap.set(row.id, row);

	const validPatches = new Map<string, { row: Row; columnId: string; oldValue: CellValue; newValue: CellValue }>();

	for (const patch of patches) {
		const targetRow = rowMap.get(patch.rowId);
		const targetCol = colMap.get(patch.columnId);

		if (!targetRow || !targetCol) continue;

		const normalizedNew = normalizeCellValue(targetCol.type, patch.newValue);
		const currentVal = targetRow[patch.columnId] ?? null;

		if (Object.is(currentVal, normalizedNew)) continue;

		const key = `${patch.rowId}:::${patch.columnId}`;
		validPatches.set(key, {
			row: targetRow,
			columnId: patch.columnId,
			oldValue: currentVal,
			newValue: normalizedNew
		});
	}

	return Array.from(validPatches.values());
}

export function convertColumnTypeAtomic(
	rows: Row[],
	columnId: string,
	newType: ColumnType
): { updatedRows: Row[]; changedCount: number; invalidCount: number } {
	let changedCount = 0;
	let invalidCount = 0;

	const updatedRows = rows.map((r) => {
		const currentVal = r[columnId];
		const normalized = normalizeCellValue(newType, currentVal);

		if (currentVal !== null && currentVal !== undefined && currentVal !== '' && normalized === null) {
			invalidCount++;
		}

		if (!Object.is(currentVal, normalized)) {
			changedCount++;
			return { ...r, [columnId]: normalized };
		}
		return r;
	});

	return { updatedRows, changedCount, invalidCount };
}
