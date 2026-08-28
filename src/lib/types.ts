export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'dropdown' | 'date';

export type CellValue = string | number | boolean | null;

export interface Column {
	id: string;
	name: string;
	type: ColumnType;
	width?: number;
}

export type Row = { id: string; [key: string]: CellValue };

export type CellAlign = 'left' | 'center' | 'right';

/** Per-cell horizontal alignment overrides, keyed `rowId::columnId`. */
export type CellAlignMap = Record<string, CellAlign>;

export interface TableData {
	title: string;
	columns: Column[];
	rows: Row[];
	cellAlign?: CellAlignMap;
}

export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
	columnId: string;
	direction: SortDirection;
}

export interface ColumnSummary {
	count: number;
	countNonEmpty: number;
	sum?: number;
	avg?: number;
	min?: number;
	max?: number;
}

export interface HistoryEntry {
	title: string;
	columns: Column[];
	rows: Row[];
	cellAlign: CellAlignMap;
}

