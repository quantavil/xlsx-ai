import { describe, expect, it } from 'bun:test';
import type { Column, Row } from '../../src/lib/types';
import { resolveFormulaRows, sheetRowNumber } from '../../src/lib/table/formulas';
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
