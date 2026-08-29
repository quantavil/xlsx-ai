import type { Column, ColumnType } from '$lib/types';
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
	/** Header of the column this dropdown filters against, e.g. district -> state. */
	dependsOn?: string;
}

export const ICEGRID_COLUMNS: readonly IcegridColumnSpec[] = [
	{ id: 'invoiceSNo', header: 'InvoiceSNo', type: 'number', description: 'Invoice sequence number, assigned by first appearance of each invoice number', required: true },
	{ id: 'itemSNo', header: 'ItemSNo', type: 'number', description: 'Item sequence number, restarting at 1 within each invoice', required: true },
	{ id: 'invoiceNo', header: 'InvoiceNo', type: 'text', description: 'Commercial invoice number', required: true },
	{ id: 'description', header: 'Description', type: 'text', description: 'Item description of goods', required: true },
	{ id: 'endUse', header: 'EndUse', type: 'dropdown', description: 'ICEGATE end-use code', catalog: 'endUse' },
	{ id: 'hawblNo', header: 'HAWBL_No', type: 'text', description: 'House Airway Bill / Bill of Lading number' },
	{ id: 'totalPackage', header: 'Total_Package', type: 'number', description: 'Total number of packages or cartons' },
	{ id: 'accessories', header: 'Accessories', type: 'text', description: 'Always blank on import; fill manually only if required' },
	{ id: 'rewardItem', header: 'RewardItem', type: 'dropdown', description: 'Reward scheme eligibility', catalog: 'rewardItem' },
	{ id: 'igstPaymentStatus', header: 'IGST_PaymentStatus', type: 'dropdown', description: 'IGST payment status', catalog: 'igstPaymentStatus' },
	{ id: 'ritcCode', header: 'RITCCode', type: 'text', description: '8-digit Indian Customs tariff code (RITC/ITC-HS)' },
	{ id: 'applicableExpSchemes', header: 'ApplicableExpSchemes', type: 'dropdown', description: 'Complete export scheme entry, e.g. 19-Drawback (DBK)', catalog: 'scheme' },
	{ id: 'quantity', header: 'Quantity', type: 'number', description: 'Item quantity invoiced', required: true },
	{ id: 'quantityUnit', header: 'QuantityUnit', type: 'dropdown', description: 'Unit of measurement', catalog: 'unit', required: true },
	{ id: 'sqcQty', header: 'SQCQTY', type: 'number', description: 'Standard Quantity Code quantity' },
	{ id: 'sqcUnit', header: 'SQCUnit', type: 'dropdown', description: 'Standard Quantity Code unit', catalog: 'unit' },
	{ id: 'unitPrice', header: 'UnitPrice', type: 'number', description: 'Price per unit', required: true },
	{ id: 'productAmount', header: 'ProductAmount', type: 'number', description: 'Total item amount as stated on the source document' },
	{ id: 'per', header: 'Per', type: 'number', description: 'Unit price denominator; defaults to 1' },
	{ id: 'perUnit', header: 'PerUnit', type: 'dropdown', description: 'Unit for the price denominator', catalog: 'unit' },
	{ id: 'drawbackSchNo', header: 'drawback_schno', type: 'text', description: 'Duty drawback schedule serial number' },
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

export const ICEGRID_HEADERS = ICEGRID_COLUMNS.map((c) => c.header);

/** Headers the module owns mechanically; AI values for these are always discarded. */
export const MECHANICAL_HEADERS = ['InvoiceSNo', 'ItemSNo', 'Per', 'Accessories'] as const;

export function buildIcegridTableColumns(
	catalogs: IcegridCatalogSnapshot = getCatalogSnapshot()
): Column[] {
	return ICEGRID_COLUMNS.map((col) => {
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

		if (!col.catalog) {
			return { id: col.header, name: col.header, type: col.type, width };
		}

		return {
			id: col.header,
			name: col.header,
			type: col.type,
			width,
			dropdown: {
				options: [...catalogs[col.catalog]],
				// User-typed values are explicit user input, which the spec permits.
				// This is a table-editing affordance only; AI output can never add an option.
				allowCustom: true,
				...(col.dependsOn ? { dependsOnColumnId: col.dependsOn } : {})
			}
		};
	});
}
