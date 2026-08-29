import { describe, expect, it } from 'bun:test';
import type { Column, Row } from '../../src/lib/types';
import {
	addressToIndices,
	aggregatesOwnColumn,
	cellAddress,
	referencedCells,
	resolveFormulaRows,
	sheetRowNumber
} from '../../src/lib/table/formulas';
import {
	applyFunction,
	applyReference,
	expectsReference,
	FORMULA_FUNCTIONS,
	matchFunctions
} from '../../src/lib/table/formula-hints';
import { isFormula, normalizeCellValue } from '../../src/lib/table/cells';
import { buildXlsxSheetData } from '../../src/lib/data/export';

const cols = (...names: string[]): Column[] =>
	names.map((name, i) => ({ id: `c${i + 1}`, name, type: 'number' }));

const rows = (...cells: (string | number | null)[][]): Row[] =>
	cells.map((vals, r) => Object.fromEntries([['id', `r${r + 1}`], ...vals.map((v, c) => [`c${c + 1}`, v])]) as Row);

describe('isFormula', () => {
	it('accepts only a leading = with content after it', () => {
		expect(isFormula('=SUM(A2:B2)')).toBe(true);
		expect(isFormula('=')).toBe(false);
		expect(isFormula('SUM(A2:B2)')).toBe(false);
		expect(isFormula(12)).toBe(false);
		expect(isFormula(null)).toBe(false);
	});
});

describe('normalizeCellValue', () => {
	it('keeps a formula verbatim in a numeric column', () => {
		// Without the guard, parseNumeric strips this to the digits it contains.
		expect(normalizeCellValue('number', '=SUM(A2:B2)')).toBe('=SUM(A2:B2)');
		expect(normalizeCellValue('currency', '  =A2*2  ')).toBe('=A2*2');
		expect(normalizeCellValue('number', '1,200')).toBe(1200);
	});
});

describe('resolveFormulaRows', () => {
	const c = cols('A', 'B', 'C');

	it('returns the same array when nothing is a formula', () => {
		const r = rows([1, 2, 3]);
		expect(resolveFormulaRows(c, r)).toBe(r);
	});

	it('computes with header-offset addressing: data starts at row 2', () => {
		const [out] = resolveFormulaRows(c, rows([2, 3, '=SUM(A2:B2)']));
		expect(out.c3).toBe(5);
	});

	it('resolves a chain declared out of order', () => {
		const [out] = resolveFormulaRows(c, rows([2, '=C2*2', '=A2+1']));
		expect(out.c2).toBe(6);
	});

	it('spans rows', () => {
		const out = resolveFormulaRows(c, rows([1, 0, null], [2, 0, null], [null, null, '=SUM(A2:A3)']));
		expect(out[2].c3).toBe(3);
	});

	it('marks a circular reference instead of hanging', () => {
		const [out] = resolveFormulaRows(c, rows(['=B2', '=A2', null]));
		expect(out.c1).toBe('#ERROR!');
	});

	it('never mutates the stored rows', () => {
		const r = rows([2, 3, '=SUM(A2:B2)']);
		resolveFormulaRows(c, r);
		expect(r[0].c3).toBe('=SUM(A2:B2)');
	});
});

describe('xlsx export', () => {
	it('writes a formula cell without its leading =', () => {
		const sheet = buildXlsxSheetData({
			title: 't',
			columns: cols('A', 'B', 'C'),
			rows: rows([2, 3, '=SUM(A2:B2)'])
		});
		// Row 0 is the header; the `<f>` element takes the expression bare.
		expect(sheet[1][2]).toMatchObject({ value: 'SUM(A2:B2)', type: 'Formula' });
	});
});

describe('sheetRowNumber', () => {
	it('skips the header row so the gutter matches formula addressing', () => {
		expect(sheetRowNumber(0)).toBe(2);
		expect(sheetRowNumber(7)).toBe(9);
	});
});

describe('addressing', () => {
	it('round-trips a grid position through its spreadsheet address', () => {
		expect(cellAddress(0, 0)).toBe('A2');
		expect(cellAddress(27, 7)).toBe('AB9');
		expect(addressToIndices('AB9', 30, 10)).toEqual({ colIndex: 27, rowIndex: 7 });
		expect(addressToIndices('$B$2', 30, 10)).toEqual({ colIndex: 1, rowIndex: 0 });
	});

	it('rejects an address outside the grid, including the header row', () => {
		expect(addressToIndices('A1', 3, 5)).toBeNull(); // row 1 is the header
		expect(addressToIndices('Z2', 3, 5)).toBeNull();
		expect(addressToIndices('A99', 3, 5)).toBeNull();
		expect(addressToIndices('nonsense', 3, 5)).toBeNull();
	});
});

describe('referencedCells', () => {
	it('expands a range without also reading its ends as loose references', () => {
		expect([...referencedCells('=SUM(A2:A4)', 3, 5)].sort()).toEqual(['0::0', '1::0', '2::0']);
	});

	it('collects single references and ranges together, skipping out-of-grid ones', () => {
		expect([...referencedCells('=SUM(A2:A3)+C4', 3, 5)].sort()).toEqual(['0::0', '1::0', '2::2']);
		expect([...referencedCells('=A2+Z9', 3, 5)]).toEqual(['0::0']);
	});
});

describe('formula hints', () => {
	it('completes a partial name and stops once it is exact', () => {
		expect(matchFunctions('=SU', 3).map((f) => f.name)).toEqual(['SUBSTITUTE', 'SUM', 'SUMIF', 'SUMPRODUCT']);
		expect(matchFunctions('=SUM', 4).map((f) => f.name)).toEqual(['SUM', 'SUMIF', 'SUMPRODUCT']);
		expect(matchFunctions('=TODAY', 6)).toEqual([]); // exact and unique - nothing left to offer
	});

	it('offers nothing outside a formula', () => {
		expect(matchFunctions('SUM', 3)).toEqual([]);
		expect(matchFunctions('=', 1)).toEqual([]);
	});

	it('inserts the name with an open paren and the caret inside it', () => {
		const fn = FORMULA_FUNCTIONS.find((f) => f.name === 'SUM')!;
		expect(applyFunction('=SU', 3, fn)).toEqual({ text: '=SUM(', caret: 5 });
		expect(applyFunction('=1+AV)', 5, FORMULA_FUNCTIONS.find((f) => f.name === 'AVERAGE')!)).toEqual({
			text: '=1+AVERAGE()',
			caret: 11
		});
	});
});

describe('point mode', () => {
	it('takes a click only where a reference can go', () => {
		expect(expectsReference('=', 1)).toBe(true);
		expect(expectsReference('=SUM(', 5)).toBe(true);
		expect(expectsReference('=A2+', 4)).toBe(true);
		expect(expectsReference('=A2', 3)).toBe(true); // clicking again replaces it
		expect(expectsReference('=SUM(A2:A4)', 11)).toBe(false); // closed - a click commits
		expect(expectsReference('plain text', 10)).toBe(false);
	});

	it('appends after an operator and replaces a reference already typed', () => {
		expect(applyReference('=', 1, 'B2')).toEqual({ text: '=B2', caret: 3 });
		expect(applyReference('=A2', 3, 'B5')).toEqual({ text: '=B5', caret: 3 });
		expect(applyReference('=SUM(A2:A4', 10, 'A2:A9')).toEqual({ text: '=SUM(A2:A9', caret: 10 });
	});
});

describe('aggregatesOwnColumn', () => {
	it('spots a totals cell reading its own column, and lets a per-row formula through', () => {
		// `=SUM(D2:D4)` sitting in column D (index 3) already contains those values.
		expect(aggregatesOwnColumn('=SUM(D2:D4)', 3, 5, 4)).toBe(true);
		// `=B2*C2` in column D reads elsewhere — an ordinary value to aggregate.
		expect(aggregatesOwnColumn('=B2*C2', 3, 5, 4)).toBe(false);
		// A mixed formula still touches its own column, so it still double-counts.
		expect(aggregatesOwnColumn('=D2+B2', 3, 5, 4)).toBe(true);
	});
});

describe('a broken formula', () => {
	const c4 = cols('A', 'B', 'C', 'D');

	it('does not take the rest of the sheet down with it', () => {
		// xlsx-calc builds every expression before evaluating any, so one unparseable
		// formula used to leave every computed cell in the grid blank.
		const out = resolveFormulaRows(
			c4,
			rows([2, 10, '=A2*B2', '=X9+'], [3, 20, '=A3*B3', '=ALSOBAD('])
		);
		expect(out[0].c3).toBe(20);
		expect(out[1].c3).toBe(60);
		expect(out[0].c4).toBe('#ERROR!');
		expect(out[1].c4).toBe('#ERROR!');
	});

	it('still computes what a circular reference does not touch', () => {
		const out = resolveFormulaRows(c4, rows([2, 10, '=A2*B2', '=D2']));
		expect(out[0].c3).toBe(20);
		expect(out[0].c4).toBe('#ERROR!');
	});
});
