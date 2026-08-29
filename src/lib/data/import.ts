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
		if (typeof val === 'number' || (!isNaN(Number(cleanNum)) && !isNaN(parseFloat(cleanNum)) && !str.includes(':'))) {
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


export async function parseSpreadsheetBuffer(
	buffer: ArrayBuffer | Uint8Array,
	title = 'Imported Spreadsheet'
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

	const ws = wb.Sheets[firstSheetName];
	const rawMatrix = XLSX.utils.sheet_to_json(ws, {
		header: 1,
		defval: null,
		raw: false
	}) as CellValue[][];

	if (!rawMatrix || rawMatrix.length === 0) {
		throw new Error('The selected sheet is empty.');
	}

	// `sheet_to_json` hands back Excel's cached results. Overlay the expressions so a
	// workbook round-trips as formulas instead of collapsing to the numbers it last
	// computed. Only cells Excel actually stored a value for are visible here.
	// The matrix is origin-shifted to `!ref`'s top-left, so a sheet whose data starts
	// at B3 puts B3 in `rawMatrix[0][0]` — the address has to be offset to match.
	const origin = XLSX.utils.decode_range(ws['!ref'] ?? 'A1').s;
	for (let r = 0; r < rawMatrix.length; r++) {
		for (let c = 0; c < (rawMatrix[r]?.length ?? 0); c++) {
			const addr = `${getExcelColumnName(origin.c + c)}${origin.r + r + 1}`;
			const formula = (ws[addr] as { f?: string } | undefined)?.f;
			if (formula) rawMatrix[r][c] = formula.startsWith('=') ? formula : `=${formula}`;
		}
	}

	// Filter out empty trailing rows
	const nonEmptyMatrix = rawMatrix.filter((row) =>
		row && row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')
	);

	if (nonEmptyMatrix.length === 0) {
		throw new Error('The selected sheet contains no data.');
	}

	const firstRow = nonEmptyMatrix[0];
	// #8 Compute max width across sampled rows to avoid dropping jagged tail columns
	const maxWidth = Math.max(...nonEmptyMatrix.slice(0, 50).map((r) => r?.length ?? 0), firstRow.length);
	const colCount = Math.min(MAX_IMPORT_COLS, maxWidth);

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

	const dataRows = firstRowIsHeaders ? nonEmptyMatrix.slice(1) : nonEmptyMatrix;
	const clampedRows = dataRows.slice(0, MAX_IMPORT_ROWS);

	// Sample column values for type inference
	const columns: Column[] = headerNames.map((name, c) => {
		const sampleVals = clampedRows.slice(0, 50).map((r) => r[c]);
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
	filename?: string
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

	const title = filename ? filename.replace(/\.[^/.]+$/, '') : 'Imported Table';
	return parseSpreadsheetBuffer(arrayBuffer, title);
}

