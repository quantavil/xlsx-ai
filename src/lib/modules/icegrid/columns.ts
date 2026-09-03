import type { Column, ColumnType, DropdownOption } from '$lib/types';
import { getCatalogSnapshot } from './catalogs';
import type { IcegridCatalogId, IcegridCatalogSnapshot } from './catalogs/types';

export interface IcegridColumnSpec {
	id: string;
	header: string;
	type: ColumnType;
	description: string;
	required?: boolean;
	/** Which trusted catalog backs this column's in-app dropdown, if any. */
	catalog?: IcegridCatalogId;
	/**
	 * Options supplied per import run rather than by a bundled catalog.
	 *
	 * Deliberately not `catalog`: a catalog-backed value must resolve to a catalog
	 * entry or be cleared, and a drawback serial the documents printed has to survive
	 * even when the live lookup is unreachable. This drives the dropdown only.
	 */
	runtimeOptions?: 'drawback';
	/** Header of the column this dropdown filters against, e.g. district -> state. */
	dependsOn?: string;
	/**
	 * Headers that take a copy of this dropdown's value, but only while they are blank.
	 *
	 * `deriveRows` applies exactly these copies at import, and only to cells nothing
	 * else filled. Repeating them here is what makes them survive a unit that arrives
	 * late: import derives once, so a `QuantityUnit` the documents did not evidence
	 * left its dependents empty with no way to fill them but by hand.
	 */
	fillsIfBlank?: readonly string[];
	/**
	 * Extracted and verified like any other field, but never a column in the table
	 * or the exported workbook.
	 *
	 * For source data a rule needs and the filing does not have a slot for. It still
	 * goes through the evidence gate, because a value that decides a declared
	 * quantity has to be as trustworthy as one that is declared directly.
	 */
	internal?: true;
}

export const ICEGRID_COLUMNS: readonly IcegridColumnSpec[] = [
	{ id: 'invoiceSNo', header: 'InvoiceSNo', type: 'number', description: 'Invoice sequence number, assigned by first appearance of each invoice number', required: true },
	{ id: 'itemSNo', header: 'ItemSNo', type: 'number', description: 'Item sequence number, restarting at 1 within each invoice', required: true },
	{ id: 'invoiceNo', header: 'InvoiceNo', type: 'text', description: 'Commercial invoice number', required: true },
	{ id: 'description', header: 'Description', type: 'text', description: 'Item description of goods', required: true },
	{ id: 'endUse', header: 'EndUse', type: 'dropdown', description: 'ICEGATE end-use code', catalog: 'endUse' },
	{ id: 'hawblNo', header: 'HAWBL_No', type: 'text', description: 'House Airway Bill / Bill of Lading number' },
	{ id: 'totalPackage', header: 'Total_Package', type: 'number', description: 'Always blank on import; fill manually only if required' },
	{ id: 'accessories', header: 'Accessories', type: 'text', description: 'Always blank on import; fill manually only if required' },
	{ id: 'rewardItem', header: 'RewardItem', type: 'dropdown', description: 'Reward scheme eligibility', catalog: 'rewardItem' },
	{ id: 'igstPaymentStatus', header: 'IGST_PaymentStatus', type: 'dropdown', description: 'IGST payment status', catalog: 'igstPaymentStatus' },
	{ id: 'ritcCode', header: 'RITCCode', type: 'text', description: '8-digit Indian Customs tariff code (RITC/ITC-HS)' },
	{ id: 'applicableExpSchemes', header: 'ApplicableExpSchemes', type: 'dropdown', description: 'Complete export scheme entry, e.g. 19-Drawback (DBK)', catalog: 'scheme' },
	{ id: 'quantity', header: 'Quantity', type: 'number', description: 'Item quantity invoiced', required: true },
	{ id: 'quantityUnit', header: 'QuantityUnit', type: 'dropdown', description: 'Unit of measurement', catalog: 'unit', required: true, fillsIfBlank: ['PerUnit', 'dbk_unit'] },
	{ id: 'sqcQty', header: 'SQCQTY', type: 'number', description: 'Standard Quantity Code quantity' },
	{ id: 'sqcUnit', header: 'SQCUnit', type: 'dropdown', description: 'Standard Quantity Code unit', catalog: 'unit' },
	{ id: 'netWeight', header: 'NetWeight', type: 'number', description: 'Net weight of this line item in kilograms; source data for SQCQTY, never filed', internal: true },
	{ id: 'unitPrice', header: 'UnitPrice', type: 'number', description: 'Price per unit', required: true },
	{ id: 'productAmount', header: 'ProductAmount', type: 'number', description: 'Total item amount as stated on the source document' },
	{ id: 'per', header: 'Per', type: 'number', description: 'Unit price denominator; defaults to 1' },
	{ id: 'perUnit', header: 'PerUnit', type: 'dropdown', description: 'Unit for the price denominator', catalog: 'unit' },
	{ id: 'drawbackSchNo', header: 'drawback_schno', type: 'dropdown', description: 'Duty drawback schedule serial number', runtimeOptions: 'drawback', dependsOn: 'RITCCode' },
	{ id: 'dbkQty', header: 'dbk_qty', type: 'number', description: 'Drawback eligible quantity' },
	{ id: 'dbkRate', header: 'dbk_rate', type: 'number', description: 'Duty drawback rate' },
	{ id: 'dbkUnit', header: 'dbk_unit', type: 'dropdown', description: 'Drawback unit', catalog: 'unit' },
	{ id: 'dbkDesc', header: 'dbk_desc', type: 'text', description: 'Duty drawback description' },
	{ id: 'roslRate', header: 'ROSLRate', type: 'number', description: 'RoSCTL rate' },
	{ id: 'roslCapValue', header: 'ROSLCapValue', type: 'number', description: 'RoSCTL maximum cap value' },
	{ id: 'countryDestination', header: 'CountryDestination', type: 'dropdown', description: 'Country of final destination, stored as its ISO alpha-2 code', catalog: 'country' },
	{ id: 'ftaCode', header: 'FTACode', type: 'dropdown', description: 'Free Trade Agreement preference code', catalog: 'fta' },
	{ id: 'stateOrigin', header: 'StateOrigin', type: 'dropdown', description: 'State of origin, stored as its two-digit code', catalog: 'state' },
	{ id: 'districtOrigin', header: 'DistrictOrigin', type: 'dropdown', description: 'District of origin, stored as its code; options depend on StateOrigin', catalog: 'district', dependsOn: 'StateOrigin' },
	{ id: 'taxableValue', header: 'Taxable_Value', type: 'number', description: 'Assessable taxable value' },
	// `number`, not `percent`: ICEGrid stores 18 for 18%, and the host `percent` type
	// would treat that as 1800%.
	{ id: 'igstRate', header: 'IGST_Rate', type: 'number', description: 'IGST rate as a whole number, e.g. 5, 12, 18, 28' },
	{ id: 'igstAmount', header: 'IGST_Amount', type: 'number', description: 'IGST tax amount' },
	{ id: 'gstCessAmount', header: 'GSTCCessAmount', type: 'number', description: 'GST compensation cess amount' },
	{ id: 'rodtep', header: 'RODTEP', type: 'dropdown', description: 'RoDTEP eligibility', catalog: 'rodtep' },
	{ id: 'rodtepQty', header: 'RoDTEPQty', type: 'number', description: 'RoDTEP eligible quantity' }
];

/** Every header the module extracts, internal ones included. Evidence is cited by these. */
export const ICEGRID_ALL_HEADERS = ICEGRID_COLUMNS.map((c) => c.header);

/** The headers that reach the table and the exported workbook, in filing order. */
export const ICEGRID_HEADERS = ICEGRID_COLUMNS.filter((c) => !c.internal).map((c) => c.header);

/**
 * The headers the module blanks rather than computes.
 *
 * A carton count is per consignment, not per line item, so a packing list gives the
 * model plenty of numbers that look like one and none that belong on a row. Blank is
 * the only honest answer, and cheaper than an extraction that has to be checked.
 */
export const CLEARED_HEADERS = ['Accessories', 'Total_Package'] as const;

/** Headers the module owns mechanically; AI values for these are always discarded. */
export const MECHANICAL_HEADERS = ['InvoiceSNo', 'ItemSNo', 'Per', ...CLEARED_HEADERS] as const;

/** Dropdown options a single run supplies, keyed by `IcegridColumnSpec.runtimeOptions`. */
export type IcegridRuntimeOptions = Partial<Record<'drawback', readonly DropdownOption[]>>;

export function buildIcegridTableColumns(
	catalogs: IcegridCatalogSnapshot = getCatalogSnapshot(),
	runtimeOptions: IcegridRuntimeOptions = {}
): Column[] {
	return ICEGRID_COLUMNS.filter((col) => !col.internal).map((col) => {
		const width =
			col.id === 'description'
				? 240
				: col.id === 'unitPrice' ||
					  col.id === 'productAmount' ||
					  col.id === 'taxableValue' ||
					  col.id === 'igstAmount' ||
					  col.id === 'gstCessAmount'
					? 140
					: 130;

		if (col.runtimeOptions) {
			return {
				id: col.header,
				name: col.header,
				type: col.type,
				width,
				dropdown: {
					options: [...(runtimeOptions[col.runtimeOptions] ?? [])],
					// The live service can be unreachable and a broker can be right when it
					// disagrees with it, so a serial always stays typeable.
					allowCustom: true,
					...(col.dependsOn ? { dependsOnColumnId: col.dependsOn } : {})
				}
			};
		}

		if (!col.catalog) {
			return { id: col.header, name: col.header, type: col.type, width };
		}

		return {
			id: col.header,
			name: col.header,
			type: col.type,
			width,
			dropdown: {
				options: col.fillsIfBlank
					? catalogs[col.catalog].map((opt) => ({
							...opt,
							fillsIfBlank: Object.fromEntries(col.fillsIfBlank!.map((h) => [h, opt.value]))
						}))
					: [...catalogs[col.catalog]],
				// User-typed values are explicit user input, which the spec permits.
				// This is a table-editing affordance only; AI output can never add an option.
				allowCustom: true,
				...(col.dependsOn ? { dependsOnColumnId: col.dependsOn } : {})
			}
		};
	});
}
