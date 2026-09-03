import { describe, it, expect } from 'bun:test';
import {
	applyIcegridAnswers,
	buildConfirmInput,
	clearCodeDerived,
	defaultAnswers
} from '../../src/lib/modules/icegrid/confirm';
import {
	detectInvoiceCurrency,
	parseExchangeRates,
	rateFor
} from '../../src/lib/modules/icegrid/exchange-rate';
import { deriveRows } from '../../src/lib/modules/icegrid/derive';
import { getCatalogSnapshot } from '../../src/lib/modules/icegrid/catalogs';
import type { DutyLookupEntry } from '../../src/lib/modules/icegrid/duty-lookup';
import type { IcegridRow } from '../../src/lib/modules/icegrid/schema';

const catalogs = getCatalogSnapshot();

const row = (over: Partial<IcegridRow>): IcegridRow => ({ ...over }) as IcegridRow;

const BOARD = [
	{ CurrencyCode: 'USD', CurrencyName: 'US DOLLARS', Import: '90.10', Export: '88.35' },
	{ CurrencyCode: 'EUR', CurrencyName: 'EUROPIAN COMMON CURR', Import: '113.60', Export: '109.80' },
	{ CurrencyCode: 'INR', CurrencyName: 'INDIAN RUPEES', Import: '1.00', Export: '1.00' },
	// The board carries rows with no usable rate; they must not become options.
	{ CurrencyCode: 'XXX', CurrencyName: 'NOT A CURRENCY', Import: '', Export: '' },
	{ CurrencyCode: 'toolong', CurrencyName: 'JUNK', Import: '1', Export: '1' }
];

const LOOKUP: DutyLookupEntry = {
	ritc: '94038900',
	drawback: [
		{ serial: '940301', description: 'Others', rate: 1.5, cap: 12, unit: 'PCS', roslRate: null, roslCap: null },
		{ serial: '940302B', description: 'Of wood', rate: 2.2, cap: 20, unit: null, roslRate: 1, roslCap: 5 }
	],
	rodtep: { description: 'Furniture', rate: 1.4, cap: 8, uqc: 'KGS' }
};

describe('exchange rate board', () => {
	it('keeps only three-letter codes with a usable export rate', () => {
		expect(parseExchangeRates(BOARD).map((r) => r.code)).toEqual(['USD', 'EUR', 'INR']);
		expect(rateFor(parseExchangeRates(BOARD), 'USD')).toBe(88.35);
		expect(rateFor(parseExchangeRates(BOARD), 'GBP')).toBeNull();
		expect(parseExchangeRates('not an array')).toEqual([]);
	});

	it('takes the export column, never the import one', () => {
		expect(parseExchangeRates(BOARD)[0].exportRate).toBe(88.35);
	});

	it('reads the currency the documents print, ignoring the exporter own rupees', () => {
		const rates = parseExchangeRates(BOARD);
		// INR is all over an Indian exporter's letterhead and is never the answer.
		expect(detectInvoiceCurrency('GSTIN 09AALFG9236H1ZZ INR INR total USD 1,440.00', rates)).toBe('USD');
		expect(detectInvoiceCurrency('Amount EUR 900 EUR 100 USD 5', rates)).toBe('EUR');
		// A symbol only answers when no code was printed.
		expect(detectInvoiceCurrency('Total $ 1,440.00', rates)).toBe('USD');
		expect(detectInvoiceCurrency('48 PCS SET NET', rates)).toBeNull();
	});
});

describe('buildConfirmInput', () => {
	const rows = [
		row({ RITCCode: '94038900', Description: 'SIDE TABLE', drawback_schno: '940301', RODTEP: 'Yes', IGST_PaymentStatus: 'LUT', EndUse: 'GNX100' }),
		row({ RITCCode: '9403.89.00', Description: 'SIDE TABLE SMALL' }),
		row({ RITCCode: '91059990', Description: 'WALL CLOCK', IGST_Rate: 18 }),
		row({ Description: 'NO CODE' })
	];

	const input = buildConfirmInput(rows, {
		catalogs,
		lookups: new Map([['94038900', LOOKUP]]),
		rates: parseExchangeRates(BOARD),
		currency: 'USD',
		exchangeRate: 88.35
	});

	it('groups by the normalized tariff code, however it was printed', () => {
		expect(input.groups.map((g) => [g.key, g.rowCount])).toEqual([
			['94038900', 2],
			['91059990', 1]
		]);
	});

	it('sends a row with no filable code to the unclassified section instead', () => {
		expect(input.unclassified.map((i) => [i.printed, i.description, i.rowCount])).toEqual([
			['', 'NO CODE', 1]
		]);
	});

	it('treats a printed heading as needing a code, not as having one', () => {
		// `9403` narrows the answer; it is not an answer. Filing it would be rejected.
		const partial = buildConfirmInput(
			[
				row({ RITCCode: '9403', Description: 'SIDE TABLE' }),
				row({ RITCCode: '9403', Description: 'side table' }),
				row({ RITCCode: '940389', Description: 'WALL SHELF' })
			],
			{ catalogs }
		);
		expect(partial.groups).toEqual([]);
		// Same heading and same goods is one decision, asked once.
		expect(partial.unclassified.map((i) => [i.printed, i.rowCount])).toEqual([
			['9403', 2],
			['940389', 1]
		]);
	});

	it('carries the classifier candidates onto the item they were found for', () => {
		const classified = buildConfirmInput([row({ RITCCode: '9403', Description: 'SIDE TABLE' })], {
			catalogs,
			classifications: new Map([
				[
					'9403|side table',
					{
						key: '9403|side table',
						terms: ['wooden furniture'],
						candidates: [
							{ code: '94036000', description: 'Other wooden furniture', basis: 'prefix' as const, via: '9403' }
						]
					}
				]
			])
		});
		expect(classified.unclassified[0].candidates.map((c) => c.code)).toEqual(['94036000']);
		expect(classified.unclassified[0].terms).toEqual(['wooden furniture']);
	});

	it('carries the pipeline own answers in as the defaults', () => {
		const [furniture, clocks] = input.groups;
		expect(furniture.values).toEqual({
			drawback_schno: '940301',
			RODTEP: 'Yes',
			IGST_PaymentStatus: 'LUT',
			IGST_Rate: null
		});
		expect(clocks.values.IGST_Rate).toBe(18);
		expect(input.invoice.EndUse).toBe('GNX100');
	});

	it('offers a tariff code only its own drawback serials', () => {
		expect(input.groups[0].drawbackOptions.map((o) => o.value)).toEqual(['940301', '940302B']);
		expect(input.groups[1].drawbackOptions).toEqual([]);
	});

	it('keeps a serial the documents printed that the board never listed', () => {
		const printed = buildConfirmInput([row({ RITCCode: '94038900', drawback_schno: '940399X' })], {
			catalogs,
			lookups: new Map([['94038900', LOOKUP]])
		});
		expect(printed.groups[0].drawbackOptions.map((o) => o.value)).toEqual([
			'940399X',
			'940301',
			'940302B'
		]);
	});
});

describe('applyIcegridAnswers', () => {
	const raw = [
		row({ RITCCode: '94038900', ProductAmount: 1440, Quantity: 48, QuantityUnit: 'PCS' }),
		row({ RITCCode: '91059990', ProductAmount: 1000, Quantity: 12, QuantityUnit: 'PCS' })
	];

	const answers = {
		invoice: { RewardItem: 'Yes', StateOrigin: '08', DistrictOrigin: null, EndUse: 'GNX100', ApplicableExpSchemes: '19-Drawback (DBK)' },
		perRitc: {
			'94038900': { drawback_schno: '940302B', RODTEP: 'Yes', IGST_PaymentStatus: 'P', IGST_Rate: 18 },
			'91059990': { drawback_schno: null, RODTEP: 'No', IGST_PaymentStatus: 'LUT', IGST_Rate: null }
		},
		assignedRitc: {},
		perItem: {},
		currency: 'USD',
		exchangeRate: 88.35
	};

	it('applies each group answer only to its own rows', () => {
		const [furniture, clock] = applyIcegridAnswers(raw, answers);
		expect(furniture.drawback_schno).toBe('940302B');
		expect(furniture.IGST_PaymentStatus).toBe('P');
		expect(clock.IGST_PaymentStatus).toBe('LUT');
		expect(clock.RODTEP).toBe('No');
	});

	it('applies the invoice answers to every row', () => {
		for (const out of applyIcegridAnswers(raw, answers)) {
			expect(out.EndUse).toBe('GNX100');
			expect(out.StateOrigin).toBe('08');
			expect(out.ApplicableExpSchemes).toBe('19-Drawback (DBK)');
		}
	});

	it('forces Free Shipping Bill rules when scheme 00 is confirmed', () => {
		const freeAnswers = {
			...answers,
			invoice: { ...answers.invoice, ApplicableExpSchemes: '00-Free Shipping bill ' }
		};
		const { rows } = deriveRows(applyIcegridAnswers(raw, freeAnswers), {
			catalogs,
			lookups: new Map([['94038900', LOOKUP]]),
			exchangeRate: answers.exchangeRate
		});
		expect(rows[0].ApplicableExpSchemes).toBe('00-Free Shipping bill ');
		expect(rows[0].RewardItem).toBe('No');
		expect(rows[0].drawback_schno).toBeNull();
		expect(rows[0].dbk_qty).toBeNull();
	});

	it('leaves a blank answer alone rather than clearing what follows from it', () => {
		const [furniture, clock] = applyIcegridAnswers(raw, answers);
		expect(furniture.DistrictOrigin).toBeUndefined();
		// Nothing proposed a serial for the clock; the schedule still gets to fill it.
		expect(clock.drawback_schno).toBeUndefined();
	});

	it('lets a confirmed answer drive the derivation that follows it', () => {
		const { rows } = deriveRows(applyIcegridAnswers(raw, answers), {
			catalogs,
			lookups: new Map([['94038900', LOOKUP]]),
			exchangeRate: answers.exchangeRate
		});

		// The confirmed serial pulls its own rate and ROSL values, not the residual's.
		expect(rows[0].drawback_schno).toBe('940302B');
		expect(rows[0].dbk_rate).toBe(2.2);
		expect(rows[0].ROSLRate).toBe(1);
		// Paid IGST: taxable value is the product amount at the confirmed rate.
		expect(rows[0].Taxable_Value).toBe(round2(1440 * 88.35));
		expect(rows[0].IGST_Amount).toBe(round2((1440 * 88.35 * 18) / 100));
		// LUT zeroes the whole tax block on the other code.
		expect([rows[1].IGST_Rate, rows[1].Taxable_Value, rows[1].IGST_Amount]).toEqual([0, 0, 0]);
	});
});

describe('changing an assigned tariff code', () => {
	it('drops what the old code implied and keeps what the shipment decided', () => {
		// Picking one code then another used to leave the first code's drawback serial
		// in place, filing goods under one tariff line against another's claim.
		expect(
			clearCodeDerived({
				drawback_schno: '940301',
				RODTEP: 'Yes',
				IGST_PaymentStatus: 'LUT',
				IGST_Rate: 18
			})
		).toEqual({
			drawback_schno: null,
			RODTEP: null,
			IGST_PaymentStatus: 'LUT',
			IGST_Rate: 18
		});
	});

	it('nulls dependent drawback rates when drawback_schno changes so deriveRows refills them', () => {
		const rawRow = row({
			RITCCode: '94038900',
			drawback_schno: '940301',
			dbk_rate: 1.5,
			dbk_desc: 'Others',
			ROSLRate: null,
			ROSLCapValue: null,
			dbk_unit: 'PCS'
		});
		const customAnswers: ReturnType<typeof defaultAnswers> = {
			invoice: { RewardItem: null, StateOrigin: null, DistrictOrigin: null, EndUse: null, ApplicableExpSchemes: null },
			perRitc: {
				'94038900': {
					drawback_schno: '940302B',
					RODTEP: null,
					IGST_PaymentStatus: null,
					IGST_Rate: null
				}
			},
			assignedRitc: {},
			perItem: {},
			currency: null,
			exchangeRate: null
		};
		const [applied] = applyIcegridAnswers([rawRow], customAnswers);
		expect(applied.drawback_schno).toBe('940302B');
		expect(applied.dbk_rate).toBeNull();
		expect(applied.dbk_desc).toBeNull();
		expect(applied.dbk_unit).toBeNull();

		// deriveRows will now refill them from 940302B lookup
		const { rows } = deriveRows([applied], {
			catalogs,
			lookups: new Map([['94038900', LOOKUP]])
		});
		expect(rows[0].drawback_schno).toBe('940302B');
		expect(rows[0].dbk_rate).toBe(2.2);
		expect(rows[0].ROSLRate).toBe(1);
	});
});

describe('defaultAnswers', () => {
	it('is what a headless run confirms, unchanged', () => {
		const input = buildConfirmInput([row({ RITCCode: '94038900', RODTEP: 'Yes' })], {
			catalogs,
			currency: 'USD',
			exchangeRate: 88.35
		});
		expect(defaultAnswers(input)).toEqual({
			invoice: { RewardItem: null, StateOrigin: null, DistrictOrigin: null, EndUse: null, ApplicableExpSchemes: null },
			perRitc: {
				'94038900': {
					drawback_schno: null,
					RODTEP: 'Yes',
					IGST_PaymentStatus: null,
					IGST_Rate: null
				}
			},
			assignedRitc: {},
			perItem: {},
			currency: 'USD',
			exchangeRate: 88.35
		});
	});
});

const round2 = (n: number) => Math.round(n * 100) / 100;
