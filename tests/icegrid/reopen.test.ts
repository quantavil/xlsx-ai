import { describe, it, expect } from 'bun:test';
import { isIcegridTable, reopenIcegridConfirmation } from '$lib/modules/icegrid';
import { buildIcegridTableColumns } from '$lib/modules/icegrid/columns';
import { getCatalogSnapshot } from '$lib/modules/icegrid/catalogs';
import type { TableData, Column } from '$lib/types';

describe('isIcegridTable', () => {
	it('detects an ICEGrid table when signature columns are present', () => {
		const catalogs = getCatalogSnapshot();
		const columns = buildIcegridTableColumns(catalogs);
		expect(isIcegridTable(columns)).toBe(true);
	});

	it('returns false for generic table columns', () => {
		const genericColumns: Column[] = [
			{ id: 'c1', name: 'Product Name', type: 'text' },
			{ id: 'c2', name: 'Price', type: 'number' },
			{ id: 'c3', name: 'Quantity', type: 'number' }
		];
		expect(isIcegridTable(genericColumns)).toBe(false);
	});

	it('returns false for empty columns', () => {
		expect(isIcegridTable([])).toBe(false);
	});
});

describe('reopenIcegridConfirmation', () => {
	const catalogs = getCatalogSnapshot();
	const columns = buildIcegridTableColumns(catalogs);

	const sampleTable: TableData = {
		title: 'Invoice #4620117',
		columns,
		rows: [
			{
				id: 'r1',
				InvoiceSNo: 1,
				ItemSNo: 1,
				InvoiceNo: '4620117',
				Description: 'Wooden Chairs',
				RITCCode: '94038900',
				Quantity: 10,
				QuantityUnit: 'NOS',
				UnitPrice: 50,
				ProductAmount: 500,
				ApplicableExpSchemes: '19-Drawback (DBK)',
				RewardItem: 'Yes',
				StateOrigin: '08',
				DistrictOrigin: '0801',
				EndUse: 'GNX100',
				drawback_schno: '940302B',
				IGST_PaymentStatus: 'P',
				IGST_Rate: 18,
				Taxable_Value: 41500,
				IGST_Amount: 7470
			}
		],
		sourceText: 'COMMERCIAL INVOICE 4620117 USD CURRENCY'
	};

	it('reopens and re-derives table values headlessly', async () => {
		const result = await reopenIcegridConfirmation(sampleTable);
		expect(result).not.toBeNull();
		if (!result) return;

		expect(result.table.title).toBe(sampleTable.title);
		expect(result.table.rows.length).toBe(1);
		expect(result.table.rows[0].InvoiceNo).toBe('4620117');
		expect(result.table.rows[0].RITCCode).toBe('94038900');
		expect(result.table.rows[0].StateOrigin).toBe('08');
	});

	it('returns null when abort signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await reopenIcegridConfirmation(sampleTable, controller.signal);
		expect(result).toBeNull();
	});
});
