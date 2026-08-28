import { z } from 'zod';
import type { ColumnType, Column, Row, TableData, CellValue, CellAlignMap } from '$lib/types';
import { normalizeCellValue } from './cells';


export const CellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ColumnTypeSchema = z.enum(['text', 'number', 'currency', 'percent', 'dropdown', 'date']);

export const PersistedColumnSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(200),
	type: ColumnTypeSchema,
	width: z.number().min(60).max(800).optional()
});

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
		cleanColumns.push({
			id,
			name: col.name ? String(col.name).trim() : 'Untitled Column',
			type,
			width: typeof col.width === 'number' ? Math.max(60, Math.min(800, col.width)) : 160
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
