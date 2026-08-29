import type { Cell, SheetData } from 'write-excel-file/browser';
import type { CellAlignMap, CellValue, Column, ColumnType, Row, TableData } from '$lib/types';
import { defaultAlignForType, isFormula, isNumericType, numericCellValue } from '$lib/table/cells';

export function sanitizeFilename(raw?: string): string {
	const clean = (raw || 'table-export')
		.trim()
		.replace(/[^a-z0-9._-]+/gi, '-')
		.replace(/[-_.]{2,}/g, '-')
		.replace(/^[-_.]+|[-_.]+$/g, '');
	return clean || 'table-export';
}


export function buildUniqueExportHeaders(columns: Column[]): Array<{ id: string; header: string }> {
	const seen = new Map<string, number>();
	return columns.map((col) => {
		const baseName = col.name ? col.name.trim() : 'Column';
		const count = seen.get(baseName) || 0;
		seen.set(baseName, count + 1);

		const header = count === 0 ? baseName : `${baseName} (${count})`;
		return { id: col.id, header };
	});
}

export function sanitizeCsvValue(val: CellValue, safeFormulaEscape = true): string {
	if (val === null || val === undefined) return '';
	let str = String(val);

	// CSV Formula Injection mitigation: prefix leading formula characters with a single quote
	if (safeFormulaEscape && typeof val === 'string') {
		const trimmed = str.trimStart();
		if (/^[=+\-@\t\r]/.test(trimmed)) {
			str = `'${str}`;
		}
	}

	if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
		return `"${str.replace(/"/g, '""')}"`;
	}

	return str;
}

export function tableToRecords(table: TableData): Record<string, CellValue>[] {
	const headerMap = buildUniqueExportHeaders(table.columns || []);
	const rows = table.rows || [];

	return rows.map((row) => {
		const record: Record<string, CellValue> = {};
		for (const { id, header } of headerMap) {
			const rawVal = row ? row[id] : null;
			record[header] = rawVal ?? null;
		}
		return record;
	});
}

export function tableToCsv(table: TableData, options: { safeFormulaEscape?: boolean } = {}): string {
	const safeEscape = options.safeFormulaEscape ?? true;
	const headerMap = buildUniqueExportHeaders(table.columns || []);
	const headers = headerMap.map((h) => sanitizeCsvValue(h.header, safeEscape));

	const lines = [headers.join(',')];

	for (const row of table.rows || []) {
		const line = headerMap.map(({ id }) => {
			const val = row ? row[id] : null;
			return sanitizeCsvValue(val, safeEscape);
		});
		lines.push(line.join(','));
	}

	return lines.join('\r\n');
}

/** Excel number formats mirroring the grid's Intl formatters in `constants.ts`. */
const NUMBER_FORMAT: Partial<Record<ColumnType, string>> = {
	currency: '"$"#,##0.00',
	percent: '0.0#%'
};

/** Resize handles store widths in px; Excel counts them in characters. */
function widthInChars(px: number | undefined): number | undefined {
	if (!px) return undefined;
	return Math.min(80, Math.max(4, Math.round(px / 7)));
}

function toSheetCell(column: Column, row: Row | undefined, cellAlign: CellAlignMap): Cell {
	const align = cellAlign[`${row?.id}::${column.id}`] ?? defaultAlignForType(column.type);
	const raw = row?.[column.id];

	if (raw === null || raw === undefined || raw === '') return null;

	// The `<f>` element carries the expression without its leading `=`; passing the
	// typed string through verbatim writes `<f>=SUM(..)</f>`, which is off-spec.
	// Excel computes the result when it opens the file — write-excel-file has no slot
	// for a cached value, so the cell reads blank in viewers that do not recalculate.
	if (isFormula(raw)) return { value: raw.slice(1), type: 'Formula', align };

	if (typeof raw === 'boolean') return { value: raw, type: Boolean, align };

	if (isNumericType(column.type)) {
		const num = numericCellValue(column.type, raw);
		// Unparseable text sitting in a numeric column still has to survive the export.
		if (num !== null) {
			const format = NUMBER_FORMAT[column.type];
			return { value: num, type: Number, ...(format ? { format } : {}), align };
		}
	}

	// Dates stay strings on purpose — the grid never reparses them either, so a
	// DD-MM-YYYY table exports exactly as typed instead of being guessed at.
	return { value: String(raw), type: String, align };
}

/** Exported for tests: the sheet matrix, without the zip step. */
export function buildXlsxSheetData(table: TableData): SheetData {
	const columns = table.columns || [];
	const cellAlign = table.cellAlign ?? {};
	const sheetData: SheetData = [
		buildUniqueExportHeaders(columns).map(({ header }) => ({
			value: header,
			type: String,
			fontWeight: 'bold' as const
		}))
	];

	for (const row of table.rows || []) {
		sheetData.push(columns.map((col) => toSheetCell(col, row, cellAlign)));
	}

	return sheetData;
}

export async function exportTableToXlsx(table: TableData): Promise<Blob> {
	const writeXlsxFile = (await import('write-excel-file/browser')).default;
	return writeXlsxFile(buildXlsxSheetData(table), {
		sheet: 'Sheet1',
		columns: (table.columns || []).map((col) => ({ width: widthInChars(col.width) }))
	}).toBlob();
}

export async function downloadTableAsXlsx(table: TableData, customFilename?: string): Promise<void> {
	const blob = await exportTableToXlsx(table);
	triggerBrowserDownload(blob, `${sanitizeFilename(customFilename || table.title)}.xlsx`);
}


export function downloadTableAsCsv(table: TableData, customFilename?: string): void {
	const csvContent = tableToCsv(table, { safeFormulaEscape: true });
	const filename = `${sanitizeFilename(customFilename || table.title)}.csv`;
	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	triggerBrowserDownload(blob, filename);
}

export async function exportTableToCsv(table: TableData, filename?: string): Promise<string> {
	const csvString = tableToCsv(table, { safeFormulaEscape: true });
	if (typeof window !== 'undefined') {
		downloadTableAsCsv(table, filename);
	}
	return csvString;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
	if (typeof window === 'undefined') return;
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

