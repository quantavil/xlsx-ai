import { describe, it, expect } from 'bun:test';
import {
	ICEGRID_COLUMNS,
	ICEGRID_HEADERS,
	buildIcegridTableColumns
} from '../../src/lib/modules/icegrid/columns';
import { applyMechanicalRules, mapReportToTableData } from '../../src/lib/modules/icegrid/to-table';
import type { IcegridRow, IcegridReport } from '../../src/lib/modules/icegrid/schema';

const DROPDOWN_HEADERS = [
	'EndUse',
	'RewardItem',
	'IGST_PaymentStatus',
	'ApplicableExpSchemes',
	'QuantityUnit',
	'SQCUnit',
	'PerUnit',
	'dbk_unit',
	'CountryDestination',
	'FTACode',
	'StateOrigin',
	'DistrictOrigin',
	'RODTEP'
];

const blankRow = (): IcegridRow =>
	Object.fromEntries(ICEGRID_HEADERS.map((h) => [h, null])) as unknown as IcegridRow;

describe('ICEGrid column metadata', () => {
	it('still emits exactly the 37 headers in order', () => {
		expect(ICEGRID_HEADERS).toHaveLength(37);
		expect(buildIcegridTableColumns().map((c) => c.id)).toEqual(ICEGRID_HEADERS);
	});

	it('makes exactly the 13 catalog-backed columns dropdowns', () => {
		const dropdowns = ICEGRID_COLUMNS.filter((c) => c.type === 'dropdown').map((c) => c.header);
		expect(dropdowns.sort()).toEqual([...DROPDOWN_HEADERS].sort());
	});

	it('keeps Accessories a plain text column with no catalog', () => {
		const accessories = ICEGRID_COLUMNS.find((c) => c.header === 'Accessories')!;
		expect(accessories.type).toBe('text');
		expect(accessories.catalog).toBeUndefined();
		expect(buildIcegridTableColumns().find((c) => c.id === 'Accessories')?.dropdown).toBeUndefined();
	});

	it('types IGST_Rate as a number so 18 does not render as 1800%', () => {
		expect(ICEGRID_COLUMNS.find((c) => c.header === 'IGST_Rate')!.type).toBe('number');
		expect(ICEGRID_COLUMNS.some((c) => c.type === 'percent')).toBe(false);
	});

	it('attaches the unit catalog to all four UOM columns', () => {
		const cols = buildIcegridTableColumns();
		for (const header of ['QuantityUnit', 'SQCUnit', 'PerUnit', 'dbk_unit']) {
			const opts = cols.find((c) => c.id === header)!.dropdown!.options;
			expect(opts, header).toHaveLength(70);
			expect(opts.map((o) => o.value), header).toContain('PCS');
		}
	});

	it('makes DistrictOrigin depend on StateOrigin', () => {
		const district = buildIcegridTableColumns().find((c) => c.id === 'DistrictOrigin')!;
		expect(district.dropdown?.dependsOnColumnId).toBe('StateOrigin');
	});

	it('labels coded catalogs with descriptions while storing only the code', () => {
		const cols = buildIcegridTableColumns();
		const state = cols.find((c) => c.id === 'StateOrigin')!.dropdown!.options;
		const rajasthan = state.find((o) => o.value === '08')!;
		expect(rajasthan.label).toBe('RAJASTHAN');

		const country = cols.find((c) => c.id === 'CountryDestination')!.dropdown!.options;
		expect(country.find((o) => o.value === 'US')?.label).toBeTruthy();

		// Nothing stored is ever the display string.
		for (const opt of [...state, ...country]) expect(opt.value).not.toContain(' ');
	});

	it('allows explicit user-created values on ICEGrid dropdowns', () => {
		for (const col of buildIcegridTableColumns()) {
			if (col.dropdown) expect(col.dropdown.allowCustom, col.id).toBe(true);
		}
	});
});

describe('applyMechanicalRules', () => {
	const rowFor = (invoiceNo: string | null): IcegridRow => ({
		...blankRow(),
		InvoiceNo: invoiceNo,
		InvoiceSNo: 99,
		ItemSNo: 99,
		Accessories: 'N',
		Description: 'thing'
	});

	it('numbers invoices by first appearance and restarts items per invoice', () => {
		const out = applyMechanicalRules([
			rowFor('INV-A'),
			rowFor('INV-A'),
			rowFor('INV-B'),
			rowFor('INV-A'),
			rowFor(null)
		]);

		expect(out.map((r) => [r.InvoiceSNo, r.ItemSNo])).toEqual([
			[1, 1],
			[1, 2],
			[2, 1],
			[1, 3],
			[null, null]
		]);
	});

	it('always clears Accessories regardless of what the AI returned', () => {
		for (const row of applyMechanicalRules([rowFor('INV-A'), rowFor(null)])) {
			expect(row.Accessories).toBeNull();
		}
	});

	it('defaults a blank Per to 1 but preserves a stated Per', () => {
		const [blank, stated] = applyMechanicalRules([
			{ ...rowFor('INV-A'), Per: null },
			{ ...rowFor('INV-A'), Per: 1000 }
		]);
		expect(blank.Per).toBe(1);
		expect(stated.Per).toBe(1000);
	});

	it('derives nothing else', () => {
		const source: IcegridRow = {
			...blankRow(),
			InvoiceNo: 'INV-A',
			Description: 'thing',
			Quantity: 120,
			QuantityUnit: 'PCS',
			UnitPrice: 2.68
		};
		const [out] = applyMechanicalRules([source]);

		// Each of these is a derivation the trusted corpus performs but that this
		// module must not invent without evidence.
		expect(out.ProductAmount).toBeNull();
		expect(out.PerUnit).toBeNull();
		expect(out.SQCQTY).toBeNull();
		expect(out.SQCUnit).toBeNull();
		expect(out.dbk_qty).toBeNull();
		expect(out.dbk_unit).toBeNull();
		expect(out.FTACode).toBeNull();
		expect(out.StateOrigin).toBeNull();
		expect(out.DistrictOrigin).toBeNull();
		expect(out.CountryDestination).toBeNull();
		expect(out.RODTEP).toBeNull();
		expect(out.RoDTEPQty).toBeNull();
		expect(out.IGST_Rate).toBeNull();
	});
});

describe('mapReportToTableData', () => {
	const report = (rows: IcegridRow[]): IcegridReport => ({
		reportVersion: 1,
		sourceFiles: ['a.pdf'],
		rows,
		warnings: []
	});

	it('maps two invoices into a 37-column table with correct serials', () => {
		const table = mapReportToTableData(
			report([
				{ ...blankRow(), InvoiceNo: 'INV-A', Description: 'x', Quantity: 1 },
				{ ...blankRow(), InvoiceNo: 'INV-A', Description: 'y', Quantity: 2 },
				{ ...blankRow(), InvoiceNo: 'INV-B', Description: 'z', Quantity: 3 }
			])
		);

		expect(table.columns.map((c) => c.id)).toEqual(ICEGRID_HEADERS);
		expect(table.rows.map((r) => [r.InvoiceSNo, r.ItemSNo])).toEqual([
			[1, 1],
			[1, 2],
			[2, 1]
		]);
		expect(table.title).toBe('ICEGrid - INV-A');
	});

	it('never percent-scales IGST_Rate', () => {
		const table = mapReportToTableData(
			report([{ ...blankRow(), InvoiceNo: 'INV-A', IGST_Rate: 18 }])
		);
		expect(table.rows[0].IGST_Rate).toBe(18);
	});

	it('leaves every unsupported field blank', () => {
		const table = mapReportToTableData(
			report([{ ...blankRow(), InvoiceNo: 'INV-A', Description: 'x' }])
		);
		const row = table.rows[0];
		const filled = ICEGRID_HEADERS.filter((h) => row[h] !== null);
		expect(filled.sort()).toEqual(['Description', 'InvoiceNo', 'InvoiceSNo', 'ItemSNo', 'Per']);
	});
});
