import type { TableData, Row, CellValue } from '$lib/types';
import {
	ICEGRID_COLUMNS,
	CLEARED_HEADERS,
	buildIcegridTableColumns,
	type IcegridRuntimeOptions
} from './columns';
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
			// Never populated on import; see CLEARED_HEADERS for why.
			...(Object.fromEntries(CLEARED_HEADERS.map((h) => [h, null])) as Record<string, null>)
		};
	});
}

/**
 * Generates a clean, business-meaningful title for an imported customs document.
 * Avoids raw internal module branding (like "ICEGrid - ...") and cleans noisy date suffixes.
 */
export function deriveSmartDocumentTitle(
	rows: readonly IcegridRow[],
	sourceFiles: readonly string[] = []
): string {
	const rawInvoices = rows
		.map((r) => (typeof r.InvoiceNo === 'string' ? r.InvoiceNo.trim() : ''))
		.filter((inv) => inv.length > 0);

	// Strip trailing date clauses like "Dt. 27/08/2026", "Dt: ...", "/ Dt ..."
	const cleanInvoices = Array.from(
		new Set(
			rawInvoices.map((inv) =>
				inv
					.replace(/(?:[\s,]+(?:[/,-]\s*)?|[/,]\s*)\b(?:Dt|Date)\b[.:\s]\s*.*$/i, '')
					.trim()
			)
		)
	).filter((inv) => inv.length > 0);

	if (cleanInvoices.length > 1) {
		const preview = cleanInvoices.slice(0, 3).join(', ');
		const more = cleanInvoices.length > 3 ? '...' : '';
		return `Invoices (${cleanInvoices.length}): ${preview}${more}`;
	}

	if (cleanInvoices.length === 1) {
		const inv = cleanInvoices[0];
		if (/^(?:inv|invoice|bill)\b/i.test(inv)) {
			return inv;
		}
		return `Invoice #${inv}`;
	}

	// Fallback to source files if no invoice was detected in rows
	if (sourceFiles.length > 0) {
		const primary = sourceFiles[0].replace(/^.*[\\/]/, '').replace(/\.[^/.]+$/, '');
		if (primary.trim()) {
			return `${primary.trim()} (Customs Grid)`;
		}
	}

	return 'Customs Declaration';
}

export function mapReportToTableData(
	report: IcegridReport,
	catalogs: IcegridCatalogSnapshot = getCatalogSnapshot(),
	runtimeOptions: IcegridRuntimeOptions = {},
	sourceText?: string
): TableData {
	const columns = buildIcegridTableColumns(catalogs, runtimeOptions);
	const rows = applyMechanicalRules(report.rows);

	const title = deriveSmartDocumentTitle(rows, report.sourceFiles);

	const tableRows: Row[] = rows.map((rawRow, idx) => {
		const rowObj: Row = { id: `r${idx + 1}` };

		for (const col of ICEGRID_COLUMNS) {
			if (col.internal) continue;
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

	return { title, columns, rows: tableRows, ...(sourceText ? { sourceText } : {}) };
}
