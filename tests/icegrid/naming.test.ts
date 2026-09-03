import { describe, it, expect } from 'bun:test';
import { deriveSmartDocumentTitle } from '../../src/lib/modules/icegrid/to-table';
import type { IcegridRow } from '../../src/lib/modules/icegrid/schema';

describe('deriveSmartDocumentTitle', () => {
	it('keeps invoice string that already starts with INV prefix', () => {
		const rows = [{ InvoiceNo: 'INV-2026-900' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows)).toBe('INV-2026-900');
	});

	it('adds Invoice # prefix for bare invoice numbers', () => {
		const rows = [{ InvoiceNo: 'GGI 63/26-27' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows)).toBe('Invoice #GGI 63/26-27');
	});

	it('strips noisy Dt. date suffixes from invoice numbers', () => {
		const rows = [{ InvoiceNo: '30744 /26-27 Dt. 27/08/2026' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows)).toBe('Invoice #30744 /26-27');
	});

	it('strips / Dt: and Date: suffixes', () => {
		const rows = [{ InvoiceNo: 'EXP-889 / Dt: 12-05-2025' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows)).toBe('Invoice #EXP-889');
		const rows2 = [{ InvoiceNo: 'EXP-889 Date: 12-05-2025' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows2)).toBe('Invoice #EXP-889');
	});

	it('preserves valid IDs that start with DT or contain DATE', () => {
		const rows1 = [{ InvoiceNo: 'DT1234' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows1)).toBe('Invoice #DT1234');

		const rows2 = [{ InvoiceNo: 'DT-5678' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows2)).toBe('Invoice #DT-5678');

		const rows3 = [{ InvoiceNo: 'CANDATE-42' }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows3)).toBe('Invoice #CANDATE-42');
	});

	it('formats multi-invoice batches with invoice count and distinct numbers', () => {
		const rows = [
			{ InvoiceNo: '4620117' },
			{ InvoiceNo: '4620117' },
			{ InvoiceNo: '4620120' },
			{ InvoiceNo: '4620152' }
		] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows)).toBe('Invoices (3): 4620117, 4620120, 4620152');
	});

	it('truncates preview when batch has more than 3 invoices', () => {
		const rows = [
			{ InvoiceNo: 'INV-1' },
			{ InvoiceNo: 'INV-2' },
			{ InvoiceNo: 'INV-3' },
			{ InvoiceNo: 'INV-4' }
		] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows)).toBe('Invoices (4): INV-1, INV-2, INV-3...');
	});

	it('falls back to source filename when no invoice number is found', () => {
		const rows = [{ InvoiceNo: null }] as unknown as IcegridRow[];
		expect(deriveSmartDocumentTitle(rows, ['path/to/commercial_invoice.pdf'])).toBe(
			'commercial_invoice (Customs Grid)'
		);
	});

	it('falls back to Customs Declaration when no invoice and no source files exist', () => {
		expect(deriveSmartDocumentTitle([])).toBe('Customs Declaration');
	});
});
