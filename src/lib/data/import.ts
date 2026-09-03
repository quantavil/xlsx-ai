import type { TableData, Column, Row, ColumnType, CellValue } from '$lib/types';
import { normalizeCellValue } from '$lib/table/cells';
import { sanitizeAndNormalizeTableData } from '$lib/table/schema';


export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_COLS = 100;

export function getExcelColumnName(colIndex: number): string {
	let num = colIndex + 1;
	let colName = '';
	while (num > 0) {
		const rem = (num - 1) % 26;
		colName = String.fromCharCode(65 + rem) + colName;
		num = Math.floor((num - 1) / 26);
	}
	return colName;
}

export function inferColumnTypeFromSamples(values: CellValue[]): ColumnType {
	const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
	if (nonNull.length === 0) return 'text';

	let numCount = 0;
	let currCount = 0;
	let pctCount = 0;
	let dateCount = 0;
	const distinctValues = new Set<string>();

	for (const val of nonNull) {
		const str = String(val).trim();
		distinctValues.add(str.toLowerCase());

		// Check currency ($1,200.00, €50, £99, ₹) — #18 add ₹
		if (/^[$€£¥₹]\s*-?[0-9,]+(?:\.[0-9]+)?$/.test(str) || /^-?[0-9,]+(?:\.[0-9]+)?\s*[$€£¥₹]$/.test(str)) {
			currCount++;
			continue;
		}

		// Check percent (15%, 0.5%, 100%)
		if (/^-?[0-9,]+(?:\.[0-9]+)?%$/.test(str)) {
			pctCount++;
			continue;
		}

		// Check date (YYYY-MM-DD, MM/DD/YYYY, or valid Date string)
		if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(str) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(str)) {
			const parsed = Date.parse(str);
			if (!isNaN(parsed)) {
				dateCount++;
				continue;
			}
		}

		// Check number (including with commas like 1,200.50)
		const cleanNum = str.replace(/,/g, '');
		const hasLeadingZero = /^0\d+/.test(cleanNum);
		if (!hasLeadingZero && (typeof val === 'number' || (!isNaN(Number(cleanNum)) && !isNaN(parseFloat(cleanNum)) && !str.includes(':')))) {
			numCount++;
			continue;
		}
	}

	const total = nonNull.length;
	if (currCount / total >= 0.5) return 'currency';
	if (pctCount / total >= 0.5) return 'percent';
	if (dateCount / total >= 0.5) return 'date';
	if (numCount / total >= 0.5) return 'number';
	if (total >= 4 && distinctValues.size <= Math.max(3, Math.floor(total * 0.6))) return 'dropdown';

	return 'text';
}


/**
 * Told when the import silently left something behind.
 *
 * The parser cannot raise a toast itself - the store is context-scoped - so it hands
 * the sentence to whoever called it.
 */
export type ImportWarn = (message: string) => void;

export async function parseSpreadsheetBuffer(
	buffer: ArrayBuffer | Uint8Array,
	title = 'Imported Spreadsheet',
	onWarning?: ImportWarn
): Promise<TableData> {
	if (buffer.byteLength > MAX_IMPORT_BYTES) {
		throw new Error(`File size (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB) exceeds 10 MB limit.`);
	}

	const XLSX = await import('xlsx');
	const wb = XLSX.read(buffer, {
		type: 'array',
		cellDates: true,
		dateNF: 'yyyy-mm-dd'
	});

	const firstSheetName = wb.SheetNames[0];
	if (!firstSheetName) {
		throw new Error('Workbook contains no sheets.');
	}

	// Only the first sheet is imported. Dropping the rest without a word looks like
	// data loss, so name what was left behind.
	if (wb.SheetNames.length > 1) {
		const rest = wb.SheetNames.slice(1);
		onWarning?.(
			`Imported "${firstSheetName}" only. ${rest.length} other sheet${rest.length > 1 ? 's were' : ' was'} not read: ${rest.join(', ')}.`
		);
	}

	const ws = wb.Sheets[firstSheetName];
	const rawMatrix = XLSX.utils.sheet_to_json(ws, {
		header: 1,
		defval: null,
		raw: true,
		dateNF: 'yyyy-mm-dd'
	}) as CellValue[][];

	if (!rawMatrix || rawMatrix.length === 0) {
		throw new Error('The selected sheet is empty.');
	}

	// `sheet_to_json` hands back Excel's raw values. Overlay expressions so a
	// workbook round-trips as formulas instead of collapsing to cached results.
	// Excel's own rendering of each cell is kept alongside: the stored value is the
	// raw one, but the number *format* is the only thing that says whether 0.15 is a
	// count or 15%, so type inference reads the rendering instead.
	// The matrix is origin-shifted to `!ref`'s top-left, so a sheet whose data starts
	// at B3 puts B3 in `rawMatrix[0][0]` — the address has to be offset to match.
	const origin = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').s;
	const displayMatrix: (string | undefined)[][] = [];
	for (let r = 0; r < rawMatrix.length; r++) {
		displayMatrix[r] = [];
		for (let c = 0; c < (rawMatrix[r]?.length ?? 0); c++) {
			const addr = `${getExcelColumnName(origin.c + c)}${origin.r + r + 1}`;
			const cellObj = ws[addr] as { f?: string; v?: unknown; w?: string } | undefined;
			displayMatrix[r][c] = cellObj?.w;
			const current = rawMatrix[r][c] as unknown;
			if (cellObj?.f) {
				rawMatrix[r][c] = cellObj.f.startsWith('=') ? cellObj.f : `=${cellObj.f}`;
			} else if (current instanceof Date) {
				// `cellDates` hands back a Date, which a cell cannot hold. Excel's own
				// rendering is the date the sheet showed; ISO is the fallback.
				rawMatrix[r][c] = cellObj?.w ?? current.toISOString().slice(0, 10);
			} else if (current === null || current === undefined) {
				if (cellObj?.w !== undefined) {
					rawMatrix[r][c] = cellObj.w;
				}
			}
		}
	}

	// Trim only trailing empty rows so interior blank rows preserve row indices for formula addressing
	const isRowEmpty = (row?: CellValue[]) =>
		!row || !row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');

	const rowsMatrix = [...rawMatrix];
	while (rowsMatrix.length > 0 && isRowEmpty(rowsMatrix[rowsMatrix.length - 1])) {
		rowsMatrix.pop();
	}

	if (rowsMatrix.length === 0) {
		throw new Error('The selected sheet contains no data.');
	}

	const firstRow = rowsMatrix[0] ?? [];
	// #8 Compute max width across sampled rows to avoid dropping jagged tail columns
	const maxWidth = Math.max(...rowsMatrix.slice(0, 50).map((r) => r?.length ?? 0), firstRow.length);
	const colCount = Math.min(MAX_IMPORT_COLS, maxWidth);
	if (maxWidth > MAX_IMPORT_COLS) {
		const droppedCols = maxWidth - MAX_IMPORT_COLS;
		onWarning?.(
			`Imported ${MAX_IMPORT_COLS} columns only. ${droppedCols} column${droppedCols > 1 ? 's were' : ' was'} discarded.`
		);
	}

	// Check if first row looks like headers (mostly non-empty strings)
	const stringCount = firstRow.filter((c) => typeof c === 'string' && isNaN(Number(c))).length;
	const firstRowIsHeaders = stringCount >= Math.ceil(colCount * 0.4);

	const headerNames: string[] = [];
	const seenHeaders = new Map<string, number>();

	for (let c = 0; c < colCount; c++) {
		let rawName = firstRowIsHeaders && firstRow[c] !== null && firstRow[c] !== undefined
			? String(firstRow[c]).trim()
			: getExcelColumnName(c);

		if (!rawName) rawName = getExcelColumnName(c);

		const count = seenHeaders.get(rawName) || 0;
		seenHeaders.set(rawName, count + 1);

		const uniqueName = count === 0 ? rawName : `${rawName} (${count})`;
		headerNames.push(uniqueName);
	}

	const dataRows = firstRowIsHeaders ? rowsMatrix.slice(1) : rowsMatrix;
	const clampedRows = dataRows.slice(0, MAX_IMPORT_ROWS);
	if (dataRows.length > MAX_IMPORT_ROWS) {
		const droppedRows = dataRows.length - MAX_IMPORT_ROWS;
		onWarning?.(
			`Imported ${MAX_IMPORT_ROWS.toLocaleString()} rows only. ${droppedRows.toLocaleString()} row${droppedRows > 1 ? 's were' : ' was'} discarded.`
		);
	}

	// Sample column values for type inference. Only trailing rows were trimmed, so
	// `clampedRows[i]` is still `displayMatrix[headerOffset + i]`.
	const headerOffset = firstRowIsHeaders ? 1 : 0;
	const columns: Column[] = headerNames.map((name, c) => {
		const sampleVals = clampedRows.slice(0, 50).map((r, i) => {
			// Only a bare number is ambiguous - 1200.5 could be a count or a price, 0.15
			// a count or 15%. Its rendered form carries the format that decides.
			const raw = r[c];
			return typeof raw === 'number' ? (displayMatrix[headerOffset + i]?.[c] ?? raw) : raw;
		});
		const inferredType = inferColumnTypeFromSamples(sampleVals);
		return {
			id: `c${c + 1}`,
			name,
			type: inferredType,
			width: 160
		};
	});

	const rows: Row[] = clampedRows.map((r, rIdx) => {
		const rowObj: Row = { id: `r${rIdx + 1}` };
		for (let c = 0; c < colCount; c++) {
			const col = columns[c];
			const rawVal = r[c];
			rowObj[col.id] = normalizeCellValue(col.type, rawVal);
		}
		return rowObj;
	});

	return sanitizeAndNormalizeTableData(title, columns, rows);
}

export async function importFileToTable(
	input: File | ArrayBuffer | Uint8Array,
	filename?: string,
	onWarning?: ImportWarn
): Promise<TableData> {
	let arrayBuffer: ArrayBuffer;

	if (typeof File !== 'undefined' && input instanceof File) {
		arrayBuffer = await input.arrayBuffer();
		if (!filename) filename = input.name;
	} else if (input instanceof Uint8Array) {
		arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
	} else {
		arrayBuffer = input as ArrayBuffer;
	}

	if (!arrayBuffer || arrayBuffer.byteLength === 0) {
		throw new Error('The selected file is empty.');
	}

	const title = filename ? filename.replace(/\.[^/.]+$/, '').trim() : 'Imported Table';
	return parseSpreadsheetBuffer(arrayBuffer, title, onWarning);
}

