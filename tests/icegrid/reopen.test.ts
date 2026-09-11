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

	it('preserves unclassified items whether selected or not across reopen', async () => {
		const { saveIcegridSession, clearIcegridSessions } = await import('$lib/modules/icegrid');
		clearIcegridSessions();

		const testTable: TableData = {
			title: 'Invoice #TEST-99',
			columns,
			rows: [
				// Item 1: was unclassified, user selected 94036000
				{
					id: 'r1',
					InvoiceSNo: 1,
					ItemSNo: 1,
					InvoiceNo: 'TEST-99',
					Description: 'Wooden Side Table',
					RITCCode: '94036000',
					Quantity: 5,
					QuantityUnit: 'NOS',
					UnitPrice: 100,
					ProductAmount: 500,
					_unclassifiedKey: '9403|wooden side table',
					_printedRitc: '9403'
				},
				// Item 2: was unclassified, user left unset (no RITC)
				{
					id: 'r2',
					InvoiceSNo: 1,
					ItemSNo: 2,
					InvoiceNo: 'TEST-99',
					Description: 'Iron Stool',
					RITCCode: null,
					Quantity: 10,
					QuantityUnit: 'NOS',
					UnitPrice: 30,
					ProductAmount: 300,
					_unclassifiedKey: '|iron stool',
					_printedRitc: ''
				},
				// Item 3: was settled on invoice with 8-digit code
				{
					id: 'r3',
					InvoiceSNo: 1,
					ItemSNo: 3,
					InvoiceNo: 'TEST-99',
					Description: 'Steel Screws',
					RITCCode: '73181500',
					Quantity: 100,
					QuantityUnit: 'NOS',
					UnitPrice: 1,
					ProductAmount: 100
				}
			],
			sourceText: 'INVOICE TEST-99 USD'
		};

		// Save the session as if the first confirmation completed
		saveIcegridSession(
			'Invoice #TEST-99',
			[
				{
					key: '9403|wooden side table',
					description: 'Wooden Side Table',
					printed: '9403',
					rowCount: 1,
					candidates: [
						{ code: '94036000', description: 'Other wooden furniture', basis: 'prefix', via: '9403' },
						{ code: '94035000', description: 'Wooden furniture of bedroom', basis: 'prefix', via: '9403' }
					],
					terms: ['wooden furniture'],
					note: 'Classified under 9403',
					materials: 'Mango Wood: 15kg',
					netWeight: 15,
					assignedRitc: '94036000'
				},
				{
					key: '|iron stool',
					description: 'Iron Stool',
					printed: '',
					rowCount: 1,
					candidates: [
						{ code: '94017900', description: 'Other seats with metal frames', basis: 'search', via: 'iron stool' }
					],
					terms: ['metal seats'],
					note: '',
					materials: 'Iron: 8kg',
					netWeight: 8,
					assignedRitc: null
				}
			]
		);

		const result = await reopenIcegridConfirmation(testTable);
		expect(result).not.toBeNull();
		if (!result) return;

		// Headless reopen confirms defaultAnswers:
		// Row 1 keeps its assigned 94036000
		expect(result.table.rows[0].RITCCode).toBe('94036000');
		// Row 2 remains unset
		expect(result.table.rows[1].RITCCode).toBeNull();
		// Row 3 remains settled 73181500
		expect(result.table.rows[2].RITCCode).toBe('73181500');

		// And internal tracking keys are preserved on the rows
		expect(result.table.rows[0]._unclassifiedKey).toBe('9403|wooden side table');
		expect(result.table.rows[1]._unclassifiedKey).toBe('|iron stool');
		expect(result.table.rows[2]._unclassifiedKey).toBeUndefined();

		clearIcegridSessions();
	});
});
