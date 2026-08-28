import { generateObject } from 'ai';
import { z } from 'zod';
import type { ModuleAiHandler } from '$lib/server/modules/types';
import { IcegridExtractionSchema, type IcegridReport } from './schema';

export const IcegridExtractInputSchema = z.object({
	sourceFiles: z.array(z.string().min(1).max(200)).min(1).max(20),
	content: z.string().min(1).max(750_000)
});

export const icegridExtractAiHandler: ModuleAiHandler = {
	moduleId: 'icegrid',
	action: 'extract',
	inputSchema: IcegridExtractInputSchema,
	async execute(input, context) {
		const documentContext = IcegridExtractInputSchema.parse(input);
		const system = `You are ICEGrid AI, an expert customs document data-extraction assistant.
Analyze the supplied commercial invoices and packing lists and extract itemized shipment rows into the Indian Customs ICEGATE 37-column format.

CRITICAL EXTRACTION RULES:
1. Every distinct invoice line item must become exactly one row in the output report.
2. Maintain sequential InvoiceSNo (1, 2, ...) and ItemSNo (1, 2, ...) across rows.
3. Extract exact invoice numbers, product descriptions, quantities, unit prices, and currencies.
4. Calculate ProductAmount = Quantity * UnitPrice accurately.
5. Set field values to null if not present in or determinable from the supplied documents. Do not invent missing facts.
6. Return only data that adheres to the JSON report schema.`;
		const prompt = `SOURCE DOCUMENTS (${documentContext.sourceFiles.length} file(s): ${documentContext.sourceFiles.join(', ')}):

${documentContext.content}

Extract all line items and output the complete ICEGrid JSON report.`;

		const result = await generateObject({
			model: context.model,
			system,
			prompt,
			schema: IcegridExtractionSchema,
			abortSignal: context.signal
		});

		const report: IcegridReport = {
			reportVersion: 1,
			sourceFiles: documentContext.sourceFiles,
			rows: result.object.rows,
			warnings: result.object.warnings ?? []
		};
		return report;
	}
};
