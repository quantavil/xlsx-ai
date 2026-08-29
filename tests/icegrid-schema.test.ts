import { describe, it, expect } from 'vitest';
import {
	IcegridReportSchema,
	IcegridAiReportSchema,
	IcegridRowSchema
} from '../src/lib/modules/icegrid/schema';

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
		FTACode: 'NCPTI',
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

	it('rejects AI responses with zero rows', () => {
		const emptyReport = {
			reportVersion: 1,
			sourceFiles: ['invoice.xlsx'],
			rows: [],
			warnings: []
		};

		// The AI-facing schema requires at least one row: an empty Gemini response is a
		// failed extraction. The post-sanitization report deliberately permits zero rows,
		// because blocking on "no rows" is validate.ts's job and carries a clear message.
		expect(IcegridAiReportSchema.safeParse(emptyReport).success).toBe(false);
		expect(IcegridReportSchema.safeParse(emptyReport).success).toBe(true);
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

describe('ICEGrid extraction schema is legal Gemini responseSchema', () => {
	// Regression guard for the bug that made every ICEGrid import fail with
	// "Gemini could not complete the request": Gemini's responseSchema only allows `enum`
	// on STRING types, so z.literal(1) -> {type:"number",enum:[1]} returned HTTP 400.
	function collectViolations(node: unknown, path = '$'): string[] {
		if (!node || typeof node !== 'object') return [];
		if (Array.isArray(node)) return node.flatMap((n, i) => collectViolations(n, `${path}[${i}]`));

		const schema = node as Record<string, unknown>;
		const found: string[] = [];
		if (Array.isArray(schema.enum) && schema.type !== 'string') {
			found.push(`${path}: enum on type "${String(schema.type)}" (Gemini allows enum only on STRING)`);
		}
		for (const [key, value] of Object.entries(schema)) {
			found.push(...collectViolations(value, `${path}.${key}`));
		}
		return found;
	}

	it('sends Gemini a responseSchema with no non-string enums', async () => {
		const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
		const { generateObject } = await import('ai');
		const { IcegridExtractionSchema } = await import('../src/lib/modules/icegrid/schema');

		let responseSchema: unknown = null;
		const captureFetch = (async (_url: string, init: { body: string }) => {
			responseSchema = JSON.parse(init.body).generationConfig?.responseSchema;
			return new Response(
				JSON.stringify({
					candidates: [
						{
							content: { role: 'model', parts: [{ text: '{"rows":[],"warnings":[]}' }] },
							finishReason: 'STOP'
						}
					],
					usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		}) as unknown as typeof fetch;

		const google = createGoogleGenerativeAI({ apiKey: 'x'.repeat(30), fetch: captureFetch });
		await generateObject({
			model: google('gemini-3.7-flash'),
			prompt: 'extract',
			schema: IcegridExtractionSchema
		}).catch(() => undefined); // the canned empty response fails rows.min(1); we only want the request

		expect(responseSchema).toBeTruthy();
		expect(collectViolations(responseSchema)).toEqual([]);
	});
});
