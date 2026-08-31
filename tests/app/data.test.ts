import { describe, it, expect } from 'bun:test';
import * as XLSX from 'xlsx';
import {
	inferColumnTypeFromSamples,
	importFileToTable,
	exportTableToCsv,
} from '../../src/lib/data';
import type { TableData } from '../../src/lib/types';
import { formatCellValue } from '../../src/lib/constants';
import { normalizeCellValue, numericCellValue } from '../../src/lib/table/cells';
import { buildXlsxSheetData, sanitizeFilename, tableToRecords } from '../../src/lib/data/export';



function workbookOf(sheets: Record<string, unknown[][]>): ArrayBuffer {
	const wb = XLSX.utils.book_new();
	for (const [name, aoa] of Object.entries(sheets)) {
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
	}
	return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('Data Management & SheetJS I/O', () => {
	it('names the sheets a multi-sheet import left behind', async () => {
		const warnings: string[] = [];
		const table = await importFileToTable(
			workbookOf({ Invoice: [['a'], [1]], Packing: [['b'], [2]], Notes: [['c'], [3]] }),
			'book.xlsx',
			(m) => warnings.push(m)
		);
		// The first sheet is still what gets imported; the warning is the only change.
		expect(table.columns[0].name).toBe('a');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('Packing, Notes');
	});

	it('says nothing when there is only one sheet', async () => {
		const warnings: string[] = [];
		await importFileToTable(workbookOf({ Only: [['a'], [1]] }), 'book.xlsx', (m) => warnings.push(m));
		expect(warnings).toEqual([]);
	});

	it('normalizes typed cell values consistently', () => {
		expect(normalizeCellValue('percent', '12.5%')).toBe(0.125);
		expect(normalizeCellValue('percent', '12.5')).toBe(0.125);
		expect(normalizeCellValue('currency', '$1,250.50')).toBe(1250.5);
		expect(normalizeCellValue('number', 'not a number')).toBeNull();
		expect(normalizeCellValue('text', false)).toBe(false);
		expect(normalizeCellValue('text', '  hello  ')).toBe('hello');
		expect(numericCellValue('percent', '0.5%')).toBe(0.005);
		expect(numericCellValue('text', '42')).toBeNull();
	});

	it('builds ordered export records and safe filenames', () => {
		const table: TableData = {
			title: 'Q4 / Revenue: 2026',
			columns: [
				{ id: 'name', name: 'User', type: 'text' },
				{ id: 'revenue', name: 'Revenue', type: 'currency' }
			],
			rows: [{ id: 'r1', name: 'Alice', revenue: 1200 }]
		};

		expect(sanitizeFilename(' Q4 / Revenue: 2026 ')).toBe('Q4-Revenue-2026');
		expect(sanitizeFilename('...')).toBe('table-export');
		expect(tableToRecords(table)).toEqual([{ User: 'Alice', Revenue: 1200 }]);
	});


	it('infers column types accurately based on heuristics', () => {
		expect(inferColumnTypeFromSamples(['$1,200.00', '$450.50', '$99.99', '$3,400'])).toBe('currency');
		expect(inferColumnTypeFromSamples(['12.5%', '85%', '99.9%', '0.4%'])).toBe('percent');
		expect(inferColumnTypeFromSamples(['2025-01-15', '2024-12-01', '2025-06-20'])).toBe('date');
		expect(inferColumnTypeFromSamples(['Active', 'Pending', 'Active', 'Pending', 'Closed Won'])).toBe('dropdown');
		expect(inferColumnTypeFromSamples([100, 250, 45.5, -12, '400'])).toBe('number');
		expect(inferColumnTypeFromSamples(['1,200', '4,500', '12,500.50', '980'])).toBe('number');
		expect(inferColumnTypeFromSamples(['Acme Corp', 'Stripe Inc', 'Vercel LLC', 'Google Cloud'])).toBe('text');
	});

	it('correctly normalizes and formats fractional percentages', () => {
		expect(formatCellValue('percent', '0.5%')).toBe('0.5%');
		expect(formatCellValue('percent', 0.005)).toBe('0.5%');
		expect(formatCellValue('percent', '12.5%')).toBe('12.5%');
		expect(formatCellValue('percent', 0.125)).toBe('12.5%');
	});

	it('imports XLSX workbook buffer into structured TableData', async () => {
		const wb = XLSX.utils.book_new();
		const wsData = [
			['Client Name', 'Contract Value', 'Growth Rate', 'Status'],
			['Alpha LLC', '$12,000', '15%', 'Active'],
			['Beta Corp', '$45,000', '28%', 'Pending'],
			['Gamma Inc', '$8,500', '0.5%', 'Completed']
		];
		const ws = XLSX.utils.aoa_to_sheet(wsData);
		XLSX.utils.book_append_sheet(wb, ws, 'Clients');
		const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

		const table = await importFileToTable(buf, 'clients.xlsx');
		expect(table.title).toBe('clients');
		expect(table.columns.length).toBe(4);
		expect(table.columns[0].name).toBe('Client Name');
		expect(table.columns[1].name).toBe('Contract Value');
		expect(table.columns[1].type).toBe('currency');
		expect(table.columns[2].type).toBe('percent');
		expect(table.rows.length).toBe(3);
		expect(table.rows[0][table.columns[0].id]).toBe('Alpha LLC');
		expect(table.rows[2][table.columns[2].id]).toBe(0.005);
	});

	it('keeps the raw value but takes the column type from Excel\'s number format', async () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([
			['When', 'Price', 'Share'],
			[new Date(Date.UTC(2023, 2, 15)), 1200.505, 0.15],
			[new Date(Date.UTC(2023, 2, 16)), 990.259, 0.5]
		]);
		for (const addr of ['B2', 'B3']) (ws[addr] as { z?: string }).z = '"$"#,##0.00';
		for (const addr of ['C2', 'C3']) (ws[addr] as { z?: string }).z = '0%';
		XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
		const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

		const table = await importFileToTable(buf, 'formats.xlsx');
		// The rendering says price and percentage; the raw value keeps the digits the
		// rendering rounded away, and a date arrives as a string a cell can hold.
		expect(table.columns.map((c) => c.type)).toEqual(['date', 'currency', 'percent']);
		expect(table.rows[0][table.columns[1].id]).toBe(1200.505);
		expect(table.rows[0][table.columns[2].id]).toBe(0.15);
		expect(String(table.rows[0][table.columns[0].id])).toStartWith('2023-03-15');
	});

	it('imports from sliced Uint8Array buffer respecting byteOffset', async () => {
		const wb = XLSX.utils.book_new();
		const wsData = [
			['Product', 'Qty'],
			['Widget A', 10]
		];
		const ws = XLSX.utils.aoa_to_sheet(wsData);
		XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
		const rawBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
		const u8 = new Uint8Array(rawBuf);

		// Create sliced Uint8Array with offset
		const padded = new Uint8Array(u8.byteLength + 20);
		padded.set(u8, 10);
		const sliced = padded.subarray(10, 10 + u8.byteLength);

		const table = await importFileToTable(sliced, 'sliced.xlsx');
		expect(table.rows.length).toBe(1);
		expect(table.columns[0].name).toBe('Product');
	});

	it('deduplicates duplicate column headers gracefully', async () => {
		const wb = XLSX.utils.book_new();
		const wsData = [
			['Name', 'Score', 'Name', 'Score'],
			['Alice', 95, 'Bob', 88]
		];
		const ws = XLSX.utils.aoa_to_sheet(wsData);
		XLSX.utils.book_append_sheet(wb, ws, 'Scores');
		const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

		const table = await importFileToTable(buf, 'scores.xlsx');
		expect(table.columns.map((c) => c.name)).toEqual(['Name', 'Score', 'Name (1)', 'Score (1)']);
	});

	it('exports table to CSV string accurately', async () => {
		const testTable: TableData = {
			title: 'Test Export',
			columns: [
				{ id: 'c1', name: 'User', type: 'text' },
				{ id: 'c2', name: 'Revenue', type: 'currency' }
			],
			rows: [
				{ id: 'r1', c1: 'Alice', c2: 1200 },
				{ id: 'r2', c1: 'Bob, Jr.', c2: 3400 }
			]
		};

		const csv = await exportTableToCsv(testTable);
		expect(csv).toContain('User,Revenue');
		expect(csv).toContain('"Bob, Jr."');
		expect(csv).toContain('1200');
	});

	it('handles empty files by throwing informative error', async () => {
		const emptyBuf = new Uint8Array(0);
		await expect(importFileToTable(emptyBuf, 'empty.csv')).rejects.toThrow();
	});

	it('mitigates CSV formula injection by quoting formula characters', async () => {
		const dangerousTable: TableData = {
			title: 'Security Test',
			columns: [
				{ id: 'c1', name: 'Formula Header', type: 'text' },
				{ id: 'c2', name: 'Cmd Header', type: 'text' }
			],
			rows: [
				{ id: 'r1', c1: '=SUM(1+1)', c2: '@calc|A1' },
				{ id: 'r2', c1: '+cmd.exe', c2: '-10% discount' }
			]
		};

		const csv = await exportTableToCsv(dangerousTable);
		expect(csv).toContain("'=SUM(1+1)");
		expect(csv).toContain("'@calc|A1");
		expect(csv).toContain("'+cmd.exe");
		expect(csv).toContain("'-10% discount");
	});


	it('disambiguates duplicate column names in tableToRecords without dropping data', () => {
		const duplicateColTable: TableData = {
			title: 'Duplicate Header Table',
			columns: [
				{ id: 'c1', name: 'Status', type: 'text' },
				{ id: 'c2', name: 'Status', type: 'text' }
			],
			rows: [{ id: 'r1', c1: 'Open', c2: 'Closed' }]
		};

		const records = tableToRecords(duplicateColTable);
		expect(records).toEqual([{ Status: 'Open', 'Status (1)': 'Closed' }]);
	});

	it('carries cell alignment and typed number formats into the xlsx sheet', () => {
		const table: TableData = {
			title: 'Styled',
			columns: [
				{ id: 'c1', name: 'Item', type: 'text' },
				{ id: 'c2', name: 'Price', type: 'currency' },
				{ id: 'c3', name: 'Share', type: 'percent' },
				{ id: 'c4', name: 'Due', type: 'date' },
				{ id: 'c5', name: 'Qty', type: 'number' }
			],
			rows: [{ id: 'r1', c1: 'Widget', c2: '$1,250.50', c3: '12.5%', c4: '05-04-2026', c5: 120 }],
			// The user centered one text cell; everything else falls back to the type default.
			cellAlign: { 'r1::c1': 'center' }
		};

		const [header, row] = buildXlsxSheetData(table);

		expect(header).toEqual([
			{ value: 'Item', type: String, fontWeight: 'bold' },
			{ value: 'Price', type: String, fontWeight: 'bold' },
			{ value: 'Share', type: String, fontWeight: 'bold' },
			{ value: 'Due', type: String, fontWeight: 'bold' },
			{ value: 'Qty', type: String, fontWeight: 'bold' }
		]);

		expect(row).toEqual([
			{ value: 'Widget', type: String, align: 'center' },
			{ value: 1250.5, type: Number, format: '"$"#,##0.00', align: 'right' },
			{ value: 0.125, type: Number, format: '0.0#%', align: 'right' },
			// Dates stay verbatim strings so a DD-MM-YYYY table survives the round trip.
			{ value: '05-04-2026', type: String, align: 'left' },
			{ value: 120, type: Number, align: 'right' }
		]);
	});

	it('writes empty cells as null and keeps unparseable numeric text', () => {
		const table: TableData = {
			title: 'Gaps',
			columns: [
				{ id: 'c1', name: 'Qty', type: 'number' },
				{ id: 'c2', name: 'Note', type: 'text' }
			],
			rows: [{ id: 'r1', c1: null, c2: '' }, { id: 'r2', c1: 'n/a', c2: 'ok' }]
		};

		const [, blank, fallback] = buildXlsxSheetData(table);
		expect(blank).toEqual([null, null]);
		expect(fallback).toEqual([
			{ value: 'n/a', type: String, align: 'right' },
			{ value: 'ok', type: String, align: 'left' }
		]);
	});

	it('preserves raw precision and string leading zeroes on import', async () => {
		const wb = XLSX.utils.book_new();
		const wsData = [
			['Code', 'Rate'],
			['00123', 1.234567]
		];
		const ws = XLSX.utils.aoa_to_sheet(wsData);
		// Format Rate cell to 2 decimal places in Excel
		ws['B2'].z = '0.00';
		ws['B2'].w = '1.23';
		XLSX.utils.book_append_sheet(wb, ws, 'Data');
		const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

		const table = await importFileToTable(buf, 'precision.xlsx');
		expect(table.rows[0].c1).toBe('00123');
		expect(table.rows[0].c2).toBe(1.234567);
	});

	it('strictly rejects non-numeric strings in numeric cells', () => {
		expect(normalizeCellValue('number', 'ABC123')).toBeNull();
		expect(normalizeCellValue('number', '12.34.56')).toBeNull();
		expect(normalizeCellValue('currency', 'Price: $100')).toBeNull();
		expect(normalizeCellValue('number', '$1,250.50')).toBe(1250.5);
		expect(normalizeCellValue('number', '-$50.25')).toBe(-50.25);
		expect(normalizeCellValue('number', '00123')).toBe(123);
	});

	it('preserves interior blank rows so formula cell addresses remain valid', async () => {
		const wb = XLSX.utils.book_new();
		const wsData = [
			['Header'],
			['First'],
			[null], // Interior blank row
			['=A2']  // Formula referencing A2
		];
		const ws = XLSX.utils.aoa_to_sheet(wsData);
		XLSX.utils.book_append_sheet(wb, ws, 'Sheet');
		const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

		const table = await importFileToTable(buf, 'blank_rows.xlsx');
		expect(table.rows.length).toBe(3);
		expect(table.rows[0].c1).toBe('First');
		expect(table.rows[1].c1).toBeNull();
		expect(table.rows[2].c1).toBe('=A2');
	});

	it('warns when column or row limits are exceeded', async () => {
		const warnings: string[] = [];
		const row101Cols = Array.from({ length: 105 }, (_, i) => `Col${i + 1}`);
		const rowData = Array.from({ length: 105 }, (_, i) => i);
		const buf = workbookOf({ Big: [row101Cols, rowData] });

		const table = await importFileToTable(buf, 'big.xlsx', (w) => warnings.push(w));
		expect(table.columns.length).toBe(100);
		expect(warnings.some((w) => w.includes('100 columns only') && w.includes('5 columns were discarded'))).toBe(true);
	});
});

