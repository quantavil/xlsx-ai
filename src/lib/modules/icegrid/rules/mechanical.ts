import type { IcegridRow } from '../schema';

/**
 * The headers the module blanks rather than computes.
 *
 * A carton count is per consignment, not per line item, so a packing list gives the
 * model plenty of numbers that look like one and none that belong on a row. Blank is
 * the only honest answer, and cheaper than an extraction that has to be checked.
 */
export const CLEARED_HEADERS = ['Accessories', 'Total_Package'] as const;

/**
 * The only values this module writes without source evidence.
 *
 * Assigns invoice and item sequence numbers, sets default Per = 1,
 * and blanks non-line-item headers like Accessories and Total_Package.
 */
export function applyMechanicalRules(rows: readonly IcegridRow[]): IcegridRow[] {
	const invoiceSerials = new Map<string, number>();
	const itemCounters = new Map<string, number>();

	return rows.map((row) => {
		const invoiceNo = typeof row.InvoiceNo === 'string' ? row.InvoiceNo.trim() : '';

		let invoiceSNo: number | null = null;
		let itemSNo: number | null = null;

		if (invoiceNo) {
			if (!invoiceSerials.has(invoiceNo)) invoiceSerials.set(invoiceNo, invoiceSerials.size + 1);
			invoiceSNo = invoiceSerials.get(invoiceNo)!;
			itemSNo = (itemCounters.get(invoiceNo) ?? 0) + 1;
			itemCounters.set(invoiceNo, itemSNo);
		}

		return {
			...row,
			InvoiceNo: invoiceNo || null,
			InvoiceSNo: invoiceSNo,
			ItemSNo: itemSNo,
			Per: row.Per === null || row.Per === undefined ? 1 : row.Per,
			...(Object.fromEntries(CLEARED_HEADERS.map((h) => [h, null])) as Record<string, null>)
		};
	});
}
