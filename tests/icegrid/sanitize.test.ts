import { describe, it, expect } from 'bun:test';
import {
	normalizeEvidenceText,
	verifyEvidenceSpan,
	quoteSupportsValue
} from '../../src/lib/modules/icegrid/evidence';
import { sanitizeIcegridExtraction } from '../../src/lib/modules/icegrid/sanitize';
import { validateIcegridReport } from '../../src/lib/modules/icegrid/validate';
import { getCatalogSnapshot } from '../../src/lib/modules/icegrid/catalogs';
import type { CombinedExtractionResult } from '../../src/lib/modules/icegrid/readers';
import type {
	IcegridAiReport,
	IcegridCandidateRow,
	IcegridEvidenceSpan,
	IcegridReport
} from '../../src/lib/modules/icegrid/schema';
import { ICEGRID_HEADERS } from '../../src/lib/modules/icegrid/columns';

const INVOICE_TEXT = `=== PAGE: 1 ===
Invoice No: INV-A
1  SIDE TABLE LARGE   48 PCS   30.00   1,440.00
HS Code 94038900   Destination: United States
State: RAJASTHAN   IGST 18%
Secondary pack unit: WIDGETS`;

const PACKING_TEXT = `=== PAGE: 1 ===
Packing List INV-A
SIDE TABLE LARGE  Net Wt 67.5 KGS`;

const extraction: CombinedExtractionResult = {
	sourceFiles: ['invoice.pdf', 'packing.pdf'],
	content: `=== FILE: invoice.pdf ===\n${INVOICE_TEXT}\n\n=== FILE: packing.pdf ===\n${PACKING_TEXT}`,
	documents: [
		{ filename: 'invoice.pdf', content: INVOICE_TEXT, charCount: INVOICE_TEXT.length },
		{ filename: 'packing.pdf', content: PACKING_TEXT, charCount: PACKING_TEXT.length }
	],
	totalChars: 0,
	totalBytes: 0
};

const span = (over: Partial<IcegridEvidenceSpan>): IcegridEvidenceSpan => ({
	sourceFile: 'invoice.pdf',
	quote: '1  SIDE TABLE LARGE   48 PCS   30.00   1,440.00',
	fields: ['Description'],
	...over
});

const candidateRow = (over: Partial<IcegridCandidateRow>): IcegridCandidateRow =>
	({
		...Object.fromEntries(ICEGRID_HEADERS.map((h) => [h, null])),
		evidence: [],
		...over
	}) as unknown as IcegridCandidateRow;

const aiReport = (rows: IcegridCandidateRow[]): IcegridAiReport => ({
	reportVersion: 1,
	sourceFiles: ['invoice.pdf', 'packing.pdf'],
	rows,
	warnings: []
});

const run = (rows: IcegridCandidateRow[]) =>
	sanitizeIcegridExtraction(aiReport(rows), extraction, getCatalogSnapshot());

describe('evidence text handling', () => {
	it('normalizes case, whitespace and mangled dashes only', () => {
		expect(normalizeEvidenceText('  SIDE   TABLE\nLARGE ')).toBe('side table large');
		expect(normalizeEvidenceText('A–B')).toBe('a-b');
	});

	it('accepts a quote present in the named file', () => {
		expect(verifyEvidenceSpan(span({}), extraction).ok).toBe(true);
	});

	it('rejects a quote that lives only in a different file', () => {
		const check = verifyEvidenceSpan(span({ quote: 'Net Wt 67.5 KGS' }), extraction);
		expect(check).toMatchObject({ ok: false, reason: 'quote_not_found' });
	});

	it('rejects a fabricated quote and an unselected filename', () => {
		expect(verifyEvidenceSpan(span({ quote: 'TOTALLY MADE UP LINE' }), extraction)).toMatchObject({
			ok: false,
			reason: 'quote_not_found'
		});
		expect(verifyEvidenceSpan(span({ sourceFile: 'nope.pdf' }), extraction)).toMatchObject({
			ok: false,
			reason: 'unknown_file'
		});
	});

	it('supports a formatted number against its plain numeric value', () => {
		expect(quoteSupportsValue('Amount 1,250.00', 1250)).toBe(true);
		expect(quoteSupportsValue('Qty 48 PCS', 48)).toBe(true);
	});

	it('accepts an identifier whose layout spaced the separators differently', () => {
		// A PDF column prints the invoice number across a gap; the stored value has none.
		expect(quoteSupportsValue('Invoice No. 30744 / 26-27', '30744/26-27')).toBe(true);
		expect(quoteSupportsValue('514 / 026', '514/026')).toBe(true);
		// Still every character accounted for - a different identifier is still rejected.
		expect(quoteSupportsValue('Invoice No. 30744 / 26-27', '30745/26-27')).toBe(false);
		expect(quoteSupportsValue('Invoice No. 30744 / 26-27', '3074/26-27')).toBe(false);
	});

	it('does not splice two adjacent numbers into one', () => {
		// Whitespace separates numbers; only commas group digits. Without this, a quote
		// reading "94038900 48" would "support" the value 9403890048.
		expect(quoteSupportsValue('HS 94038900 Qty 48', 9403890048)).toBe(false);
		expect(quoteSupportsValue('HS 94038900 Qty 48', 94038900)).toBe(true);
		expect(quoteSupportsValue('HS 94038900 Qty 48', 48)).toBe(true);
	});

	it('never treats arithmetic as support', () => {
		// 120 * 2.68 = 321.6, but the document never printed 321.6.
		expect(quoteSupportsValue('120 PCS at 2.68', 321.6)).toBe(false);
	});
});

describe('sanitizeIcegridExtraction', () => {
	it('keeps a field backed by a verified quote', () => {
		const { report } = run([
			candidateRow({
				InvoiceNo: 'INV-A',
				Description: 'SIDE TABLE LARGE',
				evidence: [span({ fields: ['InvoiceNo', 'Description'], quote: 'Invoice No: INV-A\n1  SIDE TABLE LARGE   48 PCS' })]
			})
		]);
		expect(report.rows[0].Description).toBe('SIDE TABLE LARGE');
		expect(report.rows[0].InvoiceNo).toBe('INV-A');
	});

	it('blanks a field with no evidence at all and warns', () => {
		const { report, warnings } = run([candidateRow({ Description: 'GHOST ITEM' })]);
		expect(report.rows[0].Description).toBeNull();
		expect(warnings.some((w) => w.includes('Description') && w.includes('no source evidence'))).toBe(true);
	});

	it('blanks a field whose quote is fabricated', () => {
		const { report, warnings } = run([
			candidateRow({
				Description: 'GHOST ITEM',
				evidence: [span({ fields: ['Description'], quote: 'GHOST ITEM 99 PCS' })]
			})
		]);
		expect(report.rows[0].Description).toBeNull();
		expect(
			warnings.some(
				(w) => w.includes('Description') && w.includes('cited source evidence could not be verified')
			)
		).toBe(true);
	});

	it('blanks a field the evidence span did not list', () => {
		const { report } = run([
			candidateRow({
				Quantity: 48,
				evidence: [span({ fields: ['Description'] })]
			})
		]);
		expect(report.rows[0].Quantity).toBeNull();
	});

	it('does not let one bad field erase its supported siblings or the row', () => {
		const { report } = run([
			candidateRow({
				InvoiceNo: 'INV-A',
				Description: 'SIDE TABLE LARGE',
				RITCCode: '99999999',
				evidence: [
					span({ fields: ['InvoiceNo'], quote: 'Invoice No: INV-A' }),
					span({ fields: ['Description'], quote: 'SIDE TABLE LARGE' }),
					span({ fields: ['RITCCode'], quote: 'HS Code 94038900' })
				]
			})
		]);
		expect(report.rows).toHaveLength(1);
		expect(report.rows[0].InvoiceNo).toBe('INV-A');
		expect(report.rows[0].Description).toBe('SIDE TABLE LARGE');
		expect(report.rows[0].RITCCode).toBeNull();
	});

	it('normalizes an exact unit to its canonical casing', () => {
		const { report } = run([
			candidateRow({ QuantityUnit: 'Pcs', evidence: [span({ fields: ['QuantityUnit'], quote: '48 PCS' })] })
		]);
		expect(report.rows[0].QuantityUnit).toBe('PCS');
	});

	it('blanks an unknown unit with a warning', () => {
		const { report, warnings } = run([
			candidateRow({
				QuantityUnit: 'WIDGETS',
				evidence: [span({ fields: ['QuantityUnit'], quote: 'Secondary pack unit: WIDGETS' })]
			})
		]);
		expect(report.rows[0].QuantityUnit).toBeNull();
		expect(warnings.some((w) => w.includes('not a known QuantityUnit'))).toBe(true);
	});

	it('resolves an exact country name to its code', () => {
		const { report } = run([
			candidateRow({
				CountryDestination: 'United States',
				evidence: [span({ fields: ['CountryDestination'], quote: 'Destination: United States' })]
			})
		]);
		expect(report.rows[0].CountryDestination).toBe('US');
	});

	it('resolves an exact state name to its padded code', () => {
		const { report } = run([
			candidateRow({
				StateOrigin: 'RAJASTHAN',
				evidence: [span({ fields: ['StateOrigin'], quote: 'State: RAJASTHAN' })]
			})
		]);
		expect(report.rows[0].StateOrigin).toBe('08');
	});

	it('migrates a supported bare 19 to the complete canonical scheme', () => {
		const text = 'Scheme 19 applies';
		const local: CombinedExtractionResult = {
			...extraction,
			documents: [{ filename: 'invoice.pdf', content: text, charCount: text.length }]
		};
		const { report } = sanitizeIcegridExtraction(
			aiReport([
				candidateRow({
					ApplicableExpSchemes: '19',
					evidence: [span({ fields: ['ApplicableExpSchemes'], quote: 'Scheme 19 applies' })]
				})
			]),
			local
		);
		expect(report.rows[0].ApplicableExpSchemes).toBe('19-Drawback (DBK)');
	});

	it('leaves an ambiguous bare 36 blank', () => {
		const text = 'Scheme 36 applies';
		const local: CombinedExtractionResult = {
			...extraction,
			documents: [{ filename: 'invoice.pdf', content: text, charCount: text.length }]
		};
		const { report, warnings } = sanitizeIcegridExtraction(
			aiReport([
				candidateRow({
					ApplicableExpSchemes: '36',
					evidence: [span({ fields: ['ApplicableExpSchemes'], quote: 'Scheme 36 applies' })]
				})
			]),
			local
		);
		expect(report.rows[0].ApplicableExpSchemes).toBeNull();
		expect(warnings.some((w) => w.includes('ambiguous'))).toBe(true);
	});

	it('always clears Accessories and serials no matter what the AI sent', () => {
		// These four are no longer in the candidate schema, so a compliant model cannot send
		// them. sanitize still has to blank them, because nothing here trusts the model to
		// stay compliant - hence the cast.
		const { report } = run([
			candidateRow({
				evidence: [span({ fields: ['Accessories', 'InvoiceSNo', 'ItemSNo', 'Per'], quote: 'Invoice No: INV-A' })],
				...({ Accessories: 'Y', InvoiceSNo: 7, ItemSNo: 9, Per: 5 } as object)
			})
		]);
		expect(report.rows[0].Accessories).toBeNull();
		expect(report.rows[0].InvoiceSNo).toBeNull();
		expect(report.rows[0].ItemSNo).toBeNull();
		expect(report.rows[0].Per).toBeNull();
	});

	it('rejects a value whose quote came from a file that was not selected', () => {
		const { report } = run([
			candidateRow({
				Description: 'SIDE TABLE LARGE',
				evidence: [span({ sourceFile: 'other.pdf', fields: ['Description'] })]
			})
		]);
		expect(report.rows[0].Description).toBeNull();
	});
});

describe('validateIcegridReport after sanitization', () => {
	const clean = (over: Record<string, unknown>): IcegridReport => ({
		reportVersion: 1 as const,
		sourceFiles: ['invoice.pdf'],
		warnings: [],
		rows: [
			{
				...Object.fromEntries(ICEGRID_HEADERS.map((h) => [h, null])),
				InvoiceNo: 'INV-A',
				Description: 'x',
				...over
			}
		] as unknown as IcegridReport['rows']
	});

	it('blocks only on structural failures', () => {
		expect(validateIcegridReport(clean({}), ['invoice.pdf']).valid).toBe(true);
		expect(validateIcegridReport(clean({}), ['other.pdf']).valid).toBe(false);
		expect(
			validateIcegridReport(
				{ reportVersion: 1, sourceFiles: ['invoice.pdf'], rows: [], warnings: [] },
				['invoice.pdf']
			).valid
		).toBe(false);
	});

	it('warns without overwriting a ProductAmount arithmetic mismatch', () => {
		const report = clean({ Quantity: 10, UnitPrice: 2, ProductAmount: 999 });
		const result = validateIcegridReport(report , ['invoice.pdf']);
		expect(result.valid).toBe(true);
		expect(result.warnings.some((w) => w.includes('ProductAmount'))).toBe(true);
		expect(report.rows[0].ProductAmount).toBe(999);
	});

	it('warns on a wrong-length RITC and on a district without a state', () => {
		const r1 = validateIcegridReport(clean({ RITCCode: '123' }) , ['invoice.pdf']);
		expect(r1.warnings.some((w) => w.includes('RITC'))).toBe(true);

		const r2 = validateIcegridReport(clean({ DistrictOrigin: '102' }) , ['invoice.pdf']);
		expect(r2.warnings.some((w) => w.includes('StateOrigin is blank'))).toBe(true);
	});

	it('warns on a catalog value that is not a catalog value', () => {
		const result = validateIcegridReport(clean({ RODTEP: 'MAYBE' }) , ['invoice.pdf']);
		expect(result.warnings.some((w) => w.includes('RODTEP'))).toBe(true);
	});

	it('accepts the approved enum spellings', () => {
		const result = validateIcegridReport(
			clean({ RODTEP: 'N/A', RewardItem: 'Yes', IGST_PaymentStatus: 'LUT' }),
			['invoice.pdf']
		);
		expect(result.warnings.some((w) => /RODTEP|RewardItem|IGST_PaymentStatus/.test(w))).toBe(false);
	});
});

describe('quoteSupportsValue: separators in the document, not the value', () => {
	it('matches an HS code the invoice prints with dots', () => {
		expect(quoteSupportsValue('Soft Ferrite Cores, HSN:8505.11.10', '85051110')).toBe(true);
	});

	it('matches an invoice number the invoice prints with a slash', () => {
		expect(quoteSupportsValue('Invoice 30744 / 26-27 dated', '3074426')).toBe(false);
		expect(quoteSupportsValue('Invoice 30744/26-27 dated', '307442627')).toBe(true);
	});

	it('never glues two separate tokens into one identifier', () => {
		expect(quoteSupportsValue('300 Pcs 1.66000 498.00', '3001')).toBe(false);
		expect(quoteSupportsValue('Quantity 12 Rate 34', '1234')).toBe(false);
	});

	it('still refuses a value the quote simply does not contain', () => {
		expect(quoteSupportsValue('HSN:8505.11.10', '94038900')).toBe(false);
	});
});

describe('verifyEvidenceSpan: the extractor is the unreliable half', () => {
	it('accepts a printed row our extractor split and reordered', () => {
		// The model copied the visual row; pdf text extraction emitted the columns
		// in a different order and on separate lines.
		const scrambled = 'SIDE TABLE LARGE\n30.00\n1,440.00\n48 PCS';
		const local: CombinedExtractionResult = {
			sourceFiles: ['invoice.pdf'],
			content: scrambled,
			documents: [{ filename: 'invoice.pdf', content: scrambled, charCount: scrambled.length }],
			totalChars: 0,
			totalBytes: 0
		};
		expect(
			verifyEvidenceSpan(
				{ sourceFile: 'invoice.pdf', quote: 'SIDE TABLE LARGE 48 PCS 30.00 1,440.00', fields: ['Quantity'] },
				local
			).ok
		).toBe(true);
	});

	it('still rejects a quote whose tokens the document never printed', () => {
		expect(
			verifyEvidenceSpan(
				{ sourceFile: 'invoice.pdf', quote: 'GHOST ITEM 99 PCS', fields: ['Description'] },
				extraction
			).ok
		).toBe(false);
	});

	it('never lets a fabricated number pass as a reordered quote', () => {
		// Every word is in the document, but 9,999.00 is not.
		expect(
			verifyEvidenceSpan(
				{ sourceFile: 'invoice.pdf', quote: 'SIDE TABLE LARGE 9,999.00', fields: ['ProductAmount'] },
				extraction
			).ok
		).toBe(false);
	});

	it('refuses to vouch for a one- or two-word quote on tokens alone', () => {
		expect(
			verifyEvidenceSpan(
				{ sourceFile: 'invoice.pdf', quote: '48 LARGE', fields: ['Quantity'] },
				extraction
			).ok
		).toBe(false);
	});
});

describe('trusted AI descriptions', () => {
	it('keeps an AI description when one genuine source fragment names the field', () => {
		const docText =
			'1\t200327\t250435\tS/2 EGG TABLE ENS DE 2 BDC HENRIK H-\t601 SET\t49.00\t29449.00\n40cm L-55 W-70cm';
		const local: CombinedExtractionResult = {
			sourceFiles: ['invoice.pdf'],
			content: docText,
			documents: [{ filename: 'invoice.pdf', content: docText, charCount: docText.length }],
			totalChars: docText.length,
			totalBytes: docText.length
		};
		const { report } = sanitizeIcegridExtraction(
			aiReport([
				candidateRow({
					Description: 'S/2 EGG TABLE ENS DE 2 BDC HENRIK H- 40cm L-55 W-70cm',
					evidence: [
						{
							sourceFile: 'invoice.pdf',
							quote: 'S/2 EGG TABLE ENS DE 2 BDC HENRIK H-',
							fields: ['Description']
						}
					]
				})
			]),
			local
		);

		expect(report.rows[0].Description).toBe(
			'S/2 EGG TABLE ENS DE 2 BDC HENRIK H- 40cm L-55 W-70cm'
		);
	});

	it('keeps a trusted dbk_desc on the same overlap rule', () => {
		const { report } = run([
			candidateRow({
				dbk_desc: 'SIDE TABLE LARGE WOODEN FINISH',
				evidence: [span({ fields: ['dbk_desc'], quote: 'SIDE TABLE LARGE' })]
			})
		]);
		expect(report.rows[0].dbk_desc).toBe('SIDE TABLE LARGE WOODEN FINISH');
	});

	it('rejects a description whose verified quote is about something else', () => {
		// The quote is real and names the field, but shares nothing with the value.
		const { report, warnings } = run([
			candidateRow({
				Description: 'SOLID GOLD ROLEX SUBMARINER 18K',
				evidence: [span({ fields: ['Description'], quote: 'HS Code 94038900   Destination: United States' })]
			})
		]);
		expect(report.rows[0].Description).toBeNull();
		expect(warnings.some((w) => w.includes('Description'))).toBe(true);
	});
});
