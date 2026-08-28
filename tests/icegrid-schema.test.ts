import { describe, it, expect } from 'vitest';
import { IcegridReportSchema, IcegridRowSchema } from '../src/lib/modules/icegrid/schema';

describe('ICEGrid Schema Validation', () => {
	const validRow = {
		InvoiceSNo: 1,
		ItemSNo: 1,
		InvoiceNo: 'EXP/2026/089',
		Description: 'Industrial Ball Bearings Stainless Steel 12mm',
		EndUse: 'Automotive OEM Assembly',
		HAWBL_No: 'HAWB-778899',
		Total_Package: 15,
		Accessories: null,
		RewardItem: 'Y',
		IGST_PaymentStatus: 'LUT',
		RITCCode: '84821011',
		ApplicableExpSchemes: 'MEIS',
		Quantity: 500,
		QuantityUnit: 'NOS',
		SQCQTY: 500,
		SQCUnit: 'NOS',
		UnitPrice: 24.5,
		ProductAmount: 12250.0,
		Per: 1,
		PerUnit: 'NOS',
		drawback_schno: '8482A',
		dbk_qty: 500,
		dbk_rate: 1.5,
		dbk_unit: 'NOS',
		dbk_desc: 'Ball bearings rate',
		ROSLRate: null,
		ROSLCapValue: null,
		CountryDestination: 'DE',
		FTACode: 'NONE',
		StateOrigin: 'Maharashtra',
		DistrictOrigin: 'Pune',
		Taxable_Value: 12250.0,
		IGST_Rate: 18,
		IGST_Amount: 2205.0,
		GSTCCessAmount: 0,
		RODTEP: '0.8%',
		RoDTEPQty: 500
	};

	it('validates a complete 37-column ICEGrid row with valid types and nulls', () => {
		const result = IcegridRowSchema.safeParse(validRow);
		expect(result.success).toBe(true);
	});

	it('validates a complete ICEGrid report with version, source files, and rows', () => {
		const report = {
			reportVersion: 1,
			sourceFiles: ['invoice_089.xlsx', 'packing_list.pdf'],
			rows: [validRow],
			warnings: ['Extracted single invoice with 1 itemized line.']
		};

		const result = IcegridReportSchema.safeParse(report);
		expect(result.success).toBe(true);
	});

	it('rejects reports with missing required 37 columns', () => {
		const incompleteRow: any = { ...validRow };
		delete incompleteRow.ProductAmount;

		const result = IcegridRowSchema.safeParse(incompleteRow);
		expect(result.success).toBe(false);
	});

	it('rejects reports with zero rows', () => {
		const emptyReport = {
			reportVersion: 1,
			sourceFiles: ['invoice.xlsx'],
			rows: [],
			warnings: []
		};

		const result = IcegridReportSchema.safeParse(emptyReport);
		expect(result.success).toBe(false);
	});

	it('rejects invalid report versions', () => {
		const wrongVersionReport = {
			reportVersion: 2,
			sourceFiles: ['invoice.xlsx'],
			rows: [validRow],
			warnings: []
		};

		const result = IcegridReportSchema.safeParse(wrongVersionReport);
		expect(result.success).toBe(false);
	});
});
