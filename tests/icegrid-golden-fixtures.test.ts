import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ICEGRID_HEADERS } from '../src/lib/modules/icegrid/columns';

/**
 * Layer 0 baseline: lock the trusted legacy output shape before any production
 * behavior changes. These fixtures are the contract the reworked pipeline has to
 * keep meeting; nothing here imports the new sanitize/catalog code yet.
 *
 * Fixture provenance: the trusted corpus at "INPUT & OUTPUT FILES" (17 cases).
 * The plan pointed at `<legacy-repo>/tests/fixtures/legacy/SHA256SUMS`, which does
 * not exist — that repo ships a single `tests/fixtures/sample.pdf`. SHA256SUMS is
 * therefore generated at copy time and verified here instead of copied.
 */

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures/icegrid/legacy');

/** Header 6 is `HAWBL_No` in 7 corpus workbooks and `HAWBL_NO` in the other 10. */
const canonicalHeader = (raw: unknown): string => {
	const value = String(raw ?? '').trim();
	return ICEGRID_HEADERS.find((h) => h.toLowerCase() === value.toLowerCase()) ?? value;
};

/**
 * The `ProductExportExcel` sheets store numbers as text ("1", "18", "45000.0000")
 * while the `Sheet1` sheets store them as numbers. Compare by value, not by type.
 */
const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';
const asNumber = (v: unknown): number | null => {
	if (isBlank(v)) return null;
	const n = Number(String(v).replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
};

interface GoldenWorkbook {
	dataSheetName: string;
	sheetNames: string[];
	headers: string[];
	rows: Record<string, unknown>[];
}

function readGoldenWorkbook(relativePath: string): GoldenWorkbook {
	const workbook = XLSX.read(readFileSync(join(FIXTURE_ROOT, relativePath)), { type: 'buffer' });

	// 10 of 17 trusted workbooks carry a second `Guidelines` sheet holding the
	// unit/scheme/EndUse catalogs. The plan's "one output worksheet" assertion is
	// relaxed to "exactly one data worksheet" for that reason.
	const dataSheets = workbook.SheetNames.filter((n) => n !== 'Guidelines');
	expect(dataSheets).toHaveLength(1);

	const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[dataSheets[0]], {
		header: 1,
		defval: null,
		raw: true
	});
	const headers = (grid[0] ?? []).map(canonicalHeader);
	const rows = grid
		.slice(1)
		.filter((r) => r.some((c) => !isBlank(c)))
		.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? null])));

	return { dataSheetName: dataSheets[0], sheetNames: workbook.SheetNames, headers, rows };
}

interface GoldenCase {
	dir: string;
	label: string;
	inputs: string[];
	rowCount: number;
	invoiceNumbers: number;
}

const CASES: GoldenCase[] = [
	{
		dir: 'combined-pdf',
		label: 'sparse combined PDF (invoice + packing list in one file)',
		inputs: ['input.pdf'],
		rowCount: 22,
		invoiceNumbers: 1
	},
	{
		dir: 'combined-xlsx',
		label: 'combined XLSX (invoice + packing list in one workbook)',
		inputs: ['input.xlsx'],
		rowCount: 12,
		invoiceNumbers: 1
	},
	{
		dir: 'split-xls',
		label: 'multi-file XLS (invoice and packing list selected together)',
		inputs: ['invoice.xls', 'packing.xls'],
		rowCount: 25,
		invoiceNumbers: 1
	},
	{
		dir: 'input-10',
		label: 'code-only scheme migration case (stores bare "19")',
		inputs: ['input.pdf'],
		rowCount: 28,
		invoiceNumbers: 1
	},
	{
		dir: 'enriched-xls',
		label: 'enriched XLS carrying a literal IGST_Rate of 18',
		inputs: ['input.xls'],
		rowCount: 25,
		invoiceNumbers: 1
	}
];

describe('ICEGrid golden fixtures — integrity', () => {
	it('verifies every fixture byte against the checked-in SHA256SUMS', () => {
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

		expect(entries.length).toBe(11);

		for (const entry of entries) {
			const bytes = readFileSync(join(FIXTURE_ROOT, entry.path));
			expect(createHash('sha256').update(bytes).digest('hex'), entry.path).toBe(entry.sha);
		}
	});

	it('ships every input named by each retained case', () => {
		for (const c of CASES) {
			for (const input of c.inputs) {
				expect(existsSync(join(FIXTURE_ROOT, c.dir, input)), `${c.dir}/${input}`).toBe(true);
			}
			expect(existsSync(join(FIXTURE_ROOT, c.dir, 'expected-output.xlsx')), c.dir).toBe(true);
		}
	});
});

describe('ICEGrid golden fixtures — trusted output contract', () => {
	for (const c of CASES) {
		describe(`${c.dir} — ${c.label}`, () => {
			const wb = readGoldenWorkbook(join(c.dir, 'expected-output.xlsx'));

			it('has exactly the 37 ICEGrid headers in order', () => {
				expect(wb.headers).toHaveLength(37);
				expect(wb.headers).toEqual([...ICEGRID_HEADERS]);
			});

			it('has the expected row and invoice counts', () => {
				expect(wb.rows).toHaveLength(c.rowCount);
				const invoices = new Set(wb.rows.map((r) => String(r.InvoiceNo ?? '').trim()));
				expect(invoices.size).toBe(c.invoiceNumbers);
				expect(invoices.has('')).toBe(false);
			});

			it('leaves every Accessories cell blank', () => {
				for (const row of wb.rows) expect(isBlank(row.Accessories)).toBe(true);
			});

			it('carries Per = 1 on every row', () => {
				for (const row of wb.rows) expect(asNumber(row.Per)).toBe(1);
			});

			it('assigns InvoiceSNo by first appearance and resets ItemSNo per invoice', () => {
				const invoiceSerials = new Map<string, number>();
				const itemCounters = new Map<string, number>();

				for (const row of wb.rows) {
					const invoice = String(row.InvoiceNo ?? '').trim();
					if (!invoiceSerials.has(invoice)) invoiceSerials.set(invoice, invoiceSerials.size + 1);
					itemCounters.set(invoice, (itemCounters.get(invoice) ?? 0) + 1);

					expect(asNumber(row.InvoiceSNo)).toBe(invoiceSerials.get(invoice));
					expect(asNumber(row.ItemSNo)).toBe(itemCounters.get(invoice));
				}
			});

			it('never percent-scales IGST_Rate', () => {
				for (const row of wb.rows) {
					const rate = asNumber(row.IGST_Rate);
					if (rate === null) continue;
					// A percent-typed column would store 0.18 for 18%. Trusted output stores 18.
					expect(Number.isInteger(rate) || rate >= 1).toBe(true);
					expect(rate).toBeLessThanOrEqual(28);
				}
			});
		});
	}

	it('keeps unsupported customs fields blank in the sparse case', () => {
		const wb = readGoldenWorkbook('combined-pdf/expected-output.xlsx');
		const alwaysBlank = [
			'Total_Package',
			'HAWBL_No',
			'Accessories',
			'dbk_desc',
			'ROSLRate',
			'ROSLCapValue',
			'GSTCCessAmount'
		];

		for (const header of alwaysBlank) {
			expect(
				wb.rows.every((r) => isBlank(r[header])),
				`${header} should be blank in every sparse row`
			).toBe(true);
		}
	});

	it('preserves a literal IGST_Rate of 18 in the enriched case', () => {
		const wb = readGoldenWorkbook('enriched-xls/expected-output.xlsx');
		const rates = new Set(wb.rows.map((r) => asNumber(r.IGST_Rate)));
		expect(rates.has(18)).toBe(true);
		expect(rates.has(0.18)).toBe(false);
	});

	it('preserves a RoDTEPQty that differs from Quantity', () => {
		const wb = readGoldenWorkbook('input-10/expected-output.xlsx');
		const differing = wb.rows.filter(
			(r) => asNumber(r.RoDTEPQty) !== null && asNumber(r.RoDTEPQty) !== asNumber(r.Quantity)
		);

		expect(differing.length).toBeGreaterThan(0);
		// RoDTEPQty tracks the SQC quantity, not the invoiced quantity, so it can
		// never be back-filled from Quantity.
		for (const row of differing) expect(asNumber(row.RoDTEPQty)).toBe(asNumber(row.SQCQTY));
	});
});

describe('ICEGrid golden fixtures — intentional scheme migration', () => {
	/**
	 * The legacy corpus is inconsistent: some workbooks store the bare code "19",
	 * others the complete canonical "19-Drawback (DBK)". Newly generated output
	 * standardizes on the complete value per the approved design (§7). This test
	 * records that as a deliberate migration, not an accidental mismatch, so a
	 * future diff against `input-10` is expected to differ on this column alone.
	 */
	const CODE_ONLY = '19';
	const CANONICAL = '19-Drawback (DBK)';

	it('input-10 stores the legacy code-only scheme value', () => {
		const wb = readGoldenWorkbook('input-10/expected-output.xlsx');
		const schemes = new Set(wb.rows.map((r) => String(r.ApplicableExpSchemes ?? '').trim()));
		expect([...schemes]).toEqual([CODE_ONLY]);
	});

	it('combined-pdf already stores the complete canonical scheme value', () => {
		const wb = readGoldenWorkbook('combined-pdf/expected-output.xlsx');
		const schemes = new Set(wb.rows.map((r) => String(r.ApplicableExpSchemes ?? '').trim()));
		expect([...schemes]).toEqual([CANONICAL]);
	});

	it('documents the single allowed difference for regenerated input-10 output', () => {
		const ALLOWED_MIGRATIONS: Record<string, Record<string, string>> = {
			ApplicableExpSchemes: { [CODE_ONLY]: CANONICAL }
		};

		expect(ALLOWED_MIGRATIONS.ApplicableExpSchemes[CODE_ONLY]).toBe(CANONICAL);
		expect(Object.keys(ALLOWED_MIGRATIONS)).toEqual(['ApplicableExpSchemes']);
	});
});
