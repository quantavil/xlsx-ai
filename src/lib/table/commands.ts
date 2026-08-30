import type { Column, Row, ColumnType, CellValue, FillValue } from '$lib/types';
import { normalizeCellValue, resolveDropdownOptions } from './cells';


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

	/**
	 * Sibling patches the option chosen by `patch` brings with it.
	 *
	 * Resolved against the row rather than the flat option list: a drawback serial is
	 * offered under every RITC that carries it, so the same value appears many times
	 * with a different payload each. `resolveDropdownOptions` applies the column's
	 * dependency filter first, which is what makes the surviving one this row's.
	 *
	 * ponytail: that resolver is first-wins and lets an option through on a value
	 * match alone, so a row already holding a serial from another RITC can resolve to
	 * that RITC's payload. Pre-existing in the display path; narrow the escape hatch
	 * in `resolveDropdownOptions` if a real row ever hits it.
	 */
	function coupledPatches(row: Row, column: Column, newValue: CellValue): CellPatch[] {
		if (column.type !== 'dropdown' || typeof newValue !== 'string') return [];
		const chosen = resolveDropdownOptions(column, row, rows).find(
			(opt) => opt.value.toLowerCase() === newValue.trim().toLowerCase()
		);
		if (!chosen) return [];
		// A reference reads the row as it stands. Changing the referenced column in
		// this same batch is one hop too far: it would need ordering between fills.
		const resolve = (value: FillValue): CellValue =>
			value && typeof value === 'object' ? (row[value.from] ?? null) : value;
		const blank = (value: CellValue | undefined) => value === null || value === undefined || value === '';

		return [
			...Object.entries(chosen.fills ?? {}),
			// Read against the row before the batch, for the same reason a reference is:
			// two options filling one blank cell in one paste would otherwise depend on
			// the order they happened to arrive in.
			...Object.entries(chosen.fillsIfBlank ?? {}).filter(([columnId]) => blank(row[columnId]))
		].map(([columnId, value]) => ({ rowId: row.id, columnId, newValue: resolve(value) }));
	}

	// One hop, never a cascade: fills are expanded from the incoming patches only, so
	// a filled cell cannot fill further and two coupled columns cannot loop. Each set
	// is queued *before* the patch that caused it, and the map below is last-wins, so
	// an explicit edit to a filled column in the same batch still beats its own fill.
	const expanded: CellPatch[] = [];
	for (const patch of patches) {
		const row = rowMap.get(patch.rowId);
		const column = colMap.get(patch.columnId);
		if (row && column) expanded.push(...coupledPatches(row, column, patch.newValue));
		expanded.push(patch);
	}

	for (const patch of expanded) {
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
