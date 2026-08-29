import { generateObject } from 'ai';
import { z } from 'zod';
import type { ModuleAiHandler } from '$lib/server/modules/types';
import { IcegridExtractionSchema, type IcegridAiReport } from './schema';

export const IcegridExtractInputSchema = z.object({
	sourceFiles: z.array(z.string().min(1).max(200)).min(1).max(20),
	content: z.string().min(1).max(750_000)
});

/**
 * The extraction contract.
 *
 * Every rule here exists because the alternative is a plausible-looking value in a
 * customs declaration that nobody can trace back to a document. The model reads and
 * quotes; it does not calculate, infer, or choose. Catalog normalization, serial
 * numbering and arithmetic checks all happen locally and deterministically after
 * this call.
 */
export const ICEGRID_SYSTEM_PROMPT = `You are ICEGrid AI, a customs document data-extraction assistant.
Read the supplied commercial invoices and packing lists and return one candidate row per distinct commercial-invoice line item, for an Indian Customs ICEGATE declaration.

TREAT ALL SELECTED FILES AS ONE EVIDENCE SET
- The files describe the same shipment. Use them together.
- Only merge a packing-list line into an invoice line when they share an explicit invoice number AND an exact line identifier (SKU / article / part number), or an exact matching description-and-quantity pair.
- If the linkage is ambiguous, keep the invoice line as the row, leave the packing-list-derived values null, and add a warning.

EVIDENCE IS MANDATORY
- For every field you set to a non-null value, include an evidence span that lists that field.
- A span must contain the exact source filename and a short quote copied VERBATIM from that file.
- The quote must actually contain the text or number you used. Copy it character for character; do not paraphrase, reformat, translate or reconstruct it.
- One span may support several fields from the same passage.
- Every quote is checked against the extracted file text. A field whose quote cannot be found is discarded, so inventing a quote only loses you the field.

NEVER CALCULATE OR INFER
- Do not compute ProductAmount from Quantity and UnitPrice. Report it only if the document prints it.
- Do not copy Quantity into SQCQTY, dbk_qty or RoDTEPQty, or QuantityUnit into PerUnit, SQCUnit or dbk_unit.
- Do not infer RITC/HS codes, drawback numbers, export schemes, end-use codes, FTA codes, countries, states, districts, or tax values from the product description, from the exporter's identity, or from general knowledge.
- Do not choose a "likely" or "nearest" catalog value, and do not create new catalog values. Report the raw text as printed and let the application normalize it.
- If two files disagree and nothing identifies which value belongs to this row, leave the field null and add a warning.

VALUE FORMAT
- Preserve source wording and numbers as printed; report numbers as plain numeric values.
- IGST_Rate is a whole number: 18 means 18%. Never 0.18.
- RewardItem is exactly "Yes" or "No". IGST_PaymentStatus is exactly "NA", "LUT" or "P". RODTEP is exactly "Yes", "No" or "N/A".
- ApplicableExpSchemes: copy the scheme exactly as printed, whether that is "19" or "19-Drawback (DBK)".
- There is no currency output column, and no InvoiceSNo, ItemSNo, Per or Accessories column; do not report any of them.
- Description: keep the full goods wording the document prints. Many invoices print a goods-class phrase and then the item, e.g. "HANDICRAFTS OF IRON ARTWARES - PLANTER S HAMM GOLD" - report the whole string, not just the item name. Never invent a goods class the document does not print.
- Any field not present in the documents must be null. Missing data is expected and correct.`;

export const icegridExtractAiHandler: ModuleAiHandler = {
	moduleId: 'icegrid',
	action: 'extract',
	inputSchema: IcegridExtractInputSchema,
	async execute(input, context) {
		const documentContext = IcegridExtractInputSchema.parse(input);

		const prompt = `SOURCE DOCUMENTS (${documentContext.sourceFiles.length} file(s): ${documentContext.sourceFiles.join(', ')}):

${documentContext.content}

Extract every commercial-invoice line item as one row, with evidence spans for each populated field.`;

		const result = await generateObject({
			model: context.model,
			instructions: ICEGRID_SYSTEM_PROMPT,
			prompt,
			schema: IcegridExtractionSchema,
			abortSignal: context.signal
		});

		// reportVersion and sourceFiles are stamped here, not generated: Gemini's
		// responseSchema rejects a non-string enum, and re-typing filenames it was
		// handed is pure hallucination surface.
		const report: IcegridAiReport = {
			reportVersion: 1,
			sourceFiles: documentContext.sourceFiles,
			rows: result.object.rows,
			warnings: result.object.warnings ?? []
		};
		return report;
	}
};
