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

/** What a cell shows when its formula could not be computed. */
export const ERROR_VALUE = '#ERROR!';

/**
 * Formula strings xlsx-calc cannot even parse.
 *
 * It builds the whole sheet's expression tree before evaluating any of it, so one
 * malformed formula throws during the build and *nothing* gets a value — a single
 * typo used to blank every computed cell in the grid. Whether a formula parses is a
 * property of its text, not of where it sits, so a string proven bad once stays bad:
 * the isolation pass below runs only when a new one appears.
 */
const unparseable = new Set<string>();

/** Runs the sheet, returning false if xlsx-calc could not build it. */
function tryCalc(sheet: Record<string, unknown>): boolean {
	try {
		XLSX_CALC({ SheetNames: ['S'], Sheets: { S: sheet } });
		return true;
	} catch {
		return false;
	}
}

/**
 * Finds which formulas broke the build by running each alone over the sheet's
 * literals, and remembers them. Only reached when a formula the cache has not seen
 * fails, so the ordinary path never pays for it.
 */
function quarantineUnparseable(sheet: Record<string, unknown>): void {
	const literals: Record<string, unknown> = {};
	const formulaCells: Array<[string, string]> = [];
	for (const [addr, cell] of Object.entries(sheet)) {
		const f = (cell as { f?: string } | null)?.f;
		if (f === undefined) literals[addr] = cell;
		else formulaCells.push([addr, f]);
	}
	for (const [addr, f] of formulaCells) {
		if (!tryCalc({ ...literals, [addr]: { t: 'n', f } })) unparseable.add(f);
	}
}

function tableHasFormula(columns: Column[], rows: Row[]): boolean {
	return rows.some((row) => columns.some((col) => isFormula(row?.[col.id])));
}

/** What a reference becomes when a fill or a deletion pushes it off the grid. */
export const REF_ERROR = '#REF!';

/**
 * Every `A1`-style reference in a formula, with the spans they occupy.
 *
 * Skips anything inside double quotes, and anything whose neighbours make it part of
 * a longer word — so a function that ends in digits is never mistaken for a cell.
 */
function scanReferences(
	formula: string
): Array<{ start: number; end: number; colAbs: boolean; col: string; rowAbs: boolean; row: string }> {
	const out: Array<{ start: number; end: number; colAbs: boolean; col: string; rowAbs: boolean; row: string }> = [];
	let inString = false;
	const re = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g;
	const quotes = new Set<number>();
	for (let i = 0; i < formula.length; i++) {
		if (formula[i] === '"') inString = !inString;
		if (inString || formula[i] === '"') quotes.add(i);
	}
	for (let m = re.exec(formula); m; m = re.exec(formula)) {
		const start = m.index;
		const end = start + m[0].length;
		if (quotes.has(start)) continue;
		const before = start > 0 ? formula[start - 1] : '';
		const after = formula[end] ?? '';
		// `A1B` is not a reference, and `LOG10(` is a function whose name ends in
		// digits — an open paren after it is what tells the two apart.
		if (/[A-Za-z0-9._]/.test(before) || /[A-Za-z0-9._(]/.test(after)) continue;
		out.push({ start, end, colAbs: m[1] === '$', col: m[2], rowAbs: m[3] === '$', row: m[4] });
	}
	return out;
}

/** Where an index goes, or null when it no longer exists. */
export type IndexMap = (index: number) => number | null;

/**
 * Rewrites every reference in a formula through a row map and a column map.
 *
 * The one primitive behind filling, inserting and deleting: each of those is just a
 * different pair of maps. A reference that maps to nothing — the row it named was
 * deleted, or it fell off the grid — becomes `#REF!`. Clamping it to the edge would
 * report a confident wrong number, which is worse than an obvious error.
 *
 * `$` pins a part in place, so an absolute reference is left where it is. That is
 * Excel's fill rule; a structural edit overrides it by mapping absolutes too, which
 * is why `mapAbsolute` exists — a pinned `$G$2` still has to follow row 2 when a row
 * is inserted above it.
 */
export function remapFormulaRefs(
	formula: string,
	mapRow: IndexMap,
	mapCol: IndexMap,
	columnCount: number,
	rowCount: number,
	mapAbsolute = false
): string {
	let out = '';
	let cursor = 0;
	for (const ref of scanReferences(formula)) {
		out += formula.slice(cursor, ref.start);
		cursor = ref.end;

		let colIndex = 0;
		for (const ch of ref.col.toUpperCase()) colIndex = colIndex * 26 + (ch.charCodeAt(0) - 64);
		colIndex -= 1;
		const rowIndex = Number(ref.row) - 1 - HEADER_ROWS;

		const nextCol = ref.colAbs && !mapAbsolute ? colIndex : mapCol(colIndex);
		const nextRow = ref.rowAbs && !mapAbsolute ? rowIndex : mapRow(rowIndex);
		if (
			nextCol === null ||
			nextRow === null ||
			nextCol < 0 ||
			nextCol >= columnCount ||
			nextRow < 0 ||
			nextRow >= rowCount
		) {
			out += REF_ERROR;
			continue;
		}
		out += `${ref.colAbs ? '$' : ''}${columnLetter(nextCol)}${ref.rowAbs ? '$' : ''}${sheetRowNumber(nextRow)}`;
	}
	return out + formula.slice(cursor);
}

/**
 * A formula moved by `dRow` rows and `dCol` columns, the way Excel rewrites one you
 * fill or drag.
 */
export function offsetFormulaRefs(
	formula: string,
	dRow: number,
	dCol: number,
	columnCount: number,
	rowCount: number
): string {
	return remapFormulaRefs(formula, (r) => r + dRow, (c) => c + dCol, columnCount, rowCount);
}

/** Rewrites a whole grid's formulas through one pair of maps, leaving values alone. */
export function remapRowFormulas(
	rows: Row[],
	columns: Column[],
	mapRow: IndexMap,
	mapCol: IndexMap,
	columnCount: number,
	rowCount: number
): Row[] {
	return rows.map((row) => {
		let next: Row | null = null;
		for (const col of columns) {
			const raw = row[col.id];
			if (!isFormula(raw)) continue;
			const rewritten = `=${remapFormulaRefs(raw.slice(1), mapRow, mapCol, columnCount, rowCount, true)}`;
			if (rewritten === raw) continue;
			next ??= { ...row };
			next[col.id] = rewritten;
		}
		return next ?? row;
	});
}

/** Maps for a row (or column) inserted at `at`: everything from there on moves down. */
export const insertedAt =
	(at: number): IndexMap =>
	(i) =>
		i >= at ? i + 1 : i;

/** Maps for a row (or column) removed at `at`: it becomes #REF!, the rest close up. */
export const removedAt =
	(at: number): IndexMap =>
	(i) =>
		i === at ? null : i > at ? i - 1 : i;

/** Leaves an axis untouched. */
export const unchanged: IndexMap = (i) => i;

/**
 * Whether a formula reads any cell in the column it sits in.
 *
 * A totals cell — `=SUM(D2:D4)` in column D — already contains its column's other
 * values, so adding it to that column's own SUM counts them twice. A per-row formula
 * like `=B2*C2` reads elsewhere and is an ordinary value to aggregate.
 */
export function aggregatesOwnColumn(
	formula: string,
	colIndex: number,
	columnCount: number,
	rowCount: number
): boolean {
	for (const key of referencedCells(formula, columnCount, rowCount)) {
		if (Number(key.slice(key.indexOf('::') + 2)) === colIndex) return true;
	}
	return false;
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
			if (isFormula(raw)) {
				const expression = raw.slice(1);
				sheet[addr] = unparseable.has(expression)
					? { t: 's', v: ERROR_VALUE }
					: { t: 'n', f: expression };
			}
			else if (typeof raw === 'number') sheet[addr] = { t: 'n', v: raw };
			else if (typeof raw === 'boolean') sheet[addr] = { t: 'b', v: raw };
			else sheet[addr] = { t: 's', v: String(raw) };
		}
	}
	sheet['!ref'] = `A1:${colNames[colNames.length - 1]}${rows.length + HEADER_ROWS}`;

	// One unparseable formula takes the whole build down, so on failure find which
	// ones they are, stand them down to #ERROR!, and compute everything else. A
	// circular reference throws too but survives isolation, so it ends up here as
	// well — as a single failed cell rather than a failed sheet.
	if (!tryCalc(sheet)) {
		quarantineUnparseable(sheet);
		for (const [addr, cell] of Object.entries(sheet)) {
			const f = (cell as { f?: string } | null)?.f;
			if (f !== undefined && unparseable.has(f)) sheet[addr] = { t: 's', v: ERROR_VALUE };
		}
		tryCalc(sheet);
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
