import { describe, it, expect } from 'vitest';
import { validateIcegridReport } from '../src/lib/modules/icegrid/validate';
import { mapReportToTableData } from '../src/lib/modules/icegrid/to-table';
import { ICEGRID_HEADERS } from '../src/lib/modules/icegrid/columns';
import type { IcegridReport, IcegridRow } from '../src/lib/modules/icegrid/schema';

describe('ICEGrid Validation and Mapping', () => {
	const sampleRow: IcegridRow = {
		InvoiceSNo: 1,
		ItemSNo: 1,
		InvoiceNo: 'INV-2026-900',
		Description: 'Woven Cotton Fabric 100% Dyed',
		EndUse: 'GNX100',
		HAWBL_No: 'HAWB-554433',
		Total_Package: 10,
		Accessories: null,
		RewardItem: 'Yes',
		IGST_PaymentStatus: 'LUT',
		RITCCode: '52081190',
		ApplicableExpSchemes: '19-Drawback (DBK)',
		Quantity: 1000,
		QuantityUnit: 'MTR',
		SQCQTY: 1000,
		SQCUnit: 'MTR',
		UnitPrice: 3.5,
		ProductAmount: 3500.0,
		Per: 1,
		PerUnit: 'MTR',
		drawback_schno: '5208A',
		dbk_qty: 1000,
		dbk_rate: 2.0,
		dbk_unit: 'MTR',
		dbk_desc: 'Cotton fabric DBK',
		ROSLRate: null,
		ROSLCapValue: null,
		CountryDestination: 'US',
		FTACode: 'NCPTI',
		StateOrigin: 'Tamil Nadu',
		DistrictOrigin: 'Tirupur',
		Taxable_Value: 3500.0,
		IGST_Rate: 5,
		IGST_Amount: 175.0,
		GSTCCessAmount: 0,
		RODTEP: 'Yes',
		RoDTEPQty: 1000
	};

	const validReport: IcegridReport = {
		reportVersion: 1,
		sourceFiles: ['invoice_900.xlsx'],
		rows: [sampleRow],
		warnings: []
	};

	it('validates compliant reports with zero blocking errors', () => {
		const result = validateIcegridReport(validReport);
		expect(result.valid).toBe(true);
		expect(result.blockingErrors.length).toBe(0);
	});

	it('flags missing required invoice fields as warnings and still returns the rows', () => {
		const badReport: IcegridReport = {
			reportVersion: 1,
			sourceFiles: ['inv.pdf'],
			rows: [
				{
					...sampleRow,
					InvoiceNo: null,
					UnitPrice: null,
					Quantity: -5
				}
			],
			warnings: []
		};

		const result = validateIcegridReport(badReport);
		// Gaps are editable in the grid — they must not throw away the whole extraction.
		expect(result.valid).toBe(true);
		expect(result.blockingErrors.length).toBe(0);
		expect(result.warnings.some((w) => w.includes('InvoiceNo'))).toBe(true);
		expect(result.warnings.some((w) => w.includes('UnitPrice'))).toBe(true);
		expect(result.warnings.some((w) => /Quantity is negative/.test(w))).toBe(true);
	});

	it('blocks only when the report contains no rows at all', () => {
		const result = validateIcegridReport({
			reportVersion: 1,
			sourceFiles: ['inv.pdf'],
			rows: [],
			warnings: []
		});
		expect(result.valid).toBe(false);
		expect(result.blockingErrors[0]).toContain('no extracted data rows');
	});

	it('flags calculation discrepancies as non-blocking warnings', () => {
		const calcDiscrepancyReport: IcegridReport = {
			reportVersion: 1,
			sourceFiles: ['inv.xlsx'],
			rows: [
				{
					...sampleRow,
					Quantity: 100,
					UnitPrice: 10,
					ProductAmount: 1500 // Discrepancy: 100 * 10 = 1000, but amount is 1500
				}
			],
			warnings: []
		};

		const result = validateIcegridReport(calcDiscrepancyReport);
		// Discrepancy is a warning, not a hard blocking error
		expect(result.valid).toBe(true);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain('ProductAmount');
	});

	it('blocks reports whose claimed source files differ from the selected files', () => {
		const result = validateIcegridReport(validReport, ['different-invoice.xlsx']);
		expect(result.valid).toBe(false);
		expect(result.blockingErrors[0]).toContain('sourceFiles');
	});

	it('warns when a present RITC code is not exactly eight digits', () => {
		const report: IcegridReport = {
			...validReport,
			rows: [{ ...sampleRow, RITCCode: '520811' }]
		};
		const result = validateIcegridReport(report);
		expect(result.valid).toBe(true);
		expect(result.warnings.some((warning) => warning.includes('RITC code'))).toBe(true);
	});

	it('maps valid report to TableData with exactly 37 ordered columns', () => {
		const table = mapReportToTableData(validReport);
		expect(table.title).toBe('ICEGrid - INV-2026-900');
		expect(table.columns.length).toBe(37);
		expect(table.rows.length).toBe(1);

		// Check all 37 headers match
		for (let i = 0; i < 37; i++) {
			expect(table.columns[i].id).toBe(ICEGRID_HEADERS[i]);
			expect(table.columns[i].name).toBe(ICEGRID_HEADERS[i]);
		}

		// Verify row values
		const r = table.rows[0];
		expect(r.id).toBe('r1');
		expect(r.InvoiceNo).toBe('INV-2026-900');
		expect(r.Quantity).toBe(1000);
		expect(r.UnitPrice).toBe(3.5);
		expect(r.ProductAmount).toBe(3500.0);
		expect(r.Accessories).toBeNull();
		expect(r.InvoiceSNo).toBe(1);
	});

	it('assigns mechanical default values for null fields during mapping', () => {
		const sparseRow: IcegridRow = {
			...sampleRow,
			InvoiceSNo: null,
			Per: null
		};

		const sparseReport: IcegridReport = {
			reportVersion: 1,
			sourceFiles: ['test.xlsx'],
			rows: [sparseRow],
			warnings: []
		};

		const table = mapReportToTableData(sparseReport);
		const r = table.rows[0];
		expect(r.InvoiceSNo).toBe(1); // Default from column spec
		expect(r.Per).toBe(1); // Default from column spec
	});
});
