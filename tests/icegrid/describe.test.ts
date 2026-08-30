import { describe, it, expect } from 'bun:test';
import {
	composeDescription,
	describeStyleProblem,
	deriveRows,
	parseMaterials
} from '../../src/lib/modules/icegrid/derive';
import { getCatalogSnapshot } from '../../src/lib/modules/icegrid/catalogs';
import { ICEGRID_ALL_HEADERS } from '../../src/lib/modules/icegrid/columns';
import type { IcegridDescriptionStyle, IcegridRow } from '../../src/lib/modules/icegrid/schema';

const catalogs = getCatalogSnapshot();
const row = (over: Partial<IcegridRow>): IcegridRow =>
	({ ...Object.fromEntries(ICEGRID_ALL_HEADERS.map((h) => [h, null])), ...over }) as unknown as IcegridRow;

const style = (over: Partial<IcegridDescriptionStyle> = {}): IcegridDescriptionStyle => ({
	template: 'HANDICRAFTS OF {MATERIALS} ARTWARES- {NAME}',
	separator: ' / ',
	nonMaterials: [],
	spellings: [],
	...over
});

describe('parseMaterials', () => {
	it('reads the printed shapes the packing lists actually use', () => {
		expect(parseMaterials('Alu-1.000; Marble-0.850')).toEqual([
			{ name: 'Alu', kg: 1 },
			{ name: 'Marble', kg: 0.85 }
		]);
		expect(parseMaterials('Iron 0.800 Kgs; Marble 1.700 Kgs')).toEqual([
			{ name: 'Iron', kg: 0.8 },
			{ name: 'Marble', kg: 1.7 }
		]);
		expect(parseMaterials('Brass 0.030, Glass 0.125'.replace(', ', '; '))).toEqual([
			{ name: 'Brass', kg: 0.03 },
			{ name: 'Glass', kg: 0.125 }
		]);
	});

	it('keeps a material the line names but prints no weight for', () => {
		expect(parseMaterials('Marble 2.68; Mango Wood 0.85; MDF 0.6; Iron')).toEqual([
			{ name: 'Marble', kg: 2.68 },
			{ name: 'Mango Wood', kg: 0.85 },
			{ name: 'MDF', kg: 0.6 },
			{ name: 'Iron', kg: null }
		]);
	});

	// Verbatim parentheticals from the 514/026 packing list. A live run handed these
	// straight back instead of the semicolons the prompt asks for, and a parser that
	// only knew semicolons dropped every multi-material row on the shipment.
	it('accepts the separators the packing lists themselves print', () => {
		expect(parseMaterials('Alu-9.600/Glass-0.150/Agate-0.050')).toEqual([
			{ name: 'Alu', kg: 9.6 },
			{ name: 'Glass', kg: 0.15 },
			{ name: 'Agate', kg: 0.05 }
		]);
		expect(
			parseMaterials('Aluminium-0.600/Marble-15.200/Steel-0.050/Iron-0.100/Glass-3.100')
		).toHaveLength(5);
		expect(parseMaterials('Alu-1.000 / Marble-0.850')).toEqual([
			{ name: 'Alu', kg: 1 },
			{ name: 'Marble', kg: 0.85 }
		]);
		expect(parseMaterials('Net Wt Brass 0.030, Glass 0.125, Mdf 0.090')).toEqual([
			{ name: 'Brass', kg: 0.03 },
			{ name: 'Glass', kg: 0.125 },
			{ name: 'Mdf', kg: 0.09 }
		]);
	});

	it('keeps a slash that belongs to a material name', () => {
		expect(parseMaterials('M/Wood 0.210')).toEqual([{ name: 'M/Wood', kg: 0.21 }]);
	});

	it('is empty for a line with no breakdown', () => {
		expect(parseMaterials(null)).toEqual([]);
		expect(parseMaterials('')).toEqual([]);
	});
});

// Every expectation below is a line from the 17-shipment reference corpus: the
// materials as its packing list prints them, and the Description string its trusted
// output carries. They are what settles the ordering rule.
describe('composeDescription against the reference corpus', () => {
	it('ranks heaviest first (OUTPUT 5, one shipment, two lines that disagree)', () => {
		// The pair that proves the sort is not cosmetic: same two materials, same printed
		// order, and the filed order flips with the weights.
		expect(
			composeDescription(
				'Alumunium Texture Eye  Sculpture On Tarvertine Base - Large',
				parseMaterials('Alu-1.000; Marble-0.850'),
				style({ spellings: [{ printed: 'Alu', filed: 'ALUMINUM' }] })
			)
		).toBe(
			'HANDICRAFTS OF ALUMINUM / MARBLE ARTWARES- ALUMUNIUM TEXTURE EYE  SCULPTURE ON TARVERTINE BASE - LARGE'
		);
		expect(
			composeDescription(
				'Alumunium Texture Eye  Sculpture On Tarvertine Base - Small',
				parseMaterials('Alu-0.700; Marble-0.850'),
				style({ spellings: [{ printed: 'Alu', filed: 'ALUMINUM' }] })
			)
		).toBe(
			'HANDICRAFTS OF MARBLE / ALUMINUM ARTWARES- ALUMUNIUM TEXTURE EYE  SCULPTURE ON TARVERTINE BASE - SMALL'
		);
	});

	it('ranks five materials (OUTPUT 5, stormlight cone L)', () => {
		expect(
			composeDescription(
				'Berdand Beige floor stormlight luster glass cone L',
				parseMaterials(
					'Aluminium-0.600; Marble-15.200; Steel-0.050; Iron-0.100; Glass-3.100'
				),
				style({ spellings: [{ printed: 'Aluminium', filed: 'ALUMINUM' }] })
			)
		).toBe(
			'HANDICRAFTS OF MARBLE / GLASS / ALUMINUM / IRON / STEEL ARTWARES- BERDAND BEIGE FLOOR STORMLIGHT LUSTER GLASS CONE L'
		);
	});

	it('breaks a tie on printed order (OUTPUT 17, EDSEL and CARTY)', () => {
		const godgift = style({ template: 'HANDICRAFTS OF {MATERIALS} ARTWARE- {NAME}', separator: '/' });
		// Mdf 0.030 and Rexine 0.030 weigh the same; the document prints Mdf first.
		expect(
			composeDescription(
				'EDSEL TABLE CLOCK LARGE',
				parseMaterials(
					'Aluminium 0.810; Glass 0.070; Iron 0.025; Mdf 0.030; Rexine 0.030; Steel 0.050'
				),
				godgift
			)
		).toBe('HANDICRAFTS OF ALUMINIUM/GLASS/STEEL/MDF/REXINE/IRON ARTWARE- EDSEL TABLE CLOCK LARGE');
		// Iron 0.040 and Mdf 0.040 likewise.
		expect(
			composeDescription(
				'CARTY CLOCK SILVER 7.5',
				parseMaterials('Glass 0.660; Iron 0.040; Mdf 0.040; Steel 0.140'),
				godgift
			)
		).toBe('HANDICRAFTS OF GLASS/STEEL/IRON/MDF ARTWARE- CARTY CLOCK SILVER 7.5');
	});

	it('sorts an unweighted material last and expands S.Steel (OUTPUT 1)', () => {
		// The packing list prints per-piece weights for marble, mango wood and MDF and
		// none for iron - which is in fact the heaviest at the residual 4.07 kg. Ranking
		// on printed weights alone is what reproduces the filed order.
		expect(
			composeDescription(
				'Side table large New Natural marble with colored wood',
				parseMaterials('Marble 2.68; Mango Wood 0.85; MDF 0.6; Iron'),
				style({ template: 'OTHER FURNITURE ARTICLES OF {MATERIALS} ARTWARE - {NAME}' })
			)
		).toBe(
			'OTHER FURNITURE ARTICLES OF MARBLE / MANGO WOOD / MDF / IRON ARTWARE - SIDE TABLE LARGE NEW NATURAL MARBLE WITH COLORED WOOD'
		);
		expect(
			composeDescription(
				'C Table Top Part',
				parseMaterials('Mango Wood 0.5; S.Steel 1.5'),
				style({
					template: 'OTHER FURNITURE ARTICLES OF {MATERIALS} ARTWARE - {NAME}',
					spellings: [{ printed: 'S.Steel', filed: 'Stainless Steel' }]
				})
			)
		).toBe('OTHER FURNITURE ARTICLES OF STAINLESS STEEL / MANGO WOOD ARTWARE - C TABLE TOP PART');
	});

	it('composes the rows a live run left uncomposed (OUTPUT 5)', () => {
		const thinkOverseas = style({ spellings: [{ printed: 'Alu', filed: 'ALUMINUM' }, { printed: 'Aluminium', filed: 'ALUMINUM' }] });
		expect(
			composeDescription(
				'Aluminium Textured Wall art Large',
				parseMaterials('Alu-9.600/Glass-0.150/Agate-0.050'),
				thinkOverseas
			)
		).toBe('HANDICRAFTS OF ALUMINUM / GLASS / AGATE ARTWARES- ALUMINIUM TEXTURED WALL ART LARGE');
		expect(
			composeDescription(
				'Berdand Beige floor stormlight luster glass cone L',
				parseMaterials('Aluminium-0.600/Marble-15.200/Steel-0.050/Iron-0.100/Glass-3.100'),
				thinkOverseas
			)
		).toBe(
			'HANDICRAFTS OF MARBLE / GLASS / ALUMINUM / IRON / STEEL ARTWARES- BERDAND BEIGE FLOOR STORMLIGHT LUSTER GLASS CONE L'
		);
		expect(
			composeDescription(
				'Tendu Beige Stone Side table',
				parseMaterials('Alu-0.300/Marble-12.900'),
				thinkOverseas
			)
		).toBe('HANDICRAFTS OF MARBLE / ALUMINUM ARTWARES- TENDU BEIGE STONE SIDE TABLE');
	});

	it('drops a listed non-material (OUTPUT 4, Wiring Component)', () => {
		expect(
			composeDescription(
				'Monolith Marble Wall Light Night',
				parseMaterials('Iron 0.350; Marble 1.400; Brass 0.080; Wiring Component 0.250'),
				style({
					template: 'OTHER ARTICLES OF {MATERIALS} ARTWARE - {NAME}',
					nonMaterials: ['Wiring Component']
				})
			)
		).toBe('OTHER ARTICLES OF MARBLE / IRON / BRASS ARTWARE - MONOLITH MARBLE WALL LIGHT NIGHT');
	});

	it('drops a zero-weight material and de-duplicates a repeated one', () => {
		expect(
			composeDescription('Vase', parseMaterials('Alu 2.000; Glass 0; Alu 2.000'), style())
		).toBe('HANDICRAFTS OF ALU ARTWARES- VASE');
	});

	it('returns null rather than filing a phrase with a hole in it', () => {
		expect(composeDescription('Cast Aluminium Cone Base', [], style())).toBeNull();
	});

	it('refuses a template that would throw the article name away', () => {
		// What a live run actually returned: the banner copied verbatim, with no {NAME}.
		// Composing it collapsed every row of the shipment onto one string and took the
		// article names with it.
		expect(
			composeDescription(
				'Aluminium Flower Vase',
				parseMaterials('Alu 1.900'),
				style({ template: 'HANDCRAFT OF {MATERIALS} ARTWARES' })
			)
		).toBeNull();
	});

	it('drops an entry the model failed to separate rather than inventing a material', () => {
		// "Alumi 0.570 Stone 0.300" arriving unsplit produced HANDCRAFT OF ALUMI 0.570
		// STONE ARTWARES in a live run.
		expect(parseMaterials('Alumi 0.570 Stone 0.300')).toEqual([]);
		expect(parseMaterials('Alu 1.000; Marble 0.850 Iron 0.400')).toEqual([
			{ name: 'Alu', kg: 1 }
		]);
	});
});

// descriptionStyle is the only model output that rewrites an already evidence-backed
// cell, and three separate live failures ended the same way: the article's own name
// gone from what would have been filed. These are the gate on that.
describe('the goods-class style is checked before it is trusted', () => {
	it('names why a template is unusable', () => {
		expect(describeStyleProblem(style())).toBeNull();
		expect(describeStyleProblem(style({ template: 'HANDCRAFT OF {MATERIALS} ARTWARES' }))).toContain(
			'{NAME}'
		);
		expect(
			describeStyleProblem(style({ template: 'HANDICRAFTS OF {MATERIAL} ARTWARES- {NAME}' }))
		).toContain('{MATERIAL}');
		expect(describeStyleProblem(style({ template: '   ' }))).toContain('no template');
		expect(describeStyleProblem(null)).toContain('no template');
	});

	it('never files a leftover placeholder', () => {
		expect(
			composeDescription('Vase', parseMaterials('Alu 1.000'), style({ template: 'X {MATERIAL} {NAME}' }))
		).toBeNull();
	});

	it('keeps an article name that contains a replacement pattern', () => {
		// `$&` and `$'` are substitution patterns to String.replace, and an invoice may
		// print a `$` in a description.
		expect(
			composeDescription("Vase $& Bowl", parseMaterials('Alu 1.000'), style())
		).toBe("HANDICRAFTS OF ALU ARTWARES- VASE $& BOWL");
	});

	it('refuses to compose a row that is already composed', () => {
		expect(
			composeDescription(
				'HANDICRAFTS OF ALUMINUM ARTWARES- ALUMINIUM FLOWER VASE',
				parseMaterials('Alu 1.900'),
				style()
			)
		).toBeNull();
	});

	it('reports a bad style once for the shipment, not once per row', () => {
		const rows = [
			row({ Description: 'Aluminium Flower Vase', Materials: 'Alu 1.900' }),
			row({ Description: 'Alumunium Knot', Materials: 'Alu 0.600' })
		];
		const result = deriveRows(rows, {
			catalogs,
			sourceText: '',
			descriptionStyle: style({ template: 'HANDCRAFT OF {MATERIALS} ARTWARES' })
		});
		expect(result.rows.map((r) => r.Description)).toEqual([
			'Aluminium Flower Vase',
			'Alumunium Knot'
		]);
		const rejected = result.warnings.filter((w) => w.includes('{NAME}'));
		expect(rejected).toHaveLength(1);
		// and not blamed on the materials, which were fine
		expect(result.warnings.some((w) => w.includes('packing list prints none'))).toBe(false);
	});
});

describe('deriveRows composes Description', () => {
	const base = { catalogs, sourceText: '' };

	it('replaces the printed name and marks the cell derived', () => {
		const result = deriveRows(
			[row({ Description: 'Aluminium Flower Vase', Materials: 'Alu-1.900' })],
			{
				...base,
				descriptionStyle: style({ spellings: [{ printed: 'Alu', filed: 'ALUMINUM' }] })
			}
		);
		expect(result.rows[0].Description).toBe('HANDICRAFTS OF ALUMINUM ARTWARES- ALUMINIUM FLOWER VASE');
		expect(result.provenance.r1.Description).toBe('derived');
	});

	it('leaves Description alone when the shipment states no style', () => {
		const result = deriveRows([row({ Description: 'Soft Ferrite Cores' })], base);
		expect(result.rows[0].Description).toBe('Soft Ferrite Cores');
		expect(result.provenance.r1.Description).toBe('extracted');
	});

	it('keeps the printed name and warns when the line prints no materials', () => {
		const result = deriveRows([row({ Description: 'Cast Aluminium Cone Base' })], {
			...base,
			descriptionStyle: style()
		});
		expect(result.rows[0].Description).toBe('Cast Aluminium Cone Base');
		expect(result.warnings.some((w) => w.includes('goods-class phrase'))).toBe(true);
	});

	it('never lets Materials reach the filed table', () => {
		const { ICEGRID_HEADERS } = require('../../src/lib/modules/icegrid/columns');
		expect(ICEGRID_HEADERS).not.toContain('Materials');
	});
});
