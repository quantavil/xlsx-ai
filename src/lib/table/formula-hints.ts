/**
 * Function name completion for the cell editor.
 *
 * The catalog is exactly what `xlsx-calc` can evaluate — offering a name the engine
 * would answer `#ERROR!` for is worse than offering nothing. Signatures are Excel's,
 * trimmed to the arguments that actually matter.
 */

export interface FormulaFunction {
	name: string;
	signature: string;
}

export const FORMULA_FUNCTIONS: readonly FormulaFunction[] = [
	{ name: 'ABS', signature: 'ABS(number)' },
	{ name: 'AVERAGE', signature: 'AVERAGE(number1, …)' },
	{ name: 'CEILING', signature: 'CEILING(number, significance)' },
	{ name: 'CHOOSE', signature: 'CHOOSE(index, value1, …)' },
	{ name: 'CONCATENATE', signature: 'CONCATENATE(text1, …)' },
	{ name: 'CORREL', signature: 'CORREL(array1, array2)' },
	{ name: 'COUNTA', signature: 'COUNTA(value1, …)' },
	{ name: 'COVARIANCE.P', signature: 'COVARIANCE.P(array1, array2)' },
	{ name: 'DATEDIF', signature: 'DATEDIF(start, end, unit)' },
	{ name: 'DAY', signature: 'DAY(date)' },
	{ name: 'EOMONTH', signature: 'EOMONTH(start, months)' },
	{ name: 'EXP', signature: 'EXP(number)' },
	{ name: 'FILTER', signature: 'FILTER(array, include)' },
	{ name: 'FLOOR', signature: 'FLOOR(number, significance)' },
	{ name: 'FLOOR.MATH', signature: 'FLOOR.MATH(number, significance)' },
	{ name: 'HLOOKUP', signature: 'HLOOKUP(value, table, row, [exact])' },
	{ name: 'IF', signature: 'IF(test, then, else)' },
	{ name: 'IFS', signature: 'IFS(test1, value1, …)' },
	{ name: 'INDEX', signature: 'INDEX(array, row, [column])' },
	{ name: 'IRR', signature: 'IRR(values, [guess])' },
	{ name: 'ISBLANK', signature: 'ISBLANK(value)' },
	{ name: 'ISERROR', signature: 'ISERROR(value)' },
	{ name: 'ISNUMBER', signature: 'ISNUMBER(value)' },
	{ name: 'LEFT', signature: 'LEFT(text, count)' },
	{ name: 'LEN', signature: 'LEN(text)' },
	{ name: 'LN', signature: 'LN(number)' },
	{ name: 'MATCH', signature: 'MATCH(value, array, [type])' },
	{ name: 'MAX', signature: 'MAX(number1, …)' },
	{ name: 'MIN', signature: 'MIN(number1, …)' },
	{ name: 'MONTH', signature: 'MONTH(date)' },
	{ name: 'NORM.INV', signature: 'NORM.INV(probability, mean, sd)' },
	{ name: 'PMT', signature: 'PMT(rate, periods, present)' },
	{ name: 'RIGHT', signature: 'RIGHT(text, count)' },
	{ name: 'ROUND', signature: 'ROUND(number, digits)' },
	{ name: 'SQRT', signature: 'SQRT(number)' },
	{ name: 'STDEV', signature: 'STDEV(number1, …)' },
	{ name: 'SUBSTITUTE', signature: 'SUBSTITUTE(text, old, new)' },
	{ name: 'SUM', signature: 'SUM(number1, …)' },
	{ name: 'SUMIF', signature: 'SUMIF(range, criteria, [sum_range])' },
	{ name: 'SUMPRODUCT', signature: 'SUMPRODUCT(array1, …)' },
	{ name: 'TIME', signature: 'TIME(hour, minute, second)' },
	{ name: 'TODAY', signature: 'TODAY()' },
	{ name: 'TRIM', signature: 'TRIM(text)' },
	{ name: 'VAR.P', signature: 'VAR.P(number1, …)' },
	{ name: 'VLOOKUP', signature: 'VLOOKUP(value, table, column, [exact])' },
	{ name: 'YEAR', signature: 'YEAR(date)' }
];

/** Longest run of function-name characters ending at `caret`. */
function tokenBefore(text: string, caret: number): string {
	const match = /[A-Za-z][A-Za-z0-9._]*$/.exec(text.slice(0, caret));
	return match ? match[0] : '';
}

/**
 * Functions worth offering for what sits just left of the caret.
 *
 * Empty unless the text is a formula and the caret follows a partial name, so an
 * ordinary text cell — or a formula mid-reference — never pops a list. A name that
 * already matches exactly is finished, not a prefix to complete.
 */
export function matchFunctions(text: string, caret: number): FormulaFunction[] {
	if (text[0] !== '=') return [];
	const token = tokenBefore(text, caret);
	if (!token) return [];

	const upper = token.toUpperCase();
	const matches = FORMULA_FUNCTIONS.filter((fn) => fn.name.startsWith(upper));
	return matches.length === 1 && matches[0].name === upper ? [] : matches;
}

/** Replaces the partial name at the caret with `NAME(`, caret left inside the parens. */
export function applyFunction(
	text: string,
	caret: number,
	fn: FormulaFunction
): { text: string; caret: number } {
	const token = tokenBefore(text, caret);
	const start = caret - token.length;
	const inserted = `${fn.name}(`;
	return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

/**
 * Whether a cell click should write its address here rather than move the selection.
 *
 * True where a reference can legally start — after an operator, a comma, an open
 * paren, or the leading `=` — and also directly after one, since clicking again
 * there replaces it, as it does in Excel. False after a closing paren or a literal,
 * which is what stops point mode from hijacking every click once an editor is open.
 */
export function expectsReference(text: string, caret: number): boolean {
	if (text[0] !== '=') return false;
	const head = text.slice(0, caret);
	return /[=+\-*/^(,:<>&%]\s*$/.test(head) || /\$?[A-Za-z]{1,3}\$?\d+$/.test(head);
}

/** Writes `address` at the caret, replacing a reference already sitting there. */
export function applyReference(
	text: string,
	caret: number,
	address: string
): { text: string; caret: number } {
	// Re-clicking while a reference is the last thing typed replaces it, so dragging
	// from cell to cell tracks the pointer instead of appending a trail of addresses.
	const existing = /\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/.exec(text.slice(0, caret));
	const start = caret - (existing ? existing[0].length : 0);
	return { text: text.slice(0, start) + address + text.slice(caret), caret: start + address.length };
}
