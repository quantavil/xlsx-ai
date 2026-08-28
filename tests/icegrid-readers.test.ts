import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
	ICEGRID_COLUMNS,
	ICEGRID_HEADERS,
	buildIcegridTableColumns
} from '../src/lib/modules/icegrid/columns';
import {
	extractSpreadsheetText,
	combineDocumentSources,
	isSupportedExtension,
	MAX_COMBINED_BYTES
} from '../src/lib/modules/icegrid/readers';

describe('ICEGrid Column Catalog', () => {
	it('defines exactly 37 unique ordered headers matching the ICEGATE spec', () => {
		expect(ICEGRID_COLUMNS.length).toBe(37);
		expect(ICEGRID_HEADERS.length).toBe(37);

		const uniqueHeaders = new Set(ICEGRID_HEADERS);
		expect(uniqueHeaders.size).toBe(37);

		// Verify key header spellings and order
		expect(ICEGRID_HEADERS[0]).toBe('InvoiceSNo');
		expect(ICEGRID_HEADERS[1]).toBe('ItemSNo');
		expect(ICEGRID_HEADERS[2]).toBe('InvoiceNo');
		expect(ICEGRID_HEADERS[3]).toBe('Description');
		expect(ICEGRID_HEADERS[10]).toBe('RITCCode');
		expect(ICEGRID_HEADERS[12]).toBe('Quantity');
		expect(ICEGRID_HEADERS[16]).toBe('UnitPrice');
		expect(ICEGRID_HEADERS[17]).toBe('ProductAmount');
		expect(ICEGRID_HEADERS[31]).toBe('Taxable_Value');
		expect(ICEGRID_HEADERS[32]).toBe('IGST_Rate');
		expect(ICEGRID_HEADERS[33]).toBe('IGST_Amount');
		expect(ICEGRID_HEADERS[35]).toBe('RODTEP');
		expect(ICEGRID_HEADERS[36]).toBe('RoDTEPQty');
	});

	it('builds table columns with appropriate types and widths', () => {
		const tableCols = buildIcegridTableColumns();
		expect(tableCols.length).toBe(37);
		expect(tableCols[0].id).toBe('InvoiceSNo');
		expect(tableCols[0].type).toBe('number');

		const descCol = tableCols.find((c) => c.id === 'Description');
		expect(descCol?.type).toBe('text');
		expect(descCol?.width).toBeGreaterThanOrEqual(200);

		const priceCol = tableCols.find((c) => c.id === 'UnitPrice');
		expect(priceCol?.type).toBe('currency');
	});
});

describe('ICEGrid Document Readers', () => {
	it('keeps combined extracted text within the server module input limit', () => {
		expect(MAX_COMBINED_BYTES).toBeLessThanOrEqual(750_000);
	});

	it('validates supported file extensions (.xlsx, .xls, .pdf)', () => {
		expect(isSupportedExtension('invoice.xlsx')).toBe(true);
		expect(isSupportedExtension('INVOICE.XLS')).toBe(true);
		expect(isSupportedExtension('packing_list.pdf')).toBe(true);
		expect(isSupportedExtension('notes.txt')).toBe(false);
		expect(isSupportedExtension('document.docx')).toBe(false);
	});

	it('extracts spreadsheet sheets into clean tab-delimited text preserving values', async () => {
		// Generate an in-memory workbook
		const wb = XLSX.utils.book_new();
		const wsData = [
			['Invoice No', 'Item Desc', 'Qty', 'Rate', 'Amount'],
			['INV-2026-001', 'Cotton Yarn 30s', 500, 4.5, 2250],
			['INV-2026-001', 'Polyester Spun 40s', 300, 3.2, 960]
		];
		const ws = XLSX.utils.aoa_to_sheet(wsData);
		XLSX.utils.book_append_sheet(wb, ws, 'Invoice_Items');

		const wbOut = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
		const file = new File([wbOut], 'sample_invoice.xlsx', {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});

		const result = await extractSpreadsheetText(file);
		expect(result.filename).toBe('sample_invoice.xlsx');
		expect(result.sheetCount).toBe(1);
		expect(result.content).toContain('=== SHEET: Invoice_Items ===');
		expect(result.content).toContain('Cotton Yarn 30s');
		expect(result.content).toContain('2250');
	});

	it('combines multiple files preserving source boundaries and order', async () => {
		// Workbook 1: Invoice
		const wb1 = XLSX.utils.book_new();
		const ws1 = XLSX.utils.aoa_to_sheet([['Invoice No', 'Total USD'], ['INV-99', 15000]]);
		XLSX.utils.book_append_sheet(wb1, ws1, 'Summary');
		const file1 = new File([XLSX.write(wb1, { type: 'array', bookType: 'xlsx' })], 'invoice.xlsx');

		// Workbook 2: Packing List
		const wb2 = XLSX.utils.book_new();
		const ws2 = XLSX.utils.aoa_to_sheet([['Box No', 'Gross Wt', 'Net Wt'], ['1', 45.5, 42.0]]);
		XLSX.utils.book_append_sheet(wb2, ws2, 'Packing');
		const file2 = new File([XLSX.write(wb2, { type: 'array', bookType: 'xlsx' })], 'packing.xlsx');

		const progressLogs: string[] = [];
		const combined = await combineDocumentSources([file1, file2], (msg) => progressLogs.push(msg));

		expect(combined.sourceFiles).toEqual(['invoice.xlsx', 'packing.xlsx']);
		expect(combined.documents.length).toBe(2);
		expect(combined.content).toContain('=== FILE: invoice.xlsx ===');
		expect(combined.content).toContain('=== SHEET: Summary ===');
		expect(combined.content).toContain('=== FILE: packing.xlsx ===');
		expect(combined.content).toContain('=== SHEET: Packing ===');
		expect(progressLogs.length).toBe(2);
	});

	it('extracts searchable text from PDF pages preserving page boundaries', async () => {
		const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 12 Tf 100 700 Td (Invoice 98765 Cotton Fabric) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000339 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
416
%%EOF`;
		const pdfFile = new File([new TextEncoder().encode(minimalPdf)], 'invoice.pdf', {
			type: 'application/pdf'
		});

		const { extractPdfText } = await import('../src/lib/modules/icegrid/readers');
		const result = await extractPdfText(pdfFile);
		expect(result.filename).toBe('invoice.pdf');
		expect(result.pageCount).toBe(1);
		expect(result.content).toContain('=== PAGE: 1 ===');
		expect(result.content).toContain('Invoice 98765 Cotton Fabric');
	}, 15000);

	it('rejects empty (0 byte) files with informative error', async () => {
		const emptyFile = new File([], 'empty.xlsx');
		await expect(extractSpreadsheetText(emptyFile)).rejects.toThrow('empty (0 bytes)');
	});

	it('rejects unsupported file formats', async () => {
		const txtFile = new File(['some text'], 'test.csv'); // csv not in icegrid accept list (.pdf, .xlsx, .xls)
		await expect(combineDocumentSources([txtFile])).rejects.toThrow('Unsupported file type');
	});
});
