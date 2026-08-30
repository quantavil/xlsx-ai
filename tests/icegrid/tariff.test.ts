import { describe, it, expect } from 'bun:test';
import {
	cleanTariffDescription,
	filableCandidates,
	mergeCandidates,
	parseTariffMatches,
	rankTariffCandidates,
	applyRanking,
	type TariffCandidate
} from '../../src/lib/modules/icegrid/tariff';
import { tariffQueriesFor, unclassifiedKey } from '../../src/lib/modules/icegrid/confirm';
import { normalizeRitcCode } from '../../src/lib/modules/icegrid/duty-lookup';
import type { IcegridRow } from '../../src/lib/modules/icegrid/schema';

const row = (over: Partial<IcegridRow>): IcegridRow => ({ ...over }) as IcegridRow;

// Shapes taken verbatim from the live DGFT endpoint.
const DGFT_ROWS = [
	{ itcCode: '94039900', itcDescription: 'Parts:\n- - Other' },
	{ itcCode: '940330', itcDescription: 'Wooden furniture of a kind used in offices' },
	{ itcCode: '94036000', itcDescription: 'Other wooden furniture' },
	{ itcCode: '94036000', itcDescription: 'duplicate row' },
	{ itcCode: '', itcDescription: 'no code' }
];

describe('parsing the ITC-HS master', () => {
	it('keeps the first row per code and drops codeless ones', () => {
		expect(parseTariffMatches(DGFT_ROWS).map((m) => m.code)).toEqual([
			'94039900',
			'940330',
			'94036000'
		]);
		expect(parseTariffMatches('not an array')).toEqual([]);
	});

	it('strips the schedule indent markers without eating real hyphens', () => {
		// The naive regex left one dash behind here, because matching " - " consumed
		// the space the next dash needed.
		expect(cleanTariffDescription('Parts:\n- - Other')).toBe('Parts: Other');
		expect(cleanTariffDescription('Other bed linen :\n-- Of cotton')).toBe(
			'Other bed linen : Of cotton'
		);
		expect(cleanTariffDescription('T-shirts, singlets, non-woven')).toBe(
			'T-shirts, singlets, non-woven'
		);
	});

	it('reads a code however it was punctuated', () => {
		// One normaliser for the module, not a second one under a tariff-flavoured name.
		expect(normalizeRitcCode('9403.89.00')).toBe('94038900');
		expect(normalizeRitcCode('9403 89')).toBe('940389');
		expect(normalizeRitcCode(null)).toBe('');
	});
});

describe('candidate selection', () => {
	it('offers only eight-digit rows, because a heading cannot be filed', () => {
		const matches = parseTariffMatches(DGFT_ROWS);
		expect(filableCandidates(matches, 'search', 'wooden furniture').map((c) => c.code)).toEqual([
			'94039900',
			'94036000'
		]);
	});

	it('merges lists with the first mention of a code winning', () => {
		const prefix: TariffCandidate[] = [
			{ code: '94036000', description: 'Other wooden furniture', basis: 'prefix', via: '9403' }
		];
		const search: TariffCandidate[] = [
			{ code: '94036000', description: 'dup', basis: 'search', via: 'wood' },
			{ code: '94038900', description: 'Other', basis: 'search', via: 'wood' }
		];
		const merged = mergeCandidates(prefix, search);
		expect(merged.map((c) => c.code)).toEqual(['94036000', '94038900']);
		expect(merged[0].basis).toBe('prefix');
	});

	it('ranks a document-anchored candidate above any suggestion', () => {
		const candidates: TariffCandidate[] = [
			{ code: '44201000', description: 'Wooden statuettes', basis: 'search', via: 'wood' },
			{ code: '94036000', description: 'Other wooden furniture', basis: 'prefix', via: '9403' }
		];
		expect(rankTariffCandidates(candidates, 'SIDE TABLE MANGO WOOD')[0].code).toBe('94036000');
	});

	it('ranks a description that names the goods above the residual entry', () => {
		const candidates: TariffCandidate[] = [
			{ code: '94038900', description: 'Other', basis: 'search', via: 'furniture' },
			{ code: '94036000', description: 'Other wooden furniture', basis: 'search', via: 'furniture' }
		];
		// "wood" has to reach "wooden" for this to score at all.
		expect(rankTariffCandidates(candidates, 'SIDE TABLE LARGE MANGO WOOD')[0].code).toBe('94036000');
	});

	it('sinks the residual catch-all when nothing overlaps at all', () => {
		const candidates: TariffCandidate[] = [
			{ code: '94039900', description: 'Other', basis: 'search', via: 'x' },
			{ code: '94034000', description: 'Wooden furniture of a kind used in the kitchen', basis: 'search', via: 'x' }
		];
		// Both score zero against this description. Ordering the tie by length alone
		// would put "Other" first, which is the entry least worth defaulting to.
		expect(rankTariffCandidates(candidates, 'ASSORTED GOODS')[0].code).toBe('94034000');
	});

	it('does not treat any short shared prefix as a match', () => {
		const candidates: TariffCandidate[] = [
			{ code: '52010000', description: 'Cotton, not carded', basis: 'search', via: 'x' },
			{ code: '94036000', description: 'Other wooden furniture', basis: 'search', via: 'x' }
		];
		// "cot" must not reach "cotton"; the furniture entry wins on the wood token.
		expect(rankTariffCandidates(candidates, 'WOODEN COT')[0].code).toBe('94036000');
	});

	it('caps the shortlist, because 253 rows is a search result and not a choice', () => {
		const many: TariffCandidate[] = Array.from({ length: 40 }, (_, i) => ({
			code: `9403${String(i).padStart(4, '0')}`,
			description: `entry ${i}`,
			basis: 'search' as const,
			via: 'table'
		}));
		expect(rankTariffCandidates(many, 'TABLE')).toHaveLength(6);
	});
});

describe('applying the model ranking', () => {
	const shortlist: TariffCandidate[] = [
		{ code: '94038900', description: 'Other', basis: 'prefix', via: '9403' },
		{ code: '94036000', description: 'Other wooden furniture', basis: 'prefix', via: '9403' },
		{ code: '94039900', description: 'Parts: Other', basis: 'prefix', via: '9403' }
	];

	it('reorders the shortlist to the ranking', () => {
		expect(applyRanking(shortlist, ['94036000', '94039900', '94038900']).map((c) => c.code)).toEqual(
			['94036000', '94039900', '94038900']
		);
	});

	it('drops a code that was never on the list', () => {
		// The one thing the ranker must not be able to do is introduce a code. A
		// filable-looking invention is exactly what would slip past a filer unnoticed.
		const out = applyRanking(shortlist, ['12345678', '94036000']);
		expect(out.map((c) => c.code)).toEqual(['94036000', '94038900', '94039900']);
		expect(out.some((c) => c.code === '12345678')).toBe(false);
	});

	it('keeps candidates the ranker left out, rather than filtering them away', () => {
		// Ordering is the model's job; deciding what the schedule offers is not.
		expect(applyRanking(shortlist, ['94039900']).map((c) => c.code)).toEqual([
			'94039900',
			'94038900',
			'94036000'
		]);
	});

	it('ignores a repeated code and reads one written with punctuation', () => {
		expect(
			applyRanking(shortlist, ['9403.60.00', '94036000', '94038900']).map((c) => c.code)
		).toEqual(['94036000', '94038900', '94039900']);
	});

	it('falls back to the order it was given when the ranking is empty', () => {
		expect(applyRanking(shortlist, []).map((c) => c.code)).toEqual([
			'94038900',
			'94036000',
			'94039900'
		]);
	});

	it('caps what the user is finally shown', () => {
		const many: TariffCandidate[] = Array.from({ length: 25 }, (_, i) => ({
			code: `9403${String(i).padStart(4, '0')}`,
			description: `entry ${i}`,
			basis: 'prefix' as const,
			via: '9403'
		}));
		expect(applyRanking(many, [])).toHaveLength(6);
	});
});

describe('which rows need a code', () => {
	it('asks once per printed heading and description, not once per row', () => {
		const queries = tariffQueriesFor([
			row({ RITCCode: '94038900', Description: 'HAS A CODE' }),
			row({ RITCCode: '9403', Description: 'SIDE TABLE' }),
			row({ RITCCode: '9403', Description: 'Side Table' }),
			row({ Description: 'WALL CLOCK' })
		]);
		expect(queries).toEqual([
			{ key: '9403|side table', description: 'SIDE TABLE', printed: '9403' },
			{ key: '|wall clock', description: 'WALL CLOCK', printed: '' }
		]);
	});

	it('keys a row the same way whether the dialog is built or its answers applied', () => {
		const r = row({ RITCCode: '9403.89', Description: '  Side Table  ' });
		expect(unclassifiedKey(r)).toBe('940389|side table');
	});
});
