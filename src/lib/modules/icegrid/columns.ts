import type { Column, ColumnType } from '$lib/types';

export interface IcegridColumnSpec {
	id: string;
	header: string;
	type: ColumnType;
	description: string;
	required?: boolean;
	defaultValue?: string | number | null;
}

export const ICEGRID_COLUMNS: readonly IcegridColumnSpec[] = [
	{ id: 'invoiceSNo', header: 'InvoiceSNo', type: 'number', description: 'Sequential invoice sequence number (1, 2, ...)', required: true, defaultValue: 1 },
	{ id: 'itemSNo', header: 'ItemSNo', type: 'number', description: 'Item sequence number within the invoice (1, 2, ...)', required: true },
	{ id: 'invoiceNo', header: 'InvoiceNo', type: 'text', description: 'Commercial invoice number', required: true },
	{ id: 'description', header: 'Description', type: 'text', description: 'Item description of goods', required: true },
	{ id: 'endUse', header: 'EndUse', type: 'text', description: 'End use code or description' },
	{ id: 'hawblNo', header: 'HAWBL_No', type: 'text', description: 'House Airway Bill / Bill of Lading number' },
	{ id: 'totalPackage', header: 'Total_Package', type: 'number', description: 'Total number of packages or cartons' },
	{ id: 'accessories', header: 'Accessories', type: 'text', description: 'Accessories inclusion indicator or notes' },
	{ id: 'rewardItem', header: 'RewardItem', type: 'text', description: 'Reward / RoDTEP scheme eligibility (e.g. Y/N)' },
	{ id: 'igstPaymentStatus', header: 'IGST_PaymentStatus', type: 'text', description: 'IGST payment status code (e.g. LUT, P, NP)' },
	{ id: 'ritcCode', header: 'RITCCode', type: 'text', description: '8-digit Indian Customs Harmonized Tariff code (HS/ITC)' },
	{ id: 'applicableExpSchemes', header: 'ApplicableExpSchemes', type: 'text', description: 'Applicable export schemes (e.g. EPCG, Advance Auth, EOU)' },
	{ id: 'quantity', header: 'Quantity', type: 'number', description: 'Item quantity invoiced', required: true },
	{ id: 'quantityUnit', header: 'QuantityUnit', type: 'text', description: 'Unit of measurement (e.g. PCS, NOS, KGS, MTR)', required: true },
	{ id: 'sqcQty', header: 'SQCQTY', type: 'number', description: 'Standard Quantity Code quantity' },
	{ id: 'sqcUnit', header: 'SQCUnit', type: 'text', description: 'Standard Quantity Code unit' },
	{ id: 'unitPrice', header: 'UnitPrice', type: 'currency', description: 'Price per unit', required: true },
	{ id: 'productAmount', header: 'ProductAmount', type: 'currency', description: 'Total item amount (Quantity * UnitPrice)', required: true },
	{ id: 'per', header: 'Per', type: 'number', description: 'Per unit denominator multiplier', defaultValue: 1 },
	{ id: 'perUnit', header: 'PerUnit', type: 'text', description: 'Unit for price calculation denominator' },
	{ id: 'drawbackSchNo', header: 'drawback_schno', type: 'text', description: 'Duty drawback tariff schedule number' },
	{ id: 'dbkQty', header: 'dbk_qty', type: 'number', description: 'Drawback eligible quantity' },
	{ id: 'dbkRate', header: 'dbk_rate', type: 'number', description: 'Duty drawback rate percentage or specific rate' },
	{ id: 'dbkUnit', header: 'dbk_unit', type: 'text', description: 'Drawback specific unit' },
	{ id: 'dbkDesc', header: 'dbk_desc', type: 'text', description: 'Duty drawback description' },
	{ id: 'roslRate', header: 'ROSLRate', type: 'number', description: 'RoSCTL rate percentage' },
	{ id: 'roslCapValue', header: 'ROSLCapValue', type: 'number', description: 'RoSCTL maximum cap value' },
	{ id: 'countryDestination', header: 'CountryDestination', type: 'text', description: 'Country of final destination (ISO code or name)' },
	{ id: 'ftaCode', header: 'FTACode', type: 'text', description: 'Free Trade Agreement preference code' },
	{ id: 'stateOrigin', header: 'StateOrigin', type: 'text', description: 'State of origin of goods' },
	{ id: 'districtOrigin', header: 'DistrictOrigin', type: 'text', description: 'District of origin' },
	{ id: 'taxableValue', header: 'Taxable_Value', type: 'currency', description: 'Assessable taxable value for GST calculation' },
	{ id: 'igstRate', header: 'IGST_Rate', type: 'percent', description: 'IGST tax rate percentage (e.g. 5, 12, 18, 28)' },
	{ id: 'igstAmount', header: 'IGST_Amount', type: 'currency', description: 'IGST tax amount' },
	{ id: 'gstCessAmount', header: 'GSTCCessAmount', type: 'currency', description: 'GST compensation cess amount' },
	{ id: 'rodtep', header: 'RODTEP', type: 'text', description: 'RoDTEP rate or code' },
	{ id: 'rodtepQty', header: 'RoDTEPQty', type: 'number', description: 'RoDTEP eligible quantity' }
];

export const ICEGRID_HEADERS = ICEGRID_COLUMNS.map((c) => c.header);

export function buildIcegridTableColumns(): Column[] {
	return ICEGRID_COLUMNS.map((col) => ({
		id: col.header,
		name: col.header,
		type: col.type,
		width: col.type === 'currency' || col.type === 'percent' ? 140 : col.id === 'description' ? 240 : 130
	}));
}
