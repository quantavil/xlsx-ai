import type { CellValue, ColumnType } from '$lib/types';
import { numericCellValue } from './cells';

export type ValueFilter = { kind: 'values'; values: string[] };
export type ConditionFilter = {
	kind: 'condition';
	op:
		| 'eq'
		| 'neq'
		| 'gt'
		| 'gte'
		| 'lt'
		| 'lte'
		| 'between'
		| 'contains'
		| 'notContains'
		| 'startsWith'
		| 'endsWith'
		| 'before'
		| 'after'
		| 'on'
		| 'isEmpty'
		| 'isNotEmpty';
	value?: string;
	value2?: string;
};

export type ConditionOp = ConditionFilter['op'];
export type ColumnFilter = ValueFilter | ConditionFilter;
export type ColumnFilters = Record<string, ColumnFilter>;

import { isBlank } from './cells';

const isCellEmpty = isBlank;

/** Stringified value used for value-list filtering and display */
export function stringifyCellValue(val: CellValue): string {
	if (val === null || val === undefined) return '';
	return String(val);
}

export function passesColumnFilter(
	cellVal: CellValue,
	filter: ColumnFilter,
	colType: ColumnType
): boolean {
	if (filter.kind === 'values') {
		return filter.values.includes(stringifyCellValue(cellVal));
	}

	const f = filter;
	if (f.op === 'isEmpty') return isCellEmpty(cellVal);
	if (f.op === 'isNotEmpty') return !isCellEmpty(cellVal);

	if (colType === 'number' || colType === 'currency' || colType === 'percent') {
		return passesNumericCondition(cellVal, f, colType);
	}
	if (colType === 'date') return passesDateCondition(cellVal, f);
	return passesTextCondition(cellVal, f);
}

function passesNumericCondition(cellVal: CellValue, f: ConditionFilter, colType: ColumnType): boolean {
	const op = f.op;
	const cellNum = numericCellValue(colType, cellVal);
	const filterNum = f.value !== undefined ? numericCellValue(colType, f.value as CellValue) : null;
	const filterNum2 = f.value2 !== undefined ? numericCellValue(colType, f.value2 as CellValue) : null;

	switch (op) {
		case 'eq': {
			if (cellNum === null && filterNum === null) return true;
			if (cellNum === null || filterNum === null) return false;
			return cellNum === filterNum;
		}
		case 'neq': {
			if (cellNum === null && filterNum === null) return false;
			if (cellNum === null || filterNum === null) return true;
			return cellNum !== filterNum;
		}
		case 'gt':
			if (cellNum === null || filterNum === null) return false;
			return cellNum > filterNum;
		case 'gte':
			if (cellNum === null || filterNum === null) return false;
			return cellNum >= filterNum;
		case 'lt':
			if (cellNum === null || filterNum === null) return false;
			return cellNum < filterNum;
		case 'lte':
			if (cellNum === null || filterNum === null) return false;
			return cellNum <= filterNum;
		case 'between': {
			if (cellNum === null || filterNum === null || filterNum2 === null) return false;
			const lo = Math.min(filterNum, filterNum2);
			const hi = Math.max(filterNum, filterNum2);
			return cellNum >= lo && cellNum <= hi;
		}
		default:
			return false;
	}
}

/**
 * Epoch for a cell or filter value, with `YYYY-MM-DD` read as local midnight.
 *
 * `Date.parse` reads a date-only ISO string as UTC but `MM/DD/YYYY` as local. A
 * filter typed as `2024-01-05` against a cell holding `01/05/2024` would then be
 * 5.5 hours apart here and a whole day apart west of Greenwich, so `on` would miss
 * the row it was pointed at. Reading both as local midnight keeps the comparison
 * in one frame of reference.
 */
function parseDateValue(raw: string): number {
	const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
	if (isoDateOnly) {
		const [, y, m, d] = isoDateOnly;
		return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
	}
	return Date.parse(raw);
}

function passesDateCondition(cellVal: CellValue, f: ConditionFilter): boolean {
	const op = f.op;
	const cellStr = isCellEmpty(cellVal) ? '' : String(cellVal);
	const cellTs = cellStr ? parseDateValue(cellStr) : NaN;
	const cellValid = !isNaN(cellTs);
	const filterTs = f.value ? parseDateValue(f.value) : NaN;
	const filterTs2 = f.value2 ? parseDateValue(f.value2) : NaN;
	const filterValid = !isNaN(filterTs);
	const filterValid2 = !isNaN(filterTs2);

	switch (op) {
		case 'before':
			if (!cellValid || !filterValid) return false;
			return cellTs < filterTs;
		case 'after':
			if (!cellValid || !filterValid) return false;
			return cellTs > filterTs;
		case 'on': {
			if (!cellValid || !filterValid) return false;
			const a = new Date(cellTs);
			const b = new Date(filterTs);
			return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
		}
		case 'between': {
			if (!cellValid || !filterValid || !filterValid2) return false;
			const lo = Math.min(filterTs, filterTs2);
			const hi = Math.max(filterTs, filterTs2);
			return cellTs >= lo && cellTs <= hi;
		}
		case 'eq': {
			if (!cellValid || !filterValid) return false;
			return cellTs === filterTs;
		}
		case 'neq': {
			if (!cellValid && !filterValid) return false;
			if (!cellValid || !filterValid) return true;
			return cellTs !== filterTs;
		}
		default:
			return false;
	}
}

function passesTextCondition(cellVal: CellValue, f: ConditionFilter): boolean {
	const op = f.op;
	const cellStr = isCellEmpty(cellVal) ? '' : String(cellVal);
	const cellLower = cellStr.toLowerCase();
	const needle = (f.value ?? '').toLowerCase();
	switch (op) {
		case 'eq':
			return cellLower === needle;
		case 'neq':
			return cellLower !== needle;
		case 'contains':
			if (needle === '') return true;
			return cellLower.includes(needle);
		case 'notContains':
			// The mirror of `contains ''` matching everything.
			if (needle === '') return false;
			return !cellLower.includes(needle);
		case 'startsWith':
			if (needle === '') return true;
			return cellLower.startsWith(needle);
		case 'endsWith':
			if (needle === '') return true;
			return cellLower.endsWith(needle);
		// Numeric and date operators are not offered for text columns.
		case 'gt':
		case 'gte':
		case 'lt':
		case 'lte':
		case 'between':
		case 'before':
		case 'after':
		case 'on':
			return false;
		default:
			return false;
	}
}

/** Distinct values present in column using resolved rows (for UI checklist) */
export function distinctValuesForColumn(
	resolvedRows: Array<Record<string, CellValue>>,
	columnId: string
): string[] {
	const set = new Set<string>();
	for (const row of resolvedRows) {
		const v = row?.[columnId];
		set.add(stringifyCellValue(v as CellValue));
	}
	return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
}

export function conditionOpsForType(colType: ColumnType): Array<{ op: ConditionFilter['op']; label: string }> {
	const numericOps: Array<{ op: ConditionFilter['op']; label: string }> = [
		{ op: 'eq', label: 'Equals' },
		{ op: 'neq', label: 'Not equals' },
		{ op: 'gt', label: '>' },
		{ op: 'gte', label: '>=' },
		{ op: 'lt', label: '<' },
		{ op: 'lte', label: '<=' },
		{ op: 'between', label: 'Between' },
		{ op: 'isEmpty', label: 'Is empty' },
		{ op: 'isNotEmpty', label: 'Is not empty' }
	];
	const textOps: Array<{ op: ConditionFilter['op']; label: string }> = [
		{ op: 'contains', label: 'Contains' },
		{ op: 'notContains', label: 'Does not contain' },
		{ op: 'eq', label: 'Equals' },
		{ op: 'startsWith', label: 'Starts with' },
		{ op: 'endsWith', label: 'Ends with' },
		{ op: 'isEmpty', label: 'Is empty' },
		{ op: 'isNotEmpty', label: 'Is not empty' }
	];
	const dateOps: Array<{ op: ConditionFilter['op']; label: string }> = [
		{ op: 'before', label: 'Before' },
		{ op: 'after', label: 'After' },
		{ op: 'on', label: 'On' },
		{ op: 'between', label: 'Between' },
		{ op: 'isEmpty', label: 'Is empty' },
		{ op: 'isNotEmpty', label: 'Is not empty' }
	];

	if (colType === 'number' || colType === 'currency' || colType === 'percent') return numericOps;
	if (colType === 'date') return dateOps;
	return textOps;
}


/**
 * The active filters as row predicates, resolved against the current columns.
 *
 * Built once per `filteredRows` recomputation rather than per row: the column
 * lookup and the value-list membership set are the same for every row, and a
 * filter naming a column that no longer exists simply drops out here.
 */
export function compileFilters(
	columns: ReadonlyArray<{ id: string; type: ColumnType }>,
	filters: ColumnFilters
): Array<(row: Record<string, CellValue>) => boolean> {
	const compiled: Array<(row: Record<string, CellValue>) => boolean> = [];

	for (const [colId, filter] of Object.entries(filters)) {
		const col = columns.find((c) => c && c.id === colId);
		if (!col) continue;

		if (filter.kind === 'values') {
			const allowed = new Set(filter.values);
			compiled.push((row) => allowed.has(stringifyCellValue(row[colId])));
			continue;
		}

		const colType = col.type;
		compiled.push((row) => passesColumnFilter(row[colId], filter, colType));
	}

	return compiled;
}
