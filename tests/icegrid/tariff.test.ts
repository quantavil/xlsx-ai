import { describe, it, expect } from 'bun:test';
import {
	broadenTerms,
	cleanTariffDescription,
	filableCandidates,
	headingCodes,
	mergeCandidates,
	parseTariffMatches,
	tariffLeaf,
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

describe('reading a tariff line', () => {
	// Verbatim from DGFT. Every child of 4421 arrives carrying the same eleven words of
	// parent, and only the tail after the last colon says which item it is.
	it('takes the item\u2019s own wording from the end of the path', () => {
		expect(
			tariffLeaf(
				cleanTariffDescription(
					'Spools, cops, bobbins, sewing thread reels and the like of\nturned wood:\n---- Other'
				)
			)
		).toBe('Other');
		expect(
			tariffLeaf(
				cleanTariffDescription(
					'Spools, cops, bobbins and the like of\nturned wood:\n---- Parts of domestic decorative articles used as tableware'
				)
			)
		).toBe('Parts of domestic decorative articles used as tableware');
	});

	it('is the whole line when the schedule prints no path', () => {
		expect(tariffLeaf('Other wooden furniture')).toBe('Other wooden furniture');
	});

	// The residual rule had quietly stopped firing for deep headings, which are exactly
	// the ones that produce twenty-three look-alike candidates.
	it('sinks a residual whose parent path makes it look specific', () => {
		const ranked = rankTariffCandidates(
			[
				{
					code: '44219990',
					description: 'Spools, cops, bobbins and the like of turned wood: Other',
					basis: 'broad',
					via: '4421'
				},
				{
					code: '44219960',
					description:
						'Spools, cops, bobbins and the like of turned wood: Parts of domestic decorative articles used as tableware and kitchenware',
					basis: 'broad',
					via: '4421'
				}
			],
			'12 IN WOOD BOWL W/ SERVERS - ACACIA WOOD'
		);
		expect(ranked[0].code).toBe('44219960');
	});

	// `Wood paving Blocks` beat the tableware entry purely by saying "wood" twice.
	it('counts a shared word once, however often a line repeats it', () => {
		const ranked = rankTariffCandidates(
			[
				{
					code: '44219920',
					description: 'Wood articles of turned wood: Wood paving Blocks',
					basis: 'broad',
					via: '4421'
				},
				{
					code: '44219960',
					description: 'Wood articles of turned wood: Domestic tableware and kitchenware',
					basis: 'broad',
					via: '4421'
				}
			],
			'WOOD BOWL TABLEWARE'
		);
		expect(ranked[0].code).toBe('44219960');
	});
});

describe('recovering an item whose phrases all missed', () => {
	// The schedule is matched literally, so a phrase either lands or it does not.
	// `tableware` really does answer with the heading and none of its children.
	const TABLEWARE_ANSWER = parseTariffMatches([
		{ itcCode: '4419', itcDescription: 'Tableware and kitchenware, of wood.' },
		{ itcCode: '392410', itcDescription: 'Tableware and kitchenware' },
		{ itcCode: '830621', itcDescription: 'Statuettes and other ornaments' }
	]);

	it('names the headings a search returned, most specific first', () => {
		expect(headingCodes(TABLEWARE_ANSWER)).toEqual(['392410', '830621', '4419']);
	});

	it('ignores filable rows - those needed no recovery', () => {
		const matches = parseTariffMatches([
			{ itcCode: '44191100', itcDescription: 'Bread boards' },
			{ itcCode: '4419', itcDescription: 'Tableware and kitchenware, of wood.' }
		]);
		expect(headingCodes(matches)).toEqual(['4419']);
	});

	it('deduplicates headings and honours the limit', () => {
		const matches = parseTariffMatches([
			{ itcCode: '4419', itcDescription: 'a' },
			{ itcCode: '4419', itcDescription: 'duplicate' },
			{ itcCode: '392410', itcDescription: 'b' },
			{ itcCode: '830621', itcDescription: 'c' }
		]);
		expect(headingCodes(matches, 2)).toEqual(['392410', '830621']);
	});

	// Longest first, because a longer word is a more particular one: `acacia` finds the
	// single tariff line that names it where `wood` finds two hundred and seventeen.
	it('falls back to the words inside the phrases, longest first', () => {
		expect(broadenTerms(['acacia wood', 'wooden serving board'])).toEqual([
			'serving',
			'acacia',
			'wooden'
		]);
	});

	// `cake` finds a chapter of food and `stand` finds fifty-six articles; neither is
	// good, but the ranker can read them and an empty dialog offers nothing to read.
	it('drops short words and the schedule filler the ranker already ignores', () => {
		expect(broadenTerms(['cake stand of the kind used with glass'])).toEqual([
			'stand',
			'glass',
			'cake'
		]);
	});

	it('deduplicates words shared between phrases', () => {
		expect(broadenTerms(['marble stand', 'wood stand'], 5)).toEqual(['marble', 'stand', 'wood']);
	});

	it('has nothing to broaden when every phrase was already one short word', () => {
		expect(broadenTerms(['tin', 'ash'])).toEqual([]);
		expect(broadenTerms([])).toEqual([]);
	});
});

describe('ranking a recovered candidate', () => {
	const c = (
		code: string,
		description: string,
		basis: TariffCandidate['basis'],
		via: string
	): TariffCandidate => ({ code, description, basis, via });

	// A broad candidate came from one word of the description, so it exists to keep the
	// item from being a dead end - not because it is probably right.
	it('sinks below a phrase match even when it shares more words with the goods', () => {
		const ranked = rankTariffCandidates(
			[
				c('27101243', 'Motor gasoline of a kind used in wood', 'broad', 'stand'),
				c('44219990', 'Other articles of wood', 'search', 'articles of wood')
			],
			'12 IN WOOD BOWL W/ SERVERS - ACACIA WOOD'
		);
		expect(ranked.map((x) => x.code)).toEqual(['44219990', '27101243']);
	});

	it('keeps the documents ahead of both', () => {
		const ranked = rankTariffCandidates(
			[
				c('44219990', 'Other articles of wood', 'broad', 'wood'),
				c('44219960', 'Wooden bowls', 'search', 'wooden bowl'),
				c('94036000', 'Other wooden furniture', 'prefix', '9403')
			],
			'WOOD BOWL'
		);
		expect(ranked.map((x) => x.basis)).toEqual(['prefix', 'search', 'broad']);
	});

	// An unbounded prefix is not a stem. `stand`/`standard` put petroleum at the top of
	// a list of marble homeware; `wood`/`wooden` is the inflection this actually needs.
	it('does not treat a word as a stem of an arbitrarily longer one', () => {
		const ranked = rankTariffCandidates(
			[
				c('27101243', 'Motor gasoline conforming to standard IS 2796', 'broad', 'stand'),
				c('68022190', 'Other articles of marble', 'broad', 'marble')
			],
			'2 PC CAKE STAND W/ GLASS DOME - MARBLE/WOOD STAND'
		);
		expect(ranked[0].code).toBe('68022190');
	});

	it('still matches the inflections a tariff actually uses', () => {
		const ranked = rankTariffCandidates(
			[
				c('99999999', 'Articles of iron', 'search', 'iron'),
				c('44219990', 'Other wooden articles, marbled', 'search', 'wooden')
			],
			'MANGO WOOD TRAY, MARBLE INLAY'
		);
		expect(ranked[0].code).toBe('44219990');
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
