import { describe, it, expect } from 'bun:test';
import {
	isDrawbackScheme,
	isFreeShippingBill,
	applySchemeRules,
	DRAWBACK_SCHEME_CODES
} from '../../src/lib/modules/icegrid/rules/scheme';
import {
	deriveSqcQty,
	deriveDbkQty,
	deriveRodtepQty,
	applyQuantityRules
} from '../../src/lib/modules/icegrid/rules/quantity';
import {
	scanSellerOrigin,
	scanCountryDestination
} from '../../src/lib/modules/icegrid/rules/geo';
import { applyTaxRules } from '../../src/lib/modules/icegrid/rules/tax';
import { applyMechanicalRules } from '../../src/lib/modules/icegrid/rules/mechanical';
import { getCatalogSnapshot } from '../../src/lib/modules/icegrid/catalogs';
import type { IcegridRow } from '../../src/lib/modules/icegrid/schema';

const catalogs = getCatalogSnapshot();

const makeRow = (over: Partial<IcegridRow> = {}): IcegridRow =>
	({
		InvoiceSNo: null,
		ItemSNo: null,
		InvoiceNo: 'INV-1',
		Description: 'Sample Item',
		EndUse: null,
		HAWBL_No: null,
		Total_Package: null,
		Accessories: null,
		RewardItem: null,
		IGST_PaymentStatus: null,
		RITCCode: '94038900',
		ApplicableExpSchemes: '19-Drawback (DBK)',
		Quantity: 50,
		QuantityUnit: 'PCS',
		SQCQTY: null,
		SQCUnit: 'NOS',
		NetWeight: null,
		UnitPrice: 10,
		ProductAmount: 500,
		Per: 1,
		PerUnit: 'PCS',
		drawback_schno: '940399B',
		dbk_qty: null,
		dbk_rate: 1.2,
		dbk_unit: 'PCS',
		dbk_desc: 'Sample DBK',
		ROSLRate: null,
		ROSLCapValue: null,
		CountryDestination: null,
		FTACode: null,
		StateOrigin: null,
		DistrictOrigin: null,
		Taxable_Value: null,
		IGST_Rate: null,
		IGST_Amount: null,
		GSTCCessAmount: null,
		RODTEP: null,
		RoDTEPQty: null,
		...over
	}) as IcegridRow;

describe('ICEGrid Rules - Scheme and Incentive Eligibility', () => {
	it('recognizes all 21 drawback scheme codes', () => {
		const expectedCodes = [
			'19', '41', '42', '43', '44', '46', '47', '48', '49',
			'60', '61', '62', '63', '64', '65', '71', '72', '73',
			'74', '75', '79'
		];
		expect(DRAWBACK_SCHEME_CODES.size).toBe(21);
		for (const code of expectedCodes) {
			expect(isDrawbackScheme(code)).toBe(true);
			expect(isDrawbackScheme(`${code}-Some Description`)).toBe(true);
		}
		expect(isDrawbackScheme('00-Free Shipping bill ')).toBe(false);
		expect(isDrawbackScheme('01-Advance Licence')).toBe(false);
		expect(isDrawbackScheme(null)).toBe(false);
	});

	it('identifies Free Shipping Bill (00)', () => {
		expect(isFreeShippingBill('00-Free Shipping bill ')).toBe(true);
		expect(isFreeShippingBill('00')).toBe(true);
		expect(isFreeShippingBill('19')).toBe(false);
	});

	it('applies Scheme 00 rules as non-drawback: blanks Drawback and preserves selected RewardItem/RoDTEP', () => {
		const row = makeRow({ ApplicableExpSchemes: '00-Free Shipping bill ', RewardItem: 'Yes' });
		applySchemeRules(row, true, false);

		expect(row.RewardItem).toBe('Yes');
		expect(row.RODTEP).toBe('Yes');
		expect(row.drawback_schno).toBeNull();
		expect(row.dbk_qty).toBeNull();
		expect(row.dbk_rate).toBeNull();
		expect(row.dbk_unit).toBeNull();
	});

	it('applies Scheme 00 rules: RoDTEP=N/A if not found in schedule', () => {
		const row = makeRow({ ApplicableExpSchemes: '00', RewardItem: 'Yes' });
		applySchemeRules(row, false, false);

		expect(row.RewardItem).toBe('Yes');
		expect(row.RODTEP).toBe('N/A');
		expect(row.drawback_schno).toBeNull();
	});

	it('clears drawback for non-drawback schemes and sets RoDTEP=Yes if eligible', () => {
		const row = makeRow({ ApplicableExpSchemes: '21-EOU/EPZ/SEZ' });
		applySchemeRules(row, true, false);

		expect(row.RODTEP).toBe('Yes');
		expect(row.drawback_schno).toBeNull();
		expect(row.dbk_qty).toBeNull();
		expect(row.dbk_rate).toBeNull();
		expect(row.dbk_unit).toBeNull();
	});
});

describe('ICEGrid Rules - Quantity and Formulas', () => {
	it('Rule 1: SQCQTY uses =M{row} when SQCUnit is NOS or matches QuantityUnit', () => {
		// SQCUnit NOS, QuantityUnit PCS -> =M2
		expect(deriveSqcQty('NOS', 'PCS', 50, null, 2)).toBe('=M2');
		// SQCUnit KGS, QuantityUnit KGS -> =M3 (matches)
		expect(deriveSqcQty('KGS', 'KGS', 50, 42.5, 3)).toBe('=M3');
		// SQCUnit KGS, QuantityUnit PCS -> NetWeight (no match, not NOS)
		expect(deriveSqcQty('KGS', 'PCS', 50, 42.5, 4)).toBe(42.5);
		// SQCUnit MTR, QuantityUnit PCS -> Quantity
		expect(deriveSqcQty('MTR', 'PCS', 50, null, 5)).toBe(50);
		// Blank SQCUnit -> null
		expect(deriveSqcQty(null, 'PCS', 50, null, 6)).toBeNull();
	});

	it('Rule 4: dbk_qty uses =O{row} when dbk_unit matches SQCUnit, or =M{row} when dbk_unit matches QuantityUnit or is empty', () => {
		// Matching SQCUnit on drawback scheme -> =O2
		expect(deriveDbkQty('NOS', 'NOS', 'PCS', 50, 2, true)).toBe('=O2');
		expect(deriveDbkQty('KGS', 'KGS', 'PCS', 50, 3, true)).toBe('=O3');
		// Matching QuantityUnit (when SQCUnit does not match) -> =M4
		expect(deriveDbkQty('PCS', 'NOS', 'PCS', 50, 4, true)).toBe('=M4');
		// Empty dbk_unit on drawback scheme -> =M{row}
		expect(deriveDbkQty(null, 'NOS', 'PCS', 50, 4, true)).toBe('=M4');
		expect(deriveDbkQty('', 'NOS', 'PCS', 50, 4, true)).toBe('=M4');
		expect(deriveDbkQty(undefined, 'NOS', 'PCS', 50, 4, true)).toBe('=M4');
		expect(deriveDbkQty('   ', 'NOS', 'PCS', 50, 4, true)).toBe('=M4');
		// Empty dbk_unit when SQCUnit is also NOS -> =M{row}
		expect(deriveDbkQty(null, 'NOS', 'NOS', 50, 4, true)).toBe('=M4');
		// Mismatched both units on drawback scheme -> Quantity
		expect(deriveDbkQty('MTR', 'NOS', 'PCS', 50, 4, true)).toBe(50);
		// Non-drawback scheme -> null
		expect(deriveDbkQty('NOS', 'NOS', 'NOS', 50, 5, false)).toBeNull();
		expect(deriveDbkQty(null, 'NOS', 'NOS', 50, 5, false)).toBeNull();
	});

	it('RoDTEPQty uses =O{row} when RoDTEP is Yes', () => {
		expect(deriveRodtepQty('Yes', 2)).toBe('=O2');
		expect(deriveRodtepQty('No', 2)).toBeNull();
		expect(deriveRodtepQty('N/A', 2)).toBeNull();
	});

	it('applyQuantityRules copies QuantityUnit into empty dbk_unit and applies formulas', () => {
		const row = makeRow({
			SQCUnit: 'KGS',
			QuantityUnit: 'PCS',
			Quantity: 100,
			dbk_unit: null,
			RODTEP: 'Yes'
		});

		applyQuantityRules(row, 2, true);

		// dbk_unit fell back to QuantityUnit
		expect(row.dbk_unit).toBe('PCS');
		// dbk_unit (PCS) matches QuantityUnit (PCS) -> =M2
		expect(row.dbk_qty).toBe('=M2');
		// RoDTEPQty tracks SQCQTY (=O2)
		expect(row.RoDTEPQty).toBe('=O2');
	});

	it('applyQuantityRules applies =O{row} when dbk_unit matches SQCUnit', () => {
		const row = makeRow({
			SQCUnit: 'NOS',
			QuantityUnit: 'PCS',
			Quantity: 100,
			dbk_unit: 'NOS',
			RODTEP: 'Yes'
		});

		applyQuantityRules(row, 2, true);

		expect(row.SQCQTY).toBe('=M2');
		expect(row.dbk_qty).toBe('=O2');
		expect(row.RoDTEPQty).toBe('=O2');
	});

	it('applyQuantityRules applies =M{row} when dbk_unit is initially empty even if SQCUnit matches QuantityUnit', () => {
		const row = makeRow({
			SQCUnit: 'NOS',
			QuantityUnit: 'NOS',
			Quantity: 100,
			dbk_unit: null,
			RODTEP: 'Yes'
		});

		applyQuantityRules(row, 2, true);

		expect(row.dbk_unit).toBe('NOS');
		expect(row.dbk_qty).toBe('=M2');
	});
});

describe('ICEGrid Rules - Geography Parsing', () => {
	it('Rule 5: parses State and District from seller address', () => {
		const source = `
			EXPORTER / SELLER:
			ACME EXPORTS INDIA PVT LTD
			F-120, SITAPURA INDUSTRIAL AREA, JAIPUR, RAJASTHAN - 302022
			GSTIN: 08AABCA1234F1Z5
		`;
		const res = scanSellerOrigin(source, catalogs);
		expect(res.stateCode).toBe('08');
		// Jaipur is district in Rajasthan (08)
		expect(res.districtCode).toBeTruthy();
	});

	it('Rule 5: parses State name if GSTIN is absent, then resolves district', () => {
		const source = `
			MANUFACTURER / EXPORTER:
			HERITAGE HANDICRAFTS
			RAMPUR ROAD, MORADABAD, UTTAR PRADESH, INDIA
		`;
		const res = scanSellerOrigin(source, catalogs);
		expect(res.stateCode).toBe('09'); // Uttar Pradesh
		expect(res.districtCode).toBeTruthy();
	});

	it('Rule 6: parses Country Destination via 3-tier hierarchy', () => {
		// Tier 1: Final Destination
		const t1 = 'Country of Final Destination: UNITED STATES OF AMERICA\nPort of Discharge: HAMBURG';
		expect(scanCountryDestination(t1, catalogs)).toBe('US');

		// Tier 2: Port of Discharge when Final Destination is absent
		const t2 = 'Port of Discharge: JEBEL ALI, UAE\nConsignee: Global Ltd';
		expect(scanCountryDestination(t2, catalogs)).toBe('AE');

		// Tier 3: Consignee Country when 1 and 2 are absent
		const t3 = 'Buyer / Consignee:\nAcme Germany GmbH\nBerliner Str 10, Berlin, GERMANY';
		expect(scanCountryDestination(t3, catalogs)).toBe('DE');
	});
});

describe('ICEGrid Rules - Tax Arithmetic and Mechanical Serials', () => {
	it('zeroes tax values under LUT and warns if non-zero values were present', () => {
		const row = makeRow({
			IGST_PaymentStatus: 'LUT',
			Taxable_Value: 1000,
			IGST_Rate: 18,
			IGST_Amount: 180
		});
		const res = applyTaxRules(row, 92.5, 'Row 1');
		expect(row.Taxable_Value).toBe(0);
		expect(row.IGST_Rate).toBe(0);
		expect(row.IGST_Amount).toBe(0);
		expect(res.warnings.length).toBe(1);
	});

	it('computes Taxable_Value and IGST_Amount when IGST is paid', () => {
		const row = makeRow({
			IGST_PaymentStatus: 'P',
			ProductAmount: 1000,
			IGST_Rate: 18
		});
		applyTaxRules(row, 90, 'Row 1');
		expect(row.Taxable_Value).toBe(90000);
		expect(row.IGST_Amount).toBe(16200);
	});

	it('assigns mechanical serials and blanks cleared headers', () => {
		const rows = applyMechanicalRules([
			makeRow({ InvoiceNo: 'INV-101', Accessories: 'Yes', Total_Package: 5 }),
			makeRow({ InvoiceNo: 'INV-101' }),
			makeRow({ InvoiceNo: 'INV-102' })
		]);

		expect(rows[0].InvoiceSNo).toBe(1);
		expect(rows[0].ItemSNo).toBe(1);
		expect(rows[0].Accessories).toBeNull();
		expect(rows[0].Total_Package).toBeNull();

		expect(rows[1].InvoiceSNo).toBe(1);
		expect(rows[1].ItemSNo).toBe(2);

		expect(rows[2].InvoiceSNo).toBe(2);
		expect(rows[2].ItemSNo).toBe(1);
	});
});
