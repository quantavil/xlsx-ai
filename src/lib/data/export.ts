import type { TableData, Column, CellValue } from '$lib/types';

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

export async function exportTableToXlsx(table: TableData): Promise<Uint8Array> {
	const XLSX = await import('xlsx');
	const headerMap = buildUniqueExportHeaders(table.columns || []);
	const headers = headerMap.map((h) => h.header);

	const dataRows: (CellValue | undefined)[][] = [headers];

	for (const row of table.rows || []) {
		const line = headerMap.map(({ id }) => (row ? row[id] : null));
		dataRows.push(line);
	}

	const ws = XLSX.utils.aoa_to_sheet(dataRows);
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

	const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
	return new Uint8Array(buffer);
}

export async function downloadTableAsXlsx(table: TableData, customFilename?: string): Promise<void> {
	const bytes = await exportTableToXlsx(table);
	const filename = `${sanitizeFilename(customFilename || table.title)}.xlsx`;
	const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	const blob = new Blob([arrayBuffer], {
		type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
	});
	triggerBrowserDownload(blob, filename);
}


export function downloadTableAsCsv(table: TableData, customFilename?: string): void {
	const csvContent = tableToCsv(table, { safeFormulaEscape: true });
	const filename = `${sanitizeFilename(customFilename || table.title)}.csv`;
	const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
	triggerBrowserDownload(blob, filename);
}

export async function exportTableToExcel(table: TableData, filename?: string): Promise<Uint8Array> {
	if (typeof window !== 'undefined') {
		await downloadTableAsXlsx(table, filename);
	}
	return exportTableToXlsx(table);
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

