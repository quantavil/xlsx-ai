import { z } from 'zod';

export const IcegridRowSchema = z.object({
	InvoiceSNo: z.number().int().positive().nullable().describe('Sequential invoice number (1, 2, ...)'),
	ItemSNo: z.number().int().positive().nullable().describe('Sequential item number within the invoice (1, 2, ...)'),
	InvoiceNo: z.string().nullable().describe('Commercial invoice identifier/number'),
	Description: z.string().nullable().describe('Description of goods/items'),
	EndUse: z.string().nullable().describe('End use code or description'),
	HAWBL_No: z.string().nullable().describe('House Airway Bill / Bill of Lading number'),
	Total_Package: z.number().nullable().describe('Total number of packages/cartons'),
	Accessories: z.string().nullable().describe('Accessories inclusion indicator'),
	RewardItem: z.string().nullable().describe('Reward / RoDTEP eligibility (e.g. Y/N)'),
	IGST_PaymentStatus: z.string().nullable().describe('IGST payment status code (e.g. LUT, P, NP)'),
	RITCCode: z.string().nullable().describe('8-digit Indian Customs Harmonized Tariff code (HS/ITC)'),
	ApplicableExpSchemes: z.string().nullable().describe('Applicable export schemes (e.g. EPCG, Advance Auth, EOU)'),
	Quantity: z.number().nullable().describe('Quantity of items invoiced'),
	QuantityUnit: z.string().nullable().describe('Unit of measurement (e.g. PCS, NOS, KGS, MTR)'),
	SQCQTY: z.number().nullable().describe('Standard Quantity Code quantity'),
	SQCUnit: z.string().nullable().describe('Standard Quantity Code unit'),
	UnitPrice: z.number().nullable().describe('Unit price per item'),
	ProductAmount: z.number().nullable().describe('Total item amount (Quantity * UnitPrice)'),
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
	IGST_Rate: z.number().nullable().describe('IGST tax rate percentage'),
	IGST_Amount: z.number().nullable().describe('IGST tax amount'),
	GSTCCessAmount: z.number().nullable().describe('GST compensation cess amount'),
	RODTEP: z.string().nullable().describe('RoDTEP rate or scheme indicator'),
	RoDTEPQty: z.number().nullable().describe('RoDTEP eligible quantity')
});

// What the model is actually asked to generate. Deliberately excludes reportVersion and
// sourceFiles: Gemini's responseSchema rejects non-string `enum` (z.literal(1) emits
// {type:"number",enum:[1]} -> HTTP 400), and re-typing filenames it was handed is pure
// hallucination surface. Both are stamped by the server from data it already has.
export const IcegridExtractionSchema = z.object({
	rows: z.array(IcegridRowSchema).min(1).max(500).describe('Extracted ICEGATE 37-column invoice rows'),
	warnings: z.array(z.string()).max(100).describe('Extraction notes, ambiguities, or warnings')
});

export const IcegridReportSchema = IcegridExtractionSchema.extend({
	reportVersion: z.literal(1).describe('Schema report version 1'),
	sourceFiles: z.array(z.string()).min(1).max(20).describe('List of analyzed source filenames')
});

export type IcegridRow = z.infer<typeof IcegridRowSchema>;
export type IcegridExtraction = z.infer<typeof IcegridExtractionSchema>;
export type IcegridReport = z.infer<typeof IcegridReportSchema>;
