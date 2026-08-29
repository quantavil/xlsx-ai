import { z } from 'zod';
import { ICEGRID_HEADERS } from './columns';

/** The exact 37 output headers, as a string enum Gemini's responseSchema accepts. */
export const IcegridHeaderSchema = z.enum(
	ICEGRID_HEADERS as unknown as [string, ...string[]]
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
	location: z
		.string()
		.min(1)
		.max(200)
		.describe('Where in that file, e.g. "Page 2" or "Sheet Invoice row 14"'),
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
	InvoiceNo: z.string().nullable().describe('Commercial invoice identifier/number'),
	Description: z.string().nullable().describe('Description of goods/items'),
	EndUse: z.string().nullable().describe('End use code or description'),
	HAWBL_No: z.string().nullable().describe('House Airway Bill / Bill of Lading number'),
	Total_Package: z.number().nullable().describe('Total number of packages/cartons'),
	Accessories: z.string().nullable().describe('Always null; the module clears this field'),
	RewardItem: z.string().nullable().describe('Reward scheme eligibility: exactly "Yes" or "No"'),
	IGST_PaymentStatus: z.string().nullable().describe('IGST payment status: exactly "NA", "LUT" or "P"'),
	RITCCode: z.string().nullable().describe('8-digit Indian Customs Harmonized Tariff code (HS/ITC)'),
	ApplicableExpSchemes: z.string().nullable().describe('Export scheme exactly as printed, e.g. "19" or "19-Drawback (DBK)"'),
	Quantity: z.number().nullable().describe('Quantity of items invoiced'),
	QuantityUnit: z.string().nullable().describe('Unit of measurement (e.g. PCS, NOS, KGS, MTR)'),
	SQCQTY: z.number().nullable().describe('Standard Quantity Code quantity'),
	SQCUnit: z.string().nullable().describe('Standard Quantity Code unit'),
	UnitPrice: z.number().nullable().describe('Unit price per item'),
	ProductAmount: z.number().nullable().describe('Line amount as printed on the document; never calculated'),
	Per: z.number().nullable().describe('Unit price calculation denominator (usually 1)'),
	PerUnit: z.string().nullable().describe('Denominator unit for price calculation'),
	drawback_schno: z.string().nullable().describe('Duty drawback tariff schedule number'),
	dbk_qty: z.number().nullable().describe('Drawback eligible quantity'),
	dbk_rate: z.number().nullable().describe('Duty drawback rate'),
	dbk_unit: z.string().nullable().describe('Drawback specific unit'),
	dbk_desc: z.string().nullable().describe('Drawback description'),
	ROSLRate: z.number().nullable().describe('RoSCTL rate percentage'),
	ROSLCapValue: z.number().nullable().describe('RoSCTL maximum cap value'),
	CountryDestination: z.string().nullable().describe('Country of final destination'),
	FTACode: z.string().nullable().describe('Free Trade Agreement preference code'),
	StateOrigin: z.string().nullable().describe('State of origin of goods'),
	DistrictOrigin: z.string().nullable().describe('District of origin'),
	Taxable_Value: z.number().nullable().describe('Assessable taxable value for GST'),
	IGST_Rate: z.number().nullable().describe('IGST rate as a whole number, e.g. 18 for 18%'),
	IGST_Amount: z.number().nullable().describe('IGST tax amount'),
	GSTCCessAmount: z.number().nullable().describe('GST compensation cess amount'),
	RODTEP: z.string().nullable().describe('RoDTEP eligibility: exactly "Yes", "No" or "N/A"'),
	RoDTEPQty: z.number().nullable().describe('RoDTEP eligible quantity')
});

// What the model is actually asked to generate. Deliberately excludes reportVersion and
// sourceFiles: Gemini's responseSchema rejects non-string `enum` (z.literal(1) emits
// {type:"number",enum:[1]} -> HTTP 400), and re-typing filenames it was handed is pure
// hallucination surface. Both are stamped by the server from data it already has.
export const IcegridCandidateRowSchema = IcegridRowSchema.extend({
	evidence: z
		.array(IcegridEvidenceSpanSchema)
		.max(100)
		.describe('Source spans supporting every non-null field in this row')
});

export const IcegridExtractionSchema = z.object({
	rows: z
		.array(IcegridCandidateRowSchema)
		.min(1)
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
