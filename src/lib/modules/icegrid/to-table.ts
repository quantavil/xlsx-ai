import type { TableData, Row, CellValue } from '$lib/types';
import { ICEGRID_COLUMNS, buildIcegridTableColumns } from './columns';
import type { IcegridReport } from './schema';

export function mapReportToTableData(report: IcegridReport): TableData {
	const columns = buildIcegridTableColumns();

	// Determine table title from first invoice number
	const primaryInvoice = report.rows.find((r) => r.InvoiceNo && r.InvoiceNo.trim())?.InvoiceNo?.trim();
	const title = primaryInvoice ? `ICEGrid - ${primaryInvoice}` : 'ICEGrid Import';

	const rows: Row[] = report.rows.map((rawRow, idx) => {
		const rowId = `r${idx + 1}`;
		const rowObj: Row = { id: rowId };

		for (const col of ICEGRID_COLUMNS) {
			const header = col.header;
			const val = (rawRow as Record<string, CellValue | undefined>)[header];

			if (val === undefined || val === null || val === '') {
				// Apply default value if defined
				if (col.defaultValue !== undefined) {
					rowObj[header] = col.defaultValue as CellValue;
				} else if (header === 'ItemSNo') {
					rowObj[header] = idx + 1;
				} else {
					rowObj[header] = null;
				}
			} else if (col.type === 'number' || col.type === 'currency' || col.type === 'percent') {
				const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
				rowObj[header] = isNaN(num) ? null : num;
			} else {
				rowObj[header] = typeof val === 'string' ? val.trim() : String(val);
			}
		}

		return rowObj;
	});

	return {
		title,
		columns,
		rows
	};
}
