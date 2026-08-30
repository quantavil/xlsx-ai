import { z } from 'zod';
import { ICEGRID_ALL_HEADERS } from './columns';

/** Every extractable header, as a string enum Gemini's responseSchema accepts. */
export const IcegridHeaderSchema = z.enum(
	ICEGRID_ALL_HEADERS as unknown as [string, ...string[]]
);

export type IcegridHeader = z.infer<typeof IcegridHeaderSchema>;

/**
 * One passage of a source file that supports one or more fields of a row.
 *
 * Evidence is transient: it is verified against the extracted file text during
 * sanitization and then discarded. It never becomes an output column.
 */
export const IcegridEvidenceSpanSchema = z.object({
	sourceFile: z.string().min(1).max(200).describe('Exact filename this quote came from'),
	quote: z
		.string()
		.min(1)
		.max(1_000)
		.describe('Short verbatim excerpt copied exactly from the source document'),
	fields: z
		.array(IcegridHeaderSchema)
		.min(1)
		.max(37)
		.describe('Which output fields this quote supports')
});

export type IcegridEvidenceSpan = z.infer<typeof IcegridEvidenceSpanSchema>;

export const IcegridRowSchema = z.object({
	InvoiceSNo: z.number().int().positive().nullable().describe('Always null; the module assigns serials'),
	ItemSNo: z.number().int().positive().nullable().describe('Always null; the module assigns serials'),
	InvoiceNo: z.string().nullable(),
	Description: z.string().nullable(),
	EndUse: z.string().nullable(),
	HAWBL_No: z.string().nullable().describe('House Airway Bill / Bill of Lading number'),
	Total_Package: z.number().nullable().describe('Always null; the module clears this field'),
	Accessories: z.string().nullable().describe('Always null; the module clears this field'),
	RewardItem: z.string().nullable().describe('Reward scheme eligibility: exactly "Yes" or "No"'),
	IGST_PaymentStatus: z.string().nullable().describe('IGST payment status: exactly "NA", "LUT" or "P"'),
	RITCCode: z.string().nullable().describe('8-digit Indian Customs Harmonized Tariff code (HS/ITC)'),
	ApplicableExpSchemes: z.string().nullable().describe('Export scheme exactly as printed, e.g. "19" or "19-Drawback (DBK)"'),
	Quantity: z.number().nullable(),
	QuantityUnit: z.string().nullable().describe('Unit of measurement (e.g. PCS, NOS, KGS, MTR)'),
	SQCQTY: z.number().nullable(),
	SQCUnit: z.string().nullable(),
	NetWeight: z
		.number()
		.nullable()
		.describe('Net weight of this line item in kilograms, as printed for that line'),
	Materials: z
		.string()
		.nullable()
		.describe(
			'Per-line material weight breakdown as printed, in printed order: "Name weight; Name weight". Weight in kilograms, omitted when the line prints none.'
		),
	UnitPrice: z.number().nullable(),
	ProductAmount: z.number().nullable().describe('Line amount as printed on the document; never calculated'),
	Per: z.number().nullable().describe('Unit price calculation denominator (usually 1)'),
	PerUnit: z.string().nullable(),
	drawback_schno: z.string().nullable(),
	dbk_qty: z.number().nullable(),
	dbk_rate: z.number().nullable(),
	dbk_unit: z.string().nullable(),
	dbk_desc: z.string().nullable(),
	ROSLRate: z.number().nullable(),
	ROSLCapValue: z.number().nullable(),
	CountryDestination: z.string().nullable(),
	FTACode: z.string().nullable(),
	StateOrigin: z.string().nullable(),
	DistrictOrigin: z.string().nullable(),
	Taxable_Value: z.number().nullable(),
	IGST_Rate: z.number().nullable().describe('IGST rate as a whole number, e.g. 18 for 18%'),
	IGST_Amount: z.number().nullable(),
	GSTCCessAmount: z.number().nullable(),
	RODTEP: z.string().nullable().describe('RoDTEP eligibility: exactly "Yes", "No" or "N/A"'),
	RoDTEPQty: z.number().nullable()
});

// What the model is actually asked to generate.
//
// Excludes reportVersion and sourceFiles: Gemini's responseSchema rejects a non-string
// `enum` (z.literal(1) emits {type:"number",enum:[1]} -> HTTP 400), and re-typing
// filenames it was handed is pure hallucination surface.
//
// Excludes MECHANICAL_HEADERS too. sanitize.ts skips those four headers unconditionally,
// so every token spent asking for them - in the schema, in the prompt and in the reply -
// bought an answer that was discarded on arrival.
export const IcegridCandidateRowSchema = IcegridRowSchema.omit({
	InvoiceSNo: true,
	ItemSNo: true,
	Per: true,
	Accessories: true,
	Total_Package: true
}).extend({
	evidence: z
		.array(IcegridEvidenceSpanSchema)
		.max(100)
		.describe('Source spans supporting every non-null field in this row')
});

/**
 * The exporter's house style for the goods-class phrase that opens `Description`.
 *
 * Shipment-level, not per row: every line of one shipping bill is filed under the
 * same wording. Across the 17-shipment reference corpus there are eight distinct
 * templates (`OTHER ARTICLES OF`, `OTHER FURNITURE ARTICLES OF`, `HANDICRAFTS OF`,
 * `INDIAN HANDICRAFTS OF`, ...) differing in separator spacing and in whether the
 * suffix reads ARTWARE, ARTWARES or FURNITURE. None of it is tariff text and none of
 * it is derivable from the goods, so it is read off the document's own goods banner
 * rather than invented - and when no banner states one, this is null and the
 * extracted item name stands alone.
 */
export const IcegridDescriptionStyleSchema = z.object({
	template: z
		.string()
		.min(1)
		.max(300)
		.describe(
			'The full pattern with two placeholders, e.g. "HANDICRAFTS OF {MATERIALS} ARTWARES- {NAME}"'
		),
	separator: z
		.string()
		.max(10)
		.describe('What joins two material names in this exporter\'s style, e.g. " / " or "/"'),
	nonMaterials: z
		.array(z.string().max(60))
		.max(20)
		.describe(
			'Names that appear in the weight breakdown but are components rather than materials of the article, and are left out of the phrase'
		),
	spellings: z
		.array(
			z.object({
				printed: z.string().min(1).max(60).describe('The abbreviation as the packing list writes it'),
				filed: z.string().min(1).max(60).describe('Its full name in this exporter\'s own spelling')
			})
		)
		.max(40)
		.describe('Expansions for abbreviated material names, e.g. S.Steel -> STAINLESS STEEL')
});

export type IcegridDescriptionStyle = z.infer<typeof IcegridDescriptionStyleSchema>;

export const IcegridExtractionSchema = z.object({
	descriptionStyle: IcegridDescriptionStyleSchema.nullish().describe(
		'The goods-class phrase style this shipment is filed under, or null if the documents state none'
	),
	/**
	 * Zero rows is a valid answer, and the schema must accept it.
	 *
	 * "These files hold a packing list and no commercial invoice" is a correct,
	 * well-formed response with the reason attached in `warnings`. A `.min(1)` here
	 * made the AI SDK reject it as `NoObjectGeneratedError`, so the one useful thing
	 * in the response - the model's own explanation - reached the user as an opaque
	 * 502. An empty extraction still fails the import; `pipeline.ts` raises it, with
	 * the warnings quoted. **Never constrain the shape of a legitimate answer in a
	 * schema handed to `generateObject`** - validate it where a message can be built.
	 */
	rows: z
		.array(IcegridCandidateRowSchema)
		.max(500)
		.describe('Candidate ICEGATE rows, one per commercial invoice line'),
	warnings: z.array(z.string()).max(100).describe('Extraction notes, ambiguities, or warnings')
});

/** Raw Gemini output plus the server-stamped provenance. Still carries evidence. */
export const IcegridAiReportSchema = IcegridExtractionSchema.extend({
	reportVersion: z.literal(1).describe('Schema report version 1'),
	sourceFiles: z.array(z.string()).min(1).max(20).describe('List of analyzed source filenames')
});

/** The clean report after sanitization: verified 37-field rows, no evidence. */
export const IcegridReportSchema = z.object({
	reportVersion: z.literal(1),
	sourceFiles: z.array(z.string()).min(1).max(20),
	rows: z.array(IcegridRowSchema),
	warnings: z.array(z.string())
});

export type IcegridRow = z.infer<typeof IcegridRowSchema>;
export type IcegridCandidateRow = z.infer<typeof IcegridCandidateRowSchema>;
export type IcegridExtraction = z.infer<typeof IcegridExtractionSchema>;
export type IcegridAiReport = z.infer<typeof IcegridAiReportSchema>;
export type IcegridReport = z.infer<typeof IcegridReportSchema>;
