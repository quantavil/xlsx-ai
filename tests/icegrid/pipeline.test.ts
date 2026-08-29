import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { icegridModule, summarizeWarnings } from '../../src/lib/modules/icegrid';
import { ICEGRID_HEADERS } from '../../src/lib/modules/icegrid/columns';
import type { ModuleContext } from '../../src/lib/modules/types';

const INVOICE_ROWS = [
	['Invoice Number', 'INV-A'],
	['Destination', 'United States'],
	['State of Origin', 'RAJASTHAN'],
	[],
	['Item', 'Description', 'HS Code', 'Qty', 'Unit', 'Rate', 'Amount', 'Scheme'],
	['1', 'SIDE TABLE LARGE', '94038900', '48', 'PCS', '30.00', '1,440.00', '19'],
	['2', 'WALL CLOCK 24 INCH', '91059990', '120', 'PCS', '36.57', '4,388.40', '19']
];

function invoiceFile(): File {
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(INVOICE_ROWS), 'Invoice');
	return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'invoice.xlsx');
}

function packingFile(): File {
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.aoa_to_sheet([
			['Packing List', 'INV-A'],
			['Description', 'Net Weight', 'Unit'],
			['SIDE TABLE LARGE', '67.5', 'KGS']
		]),
		'Packing'
	);
	return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'packing.xlsx');
}

/** A response shaped the way the tightened prompt asks Gemini to answer. */
const AI_RESPONSE = {
	rows: [
		{
			...Object.fromEntries(ICEGRID_HEADERS.map((h) => [h, null])),
			InvoiceNo: 'INV-A',
			Description: 'SIDE TABLE LARGE',
			RITCCode: '94038900',
			Quantity: 48,
			QuantityUnit: 'PCS',
			UnitPrice: 30,
			ProductAmount: 1440,
			ApplicableExpSchemes: '19',
			CountryDestination: 'United States',
			StateOrigin: 'RAJASTHAN',
			SQCQTY: 67.5,
			SQCUnit: 'KGS',
			// Unsupported by any document: must be blanked.
			FTACode: 'NCPTI',
			EndUse: 'GNX100',
			// Serial/mechanical fields the model was told to leave null.
			InvoiceSNo: null,
			ItemSNo: null,
			Accessories: 'N',
			evidence: [
				{
					sourceFile: 'invoice.xlsx',
					location: 'Sheet Invoice row 6',
					quote: '1\tSIDE TABLE LARGE\t94038900\t48\tPCS\t30.00\t1,440.00\t19',
					fields: [
						'Description',
						'RITCCode',
						'Quantity',
						'QuantityUnit',
						'UnitPrice',
						'ProductAmount',
						'ApplicableExpSchemes'
					]
				},
				{
					sourceFile: 'invoice.xlsx',
					location: 'Sheet Invoice row 1',
					quote: 'Invoice Number\tINV-A',
					fields: ['InvoiceNo']
				},
				{
					sourceFile: 'invoice.xlsx',
					location: 'Sheet Invoice row 2',
					quote: 'Destination\tUnited States',
					fields: ['CountryDestination']
				},
				{
					sourceFile: 'invoice.xlsx',
					location: 'Sheet Invoice row 3',
					quote: 'State of Origin\tRAJASTHAN',
					fields: ['StateOrigin']
				},
				{
					sourceFile: 'packing.xlsx',
					location: 'Sheet Packing row 3',
					quote: 'SIDE TABLE LARGE\t67.5\tKGS',
					fields: ['SQCQTY', 'SQCUnit']
				},
				{
					// Fabricated: this text is in neither file.
					sourceFile: 'invoice.xlsx',
					location: 'Sheet Invoice',
					quote: 'FTA Preference NCPTI End Use GNX100',
					fields: ['FTACode', 'EndUse']
				}
			]
		},
		{
			...Object.fromEntries(ICEGRID_HEADERS.map((h) => [h, null])),
			InvoiceNo: 'INV-A',
			Description: 'WALL CLOCK 24 INCH',
			Quantity: 120,
			QuantityUnit: 'PCS',
			evidence: [
				{
					sourceFile: 'invoice.xlsx',
					location: 'Sheet Invoice row 7',
					quote: '2\tWALL CLOCK 24 INCH\t91059990\t120\tPCS\t36.57\t4,388.40\t19',
					fields: ['Description', 'Quantity', 'QuantityUnit']
				},
				{
					sourceFile: 'invoice.xlsx',
					location: 'Sheet Invoice row 1',
					quote: 'Invoice Number\tINV-A',
					fields: ['InvoiceNo']
				}
			]
		}
	],
	warnings: []
};

function makeContext(overrides: Partial<ModuleContext> = {}) {
	const calls: unknown[] = [];
	const progress: string[] = [];
	const context = {
		ai: {
			apiKey: 'x'.repeat(40),
			modelId: 'gemini-test',
			async request(payload: unknown) {
				calls.push(payload);
				return { success: true, data: { reportVersion: 1, sourceFiles: ['invoice.xlsx', 'packing.xlsx'], ...AI_RESPONSE } };
			}
		},
		signal: new AbortController().signal,
		onProgress: (m: string) => progress.push(m),
		...overrides
	} as unknown as ModuleContext;
	return { context, calls, progress };
}

describe('icegridModule.run pipeline', () => {
	it('sends exactly one AI request for all selected files', async () => {
		const { context, calls } = makeContext();
		await icegridModule.run([invoiceFile(), packingFile()], context);

		expect(calls).toHaveLength(1);
		const payload = calls[0] as { operation: unknown; input: { sourceFiles: string[] } };
		expect(payload.operation).toEqual({ kind: 'module', moduleId: 'icegrid', action: 'extract' });
		expect(payload.input.sourceFiles).toEqual(['invoice.xlsx', 'packing.xlsx']);
	});

	it('produces a 37-column table with mechanically assigned serials', async () => {
		const { context } = makeContext();
		const result = await icegridModule.run([invoiceFile(), packingFile()], context);

		expect(result.table.columns.map((c) => c.id)).toEqual(ICEGRID_HEADERS);
		expect(result.table.rows.map((r) => [r.InvoiceSNo, r.ItemSNo])).toEqual([
			[1, 1],
			[1, 2]
		]);
	});

	it('keeps evidence-backed values and converts them through the catalogs', async () => {
		const { context } = makeContext();
		const [row] = (await icegridModule.run([invoiceFile(), packingFile()], context)).table.rows;

		expect(row.Description).toBe('SIDE TABLE LARGE');
		expect(row.Quantity).toBe(48);
		expect(row.QuantityUnit).toBe('PCS');
		expect(row.ProductAmount).toBe(1440);
		// Cross-file: the packing list supports the SQC values.
		expect(row.SQCQTY).toBe(67.5);
		expect(row.SQCUnit).toBe('KGS');
		// Exact catalog conversions.
		expect(row.CountryDestination).toBe('US');
		expect(row.StateOrigin).toBe('08');
		expect(row.ApplicableExpSchemes).toBe('19-Drawback (DBK)');
	});

	it('blanks values whose evidence was fabricated, and says so', async () => {
		const { context } = makeContext();
		const result = await icegridModule.run([invoiceFile(), packingFile()], context);

		expect(result.table.rows[0].FTACode).toBeNull();
		expect(result.table.rows[0].EndUse).toBeNull();
		expect(result.warnings.some((w) => w.includes('FTACode'))).toBe(true);
		expect(result.warnings.some((w) => w.includes('EndUse'))).toBe(true);
	});

	it('clears Accessories and applies Per = 1 regardless of AI output', async () => {
		const { context } = makeContext();
		const result = await icegridModule.run([invoiceFile(), packingFile()], context);

		for (const row of result.table.rows) {
			expect(row.Accessories).toBeNull();
			expect(row.Per).toBe(1);
		}
	});

	it('never derives ProductAmount for a row the document did not state it for', async () => {
		const { context } = makeContext();
		const result = await icegridModule.run([invoiceFile(), packingFile()], context);

		// Row 2 has Quantity and a unit but no evidence-backed amount or price.
		expect(result.table.rows[1].Quantity).toBe(120);
		expect(result.table.rows[1].ProductAmount).toBeNull();
		expect(result.table.rows[1].UnitPrice).toBeNull();
	});

	it('reports progress phases in order', async () => {
		const { context, progress } = makeContext();
		await icegridModule.run([invoiceFile(), packingFile()], context);

		const joined = progress.join(' | ');
		for (const phase of ['Reading', 'Extracting', 'Verifying evidence', 'Validating', 'Preparing table']) {
			expect(joined, phase).toContain(phase);
		}
	});

	it('still returns an editable table when there are warnings', async () => {
		const { context } = makeContext();
		const result = await icegridModule.run([invoiceFile(), packingFile()], context);

		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.table.rows).toHaveLength(2);
	});

	it('rejects an empty selection', async () => {
		const { context } = makeContext();
		await expect(icegridModule.run([], context)).rejects.toThrow('No files selected');
	});

	it('never leaks the API key or the document body into warnings', async () => {
		const { context } = makeContext();
		const result = await icegridModule.run([invoiceFile(), packingFile()], context);

		for (const warning of result.warnings) {
			expect(warning).not.toContain('x'.repeat(40));
			expect(warning).not.toContain('=== FILE:');
		}
	});
});

describe('icegridModule.run — schedule and derived fill', () => {
	it('fills the RITC-keyed schedule columns for the row that has a tariff code', async () => {
		const { context } = makeContext();
		const [row] = (await icegridModule.run([invoiceFile(), packingFile()], context)).table.rows;

		// The packing list states KGS and evidence outranks the schedule, which would
		// otherwise have supplied NOS from 94038900's UQC.
		expect(row.SQCUnit).toBe('KGS');
		expect(row.RODTEP).toBe('Yes');
		expect(row.drawback_schno).toBe('940399B');
		expect(row.dbk_rate).toBe(1.2);
	});

	it('applies the copy rules without touching evidence-backed values', async () => {
		const { context } = makeContext();
		const [row] = (await icegridModule.run([invoiceFile(), packingFile()], context)).table.rows;

		expect(row.PerUnit).toBe('PCS');
		expect(row.dbk_unit).toBe('PCS');
		expect(row.dbk_qty).toBe(48);
		// SQCQTY came from the packing list, so RoDTEPQty tracks it rather than Quantity.
		expect(row.SQCQTY).toBe(67.5);
		expect(row.RoDTEPQty).toBe(67.5);
		expect(row.Quantity).toBe(48);
	});

	it('leaves the exporter constants blank when no profile is set', async () => {
		const { context } = makeContext();
		const [row] = (await icegridModule.run([invoiceFile(), packingFile()], context)).table.rows;

		// ApplicableExpSchemes is absent here: the invoice prints "19" in its Scheme
		// column, so it arrives by extraction rather than from the profile.
		for (const header of ['EndUse', 'FTACode', 'RewardItem', 'DistrictOrigin']) {
			expect(row[header], header).toBeNull();
		}
	});

	it('opens the warnings with a provenance summary and cites the notifications', async () => {
		const { context } = makeContext();
		const result = await icegridModule.run([invoiceFile(), packingFile()], context);

		expect(result.warnings[0]).toMatch(/Filled \d+ cell\(s\) from the documents/);
		expect(result.warnings.some((w) => w.includes('77/2023'))).toBe(true);
	});

	it('reports the two new pipeline phases', async () => {
		const { context, progress } = makeContext();
		await icegridModule.run([invoiceFile(), packingFile()], context);
		expect(progress.join(' | ')).toContain('Filling schedule and derived values');
	});
});

describe('summarizeWarnings', () => {
	it('passes short lists through and truncates long ones with a count', () => {
		expect(summarizeWarnings(['a', 'b'])).toEqual(['a', 'b']);
		expect(summarizeWarnings(['a', 'b', 'c', 'd', 'e'])).toEqual([
			'a',
			'b',
			'c',
			'...and 2 more review notes.'
		]);
	});
});
