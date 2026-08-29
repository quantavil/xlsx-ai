import type { TableData, Row, CellValue } from '$lib/types';
import { ICEGRID_COLUMNS, buildIcegridTableColumns } from './columns';
import { getCatalogSnapshot } from './catalogs';
import type { IcegridCatalogSnapshot } from './catalogs/types';
import type { IcegridRow, IcegridReport } from './schema';

/**
 * The only values this module writes without source evidence.
 *
 * Everything else that is absent stays blank. In particular this deliberately does
 * NOT derive ProductAmount from Quantity * UnitPrice, PerUnit from QuantityUnit,
 * the SQC or drawback fields from the invoiced quantity, RoDTEPQty from anything,
 * or any country/state/district/scheme/tax value. Those are flagged as warnings by
 * `validateIcegridReport` instead, so a mismatch is visible without a guess being
 * written into a customs declaration.
 */
export function applyMechanicalRules(rows: readonly IcegridRow[]): IcegridRow[] {
	const invoiceSerials = new Map<string, number>();
	const itemCounters = new Map<string, number>();

	return rows.map((row) => {
		const invoiceNo = typeof row.InvoiceNo === 'string' ? row.InvoiceNo.trim() : '';

		let invoiceSNo: number | null = null;
		let itemSNo: number | null = null;

		// Without a known invoice number there is no group to number within, so the
		// serials stay blank rather than inventing a grouping.
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
			// Fixed ProductFormat rule, confirmed on every row of the trusted corpus.
			Per: row.Per === null || row.Per === undefined ? 1 : row.Per,
			// Never populated on import, and never offered as a dropdown.
			Accessories: null
		};
	});
}

export function mapReportToTableData(
	report: IcegridReport,
	catalogs: IcegridCatalogSnapshot = getCatalogSnapshot()
): TableData {
	const columns = buildIcegridTableColumns(catalogs);
	const rows = applyMechanicalRules(report.rows);

	const primaryInvoice = rows.find((r) => r.InvoiceNo)?.InvoiceNo ?? undefined;
	const title = primaryInvoice ? `ICEGrid - ${primaryInvoice}` : 'ICEGrid Import';

	const tableRows: Row[] = rows.map((rawRow, idx) => {
		const rowObj: Row = { id: `r${idx + 1}` };

		for (const col of ICEGRID_COLUMNS) {
			const val = (rawRow as Record<string, CellValue | undefined>)[col.header];

			if (val === undefined || val === null || val === '') {
				rowObj[col.header] = null;
			} else if (col.type === 'number' || col.type === 'currency') {
				// Plain numeric parsing only. No percent scaling: IGST_Rate 18 stays 18.
				const num =
					typeof val === 'number' ? val : Number.parseFloat(String(val).replace(/[^0-9.-]/g, ''));
				rowObj[col.header] = Number.isFinite(num) ? num : null;
			} else {
				rowObj[col.header] = typeof val === 'string' ? val.trim() : String(val);
			}
		}

		return rowObj;
	});

	return { title, columns, rows: tableRows };
}
