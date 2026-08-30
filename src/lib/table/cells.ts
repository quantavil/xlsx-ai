import type { CellAlign, CellValue, Column, ColumnType, DropdownOption, Row } from '$lib/types';


const NUMERIC_TYPES = new Set<ColumnType>(['number', 'currency', 'percent']);

/** The three types the grid right-aligns, sums, and exports as Excel numbers. */
export function isNumericType(type: ColumnType | string | undefined): boolean {
	return NUMERIC_TYPES.has(type as ColumnType);
}

function parseNumeric(value: CellValue): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string') return null;

	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseFloat(trimmed.replace(/[^0-9.-]/g, ''));
	return Number.isFinite(parsed) ? parsed : null;
}

export function numericCellValue(type: ColumnType, value: CellValue | undefined): number | null {
	if (!NUMERIC_TYPES.has(type) || value === null || value === undefined || value === '') return null;
	const parsed = parseNumeric(value);
	if (parsed === null) return null;
	if (type !== 'percent' || typeof value === 'number') return parsed;

	return (typeof value === 'string' && value.includes('%')) || Math.abs(parsed) > 1
		? parsed / 100
		: parsed;
}

/** An Excel formula the user typed. Stored verbatim; `resolveFormulaRows` computes it. */
export function isFormula(value: CellValue | undefined): value is string {
	return typeof value === 'string' && value.length > 1 && value[0] === '=';
}

export function normalizeCellValue(type: ColumnType, value: CellValue | undefined): CellValue {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' && value.trim() === '') return null;
	// A formula survives every column type verbatim - coercing `=SUM(A1:B1)` through
	// numericCellValue would strip it to the digits it happens to contain.
	if (typeof value === 'string' && isFormula(value.trim())) return value.trim();
	if (NUMERIC_TYPES.has(type)) return numericCellValue(type, value);
	if (typeof value === 'string') return value.trim();
	return value;
}

/** Excel's own default: numbers hug the right so digits line up, everything else left. */
export function defaultAlignForType(type: ColumnType): CellAlign {
	return NUMERIC_TYPES.has(type) ? 'right' : 'left';
}

/**
 * The option list a dropdown cell should offer, in commit order.
 *
 * Configured built-ins come first and keep their labels. Values already present in
 * the column are appended so loading an older table never hides data the user can
 * still see in the grid. When the column depends on another, only options whose
 * `parentValue` matches that row's dependency cell survive — but a value already in
 * *this* row is always offered, so a stale pairing stays visible instead of
 * silently vanishing from its own editor.
 */
export function resolveDropdownOptions(
	column: Column,
	row: Row | undefined,
	rows: readonly Row[]
): DropdownOption[] {
	const configured = column.dropdown?.options ?? [];
	const dependsOn = column.dropdown?.dependsOnColumnId;
	const currentValue = typeof row?.[column.id] === 'string' ? String(row[column.id]).trim() : '';

	const parentValue =
		dependsOn && row && typeof row[dependsOn] === 'string' ? String(row[dependsOn]).trim() : '';

	const merged: DropdownOption[] = [];
	const seen = new Set<string>();
	const add = (opt: DropdownOption) => {
		const key = opt.value.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		merged.push(opt);
	};

	for (const opt of configured) {
		if (!opt?.value) continue;
		if (dependsOn) {
			// An unset parent narrows to nothing rather than offering every district
			// in the country; the row's own value is still added below.
			const matchesParent =
				normalizeParentKey(opt.parentValue) !== '' &&
				normalizeParentKey(opt.parentValue) === normalizeParentKey(parentValue);
			if (!matchesParent && opt.value !== currentValue) continue;
		}
		add(opt);
	}

	// Columns with no configured catalog keep the historical behavior: offer whatever
	// the column already contains.
	if (configured.length === 0 || column.dropdown?.allowCustom !== false) {
		// A dependent column's catalog belongs to its parent, so harvesting the whole
		// grid offered one heading's drawback serials under another - and offered them
		// bare, with no description and no coupled values behind them. This row's own
		// value still has to appear or a typed entry vanishes from its own editor.
		const harvest = dependsOn ? (row ? [row] : []) : rows;
		for (const r of harvest) {
			const val = r[column.id];
			if (typeof val === 'string' && val.trim()) add({ value: val.trim() });
		}
	} else if (currentValue) {
		add({ value: currentValue });
	}

	return merged;
}

/**
 * Options safe to apply to every row in one dropdown range.
 * Only a closed dependent catalog needs intersection; ordinary and custom dropdowns
 * retain their active-row behavior.
 */
export function resolveDropdownOptionsForRows(
	column: Column,
	activeRow: Row | undefined,
	selectedRows: readonly Row[],
	allRows: readonly Row[]
): DropdownOption[] {
	const activeOptions = resolveDropdownOptions(column, activeRow, allRows);
	const config = column.dropdown;
	const dependsOn = config?.dependsOnColumnId;
	if (selectedRows.length <= 1 || !config || !dependsOn || config.allowCustom !== false) {
		return activeOptions;
	}

	return activeOptions.filter((candidate) =>
		selectedRows.every((row) => {
			const parentKey = normalizeParentKey(
				typeof row[dependsOn] === 'string' ? String(row[dependsOn]) : undefined
			);
			if (!parentKey) return false;
			return config.options.some(
				(option) =>
					option.value.toLowerCase() === candidate.value.toLowerCase() &&
					normalizeParentKey(option.parentValue) === parentKey
			);
		})
	);
}

/** ICEGATE writes a state as `08` but a district's parent as `8`; both mean state 8. */
function normalizeParentKey(value: string | undefined): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return '';
	return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed.toLowerCase();
}

/** Display text for one option: `08 — RAJASTHAN`, or just the value when unlabeled. */
export function dropdownOptionLabel(opt: DropdownOption): string {
	return opt.label ? `${opt.value} — ${opt.label}` : opt.value;
}
