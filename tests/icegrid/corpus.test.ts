import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ICEGRID_COLUMNS, ICEGRID_HEADERS } from '../../src/lib/modules/icegrid/columns';
import { getCatalogSnapshot, resolveCatalogValue } from '../../src/lib/modules/icegrid/catalogs';
import { combineDocumentSources } from '../../src/lib/modules/icegrid/readers';

/**
 * Reference-corpus contract tests.
 *
 * Fixtures are real shipments from the trusted corpus at "INPUT & OUTPUT FILES"
 * (17 shipments, 49 files). Six shipments are checked in — the smallest subset
 * that still exercises every distinct shape in the corpus; `EDGE_CASES` below is
 * the coverage ledger, and `covers every corpus edge case` fails if a fixture is
 * dropped without its edge case moving to another one.
 *
 * Each shipment ships its own real inputs, so the readers are exercised against the
 * same bytes that produced the expected workbook.
 */

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Edge cases the retained fixtures have to cover between them
// ---------------------------------------------------------------------------

const EDGE_CASES = {
	'input-xlsx': 'an .xlsx source document',
	'input-xls': 'a legacy .xls source document',
	'input-pdf': 'a .pdf source document',
	'single-file-source': 'invoice and packing list inside one file',
	'split-pair-same-format': 'invoice and packing list as two files of one format',
	'split-pair-mixed-format': 'invoice and packing list in two different formats',
	'many-files-one-shipment': 'three or more files selected for one shipment',
	'supporting-authorisation-doc': 'a licence/authorisation PDF alongside the trade documents',
	'sheet-style-guidelines': 'output written as Sheet1 + Guidelines with numeric cells and HAWBL_NO',
	'sheet-style-productexport': 'output written as a lone ProductExportExcel sheet with text cells and HAWBL_No',
	'multiple-invoices': 'more than one invoice in a single output',
	'scheme-canonical': 'ApplicableExpSchemes stored complete, e.g. 19-Drawback (DBK)',
	'scheme-code-only': 'ApplicableExpSchemes stored as a bare code, e.g. 19',
	'scheme-mixed-within-shipment': 'two different export schemes inside one shipment',
	'igst-paid': 'IGST actually paid, with a non-zero rate',
	'igst-lut': 'export under LUT, so zero-rated',
	'drawback-absent': 'no drawback claimed on any row',
	'drawback-partial': 'drawback claimed on some rows only',
	'drawback-full': 'drawback claimed on every row',
	'dbk-desc-populated': 'a filled dbk_desc column',
	'rosl-rate-populated': 'a filled ROSLRate column',
	'gst-cess-populated': 'a filled GSTCCessAmount column',
	'rodtep-declined': 'rows marked RODTEP = No',
	'end-use-gnx200': 'the GNX200 end use',
	'mixed-quantity-units': 'more than one QuantityUnit in one shipment',
	'rodtep-qty-equals-quantity': 'RoDTEPQty equal to Quantity',
	'rodtep-qty-tracks-sqc': 'RoDTEPQty following SQCQTY rather than Quantity'
} as const;

type EdgeCase = keyof typeof EDGE_CASES;

interface CorpusCase {
	dir: string;
	label: string;
	inputs: string[];
	rows: number;
	invoiceNumbers: string[];
	covers: EdgeCase[];
}

const CASES: CorpusCase[] = [
	{
		dir: '01-split-xls-igst-paid',
		label: 'two .xls files, IGST paid at 5% and 18%',
		inputs: ['invoice.xls', 'packing.xls'],
		rows: 25,
		invoiceNumbers: ['514/026'],
		covers: [
			'input-xls',
			'split-pair-same-format',
			'sheet-style-guidelines',
			'scheme-canonical',
			'igst-paid',
			'drawback-full',
			'rodtep-qty-tracks-sqc'
		]
	},
	{
		dir: '02-single-pdf-combined',
		label: 'one .pdf holding both documents',
		inputs: ['input.pdf'],
		rows: 16,
		invoiceNumbers: ['GGI63/26-27'],
		covers: [
			'input-pdf',
			'single-file-source',
			'sheet-style-guidelines',
			'mixed-quantity-units',
			'igst-lut',
			'drawback-full',
			'rodtep-qty-tracks-sqc'
		]
	},
	{
		dir: '03-multi-invoice-pdf',
		label: 'three invoices and three packing lists filed as one shipment',
		inputs: [
			'4620117-invoice.pdf',
			'4620117-packing.pdf',
			'4620120-invoice.pdf',
			'4620120-packing.pdf',
			'4620152-invoice.pdf',
			'4620152-packing.pdf'
		],
		rows: 11,
		invoiceNumbers: ['4620117', '4620120', '4620152'],
		covers: [
			'input-pdf',
			'many-files-one-shipment',
			'multiple-invoices',
			'sheet-style-productexport',
			'scheme-code-only',
			'rosl-rate-populated',
			'drawback-full'
		]
	},
	{
		dir: '04-no-drawback-pdf',
		label: 'EOU/SEZ shipment claiming no drawback at all',
		inputs: ['invoice.pdf', 'packing.pdf'],
		rows: 5,
		invoiceNumbers: ['30744/26-27'],
		covers: [
			'input-pdf',
			'split-pair-same-format',
			'sheet-style-productexport',
			'scheme-code-only',
			'drawback-absent',
			'end-use-gnx200',
			'rodtep-qty-equals-quantity'
		]
	},
	{
		dir: '05-authorisation-plus-xlsx',
		label: 'advance authorisation PDF read alongside an .xlsx invoice',
		inputs: ['authorisation.pdf', 'input.xlsx'],
		rows: 7,
		invoiceNumbers: ['27E3100070'],
		covers: [
			'input-pdf',
			'input-xlsx',
			'split-pair-mixed-format',
			'supporting-authorisation-doc',
			'sheet-style-productexport',
			'scheme-code-only',
			'scheme-mixed-within-shipment',
			'drawback-partial',
			'dbk-desc-populated',
			'rosl-rate-populated',
			'gst-cess-populated'
		]
	},
	{
		dir: '06-mixed-scheme-xlsx-pdf',
		label: '.xlsx invoice with a .pdf packing list, free shipping bill rows alongside drawback rows',
		inputs: ['invoice.xlsx', 'packing.pdf'],
		rows: 14,
		invoiceNumbers: ['GGI83/26-27'],
		covers: [
			'input-xlsx',
			'input-pdf',
			'split-pair-mixed-format',
			'sheet-style-guidelines',
			'scheme-canonical',
			'scheme-mixed-within-shipment',
			'drawback-partial',
			'rodtep-declined',
			'igst-lut'
		]
	}
];

// ---------------------------------------------------------------------------
// Workbook reading
// ---------------------------------------------------------------------------

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

const asNumber = (v: unknown): number | null => {
	if (isBlank(v)) return null;
	const n = Number(String(v).replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string => String(v ?? '').trim();

/** Header 6 is `HAWBL_No` in some corpus workbooks and `HAWBL_NO` in others. */
const canonicalHeader = (raw: unknown): string => {
	const value = text(raw);
	return ICEGRID_HEADERS.find((h) => h.toLowerCase() === value.toLowerCase()) ?? value;
};

interface ExpectedWorkbook {
	sheetNames: string[];
	dataSheetName: string;
	rawHeaders: string[];
	headers: string[];
	rows: Record<string, unknown>[];
}

function readExpected(dir: string): ExpectedWorkbook {
	const wb = XLSX.read(readFileSync(join(FIXTURE_ROOT, dir, 'expected-output.xlsx')), {
		type: 'buffer'
	});

	// Some workbooks carry a second `Guidelines` sheet holding the catalogs, so the
	// rule is "exactly one data worksheet", not "exactly one worksheet".
	const dataSheets = wb.SheetNames.filter((n) => n !== 'Guidelines');
	expect(dataSheets, dir).toHaveLength(1);

	const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[dataSheets[0]], {
		header: 1,
		defval: null,
		raw: true
	});
	const rawHeaders = (grid[0] ?? []).map(text);
	const headers = rawHeaders.map(canonicalHeader);
	const rows = grid
		.slice(1)
		.filter((r) => r.some((c) => !isBlank(c)))
		.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? null])));

	return { sheetNames: wb.SheetNames, dataSheetName: dataSheets[0], rawHeaders, headers, rows };
}

const EXPECTED = new Map(CASES.map((c) => [c.dir, readExpected(c.dir)]));
const expectedFor = (dir: string) => EXPECTED.get(dir)!;

// ---------------------------------------------------------------------------
// Edge-case detectors — each claim in `covers` is verified, never assumed
// ---------------------------------------------------------------------------

const some = (wb: ExpectedWorkbook, fn: (r: Record<string, unknown>) => boolean) =>
	wb.rows.some(fn);
const every = (wb: ExpectedWorkbook, fn: (r: Record<string, unknown>) => boolean) =>
	wb.rows.every(fn);
const distinct = (wb: ExpectedWorkbook, header: string) =>
	new Set(wb.rows.map((r) => text(r[header])).filter((v) => v !== ''));
const extensions = (inputs: string[]) =>
	new Set(inputs.map((f) => f.slice(f.lastIndexOf('.')).toLowerCase()));

const DETECTORS: Record<EdgeCase, (wb: ExpectedWorkbook, inputs: string[]) => boolean> = {
	'input-xlsx': (_wb, inputs) => inputs.some((f) => f.endsWith('.xlsx')),
	'input-xls': (_wb, inputs) => inputs.some((f) => f.endsWith('.xls')),
	'input-pdf': (_wb, inputs) => inputs.some((f) => f.endsWith('.pdf')),
	'single-file-source': (_wb, inputs) => inputs.length === 1,
	'split-pair-same-format': (_wb, inputs) => inputs.length === 2 && extensions(inputs).size === 1,
	'split-pair-mixed-format': (_wb, inputs) => inputs.length === 2 && extensions(inputs).size === 2,
	'many-files-one-shipment': (_wb, inputs) => inputs.length >= 3,
	'supporting-authorisation-doc': (_wb, inputs) =>
		inputs.some((f) => /authorisation|licence/i.test(f)),
	'sheet-style-guidelines': (wb) =>
		wb.sheetNames.includes('Guidelines') &&
		wb.rawHeaders[5] === 'HAWBL_NO' &&
		typeof wb.rows[0]?.ItemSNo === 'number',
	'sheet-style-productexport': (wb) =>
		wb.sheetNames.length === 1 &&
		wb.dataSheetName === 'ProductExportExcel' &&
		wb.rawHeaders[5] === 'HAWBL_No' &&
		typeof wb.rows[0]?.ItemSNo === 'string',
	'multiple-invoices': (wb) => distinct(wb, 'InvoiceNo').size > 1,
	'scheme-canonical': (wb) => some(wb, (r) => /^\d+\s*-/.test(text(r.ApplicableExpSchemes))),
	'scheme-code-only': (wb) => some(wb, (r) => /^\d+$/.test(text(r.ApplicableExpSchemes))),
	'scheme-mixed-within-shipment': (wb) => distinct(wb, 'ApplicableExpSchemes').size > 1,
	'igst-paid': (wb) =>
		some(wb, (r) => text(r.IGST_PaymentStatus) !== 'LUT' && (asNumber(r.IGST_Rate) ?? 0) > 0),
	'igst-lut': (wb) => some(wb, (r) => text(r.IGST_PaymentStatus) === 'LUT'),
	'drawback-absent': (wb) => every(wb, (r) => isBlank(r.drawback_schno)),
	'drawback-partial': (wb) =>
		some(wb, (r) => isBlank(r.drawback_schno)) && some(wb, (r) => !isBlank(r.drawback_schno)),
	'drawback-full': (wb) => every(wb, (r) => !isBlank(r.drawback_schno)),
	'dbk-desc-populated': (wb) => some(wb, (r) => !isBlank(r.dbk_desc)),
	'rosl-rate-populated': (wb) => some(wb, (r) => !isBlank(r.ROSLRate)),
	'gst-cess-populated': (wb) => some(wb, (r) => !isBlank(r.GSTCCessAmount)),
	'rodtep-declined': (wb) => some(wb, (r) => text(r.RODTEP) === 'No'),
	'end-use-gnx200': (wb) => some(wb, (r) => text(r.EndUse) === 'GNX200'),
	'mixed-quantity-units': (wb) => distinct(wb, 'QuantityUnit').size > 1,
	'rodtep-qty-equals-quantity': (wb) =>
		every(
			wb,
			(r) =>
				isBlank(r.RoDTEPQty) || isBlank(r.Quantity) || asNumber(r.RoDTEPQty) === asNumber(r.Quantity)
		) && some(wb, (r) => !isBlank(r.RoDTEPQty)),
	'rodtep-qty-tracks-sqc': (wb) =>
		some(
			wb,
			(r) =>
				text(r.RODTEP) !== 'No' &&
				asNumber(r.RoDTEPQty) !== null &&
				asNumber(r.RoDTEPQty) !== asNumber(r.Quantity) &&
				asNumber(r.RoDTEPQty) === asNumber(r.SQCQTY)
		)
};

// ---------------------------------------------------------------------------

describe('ICEGrid corpus fixtures — integrity', () => {
	it('matches every fixture byte against the checked-in SHA256SUMS', () => {
		const manifestPath = join(FIXTURE_ROOT, 'SHA256SUMS');
		expect(existsSync(manifestPath)).toBe(true);

		const entries = readFileSync(manifestPath, 'utf8')
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((line) => {
				const [sha, ...rest] = line.split(/\s+/);
				return { sha, path: rest.join(' ').replace(/^\.\//, '') };
			});

		// One entry per input plus one expected output per case.
		const fileCount = CASES.reduce((n, c) => n + c.inputs.length + 1, 0);
		expect(entries).toHaveLength(fileCount);

		for (const entry of entries) {
			const bytes = readFileSync(join(FIXTURE_ROOT, entry.path));
			expect(createHash('sha256').update(bytes).digest('hex'), entry.path).toBe(entry.sha);
		}
	});

	it('ships every input and expected output named by each case', () => {
		for (const c of CASES) {
			for (const input of c.inputs) {
				expect(existsSync(join(FIXTURE_ROOT, c.dir, input)), `${c.dir}/${input}`).toBe(true);
			}
			expect(existsSync(join(FIXTURE_ROOT, c.dir, 'expected-output.xlsx')), c.dir).toBe(true);
		}
	});
});

describe('ICEGrid corpus fixtures — edge case coverage', () => {
	it('covers every corpus edge case across the retained shipments', () => {
		const covered = new Set(CASES.flatMap((c) => c.covers));
		const missing = (Object.keys(EDGE_CASES) as EdgeCase[]).filter((e) => !covered.has(e));
		expect(missing, `uncovered edge cases: ${missing.map((m) => EDGE_CASES[m]).join('; ')}`).toEqual(
			[]
		);
	});

	it('keeps the fixture set minimal — no shipment is fully redundant', () => {
		for (const c of CASES) {
			const others = new Set(CASES.filter((o) => o !== c).flatMap((o) => o.covers));
			const unique = c.covers.filter((e) => !others.has(e));
			expect(unique.length, `${c.dir} adds no edge case the others lack`).toBeGreaterThan(0);
		}
	});

	for (const c of CASES) {
		it(`${c.dir} really exhibits each edge case it claims`, () => {
			const wb = expectedFor(c.dir);
			for (const edge of c.covers) {
				expect(DETECTORS[edge](wb, c.inputs), `${c.dir} claims "${EDGE_CASES[edge]}"`).toBe(true);
			}
		});
	}
});

describe('ICEGrid corpus fixtures — output contract', () => {
	for (const c of CASES) {
		describe(`${c.dir} — ${c.label}`, () => {
			const wb = expectedFor(c.dir);

			it('has exactly the 37 ICEGrid headers in order', () => {
				expect(wb.headers).toEqual([...ICEGRID_HEADERS]);
			});

			it('has the expected row count and invoice numbers', () => {
				expect(wb.rows).toHaveLength(c.rows);
				expect([...distinct(wb, 'InvoiceNo')].sort()).toEqual([...c.invoiceNumbers].sort());
			});

			it('leaves every Accessories cell blank and every Per at 1', () => {
				for (const row of wb.rows) {
					expect(isBlank(row.Accessories)).toBe(true);
					expect(asNumber(row.Per)).toBe(1);
				}
			});

			it('assigns InvoiceSNo by first appearance and restarts ItemSNo per invoice', () => {
				const invoiceSerials = new Map<string, number>();
				const itemCounters = new Map<string, number>();

				for (const row of wb.rows) {
					const invoice = text(row.InvoiceNo);
					expect(invoice).not.toBe('');
					if (!invoiceSerials.has(invoice)) invoiceSerials.set(invoice, invoiceSerials.size + 1);
					itemCounters.set(invoice, (itemCounters.get(invoice) ?? 0) + 1);

					expect(asNumber(row.InvoiceSNo)).toBe(invoiceSerials.get(invoice));
					expect(asNumber(row.ItemSNo)).toBe(itemCounters.get(invoice));
				}
			});

			it('states a description, quantity and unit price on every row', () => {
				for (const row of wb.rows) {
					expect(text(row.Description)).not.toBe('');
					expect(asNumber(row.Quantity)).not.toBeNull();
					expect(asNumber(row.UnitPrice)).not.toBeNull();
				}
			});

			it('carries an 8-digit RITC code on every row', () => {
				for (const row of wb.rows) {
					expect(text(row.RITCCode).replace(/\D/g, '')).toMatch(/^\d{8}$/);
				}
			});

			it('stores IGST_Rate as a whole percentage, never a fraction', () => {
				for (const row of wb.rows) {
					const rate = asNumber(row.IGST_Rate);
					if (rate === null) continue;
					// A percent-typed column would store 0.18 for 18%; ICEGrid stores 18.
					expect(rate === 0 || rate >= 1).toBe(true);
					expect(rate).toBeLessThanOrEqual(28);
				}
			});

			it('ties RoDTEPQty to SQCQTY, and zeroes it on rows that decline RoDTEP', () => {
				for (const [index, row] of wb.rows.entries()) {
					const rodtepQty = asNumber(row.RoDTEPQty);
					if (rodtepQty === null) continue;

					// A row outside the scheme claims no quantity under it.
					if (text(row.RODTEP) === 'No') {
						expect(rodtepQty, `row ${index + 1}`).toBe(0);
						continue;
					}
					if (isBlank(row.SQCQTY)) continue;
					expect(rodtepQty, `row ${index + 1}`).toBe(asNumber(row.SQCQTY));
				}
			});

			it('resolves every catalog-backed value against the shipped catalogs', () => {
				const catalogs = getCatalogSnapshot();

				for (const [index, row] of wb.rows.entries()) {
					for (const col of ICEGRID_COLUMNS) {
						if (!col.catalog) continue;
						const value = text(row[col.header]);
						if (value === '') continue;

						// DistrictOrigin has no shipped catalog yet, so only its shape is checked.
						if (col.catalog === 'district') {
							expect(value, `row ${index + 1} DistrictOrigin`).toMatch(/^\d{1,3}$/);
							continue;
						}

						const resolution = resolveCatalogValue(value, catalogs[col.catalog], {
							allowNumericPrefix: col.catalog === 'scheme'
						});
						expect(
							resolution.status,
							`row ${index + 1} ${col.header} = "${value}" is not a known option`
						).toBe('resolved');
					}
				}
			});
		});
	}
});

describe('ICEGrid corpus fixtures — readers accept the real source documents', () => {
	const normalize = (s: string) => s.replace(/[^0-9a-z]/gi, '').toUpperCase();

	for (const c of CASES) {
		it(
			`${c.dir} extracts text from all ${c.inputs.length} source file(s)`,
			async () => {
				const files = c.inputs.map(
					(name) => new File([readFileSync(join(FIXTURE_ROOT, c.dir, name))], name)
				);

				const result = await combineDocumentSources(files);

				expect(result.sourceFiles).toEqual(c.inputs);
				expect(result.documents).toHaveLength(c.inputs.length);
				for (const doc of result.documents) {
					expect(doc.charCount, doc.filename).toBeGreaterThan(0);
				}

				// Every invoice number in the expected output must be readable from the
				// sources, ignoring the separators each layout happens to print.
				const haystack = normalize(result.content);
				for (const invoice of c.invoiceNumbers) {
					expect(haystack.includes(normalize(invoice)), `${invoice} not found in extracted text`).toBe(
						true
					);
				}
			},
			30_000
		);
	}
});
