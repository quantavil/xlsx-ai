import { describe, it, expect } from 'bun:test';
import { deriveRows, findExchangeRate, stateCodeFromGstin } from '../../src/lib/modules/icegrid/derive';
import {
	lookupDrawback,
	lookupRodtep,
	uqcToUnit
} from '../../src/lib/modules/icegrid/catalogs/generated/schedules';
import { SCHEDULES_PROVENANCE } from '../../src/lib/modules/icegrid/catalogs/generated/provenance';
import { getCatalogSnapshot } from '../../src/lib/modules/icegrid/catalogs';
import { parseProfile, EMPTY_PROFILE } from '../../src/lib/modules/icegrid/profile';
import { ICEGRID_HEADERS, ICEGRID_ALL_HEADERS } from '../../src/lib/modules/icegrid/columns';
import type { IcegridRow } from '../../src/lib/modules/icegrid/schema';

const catalogs = getCatalogSnapshot();
const row = (over: Partial<IcegridRow>): IcegridRow =>
	({ ...Object.fromEntries(ICEGRID_ALL_HEADERS.map((h) => [h, null])), ...over }) as unknown as IcegridRow;

/** Every RITC in the 17-shipment corpus, with the SQC unit its output carried. */
const CORPUS_SQC: Record<string, string> = {
	'44219990': 'KGS', '46021990': 'KGS', '49011010': 'NOS', '68022190': 'KGS', '70099200': 'KGS',
	'70139900': 'KGS', '73209090': 'KGS', '73269099': 'KGS', '74198030': 'KGS', '76169990': 'KGS',
	'85051110': 'KGS', '87089900': 'KGS', '91059990': 'NOS', '94032090': 'KGS', '94038900': 'NOS',
	'94051900': 'NOS', '94052900': 'NOS', '94054900': 'NOS', '94055000': 'NOS', '95051000': 'KGS'
};

/** Drawback serial and All Industry Rate the corpus carried, per RITC. */
const CORPUS_DBK: Record<string, [string, number]> = {
	'46021990': ['4602B', 1.2], '68022190': ['680299B', 1], '70099200': ['700999B', 1.2],
	'70139900': ['701399B', 1.2], '73209090': ['7320B', 1.5], '73269099': ['732699B', 1.5],
	'76169990': ['761699B', 1.2], '85051110': ['8505B', 1.7], '87089900': ['870899B', 2],
	'91059990': ['9105B', 1.2], '94032090': ['940399B', 1.2], '94038900': ['940399B', 1.2],
	'95051000': ['9505B', 1.2]
};

describe('customs schedule lookups', () => {
	it('records the notification and effective date of each snapshot', () => {
		expect(SCHEDULES_PROVENANCE.drawback.notification).toContain('77/2023');
		expect(SCHEDULES_PROVENANCE.rodtep.effectiveFrom).toBe('2024-10-10');
		expect(SCHEDULES_PROVENANCE.drawback.entryCount).toBeGreaterThan(2000);
		expect(SCHEDULES_PROVENANCE.rodtep.entryCount).toBeGreaterThan(8000);
	});

	it('derives SQCUnit from the RoDTEP UQC for every corpus RITC', () => {
		for (const [ritc, expected] of Object.entries(CORPUS_SQC)) {
			const entry = lookupRodtep(ritc);
			expect(entry, ritc).not.toBeNull();
			expect(uqcToUnit(entry!.uqc), ritc).toBe(expected);
		}
	});

	it('derives the drawback serial and rate for every corpus RITC', () => {
		for (const [ritc, [schno, rate]] of Object.entries(CORPUS_DBK)) {
			const entry = lookupDrawback(ritc);
			expect(entry, ritc).not.toBeNull();
			expect(entry!.schno, ritc).toBe(schno);
			expect(entry!.rate, ritc).toBeCloseTo(rate, 6);
		}
	});

	it('flags a residual "Others" match and offers the alternatives', () => {
		// 94038900 has no schedule line of its own; it lands on the heading residual.
		const entry = lookupDrawback('94038900')!;
		expect(entry.schno).toBe('940399B');
		expect(entry.residual).toBe(true);
		expect(entry.alternatives.length).toBeGreaterThan(0);
		expect(entry.alternatives.every((a) => a.startsWith('9403'))).toBe(true);
	});

	it('returns null rather than guessing for an unknown or short code', () => {
		expect(lookupRodtep('123')).toBeNull();
		expect(lookupRodtep('00000000')).toBeNull();
		expect(lookupDrawback('')).toBeNull();
		expect(uqcToUnit('furlong')).toBeNull();
	});
});

describe('stateCodeFromGstin', () => {
	it('reads the state code off a GSTIN', () => {
		expect(stateCodeFromGstin('GSTIN 09AALFG9236H1ZZ here')).toBe('09');
		expect(stateCodeFromGstin('06AAACR1084L1ZC')).toBe('06');
		expect(stateCodeFromGstin('02AAACC0003E1ZX')).toBe('02');
	});

	it('returns null when no GSTIN is present', () => {
		expect(stateCodeFromGstin('no identifiers here at all')).toBeNull();
		expect(stateCodeFromGstin('09AALFG')).toBeNull();
	});
});

describe('findExchangeRate', () => {
	it('reads a printed customs exchange rate', () => {
		expect(findExchangeRate('EXCHANGE RATE : 93.60')).toBe(93.6);
		expect(findExchangeRate('Conversion rate 92.50 INR')).toBe(92.5);
	});

	it('ignores values outside a plausible INR band and missing rates', () => {
		expect(findExchangeRate('EXCHANGE RATE : 1.05')).toBeNull();
		expect(findExchangeRate('EXCHANGE RATE : 99999')).toBeNull();
		expect(findExchangeRate('no rate printed')).toBeNull();
	});
});

describe('deriveRows', () => {
	const base = { RITCCode: '94038900', Quantity: 48, QuantityUnit: 'PCS', InvoiceNo: 'INV-A' };

	it('fills the schedule-backed fields from the RITC', () => {
		const { rows, provenance } = deriveRows([row(base)], { catalogs });
		expect(rows[0].SQCUnit).toBe('NOS');
		expect(rows[0].RODTEP).toBe('Yes');
		expect(rows[0].drawback_schno).toBe('940399B');
		expect(rows[0].dbk_rate).toBe(1.2);
		expect(provenance.r1.SQCUnit).toBe('schedule');
	});

	it('applies the corpus-confirmed copy rules', () => {
		const { rows, provenance } = deriveRows([row(base)], { catalogs });
		expect(rows[0].PerUnit).toBe('PCS');
		expect(rows[0].dbk_unit).toBe('PCS');
		expect(rows[0].dbk_qty).toBe(48);
		expect(provenance.r1.PerUnit).toBe('derived');
	});

	describe('SQCQTY follows the SQC unit, never the invoiced one', () => {
		// 68022190 is counted in KGS, 94038900 in NOS. The schedule sets SQCUnit, so
		// each case is chosen by RITC rather than by writing SQCUnit directly.
		const derive = (over: Partial<IcegridRow>) =>
			deriveRows([row({ ...base, ...over })], { catalogs }).rows[0];

		it('takes the line net weight when the tariff counts in KGS', () => {
			const out = derive({ RITCCode: '68022190', NetWeight: 312.5 });
			expect(out.SQCUnit).toBe('KGS');
			expect(out.SQCQTY).toBe(312.5);
			// Never the invoiced count, which is in a different unit entirely.
			expect(out.Quantity).toBe(48);
		});

		it('leaves it blank when the tariff counts in KGS and no net weight was found', () => {
			const { rows, warnings } = deriveRows([row({ ...base, RITCCode: '68022190' })], { catalogs });
			expect(rows[0].SQCQTY).toBeNull();
			expect(warnings.some((w) => w.includes('no per-line net weight'))).toBe(true);
		});

		it('takes the invoiced quantity for any other stated unit', () => {
			// 94038900 is NOS while the invoice is PCS: the units need not agree, because
			// SQCQTY is a count either way and the tariff's unit is the one declared.
			expect(derive({}).SQCQTY).toBe(48);
			expect(derive({}).RoDTEPQty).toBe(48);
		});

		it('writes nothing when the tariff item is absent from the schedule', () => {
			// No SQCUnit means no unit to declare a quantity in.
			const out = derive({ RITCCode: '99999999', NetWeight: 312.5 });
			expect(out.SQCUnit).toBeNull();
			expect(out.SQCQTY).toBeNull();
		});

		it('never overwrites an SQCQTY the documents stated', () => {
			expect(derive({ RITCCode: '68022190', NetWeight: 312.5, SQCQTY: 9 }).SQCQTY).toBe(9);
		});
	});

	it('tracks RoDTEPQty to SQCQTY, never to Quantity', () => {
		const { rows } = deriveRows([row({ ...base, SQCQTY: 67.5 })], { catalogs });
		expect(rows[0].RoDTEPQty).toBe(67.5);
		expect(rows[0].Quantity).toBe(48);
	});

	it('derives StateOrigin from a GSTIN in the source text', () => {
		const { rows, provenance } = deriveRows([row(base)], {
			catalogs,
			sourceText: 'Exporter GSTIN 09AALFG9236H1ZZ'
		});
		expect(rows[0].StateOrigin).toBe('09');
		expect(provenance.r1.StateOrigin).toBe('derived');
	});

	it('zeroes the tax fields under LUT and computes them when IGST is paid', () => {
		const lut = deriveRows([row({ ...base, IGST_PaymentStatus: 'LUT', ProductAmount: 1440, IGST_Rate: 18 })], { catalogs });
		expect([lut.rows[0].IGST_Rate, lut.rows[0].Taxable_Value, lut.rows[0].IGST_Amount]).toEqual([0, 0, 0]);
		expect(lut.warnings.some((w) => w.includes('IGST payment status is LUT') && w.includes('IGST_Rate: 18'))).toBe(true);

		const paid = deriveRows([row({ ...base, IGST_PaymentStatus: 'P', ProductAmount: 1025, IGST_Rate: 18 })], {
			catalogs,
			exchangeRate: 92.5
		});
		// The corpus row: 1025 * 92.5 = 94812.50, IGST 18% = 17066.25.
		expect(paid.rows[0].Taxable_Value).toBe(94812.5);
		expect(paid.rows[0].IGST_Amount).toBe(17066.25);
	});

	it('leaves Taxable_Value blank and warns when no exchange rate is available', () => {
		const { rows, warnings } = deriveRows(
			[row({ ...base, IGST_PaymentStatus: 'P', ProductAmount: 1025 })],
			{ catalogs }
		);
		expect(rows[0].Taxable_Value).toBeNull();
		expect(warnings.some((w) => w.includes('no exchange rate'))).toBe(true);
	});

	it('fills the exporter constants from the profile and marks them', () => {
		const profile = parseProfile({ endUse: 'GNX100', ftaCode: 'NCPTI', rewardItem: 'Yes' });
		const { rows, provenance } = deriveRows([row(base)], { catalogs, profile });
		expect(rows[0].EndUse).toBe('GNX100');
		expect(rows[0].FTACode).toBe('NCPTI');
		expect(rows[0].RewardItem).toBe('Yes');
		expect(provenance.r1.EndUse).toBe('profile');
	});

	it('never overwrites a value the document supported', () => {
		const { rows, provenance } = deriveRows(
			[row({ ...base, SQCUnit: 'KGS', PerUnit: 'SET', RODTEP: 'No' })],
			{ catalogs, profile: parseProfile({ endUse: 'GNX200' }) }
		);
		expect(rows[0].SQCUnit).toBe('KGS');
		expect(rows[0].PerUnit).toBe('SET');
		expect(rows[0].RODTEP).toBe('No');
		expect(provenance.r1.SQCUnit).toBe('extracted');
	});

	it('clears a profile value that is not a catalog value', () => {
		const { rows, warnings } = deriveRows([row(base)], {
			catalogs,
			profile: parseProfile({ endUse: 'NOT-A-CODE' })
		});
		expect(rows[0].EndUse).toBeNull();
		expect(warnings.some((w) => w.includes('EndUse'))).toBe(true);
	});

	it('warns that schedule values carry a notification date', () => {
		const { warnings } = deriveRows([row(base)], { catalogs });
		expect(warnings.some((w) => w.includes('77/2023'))).toBe(true);
	});

	it('counts what each route filled', () => {
		const { filled } = deriveRows([row(base)], {
			catalogs,
			profile: parseProfile({ endUse: 'GNX100' })
		});
		expect(filled.extracted).toBe(4);
		expect(filled.schedule).toBeGreaterThan(0);
		expect(filled.derived).toBeGreaterThan(0);
		expect(filled.profile).toBe(1);
	});
});

describe('profile persistence', () => {
	it('falls back to an empty profile on malformed input', () => {
		for (const bad of ['not json', '{', null, 42, { endUse: 12345 }]) {
			expect(parseProfile(bad)).toEqual(EMPTY_PROFILE);
		}
	});

	it('round-trips a valid profile', () => {
		const p = parseProfile(JSON.stringify({ endUse: 'GNX100', rewardItem: 'Yes' }));
		expect(p.endUse).toBe('GNX100');
		expect(p.rewardItem).toBe('Yes');
		expect(p.ftaCode).toBeNull();
	});

	it('drops the per-consignment fields the confirmation dialog now owns', () => {
		const p = parseProfile({ endUse: 'GNX100', stateOrigin: '08', exchangeRate: 92.5 });
		expect(p).toEqual({ ...EMPTY_PROFILE, endUse: 'GNX100' });
	});
});
