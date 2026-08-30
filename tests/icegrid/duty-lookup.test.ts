import { describe, it, expect } from 'bun:test';
import {
	buildDrawbackOptions,
	distinctRitcCodes,
	normalizeRitcCode,
	sameSerial,
	selectDrawbackSerial,
	type DutyDrawbackCandidate,
	type DutyLookupEntry
} from '../../src/lib/modules/icegrid/duty-lookup';
import { deriveRows } from '../../src/lib/modules/icegrid/derive';
import { getCatalogSnapshot } from '../../src/lib/modules/icegrid/catalogs';
import { ICEGRID_HEADERS } from '../../src/lib/modules/icegrid/columns';
import type { IcegridRow } from '../../src/lib/modules/icegrid/schema';

const candidate = (over: Partial<DutyDrawbackCandidate>): DutyDrawbackCandidate => ({
	serial: '940399B',
	description: 'Others',
	rate: 1.2,
	cap: null,
	unit: null,
	roslRate: null,
	roslCap: null,
	...over
});

// The three serials the live service returns for tariff heading 9403.
const FURNITURE: DutyDrawbackCandidate[] = [
	candidate({ serial: '9403B', description: 'Other furniture and parts thereof', rate: 0 }),
	candidate({ serial: '940399B', description: 'Others', rate: 1.2 }),
	candidate({ serial: '940301B', description: 'Predominantly of marble', rate: 2.2, cap: 236, unit: 'PCS' })
];

const blankRow = (over: Partial<IcegridRow> = {}): IcegridRow =>
	({ ...Object.fromEntries(ICEGRID_HEADERS.map((h) => [h, null])), ...over }) as unknown as IcegridRow;

const entry = (over: Partial<DutyLookupEntry>): DutyLookupEntry => ({
	ritc: '94032090',
	drawback: FURNITURE,
	rodtep: { description: 'Other', rate: 0.7, cap: null, uqc: 'KGS' },
	...over
});

const derive = (rows: IcegridRow[], entries: DutyLookupEntry[]) =>
	deriveRows(rows, {
		catalogs: getCatalogSnapshot(),
		lookups: new Map(entries.map((e) => [e.ritc, e]))
	});

describe('normalizeRitcCode', () => {
	it('keeps only digits, however the document punctuated the code', () => {
		expect(normalizeRitcCode('9403.20.90')).toBe('94032090');
		expect(normalizeRitcCode('HSN: 9403 2090')).toBe('94032090');
		expect(normalizeRitcCode(null)).toBe('');
	});
});

describe('sameSerial', () => {
	it('ignores case and surrounding space, and never matches a blank', () => {
		expect(sameSerial('940301B', ' 940301b ')).toBe(true);
		expect(sameSerial('940301B', '940399B')).toBe(false);
		expect(sameSerial(null, null)).toBe(false);
		expect(sameSerial('', '')).toBe(false);
	});
});

describe('distinctRitcCodes', () => {
	it('asks once per tariff code, not once per row', () => {
		expect(
			distinctRitcCodes([
				{ RITCCode: '94032090' },
				{ RITCCode: '9403.20.90' },
				{ RITCCode: '73181500' },
				{ RITCCode: null },
				{ RITCCode: '9403' } // too short for the service to answer
			])
		).toEqual(['94032090', '73181500']);
	});
});

describe('selectDrawbackSerial', () => {
	it('prefers a serial the documents printed over anything the service suggests', () => {
		expect(selectDrawbackSerial(FURNITURE, '940301B')).toEqual({
			serial: '940301B',
			basis: 'extracted'
		});
	});

	it('keeps a printed serial the service does not list rather than discarding it', () => {
		// A broker can be right when the third-party lookup is incomplete.
		expect(selectDrawbackSerial(FURNITURE, '940320B')).toEqual({
			serial: '940320B',
			basis: 'extracted'
		});
	});

	it('takes the only candidate without calling it a guess', () => {
		expect(selectDrawbackSerial([candidate({ serial: '7318B' })], null)).toEqual({
			serial: '7318B',
			basis: 'only-candidate'
		});
	});

	it('suggests the residual line, and says it is a suggestion, when several apply', () => {
		expect(selectDrawbackSerial(FURNITURE, null)).toEqual({
			serial: '940399B',
			basis: 'suggested'
		});
	});

	it('reports nothing when the service lists nothing', () => {
		expect(selectDrawbackSerial([], null)).toEqual({ serial: null, basis: 'none' });
	});
});

describe('buildDrawbackOptions', () => {
	it('tags every option with the tariff code it belongs to', () => {
		const options = buildDrawbackOptions(
			new Map([
				['94032090', entry({})],
				['73181500', entry({ ritc: '73181500', drawback: [candidate({ serial: '7318B' })] })]
			])
		);
		expect(options).toHaveLength(4);
		expect(options.filter((o) => o.parentValue === '94032090')).toHaveLength(3);
		// The grid prepends the value when it renders an option, so a label repeating
		// the serial printed `940301B — 940301B — Predominantly of marble`.
		expect(options.find((o) => o.value === '940301B')?.label).toBe('Predominantly of marble');
	});

	it('carries the whole payload the serial determines', () => {
		const options = buildDrawbackOptions(new Map([['94032090', entry({})]]));
		expect(options.find((o) => o.value === '940301B')?.fills).toEqual({
			dbk_rate: 2.2,
			dbk_desc: 'Predominantly of marble',
			ROSLRate: null,
			ROSLCapValue: null,
			dbk_unit: 'PCS'
		});
		// A serial the schedule gives no unit for defers to the invoiced unit, exactly as
		// `deriveRows` does at import - never to the unit the previous serial left behind.
		expect(options.find((o) => o.value === '9403B')?.fills?.dbk_unit).toEqual({
			from: 'QuantityUnit'
		});
	});
});

describe('deriveRows with a live duty lookup', () => {
	it('fills rate, description, cap unit and ROSL from the chosen serial', () => {
		const { rows, provenance } = derive(
			[blankRow({ RITCCode: '94032090', drawback_schno: '940301B', QuantityUnit: 'SET' })],
			[entry({})]
		);
		expect(rows[0].dbk_rate).toBe(2.2);
		expect(rows[0].dbk_desc).toBe('Predominantly of marble');
		// The schedule prescribes a unit for this serial, so it wins over the invoice unit.
		expect(rows[0].dbk_unit).toBe('PCS');
		expect(provenance.r1.dbk_rate).toBe('lookup');
	});

	it('falls back to the invoiced unit when the serial prescribes none', () => {
		const { rows } = derive(
			[blankRow({ RITCCode: '94032090', drawback_schno: '940399B', QuantityUnit: 'SET' })],
			[entry({})]
		);
		expect(rows[0].dbk_unit).toBe('SET');
	});

	it('suggests the residual serial and warns instead of asserting a classification', () => {
		const { rows, warnings } = derive([blankRow({ RITCCode: '94032090' })], [entry({})]);
		expect(rows[0].drawback_schno).toBe('940399B');
		expect(warnings.some((w) => w.toLowerCase().includes('drawback'))).toBe(true);
	});

	it('never overwrites a serial the documents printed', () => {
		const { rows, provenance } = derive(
			[blankRow({ RITCCode: '94032090', drawback_schno: '9403B' })],
			[entry({})]
		);
		expect(rows[0].drawback_schno).toBe('9403B');
		expect(provenance.r1.drawback_schno).toBe('extracted');
		expect(rows[0].dbk_rate).toBe(0);
	});

	it('leaves the dependent fields blank and warns on a serial the service does not list', () => {
		const { rows, warnings } = derive(
			[blankRow({ RITCCode: '94032090', drawback_schno: '940320B' })],
			[entry({})]
		);
		expect(rows[0].dbk_rate).toBeNull();
		expect(rows[0].dbk_desc).toBeNull();
		expect(warnings.some((w) => w.includes('940320B'))).toBe(true);
	});

	it('marks RODTEP N/A when the tariff item is absent from the schedule', () => {
		// Absent is not the same as refused: "No" would claim the exporter declined.
		const { rows } = derive(
			[blankRow({ RITCCode: '94032090' })],
			[entry({ rodtep: null })]
		);
		expect(rows[0].RODTEP).toBe('N/A');
		expect(rows[0].RoDTEPQty).toBeNull();
	});

	it('keeps an invoice-declared No, which only the documents can know', () => {
		const { rows, provenance } = derive(
			[blankRow({ RITCCode: '94032090', RODTEP: 'No' })],
			[entry({})]
		);
		expect(rows[0].RODTEP).toBe('No');
		expect(provenance.r1.RODTEP).toBe('extracted');
	});

	it('takes SQCUnit from the RoDTEP statistical unit', () => {
		const { rows } = derive([blankRow({ RITCCode: '94032090' })], [entry({})]);
		expect(rows[0].SQCUnit).toBe('KGS');
	});

	it('falls back to the bundled schedule when no lookup arrived for the code', () => {
		const { rows, provenance } = derive([blankRow({ RITCCode: '94038900' })], []);
		expect(rows[0].drawback_schno).toBe('940399B');
		expect(provenance.r1.drawback_schno).toBe('schedule');
	});
});
