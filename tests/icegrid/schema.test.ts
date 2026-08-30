import { describe, it, expect } from 'bun:test';
import type { z } from 'zod';
import {
	IcegridReportSchema,
	IcegridAiReportSchema,
	IcegridRowSchema
} from '../../src/lib/modules/icegrid/schema';

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
		NetWeight: 42.5,
		Materials: 'Iron 0.800; Marble 1.700',
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

	it('accepts an AI response with zero rows, so its reason survives', () => {
		const emptyReport = {
			reportVersion: 1,
			sourceFiles: ['packing.xlsx'],
			rows: [],
			warnings: ['No commercial invoice file was provided; only a packing list was found.']
		};

		// "No invoice lines, and here is why" is a well-formed answer. Requiring a row
		// here made the AI SDK throw NoObjectGeneratedError and destroy the warning,
		// which is the only part of that response worth showing the user. An empty
		// extraction still fails the import - pipeline.ts raises it with the warnings.
		expect(IcegridAiReportSchema.safeParse(emptyReport).success).toBe(true);
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

	async function capturedResponseSchema(schema: z.ZodType): Promise<unknown> {
		const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
		const { generateObject } = await import('ai');

		let responseSchema: unknown = null;
		const captureFetch = (async (_url: string, init: { body: string }) => {
			responseSchema = JSON.parse(init.body).generationConfig?.responseSchema;
			return new Response(
				JSON.stringify({
					candidates: [
						{ content: { role: 'model', parts: [{ text: '{}' }] }, finishReason: 'STOP' }
					],
					usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		}) as unknown as typeof fetch;

		const google = createGoogleGenerativeAI({ apiKey: 'x'.repeat(30), fetch: captureFetch });
		await generateObject({
			model: google('gemini-3.7-flash-lite'),
			prompt: 'go',
			schema
			// The canned response is not a real answer; we only want the request.
		}).catch(() => undefined);
		return responseSchema;
	}

	it('sends Gemini a responseSchema with no non-string enums', async () => {
		// Every schema this module hands to generateObject, not just the first one:
		// a numeric literal in any of them is a 400 on every call that uses it, and
		// that is how the extraction schema broke every import once already.
		const { IcegridExtractionSchema } = await import('../../src/lib/modules/icegrid/schema');
		const { IcegridSearchTermsSchema, IcegridRankedCodesSchema } = await import(
			'../../src/lib/modules/icegrid/ai.server'
		);

		for (const [name, schema] of [
			['extraction', IcegridExtractionSchema],
			['search terms', IcegridSearchTermsSchema],
			['ranked codes', IcegridRankedCodesSchema]
		] as const) {
			const responseSchema = await capturedResponseSchema(schema);
			expect(responseSchema, name).toBeTruthy();
			expect(collectViolations(responseSchema), name).toEqual([]);
		}
	});

	it('gives the ranker no field a tariff code could be invented into', async () => {
		const { IcegridSearchTermsSchema } = await import('../../src/lib/modules/icegrid/ai.server');
		// The term generator answers with words only. If a `code` field ever appears
		// here, a model-authored code can reach the dialog without passing DGFT.
		const parsed = IcegridSearchTermsSchema.safeParse({
			items: [{ key: 'k', terms: ['wooden furniture'], code: '94036000' }]
		});
		expect(parsed.success).toBe(true);
		expect(parsed.success && Object.keys(parsed.data.items[0])).toEqual(['key', 'terms']);
	});
});
