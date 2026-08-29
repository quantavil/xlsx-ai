import { describe, it, expect } from 'bun:test';
import {
	getCatalogSnapshot,
	resolveCatalogValue,
	normalizeStateKey,
	displayString,
	UNIT_OPTIONS,
	SCHEME_OPTIONS,
	END_USE_OPTIONS,
	IGST_PAYMENT_STATUS_OPTIONS,
	REWARD_ITEM_OPTIONS,
	RODTEP_OPTIONS,
	FTA_OPTIONS,
	STATE_OPTIONS,
	COUNTRY_OPTIONS,
	DISTRICT_OPTIONS
} from '../../src/lib/modules/icegrid/catalogs';

const EM_DASH = '—';

describe('ICEGrid catalog shape', () => {
	it('stores 70 unique quantity units with the duplicate RLS removed', () => {
		expect(UNIT_OPTIONS).toHaveLength(70);
		expect(UNIT_OPTIONS.filter((o) => o.value === 'RLS')).toHaveLength(1);
		expect(UNIT_OPTIONS.map((o) => o.value)).toContain('PCS');
	});

	it('stores 69 complete scheme entries, keeping both 36 and both 56 variants', () => {
		expect(SCHEME_OPTIONS).toHaveLength(69);
		expect(SCHEME_OPTIONS.filter((o) => o.value.startsWith('36-'))).toHaveLength(2);
		expect(SCHEME_OPTIONS.filter((o) => o.value.startsWith('56-'))).toHaveLength(2);
		expect(SCHEME_OPTIONS.map((o) => o.value)).toContain('19-Drawback (DBK)');
	});

	it('stores 44 unique EndUse codes with the duplicate FSH700 removed', () => {
		expect(END_USE_OPTIONS).toHaveLength(44);
		expect(END_USE_OPTIONS.filter((o) => o.value === 'FSH700')).toHaveLength(1);
	});

	it('stores the approved small catalogs', () => {
		expect(IGST_PAYMENT_STATUS_OPTIONS.map((o) => o.value)).toEqual(['NA', 'LUT', 'P']);
		expect(REWARD_ITEM_OPTIONS.map((o) => o.value)).toEqual(['Yes', 'No']);
		expect(RODTEP_OPTIONS.map((o) => o.value)).toEqual(['Yes', 'No', 'N/A']);
	});

	it('stores the 21 regression FTA codes with exact case', () => {
		const codes = FTA_OPTIONS.map((o) => o.value);
		expect(codes).toHaveLength(21);
		for (const c of ['FTA0SL', 'CEPASG', 'PTAAPTA', 'GSTP', 'NCPTI', 'ECTAAU', 'CETAUK']) {
			expect(codes).toContain(c);
		}
	});

	it('stores states with significant leading zeroes', () => {
		const byCode = new Map(STATE_OPTIONS.map((o) => [o.value, o.label]));
		for (const code of ['08', '09', '27', '29', '33', '36', '37', '97']) {
			expect(byCode.has(code), code).toBe(true);
		}
		expect(byCode.get('08')).toBe('RAJASTHAN');
	});

	it('stores two-character country codes and excludes non-country regions', () => {
		expect(COUNTRY_OPTIONS.length).toBeGreaterThan(240);
		expect(COUNTRY_OPTIONS.every((o) => /^[A-Z]{2}$/.test(o.value))).toBe(true);
		const codes = new Set(COUNTRY_OPTIONS.map((o) => o.value));
		for (const c of ['US', 'GB', 'AU', 'DE', 'NL', 'ES', 'SA', 'CA']) expect(codes.has(c)).toBe(true);
		for (const c of ['EU', 'UN', 'ZZ', 'XA', 'XB', 'QO']) expect(codes.has(c)).toBe(false);
	});

	it('scopes every district to a known state, and ships no Accessories catalog', () => {
		const states = new Set(STATE_OPTIONS.map((o) => o.value));
		expect(DISTRICT_OPTIONS.length).toBeGreaterThan(700);
		for (const d of DISTRICT_OPTIONS) {
			expect(states.has(d.parentValue!), d.label).toBe(true);
			expect(/^\d{2,3}$/.test(d.value), d.value).toBe(true);
		}
		expect(Object.keys(getCatalogSnapshot())).not.toContain('accessories');
	});

	it('resolves the district pairs the reference corpus expects', () => {
		for (const [state, district, name] of [
			['09', '171', 'MORADABAD'],
			['02', '25', 'SOLAN'],
			['06', '75', 'SONIPAT'],
			['06', '60', 'FARIDABAD']
		]) {
			expect(resolveCatalogValue(name, DISTRICT_OPTIONS, { parentValue: state })).toMatchObject({
				status: 'resolved',
				value: district
			});
			// The same district code under the wrong state stays unresolved.
			expect(
				resolveCatalogValue(district, DISTRICT_OPTIONS, { parentValue: '07' }).status
			).toBe('unresolved');
		}
	});

	it('has no duplicate (value, parentValue) key in any catalog', () => {
		for (const [id, options] of Object.entries(getCatalogSnapshot())) {
			const keys = options.map((o) => `${o.value.toLowerCase()} ${o.parentValue ?? ''}`);
			expect(new Set(keys).size, id).toBe(keys.length);
		}
	});
});

describe('exact catalog resolution', () => {
	it('resolves an exact stored value regardless of case and padding', () => {
		expect(resolveCatalogValue('  pcs ', UNIT_OPTIONS)).toMatchObject({
			status: 'resolved',
			value: 'PCS'
		});
	});

	it('resolves the complete display string and a unique label', () => {
		expect(resolveCatalogValue(`08 ${EM_DASH} RAJASTHAN`, STATE_OPTIONS)).toMatchObject({
			value: '08'
		});
		expect(resolveCatalogValue('rajasthan', STATE_OPTIONS)).toMatchObject({ value: '08' });
		expect(resolveCatalogValue('United States', COUNTRY_OPTIONS)).toMatchObject({ value: 'US' });
	});

	it('never substring-, prefix- or nearest-matches', () => {
		const all = [...UNIT_OPTIONS, ...STATE_OPTIONS, ...COUNTRY_OPTIONS, ...FTA_OPTIONS];
		for (const bad of ['PC', 'PCSX', 'RAJASTAN', 'RAJAS', 'UNITED', 'Drawback', 'NCPT']) {
			expect(resolveCatalogValue(bad, all).status, bad).toBe('unresolved');
		}
	});

	it('migrates a bare 19 to the complete canonical scheme', () => {
		expect(resolveCatalogValue('19', SCHEME_OPTIONS, { allowNumericPrefix: true })).toMatchObject({
			status: 'resolved',
			value: '19-Drawback (DBK)'
		});
	});

	it('keeps a complete canonical scheme unchanged', () => {
		expect(
			resolveCatalogValue('19-Drawback (DBK)', SCHEME_OPTIONS, { allowNumericPrefix: true })
		).toMatchObject({ value: '19-Drawback (DBK)' });
		expect(
			resolveCatalogValue('36-MEIS', SCHEME_OPTIONS, { allowNumericPrefix: true })
		).toMatchObject({ value: '36-MEIS' });
	});

	it('leaves ambiguous bare 36 and 56 unresolved', () => {
		for (const code of ['36', '56']) {
			expect(resolveCatalogValue(code, SCHEME_OPTIONS, { allowNumericPrefix: true })).toEqual({
				status: 'unresolved',
				raw: code,
				reason: 'ambiguous'
			});
		}
	});

	it('does not apply numeric-prefix migration outside export schemes', () => {
		expect(resolveCatalogValue('19', SCHEME_OPTIONS).status).toBe('unresolved');
	});

	it('returns the raw value for warning text when unknown', () => {
		expect(resolveCatalogValue('WIDGETS', UNIT_OPTIONS)).toEqual({
			status: 'unresolved',
			raw: 'WIDGETS',
			reason: 'unknown'
		});
	});

	it('scopes a dependent catalog to its parent and reports wrong_parent', () => {
		const districts = [
			{ value: '102', label: 'JAIPUR', parentValue: '8' },
			{ value: '171', label: 'GHAZIABAD', parentValue: '9' }
		];
		expect(resolveCatalogValue('102', districts, { parentValue: '08' })).toMatchObject({
			status: 'resolved',
			value: '102'
		});
		expect(resolveCatalogValue('102', districts, { parentValue: '09' })).toEqual({
			status: 'unresolved',
			raw: '102',
			reason: 'wrong_parent'
		});
	});

	it('treats padded state 08 and district parent 8 as the same state', () => {
		expect(normalizeStateKey('08')).toBe(normalizeStateKey('8'));
		expect(normalizeStateKey('')).toBe('');
		expect(normalizeStateKey('RAJASTHAN')).toBe('rajasthan');
	});

	it('formats display strings as "value - label"', () => {
		expect(displayString({ value: '08', label: 'RAJASTHAN' })).toBe(`08 ${EM_DASH} RAJASTHAN`);
		expect(displayString({ value: 'PCS' })).toBe('PCS');
	});

	it('resolves nothing from blank input', () => {
		for (const blank of [null, undefined, '', '   ']) {
			expect(resolveCatalogValue(blank, UNIT_OPTIONS).status).toBe('unresolved');
		}
	});
});
