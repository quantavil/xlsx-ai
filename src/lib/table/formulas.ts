import XLSX_CALC from 'xlsx-calc';
import type { CellValue, Column, Row } from '$lib/types';
import { getExcelColumnName } from '$lib/data/import';
import { isFormula } from './cells';

/**
 * Excel formulas, evaluated over the grid.
 *
 * A formula lives in the cell as the literal string the user typed verbatim,
 * exactly like Excel (`=B2+C2`): the document stores it, the grid shows the result.
 * `resolveFormulaRows` produces the display copy; `rows` itself is never rewritten.
 *
 * Addressing is the exported workbook's, not the array's: row 1 holds the column
 * headers and data starts at row 2, exactly as in the file `buildXlsxSheetData`
 * writes. So `=SUM(B2:B9)` typed in the grid means the same cells after download,
 * and a formula imported from Excel needs no reference rewriting. The row gutter
 * counts from 2 for the same reason.
 */

/** Data row `r` (0-based) is spreadsheet row `r + 2`; row 1 is the header. */
const HEADER_ROWS = 1;

/** The row number a formula uses for data row `rowIndex`, and the grid gutter shows. */
export function sheetRowNumber(rowIndex: number): number {
	return rowIndex + 1 + HEADER_ROWS;
}

/** The letter shown above column `colIndex` and used to address it: 0 -> `A`. */
export const columnLetter = getExcelColumnName;

/** The address of a grid cell, as a formula writes it: `B2`. */
export function cellAddress(colIndex: number, rowIndex: number): string {
	return `${columnLetter(colIndex)}${sheetRowNumber(rowIndex)}`;
}

/** `A2` / `$B$9` -> grid indices, or null when the address falls outside the grid. */
export function addressToIndices(
	address: string,
	columnCount: number,
	rowCount: number
): { colIndex: number; rowIndex: number } | null {
	const match = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(address);
	if (!match) return null;

	let colIndex = 0;
	for (const ch of match[1].toUpperCase()) colIndex = colIndex * 26 + (ch.charCodeAt(0) - 64);
	colIndex -= 1;
	const rowIndex = Number(match[2]) - 1 - HEADER_ROWS;

	if (colIndex < 0 || colIndex >= columnCount) return null;
	if (rowIndex < 0 || rowIndex >= rowCount) return null;
	return { colIndex, rowIndex };
}

/** Every `rowIndex::colIndex` a formula reads, so the grid can tint them while editing. */
export function referencedCells(formula: string, columnCount: number, rowCount: number): Set<string> {
	const cells = new Set<string>();
	// Ranges first: `B2:B9` must not be read as two loose references.
	const consumed = new Set<number>();
	const rangeRe = /(\$?[A-Za-z]{1,3}\$?\d+):(\$?[A-Za-z]{1,3}\$?\d+)/g;
	for (let m = rangeRe.exec(formula); m; m = rangeRe.exec(formula)) {
		for (let i = m.index; i < m.index + m[0].length; i++) consumed.add(i);
		const from = addressToIndices(m[1], columnCount, rowCount);
		const to = addressToIndices(m[2], columnCount, rowCount);
		if (!from || !to) continue;
		for (let r = Math.min(from.rowIndex, to.rowIndex); r <= Math.max(from.rowIndex, to.rowIndex); r++) {
			for (let c = Math.min(from.colIndex, to.colIndex); c <= Math.max(from.colIndex, to.colIndex); c++) {
				cells.add(`${r}::${c}`);
			}
		}
	}

	const singleRe = /\$?[A-Za-z]{1,3}\$?\d+/g;
	for (let m = singleRe.exec(formula); m; m = singleRe.exec(formula)) {
		if (consumed.has(m.index)) continue;
		const at = addressToIndices(m[0], columnCount, rowCount);
		if (at) cells.add(`${at.rowIndex}::${at.colIndex}`);
	}
	return cells;
}

const ERROR_VALUE = '#ERROR!';

function tableHasFormula(columns: Column[], rows: Row[]): boolean {
	return rows.some((row) => columns.some((col) => isFormula(row?.[col.id])));
}

/**
 * `rows` with every formula cell replaced by its computed value.
 *
 * Returns the original array untouched when the table holds no formulas, so a
 * document that never uses them pays nothing and keeps referential equality.
 */
// ponytail: recalculates the whole grid on every edit (~40ms at 1k rows, ~195ms at
// 5k). Swap xlsx-calc for HyperFormula's incremental graph if tables get that large.
export function resolveFormulaRows(columns: Column[], rows: Row[]): Row[] {
	if (!tableHasFormula(columns, rows)) return rows;

	const colNames = columns.map((_, c) => getExcelColumnName(c));
	const sheet: Record<string, unknown> = {};
	for (let c = 0; c < columns.length; c++) {
		sheet[`${colNames[c]}1`] = { t: 's', v: columns[c].name ?? '' };
	}
	for (let r = 0; r < rows.length; r++) {
		for (let c = 0; c < columns.length; c++) {
			const raw = rows[r]?.[columns[c].id];
			if (raw === null || raw === undefined || raw === '') continue;
			const addr = `${colNames[c]}${sheetRowNumber(r)}`;
			if (isFormula(raw)) sheet[addr] = { t: 'n', f: raw.slice(1) };
			else if (typeof raw === 'number') sheet[addr] = { t: 'n', v: raw };
			else if (typeof raw === 'boolean') sheet[addr] = { t: 'b', v: raw };
			else sheet[addr] = { t: 's', v: String(raw) };
		}
	}
	sheet['!ref'] = `A1:${colNames[colNames.length - 1]}${rows.length + HEADER_ROWS}`;

	// A circular reference makes xlsx-calc throw mid-pass. Cells it already resolved
	// keep their value, so the workbook is still worth reading back — the rest fall
	// through to #ERROR! below.
	try {
		XLSX_CALC({ SheetNames: ['S'], Sheets: { S: sheet } });
	} catch {
		/* partial results are read back the same way */
	}

	return rows.map((row, r) => {
		let resolved: Row | null = null;
		for (let c = 0; c < columns.length; c++) {
			if (!isFormula(row?.[columns[c].id])) continue;
			const cell = sheet[`${colNames[c]}${sheetRowNumber(r)}`] as { v?: CellValue } | undefined;
			resolved ??= { ...row };
			resolved[columns[c].id] = cell?.v ?? ERROR_VALUE;
		}
		return resolved ?? row;
	});
}
