import { generateObject } from 'ai';
import { z } from 'zod';
import type { ModuleAiHandler } from '$lib/server/modules/types';
import { IcegridExtractionSchema, type IcegridAiReport } from './schema';
import { searchTariffBatch, searchTariffPrefix } from './tariff.server';
import {
	allocateQueries,
	applyRanking,
	filableCandidates,
	mergeCandidates,
	rankTariffCandidates,
	MAX_TARIFF_QUERIES,
	RANKING_SHORTLIST,
	type TariffCandidate,
	type TariffClassification
} from './tariff';

/**
 * Phrases only - the schema has no slot for a code, which is what makes "never
 * return a tariff code" an invariant rather than an instruction the model may
 * decide to ignore.
 */
export const IcegridRankedCodesSchema = z.object({
	items: z.array(
		z.object({
			key: z.string().describe('The short item id you were given, e.g. i0'),
			codes: z
				.array(z.string())
				.describe('The codes from that item list, best classification first'),
			note: z
				.string()
				.describe('Empty string, unless none of the codes fit - then say what to search instead')
		})
	)
});

export const IcegridSearchTermsSchema = z.object({
	items: z.array(
		z.object({
			key: z.string().describe('The short item id you were given, e.g. i0'),
			terms: z
				.array(z.string())
				.describe('2-4 tariff-vocabulary search phrases, most likely first')
		})
	)
});

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
- For a wrapped Description, cite at least one exact fragment from its Description cell; keep the reconstructed full value in Description, not in the quote.
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
- There is no currency output column, and no InvoiceSNo, ItemSNo, Per, Accessories or Total_Package column; do not report any of them.
- NetWeight: the net weight of THIS line item, in kilograms. Report it only where the document prints a net weight against that individual line. A consignment or invoice total, a carton or per-carton weight, and a gross weight are all different figures - leave NetWeight null rather than reporting one of them, and never divide a total across lines. If the printed weight is in any unit other than kilograms, leave it null.
- Description: report only the text printed inside that line's own Description cell. When the cell wraps across several printed rows it is still one value: join its continuation lines, in printed order, separated by single spaces. Two things never belong in it. First, a heading that spans more than one line item - a page title, a section banner, or a goods-class phrase printed once above a block of rows - however close it sits to the cell. Second, data that belongs to another column even when the layout prints it in the same block: PO numbers, HSN or tariff lines, carton dimensions, net or gross weights, and packaging notes. Dimensions and sizes that are part of the article's own printed name do belong.
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

export const IcegridClassifyInputSchema = z.object({
	items: z
		.array(
			z.object({
				key: z.string().min(1).max(200),
				description: z.string().min(1).max(500),
				/** Digits of a partial code the documents printed, e.g. `9403`. */
				printed: z.string().max(8).regex(/^\d*$/)
			})
		)
		.min(1)
		.max(60)
});

/**
 * What the model is asked for, and pointedly not asked for.
 *
 * It never returns a tariff code. It returns the words to search the schedule
 * with, because the ITC-HS match is literal: "SIDE TABLE LARGE MANGO WOOD" finds
 * nothing in the master and "wooden furniture" finds five entries. Every code the
 * user is offered comes back out of DGFT's own answer to those words, so a code
 * the model imagined cannot reach the dialog - it would have to exist in the
 * schedule to be returned at all.
 */
export const ICEGRID_CLASSIFY_PROMPT = `You are helping search the Indian ITC-HS customs tariff.

For each item you are given a commercial-invoice description. Return the SEARCH PHRASES that would find that item in the tariff schedule.

NEVER RETURN A TARIFF CODE. Only words. Codes are looked up from the official schedule using your phrases; a code you write would be discarded.

HOW THE SEARCH WORKS
- The schedule is matched literally, as a substring. Word order matters and there is no synonym or stemming support.
- So the phrase must read like the tariff's own wording, not like the invoice's. The tariff says "wooden furniture", "bed linen", "wall clocks", "articles of plastics".
- A phrase that is too specific finds nothing: "cotton bed sheet" matches no entry, "bed linen" matches eight.
- A phrase that is one common word finds hundreds and is useless: "table", "wood", "steel".
- Aim for a two or three word noun phrase naming the ARTICLE and, where the tariff distinguishes it, the MATERIAL.

FOR EACH ITEM
- Give 2 to 4 phrases, most likely first.
- Vary them: one naming the article with its material, one naming the article alone, one naming the broader class it belongs to.
- Use the material named in the description when the tariff is likely to split on it (wood, cotton, steel, plastics, glass, leather).
- Strip sizes, colours, model numbers, pack counts and marketing words. "SIDE TABLE LARGE MANGO WOOD 24 INCH" is a wooden table.
- If the description is too vague to classify at all, return an empty phrase list for that item rather than guessing.`;

/**
 * The second pass: order a list, never extend it.
 *
 * Word overlap gets the obvious cases right and is helpless on the rest - a tariff
 * writes "Seats, other than those of heading 9402" where an invoice writes
 * "ARMCHAIR", and no amount of token matching connects them. Ranking is the one
 * step where reading comprehension is what the job actually needs.
 *
 * It still cannot invent: `applyRanking` keeps only codes that were on the list it
 * was handed, and re-appends anything it omitted. The worst a bad ranking can do
 * is put the right code second.
 */
export const ICEGRID_RANK_PROMPT = `You are classifying goods against the Indian ITC-HS customs tariff.

For each item you are given its commercial-invoice description and a list of candidate tariff codes taken from the official schedule, each with the schedule's own wording.

Order that item's codes from most to least likely to be the correct classification.

RULES
- Use only the codes given for that item. Do not write a code that is not on its list; it will be discarded.
- Do not drop codes you are unsure about. Order them, do not filter them.
- Judge by what the goods ARE, not by which entry sounds better or which duty is lower.
- A residual entry ("Other", "Others", "Parts: Other") is correct only when no specific entry covers the goods. Rank a specific entry that names the article or its material above it.
- Watch the material. A tariff routinely splits the same article by wood, steel, plastics, cotton or glass, and the invoice usually names it.
- "Parts" entries are for components, not for a complete article. Do not rank a parts entry first for a finished product.
- If genuinely none of the candidates fit the goods, still order them, and put in \`note\` a short suggestion of what to search instead. Otherwise leave \`note\` as an empty string.`;

export const icegridClassifyAiHandler: ModuleAiHandler = {
	moduleId: 'icegrid',
	action: 'classify',
	inputSchema: IcegridClassifyInputSchema,
	async execute(input, context) {
		const { items } = IcegridClassifyInputSchema.parse(input);

		// A printed partial code is document evidence and outranks any suggestion, so
		// those items are answered from the schedule alone and never reach the model.
		const prefixed = items.filter((item) => item.printed.length >= 4);
		const needSearch = items.filter((item) => item.printed.length < 4);

		// The model is given short opaque ids, never the real keys.
		//
		// A key is `printed digits | lowercased description`, so a real one looks like
		// `|wall clock 24" face 61 cm,matt antq brass` - pipes, quotes and commas that
		// a model has to reproduce character for character or its answer is discarded
		// silently. `i0` it can echo. This is a correctness fix, not a tidiness one:
		// every item on a 32-row invoice came back with no phrases and no explanation.
		const ids = new Map(needSearch.map((item, index) => [`i${index}`, item.key]));

		let termsByKey = new Map<string, string[]>();
		if (needSearch.length > 0) {
			const { object } = await generateObject({
				model: context.model,
				instructions: ICEGRID_CLASSIFY_PROMPT,
				prompt: `Items:\n${[...ids]
					.map(([id, key]) => {
						const item = needSearch.find((i) => i.key === key)!;
						return `- ${id}: ${item.description}`;
					})
					.join('\n')}`,
				schema: IcegridSearchTermsSchema,
				abortSignal: context.signal
			});
			for (const entry of object.items) {
				const key = ids.get(entry.key.trim());
				if (key) termsByKey.set(key, entry.terms.slice(0, 4));
			}
		}

		// Round-robin across items, so a budget too small for everything still gives
		// every item its best phrase instead of spending itself on the first few.
		const searches = await searchTariffBatch(allocateQueries(termsByKey, MAX_TARIFF_QUERIES));

		const prefixMatches = await Promise.all(
			prefixed.map(async (item) => ({
				key: item.key,
				printed: item.printed,
				matches: await searchTariffPrefix(item.printed).catch(() => [])
			}))
		);
		const prefixByKey = new Map(prefixMatches.map((entry) => [entry.key, entry]));

		// Word overlap only picks the shortlist the ranker reads. Capping to the six the
		// user finally sees would let it decide which codes the model may consider at
		// all, and a heading like `9403` has sixteen children worth reading.
		const shortlists = new Map<string, TariffCandidate[]>(
			items.map((item) => {
				const prefix = prefixByKey.get(item.key);
				const terms = termsByKey.get(item.key) ?? [];

				const fromPrefix = prefix
					? filableCandidates(prefix.matches, 'prefix', prefix.printed)
					: [];
				const fromSearch = terms.flatMap((term) =>
					filableCandidates(searches.get(term.trim()) ?? [], 'search', term)
				);

				return [
					item.key,
					rankTariffCandidates(
						mergeCandidates(fromPrefix, fromSearch),
						item.description,
						RANKING_SHORTLIST
					)
				];
			})
		);

		// One code is not an ordering, and none is not a list.
		const rankable = items.filter((item) => (shortlists.get(item.key)?.length ?? 0) > 1);
		const rankIds = new Map(rankable.map((item, index) => [`r${index}`, item.key]));

		let rankedByKey = new Map<string, { codes: string[]; note: string }>();
		if (rankable.length > 0) {
			const { object } = await generateObject({
				model: context.model,
				instructions: ICEGRID_RANK_PROMPT,
				prompt: [...rankIds]
					.map(([id, key]) => {
						const item = rankable.find((i) => i.key === key)!;
						const lines = (shortlists.get(key) ?? [])
							.map((c) => `    ${c.code}  ${c.description}`)
							.join('\n');
						return `${id}\n  goods: ${item.description}\n  candidates:\n${lines}`;
					})
					.join('\n\n'),
				schema: IcegridRankedCodesSchema,
				abortSignal: context.signal
			});
			for (const entry of object.items) {
				const key = rankIds.get(entry.key.trim());
				if (key) rankedByKey.set(key, { codes: entry.codes, note: entry.note ?? '' });
			}
		}

		const classifications: TariffClassification[] = items.map((item) => {
			const shortlist = shortlists.get(item.key) ?? [];
			const ranked = rankedByKey.get(item.key);
			return {
				key: item.key,
				terms: termsByKey.get(item.key) ?? [],
				candidates: applyRanking(shortlist, ranked?.codes ?? []),
				note: ranked?.note?.trim() || ''
			};
		});

		return { items: classifications };
	}
};
