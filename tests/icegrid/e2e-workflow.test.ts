import { describe, it, expect } from 'bun:test';
import * as XLSX from 'xlsx';
import { combineDocumentSources } from '../../src/lib/modules/icegrid/readers';
import { IcegridReportSchema } from '../../src/lib/modules/icegrid/schema';
import { validateIcegridReport } from '../../src/lib/modules/icegrid/validate';
import { mapReportToTableData } from '../../src/lib/modules/icegrid/to-table';
import { ICEGRID_HEADERS } from '../../src/lib/modules/icegrid/columns';
import { tableToRecords } from '../../src/lib/data/export';

describe('Layer 5: ICEGrid End-to-End Extraction & Excel Export Workflow', () => {
	it('executes full pipeline: multi-file reader -> schema -> validator -> table mapper -> SheetJS Excel export', async () => {
		// 1. Synthesize Invoice XLSX
		const invWb = XLSX.utils.book_new();
		const invData = [
			['Invoice Number', 'INV-2026-EXPORT-101'],
			['Date', '2026-08-28'],
			['Currency', 'USD'],
			[],
			['Item No', 'Description', 'HS Code', 'Quantity', 'Unit', 'Unit Price', 'Total Amount'],
			['1', 'Precision CNC Machined Aluminum Flange 50mm', '84833000', '250', 'PCS', '45.00', '11250.00'],
			['2', 'Stainless Steel Hex Bolts M10x50 Grade 8.8', '73181500', '1000', 'NOS', '1.20', '1200.00']
		];
		const invWs = XLSX.utils.aoa_to_sheet(invData);
		XLSX.utils.book_append_sheet(invWb, invWs, 'Commercial_Invoice');
		const invFile = new File([XLSX.write(invWb, { type: 'array', bookType: 'xlsx' })], 'Commercial_Invoice.xlsx');

		// 2. Synthesize Packing List PDF
		const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 95 >> stream
BT /F1 12 Tf 50 700 Td (PACKING LIST - INV-2026-EXPORT-101) Tj 0 -20 Td (Total Packages: 12 Cartons | Gross Wt: 340 KGS | Port: INNSA1) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000390 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
467
%%EOF`;
		const packFile = new File([new TextEncoder().encode(minimalPdf)], 'Packing_List.pdf', {
			type: 'application/pdf'
		});

		// 3. Local Multi-File Extraction
		const extraction = await combineDocumentSources([invFile, packFile]);
		expect(extraction.sourceFiles).toEqual(['Commercial_Invoice.xlsx', 'Packing_List.pdf']);
		expect(extraction.content).toContain('=== FILE: Commercial_Invoice.xlsx ===');
		expect(extraction.content).toContain('Precision CNC Machined Aluminum Flange 50mm');
		expect(extraction.content).toContain('=== FILE: Packing_List.pdf ===');
		expect(extraction.content).toContain('PACKING LIST');

		// 4. Mocked Gemini Structured Output Result matching the documents
		const geminiResponse = {
			reportVersion: 1 as const,
			sourceFiles: extraction.sourceFiles,
			rows: [
				{
					InvoiceSNo: 1,
					ItemSNo: 1,
					InvoiceNo: 'INV-2026-EXPORT-101',
					Description: 'Precision CNC Machined Aluminum Flange 50mm',
					EndUse: null,
					HAWBL_No: null,
					Total_Package: 12,
					Accessories: null,
					RewardItem: 'Y',
					IGST_PaymentStatus: 'LUT',
					RITCCode: '84833000',
					ApplicableExpSchemes: 'RODTEP',
					Quantity: 250,
					QuantityUnit: 'PCS',
					SQCQTY: 250,
					SQCUnit: 'PCS',
					NetWeight: null,
					Materials: null,
					UnitPrice: 45.0,
					ProductAmount: 11250.0,
					Per: 1,
					PerUnit: 'PCS',
					drawback_schno: '8483A',
					dbk_qty: 250,
					dbk_rate: 1.5,
					dbk_unit: 'PCS',
					dbk_desc: 'Flange DBK',
					ROSLRate: null,
					ROSLCapValue: null,
					CountryDestination: 'US',
					FTACode: 'NCPTI',
					StateOrigin: 'Gujarat',
					DistrictOrigin: 'Ahmedabad',
					Taxable_Value: 11250.0,
					IGST_Rate: 18,
					IGST_Amount: 2025.0,
					GSTCCessAmount: 0,
					RODTEP: '0.8%',
					RoDTEPQty: 250
				},
				{
					InvoiceSNo: 1,
					ItemSNo: 2,
					InvoiceNo: 'INV-2026-EXPORT-101',
					Description: 'Stainless Steel Hex Bolts M10x50 Grade 8.8',
					EndUse: null,
					HAWBL_No: null,
					Total_Package: 12,
					Accessories: null,
					RewardItem: 'Y',
					IGST_PaymentStatus: 'LUT',
					RITCCode: '73181500',
					ApplicableExpSchemes: 'RODTEP',
					Quantity: 1000,
					QuantityUnit: 'NOS',
					SQCQTY: 1000,
					SQCUnit: 'NOS',
					NetWeight: null,
					Materials: null,
					UnitPrice: 1.2,
					ProductAmount: 1200.0,
					Per: 1,
					PerUnit: 'NOS',
					drawback_schno: '7318A',
					dbk_qty: 1000,
					dbk_rate: 2.0,
					dbk_unit: 'NOS',
					dbk_desc: 'Bolt DBK',
					ROSLRate: null,
					ROSLCapValue: null,
					CountryDestination: 'US',
					FTACode: 'NCPTI',
					StateOrigin: 'Gujarat',
					DistrictOrigin: 'Ahmedabad',
					Taxable_Value: 1200.0,
					IGST_Rate: 18,
					IGST_Amount: 216.0,
					GSTCCessAmount: 0,
					RODTEP: '1.0%',
					RoDTEPQty: 1000
				}
			],
			warnings: []
		};

		// 5. Validate Structured Report Schema
		const parsedReport = IcegridReportSchema.parse(geminiResponse);
		expect(parsedReport.rows.length).toBe(2);

		// 6. Run Deterministic Validation
		const validation = validateIcegridReport(parsedReport);
		expect(validation.valid).toBe(true);
		expect(validation.blockingErrors.length).toBe(0);

		// 7. Map to Host TableData
		const tableData = mapReportToTableData(parsedReport);
		expect(tableData.title).toBe('ICEGrid - INV-2026-EXPORT-101');
		expect(tableData.columns.length).toBe(37);
		expect(tableData.rows.length).toBe(2);

		// 8. Reusable Excel Export Check
		const records = tableToRecords(tableData);
		expect(records.length).toBe(2);

		const exportWb = XLSX.utils.book_new();
		const exportWs = XLSX.utils.json_to_sheet(records, { header: ICEGRID_HEADERS });
		XLSX.utils.book_append_sheet(exportWb, exportWs, 'ICEGrid_Output');

		const exportBuffer = XLSX.write(exportWb, { type: 'array', bookType: 'xlsx' });
		expect(exportBuffer.byteLength).toBeGreaterThan(1000);

		// 9. Re-read Exported Excel Workbook and Verify Headers & Data Integrity
		const reloadedWb = XLSX.read(exportBuffer, { type: 'array' });
		const firstSheet = reloadedWb.Sheets['ICEGrid_Output'];
		
		// Verify Header Row (Row 1)
		const sheetRows = XLSX.utils.sheet_to_json<string[]>(firstSheet, { header: 1 });
		const headerRow = sheetRows[0];
		expect(headerRow.length).toBe(37);
		expect(headerRow).toEqual(ICEGRID_HEADERS);

		// Verify Data Rows with defval for complete 37-column object mapping
		const reloadedJson = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: null });
		expect(reloadedJson.length).toBe(2);
		expect(Object.keys(reloadedJson[0])).toEqual(ICEGRID_HEADERS);
		expect(reloadedJson[0]['InvoiceNo']).toBe('INV-2026-EXPORT-101');
		expect(reloadedJson[0]['Quantity']).toBe(250);
		expect(reloadedJson[0]['UnitPrice']).toBe(45.0);
		expect(reloadedJson[0]['ProductAmount']).toBe(11250.0);
		expect(reloadedJson[1]['ItemSNo']).toBe(2);
		expect(reloadedJson[1]['ProductAmount']).toBe(1200.0);
	});
});
