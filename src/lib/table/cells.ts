import type { CellValue, ColumnType } from '$lib/types';


const NUMERIC_TYPES = new Set<ColumnType>(['number', 'currency', 'percent']);

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

export function normalizeCellValue(type: ColumnType, value: CellValue | undefined): CellValue {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' && value.trim() === '') return null;
	if (NUMERIC_TYPES.has(type)) return numericCellValue(type, value);
	if (typeof value === 'string') return value.trim();
	return value;
}
