import { z } from 'zod';
import type {
	ColumnType,
	Column,
	Row,
	TableData,
	CellValue,
	FillValue,
	CellAlignMap,
	DropdownConfig,
	DropdownOption
} from '$lib/types';
import { normalizeCellValue } from './cells';


export const CellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ColumnTypeSchema = z.enum(['text', 'number', 'currency', 'percent', 'dropdown', 'date']);

export const MAX_DROPDOWN_OPTIONS = 5_000;

/** A coupled column count high enough for any real payload, low enough to bound a file. */
export const MAX_DROPDOWN_FILLS = 20;

/** `{ from: 'QuantityUnit' }`: take this row's value in that column. */
export const FillReferenceSchema = z.object({ from: z.string().min(1).max(100) }).strict();

export const PersistedDropdownOptionSchema = z.object({
	value: z.string().min(1).max(200),
	label: z.string().max(200).optional(),
	parentValue: z.string().max(200).optional(),
	fills: z
		.record(z.string().min(1).max(100), z.union([CellValueSchema, FillReferenceSchema]))
		.optional()
});

export const PersistedDropdownConfigSchema = z.object({
	options: z.array(PersistedDropdownOptionSchema).max(MAX_DROPDOWN_OPTIONS),
	allowCustom: z.boolean(),
	dependsOnColumnId: z.string().min(1).max(100).optional()
});

export const PersistedColumnSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(200),
	type: ColumnTypeSchema,
	width: z.number().min(60).max(800).optional(),
	dropdown: PersistedDropdownConfigSchema.optional()
});

/**
 * The sibling values one option carries, or undefined when it carries none.
 *
 * `sanitizeDropdownConfig` rebuilds each option field by field, so a payload that is
 * not copied here is silently dropped the first time a table round-trips through
 * storage - coupling that works until reload and then quietly stops.
 */
function sanitizeFills(raw: unknown): Record<string, FillValue> | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

	const fills: Record<string, FillValue> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (Object.keys(fills).length >= MAX_DROPDOWN_FILLS) break;
		const columnId = key.trim();
		if (!columnId || columnId.length > 100) continue;
		const reference = FillReferenceSchema.safeParse(value);
		if (reference.success) {
			fills[columnId] = reference.data;
			continue;
		}
		if (!CellValueSchema.safeParse(value).success) continue;
		fills[columnId] = value as CellValue;
	}

	return Object.keys(fills).length > 0 ? fills : undefined;
}

/**
 * Pure, total sanitizer for one column's dropdown config. A malformed config is
 * dropped; it never invalidates the column itself, so a bad option list can't cost
 * the user their data.
 */
export function sanitizeDropdownConfig(
	raw: unknown,
	column: { id: string; type: ColumnType }
): DropdownConfig | undefined {
	if (column.type !== 'dropdown' || !raw || typeof raw !== 'object') return undefined;

	const candidate = raw as Partial<DropdownConfig>;
	if (!Array.isArray(candidate.options)) return undefined;

	const seen = new Set<string>();
	const options: DropdownOption[] = [];

	for (const opt of candidate.options.slice(0, MAX_DROPDOWN_OPTIONS)) {
		if (!opt || typeof opt !== 'object') continue;

		const value = typeof opt.value === 'string' ? opt.value.trim() : '';
		if (!value || value.length > 200) continue;

		const label = typeof opt.label === 'string' ? opt.label.trim() : '';
		const parentValue = typeof opt.parentValue === 'string' ? opt.parentValue.trim() : '';
		const fills = sanitizeFills(opt.fills);

		// Dedupe on (value, parentValue): the same district code may legitimately
		// appear under two states, but not twice under one.
		const key = `${value.toLowerCase()}\u0000${parentValue.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);

		options.push({
			value,
			...(label && label.length <= 200 ? { label } : {}),
			...(parentValue && parentValue.length <= 200 ? { parentValue } : {}),
			...(fills ? { fills } : {})
		});
	}

	const dependsOnRaw =
		typeof candidate.dependsOnColumnId === 'string' ? candidate.dependsOnColumnId.trim() : '';
	// A column depending on itself would filter its own options by its own value.
	const dependsOnColumnId =
		dependsOnRaw && dependsOnRaw !== column.id ? dependsOnRaw : undefined;

	return {
		options,
		allowCustom: candidate.allowCustom !== false,
		...(dependsOnColumnId ? { dependsOnColumnId } : {})
	};
}

export const CellAlignSchema = z.enum(['left', 'center', 'right']);

export const PersistedTableDocumentV2Schema = z.object({
	version: z.literal(2),
	title: z.string().max(200),
	columns: z.array(PersistedColumnSchema),
	rows: z.array(z.record(z.string(), CellValueSchema)),
	cellAlign: z.record(z.string(), CellAlignSchema).optional(),
	updatedAt: z.string().optional()
});

export type PersistedTableDocumentV2 = z.infer<typeof PersistedTableDocumentV2Schema>;

export type HydrationResult = {
	status: 'restored' | 'missing' | 'invalid';
	document?: TableData;
};

export function sanitizeAndNormalizeTableData(
	title: string,
	columns: Column[],
	rows: Row[],
	cellAlign?: CellAlignMap
): TableData {
	// Deduplicate column IDs
	const seenColIds = new Set<string>();
	const cleanColumns: Column[] = [];

	for (const col of columns) {
		if (!col || typeof col !== 'object' || !col.id) continue;
		const id = String(col.id).trim();
		if (!id || seenColIds.has(id)) continue;
		seenColIds.add(id);

		const type: ColumnType = ColumnTypeSchema.safeParse(col.type).success ? col.type : 'text';
		const dropdown = sanitizeDropdownConfig(col.dropdown, { id, type });
		cleanColumns.push({
			id,
			name: col.name ? String(col.name).trim() : 'Untitled Column',
			type,
			width: typeof col.width === 'number' ? Math.max(60, Math.min(800, col.width)) : 160,
			...(dropdown ? { dropdown } : {})
		});
	}

	// Normalize rows
	const seenRowIds = new Set<string>();
	const cleanRows: Row[] = [];

	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		if (!r || typeof r !== 'object') continue;
		let rowId = r.id ? String(r.id).trim() : `r${i + 1}`;
		if (seenRowIds.has(rowId)) {
			rowId = `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
		}
		seenRowIds.add(rowId);

		const cleanRow: Row = { id: rowId };
		for (const col of cleanColumns) {
			const rawVal = r[col.id];
			cleanRow[col.id] = normalizeCellValue(col.type, rawVal as CellValue);
		}
		cleanRows.push(cleanRow);
	}

	// Alignment overrides outlive nothing: keys pointing at a deleted row or column are
	// dropped here, so the map can never grow unbounded across saves.
	let cleanAlign: CellAlignMap | undefined;
	if (cellAlign) {
		cleanAlign = {};
		for (const [key, align] of Object.entries(cellAlign)) {
			const [rowId, colId] = key.split('::');
			if (!seenRowIds.has(rowId) || !seenColIds.has(colId)) continue;
			if (align === 'left' || align === 'center' || align === 'right') cleanAlign[key] = align;
		}
	}

	return {
		title: title.trim() || 'Untitled Table',
		columns: cleanColumns,
		rows: cleanRows,
		cellAlign: cleanAlign
	};
}

export function parseAndMigrateTableDocument(raw: unknown): HydrationResult {
	if (!raw) return { status: 'missing' };

	let obj: unknown = raw;
	if (typeof raw === 'string') {
		try {
			obj = JSON.parse(raw);
		} catch {
			return { status: 'invalid' };
		}
	}

	if (!obj || typeof obj !== 'object') {
		return { status: 'invalid' };
	}

	const doc = obj as Record<string, unknown>;

	// Check if already V2
	if (doc.version === 2) {
		const parsed = PersistedTableDocumentV2Schema.safeParse(doc);
		if (parsed.success) {
			const sanitized = sanitizeAndNormalizeTableData(
				parsed.data.title,
				parsed.data.columns as Column[],
				parsed.data.rows as Row[],
				parsed.data.cellAlign
			);
			return { status: 'restored', document: sanitized };
		}
	}

	// Migrate from V1 or unversioned format
	if (Array.isArray(doc.columns)) {
		const rawCols = doc.columns as Column[];
		const rawRows = Array.isArray(doc.rows) ? (doc.rows as Row[]) : [];
		const title = typeof doc.title === 'string' ? doc.title : 'Untitled Table';

		if (rawCols.length > 0) {
			const sanitized = sanitizeAndNormalizeTableData(
				title,
				rawCols,
				rawRows,
				doc.cellAlign as CellAlignMap | undefined
			);
			return { status: 'restored', document: sanitized };
		}
	}

	return { status: 'invalid' };
}
